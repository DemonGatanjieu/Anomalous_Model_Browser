import { t } from './interface_settings.js';
import { anomalousConfirm } from './ui_dialog.js';
import { formatSize, importKind } from './tts_setup_api.js';
import { DROP_FILE_LIMIT, sortOutFolders } from './tts_import_groups.js';

/**
 * Where the import window's files come from: the browser's file and folder dialogs
 * and drops, all uploaded to the node (it never reads a path on the computer).
 * Folders of Python environments, base models and a GPT-SoVITS package's program
 * and training runs are left out (tts_import_groups.js skipFolder), and the user is
 * told which; a very large upload is confirmed first. Every source gives each file's
 * folder starting with the folder that was chosen, so files are sorted the same
 * whichever way they came in.
 */

const ACCEPT = { gpt: '.ckpt', sovits: '.pth', audio: '.wav,.flac,.ogg,.mp3', text: '.txt,.lab,.list' };
const ACCEPT_ALL = Object.values(ACCEPT).join(',');
export const UPLOAD_WARN_BYTES = 2 * 1024 ** 3;
export const UPLOAD_WARN_FILES = 1500;

/** `a、b、c…`: the first few names of a list, in name order. */
function few(names) {
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    return sorted.slice(0, 3).join('、') + (sorted.length > 3 ? '…' : '');
}

/**
 * `add(items, into)` puts `{ name, dir, file }` items into the window;
 * `note(text)` adds a line under the toolbar. Returns the hidden inputs to mount and
 * the ways to bring files in.
 */
export function createFileSources({ signal, add, note }) {
    let pickFor = null; // the draft the browser file dialog adds to, or null (sort by name)

    /**
     * Browser files, `{ file, dir }`, with `{ skipped: folder }` and `{ truncated: true }`
     * markers from a drop (ui_tts_file_drop.js). Says what was left out, and asks before
     * a very large upload.
     */
    async function takeFiles(list, into = null) {
        const skipped = list.filter(item => item.skipped).map(item => item.skipped);
        const truncated = list.some(item => item.truncated);
        const items = list.filter(item => item.file).map(item => ({ name: item.file.name, dir: item.dir || '', file: item.file }));
        const usable = items.filter(item => importKind(item.name));
        const bytes = usable.reduce((sum, item) => sum + item.file.size, 0);
        if (bytes > UPLOAD_WARN_BYTES || usable.length > UPLOAD_WARN_FILES) {
            const ok = await anomalousConfirm(t('ttsUploadLarge', { count: usable.length, size: formatSize(bytes) }), t('ttsUploadLargeTitle'));
            if (signal.aborted || !ok) return;
        }
        if (items.length) add(items, into);
        if (skipped.length) note(t('ttsSkippedFolders', { folders: few(skipped) }));
        if (truncated) note(t('ttsBatchScanTruncated', { count: items.length }));
    }

    /** The browser's folder dialog lists every file: leave out the same folders a drop does. */
    function takeFolder(files) {
        const all = files.map(file => ({ file, name: file.name, dir: file.webkitRelativePath.split('/').slice(0, -1).join('/') }));
        const { kept, skipped } = sortOutFolders(all);
        const usable = kept.map(i => all[i]).filter(item => importKind(item.name));
        const list = usable.slice(0, DROP_FILE_LIMIT).map(item => ({ file: item.file, dir: item.dir }));
        takeFiles([...list, ...skipped.map(folder => ({ skipped: folder })), ...(usable.length > DROP_FILE_LIMIT ? [{ truncated: true }] : [])]);
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.onchange = () => {
        takeFiles([...fileInput.files].map(file => ({ file, dir: '' })), pickFor);
        fileInput.value = '';
    };
    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.webkitdirectory = true;
    folderInput.hidden = true;
    folderInput.onchange = () => {
        takeFolder([...folderInput.files]);
        folderInput.value = '';
    };
    const chooseFiles = (kinds = null, into = null) => {
        pickFor = into;
        fileInput.accept = kinds ? kinds.map(kind => ACCEPT[kind]).join(',') : ACCEPT_ALL;
        fileInput.click();
    };

    return {
        inputs: [fileInput, folderInput],
        chooseFiles,
        chooseFolder: () => folderInput.click(),
        takeFiles,
    };
}
