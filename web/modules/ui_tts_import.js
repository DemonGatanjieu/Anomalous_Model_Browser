import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { loadEngine, loadGptSovitsStatus } from './audio_engines.js';
import {
    buildImportBody, commitImport, discardUploads, importKind, inspectImport, nameConflict, pickWeights, scanFolder, uploadFile,
} from './tts_setup_api.js';
import { draftState, groupFiles, groupKey } from './tts_import_groups.js';
import { TRAY, renderDraftCard, renderTrayCard, showSource, syncReference, updateRow } from './ui_tts_import_draft.js';
import { PICKER_OVERLAY_CLASS, pickServerPath } from './ui_tts_path_picker.js';
import { readDroppedFiles } from './ui_tts_file_drop.js';

/**
 * The GPT-SoVITS import window: one or many characters at once, or files added to
 * an existing one (`target`), through the Anomalous_TTS node. Files come from a
 * drop (folders too), the browser's file or folder dialog (uploaded in chunks) or
 * the node's folder picker (sent as paths). The node copies everything; the
 * originals are never touched.
 *
 * Empty, the window is one big drop area that says what to bring. With files it
 * lists one card per character (ui_tts_import_draft.js), one unfolded at a time,
 * plus a card for files that match no character. Files are sorted into drafts by
 * tts_import_groups.js; each draft is inspected and imported on its own, so one
 * failure leaves the others alone. Every file is one row object, owned by exactly
 * one draft's `rows`; its elements are built once and move with it.
 */

let activeScope = null;
const ACCEPT = { gpt: '.ckpt', sovits: '.pth', audio: '.wav,.flac,.ogg,.mp3', text: '.txt,.lab,.list' };
const ACCEPT_ALL = Object.values(ACCEPT).join(',');
const UPLOAD_SVG = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';

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

    const rowView = row => ({ kind: row.kind, name: row.name, emotion: row.emotion, error: row.error, uploaded: Boolean(row.spec),
        progress: row.progress, existing: row.info?.existing ?? null, supported: row.info?.supported, version: row.info?.version });

    function viewOf(draft) {
        const name = draft.name.trim();
        const conflict = draft.target ? null : nameConflict(name, existing);
        const duplicate = !draft.target && Boolean(name) && openDrafts().some(other => other !== draft && !other.target
            && other.name.trim().toLowerCase() === name.toLowerCase());
        const state = draftState({ target: draft.target, name, rows: draft.rows.map(rowView), conflict, duplicate,
            done: draft.done, failed: draft.failed, importing: draft.importing });
        return { ...state, conflict, problems: draft.problems };
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
            const grouped = groupFiles(usable, openDrafts().map(draft => ({ key: draft.key, target: draft.target })));
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
        const first = [...touched].find(place => place !== tray);
        if (first && !openDrafts().some(draft => draft.expanded)) expand(first);
        draw();
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
        refresh();
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
            if (renamed || (languageChanged && draft.expanded)) { draw(); return; }
        } catch (e) {
            if (mine !== draft.inspectToken || scope.signal.aborted) return;
            draft.problems = [e.message || String(e)];
        }
        refresh();
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
    const chooseFiles = (kinds = null, into = null) => {
        pickFor = into;
        fileInput.accept = kinds ? kinds.map(kind => ACCEPT[kind]).join(',') : ACCEPT_ALL;
        fileInput.click();
    };
    const chooseLocalFiles = async (kinds = null, into = null) => {
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

    // ---- layout: header, steps, content, footer ----
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(el('div', 'anomalous-voice-modal-title', target ? t('ttsImportAddTitle', { name: target }) : t('ttsImportTitle')));
    const closeBtn = button('anomalous-voice-modal-close', '×', close, t('close'));
    header.append(heading, closeBtn);

    const steps = el('ol', 'anomalous-tts-steps');
    const stepItems = ['ttsStepFiles', 'ttsStepCheck', 'ttsStepImport'].map((key, i) => {
        const item = el('li', 'anomalous-tts-step');
        item.append(el('span', 'anomalous-tts-step-no', String(i + 1)), el('span', 'anomalous-tts-step-label', t(key)));
        steps.append(item);
        return item;
    });

    // "Add more" is one button with a small menu, so the list stays the main thing.
    const menu = el('div', 'anomalous-tts-menu');
    const menuItem = (label, hint, onClick) => {
        const item = button('anomalous-tts-menu-item', '', () => { menu.classList.remove('is-open'); onClick(); });
        item.append(el('span', 'anomalous-tts-menu-label', label), el('span', 'anomalous-tts-menu-hint', hint));
        return item;
    };
    menu.append(menuItem(t('ttsImportPickFiles'), t('ttsMenuUploadHint'), () => chooseFiles()),
        menuItem(t('ttsBatchPickFolder'), t('ttsMenuUploadHint'), () => folderInput.click()),
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
    const toolbar = el('div', 'anomalous-tts-toolbar');
    const found = el('span', 'anomalous-tts-toolbar-title');
    toolbar.append(found, menuWrap, newBtn);
    const noteLine = el('div', 'anomalous-tts-note');
    const cardsBox = el('div', 'anomalous-tts-cards');
    const content = el('div', 'anomalous-tts-content');

    const hero = el('div', 'anomalous-tts-hero');
    const heroIcon = el('div', 'anomalous-tts-hero-icon');
    heroIcon.innerHTML = UPLOAD_SVG;
    const needs = el('div', 'anomalous-tts-hero-needs');
    for (const [key, ext] of [['ttsCardGpt', '.ckpt'], ['ttsCardSovits', '.pth'], ['ttsHeroClips', t('ttsHeroClipsLength')]]) {
        const chip = el('span', 'anomalous-tts-hero-need');
        chip.append(el('b', '', t(key)), el('span', '', ext));
        needs.append(chip);
    }
    const heroButtons = el('div', 'anomalous-tts-hero-buttons');
    heroButtons.append(button('anomalous-voice-modal-submit', t('ttsImportPickFiles'), () => chooseFiles()),
        button('anomalous-tts-ghost is-large', t('ttsBatchPickFolder'), () => folderInput.click()));
    const heroLocal = el('div', 'anomalous-tts-hero-local');
    heroLocal.append(el('span', '', t('ttsHeroLocal')), button('anomalous-tts-link', t('ttsHeroLocalFiles'), () => chooseLocalFiles()),
        el('span', 'anomalous-tts-hero-dot', '·'), button('anomalous-tts-link', t('ttsHeroLocalFolder'), chooseLocalFolder));
    hero.append(heroIcon, el('div', 'anomalous-tts-hero-title', t(target ? 'ttsHeroTitleAdd' : 'ttsHeroTitle', { name: target })),
        needs, el('div', 'anomalous-tts-hero-desc', t(target ? 'ttsHeroDescAdd' : 'ttsHeroDesc')), heroButtons, heroLocal);

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
            refresh();
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
        },
        onEdited: (row) => {
            const draft = ownerOf(row);
            if (draft === tray) return;
            draft.failed = '';
            refresh();
        },
        onLanguage: (draft, value) => { draft.language = value; draw(); },
        onMoveRow: moveRow,
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
            readDroppedFiles(dataTransfer).then(dropped => {
                if (!scope.signal.aborted) addItems(dropped.map(({ file, dir }) => ({ name: file.name, dir, file })), draft);
            });
        },
    };

    // ---- drawing ----
    /** Status only: the cards' pills and problems, the steps and the footer. */
    function refresh() {
        let ready = 0;
        let waiting = 0;
        for (const draft of drafts) {
            const view = viewOf(draft);
            cards.get(draft)?.refresh(view);
            if (view.tone === 'ready') ready++;
            else if (view.tone !== 'done') waiting++;
        }
        const hasFiles = allRows().length > 0 || drafts.length > (target ? 1 : 0);
        stepItems.forEach((item, i) => {
            const at = importing ? 2 : hasFiles ? 1 : 0;
            item.classList.toggle('is-current', i === at);
            item.classList.toggle('is-done', i < at);
        });
        const open = openDrafts().length;
        found.textContent = target && open === 1 ? t('ttsToolbarAdding', { name: target }) : t('ttsToolbarFound', { count: open });
        const parts = [];
        if (waiting) parts.push(t('ttsFooterWaiting', { count: waiting }));
        if (tray.rows.length) parts.push(t('ttsFooterTray', { count: tray.rows.length }));
        summary.textContent = parts.join(' · ');
        summary.hidden = !parts.length;
        saveTo.textContent = t('ttsFooterSaveTo', { path: status.storage });
        saveTo.title = status.storage;
        const single = drafts.length === 1 && drafts[0].target;
        submit.textContent = single ? t('ttsImportAddSubmit') : ready > 1 ? t('ttsBatchSubmit', { count: ready }) : t('ttsFooterImportOne');
        submit.disabled = importing || !ready;
        closeBtn.disabled = importing;
    }

    /** Structure changed: rebuild the cards (rows keep their elements), keep the scroll. */
    function draw() {
        const open = openDrafts();
        if (open.length === 1) open[0].expanded = true;
        const hasFiles = allRows().length > 0 || drafts.length > (target ? 1 : 0);
        modal.classList.toggle('is-empty', !hasFiles);
        if (!hasFiles) {
            content.replaceChildren(hero);
        } else {
            const top = content.scrollTop;
            cards.clear();
            cardsBox.replaceChildren();
            if (tray.rows.length) cardsBox.append(renderTrayCard(tray, ctx));
            for (const draft of drafts) {
                const card = renderDraftCard(draft, viewOf(draft), ctx);
                cards.set(draft, card);
                cardsBox.append(card.root);
            }
            if (content.firstChild !== toolbar) content.replaceChildren(toolbar, noteLine, cardsBox);
            content.scrollTop = top;
        }
        refresh();
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

    // Files can be dropped anywhere on the window; they are sorted by name and folder.
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
            if (!scope.signal.aborted) addItems(dropped.map(({ file, dir }) => ({ name: file.name, dir, file })));
        });
    });

    modal.append(header, steps, content, footer, dropCover, fileInput, folderInput);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (target) newDraft({ key: groupKey(target), name: target, target });
    const initial = files.map(item => (item instanceof File ? { file: item, dir: '' } : item));
    if (initial.length) addItems(initial.map(({ file, dir }) => ({ name: file.name, dir, file })));
    else draw();
}
