import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imagePrompts } from '../web/modules/image_keep.js';
import { applyPromptRolesToBlocks, detailedBlocksFromWorkflow, extractWorkflowDetails } from '../web/modules/material_inspector.js';
import { resolveGraphPromptText, resolveWorkflowPromptText } from '../web/modules/prompt_link_resolve.js';
import { extractRecipeMetadata } from '../web/modules/recipe_parser.js';

function linkedWorkflow(sourceType = 'PrimitiveString', reroutes = []) {
    const source = { id: 1, type: sourceType, widgets_values: ['  linked text\n'], outputs: [{ type: 'STRING' }] };
    const nodes = [source];
    const links = [];
    let previousId = 1;
    for (const type of reroutes) {
        const id = previousId + 1;
        nodes.push({ id, type, inputs: [{ link: previousId }] });
        links.push([previousId, previousId, 0, id, 0, 'STRING']);
        previousId = id;
    }
    const clip = {
        id: 100, type: 'CLIPTextEncode', title: 'Positive', widgets_values: ['stale'],
        inputs: [{ name: 'TeXt', type: 'STRING', link: previousId }],
    };
    nodes.push(clip);
    links.push([previousId, previousId, 0, clip.id, 0, 'STRING']);
    return { workflow: { nodes, links }, clip, source };
}

function graphFromWorkflow(workflow) {
    const _nodes = workflow.nodes.map(node => ({
        ...node,
        widgets: (Array.isArray(node.widgets_values) ? node.widgets_values : []).map(value => ({ name: 'text', value })),
    }));
    const links = new Map(workflow.links.map(link => [Array.isArray(link) ? link[0] : link.id, link]));
    return { _nodes, links };
}

function checkBoth(workflow, clip, expected) {
    const original = structuredClone(workflow);
    assert.equal(resolveWorkflowPromptText(workflow, clip), expected);
    const graph = graphFromWorkflow(workflow);
    const live = graph._nodes.find(node => node.id === clip.id);
    assert.equal(resolveGraphPromptText(graph, live), expected);
    assert.deepEqual(workflow, original);
}

for (const type of ['PrimitiveString', 'PrimitiveStringMultiline', 'Text Multiline']) {
    for (const reroutes of [[], ['Reroute'], ['Reroute (rgthree)', 'ReroutePrimitive']]) {
        const { workflow, clip } = linkedWorkflow(type, reroutes);
        checkBoth(workflow, clip, 'linked text');
    }
}

{
    const { workflow, clip, source } = linkedWorkflow();
    clip.inputs = [{ name: 'clip', type: 'CLIP' }, { name: 'value', type: 'STRING', link: 0 }];
    source.outputs = [{ type: 'IMAGE' }, { type: '*' }];
    const link = { id: 0, origin_id: 1, origin_slot: 1, target_id: 100, target_slot: 1 };
    workflow.links = [link];
    checkBoth(workflow, clip, 'linked text');
    assert.equal(resolveWorkflowPromptText({ ...workflow, links: { 0: link } }, clip), 'linked text');
}

for (const type of ['WildcardText', 'DynamicPrompt', 'StringConcat', 'RandomText', 'LLMText', 'LoadTextFile', 'TextSwitch']) {
    const { workflow, clip } = linkedWorkflow(type);
    checkBoth(workflow, clip, '');
}

for (const change of [
    { widgets_values: ['first', 'second'] }, { widgets_values: ['first', 1] }, { widgets_values: [' '] },
    { widgets_values: { value: 'not an array' } }, { mode: 2 }, { mode: 4 },
    { inputs: [{ link: 0 }] }, { outputs: [{ type: 'IMAGE' }] },
]) {
    const { workflow, clip, source } = linkedWorkflow();
    Object.assign(source, change);
    checkBoth(workflow, clip, '');
}

for (const change of [{ inputs: [{ link: 2 }] }, { inputs: [{ link: 1 }, { link: 2 }] }, { mode: 2 }, { mode: 4 }]) {
    const { workflow, clip } = linkedWorkflow('Text Multiline', ['Reroute']);
    Object.assign(workflow.nodes[1], change);
    checkBoth(workflow, clip, '');
}

for (const [length, expected] of [[7, 'linked text'], [8, '']]) {
    const { workflow, clip } = linkedWorkflow('Text Multiline', Array(length).fill('Reroute'));
    checkBoth(workflow, clip, expected);
}

{
    const { workflow, clip } = linkedWorkflow('PrimitiveNode');
    workflow.links = [];
    const server = { 100: '  PNG prompt\n' };
    checkBoth(workflow, clip, '');
    assert.equal(resolveWorkflowPromptText(workflow, clip, null, server), 'PNG prompt');
    const graph = graphFromWorkflow(workflow);
    assert.equal(resolveGraphPromptText(graph, graph._nodes[1], null, server), 'PNG prompt');
    clip.inputs[0].link = null;
    checkBoth(workflow, clip, 'stale');
    assert.equal(resolveWorkflowPromptText(workflow, clip, null, server), 'stale');
    clip.widgets_values = [];
    assert.equal(resolveWorkflowPromptText(workflow, clip, null, server), 'PNG prompt');
}

{
    const { workflow } = linkedWorkflow();
    const graph = graphFromWorkflow(workflow);
    const [source, clip] = graph._nodes;
    source.widgets.push({ type: 'button', value: 'edit' }, { name: 'control_after_generate', value: 'fixed' });
    assert.equal(resolveGraphPromptText(graph, clip), 'linked text');
    source.widgets.push({ name: 'separator', value: ',' });
    assert.equal(resolveGraphPromptText(graph, clip), '');
}

{
    const { workflow, clip } = linkedWorkflow();
    const neg = { ...clip, id: 101, widgets_values: [], inputs: [{ name: 'text', link: 2 }] };
    const unknown = { ...clip, id: 102, title: 'Negative', inputs: [{ name: 'text', link: 3 }] };
    const sampler = { id: 200, type: 'KSampler', inputs: [{ name: 'positive', link: 4 }, { name: 'negative', link: 5 }] };
    workflow.nodes.push(
        neg, unknown, sampler,
        { id: 4, type: 'Text Multiline', widgets_values: ['avoid noise'] },
        { id: 5, type: 'Text Multiline', widgets_values: ['unknown text'] }
    );
    workflow.links.push(
        [2, 4, 0, 101, 0, 'STRING'], [3, 5, 0, 102, 0, 'STRING'],
        [4, 100, 0, 200, 0, 'CONDITIONING'], [5, 101, 0, 200, 1, 'CONDITIONING']
    );
    const metadata = extractRecipeMetadata(graphFromWorkflow(workflow));
    assert.deepEqual(metadata.promptPositive, ['linked text']);
    assert.deepEqual(metadata.promptNegative, ['avoid noise']);
    assert.equal(metadata.nodes.find(node => node.id === 102).role, 'unknown');

    const details = extractWorkflowDetails(workflow);
    assert.deepEqual(details.allPrompts, ['linked text', 'avoid noise', 'unknown text']);
    assert.deepEqual(details.positivePrompts, []);
    assert.deepEqual(details.negativePrompts, []);
    const blocks = applyPromptRolesToBlocks(detailedBlocksFromWorkflow(workflow, [], { 100: 'embedded PNG text' }), {
        102: { role: 'negative', source: 'title' },
    });
    const block = blocks.find(block => block.node_id === 100);
    assert.equal(block.resolvedPromptText, 'embedded PNG text');
    assert.deepEqual(block.widgets_values, ['stale']);
    assert.equal(blocks.find(block => block.node_id === 102).promptRole, 'unknown');

    // The gallery's star reads a detached copy. Its prompt uses the PNG result even if a
    // third-party source node is absent from the running frontend.
    workflow.links = workflow.links.filter(link => link[0] !== 1);
    const original = structuredClone(workflow);
    globalThis.LiteGraph = { LGraph: class {
        configure(copy) { Object.assign(this, graphFromWorkflow(copy)); }
        clear() { this._nodes.length = 0; }
    } };
    globalThis.fetch = async () => new Response(JSON.stringify({
        status: 'success', workflow, resolved_prompt_texts: { 100: 'embedded PNG text' },
    }));
    assert.deepEqual(await imagePrompts({ filename: 'fixture.png' }), {
        positive: 'embedded PNG text', negative: 'avoid noise',
    });
    assert.deepEqual(workflow, original);
}

const readModule = name => readFileSync(new URL('../web/modules/' + name, import.meta.url), 'utf8');
const button = readModule('browser_entry.js').match(/actionBarButtons:\s*\[\{([\s\S]*?)\}\]/)?.[1];
assert.ok(button, 'AMB action-bar registration exists');
assert.match(button, /icon: 'pi pi-box'/);
assert.match(button, /tooltip: t\('mainOpenTitle'\)/);
assert.match(button, /onClick: open/);
assert.doesNotMatch(button, /\blabel:/);
assert.doesNotMatch(readModule('locales.js'), /mainTopbarTriggerLabel/);
console.log('prompt links: static sources, PNG text, rejections, topology, gallery Keep and action-bar registration passed');
