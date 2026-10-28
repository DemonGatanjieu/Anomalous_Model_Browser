// The rail's labels and the page titles name their screen words by key (labelKey, TITLE_KEYS),
// so a search for t('…') does not find them: each must still be in both languages.
// (ce35145 removed 'models' and 'gallery' as unused; the rail then showed the raw keys.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { i18n } from '../web/modules/locales.js';

const read = name => fs.readFileSync(new URL(`../web/modules/${name}`, import.meta.url), 'utf8');
const railKeys = [...read('ui_shell_rail.js').matchAll(/labelKey: '([A-Za-z]+)'/g)].map(match => match[1]);
const titles = read('ui_shell_nav.js').match(/const TITLE_KEYS = \{([\s\S]*?)\};/)[1];
const titleKeys = [...titles.matchAll(/: '([A-Za-z]+)'/g)].map(match => match[1]);

assert.ok(railKeys.includes('models') && railKeys.includes('gallery'));
assert.ok(titleKeys.includes('gallery'));
for (const key of new Set([...railKeys, ...titleKeys])) {
    for (const lang of ['zh', 'en']) assert.ok(i18n[lang][key], `${lang} has no '${key}'`);
}

// Every rail page has a number key (1-9, ui_shell_nav.js): the AI workbench pushed the audio
// gallery off the keys until it became a view of Voices.
const railPages = read('ui_shell_rail.js').match(/export const RAIL_PAGES = Object\.freeze\(\[([\s\S]*?)\]\);/)[1];
assert.ok([...railPages.matchAll(/\{ page: '/g)].length <= 9, 'more rail pages than number keys');
