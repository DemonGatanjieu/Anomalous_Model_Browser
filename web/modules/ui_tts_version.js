import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { button, el } from './usage_view.js';

/**
 * "Anomalous_TTS version" in GPT-SoVITS Settings: the installed version (local), its
 * published releases only after "Check for updates" (network), and an update to the
 * newest stable one, or back to where the last update came from; then the restart
 * question (ComfyUI Manager's reboot when there is one). The backend only acts on a git
 * clone of the official repository (api/tts_version.py).
 */

async function request(url, options = {}) {
    try {
        const resp = await fetch(url, options);
        return await resp.json().catch(() => ({ success: false, error: `HTTP ${resp.status}` }));
    } catch (e) {
        return { success: false, code: 'offline', error: e.message };
    }
}

const post = (url, body = {}) => request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function errorText(result) {
    const key = `versionError_${result.code}`;
    const text = t(key, { error: result.error || '' });
    const message = text === key ? t('versionErrorGeneric', { error: result.error || result.code || '' }) : text;
    return result.files?.length ? `${message}\n\n${result.files.join('\n')}` : message;
}

function versionOf(state) {
    return state.tag || state.base_tag || state.label;
}

async function askRestart(message) {
    const restart = await anomalousConfirm(`${message}\n\n${t('versionRestartQuestion')}`, t('ttsVersionTitle'), {
        okLabel: t('versionRestartNow'), cancelLabel: t('versionRestartLater'),
    });
    if (!restart) return '';
    // Manager's reboot exits the server, so a dropped connection means it is restarting.
    const reboot = await post('/api/manager/reboot');
    if (reboot.code === 'offline' || reboot.success !== false) return t('versionRestarting');
    await anomalousAlert(t('versionRestartManual'));
    return '';
}

/** The settings group; `local` false (another device) leaves the buttons out. */
export function renderTtsVersion(local) {
    const group = el('div', 'anomalous-tts-setup-group');
    const row = el('div', 'anomalous-tts-setup-row');
    const value = el('span', 'anomalous-tts-setup-path', '…');
    const note = el('span', 'anomalous-tts-setup-meta', '');
    const actions = el('span', 'anomalous-tts-version-actions');
    row.append(value, note, actions);
    const hint = el('div', 'anomalous-tts-hint', t('ttsVersionHint'));
    group.append(row, hint); // its title is the fold's (ui_tts_setup.js)

    let busy = false;
    const run = async (label, work) => {
        if (busy) return;
        busy = true;
        actions.querySelectorAll('button').forEach(btn => { btn.disabled = true; });
        note.textContent = label;
        try { await work(); } finally { busy = false; }
    };

    const show = (state, listing = null) => {
        value.textContent = versionOf(state);
        note.textContent = '';
        actions.replaceChildren();
        if (!local) return;
        const latest = listing?.releases.find(item => item.latest);
        if (!listing) {
            actions.append(button('anomalous-tts-add', t('ttsVersionCheck'), () => run(t('ttsVersionChecking'), check)));
        } else if (!latest || latest.current || latest.direction !== 'newer') {
            note.textContent = t('ttsVersionUpToDate');
        } else {
            note.textContent = t('ttsVersionNew', { tag: latest.tag });
            actions.append(button('anomalous-tts-add', t('ttsVersionUpdate', { tag: latest.tag }),
                () => run(t('versionSwitching', { tag: latest.tag }), () => update(state, latest))));
            if (latest.url) {
                const notes = el('a', 'anomalous-tts-link', t('ttsVersionNotes'));
                notes.href = latest.url;
                notes.target = '_blank';
                notes.rel = 'noopener noreferrer';
                actions.append(notes);
            }
        }
        if (state.previous?.label) {
            actions.append(button('anomalous-tts-link', t('ttsVersionUndo', { tag: state.previous.label }),
                () => run(t('versionSwitching', { tag: state.previous.label }), () => undo(state))));
        }
    };

    const check = async () => {
        const listing = await request('/anomalous/tts_version/releases?refresh=1');
        if (!listing.success) {
            await anomalousAlert(errorText(listing));
            return load();
        }
        show(listing.state, listing);
    };

    const finish = async (result, tag) => {
        if (!result.success) {
            await anomalousAlert(errorText(result));
            return load();
        }
        show(result.state);
        note.textContent = await askRestart(t('ttsVersionUpdated', { tag })) || t('versionPendingRestart');
    };

    const update = async (state, release) => {
        if (!await anomalousConfirm(t('ttsVersionConfirm', { tag: release.tag, from: versionOf(state) }), t('ttsVersionTitle'))) return show(state);
        await finish(await post('/anomalous/tts_version/update', { tag: release.tag }), release.tag);
    };

    const undo = async (state) => {
        const tag = state.previous.label;
        if (!await anomalousConfirm(t('versionConfirmUndo', { label: tag }), t('ttsVersionTitle'))) return show(state);
        await finish(await post('/anomalous/tts_version/undo'), tag);
    };

    const load = async () => {
        const data = await request('/anomalous/tts_version');
        if (!data.success || !data.found) {
            value.textContent = t('ttsVersionUnknown');
            note.textContent = '';
            actions.replaceChildren();
            hint.textContent = t('ttsVersionNoGit');
            return;
        }
        show(data.state);
    };
    load();
    return group;
}
