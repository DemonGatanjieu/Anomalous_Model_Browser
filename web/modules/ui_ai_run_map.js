/**
 * What a run really was (api/ai_run_map.py): under a run step, one line that says it (the base
 * model, how many LoRAs, the size, the steps), what changed since the run before as chips, and,
 * opened, its nodes as boxes and links drawn by the stage's diagram (ui_ai_stage.js), each box
 * locating its node on the canvas. The words are the user's language, made here from the facts
 * the server read; show_run_map puts the same on the stage (a "run_map" block).
 */

import { translate as t } from './locales.js';
import { diagram } from './ui_ai_stage.js';

const LABELLED = new Set(['MODEL', 'LATENT', 'IMAGE', 'CONDITIONING', 'UPSCALE_MODEL', 'MASK', 'CONTROL_NET']);
const COLOR = { model: 'purple', lora: 'purple', prompt: 'green', sampler: 'blue', size: 'yellow', image: 'yellow', upscale: 'yellow' };
const MIN_SCALE = 0.6;
const KEYS = ['steps', 'cfg', 'denoise', 'sampler_name', 'scheduler', 'width', 'height', 'batch_size', 'strength_model', 'strength_clip', 'text'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const fileName = value => String(value || '').replace(/\\/g, '/').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
const size = facts => (facts.width ? `${facts.width}×${facts.height}${facts.batch > 1 ? ` ×${facts.batch}` : ''}` : '');

/** A box's second line: what matters about it, in the user's words. */
export function boxDetail(box) {
    const facts = box.facts || {};
    switch (box.role) {
    case 'lora': return [facts.file, Number.isFinite(facts.strength) ? `(${facts.strength})` : ''].filter(Boolean).join(' ');
    case 'prompt': return `${t(facts.polarity === 'negative' ? 'aiMapNegative' : 'aiMapPositive')}：${facts.text || '—'}`;
    case 'sampler': return [size(facts), facts.steps ? t('aiRunSteps', { steps: facts.steps }) : '', facts.cfg !== undefined ? `CFG ${facts.cfg}` : '',
        facts.sampler_name || '', facts.denoise !== undefined && facts.denoise < 1 ? t('aiMapDenoise', { value: facts.denoise }) : ''].filter(Boolean).join(' · ');
    case 'size': return size(facts);
    case 'save': return facts.prefix || '';
    case 'image': case 'model': case 'upscale': return facts.file || size(facts);
    default: return (facts.values || []).map(([key, value]) => `${key} ${value}`).join(' · ') || facts.file || size(facts);
    }
}

/** One line for the whole run: base model, LoRAs, size, steps, how many nodes. */
export function mapLine(map) {
    const boxes = map?.boxes || [];
    const parts = [];
    const base = boxes.find(box => box.role === 'model' && box.facts?.file);
    if (base) parts.push(t('aiMapBase', { name: base.facts.file }));
    const loras = boxes.filter(box => box.role === 'lora').length;
    if (loras) parts.push(t('aiMapLoras', { count: loras }));
    const sampler = boxes.find(box => box.role === 'sampler');
    const shape = boxes.find(box => box.facts?.width);
    if (shape) parts.push(size(shape.facts));
    if (sampler?.facts?.steps) parts.push(t('aiRunSteps', { steps: sampler.facts.steps }));
    parts.push(t('aiMapNodes', { count: boxes.length }));
    return parts.join(' · ');
}

/** A change since the run before, as one short line. */
export function changeWords(change) {
    if (change.change) return t(change.change === 'added' ? 'aiMapAdded' : 'aiMapRemoved', { title: change.title });
    const key = KEYS.includes(change.key) ? t(`aiMapKey_${change.key}`) : change.key;
    if (change.key === 'text' || String(change.from).length + String(change.to).length > 60) return t('aiMapChangedOnly', { title: change.title, key });
    const show = value => (/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i.test(value) ? fileName(value) : value) || '—';
    return t('aiMapChanged', { title: change.title, key, from: show(change.from), to: show(change.to) });
}

/** The stage diagram block of a run map: top to bottom, so a whole run fits a narrow column. */
export function mapBlock(map) {
    return {
        direction: 'down',
        nodes: (map.boxes || []).map(box => ({ id: box.id, label: box.title, detail: boxDetail(box), node_id: box.id, color: COLOR[box.role] || '' })),
        edges: (map.links || []).map(link => ({ from: link.from, to: link.to, label: LABELLED.has(link.type) ? link.type : '' })),
    };
}

/** Shrinks a drawn diagram to the column it is in (down to MIN_SCALE; narrower, it scrolls sideways). */
function fitDiagram(wrap) {
    const stage = wrap.querySelector('.anomalous-ai-diagram');
    const width = parseFloat(stage?.style.width) || 0;
    const height = parseFloat(stage?.style.height) || 0;
    if (!width || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
        const room = wrap.clientWidth - 4;
        if (room <= 0) return;
        const scale = Math.max(MIN_SCALE, Math.min(1, room / width));
        stage.style.transformOrigin = 'top left';
        stage.style.transform = scale < 1 ? `scale(${scale})` : '';
        stage.style.marginBottom = scale < 1 ? `${-height * (1 - scale)}px` : '';
        stage.style.marginRight = scale < 1 ? `${-width * (1 - scale)}px` : '';
    };
    new ResizeObserver(apply).observe(wrap);
}

/** Under a run step (or on the stage): the line, the changes, the boxes; null for a run without a map.
 * `ctx`: {locateNode(id)}; `open` shows the boxes at once. */
export function runMapBox(step, ctx, open = false) {
    if (!step?.map?.boxes?.length) return null;
    const box = el('div', 'anomalous-ai-run-map');
    const changes = step.changes || [];
    if (changes.length) {
        const chips = el('div', 'anomalous-ai-run-map-changes');
        chips.append(el('span', 'anomalous-ai-run-map-changes-title', t('aiMapSince')),
            ...changes.map(change => el('span', `anomalous-ai-run-map-change${change.change ? ` is-${change.change}` : ''}`, changeWords(change))));
        box.append(chips);
    }
    const more = el('details', 'anomalous-ai-run-map-more');
    more.open = open;
    const head = el('summary', 'anomalous-ai-run-map-head');
    head.append(el('span', 'anomalous-ai-run-map-title', t('aiMapTitle')), el('span', 'anomalous-ai-run-map-line', mapLine(step.map)));
    more.append(head);
    let drawn = false;
    const draw = () => {
        if (drawn || !more.open) return;
        drawn = true;
        const drawing = diagram(mapBlock(step.map), ctx);
        more.append(drawing, el('div', 'anomalous-ai-run-map-note', t('aiMapNote')));
        fitDiagram(drawing);
    };
    more.addEventListener('toggle', draw);
    draw();
    box.append(more);
    return box;
}
