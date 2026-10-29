/**
 * What a step of the AI workbench's timeline says under its title, by what it is (ui_ai_workbench.js
 * draws the row around it): the user's own steps (marks on a picture, materials, a change made in
 * Anomalous, pictures handed over, a stop, the canvas mode, a message with the pictures it
 * carries) each with whether the AI has it (ui_ai_delivery.js), a decision (ui_ai_decisions.js),
 * what happened outside Anomalous (pictures changed, the AI's own word: api/ai_outside.py), a
 * skill the AI went by (api/ai_skills.py) and, under a run, the skills fetched before it, or
 * the AI's note laid out (a long one folded until asked).
 */

import { resolveLocale, translate as t } from './locales.js';
import { skillsBefore } from './ai_task_view.js';
import { entrySummary } from './activity_log.js';
import { changeNodeId } from './activity_diff.js';
import { noteNode } from './ai_text_format.js';
import { locateNode } from './ui_ai_results.js';
import { marksStep } from './ui_ai_marker.js';
import { toolboxStep } from './ui_ai_toolbox.js';
import { canvasChanges } from './ui_canvas_changes.js';
import { deliveryState } from './ui_ai_delivery.js';
import { decisionCard } from './ui_ai_decisions.js';
import { imageResults } from './ui_ai_images.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const said = text => el('div', 'anomalous-ai-user-text', text);
const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';

/** A skill the AI fetched: its name and, for advice that goes by the model, the form it came in. */
function skillUsed(step) {
    const model = step.for_model;
    const box = el('div', 'anomalous-ai-skill-used');
    box.append(el('strong', '', words(step.title)));
    if (model) box.append(el('span', '', t(`aiSkillForm_${model.form}`, { model: model.model, billions: model.billions })));
    return box;
}
const FOLD_CHARS = 420;
const FOLD_LINES = 8;

/** The AI's note; a long one folded to its first lines, with "show all" / "show less". */
function note(text) {
    const node = noteNode(text);
    if (text.length <= FOLD_CHARS && text.split('\n').length <= FOLD_LINES) return node;
    const box = el('div', 'anomalous-ai-fold is-folded');
    const toggle = el('button', 'anomalous-ai-fold-toggle', t('aiFoldMore'));
    toggle.type = 'button';
    toggle.onclick = () => {
        const folded = box.classList.toggle('is-folded');
        toggle.textContent = t(folded ? 'aiFoldMore' : 'aiFoldLess');
    };
    box.append(node, toggle);
    return box;
}

/** The pictures a message carries ("subfolder/name.png"), as the AI's own are shown: to open, compare, keep or mark up. */
function namedPictures(step, owner) {
    const pictures = (step.refs || []).filter(ref => ref.kind === 'pictures').map((ref) => {
        const parts = ref.id.split('/');
        return { type: 'image', folder: 'output', filename: parts.pop(), subfolder: parts.join('/') };
    });
    if (!pictures.length) return [];
    const box = imageResults(pictures, owner);
    box.classList.add('is-said'); // the size of what one hands over, not of results
    return [box];
}

/** Pictures changed outside Anomalous since the AI's previous call: each named, those in the output folder shown. */
function outsideFiles(step, owner) {
    const list = el('ul', 'anomalous-ai-outside-list');
    for (const item of step.files || []) list.append(el('li', '', t(`aiOutside_${item.change}`, { name: `${item.folder}/${item.name}` })));
    if (step.more) list.append(el('li', '', t('aiOutsideMore', { count: step.more })));
    const pictures = (step.files || []).filter(item => item.folder === 'output')
        .map(item => ({ type: 'image', folder: 'output', filename: item.name, subfolder: '' }));
    const shown = pictures.length ? imageResults(pictures, owner) : null;
    shown?.classList.add('is-said');
    return [list, ...(shown ? [shown] : []), el('div', 'anomalous-ai-outside-who', t('aiOutsideWho'))];
}

/** The AI's own word on what it did with other tools. */
function outsideLog(step) {
    const box = el('dl', 'anomalous-ai-outside-log');
    for (const [key, value] of [['aiOutsideWhat', step.what], ['aiOutsideWhy', step.why], ['aiOutsideFiles', (step.files || []).join('\n')]]) {
        if (value) box.append(el('dt', '', t(key)), el('dd', '', value));
    }
    return [box];
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
    case 'outside_files': return outsideFiles(step, ctx.owner);
    case 'log_outside': return outsideLog(step);
    case 'use_skill': return [skillUsed(step)];
    case 'run_workflow': {
        const used = skillsBefore(ctx.steps, step).map(item => words(item.title));
        return [...(used.length ? [el('div', 'anomalous-ai-skill-used', t('aiRunSkills', { names: [...new Set(used)].join(' · ') }))] : []),
            ...(step.text ? [note(step.text)] : [])];
    }
    default:
        if (step.kind === 'decision') return [decisionCard(step.decision || {}, ctx.numberOf)];
        if (step.kind === 'user') return [...(step.text ? [said(step.text)] : []), ...namedPictures(step, ctx.owner), deliveryState(step)];
        return step.text ? [note(step.text)] : [];
    }
}
