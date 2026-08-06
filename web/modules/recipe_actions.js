import { app } from '../../../scripts/app.js';

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function nodeType(node) {
    return String(node?.type || node?.class_type || '').trim();
}

function savedNodeRecords(workflow) {
    return Array.isArray(workflow?.nodes) ? workflow.nodes.filter((node) => node && node.id !== undefined) : [];
}

function nodeShape(node) {
    const inputs = Array.isArray(node?.inputs) ? node.inputs.length : -1;
    const outputs = Array.isArray(node?.outputs) ? node.outputs.length : -1;
    return `${nodeType(node)}|${inputs}|${outputs}`;
}

function nodeTitle(node) {
    return String(node?.title || node?.properties?.['Node name for S&R'] || '').trim().toLowerCase();
}

function liveNodeById(graph, id) {
    return graph?.getNodeById?.(id)
        || graph?.getNodeById?.(Number(id))
        || graph?._nodes?.find((node) => String(node?.id) === String(id))
        || null;
}

function volatileWidget(node, widget, index) {
    const name = String(widget?.name || '').toLowerCase();
    if (/(^|[_\s-])(seed|noise_seed|random_seed|variation_seed|last_seed)([_\s-]|$)/i.test(name)) return true;
    const type = nodeType(node).toLowerCase();
    if (type === 'ksampler') return index === 0;
    if (type === 'ksampleradvanced') return index === 1;
    return false;
}

function matchSkeleton(sourceWorkflow, candidateWorkflow) {
    const sourceNodes = savedNodeRecords(sourceWorkflow);
    const candidateNodes = savedNodeRecords(candidateWorkflow);
    const available = new Set(candidateNodes);
    const matches = new Map();
    const missing = [];
    for (const source of sourceNodes) {
        const exact = [...available].find((candidate) => (
            String(candidate.id) === String(source.id)
            && nodeType(candidate) === nodeType(source)
            && nodeShape(candidate) === nodeShape(source)
        ));
        const sameTitle = [...available].find((candidate) => (
            nodeShape(candidate) === nodeShape(source)
            && nodeTitle(candidate) === nodeTitle(source)
            && nodeTitle(source)
        ));
        const sameShape = [...available].find((candidate) => nodeShape(candidate) === nodeShape(source));
        const sameType = [...available].find((candidate) => nodeType(candidate) === nodeType(source));
        const target = exact || sameTitle || sameShape || sameType;
        if (!target) {
            missing.push(nodeType(source) || String(source.id));
            continue;
        }
        available.delete(target);
        matches.set(String(source.id), target);
    }
    return { matches, missing, sourceCount: sourceNodes.length, candidateCount: candidateNodes.length };
}

export function assertRecipeSkeleton(sourceWorkflow, candidateWorkflow) {
    const result = matchSkeleton(sourceWorkflow, candidateWorkflow);
    if (result.missing.length) {
        const error = new Error(`Missing recipe skeleton nodes: ${result.missing.join(', ')}`);
        error.code = 'recipe_parameter_skeleton_mismatch';
        error.missing = result.missing;
        throw error;
    }
    return result;
}

/** Apply only saved widget values to a matching local graph, with rollback. */
export function applyRecipeParametersToCanvas(source) {
    const graph = app.graph;
    const sourceWorkflow = source?.workflow;
    const candidateWorkflow = graph?.serialize?.();
    if (!graph || !sourceWorkflow || !candidateWorkflow) throw new Error('recipe_parameter_apply_unavailable');
    const skeleton = assertRecipeSkeleton(sourceWorkflow, candidateWorkflow);
    const sourceNodes = savedNodeRecords(sourceWorkflow);
    const changes = [];
    for (const sourceNode of sourceNodes) {
        const targetRecord = skeleton.matches.get(String(sourceNode.id));
        if (!targetRecord || !Array.isArray(sourceNode.widgets_values)) continue;
        // `candidateWorkflow` is a serialized graph and intentionally has no
        // live widget objects. Resolve the matched record back to ComfyUI's
        // runtime node before reading callbacks or writing widget values.
        const target = liveNodeById(graph, targetRecord.id);
        if (!target) {
            const error = new Error(`Could not resolve live node ${targetRecord.id} on ${nodeType(targetRecord)}`);
            error.code = 'recipe_parameter_node_unavailable';
            throw error;
        }
        const targetWidgets = Array.isArray(target.widgets) ? target.widgets : [];
        for (let index = 0; index < sourceNode.widgets_values.length; index += 1) {
            if (volatileWidget(sourceNode, targetWidgets[index], index)) continue;
            if (!targetWidgets[index]) {
                const error = new Error(`Missing widget ${index} on ${nodeType(target)}`);
                error.code = 'recipe_parameter_widget_mismatch';
                throw error;
            }
            changes.push({
                sourceNode,
                target,
                targetWidget: targetWidgets[index],
                index,
                value: cloneJson(sourceNode.widgets_values[index]),
                previousValue: cloneJson(targetWidgets[index].value),
            });
        }
    }

    const previous = changes.map((change) => ({ ...change, previousValue: cloneJson(change.previousValue) }));
    graph.beforeChange?.();
    try {
        for (const change of changes) {
            change.targetWidget.value = cloneJson(change.value);
            if (Array.isArray(change.target.widgets_values)) change.target.widgets_values[change.index] = cloneJson(change.value);
            if (typeof change.targetWidget.callback === 'function') {
                change.targetWidget.callback.call(change.targetWidget, change.targetWidget.value, app.canvas, change.target);
            }
            if (typeof change.target.onWidgetChanged === 'function') {
                // Current ComfyUI uses the fourth argument as the live widget
                // for its error-clearing hooks. Omitting it makes those hooks
                // evaluate `sourceNodeId in undefined`.
                change.target.onWidgetChanged(
                    change.index,
                    change.targetWidget.value,
                    change.previousValue,
                    change.targetWidget,
                );
            }
        }
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        return { nodes: sourceNodes.length, widgets: changes.length };
    } catch (error) {
        for (const change of previous) {
            change.targetWidget.value = cloneJson(change.previousValue);
            if (Array.isArray(change.target.widgets_values)) change.target.widgets_values[change.index] = cloneJson(change.previousValue);
        }
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        throw error;
    } finally {
        graph.afterChange?.();
    }
}

function linkRecords(workflow) {
    if (Array.isArray(workflow?.links)) return workflow.links.filter((link) => Array.isArray(link) || link && typeof link === 'object');
    if (workflow?.links instanceof Map) return [...workflow.links.values()].filter(Boolean);
    if (workflow?.links && typeof workflow.links === 'object') return Object.values(workflow.links).filter(Boolean);
    return [];
}

function savedGroupRecords(workflow) {
    return Array.isArray(workflow?.groups) ? workflow.groups.filter((group) => group && typeof group === 'object') : [];
}

function graphNode(graph, id) {
    return graph?.getNodeById?.(id)
        || graph?._nodes?.find((node) => String(node?.id) === String(id))
        || null;
}

function nextNodeId(graph, usedIds) {
    let max = 0;
    for (const node of graph?._nodes || []) max = Math.max(max, Number(node?.id) || 0);
    for (const id of usedIds) max = Math.max(max, Number(id) || 0);
    return max + 1;
}

function liveBounds(graph) {
    const nodes = (graph?._nodes || []).filter(Boolean);
    if (!nodes.length) return null;
    return nodes.reduce((bounds, node) => {
        const x = Number(node.pos?.[0]) || 0;
        const y = Number(node.pos?.[1]) || 0;
        const width = Number(node.size?.[0]) || 220;
        const height = Number(node.size?.[1]) || 120;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x + width);
        bounds.maxY = Math.max(bounds.maxY, y + height);
        return bounds;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function savedBounds(nodes) {
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return nodes.reduce((bounds, node) => {
        const x = Number(node.pos?.[0]) || 0;
        const y = Number(node.pos?.[1]) || 0;
        const width = Number(node.size?.[0]) || 220;
        const height = Number(node.size?.[1]) || 120;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x + width);
        bounds.maxY = Math.max(bounds.maxY, y + height);
        return bounds;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function instantiateNode(nodeData) {
    const type = nodeType(nodeData);
    const creator = globalThis.LiteGraph?.createNode;
    if (typeof creator !== 'function' || !type) return null;
    const node = creator.call(globalThis.LiteGraph, type);
    if (!node) return null;
    node.configure?.(cloneJson(nodeData));
    return node;
}

function instantiateGroup(groupData) {
    const GroupClass = globalThis.LiteGraph?.LGraphGroup;
    if (typeof GroupClass !== 'function') return null;
    const group = new GroupClass(String(groupData?.title || ''));
    group.configure?.(cloneJson(groupData));
    return group;
}

function linkField(link, arrayIndex, objectKey) {
    return Array.isArray(link) ? link[arrayIndex] : link?.[objectKey];
}

function connectLink(link, idMap, graph) {
    const originId = linkField(link, 1, 'origin_id');
    const targetId = linkField(link, 3, 'target_id');
    const originSlot = linkField(link, 2, 'origin_slot');
    const targetSlot = linkField(link, 4, 'target_slot');
    if (originId === undefined || targetId === undefined || originSlot === undefined || targetSlot === undefined) return false;
    const origin = graphNode(graph, idMap.get(String(originId)));
    const target = graphNode(graph, idMap.get(String(targetId)));
    if (!origin || !target) return false;
    const result = origin.connect?.(Number(originSlot), target, Number(targetSlot));
    return Boolean(result);
}

/** Merge one serialized workflow into the live graph as one rollback-able action. */
export function appendRecipeToCanvas(recipe) {
    const graph = app.graph;
    const savedNodes = savedNodeRecords(recipe?.workflow);
    const savedLinks = linkRecords(recipe?.workflow);
    const savedGroups = savedGroupRecords(recipe?.workflow);
    if (!graph || !savedNodes.length) throw new Error('recipe_append_empty');
    if (typeof globalThis.LiteGraph?.createNode !== 'function') throw new Error('recipe_append_unsupported');
    if (recipe?.workflow?.definitions?.subgraphs?.length) {
        throw new Error('recipe_append_subgraphs_unsupported');
    }
    if (savedGroups.length && typeof globalThis.LiteGraph?.LGraphGroup !== 'function') {
        throw new Error('recipe_append_groups_unsupported');
    }

    const idMap = new Map();
    const inserted = [];
    const existingIds = new Set((graph._nodes || []).map((node) => String(node?.id)));
    let id = nextNodeId(graph, savedNodes.map((node) => node.id));
    const sourceBounds = savedBounds(savedNodes);
    const targetBounds = liveBounds(graph);
    const offsetX = targetBounds ? targetBounds.maxX + 140 - sourceBounds.minX : 40 - sourceBounds.minX;
    const offsetY = targetBounds ? targetBounds.minY - sourceBounds.minY : 40 - sourceBounds.minY;
    const insertedGroups = [];

    graph.beforeChange?.();
    try {
        for (const nodeData of savedNodes) {
            const node = instantiateNode(nodeData);
            if (!node) {
                const error = new Error(`Missing node type: ${nodeType(nodeData)}`);
                error.code = 'recipe_append_missing_node';
                throw error;
            }
            while (existingIds.has(String(id))) id += 1;
            const oldId = String(nodeData.id);
            idMap.set(oldId, id);
            node.id = id;
            existingIds.add(String(id));
            const x = Number(nodeData.pos?.[0]) || 0;
            const y = Number(nodeData.pos?.[1]) || 0;
            node.pos = [x + offsetX, y + offsetY];
            graph.add(node);
            inserted.push(node);
            id += 1;
        }

        for (const link of savedLinks) {
            if (!connectLink(link, idMap, graph)) {
                const error = new Error('Invalid link in recipe');
                error.code = 'recipe_append_invalid_link';
                throw error;
            }
        }
        for (const groupData of savedGroups) {
            const group = instantiateGroup(groupData);
            if (!group) {
                const error = new Error('Could not restore a recipe group.');
                error.code = 'recipe_append_groups_unsupported';
                throw error;
            }
            if (Array.isArray(group.bounding) && group.bounding.length >= 4) {
                group.bounding = [
                    Number(group.bounding[0]) + offsetX,
                    Number(group.bounding[1]) + offsetY,
                    group.bounding[2],
                    group.bounding[3],
                ];
            }
            graph.add(group);
            insertedGroups.push(group);
        }
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        app.canvas?.selectNodes?.(inserted);
        app.canvas?.selectItems?.(inserted);
        return { nodes: inserted.length, links: savedLinks.length, groups: insertedGroups.length };
    } catch (error) {
        for (const group of insertedGroups) graph.remove?.(group);
        for (const node of inserted) graph.remove?.(node);
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        throw error;
    } finally {
        graph.afterChange?.();
    }
}
