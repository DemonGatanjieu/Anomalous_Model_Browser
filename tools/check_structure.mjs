// Structure check, run before every commit: node tools/check_structure.mjs
// Fails when a source file is missing from the architecture map, or a web
// module is no longer imported from an entry. Warns about files over the size
// review threshold in AGENTS.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => path.posix.join(dir, f));

const ENTRIES = ['web/main.js', 'web/hash_resolver.js'];
// Language catalogs and data tables are exempt from the size threshold (AGENTS.md section 2).
const SIZE_EXEMPT = new Set(['web/modules/locales.js']);
const SIZE_LIMIT = 600;

const pythonFiles = [...list('.', '.py'), ...list('api', '.py')].filter((f) => !f.endsWith('__init__.py'));
const webFiles = [...list('web', '.js'), ...list('web/modules', '.js')];
const failures = [];

// 1. Every source file has a line in ARCHITECTURE.md or docs/architecture/.
const docs = ['ARCHITECTURE.md', ...list('docs/architecture', '.md')].map(read).join('\n');
for (const file of [...pythonFiles, ...webFiles]) {
    if (!docs.includes(path.posix.basename(file))) failures.push(`${file}: no line in the architecture map`);
}

// 2. Every web module is reachable by imports from an entry.
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+\.js)['"]/g;
const reached = new Set();
const walk = (file) => {
    if (reached.has(file) || !fs.existsSync(path.join(ROOT, file))) return;
    reached.add(file);
    for (const [, spec] of read(file).matchAll(IMPORT)) walk(path.posix.join(path.posix.dirname(file), spec));
};
ENTRIES.forEach(walk);
for (const file of webFiles) {
    if (!reached.has(file)) failures.push(`${file}: not imported from ${ENTRIES.join(' or ')}; remove it or wire it in`);
}

// 3. Size review threshold (warning only).
const large = [...pythonFiles, ...webFiles]
    .filter((f) => !SIZE_EXEMPT.has(f))
    .map((f) => [f, read(f).split('\n').length])
    .filter(([, lines]) => lines > SIZE_LIMIT)
    .sort((a, b) => b[1] - a[1]);

if (large.length) {
    console.log(`Over ${SIZE_LIMIT} lines (review before adding features, AGENTS.md section 2):`);
    for (const [file, lines] of large) console.log(`  ${lines}\t${file}`);
}
if (failures.length) {
    console.error(`\nStructure check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`\nStructure check passed: ${pythonFiles.length + webFiles.length} source files mapped, ${reached.size} web modules reachable.`);
