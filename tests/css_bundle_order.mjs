import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = await fs.readFile(path.join(root, 'web/styles.css'), 'utf8');
const imports = [...entry.matchAll(/@import\s+url\("\.\/styles\/([^?"\s]+)\?v=([^"\s]+)"\);/g)];

assert.equal(imports.length, 11, 'the stylesheet entry must contain the full ordered import list');
assert.equal(imports.map(match => match[1]).length, new Set(imports.map(match => match[1])).size, 'imports must be unique');
assert.equal(new Set(imports.map(match => match[2])).size, 1, 'child stylesheets must share one cache version');
assert.equal(entry.replace(/@import[^;]+;\s*/g, ''), '', 'styles.css must remain an import-only external entry');

const chunks = await Promise.all(imports.map(match => fs.readFile(path.join(root, 'web/styles', match[1]))));
const digest = crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
assert.equal(digest, '81ffe429c2512756e1614cd10aa073670c18c18f3dc84e5016ffe330d59e07fb', 'CSS rule bytes or cascade order changed');

console.log('CSS bundle: ordered imports preserve the original stylesheet byte-for-byte.');
