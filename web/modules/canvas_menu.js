/**
 * AMB's entries in the canvas's right-click menus (the extension's getNodeMenuItems and
 * getCanvasMenuItems hooks, browser_entry.js), as Settings -> Canvas sets them
 * (canvas_menu_settings.js). A node's menu offers what Current node does for it — open it in
 * AMB, change its model by picture, insert a LoRA before / after, its saved values, the
 * model's pictures and details, save its values or the picked nodes as a combo — each only
 * where it applies; the empty canvas's menu opens the quick search and AMB's pages. `browser()` gives the browser,
 * made on first use.
 */

import { translate as t } from './locales.js';
import { menuSettings } from './canvas_menu_settings.js';
import { loraInsertionCapabilities } from './graph_splice.js';
import { modelComboWidgets } from './ui_node_model_picker.js';
import { hasComboNodes, menuNodes, saveSelectionAsCombo } from './ui_combo_structure.js';
import { saveNodeParameters } from './node_parameter_sets.js';
import { anomalousPrompt } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openSettingsPage } from './ui_settings_page.js';
import { RAIL_PAGES } from './ui_shell_rail.js';
import { openQuickSearch } from './ui_quick_search.js';

const item = (content, run) => ({ content, callback: () => void run() });

/** The widgets naming a model file that is set (not empty, not "None"). */
const setModels = node => modelComboWidgets(node).filter(widget => typeof widget.value === 'string' && widget.value && widget.value !== 'None');

/** The model AMB knows for `widget`'s file (with its type, path_idx and subfolder), or null. */
async function findModel(widget) {
    try {
        const response = await fetch(`/anomalous/find_model?search=${encodeURIComponent(widget.value.replace(/\\/g, '/'))}`);
        const found = await response.json();
        if (found.status === 'success' && found.model) return found.model;
    } catch (error) {
        console.warn('[AMB] Could not look up the model:', error);
    }
    showWorkbenchToast(t('canvasMenuModelUnknown'));
    return null;
}

/** One label per model widget: the widget's name when the node has several. */
const perModel = (widgets, key) => widgets.map(widget => [widget, widgets.length > 1 ? `${t(key)}: ${widget.name}` : t(key)]);

// Entry id -> (node, browser) => its menu items ([] where it does not apply).
const NODE_ITEMS = {
    open: (node, browser) => [item(t('canvasMenuOpen'), () => browser()?.showForNode(node))],
    replaceModel: (node, browser) => perModel(modelComboWidgets(node), 'canvasMenuReplace')
        .map(([widget, label]) => item(label, () => browser()?._openGalleryReplacer(node, widget))),
    loraBefore: (node, browser) => loraInsertionCapabilities(node.graph, node).before.supported
        ? [item(t('canvasMenuLoraBefore'), () => browser()?.openLoraInsertionPicker(node, 'before'))] : [],
    loraAfter: (node, browser) => loraInsertionCapabilities(node.graph, node).after.supported
        ? [item(t('canvasMenuLoraAfter'), () => browser()?.openLoraInsertionPicker(node, 'after'))] : [],
    parameters: (node, browser) => node.widgets?.length
        ? [item(t('canvasMenuParameters'), () => browser()?.showForNode(node, { section: 'parameters' }))] : [],
    modelOutputs: (node, browser) => perModel(setModels(node), 'canvasMenuOutputs').map(([widget, label]) => item(label, async () => {
        const model = await findModel(widget);
        const owner = model && browser();
        if (!owner) return;
        owner.show();
        owner.showGeneratedGallery(model);
    })),
    modelDetails: (node, browser) => perModel(setModels(node), 'canvasMenuDetails').map(([widget, label]) => item(label, async () => {
        const model = await findModel(widget);
        if (model) browser()?.openModelDetail(model);
    })),
    saveParameters: node => node.widgets?.length ? [item(t('canvasMenuSaveParams'), async () => {
        const name = await anomalousPrompt(t('currentNodeSaveName'), node.title || node.type, t('currentNodeSave'));
        if (name === null) return;
        try {
            const result = await saveNodeParameters(node, name || node.title || node.type);
            showWorkbenchToast(t(result.status === 'duplicate' ? 'currentNodeSavedBefore' : 'currentNodeSaved', { name: result.name }));
        } catch (error) {
            console.error('[AMB] Could not save the node values:', error);
            showWorkbenchToast(t('currentNodeSaveFailed'));
        }
    })] : [],
    saveCombo: (node, browser) => {
        const nodes = menuNodes(node);
        if (!hasComboNodes(nodes)) return [];
        const label = nodes.length > 1 ? t('comboMenuSaveMany', { count: nodes.length }) : t('comboMenuSave');
        return [item(label, () => {
            const owner = browser();
            if (owner) return saveSelectionAsCombo(owner, nodes);
        })];
    },
};

// Entry id -> (browser, placement) => the empty canvas's items.
const CANVAS_ITEMS = {
    quickSearch: browser => [item(t('canvasMenuQuickSearch'), () => openQuickSearch(browser))],
    // The pages themselves inside AMB's submenu; right in the menu, a submenu of them.
    openPage: (browser, placement) => {
        const pages = RAIL_PAGES.map(({ page, labelKey }) => item(t(labelKey), () => browser()?.show({ page })));
        return placement === 'top' ? [{ content: t('canvasMenuOpenPage'), has_submenu: true, submenu: { options: pages } }] : pages;
    },
};

/** The items of `list` that are on and apply, built by `builders`; a broken one is left out. */
function build(list, builders, ...args) {
    return list.filter(entry => entry.on).flatMap((entry) => {
        try {
            return builders[entry.id]?.(...args) || [];
        } catch (error) {
            console.warn(`[AMB] Canvas menu entry ${entry.id} failed:`, error);
            return [];
        }
    });
}

/** `items` as AMB's part of a menu: one submenu (ending in "Adjust this menu"), or right in it. */
function place(items, placement, browser) {
    if (!items.length) return [];
    if (placement === 'top') return [null, ...items];
    const adjust = item(t('canvasMenuAdjust'), () => {
        const owner = browser();
        if (!owner) return;
        owner.show();
        openSettingsPage(owner, { tab: 'canvas' });
    });
    return [null, { content: t('canvasMenuTitle'), has_submenu: true, submenu: { options: [...items, null, adjust] } }];
}

/** AMB's items for the menu of `node`. */
export function nodeMenuItems(node, browser) {
    const settings = menuSettings();
    return place(build(settings.node, NODE_ITEMS, node, browser), settings.placement, browser);
}

/** AMB's items for the empty canvas's menu. */
export function canvasMenuItems(browser) {
    const settings = menuSettings();
    return place(build(settings.canvas, CANVAS_ITEMS, browser, settings.placement), settings.placement, browser);
}
