// The settings page's tabs (web/modules/settings_tabs.js): four of them, and every tab of before 1.65 a link may
// still name lands on the tab its card moved to, scrolled to that card.
import assert from 'node:assert/strict';
import { SETTINGS_TABS, resolveSettingsTarget } from '../web/modules/settings_tabs.js';
import { i18n } from '../web/modules/locales.js';

assert.deepEqual(SETTINGS_TABS.map(tab => tab.id), ['look', 'models', 'tools', 'help']);
for (const { labelKey } of SETTINGS_TABS) {
    for (const lang of ['zh', 'en']) assert.ok(i18n[lang][labelKey], `${lang} has no '${labelKey}'`);
}

// The four tabs: as asked, with the card asked for.
assert.deepEqual(resolveSettingsTarget('look'), { tab: 'look', section: '' });
assert.deepEqual(resolveSettingsTarget('models', 'network'), { tab: 'models', section: 'network' });
assert.deepEqual(resolveSettingsTarget('tools', 'packs'), { tab: 'tools', section: 'packs' });
assert.deepEqual(resolveSettingsTarget('help'), { tab: 'help', section: '' });

// The old tabs: the tab their card is on now, scrolled to it.
const MOVED = {
    canvas: { tab: 'look', section: 'canvas' },
    network: { tab: 'models', section: 'network' },
    workflows: { tab: 'tools', section: 'workflows' },
    prompts: { tab: 'tools', section: 'prompts' },
    packs: { tab: 'tools', section: 'packs' },
    backup: { tab: 'help', section: 'backup' },
};
for (const [old, target] of Object.entries(MOVED)) assert.deepEqual(resolveSettingsTarget(old), target, old);
assert.deepEqual(resolveSettingsTarget('canvas', 'elsewhere'), { tab: 'look', section: 'elsewhere' }, 'a card asked for wins');

// Anything else: Look, from the top.
for (const odd of [undefined, null, '', 'gone', 'toString', '__proto__']) {
    assert.deepEqual(resolveSettingsTarget(odd, 'canvas'), { tab: 'look', section: '' }, String(odd));
}
console.log('settings tabs: ok');
