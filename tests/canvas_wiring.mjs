import assert from 'node:assert/strict';
import { addWires, applyWires, pairWires, reachesOutput, validateWires } from '../web/modules/canvas_wiring.js';

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
console.log('Typed wiring: insertion, fan-out, inpainting, ambiguity, cycles and rollback passed.');
