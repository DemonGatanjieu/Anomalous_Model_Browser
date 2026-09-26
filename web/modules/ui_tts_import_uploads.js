import { uploadFile } from './tts_setup_api.js';

/**
 * The import window's uploads: browser files go to the node in chunks, a few files at
 * a time, in the order they were queued. A row is `{ file, controller, uploadId,
 * progress, spec, error }` (ui_tts_import.js); an aborted row is dropped. `onProgress(row)`
 * repaints the row; `onDone(row)` runs once it is uploaded (`spec` set) or failed (`error`).
 */

const UPLOADS_AT_ONCE = 3;

export function createUploadQueue({ onProgress, onDone }) {
    const queue = [];
    let running = 0;

    async function upload(row) {
        try {
            await uploadFile(row.file, {
                signal: row.controller.signal,
                onStart: (id) => { row.uploadId = id; },
                onProgress: (fraction) => { row.progress = fraction; onProgress(row); },
            });
            row.spec = { upload: row.uploadId };
        } catch (e) {
            if (row.controller.signal.aborted) return;
            row.error = e.message || String(e);
        }
        onDone(row);
    }

    function pump() {
        while (running < UPLOADS_AT_ONCE && queue.length) {
            const row = queue.shift();
            if (row.controller.signal.aborted) continue;
            running++;
            upload(row).finally(() => { running--; pump(); });
        }
    }

    return {
        add: (row) => { queue.push(row); pump(); },
        /** The window closes: nothing more starts (running uploads stop through their rows' controllers). */
        clear: () => { queue.length = 0; },
    };
}
