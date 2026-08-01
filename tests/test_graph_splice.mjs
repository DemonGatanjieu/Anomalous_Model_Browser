import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const graphSpliceSource = await readFile(new URL('../web/modules/graph_splice.js', import.meta.url), 'utf8');
const graphSpliceModule = await import(`data:text/javascript;base64,${Buffer.from(graphSpliceSource).toString('base64')}`);
const {
    analyzeModelChainInsertion,
    getModelChainInsertionCapabilities,
    spliceModelChainNode,
} = graphSpliceModule;

class MockNode {
    constructor(id, { inputs = [], outputs = [], x = 0 } = {}) {
        this.id = id;
        this.inputs = inputs.map(type => ({ type, link: null }));
        this.outputs = outputs.map(type => ({ type, links: [] }));
        this.pos = [x, 0];
        this.size = [220, 120];
        this.graph = null;
    }

    connect(originSlot, targetNode, targetSlot) {
        return this.graph.connect(this, originSlot, targetNode, targetSlot);
    }
}

class MockGraph {
    constructor(nodes = []) {
        this._nodes = [];
        this.links = {};
        this.nextNodeId = 100;
        this.nextLinkId = 1;
        this.beforeCount = 0;
        this.afterCount = 0;
        this.changed = 0;
        nodes.forEach(node => this.add(node));
    }

    add(node) {
        if (node.id === null || node.id === undefined) node.id = this.nextNodeId++;
        if (!this._nodes.includes(node)) this._nodes.push(node);
        node.graph = this;
    }

    remove(node) {
        for (const input of node.inputs || []) {
            if (input.link !== null) this.removeLink(input.link);
        }
        for (const output of node.outputs || []) {
            for (const linkId of [...(output.links || [])]) this.removeLink(linkId);
        }
        this._nodes = this._nodes.filter(item => item !== node);
        node.graph = null;
    }

    getNodeById(id) {
        return this._nodes.find(node => node.id === id);
    }

    removeLink(linkId) {
        const link = this.links[linkId];
        if (!link) return;
        const origin = this.getNodeById(link.origin_id);
        const target = this.getNodeById(link.target_id);
        if (origin?.outputs?.[link.origin_slot]) {
            origin.outputs[link.origin_slot].links = origin.outputs[link.origin_slot].links.filter(id => id !== linkId);
        }
        if (target?.inputs?.[link.target_slot]?.link === linkId) {
            target.inputs[link.target_slot].link = null;
        }
        delete this.links[linkId];
    }

    connect(origin, originSlot, target, targetSlot) {
        if (!origin.outputs[originSlot] || !target.inputs[targetSlot]) return null;
        const type = origin.outputs[originSlot].type;
        if (type !== target.inputs[targetSlot].type) return null;
        const previous = target.inputs[targetSlot].link;
        if (previous !== null) this.removeLink(previous);
        const id = this.nextLinkId++;
        const link = {
            id,
            type,
            origin_id: origin.id,
            origin_slot: originSlot,
            target_id: target.id,
            target_slot: targetSlot,
        };
        this.links[id] = link;
        origin.outputs[originSlot].links.push(id);
        target.inputs[targetSlot].link = id;
        return link;
    }

    beforeChange() { this.beforeCount += 1; }
    afterChange() { this.afterCount += 1; }
    change() { this.changed += 1; }
    setDirtyCanvas() {}
}

function chainNode(id, x = 0) {
    return new MockNode(id, { inputs: ['MODEL', 'CLIP'], outputs: ['MODEL', 'CLIP'], x });
}

function loaderNode(id, x = 0) {
    return new MockNode(id, { outputs: ['MODEL', 'CLIP'], x });
}

function connectBoth(graph, origin, target) {
    origin.connect(0, target, 0);
    origin.connect(1, target, 1);
}

function assertDirectLink(graph, origin, originSlot, target, targetSlot) {
    const linkId = target.inputs[targetSlot].link;
    const link = graph.links[linkId];
    assert.ok(link);
    assert.equal(link.origin_id, origin.id);
    assert.equal(link.origin_slot, originSlot);
}

{
    const source = loaderNode(1, 0);
    const anchor = chainNode(2, 500);
    const graph = new MockGraph([source, anchor]);
    connectBoth(graph, source, anchor);
    const inserted = chainNode(null);

    assert.equal(getModelChainInsertionCapabilities(graph, anchor).before.supported, true);
    spliceModelChainNode({ graph, anchorNode: anchor, insertedNode: inserted, direction: 'before' });

    assertDirectLink(graph, source, 0, inserted, 0);
    assertDirectLink(graph, source, 1, inserted, 1);
    assertDirectLink(graph, inserted, 0, anchor, 0);
    assertDirectLink(graph, inserted, 1, anchor, 1);
    assert.equal(graph.beforeCount, 1);
    assert.equal(graph.afterCount, 1);
}

{
    const anchor = loaderNode(1, 0);
    const downstream = chainNode(2, 500);
    const graph = new MockGraph([anchor, downstream]);
    connectBoth(graph, anchor, downstream);
    const inserted = chainNode(null);

    assert.equal(analyzeModelChainInsertion(graph, anchor, 'after').supported, true);
    spliceModelChainNode({ graph, anchorNode: anchor, insertedNode: inserted, direction: 'after' });

    assertDirectLink(graph, anchor, 0, inserted, 0);
    assertDirectLink(graph, anchor, 1, inserted, 1);
    assertDirectLink(graph, inserted, 0, downstream, 0);
    assertDirectLink(graph, inserted, 1, downstream, 1);
}

{
    const anchor = loaderNode(1);
    const a = chainNode(2);
    const b = chainNode(3);
    const graph = new MockGraph([anchor, a, b]);
    anchor.connect(0, a, 0);
    anchor.connect(0, b, 0);
    anchor.connect(1, a, 1);

    const analysis = analyzeModelChainInsertion(graph, anchor, 'after');
    assert.equal(analysis.supported, false);
    assert.equal(analysis.code, 'ambiguous_downstream_branches');
}

{
    const source = loaderNode(1);
    const anchor = chainNode(2);
    const graph = new MockGraph([source, anchor]);
    connectBoth(graph, source, anchor);
    const inserted = chainNode(null);
    const originalConnect = inserted.connect.bind(inserted);
    inserted.connect = (originSlot, target, targetSlot) => {
        if (inserted.outputs[originSlot]?.type === 'CLIP') return null;
        return originalConnect(originSlot, target, targetSlot);
    };

    assert.throws(
        () => spliceModelChainNode({ graph, anchorNode: anchor, insertedNode: inserted, direction: 'before' }),
        error => error.code === 'connection_failed',
    );
    assert.equal(graph._nodes.includes(inserted), false);
    assertDirectLink(graph, source, 0, anchor, 0);
    assertDirectLink(graph, source, 1, anchor, 1);
    assert.equal(graph.beforeCount, 1);
    assert.equal(graph.afterCount, 1);
}

console.log('graph_splice tests passed');
