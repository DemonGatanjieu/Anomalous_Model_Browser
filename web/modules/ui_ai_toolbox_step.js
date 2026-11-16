/**
 * A change of a task's picks on the AI workbench's timeline (a "user_toolbox" step, api/ai_toolbox.py:
 * something taken back, or how strictly changed, in the materials picker ui_ai_toolbox.js): what the
 * task has after it as chips, how strictly the AI keeps to them, and whether the AI has it.
 */

import { resolveLocale, translate as t } from './locales.js';
import { PICK_KINDS, keptCatalog, wayTitle } from './ai_toolbox_data.js';
import { keyOf, totalPicks } from './ai_toolbox_state.js';
import { coverUrl, el, kindIcon } from './ui_ai_toolbox_cards.js';
import { packItems, pageNodes } from './ui_ai_toolbox_sources.js';
import { icon } from './ui_ai_icons.js';
import { sourceBadge } from './ui_ai_toolbox_icons.js';
import { deliveryState } from './ui_ai_delivery.js';

/** The timeline row of step `step`. */
export function toolboxStep(step) {
    const box = el('div', 'anomalous-tb-step');
    const picks = step.toolbox || {};
    if (!totalPicks(picks, PICK_KINDS)) {
        box.append(el('div', 'anomalous-ai-user-text', t('aiToolboxCleared')));
    } else {
        const mode = el('div', `anomalous-tb-step-mode is-${picks.mode === 'only' ? 'only' : 'prefer'}`);
        mode.append(icon(picks.mode === 'only' ? 'lock' : 'target', 14), el('span', '', t(`aiToolboxStepMode_${picks.mode === 'only' ? 'only' : 'prefer'}`)));
        const chips = el('div', 'anomalous-tb-chips is-static');
        const nodes = picks.nodes?.length || picks.packs?.length ? pageNodes() : [];
        const known = new Map([...nodes, ...packItems(nodes), ...(keptCatalog() || [])].map(item => [keyOf(item.kind, item.id), item]));
        for (const kind of PICK_KINDS) {
            for (const id of picks[kind] || []) {
                const item = known.get(keyOf(kind, id));
                const node = el('span', `anomalous-tb-chip is-${kind}`);
                const url = item && ['combos', 'workflows', 'models'].includes(kind) ? coverUrl(item) : '';
                if (url) {
                    const img = el('img');
                    img.src = url;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.onerror = () => img.replaceWith(icon(kindIcon(kind), 14));
                    node.append(img);
                } else {
                    node.append((kind === 'nodes' || kind === 'packs') && item ? sourceBadge(item.source, 16) : icon(kindIcon(kind), 14));
                }
                const inner = kind === 'prompts' && /^(combo|workflow):/.test(id);
                node.append(el('span', 'anomalous-tb-chip-name', kind === 'ways' ? wayTitle(id, resolveLocale()) : inner ? t('aiTbPromptOf', { name: id.replace(/^(combo|workflow):/, '') }) : item?.title || String(id).split(/[\\/:]/).pop()));
                chips.append(node);
            }
        }
        box.append(mode, chips);
    }
    box.append(deliveryState(step));
    return box;
}
