/**
 * The models part of a combo's editor (ui_notebook_editor.js): the base model, the main model
 * and the LoRAs as short lists of what is chosen (cover, name, base model), with Change / Add
 * opening a grid of the compatible ones (GET /anomalous/compatible_models, asked only when a
 * grid opens). Choosing saves at once and tells the head (ui_combo_hero.js) to redraw its chips.
 */

import { translate as t } from './locales.js';
import { isUnetModel, UNLABELED_BASE_MODEL } from './notebook_canvas.js';
import { createLoraNodeChoice } from './ui_lora_node_choice.js';
import { comboModelCover, comboModelName } from './ui_combo_hero.js';

const FALLBACK_BASES = ['SD 1.5', 'SDXL', 'Pony', 'Illustrious', 'Flux.1'];
const MAIN_TYPES = 'checkpoints,unet,diffusion_models';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function cover(model, className) {
    const box = el('span', className);
    const src = comboModelCover(model);
    if (src) {
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = src;
        img.onerror = () => img.remove();
        box.append(img);
    }
    return box;
}

/** One chosen model: cover, name, its base model and file; `extra` controls at the end. */
function pickedRow(model, number, ...extra) {
    const row = el('div', 'anomalous-combo-pick');
    if (number) row.append(el('span', 'anomalous-combo-pick-number', String(number)));
    const copy = el('span', 'anomalous-combo-pick-copy');
    copy.append(el('span', 'anomalous-combo-pick-name', comboModelName(model)),
        el('span', 'anomalous-combo-pick-detail', [model.metadata?.baseModel, model.filename].filter(Boolean).join(' · ')));
    copy.title = model.filename || '';
    row.append(cover(model, 'anomalous-combo-pick-cover'), copy, ...extra);
    return row;
}

/** A grid of the compatible models of `types`, read once; `isPicked(model)`, `onPick(model)`. */
function pickerGrid(baseModel, types, { isPicked, onPick, number }) {
    const grid = el('div', 'anomalous-nb-gallery-wrap anomalous-combo-picker');
    let models = null;
    const draw = () => {
        if (!models) return;
        grid.replaceChildren();
        if (!models.length) {
            grid.append(el('span', 'anomalous-combo-picker-empty', t('comboPickerNone')));
            return;
        }
        for (const model of models) {
            const picked = isPicked(model);
            const card = button(`anomalous-nb-minicheck${picked ? ' selected' : ''}`, undefined, () => {
                onPick(model);
                draw();
            });
            card.title = model.filename;
            const at = picked && number ? number(model) : 0;
            if (at) card.append(el('span', 'anomalous-combo-picker-number', String(at)));
            const thumb = cover(model, 'anomalous-combo-picker-cover');
            if (!thumb.childElementCount) thumb.append(el('span', 'anomalous-nb-mini-empty', '?'));
            card.append(thumb, el('span', 'anomalous-nb-minicheck-name', comboModelName(model)));
            grid.append(card);
        }
    };
    grid.load = () => {
        if (models) return draw();
        grid.replaceChildren(el('span', 'anomalous-combo-picker-empty', t('loading')));
        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=${types}`)
            .then(response => response.json())
            .then((payload) => {
                models = payload.models || [];
                draw();
            })
            .catch(() => grid.replaceChildren(el('span', 'anomalous-combo-picker-empty', t('comboPickerFailed'))));
    };
    grid.redraw = draw;
    grid.hidden = true;
    return grid;
}

/** The base model drop-down: changing it empties the models (they belong to one base). */
function baseSelect(ctx, data) {
    const select = el('select', 'anomalous-nb-select anomalous-combo-base-select');
    const fill = (bases) => {
        const list = [...new Set([...(data.baseModel ? [data.baseModel] : []), ...bases])];
        select.replaceChildren(...list.map((base) => {
            const option = el('option', '', base === UNLABELED_BASE_MODEL ? t('notebookUnlabeledBase') : base);
            option.value = base;
            option.selected = base === data.baseModel;
            return option;
        }));
    };
    fill(ctx.baseModelsCache || FALLBACK_BASES);
    if (!ctx.baseModelsCache) {
        fetch('/anomalous/base_models').then(response => response.json()).then((payload) => {
            const bases = [...(payload.base_models || []), ...(payload.unlabeled ? [UNLABELED_BASE_MODEL] : [])];
            if (!bases.length) return;
            ctx.baseModelsCache = bases;
            fill(bases);
        }).catch(() => {});
    }
    select.onchange = () => {
        data.baseModel = select.value;
        data.mainModel = null;
        data.loras = [];
        ctx.saveCurrentNotebook();
        ctx.renderNotebookEditor();
    };
    return select;
}

/** The models part for `data` (the combo's data; changed in place). */
export function createComboModels(ctx, data) {
    if (!data.baseModel) data.baseModel = 'SDXL';
    data.loras ||= [];
    const card = el('section', 'anomalous-nb-card anomalous-combo-models');
    card.id = 'amb-nb-sec-models';
    const changed = () => {
        ctx.saveCurrentNotebook();
        ctx.updateNotebookModelsSummary?.();
    };

    const head = el('div', 'anomalous-combo-section-head');
    const baseLabel = el('label', 'anomalous-combo-base');
    baseLabel.append(el('span', '', t('comboBaseModel')), baseSelect(ctx, data));
    head.append(el('h3', 'anomalous-combo-section-title', t('comboModelsTitle')), baseLabel);

    // Main model: the one chosen, Change opens the grid; a pick closes it.
    const mainTitle = el('h4', 'anomalous-combo-sub-title', t('mainModel'));
    const mainList = el('div', 'anomalous-combo-picks');
    const unetHint = el('div', 'anomalous-nb-unet-hint', t('notebookUnetNeedsTextEncoder'));
    const mainGrid = pickerGrid(data.baseModel, MAIN_TYPES, {
        isPicked: model => data.mainModel?.filename === model.filename,
        onPick: (model) => {
            data.mainModel = data.mainModel?.filename === model.filename ? null : model;
            mainGrid.hidden = Boolean(data.mainModel);
            changed();
            drawMain();
        },
    });
    const drawMain = () => {
        const toggle = button('anomalous-combo-pick-action', '', () => {
            mainGrid.hidden = !mainGrid.hidden;
            if (!mainGrid.hidden) mainGrid.load();
            drawMain();
        });
        toggle.textContent = !mainGrid.hidden ? t('comboPickerClose') : data.mainModel ? t('comboChange') : t('comboChoose');
        mainList.replaceChildren(data.mainModel
            ? pickedRow(data.mainModel, 0, toggle)
            : Object.assign(el('div', 'anomalous-combo-pick is-empty'), { textContent: t('comboNoMainModel') }));
        if (!data.mainModel) mainList.firstChild.append(toggle);
        unetHint.hidden = !isUnetModel(data.mainModel);
    };

    // LoRAs: the chosen ones in order (✕ takes one out), Add opens the grid; picks toggle.
    const loraTitle = el('h4', 'anomalous-combo-sub-title', t('loras'));
    const loraList = el('div', 'anomalous-combo-picks');
    const loraGrid = pickerGrid(data.baseModel, 'loras', {
        isPicked: model => data.loras.some(lora => lora.filename === model.filename),
        number: model => data.loras.findIndex(lora => lora.filename === model.filename) + 1,
        onPick: (model) => {
            const at = data.loras.findIndex(lora => lora.filename === model.filename);
            if (at >= 0) data.loras.splice(at, 1);
            else data.loras.push(model);
            changed();
            drawLoras();
        },
    });
    const drawLoras = () => {
        loraTitle.textContent = data.loras.length ? `${t('loras')} · ${data.loras.length}` : t('loras');
        const rows = data.loras.map((lora, index) => pickedRow(lora, index + 1, button('anomalous-combo-pick-remove', '✕', () => {
            data.loras.splice(index, 1);
            changed();
            drawLoras();
            loraGrid.redraw();
        })));
        rows.forEach(row => { row.lastChild.title = t('comboRemoveLora'); row.lastChild.setAttribute('aria-label', t('comboRemoveLora')); });
        const add = button('anomalous-combo-add', loraGrid.hidden ? `+ ${t('comboAddLora')}` : t('comboPickerClose'), () => {
            loraGrid.hidden = !loraGrid.hidden;
            if (!loraGrid.hidden) loraGrid.load();
            drawLoras();
        });
        loraList.replaceChildren(...rows, add);
    };

    drawMain();
    drawLoras();
    card.append(head, mainTitle, mainList, mainGrid, unetHint, loraTitle,
        createLoraNodeChoice(data, () => ctx.saveCurrentNotebook()), loraList, loraGrid);
    return card;
}
