/**
 * Pictures dropped on, or pasted into, the AI workbench's message box (ui_ai_message.js): a file
 * from the computer, or a screenshot, is kept in the output folder's ai_inbox (POST
 * /anomalous/ai_pictures/upload, api/ai_pictures.py save_upload) and attached to the message; a
 * ComfyUI output picture dragged from the page (its /view address) is attached as it is. While
 * something is dragged over the box it says it takes it.
 */

import { translate as t } from './locales.js';
import { pictureItem } from './ui_ai_gallery_pick.js';

const TYPES = /^image\/(png|jpeg|webp|gif)$/;

async function upload(file) {
    const response = await fetch(`/anomalous/ai_pictures/upload?${new URLSearchParams({ name: file.name || '' })}`, {
        method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

/** An output picture of this ComfyUI named by a dropped address ("/view?filename=…&type=output"), or null. */
function outputOf(text) {
    try {
        const url = new URL(String(text || '').split('\n')[0].trim(), location.href);
        if (url.origin !== location.origin || !url.pathname.endsWith('/view') || (url.searchParams.get('type') || 'output') !== 'output') return null;
        const filename = url.searchParams.get('filename');
        return filename ? { filename, subfolder: url.searchParams.get('subfolder') || '' } : null;
    } catch (_) {
        return null;
    }
}

/**
 * Lets `box` take pictures: `add(item)` attaches one, `room()` says how many more fit, `say(text)`
 * tells the user what went wrong.
 */
export function takePictures(box, field, { add, room, say }) {
    box.dataset.drop = t('aiDropHere'); // the words over the box while something is dragged over it
    const take = async (files, address) => {
        const found = outputOf(address);
        if (found && !files.length) {
            add(pictureItem({ type: 'image', folder: 'output', ...found }, true));
            return;
        }
        const pictures = files.filter(file => TYPES.test(file.type));
        if (!pictures.length) {
            if (files.length) say(t('aiDropNotPicture'));
            return;
        }
        if (pictures.length > room()) say(t('aiPicsFull'));
        box.classList.add('is-uploading');
        try {
            for (const file of pictures.slice(0, Math.max(0, room()))) {
                const kept = await upload(file);
                add(pictureItem({ type: 'image', folder: 'output', filename: kept.filename, subfolder: kept.subfolder }, true));
            }
        } catch (error) {
            say(error.message);
        } finally {
            box.classList.remove('is-uploading');
        }
    };
    let depth = 0; // dragenter / dragleave also come from the box's children
    const carries = event => [...(event.dataTransfer?.types || [])].some(type => type === 'Files' || type === 'text/uri-list');
    box.addEventListener('dragenter', (event) => {
        if (!carries(event)) return;
        event.preventDefault();
        depth += 1;
        box.classList.add('is-dropping');
    });
    box.addEventListener('dragover', (event) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });
    box.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (!depth) box.classList.remove('is-dropping');
    });
    box.addEventListener('drop', (event) => {
        if (!carries(event)) return;
        event.preventDefault();
        depth = 0;
        box.classList.remove('is-dropping');
        void take([...(event.dataTransfer.files || [])], event.dataTransfer.getData('text/uri-list'));
    });
    field.addEventListener('paste', (event) => {
        const files = [...(event.clipboardData?.files || [])];
        if (!files.some(file => TYPES.test(file.type))) return; // words paste as words
        event.preventDefault();
        void take(files, '');
    });
}
