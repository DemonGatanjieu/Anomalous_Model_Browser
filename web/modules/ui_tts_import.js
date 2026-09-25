import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { loadGptSovitsStatus } from './audio_engines.js';
import { buildImportBody, commitImport, discardUploads, importKind, importProblem, inspectImport, uploadFile } from './tts_setup_api.js';
import { PICKER_OVERLAY_CLASS, formatSize, pickServerPath } from './ui_tts_path_picker.js';

/**
 * Import GPT-SoVITS files as a new character, or add them to one (`target`), through
 * the Anomalous_TTS node. Files come from a drop, the browser's file dialog (both are
 * uploaded in chunks) or the node's folder picker (sent as paths). The node copies
 * everything; the originals are never touched.
 *
 * Each file is one row object; its DOM is built once and updated in place, so
 * upload progress and inspect results never steal focus from a field being typed in.
 */

let activeScope = null;
const LANGUAGES = ['', 'ja', 'zh', 'en'];
const ACCEPT = '.ckpt,.pth,.wav,.flac,.ogg,.mp3,.txt,.list';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
    btn.onclick = onClick;
    return btn;
}

function input(className, placeholder, value = '') {
    const node = el('input', className);
    node.type = 'text';
    node.placeholder = placeholder;
    node.value = value;
    return node;
}

/**
 * Let OS files be dropped on `root` (the studio). `onDrop(files, character)` gets the
 * character of the card they were dropped on, or null. Internal drags are ignored.
 */
export function bindTtsFileDrop(root, onDrop) {
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    let marked = null;
    root.dataset.dropHint = t('ttsDropNew');
    const mark = (card) => {
        if (marked === card) return;
        marked?.classList.remove('is-file-target');
        card?.classList.add('is-file-target');
        marked = card;
        root.dataset.dropHint = card ? t('ttsDropAddTo', { name: card.dataset.ttsCharacter }) : t('ttsDropNew');
    };
    const cardAt = e => e.target?.closest?.('[data-tts-character]') || null;
    root.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        root.classList.add('is-file-dragover');
        mark(cardAt(e));
    });
    root.addEventListener('dragleave', (e) => {
        if (root.contains(e.relatedTarget)) return;
        root.classList.remove('is-file-dragover');
        mark(null);
    });
    root.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation(); // ComfyUI would try to open the files as a workflow
        const card = cardAt(e);
        root.classList.remove('is-file-dragover');
        mark(null);
        onDrop([...e.dataTransfer.files], card?.dataset.ttsCharacter || null);
    });
}

/** Open the import form. `onDone(character)` runs after the node created or updated it. */
export async function openTtsImport({ files = [], target = null, onDone } = {}) {
    let status;
    try {
        status = await loadGptSovitsStatus();
    } catch (e) {
        await anomalousAlert(t('ttsSetupFailed', { error: e.message || String(e) }));
        return;
    }
    if (!status) return;
    if (status.local === false) {
        await anomalousAlert(t('ttsSetupRemote'));
        return;
    }
    const libraries = status.libraries.filter(lib => lib.writable);
    if (!target && !libraries.length) {
        await anomalousAlert(t('ttsImportNoLibrary'));
        return;
    }

    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const rows = [];
    let committed = false;
    let referenceKey = null;
    let referenceChosen = Boolean(target); // adding files never replaces the main voice unless asked
    let nameEdited = false;
    let inspectTimer = null;
    let inspectToken = 0;
    let player = null;
    let nextKey = 0;
    let uploads = Promise.resolve();

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-import');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();
    scope.onDispose(() => {
        clearTimeout(inspectTimer);
        player?.pause();
        for (const row of rows) {
            row.controller.abort();
            if (row.url) URL.revokeObjectURL(row.url);
        }
        if (!committed) discardUploads(rows.map(row => row.uploadId).filter(Boolean));
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    // No close on a backdrop click: a stray click would throw away the files and uploads.
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector(`.anomalous-dialog-overlay, .${PICKER_OVERLAY_CLASS}`)) return;
        e.stopPropagation();
        close();
    }, true);

    // ---- header, target ----
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(
        el('div', 'anomalous-voice-modal-title', target ? t('ttsImportAddTitle', { name: target }) : t('ttsImportTitle')),
        el('div', 'anomalous-voice-modal-subtitle', t(target ? 'ttsImportAddSubtitle' : 'ttsImportSubtitle')),
    );
    header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));

    const nameInput = input('anomalous-uploader-input', t('ttsImportNamePlaceholder'));
    nameInput.oninput = () => { nameEdited = true; syncNote(); };
    const librarySelect = el('select', 'anomalous-uploader-input');
    for (const lib of libraries) {
        const option = el('option', '', t('ttsImportLibraryOption', { path: lib.path, count: lib.characters }));
        option.value = lib.path;
        librarySelect.append(option);
    }
    librarySelect.onchange = () => syncNote();
    const targetBox = el('div', 'anomalous-tts-import-target');
    if (!target) {
        const nameField = el('label', 'anomalous-voice-field');
        nameField.append(el('span', 'anomalous-voice-field-label', t('ttsImportName')), nameInput);
        const libField = el('label', 'anomalous-voice-field');
        libField.append(el('span', 'anomalous-voice-field-label', t('ttsImportLibrary')), librarySelect);
        targetBox.append(nameField, libField);
    }

    // ---- sources ----
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = ACCEPT;
    fileInput.hidden = true;
    fileInput.onchange = () => { addBrowserFiles([...fileInput.files]); fileInput.value = ''; };
    const dropzone = el('div', 'anomalous-audio-dropzone anomalous-tts-import-drop');
    const pickLocal = button('anomalous-tts-add', t('ttsImportPickLocal'), async (e) => {
        e.stopPropagation();
        const paths = await pickServerPath({ mode: 'files', title: t('ttsImportPickLocal'), hint: t('ttsImportPickLocalHint') });
        if (paths && !scope.signal.aborted) addPaths(paths);
    });
    const pickBrowser = button('anomalous-tts-add', t('ttsImportPickFiles'), (e) => { e.stopPropagation(); fileInput.click(); });
    const dropButtons = el('div', 'anomalous-tts-setup-actions');
    dropButtons.append(pickBrowser, pickLocal);
    dropzone.append(el('div', 'anomalous-audio-dropzone-hint', t('ttsImportDropHint')),
        el('div', 'anomalous-audio-dropzone-formats', t('ttsImportDropFormats')), dropButtons, fileInput);
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
        addBrowserFiles([...(e.dataTransfer?.files || [])]);
    };

    const list = el('div', 'anomalous-tts-import-list');
    const skipped = el('div', 'anomalous-tts-hint');
    const problems = el('div', 'anomalous-tts-import-problems');

    const languageSelect = el('select', 'anomalous-uploader-input');
    const languageField = el('label', 'anomalous-voice-field anomalous-tts-import-language');
    languageField.append(el('span', 'anomalous-voice-field-label', t('ttsImportLanguage')), languageSelect);
    const fillLanguages = (suggested) => {
        const keep = languageSelect.value;
        languageSelect.replaceChildren(...LANGUAGES.map(code => {
            const option = el('option', '', code ? t(`ttsNeededFor_${code}`)
                : suggested ? t('ttsImportLanguageAutoFound', { lang: t(`ttsNeededFor_${suggested}`) }) : t('ttsImportLanguageAuto'));
            option.value = code;
            return option;
        }));
        languageSelect.value = keep;
    };
    fillLanguages(null);
    const note = el('div', 'anomalous-tts-hint');
    const syncNote = () => {
        note.textContent = target ? t('ttsImportAddNote', { name: target })
            : t('ttsImportNote', { path: `${librarySelect.value}/${nameInput.value.trim() || '…'}` });
    };
    syncNote();

    // ---- rows ----
    const readyRows = () => rows.filter(row => row.spec && !row.error);

    function renderState(row) {
        const { state } = row.els;
        state.classList.toggle('is-error', Boolean(row.error));
        state.textContent = row.error ? t('ttsImportRowError', { error: row.error })
            : row.spec ? t('ttsImportRowReady') : t('ttsImportRowUploading', { percent: Math.floor(100 * row.progress) });
    }

    function renderMeta(row) {
        const info = row.info || {};
        const parts = row.size ? [formatSize(row.size)] : [];
        if (info.version) parts.push(info.supported ? info.version : t('ttsImportUnsupported', { version: info.version }));
        if (info.seconds !== undefined) parts.push(t('ttsImportSeconds', { seconds: info.seconds }));
        row.els.meta.textContent = parts.join(' · ');
    }

    function syncReference() {
        for (const row of rows) {
            if (!row.els.main) continue;
            const on = row.key === referenceKey;
            row.els.main.setAttribute('aria-pressed', String(on));
            row.els.main.classList.toggle('active', on);
            row.els.emotion.disabled = on;
        }
    }

    function removeRow(row) {
        row.controller.abort();
        if (row.uploadId) discardUploads([row.uploadId]);
        if (row.url) URL.revokeObjectURL(row.url);
        rows.splice(rows.indexOf(row), 1);
        row.els.root.remove();
        if (referenceKey === row.key) referenceKey = null;
        scheduleInspect();
    }

    function buildRow(row) {
        const root = el('div', 'anomalous-tts-import-row');
        root.dataset.kind = row.kind;
        const line = el('div', 'anomalous-tts-import-line');
        const name = el('span', 'anomalous-tts-picker-name', row.name);
        name.title = row.path || row.name;
        row.els = { root, meta: el('span', 'anomalous-tts-picker-meta'), state: el('span', 'anomalous-tts-import-state') };
        line.append(el('span', 'anomalous-tts-kind', t(`ttsKind_${row.kind}`)), name, row.els.meta, row.els.state,
            button('anomalous-tts-remove', '×', () => removeRow(row), t('ttsEditorRemove')));
        root.append(line);
        if (row.kind === 'audio') {
            const audio = el('div', 'anomalous-tts-import-audio');
            row.els.main = button('anomalous-tag-chip', t('ttsImportMain'), () => {
                referenceKey = referenceKey === row.key ? null : row.key;
                referenceChosen = true;
                syncReference();
            }, t('ttsImportMainTitle'));
            const play = button('anomalous-audio-play-btn', '▶', () => {
                player?.pause();
                row.url = row.url || URL.createObjectURL(row.file);
                player = new Audio(row.url);
                player.play().catch(() => {});
            }, t('audioPlay'));
            play.hidden = !row.file; // local paths cannot be played from the browser
            row.els.emotion = input('anomalous-tts-name-input', t('ttsImportEmotionPlaceholder'));
            row.els.emotion.oninput = () => { row.emotion = row.els.emotion.value.trim(); };
            row.els.text = input('anomalous-tts-text-input', t('ttsImportTextPlaceholder'));
            row.els.text.oninput = () => { row.text = row.els.text.value.trim(); row.textEdited = true; };
            audio.append(row.els.main, play, row.els.emotion, row.els.text);
            root.append(audio);
        }
        renderMeta(row);
        renderState(row);
        return root;
    }

    function addRow(fields) {
        const duplicate = rows.some(row => row.kind === fields.kind && row.name.toLowerCase() === fields.name.toLowerCase());
        if (duplicate) return null;
        const row = { key: nextKey++, progress: 0, emotion: '', text: '', textEdited: false, uploadId: null,
            spec: null, error: '', info: null, controller: new AbortController(), ...fields };
        rows.push(row);
        list.append(buildRow(row));
        return row;
    }

    function reportSkipped(names) {
        skipped.textContent = names.length ? t('ttsImportSkipped', { files: names.join(', ') }) : '';
    }

    function addBrowserFiles(fileList) {
        const bad = [];
        for (const file of fileList) {
            const kind = importKind(file.name);
            const row = kind ? addRow({ name: file.name, kind, size: file.size, file }) : null;
            if (!row) { bad.push(file.name); continue; }
            uploads = uploads.then(() => upload(row));
        }
        reportSkipped(bad);
    }

    function addPaths(paths) {
        const bad = [];
        for (const path of paths) {
            const name = path.split('/').pop();
            const kind = importKind(name);
            const row = kind ? addRow({ name, kind, size: 0, path, spec: { path } }) : null;
            if (!row) bad.push(name);
        }
        reportSkipped(bad);
        scheduleInspect();
    }

    async function upload(row) {
        if (row.controller.signal.aborted) return;
        try {
            await uploadFile(row.file, {
                library: target ? undefined : librarySelect.value,
                signal: row.controller.signal,
                onStart: (id) => { row.uploadId = id; },
                onProgress: (fraction) => { row.progress = fraction; renderState(row); },
            });
            row.spec = { upload: row.uploadId };
        } catch (e) {
            if (row.controller.signal.aborted) return;
            row.error = e.message || String(e);
        }
        renderState(row);
        scheduleInspect();
    }

    function scheduleInspect() {
        clearTimeout(inspectTimer);
        inspectTimer = setTimeout(runInspect, 250);
    }

    async function runInspect() {
        const ready = readyRows();
        if (!ready.length || rows.some(row => !row.spec && !row.error)) {
            if (!ready.length) problems.replaceChildren();
            return;
        }
        const mine = ++inspectToken;
        try {
            const result = await inspectImport(ready.map(row => row.spec), scope.signal);
            if (mine !== inspectToken || scope.signal.aborted) return;
            ready.forEach((row, i) => {
                row.info = result.files[i];
                if (row.info.size) row.size = row.info.size;
                renderMeta(row);
                if (row.els.text && !row.textEdited && row.info.text) {
                    row.text = row.info.text;
                    row.els.text.value = row.info.text;
                }
            });
            const { suggested } = result;
            if (!target && !nameEdited && suggested.name) { nameInput.value = suggested.name; syncNote(); }
            if (!referenceChosen) referenceKey = suggested.reference !== null ? ready[suggested.reference]?.key ?? null : null;
            syncReference();
            fillLanguages(suggested.language);
            problems.replaceChildren(...result.problems.map(text => el('div', 'anomalous-tts-import-problem', text)));
        } catch (e) {
            if (mine !== inspectToken || scope.signal.aborted) return;
            problems.replaceChildren(el('div', 'anomalous-tts-import-problem is-error', e.message || String(e)));
        }
    }

    // ---- footer ----
    const footer = el('div', 'anomalous-voice-modal-footer');
    const submit = button('anomalous-voice-modal-submit', t(target ? 'ttsImportAddSubmit' : 'ttsImportSubmit'), async () => {
        const ready = readyRows();
        const pending = rows.filter(row => !row.spec && !row.error).length;
        const problem = importProblem({ target, character: nameInput.value, rows: ready, uploading: pending });
        if (problem) {
            await anomalousAlert(t(problem[0], problem[1]));
            return;
        }
        const index = ready.findIndex(row => row.key === referenceKey);
        const body = buildImportBody({
            target, library: librarySelect.value, character: nameInput.value.trim(), language: languageSelect.value,
            referenceIndex: index >= 0 ? index : null,
            rows: ready.map(row => ({ spec: row.spec, kind: row.kind, emotion: row.emotion, text: row.text })),
        });
        submit.disabled = true;
        try {
            const character = await commitImport(body);
            committed = true;
            onDone?.(character);
            close();
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('ttsImportFailed', { error: e.message || String(e) }));
        } finally {
            if (!scope.signal.aborted) submit.disabled = false;
        }
    });
    footer.append(button('anomalous-voice-modal-cancel', t('dialogCancel'), close), submit);

    const body = el('div', 'anomalous-tts-editor-body');
    body.append(targetBox, dropzone, skipped, list, languageField, problems, note);
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    addBrowserFiles(files);
    (target ? pickBrowser : nameInput).focus();
}
