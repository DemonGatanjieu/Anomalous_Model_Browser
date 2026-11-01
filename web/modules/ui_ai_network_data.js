/**
 * The training network's data (ui_ai_network.js), from GET /anomalous/ai_training: the items (the
 * ready-made ways and skills that are on or have a record, the node packs that ran), the base models
 * (those of the main models here, and any the record names), the pairs that ran (edges) and how each
 * turned out (the user's judgement first, else the AI's), the pairs that could still be tried, and the
 * numbers over the views. Shared by the drawings (ui_ai_network_graph.js) and the detail column
 * (ui_ai_network_detail.js).
 */

import { resolveLocale, translate as t } from './locales.js';

export const KINDS = ['way', 'skill', 'pack'];
export const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';
export const baseLabel = base => base || t('aiRecordOther');
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const isBase = pick => Boolean(pick) && pick.base !== undefined && !pick.kind;
export const isItem = pick => Boolean(pick?.kind) && pick.base === undefined;
export const isPair = pick => Boolean(pick?.kind) && pick.base !== undefined;
export const pairKey = (base, item) => `${base}|${item.key}`;

/** Whether `edge` belongs to the pick: a base, an item, a pair, or nothing picked. */
export const touches = (edge, pick) => !pick || (pick.base === undefined || pick.base === edge.base)
    && (!pick.kind || pick.kind === edge.item.kind && pick.name === edge.item.name);

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The items: the ways and skills on (and any with a record) and the node packs that ran, those that ran most first. */
function itemsOf(data) {
    const record = data.record || {};
    const out = [];
    for (const block of data.blocks) {
        const usable = block.usable && block.on;
        if (usable || record.way?.[block.name]) out.push({ kind: 'way', name: block.name, title: words(block.title), sub: t(`aiBlocksJob_${block.job}`), usable });
    }
    for (const skill of data.skills) {
        if (skill.on || record.skill?.[skill.name]) out.push({ kind: 'skill', name: skill.name, title: words(skill.title), sub: 'Skill', usable: skill.on });
    }
    for (const name of Object.keys(record.skill || {})) {
        if (name.startsWith('external:') && !out.some(item => item.kind === 'skill' && item.name === name))
            out.push({ kind: 'skill', name, title: name.slice(9), sub: t('aiNetExternalSkill'), usable: false });
    }
    for (const pack of Object.keys(record.pack || {}).sort()) out.push({ kind: 'pack', name: pack, title: pack, sub: t('aiNetPack'), usable: false });
    const runs = item => Object.values(record[item.kind]?.[item.name] || {}).reduce((sum, count) => sum + count.runs, 0);
    return out.map(item => ({ ...item, key: `${item.kind}:${item.name}`, runs: runs(item) })).sort((a, b) => b.runs - a.runs);
}

/** The base models with how many main models here have each and how often they ran, most run first. */
function basesOf(data, edges) {
    const bases = new Map(data.models.map(model => [model.base, 0]));
    for (const model of data.models) bases.set(model.base, bases.get(model.base) + 1);
    const runs = new Map();
    for (const edge of edges) {
        runs.set(edge.base, (runs.get(edge.base) || 0) + edge.count.runs);
        if (!bases.has(edge.base)) bases.set(edge.base, 0);
    }
    return [...bases].map(([base, models]) => ({ base, models, runs: runs.get(base) || 0 }))
        .sort((a, b) => b.runs - a.runs || b.models - a.models || a.base.localeCompare(b.base));
}

/** How a pair turned out: the user's judgement first, else the AI's (`ai`), else only that it ran. */
export function look(count) {
    const share = (good, all) => (good / all >= 0.6 ? 'good' : good / all >= 0.3 ? 'fair' : 'bad');
    const user = count.good + count.bad + count.passed;
    const ai = count.ai_good + count.ai_passed;
    if (user) return { tone: share(count.good, user), ai: false };
    if (ai) return { tone: share(count.ai_good, ai), ai: true };
    return { tone: 'ran', ai: false };
}

/**
 * The network the views draw: {data, items, bases, edges, tried}. `filter`: {kind: 'all' | a kind,
 * ran: only what ran}.
 */
export function networkOf(data, filter) {
    let items = itemsOf(data);
    if (filter.kind !== 'all') items = items.filter(item => item.kind === filter.kind);
    if (filter.ran) items = items.filter(item => item.runs);
    const edges = items.flatMap(item => Object.entries(data.record?.[item.kind]?.[item.name] || {})
        .map(([base, count]) => ({ base, item, count, look: look(count) })));
    let bases = basesOf(data, edges);
    if (filter.ran) bases = bases.filter(base => base.runs);
    return { data, items, bases, edges, tried: new Set(edges.map(edge => pairKey(edge.base, edge.item))) };
}

/** Whether a pair could be tried: the item runs here, the base model has models here, they never ran together. */
export const canTry = (net, base, item) => item.usable && base.models > 0 && !net.tried.has(pairKey(base.base, item));

/** The pairs of the picked base model or item not tried yet: [base, item]. */
export function untried(net, pick) {
    if (isBase(pick)) {
        const base = net.bases.find(entry => entry.base === pick.base);
        return base ? net.items.filter(item => canTry(net, base, item)).map(item => [base.base, item]) : [];
    }
    const item = isItem(pick) && net.items.find(entry => entry.kind === pick.kind && entry.name === pick.name);
    return item ? net.bases.filter(base => canTry(net, base, item)).map(base => [base.base, item]) : [];
}

/** "4 runs · 3 good", or the AI's word when the user gave none. */
export function short(count) {
    const judged = look(count);
    return t(judged.ai ? 'aiNetShortAi' : 'aiNetShort', { runs: count.runs, good: judged.ai ? count.ai_good : count.good });
}

export function countWords(count, keys) {
    return keys.filter(key => count[key]).map(key => t(`aiNetCount_${key}`, { n: count[key] })).join(' · ');
}

/** The numbers over the views: runs here, judged by the user, by the AI, pairs that could be tried, rounds. */
export function totals(net) {
    const models = Object.values(net.data.by_model || {});
    const sum = key => models.reduce((all, count) => all + (count[key] || 0), 0);
    return {
        runs: sum('runs'), judged: sum('good') + sum('bad') + sum('passed'), ai: sum('ai'),
        untried: net.bases.reduce((all, base) => all + net.items.filter(item => canTry(net, base, item)).length, 0),
        rounds: (net.data.rounds || []).length,
    };
}

/** A thin bar of how `counts` (edges' counts summed) turned out: good, not good, not chosen, not judged. */
export function meter(counts) {
    const sum = key => counts.reduce((all, count) => all + count[key], 0);
    const runs = sum('runs');
    const bar = el('span', 'anomalous-ai-net-meter');
    if (!runs) return bar;
    const parts = { good: sum('good'), bad: sum('bad'), passed: sum('passed') };
    parts.open = Math.max(0, runs - parts.good - parts.bad - parts.passed);
    for (const [part, value] of Object.entries(parts)) {
        if (!value) continue;
        const piece = el('span', `anomalous-ai-net-meter-part is-${part}`);
        piece.style.flexGrow = String(value);
        bar.append(piece);
    }
    return bar;
}
