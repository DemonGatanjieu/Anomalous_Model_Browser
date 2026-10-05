/**
 * Where a downloaded model goes inside its type's models folder (Model Check's downloads;
 * model_download.js, ui_model_download.js). The download settings say: where the workflow
 * says (its own subfolder, so the node needs no change; a bare name goes into the settings'
 * folder) or always the settings' folder, `{base}` there standing for the model's base model
 * (an existing folder of that name, in any spelling, is used). The file keeps the workflow's
 * name. No imports, so it is tested on its own.
 */

const UNSAFE_FORMATS = /\.(ckpt|pt|pth|bin)$/i;
// Civitai's base models -> the folder name most people use for them.
const BASE_FAMILIES = [
    [/^sd ?1\.[45]/i, 'SD1.5'], [/^sdxl/i, 'SDXL'], [/^sd ?3/i, 'SD3'], [/^pony/i, 'Pony'],
    [/^illustrious/i, 'Illustrious'], [/^noob/i, 'NoobAI'], [/^flux/i, 'Flux'], [/^hunyuan/i, 'Hunyuan'],
    [/^wan/i, 'Wan'], [/^qwen/i, 'Qwen'], [/^hidream/i, 'HiDream'], [/^chroma/i, 'Chroma'],
];

const slashes = (value) => String(value || '').replace(/\\/g, '/');
const fileName = (value) => slashes(value).split('/').pop();
const dirName = (value) => slashes(value).split('/').slice(0, -1).join('/');
const squash = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The folder name `{base}` stands for among `siblings` (the folders beside it): one of them
 * that names the model's base model, in any spelling, else the base model's usual name. */
export function baseFolder(baseModel, siblings = []) {
    const base = String(baseModel || '').trim();
    if (!base) return '';
    const family = BASE_FAMILIES.find(([pattern]) => pattern.test(base))?.[1] || base.replace(/[<>:"/\\|?*]+/g, ' ').replace(/ +/g, ' ').trim();
    const names = new Set([squash(family), squash(base)]);
    return siblings.find(name => names.has(squash(name))) || family;
}

/** The settings' folder with `{base}` filled in (dropped when the base model is unknown);
 * `subfolders` are the type folder's existing ones ("a", "a/b"). */
export function expandFolder(folder, baseModel, subfolders = []) {
    const parts = [];
    for (const raw of slashes(folder).split('/')) {
        let part = raw.trim();
        if (/\{base\}/i.test(part)) {
            const prefix = parts.join('/').toLowerCase();
            const siblings = subfolders.filter(path => dirName(path).toLowerCase() === prefix).map(fileName);
            part = part.replace(/\{base\}/gi, baseFolder(baseModel, siblings)).trim();
        }
        if (part) parts.push(part);
    }
    return parts.join('/');
}

/** Where in its type's folder an entry's file goes: "sub/folder/name.ext", '/' separated. */
export function destinationFor(entry, info, settings, subfolders = []) {
    const name = fileName(entry.value);
    const own = dirName(entry.value);
    if (settings?.place !== 'folder' && own) return `${own}/${name}`;
    const folder = expandFolder(settings?.folder ?? 'Downloads', info?.base_model, subfolders);
    return folder ? `${folder}/${name}` : name;
}

/** Whether a file of this kind can carry code that runs when it is loaded. */
export const unsafeFormat = (value) => UNSAFE_FORMATS.test(String(value || ''));
