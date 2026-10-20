/**
 * Where the AI's stage blocks go, without DOM (ui_ai_stage.js draws them): a diagram's boxes in
 * columns (or rows) by how far they are from where the arrows start, and the place of a mark
 * on a picture. The AI gives only what is there and what connects; the layout is Anomalous's.
 */

/**
 * `{ place: Map(id → { layer, slot }), layers, slots }` for a diagram: a box's layer is the
 * longest chain of arrows leading to it (boxes in a loop stop growing after one pass each), and
 * a box nothing leads to sits right before the first box it feeds (a prompt feeding the sampler
 * stands next to it, not at the far left with a long arrow across everything). Within a layer,
 * boxes are sorted by where the boxes feeding them are, so arrows cross less; ties keep the
 * order the AI listed them in.
 */
export function diagramLayout(nodes, edges) {
    const ids = (nodes || []).map(node => node.id);
    const layer = new Map(ids.map(id => [id, 0]));
    const links = (edges || []).filter(edge => layer.has(edge.from) && layer.has(edge.to) && edge.from !== edge.to);
    for (let pass = 0; pass < ids.length; pass += 1) {
        let moved = false;
        for (const { from, to } of links) {
            if (layer.get(to) < layer.get(from) + 1 && layer.get(from) + 1 < ids.length) {
                layer.set(to, layer.get(from) + 1);
                moved = true;
            }
        }
        if (!moved) break;
    }
    const feeds = new Map(ids.map(id => [id, []]));
    const fedBy = new Map(ids.map(id => [id, []]));
    for (const { from, to } of links) {
        feeds.get(from).push(to);
        fedBy.get(to).push(from);
    }
    for (const id of ids) {
        if (fedBy.get(id).length || !feeds.get(id).length) continue;
        layer.set(id, Math.max(layer.get(id), Math.min(...feeds.get(id).map(to => layer.get(to))) - 1));
    }
    const top = Math.max(0, ...layer.values());
    const place = new Map();
    let widest = 1;
    for (let at = 0; at <= top; at += 1) {
        const here = ids.filter(id => layer.get(id) === at);
        const weight = (id) => {
            const before = fedBy.get(id).filter(from => place.has(from)).map(from => place.get(from).slot);
            return before.length ? before.reduce((sum, slot) => sum + slot, 0) / before.length : Infinity;
        };
        const order = here.map((id, listed) => ({ id, listed, weight: weight(id) }))
            .sort((a, b) => (a.weight === b.weight ? a.listed - b.listed : (a.weight === Infinity ? 1 : b.weight === Infinity ? -1 : a.weight - b.weight)));
        order.forEach(({ id }, slot) => place.set(id, { layer: at, slot }));
        widest = Math.max(widest, here.length);
    }
    return { place, layers: top + 1, slots: widest };
}

/**
 * Pixel boxes for a diagram: `{ boxes: Map(id → {x, y, w, h}), width, height }`. `direction`
 * 'right' puts the layers in columns, 'down' in rows.
 */
export function diagramBoxes(nodes, edges, direction = 'right', size = { w: 150, h: 54, gapX: 56, gapY: 18 }) {
    const { place, layers, slots } = diagramLayout(nodes, edges);
    const down = direction === 'down';
    const counts = new Map();
    for (const { layer } of place.values()) counts.set(layer, (counts.get(layer) || 0) + 1);
    const boxes = new Map();
    for (const [id, { layer, slot }] of place) {
        // A shorter layer is centred against the longest one.
        const offset = (slots - counts.get(layer)) / 2;
        const along = layer * ((down ? size.h : size.w) + (down ? size.gapY * 2 : size.gapX));
        const across = (slot + offset) * ((down ? size.w : size.h) + (down ? size.gapX / 2 : size.gapY));
        boxes.set(id, down ? { x: across, y: along, w: size.w, h: size.h } : { x: along, y: across, w: size.w, h: size.h });
    }
    const width = Math.max(0, ...[...boxes.values()].map(box => box.x + box.w));
    const height = Math.max(0, ...[...boxes.values()].map(box => box.y + box.h));
    return { boxes, width, height };
}

/** Where an arrow from box `a` to box `b` starts and ends: the middle of their facing sides. */
export function arrowEnds(a, b, direction = 'right') {
    if (direction === 'down' ? b.y >= a.y + a.h : b.x >= a.x + a.w) {
        return direction === 'down'
            ? { x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y }
            : { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
    }
    // Backwards or beside: centre to centre.
    return { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 };
}

/**
 * A mark's place on its picture, in percent of the picture: `{ left, top, width, height, round }`.
 * x / y are the centre; a circle's r is a fraction of the picture's width (so `height` is null:
 * the page keeps it round).
 */
export function markBox(mark) {
    const clamp = value => Math.max(0, Math.min(100, value));
    if (mark.w !== undefined && mark.h !== undefined) {
        return { left: clamp((mark.x - mark.w / 2) * 100), top: clamp((mark.y - mark.h / 2) * 100), width: mark.w * 100, height: mark.h * 100, round: false };
    }
    const r = mark.r ?? 0.06;
    return { left: clamp((mark.x - r) * 100), top: clamp(mark.y * 100), width: r * 200, height: null, round: true };
}
