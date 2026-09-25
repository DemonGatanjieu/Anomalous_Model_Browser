import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { browseFolder } from './tts_setup_api.js';

/**
 * Choose a folder, or files, on the computer running ComfyUI. The browser cannot
 * see local paths, so the Anomalous_TTS node lists folders (`/anomalous_tts/browse`).
 * Resolves with the folder path, an array of file paths, or null when cancelled.
 */

const LAST_PATH_KEY = 'anomalous_tts_last_path';
export const PICKER_OVERLAY_CLASS = 'anomalous-tts-picker-overlay';
const FOLDER_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

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

function lastPath() {
    try { return localStorage.getItem(LAST_PATH_KEY) || ''; } catch (_) { return ''; }
}

function rememberPath(path) {
    try { localStorage.setItem(LAST_PATH_KEY, path); } catch (_) { /* convenience only */ }
}

export function formatSize(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * `mode`: 'folder' (resolve with the open folder) or 'files' (tick files, resolve with their paths).
 * `kinds` limits the files shown in 'files' mode (gpt, sovits, audio, text).
 */
export function pickServerPath({ mode = 'folder', title, hint = '', kinds = null } = {}) {
    return new Promise(resolve => {
        const scope = createViewScope();
        let result = null;
        let current = '';
        let token = 0;
        const picked = new Set();

        const overlay = el('div', `anomalous-voice-modal-overlay ${PICKER_OVERLAY_CLASS}`);
        const modal = el('div', 'anomalous-voice-modal anomalous-tts-picker');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const close = () => scope.dispose();
        scope.onDispose(() => { overlay.remove(); resolve(result); });
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        scope.listen(window, 'keydown', (e) => {
            if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
            e.stopPropagation();
            close();
        }, true);

        const header = el('div', 'anomalous-voice-modal-header');
        const heading = el('div', 'anomalous-voice-modal-heading');
        heading.append(el('div', 'anomalous-voice-modal-title', title || t(mode === 'folder' ? 'ttsPickFolderTitle' : 'ttsPickFilesTitle')));
        if (hint) heading.append(el('div', 'anomalous-voice-modal-subtitle', hint));
        header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));

        const pathInput = el('input', 'anomalous-tts-picker-path');
        pathInput.type = 'text';
        pathInput.placeholder = t('ttsPickPathPlaceholder');
        pathInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); open(pathInput.value.trim()); } };
        const upBtn = button('anomalous-tts-add', t('ttsPickUp'), () => open(upBtn.dataset.parent || ''));
        const goBtn = button('anomalous-tts-add', t('ttsPickGo'), () => open(pathInput.value.trim()));
        const bar = el('div', 'anomalous-tts-picker-bar');
        bar.append(upBtn, pathInput, goBtn);

        const list = el('div', 'anomalous-tts-picker-list');
        list.setAttribute('role', 'listbox');
        const status = el('div', 'anomalous-tts-hint');

        const footer = el('div', 'anomalous-voice-modal-footer');
        const confirm = button('anomalous-voice-modal-submit', '', () => {
            if (mode === 'folder') {
                if (!current) return;
                result = current;
            } else {
                if (!picked.size) return;
                result = [...picked];
            }
            rememberPath(current);
            close();
        });
        const syncConfirm = () => {
            confirm.textContent = mode === 'folder' ? t('ttsPickThisFolder') : t('ttsPickAddFiles', { count: picked.size });
            confirm.disabled = mode === 'folder' ? !current : !picked.size;
        };
        footer.append(button('anomalous-voice-modal-cancel', t('dialogCancel'), close), confirm);

        const fileRow = (folder, file) => {
            const path = `${folder.replace(/\/$/, '')}/${file.name}`;
            const row = el('label', 'anomalous-tts-picker-item is-file');
            const box = el('input');
            box.type = 'checkbox';
            box.checked = picked.has(path);
            box.onchange = () => { if (box.checked) picked.add(path); else picked.delete(path); syncConfirm(); };
            row.append(box, el('span', 'anomalous-tts-picker-name', file.name),
                el('span', 'anomalous-tts-kind', t(`ttsKind_${file.kind}`)), el('span', 'anomalous-tts-picker-meta', formatSize(file.size)));
            return row;
        };

        async function open(path) {
            const mine = ++token;
            status.textContent = t('audioLoading');
            status.classList.remove('is-error');
            try {
                const data = await browseFolder(path, scope.signal);
                if (mine !== token || scope.signal.aborted) return;
                current = data.path;
                pathInput.value = data.path;
                upBtn.disabled = data.parent === null;
                upBtn.dataset.parent = data.parent || '';
                const items = data.dirs.map(name => {
                    const target = data.path ? `${data.path.replace(/\/$/, '')}/${name}` : name;
                    const row = button('anomalous-tts-picker-item is-dir', '', () => open(target));
                    const icon = el('span', 'anomalous-tts-picker-icon');
                    icon.innerHTML = FOLDER_SVG;
                    row.append(icon, el('span', 'anomalous-tts-picker-name', name));
                    return row;
                });
                if (mode === 'files') {
                    items.push(...data.files.filter(f => !kinds || kinds.includes(f.kind)).map(f => fileRow(data.path, f)));
                }
                list.replaceChildren(...items);
                status.textContent = !items.length ? t('ttsPickEmpty') : data.truncated ? t('ttsPickTruncated') : '';
                syncConfirm();
            } catch (e) {
                if (mine !== token || scope.signal.aborted) return;
                if (path && path === initial && !current) { open(''); return; } // remembered folder is gone
                status.textContent = e.message || String(e);
                status.classList.add('is-error');
            }
        }

        modal.append(header, bar, list, status, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        syncConfirm();
        const initial = lastPath();
        open(initial);
        pathInput.focus();
    });
}
