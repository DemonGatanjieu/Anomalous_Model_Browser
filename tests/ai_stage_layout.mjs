// Where the AI's stage blocks go (web/modules/ai_stage_layout.js): diagram layers and boxes, marks.
import assert from 'node:assert/strict';
import { arrowEnds, diagramBoxes, diagramLayout, markBox } from '../web/modules/ai_stage_layout.js';

const nodes = ['model', 'lora', 'prompt', 'sampler', 'save'].map(id => ({ id }));
const edges = [{ from: 'model', to: 'lora' }, { from: 'lora', to: 'sampler' }, { from: 'prompt', to: 'sampler' }, { from: 'sampler', to: 'save' }];
const { place, layers, slots } = diagramLayout(nodes, edges);
assert.deepEqual(Object.fromEntries([...place].map(([id, at]) => [id, at.layer])), { model: 0, lora: 1, prompt: 1, sampler: 2, save: 3 },
    'a prompt that only feeds the sampler stands right before it');
assert.equal(layers, 4);
assert.equal(slots, 2);
assert.deepEqual(place.get('prompt'), { layer: 1, slot: 1 }, 'after the box fed from the left');

// The user's chain: model → LoRA → LoRA → sampler → save, the prompt into the sampler.
const chain = diagramLayout(['ckpt', 'lora1', 'lora2', 'pos', 'ks', 'save'].map(id => ({ id })), [
    { from: 'ckpt', to: 'lora1' }, { from: 'lora1', to: 'lora2' }, { from: 'lora2', to: 'ks' }, { from: 'pos', to: 'ks' }, { from: 'ks', to: 'save' }]);
assert.deepEqual(Object.fromEntries([...chain.place].map(([id, at]) => [id, at.layer])), { ckpt: 0, lora1: 1, lora2: 2, pos: 2, ks: 3, save: 4 });

// Within a layer, by where their feeders are: crossing arrows untangle.
const cross = diagramLayout(['a', 'b', 'x', 'y'].map(id => ({ id })), [{ from: 'a', to: 'y' }, { from: 'b', to: 'x' }]);
assert.equal(cross.place.get('y').slot, 0);
assert.equal(cross.place.get('x').slot, 1);

// A loop does not grow forever; a missing end is ignored.
const loop = diagramLayout([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'zz' }]);
assert.ok(loop.layers <= 2);

// Boxes: layers in columns to the right, a shorter layer centred.
const size = { w: 100, h: 40, gapX: 50, gapY: 10 };
const right = diagramBoxes(nodes, edges, 'right', size);
assert.deepEqual(right.boxes.get('model'), { x: 0, y: 25, w: 100, h: 40 }, 'a layer of one is centred');
assert.deepEqual(right.boxes.get('lora'), { x: 150, y: 0, w: 100, h: 40 });
assert.equal(right.width, 3 * 150 + 100);
assert.equal(right.height, 90);
const down = diagramBoxes(nodes, edges, 'down', size);
assert.equal(down.boxes.get('sampler').y, 2 * 60);

// Arrows meet the facing sides; backwards they go centre to centre.
assert.deepEqual(arrowEnds({ x: 0, y: 0, w: 100, h: 40 }, { x: 150, y: 0, w: 100, h: 40 }), { x1: 100, y1: 20, x2: 150, y2: 20 });
assert.deepEqual(arrowEnds({ x: 150, y: 0, w: 100, h: 40 }, { x: 0, y: 0, w: 100, h: 40 }), { x1: 200, y1: 20, x2: 50, y2: 20 });
assert.deepEqual(arrowEnds({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 60, w: 100, h: 40 }, 'down'), { x1: 50, y1: 40, x2: 50, y2: 60 });

// Marks: a box by its centre and size, a circle by its centre and radius (of the width).
assert.deepEqual(markBox({ x: 0.5, y: 0.5, w: 0.2, h: 0.1 }), { left: 40, top: 45, width: 20, height: 10, round: false });
const circle = markBox({ x: 0.6, y: 0.3, r: 0.05 });
assert.equal(circle.round, true);
assert.equal(circle.height, null);
assert.ok(Math.abs(circle.left - 55) < 1e-9 && Math.abs(circle.width - 10) < 1e-9 && Math.abs(circle.top - 30) < 1e-9);
assert.equal(markBox({ x: 0.01, y: 0.5, r: 0.1 }).left, 0, 'kept on the picture');

console.log('ai_stage_layout: ok');
