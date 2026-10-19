/**
 * The canvas's quick search (Alt+B, or the empty canvas's right-click menu): a bar over the
 * canvas that finds combos, models and saved prompts as you type (quick_search_data.js) and
 * puts the chosen one on the canvas where the pointer was: a combo as its group of nodes and a
 * model in its loader node, both following the pointer until a click; a prompt as a new prompt
 * node. ↑ ↓ pick, Enter puts it down, Tab changes which kind is shown, Esc or a click outside
 * closes the bar. Nothing is read until the bar opens; what was read is kept a minute.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { formatModelTypeLabel } from './model_picker.js';
import {
    KINDS, cachedSources, comboItem, keepSources, loadModelItems, promptItem, searchQuick,
} from './quick_search_data.js';
import { listCombos } from './image_keep.js';
import { loadPromptSourceCards } from './prompt_material_source.js';
import { outputThumbnail } from './ui_kept_toast.js';
import { structuredComboMeta } from './ui_combo_structure.js';
import { STRUCTURED } from './combo_slots.js';
import { addPromptNode } from './prompt_card_drag.js';

const FILTERS = ['', ...KINDS];
let closeOpen = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const modelName = model => String(model?.metadata?.custom_name || model?.filename || '').replace(/\.[^.]+$/, '');

/** A combo as a search item, with what its card says and shows. */
function comboSearchItem(note) {
    const data = note.data || {};
    if (data.kind === STRUCTURED) {
        const meta = structuredComboMeta(data);
        const thumb = data.source_image?.filename ? outputThumbnail(data.source_image) : meta.cover;
        return comboItem(note, { detail: meta.meta, thumb, text: meta.prompt });
    }
    const loras = (data.loras || []).length;
    const detail = [modelName(data.mainModel), loras ? t('comboLoraCount', { count: loras }) : ''].filter(Boolean).join(' · ');
    const thumb = data.source_image?.filename ? outputThumbnail(data.source_image)
        : data.mainModel?.preview_url ? `${data.mainModel.preview_url}${data.mainModel.preview_url.includes('?') ? '&' : '?'}variant=card` : '';
    return comboItem(note, { detail, thumb, text: [data.promptEn, ...(data.loras || []).map(modelName)].join(' ') });
}

/** Reads the three lists (each on its own, so one that fails leaves the others). */
async function loadSources(signal, onPart) {
    const kept = cachedSources();
    if (kept) return kept;
    const parts = { models: [], combos: [], prompts: [] };
    const read = async (key, load) => {
        try {
            parts[key] = await load();
        } catch (error) {
            if (signal.aborted) return;
            console.warn(`[AMB] Quick search could not read the ${key}:`, error);
        }
        onPart(parts);
    };
    await Promise.all([
        read('combos', async () => (await listCombos()).map(comboSearchItem)),
        read('models', () => loadModelItems(signal)),
        read('prompts', async () => (await loadPromptSourceCards(signal)).map(promptItem)),
    ]);
    return signal.aborted ? parts : keepSources(parts);
}

/** Puts `item` on the canvas at `position` (canvas coordinates); `browser()` gives the browser. */
function use(item, position, browser) {
    if (item.kind === 'prompt') {
        addPromptNode(app.graph, position, item.data);
        return;
    }
    const owner = browser();
    if (!owner) return;
    if (item.kind === 'combo') {
        owner.currentNotebook = item.data;
        owner.sendNotebookToCanvas();
        return;
    }
    const model = item.data;
    owner.applyModelToCanvas(model.type, model.subfolder, model);
}

function thumbOf(item) {
    const box = el('span', `anomalous-qs-thumb is-${item.kind}`);
    if (item.thumb) {
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = item.thumb;
        img.onerror = () => img.remove();
        box.append(img);
    } else {
        box.textContent = item.kind === 'prompt' ? (item.role === 'negative' ? '−' : '+') : '';
    }
    return box;
}

/** Closes the bar when it is open. */
export function closeQuickSearch() {
    closeOpen?.();
}

/** Opens the bar (or closes it when it is open); `browser()` gives the browser, made on first use. */
export function openQuickSearch(browser) {
    if (closeOpen) {
        closeOpen();
        return;
    }
    const position = [...(app.canvas?.graph_mouse || [0, 0])];
    const overlay = el('div', 'anomalous-qs-overlay');
    const panel = el('div', 'anomalous-qs-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('quickSearchTitle'));
    const input = el('input', 'anomalous-qs-input');
    input.type = 'search';
    input.placeholder = t('quickSearchPlaceholder');
    input.setAttribute('aria-label', t('quickSearchPlaceholder'));
    input.autocomplete = 'off';
    input.spellcheck = false;
    const filters = el('div', 'anomalous-qs-filters');
    filters.setAttribute('role', 'radiogroup');
    const list = el('div', 'anomalous-qs-list');
    list.setAttribute('role', 'listbox');
    const foot = el('div', 'anomalous-qs-foot', t('quickSearchKeys'));
    panel.append(input, filters, list, foot);
    overlay.append(panel);
    document.body.append(overlay);

    const controller = new AbortController();
    let sources = cachedSources() || { models: [], combos: [], prompts: [] };
    let loading = !cachedSources();
    let filter = '';
    let rows = [];
    let active = 0;

    const close = () => {
        controller.abort();
        overlay.remove();
        window.removeEventListener('keydown', onKey, true);
        if (closeOpen === close) closeOpen = null;
    };
    closeOpen = close;

    const pick = (index) => {
        if (!rows.length) return;
        active = (index + rows.length) % rows.length;
        rows.forEach(({ row }, at) => row.setAttribute('aria-selected', String(at === active)));
        rows[active].row.scrollIntoView({ block: 'nearest' });
    };
    const choose = (index = active) => {
        const chosen = rows[index]?.item;
        if (!chosen) return;
        close();
        try {
            use(chosen, position, browser);
        } catch (error) {
            console.error('[AMB] Quick search could not put it on the canvas:', error);
        }
    };

    const drawFilters = () => {
        filters.replaceChildren(...FILTERS.map((kind) => {
            const chip = el('button', 'anomalous-qs-filter', t(kind ? `quickSearchKind_${kind}` : 'quickSearchAll'));
            chip.type = 'button';
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String(kind === filter));
            chip.onmousedown = event => event.preventDefault(); // the input keeps the focus
            chip.onclick = () => {
                filter = kind;
                draw();
            };
            return chip;
        }));
    };

    const draw = () => {
        drawFilters();
        const items = [...sources.combos, ...sources.models, ...sources.prompts];
        const groups = searchQuick(items, input.value, { kind: filter });
        rows = [];
        list.replaceChildren();
        for (const group of groups) {
            list.append(el('div', 'anomalous-qs-group', t(`quickSearchKind_${group.kind}`)));
            for (const item of group.items) {
                const row = el('div', 'anomalous-qs-row');
                row.setAttribute('role', 'option');
                const copy = el('span', 'anomalous-qs-copy');
                copy.append(el('span', 'anomalous-qs-title', item.title));
                if (item.detail) copy.append(el('span', 'anomalous-qs-detail', item.detail));
                const tag = item.kind === 'model' ? formatModelTypeLabel(item.type, item.type)
                    : item.kind === 'prompt' ? t(item.role === 'negative' ? 'quickSearchNegative' : 'quickSearchPositive') : '';
                row.append(thumbOf(item), copy);
                if (tag) row.append(el('span', 'anomalous-qs-tag', tag));
                const index = rows.length;
                row.onmousemove = () => { if (active !== index) pick(index); };
                row.onmousedown = event => event.preventDefault();
                row.onclick = () => choose(index);
                rows.push({ row, item });
                list.append(row);
            }
            if (group.more) list.append(el('div', 'anomalous-qs-more', t('quickSearchMore', { count: group.more })));
        }
        if (!rows.length) {
            const words = input.value.trim();
            list.append(el('p', 'anomalous-qs-empty', loading ? t('loading')
                : words ? t('quickSearchNothing') : t('quickSearchHint')));
        }
        active = 0;
        pick(0);
    };

    function onKey(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
            return;
        }
        // The bar takes every key while it is open: ComfyUI's shortcuts stay quiet, and typing
        // goes into the box even when a menu's click gave the focus back to the canvas.
        event.stopPropagation();
        if (document.activeElement !== input && !event.ctrlKey && !event.metaKey) input.focus();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            pick(active + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            choose();
        } else if (event.key === 'Tab') {
            event.preventDefault();
            const at = FILTERS.indexOf(filter);
            filter = FILTERS[(at + (event.shiftKey ? -1 : 1) + FILTERS.length) % FILTERS.length];
            draw();
        }
    }
    window.addEventListener('keydown', onKey, true);
    overlay.onmousedown = (event) => {
        if (event.target === overlay) close();
    };
    input.oninput = draw;

    draw();
    input.focus();
    setTimeout(() => input.focus(), 0); // opened from a menu, whose closing takes the focus
    if (loading) {
        void loadSources(controller.signal, (parts) => {
            if (controller.signal.aborted) return;
            sources = parts;
            draw();
        }).then((all) => {
            if (controller.signal.aborted) return;
            loading = false;
            sources = all;
            draw();
        });
    }
}
