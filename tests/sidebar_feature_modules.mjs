import assert from 'node:assert/strict';
import { all, fixture, Element } from './ui_fixture.mjs';

const f = fixture();
f.document.getElementById = id => all(f.document.body).find(element => element.id === id) || null;
Element.prototype.removeChild = function(child) {
    if (child?.parentNode !== this) throw new Error('NotFoundError');
    child.remove();
    return child;
};
Object.defineProperty(Element.prototype, 'lastChild', {
    configurable: true,
    get() { return this.children.at(-1) || null; },
});

const container = new Element('div');
container.id = 'anomalous-container';
f.document.body.append(container);

const sidebar = await f.module('ui_sidebar.js');
const grid = await f.module('ui_grid.js');
const navigation = await f.module('ui_browser_navigation.js');
assert.equal(typeof sidebar.createDOM, 'function');
assert.equal(typeof grid.loadModels, 'function');
const navigationOwner = {
    grid: new Element('div'),
    detailPanel: new Element('div'),
    galleryPanel: new Element('div'),
    nbPanel: new Element('div'),
    doctorPanel: new Element('div'),
    assistantPanel: new Element('div'),
};
navigation.hideAllPanels.call(navigationOwner);
assert.ok(Object.values(navigationOwner).filter(value => value instanceof Element).every(panel => panel.style.display === 'none'));

const utilityContainer = new Element('div');
const sidebarActions = new Element('div');
const sidebarWrapper = new Element('div');
sidebarWrapper.append(sidebarActions);
utilityContainer.append(sidebarWrapper);
f.document.body.append(utilityContainer);
const utilityOwner = {
    sidebarActions,
    sidebarWrapper,
    energySaving: true,
    cardThumbnailMode: 'balanced',
    detailPanel: new Element('div'),
    currentDetailModel: null,
    renderCount: 0,
    loadCount: 0,
    renderSidebar() { this.renderCount += 1; },
    loadModels() { this.loadCount += 1; },
    showHelp() {},
    openFolderManager() {},
};
const toolboxModule = await f.module('ui_toolbox.js');
const settingsModule = await f.module('ui_settings_hub.js');
let settingsControl;
const toolboxControl = toolboxModule.createToolbox(utilityOwner, {
    container: utilityContainer,
    menuBtn: new Element('button'),
    toolboxIcon: 'tools',
    isScanning: () => false,
    getSettingsButton: () => settingsControl.button,
    onBeforeOpen: () => settingsControl?.close(),
});
const control = () => new Element('button');
settingsControl = settingsModule.createSettingsHub(utilityOwner, {
    container: utilityContainer,
    savedScale: '1',
    savedBgOpacity: '0.2',
    updateLangClass() {},
    modelsBtn: control(),
    galleryBtn: control(),
    toolboxBtn: toolboxControl.button,
    nbBtn: control(),
    dockBtn: control(),
    updateNoticeBtn: control(),
    icons: { MODELS: 'models', GALLERY: 'gallery', HELP: 'help', RECIPES: 'recipes', SETTINGS: 'settings' },
    onBeforeOpen: () => toolboxControl.close(),
});
toolboxControl.mount();
assert.equal(sidebarActions.children.at(0), toolboxControl.button);
assert.equal(sidebarActions.children.at(-1), settingsControl.button);
const toolboxToolIds = all(toolboxControl.modal).map(element => element.getAttribute('data-tool-id')).filter(Boolean);
assert.ok(toolboxToolIds.includes('prompt-studio'));
assert.ok(!toolboxToolIds.includes('scan'), 'fixed shortcuts stay out of the toolbox catalog');
await toolboxControl.button.click();
assert.equal(toolboxControl.modal.style.display, 'flex');
await settingsControl.button.click();
assert.equal(toolboxControl.modal.style.display, 'none', 'settings closes the toolbox');
assert.equal(settingsControl.modal.style.display, 'flex');
await toolboxControl.button.click();
assert.equal(settingsControl.modal.style.display, 'none', 'toolbox closes settings');
settingsControl.close();
const languageButton = all(settingsControl.modal).find(element => element.classList.contains('anomalous-lang-btn'));
await languageButton.click();
await f.flush();
assert.ok(utilityOwner.renderCount > 0 && utilityOwner.loadCount > 0, 'language refresh updates live browser views');

const help = await f.module('ui_help.js');
const helpOwner = { modal: container };
help.showHelp.call(helpOwner);
assert.ok(helpOwner.helpModal?.isConnected, 'help opens inside the browser container');
await f.button(helpOwner.helpModal, 'Close').click();
assert.equal(helpOwner.helpModal.isConnected, false, 'help close removes the dialog');

let loadFoldersCount = 0;
f.fetch = async url => {
    if (String(url).includes('/all_folder_types')) {
        return { ok: true, json: async () => ({ folder_types: [{ type: 'checkpoints', visible: true }], folder_view_mode: 'abstract' }) };
    }
    return { ok: true, json: async () => ({ status: 'ok' }) };
};
const folders = await f.module('ui_folder_manager.js');
const folderOwner = {
    firstLoadDone: true,
    expandedFolders: new Set(['checkpoints']),
    async loadFolders() { loadFoldersCount += 1; },
};
await folders.openFolderManager.call(folderOwner);
await f.flush();
let folderModal = f.document.getElementById('anomalous-folder-manager-modal');
await f.button(folderModal, 'Cancel').click();
assert.equal(folderModal.isConnected, false, 'folder manager cancel only closes the dialog');
assert.equal(f.requests.filter(([, options]) => options.method === 'POST').length, 0, 'cancel does not write configuration');

await folders.openFolderManager.call(folderOwner);
await f.flush();
folderModal = f.document.getElementById('anomalous-folder-manager-modal');
await f.button(folderModal, 'Save & Reload').click();
assert.equal(loadFoldersCount, 1, 'saving refreshes the sidebar folder data');
assert.equal(folderOwner.firstLoadDone, false);
assert.equal(folderOwner.expandedFolders.size, 0);
assert.ok(f.requests.some(([url, options]) => url === '/anomalous/save_config' && options.method === 'POST'));

const wizard = await f.module('ui_scan_wizard.js');
const scanOwner = {
    currentType: 'checkpoints',
    currentPathIdx: 0,
    currentSubfolder: '/',
    loadModels() {},
};
wizard.openScanWizard.call(scanOwner, { isGlobal: true });
let wizardModal = f.document.getElementById('anomalous-wizard-modal');
await f.button(wizardModal, 'Cancel').click();
assert.equal(wizardModal.isConnected, false, 'closing the wizard does not launch a scan');

wizard.openScanWizard.call(scanOwner, { targetFiles: 'model.safetensors' });
wizardModal = f.document.getElementById('anomalous-wizard-modal');
await f.button(wizardModal, 'Execute').click();
await f.flush();
const scanRequest = f.requests.find(([url, options]) => String(url).startsWith('/anomalous/scan?') && options.method === 'POST');
assert.ok(scanRequest, 'single-model scan uses the scoped scan endpoint');
assert.deepEqual(JSON.parse(scanRequest[1].body).target_files, ['model.safetensors']);
assert.equal(wizardModal.isConnected, false, 'launching a scan closes only the wizard UI');
assert.deepEqual(f.errors, [], 'feature flows complete without user-facing errors');

console.log('Sidebar feature modules: help close, folder cancel/save, and scan wizard launch passed.');
