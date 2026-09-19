/**
 * ui_model_sources.js
 * 模型来源统一中控中心 (Model Source Hub)
 * 
 * 核心功能：
 * 1. 查看/编辑当前工作流中用到的模型来源链接 (Workflow Scope)
 * 2. 盘点本地全部模型库已识别/缺失信息状态 (Library Scope)
 * 3. 一键在画布生成原生 ComfyUI Note 便签节点 (显式工作流节点)
 * 4. 同步/保存来源元数据至工作流 JSON/PNG extra 字段 (隐式元数据)
 * 5. 一键浏览器直达对应发布页 (Civitai / Hugging Face / Liblib / 网盘等)
 * 6. 持久化自定义链接至本地模型 .civitai.info (全系统自动回退)
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse } from './ui_dom.js';
import { createViewScope } from './ui_lifecycle.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { inferModelFolderTypes, isPhysicalRenameProtectedType } from './model_policies.js';
import { foundationModelType, partitionSourceModels, shapeLibrarySourceModels, usableSourceUrl } from './model_source_data.js';

let activeSourcesModalScope = null;

export function detectPlatform(url) {
    if (!url || typeof url !== 'string') return null;
    const clean = url.trim();
    if (!clean) return null;
    if (/civitai\.(com|red)/i.test(clean)) return { name: 'Civitai', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)', border: 'rgba(56,189,248,0.4)' };
    if (/huggingface\.co/i.test(clean)) return { name: 'HuggingFace', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)' };
    if (/liblib/i.test(clean)) return { name: 'LiblibAI', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.4)' };
    if (/modelscope\.cn/i.test(clean)) return { name: 'ModelScope', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.4)' };
    if (/github\.com/i.test(clean)) return { name: 'GitHub', color: '#34d399', bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.4)' };
    if (/pan\.baidu|123pan|quark|lanzou/i.test(clean)) return { name: 'CloudNet', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.4)' };
    return { name: 'Web Link', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.3)' };
}

export function isModelFilename(val) {
    return typeof val === 'string' && /\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$/i.test(val);
}

export function normalizeUrl(url) {
    if (!url) return '';
    let trimmed = url.trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = 'https://' + trimmed;
    }
    return trimmed;
}

function foundationType(model) {
    return foundationModelType(model);
}

function canSaveLocalSource(model) {
    return !model.isMissing && (!foundationType(model) || model.nodeId == null || Boolean(model.file_path));
}

/** 提取当前画布上所有正在使用的模型 */
export function collectWorkflowModels() {
    const models = [];
    const seen = new Set();
    const liveNodes = app.graph?._nodes || [];
    const savedSources = app.graph?.extra?.anomalous_model_sources || {};
    const savedHashes = app.graph?.extra?.anomalous_hashes || {};

    for (const node of liveNodes) {
        if (!Array.isArray(node.widgets)) continue;
        for (const w of node.widgets) {
            const val = w.value;
            const folderTypes = inferModelFolderTypes(node, w);
            // Native component options such as TAESD need not have a file extension.
            const componentOption = /^(vae_name|clip_name\d*|clip_vision(?:_name)?|text_encoder(?:_name)?\d*)$/i.test(w.name || '')
                && folderTypes.some(isPhysicalRenameProtectedType)
                && typeof val === 'string' && val.trim() && val.toLowerCase() !== 'none';
            if (!isModelFilename(val) && !componentOption) continue;

            const dedupeKey = `${node.id}_${val}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const basename = val.split(/[/\\]/).pop();
            const nativeValues = w.options?.values;
            const isMissing = Array.isArray(nativeValues)
                && !nativeValues.some(value => typeof value === 'string' && value.replaceAll('\\', '/') === val.replaceAll('\\', '/'));
            const hashObj = savedHashes[dedupeKey] || savedHashes[val] || window.anomalous_hash_cache?.[val] || window.anomalous_hash_cache?.[basename] || {};
            const hash = typeof hashObj === 'string' ? hashObj : (hashObj.hash || '');

            const existingSource = savedSources[val] || savedSources[basename] || savedSources[dedupeKey];
            let url = usableSourceUrl(typeof existingSource === 'string' ? existingSource : existingSource?.url)
                || usableSourceUrl(hashObj?.url) || usableSourceUrl(hashObj?.civitai_url);

            models.push({
                key: dedupeKey,
                nodeId: node.id,
                nodeTitle: node.title || node.type || `Node #${node.id}`,
                nodeType: node.type,
                folderTypes,
                filename: val,
                basename,
                isMissing,
                hash,
                url,
                initialUrl: url,
                platform: detectPlatform(url),
            });
        }
    }
    return models;
}

/** 异步盘点本地全部模型库 */
export async function fetchAllLibraryModels(signal = null) {
    const res = await fetch('/anomalous/all_scan_models?limit=0', { signal });
    const payload = await jsonResponse(res, 'load library models');
    return shapeLibrarySourceModels(payload.models, detectPlatform);
}

/** 在 ComfyUI 画布生成原生 Note 便签节点 */
export function createCanvasNoteNode(models) {
    if (!models.length) return false;
    const creator = (typeof LiteGraph !== 'undefined' ? LiteGraph?.createNode : null) || globalThis.LiteGraph?.createNode || (typeof window !== 'undefined' ? window.LiteGraph?.createNode : null);
    if (typeof creator !== 'function') return false;

    const noteNode = creator('Note');
    if (!noteNode) return false;

    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let textContent = `═══════════════════════════════════════════════════════════════\n`;
    textContent += `📋 工作流模型来源与下载直达 (Workflow Models & Sources)\n`;
    textContent += `═══════════════════════════════════════════════════════════════\n`;
    textContent += `• 生成时间: ${timeStr}\n`;
    textContent += `• 模型总数: ${models.length} 个\n`;
    textContent += `───────────────────────────────────────────────────────────────\n\n`;

    models.forEach((m, idx) => {
        textContent += `[${idx + 1}] ${m.nodeTitle || m.nodeType || 'Model'}\n`;
        textContent += `    文件: ${m.filename}\n`;
        if (m.url) {
            textContent += `    来源: ${m.url}\n`;
        } else if (foundationType(m)) {
            textContent += `    来源: ${t('modelSourcesStatusUnfilledOptional')}\n`;
        } else {
            textContent += `    来源: ⚠️ 未配置来源发布页\n`;
        }
        if (m.hash) {
            textContent += `    哈希: ${m.hash.slice(0, 16)}...\n`;
        }
        textContent += `\n`;
    });

    textContent += `───────────────────────────────────────────────────────────────\n`;
    textContent += `由 Anomalous Model Browser 模型来源中控中心一键生成`;

    noteNode.title = window.anomalous_browser_lang === 'zh' ? '📋 模型来源清单 (Sources)' : '📋 Model Sources';
    if (Array.isArray(noteNode.widgets) && noteNode.widgets.length > 0) {
        noteNode.widgets[0].value = textContent;
    }

    // 计算合适坐标（排在画布最上方或靠左侧）
    let minX = Infinity;
    let minY = Infinity;
    for (const n of app.graph._nodes || []) {
        if (n.pos) {
            if (n.pos[0] < minX) minX = n.pos[0];
            if (n.pos[1] < minY) minY = n.pos[1];
        }
    }
    if (!Number.isFinite(minX)) { minX = 100; minY = 100; }
    noteNode.pos = [minX, minY - 320];
    noteNode.size = [480, 260];

    app.graph.add(noteNode);
    app.canvas?.setDirty(true, true);
    return noteNode;
}

/** 同步来源至工作流元数据 (extra.anomalous_model_sources) */
export function syncWorkflowSources(models) {
    if (!app.graph) return { count: 0, isUpdate: false };
    app.graph.extra ||= {};
    const existing = app.graph.extra.anomalous_model_sources || {};
    const isUpdate = Object.keys(existing).length > 0;

    const updatedMap = { ...existing };
    let savedCount = 0;

    for (const m of models) {
        if (!m.url) continue;
        const normalized = normalizeUrl(m.url);
        updatedMap[m.filename] = {
            name: m.filename,
            url: normalized,
            platform: detectPlatform(normalized)?.name || 'Custom',
            nodeId: m.nodeId,
            hash: m.hash || '',
            updated_at: Date.now(),
        };
        m.url = normalized;
        m.initialUrl = normalized;
        m.platform = detectPlatform(normalized);
        savedCount++;
    }

    app.graph.extra.anomalous_model_sources = updatedMap;
    app.canvas?.setDirty(true, true);
    return { count: savedCount, isUpdate };
}

/** 复制 Markdown 格式清单 */
export async function copySourcesSummary(models) {
    if (!models.length) return;
    let md = `### 📋 工作流模型下载来源清单 (Workflow Models & Sources)\n\n`;
    models.forEach((m, idx) => {
        const plat = m.platform ? `[${m.platform.name}]` : '';
        md += `${idx + 1}. **${m.nodeTitle || m.nodeType}** \`${m.basename || m.filename}\`\n`;
        if (m.url) {
            md += `   - 来源链接: ${plat} ${m.url}\n`;
        } else if (foundationType(m)) {
            md += `   - 来源链接: ${t('modelSourcesStatusUnfilledOptional')}\n`;
        } else {
            md += `   - 来源链接: ⚠️ 未指定\n`;
        }
    });
    await navigator.clipboard.writeText(md);
}

/** 保存单个模型自定义链接到本地 .civitai.info */
export async function saveSingleModelToLocalSidecar(item, url) {
    if (!canSaveLocalSource(item)) throw new Error(t('modelSourcesLocalTargetUnknown'));
    const cleanUrl = normalizeUrl(url);
    const targetFilename = item.basename || (item.filename ? item.filename.split(/[/\\]/).pop() : '');
    const body = {
        filename: targetFilename,
        type: item.type || 'checkpoints',
        subfolder: item.subfolder || '/',
        path_idx: item.path_idx || 0,
        custom_source_url: cleanUrl,
    };
    const res = await fetch('/anomalous/update_metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return jsonResponse(res, 'save custom source url');
}

/** 一键打开外部链接 */
export function openExternalUrl(rawUrl) {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return;
    window.open(normalized, '_blank', 'noopener,noreferrer');
}

/** 异步解析工作流中模型的本地元数据与路径详情 */
export async function resolveWorkflowModelsMetadata(models, signal = null) {
    if (!Array.isArray(models) || !models.length) return false;
    const components = models.filter(m => foundationType(m));
    const requestedPaths = models.filter(m => !foundationType(m)).map(m => m.filename);
    try {
        const res = await fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: requestedPaths }),
            signal,
        });
        const data = await jsonResponse(res, 'resolve workflow models');
        const modelsMap = data?.models || {};
        const componentModels = {};
        // The endpoint caps contextual lookups at 16; keep large workflows complete.
        for (let offset = 0; offset < components.length; offset += 16) {
            const response = await fetch('/anomalous/resolve_paths_to_previews', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
                body: JSON.stringify({ paths: [], context_requests: components.slice(offset, offset + 16).map(m => ({
                    key: m.key, path: m.relPath || m.filename, folder_types: m.folderTypes || [m.type], exact_only: true,
                })) }),
            });
            const batch = await jsonResponse(response, 'resolve component sources');
            Object.assign(componentModels, batch.context_models || {});
        }
        let hasChanges = false;

        for (const m of models) {
            const info = foundationType(m) ? componentModels[m.key] : modelsMap[m.filename] || modelsMap[m.basename];
            if (info) {
                m.type = info.type;
                m.subfolder = info.subfolder;
                m.path_idx = info.path_idx;
                m.file_path = info.file_path;
                hasChanges = true;
                if (foundationType(m)) m.isMissing = false;
                if (!m.hash && info.metadata?.hash) {
                    m.hash = info.metadata.hash;
                    hasChanges = true;
                }
                const resolvedUrl = usableSourceUrl(info.metadata?.source_url)
                    || usableSourceUrl(info.metadata?.civitai_url);
                if (!m.url && resolvedUrl) {
                    m.url = resolvedUrl;
                    m.initialUrl = resolvedUrl;
                    m.platform = detectPlatform(resolvedUrl);
                    hasChanges = true;
                }
                if (typeof window !== 'undefined' && window.anomalous_hash_cache) {
                    if (m.filename && info.metadata?.hash) {
                        window.anomalous_hash_cache[m.filename] = {
                            hash: info.metadata.hash,
                            url: resolvedUrl,
                        };
                    }
                }
            }
        }
        return hasChanges;
    } catch (e) {
        if (!signal?.aborted) {
            console.warn('[Model Source Hub] Failed to resolve workflow model info', e);
        }
        return false;
    }
}

// -----------------------------------------------------------------------------
// UI RENDERERS (Sub-divided into concise blocks <= 50 lines)
// -----------------------------------------------------------------------------

function renderModalHeader(headerEl, scope, state, onScopeChange, onClose) {
    headerEl.className = 'anomalous-sources-header';
    const topRow = text(headerEl, 'div', '', 'anomalous-sources-top-row');

    const titleWrap = text(topRow, 'div', '', 'anomalous-sources-title-wrap');
    text(titleWrap, 'h3', t('modelSourcesModalTitle'));

    const closeBtn = text(topRow, 'button', '✕', 'anomalous-sources-close-btn');
    closeBtn.title = t('close') || '关闭';
    closeBtn.onclick = onClose;

    // Scope Tabs (Active Workflow vs All Local Models)
    const tabsRow = text(headerEl, 'div', '', 'anomalous-sources-scope-tabs');

    const wfTab = text(tabsRow, 'button', '', `anomalous-sources-scope-tab${state.scope === 'workflow' ? ' is-active' : ''}`);
    wfTab.innerHTML = `🎛️ ${t('modelSourcesScopeWorkflow')} <span class="anomalous-sources-badge-num">${state.workflowModels.length}</span>`;
    wfTab.onclick = () => onScopeChange('workflow');

    const libTab = text(tabsRow, 'button', '', `anomalous-sources-scope-tab${state.scope === 'library' ? ' is-active' : ''}`);
    const libraryCount = state.libraryStatus === 'ready' ? state.libraryModels.length : '...';
    libTab.innerHTML = `📚 ${t('modelSourcesScopeLibrary')} <span class="anomalous-sources-badge-num">${libraryCount}</span>`;
    libTab.onclick = () => onScopeChange('library');
}

function renderFilterAndSearch(filterBarEl, state, onFilterChange, onSearch) {
    filterBarEl.className = 'anomalous-sources-filter-bar';

    const pillsWrap = text(filterBarEl, 'div', '', 'anomalous-sources-pills');
    const filters = [
        { id: 'all', label: t('modelSourcesFilterAll') },
        { id: 'resolved', label: t('modelSourcesFilterResolved') },
        { id: 'unresolved', label: t('modelSourcesFilterUnresolved') },
    ];

    filters.forEach(f => {
        const pill = text(pillsWrap, 'button', f.label, `anomalous-sources-pill${state.filter === f.id ? ' is-active' : ''}`);
        pill.onclick = () => onFilterChange(f.id);
    });

    const searchInput = text(filterBarEl, 'input', '', 'anomalous-sources-search-input');
    searchInput.placeholder = t('modelSourcesSearchPlaceholder');
    searchInput.value = state.searchKeyword;
    searchInput.oninput = () => onSearch(searchInput.value.trim().toLowerCase());
}

function renderModelTitle(infoCol, m) {
    const titleRow = text(infoCol, 'div', '', 'anomalous-source-row-title');
    text(titleRow, 'span', m.nodeTitle || m.type || 'Model', 'anomalous-source-node-tag');
    text(titleRow, 'strong', m.basename || m.filename, 'anomalous-source-model-name');

    const component = foundationType(m);
    if (component) {
        const label = { clip: 'modelSourcesTypeTextEncoder', text_encoders: 'modelSourcesTypeTextEncoder',
            vae: 'modelSourcesTypeVae', vae_approx: 'modelSourcesTypeVaeApprox', clip_vision: 'modelSourcesTypeVisionEncoder' }[component];
        text(titleRow, 'span', t(label), 'anomalous-source-badge-neutral');
    }
    const sourceBadge = text(titleRow, 'span', t(component ? 'modelSourcesStatusUnfilledOptional' : 'modelSourcesStatusUnfilled'), 'anomalous-source-badge-neutral');
    sourceBadge.hidden = Boolean(m.url?.trim());

    if (m.isMissing) {
        const missingBadge = text(titleRow, 'span', t('modelSourcesStatusMissingOnDisk'), 'anomalous-source-badge-danger');
        missingBadge.title = t('modelSourcesStatusMissingOnDisk');
    }

    if (m.isEditing) {
        const editBadge = text(titleRow, 'span', window.anomalous_browser_lang === 'zh' ? '✏️ 正在编辑' : '✏️ Editing', 'anomalous-source-edit-badge');
        editBadge.title = window.anomalous_browser_lang === 'zh' ? '当前处于来源链接修改状态' : 'In editing mode';
    }

    if (m.hash) {
        text(titleRow, 'code', `SHA: ${m.hash.slice(0, 10)}...`, 'anomalous-source-hash-chip');
    }
    return sourceBadge;
}

function renderModelUrlInput(inputWrap, m, onRefresh, getActions) {
    const isLocked = Boolean(m.url && !m.isEditing);
    const inputClass = `anomalous-source-url-input${isLocked ? ' is-locked' : ''}${m.isEditing ? ' is-editing' : ''}`;
    const urlInput = text(inputWrap, 'input', '', inputClass);
    urlInput.placeholder = t('modelSourcesUrlPlaceholder');
    urlInput.value = m.url || '';
    urlInput.readOnly = isLocked;

    const platBadge = text(inputWrap, 'span', m.platform?.name || '', 'anomalous-source-plat-badge');
    if (m.platform) {
        platBadge.style.color = m.platform.color;
        platBadge.style.borderColor = m.platform.border;
        platBadge.style.backgroundColor = m.platform.bg;
    } else {
        platBadge.style.display = 'none';
    }

    if (isLocked) {
        urlInput.title = window.anomalous_browser_lang === 'zh'
            ? '当前为展示锁定态。双击或点击右侧【✏️ 修改】可解锁编辑'
            : 'Protected link. Double-click or click [✏️ Edit] to modify';
        urlInput.ondblclick = () => {
            m.isEditing = true;
            onRefresh();
        };
    } else {
        urlInput.oninput = () => {
            m.url = urlInput.value.trim();
            m.platform = detectPlatform(m.url);
            if (m.platform) {
                platBadge.style.display = '';
                platBadge.textContent = m.platform.name;
                platBadge.style.color = m.platform.color;
                platBadge.style.borderColor = m.platform.border;
                platBadge.style.backgroundColor = m.platform.bg;
            } else {
                platBadge.style.display = 'none';
            }
            const { localBtn, jumpBtn, sourceBadge } = getActions();
            if (sourceBadge) sourceBadge.hidden = Boolean(m.url);
            const isDirty = Boolean(m.url && m.url.trim() !== (m.initialUrl || '').trim());
            if (localBtn) localBtn.style.display = (isDirty && canSaveLocalSource(m)) ? '' : 'none';
            if (jumpBtn) jumpBtn.disabled = !m.url;
        };
        urlInput.onkeydown = (e) => {
            if (e.key === 'Escape') {
                m.url = m.initialUrl;
                m.platform = detectPlatform(m.url);
                m.isEditing = false;
                onRefresh();
            } else if (e.key === 'Enter') {
                m.isEditing = false;
                onRefresh();
            }
        };
        if (m.isEditing) {
            setTimeout(() => {
                urlInput.focus();
                urlInput.select();
            }, 0);
        }
    }

    return urlInput;
}

function renderModelRowActions(actionsRow, m, state, urlInput, onRefresh, onAutoDetect, onSaveLocal) {
    const isDirty = Boolean(m.url && m.url.trim() !== (m.initialUrl || '').trim());

    const jumpBtn = text(actionsRow, 'button', t('modelSourcesJump'), 'anomalous-btn-primary anomalous-btn-sm anomalous-btn-jump');
    jumpBtn.disabled = !m.url;
    jumpBtn.title = window.anomalous_browser_lang === 'zh' ? '在浏览器新标签页中打开对应网址' : 'Open website in new tab';
    jumpBtn.onclick = () => openExternalUrl(m.url);

    const detectBtn = text(actionsRow, 'button', t('modelSourcesAutoDetect'), 'anomalous-btn-ghost anomalous-btn-sm');
    detectBtn.title = window.anomalous_browser_lang === 'zh' ? '从本地元数据或 SHA256 自动解析来源' : 'Auto detect from hash or metadata';
    detectBtn.onclick = () => onAutoDetect(m, urlInput);

    let editBtn = null;
    let cancelBtn = null;

    if (m.isEditing) {
        cancelBtn = text(actionsRow, 'button', window.anomalous_browser_lang === 'zh' ? '✕ 取消' : '✕ Cancel', 'anomalous-btn-ghost anomalous-btn-sm');
        cancelBtn.title = window.anomalous_browser_lang === 'zh' ? '放弃本次修改并还原' : 'Cancel edits and revert';
        cancelBtn.onclick = () => {
            m.url = m.initialUrl;
            m.platform = detectPlatform(m.url);
            m.isEditing = false;
            onRefresh();
        };
    } else if (m.url) {
        editBtn = text(actionsRow, 'button', window.anomalous_browser_lang === 'zh' ? '✏️ 修改' : '✏️ Edit', 'anomalous-btn-ghost anomalous-btn-sm');
        editBtn.title = window.anomalous_browser_lang === 'zh' ? '解锁输入框以修改来源网址' : 'Unlock to edit URL';
        editBtn.onclick = () => {
            m.isEditing = true;
            onRefresh();
        };
    }

    let localBtn = null;
    if (canSaveLocalSource(m)) {
        localBtn = text(actionsRow, 'button', t('modelSourcesSaveLocal'), 'anomalous-btn-primary anomalous-btn-sm anomalous-btn-save-local');
        localBtn.title = window.anomalous_browser_lang === 'zh' ? '检测到链接已修改，点击记入本地模型的 .civitai.info' : 'Modified link detected. Save to local .civitai.info';
        localBtn.style.display = isDirty ? '' : 'none';
        localBtn.onclick = () => onSaveLocal(m);
    }

    return { jumpBtn, detectBtn, editBtn, cancelBtn, localBtn };
}

function renderModelRow(listEl, m, state, onRefresh, onAutoDetect, onSaveLocal) {
    const card = text(listEl, 'div', '', `anomalous-source-row-item${m.url ? ' has-url' : ' is-missing-url'}`);

    const infoCol = text(card, 'div', '', 'anomalous-source-col-info');
    const sourceBadge = renderModelTitle(infoCol, m);

    const inputRow = text(card, 'div', '', 'anomalous-source-col-input-row');
    const inputWrap = text(inputRow, 'div', '', 'anomalous-source-input-wrap');
    const actionsRow = text(inputRow, 'div', '', 'anomalous-source-row-actions');

    let actionRefs = {};
    const urlInput = renderModelUrlInput(inputWrap, m, onRefresh, () => ({ ...actionRefs, sourceBadge }));
    actionRefs = renderModelRowActions(actionsRow, m, state, urlInput, onRefresh, onAutoDetect, onSaveLocal);
}

function renderComponentDisclosure(listEl, state, group, renderRow) {
    const button = text(listEl, 'button', '', 'anomalous-sources-components-toggle');
    button.setAttribute('aria-expanded', String(state.componentsExpanded));
    const marker = state.componentsExpanded ? '▾' : '▸';
    const label = text(button, 'span', '', 'anomalous-sources-components-label');
    text(label, 'span', `${marker} ${t('modelSourcesComponentsAdvanced', { count: group.componentModels.length })}`);
    text(label, 'small', t('modelSourcesComponentsOptionalHint'));
    if (group.componentMissingCount) {
        text(button, 'span', t('modelSourcesComponentsMissing', { count: group.componentMissingCount }), 'anomalous-source-badge-danger');
    }
    button.onclick = () => {
        state.componentsExpanded = !state.componentsExpanded;
        state.refresh();
    };
    if (!state.componentsExpanded) return;
    const rows = text(listEl, 'div', '', 'anomalous-sources-components-list');
    group.componentModels.forEach(model => renderRow(rows, model));
    if (!group.componentModels.length) {
        text(rows, 'div', t('modelSourcesComponentsNoSearchMatch'), 'anomalous-sources-components-empty');
    }
}

function renderFooterBar(footerEl, state, activeMainModels, onSaveWorkflow, onGenerateNote, onCopySummary) {
    footerEl.className = 'anomalous-sources-footer';
    footerEl.replaceChildren();

    const statsEl = text(footerEl, 'div', '', 'anomalous-sources-footer-stats');
    const withUrlCount = activeMainModels.filter(m => Boolean(m.url?.trim())).length;
    statsEl.innerHTML = `${t('modelSourcesMainStats')}: <strong>${withUrlCount} / ${activeMainModels.length}</strong>`;

    const btnsWrap = text(footerEl, 'div', '', 'anomalous-sources-footer-actions');

    const copyBtn = text(btnsWrap, 'button', t('modelSourcesCopySummary'), 'anomalous-btn-ghost anomalous-btn-sm');
    copyBtn.onclick = onCopySummary;

    if (state.scope === 'workflow') {
        const noteBtn = text(btnsWrap, 'button', t('modelSourcesGenerateNoteNode'), 'anomalous-btn-ghost anomalous-btn-sm');
        noteBtn.title = window.anomalous_browser_lang === 'zh' ? '在 ComfyUI 画布生成一个原生 Note 便签节点，任何人打开都能直接看到下载链接' : 'Generate native Note node with source links on canvas';
        noteBtn.onclick = onGenerateNote;

        // Dynamic Save vs Sync text
        const hasExisting = Boolean(Object.keys(app.graph?.extra?.anomalous_model_sources || {}).length);
        const saveLabel = hasExisting ? t('modelSourcesSyncToWorkflow') : t('modelSourcesSaveToWorkflow');
        const saveBtn = text(btnsWrap, 'button', saveLabel, 'anomalous-btn-primary anomalous-btn-sm');
        saveBtn.onclick = onSaveWorkflow;
    }
}

// -----------------------------------------------------------------------------
// MAIN MODAL OPENER
// -----------------------------------------------------------------------------

export function openModelSourcesModal(initialScope = 'workflow') {
    activeSourcesModalScope?.dispose();
    const scope = createViewScope();
    activeSourcesModalScope = scope;

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-model-sources-overlay';
    scope.onDispose(() => {
        overlay.remove();
        if (activeSourcesModalScope === scope) activeSourcesModalScope = null;
    });

    const modal = document.createElement('div');
    modal.className = 'anomalous-model-sources-modal';
    overlay.appendChild(modal);

    const state = {
        scope: initialScope,
        filter: 'all',
        searchKeyword: '',
        workflowModels: collectWorkflowModels(),
        libraryModels: [],
        libraryStatus: 'idle',
        componentsExpanded: false,
        libraryRequestId: 0,
    };

    const headerEl = text(modal, 'header', '', '');
    const filterBarEl = text(modal, 'div', '', '');
    const bodyEl = text(modal, 'div', '', 'anomalous-sources-body');
    const footerEl = text(modal, 'footer', '', '');

    const ensureLibraryLoaded = async (force = false) => {
        if (state.libraryStatus === 'loading') return;
        if (!force && state.libraryStatus === 'ready') {
            refreshUi();
            return;
        }
        const requestId = ++state.libraryRequestId;
        state.libraryStatus = 'loading';
        refreshUi();
        try {
            const items = await fetchAllLibraryModels(scope.signal);
            if (scope.signal.aborted || requestId !== state.libraryRequestId) return;
            state.libraryModels = items;
            state.libraryStatus = 'ready';
        } catch (error) {
            if (scope.signal.aborted || requestId !== state.libraryRequestId) return;
            console.error('[Model Source Hub] Failed to fetch library models', error);
            state.libraryStatus = 'error';
        }
        if (!scope.signal.aborted && requestId === state.libraryRequestId) refreshUi();
    };

    const refreshUi = () => {
        headerEl.replaceChildren();
        filterBarEl.replaceChildren();
        bodyEl.replaceChildren();

        renderModalHeader(headerEl, scope, state, (newScope) => {
            if (state.scope === newScope) return;
            state.scope = newScope;
            if (newScope === 'library') {
                ensureLibraryLoaded();
                return;
            }
            refreshUi();
        }, () => scope.dispose());

        renderFilterAndSearch(filterBarEl, state, (newFilter) => {
            state.filter = newFilter;
            refreshUi();
        }, (keyword) => {
            state.searchKeyword = keyword;
            refreshUi();
        });

        const rawList = state.scope === 'workflow' ? state.workflowModels : state.libraryModels;
        const group = partitionSourceModels(rawList, state.filter, state.searchKeyword);
        const renderRow = (parent, model) => renderModelRow(parent, model, state,
            () => refreshUi(),
            async (item, inputEl) => {
                inputEl.disabled = true;
                try {
                    const detected = await autoDetectModelSource(item);
                    if (detected) {
                        item.url = detected;
                        item.initialUrl = item.initialUrl || detected;
                        item.platform = detectPlatform(detected);
                        inputEl.value = detected;
                        if (state.filter === 'unresolved') state.filter = 'resolved';
                        refreshUi();
                        showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '✓ 已识别模型来源！' : '✓ Model source detected!');
                    } else {
                        showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '未能在本地或云端匹配到官方页面' : 'No online source matched');
                    }
                } finally {
                    inputEl.disabled = false;
                }
            },
            async (item) => {
                try {
                    await saveSingleModelToLocalSidecar(item, item.url);
                    item.initialUrl = item.url;
                    item.isEditing = false;
                    refreshUi();
                    showWorkbenchToast(t('modelSourcesSavedLocal'));
                } catch (e) {
                    showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '保存至本地失败' : 'Failed to save local');
                }
            });

        if (state.scope === 'library' && state.libraryStatus === 'loading') {
            const loadingBox = text(bodyEl, 'div', '', 'anomalous-sources-empty');
            text(loadingBox, 'div', `⏳ ${t('modelSourcesLibraryLoading')}`);
        } else if (state.scope === 'library' && state.libraryStatus === 'error') {
            const errorBox = text(bodyEl, 'div', '', 'anomalous-sources-empty');
            text(errorBox, 'div', t('modelSourcesLibraryLoadFailed'));
            const retry = text(errorBox, 'button', t('modelSourcesRetry'), 'anomalous-btn-ghost anomalous-btn-sm');
            retry.onclick = () => {
                state.libraryStatus = 'idle';
                ensureLibraryLoaded();
            };
        } else {
            if (state.scope === 'library') {
                text(bodyEl, 'div', t('modelSourcesLibraryRangeHint'), 'anomalous-sources-library-hint');
            }
            group.mainModels.forEach(model => renderRow(bodyEl, model));
            if (group.allComponentCount) {
                state.refresh = refreshUi;
                renderComponentDisclosure(bodyEl, state, group, renderRow);
            }
        }

        const libraryUnavailable = state.scope === 'library'
            && (state.libraryStatus === 'loading' || state.libraryStatus === 'error');
        if (!libraryUnavailable
            && !group.mainModels.length && !group.allComponentCount) {
            const emptyBox = text(bodyEl, 'div', '', 'anomalous-sources-empty');
            emptyBox.innerHTML = `
                <div style="font-size:24px;margin-bottom:6px;">🔍</div>
                <div>${t('modelSourcesNoModelsFound')}</div>
            `;
        }

        const visibleModels = [...group.mainModels, ...(state.componentsExpanded ? group.componentModels : [])];
        renderFooterBar(footerEl, state, group.mainModels,
            () => {
                const res = syncWorkflowSources(state.workflowModels);
                showWorkbenchToast(res.isUpdate ? t('modelSourcesSyncedToWorkflow') : t('modelSourcesSavedToWorkflow'));
                refreshUi();
            },
            () => {
                const ok = createCanvasNoteNode(state.workflowModels);
                if (ok) showWorkbenchToast(t('modelSourcesNoteCreated'));
            },
            async () => {
                await copySourcesSummary(visibleModels);
                showWorkbenchToast(t('modelSourcesCopied'));
            }
        );
    };

    refreshUi();

    resolveWorkflowModelsMetadata(state.workflowModels, scope.signal).then(hasChanges => {
        if (hasChanges && !scope.signal.aborted) {
            refreshUi();
        }
    });

    overlay.onclick = (e) => {
        if (e.target === overlay) scope.dispose();
    };

    scope.listen(window, 'keydown', (e) => {
        if (e.key === 'Escape') scope.dispose();
    });

    document.body.appendChild(overlay);
    if (initialScope === 'library') ensureLibraryLoaded();
    return () => scope.dispose();
}

/** 自动识别单条模型来源 */
export async function autoDetectModelSource(item) {
    if (item.url) return item.url;
    if (foundationType(item)) {
        await resolveWorkflowModelsMetadata([item]);
        return item.url || '';
    }

    // 1. Priority: check local sidecar & metadata via backend resolver
    try {
        const queryPath = item.filename || item.basename;
        const res = await fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: [queryPath, item.basename].filter(Boolean) }),
        });
        const data = await jsonResponse(res, 'detect model source local');
        const resolved = data?.models?.[queryPath] || data?.models?.[item.basename];
        if (resolved) {
            item.type = resolved.type;
            item.subfolder = resolved.subfolder;
            item.path_idx = resolved.path_idx;
            if (resolved.metadata?.hash) item.hash = resolved.metadata.hash;
            const foundUrl = usableSourceUrl(resolved.metadata?.source_url)
                || usableSourceUrl(resolved.metadata?.civitai_url);
            if (foundUrl) return foundUrl;
        }
    } catch (e) {
        // Backend lookup failed, proceed to cloud/search fallback
    }

    // 2. Cloud lookup if hash exists
    if (item.hash) {
        try {
            const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${item.hash}`);
            if (res.ok) {
                const data = await res.json();
                if (data.modelId) {
                    const domain = (data.model?.nsfw || data.nsfwLevel > 1) ? 'civitai.red' : 'civitai.com';
                    return `https://${domain}/models/${data.modelId}${data.id ? '?modelVersionId=' + data.id : ''}`;
                }
            }
        } catch (e) {
            // Network fallback
        }
    }

    // A search-results page is not a model source. Keep the item unresolved
    // unless local metadata or an exact hash lookup identifies a release.
    return '';
}
