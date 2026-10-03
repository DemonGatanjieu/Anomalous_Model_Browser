import { app } from "../../scripts/app.js";
import { findWorkflowHashRecord } from './modules/recipe_provenance.js';
import { requiresHashForModelRecovery } from './modules/model_policies.js';
import { detectPlatform, isModelFilename } from './modules/model_source_links.js';
import { usableSourceUrl } from './modules/model_source_data.js';

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

/**
 * A model's own download link (its information's, the editor's first) for a workflow that
 * keeps none of its own for it; `auto` marks it as taken, so a newer one replaces it.
 */
function addOwnSource(sources, nodeId, value, basename, record) {
    const url = usableSourceUrl(record?.url);
    const kept = sources[value] || sources[basename];
    if (!url || (kept && !kept.auto)) return;
    sources[value] = { name: value, url, platform: detectPlatform(url)?.name || 'Custom', nodeId, hash: record.hash || '', auto: true };
}

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
            const existingProvenance = {
                extra: {
                    anomalous_hashes: extraObj.anomalous_hashes
                        ? JSON.parse(JSON.stringify(extraObj.anomalous_hashes))
                        : {},
                },
            };
            extraObj.anomalous_hashes = {};
            const liveSources = (this.extra && this.extra.anomalous_model_sources) ||
                                (app.graph?.extra && app.graph.extra.anomalous_model_sources) ||
                                extraObj.anomalous_model_sources || null;
            // Download links travel with the fingerprints: the workflow's own, else each model's.
            const sources = liveSources && typeof liveSources === 'object' ? JSON.parse(JSON.stringify(liveSources)) : {};
            const usedNames = new Set();
            let unscanned_models = [];

            if (data.nodes) {
                const liveNodes = this._nodes || [];
                for (const node of data.nodes) {
                    const liveNode = liveNodes.find(n => n.id === node.id);

                    if (node.widgets_values && node.widgets_values.length > 0) {
                        for (const val of node.widgets_values) {
                            if (typeof val === 'string') {
                                usedNames.add(val).add(val.replace(/\\/g, '/')).add(val.split(/[/\\]/).pop());
                            }
                            if (isModelFilename(val)) {
                                const parts = val.split(/[/\\]/);
                                const basename = parts[parts.length - 1];

                                let valIsMissing = false;
                                let matchingWidget = null;
                                if (liveNode && liveNode.widgets) {
                                    matchingWidget = liveNode.widgets.find(w => w.value === val && w.type === "combo") || null;
                                    if (matchingWidget && matchingWidget.options && matchingWidget.options.values && !matchingWidget.options.values.includes(val)) {
                                        valIsMissing = true;
                                    }
                                }

                                if (!valIsMissing) {
                                    const normVal = val.replace(/\\/g, '/');
                                    const cache_data = window.anomalous_hash_cache[val] || window.anomalous_hash_cache[normVal] || window.anomalous_hash_cache[basename];
                                    if (cache_data) {
                                        let hashObj = typeof cache_data === 'string' ? { hash: cache_data, size: "" } : cache_data;
                                        if (matchingWidget && requiresHashForModelRecovery(liveNode, matchingWidget) && !hashObj.hash) {
                                            const preserved = findWorkflowHashRecord(existingProvenance, node.id, val);
                                            if (preserved?.hash) hashObj = preserved;
                                            else {
                                                if (!unscanned_models.includes(basename)) unscanned_models.push(basename);
                                                continue;
                                            }
                                        }
                                        extraObj.anomalous_hashes[`${node.id}_${val}`] = hashObj;
                                        if (normVal !== val) {
                                            extraObj.anomalous_hashes[`${node.id}_${normVal}`] = hashObj;
                                        }
                                        addOwnSource(sources, node.id, val, basename, { ...hashObj, url: cache_data.url });
                                    } else {
                                        const preserved = findWorkflowHashRecord(existingProvenance, node.id, val);
                                        if (preserved) {
                                            extraObj.anomalous_hashes[`${node.id}_${val}`] = preserved;
                                            if (normVal !== val) extraObj.anomalous_hashes[`${node.id}_${normVal}`] = preserved;
                                        } else if (!unscanned_models.includes(basename)) {
                                            unscanned_models.push(basename);
                                        }
                                    }
                                } else {
                                    // Missing dropdown values cannot be rediscovered from the
                                    // local cache. Preserve recipe/workflow provenance so Model
                                    // Doctor can still recover the exact appended reference.
                                    const preserved = findWorkflowHashRecord(existingProvenance, node.id, val);
                                    if (preserved) {
                                        const normVal = val.replace(/\\/g, '/');
                                        extraObj.anomalous_hashes[`${node.id}_${val}`] = preserved;
                                        if (normVal !== val) extraObj.anomalous_hashes[`${node.id}_${normVal}`] = preserved;
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
            // A link for a model no node names any more (replaced, removed) stays behind.
            for (const name of Object.keys(sources)) if (!usedNames.has(name)) delete sources[name];
            if (Object.keys(sources).length) extraObj.anomalous_model_sources = sources;
            else delete extraObj.anomalous_model_sources;
            data.extra = extraObj;
            window.anomalous_unscanned_models = unscanned_models;
            return data;
        };
    }
});
