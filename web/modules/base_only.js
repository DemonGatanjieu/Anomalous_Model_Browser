/**
 * The first pass of a queued prompt, the base, and the rest: a base sampler is one with no sampler
 * before it; the base part is every node no later sampler feeds; its picture nodes are whatever takes
 * `images` there below a base and feeds nothing: those taking a decoded base as it is, when there are any
 * (something made from the picture, as the mask a later step previews, is not a base to pick, and
 * belongs to the rest). Pure: an API prompt comes in, the canvas never changes.
 * - run_workflow(base_only): baseOnly cuts the prompt down to the base part, its picture nodes made
 *   PreviewImage (shown, nothing saved). A base handed on unfinished (the mid-way switch: no picture
 *   of it before the second sampler) is finished and decoded as the canvas's own VAE decode does.
 * - The run after the user picked one (api/ai_bases.py): onKeptBase hands the later part the kept
 *   picture (LoadImage) where it takes the base's picture, so the base is never drawn again; null when
 *   it takes more than that picture (the mid-way switch's latent): the base is drawn again from its seed.
 */

const SEEDS = ['seed', 'noise_seed'];
const isLink = value => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';
const links = node => Object.entries(node?.inputs || {}).filter(([, value]) => isLink(value));

function split(output) {
    const ids = Object.keys(output || {});
    const samplers = new Set(ids.filter(id => isLink(output[id]?.inputs?.latent_image)));
    const before = new Map();
    const above = (id, path = new Set()) => {
        if (before.has(id)) return before.get(id);
        const found = new Set();
        if (path.has(id)) return found; // a loop is ComfyUI's to refuse
        path.add(id);
        for (const [, [from]] of links(output[id])) {
            if (!output[from]) continue;
            found.add(from);
            for (const item of above(from, path)) found.add(item);
        }
        path.delete(id);
        before.set(id, found);
        return found;
    };
    const bases = [...samplers].filter(id => ![...above(id)].some(item => samplers.has(item)));
    if (!bases.length) throw new Error('No sampler on the canvas: there is no base to show.');
    const later = new Set([...samplers].filter(id => !bases.includes(id)));
    const part = new Set(ids.filter(id => !later.has(id) && ![...above(id)].some(item => later.has(item))));
    const taken = new Set(ids.flatMap(id => links(output[id]).map(([, [from]]) => from)));
    const below = [...part].filter(id => isLink(output[id].inputs.images) && !taken.has(id)
        && bases.some(base => above(id).has(base)));
    const decoded = below.filter(id => bases.includes(output[output[id].inputs.images[0]]?.inputs?.samples?.[0]));
    return { ids, above, bases, part, shows: decoded.length ? decoded : below };
}

/** {output, bases: [{node, type, names}], shows: [node ids], saved: [those the canvas saves], prefix} for API prompt `output`. */
export function baseOnly(output) {
    const { ids, above, bases, part, shows } = split(output);
    const cut = {};
    const saved = shows.filter(id => output[id].class_type !== 'PreviewImage');
    const prefix = shows.map(id => output[id].inputs.filename_prefix).find(value => typeof value === 'string') || '';
    for (const id of shows) cut[id] = { class_type: 'PreviewImage', inputs: { images: output[id].inputs.images } };
    const decoder = ids.map(id => output[id]).find(node => isLink(node?.inputs?.samples) && isLink(node?.inputs?.vae)
        && part.has(node.inputs.vae[0]));
    let next = Math.max(0, ...ids.map(Number).filter(Number.isFinite)) + 1;
    for (const base of bases.filter(id => !shows.some(show => above(show).has(id)))) {
        if (!decoder) throw new Error('No VAE decode on the canvas to show the base with.');
        const finish = 'end_at_step' in output[base].inputs ? { end_at_step: 10000, return_with_leftover_noise: 'disable' } : {};
        cut[base] = { ...output[base], inputs: { ...output[base].inputs, ...finish } };
        const decode = String(next++), show = String(next++);
        cut[decode] = { class_type: decoder.class_type, inputs: { ...decoder.inputs, samples: [base, 0] } };
        cut[show] = { class_type: 'PreviewImage', inputs: { images: [decode, 0] } };
        shows.push(show);
    }
    const needed = new Set();
    const keep = id => {
        if (needed.has(id) || !(cut[id] || output[id])) return;
        needed.add(id);
        for (const [, [from]] of links(cut[id] || output[id])) keep(from);
    };
    shows.forEach(keep);
    return {
        output: Object.fromEntries([...needed].map(id => [id, cut[id] || output[id]])), shows, saved, prefix,
        bases: bases.map(id => ({ node: id, type: output[id].class_type, names: SEEDS.filter(name => name in output[id].inputs) })),
    };
}

/** API prompt `output` with picture `image` (in the input folder) in place of drawing the base, or null. */
export function onKeptBase(output, image) {
    const { ids, bases, shows } = split(output);
    const pictures = new Set(shows.map(id => String(output[id].inputs.images)));
    const load = String(Math.max(0, ...ids.map(Number).filter(Number.isFinite)) + 1);
    const taken = new Set(ids.flatMap(id => links(output[id]).map(([, [from]]) => from)));
    const ends = ids.filter(id => !taken.has(id) && !shows.includes(id)); // what the rest makes: the base's own pictures go
    const swapped = { [load]: { class_type: 'LoadImage', inputs: { image } } };
    for (const id of ids) {
        const inputs = Object.entries(output[id].inputs || {})
            .map(([name, value]) => [name, isLink(value) && pictures.has(String(value)) ? [load, 0] : value]);
        swapped[id] = { ...output[id], inputs: Object.fromEntries(inputs) };
    }
    const needed = new Set();
    const keep = id => {
        if (needed.has(id) || !swapped[id]) return;
        needed.add(id);
        for (const [, [from]] of links(swapped[id])) keep(from);
    };
    ends.forEach(keep);
    if (!needed.has(load) || bases.some(base => needed.has(base))) return null;
    return Object.fromEntries([...needed].map(id => [id, swapped[id]]));
}
