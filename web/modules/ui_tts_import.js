import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { loadEngine, loadGptSovitsStatus } from './audio_engines.js';
import {
    buildImportBody, commitImport, discardUploads, importKind, inspectImport, nameConflict, pickWeights, uploadFile,
} from './tts_setup_api.js';
import { draftChecklist, draftState, groupFiles, groupKey, leftOut } from './tts_import_groups.js';
import { TRAY, renderDraftCard, renderTrayCard, showSource, syncReference, updateRow } from './ui_tts_import_draft.js';
import { PICKER_OVERLAY_CLASS } from './ui_tts_path_picker.js';
import { readDroppedFiles } from './ui_tts_file_drop.js';
import { createFileSources } from './ui_tts_import_sources.js';
import { closeSpotlightTour, isSpotlightTourActive, startSpotlightTour } from './ui_spotlight_tour.js';
import { TOURS, markTourSeen, renderBatchHero, renderChooseScreen, seenTours } from './ui_tts_import_screens.js';

/**
 * The GPT-SoVITS import window, through the Anomalous_TTS node. It first asks what
 * the user has: one character (`single`: one card, its checklist leads step by
 * step), many characters or a package (`batch`: a drop area, then files sorted
 * into one card per character, plus a card for files that match no character),
 * or files for an existing character (`add`, also opened straight from a
 * character's "Add files"). A spotlight tour explains each screen the first time.
 *
 * Files come from a drop (folders too), the browser's file or folder dialog
 * (uploaded in chunks, a few files at a time) or the node's folder picker (sent as
 * paths); see ui_tts_import_sources.js. The node copies what is imported; the
 * originals are never touched. Clips outside 3–10 s are left out. Each draft is inspected and
 * imported on its own, so one failure leaves the others alone. Every file is one
 * row object, owned by exactly one draft's `rows`; its elements are built once
 * (ui_tts_import_draft.js) and move with it.
 */

let activeScope = null;
const UPLOADS_AT_ONCE = 3;
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
 * Open the import window. `files`: `{ file, dir }` items (or plain Files); `target`:
 * add them to this character. `onDone(character)` runs once after imports finished.
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
    const cards = new Map(); // draft -> { refresh } of its drawn card
    // Dropped files skip the question: several files are sorted like a package.
    let mode = target ? 'add' : files.length ? 'batch' : null;
    let nextDraft = 0;
    let nextRow = 0;
    let importing = false;
    let player = null;
    const uploadQueue = [];
    let uploading = 0;
    let refreshTimer = 0;

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-import');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => { if (!importing) scope.dispose(); };
    const allRows = () => [...drafts.flatMap(draft => draft.rows), ...tray.rows];
    scope.onDispose(() => {
        closeSpotlightTour();
        for (const draft of drafts) clearTimeout(draft.inspectTimer);
        clearTimeout(refreshTimer);
        uploadQueue.length = 0;
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
        if (e.key !== 'Escape' || isSpotlightTourActive() || document.querySelector(`.anomalous-dialog-overlay, .${PICKER_OVERLAY_CLASS}`)) return;
        e.stopPropagation();
        if (menu.classList.contains('is-open')) { menu.classList.remove('is-open'); return; }
        close();
    }, true);

    // ---- drafts and rows ----
    function newDraft({ key, name, target: into = null }) {
        const draft = {
            id: `d${nextDraft++}`, key, name, target: into, nameEdited: false, rows: [], referenceKey: null,
            referenceChosen: Boolean(into), // adding files never replaces the main voice unless asked
            language: '', detectedLanguage: null, problems: [], inspectTimer: null, inspectToken: 0,
            expanded: false, importing: false, done: false, failed: '',
        };
        drafts.push(draft);
        return draft;
    }
    const placeOf = id => (id === TRAY ? tray : drafts.find(draft => draft.id === id));
    const ownerOf = row => [...drafts, tray].find(place => place.rows.includes(row));
    const openDrafts = () => drafts.filter(draft => !draft.done);
    const solo = () => mode !== 'batch' && drafts.length === 1;

    const rowView = row => ({ kind: row.kind, name: row.name, emotion: row.emotion, error: row.error, uploaded: Boolean(row.spec),
        progress: row.progress, existing: row.info?.existing ?? null, supported: row.info?.supported, version: row.info?.version,
        seconds: row.info?.seconds });
    /** Keys of the draft's rows the import leaves out (clips outside 3–10 s and their line files). */
    const skippedKeys = (rows) => {
        const out = leftOut(rows.map(rowView));
        return new Set(rows.filter((_, i) => out.has(i)).map(row => row.key));
    };

    function viewOf(draft) {
        const name = draft.name.trim();
        const conflict = draft.target ? null : nameConflict(name, existing);
        const duplicate = !draft.target && Boolean(name) && openDrafts().some(other => other !== draft && !other.target
            && other.name.trim().toLowerCase() === name.toLowerCase());
        const rows = draft.rows.map(rowView);
        const main = draft.rows.find(row => row.key === draft.referenceKey)?.name || null;
        const state = draftState({ target: draft.target, name, rows, main, conflict, duplicate,
            done: draft.done, failed: draft.failed, importing: draft.importing });
        const checklist = draftChecklist({ target: draft.target, name, rows, main, conflict, duplicate });
        return { ...state, conflict, problems: draft.problems, checklist, skipped: skippedKeys(draft.rows) };
    }

    /** One card open at a time; a lone character is always open. */
    function expand(draft) {
        for (const other of drafts) other.expanded = other === draft;
    }

    /** Something about a draft changed: forget an earlier failure and look at its files again. */
    function touch(draft) {
        if (!draft || draft === tray) return;
        draft.failed = '';
        clearTimeout(draft.inspectTimer);
        draft.inspectTimer = setTimeout(() => inspect(draft), 250);
    }

    function forgetRow(row) {
        row.controller.abort();
        if (row.uploadId) discardUploads([row.uploadId]);
        if (row.url) URL.revokeObjectURL(row.url);
        row.els?.root.remove();
    }

    function removeRow(row, { redraw = true } = {}) {
        const place = ownerOf(row);
        forgetRow(row);
        place.rows.splice(place.rows.indexOf(row), 1);
        if (place.referenceKey === row.key) place.referenceKey = null;
        touch(place);
        if (redraw) draw();
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
        if (!placeRow(to, row)) forgetRow(row);
        touch(from);
        touch(to);
        if (to !== tray && !to.expanded && from === tray && !tray.rows.length) expand(to);
        draw();
    }

    /** A whole folder of unassigned files at once. */
    function moveRows(rows, id) {
        const to = placeOf(id);
        if (!to || to === tray) return;
        for (const row of rows) {
            tray.rows.splice(tray.rows.indexOf(row), 1);
            if (!placeRow(to, row)) forgetRow(row);
        }
        touch(to);
        if (!openDrafts().some(draft => draft.expanded)) expand(to);
        draw();
    }

    /**
     * Add files: `items` are `{ name, dir, file }` or `{ name, dir, path, size }`. Into
     * `into` when given (or the only card outside batch mode), else sorted into drafts.
     */
    function addItems(items, into = null) {
        const known = items.map(item => ({ ...item, kind: importKind(item.name) }));
        const bad = known.filter(item => !item.kind).map(item => item.name);
        const usable = known.filter(item => item.kind);
        const place = into || (solo() ? drafts[0] : null);
        let assign;
        if (place) {
            assign = usable.map(() => place);
        } else {
            const grouped = groupFiles(usable, openDrafts().map(draft => ({ key: draft.key, target: draft.target })));
            for (const add of grouped.added) newDraft(add);
            assign = grouped.assign.map(key => (key === null ? tray : openDrafts().find(draft => draft.key === key)));
        }
        const notes = [];
        const keptBest = [];
        const touched = new Set();
        for (const owner of new Set(assign)) {
            const mine = usable.filter((_, i) => assign[i] === owner);
            const { skip, kept } = pickWeights(mine);
            keptBest.push(...kept);
            mine.forEach((item, i) => {
                if (skip.has(i)) return;
                const row = {
                    key: nextRow++, kind: item.kind, name: item.name, dir: item.dir || '', path: item.path || '', file: item.file || null,
                    size: item.file?.size ?? item.size ?? 0, spec: item.path ? { path: item.path } : null, uploadId: null, progress: 0,
                    error: '', info: null, emotion: '', text: '', textEdited: false, committed: false, controller: new AbortController(),
                };
                if (!placeRow(owner, row)) { bad.push(item.name); return; }
                touched.add(owner);
                if (row.file) queueUpload(row);
            });
        }
        if (keptBest.length > 2) {
            notes.push(t('ttsImportKeptBestMany', { count: keptBest.reduce((sum, k) => sum + k.others, 0) }));
        } else {
            notes.push(...keptBest.map(k => t('ttsImportKeptBest', { kind: t(`ttsKind_${k.kind}`), file: k.name, count: k.others })));
        }
        if (bad.length) notes.push(t('ttsImportSkipped', { files: bad.join(', ') }));
        noteLine.textContent = notes.join(' ');
        touched.forEach(touch);
        const first = [...touched].find(owner => owner !== tray);
        if (first && !openDrafts().some(draft => draft.expanded)) expand(first);
        draw();
    }

    function queueUpload(row) {
        uploadQueue.push(row);
        pumpUploads();
    }

    function pumpUploads() {
        while (uploading < UPLOADS_AT_ONCE && uploadQueue.length) {
            const row = uploadQueue.shift();
            if (row.controller.signal.aborted) continue;
            uploading++;
            upload(row).finally(() => { uploading--; pumpUploads(); });
        }
    }

    /** Many uploads finish close together: repaint once for them. */
    function refreshSoon() {
        if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = 0; if (!scope.signal.aborted) refresh(); }, 100);
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
        refreshSoon();
    }

    async function inspect(draft) {
        if (draft.done || scope.signal.aborted) return;
        const ready = draft.rows.filter(row => row.spec && !row.error);
        if (draft.rows.some(row => !row.spec && !row.error)) return; // the last upload runs this again
        const mine = ++draft.inspectToken;
        if (!ready.length) {
            draft.problems = [];
            refresh();
            return;
        }
        try {
            const result = await inspectImport(ready.map(row => row.spec), scope.signal, draft.target);
            if (mine !== draft.inspectToken || scope.signal.aborted) return;
            const skippedBefore = skippedKeys(draft.rows).size;
            ready.forEach((row, i) => {
                row.info = result.files[i];
                if (row.info.size) row.size = row.info.size;
                updateRow(row);
                if (row.textEdited) return;
                row.text = row.info.text || '';
                if (row.els?.text) {
                    row.els.text.value = row.text;
                    showSource(row, row.info.text_source || 'none');
                }
            });
            const { suggested } = result;
            const renamed = !draft.target && !draft.nameEdited && !draft.name && Boolean(suggested.name);
            if (renamed) draft.name = suggested.name;
            if (!draft.referenceChosen) draft.referenceKey = suggested.reference !== null ? ready[suggested.reference]?.key ?? null : null;
            const languageChanged = draft.detectedLanguage !== suggested.language;
            draft.detectedLanguage = suggested.language;
            draft.problems = result.problems;
            syncReference(draft);
            const regrouped = skippedKeys(draft.rows).size !== skippedBefore && (draft.expanded || solo());
            if (renamed || regrouped || (languageChanged && (draft.expanded || solo()))) { draw(); return; }
        } catch (e) {
            if (mine !== draft.inspectToken || scope.signal.aborted) return;
            draft.problems = [e.message || String(e)];
        }
        refresh();
    }

    // ---- picking files (ui_tts_import_sources.js) ----
    const sources = createFileSources({
        signal: scope.signal,
        add: (items, into) => addItems(items, into),
        note: (text) => { noteLine.textContent = `${noteLine.textContent} ${text}`.trim(); },
    });
    const { chooseFiles, chooseLocalFiles, chooseLocalFolder } = sources;

    // ---- layout: header, steps, content, footer ----
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(el('div', 'anomalous-voice-modal-title', target ? t('ttsImportAddTitle', { name: target }) : t('ttsImportTitle')));
    const helpBtn = button('anomalous-tts-help', '?', () => runTour(currentTour(), true), t('ttsTourReplay'));
    const closeBtn = button('anomalous-voice-modal-close', '×', close, t('close'));
    const headerButtons = el('div', 'anomalous-tts-header-buttons');
    headerButtons.append(helpBtn, closeBtn);
    header.append(heading, headerButtons);

    const steps = el('ol', 'anomalous-tts-steps');
    const stepItems = ['ttsStepChoose', 'ttsStepFiles', 'ttsStepImport'].map((key, i) => {
        const item = el('li', 'anomalous-tts-step');
        item.append(el('span', 'anomalous-tts-step-no', String(i + 1)), el('span', 'anomalous-tts-step-label', t(key)));
        steps.append(item);
        return item;
    });

    // Step 1: what do you have?
    const choose = renderChooseScreen(existing, {
        single: () => { mode = 'single'; expand(newDraft({ key: '#solo', name: '' })); draw(); },
        batch: () => { mode = 'batch'; draw(); },
        character: (name) => { mode = 'add'; expand(newDraft({ key: groupKey(name), name, target: name })); draw(); },
    });

    // "Add more" is one button with a small menu, so the list stays the main thing.
    const menu = el('div', 'anomalous-tts-menu');
    const menuItem = (label, hint, onClick) => {
        const item = button('anomalous-tts-menu-item', '', () => { menu.classList.remove('is-open'); onClick(); });
        item.append(el('span', 'anomalous-tts-menu-label', label), el('span', 'anomalous-tts-menu-hint', hint));
        return item;
    };
    menu.append(menuItem(t('ttsImportPickFiles'), t('ttsMenuUploadHint'), () => chooseFiles()),
        menuItem(t('ttsBatchPickFolder'), t('ttsMenuUploadHint'), sources.chooseFolder),
        menuItem(t('ttsMenuLocalFiles'), t('ttsMenuLocalHint'), () => chooseLocalFiles()),
        menuItem(t('ttsBatchPickLocalFolder'), t('ttsMenuLocalHint'), chooseLocalFolder));
    const addMore = button('anomalous-tts-ghost', t('ttsAddMore'), () => menu.classList.toggle('is-open'));
    const menuWrap = el('div', 'anomalous-tts-menu-wrap');
    menuWrap.append(addMore, menu);
    scope.listen(document, 'mousedown', (e) => { if (!menuWrap.contains(e.target)) menu.classList.remove('is-open'); });
    const newBtn = button('anomalous-tts-ghost', t('ttsBatchNewDraft'), () => {
        expand(newDraft({ key: `#new${nextDraft}`, name: '' }));
        draw();
        cardsBox.querySelector('.anomalous-tts-card.is-open .anomalous-tts-card-name-input')?.focus();
    });
    const backBtn = button('anomalous-tts-link', t('ttsChooseAgain'), () => {
        drafts.length = 0;
        mode = null;
        draw();
    });
    const toolbar = el('div', 'anomalous-tts-toolbar');
    const found = el('span', 'anomalous-tts-toolbar-title');
    const dropHint = el('span', 'anomalous-tts-toolbar-hint', t('ttsSoloDropHint'));
    toolbar.append(found, dropHint, backBtn, menuWrap, newBtn);
    const noteLine = el('div', 'anomalous-tts-note');
    const cardsBox = el('div', 'anomalous-tts-cards');
    const content = el('div', 'anomalous-tts-content');

    // Batch mode before any file: the drop area says what to bring.
    const hero = renderBatchHero({
        folder: sources.chooseFolder, files: () => chooseFiles(), localFolder: chooseLocalFolder,
        localFiles: () => chooseLocalFiles(), back: () => { mode = null; draw(); },
    });

    const saveTo = el('span', 'anomalous-tts-footer-path');
    const summary = el('span', 'anomalous-tts-footer-summary');
    const submit = button('anomalous-voice-modal-submit', '', () => importReady());
    const footerInfo = el('div', 'anomalous-tts-footer-info');
    footerInfo.append(summary, saveTo);
    const footer = el('div', 'anomalous-voice-modal-footer anomalous-tts-footer');
    footer.append(footerInfo, button('anomalous-voice-modal-cancel', t('dialogCancel'), close), submit);

    const places = () => [
        ...openDrafts().map(draft => ({ id: draft.id, label: draft.target || draft.name.trim() || t('ttsBatchUnnamed') })),
        ...(tray.rows.length ? [{ id: TRAY, label: t('ttsBatchTray') }] : []),
    ];

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
        pick: (draft, kinds, local) => (local ? chooseLocalFiles(kinds, draft) : chooseFiles(kinds, draft)),
        onToggle: (draft) => {
            if (draft.done) return;
            if (draft.expanded && openDrafts().length > 1) draft.expanded = false;
            else expand(draft);
            draw();
        },
        onName: (draft, value) => {
            draft.name = value;
            draft.nameEdited = true;
            draft.key = groupKey(value) || draft.key;
            draft.failed = '';
            refreshSoon();
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
            draw();
        },
        onReference: (row) => {
            const draft = ownerOf(row);
            draft.referenceKey = draft.referenceKey === row.key ? null : row.key;
            draft.referenceChosen = true;
            syncReference(draft);
            refresh();
        },
        onEdited: (row) => {
            const draft = ownerOf(row);
            if (draft === tray) return;
            draft.failed = '';
            refresh();
        },
        onLanguage: (draft, value) => { draft.language = value; draw(); },
        onMoveRow: moveRow,
        onMoveRows: moveRows,
        onShowAll: (draft) => { draft.showAll = true; draw(); },
        onRemoveRow: (row) => removeRow(row),
        onRemoveDraft: async (draft) => {
            if (draft.rows.length && !await anomalousConfirm(t('ttsCardRemoveConfirm', { name: draft.target || draft.name.trim() || t('ttsBatchUnnamed'), count: draft.rows.length }))) return;
            if (scope.signal.aborted) return;
            clearTimeout(draft.inspectTimer);
            draft.rows.forEach(forgetRow);
            drafts.splice(drafts.indexOf(draft), 1);
            cards.delete(draft);
            draw();
        },
        onDropFiles: (draft, dataTransfer) => {
            modal.classList.remove('is-dragover');
            readDroppedFiles(dataTransfer).then(dropped => { if (!scope.signal.aborted) sources.takeFiles(dropped, draft); });
        },
    };

    // ---- tours ----
    const currentTour = () => (mode === null ? 'choose' : cardsBox.querySelector('.anomalous-tts-card.is-open .anomalous-tts-check') && content.contains(cardsBox) ? 'card' : null);
    function runTour(id, force = false) {
        if (!id || scope.signal.aborted || isSpotlightTourActive() || (!force && seenTours().has(id))) return;
        if (startSpotlightTour(null, { steps: TOURS[id] })) markTourSeen(id);
    }

    // ---- drawing ----
    /** Status only: the cards' pills, checklists and problems, the steps and the footer. */
    function refresh() {
        let ready = 0;
        let waiting = 0;
        for (const draft of drafts) {
            const view = viewOf(draft);
            cards.get(draft)?.refresh(view);
            if (view.tone === 'ready') ready++;
            else if (view.tone !== 'done') waiting++;
        }
        const at = importing || (ready && !waiting && !tray.rows.length) ? 2 : mode === null ? 0 : 1;
        stepItems.forEach((item, i) => {
            item.classList.toggle('is-current', i === at);
            item.classList.toggle('is-done', i < at);
        });
        const open = openDrafts().length;
        found.textContent = mode === 'add' && open === 1 ? t('ttsToolbarAdding', { name: drafts[0].target })
            : mode === 'single' ? t('ttsToolbarSingle') : t('ttsToolbarFound', { count: open });
        const parts = [];
        if (waiting && !solo()) parts.push(t('ttsFooterWaiting', { count: waiting }));
        if (tray.rows.length) parts.push(t('ttsFooterTray', { count: tray.rows.length }));
        summary.textContent = parts.join(' · ');
        summary.hidden = !parts.length;
        saveTo.textContent = t('ttsFooterSaveTo', { path: status.storage });
        saveTo.title = status.storage;
        submit.textContent = mode === 'add' && drafts.length === 1 ? t('ttsImportAddSubmit') : ready > 1 ? t('ttsBatchSubmit', { count: ready }) : t('ttsFooterImportOne');
        submit.disabled = importing || !ready;
        closeBtn.disabled = importing;
    }

    /** Structure changed: rebuild the screen (rows keep their elements), keep the scroll. */
    function draw() {
        const open = openDrafts();
        if (open.length === 1) open[0].expanded = true;
        const batchEmpty = mode === 'batch' && !allRows().length && !drafts.length;
        modal.classList.toggle('is-empty', mode === null || batchEmpty);
        if (mode === null) {
            content.replaceChildren(choose);
        } else if (batchEmpty) {
            content.replaceChildren(hero);
        } else {
            const top = content.scrollTop;
            cards.clear();
            cardsBox.replaceChildren();
            if (tray.rows.length) cardsBox.append(renderTrayCard(tray, ctx));
            for (const draft of drafts) {
                const card = renderDraftCard(draft, viewOf(draft), ctx, { solo: solo() });
                cards.set(draft, card);
                cardsBox.append(card.root);
            }
            const batch = mode === 'batch';
            menuWrap.hidden = !batch;
            newBtn.hidden = !batch;
            dropHint.hidden = batch;
            backBtn.hidden = Boolean(target) || allRows().length > 0;
            if (content.firstChild !== toolbar) content.replaceChildren(toolbar, noteLine, cardsBox);
            content.scrollTop = top;
        }
        refresh();
        setTimeout(() => runTour(currentTour()), 60); // after layout, so the spotlight finds its targets
    }

    // ---- importing, one character after another ----
    async function importReady() {
        const queue = drafts.filter(draft => viewOf(draft).tone === 'ready');
        if (!queue.length) return;
        importing = true;
        let last = null;
        for (const draft of queue) {
            draft.importing = true;
            refresh();
            const skipped = skippedKeys(draft.rows);
            const ready = draft.rows.filter(row => row.spec && !row.error && !skipped.has(row.key));
            const index = ready.findIndex(row => row.key === draft.referenceKey);
            const body = buildImportBody({
                target: draft.target, library: status.storage, character: draft.name.trim(), language: draft.language,
                referenceIndex: index >= 0 ? index : null,
                rows: ready.map(row => ({ spec: row.spec, kind: row.kind, emotion: row.emotion, text: row.text })),
            });
            try {
                last = await commitImport(body);
                draft.done = true;
                draft.expanded = false;
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
        const failed = drafts.find(draft => draft.failed);
        if (failed) expand(failed);
        draw();
    }

    // Files can be dropped anywhere on the window: on the question screen they are
    // sorted like a package, otherwise they go where the current mode puts them.
    const dropCover = el('div', 'anomalous-tts-drop-cover', t('ttsDropCover'));
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
            if (scope.signal.aborted) return;
            if (mode === null) mode = 'batch';
            sources.takeFiles(dropped);
        });
    });

    modal.append(header, steps, content, footer, dropCover, ...sources.inputs);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (target) newDraft({ key: groupKey(target), name: target, target });
    draw();
    if (files.length) sources.takeFiles(files.map(item => (item instanceof File ? { file: item, dir: '' } : item)));
}
