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
    return typeof val === 'string' && /\.(safetensors|ckpt|pt|bin|sft)$/i.test(val);
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
            if (!isModelFilename(val)) continue;

            const dedupeKey = `${node.id}_${val}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const basename = val.split(/[/\\]/).pop();
            const isMissing = Boolean(w.options?.values && !w.options.values.includes(val));
            const hashObj = savedHashes[dedupeKey] || savedHashes[val] || window.anomalous_hash_cache?.[val] || window.anomalous_hash_cache?.[basename] || {};
            const hash = typeof hashObj === 'string' ? hashObj : (hashObj.hash || '');

            const existingSource = savedSources[val] || savedSources[basename] || savedSources[dedupeKey];
            let url = existingSource?.url || hashObj?.url || '';

            models.push({
                key: dedupeKey,
                nodeId: node.id,
                nodeTitle: node.title || node.type || `Node #${node.id}`,
                nodeType: node.type,
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
    try {
        const res = await fetch('/anomalous/all_scan_models?limit=0', { signal });
        const payload = await jsonResponse(res, 'load library models');
        const rawList = Array.isArray(payload.models) ? payload.models : [];

        return rawList.map(m => {
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
    } catch (e) {
        if (signal?.aborted) return [];
        console.error('[Model Source Hub] Failed to fetch library models', e);
        return [];
    }
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
        } else {
            md += `   - 来源链接: ⚠️ 未指定\n`;
        }
    });
    await navigator.clipboard.writeText(md);
}

/** 保存单个模型自定义链接到本地 .civitai.info */
export async function saveSingleModelToLocalSidecar(item, url) {
    const cleanUrl = normalizeUrl(url);
    const body = {
        filename: item.filename,
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
    libTab.innerHTML = `📚 ${t('modelSourcesScopeLibrary')} <span class="anomalous-sources-badge-num">${state.libraryModels.length || '...'}</span>`;
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

function renderModelRow(listEl, m, state, onUpdateUrl, onAutoDetect, onSaveLocal) {
    const card = text(listEl, 'div', '', `anomalous-source-row-item${m.url ? ' has-url' : ' is-missing-url'}`);

    const infoCol = text(card, 'div', '', 'anomalous-source-col-info');
    const titleRow = text(infoCol, 'div', '', 'anomalous-source-row-title');

    text(titleRow, 'span', m.nodeTitle || m.type || 'Model', 'anomalous-source-node-tag');
    text(titleRow, 'strong', m.basename || m.filename, 'anomalous-source-model-name');

    if (m.isMissing) {
        const missingBadge = text(titleRow, 'span', t('modelSourcesStatusMissingOnDisk'), 'anomalous-source-badge-danger');
        missingBadge.title = '当前本地尚未下载安装此模型';
    }

    if (m.hash) {
        text(titleRow, 'code', `SHA: ${m.hash.slice(0, 10)}...`, 'anomalous-source-hash-chip');
    }

    // Input row with URL and actions
    const inputRow = text(card, 'div', '', 'anomalous-source-col-input-row');

    const inputWrap = text(inputRow, 'div', '', 'anomalous-source-input-wrap');
    const urlInput = text(inputWrap, 'input', '', 'anomalous-source-url-input');
    urlInput.placeholder = t('modelSourcesUrlPlaceholder');
    urlInput.value = m.url || '';

    if (m.platform) {
        const platBadge = text(inputWrap, 'span', m.platform.name, 'anomalous-source-plat-badge');
        platBadge.style.color = m.platform.color;
        platBadge.style.borderColor = m.platform.border;
        platBadge.style.backgroundColor = m.platform.bg;
    }

    urlInput.oninput = () => {
        m.url = urlInput.value.trim();
        m.platform = detectPlatform(m.url);
        onUpdateUrl(m);
    };

    // Action buttons group
    const actionsRow = text(inputRow, 'div', '', 'anomalous-source-row-actions');

    const jumpBtn = text(actionsRow, 'button', t('modelSourcesJump'), 'anomalous-btn-primary anomalous-btn-sm anomalous-btn-jump');
    jumpBtn.disabled = !m.url;
    jumpBtn.title = window.anomalous_browser_lang === 'zh' ? '在浏览器新标签页中打开对应网址' : 'Open website in new tab';
    jumpBtn.onclick = () => openExternalUrl(m.url);

    const detectBtn = text(actionsRow, 'button', t('modelSourcesAutoDetect'), 'anomalous-btn-ghost anomalous-btn-sm');
    detectBtn.title = window.anomalous_browser_lang === 'zh' ? '从本地元数据或 SHA256 自动解析来源' : 'Auto detect from hash or metadata';
    detectBtn.onclick = () => onAutoDetect(m, urlInput);

    if (state.scope === 'workflow' && !m.isMissing) {
        const localBtn = text(actionsRow, 'button', t('modelSourcesSaveLocal'), 'anomalous-btn-ghost anomalous-btn-sm');
        localBtn.title = window.anomalous_browser_lang === 'zh' ? '把该链接同时记入本地该模型的 .civitai.info 侧边信息中' : 'Save to local model sidecar info';
        localBtn.onclick = () => onSaveLocal(m);
    }
}

function renderFooterBar(footerEl, state, activeModels, onSaveWorkflow, onGenerateNote, onCopySummary) {
    footerEl.className = 'anomalous-sources-footer';
    footerEl.replaceChildren();

    const statsEl = text(footerEl, 'div', '', 'anomalous-sources-footer-stats');
    const withUrlCount = activeModels.filter(m => Boolean(m.url?.trim())).length;
    statsEl.innerHTML = `${window.anomalous_browser_lang === 'zh' ? '已配置' : 'Configured'}: <strong>${withUrlCount} / ${activeModels.length}</strong>`;

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
        isLoadingLibrary: false,
    };

    const headerEl = text(modal, 'header', '', '');
    const filterBarEl = text(modal, 'div', '', '');
    const bodyEl = text(modal, 'div', '', 'anomalous-sources-body');
    const footerEl = text(modal, 'footer', '', '');

    const refreshUi = () => {
        headerEl.replaceChildren();
        filterBarEl.replaceChildren();
        bodyEl.replaceChildren();

        renderModalHeader(headerEl, scope, state, (newScope) => {
            state.scope = newScope;
            if (newScope === 'library' && !state.libraryModels.length && !state.isLoadingLibrary) {
                state.isLoadingLibrary = true;
                refreshUi();
                fetchAllLibraryModels(scope.signal).then(items => {
                    if (scope.signal.aborted) return;
                    state.libraryModels = items;
                    state.isLoadingLibrary = false;
                    refreshUi();
                });
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

        // Filter models
        const rawList = state.scope === 'workflow' ? state.workflowModels : state.libraryModels;
        const filtered = rawList.filter(m => {
            if (state.filter === 'resolved' && !m.url) return false;
            if (state.filter === 'unresolved' && m.url) return false;
            if (state.searchKeyword) {
                const title = `${m.nodeTitle || ''} ${m.filename || ''} ${m.basename || ''}`.toLowerCase();
                if (!title.includes(state.searchKeyword)) return false;
            }
            return true;
        });

        if (state.isLoadingLibrary) {
            const loadingBox = text(bodyEl, 'div', '', 'anomalous-sources-empty');
            loadingBox.innerHTML = `<div>⏳ 正在全量盘点本地模型库...</div>`;
        } else if (!filtered.length) {
            const emptyBox = text(bodyEl, 'div', '', 'anomalous-sources-empty');
            emptyBox.innerHTML = `
                <div style="font-size:24px;margin-bottom:6px;">🔍</div>
                <div>${t('modelSourcesNoModelsFound')}</div>
            `;
        } else {
            filtered.forEach(m => {
                renderModelRow(bodyEl, m, state,
                    () => refreshUi(),
                    async (item, inputEl) => {
                        inputEl.disabled = true;
                        try {
                            const detected = await autoDetectModelSource(item);
                            if (detected) {
                                item.url = detected;
                                item.platform = detectPlatform(detected);
                                inputEl.value = detected;
                                refreshUi();
                                showWorkbenchToast(t('modelSourcesSavedLocal'));
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
                            showWorkbenchToast(t('modelSourcesSavedLocal'));
                        } catch (e) {
                            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '保存至本地失败' : 'Failed to save local');
                        }
                    }
                );
            });
        }

        renderFooterBar(footerEl, state, filtered,
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
                await copySourcesSummary(filtered);
                showWorkbenchToast(t('modelSourcesCopied'));
            }
        );
    };

    refreshUi();

    overlay.onclick = (e) => {
        if (e.target === overlay) scope.dispose();
    };

    scope.listen(window, 'keydown', (e) => {
        if (e.key === 'Escape') scope.dispose();
    });

    document.body.appendChild(overlay);
    return () => scope.dispose();
}

/** 自动识别单条模型来源 */
async function autoDetectModelSource(item) {
    if (item.url) return item.url;
    // 1. Check local sidecar if hash exists
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
    // 2. Search fallback
    const query = encodeURIComponent((item.basename || item.filename).replace(/\.[^.]+$/, ''));
    return `https://civitai.com/search/models?query=${query}`;
}
