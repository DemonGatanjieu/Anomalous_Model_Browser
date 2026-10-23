/**
 * What a step of the AI workbench's timeline says under its title, by what it is (ui_ai_workbench.js
 * draws the row around it): the user's own steps (marks on a picture, materials, a change made in
 * Anomalous, pictures handed over, a stop, the canvas mode, a message with the pictures its "@"
 * name) each with whether the AI has it (ui_ai_delivery.js), a decision (ui_ai_decisions.js), or
 * the AI's note laid out.
 */

import { translate as t } from './locales.js';
import { entrySummary } from './activity_log.js';
import { changeNodeId } from './activity_diff.js';
import { noteNode } from './ai_text_format.js';
import { locateNode } from './ui_ai_results.js';
import { marksStep } from './ui_ai_marker.js';
import { toolboxStep } from './ui_ai_toolbox.js';
import { canvasChanges } from './ui_canvas_changes.js';
import { deliveryState } from './ui_ai_delivery.js';
import { decisionCard } from './ui_ai_decisions.js';
import { thumbUrl } from './ui_ai_gallery_pick.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const said = text => el('div', 'anomalous-ai-user-text', text);

/** The pictures a message's "@" name, small ("subfolder/name.png"; a deleted one is left out). */
function namedPictures(step) {
    const pictures = (step.refs || []).filter(ref => ref.kind === 'pictures');
    if (!pictures.length) return [];
    const strip = el('div', 'anomalous-ai-user-pictures');
    for (const ref of pictures) {
        const parts = ref.id.split('/');
        const img = el('img');
        img.src = thumbUrl({ filename: parts.pop(), subfolder: parts.join('/') });
        img.alt = '';
        img.title = ref.id;
        img.loading = 'lazy';
        img.onerror = () => img.remove();
        strip.append(img);
    }
    return [strip];
}

/** A change the user made in Anomalous while the AI worked (an activity entry), and whether the AI knows. */
function userChange(step, entries) {
    const box = el('div', 'anomalous-ai-user-change');
    const entry = entries.get(step.activity);
    box.append(said(entry ? entrySummary(entry) : step.text));
    if (entry?.source === 'canvas') {
        const note = el('span', 'anomalous-ai-link-note');
        box.append(canvasChanges(entry, { locate: change => locateNode(changeNodeId(change), note) }), note);
    }
    box.append(deliveryState(step, 'aiChangeSeen', 'aiChangeWaiting'));
    return box;
}

/** The nodes under step `step`'s title. `ctx`: {taskId, owner, entries (activity entries by id), numberOf(stepId)}. */
export function stepBody(step, ctx) {
    switch (step.tool) {
    case 'user_marks': return [marksStep(step, ctx.taskId, ctx.owner)];
    case 'user_toolbox': return [toolboxStep(step)];
    case 'user_activity': return [userChange(step, ctx.entries)];
    case 'user_pictures': return [said(step.text || t('aiPicturesStep', { count: (step.results || []).length })), deliveryState(step, 'aiPicturesSeen')];
    case 'user_stop': return [said(t('aiRunStoppedByYou')), deliveryState(step)];
    case 'user_canvas': return [said(t(step.canvas === 'new' ? 'aiCanvasChoseNew' : 'aiCanvasChoseCurrent')), deliveryState(step)];
    default:
        if (step.kind === 'decision') return [decisionCard(step.decision || {}, ctx.numberOf)];
        if (step.kind === 'user') return [said(step.text), ...namedPictures(step), deliveryState(step)];
        return step.text ? [noteNode(step.text)] : [];
    }
}
