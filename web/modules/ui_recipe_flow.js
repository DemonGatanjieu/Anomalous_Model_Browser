/**
 * A workflow's flow at the top of its details (ui_recipe_set_view.js): its stages in a row, one per
 * sampler in the order they run (as the AI's run view tells a run, ui_ai_run_story.js): what the
 * stage does (makes the base, goes on from the stage before, enlarges and redraws), the main model
 * its sampler is fed (through LoRAs and patches such as a Tile LLLite or a ControlNet), its steps
 * or the steps it runs of a split, its redraw strength; then where the pictures are saved. Under it
 * the presets: the workflow's own values and each saved set unlike them (listedSets), with the
 * stages a set changes; the one shown is lit and its stages show its values, those it changes
 * marked. A click on another one shows it (ctx.select). The stages are read by recipe_flow.js.
 */

import { translate as t } from './locales.js';
import { appendText } from './ui_recipe_detail_dom.js';
import { listedSets } from './ui_recipe_sets.js';
import { changedNodes, flowStages, touched } from './recipe_flow.js';

const SAVE = /^(SaveImage|PreviewImage)|save/i;
const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

function stageBox(stage, lit) {
    const box = document.createElement('div');
    box.className = `anomalous-wfd-flow-stage${lit ? ' is-changed' : ''}${stage.skipped ? ' is-skipped' : ''}`;
    const head = appendText(box, 'div', `${NUMBERS[stage.n - 1] || stage.n} ${t(`workflowFlow_${stage.kind}`)}`, 'anomalous-wfd-flow-name');
    if (stage.model.control) appendText(head, 'span', stage.model.control === 'Tile' ? '+ Tile' : t('workflowFlowControl'), 'anomalous-wfd-flow-tag');
    appendText(box, 'div', stage.model.name || t('workflowFlowNoModel'), 'anomalous-wfd-flow-model').title = stage.model.name;
    const facts = [];
    if (stage.skipped) facts.push(t('workflowFlowSkipped'));
    else if (stage.window) facts.push(t('workflowFlowWindow', { from: stage.window[0], to: stage.window[1] }));
    else if (stage.steps) facts.push(t('workflowFlowSteps', { steps: stage.steps }));
    if (typeof stage.upscale === 'number') facts.push(`×${stage.upscale}`);
    if (stage.denoise < 1) facts.push(t('workflowFlowDenoise', { value: Math.round(stage.denoise * 100) }));
    if (stage.model.loras) facts.push(`LoRA ${stage.model.loras}`);
    appendText(box, 'div', facts.join(' · '), 'anomalous-wfd-flow-facts');
    return box;
}

/** The flow of `ctx.recipe` with preset `notebook` (null: its own values) shown; null when it has no sampler. */
export function renderFlow(ctx, notebook) {
    const { recipe, parameterState } = ctx;
    const shown = notebook?.data?.workflow || recipe.workflow;
    const stages = flowStages(shown);
    if (!stages.length) return null;
    const changedHere = notebook ? changedNodes(recipe.workflow, shown) : new Set();
    const lit = new Set(touched(stages, changedHere));
    const panel = document.createElement('section');
    panel.className = 'anomalous-wfd-flow';
    const row = document.createElement('div');
    row.className = 'anomalous-wfd-flow-row';
    for (const stage of stages) {
        row.appendChild(stageBox(stage, lit.has(stage.n)));
        appendText(row, 'span', '→', 'anomalous-wfd-flow-arrow');
    }
    const saves = (shown.nodes || []).filter(node => SAVE.test(node.type) && node.mode !== 2 && node.mode !== 4).length;
    const save = document.createElement('div');
    save.className = 'anomalous-wfd-flow-stage is-save';
    appendText(save, 'div', t('workflowFlowSave'), 'anomalous-wfd-flow-name');
    appendText(save, 'div', t('workflowFlowSaves', { count: saves }), 'anomalous-wfd-flow-facts');
    row.appendChild(save);
    const presets = document.createElement('div');
    presets.className = 'anomalous-wfd-flow-presets';
    const chip = (label, note, active, pick) => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = `anomalous-wfd-flow-preset${active ? ' is-active' : ''}`;
        appendText(node, 'span', label, 'anomalous-wfd-flow-preset-name');
        appendText(node, 'span', note, 'anomalous-wfd-flow-preset-note');
        node.onclick = () => {
            parameterState.editor = null;
            pick();
        };
        presets.appendChild(node);
    };
    chip(t('workflowOwnValues'), t('workflowFlowOwn'), !notebook, () => ctx.select('set', null));
    for (const set of listedSets(recipe, parameterState.notebooks)) {
        const changes = touched(stages, changedNodes(recipe.workflow, set.data?.workflow));
        chip(set.name || t('recipeParameterUntitled'), changes.length
            ? t('workflowFlowChanges', { stages: changes.map(n => NUMBERS[n - 1] || n).join('') }) : t('workflowFlowSameStages'),
        notebook?.filename === set.filename, () => ctx.select('set', set.filename));
    }
    panel.append(row, presets);
    if (lit.size) appendText(panel, 'p', t('workflowFlowLitHint'), 'anomalous-wfd-flow-hint');
    return panel;
}
