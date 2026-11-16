/**
 * Where the materials picker's things come from (ui_ai_toolbox.js): the page's node types and the
 * custom node packs among them as things to pick whole (what "@" names too, ui_ai_mention.js),
 * the second column that narrows a kind by a node's source, a prompt's origin, a model's type or
 * a way's job (a column in the large window; in the side panel one "Source: All ▾" button opening
 * a list to search, ui_ai_facet_menu.js), the base model chips of the models listed (as the Models
 * page has them, model_bases.js), and the bar over the cards that picks the pack shown.
 */

import { translate as t } from './locales.js';
import { nodeItems, nodeSources } from './ai_toolbox_data.js';
import { el, tbButton } from './ui_ai_toolbox_cards.js';
import { icon } from './ui_ai_icons.js';
import { sourceBadge } from './ui_ai_toolbox_icons.js';
import { closeFacetMenu, toggleFacetMenu } from './ui_ai_facet_menu.js';
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
 * (null: everything). `isSide`: the side panel's one button, its list opening over `main`.
 */
export function renderFacets({ side, main, isSide, kind, activeFacet, beforeFacet, hasPack, onPick }) {
    closeFacetMenu();
    const list = facets(beforeFacet, kind);
    side.hidden = list.length < 2;
    if (side.hidden) return;
    const row = (facet, label, count, badge) => {
        const node = tbButton(`anomalous-tb-facet${activeFacet === facet ? ' is-on' : ''}`, [badge || icon('list', 16), label], () => onPick(facet));
        node.dataset.label = label;
        // The whole name in a tooltip only when the row cuts it short.
        node.onpointerenter = () => { node.title = node.children[1].scrollWidth > node.children[1].clientWidth ? label : ''; };
        node.append(el('span', 'anomalous-tb-facet-count', String(count)));
        if (activeFacet === facet && isSide) node.append(icon('check', 14));
        if (facet && hasPack(facet)) node.classList.add('has-pack');
        return node;
    };
    const title = t(kind === 'nodes' ? 'aiTbSources' : 'aiTbNarrow');
    const rows = () => [row(null, t('aiTbEverything'), beforeFacet.length),
        ...list.map(facet => row(facet.key, facet.label, facet.count, facet.source ? sourceBadge(facet.source, 22) : null))];
    if (!isSide) {
        side.replaceChildren(el('div', 'anomalous-tb-facets-title', title), ...rows());
        return;
    }
    // The side panel: one button saying what is shown, opening the list to pick from (and search).
    const current = list.find(facet => facet.key === activeFacet);
    const open = tbButton(`anomalous-tb-facet-open${current && hasPack(current.key) ? ' has-pack' : ''}`, [
        current?.source ? sourceBadge(current.source, 20) : icon('list', 15),
        el('span', 'anomalous-tb-facet-open-label', `${title}${t('wordColon')}${current?.label || t('aiTbEverything')}`),
        el('span', 'anomalous-tb-facet-count', String(current?.count ?? beforeFacet.length)), icon('chevronDown', 14)],
    () => toggleFacetMenu({ host: main, top: side.offsetTop + side.offsetHeight, title, rows: rows(), button: open }), t('aiTbPickSource'));
    open.setAttribute('aria-haspopup', 'listbox');
    side.replaceChildren(open);
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
