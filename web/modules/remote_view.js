/**
 * Opened from another device (ComfyUI started with --listen): a chip in the header says this
 * window can look but not change anything (the server refuses changes from other devices,
 * api/local_guard.py). Nothing shows on the computer ComfyUI runs on.
 */

import { translate as t } from './locales.js';

/** Asks the server once whether this page is on its computer; when not, marks the window and adds the chip to `group`. */
export async function markRemoteView(container, group) {
    try {
        const response = await fetch('/anomalous/access', { cache: 'no-store' });
        const data = response.ok ? await response.json() : null;
        if (!data || data.local !== false) return;
    } catch {
        return; // an older server without the route: nothing to say
    }
    container.classList.add('anomalous-remote-view');
    const chip = document.createElement('span');
    chip.className = 'anomalous-remote-chip';
    chip.textContent = t('remoteViewChip');
    chip.title = t('remoteViewHint');
    group.append(chip);
}
