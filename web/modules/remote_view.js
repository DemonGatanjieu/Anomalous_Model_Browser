/**
 * Opened from another device (ComfyUI started with --listen, or on a rented cloud server): a chip
 * in the header says so. Usually "view only" (the server refuses changes from other devices,
 * api/local_guard.py), and pressed it says how cloud users can still change things: an SSH tunnel,
 * or the allow_remote_changes file on the server, with the line to paste into the server's
 * terminal that makes it. With that file there, "remote changes on", marked, and pressed it says
 * that anyone who can open the page may change things, and gives the line that removes it.
 * Nothing shows on the computer ComfyUI runs on.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';

/** Asks the server once whether this page is on its computer; when not, marks the window and adds the chip to `group`. */
export async function markRemoteView(container, group) {
    let data = null;
    try {
        const response = await fetch('/anomalous/access', { cache: 'no-store' });
        data = response.ok ? await response.json() : null;
    } catch {
        return; // an older server without the route: nothing to say
    }
    if (!data || data.local !== false) return;
    const open = data.changes === true;
    if (!open) container.classList.add('anomalous-remote-view');
    // A span with a button's role and keys: the header's button rules (!important) would restyle a <button>.
    const chip = document.createElement('span');
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    chip.className = `anomalous-remote-chip${open ? ' is-open' : ''}`;
    chip.textContent = t(open ? 'remoteChangesChip' : 'remoteViewChip');
    chip.title = t('remoteChipTip');
    chip.onclick = () => anomalousAlert(t(open ? 'remoteChangesHint' : 'remoteViewHint'), chip.textContent, { copy: data.command });
    chip.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        chip.click();
    };
    group.append(chip);
}
