import { isPhysicalRenameProtectedType } from './model_policies.js';

export function foundationModelType(model) {
    const candidates = Array.isArray(model?.folderTypes) ? [...model.folderTypes] : [];
    if (model?.type) candidates.push(model.type);
    return candidates.find(isPhysicalRenameProtectedType) || '';
}

export function shapeLibrarySourceModels(rawList, detectPlatform) {
    return (Array.isArray(rawList) ? rawList : []).map(m => {
        const meta = m.metadata || {};
        const url = meta.source_url || meta.civitai_url || '';
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
            civitai_url: meta.civitai_url || '',
            source_url: meta.source_url || '',
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
    const mainModels = allMain.filter(model => {
        if (filter === 'resolved' && !model.url) return false;
        if (filter === 'unresolved' && model.url) return false;
        return matchesSearch(model, searchKeyword);
    });
    return {
        mainModels,
        componentModels: allComponents.filter(model => matchesSearch(model, searchKeyword)),
        allComponentCount: allComponents.length,
        componentMissingCount: allComponents.filter(model => model.isMissing === true).length,
    };
}
