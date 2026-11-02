/**
 * The box picked in a workflow's flow, under it (ui_recipe_flow.js), nothing while none is: what it
 * is with its full file name, whether it runs with the values shown, × to close, and every value of
 * its node, a value the preset changed struck out as the workflow's own with the preset's after it
 * (both orange). A stage that runs names its
 * other nodes that changed (its model, a LoRA), each a button to that one; a box unused with these
 * values names the presets that use it, each a button to that preset.
 */

import { translate as t } from './locales.js';
import { appendText, button, displayValue } from './ui_recipe_detail_dom.js';
import { nodeValues, sameValue, stageMark, usedIn } from './recipe_flow.js';

const nodeIn = (workflow, id) => (workflow?.nodes || []).find(node => String(node.id) === id) || null;

/** What a box of the flow is: a stage by its number and job, anything else by its role. */
export const roleOf = item => (item.sampler ? `${stageMark(item.n)} ${t(`workflowFlow_${item.kind}`)}` : t(`workflowFlowRole_${item.kind}`));

function stateKey(item, used) {
    if (used) return 'workflowFlowRuns';
    if (item.state === 'off') return 'workflowFlowOff';
    return item.state === 'skipped' ? 'workflowFlowSkipped' : 'workflowFlowUnused';
}

/** A line of buttons after `label`. */
function links(card, label, entries) {
    const line = appendText(card, 'div', '', 'anomalous-wfd-flow-links');
    appendText(line, 'span', label);
    for (const [text, run] of entries) button(line, text, 'anomalous-wfd-flow-link').onclick = run;
}

/**
 * Draws the picked box's card into `panel`. view: flow (shown), shown (its workflow), changed (node
 * ids unlike the workflow's own), current (the preset shown, null for the own values), presets()
 * ([{label, filename, flow}], the own values first), pick(id).
 */
export function renderInspector(panel, ctx, { flow, shown, changed, current, presets, pick }) {
    const id = ctx.parameterState.flowPick;
    const item = id && (flow.stages.find(stage => stage.sampler === id) || flow.parts.find(part => part.ids.includes(id)));
    if (!item) return;
    const card = appendText(panel, 'div', '', 'anomalous-wfd-flow-inspect');
    const node = nodeIn(shown, id);
    const used = usedIn(flow, id);
    const head = appendText(card, 'div', '', 'anomalous-wfd-flow-inspect-head');
    const titles = appendText(head, 'div', '');
    appendText(titles, 'strong', roleOf(item), 'anomalous-wfd-flow-inspect-title');
    appendText(titles, 'div', item.file || node?.title || node?.type || '', 'anomalous-wfd-flow-inspect-file');
    appendText(head, 'span', t(stateKey(item, used)), `anomalous-wfd-flow-state${used ? ' is-on' : ''}`);
    const close = button(head, '×', 'anomalous-wf-icon-btn');
    close.title = t('workflowFlowClose');
    close.onclick = () => pick(id);
    if (item.ids?.length > 1) appendText(card, 'small', t('workflowFlowNodes', { count: item.ids.length, ids: item.ids.map(other => `#${other}`).join(' ') }), 'anomalous-wfd-muted');
    if (!used) {
        const where = presets().filter(preset => preset.filename !== current && usedIn(preset.flow, id));
        links(card, t(where.length ? 'workflowFlowRunsIn' : 'workflowFlowRunsNowhere'), where.map(preset => [preset.label, () => {
            ctx.parameterState.editor = null;
            ctx.select('set', preset.filename);
        }]));
    }
    const others = item.sampler && used ? [...item.nodes].filter(other => other !== id && changed.has(other)) : [];
    if (others.length) {
        links(card, t('workflowFlowChangedHere'), others.map((other) => {
            const part = flow.parts.find(entry => entry.ids.includes(other));
            const otherNode = nodeIn(shown, other);
            return [part ? `${roleOf(part)} ${part.name}` : `${otherNode?.title || otherNode?.type || ''} #${other}`, () => pick(other)];
        }));
    }
    const own = changed.has(id) ? nodeValues(nodeIn(ctx.recipe.workflow, id)) : null;
    if (own) appendText(card, 'small', t('workflowFlowDiffNote'), 'anomalous-wfd-muted');
    const grid = appendText(card, 'div', '', 'anomalous-wfd-flow-values');
    nodeValues(node).forEach(({ name, value }, at) => {
        const was = own && !sameValue(own[at]?.value, value) ? own[at] : null;
        const cell = appendText(grid, 'div', '', `anomalous-wfd-flow-value${was ? ' is-changed' : ''}`);
        appendText(cell, 'span', name);
        const text = appendText(cell, 'strong', '');
        if (was) {
            appendText(text, 'span', displayValue(was.value), 'anomalous-wfd-flow-was');
            text.append(' → ');
        }
        text.append(displayValue(value));
    });
}
