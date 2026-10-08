/**
 * The models page's Tidy check (api/model_placement.py): models in the wrong folder and
 * identical copies; moving a model to where it belongs, a copy to the Recycle Bin. No DOM.
 * The type bar's count is asked once and kept until something changes the folders.
 */

let counted = null;

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

/** { misplaced, duplicates, unchecked }; `deep` also reads same-size files never scanned. */
export const checkPlacement = (deep = false, signal) => json(`/anomalous/placement/check${deep ? '?deep=1' : ''}`, { signal });

/** The misplaced models the Tidy tab lists: not those that load where they are, nor an extra
 * copy of a file that is in the right folder (the identical files step has it). */
export function tidyMisplaced(data) {
    const key = (item) => `${item.type}|${item.root}|${item.rel}`;
    const extra = new Set(data.duplicates.filter(group => group.files.some(file => file.fits))
        .flatMap(group => group.files.filter(file => !file.fits).map(key)));
    return data.misplaced.filter(item => !item.works && !extra.has(key(item)));
}

/** How many things the Tidy tab has to show: listed misplaced models and groups of identical files. */
export function tidyCount() {
    counted ||= checkPlacement()
        .then(data => tidyMisplaced(data).length + data.duplicates.length)
        .catch(() => 0);
    return counted;
}

/** The folders changed (an import, a move, a deletion): count again next time. */
export function forgetTidyCount() {
    counted = null;
}

/** Moves `item` ({type, root, rel}) to `to` ({type, root, rel}); resolves to where it went. */
export async function moveModel(item, to) {
    const moved = await post('/anomalous/placement/move', {
        type: item.type, root: item.root, rel: item.rel, to_type: to.type, to_root: to.root, to_rel: to.rel,
    });
    forgetTidyCount();
    return moved;
}

/** Sends one copy ({type, root, rel}) with its covers and info to the Recycle Bin. */
export async function recycleModel(item) {
    const cut = item.rel.lastIndexOf('/');
    const data = await post('/anomalous/delete_model', {
        type: item.type, path_idx: item.root, subfolder: cut < 0 ? '/' : `/${item.rel.slice(0, cut)}`, filename: item.rel.slice(cut + 1),
    });
    if (data.status !== 'success') {
        const error = new Error(data.message || 'failed');
        error.code = 'unknown';
        throw error;
    }
    forgetTidyCount();
    return data;
}
