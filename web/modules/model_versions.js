/**
 * Versions of one model (pure): files whose scan found the same Civitai model page (metadata.model_id)
 * are versions of one model, told apart by their version id. Only that id groups them, never a
 * similar file name: two files of one name may be unrelated, and versions often share a name.
 * Files not matched on Civitai stay on their own. ui_grid.js shows a group as one card with a
 * version switch, ui_model_versions.js draws the switch and the details' version row. freeName
 * names a version's download when its file name is taken (a download never replaces a file).
 */

const positive = value => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
};

/** The model's Civitai page id, or 0 when it has none. */
export const pageId = model => positive(model?.metadata?.model_id);

/** The model's Civitai version id, or 0. */
export const versionId = model => positive(model?.metadata?.version_id);

/** Newest first: Civitai's version ids grow with time; a file without one goes last, then by file name. */
function newestFirst(a, b) {
    return (versionId(b) - versionId(a)) || String(a.filename).localeCompare(String(b.filename));
}

/**
 * `models` as the list shows them: one entry a file, or a model page's files together, at the place
 * of the first of them. Each entry is { model, versions }: `versions` newest first (only the model
 * itself when it has no others), `model` the version `chosen(pageId)` names when it is among them,
 * else the newest.
 */
export function groupByPage(models, chosen = () => 0) {
    const entries = [];
    const byPage = new Map();
    for (const model of models || []) {
        const page = pageId(model);
        if (!page) {
            entries.push({ model, versions: [model] });
            continue;
        }
        let entry = byPage.get(page);
        if (!entry) {
            entry = { model, versions: [] };
            byPage.set(page, entry);
            entries.push(entry);
        }
        entry.versions.push(model);
    }
    for (const [page, entry] of byPage) {
        entry.versions.sort(newestFirst);
        const wanted = chosen(page);
        entry.model = entry.versions.find(model => wanted && versionId(model) === wanted) || entry.versions[0];
    }
    return entries;
}

/** The versions of `model` among `models` (itself included), newest first; just itself when it has no page. */
export function versionsOf(models, model) {
    const page = pageId(model);
    if (!page) return [model];
    const found = (models || []).filter(other => pageId(other) === page);
    if (!found.includes(model)) found.push(model);
    return found.sort(newestFirst);
}

/** `name` with `version` added before its extension, when a file of that name is here already. */
export function freeName(name, version, taken) {
    if (!taken.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    const tag = String(version || '').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'version';
    let candidate = `${stem}_${tag}${ext}`;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}_${tag}_${n}${ext}`;
    return candidate;
}
