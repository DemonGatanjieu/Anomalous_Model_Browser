// Every check in one go, from the plugin folder: node tools/run_tests.mjs
// The structure check, each tests/*.mjs, then the Python tests (unittest) with the Python
// that runs ComfyUI: $PYTHON when set, else the portable build's python_embeded, else python.
// Exits non-zero when anything fails. See docs/guides/testing.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTABLE_PYTHON = path.resolve(ROOT, '..', '..', '..', 'python_embeded', process.platform === 'win32' ? 'python.exe' : 'python');
const python = process.env.PYTHON || (fs.existsSync(PORTABLE_PYTHON) ? PORTABLE_PYTHON : 'python');

const failed = [];
const run = (label, command, args, { quiet = false } = {}) => {
    const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
    const ok = result.status === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok || !quiet) {
        const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? String(result.error) : ''}`.trim();
        if (output && !ok) console.log(output.split('\n').map(line => `     ${line}`).join('\n'));
    }
    if (!ok) failed.push(label);
};

run('structure check', process.execPath, ['tools/check_structure.mjs'], { quiet: true });
for (const file of fs.readdirSync(path.join(ROOT, 'tests')).filter(name => name.endsWith('.mjs')).sort()) {
    run(`tests/${file}`, process.execPath, [path.join('tests', file)], { quiet: true });
}
run(`Python tests (${path.basename(python)})`, python, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], { quiet: true });

console.log(failed.length ? `\n${failed.length} failed: ${failed.join(', ')}` : '\nAll passed.');
process.exit(failed.length ? 1 : 0);
