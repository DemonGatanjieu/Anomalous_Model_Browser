/**
 * What an AI task made, and where it leads (ui_ai_workbench.js draws the task): the pictures a
 * step made (the viewer), its models (their page), the combo, the spoken audio (▶), the canvas
 * change (found on the canvas, undone while it can be), the scan; and the strip of everything
 * a task made above its timeline. `shared` is set by the workbench: the browser (`owner`) and
 * the activity entries of the task's canvas steps.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { changeNodeId } from './activity_diff.js';
import { canUndo, undoEntry } from './canvas_undo.js';
import { anomalousAlert } from './ui_dialog.js';
import { openListedModel } from './ui_scan_lists.js';
import { listCombos } from './image_keep.js';
import { audioResult, outputUrl, taskResults } from './ai_task_view.js';
import { imageComparison, imageResults } from './ui_ai_images.js';
import { canvasChanges } from './ui_canvas_changes.js';

export const shared = { owner: null, entries: new Map(), player: null };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

function playButton(result) {
    const play = button('anomalous-ai-play', '▶', () => {
        const url = outputUrl(audioResult(result));
        if (shared.player?.dataset?.url === url && !shared.player.paused) {
            shared.player.pause();
            return;
        }
        shared.player?.pause();
        shared.player = new Audio(url);
        shared.player.dataset.url = url;
        shared.player.play().catch(() => {});
    }, t('audioPlay'));
    return play;
}

export async function openModel(result) {
    const owner = shared.owner;
    if (!owner || !result.rel) return;
    await openListedModel(owner, { type: result.folder, path_idx: result.path_idx, rel: result.rel, filename: result.name || result.rel }, () => owner.goTo('ai'));
}

async function openComboNamed(name) {
    const owner = shared.owner;
    const note = (await listCombos().catch(() => [])).find(item => item.data?.name === name || item.name === name);
    if (note) await owner.openCombo(note);
    else await owner.showNotebooks();
}

function locate(entry, note) {
    const change = (entry?.detail?.changes || []).find(item => item.kind !== 'removed' && changeNodeId(item) !== null);
    locateNode(change ? changeNodeId(change) : null, note);
}

/** Closes the browser on canvas node `id`, selected and centred (a note says when it is gone). */
export function locateNode(id, note) {
    const graph = app.canvas?.graph || app.graph;
    const node = id === null ? null : graph?.getNodeById?.(Number(id)) ?? graph?.getNodeById?.(id);
    if (!node) {
        if (note) note.textContent = t('activityLocateMissing');
        else void anomalousAlert(t('activityLocateMissing'));
        return;
    }
    shared.owner?.close?.();
    app.canvas.selectNode?.(node);
    app.canvas.centerOnNode?.(node);
    app.canvas.setDirty?.(true, true);
}

/** The links under a step: what it made and where that leads. */
export function resultLinks(step, changed = () => {}) {
    const box = el('div', 'anomalous-ai-results');
    const pictures = (step.results || []).filter(result => result.type === 'image');
    if (pictures.length) {
        box.append(imageResults(pictures, shared.owner));
        const compare = imageComparison(pictures);
        if (compare) box.append(compare);
    }
    const links = el('div', 'anomalous-ai-links');
    const note = el('span', 'anomalous-ai-link-note');
    for (const result of step.results || []) {
        if (result.type === 'model') {
            const chip = button('anomalous-ai-chip is-model', result.name || result.model_id, () => openModel(result), t('aiOpenModel'));
            chip.disabled = !result.rel;
            links.append(chip);
        } else if (result.type === 'combo') {
            links.append(button('anomalous-ai-chip is-combo', result.name, () => openComboNamed(result.name), t('aiOpenCombo')));
        } else if (result.type === 'audio') {
            const chip = el('span', 'anomalous-ai-chip is-audio');
            chip.append(playButton(result), el('span', '', result.file.split('/').pop()));
            links.append(chip);
        } else if (result.type === 'canvas') {
            const entry = shared.entries.get(result.activity);
            box.append(canvasChanges(entry, { locate: change => locateNode(changeNodeId(change), note) }));
            if (entry) {
                links.append(button('anomalous-ai-link', t('activityLocate'), () => locate(entry, note)));
                if (canUndo(app, entry)) {
                    const undo = button('anomalous-ai-link', t('activityUndo'), () => {
                        let done = t('activityUndone');
                        try { undoEntry(app, entry); } catch (_) { done = t('activityUndoGone'); }
                        undo.replaceWith(el('span', 'anomalous-ai-link-done', done));
                        changed();
                    });
                    links.append(undo);
                }
            }
        } else if (result.type === 'scan') {
            links.append(button('anomalous-ai-link', t('aiOpenScan'), () => shared.owner?.openScanPage?.()));
        }
    }
    if (pictures.length) links.append(button('anomalous-ai-link', t('aiOpenGallery'), () => shared.owner?.goTo('gallery')));
    if (links.childNodes.length) box.append(links, note);
    return box.childNodes.length ? box : null;
}

export function strip(task, selection = {}) {
    const made = taskResults(task);
    if (!made.image.length && !made.model.length && !made.combo.length && !made.audio.length) return null;
    const box = el('div', 'anomalous-ai-made');
    box.append(el('div', 'anomalous-ai-made-title', t('aiMade')));
    if (made.image.length) {
        const compare = imageComparison(made.image, selection);
        if (compare) box.append(compare);
        const pictures = el('details', 'anomalous-ai-result-overview');
        pictures.open = Boolean(selection.expanded);
        pictures.append(el('summary', '', t('aiBrowseResults')));
        const draw = () => {
            selection.expanded = pictures.open;
            if (pictures.open && pictures.children.length === 1) pictures.append(imageResults(made.image, shared.owner, { compact: true }));
        };
        pictures.addEventListener('toggle', draw);
        draw();
        box.append(pictures);
    }
    const chips = el('div', 'anomalous-ai-links');
    const seen = new Set();
    for (const result of [...made.model, ...made.combo]) {
        const key = `${result.type}:${result.model_id || result.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chips.append(result.type === 'model'
            ? button('anomalous-ai-chip is-model', result.name || result.model_id, () => openModel(result), t('aiOpenModel'))
            : button('anomalous-ai-chip is-combo', result.name, () => openComboNamed(result.name), t('aiOpenCombo')));
    }
    for (const result of made.audio) {
        const chip = el('span', 'anomalous-ai-chip is-audio');
        chip.append(playButton(result), el('span', '', result.file.split('/').pop()));
        chips.append(chip);
    }
    if (chips.childNodes.length) box.append(chips);
    return box;
}
