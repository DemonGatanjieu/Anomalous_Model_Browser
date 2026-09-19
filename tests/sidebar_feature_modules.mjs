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
const browser = await f.module('browser.js');
assert.equal(typeof sidebar.createDOM, 'function');
assert.equal(typeof grid.loadModels, 'function');
assert.equal(typeof browser.AnomalousBrowser, 'function');
const browserShell = Object.create(browser.AnomalousBrowser.prototype);
browserShell.triggerButton = new Element('button');
browserShell.entryMode = 'floating';
browserShell.setTriggerVisible(true);
assert.equal(browserShell.triggerButton.classList.contains('anomalous-trigger-hidden'), false);
browserShell.entryMode = 'menu';
browserShell.setTriggerVisible(true);
assert.equal(browserShell.triggerButton.classList.contains('anomalous-trigger-hidden'), true, 'non-floating entry modes keep the trigger hidden');
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

const restoredGrid = new Element('div');
restoredGrid.style.display = 'none';
const restoredDetail = new Element('div');
restoredDetail.style.display = 'block';
const workspaceOwner = {
    grid: restoredGrid,
    detailPanel: restoredDetail,
    nbPanel: new Element('div'),
    workspaceReturnState: { grid: 'grid', detail: 'none' },
    recipeModelReturn: null,
};
navigation.closeWorkspace.call(workspaceOwner);
assert.equal(workspaceOwner.nbPanel.style.display, 'none');
assert.equal(restoredGrid.style.display, 'grid', 'workspace close restores the shared navigation state');
assert.equal(restoredDetail.style.display, 'none');

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

// Direct single-model precision scan without opening wizard modal
let directScanRefreshed = false;
const directScanOwner = {
    currentType: 'loras',
    currentPathIdx: 0,
    currentSubfolder: '/',
    loadModels() { directScanRefreshed = true; },
};
const dummyBtn = f.document.createElement('button');
const dummySvg = f.document.createElement('svg');
dummyBtn.appendChild(dummySvg);

f.fetch = async (url) => {
    if (String(url).startsWith('/anomalous/scan?')) {
        return { ok: true, json: async () => ({ status: 'ok' }) };
    }
    if (String(url).startsWith('/anomalous/scan_status?')) {
        return { ok: true, json: async () => ({ scanning: false, interrupted: false }) };
    }
    return { ok: true, json: async () => ({}) };
};

await wizard.triggerDirectModelScan.call(directScanOwner, { filename: 'my_lora.safetensors', name: 'My Lora' }, dummyBtn);
assert.equal(dummyBtn.classList.contains('anomalous-radar-spinning'), true, 'button spins immediately');
f.runTimers();
await f.flush();

const directScanReq = f.requests.find(([url, options]) => String(url).includes('type=loras') && options.method === 'POST');
assert.ok(directScanReq, 'direct scan triggers POST /anomalous/scan');
assert.deepEqual(JSON.parse(directScanReq[1].body).target_files, ['my_lora.safetensors']);
assert.equal(JSON.parse(directScanReq[1].body).skip_rename, true, 'direct single model scan preserves physical file name');
assert.equal(directScanRefreshed, true, 'browser.loadModels called after scan completes');
assert.equal(dummyBtn.classList.contains('anomalous-radar-spinning'), false, 'radar spinning class removed after completion');
const scanProgressPanel = f.document.getElementById('anomalous-scan-progress');
assert.ok(scanProgressPanel, 'scan progress panel displayed in DOM');
assert.equal(scanProgressPanel.classList.contains('is-complete'), true, 'scan progress panel marked complete');
assert.equal(f.errors.length, 0, 'no alert or errors triggered on scan completion');

// Verification of factual scan completion feedback (strictly factual, zero speculative guidance)
f.window.anomalous_browser_lang = 'zh';

// 1. Civitai with cover
f.fetch = async () => ({
    ok: true,
    json: async () => ({
        metadata: { id: 12345, modelId: 67890 },
        preview_url: '/api/view?filename=cover.png'
    })
});
let toastMsg = await wizard.formatScanCompletionToast({ filename: 'civitai_model.safetensors' });
assert.equal(toastMsg.includes('已从 Civitai 获取封面与模型信息'), true, 'reports civitai cover & info');
assert.equal(toastMsg.includes('编辑') || toastMsg.includes('右键'), false, 'no speculative advice');

// 2. Civitai without cover
f.fetch = async () => ({
    ok: true,
    json: async () => ({
        metadata: { id: 12345, modelId: 67890 },
        preview_url: null
    })
});
toastMsg = await wizard.formatScanCompletionToast({ filename: 'civitai_no_cover.safetensors' });
assert.equal(toastMsg.includes('已匹配到 Civitai 信息（线上未提供封面）'), true, 'reports civitai without cover');
assert.equal(toastMsg.includes('编辑') || toastMsg.includes('右键'), false, 'no speculative advice');

// 3. Non-Civitai with baseModel
f.fetch = async () => ({
    ok: true,
    json: async () => ({
        metadata: { id: -1, baseModel: 'FLUX.1-D' },
        preview_url: null
    })
});
toastMsg = await wizard.formatScanCompletionToast({ filename: 'flux_dev.safetensors' });
assert.equal(toastMsg, 'ℹ️ 非 Civitai 模型：已识别底模为 [FLUX.1-D]', 'factual non-civitai base model info');
assert.equal(toastMsg.includes('编辑') || toastMsg.includes('右键'), false, 'no speculative advice');

// 4. Non-Civitai without baseModel
f.fetch = async () => ({
    ok: true,
    json: async () => ({
        metadata: { id: -1 },
        preview_url: null
    })
});
toastMsg = await wizard.formatScanCompletionToast({ filename: 'unknown.safetensors' });
assert.equal(toastMsg, 'ℹ️ 未在 Civitai 匹配到此模型', 'factual unmatched message');
assert.equal(toastMsg.includes('编辑') || toastMsg.includes('右键'), false, 'no speculative advice');

// 5. Realistic backend response format with model wrapper and python metadata fields
f.fetch = async () => ({
    ok: true,
    json: async () => ({
        status: 'success',
        model: {
            filename: 'flux1-dev-fp8_flux1-dev-fp8.safetensors',
            metadata: {
                name: 'flux1-dev-fp8',
                baseModel: 'Flux.1 D',
                civitai_url: '',
                hash: '8e91b68084b53a7fc44ed2a3756d821e355ac1a7b6fe29be760c1db532f3d88a'
            },
            preview_url: ''
        }
    })
});
toastMsg = await wizard.formatScanCompletionToast({ filename: 'flux1-dev-fp8_flux1-dev-fp8.safetensors' });
assert.equal(toastMsg, 'ℹ️ 非 Civitai 模型：已识别底模为 [Flux.1 D]', 'unpacks real backend model wrapper');

console.log('Sidebar feature modules: help close, folder cancel/save, and scan wizard launch passed.');
