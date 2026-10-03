/**
 * Prompt Notes on the Material Library's Prompts page, above the saved prompts: each note
 * (model, LoRAs, prompt) with Put into this workflow and New group of nodes
 * (notebook_canvas.js); the card opens the note's editor (ui_notebooks.js) and New note
 * starts one there. The notes stay where they always were (GET /anomalous/notebooks).
 */

import { translate as t } from './locales.js';
import { anomalousPrompt } from './ui_dialog.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const modelName = (model) => String(model?.filename || '').replace(/\.[^.]+$/, '');

function openNote(owner, note) {
    owner.currentNotebook = note;
    owner.showNotebooks();
}

function noteCard(owner, note) {
    const data = note.data || {};
    const card = el('article', 'anomalous-note-card');
    card.tabIndex = 0;
    card.onclick = () => openNote(owner, note);
    card.onkeydown = (event) => {
        if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            openNote(owner, note);
        }
    };
    const head = el('div', 'anomalous-note-card-head');
    head.append(el('strong', '', note.name));
    const loras = (data.loras || []).length;
    head.append(el('span', 'anomalous-note-card-meta',
        [modelName(data.mainModel) || t('noteNoModel'), loras ? t('noteLoraCount', { count: loras }) : ''].filter(Boolean).join(' · ')));
    card.append(head, el('p', 'anomalous-note-card-prompt', String(data.promptEn || '').trim() || t('noteNoPrompt')));
    const actions = el('div', 'anomalous-note-card-actions');
    for (const [className, key, run] of [
        ['anomalous-btn-primary', 'noteApplyButton', () => owner.applyNotebookToWorkflow()],
        ['anomalous-btn-ghost', 'sendToCanvas', () => owner.sendNotebookToCanvas()],
    ]) {
        const button = el('button', className, t(key));
        button.type = 'button';
        button.onclick = (event) => {
            event.stopPropagation();
            owner.currentNotebook = note;
            run();
        };
        actions.append(button);
    }
    card.append(actions);
    return card;
}

async function newNote(owner) {
    const name = String(await anomalousPrompt(t('newNotebookName'), '', t('createNotebook')) || '').trim();
    if (!name) return;
    owner.currentNotebook = {
        filename: `${name}.json`,
        name,
        data: { baseModel: '', mainModel: null, loras: [], promptEn: '', promptZh: '' },
    };
    if (await owner.saveCurrentNotebook()) owner.showNotebooks();
}

function heading(titleKey, extra = null) {
    const row = el('div', 'anomalous-note-shelf-heading');
    row.append(el('span', '', t(titleKey)));
    if (extra) row.append(extra);
    return row;
}

/** The notes matching the library's search: a heading with New note, then their cards. */
export async function noteShelf(owner, signal) {
    const response = await fetch('/anomalous/notebooks', { cache: 'no-store', signal });
    const { notebooks = [] } = await response.json();
    const query = String(owner.materialQuery || '').trim().toLowerCase();
    const shown = notebooks.filter(note => !query || `${note.name} ${note.data?.promptEn || ''}`.toLowerCase().includes(query));
    const create = el('button', 'anomalous-btn-ghost', t('createNotebook'));
    create.type = 'button';
    create.onclick = () => void newNote(owner);
    const fragment = document.createDocumentFragment();
    fragment.append(heading('noteShelfTitle', create), ...shown.map(note => noteCard(owner, note)));
    if (!shown.length) fragment.append(el('p', 'anomalous-note-shelf-empty', t(query ? 'materialNoMatches' : 'noteShelfEmpty')));
    return fragment;
}

export const savedPromptsHeading = () => heading('noteSavedPromptsTitle');
