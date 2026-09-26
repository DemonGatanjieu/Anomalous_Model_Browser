import { t } from './interface_settings.js';
import { isSkippedFolder } from './tts_import_groups.js';

/**
 * Files dropped from the OS on the audio studio, the sidebar or the import
 * workbench: which character they were dropped on, and the folder each file came
 * from (dropped folders are walked), so the workbench can sort them.
 */

/** GPT-SoVITS program and training folders inside a drop are not walked: `{ skipped: folder }`. */
async function walkEntry(entry, dir, top = false) {
    if (entry.isFile) return [{ file: await new Promise((ok, fail) => entry.file(ok, fail)), dir }];
    const sub = dir ? `${dir}/${entry.name}` : entry.name;
    if (!top && isSkippedFolder(entry.name)) return [{ skipped: sub }];
    const reader = entry.createReader();
    const children = [];
    for (;;) {
        const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        children.push(...batch);
    }
    return (await Promise.all(children.map(child => walkEntry(child, sub)))).flat();
}

/**
 * Files of a drop, with the folder each came from (dropped folders are walked).
 * The entries must be taken during the drop event, so call it synchronously there.
 */
export function readDroppedFiles(dataTransfer) {
    const entries = [...(dataTransfer?.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return Promise.resolve([...(dataTransfer?.files || [])].map(file => ({ file, dir: '' })));
    return Promise.all(entries.map(entry => walkEntry(entry, '', true))).then(lists => lists.flat());
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
