import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { loadGptSovitsStatus } from './audio_engines.js';
import { changePretrainedSource, changeStorage, forgetLibrary, pretrainedReminder, setupSummary, startPretrainedDownload } from './tts_setup_api.js';
import { formatSize, pickServerPath } from './ui_tts_path_picker.js';

/**
 * GPT-SoVITS setup card at the top of the audio studio: the storage place (change it,
 * optionally moving the characters there), other places that still hold characters,
 * pretrained files (download or use an existing GPT-SoVITS package) and missing
 * Python packages, from the node's `/anomalous_tts/status`. It stays one quiet line
 * unless opened: missing pretrained files are fetched on first use anyway, so they
 * only get a small dot (dismissable) when the characters here need them; missing
 * Python packages get a red one. While a download or a move runs the card polls the
 * status and redraws itself; it stops as soon as it is no longer in the page.
 */

const OPEN_KEY = 'anomalous_tts_setup_open';
const DISMISSED_KEY = 'anomalous_tts_pretrained_dismissed';
const POLL_MS = 1000;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) btn.title = title;
    btn.onclick = onClick;
    return btn;
}

function storedOpen() {
    try { return localStorage.getItem(OPEN_KEY); } catch (_) { return null; }
}

function storeOpen(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) { /* convenience only */ }
}

function storedDismissed() {
    try {
        const ids = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
        return Array.isArray(ids) ? ids : [];
    } catch (_) { return []; }
}

function storeDismissed(ids) {
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...storedDismissed(), ...ids])])); } catch (_) { /* convenience only */ }
}

/**
 * Run a change, report failures, then let the studio redraw. The button stays disabled
 * while it runs; `work` returns false when the user cancelled (nothing to redraw).
 */
async function act(btn, work, onChanged) {
    btn.disabled = true;
    try {
        if (await work() === false) btn.disabled = false;
        else onChanged();
    } catch (e) {
        await anomalousAlert(t('ttsSetupFailed', { error: e.message || String(e) }));
        btn.disabled = false;
    }
}

function summaryText(status, summary) {
    const parts = [t('ttsSetupCharacters', { count: summary.characters })];
    if (summary.moving) parts.push(t('ttsSetupMoving', { done: status.move.done, total: status.move.total }));
    if (summary.downloading) parts.push(t('ttsSetupDownloading'));
    if (summary.packages) parts.push(t('ttsSetupPackagesMissing', { count: summary.packages }));
    return parts.join(' · ');
}

/** Progress or result of the last move, shown only while it concerns the current storage place. */
function moveLine(move, storage) {
    if (!move || move.to.toLowerCase() !== storage.toLowerCase()) return null;
    if (move.state === 'moving') {
        const copied = move.bytes_total ? t('ttsStorageMovingBytes', { percent: Math.floor(100 * move.bytes_done / move.bytes_total) }) : '';
        return el('div', 'anomalous-tts-state is-busy', t('ttsStorageMoving', { done: move.done, total: move.total, current: move.current || '…' }) + copied);
    }
    if (move.state === 'error') {
        return el('div', 'anomalous-tts-state is-error', t('ttsStorageMoveError', { error: move.error, done: move.done, total: move.total }));
    }
    return el('div', 'anomalous-tts-state is-ok', t('ttsStorageMoveDone', { count: move.done }));
}

/** Ask where to, and whether the characters already there come along. */
async function pickStorage(status) {
    const path = await pickServerPath({ mode: 'folder', title: t('ttsStorageChangeTitle'), hint: t('ttsStorageChangeHint') });
    if (!path) return false;
    const here = status.libraries.find(lib => lib.storage)?.characters || 0;
    let move = false;
    if (here) {
        move = await anomalousConfirm(t('ttsStorageMoveAsk', { count: here, path }), 'Anomalous',
            { okLabel: t('ttsStorageMoveYes'), noLabel: t('ttsStorageMoveNo') });
        if (move === null) return false;
    }
    await changeStorage(path, move);
}

function renderStorage(status, local, onChanged) {
    const group = el('div', 'anomalous-tts-setup-group');
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupStorage')));
    const home = status.libraries.find(lib => lib.storage);
    const row = el('div', 'anomalous-tts-setup-row');
    const path = el('span', 'anomalous-tts-setup-path', status.storage);
    path.title = status.storage;
    const change = button('anomalous-tts-add', t('ttsStorageChange'), () => act(change, () => pickStorage(status), onChanged));
    change.disabled = !local || status.move?.state === 'moving';
    row.append(path, el('span', 'anomalous-tts-setup-meta', t('ttsSetupCharacters', { count: home?.characters || 0 })), change);
    group.append(row);
    const move = moveLine(status.move, status.storage);
    if (move) group.append(move);
    group.append(el('div', 'anomalous-tts-hint', t('ttsStorageHint')));

    // Other places that still hold characters: earlier storage places, yaml folders.
    const others = status.libraries.filter(lib => !lib.storage && (lib.source !== 'default' || lib.characters > 0));
    if (!others.length) return group;
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupOtherPlaces')));
    for (const lib of others) {
        const line = el('div', 'anomalous-tts-setup-row');
        const where = el('span', 'anomalous-tts-setup-path', lib.path);
        where.title = lib.path;
        line.append(where, el('span', 'anomalous-tts-kind', t(`ttsLibrarySource_${lib.source}`)),
            el('span', 'anomalous-tts-setup-meta', lib.exists ? t('ttsSetupCharacters', { count: lib.characters }) : t('ttsLibraryMissing')));
        if (lib.source === 'app') {
            const remove = button('anomalous-tts-remove', '×', () => act(remove, async () => {
                if (!await anomalousConfirm(t('ttsLibraryRemoveConfirm', { path: lib.path }))) return false;
                await forgetLibrary(lib.path);
            }, onChanged), t('ttsLibraryRemove'));
            remove.disabled = !local;
            line.append(remove);
        }
        group.append(line);
    }
    group.append(el('div', 'anomalous-tts-hint', t('ttsOtherPlacesHint')));
    return group;
}

function pretrainedState(item) {
    if (item.state === 'ok') return el('span', 'anomalous-tts-state is-ok', t('ttsPretrainedOk'));
    if (item.state === 'downloading') {
        const pct = item.size ? Math.min(99, Math.floor(100 * (item.done || 0) / item.size)) : 0;
        return el('span', 'anomalous-tts-state is-busy', t('ttsPretrainedDownloading', { percent: pct }));
    }
    if (item.state === 'queued') return el('span', 'anomalous-tts-state is-busy', t('ttsPretrainedQueued'));
    const state = el('span', `anomalous-tts-state ${item.state === 'error' ? 'is-error' : 'is-missing'}`,
        item.state === 'error' ? t('ttsPretrainedError') : t(item.required ? 'ttsPretrainedMissing' : 'ttsPretrainedOptional'));
    if (item.error) state.title = item.error;
    return state;
}

function renderPretrained(status, local, onChanged) {
    const group = el('div', 'anomalous-tts-setup-group');
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupPretrained')));
    const missing = status.pretrained.filter(item => item.state === 'missing' || item.state === 'error');
    for (const item of status.pretrained) {
        const row = el('div', 'anomalous-tts-setup-row');
        const label = el('span', 'anomalous-tts-setup-path', item.label);
        label.title = item.path || item.error || '';
        row.append(label, el('span', 'anomalous-tts-kind', t(`ttsNeededFor_${item.needed_for}`)), pretrainedState(item));
        if (item.state === 'missing' || item.state === 'error') {
            const get = button('anomalous-tts-add', t('ttsPretrainedDownload', { size: formatSize(item.size) }),
                () => act(get, () => startPretrainedDownload([item.id]), onChanged));
            get.disabled = !local;
            row.append(get);
        }
        group.append(row);
    }
    const actions = el('div', 'anomalous-tts-setup-actions');
    if (missing.length > 1) {
        const total = missing.reduce((sum, item) => sum + item.size, 0);
        const all = button('anomalous-tts-add', t('ttsPretrainedDownloadAll', { size: formatSize(total) }),
            () => act(all, () => startPretrainedDownload(missing.map(item => item.id)), onChanged));
        all.disabled = !local;
        actions.append(all);
    }
    const useSource = button('anomalous-tts-add', t('ttsPretrainedUsePackage'), () => act(useSource, async () => {
        const path = await pickServerPath({ mode: 'folder', title: t('ttsPretrainedUsePackage'), hint: t('ttsPretrainedPackageHint') });
        if (!path) return false;
        await changePretrainedSource(path);
    }, onChanged));
    useSource.disabled = !local;
    actions.append(useSource);
    group.append(actions);
    for (const source of status.pretrained_sources || []) {
        const row = el('div', 'anomalous-tts-setup-row');
        const path = el('span', 'anomalous-tts-setup-path', source);
        path.title = source;
        const remove = button('anomalous-tts-remove', '×', () => act(remove, () => changePretrainedSource(source, true), onChanged), t('ttsLibraryRemove'));
        remove.disabled = !local;
        row.append(path, el('span', 'anomalous-tts-kind', t('ttsPretrainedSource')), remove);
        group.append(row);
    }
    group.append(el('div', 'anomalous-tts-hint', t('ttsPretrainedHint')));
    return group;
}

function renderPackages(status) {
    const missing = Object.entries(status.dependencies || {}).filter(([, dep]) => !dep.ok);
    if (!missing.length) return null;
    const group = el('div', 'anomalous-tts-setup-group');
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupPackages')));
    for (const [lang, dep] of missing) {
        const row = el('div', 'anomalous-tts-setup-row is-package');
        const code = el('code', 'anomalous-tts-setup-command', dep.command);
        const copy = button('anomalous-tts-add', t('ttsCopyCommand'), async () => {
            try { await navigator.clipboard.writeText(dep.command); copy.textContent = t('ttsCopied'); } catch (_) { /* select by hand */ }
        });
        row.append(el('span', 'anomalous-tts-setup-meta', t('ttsPackagesFor', { lang: t(`ttsNeededFor_${lang}`), packages: dep.missing.join(', ') })), code, copy);
        group.append(row);
    }
    group.append(el('div', 'anomalous-tts-hint', t('ttsPackagesHint')));
    return group;
}

/** "N pretrained files not downloaded yet" with download-all and "don't remind me". */
function renderReminder(reminder, local, onChanged, onDismiss) {
    const box = el('div', 'anomalous-tts-reminder');
    box.append(el('span', 'anomalous-tts-reminder-text', t('ttsReminderText', { count: reminder.items.length, size: formatSize(reminder.size) })));
    const get = button('anomalous-tts-add', t('ttsReminderDownload'),
        () => act(get, () => startPretrainedDownload(reminder.items.map(item => item.id)), onChanged));
    get.disabled = !local;
    const dismiss = button('anomalous-tts-link', t('ttsReminderDismiss'), onDismiss);
    box.append(get, dismiss);
    return box;
}

/**
 * The card for one status payload. `onChanged()` redraws the studio (storage and
 * sources change the character list); `onImport()` opens the import form;
 * `languages` are the languages of the characters in the studio (for the reminder).
 */
export function renderTtsSetup(status, options) {
    const { onChanged, onImport, languages = [] } = options;
    const summary = setupSummary(status);
    const local = status.local !== false;
    const reminder = pretrainedReminder(status, languages, storedDismissed());
    const attention = summary.packages ? 'is-blocked' : reminder.due ? 'is-reminder' : '';
    const card = el('section', `anomalous-tts-setup ${attention}`.trim());
    let open = storedOpen() === '1';

    const head = el('div', 'anomalous-tts-setup-head');
    const toggle = button('anomalous-tts-setup-toggle', '', () => {
        open = !open;
        storeOpen(open);
        card.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.setAttribute('aria-expanded', String(open));
    if (attention) {
        const dot = el('span', 'anomalous-tts-setup-dot');
        dot.title = t(summary.packages ? 'ttsSetupDotPackages' : 'ttsSetupDotPretrained');
        toggle.append(dot);
    }
    toggle.append(el('span', 'anomalous-tts-setup-title', t('ttsSetupTitle')),
        el('span', 'anomalous-tts-setup-summary', summaryText(status, summary)), el('span', 'anomalous-tts-setup-chevron', '▾'));
    head.append(toggle);
    // With no characters the empty studio below carries the import button.
    if (summary.characters) {
        const importBtn = button('anomalous-voice-modal-submit anomalous-tts-setup-import', t('ttsImportOpen'), onImport);
        importBtn.disabled = !local;
        if (!local) importBtn.title = t('ttsSetupRemote');
        head.append(importBtn);
    }

    const body = el('div', 'anomalous-tts-setup-body');
    if (!local) body.append(el('div', 'anomalous-tts-setup-notice', t('ttsSetupRemote')));
    if (reminder.due) {
        body.append(renderReminder(reminder, local, onChanged, () => {
            storeDismissed(reminder.items.map(item => item.id));
            card.replaceWith(renderTtsSetup(status, options));
        }));
    }
    const packages = renderPackages(status);
    if (packages) body.append(packages);
    body.append(renderStorage(status, local, onChanged), renderPretrained(status, local, onChanged));

    card.classList.toggle('is-open', open);
    card.append(head, body);
    if (summary.downloading || summary.moving) pollWhileBusy(card, options, summary.moving);
    return card;
}

/** Redraw the card with fresh status; when a move ends, redraw the whole studio (characters moved). */
function pollWhileBusy(card, options, moving) {
    setTimeout(async () => {
        if (!card.isConnected) return;
        try {
            const status = await loadGptSovitsStatus({ force: true });
            if (!card.isConnected || !status) return;
            if (moving && status.move?.state !== 'moving') options.onChanged();
            else card.replaceWith(renderTtsSetup(status, options));
        } catch (_) {
            if (card.isConnected) pollWhileBusy(card, options, moving);
        }
    }, POLL_MS);
}
