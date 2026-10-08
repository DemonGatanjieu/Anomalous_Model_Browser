/**
 * Model import (the models page's Import chip, and model files dropped on the models page):
 * what each file is and where it goes, then putting it there (api/model_import.py does the
 * file work; ui_model_import.js shows it). No DOM.
 *
 * A browser never says where a dropped file is. The server looks for the same file (name,
 * size, time) in this computer's Downloads and Desktop and moves it from there; a file it does
 * not find is uploaded (a copy). Imported files go where the download settings put downloads
 * (`{base}` = the base model's folder), then get scanned like downloads.
 */

import { app } from "../../../scripts/app.js";
import { expandFolder } from './download_places.js';
import { startScan, targetsForItems } from './scan_runner.js';

export const MODEL_FILE = /\.(safetensors|sft|gguf|ckpt|pt|pth|bin)$/i;
const MAX_HEADER = 100 * 1024 * 1024;
const GGUF_READ = 16 * 1024 * 1024;

async function json(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.code = data.error || 'http';
        throw error;
    }
    return data;
}

const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** The model files among dropped or picked files. */
export const modelFiles = (files) => [...(files || [])].filter(file => MODEL_FILE.test(file.name));

/** The file's header bytes: a .safetensors header, the start of a .gguf, nothing for the rest
 * (formats that can carry code are never read). */
async function readHead(file) {
    if (/\.(safetensors|sft)$/i.test(file.name)) {
        if (file.size < 8) return new Blob();
        const start = new DataView(await file.slice(0, 8).arrayBuffer());
        const size = Number(start.getBigUint64(0, true));
        return size > MAX_HEADER ? new Blob() : file.slice(0, 8 + size);
    }
    if (/\.gguf$/i.test(file.name)) return file.slice(0, GGUF_READ);
    return new Blob();
}

/** { types: { type: roots }, settings }: where models can go, and the download folder rule. */
export const fetchImportFolders = () => json('/anomalous/import/folders');

/** What `file` is: { kind, base, sure, same_name, token?, where? } (token: found on this computer). */
export async function inspectFile(file) {
    const params = new URLSearchParams({ name: file.name, size: String(file.size), mtime: String(file.lastModified || 0) });
    return json(`/anomalous/import/inspect?${params}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readHead(file),
    });
}

/** A found file's SHA-256, Civitai's record of it and an already scanned copy (slow: reads it all). */
export const identifyFile = (token) => post('/anomalous/import/identify', { token });

/** Where a file goes inside its type folder: the download settings' folder with {base} filled. */
export function importDestination(name, base, settings, subfolders = []) {
    const folder = expandFolder(settings?.folder ?? '{base}', base, subfolders);
    return folder ? `${folder}/${name}` : name;
}

/** Moves (or with `keep` copies) a found file to `choice` = { type, root, rel }. */
export const placeFile = (token, choice, keep) => post('/anomalous/import/place', { token, ...choice, keep: Boolean(keep) });

/** Uploads `file` to `choice`; `onProgress(sent, total)`. Resolves to where it went; rejects with `.code`. */
export function uploadFile(file, choice, onProgress) {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({ type: choice.type, root: String(choice.root), rel: choice.rel, size: String(file.size) });
        const request = new XMLHttpRequest();
        request.open('PUT', `/anomalous/import/upload?${params}`);
        request.setRequestHeader('Content-Type', 'application/octet-stream');
        request.upload.onprogress = (event) => onProgress?.(event.loaded, event.total || file.size);
        request.onload = () => {
            let data = {};
            try { data = JSON.parse(request.responseText || '{}'); } catch { /* not JSON */ }
            if (request.status >= 200 && request.status < 300) return resolve(data);
            const error = new Error(data.error || `HTTP ${request.status}`);
            error.code = data.error || 'http';
            reject(error);
        };
        request.onerror = () => {
            const error = new Error('network');
            error.code = 'network';
            reject(error);
        };
        request.send(file);
    });
}

/** After a batch was put in place: ComfyUI's model lists, the models page, then one scan of the new files. */
export async function afterImport(owner, placed) {
    if (!placed.length) return;
    try {
        await app.refreshComboInNodes?.();
    } catch (error) {
        console.warn('[AMB] Import: could not reload the model lists.', error);
    }
    owner.loadFolders?.(); // the type counts, then the cards
    const items = placed.map(item => ({ type: item.type, path_idx: item.root, rel: item.rel, filename: item.file }));
    await startScan(owner, { targets: targetsForItems(items) });
}
