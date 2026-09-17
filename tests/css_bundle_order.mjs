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
assert.equal(digest, 'd014a9d1826e2c48a46ac72389fe4e5bdd0b2ba85618f653d13852cd93812bc1', 'CSS rule bytes or cascade order changed');

console.log('CSS bundle: ordered imports preserve the original stylesheet byte-for-byte.');
