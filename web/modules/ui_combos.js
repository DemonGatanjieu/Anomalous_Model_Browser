/**
 * The Combos page (搭配): each saved combo of a main model, LoRAs and a prompt (the files
 * GET /anomalous/notebooks keeps, formerly Prompt Notes) as a card with its model's cover
 * and Put on canvas (notebook_canvas.js: a new group of nodes that follows the pointer). A card
 * opens the combo in its editor (ui_notebook_editor.js), and dragged onto the canvas becomes a
 * new group of nodes where it is dropped. New names one and opens it.
 */

import { translate as t } from './locales.js';
import { anomalousPrompt } from './ui_dialog.js';
import { freeComboName, listCombos } from './image_keep.js';
import { bindMaterialDrag } from './material_drag.js';

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

const modelName = model => String(model?.metadata?.custom_name || model?.filename || '').replace(/\.[^.]+$/, '');
const withQuery = (url, query) => `${url}${url.includes('?') ? '&' : '?'}${query}`;

/** The main model's cover, as the model cards show it (a video's still first frame). */
function cover(model) {
    const box = el('div', 'anomalous-combo-cover');
    const url = model?.preview_url;
    if (!url) return box;
    const img = el('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = withQuery(url, /\.(mp4|webm)(?:&|$)/i.test(url) ? 'variant=poster' : 'variant=card');
    img.onerror = () => img.remove();
    box.append(img);
    return box;
}

function comboCard(owner, note) {
    const data = note.data || {};
    const card = el('article', 'anomalous-combo-card');
    card.tabIndex = 0;
    const open = () => owner.openCombo(note);
    card.onclick = open;
    card.onkeydown = (event) => {
        if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            open();
        }
    };
    const body = el('div', 'anomalous-combo-body');
    const loras = (data.loras || []).length;
    body.append(
        el('strong', 'anomalous-combo-name', note.name),
        el('span', 'anomalous-combo-meta', [modelName(data.mainModel) || t('comboNoModel'), loras ? t('comboLoraCount', { count: loras }) : ''].filter(Boolean).join(' · ')),
        el('p', 'anomalous-combo-prompt', String(data.promptEn || '').trim() || t('comboNoPrompt')),
    );
    const use = button('anomalous-btn-primary anomalous-combo-use', t('comboUse'), (event) => {
        event.stopPropagation();
        owner.currentNotebook = note;
        owner.sendNotebookToCanvas();
    });
    use.title = t('comboUseHint');
    body.append(use);
    card.append(cover(data.mainModel), body);
    bindMaterialDrag(card, owner, {
        payload: () => ({ type: 'combo', filename: note.filename, dragHint: t('comboDragHint'), dragTargetHint: t('comboDragCanvas') }),
        accepts: () => false,
        dropOnCanvas: async (event, dragData, graph, position) => {
            if (!position) throw new Error('materialTargetChanged');
            owner.currentNotebook = note;
            owner.sendNotebookToCanvas(position);
        },
    });
    return card;
}

/** Asks for a name, saves an empty combo and opens it. */
export async function newCombo(owner) {
    const wanted = String(await anomalousPrompt(t('comboNewName'), '', t('comboNew')) || '').trim();
    if (!wanted) return;
    const name = freeComboName(wanted, await listCombos());
    const note = {
        filename: `${name}.json`,
        name,
        data: { name, baseModel: '', mainModel: null, loras: [], promptEn: '', promptZh: '' },
    };
    owner.currentNotebook = note;
    if (await owner.saveCurrentNotebook()) owner.openCombo(note);
}

/** Fills `host` with the search box, New and a card per combo matching the search. */
export async function renderComboList(owner, host) {
    const bar = el('div', 'anomalous-combo-bar');
    const search = el('input', 'anomalous-combo-search');
    search.type = 'search';
    search.placeholder = t('comboSearch');
    search.value = owner.comboQuery || '';
    bar.append(el('p', 'anomalous-combo-lead', t('comboLead')), search, button('anomalous-btn-primary', t('comboNew'), () => void newCombo(owner)));
    const grid = el('div', 'anomalous-combo-grid');
    host.replaceChildren(bar, grid);
    grid.append(el('p', 'anomalous-combo-empty', t('loading')));

    let combos;
    try {
        combos = await listCombos();
    } catch (error) {
        console.error('[AMB] Could not list combos:', error);
        grid.replaceChildren(el('p', 'anomalous-combo-empty', t('comboLoadError')));
        return;
    }
    const draw = () => {
        const query = String(owner.comboQuery || '').trim().toLowerCase();
        const shown = combos.filter(note => !query
            || `${note.name} ${modelName(note.data?.mainModel)} ${note.data?.promptEn || ''}`.toLowerCase().includes(query));
        grid.replaceChildren(...shown.map(note => comboCard(owner, note)));
        if (!shown.length) grid.append(el('p', 'anomalous-combo-empty', t(query ? 'comboNoMatches' : 'comboEmpty')));
    };
    search.oninput = () => {
        owner.comboQuery = search.value;
        draw();
    };
    draw();
}
