import assert from 'node:assert/strict';
import {
    applyRecipeWidgetChanges,
    captureRecipeDraft,
    analyseRecipeScope,
    extractRecipeMetadata,
    extractRecipeParameterChoicesFromMetadata,
} from '../web/modules/recipe_parser.js';

const longNegative = 'negative prompt '.repeat(40).trim();
const workflow = {
    nodes: [
        { id: 1, type: 'CLIPTextEncode', title: 'positive', widgets_values: ['a full positive prompt'] },
        { id: 2, type: 'CLIPTextEncode', title: 'negative', widgets_values: [longNegative] },
        { id: 3, type: 'KSampler', title: 'Sampler', widgets_values: [42, 'fixed', 24, 6.5, 'euler', 'normal', 1] },
    ],
    links: [
        [10, 1, 0, 3, 1, 'CONDITIONING'],
        [11, 2, 0, 3, 2, 'CONDITIONING'],
    ],
};

const graph = {
    _nodes: [
        {
            id: 1,
            type: 'CLIPTextEncode',
            title: 'positive',
            widgets: [{ name: 'text', value: 'a full positive prompt', type: 'text' }],
            inputs: [],
        },
        {
            id: 2,
            type: 'CLIPTextEncode',
            title: 'negative',
            widgets: [{ name: 'text', value: longNegative, type: 'text' }],
            inputs: [],
        },
        {
            id: 3,
            type: 'KSampler',
            title: 'Sampler',
            widgets: [
                { name: 'seed', value: 42 }, { name: 'control_after_generate', value: 'fixed' },
                { name: 'steps', value: 24 }, { name: 'cfg', value: 6.5 },
                { name: 'sampler_name', value: 'euler' }, { name: 'scheduler', value: 'normal' },
                { name: 'denoise', value: 1 },
            ],
            inputs: [
                { name: 'positive', link: 10 },
                { name: 'negative', link: 11 },
            ],
        },
    ],
    links: new Map(workflow.links.map((link) => [link[0], link])),
    serializeCalls: 0,
    serialize() {
        this.serializeCalls += 1;
        return JSON.parse(JSON.stringify(workflow));
    },
};

const draft = captureRecipeDraft(graph);
assert.equal(graph.serializeCalls, 1, 'recipe capture serializes exactly once');
assert.deepEqual(draft.workflow, workflow, 'draft keeps the authoritative serialized workflow');
assert.equal(draft.stats.nodeCount, 3);
assert.equal(draft.stats.linkCount, 2);

const completeScope = analyseRecipeScope({
    _nodes: [{
        constructor: { nodeData: { output_node: true, input: { required: { images: ['IMAGE', {}] }, optional: {} } } },
        inputs: [{ name: 'images', link: 1 }],
        widgets: [],
    }],
});
assert.equal(completeScope.scope, 'complete', 'a runnable graph with an output node is a complete recipe');

const partialScope = analyseRecipeScope({
    _nodes: [{
        constructor: { nodeData: { output_node: false, input: { required: { model: ['MODEL', {}] }, optional: {} } } },
        inputs: [{ name: 'model', link: null }],
        widgets: [],
    }],
});
assert.equal(partialScope.scope, 'partial', 'an open required connection makes a partial recipe');
assert.equal(partialScope.boundaryInputCount, 1);

const nestedOutput = {
    constructor: { nodeData: { output_node: true, input: { required: {}, optional: {} } } },
    inputs: [],
    widgets: [],
};
const subgraphScope = analyseRecipeScope({
    _nodes: [{
        constructor: { nodeData: { output_node: false, input: { required: {}, optional: {} } } },
        inputs: [],
        widgets: [],
        getInnerNodes: () => [nestedOutput],
    }],
});
assert.equal(subgraphScope.scope, 'complete', 'output nodes inside a subgraph close the complete workflow');

const metadata = extractRecipeMetadata(graph);
assert.equal(metadata.nodes.find((node) => node.id === 1).role, 'positive', 'positive prompt follows the linked conditioning input');
assert.equal(metadata.nodes.find((node) => node.id === 2).role, 'negative', 'negative prompt follows the linked input');
const negativeSummary = metadata.nodes.find((node) => node.id === 2).widgets[0].value;
assert.equal(negativeSummary.length, 320, 'generic metadata remains a bounded browsing summary');

const editable = extractRecipeParameterChoicesFromMetadata(metadata, workflow);
const negativeChoice = editable.find((choice) => choice.nodeId === 2 && choice.widgetName === 'text');
assert.equal(negativeChoice.value, longNegative, 'editing choices resolve the full workflow value');

applyRecipeWidgetChanges(metadata, workflow, [{
    ...negativeChoice,
    previousValue: longNegative,
    value: 'replacement negative prompt',
}]);
assert.equal(workflow.nodes[1].widgets_values[0], 'replacement negative prompt');
assert.deepEqual(metadata.promptNegative, ['replacement negative prompt']);
assert.equal(workflow.nodes[0].widgets_values[0], 'a full positive prompt', 'only the selected widget changes');

const conservativeGraph = {
    _nodes: [
        {
            id: 20,
            type: 'CLIPTextEncode',
            title: 'negative-looking but disconnected',
            widgets: [{ name: 'text', value: 'do not guess me', type: 'text' }],
            inputs: [],
        },
        {
            id: 21,
            type: 'ThirdPartyCLIPTextEncode',
            title: 'negative',
            widgets: [{ name: 'text', value: 'third party prompt', type: 'text' }],
            inputs: [],
        },
    ],
    links: new Map(),
};
const conservativeMetadata = extractRecipeMetadata(conservativeGraph);
assert.equal(conservativeMetadata.nodes.find((node) => node.id === 20).role, 'unknown', 'disconnected official text is not guessed from its title');
assert.equal(conservativeMetadata.nodes.find((node) => node.id === 21).role, undefined, 'third-party text nodes are not automatically classified');
assert.deepEqual(conservativeMetadata.promptPositive, [], 'unresolved text is not inserted into positive prompts');
assert.deepEqual(conservativeMetadata.promptNegative, [], 'unresolved text is not inserted into negative prompts');

const sharedText = {
    id: 30,
    type: 'CLIPTextEncode',
    widgets: [{ name: 'text', value: 'shared conditioning', type: 'text' }],
    inputs: [],
};
const sharedSampler = {
    id: 31,
    type: 'KSampler',
    widgets: [],
    inputs: [{ name: 'positive', link: 30 }, { name: 'negative', link: 31 }],
};
const sharedGraph = {
    _nodes: [sharedText, sharedSampler],
    links: new Map([
        [30, [30, 30, 0, 31, 1, 'CONDITIONING']],
        [31, [31, 30, 0, 31, 2, 'CONDITIONING']],
    ]),
};
const sharedMetadata = extractRecipeMetadata(sharedGraph);
assert.equal(sharedMetadata.nodes.find((node) => node.id === 30).role, 'both', 'one official text node may supply both roles');

console.log('recipe_parser_roundtrip: ok');
