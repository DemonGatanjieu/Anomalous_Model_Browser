/**
 * A workflow's flow on top of its details (ui_recipe_detail.js), small and only its structure, read
 * by recipe_flow.js with the values shown (the workflow's own or a preset): the stages in the order
 * they run (makes the base, goes on, enlarges and redraws), then the picture nodes after them and
 * the saves; over the stages one lane each for the model files, the LoRAs and the control models,
 * each a bar over the stages it feeds. A stage these values do not run is dashed and says so, a part
 * they leave unused is dashed; what a preset sets unlike the workflow's own is orange. A box's values
 * (steps, strength, the stages it feeds) are its tooltip; a click opens all its node's values under
 * the flow (ui_recipe_flow_inspect.js). The one picked is parameterState.flowPick (a node id), kept
 * while the details are open, across presets too.
 */

import { translate as t } from './locales.js';
import { appendText, displayValue } from './ui_recipe_detail_dom.js';
import { listedSets } from './ui_recipe_sets.js';
import { changedNodes, flowLanes, readFlow, stageMark, touched } from './recipe_flow.js';
import { renderInspector, roleOf } from './ui_recipe_flow_inspect.js';

const KIND_CLASS = { model: 'is-supply', lora: 'is-supply', control: 'is-guard', post: 'is-guard' };

/** Puts grid cell `item` on row `row` over columns `from` to `to`. */
function place(item, row, from, to = from) {
    item.style.gridRow = String(row);
    item.style.gridColumn = `${from} / ${to + 1}`;
    return item;
}

/** One box of the flow, a button: its `name`, a short `tag` after it; `tip` is its tooltip. */
function box(parent, { className, name, tag, tip, changed, off, picked, onPick }) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `anomalous-wfd-flow-box ${className}${changed ? ' is-changed' : ''}${off ? ' is-off' : ''}${picked ? ' is-picked' : ''}`;
    appendText(item, 'span', name, 'anomalous-wfd-flow-name');
    if (tag) appendText(item, 'span', tag, 'anomalous-wfd-flow-tag');
    item.title = `${tip}\n${t('workflowFlowBoxHint')}`;
    item.onclick = onPick;
    parent.appendChild(item);
    return item;
}

function stageFacts(stage) {
    const facts = [stage.model || t('workflowFlowNoModel')];
    if (stage.state === 'off') facts.push(t('workflowFlowOff'));
    else if (stage.state === 'skipped') facts.push(t('workflowFlowSkipped'));
    else if (stage.window) facts.push(t('workflowFlowWindow', { from: stage.window[0], to: stage.window[1] }));
    else if (stage.steps) facts.push(t('workflowFlowSteps', { steps: stage.steps }));
    if (typeof stage.upscale === 'number') facts.push(`×${stage.upscale}`);
    if (stage.denoise < 1) facts.push(t('workflowFlowDenoise', { value: Math.round(stage.denoise * 100) }));
    return facts.join(' · ');
}

/** A part's values worth a glance and the stages it feeds that run, for its tooltip. */
function partFacts(part, shown, running) {
    const facts = [];
    if (part.kind === 'post') {
        const node = (shown.nodes || []).find(item => String(item.id) === part.ids[0]);
        const values = (Array.isArray(node?.widgets_values) ? node.widgets_values : []).filter(value => ['string', 'number'].includes(typeof value));
        facts.push(...values.slice(0, 2).map(displayValue));
    }
    if (typeof part.strength === 'number') facts.push(t('workflowFlowStrength', { value: part.strength }));
    if (part.kind === 'post') return facts.join(' · ');
    const feeds = part.stages.filter(n => running.has(n));
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
    const partBox = part => box(grid, {
        className: KIND_CLASS[part.kind], name: part.name, tip: `${roleOf(part)} · ${part.file || part.name}\n${partFacts(part, shown, running)}`,
        changed: part.ids.some(id => changed.has(id)), off: !part.on, picked: part.ids.includes(parameterState.flowPick), onPick: () => pick(part.ids[0]),
    });
    const after = flow.parts.filter(part => part.kind === 'post');
    const grid = appendText(panel, 'div', '', 'anomalous-wfd-flow-grid');
    grid.style.gridTemplateColumns = `max-content repeat(${flow.stages.length}, minmax(116px, 1fr)) repeat(${after.length + 1}, minmax(84px, 0.6fr))`;
    let row = 1;
    for (const lane of flowLanes(flow)) {
        lane.rows.forEach((bars, at) => {
            if (!at) place(appendText(grid, 'span', t(`workflowFlowRole_${lane.kind}`), 'anomalous-wfd-flow-lane'), row, 1);
            for (const { part, from, to } of bars) place(partBox(part), row, from + 1, to + 1);
            row += 1;
        });
    }
    place(appendText(grid, 'span', t('workflowFlowLaneStages'), 'anomalous-wfd-flow-lane'), row, 1);
    for (const stage of flow.stages) {
        const runs = stage.state === 'run';
        place(box(grid, {
            className: `is-stage${stage.n > 1 ? ' is-step' : ''}`, name: roleOf(stage), tag: runs ? '' : t('workflowFlowNotRun'), tip: stageFacts(stage),
            changed: lit.has(stage.n), off: !runs, picked: parameterState.flowPick === stage.sampler, onPick: () => pick(stage.sampler),
        }), row, stage.n + 1);
    }
    after.forEach((part, at) => place(partBox(part), row, flow.stages.length + 2 + at).classList.add('is-step'));
    const save = appendText(grid, 'div', '', 'anomalous-wfd-flow-save is-step');
    appendText(save, 'span', t('workflowFlowSave'), 'anomalous-wfd-flow-name');
    if (flow.saves > 1) appendText(save, 'span', `×${flow.saves}`, 'anomalous-wfd-flow-tag');
    save.title = t('workflowFlowSaves', { count: flow.saves });
    place(save, row, flow.stages.length + after.length + 2);
    renderInspector(panel, ctx, {
        flow, shown, changed, current: notebook?.filename ?? null, pick,
        presets: () => [{ label: t('workflowOwnValues'), filename: null, flow: own },
            ...listedSets(recipe, parameterState.notebooks).map(set => ({ label: set.name || t('recipeParameterUntitled'), filename: set.filename, flow: readFlow(set.data?.workflow) }))],
    });
    return panel;
}
