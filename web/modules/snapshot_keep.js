/**
 * What a save can become: a copy of it as a workflow card, as a preset of a card with the same
 * structure, or as a combo. The copy and the save go their own ways from then on (AD-023). The save's
 * newest saved picture goes with the copy as its cover. No DOM.
 */

import { readDetached } from './detached_graph.js';
import { keepImageAsCombo } from './image_keep.js';
import { captureRecipeDraft } from './recipe_parser.js';
import { keepImageAsRecipe } from './recipe_save.js';
import { nextSetName } from './ui_param_set_keys.js';
import { jsonResponse } from './ui_dom.js';

const cover = save => [...save.pictures].reverse().find(picture => picture.type === 'output') || null;

/** A new workflow card from `save`; `existed` when its picture was kept as one before. */
export const keepAsCard = (save, workflow) => keepImageAsRecipe(cover(save), { workflow });

/** A new combo of the nodes that make `save`'s model and prompts; `existed` as for a card. */
export const keepAsCombo = (save, workflow) => keepImageAsCombo(cover(save), { workflow });

/** A new preset of `card` (as cardsLike gives it) with `workflow`'s values. The preset's name. */
export async function keepAsPreset(card, workflow) {
    const { notebooks = [] } = await jsonResponse(await fetch(`/anomalous/parameters?recipe_filename=${encodeURIComponent(card.filename)}`, { cache: 'no-store' }), 'list presets');
    const draft = readDetached(workflow, captureRecipeDraft);
    const name = nextSetName(card, notebooks);
    const response = await fetch('/anomalous/save_parameter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tags: card.tags, notes: card.notes, params: draft.metadata, workflow: draft.workflow, recipe_filename: card.filename }),
    });
    await jsonResponse(response, 'save preset');
    return name;
}
