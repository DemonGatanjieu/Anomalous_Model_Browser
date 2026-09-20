import { composePromptPlan } from './prompt_composition.js';

// Shared by Node Assistant and Material Library. No node creation or link edits.
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function selectedMaterialNode(app) {
    const nodes = Object.values(app.canvas?.selected_nodes || {});
    if (nodes.length !== 1 || !nodes[0]) return null;
    const node = nodes[0];
    const graph = app.graph?.getNodeById(node.id) === node ? app.graph : (node.graph || app.canvas?.graph || app.graph);
    return graph?.getNodeById(node.id) === node ? node : null;
}

function volatile(node, widget, index) {
    return /(^|[_\s-])(seed|noise_seed|random_seed|variation_seed|last_seed)([_\s-]|$)/i.test(widget?.name || '')
        || (node.type === 'KSampler' && index === 0) || (node.type === 'KSamplerAdvanced' && index === 1);
}

function hashesFor(graph, id) {
    return Object.fromEntries(Object.entries(graph.extra?.anomalous_hashes || {}).filter(([key]) => key.startsWith(`${id}_`)));
}

function replaceHashes(graph, id, records) {
    if (!Object.keys(records).length && !graph.extra?.anomalous_hashes) return;
    graph.extra ||= {};
    graph.extra.anomalous_hashes ||= {};
    for (const key of Object.keys(graph.extra.anomalous_hashes)) if (key.startsWith(`${id}_`)) delete graph.extra.anomalous_hashes[key];
    Object.assign(graph.extra.anomalous_hashes, clone(records));
}

export function applyNodeMaterialValues(app, node, entries, options = {}) {
    const graph = app.graph?.getNodeById(node?.id) === node ? app.graph : (node?.graph || app.canvas?.graph || app.graph);
    if (!node || graph?.getNodeById(node.id) !== node || !Array.isArray(node.widgets)) throw new Error('materialTargetChanged');
    const changes = entries.filter(({ index }) => !volatile(node, node.widgets[index], index));
    if (!changes.length) throw new Error('materialNoCompatibleValues');
    for (const { index, value } of changes) {
        const widget = node.widgets[index];
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('materialNoCompatibleValues');
        if (!Number.isInteger(index) || !widget || value === undefined) throw new Error('materialNoCompatibleValues');
        const choices = typeof widget.options?.values === 'function' ? widget.options.values() : widget.options?.values;
        if (Array.isArray(choices) && !choices.includes(value)) throw new Error('materialValueUnavailable');
        if (widget.value != null && (typeof widget.value !== typeof value || Array.isArray(widget.value) !== Array.isArray(value))) throw new Error('materialNoCompatibleValues');
    }
    const previous = node.widgets.map(widget => clone(widget.value));
    const serialized = clone(node.widgets_values);
    const hadExtra = Object.hasOwn(graph, 'extra');
    const hadHashes = !!graph.extra && Object.hasOwn(graph.extra, 'anomalous_hashes');
    const oldHashes = clone(hashesFor(graph, node.id));
    const transportsHashes = options.sourceNodeId !== undefined;
    const mapped = {};
    if (transportsHashes) {
        const prefix = `${options.sourceNodeId}_`;
        for (const [key, value] of Object.entries(options.workflowHashes || {})) {
            if (key.startsWith(prefix)) mapped[`${node.id}_${key.slice(prefix.length)}`] = clone(value);
        }
    }
    const notify = () => {
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        if (typeof globalThis.CustomEvent === 'function') {
            globalThis.window?.dispatchEvent(new CustomEvent('graphChanged'));
        }
    };
    const restore = () => {
        node.widgets.forEach((widget, index) => { widget.value = clone(previous[index]); });
        if (serialized === undefined) delete node.widgets_values;
        else node.widgets_values = clone(serialized);
        if (transportsHashes) {
            replaceHashes(graph, node.id, oldHashes);
            if (!hadHashes && graph.extra?.anomalous_hashes && !Object.keys(graph.extra.anomalous_hashes).length) delete graph.extra.anomalous_hashes;
            if (!hadExtra && graph.extra && !Object.keys(graph.extra).length) delete graph.extra;
        }
    };
    graph.beforeChange?.();
    try {
        for (const { index, value } of changes) {
            const widget = node.widgets[index];
            widget.value = clone(value);
            if (Array.isArray(node.widgets_values)) node.widgets_values[index] = clone(value);
            widget.callback?.call(widget, widget.value, app.canvas, node);
            node.onWidgetChanged?.(index, widget.value, previous[index], widget);
        }
        if (transportsHashes) replaceHashes(graph, node.id, mapped);
        notify();
    } catch (error) {
        restore();
        notify();
        throw error;
    } finally { graph.afterChange?.(); }
    const appliedSerialized = clone(node.widgets_values);
    const applied = node.widgets.map(widget => clone(widget.value));
    const appliedHashes = clone(hashesFor(graph, node.id));
    let undone = false;
    return {
        widgets: changes.length,
        undo() {
            if (undone || app.graph !== graph || graph.getNodeById(node.id) !== node
                || !same(node.widgets.map(widget => widget.value), applied)
                || !same(node.widgets_values, appliedSerialized)
                || !same(hashesFor(graph, node.id), appliedHashes)) throw new Error('materialUndoChanged');
            graph.beforeChange?.();
            try { restore(); notify(); undone = true; }
            finally { graph.afterChange?.(); }
        },
    };
}

export function applyMaterialBlock(app, node, block, workflowHashes) {
    if (node?.type !== block?.type || !Array.isArray(block.widgets_values)
        || block.widgets_values.length > (node.widgets?.length || 0)) throw new Error('materialNoCompatibleValues');
    return applyNodeMaterialValues(app, node, block.widgets_values.map((value, index) => ({ index, value })),
        { sourceNodeId: block.node_id, workflowHashes });
}

export const POSITIVE_PROMPT_REGEX = /^(positive|positive_prompt|text_positive|text_g|text_l|正面|正向|正面提示词|正向提示词)$/i;
export const NEGATIVE_PROMPT_REGEX = /^(negative|negative_prompt|text_negative|负面|反向|负面提示词|反向提示词)$/i;

export function isPositivePromptWidget(name) {
    return POSITIVE_PROMPT_REGEX.test(String(name || '').trim());
}

export function isNegativePromptWidget(name) {
    return NEGATIVE_PROMPT_REGEX.test(String(name || '').trim());
}

export function classifyPromptWidgetRole(name) {
    const trimmed = String(name || '').trim();
    if (POSITIVE_PROMPT_REGEX.test(trimmed)) return 'positive';
    if (NEGATIVE_PROMPT_REGEX.test(trimmed)) return 'negative';
    return null;
}

export function promptWidgetTargets(node) {
    const promptNameRegex = /^(text|text_g|text_l|prompt|positive|positive_prompt|negative|negative_prompt|text_positive|text_negative|caption|string|value|文本|提示词|正面|负面|正向|反向|正面提示词|负面提示词|正向提示词|反向提示词|描述|内容)$/i;
    return (node?.widgets || []).flatMap((widget, index) => {
        if (!widget) return [];
        const name = String(widget.name || '');
        const label = String(widget.label || '');
        const isNotCombo = !widget.options?.values || !Array.isArray(widget.options.values);
        const matchesName = promptNameRegex.test(name) || promptNameRegex.test(label) || widget.type === 'customtext' || widget.type === 'text' || !!widget.options?.multiline;
        return typeof widget.value === 'string' && matchesName && isNotCombo ? [{ index, name: name || label || 'text' }] : [];
    });
}

export function inspectNodePromptSlots(node) {
    const targets = promptWidgetTargets(node);
    if (!targets || !targets.length) {
        return {
            hasSlots: false,
            positiveSlot: null,
            negativeSlot: null,
            generalSlots: [],
            targets: [],
        };
    }

    let positiveSlot = null;
    let negativeSlot = null;
    const generalSlots = [];

    const nodeTitle = String(node?.title || node?.type || '').toLowerCase();
    const isNegativeTitle = /^(negative|负面|反向|负向)/i.test(nodeTitle) || /negative/i.test(nodeTitle);

    for (const target of targets) {
        const role = classifyPromptWidgetRole(target.name);
        if (role === 'positive' && !positiveSlot) {
            positiveSlot = target;
        } else if (role === 'negative' && !negativeSlot) {
            negativeSlot = target;
        } else {
            generalSlots.push(target);
        }
    }

    const isPositiveTitle = /^(positive|正面|正向)/i.test(nodeTitle) || /positive/i.test(nodeTitle);
    if (!positiveSlot && !negativeSlot && generalSlots.length === 1) {
        if (isNegativeTitle) {
            negativeSlot = generalSlots[0];
            generalSlots.length = 0;
        } else if (isPositiveTitle) {
            positiveSlot = generalSlots[0];
            generalSlots.length = 0;
        }
    }

    return {
        hasSlots: true,
        positiveSlot,
        negativeSlot,
        generalSlots,
        targets,
    };
}

export const MODEL_EXTENSIONS_REGEX = /\.(safetensors|ckpt|pt|bin|pth|sft|onnx|engine|gguf)$/i;

export function isModelFilePath(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const lines = trimmed.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    return lines.length > 0 && lines.every(line => MODEL_EXTENSIONS_REGEX.test(line));
}

export function isPromptNodeType(type) {
    const norm = String(type || '').trim().toLowerCase();
    if (!norm) return false;
    if (/lora|checkpoint|unet|vae|controlnet|sampler|latent|saveimage|previewimage|loadimage/i.test(norm)) {
        return false;
    }
    return /cliptextencode|prompt|text_box|showtext|easy positive|easy negative|easy wildcards/i.test(norm);
}

export function extractMaterialPromptEnvelope(material, payload = {}) {
    const effectivePayload = (payload && Object.keys(payload).length > 0) ? payload : (material || {});
    const data = effectivePayload.data || effectivePayload;

    let positive = '';
    let negative = '';
    let singleText = '';
    let primaryRole = 'none';

    // 1. Check prompt_plan
    if (data.kind === 'prompt_plan' || effectivePayload.kind === 'prompt_plan' || data.plan || effectivePayload.plan) {
        const plan = data.plan || effectivePayload.plan || {};
        const composed = composePromptPlan(plan);
        const pos = (composed.positive || '').trim();
        const neg = (composed.negative || '').trim();
        if (pos && neg) {
            positive = pos;
            negative = neg;
            singleText = pos;
            primaryRole = 'both';
        } else if (pos) {
            positive = pos;
            singleText = pos;
            primaryRole = 'positive';
        } else if (neg) {
            negative = neg;
            singleText = neg;
            primaryRole = 'negative';
        }
    }

    // 2. Check prompt_text / prompt_note_bundle
    if (primaryRole === 'none') {
        const note = data.note || effectivePayload.note;
        if (note) {
            const isZh = typeof window !== 'undefined' && window.anomalous_browser_lang === 'zh';
            const txt = (isZh && note.promptZh) ? note.promptZh : (note.promptEn || note.promptZh || '');
            if (txt && txt.trim() && !isModelFilePath(txt)) {
                singleText = txt.trim();
                const lowerName = String(effectivePayload.name || note.title || '').toLowerCase();
                const tags = Array.isArray(effectivePayload.tags) ? effectivePayload.tags.map(t => String(t).toLowerCase()) : [];
                const isNeg = lowerName.includes('negative') || lowerName.includes('负向') || lowerName.includes('反向')
                    || tags.some(t => t.includes('negative') || t.includes('负向') || t.includes('反向'));
                if (isNeg) {
                    negative = singleText;
                    primaryRole = 'negative';
                } else {
                    positive = singleText;
                    primaryRole = 'positive';
                }
            }
        }
    }

    // 3. Check prompt_groups (authoritative graph link tracing from backend)
    if (primaryRole === 'none') {
        const groups = effectivePayload.prompt_groups;
        if (groups && typeof groups === 'object') {
            const pgPos = (Array.isArray(groups.positive) ? groups.positive : [])
                .filter(v => typeof v === 'string' && v.trim() && !isModelFilePath(v))
                .join('\n\n')
                .trim();
            const pgNeg = (Array.isArray(groups.negative) ? groups.negative : [])
                .filter(v => typeof v === 'string' && v.trim() && !isModelFilePath(v))
                .join('\n\n')
                .trim();
            if (pgPos && pgNeg) {
                positive = pgPos;
                negative = pgNeg;
                singleText = pgPos;
                primaryRole = 'both';
            } else if (pgPos) {
                positive = pgPos;
                singleText = pgPos;
                primaryRole = 'positive';
            } else if (pgNeg) {
                negative = pgNeg;
                singleText = pgNeg;
                primaryRole = 'negative';
            }
        }
    }

    // 4. Check node_blocks (fallback only for prompt nodes)
    if (primaryRole === 'none') {
        const blocks = effectivePayload.node_blocks;
        const promptRoles = effectivePayload.prompt_roles;
        if (Array.isArray(blocks) && blocks.length > 0) {
            const posList = [];
            const negList = [];
            for (const block of blocks) {
                if (!block) continue;
                const blockType = String(block.type || '').toLowerCase();
                const role = promptRoles?.[String(block.node_id)]?.role || block.promptRole;
                const isExplicitPrompt = role === 'positive' || role === 'negative' || role === 'both';
                const isPromptType = isPromptNodeType(blockType);

                // STRICT GUARD: Only inspect blocks that are recognized prompt nodes or have prompt role
                if (!isExplicitPrompt && !isPromptType) continue;

                const widgetValues = Array.isArray(block.widgets_values) ? block.widgets_values : [];
                for (const val of widgetValues) {
                    if (typeof val === 'string' && val.trim()) {
                        const str = val.trim();
                        // Strictly reject any model filenames
                        if (isModelFilePath(str)) continue;

                        if (role === 'negative') {
                            negList.push(str);
                        } else if (role === 'positive') {
                            posList.push(str);
                        } else if (role === 'both') {
                            posList.push(str);
                            negList.push(str);
                        } else {
                            const blockTitle = String(block.title || block.type || '').toLowerCase();
                            if (/negative|负向|反向/i.test(blockTitle)) {
                                negList.push(str);
                            } else if (/positive|正向|正面/i.test(blockTitle) || isPromptType) {
                                posList.push(str);
                            }
                        }
                        break;
                    }
                }
            }
            const joinedPos = [...new Set(posList)].join('\n\n');
            const joinedNeg = [...new Set(negList)].join('\n\n');
            if (joinedPos && joinedNeg) {
                positive = joinedPos;
                negative = joinedNeg;
                singleText = joinedPos;
                primaryRole = 'both';
            } else if (joinedPos) {
                positive = joinedPos;
                singleText = joinedPos;
                primaryRole = 'positive';
            } else if (joinedNeg) {
                negative = joinedNeg;
                singleText = joinedNeg;
                primaryRole = 'negative';
            }
        }
    }

    // 5. Fallback to summary or name if kind is prompt_text
    if (primaryRole === 'none' && effectivePayload.kind === 'prompt_text') {
        const raw = effectivePayload.summary || effectivePayload.name || '';
        if (raw && raw.trim() && !isModelFilePath(raw)) {
            singleText = raw.trim();
            positive = singleText;
            primaryRole = 'positive';
        }
    }

    const hasPrompt = Boolean((positive && positive.trim()) || (negative && negative.trim()) || (singleText && singleText.trim()));

    return {
        hasPrompt,
        positive: positive.trim(),
        negative: negative.trim(),
        singleText: singleText.trim(),
        primaryRole,
    };
}

export function dispatchPromptInjection(app, node, envelope, options = {}) {
    if (!node || !envelope || !envelope.hasPrompt) {
        throw new Error('materialNoCompatibleValues');
    }

    const slots = inspectNodePromptSlots(node);
    if (!slots.hasSlots) {
        throw new Error('materialNoCompatibleValues');
    }

    const entries = [];

    // Strategy ①: Dual-Slot Pair Injection (成对原子注入)
    if (envelope.positive && envelope.negative && slots.positiveSlot && slots.negativeSlot) {
        entries.push({ index: slots.positiveSlot.index, value: envelope.positive });
        entries.push({ index: slots.negativeSlot.index, value: envelope.negative });
    }
    // Strategy ②: Role-Matched Injection (角色精准对齐)
    else if (envelope.primaryRole === 'negative' || (envelope.negative && !envelope.positive)) {
        const val = envelope.negative || envelope.singleText;
        const targetSlot = slots.negativeSlot || slots.generalSlots[0] || slots.positiveSlot || slots.targets[0];
        if (!targetSlot) throw new Error('materialNoCompatibleValues');
        entries.push({ index: targetSlot.index, value: val });
    }
    else if (envelope.primaryRole === 'positive' || (envelope.positive && !envelope.negative)) {
        const val = envelope.positive || envelope.singleText;
        const targetSlot = slots.positiveSlot || slots.generalSlots[0] || slots.negativeSlot || slots.targets[0];
        if (!targetSlot) throw new Error('materialNoCompatibleValues');
        entries.push({ index: targetSlot.index, value: val });
    }
    // Strategy ④: Single-Slot / General Fallback (单槽位/通用回退)
    else {
        if (slots.negativeSlot && !slots.positiveSlot) {
            const val = envelope.negative || envelope.singleText || envelope.positive;
            entries.push({ index: slots.negativeSlot.index, value: val });
        } else if (slots.positiveSlot && !slots.negativeSlot) {
            const val = envelope.positive || envelope.singleText || envelope.negative;
            entries.push({ index: slots.positiveSlot.index, value: val });
        } else {
            const targetSlot = slots.generalSlots[0] || slots.positiveSlot || slots.negativeSlot || slots.targets[0];
            if (!targetSlot) throw new Error('materialNoCompatibleValues');
            const val = envelope.positive || envelope.singleText || envelope.negative;
            entries.push({ index: targetSlot.index, value: val });
        }
    }

    if (!entries.length) {
        throw new Error('materialNoCompatibleValues');
    }

    return applyNodeMaterialValues(app, node, entries, options);
}


