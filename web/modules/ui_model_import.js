/**
 * Model import's window: model files dropped on the models page (or picked with its Import
 * chip) each get a card saying what the file is (type, base model, how sure), one line on what
 * such a model is for, where it will go (changeable) and anything to know (a format that can
 * carry code, a file of that name or the very same file already there). "Put in place" moves
 * the files found on this computer and uploads the others; model_import.js does the work.
 */

import { translate as t } from './locales.js';
import { unsafeFormat } from './download_places.js';
import { defaultRoot, rememberRoot } from './model_download.js';
import {
    afterImport, fetchImportFolders, identifyFile, importDestination, inspectFile, modelFiles, placeFile, uploadFile,
} from './model_import.js';
import { formatSize, joinPath } from './ui_model_download.js';
import { createViewScope } from './ui_lifecycle.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openSettingsPage } from './ui_settings_page.js';

const KINDS = ['checkpoints', 'loras', 'vae', 'text_encoders', 'diffusion_models', 'controlnet', 'embeddings',
    'clip_vision', 'upscale_models', 'ipadapter'];
const LEVELS = { sure: ['●●●', 'doctorLevelSure'], likely: ['●●○', 'doctorLevelLikely'] };
const ACCEPT = '.safetensors,.sft,.gguf,.ckpt,.pt,.pth,.bin';
// Types whose files serve several base models: no base model folder.
const SHARED = ['vae', 'text_encoders', 'clip_vision', 'upscale_models', 'ipadapter'];

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

/** Why an import failed: its own sentence, else the download one for the same code. */
function errorText(code) {
    for (const key of [`importError_${code}`, `downloadError_${code}`]) {
        const text = t(key);
        if (text !== key) return text;
    }
    return t('importError_unknown');
}

/** Lets the user pick model files, then opens the import window for them. */
export function pickModelFiles(owner) {
    const input = el('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ACCEPT;
    input.onchange = () => {
        const files = modelFiles(input.files);
        if (files.length) openImportDialog(owner, files);
    };
    input.click();
}

/** Model files dropped on `target` (the models grid) open the import window. */
export function attachModelDrop(owner, target) {
    let depth = 0;
    let hint = null;
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    const hide = () => {
        depth = 0;
        hint?.remove();
        hint = null;
    };
    const show = () => {
        if (hint) return;
        const box = target.getBoundingClientRect();
        hint = el('div', 'anomalous-import-drop');
        Object.assign(hint.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        hint.append(el('span', 'anomalous-import-drop-text', t('importDropHint')));
        document.body.append(hint);
    };
    target.addEventListener('dragenter', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth += 1;
        show();
    });
    target.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('dragleave', (event) => {
        if (!hasFiles(event)) return;
        depth -= 1;
        if (depth <= 0) hide();
    });
    target.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        hide();
        const files = modelFiles(event.dataTransfer.files);
        if (files.length) openImportDialog(owner, files);
        else showWorkbenchToast(t('importNoModels'));
    });
}

/** One file's card. `card` is its state; `draw()` redraws it from that state. */
function makeCard(file, view) {
    const card = { file, info: null, found: null, kind: '', base: '', rootIndex: 0, rel: '', edited: false,
        include: true, state: 'looking', message: '', identifying: false };
    card.box = el('div', 'anomalous-download-item anomalous-import-item');

    const roots = () => {
        const all = view.folders?.types?.[card.kind] || [];
        const existing = all.filter(root => root.exists);
        return existing.length ? existing : all.slice(0, 1);
    };
    const root = () => roots().find(item => item.index === card.rootIndex) || roots()[0] || { index: 0, path: '', subfolders: [] };
    card.place = () => {
        if (!card.kind) return;
        if (!roots().some(item => item.index === card.rootIndex)) card.rootIndex = defaultRoot(card.kind, view.folders?.types?.[card.kind] || [])?.index ?? 0;
        if (!card.edited) card.rel = importDestination(file.name, card.base, view.folders?.settings, root().subfolders);
    };

    const head = () => {
        const line = el('div', 'anomalous-download-head');
        line.append(el('strong', 'anomalous-download-name', file.name));
        const where = card.info?.token ? t(card.info.where === 'desktop' ? 'importFromDesktop' : 'importFromDownloads') : t('importWillUpload');
        line.append(el('span', 'anomalous-download-facts', [formatSize(file.size), card.info ? where : ''].filter(Boolean).join(' · ')));
        if (card.state !== 'done' && card.state !== 'busy') {
            const remove = button('anomalous-import-remove', '✕', () => view.remove(card));
            remove.title = t('importRemove');
            line.append(remove);
        }
        return line;
    };

    const kindLine = () => {
        const line = el('label', 'anomalous-download-where');
        line.append(el('span', 'anomalous-download-label', t('importKind')));
        const select = el('select', 'anomalous-download-root anomalous-import-kind');
        const empty = el('option', '', t('importKindPick'));
        empty.value = '';
        select.append(empty);
        for (const kind of KINDS) {
            if (!view.folders?.types?.[kind]) continue;
            const option = el('option', '', t(`importKind_${kind}`));
            option.value = kind;
            select.append(option);
        }
        select.value = card.kind;
        select.disabled = card.state === 'busy' || card.state === 'done';
        select.onchange = () => {
            card.kind = select.value;
            card.picked = true;
            card.edited = false;
            card.place();
            card.draw();
            view.update();
        };
        line.append(select);
        const civitai = card.found?.civitai;
        const level = card.picked ? null : civitai?.base_model || card.info?.sure ? 'sure' : card.kind ? 'likely' : null;
        if (level) {
            const [dots, key] = LEVELS[level];
            line.append(el('span', `anomalous-doctor-level is-${level}`, `${dots} ${t(key)}`));
        }
        return line;
    };

    const baseLine = () => {
        const civitai = card.found?.civitai;
        const parts = [card.base ? t('importBase', { base: card.base }) : t(SHARED.includes(card.kind) ? 'importBaseShared' : 'importBaseNone')];
        if (civitai?.base_model) parts.push(t('importBaseCivitai'));
        const line = el('div', 'anomalous-download-note', parts.join(' '));
        if (card.identifying) line.append(el('span', 'anomalous-import-checking', ` · ${t('importChecking')}`));
        else if (card.found?.reason === 'network') line.append(document.createTextNode(` · ${t('importCivitaiDown')}`));
        else if (card.found?.reason === 'not_found') line.append(document.createTextNode(` · ${t('importCivitaiUnknown')}`));
        return line;
    };

    const whereLines = () => {
        const line = el('label', 'anomalous-download-where');
        line.append(el('span', 'anomalous-download-label', t('downloadSaveTo')));
        const choices = roots();
        const locked = card.state === 'busy' || card.state === 'done';
        if (choices.length > 1) {
            const select = el('select', 'anomalous-download-root');
            for (const item of choices) {
                const option = el('option', '', item.path);
                option.value = String(item.index);
                select.append(option);
            }
            select.value = String(root().index);
            select.disabled = locked;
            select.onchange = () => {
                card.rootIndex = Number(select.value);
                card.place();
                card.draw();
            };
            line.append(select);
        }
        const input = el('input', 'anomalous-download-rel');
        input.type = 'text';
        input.spellcheck = false;
        input.value = card.rel;
        input.disabled = locked;
        const full = el('div', 'anomalous-download-path');
        const showPath = () => { full.textContent = root().path ? joinPath(root().path, input.value.trim()) : input.value.trim(); };
        input.oninput = () => {
            card.rel = input.value.trim().replace(/\\/g, '/');
            card.edited = true;
            showPath();
        };
        showPath();
        line.append(input);
        return [line, full];
    };

    const notes = () => {
        const list = [];
        const note = (key, params, tone = '') => list.push(el('div', `anomalous-download-note${tone ? ` is-${tone}` : ''}`, t(key, params)));
        if (card.kind) note(`importKindHelp_${card.kind}`);
        else if (card.info) note(unsafeFormat(file.name) ? 'importKindUnreadable' : 'importKindUnknown', {}, 'warn');
        const civitai = card.found?.civitai;
        if (civitai?.model_name) note('importCivitaiName', { name: [civitai.model_name, civitai.version_name].filter(Boolean).join(' — ') });
        if (unsafeFormat(file.name)) note('downloadUnsafeFormat', {}, 'warn');
        if (card.found?.duplicate) note('importDuplicate', { path: card.found.duplicate }, 'bad');
        else {
            const same = (card.info?.same_name || []).find(item => item.size === file.size);
            const other = (card.info?.same_name || [])[0];
            if (same) note('importSameFile', { path: same.rel }, 'warn');
            else if (other) note('importSameName', { path: other.rel });
        }
        return list;
    };

    const status = () => {
        const line = el('div', 'anomalous-import-status');
        if (card.state === 'looking') line.append(el('span', 'anomalous-download-text', t('importLooking')));
        if (card.state === 'busy') {
            line.append(el('span', 'anomalous-download-text', card.message));
            if (card.percent !== undefined) {
                const bar = el('span', 'anomalous-download-bar');
                bar.style.setProperty('--amb-download-done', `${card.percent}%`);
                line.append(bar);
            }
        }
        if (card.state === 'done') line.append(el('span', 'anomalous-download-text is-ok', t('importPlaced', { path: card.message })));
        if (card.state === 'failed') line.append(el('span', 'anomalous-download-text is-bad', card.message));
        if (card.state === 'ready' && card.found?.duplicate) {
            const box = el('label', 'anomalous-import-include');
            const tick = el('input');
            tick.type = 'checkbox';
            tick.checked = card.include;
            tick.onchange = () => { card.include = tick.checked; view.update(); };
            box.append(tick, el('span', '', t('importStillPut')));
            line.append(box);
        }
        return line;
    };

    card.draw = () => {
        const focused = card.box.contains(document.activeElement) && document.activeElement.classList.contains('anomalous-download-rel');
        card.box.classList.toggle('is-done', card.state === 'done');
        card.box.replaceChildren(head());
        if (card.info) card.box.append(kindLine());
        if (card.info && card.kind) card.box.append(baseLine());
        if (card.info && card.kind) card.box.append(...whereLines());
        card.box.append(...notes(), status());
        if (focused) card.box.querySelector('.anomalous-download-rel')?.focus();
    };
    card.setProgress = (message, percent) => {
        card.message = message;
        card.percent = percent;
        card.draw();
    };
    card.draw();
    return card;
}

/** The import window for `files` (model files only). */
export function openImportDialog(owner, files) {
    const scope = createViewScope();
    const overlay = el('div', 'anomalous-dialog-overlay anomalous-download-overlay');
    const dialog = el('div', 'anomalous-download-dialog anomalous-import-dialog');
    dialog.setAttribute('role', 'dialog');
    const title = el('h3', 'anomalous-download-title');
    const intro = el('div', 'anomalous-download-note', t('importIntro'));
    const list = el('div', 'anomalous-download-items');
    const keepBox = el('label', 'anomalous-import-include');
    const keep = el('input');
    keep.type = 'checkbox';
    keepBox.append(keep, el('span', '', t('importKeepOriginal')));
    keepBox.hidden = true;
    const rules = button('anomalous-download-rules', t('downloadRules'), () => {
        if (busy) return;
        close();
        openSettingsPage(owner, { tab: 'models' });
    });
    const footer = el('div', 'anomalous-download-footer');
    const cancel = button('anomalous-scan-secondary', t('dialogCancel'), () => close());
    const go = button('anomalous-scan-primary', '', () => putAll());
    footer.append(cancel, go);
    dialog.append(title, intro, list, keepBox, rules, footer);
    overlay.append(dialog);
    document.body.append(overlay);

    let busy = false;
    let placedAny = [];
    const view = { folders: null, cards: [] };
    const ready = () => view.cards.filter(card => card.state === 'ready' || card.state === 'failed');
    const toPut = () => ready().filter(card => card.kind && card.rel && card.include);
    view.update = () => {
        title.textContent = t('importTitle', { count: view.cards.length });
        const count = toPut().length;
        go.textContent = t('importPutAll', { count });
        go.disabled = busy || !count;
        cancel.disabled = busy;
        keepBox.hidden = !view.cards.some(card => card.info?.token && card.state !== 'done');
    };
    view.remove = (card) => {
        if (busy) return;
        view.cards = view.cards.filter(item => item !== card);
        card.box.remove();
        if (!view.cards.length) close();
        else view.update();
    };

    function close() {
        if (busy) return;
        scope.dispose();
        overlay.remove();
        if (placedAny.length) afterImport(owner, placedAny);
        placedAny = [];
    }
    scope.listen(document, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    }, true);
    overlay.onclick = (event) => { if (event.target === overlay) close(); };

    async function identifyAll() {
        // One at a time: each reads its whole file from disk.
        for (const card of view.cards) {
            if (scope.signal.aborted) return;
            if (!card.info?.token || card.state !== 'ready') continue;
            card.identifying = true;
            card.draw();
            try {
                card.found = await identifyFile(card.info.token);
                if (card.found.civitai?.base_model) {
                    card.base = card.found.civitai.base_model;
                    card.place();
                }
                if (card.found.duplicate) card.include = false;
            } catch (error) {
                console.warn('[AMB] Import: could not check the file.', error);
            }
            card.identifying = false;
            if (scope.signal.aborted) return;
            card.draw();
            view.update();
        }
    }

    async function putAll() {
        if (busy) return;
        busy = true;
        view.update();
        const placed = [];
        for (const card of toPut()) {
            const choice = { type: card.kind, root: card.rootIndex, rel: card.rel };
            card.state = 'busy';
            try {
                let result;
                if (card.info.token) {
                    card.setProgress(t(keep.checked ? 'importCopying' : 'importMoving'));
                    result = await placeFile(card.info.token, choice, keep.checked);
                } else {
                    card.setProgress(t('importUploading', { percent: 0 }), 0);
                    result = await uploadFile(card.file, choice, (sent, total) => {
                        const percent = total ? Math.floor((sent / total) * 100) : 0;
                        card.setProgress(t('importUploading', { percent }), percent);
                    });
                }
                rememberRoot(card.kind, card.rootIndex);
                placed.push(result);
                card.state = 'done';
                card.message = result.rel;
            } catch (error) {
                card.state = 'failed';
                card.message = errorText(error.code);
            }
            card.draw();
        }
        busy = false;
        placedAny.push(...placed);
        view.update();
        if (placed.length) showWorkbenchToast(t('importDone', { count: placed.length }));
        // Open while something is left to do: a failure, or a file still without a type.
        if (view.cards.every(card => card.state === 'done' || (card.state === 'ready' && !card.include))) close();
    }

    for (const file of files) {
        const card = makeCard(file, view);
        view.cards.push(card);
        list.append(card.box);
    }
    view.update();

    (async () => {
        try {
            view.folders = await fetchImportFolders();
        } catch (error) {
            console.warn('[AMB] Import: model folders unavailable.', error);
            view.folders = { types: {}, settings: null };
        }
        await Promise.all(view.cards.map(async (card) => {
            try {
                card.info = await inspectFile(card.file);
                card.kind = card.info.kind || '';
                card.base = card.info.base || '';
                card.place();
                card.state = 'ready';
            } catch (error) {
                card.state = 'failed';
                card.message = errorText(error.code);
            }
            if (!scope.signal.aborted) card.draw();
        }));
        if (scope.signal.aborted) return;
        view.update();
        identifyAll();
    })();
}
