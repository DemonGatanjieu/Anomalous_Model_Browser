// The UI map's index (tools/ui_map.mjs), read from the code each time so it cannot go stale:
// the words on screen (web/modules/locales.js), what each web file shows of them, the
// /anomalous/ addresses it calls and the CSS classes it makes, which files import it, the
// backend's routes with the function behind each, the words the backend names for the page
// (an option's label_key), and which CSS files style each class.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(ext)).map(f => path.posix.join(dir, f));
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** `/anomalous/...` as written in the code, up to its query: each `${…}` or `{name}` as `{}`. */
export function routeShape(source, from = 0) {
    let out = '';
    for (let at = from; at < source.length; at += 1) {
        const char = source[at];
        if (char === '$' && source[at + 1] === '{') {
            let depth = 0;
            for (at += 1; at < source.length; at += 1) {
                if (source[at] === '{') depth += 1;
                else if (source[at] === '}' && --depth === 0) break;
            }
            out += '{}';
        } else if (char === '{') {
            const end = source.indexOf('}', at);
            out += '{}';
            at = end < 0 ? source.length : end;
        } else if (/[A-Za-z0-9_\-./]/.test(char)) {
            out += char;
        } else {
            break;
        }
    }
    return out.replace(/\/+$/, '');
}

/** Whether frontend address shape `front` can reach backend route shape `back` (each `{}` any part). */
export function reaches(front, back) {
    if (front === back) return true;
    const pattern = new RegExp(`^${front.split('{}').map(part => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return pattern.test(back.replaceAll('{}', 'X'));
}

async function words() {
    const { i18n } = await import(pathToFileURL(path.join(ROOT, 'web/modules/locales.js')).href);
    const text = read('web/modules/locales.js');
    const lines = new Map();
    let lang = null;
    text.split('\n').forEach((line, index) => {
        const head = line.match(/^ {4}(\w+): \{/);
        if (head) lang = head[1];
        const key = line.match(/^ {8}([A-Za-z_]\w*):/);
        if (key && lang) lines.set(`${lang}:${key[1]}`, index + 1);
    });
    return { zh: i18n.zh || {}, en: i18n.en || {}, line: (lang, key) => lines.get(`${lang}:${key}`) || 0 };
}

function backendRoutes() {
    const routes = [];
    for (const file of ['__init__.py', ...list('api', '.py')]) {
        const text = read(file);
        const defs = new Map([...text.matchAll(/^(?:async )?def (\w+)\(/gm)].map(match => [match[1], lineAt(text, match.index)]));
        const added = /router\.add_(?:(get|post|put|delete|patch)\(|route\(\s*['"]([*A-Z]+)['"]\s*,)\s*['"]([^'"]+)['"]\s*,\s*([\w.]+)/g;
        for (const match of text.matchAll(added)) {
            const [, verb, anyVerb, route, handler] = match;
            const method = verb || (anyVerb === '*' ? 'any' : anyVerb);
            const [module, func] = handler.includes('.') ? handler.split('.') : [path.posix.basename(file, '.py'), handler];
            const owner = handler.includes('.') ? `api/${module}.py` : file;
            const ownText = owner === file ? text : (fs.existsSync(path.join(ROOT, owner)) ? read(owner) : '');
            const def = ownText.match(new RegExp(`^(?:async )?def ${func}\\(`, 'm'));
            routes.push({
                method: method.toUpperCase(), route, shape: routeShape(route), file: owner, func,
                line: owner === file ? (defs.get(func) || 0) : (def ? lineAt(ownText, def.index) : 0),
                registered: `${file}:${lineAt(text, match.index)}`,
            });
        }
    }
    return routes;
}

function cssIndex() {
    const where = new Map(); // class -> [file:line]
    for (const file of list('web/styles', '.css')) {
        read(file).split('\n').forEach((line, index) => {
            for (const [, name] of line.matchAll(/\.(anomalous-[\w-]+|amb-[\w-]+)/g)) {
                const at = `${file}:${index + 1}`;
                const known = where.get(name) || [];
                if (!known.includes(at)) known.push(at);
                where.set(name, known);
            }
        });
    }
    return where;
}

const KEY_LIKE = /^[a-zA-Z][A-Za-z0-9_]{2,}$/;
const STRING = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g; // a '\n' inside is part of the string
const TEMPLATE = /`([^`]*)`/g;

/** What one web file uses: words (key -> lines), addresses, classes (class -> lines), imports. */
function scanFile(file, keys) {
    const text = read(file);
    const uses = new Map();
    const use = (key, line) => uses.set(key, [...(uses.get(key) || []), line]);
    // A key in quotes: inside t(…) / translate(…), or a name no other string would have (aiCanvasGo).
    for (const match of text.matchAll(STRING)) {
        const value = match[1] ?? match[2];
        if (!keys.has(value)) continue;
        if (/[A-Z_]/.test(value) || /\b(?:t|translate)\(\s*$/.test(text.slice(Math.max(0, match.index - 14), match.index))) use(value, lineAt(text, match.index));
    }
    // A key put together in a template (`aiCanvas_${mode}`): every key it can be.
    for (const match of text.matchAll(TEMPLATE)) {
        const body = match[1];
        if (!body.includes('${')) continue;
        const parts = body.split(/\$\{[^}]*\}/);
        if (!parts[0] || !KEY_LIKE.test(parts[0]) || parts.some(part => !/^[A-Za-z0-9_]*$/.test(part))) continue;
        const pattern = new RegExp(`^${parts.join('[A-Za-z0-9_]+')}$`);
        const line = lineAt(text, match.index);
        for (const key of keys) if (pattern.test(key)) use(key, line);
    }
    const calls = [];
    for (const match of text.matchAll(/['"`](\/anomalous\/)/g)) {
        const shape = routeShape(text, match.index + 1);
        const near = text.slice(match.index, match.index + 260);
        const lead = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
        const method = /method:\s*['"](POST|PUT|DELETE|PATCH)['"]/.exec(near)?.[1]
            || (/post\w*\(\s*$/i.test(lead) ? 'POST' : /fetch\(\s*$/.test(lead) ? 'GET' : null);
        calls.push({ shape, method, line: lineAt(text, match.index) });
    }
    const classes = new Map();
    for (const match of text.matchAll(/\b(anomalous-[a-z0-9-]*[a-z0-9]|amb-[a-z0-9-]*[a-z0-9])\b/g)) {
        const line = lineAt(text, match.index);
        classes.set(match[1], [...(classes.get(match[1]) || []), line]);
    }
    const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+\.js)['"]/g)]
        .map(match => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
    const head = text.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1].replace(/^\s*\* ?/gm, '').replace(/\s+/g, ' ').trim() || '';
    return { file, uses, calls, classes, imports, about: head.split(/(?<=\.)\s+(?=[A-Z(`"])/)[0] || '' };
}

/** Words of the page the backend names (an option's label_key, api/ai_repaint.py): keys in quotes in api/*.py. */
function serverWords(keys) {
    const found = new Set();
    for (const file of list('api', '.py')) {
        for (const match of read(file).matchAll(STRING)) {
            const value = match[1] ?? match[2];
            if (keys.has(value) && /[A-Z]/.test(value)) found.add(value);
        }
    }
    return found;
}

/** The whole index. */
export async function buildIndex() {
    const text = await words();
    const keys = new Set([...Object.keys(text.zh), ...Object.keys(text.en)]);
    const files = [...list('web', '.js'), ...list('web/modules', '.js')].filter(file => file !== 'web/modules/locales.js').map(file => scanFile(file, keys));
    const importers = new Map();
    for (const one of files) for (const target of one.imports) importers.set(target, [...(importers.get(target) || []), one.file]);
    const routes = backendRoutes();
    for (const one of files) {
        for (const call of one.calls) {
            const exact = routes.filter(route => route.shape === call.shape);
            call.routes = (exact.length ? exact : routes.filter(route => reaches(call.shape, route.shape)))
                .filter(route => !call.method || exact.length < 2 || route.method === call.method);
        }
    }
    return { text, keys, files, importers, routes, serverKeys: serverWords(keys), css: cssIndex() };
}
