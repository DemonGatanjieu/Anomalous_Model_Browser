import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { loadEngine, loadGptSovitsStatus } from './audio_engines.js';
import {
    buildImportBody, commitImport, discardUploads, importKind, inspectImport, nameConflict, pickWeights, scanFolder, uploadFile,
} from './tts_setup_api.js';
import { draftState, groupFiles, groupKey } from './tts_import_groups.js';
import { ROW_DRAG_TYPE, TRAY, renderDraftPane, showSource, syncReference, updateRow } from './ui_tts_import_draft.js';
import { PICKER_OVERLAY_CLASS, pickServerPath } from './ui_tts_path_picker.js';
import { readDroppedFiles } from './ui_tts_file_drop.js';

/**
 * The GPT-SoVITS import workbench: one or many characters at once, or files added
 * to an existing one (`target`), through the Anomalous_TTS node. Files come from a
 * drop (folders too), the browser's file or folder dialog (uploaded in chunks) or
 * the node's folder picker (sent as paths). The node copies everything; the
 * originals are never touched.
 *
 * Left: the characters being built (drafts) and the unassigned tray. Right: the
 * selected one (ui_tts_import_draft.js). Files are sorted into drafts by
 * tts_import_groups.js; each draft is inspected and imported on its own, so one
 * failure leaves the others alone. Every file is one row object, owned by exactly
 * one draft's `rows`; its elements are built once and move with it.
 */

let activeScope = null;
const ACCEPT = { gpt: '.ckpt', sovits: '.pth', audio: '.wav,.flac,.ogg,.mp3', text: '.txt,.lab,.list' };
const ACCEPT_ALL = Object.values(ACCEPT).join(',');

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

/**
 * Open the workbench. `files`: `{ file, dir }` items (or plain Files); `target`: add
 * them to this character. `onDone(character)` runs once after imports finished.
 */
export async function openTtsImport({ files = [], target = null, onDone } = {}) {
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
    // New characters always go to the storage place (changed in GPT-SoVITS settings).
    const home = status.libraries.find(lib => lib.storage);
    if (!target && !home?.writable) {
        await anomalousAlert(t('ttsImportNoLibrary', { path: status.storage }));
        return;
    }

    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const drafts = [];
    const tray = { id: TRAY, rows: [] };
    let selected = null;
    let pane = null; // { refresh } of the drawn draft
    let nextDraft = 0;
    let nextRow = 0;
    let importing = false;
    let player = null;
    let uploads = Promise.resolve();
    let pickFor = null; // the draft the browser file dialog adds to, or null (sort by name)

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-import');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => { if (!importing) scope.dispose(); };
    const allRows = () => [...drafts.flatMap(draft => draft.rows), ...tray.rows];
    scope.onDispose(() => {
        for (const draft of drafts) clearTimeout(draft.inspectTimer);
        player?.pause();
        const rows = allRows();
        for (const row of rows) {
            row.controller.abort();
            if (row.url) URL.revokeObjectURL(row.url);
        }
        discardUploads(rows.filter(row => !row.committed).map(row => row.uploadId).filter(Boolean));
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    // No close on a backdrop click: a stray click would throw away the files and uploads.
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector(`.anomalous-dialog-overlay, .${PICKER_OVERLAY_CLASS}`)) return;
        e.stopPropagation();
        close();
    }, true);

    // ---- drafts and rows ----
    function newDraft({ key, name, target: into = null }) {
        const draft = {
            id: `d${nextDraft++}`, key, name, target: into, nameEdited: false, rows: [], referenceKey: null,
            referenceChosen: Boolean(into), // adding files never replaces the main voice unless asked
            language: '', detectedLanguage: null, problems: [], inspectTimer: null, inspectToken: 0,
            importing: false, done: false, failed: '',
        };
        drafts.push(draft);
        return draft;
    }
    const placeOf = id => (id === TRAY ? tray : drafts.find(draft => draft.id === id));
    const ownerOf = row => [...drafts, tray].find(place => place.rows.includes(row));
    const openDrafts = () => drafts.filter(draft => !draft.done);

    const rowView = row => ({ kind: row.kind, name: row.name, emotion: row.emotion, error: row.error, uploaded: Boolean(row.spec),
        progress: row.progress, existing: row.info?.existing ?? null, supported: row.info?.supported, version: row.info?.version });

    function viewOf(draft) {
        const name = draft.name.trim();
        const conflict = draft.target ? null : nameConflict(name, existing);
        const duplicate = !draft.target && Boolean(name) && openDrafts().some(other => other !== draft && !other.target
            && other.name.trim().toLowerCase() === name.toLowerCase());
        const state = draftState({ target: draft.target, name, rows: draft.rows.map(rowView), conflict, duplicate,
            done: draft.done, failed: draft.failed, importing: draft.importing });
        return { ...state, conflict, problems: draft.problems, saveTo: `${status.storage}/${name || '…'}` };
    }

    /** Something about a draft changed: forget an earlier failure and look at its files again. */
    function touch(draft) {
        if (!draft || draft === tray) return;
        draft.failed = '';
        clearTimeout(draft.inspectTimer);
        draft.inspectTimer = setTimeout(() => inspect(draft), 250);
    }

    function removeRow(row, { redraw = true } = {}) {
        const place = ownerOf(row);
        row.controller.abort();
        if (row.uploadId) discardUploads([row.uploadId]);
        if (row.url) URL.revokeObjectURL(row.url);
        place.rows.splice(place.rows.indexOf(row), 1);
        row.els?.root.remove();
        if (place.referenceKey === row.key) place.referenceKey = null;
        touch(place);
        if (redraw) drawAll();
    }

    /** GPT and SoVITS hold one file per draft: a newer one replaces the old. Other kinds skip duplicates. */
    function placeRow(place, row) {
        if (place !== tray && (row.kind === 'gpt' || row.kind === 'sovits')) {
            const old = place.rows.find(other => other.kind === row.kind && other !== row);
            if (old) removeRow(old, { redraw: false });
        } else if (place.rows.some(other => other !== row && other.kind === row.kind && other.name.toLowerCase() === row.name.toLowerCase())) {
            return false;
        }
        place.rows.push(row);
        return true;
    }

    function moveRow(row, id) {
        const from = ownerOf(row);
        const to = placeOf(id);
        if (!to || to === from) return;
        from.rows.splice(from.rows.indexOf(row), 1);
        if (from.referenceKey === row.key) from.referenceKey = null;
        if (!placeRow(to, row)) removeRow(row, { redraw: false });
        touch(from);
        touch(to);
        if (from === tray && !tray.rows.length && to !== tray) selected = to; // the tray is done: follow the file
        drawAll();
    }

    /**
     * Add files: `items` are `{ name, dir, file }` or `{ name, dir, path, size }`. Into
     * `into` when given, else sorted into drafts (new ones for new weight names).
     */
    function addItems(items, into = null) {
        const known = items.map(item => ({ ...item, kind: importKind(item.name) }));
        const bad = known.filter(item => !item.kind).map(item => item.name);
        const usable = known.filter(item => item.kind);
        let assign;
        if (into) {
            assign = usable.map(() => into);
        } else {
            const open = openDrafts();
            const grouped = groupFiles(usable, open.map(draft => ({ key: draft.key, target: draft.target })));
            for (const add of grouped.added) newDraft(add);
            assign = grouped.assign.map(key => (key === null ? tray : openDrafts().find(draft => draft.key === key)));
        }
        const notes = [];
        const touched = new Set();
        for (const place of new Set(assign)) {
            const mine = usable.filter((_, i) => assign[i] === place);
            const { skip, kept } = pickWeights(mine);
            notes.push(...kept.map(k => t('ttsImportKeptBest', { kind: t(`ttsKind_${k.kind}`), file: k.name, count: k.others })));
            mine.forEach((item, i) => {
                if (skip.has(i)) return;
                const row = {
                    key: nextRow++, kind: item.kind, name: item.name, dir: item.dir || '', path: item.path || '', file: item.file || null,
                    size: item.file?.size ?? item.size ?? 0, spec: item.path ? { path: item.path } : null, uploadId: null, progress: 0,
                    error: '', info: null, emotion: '', text: '', textEdited: false, committed: false, controller: new AbortController(),
                };
                if (!placeRow(place, row)) { bad.push(item.name); return; }
                touched.add(place);
                if (row.file) uploads = uploads.then(() => upload(row));
            });
        }
        if (bad.length) notes.push(t('ttsImportSkipped', { files: bad.join(', ') }));
        noteLine.textContent = notes.join(' ');
        touched.forEach(touch);
        if (!selected || selected.done || !touched.has(selected)) {
            selected = [...touched].find(place => place !== tray) || (touched.has(tray) ? tray : selected);
        }
        drawAll();
    }

    async function upload(row) {
        if (row.controller.signal.aborted) return;
        try {
            await uploadFile(row.file, {
                signal: row.controller.signal,
                onStart: (id) => { row.uploadId = id; },
                onProgress: (fraction) => { row.progress = fraction; updateRow(row); },
            });
            row.spec = { upload: row.uploadId };
        } catch (e) {
            if (row.controller.signal.aborted) return;
            row.error = e.message || String(e);
        }
        updateRow(row);
        touch(ownerOf(row));
        drawList();
    }

    async function inspect(draft) {
        if (draft.done || scope.signal.aborted) return;
        const ready = draft.rows.filter(row => row.spec && !row.error);
        if (draft.rows.some(row => !row.spec && !row.error)) return; // the last upload runs this again
        const mine = ++draft.inspectToken;
        if (!ready.length) {
            draft.problems = [];
            drawList();
            if (draft === selected) pane?.refresh(viewOf(draft));
            return;
        }
        try {
            const result = await inspectImport(ready.map(row => row.spec), scope.signal, draft.target);
            if (mine !== draft.inspectToken || scope.signal.aborted) return;
            ready.forEach((row, i) => {
                row.info = result.files[i];
                if (row.info.size) row.size = row.info.size;
                updateRow(row);
                if (row.els?.text && !row.textEdited) {
                    row.text = row.info.text || '';
                    row.els.text.value = row.text;
                    showSource(row, row.info.text_source || 'none');
                } else if (!row.textEdited) {
                    row.text = row.info.text || '';
                }
            });
            const { suggested } = result;
            if (!draft.target && !draft.nameEdited && !draft.name && suggested.name) draft.name = suggested.name;
            if (!draft.referenceChosen) draft.referenceKey = suggested.reference !== null ? ready[suggested.reference]?.key ?? null : null;
            const languageChanged = draft.detectedLanguage !== suggested.language;
            draft.detectedLanguage = suggested.language;
            draft.problems = result.problems;
            syncReference(draft);
            if (draft === selected && languageChanged) drawPane();
            else if (draft === selected) pane?.refresh(viewOf(draft));
        } catch (e) {
            if (mine !== draft.inspectToken || scope.signal.aborted) return;
            draft.problems = [e.message || String(e)];
            if (draft === selected) pane?.refresh(viewOf(draft));
        }
        drawList();
    }

    // ---- picking files ----
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.onchange = () => {
        addItems([...fileInput.files].map(file => ({ name: file.name, dir: '', file })), pickFor);
        fileInput.value = '';
    };
    const folderInput = el('input');
    folderInput.type = 'file';
    folderInput.webkitdirectory = true;
    folderInput.hidden = true;
    folderInput.onchange = () => {
        addItems([...folderInput.files].map(file => ({ name: file.name, dir: file.webkitRelativePath.split('/').slice(0, -1).join('/'), file })));
        folderInput.value = '';
    };
    const chooseBrowser = (kinds, into) => {
        pickFor = into;
        fileInput.accept = kinds ? kinds.map(kind => ACCEPT[kind]).join(',') : ACCEPT_ALL;
        fileInput.click();
    };
    const chooseLocal = async (kinds, into) => {
        const paths = await pickServerPath({ mode: 'files', title: t('ttsImportPickLocal'), hint: t('ttsImportPickLocalHint'), kinds });
        if (paths && !scope.signal.aborted) addItems(paths.map(path => ({ name: path.split('/').pop(), dir: '', path })), into);
    };
    const chooseLocalFolder = async () => {
        const path = await pickServerPath({ mode: 'folder', title: t('ttsBatchPickLocalFolder'), hint: t('ttsBatchPickLocalFolderHint') });
        if (!path || scope.signal.aborted) return;
        try {
            const result = await scanFolder(path, scope.signal);
            addItems(result.files.map(file => ({ name: file.name, dir: file.dir, path: file.path, size: file.size })));
            if (result.truncated) noteLine.textContent += ` ${t('ttsBatchScanTruncated', { count: result.files.length })}`;
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('ttsSetupFailed', { error: e.message || String(e) }));
        }
    };

    // ---- layout ----
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(el('div', 'anomalous-voice-modal-title', t(target ? 'ttsImportAddTitle' : 'ttsImportTitle', { name: target })),
        el('div', 'anomalous-voice-modal-subtitle', t(target ? 'ttsImportAddSubtitle' : 'ttsBatchSubtitle')));
    const closeBtn = button('anomalous-voice-modal-close', '×', close, t('close'));
    header.append(heading, closeBtn);

    const addBar = el('div', 'anomalous-tts-import-addbar');
    const addButtons = el('div', 'anomalous-tts-setup-actions');
    addButtons.append(button('anomalous-tts-add', t('ttsImportPickFiles'), () => chooseBrowser(null, null)),
        button('anomalous-tts-add', t('ttsBatchPickFolder'), () => folderInput.click()),
        button('anomalous-tts-add', t('ttsImportPickLocal'), () => chooseLocal(null, null)),
        button('anomalous-tts-add', t('ttsBatchPickLocalFolder'), chooseLocalFolder));
    addBar.append(el('span', 'anomalous-tts-hint', t('ttsBatchDropHint')), addButtons, fileInput, folderInput);
    const noteLine = el('div', 'anomalous-tts-hint');

    const list = el('div', 'anomalous-tts-batch-drafts');
    const paneBox = el('div', 'anomalous-tts-batch-detail');
    const main = el('div', 'anomalous-tts-batch-main');
    const side = el('div', 'anomalous-tts-batch-side');
    const newBtn = button('anomalous-tts-link', t('ttsBatchNewDraft'), () => {
        selected = newDraft({ key: `#new${nextDraft}`, name: '' });
        drawAll();
    });
    side.append(list, newBtn);
    main.append(side, paneBox);

    const summary = el('span', 'anomalous-tts-batch-summary');
    const submit = button('anomalous-voice-modal-submit', '', () => importReady());
    const footer = el('div', 'anomalous-voice-modal-footer');
    footer.append(summary, button('anomalous-voice-modal-cancel', t('dialogCancel'), close), submit);

    // ---- drawing ----
    const countsOf = rows => t('ttsBatchCounts', {
        gpt: rows.some(row => row.kind === 'gpt') ? '✓' : '—',
        sovits: rows.some(row => row.kind === 'sovits') ? '✓' : '—',
        audio: rows.filter(row => row.kind === 'audio').length,
    });

    /** A list entry takes rows dragged from the right side and OS files dropped on it. */
    function bindListDrop(item, place) {
        item.addEventListener('dragover', (e) => {
            const types = [...(e.dataTransfer?.types || [])];
            if (!types.includes(ROW_DRAG_TYPE) && !types.includes('Files')) return;
            e.preventDefault();
            item.classList.add('is-drop-target');
        });
        item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'));
        item.addEventListener('drop', (e) => {
            item.classList.remove('is-drop-target');
            const key = e.dataTransfer.getData(ROW_DRAG_TYPE);
            if (key) {
                e.preventDefault();
                e.stopPropagation();
                const row = allRows().find(r => String(r.key) === key);
                if (row) moveRow(row, place.id);
                return;
            }
            if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            modal.classList.remove('is-dragover');
            readDroppedFiles(e.dataTransfer).then(files => {
                if (!scope.signal.aborted) addItems(files.map(({ file, dir }) => ({ name: file.name, dir, file })), place === tray ? null : place);
            });
        });
    }

    function drawList() {
        list.replaceChildren();
        let ready = 0;
        let needed = 0;
        for (const draft of drafts) {
            const view = viewOf(draft);
            if (view.tone === 'ready') ready++;
            if (view.tone === 'needed' || view.tone === 'error') needed++;
            const item = button(`anomalous-tts-batch-draft${draft === selected ? ' active' : ''}`, '', () => { selected = draft; drawAll(); });
            item.dataset.tone = view.tone;
            const label = draft.target ? t('ttsBatchAddTo', { name: draft.target }) : draft.name.trim() || t('ttsBatchUnnamed');
            const top = el('span', 'anomalous-tts-batch-draft-top');
            top.append(el('span', 'anomalous-tts-batch-dot'), el('span', 'anomalous-tts-batch-draft-name', label));
            const counts = draft.target ? t('ttsBatchNewFiles', { count: draft.rows.length }) : countsOf(draft.rows);
            item.append(top, el('span', 'anomalous-tts-batch-draft-meta', draft.done ? t('ttsBatchDone') : draft.importing ? t('ttsBatchImporting') : counts));
            item.title = view.problem ? t(view.problem[0], view.problem[1]) : label;
            if (!draft.done) bindListDrop(item, draft);
            list.append(item);
        }
        if (tray.rows.length) {
            const item = button(`anomalous-tts-batch-draft is-tray${selected === tray ? ' active' : ''}`, '', () => { selected = tray; drawAll(); });
            const top = el('span', 'anomalous-tts-batch-draft-top');
            top.append(el('span', 'anomalous-tts-batch-dot'), el('span', 'anomalous-tts-batch-draft-name', t('ttsBatchTray')));
            item.append(top, el('span', 'anomalous-tts-batch-draft-meta', t('ttsBatchTrayCount', { count: tray.rows.length })));
            bindListDrop(item, tray);
            list.append(item);
        }
        const parts = [t('ttsBatchSummary', { ready, needed })];
        if (tray.rows.length) parts.push(t('ttsBatchTraySummary', { count: tray.rows.length }));
        summary.textContent = parts.join(' · ');
        const single = drafts.length === 1 && drafts[0].target;
        submit.textContent = single ? t('ttsImportAddSubmit') : t('ttsBatchSubmit', { count: ready });
        submit.disabled = importing || !ready;
        closeBtn.disabled = importing;
    }

    const places = () => [...openDrafts().map(draft => ({
        id: draft.id, label: draft.target ? t('ttsBatchAddTo', { name: draft.target }) : draft.name.trim() || t('ttsBatchUnnamed'),
    })), { id: TRAY, label: t('ttsBatchTray') }];

    const ctx = {
        status,
        signal: scope.signal,
        places,
        play: (row) => {
            player?.pause();
            row.url = row.url || URL.createObjectURL(row.file);
            player = new Audio(row.url);
            player.play().catch(() => {});
        },
        pick: (draft, kinds, local) => (local ? chooseLocal(kinds, draft) : chooseBrowser(kinds, draft)),
        onName: (draft, value) => {
            draft.name = value;
            draft.nameEdited = true;
            draft.key = groupKey(value) || draft.key;
            draft.failed = '';
            pane?.refresh(viewOf(draft));
            drawList();
        },
        onSwitchToAdd: (draft) => {
            const conflict = nameConflict(draft.name, existing);
            if (conflict?.kind !== 'exact') return;
            draft.target = conflict.name;
            draft.name = conflict.name;
            draft.key = groupKey(conflict.name);
            draft.referenceKey = null; // do not replace its main voice unless the user picks one again
            draft.referenceChosen = true;
            touch(draft);
            drawAll();
        },
        onReference: (row) => {
            const draft = ownerOf(row);
            draft.referenceKey = draft.referenceKey === row.key ? null : row.key;
            draft.referenceChosen = true;
            syncReference(draft);
        },
        onEdited: (row) => {
            const draft = ownerOf(row);
            if (draft === tray) return;
            draft.failed = '';
            pane?.refresh(viewOf(draft));
            drawList();
        },
        onLanguage: (draft, value) => { draft.language = value; drawPane(); },
        onMoveRow: moveRow,
        onRemoveRow: (row) => removeRow(row),
    };

    function drawPane() {
        pane = null;
        if (!selected) {
            paneBox.replaceChildren(el('div', 'anomalous-tts-batch-empty', t('ttsBatchEmpty')));
        } else if (selected.done) {
            paneBox.replaceChildren(el('div', 'anomalous-tts-batch-empty', t('ttsBatchDoneNote', { name: selected.name })));
        } else {
            pane = renderDraftPane(paneBox, selected, selected === tray ? { conflict: null, problem: null, problems: [], saveTo: '' } : viewOf(selected), ctx);
        }
    }

    function drawAll() {
        if (selected && selected !== tray && !drafts.includes(selected)) selected = null;
        if (selected === tray && !tray.rows.length) selected = openDrafts()[0] || null;
        drawList();
        drawPane();
    }

    // ---- importing, one draft after another ----
    async function importReady() {
        const queue = drafts.filter(draft => viewOf(draft).tone === 'ready');
        if (!queue.length) return;
        importing = true;
        let last = null;
        for (const draft of queue) {
            draft.importing = true;
            drawList();
            const ready = draft.rows.filter(row => row.spec && !row.error);
            const index = ready.findIndex(row => row.key === draft.referenceKey);
            const body = buildImportBody({
                target: draft.target, library: status.storage, character: draft.name.trim(), language: draft.language,
                referenceIndex: index >= 0 ? index : null,
                rows: ready.map(row => ({ spec: row.spec, kind: row.kind, emotion: row.emotion, text: row.text })),
            });
            try {
                last = await commitImport(body);
                draft.done = true;
                draft.name = last.name;
                for (const row of draft.rows) row.committed = true;
                existing.push(last.name);
            } catch (e) {
                draft.failed = e.message || String(e);
            }
            draft.importing = false;
        }
        importing = false;
        if (scope.signal.aborted) return;
        if (last) onDone?.(last);
        if (!openDrafts().length && !tray.rows.length) {
            scope.dispose();
            return;
        }
        selected = drafts.find(draft => draft.failed) || openDrafts()[0] || tray;
        drawAll();
    }

    // Files can be dropped anywhere on the workbench; they are sorted by name and folder.
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
        readDroppedFiles(e.dataTransfer).then(dropped => {
            if (!scope.signal.aborted) addItems(dropped.map(({ file, dir }) => ({ name: file.name, dir, file })));
        });
    });

    modal.append(header, addBar, noteLine, main, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (target) selected = newDraft({ key: groupKey(target), name: target, target });
    const initial = files.map(item => (item instanceof File ? { file: item, dir: '' } : item));
    if (initial.length) addItems(initial.map(({ file, dir }) => ({ name: file.name, dir, file })));
    else drawAll();
}
