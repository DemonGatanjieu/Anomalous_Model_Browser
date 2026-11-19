/**
 * Pure normalization, filtering and same-model multi-version expansion for the reusable
 * model picker (ui_ai_model_pick.js). No DOM, no network.
 */

import { inFamily } from './model_bases.js';
import { groupByPage, pageId } from './model_versions.js';

const TYPE_ORDER = ['checkpoints', 'diffusion_models', 'unet', 'loras', 'vae', 'controlnet', 'clip', 'embeddings', 'upscale_models'];
const basename = value => String(value || '').split(':').pop().split(/[\\/]/).pop() || '';
const lower = value => String(value || '').trim().toLowerCase();

/** Normalizes any model record (`main_models`, `ai_toolbox_catalog`, library card) for `modelCardFace` and picker filters. */
export function adaptPickerModel(item) {
    const modelId = String(item?.model_id || item?.id || '');
    const file = String(item?.filename || item?.file || basename(modelId));
    const rawMeta = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const scannedBase = String(rawMeta.baseModel || item?.base || '').trim();
    const guessBase = String(rawMeta.base_guess || '').trim();
    const inferred = !scannedBase && Boolean(guessBase);
    const baseModel = scannedBase || guessBase;
    const displayName = String(rawMeta.custom_name || item?.name || item?.title || file);
    const previewUrl = String(item?.preview_url || item?.cover || '');
    const type = String(item?.type || (modelId.includes(':') ? modelId.split(':', 1)[0] : '')).trim();
    return {
        ...item,
        id: modelId,
        model_id: modelId,
        name: displayName,
        filename: file,
        file,
        folder: String(item?.folder ?? item?.subfolder ?? ''),
        type,
        base: baseModel,
        family: String(item?.family || ''),
        favourite: Boolean(item?.favourite),
        cover: previewUrl,
        preview_url: previewUrl,
        words: Array.isArray(item?.words) ? item.words : [],
        metadata: {
            ...rawMeta,
            custom_name: displayName,
            baseModel,
            base_guess: guessBase || baseModel,
            version_name: String(rawMeta.version_name || '').trim(),
            // The catalog says whether it was scanned (the card badge as on the Models page); other records guess.
            info_source: 'info_source' in rawMeta ? String(rawMeta.info_source || '') : (inferred ? 'local' : ''),
        },
    };
}

/** Distinct `[type, count]` entries in `models`, in standard ComfyUI folder priority order. */
export function modelTypes(models) {
    const counts = new Map();
    for (const item of models || []) {
        const kind = String(item?.type || '').trim();
        if (!kind) continue;
        counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    const rank = key => {
        const at = TYPE_ORDER.indexOf(key);
        return at >= 0 ? at : TYPE_ORDER.length;
    };
    return [...counts.entries()].sort((a, b) => (rank(a[0]) - rank(b[0])) || (b[1] - a[1]) || a[0].localeCompare(b[0]));
}

/** Filters adapted `models` by `query` (all whitespace terms across name/file/version/base/type/words), `type`, exact `baseFamily`, and `favouritesOnly`. */
export function filterPickerModels(models, { query = '', type = null, baseFamily = null, favouritesOnly = false } = {}) {
    const terms = lower(query).split(/\s+/).filter(Boolean);
    return (models || []).filter((item) => {
        if (type !== null && (item.type || '') !== type) return false;
        if (favouritesOnly && !item.favourite) return false;
        if (!inFamily(item, baseFamily)) return false;
        if (!terms.length) return true;
        const meta = item.metadata || {};
        const haystack = lower([
            item.name, item.filename, item.folder, item.type, item.family, item.base,
            meta.baseModel, meta.base_guess, meta.version_name, ...(item.words || []),
        ].join(' '));
        return terms.every(term => haystack.includes(term));
    });
}

/**
 * Groups sibling versions of the same Civitai page (`metadata.model_id`) together while keeping all
 * versions expanded side by side. Groups holding `priorityIds` come first, then favourite groups.
 */
export function expandModelGroups(models, priorityIds = []) {
    const priority = new Map((priorityIds || []).map((id, at) => [id, at]));
    const groups = groupByPage(models || []).map((entry, originalIndex) => {
        let bestPriority = Infinity;
        let hasFavourite = false;
        for (const version of entry.versions) {
            if (version.favourite) hasFavourite = true;
            const rank = priority.get(version.model_id);
            if (rank !== undefined && rank < bestPriority) bestPriority = rank;
        }
        return { entry, originalIndex, bestPriority, hasFavourite };
    });
    groups.sort((a, b) => (a.bestPriority - b.bestPriority)
        || (Number(b.hasFavourite) - Number(a.hasFavourite))
        || (a.originalIndex - b.originalIndex));
    const expanded = [];
    for (const { entry } of groups) {
        const size = entry.versions.length;
        const groupId = size > 1 ? String(pageId(entry.model)) : '';
        entry.versions.forEach((model, versionIndex) => {
            expanded.push({
                model,
                groupId,
                groupSize: size,
                versionIndex,
                isGroupStart: size > 1 && versionIndex === 0,
                isGroupEnd: size > 1 && versionIndex === size - 1,
            });
        });
    }
    return expanded;
}
