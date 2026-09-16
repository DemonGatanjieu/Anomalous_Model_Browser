import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const storage = new Map();
const f = fixture({ storage });
f.document.getElementById = id => f.document.body.querySelector(`#${id}`);

const registeredSettings = {};
const settingValues = new Map();
let registeredExtension;
f.app.registerExtension = extension => { registeredExtension = extension; };
f.app.extensionManager = {
    setting: {
        settings: registeredSettings,
        get: id => settingValues.get(id),
        set: (id, value) => settingValues.set(id, value),
    }
};

const interfaceModule = await f.module('interface_settings.js');
const entryModule = await f.module('browser_entry.js');
const entry = entryModule.createBrowserEntry({
    translate: interfaceModule.t,
    getCurrentLanguage: interfaceModule.getCurrentLanguage,
});

assert.equal(entry.settings.map(setting => setting.id).join(','), [
    entryModule.FLOATING_TRIGGER_STYLE_SETTING_ID,
    entryModule.FLOATING_TRIGGER_SIZE_SETTING_ID,
    entryModule.SHORTCUT_SETTING_ID,
    entryModule.ENTRY_MODE_SETTING_ID,
].join(','));
assert.equal(interfaceModule.createInterfaceSettings().map(setting => setting.id).join(','), [
    interfaceModule.LANGUAGE_SETTING_ID,
    interfaceModule.ABYSSAL_SCARLET_SETTING_ID,
].join(','));

entry.settings.find(setting => setting.id === entryModule.ENTRY_MODE_SETTING_ID).onChange('menu');
assert.equal(f.document.documentElement.classList.contains('anomalous-floating-entry-enabled'), false);
assert.equal(f.document.documentElement.classList.contains('anomalous-topbar-entry-enabled'), false);

const interfaceSettings = interfaceModule.createInterfaceSettings();
interfaceSettings.find(setting => setting.id === interfaceModule.LANGUAGE_SETTING_ID).onChange('en');
assert.equal(storage.get('anomalous_lang'), 'en');
assert.equal(f.window.anomalous_browser_lang, 'en');

interfaceSettings.find(setting => setting.id === interfaceModule.ABYSSAL_SCARLET_SETTING_ID).onChange(true);
assert.equal(f.document.documentElement.classList.contains('theme-abyssal-scarlet'), true);
assert.equal(storage.get('anomalous_theme_abyssal_scarlet'), 'true');

await f.module('../main.js');
assert.equal(registeredExtension.name, 'Anomalous.ModelBrowser');
assert.equal(registeredExtension.settings.length, 6);
assert.equal(registeredExtension.commands.length, 2);
assert.equal(typeof registeredExtension.setup, 'function');

console.log('Main module boundaries: entry settings, language, and theme behavior passed.');
