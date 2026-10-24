/**
 * What an AI task made, as the side column's Results view (ui_ai_side_views.js), newest first:
 * the pictures by the step that brought them, with the gallery's tools on each (ui_ai_images.js);
 * the workflow (the task's own tab or the open canvas) and the combos it placed; the newest
 * picture's prompts; the models it used and downloaded; the sounds. What made the newest picture
 * (its whole workflow, its combo, its prompts) is kept from here as that picture's keep menu
 * keeps it (ui_keep_menu.js). Over the timeline a line counts what the task made and leads to the
 * view (drawOutputsLine); the view's button in the switch counts what came since it was last
 * seen (newOutputs). The rules are ai_task_view.js taskOutputs.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { newestPicture, outputCount, pictureKey, taskOutputs } from './ai_task_view.js';
import { imagePrompts } from './image_keep.js';
import { keepPictureAs } from './ui_keep_menu.js';
import { anomalousAlert, copyText } from './ui_dialog.js';
import { showTab } from './mcp_task_tab.js';
import { formatSize } from './ui_model_download.js';
import { imageResults } from './ui_ai_images.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { openComboNamed, openModel, playButton } from './ui_ai_results.js';
import { showStepRow } from './ui_ai_decisions.js';
import { sideHead } from './ui_ai_side.js';

const RUNS_SHOWN = 6; // steps with pictures drawn at first; the earlier ones on request
const PROMPTS_KEPT = 20;
const SAID_MS = 2000;
const prompts = new Map(); // picture key → its prompts (a promise), the latest few

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

const pictureCount = outputs => outputs.runs.reduce((sum, run) => sum + run.pictures.length, 0);

/** Where the task's workflow is: `{ tab }` its own tab, `{ tab: null }` the open canvas the AI changed; null when neither. */
function workflowOf(task, outputs) {
    const tab = task.canvas_mode !== 'current' ? task.canvas?.tab : null;
    if (tab?.path) return { tab };
    return outputs.canvas ? { tab: null } : null;
}

/** What the task made, in words ("8 pictures", "a workflow"…), only what it has. */
function countWords(task, outputs) {
    const models = outputs.models.length + outputs.downloads.length;
    return [
        pictureCount(outputs) && t('aiOutPictures', { count: pictureCount(outputs) }),
        workflowOf(task, outputs) && t('aiOutWorkflow'),
        outputs.combos.length && t('aiOutCombos', { count: outputs.combos.length }),
        models && t('aiOutModels', { count: models }),
        outputs.audio.length && t('aiOutSounds', { count: outputs.audio.length }),
    ].filter(Boolean);
}

/**
 * How many things the task made since the Results view was last seen (`shown`: it is on screen
 * now, so everything is seen); what a task had when it was opened is not new.
 */
export function newOutputs(side, task, shown) {
    const count = outputCount(taskOutputs(task));
    if (shown || side.outputsSeen === null || side.outputsSeen === undefined) side.outputsSeen = count;
    return Math.max(0, count - side.outputsSeen);
}

/** The line over the timeline into `holder`: what the task made, counted, and `open()` to the view; empty while it made nothing. */
export function drawOutputsLine(holder, task, open) {
    const words = countWords(task, taskOutputs(task));
    const key = JSON.stringify(words);
    if (holder.dataset.key === key) return;
    holder.dataset.key = key;
    if (!words.length) {
        holder.replaceChildren();
        return;
    }
    const line = el('div', 'anomalous-ai-out-line');
    line.append(icon('tray', 16, 'anomalous-ai-out-line-icon'), el('span', 'anomalous-ai-out-line-words', t('aiOutLine', { what: words.join(' · ') })),
        iconButton('anomalous-ai-side-open', 'sidebar', t('aiOutSee'), open, { size: 14 }));
    holder.replaceChildren(line);
}

function section(name, title, ...more) {
    const box = el('section', 'anomalous-ai-out-part');
    const head = el('div', 'anomalous-ai-out-head');
    head.append(icon(name, 15), el('span', 'anomalous-ai-out-title', title), ...more);
    box.append(head);
    return box;
}

/** Keeps what made the newest picture as `kind`, as the picture's keep menu does (a toast says where it went). */
function keepButton(ctx, kind, name, picture) {
    const node = iconButton('anomalous-ai-link', name, t(`aiOutKeep_${kind}`), async () => {
        node.disabled = true;
        try {
            await keepPictureAs(ctx.owner, kind, picture);
        } finally {
            node.disabled = false;
        }
    }, { size: 14, title: t(`aiOutKeepTip_${kind}`) });
    return node;
}

/** A step's pictures, headed by its number and time (a way back to it in the timeline); groups sit side by side. */
function runGroup(run, ctx) {
    const group = el('div', 'anomalous-ai-out-group');
    group.append(button('anomalous-ai-out-run', t('aiOutRun', { number: ctx.numberOf(run.step.id), time: timeLabel(run.step.at) }),
        () => showStepRow(run.step.id), t('aiOutRunShow')), imageResults(run.pictures, ctx.owner, { compact: true }));
    return group;
}

function picturesPart(outputs, ctx) {
    if (!outputs.runs.length) return null;
    const count = pictureCount(outputs);
    const box = section('image', t('aiOutPicturesTitle'), el('span', 'anomalous-ai-out-count', count));
    if (count > 1) box.firstChild.append(el('span', 'anomalous-ai-out-hint', t('aiTickHint')));
    const groups = el('div', 'anomalous-ai-out-groups');
    box.append(groups);
    const draw = runs => groups.append(...runs.map(run => runGroup(run, ctx)));
    draw(outputs.runs.slice(0, RUNS_SHOWN));
    const earlier = outputs.runs.slice(RUNS_SHOWN);
    if (earlier.length) {
        const more = button('anomalous-ai-link anomalous-ai-out-more', t('aiOutEarlier', { count: earlier.length }), () => {
            more.remove();
            draw(earlier);
        });
        box.append(more);
    }
    return box;
}

function workflowPart(where, outputs, newest, ctx) {
    if (!where && !newest) return null;
    const box = section('workflows', t('aiOutWorkflowTitle'));
    const card = el('div', 'anomalous-ai-out-card');
    const words = el('div', 'anomalous-ai-out-words');
    words.append(el('span', 'anomalous-ai-out-name', where?.tab ? t('aiOutTab', { name: where.tab.name }) : t(where ? 'aiOutCanvas' : 'aiOutRunWorkflow')));
    if (outputs.canvas) words.append(el('span', 'anomalous-ai-out-sub', t('aiOutChanges', { count: outputs.canvas })));
    card.append(icon('workflows', 18, 'anomalous-ai-out-icon'), words);
    const tools = el('div', 'anomalous-ai-links');
    if (where) {
        tools.append(iconButton('anomalous-ai-link', 'target', t('aiOutOpenCanvas'), async () => {
            if (where.tab && !await showTab(where.tab.path)) await anomalousAlert(t('aiCanvasGone', { name: where.tab.name }));
            else ctx.showCanvas();
        }, { size: 14 }));
    }
    if (newest) tools.append(keepButton(ctx, 'recipe', 'workflows', newest));
    box.append(card);
    if (tools.childNodes.length) box.append(tools);
    if (!newest) box.append(el('div', 'anomalous-ai-out-note', t('aiOutNeedPicture')));
    return box;
}

function combosPart(outputs, newest, ctx) {
    if (!outputs.combos.length && !newest) return null;
    const box = section('combos', t('aiOutCombosTitle'));
    const chips = el('div', 'anomalous-ai-links');
    for (const combo of outputs.combos) chips.append(button('anomalous-ai-chip is-combo', combo.name, () => openComboNamed(combo.name), t('aiOpenCombo')));
    if (newest) chips.append(keepButton(ctx, 'combo', 'plus', newest));
    box.append(chips);
    return box;
}

/** A picture's prompts, read once (the latest few kept; a failed read is tried again next time). */
function promptsOf(picture) {
    const key = pictureKey(picture);
    if (!prompts.has(key)) {
        prompts.set(key, imagePrompts(picture).catch((error) => {
            prompts.delete(key);
            throw error;
        }));
        if (prompts.size > PROMPTS_KEPT) prompts.delete(prompts.keys().next().value);
    }
    return prompts.get(key);
}

function promptBox(role, text) {
    const box = el('div', `anomalous-ai-out-prompt is-${role}`);
    const head = el('div', 'anomalous-ai-out-prompt-head');
    const copy = iconButton('anomalous-ai-out-copy', 'copy', t('aiOutCopy'), async () => {
        copy.lastChild.textContent = t(await copyText(text) ? 'aiOutCopied' : 'aiOutNotCopied');
        setTimeout(() => { copy.lastChild.textContent = t('aiOutCopy'); }, SAID_MS);
    }, { size: 13 });
    head.append(el('span', 'anomalous-ai-out-role', t(role === 'positive' ? 'aiOutPositive' : 'aiOutNegative')), copy);
    const words = el('div', 'anomalous-ai-out-prompt-text', text);
    words.title = text;
    box.append(head, words);
    return box;
}

function promptsPart(picture, ctx) {
    const box = section('prompts', t('aiOutPromptTitle'), el('span', 'anomalous-ai-out-hint', t('aiOutPromptOf')));
    const holder = el('div', 'anomalous-ai-out-prompts', t('loading'));
    box.append(holder);
    promptsOf(picture).then(({ positive, negative }) => {
        const parts = [['positive', positive], ['negative', negative]].filter(([, text]) => text.trim());
        if (!parts.length) { // a workflow without prompts (an upscale, a copy): nothing to show
            box.remove();
            return;
        }
        holder.replaceChildren(...parts.map(([role, text]) => promptBox(role, text)));
        const tools = el('div', 'anomalous-ai-links');
        tools.append(keepButton(ctx, 'prompt', 'prompts', picture));
        box.append(tools);
    }, (error) => {
        console.warn('[AMB] Could not read the newest picture\'s prompts:', error);
        holder.textContent = t('aiOutPromptNone');
    });
    return box;
}

function modelsPart(outputs) {
    if (!outputs.models.length && !outputs.downloads.length) return null;
    const box = section('models', t('aiOutModelsTitle'));
    const chips = el('div', 'anomalous-ai-links');
    for (const item of outputs.downloads) {
        const chip = el('span', 'anomalous-ai-chip is-download');
        chip.title = [item.name, item.file].filter(Boolean).join('\n');
        chip.append(el('span', 'anomalous-ai-out-new', t('aiOutDownloadRequested')), el('span', 'anomalous-ai-out-chip-name', item.file));
        if (item.size) chip.append(el('span', 'anomalous-ai-out-size', formatSize(item.size)));
        chips.append(chip);
    }
    for (const model of outputs.models) {
        const chip = button('anomalous-ai-chip is-model', model.name || model.model_id, () => openModel(model), t('aiOpenModel'));
        chip.disabled = !model.rel;
        chips.append(chip);
    }
    box.append(chips);
    return box;
}

function soundsPart(outputs) {
    if (!outputs.audio.length) return null;
    const box = section('pulse', t('aiOutSoundsTitle'));
    const chips = el('div', 'anomalous-ai-links');
    for (const result of outputs.audio) {
        const chip = el('span', 'anomalous-ai-chip is-audio');
        chip.append(playButton(result), el('span', '', result.file.split('/').pop()));
        chips.append(chip);
    }
    box.append(chips);
    return box;
}

/**
 * What `task` made into `pane`. `ctx`: {owner, numberOf(stepId), close(), showCanvas()}. Drawn
 * again only when that changed, so the view stays where it was scrolled while the AI works.
 */
export function renderOutputsView(pane, task, ctx) {
    const outputs = taskOutputs(task);
    const where = workflowOf(task, outputs);
    const key = JSON.stringify([task.id, outputs.runs.map(run => [run.step.id, ctx.numberOf(run.step.id), run.pictures]),
        outputs.combos, outputs.models, outputs.downloads, outputs.audio, outputs.canvas, where]);
    if (pane.dataset.key === key) return;
    pane.dataset.key = key;
    const newest = newestPicture(outputs);
    const parts = [picturesPart(outputs, ctx), workflowPart(where, outputs, newest, ctx), combosPart(outputs, newest, ctx),
        newest && promptsPart(newest, ctx), modelsPart(outputs), soundsPart(outputs)].filter(Boolean);
    const body = el('div', 'anomalous-ai-stage-body anomalous-ai-outputs');
    body.append(...(parts.length ? parts : [el('div', 'anomalous-ai-stage-empty', t('aiOutNone'))]));
    pane.replaceChildren(sideHead(t('aiSideOutputs'), ctx.close), body);
}
