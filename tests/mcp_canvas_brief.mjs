// node tests/mcp_canvas_brief.mjs — the canvas in brief for an AI: a line per node, what a run still
// needs wired and what on the canvas fits it, ComfyUI's errors.
import assert from 'node:assert/strict';
import { canvasBrief, flowChains, unwired } from '../web/modules/mcp_canvas_brief.js';

/** A node as LiteGraph keeps it, with ComfyUI's data on which inputs a run needs. */
function node(id, type, inputs = [], outputs = [], { required = inputs.map(input => input.name), mode = 0, title } = {}) {
    const made = { id, type, title: title ?? type, mode, inputs, outputs };
    Object.defineProperty(made, 'constructor', { value: { nodeData: { input: { required: Object.fromEntries(required.map(name => [name, ['X']])) } } } });
    return made;
}
const socket = (name, type, link = null, more = {}) => ({ name, type, link, ...more });
const out = (name, type = name) => ({ name, type });

function graph(nodes, links) {
    return { _nodes: nodes, links, getNodeById: id => nodes.find(item => item.id === id) };
}

const nodes = [
    node(1, 'CheckpointLoaderSimple', [], [out('MODEL'), out('CLIP'), out('VAE')]),
    node(2, 'CLIPTextEncode', [socket('clip', 'CLIP', 1), socket('text', 'STRING', null, { widget: { name: 'text' } })], [out('CONDITIONING')], { title: '正面' }),
    node(3, 'KSampler', [socket('model', 'MODEL', 2), socket('positive', 'CONDITIONING', 3), socket('negative', 'CONDITIONING'), socket('latent_image', 'LATENT')], [out('LATENT')]),
    node(4, 'EmptyLatentImage', [], [out('LATENT')]),
    node(5, 'LatentUpscale', [socket('samples', 'LATENT', 4)], [out('LATENT')]), // fed by #3: wiring it back would loop
    node(6, 'KSampler', [socket('model', 'MODEL')], [out('LATENT')], { mode: 4 }), // bypassed: not run as it is
    node(7, 'ImageScale', [socket('image', 'IMAGE', 5), socket('mask', 'MASK')], [out('IMAGE')], { required: ['image'] }), // mask is optional
];
const links = { 1: { origin_id: 1, origin_slot: 1 }, 2: { origin_id: 1, origin_slot: 0 }, 3: { origin_id: 2, origin_slot: 0 }, 4: { origin_id: 3, origin_slot: 0 }, 5: { origin_id: 99, origin_slot: 0 } };
const g = graph(nodes, links);

const brief = canvasBrief(g, { 3: { errors: [{ message: 'Required input is missing', details: 'negative' }] } });
assert.equal(brief.node_count, 7);
assert.equal(brief.lines[1], '#2 CLIPTextEncode "正面" | clip←#1 | gives CONDITIONING', 'a widget input is no socket');
assert.equal(brief.lines[2], '#3 KSampler | model←#1 positive←#2 negative←?CONDITIONING latent_image←?LATENT | gives LATENT');
assert.equal(brief.lines[5], '#6 KSampler [bypassed] | model←?MODEL | gives LATENT');
assert.equal(brief.lines[6], '#7 ImageScale | image←#99 | gives IMAGE', 'an optional input left free is no gap');
assert.deepEqual(brief.unwired, [
    { node: 3, input: 'negative', type: 'CONDITIONING', fits: ['#2 CONDITIONING'] },
    { node: 3, input: 'latent_image', type: 'LATENT', fits: ['#4 LATENT'] }, // not #5 (it is fed by #3), not #6 (bypassed)
], 'a bypassed node asks for nothing');
assert.deepEqual(brief.errors, [{ node: 3, error: 'Required input is missing: negative' }]);
assert.equal(canvasBrief(g).errors, undefined);

const many = graph(Array.from({ length: 35 }, (_, at) => node(at + 1, 'SaveImage', [socket('images', 'IMAGE')], [])), {});
const long = canvasBrief(many);
assert.equal(long.lines.length, 8);
assert.equal(long.more_nodes, 27);
assert.equal(long.unwired.length, 8);
assert.equal(long.more_unwired, 27);
assert.equal(long.unwired[0].fits, undefined, 'nothing on the canvas gives an IMAGE');
assert.deepEqual(unwired(graph([], {})), { unwired: [] });

assert(brief.chains.some(chain => chain.includes('CONDITIONING:positive')));
assert(!brief.chains.some(chain => chain.includes('#6 ')), 'bypassed nodes are not active paths');
const serial = graph([
    node(1, 'EmptyLatentImage'), node(2, 'KSampler', [socket('latent_image', 'LATENT', 1)]),
    node(3, 'VAEDecode', [socket('samples', 'LATENT', 2)]), node(4, 'SaveImage', [socket('images', 'IMAGE', 3)]),
], { 1: { origin_id: 1 }, 2: { origin_id: 2 }, 3: { origin_id: 3 } });
assert.deepEqual(flowChains(serial).chains, [
    '#1 EmptyLatentImage --LATENT:latent_image--> #2 KSampler --LATENT:samples--> #3 VAEDecode --IMAGE:images--> #4 SaveImage',
]);
serial._nodes.push(node(5, 'VAELoader'));
serial._nodes[2].inputs.push(socket('vae', 'VAE', 5));
serial.links[5] = { origin_id: 5 };
assert(flowChains(serial).chains[0].includes('#2 KSampler --LATENT:samples--> #3 VAEDecode --IMAGE:images--> #4 SaveImage'),
    'auxiliary VAE input must not split the picture spine');
serial._nodes[2].inputs.pop();
delete serial.links[5];
serial._nodes[0].inputs = [socket('loop', 'IMAGE', 4)];
serial.links[4] = { origin_id: 4 };
assert.equal(flowChains(serial).chains.length, 1, 'a malformed cyclic graph still terminates');
assert(flowChains(serial).chains[0].length <= 240);
const branches = graph([node(1, 'Source'), ...Array.from({ length: 20 }, (_, i) =>
    node(i + 2, 'Target', [socket(i % 2 ? 'positive' : 'negative', 'CONDITIONING', i + 1)]))],
    Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, { origin_id: 1 }])));
assert.equal(flowChains(branches).chains.length, 6);
assert.equal(flowChains(branches).more_chains, 14);

console.log('mcp_canvas_brief: ok');
