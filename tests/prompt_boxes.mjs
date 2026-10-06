import assert from 'node:assert/strict';
import { partnerBox, planPromptFill, promptBoxes, promptNameRole, typeTakesPrompt, wiredRole } from '../web/modules/prompt_boxes.js';

const multiline = ['STRING', { multiline: true }];
globalThis.LiteGraph = { registered_node_types: {
    CLIPTextEncode: { nodeData: { input: { required: { text: multiline, clip: ['CLIP'] } } } },
    ConditioningCombine: { nodeData: { input: { required: { conditioning_1: ['CONDITIONING'], conditioning_2: ['CONDITIONING'] } } } },
    KSampler: { nodeData: { input: { required: { seed: ['INT'] } } } },
    BasicGuider: { nodeData: { input: { required: { conditioning: ['CONDITIONING'] } } } },
    SaveImage: { nodeData: { input: { required: { filename_prefix: ['STRING', {}] } } } },
    'easy a1111Loader': { nodeData: { input: { required: { positive: multiline, negative: multiline } } } },
} };

// A tiny graph: nodes with outputs/inputs and a Map of links, like ComfyUI's.
function makeGraph() {
    const nodes = [];
    const links = new Map();
    let nextLink = 1;
    const graph = {
        _nodes: nodes,
        getLink: id => links.get(id),
        getNodeById: id => nodes.find(node => node.id === id) || null,
    };
    const add = (id, type, inputs = [], widgets = []) => {
        const node = { id, type, graph, inputs: inputs.map(name => ({ name })), outputs: [{ links: [] }], widgets };
        nodes.push(node);
        return node;
    };
    const connect = (from, to, inputName) => {
        const id = nextLink++;
        links.set(id, { target_id: to.id, target_slot: to.inputs.findIndex(input => input.name === inputName) });
        from.outputs[0].links.push(id);
    };
    return { add, connect };
}

const text = value => ({ name: 'text', value });

// Boxes come from the definition: a single-line STRING is not a prompt box.
{
    const { add } = makeGraph();
    assert.equal(promptBoxes(add(1, 'SaveImage', [], [{ name: 'filename_prefix', value: 'ComfyUI' }])).length, 0);
    assert.equal(typeTakesPrompt('SaveImage'), false);
    assert.equal(typeTakesPrompt('CLIPTextEncode'), true);
    assert.equal(promptNameRole('negative_prompt'), 'negative');
    assert.equal(promptNameRole('text_g'), '');
}

// Roles follow the wiring, also through a combine node; titles do not matter.
{
    const { add, connect } = makeGraph();
    const pos = add(1, 'CLIPTextEncode', [], [text('a cat')]);
    const neg = add(2, 'CLIPTextEncode', [], [text('blurry')]);
    neg.title = 'Positive (misnamed)';
    const style = add(3, 'CLIPTextEncode', [], [text('watercolor')]);
    const combine = add(4, 'ConditioningCombine', ['conditioning_1', 'conditioning_2']);
    const sampler = add(5, 'KSampler', ['positive', 'negative']);
    connect(pos, combine, 'conditioning_1');
    connect(style, combine, 'conditioning_2');
    connect(combine, sampler, 'positive');
    connect(neg, sampler, 'negative');
    assert.equal(promptBoxes(pos)[0].role, 'positive');
    assert.equal(promptBoxes(style)[0].role, 'positive');
    assert.equal(promptBoxes(neg)[0].role, 'negative');
    assert.deepEqual([...wiredRole(neg).samplers], [5]);

    // The negative box on the same sampler is the partner of a positive one.
    assert.equal(partnerBox(pos, 'positive').node, neg);
    assert.equal(partnerBox(neg, 'negative'), null); // two positive boxes reach it: no single partner

    const loose = add(6, 'CLIPTextEncode', [], [text('')]);
    assert.equal(promptBoxes(loose)[0].role, '');
    assert.equal(partnerBox(loose, 'positive'), null);
}

// A guider's conditioning input counts as positive.
{
    const { add, connect } = makeGraph();
    const encode = add(1, 'CLIPTextEncode', [], [text('a cat')]);
    connect(encode, add(2, 'BasicGuider', ['conditioning']), 'conditioning');
    assert.equal(promptBoxes(encode)[0].role, 'positive');
}

// Filling: each box takes its own role's text; a chosen box takes its role's text or the main one.
{
    const { add } = makeGraph();
    const loader = add(1, 'easy a1111Loader', [], [{ name: 'positive', value: '' }, { name: 'negative', value: '' }]);
    const both = { positive: 'a cat', negative: 'blurry', singleText: 'a cat', primaryRole: 'both' };
    const negOnly = { positive: '', negative: 'blurry', singleText: 'blurry', primaryRole: 'negative' };
    assert.deepEqual(planPromptFill(loader, both).map(e => [e.index, e.value]), [[0, 'a cat'], [1, 'blurry']]);
    assert.deepEqual(planPromptFill(loader, negOnly).map(e => [e.index, e.value]), [[1, 'blurry']]);
    const [posBox, negBox] = promptBoxes(loader);
    assert.deepEqual(planPromptFill(loader, both, negBox).map(e => [e.index, e.value]), [[1, 'blurry']]);
    // The user chose the positive box for a negative-only prompt: it gets that text.
    assert.deepEqual(planPromptFill(loader, negOnly, posBox).map(e => [e.index, e.value]), [[0, 'blurry']]);
    const loose = add(2, 'CLIPTextEncode', [], [text('')]);
    assert.deepEqual(planPromptFill(loose, both).map(e => e.value), ['a cat']);
}

console.log('prompt boxes: definition, wiring roles, partners and filling OK');
