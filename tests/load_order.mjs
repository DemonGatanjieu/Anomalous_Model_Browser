// ComfyUI loads every .js file of the plugin as an extension, all at once, so any of them may be the
// first to run. In an import cycle the one that runs first can find a binding of another file not
// made yet ("Cannot access 'x' before initialization"), and then the whole plugin fails to load
// (1.63: ui_ai_workbench.js set ui_ai_toolbox.js's sideHost at load). This enters each file first,
// in a Node of its own with the page stood in for (tests/load_order/), and fails on any such error.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..', 'web');
const files = [
    ...fs.readdirSync(web).filter(name => name.endsWith('.js')),
    ...fs.readdirSync(path.join(web, 'modules')).filter(name => name.endsWith('.js')).map(name => `modules/${name}`),
];
const page = pathToFileURL(path.join(here, 'load_order', 'page.mjs')).href;
const enter = path.join(here, 'load_order', 'enter.mjs');

const first = file => new Promise(done => {
    execFile(process.execPath, ['--import', page, enter, path.join(web, file)], { timeout: 30000, encoding: 'utf8' },
        (error, stdout) => done(String(stdout || '').trim().split('\n').pop() || `ERR ${error?.message || 'no answer'}`));
});

const failed = [];
let next = 0;
async function worker() {
    while (next < files.length) {
        const file = files[next++];
        const said = await first(file);
        if (/before initialization/.test(said)) failed.push(`${file}: ${said.slice(4)}`);
    }
}
await Promise.all(Array.from({ length: Math.max(2, Math.min(8, os.cpus().length - 1)) }, worker));
assert.deepEqual(failed, [], `run first, these files find a binding not made yet; the plugin would not load:\n${failed.join('\n')}`);
console.log(`load_order: each of ${files.length} files can run first`);
