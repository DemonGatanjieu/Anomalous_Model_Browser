// ComfyUI imports every .js under web/ on its own, all at once, so any module of an import cycle can happen
// to run first. A module that uses, as it loads, a `const` of a module in its own cycle then fails now and
// then, and AMB with it: no button, no window (docs/architecture/lessons.md). Such a value goes in a module
// outside the cycle.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'modules');
const IMPORT = /^import\s+\{([^}]*)\}\s+from\s+'\.\/([\w.]+\.js)'/gm;

const modules = new Map(readdirSync(folder).filter(name => name.endsWith('.js')).map((name) => {
    const text = readFileSync(join(folder, name), 'utf8').replace(/\r\n/g, '\n');
    const imports = [...text.matchAll(IMPORT)].map(([, names, from]) => ({ from, names: names.split(',').map(item => item.trim().split(/\s+as\s+/)).filter(([first]) => first) }));
    return [name, { text, imports, to: new Set(imports.map(item => item.from)) }];
}));

/** The modules in cycles, each with the set of those in the same cycle (Tarjan, on the imports). */
function cycles() {
    const index = new Map();
    const low = new Map();
    const stack = [];
    const groups = new Map();
    const visit = (name) => {
        index.set(name, index.size);
        low.set(name, index.get(name));
        stack.push(name);
        for (const next of modules.get(name)?.to || []) {
            if (!modules.has(next)) continue;
            if (!index.has(next)) {
                visit(next);
                low.set(name, Math.min(low.get(name), low.get(next)));
            } else if (stack.includes(next)) low.set(name, Math.min(low.get(name), index.get(next)));
        }
        if (low.get(name) !== index.get(name)) return;
        const group = new Set();
        let member;
        do {
            member = stack.pop();
            group.add(member);
        } while (member !== name);
        for (const item of group) groups.set(item, group);
    };
    for (const name of modules.keys()) if (!index.has(name)) visit(name);
    return groups;
}

/** Is `local` used by a line at the top of `text`, that is one run as the module loads? */
function usedAsItLoads(text, local) {
    return text.split('\n').some(line => /^[\w(]/.test(line)
        && !/^(import|function|async function|export (async )?function|export default function|class)\b/.test(line)
        && new RegExp(`\\b${local}\\b`).test(line.split('=>')[0]));
}

const groups = cycles();
const found = [];
for (const [name, { text, imports }] of modules) {
    for (const { from, names } of imports) {
        if (!groups.get(name)?.has(from) || from === name) continue;
        const source = modules.get(from).text;
        for (const [exported, local = exported] of names) {
            const isValue = new RegExp(`^export (const|let) ${exported}\\b`, 'm').test(source);
            if (isValue && usedAsItLoads(text, local)) found.push(`${name} uses ${exported} of ${from} as it loads`);
        }
    }
}
assert.deepEqual(found, []);
console.log('Module cycles: nothing reads a value of its own cycle as it loads.');
