import { t } from './interface_settings.js';
import { previewUrl } from './tts_setup_api.js';

/**
 * Listening to clips in the import window, while they upload or wait unassigned:
 * one clip at a time, its row marked and its button turned into "stop"; clicking
 * another clip switches to it, so clips can be compared one after another. Browser
 * files play from memory (`row.url`, an object URL the window revokes with the row);
 * local paths play through the node (`/anomalous_tts/import/preview`).
 */
export function createImportPlayer() {
    let audio = null;
    let current = null;

    const mark = (row, playing, error = '') => {
        const button = row?.els?.play;
        if (!button) return;
        button.textContent = playing ? '■' : '▶';
        button.title = error ? t('ttsPreviewFailed', { error }) : t(playing ? 'ttsPreviewStop' : 'audioPlay');
        button.setAttribute('aria-label', button.title);
        button.classList.toggle('is-failed', Boolean(error));
        row.els.root.classList.toggle('is-playing', playing);
    };

    function stop() {
        audio?.pause();
        audio = null;
        mark(current, false);
        current = null;
    }

    /** Play `row`, or stop it when it is the one playing. */
    function toggle(row) {
        if (current === row) { stop(); return; }
        stop();
        if (!row.file && !row.path) return;
        if (row.file) row.url = row.url || URL.createObjectURL(row.file);
        const mine = new Audio(row.file ? row.url : previewUrl(row.path));
        audio = mine;
        current = row;
        mark(row, true);
        const fail = (error) => {
            if (audio !== mine) return;
            audio = null;
            current = null;
            mark(row, false, error);
        };
        mine.onended = () => { if (audio === mine) stop(); };
        mine.onerror = () => fail(mine.error?.message || t('ttsPreviewUnreadable'));
        mine.play().catch(e => fail(e.message || String(e)));
    }

    return {
        toggle,
        stop,
        /** A row leaves the window: stop it if it is playing. */
        forget: (row) => { if (current === row) stop(); },
    };
}
