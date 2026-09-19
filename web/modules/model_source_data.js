import { isPhysicalRenameProtectedType } from './model_policies.js';

export function usableSourceUrl(value) {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url) return '';
    const civitaiModel = url.match(/^https?:\/\/(?:www\.)?civitai\.(?:com|red)\/models\/(-?\d+)(?:[/?#]|$)/i);
    if (civitaiModel && Number(civitaiModel[1]) <= 0) return '';
    return url;
}

export function foundationModelType(model) {
    const candidates = Array.isArray(model?.folderTypes) ? [...model.folderTypes] : [];
    if (model?.type) candidates.push(model.type);
    return candidates.find(isPhysicalRenameProtectedType) || '';
}

export function shapeLibrarySourceModels(rawList, detectPlatform) {
    return (Array.isArray(rawList) ? rawList : []).map(m => {
        const meta = m.metadata || {};
        const sourceUrl = usableSourceUrl(meta.source_url);
        const civitaiUrl = usableSourceUrl(meta.civitai_url);
        const url = sourceUrl || civitaiUrl;
        const relPath = m.subfolder ? `${m.subfolder}/${m.filename}` : m.filename;
        return {
            key: `lib_${m.type}_${m.path_idx}_${relPath}`,
            type: m.type,
            path_idx: m.path_idx,
            subfolder: m.subfolder || '',
            filename: m.filename,
            basename: m.filename,
            relPath,
            size_mb: m.size_mb || 0,
            hash: meta.hash || '',
            civitai_url: civitaiUrl,
            source_url: sourceUrl,
            url,
            initialUrl: url,
            platform: detectPlatform(url),
            hasResolved: Boolean(url.trim()),
        };
    });
}

function matchesSearch(model, keyword) {
    if (!keyword) return true;
    const haystack = `${model.nodeTitle || ''} ${model.nodeType || ''} ${model.type || ''} ${model.filename || ''} ${model.basename || ''}`.toLowerCase();
    return haystack.includes(keyword);
}

export function partitionSourceModels(models, filter = 'all', searchKeyword = '') {
    const allModels = Array.isArray(models) ? models : [];
    const allComponents = allModels.filter(model => Boolean(foundationModelType(model)));
    const allMain = allModels.filter(model => !foundationModelType(model));
    const matchesFilter = model => {
        if (filter === 'resolved' && !model.url) return false;
        if (filter === 'unresolved' && model.url) return false;
        return matchesSearch(model, searchKeyword);
    };
    const mainModels = allMain.filter(matchesFilter);
    const componentModels = allComponents.filter(matchesFilter);
    return {
        mainModels,
        componentModels,
        allComponentCount: componentModels.length,
        componentMissingCount: componentModels.filter(model => model.isMissing === true).length,
    };
}
