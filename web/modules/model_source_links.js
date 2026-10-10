/**
 * Where each model can be downloaded: the data and actions behind the Models page's
 * "Sources" view (ui_model_sources.js renders it). The models of the open workflow come
 * from its loader widgets; the library's from /anomalous/all_scan_models. A link is kept
 * in the model's own information (the editor's download link) and, for a model of the
 * open workflow, in the workflow too (extra.anomalous_model_sources), so a shared
 * workflow carries it.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { jsonResponse } from './ui_dom.js';
import { recordCanvasStep } from './canvas_history.js';
import { inferModelFolderTypes, isPhysicalRenameProtectedType } from './model_policies.js';
import { foundationModelType, shapeLibrarySourceModels, usableSourceUrl } from './model_source_data.js';

// A link's site, for its badge (the site's own colour).
const PLATFORMS = [
    [/civitai\.(com|red)/i, 'Civitai', '56, 189, 248'],
    [/huggingface\.co/i, 'HuggingFace', '251, 191, 36'],
    [/liblib/i, 'LiblibAI', '236, 72, 153'],
    [/modelscope\.cn/i, 'ModelScope', '168, 85, 247'],
    [/github\.com/i, 'GitHub', '52, 211, 153'],
    [/pan\.baidu|123pan|quark|lanzou/i, 'CloudNet', '6, 182, 212'],
];

export function detectPlatform(url) {
    const clean = typeof url === 'string' ? url.trim() : '';
    if (!clean) return null;
    const [, name, rgb] = PLATFORMS.find(([pattern]) => pattern.test(clean)) || [null, 'Web Link', ''];
    return rgb
        ? { name, color: `rgb(${rgb})`, bg: `rgba(${rgb}, 0.15)`, border: `rgba(${rgb}, 0.4)` }
        : { name, color: 'var(--amb-text-muted)', bg: 'transparent', border: 'var(--amb-border-strong)' };
}

export function isModelFilename(val) {
    return typeof val === 'string' && /\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$/i.test(val);
}

export function normalizeUrl(url) {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Whether the model's file is known here, so its own information can keep the link. */
export function canSaveLocalSource(model) {
    return !model.isMissing && Boolean(model.type) && (!foundationModelType(model) || model.nodeId == null || Boolean(model.file_path));
}

/** The models the open workflow's loader widgets name, one per node and file. */
export function collectWorkflowModels() {
    const models = [];
    const seen = new Set();
    const savedSources = app.graph?.extra?.anomalous_model_sources || {};
    const savedHashes = app.graph?.extra?.anomalous_hashes || {};

    for (const node of app.graph?._nodes || []) {
        if (!Array.isArray(node.widgets)) continue;
        for (const w of node.widgets) {
            const val = w.value;
            const folderTypes = inferModelFolderTypes(node, w);
            // Native component options such as TAESD need not have a file extension.
            const componentOption = /^(vae_name|clip_name\d*|clip_vision(?:_name)?|text_encoder(?:_name)?\d*)$/i.test(w.name || '')
                && folderTypes.some(isPhysicalRenameProtectedType)
                && typeof val === 'string' && val.trim() && val.toLowerCase() !== 'none';
            if (!isModelFilename(val) && !componentOption) continue;

            const key = `${node.id}_${val}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const basename = val.split(/[/\\]/).pop();
            const nativeValues = w.options?.values;
            const isMissing = Array.isArray(nativeValues)
                && !nativeValues.some(value => typeof value === 'string' && value.replaceAll('\\', '/') === val.replaceAll('\\', '/'));
            const hashObj = savedHashes[key] || savedHashes[val] || window.anomalous_hash_cache?.[val] || window.anomalous_hash_cache?.[basename] || {};
            const saved = savedSources[val] || savedSources[basename] || savedSources[key];
            const url = usableSourceUrl(typeof saved === 'string' ? saved : saved?.url)
                || usableSourceUrl(hashObj?.url) || usableSourceUrl(hashObj?.civitai_url);

            models.push({
                key, nodeId: node.id, nodeTitle: node.title || node.type || `#${node.id}`, nodeType: node.type,
                folderTypes, filename: val, basename, isMissing,
                hash: typeof hashObj === 'string' ? hashObj : (hashObj.hash || ''),
                url, initialUrl: url, platform: detectPlatform(url),
            });
        }
    }
    return models;
}

/** Every model in the folders the browser shows. */
export async function fetchAllLibraryModels(signal = null) {
    const res = await fetch('/anomalous/all_scan_models?limit=0', { signal });
    const payload = await jsonResponse(res, 'load library models');
    return shapeLibrarySourceModels(payload.models, detectPlatform);
}

/** Fills in where the workflow's models live here (type, folder) and links their information has. */
export async function resolveWorkflowModelsMetadata(models, signal = null) {
    if (!Array.isArray(models) || !models.length) return false;
    const components = models.filter(m => foundationModelType(m));
    const requestedPaths = models.filter(m => !foundationModelType(m)).map(m => m.filename);
    try {
        const res = await fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: requestedPaths }), signal,
        });
        const modelsMap = (await jsonResponse(res, 'resolve workflow models'))?.models || {};
        const componentModels = {};
        // The endpoint caps contextual lookups at 16; keep large workflows complete.
        for (let offset = 0; offset < components.length; offset += 16) {
            const response = await fetch('/anomalous/resolve_paths_to_previews', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
                body: JSON.stringify({ paths: [], context_requests: components.slice(offset, offset + 16).map(m => ({
                    key: m.key, path: m.relPath || m.filename, folder_types: m.folderTypes || [m.type], exact_only: true,
                })) }),
            });
            Object.assign(componentModels, (await jsonResponse(response, 'resolve component sources')).context_models || {});
        }
        let changed = false;
        for (const m of models) {
            const info = foundationModelType(m) ? componentModels[m.key] : modelsMap[m.filename] || modelsMap[m.basename];
            if (!info) continue;
            Object.assign(m, { type: info.type, subfolder: info.subfolder, path_idx: info.path_idx, file_path: info.file_path });
            if (foundationModelType(m)) m.isMissing = false;
            if (!m.hash && info.metadata?.hash) m.hash = info.metadata.hash;
            const resolvedUrl = usableSourceUrl(info.metadata?.source_url) || usableSourceUrl(info.metadata?.civitai_url);
            if (!m.url && resolvedUrl) Object.assign(m, { url: resolvedUrl, initialUrl: resolvedUrl, platform: detectPlatform(resolvedUrl) });
            if (window.anomalous_hash_cache && m.filename && info.metadata?.hash) {
                window.anomalous_hash_cache[m.filename] = { hash: info.metadata.hash, url: resolvedUrl };
            }
            changed = true;
        }
        return changed;
    } catch (e) {
        if (!signal?.aborted) console.warn('[AMB] Model sources: could not resolve the workflow\'s models.', e);
        return false;
    }
}

/** Writes `url` into the open workflow's sources for `model` ('' removes it); one Ctrl+Z step. */
function keepInWorkflow(model, url) {
    if (!app.graph) return false;
    app.graph.extra ||= {};
    const sources = { ...(app.graph.extra.anomalous_model_sources || {}) };
    if (url) {
        sources[model.filename] = { name: model.filename, url, platform: detectPlatform(url)?.name || 'Custom', nodeId: model.nodeId, hash: model.hash || '', updated_at: Date.now() };
    } else {
        delete sources[model.filename];
    }
    app.graph.extra.anomalous_model_sources = sources;
    app.canvas?.setDirty(true, true);
    recordCanvasStep(app);
    return true;
}

/**
 * Keeps a model's link: in its own information when the file is known here, and in the
 * open workflow for one of its models. Returns where: { local, workflow }.
 */
export async function saveModelSource(model, rawUrl) {
    const url = normalizeUrl(rawUrl);
    const where = { local: false, workflow: false };
    if (canSaveLocalSource(model)) {
        const res = await fetch('/anomalous/update_metadata', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: model.basename || model.filename.split(/[/\\]/).pop(),
                type: model.type, subfolder: model.subfolder ? `/${String(model.subfolder).replace(/^\/+/, '')}` : '/',
                path_idx: model.path_idx || 0, custom_source_url: url,
            }),
        });
        const payload = await jsonResponse(res, 'save model source');
        if (payload.status !== 'success') throw new Error(payload.message || 'save model source failed');
        where.local = true;
    }
    if (model.nodeId != null) where.workflow = keepInWorkflow(model, url);
    if (!where.local && !where.workflow) throw new Error(t('modelSourcesLocalTargetUnknown'));
    Object.assign(model, { url, initialUrl: url, platform: detectPlatform(url) });
    return where;
}

/** Puts every link the listed workflow models have into the workflow; how many. */
export function keepAllInWorkflow(models) {
    if (!app.graph) return 0;
    app.graph.extra ||= {};
    const sources = { ...(app.graph.extra.anomalous_model_sources || {}) };
    let count = 0;
    for (const m of models) {
        if (!m.url) continue;
        const url = normalizeUrl(m.url);
        sources[m.filename] = { name: m.filename, url, platform: detectPlatform(url)?.name || 'Custom', nodeId: m.nodeId, hash: m.hash || '', updated_at: Date.now() };
        count++;
    }
    app.graph.extra.anomalous_model_sources = sources;
    app.canvas?.setDirty(true, true);
    recordCanvasStep(app);
    return count;
}

const timestamp = () => {
    const now = new Date();
    const two = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
};

/** The list as lines: one model and its link each. */
function sourceLines(models, link) {
    return models.map((m, idx) => {
        const source = m.url || (foundationModelType(m) ? t('modelSourcesStatusUnfilledOptional') : t('modelSourcesStatusUnfilled'));
        return link(m, idx, source);
    });
}

/** A Note node on the canvas listing the workflow's models and links, above the others. */
export function createCanvasNoteNode(models) {
    const creator = globalThis.LiteGraph?.createNode;
    const noteNode = models.length && typeof creator === 'function' ? creator.call(globalThis.LiteGraph, 'Note') : null;
    if (!noteNode) return null;
    const lines = sourceLines(models, (m, idx, source) => `[${idx + 1}] ${m.nodeTitle || m.nodeType || 'Model'}\n    ${t('modelSourcesNoteFile')}: ${m.filename}\n    ${t('modelSourcesNoteLink')}: ${source}`);
    const text = `${t('modelSourcesNoteTitle')}\n${timestamp()} · ${t('modelSourcesNoteCount', { count: models.length })}\n\n${lines.join('\n\n')}`;
    noteNode.title = t('modelSourcesNoteTitle');
    if (noteNode.widgets?.length) noteNode.widgets[0].value = text;
    let minX = Infinity;
    let minY = Infinity;
    for (const n of app.graph._nodes || []) {
        if (!n.pos) continue;
        minX = Math.min(minX, n.pos[0]);
        minY = Math.min(minY, n.pos[1]);
    }
    if (!Number.isFinite(minX)) { minX = 100; minY = 100; }
    noteNode.pos = [minX, minY - 320];
    noteNode.size = [480, 260];
    app.graph.add(noteNode);
    app.canvas?.setDirty(true, true);
    recordCanvasStep(app);
    return noteNode;
}

/** The list as Markdown on the clipboard. */
export async function copySourcesSummary(models) {
    const lines = sourceLines(models, (m, idx, source) => `${idx + 1}. **${m.nodeTitle || m.type || ''}** \`${m.basename || m.filename}\` — ${source}`);
    await navigator.clipboard.writeText(`### ${t('modelSourcesNoteTitle')}\n\n${lines.join('\n')}\n`);
}

export function openExternalUrl(rawUrl) {
    const normalized = normalizeUrl(rawUrl);
    if (normalized) window.open(normalized, '_blank', 'noopener,noreferrer');
}

/** A link for a model without one: its local information, else Civitai by hash; '' when none. */
export async function autoDetectModelSource(item) {
    if (foundationModelType(item)) {
        await resolveWorkflowModelsMetadata([item]);
        return item.url || '';
    }
    try {
        const queryPath = item.filename || item.basename;
        const res = await fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: [queryPath, item.basename].filter(Boolean) }),
        });
        const data = await jsonResponse(res, 'detect model source local');
        const resolved = data?.models?.[queryPath] || data?.models?.[item.basename];
        if (resolved) {
            Object.assign(item, { type: resolved.type, subfolder: resolved.subfolder, path_idx: resolved.path_idx });
            if (resolved.metadata?.hash) item.hash = resolved.metadata.hash;
            const found = usableSourceUrl(resolved.metadata?.source_url) || usableSourceUrl(resolved.metadata?.civitai_url);
            if (found) return found;
        }
    } catch (e) {
        // the local lookup failed; Civitai by hash may still know it
    }
    if (item.hash) {
        try {
            const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${item.hash}`);
            if (res.ok) {
                const data = await res.json();
                if (data.modelId) {
                    const domain = (data.model?.nsfw || data.nsfwLevel > 1) ? 'civitai.red' : 'civitai.com';
                    return `https://${domain}/models/${data.modelId}${data.id ? `?modelVersionId=${data.id}` : ''}`;
                }
            }
        } catch (e) {
            // no connection: nothing found
        }
    }
    // A search-results page is not a model source.
    return '';
}
