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

window.anomalous_resolve_all_missing_nodes = async function (is_manual = false) {
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

    // Always fetch latest hashes before trying to resolve
    try {
        const res = await fetch('/anomalous/all_hashes');
        const data = await res.json();
        Object.assign(window.anomalous_hash_cache, data);
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
                            if (node.color === "#FF3333" || node.bgcolor === "#FF3333" || node.color === "#f66") {
                                delete node.color;
                                delete node.bgcolor;
                            }
                            if (w.callback) {
                                w.callback(w.value, app.canvas, node, app.canvas.graph_mouse, null);
                            }
                            app.graph.setDirtyCanvas(true, true);
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
                                                else w.options.values.push(finalValue); // Absolute fallback
                                            }
                                        } catch (e) {
                                            console.warn("Failed to clear cache:", e);
                                        }
                                    }

                                    console.log(`[Anomalous Hash Resolver] Auto-fixed missing model: ${val} -> ${finalValue}`);
                                    w.value = finalValue;
                                    delete node.color;
                                    delete node.bgcolor;
                                    node.has_errors = false;
                                    if (w.callback) {
                                        w.callback(w.value, app.canvas, node, app.canvas.graph_mouse, null);
                                    }
                                    app.graph.setDirtyCanvas(true, true);
                                    fixed_count++;
                                }
                            } else if (!is_manual) {
                                showMissingModelPrompt(val, h);
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

    if (is_manual) {
        // Detect current UI language (Default to 'zh' if not set)
        // 获取当前界面语言（未设置时默认使用中文）
        const lang = (window.anomalous_browser_lang === 'en') ? 'en' : 'zh';

        if (fixed_count > 0) {
            if (lang === 'en') {
                alert(`🪄 Anomalous successfully fixed ${fixed_count} missing model(s)!\n\n💡 Tip: If you still see errors in the "Workflow Overview" side panel, simply click its [Refresh] button to clear them.`);
            } else {
                alert(`🪄 Anomalous 成功修复了 ${fixed_count} 个缺失的模型！\n\n💡 提示：如果侧边栏【工作流总览】中依然显示红色报错，顺手点击一下该面板里的【刷新】按钮即可清除。`);
            }
        } else {
            if (lang === 'en') {
                alert(`🪄 No models could be auto-fixed.\nIf nodes are still red, please open the Anomalous plugin window, click "Settings", and run a "Full Scan", or download the models from Civitai.`);
            } else {
                alert(`🪄 未发现可以自动修复的模型。\n如果依然有飘红，请点开 Anomalous 插件悬浮窗，进入【设置】并运行一次【一键全盘扫描】，或去 C站 下载缺失模型。`);
            }
        }
    }
};

function showMissingModelPrompt(filename, hash) {
    const existing = document.getElementById('anomalous-missing-prompt');
    let container;
    if (!existing) {
        container = document.createElement('div');
        container.id = 'anomalous-missing-prompt';
        container.style.position = 'fixed';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.background = 'var(--comfy-menu-bg, #222)';
        container.style.border = '1px solid var(--border-color, #444)';
        container.style.padding = '20px';
        container.style.borderRadius = '8px';
        container.style.zIndex = '9999';
        container.style.color = '#fff';
        container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        container.style.minWidth = '350px';

        const title = document.createElement('h3');
        title.innerText = '⚠️ 缺失模型提醒';
        title.style.marginTop = '0';
        title.style.color = '#ff6b6b';

        const desc = document.createElement('p');
        desc.style.fontSize = '0.9em';
        desc.style.color = '#ccc';
        desc.innerHTML = '点击下方的一键扫描会自动获取所有缺失模型的最新哈希信息。<br><br><span style="color:#ffc107">⚠️ 注意：</span>此操作<b>不会</b>重命名您的文件，也<b>不会</b>下载预览图，仅仅为了快速点亮红框节点。<br>如需全盘整理改名，请去左侧边栏的“设置”中执行“全局扫描”。';

        container.appendChild(title);
        container.appendChild(desc);

        const list = document.createElement('div');
        list.id = 'anomalous-missing-list';
        list.style.maxHeight = '200px';
        list.style.overflowY = 'auto';
        list.style.marginBottom = '15px';
        container.appendChild(list);

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '10px';
        btnRow.style.justifyContent = 'flex-end';

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '忽略并手动处理';
        closeBtn.style.padding = '6px 12px';
        closeBtn.style.background = '#444';
        closeBtn.style.color = '#fff';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => container.remove();

        const scanBtn = document.createElement('button');
        scanBtn.innerText = '一键扫描 (不改名)';
        scanBtn.style.padding = '6px 12px';
        scanBtn.style.background = '#007bff';
        scanBtn.style.color = '#fff';
        scanBtn.style.border = 'none';
        scanBtn.style.borderRadius = '4px';
        scanBtn.style.cursor = 'pointer';
        scanBtn.onclick = async () => {
            scanBtn.innerText = '启动中...';
            scanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/scan_all', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'ok') {
                    scanBtn.innerText = '正在后台极速获取信息中，请稍候...';

                    const pollTimer = setInterval(async () => {
                        try {
                            const statusRes = await fetch('/anomalous/global_scan_status');
                            const statusData = await statusRes.json();
                            if (!statusData.scanning) {
                                clearInterval(pollTimer);
                                container.remove();
                                // Add a tiny delay to ensure disk is flushed
                                setTimeout(async () => {
                                    alert('信息获取完成！正在为您自动点亮缺失模型...');
                                    await window.anomalous_resolve_all_missing_nodes(true);
                                }, 500);
                            }
                        } catch (e) {
                            console.error("Polling error", e);
                        }
                    }, 2000);
                } else {
                    alert('扫描启动失败: ' + data.message);
                    scanBtn.disabled = false;
                    scanBtn.innerText = '一键扫描 (不改名)';
                }
            } catch (err) {
                alert('请求失败');
                scanBtn.disabled = false;
                scanBtn.innerText = '一键扫描 (不改名)';
            }
        };

        const copyBtn = document.createElement('button');
        copyBtn.innerText = '复制所有 C站 下载链接';
        copyBtn.style.padding = '6px 12px';
        copyBtn.style.background = '#28a745';
        copyBtn.style.color = '#fff';
        copyBtn.style.border = 'none';
        copyBtn.style.borderRadius = '4px';
        copyBtn.style.cursor = 'pointer';
        copyBtn.onclick = () => {
            const links = Array.from(list.querySelectorAll('a')).map(a => a.href).join('\n');
            navigator.clipboard.writeText(links).then(() => {
                const oldText = copyBtn.innerText;
                copyBtn.innerText = '已复制！';
                setTimeout(() => copyBtn.innerText = oldText, 2000);
            });
        };

        btnRow.appendChild(closeBtn);
        btnRow.appendChild(scanBtn);
        btnRow.appendChild(copyBtn);
        container.appendChild(btnRow);

        document.body.appendChild(container);
    } else {
        container = existing;
    }

    const list = container.querySelector('#anomalous-missing-list');
    const item = document.createElement('div');
    item.style.marginBottom = '8px';
    item.style.borderBottom = '1px solid #333';
    item.style.paddingBottom = '8px';
    item.innerHTML = `<strong style="word-break: break-all;">${filename}</strong> <br><span style="font-size:0.8em; color:#aaa;">Hash: ${hash}</span>
        <a href="https://civitai.com/search/models?sortBy=models_v9&query=${hash}" target="_blank" style="color:#4dabf7; font-size:0.8em; margin-left:10px; text-decoration:none;">[去C站下载]</a>`;
    list.appendChild(item);
}

app.registerExtension({
    name: "Anomalous.ModelBrowser.HashResolver",

    async setup() {
        // Pre-fetch all hashes on startup so that dragging generated images (without opening UI) still intercepts
        try {
            const res = await fetch('/anomalous/all_hashes');
            const data = await res.json();
            Object.assign(window.anomalous_hash_cache, data);
        } catch (e) {
            console.warn("[Anomalous] Failed to fetch initial hashes", e);
        }



        // Intercept graph serialization to inject hashes
        const origSerialize = LGraph.prototype.serialize;
        LGraph.prototype.serialize = function () {
            const data = origSerialize.apply(this, arguments);

            // Clone extra to avoid mutating the live graph's extra object
            const extraObj = data.extra ? JSON.parse(JSON.stringify(data.extra)) : {};
            extraObj.anomalous_hashes = {};

            if (data.nodes) {
                for (const node of data.nodes) {
                    if (node.widgets_values && node.widgets_values.length > 0) {
                        for (const val of node.widgets_values) {
                            if (typeof val === 'string' && (val.endsWith('.safetensors') || val.endsWith('.ckpt') || val.endsWith('.pt'))) {
                                const parts = val.split(/[/\\]/);
                                const basename = parts[parts.length - 1];

                                const cache_data = window.anomalous_hash_cache[basename] || window.anomalous_hash_cache[val];
                                if (cache_data) {
                                    if (typeof cache_data === 'string') {
                                        extraObj.anomalous_hashes[`${node.id}_${val}`] = { hash: cache_data, size: "" };
                                    } else {
                                        extraObj.anomalous_hashes[`${node.id}_${val}`] = cache_data;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            data.extra = extraObj;
            return data;
        };

        // Intercept loadGraphData to resolve missing models
        const origLoadGraphData = app.loadGraphData;
        app.loadGraphData = function (graphData) {
            // Proceed with original loadGraphData synchronously first
            const ret = origLoadGraphData.apply(this, arguments);

            // After graph is loaded, we async fix the missing nodes
            if (graphData && graphData.extra && graphData.extra.anomalous_hashes) {
                setTimeout(async () => {
                    await window.anomalous_resolve_all_missing_nodes(false);
                }, 200); // Small delay to ensure ComfyUI has finished rendering/validating
            }

            return ret;
        };
    }
});
