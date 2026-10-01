/**
 * Dragging a prompt onto the canvas. While a prompt material is dragged, every prompt box
 * on the canvas is outlined in its role's colour; the box under the pointer is the
 * target (or a node's only box), and the hint says what releasing will write where,
 * including the opposite-role box on the same sampler. prompt_boxes.js decides boxes and
 * roles; ui_material_cards.js binds this to the cards.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { getCanvasPosition } from './material_drag.js';
import { extractMaterialPromptEnvelope } from './node_material_actions.js';
import { partnerBox, promptBoxes, typeTakesPrompt } from './prompt_boxes.js';
import { fetchMaterial } from './ui_material_application.js';

const ROLE_CLASSES = { positive: 'is-positive', negative: 'is-negative', both: 'is-both', '': 'is-unknown' };
const BOX_LABELS = { positive: 'promptBoxPositive', negative: 'promptBoxNegative', both: 'promptBoxBoth', '': 'promptBoxPlain' };
const OPPOSITE = { positive: 'negative', negative: 'positive' };
// The dragged material's prompt texts, fetched when its drag starts (list summaries of
// prompt plans do not carry the text).
let dragged = { filename: '', envelope: null };

/** Starts fetching the dragged material's prompt texts, so the hint can say exactly what goes where. */
export function preparePromptDrag(material) {
    const drag = dragged = { filename: material.filename, envelope: null };
    fetchMaterial(material.filename)
        .then(payload => { drag.envelope = extractMaterialPromptEnvelope(material, payload); })
        .catch(() => {}); // the hint stays general; the drop fetches again and reports failures
}

/** Whether a material carries prompt text a prompt box can take. */
export function carriesPrompt(material, isPromptMaterial) {
    return isPromptMaterial || material.kind === 'prompt_plan'
        || (material.capabilities || []).includes('copy_prompt')
        || (material.node_types || []).some(type => typeTakesPrompt(type));
}

/** Outlines every prompt box of the open graph by role; returns what removes the outlines. */
export function outlinePromptBoxes(graph = app.graph) {
    const marked = [];
    for (const node of graph?._nodes || []) {
        for (const box of promptBoxes(node)) {
            const element = box.widget.element;
            if (!element) continue;
            element.classList.add('anomalous-prompt-box', ROLE_CLASSES[box.role]);
            marked.push(element);
        }
    }
    return () => {
        for (const element of marked) element.classList.remove('anomalous-prompt-box', 'is-hover', ...Object.values(ROLE_CLASSES));
    };
}

/** Marks the box a drag points at (null: none). */
export function markTargetBox(box) {
    for (const element of document.querySelectorAll('.anomalous-prompt-box.is-hover')) {
        if (element !== box?.widget.element) element.classList.remove('is-hover');
    }
    box?.widget.element?.classList.add('is-hover');
}

/** The prompt box a drag event points at on `node`: the box under the pointer, or the node's only box. */
export function promptBoxAt(node, event) {
    const boxes = promptBoxes(node);
    const hit = boxes.find(box => box.widget.element?.contains(event.target));
    if (hit) return hit;
    const position = getCanvasPosition(event, app.canvas);
    const widget = position && node.getWidgetOnPos?.(position[0], position[1], true);
    return boxes.find(box => box.widget === widget) || (boxes.length === 1 ? boxes[0] : null);
}

/** Why a node refuses a prompt drop at this point ('' when it takes it). */
export function promptRefusal(node, event) {
    const boxes = promptBoxes(node);
    if (!boxes.length) return t('promptDropNoBox');
    return promptBoxAt(node, event) ? '' : t('promptDropPickBox');
}

/** What releasing a prompt material on `box` of `node` will do, in one line. */
export function promptDropHint(material, node, box) {
    const known = dragged.filename === material.filename ? dragged.envelope : null;
    const envelope = known || extractMaterialPromptEnvelope(material);
    const label = role => t(BOX_LABELS[role]);
    let hint = t('promptDropInto', { node: `#${node.id}`, box: label(box.role) });
    const other = OPPOSITE[box.role];
    if (!envelope.hasPrompt) {
        const partner = other && partnerBox(node, box.role);
        return partner ? hint + t('promptDropPartnerMaybe', { node: `#${partner.node.id}`, box: label(other), role: t(other === 'negative' ? 'recipePromptRoleNegative' : 'recipePromptRolePositive') }) : hint;
    }
    if (other && !envelope[box.role]) {
        hint += t('promptDropOnlyOther', { role: t(other === 'negative' ? 'recipePromptRoleNegative' : 'recipePromptRolePositive') });
    }
    const partner = other && envelope[box.role] && envelope[other] ? partnerBox(node, box.role) : null;
    if (partner) hint += t('promptDropPartner', { node: `#${partner.node.id}`, box: label(other) });
    return hint;
}
