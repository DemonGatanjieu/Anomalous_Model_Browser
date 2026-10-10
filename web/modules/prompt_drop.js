/**
 * What dropping a dragged prompt on the canvas would do (prompt_card_drag.js drags Prompt
 * Studio's cards). While it is dragged, every prompt box on the canvas is outlined in its
 * role's colour; the box under the pointer is the target (or a node's only box), the hint
 * says what releasing writes where, including the opposite-role box on the same sampler, and
 * those boxes show the new text over their own until the pointer leaves. prompt_boxes.js
 * decides boxes and roles.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { getCanvasPosition } from './material_drag.js';
import { extractMaterialPromptEnvelope } from './node_material_actions.js';
import { partnerBox, planPromptFill, promptBoxes } from './prompt_boxes.js';

const ROLE_CLASSES = { positive: 'is-positive', negative: 'is-negative', both: 'is-both', '': 'is-unknown' };
const BOX_LABELS = { positive: 'promptBoxPositive', negative: 'promptBoxNegative', both: 'promptBoxBoth', '': 'promptBoxPlain' };
const OPPOSITE = { positive: 'negative', negative: 'positive' };
// The dragged prompt's text, known when its drag starts.
let dragged = { filename: '', envelope: null };
let previews = []; // { overlay, element } over the boxes a release would write
let previewKey = '';

/** A drag whose text is known already (a Prompt Studio card, keyed `key`). */
export function prepareTextDrag(key, envelope) {
    dragged = { filename: key, envelope };
}

const known = material => (dragged.filename === material.filename ? dragged : null);

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
    const envelope = known(material)?.envelope || extractMaterialPromptEnvelope(material);
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

/** Removes the previews (the drag ended, or the pointer left the box). */
export function clearDropPreview() {
    for (const { overlay, element } of previews) {
        overlay.remove();
        element.classList.remove('is-previewing');
    }
    previews = [];
    previewKey = '';
}

/** Shows, over `box` of `node` and its partner box, the text a release would write; no box clears. */
export function previewPromptDrop(material, node, box) {
    const envelope = known(material)?.envelope;
    const targets = [];
    if (node && box && envelope?.hasPrompt) {
        targets.push([node, box]);
        const other = OPPOSITE[box.role];
        const partner = other && envelope[box.role] && envelope[other] ? partnerBox(node, box.role) : null;
        if (partner) targets.push([partner.node, partner.box]);
    }
    const key = targets.map(([target, item]) => `${target.id}:${item.index}`).join('|');
    if (key === previewKey) return;
    clearDropPreview();
    previewKey = key;
    for (const [target, item] of targets) {
        const [entry] = planPromptFill(target, envelope, item);
        const element = item.widget.element;
        const rect = element?.getBoundingClientRect();
        if (!entry || !rect?.width || !rect.height) continue; // a box not laid out shows nothing
        const overlay = document.createElement('div');
        overlay.className = `anomalous-prompt-preview ${ROLE_CLASSES[item.role]}`;
        // The canvas zoom scales the box; the text follows it, down to a readable size.
        const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
        Object.assign(overlay.style, {
            left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
            fontSize: `${Math.max(11, parseFloat(getComputedStyle(element).fontSize) * scale)}px`, // readable when zoomed out
        });
        const tag = document.createElement('span');
        tag.className = 'anomalous-prompt-preview-tag';
        tag.textContent = t('promptPreviewTag');
        const body = document.createElement('div');
        body.className = 'anomalous-prompt-preview-text';
        body.textContent = entry.value;
        overlay.append(tag, body);
        document.body.appendChild(overlay);
        element.classList.add('is-previewing');
        previews.push({ overlay, element });
    }
}
