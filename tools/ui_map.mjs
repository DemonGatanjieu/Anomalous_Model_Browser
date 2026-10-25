// The UI map: from what is on screen to the code and the backend behind it, read from the code
// each time (tools/ui_map_scan.mjs), so it cannot go stale.
//   node tools/ui_map.mjs find <words on screen | key | /anomalous/route | file.js>
//   node tools/ui_map.mjs build    writes docs/ui-map.md (every page's files, words, routes; not tracked)
//   node tools/ui_map.mjs check    the hand-written docs/architecture/ui-flows.md against the code
// check_structure.mjs runs the check: the words in 「」 there are on screen, the files and routes
// it names exist, and no screen word uses a name its glossary retired.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, buildIndex, routeShape } from './ui_map_scan.mjs';

const FLOWS = 'docs/architecture/ui-flows.md';
const MAP = 'docs/ui-map.md';
const SHOWN = 6; // keys shown for one search
const AREAS = [
    ['AI 工作台', /^(ui_ai_|ai_|mcp_)/],
    ['配音与声音', /tts|script|audio|voice/],
    ['图库与图片', /gallery|image|kept|keep|material|output/],
    ['模型', /model|scan|folder|civitai|download|import|sidecar|doctor|hash/],
    ['工作流与搭配', /recipe|combo|notebook|param|workflow|share|backup|sampler|lora/],
    ['提示词', /prompt|translation|tag/],
    ['画布', /canvas|node|placement|quick|spotlight|shortcut/],
    ['外壳与设置', /shell|rail|home|setting|dialog|tour|first_run|update|version|activity|popup|tab|split|sidebar|lifecycle|remote|safe|search|usage|pack|main/],
    ['其他', /./],
];

const short = (text, size = 40) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const plain = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const areaOf = file => AREAS.find(([, test]) => test.test(path.posix.basename(file)))[0];

/** Where `key` shows: [{file, line}] in the web files. */
function placesOf(index, key) {
    return index.files.flatMap(one => (one.uses.get(key) || []).map(line => ({ file: one.file, line, one })));
}

/** The CSS classes made just before `line` in `one` (an element is made, then its words go in), with the CSS that styles them. */
function stylesNear(index, one, line) {
    return [...one.classes].filter(([, lines]) => lines.some(at => at <= line + 1 && at >= line - 8))
        .sort(([, a], [, b]) => Math.min(...a.map(at => Math.abs(at - line))) - Math.min(...b.map(at => Math.abs(at - line))))
        .map(([name]) => ({ name, at: index.css.get(name) || [] })).filter(style => style.at.length).slice(0, 3);
}

function routeLine(route) {
    return `${route.method} ${route.route}  →  ${route.file}:${route.line} ${route.func}`;
}

function callsNear(one, line) {
    return [...one.calls].sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line)).slice(0, 3);
}

function findWords(index, query) {
    const want = query.toLowerCase();
    const scored = [];
    for (const key of index.keys) {
        const zh = plain(index.text.zh[key]);
        const en = plain(index.text.en[key]);
        const values = [zh, en].map(value => value.toLowerCase());
        let score = null;
        if (key.toLowerCase() === want || values.includes(want)) score = 0;
        else if (values.some(value => value.startsWith(want))) score = 1;
        else if (values.some(value => value.includes(want))) score = 2;
        if (score !== null) scored.push({ key, zh, en, score: score + (zh.length > 60 ? 0.5 : 0) });
    }
    scored.sort((a, b) => a.score - b.score || a.zh.length - b.zh.length);
    if (!scored.length) return [`没有哪条界面文字含有「${query}」。换个说法，或用 key、/anomalous/ 地址、文件名查。`];
    const out = [];
    for (const item of scored.slice(0, SHOWN)) {
        out.push('', `「${short(item.zh, 60)}」  ${item.key}`, `   English: ${short(item.en, 70)}   (web/modules/locales.js:${index.text.line('zh', item.key)})`);
        const places = placesOf(index, item.key);
        if (!places.length) out.push('   没有文件用它（可能没用了，或是拼出来的 key）');
        for (const { file, line, one } of places.slice(0, 4)) {
            out.push(`   显示在  ${file}:${line}`);
            for (const style of stylesNear(index, one, line)) out.push(`      样式  .${style.name}  ${style.at.slice(0, 3).join('  ')}`);
            for (const call of callsNear(one, line)) {
                for (const route of call.routes.slice(0, 2)) out.push(`      调用  ${routeLine(route)}   (第 ${call.line} 行)`);
            }
            const from = index.importers.get(file) || [];
            if (from.length) out.push(`      谁用它  ${from.slice(0, 4).join('  ')}${from.length > 4 ? ` 等 ${from.length} 个` : ''}`);
        }
        if (places.length > 4) out.push(`   …还有 ${places.length - 4} 处`);
    }
    if (scored.length > SHOWN) out.push('', `还有 ${scored.length - SHOWN} 条文字也含「${query}」，写得更具体一点可以缩小范围。`);
    return out;
}

function findRoute(index, query) {
    const shape = routeShape(query.replace(/\?.*/, ''));
    // Its start (/anomalous/ai_tasks), or one address with its parts filled in (/anomalous/ai_tasks/123/marks).
    const filled = route => new RegExp(`^${route.shape.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replaceAll('{}', '[^/]+')}$`).test(shape);
    const routes = index.routes.filter(route => route.shape.startsWith(shape) || filled(route));
    if (!routes.length) return [`后端没有以 ${query} 开头的接口。`];
    return routes.flatMap((route) => {
        const callers = index.files.flatMap(one => one.calls.filter(call => call.routes.includes(route)).map(call => `${one.file}:${call.line}`));
        return ['', routeLine(route), `   登记在 ${route.registered}`, callers.length ? `   前端调用  ${callers.slice(0, 8).join('  ')}` : '   前端没有调用（给 MCP、ComfyUI 或别的插件用）'];
    });
}

function findFile(index, query) {
    const one = index.files.find(item => item.file.endsWith(query.replace(/\\/g, '/')));
    if (!one) return [`没有前端文件叫 ${query}。`];
    const words = [...one.uses.keys()].map(key => `「${short(plain(index.text.zh[key]), 24)}」`);
    return [
        one.file, one.about ? `   ${short(one.about, 160)}` : '',
        `   显示的文字（${words.length}）  ${words.slice(0, 16).join(' ')}${words.length > 16 ? ' …' : ''}`,
        ...one.calls.flatMap(call => call.routes.slice(0, 2).map(route => `   调用  ${routeLine(route)}   (第 ${call.line} 行)`)),
        `   谁用它  ${(index.importers.get(one.file) || []).join('  ') || '（入口）'}`,
        `   它用到  ${one.imports.map(file => path.posix.basename(file)).join('  ')}`,
    ].filter(Boolean);
}

export async function find(asked) {
    const index = await buildIndex();
    // Git Bash turns "/anomalous/x" into "C:/Program Files/Git/anomalous/x"; "anomalous/x" is meant the same.
    const query = asked.replace(/^(?:[A-Za-z]:)?[^?]*?\/?(?=anomalous\/)/, '/');
    if (query.startsWith('/anomalous')) return findRoute(index, query);
    if (/\.(m?js)$/.test(query)) return findFile(index, query);
    return findWords(index, query);
}

/** docs/ui-map.md: each page's files with their words and routes, the routes with their callers, and what looks unused. */
export async function build() {
    const index = await buildIndex();
    const lines = ['# AMB UI map (generated)', '', '由 `node tools/ui_map.mjs build` 从代码生成，不进版本库，别手改。查一个按钮用 `node tools/ui_map.mjs find 屏幕上的字`。', ''];
    for (const [area] of AREAS) {
        const files = index.files.filter(one => areaOf(one.file) === area);
        if (!files.length) continue;
        lines.push(`## ${area}`, '');
        for (const one of files) {
            const words = [...one.uses.keys()].map(key => `「${short(plain(index.text.zh[key]), 20)}」`);
            lines.push(`### ${path.posix.basename(one.file)}`, '');
            if (one.about) lines.push(short(one.about, 220), '');
            if (words.length) lines.push(`- 文字（${words.length}）：${words.slice(0, 14).join(' ')}${words.length > 14 ? ' …' : ''}`);
            for (const call of one.calls) for (const route of call.routes.slice(0, 2)) lines.push(`- 调用 \`${route.method} ${route.route}\` → \`${route.file}\` ${route.func}（第 ${call.line} 行）`);
            const from = index.importers.get(one.file) || [];
            if (from.length) lines.push(`- 谁用它：${from.map(file => path.posix.basename(file)).join('、')}`);
            lines.push('');
        }
    }
    lines.push('## 后端接口和调用它的前端', '');
    for (const route of index.routes) {
        const callers = index.files.filter(one => one.calls.some(call => call.routes.includes(route))).map(one => path.posix.basename(one.file));
        lines.push(`- \`${route.method} ${route.route}\` → \`${route.file}\` ${route.func}：${callers.join('、') || '前端没有调用'}`);
    }
    const unused = [...index.keys].filter(key => !index.files.some(one => one.uses.has(key)));
    const lost = index.files.flatMap(one => one.calls.filter(call => !call.routes.length).map(call => `${one.file}:${call.line} ${call.shape}`));
    lines.push('', '## 看起来没用上的', '', `- 没有文件用到的文字 key（${unused.length}）：${unused.join('、') || '无'}`, `- 后端没有的地址（${lost.length}）：${lost.join('、') || '无'}`, '');
    fs.writeFileSync(path.join(ROOT, MAP), lines.join('\n'));
    return [`写好了 ${MAP}：${index.files.length} 个前端文件，${index.routes.length} 个后端接口，${unused.length} 条没用上的文字，${lost.length} 个后端没有的地址。`];
}

/** What is wrong in docs/architecture/ui-flows.md (or `doc`, its text) against the code (check_structure.mjs fails on each). */
export async function check(doc = null) {
    if (doc === null && !fs.existsSync(path.join(ROOT, FLOWS))) return [];
    doc ??= fs.readFileSync(path.join(ROOT, FLOWS), 'utf8');
    const index = await buildIndex();
    const failures = [];
    const zh = Object.values(index.text.zh).map(plain);
    const patterns = zh.map(value => new RegExp(`^${value.split(/\{[^}]*\}/).map(part => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.+')}$`));
    doc.split('\n').forEach((line, at) => {
        const where = `${FLOWS}:${at + 1}`;
        for (const [, quoted] of line.matchAll(/「([^」]+)」/g)) {
            const text = plain(quoted).replace(/\s*[▾▸›]$/, '');
            const prefix = text.endsWith('…') ? text.slice(0, -1) : null;
            const found = prefix ? zh.some(value => value.startsWith(prefix)) : zh.includes(text) || patterns.some(pattern => pattern.test(text));
            if (!found) failures.push(`${where}: 「${quoted}」 is not a word on screen now (web/modules/locales.js); say it as the page does`);
        }
        for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
            if (/^[\w./-]+\.(m?js|py|css)$/.test(token) && !fileExists(token)) failures.push(`${where}: \`${token}\` does not exist`);
            if (token.startsWith('/anomalous/') && !index.routes.some(route => route.shape.startsWith(routeShape(token.replace(/^(GET|POST) /, ''))))) failures.push(`${where}: no backend route \`${token}\``);
        }
    });
    // The glossary: one name for each thing; the names it retired are not on screen.
    const glossary = doc.split(/^## /m).find(part => part.startsWith('统一叫法')) || '';
    for (const row of glossary.split('\n').filter(item => /^\|/.test(item) && !/^\|\s*[-:]/.test(item)).slice(1)) {
        const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
        const retired = [[cells[2], 'zh'], [cells[3], 'en']];
        for (const [list, lang] of retired) {
            for (const word of String(list || '').split(/[、,，]/).map(item => item.replace(/[「」`]/g, '').trim()).filter(item => item && !/^[-—–无]+$/.test(item))) {
                const test = lang === 'en' ? new RegExp(`\\b${word}\\b`, 'i') : null;
                const hits = Object.entries(index.text[lang]).filter(([, value]) => (test ? test.test(value) : String(value).includes(word))).map(([key]) => key);
                if (hits.length) failures.push(`${FLOWS} glossary: "${word}" is retired for 「${cells[0]}」 but still on screen: ${hits.slice(0, 6).join(', ')}`);
            }
        }
    }
    return failures;
}

function fileExists(token) {
    if (fs.existsSync(path.join(ROOT, token))) return true;
    const name = path.posix.basename(token);
    return ['web', 'web/modules', 'web/styles', 'api', 'tools', 'tests', '.'].some(dir => fs.existsSync(path.join(ROOT, dir, name)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, ...rest] = process.argv.slice(2);
    const run = { find: () => find(rest.join(' ')), build, check };
    if (!run[command] || (command === 'find' && !rest.length)) {
        console.log('node tools/ui_map.mjs find <屏幕上的字 | key | /anomalous/地址 | 文件名.js>\nnode tools/ui_map.mjs build\nnode tools/ui_map.mjs check');
        process.exit(command ? 1 : 0);
    }
    const out = await run[command]();
    console.log(out.join('\n') || 'ui-flows.md 和代码一致。');
    if (command === 'check' && out.length) process.exit(1);
}
