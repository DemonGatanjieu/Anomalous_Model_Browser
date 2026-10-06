/**
 * Share and import (the Workflows page's ⇅): the canvas workflow as a short share code
 * (share_code.js) in two spellings, Chinese characters (shortest) and letters (passes any
 * filter); and one place to bring anything in: a pasted share code (AMB2/AMB1/AMB0) or
 * workflow JSON, a dropped or chosen workflow file or image (ComfyUI's own loader), or a .zip:
 * a recipe package (ui_recipe_package.js) or a backup (ui_backup.js).
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { decodeShareCode, encodeShareCode } from './share_code.js';
import { packOf } from './combo_slots.js';
import { isModelFilename } from './model_source_links.js';
import { importBackupFile } from './ui_backup.js';
import { importRecipePackageFile } from './ui_recipe_package.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const templates = new Map();

/** A fresh node of `type`: its ports and size (null when the type is not installed). */
function templateOf(type) {
    if (templates.has(type)) return templates.get(type);
    let template = null;
    try {
        const node = globalThis.LiteGraph?.createNode(type);
        if (node) {
            const data = node.serialize();
            template = { inputs: data.inputs || [], outputs: data.outputs || [], size: data.size || null };
        }
    } catch (error) {
        console.warn(`[AMB] Share code: could not make a ${type} to compare with.`, error);
    }
    templates.set(type, template);
    return template;
}

const HELPERS = { templateOf, isCore: type => Boolean(templateOf(type)) && !packOf(type) };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(label, variant, onClick) {
    const node = el('button', `anomalous-share-btn${variant ? ` ${variant}` : ''}`, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** What a workflow tells others about its models: how many carry a fingerprint, how many links. */
function provenance(workflow) {
    const models = new Set();
    for (const node of workflow.nodes || []) {
        for (const value of Array.isArray(node.widgets_values) ? node.widgets_values : []) {
            if (isModelFilename(value)) models.add(`${node.id}_${value}`);
        }
    }
    const hashes = workflow.extra?.anomalous_hashes || {};
    const hashed = [...models].filter(key => hashes[key]?.hash).length;
    return { models: models.size, hashed, links: Object.keys(workflow.extra?.anomalous_model_sources || {}).length };
}

function provenanceNote(summary) {
    if (!summary.models) return '';
    if (localStorage.getItem('anomalous_inject_hash') === 'false') return t('mainShareProvenanceOff');
    const missing = summary.models - summary.hashed;
    return [t('mainShareFingerprints', { hashed: summary.hashed, total: summary.models }),
        missing ? t('mainShareNoFingerprint', { count: missing }) : ''].filter(Boolean).join(' ');
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = el('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        const done = document.execCommand('copy');
        area.remove();
        return done;
    }
}

/** The share part: the code is made when the dialog opens, again when links are left out. */
function exportSection() {
    const section = el('section', 'anomalous-share-section');
    section.append(el('h3', 'anomalous-share-heading', t('shareExportHeading')), el('p', 'anomalous-share-note', t('shareExportHelp')));
    const code = el('textarea', 'anomalous-share-code');
    code.readOnly = true;
    const stats = el('p', 'anomalous-share-stats');
    const note = el('p', 'anomalous-share-note');
    const linksLabel = el('label', 'anomalous-share-check');
    const linksBox = el('input');
    linksBox.type = 'checkbox';
    linksBox.checked = true;
    const linksText = el('span');
    linksLabel.append(linksBox, linksText);
    const actions = el('div', 'anomalous-share-actions');
    let current = null;
    const copy = (kind) => async () => {
        if (!current) return;
        const text = current[kind];
        if (await copyText(text)) showWorkbenchToast(t('shareCopied', { kind: t(kind === 'hanzi' ? 'shareKindHanzi' : 'shareKindLetters'), count: text.length }));
    };
    actions.append(button(t('shareCopyHanzi'), 'is-primary', copy('hanzi')), button(t('shareCopyLetters'), '', copy('letters')));
    section.append(code, stats, linksLabel, note, actions, el('p', 'anomalous-share-note', t('shareCodeHelp')));

    const make = async () => {
        const workflow = (await app.graphToPrompt()).workflow;
        if (!workflow?.nodes?.length) {
            code.value = '';
            stats.textContent = t('shareEmptyCanvas');
            actions.hidden = true;
            linksLabel.hidden = true;
            return;
        }
        const summary = provenance(workflow);
        linksText.textContent = ` ${t('mainShareLinks', { count: summary.links })}`;
        linksLabel.hidden = !summary.links;
        note.textContent = provenanceNote(summary);
        note.hidden = !note.textContent;
        if (!linksBox.checked) delete workflow.extra?.anomalous_model_sources;
        current = await encodeShareCode(workflow, HELPERS);
        code.value = current.hanzi;
        stats.textContent = [t('shareStats', { hanzi: current.hanzi.length, letters: current.letters.length }),
            current.whole ? t('shareWhole') : ''].filter(Boolean).join(' ');
        actions.hidden = false;
    };
    linksBox.onchange = () => void make().catch(fail);
    const fail = (error) => {
        console.error('[AMB] Share code: making it failed.', error);
        stats.textContent = t('shareImportFailed', { error: error.message });
    };
    void make().catch(fail);
    return section;
}

/** Fits the loaded workflow into view (share codes carry no view). */
function fitView() {
    try {
        void app.extensionManager?.command?.execute?.('Comfy.Canvas.FitView');
    } catch { /* the view stays */ }
}

/** The import part: paste, drop or choose; `done()` closes the dialog. */
function importSection(owner, done) {
    const section = el('section', 'anomalous-share-section');
    const input = el('textarea', 'anomalous-share-code is-input');
    input.placeholder = t('shareImportPlaceholder');
    const status = el('p', 'anomalous-share-note');
    const opened = (count) => {
        done();
        document.getElementById('anomalous-close')?.click(); // the canvas is what the user wants to see now
        showWorkbenchToast(t('shareImported', { count }));
    };
    const fail = (error) => {
        status.textContent = t('shareImportFailed', { error: error.message });
        status.classList.add('is-bad');
    };
    const fromText = async (raw) => {
        const text = String(raw || '').trim();
        if (!text) throw new Error(t('shareImportEmpty'));
        if (text.startsWith('{')) {
            await app.handleFile(new File([text], 'workflow.json', { type: 'application/json' }));
            opened(JSON.parse(text).nodes?.length || 0);
            return;
        }
        const workflow = await decodeShareCode(text, HELPERS);
        await app.loadGraphData(workflow);
        fitView();
        opened(workflow.nodes?.length || 0);
    };
    const fromFile = async (file) => {
        if (/\.zip$/i.test(file.name)) {
            // A recipe package, else a backup (the backup's own dialog says when it is neither).
            if (!/^AMB-backup-/i.test(file.name) && await importRecipePackageFile(owner, file)) {
                done();
                return;
            }
            done();
            await importBackupFile(owner, file);
            return;
        }
        await app.handleFile(file);
        opened(app.graph?._nodes?.length || 0);
    };
    const run = (work) => {
        status.classList.remove('is-bad');
        status.textContent = '';
        void work().catch(fail);
    };
    const chooser = el('input');
    chooser.type = 'file';
    chooser.accept = '.json,.png,.webp,.jpg,.jpeg,.flac,.mp4,.webm,.zip';
    chooser.onchange = () => { if (chooser.files?.[0]) run(() => fromFile(chooser.files[0])); };
    const actions = el('div', 'anomalous-share-actions');
    actions.append(button(t('shareChooseFile'), '', () => chooser.click()),
        button(t('shareImportButton'), 'is-primary', () => run(() => fromText(input.value))));
    section.append(el('h3', 'anomalous-share-heading', t('shareImportHeading')), input, status, actions);
    return { section, dropFile: file => run(() => fromFile(file)), dropText: (text) => { input.value = text; run(() => fromText(text)); } };
}

/** Opens the dialog. */
export function openShareDialog(owner) {
    const overlay = el('div', 'anomalous-share-overlay');
    const dialog = el('div', 'anomalous-share-dialog is-wide');
    dialog.setAttribute('role', 'dialog');
    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    const incoming = importSection(owner, close);
    const footer = el('div', 'anomalous-share-actions');
    footer.append(button(t('mainClose'), 'is-quiet', close));
    dialog.append(el('h2', 'anomalous-share-title', t('shareTitle')), exportSection(), incoming.section, footer);
    // Anything dropped on the dialog is imported (and never reaches the canvas behind it).
    overlay.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dialog.classList.add('is-drop');
    });
    overlay.addEventListener('dragleave', (event) => {
        if (event.target === overlay) dialog.classList.remove('is-drop');
    });
    overlay.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dialog.classList.remove('is-drop');
        const file = event.dataTransfer?.files?.[0];
        const text = event.dataTransfer?.getData('text/plain');
        if (file) incoming.dropFile(file);
        else if (text) incoming.dropText(text);
    });
    overlay.onclick = (event) => { if (event.target === overlay) close(); };
    document.addEventListener('keydown', onKey, true);
    overlay.append(dialog);
    document.body.append(overlay);
}
