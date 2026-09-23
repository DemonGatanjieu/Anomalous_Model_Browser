import { translate } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';

/**
 * Version line in the update guide ("!" in the header) and the "Version & updates" panel:
 * shows the installed version, lists published releases only when asked,
 * and switches, rolls back, returns to latest or undoes the last switch.
 */

const t = (key, params) => translate(key, params);
let activeScope = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const btn = el('button', className, label);
    btn.type = 'button';
    btn.onclick = onClick;
    return btn;
}

async function request(url, options = {}) {
    let resp;
    try {
        resp = await fetch(url, options);
    } catch (e) {
        return { success: false, code: 'offline', error: e.message };
    }
    const data = await resp.json().catch(() => ({ success: false, error: `HTTP ${resp.status}` }));
    return data;
}

const post = (url, body = {}) => request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

function errorText(result) {
    const key = `versionError_${result.code}`;
    const text = t(key, { error: result.error || '' });
    const message = text === key ? t('versionErrorGeneric', { error: result.error || result.code || '' }) : text;
    return result.files?.length ? `${message}\n\n${result.files.join('\n')}` : message;
}

function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function stateLabel(state) {
    if (!state?.is_git) return t('versionUnknown');
    if (state.tag) return state.tag;
    return state.branch ? t('versionDevBuild', { base: state.base_tag || state.commit, branch: state.branch }) : state.label;
}

// ---------- version line ----------

/**
 * "Current version · Check for updates" row for the update guide. Reads the installed
 * version locally (no network). `beforeOpen` lets the host close itself first, since a
 * modal <dialog> would stay above the panel.
 */
export function createVersionLine(owner, { beforeOpen } = {}) {
    const line = el('div', 'anomalous-version-line');
    const label = el('span', 'anomalous-version-line-label', t('versionCurrent'));
    const value = el('strong', 'anomalous-version-line-value', '…');
    const open = button('anomalous-version-line-open', t('versionCheckOpen'), () => {
        beforeOpen?.();
        openVersionPanel(owner);
    });
    line.append(label, value, open);
    request('/anomalous/version').then(data => {
        value.textContent = data.success && data.state?.is_git ? (data.state.tag || data.state.base_tag || data.state.label) : t('versionChipUnknown');
    });
    return line;
}

// ---------- panel ----------

export function openVersionPanel(owner, chip = null) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;

    const overlay = el('div', 'anomalous-version-overlay');
    const panel = el('div', 'anomalous-version-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();
    scope.onDispose(() => {
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
        e.stopPropagation();
        close();
    }, true);

    const header = el('div', 'anomalous-version-header');
    header.append(el('div', 'anomalous-version-title', t('versionPanelTitle')), button('anomalous-version-close', '×', close));

    const current = el('div', 'anomalous-version-current');
    const actions = el('div', 'anomalous-version-actions');
    const status = el('div', 'anomalous-version-status');
    const listBar = el('label', 'anomalous-version-prerelease');
    const prereleaseToggle = document.createElement('input');
    prereleaseToggle.type = 'checkbox';
    listBar.append(prereleaseToggle, el('span', '', t('versionShowPrerelease')));
    listBar.hidden = true;
    const list = el('div', 'anomalous-version-list');

    const view = { state: null, listing: null, busy: false };
    const setBusy = (busy, message = '') => {
        view.busy = busy;
        panel.classList.toggle('is-busy', busy);
        status.textContent = message;
        status.classList.remove('is-error');
        panel.querySelectorAll('button.anomalous-version-action').forEach(btn => { btn.disabled = busy || btn.dataset.blocked === '1'; });
    };
    const showError = (result) => {
        status.textContent = errorText(result);
        status.classList.add('is-error');
    };

    const renderCurrent = () => {
        const state = view.state;
        current.replaceChildren();
        const line = el('div', 'anomalous-version-current-line');
        line.append(el('span', 'anomalous-version-current-label', t('versionCurrent')), el('strong', '', stateLabel(state)));
        current.appendChild(line);
        if (state?.is_git) {
            const meta = [state.branch ? t('versionBranch', { branch: state.branch }) : t('versionDetached'), state.commit].filter(Boolean).join(' · ');
            current.appendChild(el('div', 'anomalous-version-meta', meta));
        }
        if (state?.dirty) {
            current.appendChild(el('div', 'anomalous-version-warning', t('versionDirtyWarning')));
        } else if (state && !state.is_git) {
            current.appendChild(el('div', 'anomalous-version-warning', t('versionError_not_git')));
        }
    };

    const blocked = () => !view.state?.is_git || view.state.dirty;

    const renderActions = () => {
        const check = button('anomalous-version-action primary', t('versionCheck'), () => loadReleases(true));
        const latest = button('anomalous-version-action', t('versionReturnLatest'), returnToLatest);
        latest.title = t('versionReturnLatestHint');
        const items = [check, latest];
        const previous = view.state?.previous;
        if (previous?.label) items.push(button('anomalous-version-action', t('versionUndo', { label: previous.label }), undoSwitch));
        for (const item of items.slice(1)) item.dataset.blocked = blocked() ? '1' : '0';
        check.dataset.blocked = view.state?.is_git ? '0' : '1';
        items.forEach(item => { item.disabled = view.busy || item.dataset.blocked === '1'; });
        actions.replaceChildren(...items);
    };

    const renderList = () => {
        const listing = view.listing;
        if (!listing) {
            list.replaceChildren(el('div', 'anomalous-version-empty', t('versionCheckHint')));
            return;
        }
        listBar.hidden = !listing.releases.some(item => item.prerelease);
        const releases = listing.releases.filter(item => prereleaseToggle.checked || !item.prerelease || item.current);
        list.replaceChildren(...releases.map(renderRelease));
        if (!releases.length) list.appendChild(el('div', 'anomalous-version-empty', t('versionNoReleases')));
    };

    const renderRelease = (release) => {
        const card = el('div', `anomalous-version-release${release.current ? ' is-current' : ''}`);
        const top = el('div', 'anomalous-version-release-top');
        const titleBox = el('div', 'anomalous-version-release-title');
        titleBox.append(el('strong', '', release.tag));
        if (release.name && release.name !== release.tag) titleBox.append(el('span', 'anomalous-version-release-name', release.name));
        const badges = el('div', 'anomalous-version-badges');
        if (release.current) badges.appendChild(el('span', 'anomalous-version-badge is-current', t('versionBadgeCurrent')));
        if (release.latest) badges.appendChild(el('span', 'anomalous-version-badge is-latest', t('versionBadgeLatest')));
        if (release.prerelease) badges.appendChild(el('span', 'anomalous-version-badge is-pre', t('versionBadgePrerelease')));
        const date = formatDate(release.published_at);
        if (date) badges.appendChild(el('span', 'anomalous-version-date', date));
        top.append(titleBox, badges);
        card.appendChild(top);

        const footer = el('div', 'anomalous-version-release-footer');
        if (release.notes) {
            const notes = el('pre', 'anomalous-version-notes', release.notes);
            notes.hidden = true;
            const toggle = button('anomalous-version-link', t('versionNotes'), () => {
                notes.hidden = !notes.hidden;
            });
            footer.appendChild(toggle);
            card.appendChild(notes);
        }
        if (release.url) {
            const link = el('a', 'anomalous-version-link', t('versionOpenGithub'));
            link.href = release.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            footer.appendChild(link);
        }
        if (!release.current) {
            const label = release.direction === 'newer' ? t('versionUpdateTo') : t('versionRollbackTo');
            const switchBtn = button(`anomalous-version-action${release.direction === 'newer' ? ' primary' : ''}`, label, () => switchTo(release));
            switchBtn.dataset.blocked = blocked() ? '1' : '0';
            switchBtn.disabled = view.busy || blocked();
            footer.appendChild(switchBtn);
        }
        card.appendChild(footer);
        return card;
    };

    const renderAll = () => {
        renderCurrent();
        renderActions();
        renderList();
    };

    const refreshState = async () => {
        const data = await request('/anomalous/version');
        if (data.success) view.state = data.state;
        if (chip && view.state) chip.textContent = view.state.tag || view.state.base_tag || view.state.label || chip.textContent;
    };

    const loadReleases = async (force) => {
        setBusy(true, t('versionChecking'));
        const data = await request(`/anomalous/version/releases${force ? '?refresh=1' : ''}`);
        if (scope.signal.aborted) return;
        setBusy(false);
        if (!data.success) {
            showError(data);
            renderAll();
            return;
        }
        view.state = data.state;
        view.listing = data;
        renderAll();
        const latest = data.releases.find(item => item.latest);
        status.textContent = latest?.current ? t('versionUpToDate') : (latest ? t('versionNewAvailable', { tag: latest.tag }) : '');
        if (data.source === 'git') status.textContent += ` ${t('versionSourceGit')}`;
    };

    /** Shared ending for every switch: tell the user to restart, offer Manager's restart. */
    const afterSwitch = async (result, successKey, params) => {
        await refreshState();
        view.listing = null;
        renderAll();
        if (!result.success) {
            showError(result);
            return;
        }
        if (chip) chip.textContent = `${chip.textContent} · ${t('versionPendingRestart')}`;
        status.textContent = t(successKey, params);
        const restart = await anomalousConfirm(`${t(successKey, params)}\n\n${t('versionRestartQuestion')}`, t('versionPanelTitle'), {
            okLabel: t('versionRestartNow'), cancelLabel: t('versionRestartLater'),
        });
        if (!restart) return;
        // ComfyUI Manager's reboot exits the server, so a dropped connection means it is restarting.
        // 404 (no Manager) or 403 (Manager security level) means the user restarts by hand.
        const reboot = await post('/api/manager/reboot');
        if (reboot.code === 'offline' || reboot.success !== false) {
            status.textContent = t('versionRestarting');
        } else {
            await anomalousAlert(t('versionRestartManual'));
        }
    };

    const switchTo = async (release) => {
        if (view.busy) return;
        setBusy(true, t('versionPreparing', { tag: release.tag }));
        const preview = await post('/anomalous/version/preview', { tag: release.tag });
        setBusy(false);
        if (scope.signal.aborted) return;
        if (!preview.success) {
            showError(preview);
            return;
        }
        const lines = [t(preview.direction === 'newer' ? 'versionConfirmUpdate' : 'versionConfirmRollback', { tag: release.tag, from: preview.from })];
        if (preview.direction !== 'newer') lines.push(t('versionRollbackDataWarning'));
        if (!preview.has_switcher) lines.push(t('versionNoPanelWarning', { tag: release.tag }));
        lines.push(t('versionRestartNote'));
        if (!await anomalousConfirm(lines.join('\n\n'), t('versionPanelTitle'))) return;
        setBusy(true, t('versionSwitching', { tag: release.tag }));
        const result = await post('/anomalous/version/switch', { tag: release.tag });
        setBusy(false);
        await afterSwitch(result, 'versionSwitched', { tag: release.tag });
    };

    const returnToLatest = async () => {
        if (view.busy) return;
        if (!await anomalousConfirm(`${t('versionConfirmLatest')}\n\n${t('versionRestartNote')}`, t('versionPanelTitle'))) return;
        setBusy(true, t('versionSwitching', { tag: 'main' }));
        const result = await post('/anomalous/version/latest');
        setBusy(false);
        await afterSwitch(result, 'versionReturnedLatest', {});
    };

    const undoSwitch = async () => {
        if (view.busy) return;
        const label = view.state?.previous?.label || '';
        if (!await anomalousConfirm(`${t('versionConfirmUndo', { label })}\n\n${t('versionRestartNote')}`, t('versionPanelTitle'))) return;
        setBusy(true, t('versionSwitching', { tag: label }));
        const result = await post('/anomalous/version/undo');
        setBusy(false);
        await afterSwitch(result, 'versionSwitched', { tag: label });
    };

    prereleaseToggle.onchange = renderList;
    panel.append(header, current, actions, status, listBar, list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    renderAll();
    refreshState().then(() => { if (!scope.signal.aborted) renderAll(); });
    return close;
}
