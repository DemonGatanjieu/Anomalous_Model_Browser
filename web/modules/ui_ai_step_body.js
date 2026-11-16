/**
 * What a step of the AI workbench's timeline says under its title, by what it is (ui_ai_workbench.js
 * draws the row around it): the user's own steps (marks on a picture, materials, a change made in
 * Anomalous, pictures handed over, a stop, the canvas mode, privacy mode, their word on a run, a message
 * with the pictures it carries) each with whether the AI has it (ui_ai_delivery.js), a decision (ui_ai_decisions.js),
 * what happened outside Anomalous (pictures changed, the AI's own word: api/ai_outside.py), a
 * skill the AI went by (api/ai_skills.py) and, under a run, the skills fetched before it, or
 * the AI's note laid out (a long one folded until asked).
 */

import { resolveLocale, translate as t } from './locales.js';
import { wayTitle } from './ai_toolbox_data.js';
import { modelStem } from './ai_start_from.js';
import { icon } from './ui_ai_icons.js';
import { skillsBefore } from './ai_task_view.js';
import { entrySummary } from './activity_log.js';
import { changeNodeId } from './activity_diff.js';
import { noteNode } from './ai_text_format.js';
import { locateNode } from './ui_ai_results.js';
import { marksStep } from './ui_ai_marker.js';
import { toolboxStep } from './ui_ai_toolbox_step.js';
import { canvasChanges } from './ui_canvas_changes.js';
import { deliveryState } from './ui_ai_delivery.js';
import { decisionCard } from './ui_ai_decisions.js';
import { imageResults } from './ui_ai_images.js';
import { renderHiddenText, sealedParts } from './ai_hide_mark.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const said = text => el('div', 'anomalous-ai-user-text', text);
const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';
const REF_ICON = { packs: 'nodes', ways: 'blocks' };

/** Non-picture refs carried by a user message, with each ref's optional user note beside its name. */
function namedRefs(step, sealed, masked = false) {
    const refs = (step.refs || []).filter(ref => ref.kind !== 'pictures');
    if (!refs.length) return [];
    const row = el('div', 'anomalous-tb-chips is-static anomalous-ai-step-refs');
    const locale = resolveLocale();
    for (const ref of refs) {
        const chip = el('span', `anomalous-tb-chip is-${ref.kind}`);
        const titled = ref.kind === 'ways' ? wayTitle(ref.id, locale) : '';
        const label = titled && titled !== ref.id ? titled : (ref.label || ref.id);
        chip.append(icon(REF_ICON[ref.kind] || ref.kind, 13), el('span', 'anomalous-tb-chip-name', label));
        if (ref.note) {
            const noteNode = el('span', 'anomalous-ai-step-ref-note');
            noteNode.append(renderHiddenText(ref.note, sealed, { masked, lockIcon: () => icon('lock', 10) }));
            chip.append(noteNode);
        }
        row.append(chip);
    }
    return [row];
}

function sealedNoteBar(label, onToggle) {
    const bar = el('div', 'anomalous-ai-sealed-bar');
    bar.append(icon('lock', 12), el('span', 'anomalous-ai-sealed-bar-text', label));
    if (onToggle) {
        const btn = el('button', 'anomalous-ai-sealed-toggle', t('aiSealedViewAi'));
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
        btn.onclick = () => {
            const masked = btn.getAttribute('aria-pressed') !== 'true';
            btn.setAttribute('aria-pressed', String(masked));
            btn.textContent = t(masked ? 'aiSealedViewMine' : 'aiSealedViewAi');
            onToggle(masked);
        };
        bar.append(btn);
    }
    return bar;
}

const modelToken = (modelId, sealed) => Object.entries(sealed || {})
    .find(([token, value]) => token.startsWith('[M') && value === modelId)?.[0] || '';

function routeStep(step, ctx) {
    const models = step.models || [];
    const [a, b] = models.map(modelStem);
    const bubble = said(t(`aiRoute_${step.route}`, { a: a || '', b: b || '' }));
    if (!ctx.privateTask) return [bubble, deliveryState(step)];
    const tokens = models.map(id => modelToken(id, ctx.sealed)).filter(Boolean);
    if (tokens.length) {
        const bar = sealedNoteBar(t('aiSealedRouteNote', { tokens: tokens.join(t('listSeparator')) }), (masked) => {
            const [ma, mb] = models.map((id, at) => (masked ? (modelToken(id, ctx.sealed) || (at ? b : a)) : (at ? b : a)));
            bubble.textContent = t(`aiRoute_${step.route}`, { a: ma || '', b: mb || '' });
        });
        return [bubble, bar, deliveryState(step)];
    }
    if (ctx.privacyModels !== false) return [bubble, sealedNoteBar(t('aiSealedRoutePending')), deliveryState(step)];
    return [bubble, deliveryState(step)];
}

function userMessageStep(step, ctx) {
    const sealed = ctx.sealed;
    const refs = (step.refs || []).filter(ref => ref.kind !== 'pictures');
    const tokens = [...sealedParts(step.text, sealed), ...refs.flatMap(ref => sealedParts(ref.note, sealed))]
        .filter(part => part.type === 'sealed');
    const bubble = step.text ? el('div', 'anomalous-ai-user-text') : null;
    let refsHolder = refs.length ? el('div', 'anomalous-ai-step-refs-wrap') : null;
    const draw = (masked) => {
        if (bubble) bubble.replaceChildren(renderHiddenText(step.text, sealed, { masked, lockIcon: () => icon('lock', 11) }));
        if (refsHolder) refsHolder.replaceChildren(...namedRefs(step, sealed, masked));
    };
    draw(false);
    const bar = tokens.length ? sealedNoteBar(t('aiSealedMessageNote', {
        tokens: [...new Set(tokens.map(part => part.token || t('aiPrivacy')))].join(t('listSeparator')),
    }), draw) : null;
    return [...(bubble ? [bubble] : []), ...(refsHolder ? [refsHolder] : []),
        ...namedPictures(step, ctx.owner), ...(bar ? [bar] : []), deliveryState(step)];
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

/** The nodes under step `step`'s title. `ctx`: {taskId, owner, entries (activity entries by id), numberOf(stepId), sealed (the task's texts behind its tokens)}. */
export function stepBody(step, ctx) {
    switch (step.tool) {
    case 'user_marks': return [marksStep(step, ctx.taskId, ctx.owner)];
    case 'user_toolbox': return [toolboxStep(step)];
    case 'user_route': return routeStep(step, ctx);
    case 'user_activity': return [userChange(step, ctx.entries)];
    case 'user_pictures': return [said(step.text || t('aiPicturesStep', { count: (step.results || []).length })), deliveryState(step, 'aiPicturesSeen')];
    case 'user_stop': return [said(t('aiRunStoppedByYou')), deliveryState(step)];
    case 'user_halt': return [said(t('aiHaltedByYou')), deliveryState(step)];
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
            ...(step.text ? [note(step.text)] : [])];
    }
    default:
        if (step.kind === 'decision') return [decisionCard(step.decision || {}, ctx.numberOf)];
        if (step.kind === 'user') return userMessageStep(step, ctx);
        return step.text ? [note(step.text)] : [];
    }
}
