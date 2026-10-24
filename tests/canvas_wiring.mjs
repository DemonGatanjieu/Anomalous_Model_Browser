import assert from 'node:assert/strict';
import { addWires, applyWires, groupWires, pairWires, reachesOutput, validateWires } from '../web/modules/canvas_wiring.js';

class Graph {
    constructor() { this._nodes = []; this.links = {}; this.serial = 0; this.nodeSerial = 0; }
    getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); }
    getLink(id) { return this.links[id]; }
    add(n) { n.id = ++this.nodeSerial; n.graph = this; this._nodes.push(n); }
    remove(n) {
        for (const link of Object.values(this.links)) {
            if (link.origin_id === n.id || link.target_id === n.id) this.getNodeById(link.target_id).disconnectInput(link.target_slot);
        }
        this._nodes = this._nodes.filter(item => item !== n);
    }
}
function node(g, inputs = [], outputs = [], terminal = false) {
    const n = {
        inputs: inputs.map(([name, type]) => ({ name, type, link: null })),
        outputs: outputs.map(([name, type]) => ({ name, type, links: [] })),
        constructor: { nodeData: { output_node: terminal } },
        disconnectInput(slot) {
            const id = this.inputs[slot].link, link = this.graph.links[id];
            if (link) {
                const out = this.graph.getNodeById(link.origin_id).outputs[link.origin_slot];
                out.links = out.links.filter(i => i !== id);
                delete this.graph.links[id];
            }
            this.inputs[slot].link = null;
        },
        connect(slot, to, target) {
            if (this.fail) { this.fail = false; return null; }
            to.disconnectInput(target);
            const id = ++this.graph.serial;
            const link = { id, origin_id: this.id, origin_slot: slot, target_id: to.id, target_slot: target };
            this.graph.links[id] = link;
            this.outputs[slot].links.push(id); to.inputs[target].link = id;
            return link;
        },
    };
    if (g) g.add(n);
    return n;
}
const snapshot = g => Object.values(g.links).map(l => [l.origin_id, l.origin_slot, l.target_id, l.target_slot].join(':')).sort();
const wire = (g, plan, added = null, replace = false) => applyWires(g, validateWires(g, plan, replace), added);

// Insertion keeps the entire selected branch connected and reaches the real output.
{
    const g = new Graph(), decode = node(g, [], [['IMAGE','IMAGE']]);
    const save = node(g, [['images','IMAGE']], [], true);
    decode.connect(0, save, 0);
    const scale = node(null, [['image','IMAGE']], [['IMAGE','IMAGE']]);
    const result = wire(g, addWires(g, scale, { insert_after: decode.id }), scale);
    assert.equal(result.length, 2);
    assert.equal(result[1].replaced_from, decode.id);
    assert.equal(g.getLink(save.inputs[0].link).origin_id, scale.id);
    assert.equal(reachesOutput(g, scale), true);
    save.mode = 2;
    assert.equal(reachesOutput(g, scale), false, 'muted outputs do not count');
}
// Fan-out requires an explicit branch; the other preview is not rewired.
{
    const g = new Graph(), decode = node(g, [], [['IMAGE','IMAGE']]);
    const save = node(g, [['image','IMAGE']], [], true), preview = node(g, [['image','IMAGE']], [], true);
    decode.connect(0, save, 0); decode.connect(0, preview, 0);
    const scale = node(null, [['image','IMAGE']], [['IMAGE','IMAGE']]);
    const before = snapshot(g);
    assert.throws(() => addWires(g, scale, { insert_after: decode.id }), /branches/);
    assert.deepEqual(snapshot(g), before);
    wire(g, addWires(g, scale, { insert_after: decode.id, wire_to: [save.id] }), scale);
    assert.equal(g.getLink(preview.inputs[0].link).origin_id, decode.id);
}
// Four inpainting wires in one transaction; replacing an occupied latent needs opt-in.
{
    const g = new Graph(), load = node(g, [], [['IMAGE','IMAGE'], ['MASK','MASK']]);
    const ckpt = node(g, [], [['MODEL','MODEL'], ['VAE','VAE']]);
    const empty = node(g, [], [['LATENT','LATENT']]), sampler = node(g, [['latent_image','LATENT']], [['LATENT','LATENT']]);
    empty.connect(0, sampler, 0);
    const encode = node(null, [['pixels','IMAGE'], ['mask','MASK'], ['vae','VAE']], [['LATENT','LATENT']]);
    const plan = addWires(g, encode, { wire_from: [load.id, ckpt.id], wire_to: [sampler.id] });
    assert.equal(plan.length, 4);
    assert.throws(() => validateWires(g, plan), /replace:true/);
    assert.equal(wire(g, plan, encode, true).length, 4);
    assert.equal(reachesOutput(g, encode), false);
}
// Ambiguity, wildcard and conflicting sources fail before mutation.
{
    const g = new Graph(), text = node(g, [], [['CONDITIONING','CONDITIONING']]);
    const sampler = node(g, [['positive','CONDITIONING'], ['negative','CONDITIONING']]);
    assert.throws(() => pairWires(text, sampler), /positive.*negative/);
    assert.equal(pairWires(text, sampler, { output: 0, input: 'negative' }).length, 1);
    const any = node(g, [], [['any','*']]);
    assert.throws(() => pairWires(any, sampler), /wildcards/);
    assert.equal(pairWires(any, sampler, { output: 0, input: 'negative' }).length, 1);
    const other = node(g, [], [['CONDITIONING','CONDITIONING']]);
    assert.throws(() => validateWires(g, [...pairWires(text, sampler, { output: 0, input: 'positive' }),
        ...pairWires(other, sampler, { output: 0, input: 'positive' })]), /Several sources/);
    assert.equal(Object.keys(g.links).length, 0);
}
// Cycles in the final planned topology are refused, including a detached new node.
{
    const g = new Graph(), a = node(g, [['in','IMAGE']], [['out','IMAGE']]), b = node(g, [['in','IMAGE']], [['out','IMAGE']]);
    a.connect(0,b,0);
    const added = node(null, [['in','IMAGE']], [['out','IMAGE']]);
    assert.throws(() => validateWires(g, addWires(g, added, { wire_from:[b.id], wire_to:[a.id] })), /loop/);
}
// Failure on the second link removes the newly added node and restores the original branch.
{
    const g = new Graph(), decode = node(g, [], [['IMAGE','IMAGE']]), save = node(g, [['images','IMAGE']], [], true);
    decode.connect(0,save,0);
    const before = snapshot(g), added = node(null, [['image','IMAGE']], [['IMAGE','IMAGE']]);
    added.fail = true;
    assert.throws(() => wire(g, addWires(g, added, { insert_after: decode.id }), added), /Original connections restored/);
    assert.deepEqual(snapshot(g), before);
    assert.equal(g._nodes.length, 2);
}
// An existing-node batch must restore BOTH replaced inputs if the second connection fails.
{
    const g = new Graph(), old = node(g, [], [['IMAGE','IMAGE'], ['MASK','MASK']]);
    const next = node(g, [], [['IMAGE','IMAGE'], ['MASK','MASK']]);
    const target = node(g, [['pixels','IMAGE'], ['mask','MASK']]);
    old.connect(0, target, 0); old.connect(1, target, 1);
    const before = snapshot(g), connect = next.connect;
    next.connect = function(slot, ...args) { return slot === 1 ? null : connect.call(this, slot, ...args); };
    assert.throws(() => wire(g, pairWires(next, target), null, true), /Original connections restored/);
    assert.deepEqual(snapshot(g), before);
}
// Widget callbacks that fail before wiring must leave no new node and preserve the old path.
{
    const g = new Graph(), a = node(g, [], [['IMAGE','IMAGE']]), b = node(g, [['images','IMAGE']]);
    a.connect(0,b,0);
    const added = node(null, [['image','IMAGE']], [['IMAGE','IMAGE']]), before = snapshot(g);
    const plan = validateWires(g, addWires(g, added, { insert_after: a.id }));
    assert.throws(() => applyWires(g, plan, added, () => { throw new Error('widget failed'); }), /Original connections restored/);
    assert.equal(g._nodes.length, 2);
    assert.deepEqual(snapshot(g), before);
}
// A text-to-image graph for the splices below: checkpoint, two prompts, sampler.
function textToImage() {
    const g = new Graph(), ckpt = node(g, [], [['MODEL','MODEL'], ['CLIP','CLIP'], ['VAE','VAE']]);
    const pos = node(g, [['clip','CLIP']], [['CONDITIONING','CONDITIONING']]), neg = node(g, [['clip','CLIP']], [['CONDITIONING','CONDITIONING']]);
    const sampler = node(g, [['model','MODEL'], ['positive','CONDITIONING'], ['negative','CONDITIONING']], [['LATENT','LATENT']]);
    ckpt.connect(1, pos, 0); ckpt.connect(1, neg, 0);
    ckpt.connect(0, sampler, 0); pos.connect(0, sampler, 1); neg.connect(0, sampler, 2);
    return { g, ckpt, pos, neg, sampler };
}
const controlNet = () => node(null, [['positive','CONDITIONING'], ['negative','CONDITIONING'], ['control_net','CONTROL_NET'], ['image','IMAGE']],
    [['positive','CONDITIONING'], ['negative','CONDITIONING']]);
const source = (g, n, slot) => g.getLink(n.inputs[slot].link).origin_id;
// Same-name sockets pair up; a ControlNet in front of the sampler takes each prompt at its own input.
{
    const { g, pos, neg, sampler } = textToImage();
    const loader = node(g, [], [['CONTROL_NET','CONTROL_NET']]), picture = node(g, [], [['IMAGE','IMAGE'], ['MASK','MASK']]);
    const cn = controlNet();
    assert.equal(pairWires(cn, sampler).length, 2);
    const result = wire(g, addWires(g, cn, { wire_from: [loader.id, picture.id], wire_to: [sampler.id] }), cn);
    assert.equal(result.length, 6);
    assert.deepEqual([source(g, cn, 0), source(g, cn, 1), source(g, cn, 2), source(g, cn, 3)], [pos.id, neg.id, loader.id, picture.id]);
    assert.deepEqual([g.getLink(sampler.inputs[1].link).origin_slot, g.getLink(sampler.inputs[2].link).origin_slot], [0, 1]);
    assert.equal(source(g, sampler, 1), cn.id);
    assert.throws(() => addWires(g, controlNet(), { insert_after: pos.id }), /#new\.positive.*connect_nodes/);
}
// A LoRA behind a checkpoint splices MODEL and CLIP; the two prompts are two CLIP branches to choose.
{
    const { g, ckpt, pos, neg, sampler } = textToImage();
    const lora = () => node(null, [['model','MODEL'], ['clip','CLIP']], [['MODEL','MODEL'], ['CLIP','CLIP']]);
    assert.throws(() => addWires(g, lora(), { insert_after: ckpt.id }), /choose wire_to.*: 4, 2, 3/);
    const first = lora();
    assert.equal(wire(g, addWires(g, first, { insert_after: ckpt.id, wire_to: [sampler.id, pos.id, neg.id] }), first).length, 5);
    assert.deepEqual([source(g, sampler, 0), source(g, pos, 0), source(g, neg, 0)], [first.id, first.id, first.id]);
    const second = lora();
    assert.equal(wire(g, addWires(g, second, { wire_to: [sampler.id, pos.id, neg.id] }), second).length, 5, 'the same splice in front');
    assert.deepEqual([source(g, second, 0), source(g, second, 1), source(g, pos, 0)], [first.id, first.id, second.id]);
}
// A splice with two inputs of that type and neither named alike is left to the AI; a plain replacement still asks.
{
    const g = new Graph(), decode = node(g, [], [['IMAGE','IMAGE']]), save = node(g, [['images','IMAGE']], [], true);
    decode.connect(0, save, 0);
    assert.throws(() => addWires(g, node(null, [['image1','IMAGE'], ['image2','IMAGE']], [['IMAGE','IMAGE']]), { wire_to: [save.id] }), /image1 or image2/);
    const scale = node(null, [['image','IMAGE']], [['IMAGE','IMAGE']]);
    wire(g, addWires(g, scale, { wire_to: [save.id] }), scale);
    assert.deepEqual([source(g, scale, 0), source(g, save, 0)], [decode.id, scale.id]);
    const loader = node(null, [], [['IMAGE','IMAGE']]);
    assert.throws(() => validateWires(g, addWires(g, loader, { wire_to: [save.id] })), /replace:true/);
}
// A group in API form: links inside it, to canvas nodes as "#id" and outputs by name, then wire_to spliced; one rollback for all.
{
    const { g, ckpt, sampler } = textToImage();
    const picture = node(g, [], [['IMAGE','IMAGE'], ['MASK','MASK']]);
    const made = { a: node(null, [['pixels','IMAGE'], ['vae','VAE']], [['LATENT','LATENT']]), b: node(null, [['samples','LATENT'], ['mask','MASK']], [['LATENT','LATENT']]) };
    const empty = node(g, [], [['LATENT','LATENT']]);
    sampler.inputs.push({ name: 'latent_image', type: 'LATENT', link: null });
    empty.connect(0, sampler, 3);
    const nodes = { a: { inputs: { pixels: [`#${picture.id}`, 0], vae: [`#${ckpt.id}`, 'VAE'] } }, b: { inputs: { samples: ['a', 'LATENT'], mask: [`#${picture.id}`, 'MASK'] }, wire_to: sampler.id } };
    assert.throws(() => validateWires(g, groupWires(g, made, nodes)), /latent_image is already wired.*replace:true/,
        'the samples of b come from a, so it replaces the empty latent instead of splicing it');
    const plan = validateWires(g, groupWires(g, made, nodes), true);
    assert.equal(plan.length, 5, 'four links in, one into the sampler');
    const before = snapshot(g);
    made.b.fail = true;
    assert.throws(() => applyWires(g, plan, Object.values(made)), /Original connections restored/);
    assert.deepEqual(snapshot(g), before);
    assert.equal(g._nodes.includes(made.a), false, 'every node of the group is taken out again');
    made.b.fail = false;
    assert.equal(applyWires(g, plan, Object.values(made)).length, 5);
    assert.equal(source(g, sampler, 3), made.b.id);
    assert.throws(() => groupWires(g, { c: node(null, [['image','IMAGE']], []) }, { c: { inputs: { image: ['#999', 0] } } }), /No node #999/);
    assert.throws(() => groupWires(g, { c: node(null, [['image','IMAGE']], []) }, { c: { inputs: { image: ['zz', 0] } } }), /neither a node of this group/);
    assert.throws(() => groupWires(g, { c: node(null, [['image','IMAGE']], []) }, { c: { inputs: { pixels: [`#${picture.id}`, 0] } } }), /Node c .* has no input pixels; it has: image/);
}
console.log('Typed wiring: insertion, splices, same-name pairs, groups, fan-out, inpainting, ambiguity, cycles and rollback passed.');
