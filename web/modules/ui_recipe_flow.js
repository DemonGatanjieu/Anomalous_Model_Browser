/**
 * A workflow's flow at the top of its details (ui_recipe_set_view.js), with the values shown (the
 * workflow's own or a preset), read by recipe_flow.js. On top the model files and LoRAs the stages
 * are fed, each with its strength and the stages it feeds; then the stages in the order they run,
 * each under the control models patched into it (a Tile LLLite with its strength): what it does
 * (makes the base, goes on, enlarges and redraws), its model, its steps or the part of a split it
 * runs, how much it redraws. A stage these values do not run hangs dashed under a line straight
 * past it. Then the picture nodes after the samplers and the saves. What a preset changes from the
 * workflow's own is marked, what it leaves unused dashed. Every box is a button that opens its
 * node's values under the flow (ui_recipe_flow_inspect.js); the one picked is
 * parameterState.flowPick (a node id), kept while the details are open, across presets too.
 */

import { translate as t } from './locales.js';
import { appendText, displayValue } from './ui_recipe_detail_dom.js';
import { listedSets } from './ui_recipe_sets.js';
import { changedNodes, readFlow, stageMark, touched } from './recipe_flow.js';
import { renderInspector, roleOf } from './ui_recipe_flow_inspect.js';

const LEGEND = [['is-stage', 'workflowFlowLegendStage'], ['is-supply', 'workflowFlowLegendSupply'], ['is-guard', 'workflowFlowLegendGuard'],
    ['is-changed', 'workflowFlowLegendChanged'], ['is-off', 'workflowFlowLegendOff']];
const KIND_CLASS = { model: 'is-supply', lora: 'is-supply', control: 'is-guard', post: 'is-guard' };

function legend(panel) {
    const line = appendText(panel, 'div', '', 'anomalous-wfd-flow-legend');
    for (const [className, key] of LEGEND) {
        const entry = appendText(line, 'span', '');
        appendText(entry, 'i', '', `anomalous-wfd-flow-dot ${className}`);
        entry.append(t(key));
    }
}

/** One box of the flow, a button: `role` above `name` and `facts`. */
function box(parent, { className, role, name, facts, changed, off, picked, onPick }) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `anomalous-wfd-flow-box ${className}${changed ? ' is-changed' : ''}${off ? ' is-off' : ''}${picked ? ' is-picked' : ''}`;
    const head = appendText(item, 'span', role, 'anomalous-wfd-flow-role');
    if (changed) appendText(head, 'span', t('workflowFlowChanged'), 'anomalous-wfd-flow-badge');
    appendText(item, 'span', name, 'anomalous-wfd-flow-model').title = name;
    if (facts) appendText(item, 'span', facts, 'anomalous-wfd-flow-facts');
    item.onclick = onPick;
    parent.appendChild(item);
}

function stageFacts(stage) {
    const facts = [];
    if (stage.state === 'off') facts.push(t('workflowFlowOff'));
    else if (stage.state === 'skipped') facts.push(t('workflowFlowSkipped'));
    else if (stage.window) facts.push(t('workflowFlowWindow', { from: stage.window[0], to: stage.window[1] }));
    else if (stage.steps) facts.push(t('workflowFlowSteps', { steps: stage.steps }));
    if (typeof stage.upscale === 'number') facts.push(`×${stage.upscale}`);
    if (stage.denoise < 1) facts.push(t('workflowFlowDenoise', { value: Math.round(stage.denoise * 100) }));
    return facts.join(' · ');
}

/** A part's values worth a glance, and the stages it feeds that run (a control model sits on its stage, so only when it has more). */
function partFacts(part, shown, running) {
    const facts = [];
    if (part.kind === 'post') {
        const node = (shown.nodes || []).find(item => String(item.id) === part.ids[0]);
        const values = (Array.isArray(node?.widgets_values) ? node.widgets_values : []).filter(value => ['string', 'number'].includes(typeof value));
        facts.push(...values.slice(0, 2).map(displayValue));
    }
    if (typeof part.strength === 'number') facts.push(t('workflowFlowStrength', { value: part.strength }));
    const feeds = part.stages.filter(n => running.has(n));
    if (part.kind === 'post' || (part.kind === 'control' && part.on && feeds.length < 2)) return facts.join(' · ');
    facts.push(part.on ? t('workflowFlowFeeds', { stages: feeds.map(stageMark).join('') }) : t('workflowFlowUnused'));
    return facts.join(' · ');
}

/** The flow of `ctx.recipe` with preset `notebook` (null: its own values) shown; null when it has no sampler. */
export function renderFlow(ctx, notebook) {
    const { recipe, parameterState } = ctx;
    const shown = notebook?.data?.workflow || recipe.workflow;
    const flow = readFlow(shown);
    if (!flow.stages.length) return null;
    const own = notebook ? readFlow(recipe.workflow) : flow;
    const changed = notebook ? changedNodes(recipe.workflow, shown) : new Set();
    const lit = new Set(touched(flow.stages, changed, own.stages));
    const running = new Set(flow.stages.filter(stage => stage.state === 'run').map(stage => stage.n));
    const panel = document.createElement('section');
    panel.className = 'anomalous-wfd-flow';
    const pick = (id) => {
        parameterState.flowPick = parameterState.flowPick === id ? null : id;
        panel.replaceWith(renderFlow(ctx, notebook));
    };
    const partBox = (parent, part) => box(parent, {
        className: KIND_CLASS[part.kind], role: roleOf(part), name: part.name, facts: partFacts(part, shown, running),
        changed: part.ids.some(id => changed.has(id)), off: !part.on, picked: part.ids.includes(parameterState.flowPick), onPick: () => pick(part.ids[0]),
    });
    legend(panel);
    const supply = appendText(panel, 'div', '', 'anomalous-wfd-flow-supply');
    flow.parts.filter(part => part.kind === 'model' || part.kind === 'lora').forEach(part => partBox(supply, part));
    const row = appendText(panel, 'div', '', 'anomalous-wfd-flow-row');
    flow.stages.forEach((stage, at) => {
        if (at) appendText(row, 'span', '→', 'anomalous-wfd-flow-arrow');
        const runs = stage.state === 'run';
        const column = appendText(row, 'div', '', `anomalous-wfd-flow-col${runs ? '' : ' is-branch'}`);
        if (!runs) appendText(column, 'span', `${t('workflowFlowThrough')} ⟶`, 'anomalous-wfd-flow-through');
        flow.parts.filter(part => part.kind === 'control' && part.stages[0] === stage.n).forEach(part => partBox(column, part));
        box(column, {
            className: 'is-stage', role: roleOf(stage), name: stage.model || t('workflowFlowNoModel'), facts: stageFacts(stage),
            changed: lit.has(stage.n), off: !runs, picked: parameterState.flowPick === stage.sampler, onPick: () => pick(stage.sampler),
        });
    });
    const after = flow.parts.filter(part => part.kind === 'post');
    appendText(row, 'span', '→', 'anomalous-wfd-flow-arrow');
    const end = appendText(row, 'div', '', 'anomalous-wfd-flow-col is-end');
    after.forEach(part => partBox(end, part));
    const save = appendText(end, 'div', '', 'anomalous-wfd-flow-save');
    appendText(save, 'span', t('workflowFlowSave'), 'anomalous-wfd-flow-role');
    appendText(save, 'span', t('workflowFlowSaves', { count: flow.saves }), 'anomalous-wfd-flow-facts');
    renderInspector(panel, ctx, {
        flow, shown, changed, current: notebook?.filename ?? null, pick,
        presets: () => [{ label: t('workflowOwnValues'), filename: null, flow: own },
            ...listedSets(recipe, parameterState.notebooks).map(set => ({ label: set.name || t('recipeParameterUntitled'), filename: set.filename, flow: readFlow(set.data?.workflow) }))],
    });
    return panel;
}
