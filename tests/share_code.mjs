// Workflow share codes (web/modules/share_code.js): the two spellings, the lean form and its
// self-check, the fall back to the whole workflow, and the old AMB0/AMB1 codes.
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
    decodeShareCode, encodeShareCode, fromHanzi, fromLetters, leanWorkflow, rebuildWorkflow, sameWorkflow, toHanzi, toLetters,
} from '../web/modules/share_code.js';

// Bytes survive both spellings at every length.
for (let length = 0; length < 64; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 97 + length * 31) % 256);
    assert.deepEqual(fromHanzi(toHanzi(bytes)), bytes, `hanzi ${length}`);
    assert.deepEqual(fromLetters(toLetters(bytes)), bytes, `letters ${length}`);
}
assert.throws(() => fromHanzi('abc'));

// Fresh nodes of each type, as the canvas would make them.
const port = (name, type, extra = {}) => ({ name, type, ...extra });
const TEMPLATES = {
    CheckpointLoaderSimple: { inputs: [], outputs: [port('MODEL', 'MODEL', { links: null }), port('CLIP', 'CLIP', { links: null }), port('VAE', 'VAE', { links: null })], size: [315, 98] },
    CLIPTextEncode: { inputs: [port('clip', 'CLIP', { link: null }), port('text', 'STRING', { widget: { name: 'text' }, link: null })], outputs: [port('CONDITIONING', 'CONDITIONING', { links: null })], size: [400, 200] },
    KSampler: {
        inputs: [port('model', 'MODEL', { link: null }), port('positive', 'CONDITIONING', { link: null }), port('negative', 'CONDITIONING', { link: null })],
        outputs: [port('LATENT', 'LATENT', { links: null })], size: [315, 262],
    },
    'Lora Loader Stack (rgthree)': { inputs: [port('model', 'MODEL', { link: null }), port('clip', 'CLIP', { link: null })], outputs: [port('MODEL', 'MODEL', { links: null }), port('CLIP', 'CLIP', { links: null })], size: [340, 200] },
};
const CORE = new Set(['CheckpointLoaderSimple', 'CLIPTextEncode', 'KSampler']);
const here = { templateOf: type => TEMPLATES[type] || null, isCore: type => CORE.has(type) };
const nowhere = { templateOf: () => null, isCore: () => false }; // a computer without these node packs

const node = (id, type, widgets, pos, more = {}) => {
    const template = TEMPLATES[type];
    return {
        id, type, pos, size: template.size, flags: {}, order: id, mode: 0,
        inputs: template.inputs.map(input => ({ ...input })), outputs: template.outputs.map(output => ({ ...output, links: [] })),
        properties: { 'Node name for S&R': type }, widgets_values: widgets, ...more,
    };
};
function workflow() {
    const nodes = [
        node(4, 'CheckpointLoaderSimple', ['sd_xl_base_1.0.safetensors'], [26, 474]),
        node(6, 'CLIPTextEncode', ['a photo of a cat, masterpiece, best quality'], [415, 186], { title: 'Positive' }),
        node(7, 'CLIPTextEncode', ['blurry, lowres'], [413, 389]),
        node(3, 'KSampler', [156680208700286, 'randomize', 20, 8, 'euler', 'normal', 1], [863, 186]),
        node(10, 'Lora Loader Stack (rgthree)', ['cute.safetensors', 0.8, 'None', 1, 'None', 1, 'None', 1], [200, 700], { mode: 4 }),
    ];
    const links = [[1, 4, 1, 6, 0, 'CLIP'], [2, 4, 1, 7, 0, 'CLIP'], [3, 6, 0, 3, 1, 'CONDITIONING'], [4, 7, 0, 3, 2, 'CONDITIONING'], [5, 4, 0, 10, 0, 'MODEL'], [6, 10, 0, 3, 0, 'MODEL']];
    const byId = new Map(nodes.map(item => [item.id, item]));
    for (const [id, from, fromSlot, to, toSlot] of links) {
        byId.get(from).outputs[fromSlot].links.push(id);
        byId.get(to).inputs[toSlot].link = id;
    }
    return {
        last_node_id: 10, last_link_id: 6, nodes, links,
        groups: [{ title: 'Prompts', bounding: [400, 150, 450, 450], color: '#3f789e', font_size: 24 }],
        config: {}, version: 0.4,
        extra: { ds: { scale: 1, offset: [0, 0] }, anomalous_hashes: { '4_sd_xl_base_1.0.safetensors': { hash: 'ab'.repeat(32), size: 6938078334 } } },
    };
}

// The lean form rebuilds the same workflow; only differences from a fresh node are kept.
const original = workflow();
const lean = leanWorkflow(original, here);
const rebuilt = rebuildWorkflow(lean, here);
assert.ok(sameWorkflow(original, rebuilt));
assert.equal(lean.n.find(item => item[0] === 3).length, 4); // a plain KSampler: no extras at all
assert.ok(lean.n.find(item => item[0] === 10)[4].i, 'a node pack node keeps its ports');
assert.equal(rebuilt.nodes.find(item => item.id === 6).title, 'Positive');
assert.equal(rebuilt.nodes.find(item => item.id === 10).mode, 4);
assert.deepEqual(rebuilt.groups[0].bounding, [400, 150, 450, 450]);
assert.equal(rebuilt.extra.anomalous_hashes['4_sd_xl_base_1.0.safetensors'].hash, 'ab'.repeat(32));
assert.equal(rebuilt.extra.ds, undefined);

// A workflow as ComfyUI saves it leaves out the values of nodes without any: still the same.
const saved = rebuildWorkflow(lean, here);
for (const item of saved.nodes) if (!item.widgets_values.length) delete item.widgets_values;
assert.ok(sameWorkflow(saved, rebuilt) && sameWorkflow(rebuilt, saved));

// Codes: both spellings open to the same workflow, much shorter than the old full code.
const code = await encodeShareCode(original, here);
assert.equal(code.whole, false);
assert.ok(code.hanzi.startsWith('AMB2-') && code.letters.startsWith('AMB2-'));
const old = 'AMB0-' + Buffer.from(deflateRawSync(JSON.stringify(original))).toString('base64');
assert.ok(code.hanzi.length * 3 < old.length, `${code.hanzi.length} vs ${old.length}`);
assert.ok(code.hanzi.length < code.letters.length);
for (const spelling of [code.hanzi, code.letters]) assert.ok(sameWorkflow(original, await decodeShareCode(spelling, here)));
// A chat that wraps the text or adds spaces does not break it.
const wrapped = code.hanzi.replace(/(.{20})/gu, '$1\n ');
assert.ok(sameWorkflow(original, await decodeShareCode(wrapped, here)));

// On a computer without the node pack, its node still has its ports and links.
const elsewhere = await decodeShareCode(code.hanzi, { templateOf: type => (CORE.has(type) ? TEMPLATES[type] : null) });
const stack = elsewhere.nodes.find(item => item.id === 10);
assert.deepEqual(stack.inputs.map(input => input.link), [5, null]);
assert.deepEqual(stack.outputs[0].links, [6]);
assert.ok(sameWorkflow(original, elsewhere));

// A core node whose ports differ from a fresh one (an extra input) keeps them.
const grown = workflow();
grown.nodes.find(item => item.id === 3).inputs.push({ name: 'latent_image', type: 'LATENT', link: null });
const grownLean = leanWorkflow(grown, here);
assert.ok(grownLean.n.find(item => item[0] === 3)[4].i);
assert.ok(sameWorkflow(grown, rebuildWorkflow(grownLean, here)));

// What the lean form cannot hold goes whole: a subgraph, or nodes it cannot rebuild.
const withSubgraph = { ...workflow(), definitions: { subgraphs: [{ id: 'x' }] } };
const wholeCode = await encodeShareCode(withSubgraph, here);
assert.equal(wholeCode.whole, true);
assert.deepEqual((await decodeShareCode(wholeCode.letters, here)).definitions, withSubgraph.definitions);
const unknownHere = await encodeShareCode(workflow(), nowhere); // every node keeps its ports: still lean
assert.equal(unknownHere.whole, false);

// Old codes still open; AMB1 is laid out by link depth.
assert.ok(sameWorkflow(original, await decodeShareCode(old, here)));
const skeleton = workflow();
skeleton.nodes.forEach((item) => { delete item.pos; });
const amb1 = await decodeShareCode('AMB1-' + Buffer.from(deflateRawSync(JSON.stringify(skeleton))).toString('base64'), here);
assert.deepEqual(amb1.nodes.find(item => item.id === 3).pos, [800, 0]);
await assert.rejects(decodeShareCode('hello', here));
await assert.rejects(decodeShareCode('AMB2-' + '一'.repeat(3) + 'x', here));

console.log(`share_code: ok (hanzi ${code.hanzi.length}, letters ${code.letters.length}, old ${old.length})`);
