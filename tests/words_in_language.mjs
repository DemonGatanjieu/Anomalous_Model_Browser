// What the code puts together itself goes through the locale: `.join('、')` or a "：" in a template shows
// Chinese punctuation in the English window. tts_setup_api.js runs without the window's words.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'modules');
const LEFT_OUT = new Set(['locales.js', 'tts_setup_api.js']);
const CHINESE_JOIN = [/\.join\('[、：]'\)/, /：\$\{/, /\}：[`$]/, /（\$\{/];

const found = [];
for (const name of readdirSync(folder).filter(file => file.endsWith('.js') && !LEFT_OUT.has(file))) {
    readFileSync(join(folder, name), 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (CHINESE_JOIN.some(pattern => pattern.test(line))) found.push(`${name}:${index + 1}: ${line.trim()}`);
    });
}
assert.deepEqual(found, [], 'use t(\'listSeparator\') and t(\'wordColon\')');
console.log('words in the shown language: ok');
