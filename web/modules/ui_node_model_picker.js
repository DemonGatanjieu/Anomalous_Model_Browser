/** Node model replacement and insertion picker. */

import { app } from "../../../scripts/app.js";
import { translate } from "./locales.js";
import { planLoraInsertion, spliceLora } from "./graph_splice.js";
import { collectMainModelContextRequests, getBaseModelFamily, inferPickerModelType } from "./model_picker.js";
import { escapeHtml } from "./safe_dom.js";
import { recordCanvasStep } from "./canvas_history.js";
import { modelCardFace } from "./ui_grid.js";

const t = (key, params) => translate(key, params);

export function getNativeWidgetValues(node, widget) {
    const source = widget?.options?.values;
    let values = source;
    if (typeof source === 'function') {
        try {
            values = source(widget, node);
        } catch (error) {
            console.warn('[Anomalous] Failed to resolve native combo values:', error);
            values = [];
        }
    }
    return Array.isArray(values)
        ? [...new Set(values.filter(value => typeof value === 'string'))]
        : [];
}

/** Whether the LoRA ComfyUI lists as `name` trains the text encoder (api/lora_info.py); yes when unknown. */
async function loraTrainsTextEncoder(name) {
    try {
        const data = await (await fetch(`/anomalous/lora_info?name=${encodeURIComponent(name)}`)).json();
        return data.text_encoder !== false;
    } catch {
        return true;
    }
}

/** The node's drop-downs that list model files. */
export function modelComboWidgets(node) {
    return (node?.widgets || []).filter(widget => {
        if (widget?.type !== 'combo') return false;
        const values = getNativeWidgetValues(node, widget);
        return values.some(value => /\.(safetensors|ckpt|pt|bin|pth|sft|gguf)$/i.test(value));
    });
}

export function findModelComboWidget(node) {
    return modelComboWidgets(node)[0] || null;
}

export function setWidgetValue(node, widget, value) {
    widget.value = value;
    const widgetIndex = node?.widgets?.indexOf(widget) ?? -1;
    if (widgetIndex >= 0) {
        node.widgets_values = Array.isArray(node.widgets_values)
            ? node.widgets_values
            : node.widgets.map(item => item?.value);
        node.widgets_values[widgetIndex] = value;
    }
}

export function _openGalleryReplacer(node, w, options = {}) {
        const mode = options.mode === 'insert' ? 'insert' : 'replace';
        const pickerType = inferPickerModelType(node, w, options);
        const validPaths = getNativeWidgetValues(node, w);
        if (!validPaths.length) {
            alert(t('pickerNoCompatible'));
            return;
        }

        const normalizePath = value => String(value || '').replace(/\\/g, '/');
        const getName = value => normalizePath(value).split('/').pop() || normalizePath(value);
        const getFolder = value => {
            const normalized = normalizePath(value);
            const splitAt = normalized.lastIndexOf('/');
            return splitAt >= 0 ? normalized.slice(0, splitAt) : '';
        };
        const currentPath = mode === 'replace'
            ? validPaths.find(path => normalizePath(path) === normalizePath(w.value)) || null
            : null;
        const contextRequests = pickerType.isLora
            ? collectMainModelContextRequests(app.graph, options.anchorNode || node)
            : [];
        let selectedPath = currentPath;
        let selectedFolder = '';
        let previews = {};
        let modelInfo = {};
        let contextModels = {};
        let selectedBaseFamily = '';
        let renderGeneration = 0;
        let applying = false;

        const modal = document.createElement('div');
        modal.className = 'anomalous-picker-overlay'; // the browser's Esc leaves it to the picker (ui_browser_navigation.js)
        modal.style.cssText = 'position:fixed;inset:0;background:var(--amb-lt-page,radial-gradient(circle at 15% 0%,rgba(53,73,118,0.34),transparent 35%),rgba(7,8,12,0.965));z-index:999999;display:flex;flex-direction:column;padding:22px 24px;box-sizing:border-box;color:var(--amb-lt-text,#fff);font-family:Inter,Arial,sans-serif;';
        const stopMedia = container => container?.querySelectorAll?.('video,audio').forEach(media => {
            media.pause();
            media.removeAttribute('src');
            media.load?.();
        });
        // Esc closes the picker wherever the focus is, and only the picker (not the browser behind).
        const onEscape = (event) => {
            if (event.key !== 'Escape' || !modal.isConnected) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            closeModal();
        };
        const closeModal = () => {
            renderGeneration += 1;
            window.removeEventListener('keydown', onEscape, true);
            stopMedia(modal);
            modal.remove();
            if (!document.querySelector('.anomalous-picker-overlay')) document.documentElement.classList.remove('anomalous-picker-open');
        };

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-shrink:0;';
        const headerIcon = document.createElement('span');
        headerIcon.textContent = mode === 'insert' ? '＋' : '⇄';
        headerIcon.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(135deg,#4776e6,#8e54e9);font-size:21px;font-weight:800;box-shadow:0 8px 22px rgba(78,91,220,0.35);';
        const headerCopy = document.createElement('div');
        headerCopy.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        const eyebrow = document.createElement('div');
        eyebrow.textContent = t('pickerEyebrow');
        eyebrow.style.cssText = 'font-size:10px;color:var(--amb-lt-accent-text,#8fa8da);letter-spacing:0.12em;text-transform:uppercase;font-weight:750;';
        const title = document.createElement('h2');
        title.style.cssText = 'margin:0;font-size:19px;line-height:1.15;';
        title.textContent = mode === 'insert'
            ? (options.direction === 'before' ? t('pickerInsertBeforeTitle') : t('pickerInsertAfterTitle'))
            : t('pickerChangeTitle');
        const typeBadge = document.createElement('span');
        typeBadge.textContent = pickerType.label;
        typeBadge.style.cssText = 'padding:5px 10px;border-radius:20px;background:color-mix(in srgb, var(--amb-link) 10%, transparent);border:1px solid color-mix(in srgb, var(--amb-link) 25%, transparent);color:var(--amb-link);font-size:10px;font-weight:750;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'margin-left:auto;width:38px;height:38px;border-radius:10px;background:rgba(var(--amb-ink-rgb), 0.04);border:1px solid var(--amb-border);color:var(--amb-text-muted);font-size:20px;cursor:pointer;';
        closeBtn.onclick = closeModal;
        headerCopy.append(eyebrow, title);
        header.append(headerIcon, headerCopy, typeBadge, closeBtn);
        modal.appendChild(header);

        const compatibilityHint = document.createElement('div');
        compatibilityHint.style.cssText = 'display:none;align-items:center;gap:8px;margin:0 0 12px;padding:9px 12px;border-radius:10px;background:rgba(0,200,160,0.075);border:1px solid rgba(0,220,180,0.13);color:var(--amb-lt-ok,#8edfd0);font-size:11px;flex-shrink:0;';
        modal.appendChild(compatibilityHint);

        const body = document.createElement('div');
        body.style.cssText = 'display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr);gap:14px;min-height:0;flex:1;';
        const folderPanel = document.createElement('aside');
        folderPanel.style.cssText = 'background:var(--amb-lt-surface,rgba(20,22,29,0.92));border:1px solid var(--amb-border);border-radius:13px;overflow:auto;padding:10px;box-shadow:0 14px 35px rgba(0,0,0,0.18);';
        const folderTitle = document.createElement('div');
        folderTitle.textContent = t('pickerFolders');
        folderTitle.style.cssText = 'font-size:13px;font-weight:700;color:var(--amb-text-soft);padding:8px 10px 10px;';
        const folderList = document.createElement('div');
        folderList.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        folderPanel.append(folderTitle, folderList);

        const content = document.createElement('section');
        content.style.cssText = 'display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--amb-lt-surface,rgba(18,20,27,0.92));border:1px solid var(--amb-border);border-radius:13px;overflow:hidden;box-shadow:0 14px 35px rgba(0,0,0,0.18);';
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:10px;padding:12px;border-bottom:1px solid var(--amb-border-strong);flex-wrap:wrap;align-items:center;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = t('pickerSearch');
        searchInput.style.cssText = 'flex:1;min-width:220px;padding:10px 12px;border-radius:9px;border:1px solid var(--amb-border);background:var(--amb-bg-card-hover);color:var(--amb-lt-text,#fff);font-size:13px;outline:none;';
        const baseFilterSelect = document.createElement('select');
        baseFilterSelect.style.cssText = `display:${pickerType.isLora ? 'block' : 'none'};padding:10px 12px;border-radius:9px;border:1px solid rgba(0,220,180,0.2);background:var(--amb-bg-card-hover);color:var(--amb-lt-ok,#9be8d9);font-size:12px;max-width:230px;`;
        const allBaseOption = document.createElement('option');
        allBaseOption.value = '';
        allBaseOption.textContent = t('pickerMainAll');
        baseFilterSelect.appendChild(allBaseOption);
        const sortSelect = document.createElement('select');
        sortSelect.style.cssText = 'padding:10px 12px;border-radius:9px;border:1px solid var(--amb-border);background:var(--amb-bg-card-hover);color:var(--amb-lt-text,#fff);font-size:12px;';
        [
            ['name-asc', t('pickerNameAsc')],
            ['name-desc', t('pickerNameDesc')],
            ['folder-asc', t('pickerByFolder')],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            sortSelect.appendChild(option);
        });
        const resultCount = document.createElement('span');
        resultCount.style.cssText = 'color:var(--amb-text-muted);font-size:12px;white-space:nowrap;';
        toolbar.append(searchInput, baseFilterSelect, sortSelect, resultCount);
        content.appendChild(toolbar);

        const loadingText = document.createElement('div');
        loadingText.textContent = t('pickerLoadingCovers');
        loadingText.style.cssText = 'color:var(--amb-text-muted);font-size:13px;padding:10px 14px 0;';
        const gridScroll = document.createElement('div');
        // clip-path: cards scrolled up under the toolbar must not take its clicks (lessons.md, 2026-10-12).
        gridScroll.style.cssText = 'overflow:auto;min-height:0;flex:1;padding:14px;clip-path:inset(0);';
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;align-content:start;';
        gridScroll.appendChild(grid);
        content.append(loadingText, gridScroll);
        body.append(folderPanel, content);
        modal.appendChild(body);

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:14px;flex-shrink:0;';
        const selectionText = document.createElement('div');
        selectionText.style.cssText = 'min-width:0;flex:1;color:var(--amb-text-muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = t('pickerCancel');
        cancelBtn.style.cssText = 'padding:10px 18px;background:var(--amb-bg-card-hover);color:var(--amb-text-soft);border:1px solid var(--amb-border-strong);border-radius:7px;cursor:pointer;';
        cancelBtn.onclick = closeModal;
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = mode === 'insert'
            ? t('pickerInsertConfirm')
            : t('pickerReplaceConfirm');
        confirmBtn.style.cssText = 'padding:10px 20px;background:#1976d2;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;';
        footer.append(selectionText, cancelBtn, confirmBtn);
        modal.appendChild(footer);
        // Opened from the canvas's right-click menu the browser is closed, so the floating button would sit on the picker's head.
        document.documentElement.classList.add('anomalous-picker-open');
        document.body.appendChild(modal);

        let folderCounts = new Map();
        const pathMatchesBaseFilter = path => {
            if (!selectedBaseFamily) return true;
            const baseModel = modelInfo[path]?.metadata?.baseModel;
            return getBaseModelFamily(baseModel) === selectedBaseFamily;
        };
        const rebuildFolderCounts = () => {
            const visibleByBase = validPaths.filter(pathMatchesBaseFilter);
            folderCounts = new Map([['', visibleByBase.length]]);
            visibleByBase.forEach(path => {
                const parts = getFolder(path).split('/').filter(Boolean);
                let accumulated = '';
                parts.forEach(part => {
                    accumulated = accumulated ? `${accumulated}/${part}` : part;
                    folderCounts.set(accumulated, (folderCounts.get(accumulated) || 0) + 1);
                });
            });
        };
        rebuildFolderCounts();

        const updateSelection = () => {
            selectionText.textContent = selectedPath
                ? t('pickerSelected', { path: normalizePath(selectedPath) })
                : t('pickerChooseModel');
            confirmBtn.disabled = !selectedPath || applying;
            confirmBtn.style.opacity = confirmBtn.disabled ? '0.45' : '1';
            confirmBtn.style.cursor = confirmBtn.disabled ? 'not-allowed' : 'pointer';
        };

        let renderCards = () => {};
        const configureBaseFilter = () => {
            if (!pickerType.isLora) return;
            const groups = new Map();
            validPaths.forEach(path => {
                const baseModel = modelInfo[path]?.metadata?.baseModel;
                const family = getBaseModelFamily(baseModel);
                if (!family) return;
                const existing = groups.get(family) || { label: baseModel, count: 0 };
                existing.count += 1;
                if (String(baseModel).length < String(existing.label).length) existing.label = baseModel;
                groups.set(family, existing);
            });

            baseFilterSelect.replaceChildren(allBaseOption);
            [...groups.entries()]
                .sort((a, b) => String(a[1].label).localeCompare(String(b[1].label), undefined, { numeric: true }))
                .forEach(([family, group]) => {
                    const option = document.createElement('option');
                    option.value = family;
                    option.textContent = `${group.label} (${group.count})`;
                    baseFilterSelect.appendChild(option);
                });

            const mainBaseModel = Object.values(contextModels)
                .map(item => item?.metadata?.baseModel)
                .find(Boolean) || '';
            const currentBaseModel = currentPath ? modelInfo[currentPath]?.metadata?.baseModel || '' : '';
            const preferredBaseModel = mainBaseModel || currentBaseModel;
            const preferredFamily = getBaseModelFamily(preferredBaseModel);
            selectedBaseFamily = preferredFamily && groups.has(preferredFamily) ? preferredFamily : '';
            baseFilterSelect.value = selectedBaseFamily;
            if (selectedBaseFamily && selectedPath && !pathMatchesBaseFilter(selectedPath)) selectedPath = null;
            rebuildFolderCounts();

            compatibilityHint.style.display = 'flex';
            if (mainBaseModel && selectedBaseFamily) {
                compatibilityHint.textContent = t('pickerCompatibleMain', { name: mainBaseModel });
            } else if (preferredBaseModel && selectedBaseFamily) {
                compatibilityHint.textContent = t('pickerCompatibleTag', { name: preferredBaseModel });
            } else if (mainBaseModel) {
                compatibilityHint.textContent = t('pickerCompatibleNoTags', { name: mainBaseModel });
            } else {
                compatibilityHint.textContent = t('pickerCompatibleUnknown');
            }
        };

        const renderFolders = () => {
            folderList.replaceChildren();
            const folders = ['', ...[...folderCounts.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
            folders.forEach(folderPath => {
                const button = document.createElement('button');
                const depth = folderPath ? folderPath.split('/').length - 1 : 0;
                const label = folderPath ? folderPath.split('/').pop() : t('pickerAllModels');
                const iconSvg = folderPath
                    ? '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
                    : '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
                button.innerHTML = `${iconSvg}${escapeHtml(label)} (${folderCounts.get(folderPath) || 0})`;
                button.title = folderPath || label;
                button.style.cssText = `text-align:left;padding:7px 8px 7px ${8 + depth * 14}px;border-radius:6px;border:none;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${selectedFolder === folderPath ? 'var(--amb-lt-text,#fff)' : 'var(--amb-lt-muted,#aaa)'};background:${selectedFolder === folderPath ? 'rgba(25,118,210,0.45)' : 'transparent'};`;
                button.onclick = () => {
                    selectedFolder = folderPath;
                    renderFolders();
                    renderCards();
                };
                folderList.appendChild(button);
            });
        };

        // Marks the chosen card in place: redrawing the grid would empty it and scroll back to the top.
        const paintCard = (card) => {
            const path = card.dataset.path;
            const isSelected = path === selectedPath;
            card.style.borderColor = isSelected ? '#6ea8ff' : path === currentPath ? '#e9b949' : '';
            card.style.boxShadow = isSelected ? '0 0 0 2px rgba(88,151,255,0.35),0 14px 28px rgba(0,0,0,0.28)' : '';
        };
        // The models page's card face; a video cover shows its still and plays while pointed at.
        const cardOwner = { energySaving: true, cardThumbnailMode: this.cardThumbnailMode };
        renderCards = () => {
            const term = searchInput.value.trim().toLowerCase();
            const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            const paths = validPaths.filter(path => {
                const normalized = normalizePath(path);
                const folderPath = getFolder(normalized);
                const inFolder = !selectedFolder || folderPath === selectedFolder || folderPath.startsWith(`${selectedFolder}/`);
                return pathMatchesBaseFilter(path) && inFolder && (!term || normalized.toLowerCase().includes(term));
            });
            if (sortSelect.value === 'name-desc') paths.sort((a, b) => collator.compare(getName(b), getName(a)));
            else if (sortSelect.value === 'folder-asc') paths.sort((a, b) => collator.compare(normalizePath(a), normalizePath(b)));
            else paths.sort((a, b) => collator.compare(getName(a), getName(b)));

            resultCount.textContent = t('pickerResults', { count: paths.length });
            stopMedia(grid);
            grid.replaceChildren();
            const generation = ++renderGeneration;
            let index = 0;
            const renderChunk = () => {
                if (generation !== renderGeneration || !modal.isConnected) return;
                const fragment = document.createDocumentFragment();
                const end = Math.min(index + 40, paths.length);
                for (; index < end; index += 1) {
                    const path = paths[index];
                    const info = modelInfo[path] || { filename: getName(path), metadata: {} };
                    const card = modelCardFace(cardOwner, { ...info, preview_url: info.preview_url || previews[path] || '' }, index);
                    card.classList.add('anomalous-picker-card');
                    card.tabIndex = 0;
                    card.setAttribute('role', 'button');
                    card.dataset.path = path;
                    card.title = normalizePath(path);
                    paintCard(card);
                    if (currentPath === path) card.appendChild(Object.assign(document.createElement('span'), { className: 'anomalous-picker-current', textContent: t('pickerCurrent') }));
                    const choose = () => {
                        selectedPath = path;
                        updateSelection();
                        grid.querySelectorAll('[data-path]').forEach(paintCard);
                    };
                    card.onclick = choose;
                    card.onkeydown = event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            choose();
                        }
                    };
                    fragment.appendChild(card);
                }
                grid.appendChild(fragment);
                if (index < paths.length) requestAnimationFrame(renderChunk);
            };
            if (paths.length) requestAnimationFrame(renderChunk);
            else {
                const empty = document.createElement('div');
                empty.textContent = t('pickerNoMatches');
                empty.style.cssText = 'color:var(--amb-text-dim);padding:30px;text-align:center;grid-column:1/-1;';
                grid.appendChild(empty);
            }
        };

        confirmBtn.onclick = async () => {
            if (!selectedPath || applying) return;
            applying = true;
            updateSelection();
            const oldValue = w.value;
            try {
                if (mode === 'insert') {
                    // The CLIP line goes through the LoRA only when the file trains the text encoder.
                    const textEncoder = await loraTrainsTextEncoder(selectedPath);
                    const plan = planLoraInsertion(app.graph, options.anchorNode, options.direction, { textEncoder });
                    if (!plan.supported) throw new Error(plan.code);
                    const inserted = plan.clip ? node : LiteGraph.createNode('LoraLoaderModelOnly');
                    const loraWidget = plan.clip ? w : findModelComboWidget(inserted);
                    setWidgetValue(inserted, loraWidget, selectedPath);
                    spliceLora({ graph: app.graph, plan, anchorNode: options.anchorNode, insertedNode: inserted });
                    try {
                        loraWidget.callback?.(loraWidget.value, app.canvas, inserted, app.canvas?.graph_mouse, null);
                    } catch (error) {
                        console.warn('[Anomalous] LoRA widget callback failed:', error);
                    }
                    recordCanvasStep(app);
                    closeModal();
                    app.canvas?.selectNode?.(inserted);
                    return;
                } else {
                    app.graph?.beforeChange?.(node);
                    try {
                        setWidgetValue(node, w, selectedPath);
                        if (typeof w.callback === 'function') w.callback(w.value, app.canvas, node, app.canvas?.graph_mouse, null);
                        // ComfyUI clears its own missing-model mark through this hook.
                        node.onWidgetChanged?.(w.name, w.value, oldValue, w);
                        app.graph?.afterChange?.(node);
                    } catch (error) {
                        setWidgetValue(node, w, oldValue);
                        app.graph?.afterChange?.(node);
                        throw error;
                    }
                    app.graph?.change?.();
                    app.graph?.setDirtyCanvas?.(true, true);
                }
                delete node.color;
                delete node.bgcolor;
                node.has_errors = false;
                if (app.lastNodeErrors?.[node.id]) delete app.lastNodeErrors[node.id];
                if (typeof app.clearErrors === 'function') app.clearErrors();
                try { window.dispatchEvent(new CustomEvent('graphChanged')); } catch (error) {}
                recordCanvasStep(app);
                closeModal();
                if (options.onApplied) options.onApplied();
                else this.diagnoseNode(node);
            } catch (error) {
                setWidgetValue(node, w, oldValue);
                applying = false;
                updateSelection();
                console.error('[Anomalous] Failed to apply model choice:', error);
            alert(t('pickerOperationFailed') + error.message);
            }
        };

        searchInput.oninput = renderCards;
        baseFilterSelect.onchange = () => {
            selectedBaseFamily = baseFilterSelect.value;
            selectedFolder = '';
            if (selectedPath && !pathMatchesBaseFilter(selectedPath)) selectedPath = null;
            rebuildFolderCounts();
            renderFolders();
            updateSelection();
            renderCards();
        };
        sortSelect.onchange = renderCards;
        window.addEventListener('keydown', onEscape, true);
        renderFolders();
        updateSelection();
        renderCards();
        setTimeout(() => searchInput.focus(), 0);

        const requestPayload = {
            paths: validPaths,
            context_requests: contextRequests,
        };
        if (pickerType.folderTypes.length) requestPayload.folder_types = pickerType.folderTypes;
        fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
        }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).then(data => {
            if (!modal.isConnected) return;
            previews = data.previews || {};
            modelInfo = data.models || {};
            contextModels = data.context_models || {};
            loadingText.style.display = 'none';
            configureBaseFilter();
            renderFolders();
            updateSelection();
            renderCards();
        }).catch(error => {
            if (!modal.isConnected) return;
            console.error('[Anomalous] Failed to load model previews:', error);
            loadingText.textContent = t('pickerCoversFailed');
            configureBaseFilter();
            renderFolders();
        });
    }

