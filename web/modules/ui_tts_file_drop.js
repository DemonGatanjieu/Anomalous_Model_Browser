import { t } from './interface_settings.js';
import { importKind } from './tts_setup_api.js';
import { DROP_FILE_LIMIT, isPackage, skipFolder } from './tts_import_groups.js';

/**
 * Files dropped from the OS on the audio studio, the sidebar or the import
 * workbench: which character they were dropped on, and the folder each file came
 * from (dropped folders are walked), so the workbench can sort them.
 */

const readAll = reader => new Promise((ok, fail) => reader.readEntries(ok, fail));

/**
 * The entries of a drop, walked: `{ file, dir }` for each file an import can use,
 * `{ skipped: folder }` for a folder left out (tts_import_groups.js skipFolder: never
 * one that was dropped by itself), `{ truncated: true }` once `DROP_FILE_LIMIT` files
 * were taken. Other files are not even opened: a program folder holds thousands.
 */
async function walkEntries(entries, dir, inPackage, count) {
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const lists = await Promise.all(sorted.map(async (entry) => {
        const at = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isFile) {
            if (!importKind(entry.name)) return [];
            if (count.files >= DROP_FILE_LIMIT) { count.truncated = true; return []; }
            count.files++;
            return [{ file: await new Promise((ok, fail) => entry.file(ok, fail)), dir }];
        }
        if (inPackage !== null && skipFolder(entry.name, inPackage)) return [{ skipped: at }];
        const reader = entry.createReader();
        const children = [];
        for (;;) {
            const batch = await readAll(reader);
            if (!batch.length) break;
            children.push(...batch);
        }
        return walkEntries(children, at, isPackage(children.map(child => child.name)), count);
    }));
    return lists.flat(); // in name order, whatever finished first
}

/**
 * Files of a drop, with the folder each came from (dropped folders are walked).
 * The entries must be taken during the drop event, so call it synchronously there.
 * Several things dropped together are judged as one folder's contents.
 */
export function readDroppedFiles(dataTransfer) {
    const entries = [...(dataTransfer?.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return Promise.resolve([...(dataTransfer?.files || [])].map(file => ({ file, dir: '' })));
    const count = { files: 0, truncated: false };
    const together = entries.length > 1 ? isPackage(entries.map(entry => entry.name)) : null;
    return walkEntries(entries, '', together, count).then(list => (count.truncated ? [...list, { truncated: true }] : list));
}

/**
 * Let OS files be dropped on `root` (the studio or the sidebar). `onDrop(files, character)`
 * gets `{ file, dir }` items and the character of the card they were dropped on, or null.
 */
export function bindTtsFileDrop(root, onDrop) {
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    let marked = null;
    root.dataset.dropHint = t('ttsDropNew');
    const mark = (card) => {
        if (marked === card) return;
        marked?.classList.remove('is-file-target');
        card?.classList.add('is-file-target');
        marked = card;
        root.dataset.dropHint = card ? t('ttsDropAddTo', { name: card.dataset.ttsCharacter }) : t('ttsDropNew');
    };
    const cardAt = e => e.target?.closest?.('[data-tts-character]') || null;
    root.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        root.classList.add('is-file-dragover');
        mark(cardAt(e));
    });
    root.addEventListener('dragleave', (e) => {
        if (root.contains(e.relatedTarget)) return;
        root.classList.remove('is-file-dragover');
        mark(null);
    });
    root.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation(); // ComfyUI would try to open the files as a workflow
        const card = cardAt(e);
        root.classList.remove('is-file-dragover');
        mark(null);
        readDroppedFiles(e.dataTransfer).then(files => onDrop(files, card?.dataset.ttsCharacter || null));
    });
}
