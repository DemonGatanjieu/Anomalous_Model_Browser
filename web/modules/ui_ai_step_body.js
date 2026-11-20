/**
 * What a step of the AI workbench's timeline says under its title, by what it is, and the timeline
 * row itself (`drawStepRow`): the user's own steps (marks on a picture, materials, a change made in
 * Anomalous, pictures handed over, a stop, the canvas mode, privacy mode, their word on a run, a message
 * with the pictures it carries) each with whether the AI has it (ui_ai_delivery.js), a decision (ui_ai_decisions.js),
 * what happened outside Anomalous (pictures changed, the AI's own word: api/ai_outside.py), a
 * skill the AI went by (api/ai_skills.py) and, under a run, the skills fetched before it, or
 * the AI's note laid out (a long one folded until asked). What was hidden from the AI shows veiled, the tokens in
 * the AI's notes as what they stand for (ui_ai_sealed_veil.js).
 */

import { resolveLocale, translate as t } from './locales.js';
import { wayTitle } from './ai_toolbox_data.js';
import { modelStem } from './ai_start_from.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { duration, skillsBefore, stepDetail, toolKey } from './ai_task_view.js';
import { entrySummary, timeLabel } from './activity_log.js';
import { changeNodeId } from './activity_diff.js';
import { noteNode } from './ai_text_format.js';
import { locateNode, resultLinks } from './ui_ai_results.js';
import { marksStep } from './ui_ai_marker.js';
import { standinStep } from './ui_ai_released.js';
import { toolboxStep } from './ui_ai_toolbox_step.js';
import { canvasChanges } from './ui_canvas_changes.js';
import { deliveryState } from './ui_ai_delivery.js';
import { decisionCard } from './ui_ai_decisions.js';
import { imageResults } from './ui_ai_images.js';
import { renderHiddenText, sealedParts } from './ai_hide_mark.js';
import { tokensAsWords } from './ui_ai_sealed_veil.js';
import { gateCard } from './ui_ai_gate.js';
import { panelLine } from './ui_ai_side.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const said = text => el('div', 'anomalous-ai-user-text', text);
const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';
const REF_ICON = { packs: 'nodes', ways: 'blocks' };

function refLabel(ref, locale) {
    const titled = ref.kind === 'ways' ? wayTitle(ref.id, locale) : '';
    return titled && titled !== ref.id ? titled : (ref.label || ref.id);
}

/** Non-picture refs carried by a user message, with each ref's optional user note beside its name. */
function namedRefs(refs, sealed) {
    const row = el('div', 'anomalous-tb-chips is-static anomalous-ai-step-refs');
    const locale = resolveLocale();
    for (const ref of refs) {
        const chip = el('span', `anomalous-tb-chip is-${ref.kind}`);
        chip.append(icon(REF_ICON[ref.kind] || ref.kind, 13), el('span', 'anomalous-tb-chip-name', refLabel(ref, locale)));
        if (ref.note) {
            const noteNode = el('span', 'anomalous-ai-step-ref-note');
            noteNode.append(renderHiddenText(ref.note, sealed, { lockIcon: () => icon('lock', 10), veil: true }));
            chip.append(noteNode);
        }
        row.append(chip);
    }
    return row;
}

const TOKEN = /(\[(?:P|M|img)\d+\])/;
const RECEIVED_FOLD = 160; // longer than this, what the AI got shows its first lines until asked

/** `text` as the AI got it: each hidden part as the token sent in its place. */
const sentText = (text, sealed) => sealedParts(text, sealed)
    .map(part => (part.type === 'sealed' ? part.token || '[P]' : part.value)).join('');

/** Under a message with hidden words: what the AI got, the tokens marked, so the two read side by side. */
function receivedLine(text) {
    const line = el('div', 'anomalous-ai-received');
    const body = el('span', 'anomalous-ai-received-text');
    for (const part of text.split(TOKEN).filter(Boolean)) {
        body.append(TOKEN.test(part) ? el('code', 'anomalous-ai-sealed-token', part) : document.createTextNode(part));
    }
    line.append(el('span', 'anomalous-ai-received-label', t('aiSealedReceived')), body);
    if (text.length > RECEIVED_FOLD) {
        line.classList.add('is-folded');
        const toggle = el('button', 'anomalous-ai-fold-toggle', t('aiFoldMore'));
        toggle.type = 'button';
        toggle.onclick = () => {
            const folded = line.classList.toggle('is-folded');
            toggle.textContent = t(folded ? 'aiFoldMore' : 'aiFoldLess');
        };
        line.append(toggle);
    }
    return line;
}

const modelToken = (modelId, sealed) => Object.entries(sealed || {})
    .find(([token, value]) => token.startsWith('[M') && value === modelId)?.[0] || '';

function routeStep(step, ctx) {
    const models = step.models || [];
    const [a, b] = models.map(modelStem);
    const bubble = said(t(`aiRoute_${step.route}`, { a: a || '', b: b || '' }));
    if (!ctx.privateTask) return [bubble, deliveryState(step)];
    const [ta, tb] = models.map(id => modelToken(id, ctx.sealed));
    if (ta || tb) return [bubble, receivedLine(t(`aiRoute_${step.route}`, { a: ta || a || '', b: tb || b || '' })), deliveryState(step)];
    if (ctx.privacyModels !== false) {
        const pending = el('div', 'anomalous-ai-sealed-bar');
        pending.append(icon('lock', 12), el('span', '', t('aiSealedRoutePending')));
        return [bubble, pending, deliveryState(step)];
    }
    return [bubble, deliveryState(step)];
}

function userMessageStep(step, ctx) {
    const sealed = ctx.sealed;
    const refs = (step.refs || []).filter(ref => ref.kind !== 'pictures');
    const hides = text => sealedParts(text, sealed).some(part => part.type === 'sealed');
    const bubble = step.text ? el('div', 'anomalous-ai-user-text') : null;
    bubble?.append(renderHiddenText(step.text, sealed, { lockIcon: () => icon('lock', 11), veil: true }));
    const hiddenNotes = refs.filter(ref => hides(ref.note));
    const received = hides(step.text) || hiddenNotes.length ? receivedLine([
        ...(step.text ? [sentText(step.text, sealed)] : []),
        ...hiddenNotes.map(ref => t('aiSealedNoteOf', { name: refLabel(ref, resolveLocale()) }) + sentText(ref.note, sealed)),
    ].join('\n')) : null;
    return [...(bubble ? [bubble] : []), ...(refs.length ? [namedRefs(refs, sealed)] : []),
        ...(received ? [received] : []), ...namedPictures(step, ctx.owner), deliveryState(step)];
}

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

/** The AI's note, its tokens as what they stand for (`sealed`); a long one folded to its first lines, with "show all" / "show less". */
function note(text, sealed) {
    const node = tokensAsWords(noteNode(text), sealed);
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

/** The nodes under step `step`'s title. `ctx`: {taskId, owner, entries (activity entries by id), numberOf(stepId), sealed (the task's texts behind its tokens)}. */
export function stepBody(step, ctx) {
    switch (step.tool) {
    case 'user_marks': return [marksStep(step, ctx.taskId, ctx.owner)];
    case 'user_standin': return [standinStep(step, ctx.taskId, ctx.owner)];
    case 'user_toolbox': return [toolboxStep(step)];
    case 'user_route': return routeStep(step, ctx);
    case 'user_activity': return [userChange(step, ctx.entries)];
    case 'user_pictures': return [said(step.text || t('aiPicturesStep', { count: (step.results || []).length })), deliveryState(step, 'aiPicturesSeen')];
    case 'user_stop': return [said(t('aiRunStoppedByYou')), deliveryState(step)];
    case 'user_halt': return [said(t(step.pause ? 'aiPausedByYou' : 'aiHaltedByYou')), deliveryState(step)];
    case 'user_canvas': return [said(t(step.canvas === 'new' ? 'aiCanvasChoseNew' : 'aiCanvasChoseCurrent')), deliveryState(step)];
    case 'user_privacy': return [said(t(step.privacy ? 'aiPrivacyChoseOn' : 'aiPrivacyChoseOff')), deliveryState(step)];
    case 'outside_files': return outsideFiles(step, ctx.owner);
    case 'log_outside': return outsideLog(step);
    case 'user_verdict': return [said(t(`aiVerdictSaid_${step.verdict}`) + (step.issues?.length
        ? t('aiIssuesSaid', { issues: step.issues.map(name => t(`aiIssue_${name}`)).join(t('aiIssueJoin')) }) : '')), deliveryState(step)];
    case 'use_skill': return [skillUsed(step)];
    case 'run_workflow': {
        const used = skillsBefore(ctx.steps, step).map(item => words(item.title));
        return [...(used.length ? [el('div', 'anomalous-ai-skill-used', t('aiRunSkills', { names: [...new Set(used)].join(' · ') }))] : []),
            ...(step.text ? [note(step.text, ctx.sealed)] : [])];
    }
    default:
        if (step.kind === 'decision') return [decisionCard(step.decision || {}, ctx.numberOf)];
        if (step.kind === 'user') return userMessageStep(step, ctx);
        return step.text ? [note(step.text, ctx.sealed)] : [];
    }
}

/** One step row of the timeline; `number` is its place in the task (the dot shows it). */
export function drawStepRow(step, number, ctx) {
    const running = step.state === 'running';
    const row = el('div', `anomalous-ai-step is-${step.kind}${step.ok ? '' : ' is-failed'}${running ? ' is-running' : ''}${step.state === 'asking' ? ' is-asking' : ''}`);
    row.dataset.stepIds = step.id;
    row.append(el('span', 'anomalous-ai-step-dot', number));
    const body = el('div', 'anomalous-ai-step-body');
    const line = el('div', 'anomalous-ai-step-line');
    line.append(el('span', 'anomalous-ai-kind', t(`aiKind_${step.kind}`)), el('span', 'anomalous-ai-step-title', t(step.pause ? 'aiTool_user_pause' : toolKey(step.tool))));
    const detail = ['panel', 'outside'].includes(step.kind) || step.tool === 'user_activity' ? '' : stepDetail(step); // their body says it
    const { task } = ctx;
    if (detail) {
        const text = el('span', 'anomalous-ai-step-detail', detail);
        text.title = detail;
        line.append(tokensAsWords(text, task?.sealed));
    }
    body.append(line, ...stepBody(step, { taskId: task?.id, owner: ctx.owner, entries: ctx.entries, numberOf: ctx.numberOf,
        steps: task?.steps, sealed: task?.sealed, privateTask: task?.private === true, privacyModels: task?.privacy_models !== false }));
    const other = step.reply_to || step.replied;
    if (other) {
        body.append(iconButton(`anomalous-ai-reply-link${step.replied ? ' is-replied' : ''}`, step.replied ? 'chat' : 'undo',
            t(step.replied ? 'aiReplied' : 'aiReplyTo', { number: ctx.numberOf(other) ?? '' }), () => ctx.showStep(other)));
    }
    if (step.kind === 'panel' && task) body.append(panelLine(step, () => ctx.showOnStage(step.panel.id)));
    const gate = task && gateCard(step, task.id, ctx.refresh);
    if (gate) body.append(gate);
    if (step.error && !gate) body.append(el('div', 'anomalous-ai-step-error', step.error));
    if (step.state === 'cancelled') body.append(el('div', 'anomalous-ai-step-cancelled', t(step.stop === 'user' ? 'aiRunCancelledByYou' : 'aiRunCancelledByAi')));
    if (running && step.kind !== 'run') body.append(el('div', 'anomalous-ai-step-running', t('aiStepRunning')));
    const links = resultLinks(step, ctx.redraw);
    if (links) body.append(links);
    const when = el('div', 'anomalous-ai-step-when');
    when.append(el('span', '', timeLabel(step.at)));
    const took = duration(step.ms);
    if (took) when.append(el('span', '', t(took.key, took.values)));
    row.append(body, when);
    return row;
}

/** Brings a step's row into view (from the flow), marked for a moment; a folded chain opens to it. */
export function scrollToStep(timeline, stepId) {
    const has = item => item.dataset.stepIds.split(' ').includes(stepId);
    const chain = [...timeline.children].find(has);
    chain?.reveal?.();
    const row = [...timeline.querySelectorAll('[data-step-ids]')].findLast(has);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1600);
}
