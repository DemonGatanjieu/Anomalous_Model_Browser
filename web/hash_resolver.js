import { app } from "../../scripts/app.js";

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

    // Always fetch latest hashes before trying to resolve (using cache-buster to avoid stale hashes)
    try {
        const res = await fetch('/anomalous/all_hashes?t=' + Date.now());
        const data = await res.json();
        const hashesObj = data.hashes ? data.hashes : data;
        Object.assign(window.anomalous_hash_cache, hashesObj);
    } catch (e) {
        console.warn("[Anomalous] Failed to fetch hashes for manual resolution", e);
    }

    let fixed_count = 0;
    const hashes = (app.graph.extra && app.graph.extra.anomalous_hashes) || {};

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

                    let hashData = hashes[`${node.id}_${val}`];

                    // Fallback: If graph wasn't saved with hashes, check if the global cache knows this filename
                    if (!hashData && window.anomalous_hash_cache) {
                        const parts = val.split(/[/\\]/);
                        const basename = parts[parts.length - 1];
                        const cache_data = window.anomalous_hash_cache[basename] || window.anomalous_hash_cache[val];
                        if (cache_data) {
                            hashData = typeof cache_data === 'string' ? { hash: cache_data, size: "" } : cache_data;
                        }
                    }

                    if (hashData) {
                        let h = typeof hashData === 'string' ? hashData : hashData.hash;
                        let s = typeof hashData === 'string' ? "" : (hashData.size || "");
                        try {
                            const res = await fetch(`/anomalous/resolve_hash?hash=${encodeURIComponent(h)}&size=${encodeURIComponent(s)}`);
                            const resData = await res.json();

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
                                        try {
                                            await fetch('/anomalous/clear_cache', { method: 'POST' });
                                            await app.refreshComboInNodes();
                                            // Re-evaluate exact match after refreshing
                                            if (w.options && w.options.values) {
                                                const newMatch = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normRes);
                                                if (newMatch) finalValue = newMatch;
                                                else {
                                                    const newVals = [...w.options.values];
                                                    newVals.push(finalValue);
                                                    w.options.values = newVals;
                                                }
                                            }
                                        } catch (e) {
                                            console.warn("Failed to clear cache:", e);
                                        }
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
        if (app.lastNodeErrors) app.lastNodeErrors = null;
        if (typeof app.clearErrors === 'function') app.clearErrors();

        // Note: We removed the aggressive "ghost clicker" that automatically clicked the Refresh button in the Vue side panel.
        // It was too intrusive and could cause focus issues. Instead, we now gently remind the user via an alert.
        // 注：我们移除了主动点击 Vue 侧边栏刷新按钮的“幽灵连点器”，因为它侵入性过强且容易引发焦点问题。改为在弹窗中进行善意提醒。
    }

    if (is_manual && !silent) {
        // Detect current UI language (Default to 'zh' if not set)
        // 获取当前界面语言（未设置时默认使用中文）
        const lang = (window.anomalous_browser_lang === 'en') ? 'en' : 'zh';

        if (fixed_count > 0) {
            if (lang === 'en') {
                alert(`🪄 Anomalous successfully fixed ${fixed_count} missing model(s)!\n\n💡 Tip: If you still see errors in the "Workflow Overview" side panel, simply click its [Refresh] button to clear them.`);
            } else {
                alert(`🪄 Anomalous 成功修复了 ${fixed_count} 个缺失的模型！\n\n💡 提示：如果侧边栏【工作流总览】中依然显示红色报错，顺手点击一下该面板里的【刷新】按钮即可清除。`);
            }
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

        // Intercept graph serialization to inject hashes
        const origSerialize = LGraph.prototype.serialize;
        window.anomalous_has_warned_unscanned = false;
        window.anomalous_unscanned_models = [];
        LGraph.prototype.serialize = function () {
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
                                    const cache_data = window.anomalous_hash_cache[basename] || window.anomalous_hash_cache[val];
                                    if (cache_data) {
                                        if (typeof cache_data === 'string') {
                                            extraObj.anomalous_hashes[`${node.id}_${val}`] = { hash: cache_data, size: "" };
                                        } else {
                                            extraObj.anomalous_hashes[`${node.id}_${val}`] = cache_data;
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

            data.extra = extraObj;
            window.anomalous_unscanned_models = unscanned_models;
            return data;
        };



        // Intercept loadGraphData to resolve missing models
        const origLoadGraphData = app.loadGraphData;
        app.loadGraphData = function (graphData) {
            // Proceed with original loadGraphData synchronously first
            const ret = origLoadGraphData.apply(this, arguments);

            return ret;
        };
    }
});
