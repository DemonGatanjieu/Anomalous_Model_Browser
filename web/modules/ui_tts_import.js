import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { loadEngine, loadGptSovitsStatus } from './audio_engines.js';
import {
    buildImportBody, commitImport, discardUploads, importKind, importProblem, inspectImport, nameConflict, pickWeights, uploadFile, usableAsReference,
} from './tts_setup_api.js';
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
export async function openTtsImport({ files = [], target: initialTarget = null, onDone } = {}) {
    let status;
    let existing = [];
    try {
        [status, existing] = await Promise.all([
            loadGptSovitsStatus(),
            loadEngine('gpt_sovits').then(result => result.groups.map(group => group.character)),
        ]);
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
    if (!initialTarget && !libraries.length) {
        await anomalousAlert(t('ttsImportNoLibrary'));
        return;
    }
    const defaultLibrary = (libraries.find(lib => lib.source === 'default') || libraries[0])?.path || '';

    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const rows = [];
    let target = initialTarget;
    let committed = false;
    let referenceKey = null;
    let referenceChosen = Boolean(target); // adding files never replaces the main voice unless asked
    let nameEdited = false;
    let conflict = null;
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

    // ---- header ----
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    const title = el('div', 'anomalous-voice-modal-title');
    const subtitle = el('div', 'anomalous-voice-modal-subtitle');
    heading.append(title, subtitle);
    header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));

    // ---- name, where it goes ----
    const nameInput = input('anomalous-uploader-input', t('ttsImportNamePlaceholder'));
    const nameField = el('label', 'anomalous-voice-field');
    nameField.append(el('span', 'anomalous-voice-field-label', t('ttsImportName')), nameInput);
    const conflictLine = el('div', 'anomalous-tts-import-conflict');
    const librarySelect = el('select', 'anomalous-uploader-input');
    for (const lib of libraries) {
        const option = el('option', '', t('ttsImportLibraryOption', { path: lib.path, count: lib.characters }));
        option.value = lib.path;
        librarySelect.append(option);
    }
    librarySelect.value = defaultLibrary;
    librarySelect.hidden = true; // one standard place; shown only when asked for
    const saveTo = el('span', 'anomalous-tts-hint');
    const changeLocation = button('anomalous-tts-link', t('ttsImportChangeLocation'), () => {
        librarySelect.hidden = false;
        changeLocation.hidden = true;
        librarySelect.focus();
    });
    changeLocation.hidden = libraries.length < 2;
    const saveLine = el('div', 'anomalous-tts-import-saveto');
    saveLine.append(saveTo, changeLocation);
    const nameBlock = el('div', 'anomalous-tts-import-target');
    nameBlock.append(nameField, conflictLine, saveLine, librarySelect);

    const syncSaveTo = () => {
        saveTo.textContent = t('ttsImportSaveTo', { path: `${librarySelect.value}/${nameInput.value.trim() || '…'}` });
    };
    const syncConflict = () => {
        conflict = target ? null : nameConflict(nameInput.value, existing);
        conflictLine.replaceChildren();
        if (!conflict) return;
        if (conflict.kind === 'exact') {
            conflictLine.append(el('span', '', t('ttsImportNameTaken', { name: conflict.name })),
                button('anomalous-tts-link', t('ttsImportSwitchToAdd'), () => switchToAdd(conflict.name)));
        } else {
            conflictLine.append(el('span', '', t('ttsImportNameTakenVariant', { name: conflict.name, variants: conflict.variants.join('、') })));
        }
    };
    nameInput.oninput = () => { nameEdited = true; syncSaveTo(); syncConflict(); };
    librarySelect.onchange = syncSaveTo;

    // ---- adding files ----
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.onchange = () => { addBrowserFiles([...fileInput.files]); fileInput.value = ''; };
    const chooseBrowser = (accept) => { fileInput.accept = accept; fileInput.click(); };
    const chooseLocal = async (kinds) => {
        const paths = await pickServerPath({ mode: 'files', title: t('ttsImportPickLocal'), hint: t('ttsImportPickLocalHint'), kinds });
        if (paths && !scope.signal.aborted) addPaths(paths);
    };
    const addBar = el('div', 'anomalous-tts-import-addbar');
    const addButtons = el('div', 'anomalous-tts-setup-actions');
    addButtons.append(button('anomalous-tts-add', t('ttsImportPickFiles'), () => chooseBrowser(ACCEPT)),
        button('anomalous-tts-add', t('ttsImportPickLocal'), () => chooseLocal(null)));
    addBar.append(el('span', 'anomalous-tts-hint', t('ttsImportDropHint')), addButtons, fileInput);

    /** A labelled section holding rows of some kinds, with an empty placeholder and its own pick buttons. */
    function section(label, kind, accept, emptyText) {
        const box = el('div', `anomalous-tts-import-section is-${kind}`);
        const head = el('div', 'anomalous-tts-import-section-head');
        const pick = el('span', 'anomalous-tts-import-section-pick');
        pick.append(button('anomalous-tts-link', t('ttsImportPick'), () => chooseBrowser(accept)),
            button('anomalous-tts-link', t('ttsImportPickHere'), () => chooseLocal([kind])));
        head.append(el('span', 'anomalous-voice-field-label', label), pick);
        const list = el('div', 'anomalous-tts-import-list');
        const empty = el('div', 'anomalous-tts-import-empty', emptyText);
        box.append(head, list, empty);
        return { box, list, empty };
    }
    const sections = {
        gpt: section(t('ttsImportSlotGpt'), 'gpt', '.ckpt', t('ttsImportSlotEmpty')),
        sovits: section(t('ttsImportSlotSovits'), 'sovits', '.pth', t('ttsImportSlotEmpty')),
        audio: section(t('ttsImportSlotAudio'), 'audio', '.wav,.flac,.ogg,.mp3', t('ttsImportAudioEmpty')),
        text: section(t('ttsImportSlotText'), 'text', '.txt,.list', t('ttsImportTextEmpty')),
    };
    const syncSections = () => {
        for (const [kind, sec] of Object.entries(sections)) sec.empty.hidden = rows.some(row => row.kind === kind);
    };

    const notes = el('div', 'anomalous-tts-hint');
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
        row.els.root.classList.toggle('is-unsupported', info.supported === false);
        row.els.root.classList.toggle('is-out-of-range', !usableAsReference(info.seconds));
    }

    function syncReference() {
        for (const row of rows) {
            if (!row.els.main) continue;
            const usable = usableAsReference(row.info?.seconds);
            if (!usable && referenceKey === row.key) referenceKey = null;
            const on = row.key === referenceKey;
            row.els.main.setAttribute('aria-pressed', String(on));
            row.els.main.classList.toggle('active', on);
            row.els.main.disabled = !usable;
            row.els.main.title = usable ? t('ttsImportMainTitle') : t('ttsImportOutOfRange');
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
        syncSections();
        scheduleInspect();
    }

    function buildRow(row) {
        const root = el('div', 'anomalous-tts-import-row');
        root.dataset.kind = row.kind;
        const line = el('div', 'anomalous-tts-import-line');
        const name = el('span', 'anomalous-tts-picker-name', row.name);
        name.title = row.path || row.name;
        row.els = { root, meta: el('span', 'anomalous-tts-picker-meta'), state: el('span', 'anomalous-tts-import-state') };
        line.append(name, row.els.meta, row.els.state, button('anomalous-tts-remove', '×', () => removeRow(row), t('ttsEditorRemove')));
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

    /** GPT and SoVITS hold one file each: a new one replaces the old. Other kinds skip duplicates. */
    function addRow(fields) {
        if (fields.kind === 'gpt' || fields.kind === 'sovits') {
            const old = rows.find(row => row.kind === fields.kind);
            if (old) removeRow(old);
        } else if (rows.some(row => row.kind === fields.kind && row.name.toLowerCase() === fields.name.toLowerCase())) {
            return null;
        }
        const row = { key: nextKey++, progress: 0, emotion: '', text: '', textEdited: false, uploadId: null,
            spec: null, error: '', info: null, controller: new AbortController(), ...fields };
        rows.push(row);
        sections[row.kind].list.append(buildRow(row));
        syncSections();
        return row;
    }

    /** Sort a batch by kind, keep the latest epoch of each weight kind, and say what was left out. */
    function addBatch(items, add) {
        const known = items.map(item => ({ ...item, kind: importKind(item.name) }));
        const { skip, kept } = pickWeights(known);
        const bad = [];
        known.forEach((item, index) => {
            if (skip.has(index)) return;
            if (!item.kind || !add(item)) bad.push(item.name);
        });
        const lines = kept.map(k => t('ttsImportKeptBest', { kind: t(`ttsKind_${k.kind}`), file: k.name, count: k.others }));
        if (bad.length) lines.push(t('ttsImportSkipped', { files: bad.join(', ') }));
        notes.textContent = lines.join(' ');
    }

    function addBrowserFiles(fileList) {
        addBatch(fileList.map(file => ({ name: file.name, file })), (item) => {
            const row = addRow({ name: item.name, kind: item.kind, size: item.file.size, file: item.file });
            if (row) uploads = uploads.then(() => upload(row));
            return row;
        });
    }

    function addPaths(paths) {
        addBatch(paths.map(path => ({ name: path.split('/').pop(), path })),
            (item) => addRow({ name: item.name, kind: item.kind, size: 0, path: item.path, spec: { path: item.path } }));
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
            if (!target && !nameEdited && suggested.name) { nameInput.value = suggested.name; syncSaveTo(); syncConflict(); }
            if (!referenceChosen) referenceKey = suggested.reference !== null ? ready[suggested.reference]?.key ?? null : null;
            syncReference();
            fillLanguages(suggested.language);
            problems.replaceChildren(...result.problems.map(text => el('div', 'anomalous-tts-import-problem', text)));
        } catch (e) {
            if (mine !== inspectToken || scope.signal.aborted) return;
            problems.replaceChildren(el('div', 'anomalous-tts-import-problem is-error', e.message || String(e)));
        }
    }

    // ---- mode: new character, or add to one ----
    const submit = button('anomalous-voice-modal-submit', '', async () => {
        const ready = readyRows();
        const pending = rows.filter(row => !row.spec && !row.error).length;
        const problem = importProblem({
            target, character: nameInput.value, uploading: pending, conflict,
            rows: ready.map(row => ({ kind: row.kind, name: row.name, emotion: row.emotion, supported: row.info?.supported, version: row.info?.version })),
        });
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

    function syncMode() {
        title.textContent = target ? t('ttsImportAddTitle', { name: target }) : t('ttsImportTitle');
        subtitle.textContent = t(target ? 'ttsImportAddSubtitle' : 'ttsImportSubtitle');
        submit.textContent = t(target ? 'ttsImportAddSubmit' : 'ttsImportSubmit');
        nameBlock.hidden = Boolean(target);
        syncConflict();
    }

    /** The name belongs to an existing character: add these files to it instead. */
    function switchToAdd(name) {
        target = name;
        referenceKey = null; // do not replace its main voice unless the user picks one again
        referenceChosen = true;
        syncReference();
        syncMode();
    }

    // Files can be dropped anywhere on the form; each goes to its section by kind.
    modal.addEventListener('dragover', (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        modal.classList.add('is-dragover');
    });
    modal.addEventListener('dragleave', (e) => { if (!modal.contains(e.relatedTarget)) modal.classList.remove('is-dragover'); });
    modal.addEventListener('drop', (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        modal.classList.remove('is-dragover');
        addBrowserFiles([...e.dataTransfer.files]);
    });

    const footer = el('div', 'anomalous-voice-modal-footer');
    footer.append(button('anomalous-voice-modal-cancel', t('dialogCancel'), close), submit);
    const body = el('div', 'anomalous-tts-editor-body');
    body.append(nameBlock, addBar, notes, sections.gpt.box, sections.sovits.box, sections.audio.box, sections.text.box,
        languageField, problems);
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    syncSaveTo();
    syncMode();
    syncSections();
    addBrowserFiles(files);
    (target ? submit : nameInput).focus();
}
