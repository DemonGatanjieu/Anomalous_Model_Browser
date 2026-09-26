import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { loadGptSovitsStatus } from './audio_engines.js';
import { changePretrainedSource, changeStorage, forgetLibrary, pretrainedReminder, setupSummary, startPretrainedDownload } from './tts_setup_api.js';
import { PICKER_OVERLAY_CLASS, formatSize, pickServerPath } from './ui_tts_path_picker.js';

/**
 * GPT-SoVITS settings, opened from the audio sidebar's footer: the storage place (change it,
 * optionally moving the characters there), other places that still hold characters,
 * pretrained files (download or use an existing GPT-SoVITS package) and missing
 * Python packages, from the node's `/anomalous_tts/status`. Missing pretrained files
 * are fetched on first use anyway, so the sidebar entry only gets a small dot
 * (dismissable) when the characters here need them; missing Python packages get a
 * red one. While a download or a move runs the card polls the status and redraws
 * itself; it stops as soon as it is no longer in the page.
 */

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

/** What the sidebar entry shows: `level` is 'blocked' (packages), 'reminder' (pretrained) or ''. */
export function setupAttention(status, languages = []) {
    const summary = setupSummary(status);
    const reminder = pretrainedReminder(status, languages, storedDismissed());
    return {
        level: summary.packages ? 'blocked' : reminder.due ? 'reminder' : '',
        title: t(summary.packages ? 'ttsSetupDotPackages' : reminder.due ? 'ttsSetupDotPretrained' : 'ttsSetupTitle'),
        busy: summary.downloading ? t('ttsSetupDownloading')
            : summary.moving ? t('ttsSetupMoving', { done: status.move.done, total: status.move.total }) : '',
    };
}

/**
 * The card for one status payload. `onChanged()` redraws the studio (storage and
 * sources change the character list); `onDismissed()` runs after "don't remind me";
 * `languages` are the languages of the characters in the studio (for the reminder).
 */
export function renderTtsSetup(status, options) {
    const { onChanged, onDismissed, languages = [] } = options;
    const summary = setupSummary(status);
    const local = status.local !== false;
    const reminder = pretrainedReminder(status, languages, storedDismissed());
    const card = el('section', `anomalous-tts-setup${summary.packages ? ' is-blocked' : ''}`);

    if (!local) card.append(el('div', 'anomalous-tts-setup-notice', t('ttsSetupRemote')));
    if (reminder.due) {
        card.append(renderReminder(reminder, local, onChanged, () => {
            storeDismissed(reminder.items.map(item => item.id));
            card.replaceWith(renderTtsSetup(status, options));
            onDismissed?.();
        }));
    }
    const packages = renderPackages(status);
    if (packages) card.append(packages);
    card.append(renderStorage(status, local, onChanged), renderPretrained(status, local, onChanged));
    if (summary.downloading || summary.moving) pollWhileBusy(card, options, summary.moving);
    return card;
}

let activeScope = null;

/**
 * The settings dialog. `onChanged()` redraws the studio and sidebar after a change;
 * the dialog then reloads the status and redraws itself.
 */
export async function openTtsSetup({ onChanged, languages = [] }) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    let status;
    try {
        status = await loadGptSovitsStatus({ force: true });
    } catch (e) {
        await anomalousAlert(t('ttsSetupFailed', { error: e.message || String(e) }));
    }
    if (!status || scope.signal.aborted) { scope.dispose(); return; }

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-setup-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();
    scope.onDispose(() => {
        overlay.remove();
        if (activeScope === scope) activeScope = null;
        onChanged?.({ sidebarOnly: true }); // downloads may have finished meanwhile: refresh the dot
    });
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector(`.anomalous-dialog-overlay, .${PICKER_OVERLAY_CLASS}`)) return;
        e.stopPropagation();
        close();
    }, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    const subtitle = el('div', 'anomalous-voice-modal-subtitle');
    heading.append(el('div', 'anomalous-voice-modal-title', t('ttsSetupTitle')), subtitle);
    header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));
    const body = el('div', 'anomalous-tts-setup-modal-body');

    const options = {
        languages,
        onDismissed: () => onChanged?.({ sidebarOnly: true }),
        onChanged: async () => {
            onChanged?.();
            try { status = await loadGptSovitsStatus({ force: true }); } catch (_) { /* keep the last one */ }
            if (!scope.signal.aborted && status) draw();
        },
    };
    const draw = () => {
        subtitle.textContent = summaryText(status, setupSummary(status));
        body.replaceChildren(renderTtsSetup(status, options));
    };
    draw();
    modal.append(header, body);
    overlay.append(modal);
    document.body.append(overlay);
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
