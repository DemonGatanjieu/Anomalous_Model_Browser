import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { importKind, scanFolder } from './tts_setup_api.js';
import { isSkippedFolder } from './tts_import_groups.js';
import { formatSize, pickServerPath } from './ui_tts_path_picker.js';

/**
 * Where the import window's files come from: the browser's file and folder dialogs
 * and drops (uploaded to the node), or the node's own picker (local paths, copied
 * without uploading). Files inside GPT-SoVITS program or training folders are left
 * out, and a very large upload first offers the node's picker instead: ComfyUI runs
 * on this computer, so copying from the path skips sending every byte twice.
 */

const ACCEPT = { gpt: '.ckpt', sovits: '.pth', audio: '.wav,.flac,.ogg,.mp3', text: '.txt,.lab,.list' };
const ACCEPT_ALL = Object.values(ACCEPT).join(',');
export const UPLOAD_WARN_BYTES = 2 * 1024 ** 3;
export const UPLOAD_WARN_FILES = 1500;

/** The first skipped folder on `dir` (`a/logs/b` → `a/logs`), or null. */
function skippedPart(dir) {
    const parts = String(dir || '').split('/');
    const at = parts.findIndex(isSkippedFolder);
    return at < 0 ? null : parts.slice(0, at + 1).join('/');
}

/**
 * `add(items, into)` puts `{ name, dir, file | path, size }` items into the window;
 * `note(text)` adds a line under the toolbar. Returns the hidden inputs to mount and
 * the ways to bring files in.
 */
export function createFileSources({ signal, add, note }) {
    let pickFor = null; // the draft the browser file dialog adds to, or null (sort by name)

    const chooseLocalFiles = async (kinds = null, into = null) => {
        const paths = await pickServerPath({ mode: 'files', title: t('ttsImportPickLocal'), hint: t('ttsImportPickLocalHint'), kinds });
        if (paths && !signal.aborted) add(paths.map(path => ({ name: path.split('/').pop(), dir: '', path })), into);
    };
    const chooseLocalFolder = async () => {
        const path = await pickServerPath({ mode: 'folder', title: t('ttsBatchPickLocalFolder'), hint: t('ttsBatchPickLocalFolderHint') });
        if (!path || signal.aborted) return;
        try {
            const result = await scanFolder(path, signal);
            add(result.files.map(file => ({ name: file.name, dir: file.dir, path: file.path, size: file.size })));
            if (result.truncated) note(t('ttsBatchScanTruncated', { count: result.files.length }));
        } catch (e) {
            if (!signal.aborted) await anomalousAlert(t('ttsSetupFailed', { error: e.message || String(e) }));
        }
    };

    /**
     * Browser files, `{ file, dir }` (or `{ skipped: folder }` for a folder a drop did
     * not go into). Leaves out program and training folders, and asks before a very
     * large upload.
     */
    async function takeFiles(list, into = null) {
        const skipped = new Set();
        const items = [];
        for (const item of list) {
            const part = item.skipped || skippedPart(item.dir);
            if (part) skipped.add(part);
            else items.push({ name: item.file.name, dir: item.dir || '', file: item.file });
        }
        const usable = items.filter(item => importKind(item.name));
        const bytes = usable.reduce((sum, item) => sum + item.file.size, 0);
        if (bytes > UPLOAD_WARN_BYTES || usable.length > UPLOAD_WARN_FILES) {
            const choice = await anomalousConfirm(t('ttsUploadLarge', { count: usable.length, size: formatSize(bytes) }),
                t('ttsUploadLargeTitle'), { okLabel: t('ttsUploadUseLocal'), noLabel: t('ttsUploadAnyway') });
            if (signal.aborted || choice === null) return;
            if (choice) { await chooseLocalFolder(); return; }
        }
        if (items.length) add(items, into);
        if (skipped.size) {
            const names = [...skipped];
            note(t('ttsSkippedFolders', { folders: names.slice(0, 3).join('、') + (names.length > 3 ? '…' : '') }));
        }
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
        takeFiles([...folderInput.files].map(file => ({ file, dir: file.webkitRelativePath.split('/').slice(0, -1).join('/') })));
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
        chooseLocalFiles,
        chooseLocalFolder,
        takeFiles,
    };
}
