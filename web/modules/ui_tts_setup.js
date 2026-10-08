import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { loadGptSovitsStatus } from './audio_engines.js';
import { formatSize, pretrainedReminder, setupSummary, startPretrainedDownload } from './tts_setup_api.js';

/**
 * GPT-SoVITS settings, opened from the audio sidebar's footer: the storage place, other
 * places with characters, pretrained files (download them, or GPT-SoVITS packages they
 * come from) and missing Python packages, from the node's `/anomalous_tts/status`.
 * Where folders are is shown, not changed: the node takes them only from its settings
 * file, which the card names. Missing pretrained files are fetched on first use anyway,
 * so the sidebar entry only gets a small dot (dismissable) when the characters here
 * need them; missing Python packages get a red one. While a download runs the card
 * polls the status and redraws itself; it stops as soon as it is no longer in the page.
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
    if (summary.downloading) parts.push(t('ttsSetupDownloading'));
    if (summary.packages) parts.push(t('ttsSetupPackagesMissing', { count: summary.packages }));
    return parts.join(' · ');
}

/** A folder path on one line, the full path on hover. */
function pathText(path) {
    const node = el('span', 'anomalous-tts-setup-path', path);
    node.title = path;
    return node;
}

function copyButton(text, labelKey) {
    const copy = button('anomalous-tts-add', t(labelKey), async () => {
        try { await navigator.clipboard.writeText(text); copy.textContent = t('ttsCopied'); } catch (_) { /* select by hand */ }
    });
    return copy;
}

function renderStorage(status) {
    const group = el('div', 'anomalous-tts-setup-group');
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupStorage')));
    const home = status.libraries.find(lib => lib.storage);
    const row = el('div', 'anomalous-tts-setup-row');
    row.append(pathText(status.storage), el('span', 'anomalous-tts-setup-meta', t('ttsSetupCharacters', { count: home?.characters || 0 })));
    group.append(row, el('div', 'anomalous-tts-hint', t('ttsStorageHint')));

    // Other places with characters: folders in the settings file, yaml folders.
    const others = status.libraries.filter(lib => !lib.storage && (lib.source !== 'default' || lib.characters > 0));
    if (!others.length) return group;
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupOtherPlaces')));
    for (const lib of others) {
        const line = el('div', 'anomalous-tts-setup-row');
        line.append(pathText(lib.path), el('span', 'anomalous-tts-kind', t(`ttsLibrarySource_${lib.source}`)),
            el('span', 'anomalous-tts-setup-meta', lib.exists ? t('ttsSetupCharacters', { count: lib.characters }) : t('ttsLibraryMissing')));
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
    if (actions.childElementCount) group.append(actions);
    for (const source of status.pretrained_sources || []) {
        const row = el('div', 'anomalous-tts-setup-row');
        row.append(pathText(source), el('span', 'anomalous-tts-kind', t('ttsPretrainedSource')));
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
        row.append(el('span', 'anomalous-tts-setup-meta', t('ttsPackagesFor', { lang: t(`ttsNeededFor_${lang}`), packages: dep.missing.join(', ') })),
            code, copyButton(dep.command, 'ttsCopyCommand'));
        group.append(row);
    }
    group.append(el('div', 'anomalous-tts-hint', t('ttsPackagesHint')));
    return group;
}

/** The node's settings file: where the storage place, other places and package sources are changed. */
function renderSettingsFile(status) {
    if (!status.settings_file) return null; // a node before interface v13
    const group = el('div', 'anomalous-tts-setup-group');
    group.append(el('div', 'anomalous-tts-section', t('ttsSettingsFile')));
    const row = el('div', 'anomalous-tts-setup-row');
    row.append(pathText(status.settings_file), copyButton(status.settings_file, 'ttsCopyPath'));
    group.append(row, el('div', 'anomalous-tts-hint', t('ttsSettingsFileHint')));
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
        busy: summary.downloading ? t('ttsSetupDownloading') : '',
    };
}

/**
 * The card for one status payload. `onChanged()` redraws the studio (a download
 * changes what is ready); `onDismissed()` runs after "don't remind me";
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
    card.append(renderStorage(status), renderPretrained(status, local, onChanged));
    const settingsFile = renderSettingsFile(status);
    if (settingsFile) card.append(settingsFile);
    if (summary.downloading) pollWhileBusy(card, options);
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
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
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

/** Redraw the card with fresh status while a download runs. */
function pollWhileBusy(card, options) {
    setTimeout(async () => {
        if (!card.isConnected) return;
        try {
            const status = await loadGptSovitsStatus({ force: true });
            if (card.isConnected && status) card.replaceWith(renderTtsSetup(status, options));
        } catch (_) {
            if (card.isConnected) pollWhileBusy(card, options);
        }
    }, POLL_MS);
}
