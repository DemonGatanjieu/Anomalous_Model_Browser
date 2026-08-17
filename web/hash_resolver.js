import { app } from "../../scripts/app.js";
import { translate } from './modules/locales.js';

// Global cache for hashes: filename -> hash
window.anomalous_hash_cache = window.anomalous_hash_cache || {};

// Function to update cache, can be called from main.js
window.anomalous_update_hash_cache = function (models) {
    if (!models) return;
    for (const m of models) {
        if (m.filename && m.metadata && m.metadata.hash) {
            window.anomalous_hash_cache[m.filename] = {
                hash: m.metadata.hash,
                size: m.size_bytes || ""
            };
        }
    }
};

function inferExpectedModelTypes(node, widget) {
    const widgetName = String(widget?.name || '').toLowerCase();
    const nodeType = String(node?.type || '').toLowerCase();
    const key = `${widgetName} ${nodeType}`;

    if (widgetName.includes('vae') || nodeType === 'vaeloader' || key.includes('vae loader')) return 'vae';
    if (widgetName.includes('lora') || key.includes('lora')) return 'loras';
    if (widgetName.includes('control_net') || widgetName.includes('controlnet') || key.includes('controlnet')) return 'controlnet';
    if (widgetName.includes('ckpt') || widgetName.includes('checkpoint') || key.includes('checkpoint')) return 'checkpoints';
    if (widgetName.includes('unet') || widgetName.includes('diffusion_model') || key.includes('unet loader')) return 'diffusion_models,unet';
    return '';
}

window.anomalous_resolve_all_missing_nodes = async function (is_manual = false, silent = false) {
    if (!is_manual && localStorage.getItem('anomalous_auto_scan_enabled') !== 'true') return;
    if (!app.graph || !app.graph._nodes) return;

    // Fast path: if there are no missing nodes and it's not a manual check, abort early to save performance
    let has_missing = false;
    for (const node of app.graph._nodes) {
        if (node.color === "#FF3333" || node.bgcolor === "#FF3333" || node.color === "#f66" || (node.flags && node.flags.collapsed && node.color === "#FF3333")) {
            has_missing = true;
            break;
        }
        if (node.widgets) {
            for (let i = 0; i < node.widgets.length; i++) {
                const w = node.widgets[i];
                if (typeof w.value === 'string' && (w.value.endsWith('.safetensors') || w.value.endsWith('.ckpt') || w.value.endsWith('.pt'))) {
                    if (w.options && w.options.values && !w.options.values.includes(w.value)) {
                        has_missing = true;
                        break;
                    }
                }
            }
        }
        if (has_missing) break;
    }

    if (!has_missing && !is_manual) return;

    // Refresh ComfyUI's frontend folder paths cache to prevent false-positive red nodes
    if (app.refreshComboInNodes) {
        try {
            await app.refreshComboInNodes();
        } catch (e) {
            console.warn("[Anomalous Hash Resolver] Failed to refresh ComfyUI node combos", e);
        }
    }

    const hashes = (app.graph.extra && app.graph.extra.anomalous_hashes) || {};
    const getWorkflowHash = (nodeId, val) => {
        if (!hashes || typeof val !== 'string') return null;
        const normVal = val.replace(/\\/g, '/');
        const winVal = val.replace(/\//g, '\\');
        return hashes[`${nodeId}_${val}`] ||
               hashes[`${nodeId}_${normVal}`] ||
               hashes[`${nodeId}_${winVal}`] ||
               hashes[val] ||
               hashes[normVal] ||
               hashes[winVal] ||
               null;
    };

    let needsGlobalHashRefresh = false;
    provenanceCheck:
    for (const node of app.graph._nodes) {
        for (const widget of (node.widgets || [])) {
            const value = widget.value;
            if (typeof value !== 'string' || !(value.endsWith('.safetensors') || value.endsWith('.ckpt') || value.endsWith('.pt'))) continue;
            if (!getWorkflowHash(node.id, value)) {
                needsGlobalHashRefresh = true;
                break provenanceCheck;
            }
        }
    }

    // Provenance-rich workflows already carry the identity data needed by the
    // doctor. Refresh the full local filename->hash cache only for legacy items
    // that actually need that fallback.
    if (needsGlobalHashRefresh) {
        try {
            const res = await fetch('/anomalous/all_hashes?t=' + Date.now());
            const data = await res.json();
            const hashesObj = data.hashes ? data.hashes : data;
            Object.assign(window.anomalous_hash_cache, hashesObj);
        } catch (e) {
            console.warn("[Anomalous] Failed to fetch hashes for manual resolution", e);
        }
    }

    let fixed_count = 0;

    const findHashData = (node, widget, value) => {
        let hashData = getWorkflowHash(node.id, value);
        if (!hashData && window.anomalous_hash_cache && typeof value === 'string') {
            const parts = value.split(/[/\\]/);
            const basename = parts[parts.length - 1];
            const normVal = value.replace(/\\/g, '/');
            const cacheData = window.anomalous_hash_cache[value] || window.anomalous_hash_cache[normVal] || window.anomalous_hash_cache[basename];
            if (cacheData) hashData = typeof cacheData === 'string' ? { hash: cacheData, size: "" } : cacheData;
        }
        return hashData;
    };

    // Resolve all model references in one request. The backend groups items by
    // required model category and scans each category once. Native slash-only
    // normalization remains in the existing loop below and needs no disk scan.
    const batchItems = [];
    for (const node of app.graph._nodes) {
        if (!node.widgets) continue;
        for (let i = 0; i < node.widgets.length; i++) {
            const widget = node.widgets[i];
            const value = widget.value;
            if (typeof value !== 'string' || !(value.endsWith('.safetensors') || value.endsWith('.ckpt') || value.endsWith('.pt'))) continue;
            if (widget.options && widget.options.values && !widget.options.values.includes(value)) {
                const normalized = value.replace(/\\/g, '/');
                const nativeMatch = widget.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normalized);
                if (nativeMatch && nativeMatch !== value) continue;
            }
            const hashData = findHashData(node, widget, value);
            if (!hashData) continue;
            const hash = typeof hashData === 'string' ? hashData : (hashData.hash || "");
            const size = typeof hashData === 'string' ? "" : (hashData.size || "");
            if (!hash && !size) continue;
            batchItems.push({
                key: `${node.id}:${i}:${value}`,
                hash,
                size,
                type: inferExpectedModelTypes(node, widget)
            });
        }
    }

    const batchResults = new Map();
    if (batchItems.length) {
        try {
            for (let offset = 0; offset < batchItems.length; offset += 256) {
                const batchResponse = await fetch('/anomalous/resolve_hash_batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: batchItems.slice(offset, offset + 256) })
                });
                if (!batchResponse.ok) throw new Error(`HTTP ${batchResponse.status}`);
                const batchData = await batchResponse.json();
                for (const entry of (batchData.results || [])) batchResults.set(entry.key, entry.result);
            }
        } catch (error) {
            console.warn('[Anomalous Hash Resolver] Batch resolution failed; falling back to single-item requests.', error);
        }
    }

    for (const node of app.graph._nodes) {
        if (node.widgets) {
            for (let i = 0; i < node.widgets.length; i++) {
                const w = node.widgets[i];
                const val = w.value;
                if (typeof val === 'string' && (val.endsWith('.safetensors') || val.endsWith('.ckpt') || val.endsWith('.pt'))) {

                    // Native slash mismatch fix: if val isn't in options, but matches if we normalize slashes
                    if (w.options && w.options.values && !w.options.values.includes(val)) {
                        const normVal = val.replace(/\\/g, '/');
                        const exactMatch = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normVal);
                        if (exactMatch && exactMatch !== val) {
                            console.log(`[Anomalous Hash Resolver] Fixed slash mismatch: ${val} -> ${exactMatch}`);
                            w.value = exactMatch;
                            const wIdx = node.widgets.indexOf(w);
                            if (wIdx !== -1 && node.widgets_values) {
                                node.widgets_values[wIdx] = exactMatch;
                            }
                            delete node.color;
                            delete node.bgcolor;
                            node.has_errors = false;
                            
                            if (app.lastNodeErrors && app.lastNodeErrors[node.id]) {
                                delete app.lastNodeErrors[node.id];
                            }
                            
                            if (w.callback) {
                                w.callback(w.value, app.canvas, node, app.canvas.graph_mouse, null);
                            }
                            app.graph.setDirtyCanvas(true, true);
                            fixed_count++; // Mark as fixed so the global graph update is triggered!
                            continue; // Already fixed natively, skip backend lookup
                        }
                    }

                    const hashData = findHashData(node, w, val);

                    if (hashData) {
                        let h = typeof hashData === 'string' ? hashData : hashData.hash;
                        let s = typeof hashData === 'string' ? "" : (hashData.size || "");
                        try {
                            const expectedTypes = inferExpectedModelTypes(node, w);
                            const typeQuery = expectedTypes ? `&type=${encodeURIComponent(expectedTypes)}` : '';
                            const batchKey = `${node.id}:${i}:${val}`;
                            let resData = batchResults.get(batchKey);
                            if (!batchResults.has(batchKey)) {
                                const res = await fetch(`/anomalous/resolve_hash?hash=${encodeURIComponent(h)}&size=${encodeURIComponent(s)}${typeQuery}`);
                                resData = await res.json();
                            }

                            if (resData.found) {
                                const normVal = val.replace(/\\/g, '/');
                                const normRes = resData.filename.replace(/\\/g, '/');

                                let finalValue = resData.filename;
                                let optionsCacheStale = false;
                                if (w.options && w.options.values) {
                                    const exactMatch = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normRes);
                                    if (exactMatch) {
                                        finalValue = exactMatch;
                                    } else {
                                        optionsCacheStale = true;
                                    }
                                }

                                if (finalValue !== val || normRes !== normVal || optionsCacheStale || node.has_errors || node.color) {
                                    if (optionsCacheStale) {
                                        console.log(`[Anomalous Hash Resolver] Found ${finalValue} on disk, but ComfyUI frontend dropdown is stale. Forcing backend cache clear...`);
                                        let refreshedMatch = null;
                                        try {
                                            await fetch('/anomalous/clear_cache', { method: 'POST' });
                                            await app.refreshComboInNodes();
                                            // Re-evaluate exact match after refreshing
                                            if (w.options && w.options.values) {
                                                refreshedMatch = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normRes) || null;
                                            }
                                        } catch (e) {
                                            console.warn("Failed to clear cache:", e);
                                        }
                                        if (!refreshedMatch) {
                                            console.warn(`[Anomalous Hash Resolver] Rejected cross-type or invalid model path for ${node.type}.${w.name}: ${finalValue}`);
                                            continue;
                                        }
                                        finalValue = refreshedMatch;
                                    }

                                    console.log(`[Anomalous Hash Resolver] Auto-fixed missing model: ${val} -> ${finalValue}`);
                                    w.value = finalValue;
                                    const wIdx = node.widgets.indexOf(w);
                                    if (wIdx !== -1 && node.widgets_values) {
                                        node.widgets_values[wIdx] = finalValue;
                                    }
                                    delete node.color;
                                    delete node.bgcolor;
                                    node.has_errors = false;
                                    node.anomalous_auto_resolved = true;
                                    node.anomalous_original_missing_val = val;
                                    if (w.callback) {
                                        w.callback(w.value, app.canvas, node, app.canvas.graph_mouse, null);
                                    }
                                    app.graph.setDirtyCanvas(true, true);
                                    fixed_count++;
                                }
                            }
                        } catch (err) {
                            console.error("[Anomalous Hash Resolver] Error:", err);

                        }
                    }
                }
            }
        }
    }

    if (fixed_count > 0) {
        // Force ComfyUI v1 side panels (Workflow Overview/Parameters) to re-evaluate and clear errors
        if (app.graph && app.graph.change) app.graph.change();
        try {
            window.dispatchEvent(new CustomEvent("graphChanged"));
        } catch (e) { }

        // Deep clear ComfyUI native error caches
        if (app.lastNodeErrors) {
            Object.keys(app.lastNodeErrors).forEach(key => delete app.lastNodeErrors[key]);
        }
        if (typeof app.clearErrors === 'function') app.clearErrors();

        // Note: We removed the aggressive "ghost clicker" that automatically clicked the Refresh button in the Vue side panel.
        // It was too intrusive and could cause focus issues. Instead, we now gently remind the user via an alert.
        // 注：我们移除了主动点击 Vue 侧边栏刷新按钮的“幽灵连点器”，因为它侵入性过强且容易引发焦点问题。改为在弹窗中进行善意提醒。
    }

    if (is_manual && !silent) {
        if (fixed_count > 0) {
            alert(translate('hashResolverFixed', { count: fixed_count }));
        }
    }
};



app.registerExtension({
    name: "Anomalous.ModelBrowser.HashResolver",

    async setup() {
        // Expose global reload function so scans can trigger it
        window.anomalous_reload_hashes = async function () {
            try {
                const resp = await fetch('/anomalous/all_hashes');
                const data = await resp.json();
                window.anomalous_hash_cache = data.hashes ? data.hashes : data;
                window.anomalous_is_empty_state = Object.keys(window.anomalous_hash_cache).length === 0;
            } catch (e) {
                window.anomalous_hash_cache = {};
                window.anomalous_is_empty_state = true;
                console.warn("[Anomalous] Failed to fetch hashes", e);
            }
        };

        // Pre-fetch all hashes on startup so that dragging generated images (without opening UI) still intercepts
        await window.anomalous_reload_hashes();

        // Intercept graph serialization to inject hashes. ComfyUI 0.27 no
        // longer guarantees a global LGraph symbol, so prefer the graph's
        // actual constructor and fail closed if the graph API is unavailable.
        // This resolver is optional and must never prevent the main browser
        // extension from registering its visible entry point.
        const graphClass = [app.graph?.constructor, globalThis.LGraph].find((candidate) => (
            candidate?.prototype && typeof candidate.prototype.serialize === 'function'
        ));
        if (!graphClass) {
            console.warn('[Anomalous Hash Resolver] Graph serialization API is unavailable; resolver disabled for this session.');
            return;
        }
        if (graphClass.prototype.__anomalousHashResolverPatched) return;

        const origSerialize = graphClass.prototype.serialize;
        window.anomalous_has_warned_unscanned = false;
        window.anomalous_unscanned_models = [];
        graphClass.prototype.__anomalousHashResolverPatched = true;
        graphClass.prototype.serialize = function () {
            const data = origSerialize.apply(this, arguments);

            if (localStorage.getItem('anomalous_inject_hash') === 'false') {
                return data;
            }

            // Clone extra to avoid mutating the live graph's extra object
            const extraObj = data.extra ? JSON.parse(JSON.stringify(data.extra)) : {};
            extraObj.anomalous_hashes = {};
            let unscanned_models = [];

            if (data.nodes) {
                const liveNodes = this._nodes || [];
                for (const node of data.nodes) {
                    const liveNode = liveNodes.find(n => n.id === node.id);

                    if (node.widgets_values && node.widgets_values.length > 0) {
                        for (const val of node.widgets_values) {
                            if (typeof val === 'string' && (val.endsWith('.safetensors') || val.endsWith('.ckpt') || val.endsWith('.pt'))) {
                                const parts = val.split(/[/\\]/);
                                const basename = parts[parts.length - 1];

                                let valIsMissing = false;
                                if (liveNode && liveNode.widgets) {
                                    const matchingWidget = liveNode.widgets.find(w => w.value === val && w.type === "combo");
                                    if (matchingWidget && matchingWidget.options && matchingWidget.options.values && !matchingWidget.options.values.includes(val)) {
                                        valIsMissing = true;
                                    }
                                }

                                if (!valIsMissing) {
                                    const normVal = val.replace(/\\/g, '/');
                                    const cache_data = window.anomalous_hash_cache[val] || window.anomalous_hash_cache[normVal] || window.anomalous_hash_cache[basename];
                                    if (cache_data) {
                                        const hashObj = typeof cache_data === 'string' ? { hash: cache_data, size: "" } : cache_data;
                                        extraObj.anomalous_hashes[`${node.id}_${val}`] = hashObj;
                                        if (normVal !== val) {
                                            extraObj.anomalous_hashes[`${node.id}_${normVal}`] = hashObj;
                                        }
                                    } else {
                                        if (!unscanned_models.includes(basename)) {
                                            unscanned_models.push(basename);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            data.extra = extraObj;
            window.anomalous_unscanned_models = unscanned_models;
            return data;
        };

        // Intercept loadGraphData to resolve missing models
        if (typeof app.loadGraphData === 'function') {
            const origLoadGraphData = app.loadGraphData;
            app.loadGraphData = function (graphData) {
                // Proceed with original loadGraphData synchronously first
                return origLoadGraphData.apply(this, arguments);
            };
        }
    }
});
