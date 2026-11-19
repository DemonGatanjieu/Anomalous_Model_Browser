/**
 * Where the materials picker's things come from (ui_ai_toolbox.js): the page's node types and the
 * custom node packs among them as things to pick whole (what "@" names too, ui_ai_mention.js),
 * the second column that narrows a kind by a node's source, a prompt's origin, a model's type or
 * a way's job, the base model chips of the models listed (as the Models
 * page has them, model_bases.js), the bar over the cards that picks the pack shown, and the bottom row's
 * two buttons for how strictly the AI keeps to the task's picks.
 */

import { translate as t } from './locales.js';
import { nodeItems, nodeSources } from './ai_toolbox_data.js';
import { el, kindIcon, tbButton } from './ui_ai_toolbox_cards.js';
import { icon } from './ui_ai_icons.js';
import { sourceBadge } from './ui_ai_toolbox_icons.js';
import { typeLabel } from './ui_model_types.js';
import { countBases } from './model_bases.js';

let nodesKept = null; // the page's node types do not change while it is open

/** Every node type the page knows, as picker items. */
export function pageNodes() {
    return (nodesKept ||= nodeItems(globalThis.LiteGraph?.registered_node_types));
}

/** The custom node packs among `nodes`, as items to pick whole. */
export function packItems(nodes) {
    return nodeSources(nodes).filter(source => source.kind === 'pack').map(source => ({
        kind: 'packs', id: source.key, title: t('aiTbPackName', { name: source.label || source.key }), source, count: source.count,
        haystack: `${source.label || ''} ${source.key}`.toLowerCase(),
    }));
}

/** What narrows a kind in the second column: a node's source, a prompt's origin, a model's type, a way's job. */
export function facetOf(item) {
    if (item.kind === 'nodes') return { key: item.source.key, label: item.source.kind === 'pack' ? item.source.label : t(`aiTbSource_${item.source.kind}`), source: item.source };
    if (item.kind === 'prompts') return { key: item.source, label: t(`aiTbPromptFrom_${item.source}`) };
    if (item.kind === 'models') return { key: item.type, label: typeLabel({ type: item.type }) };
    if (item.kind === 'ways' && item.job) return { key: item.job, label: t(`aiBlocksJob_${item.job}`) };
    return null;
}

/** The second column's choices for `items` of `kind`, each with how many it has. */
export function facets(items, kind) {
    if (kind === 'nodes') {
        return nodeSources(items).map(source => ({ key: source.key, count: source.count, source,
            label: source.kind === 'pack' ? source.label : t(`aiTbSource_${source.kind}`) }));
    }
    const found = new Map();
    for (const item of items) {
        const facet = facetOf(item);
        if (!facet) continue;
        const entry = found.get(facet.key) || { ...facet, count: 0 };
        entry.count++;
        found.set(facet.key, entry);
    }
    return [...found.values()].sort((a, b) => b.count - a.count);
}

/**
 * The second column into `side` (hidden with fewer than two choices): `beforeFacet` are the items it
 * narrows, `activeFacet` the choice on, `hasPack(key)` whether that pack is picked whole, `onPick(key)`
 * (null: everything).
 */
export function renderFacets({ side, kind, activeFacet, beforeFacet, hasPack, onPick }) {
    const list = facets(beforeFacet, kind);
    side.hidden = list.length < 2;
    if (side.hidden) return;
    const row = (facet, label, count, badge) => {
        const node = tbButton(`anomalous-tb-facet${activeFacet === facet ? ' is-on' : ''}`, [badge || icon('list', 16), label], () => onPick(facet));
        node.dataset.label = label;
        // The whole name in a tooltip only when the row cuts it short.
        node.onpointerenter = () => { node.title = node.children[1].scrollWidth > node.children[1].clientWidth ? label : ''; };
        node.append(el('span', 'anomalous-tb-facet-count', String(count)));
        if (facet && hasPack(facet)) node.classList.add('has-pack');
        return node;
    };
    side.replaceChildren(el('div', 'anomalous-tb-facets-title', t(kind === 'nodes' ? 'aiTbSources' : 'aiTbNarrow')),
        row(null, t('aiTbEverything'), beforeFacet.length),
        ...list.map(facet => row(facet.key, facet.label, facet.count, facet.source ? sourceBadge(facet.source, 22) : null)));
}

/** The base model chips of `models` into `baseBar` (hidden with fewer than two): `active` is the one on (null: all), `onPick(family)`. */
export function renderBases({ baseBar, models, active, onPick }) {
    const counts = countBases(models);
    baseBar.hidden = counts.length < 2;
    baseBar.replaceChildren(...[[null, models.length], ...counts].map(([family, count]) => {
        const chip = tbButton('anomalous-model-base-chip', [family === null ? t('modelBasesAll') : family || t('modelBasesUnknown'),
            el('span', 'anomalous-model-type-count', String(count))], () => onPick(family));
        chip.setAttribute('aria-pressed', String(family === active));
        return chip;
    }));
}

/** While one custom node pack is shown: its name, how many node types, and putting it on the message whole (`on`: it is). */
export function renderPackBar({ packBar, pack, on, onToggle }) {
    packBar.hidden = !pack;
    if (!pack) return;
    const text = el('div', 'anomalous-tb-pack-text');
    text.append(el('div', 'anomalous-tb-pack-name', pack.source.label || pack.id), el('div', 'anomalous-tb-pack-count', t('aiTbPackCount', { count: pack.count })));
    packBar.replaceChildren(sourceBadge(pack.source, 26), text,
        tbButton(`anomalous-tb-pack-pick${on ? ' is-on' : ''}`, [icon(on ? 'check' : 'plus', 15), t(on ? 'aiTbPackPicked' : 'aiTbPackPick')],
            onToggle, t('aiTbPackHint')));
}

/** Renders the kind tabs (left rail in side mode, horizontal nav bar in full mode). */
export function renderKindRail({ rail, kinds, activeKind, countOf, matchCountOf, onSwitch }) {
    rail.replaceChildren(...kinds.map((kind) => {
        const count = countOf(kind);
        const matches = matchCountOf(kind);
        const node = tbButton(`anomalous-tb-kind${activeKind === kind ? ' is-on' : ''}`, [icon(kindIcon(kind), 18), t(`aiToolboxKind_${kind}`)], () => onSwitch(kind));
        const meta = el('span', 'anomalous-tb-kind-meta');
        if (matches !== null) meta.append(el('span', 'anomalous-tb-kind-matches', String(matches)));
        if (count) meta.append(el('span', 'anomalous-tb-count', String(count)));
        node.append(meta);
        return node;
    }));
}

/** Renders the top filter tabs (All / Given / Favourites / Recent) with live counts. */
export function renderFilterTabs({ filters, activeFilter, counts, onPick }) {
    const specs = [
        ['all', t('aiTbAll'), null, 'list'],
        ['given', t('aiTbGiven'), counts.given, 'sparkle'],
        ['liked', t('aiTbLiked'), counts.liked, 'star'],
        ['recent', t('aiTbRecent'), counts.recent, 'clock'],
    ];
    filters.replaceChildren(...specs.map(([key, label, count, glyph]) => {
        const node = tbButton(`anomalous-tb-filter${activeFilter === key ? ' is-on' : ''}`, [icon(glyph, 14), label], () => onPick(key), label);
        if (count) node.append(el('span', 'anomalous-tb-count', String(count)));
        return node;
    }));
}

const MODES = ['prefer', 'only'];

/** "Prefer these" / "Only these" as a radio pair: `active` the task's, `onPick(mode)` applies another. */
export function renderModes({ active, disabled, onPick }) {
    const modes = el('div', 'anomalous-tb-modes');
    modes.setAttribute('role', 'radiogroup');
    for (const mode of MODES) {
        const option = tbButton(`anomalous-tb-mode${active === mode ? ' is-on' : ''}`, [icon(mode === 'only' ? 'filter' : 'target', 16), t(`aiTbMode_${mode}`)], () => onPick(mode), t(`aiTbModeHint_${mode}`));
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(active === mode));
        option.disabled = disabled;
        modes.append(option);
    }
    return modes;
}

/** Updates the center column's subheader: folds the title/count into the base bar in full models view to avoid empty space. */
export function renderSubhead({ gridHead, baseBar, kind, facetLabel, countText }) {
    const compactBases = !baseBar.hidden;
    gridHead.hidden = compactBases;
    if (compactBases) {
        baseBar.append(el('span', 'anomalous-tb-bases-count', facetLabel ? `${facetLabel} · ${countText}` : countText));
        return;
    }
    gridHead.replaceChildren(el('span', 'anomalous-tb-grid-title', facetLabel || t(`aiToolboxKind_${kind}`)),
        el('span', 'anomalous-tb-grid-count', countText));
}
