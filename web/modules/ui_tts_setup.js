import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { loadGptSovitsStatus } from './audio_engines.js';
import { changeLibrary, changePretrainedSource, setupSummary, startPretrainedDownload } from './tts_setup_api.js';
import { formatSize, pickServerPath } from './ui_tts_path_picker.js';

/**
 * GPT-SoVITS setup card at the top of the audio studio: character libraries,
 * pretrained files (download or use an existing GPT-SoVITS package) and missing
 * Python packages, from the node's `/anomalous_tts/status`. Collapsed to one line
 * once everything is ready. While a download runs the card polls the status and
 * redraws itself; it stops as soon as it is no longer in the page.
 */

const OPEN_KEY = 'anomalous_tts_setup_open';
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
    parts.push(summary.downloading ? t('ttsSetupDownloading')
        : summary.missing ? t('ttsSetupPretrainedMissing', { count: summary.missing }) : t('ttsSetupPretrainedOk'));
    if (summary.packages) parts.push(t('ttsSetupPackagesMissing', { count: summary.packages }));
    return parts.join(' · ');
}

function renderLibraries(status, local, onChanged) {
    const group = el('div', 'anomalous-tts-setup-group');
    group.append(el('div', 'anomalous-tts-section', t('ttsSetupLibraries')));
    for (const lib of status.libraries) {
        const row = el('div', 'anomalous-tts-setup-row');
        const path = el('span', 'anomalous-tts-setup-path', lib.path);
        path.title = lib.path;
        row.append(path, el('span', 'anomalous-tts-kind', t(`ttsLibrarySource_${lib.source}`)),
            el('span', 'anomalous-tts-setup-meta', lib.exists ? t('ttsSetupCharacters', { count: lib.characters }) : t('ttsLibraryMissing')));
        if (lib.source === 'app') {
            const remove = button('anomalous-tts-remove', '×', () => act(remove, async () => {
                if (!await anomalousConfirm(t('ttsLibraryRemoveConfirm', { path: lib.path }))) return false;
                await changeLibrary(lib.path, true);
            }, onChanged), t('ttsLibraryRemove'));
            remove.disabled = !local;
            row.append(remove);
        }
        group.append(row);
    }
    const add = button('anomalous-tts-add', t('ttsLibraryAdd'), () => act(add, async () => {
        const path = await pickServerPath({ mode: 'folder', title: t('ttsLibraryAdd'), hint: t('ttsLibraryAddHint') });
        if (!path) return false;
        await changeLibrary(path);
    }, onChanged));
    add.disabled = !local;
    group.append(add, el('div', 'anomalous-tts-hint', t('ttsLibraryHint')));
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

/**
 * The card for one status payload. `onChanged()` redraws the studio (libraries and
 * sources change the character list); `onImport()` opens the import form.
 */
export function renderTtsSetup(status, { onChanged, onImport }) {
    const summary = setupSummary(status);
    const local = status.local !== false;
    const card = el('section', `anomalous-tts-setup${summary.ready ? ' is-ready' : ''}`);
    const stored = storedOpen();
    let open = stored === null ? !summary.ready : stored === '1';

    const head = el('div', 'anomalous-tts-setup-head');
    const toggle = button('anomalous-tts-setup-toggle', '', () => {
        open = !open;
        storeOpen(open);
        card.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.setAttribute('aria-expanded', String(open));
    toggle.append(el('span', 'anomalous-tts-setup-dot'), el('span', 'anomalous-tts-setup-title', t('ttsSetupTitle')),
        el('span', 'anomalous-tts-setup-summary', summaryText(status, summary)), el('span', 'anomalous-tts-setup-chevron', '▾'));
    const importBtn = button('anomalous-voice-modal-submit anomalous-tts-setup-import', t('ttsImportOpen'), onImport);
    importBtn.disabled = !local;
    if (!local) importBtn.title = t('ttsSetupRemote');
    head.append(toggle, importBtn);

    const body = el('div', 'anomalous-tts-setup-body');
    if (!local) body.append(el('div', 'anomalous-tts-setup-notice', t('ttsSetupRemote')));
    body.append(renderLibraries(status, local, onChanged), renderPretrained(status, local, onChanged));
    const packages = renderPackages(status);
    if (packages) body.append(packages);

    card.classList.toggle('is-open', open);
    card.append(head, body);
    if (summary.downloading) pollWhileDownloading(card, { onChanged, onImport });
    return card;
}

function pollWhileDownloading(card, options) {
    setTimeout(async () => {
        if (!card.isConnected) return;
        try {
            const status = await loadGptSovitsStatus({ force: true });
            if (card.isConnected && status) card.replaceWith(renderTtsSetup(status, options));
        } catch (_) {
            if (card.isConnected) pollWhileDownloading(card, options);
        }
    }, POLL_MS);
}
