/**
 * The steps of the "Run my preset" sheet (ui_ai_starter_sheet.js opens it, ui_ai_start_steps.js steps it):
 * which saved workflow (a card grid; running what is on the canvas, a few versions together, is the Saves
 * page's job, and a strip over the grid goes there), the presets as chips that a press lines up to run, each
 * so many times, then what to change this time. With nothing to change Anomalous
 * runs the list itself (preset_runs.js), no AI app needed, and keeps the list in this
 * browser: the home page's line runs it again with one press (againLine). With a change the list goes to
 * an AI as a task and a message; in privacy mode the names in it (the workflow's and each preset's, a
 * token each) and a prompt of the user's go marked to hide (ai_hide_mark.js), so the AI gets tokens.
 */

import { marked } from './ai_hide_mark.js';
import { translate as t } from './locales.js';
import { MAX_EACH, MAX_TOTAL, OWN, still, toggled, total, withTimes } from './preset_run_list.js';
import { runPresets } from './preset_runs.js';
import { startTask } from './ui_ai_handoff.js';
import { icon } from './ui_ai_icons.js';
import { anomalousAlert } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { PAGE_ICONS } from './ui_shell_rail.js';
import { savesFromHome } from './ui_snapshot_bar.js';
import { workflowCardGrid } from './ui_workflow_pick.js';

const KEY = 'anomalous_ai_preset_last';
const MAX_NOTE = 2000; // a message to the AI (api/ai_panels.py MAX_MESSAGE)
const MAX_HIDDEN = 1200;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function field(label, ...controls) {
    const box = el('div', 'anomalous-ai-start-field');
    box.append(el('span', 'anomalous-ai-start-label', label), ...controls);
    return box;
}

function check(label, on = false) {
    const box = el('label', 'anomalous-ai-preset-check');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = on;
    box.append(input, el('span', '', label));
    return { box, input };
}

function kept(workflows) {
    try {
        return still(JSON.parse(localStorage.getItem(KEY) || 'null'), workflows);
    } catch (_) {
        return null;
    }
}

function keep(run) {
    try { localStorage.setItem(KEY, JSON.stringify(run)); } catch (_) { /* a browser that keeps nothing: no "the same again" */ }
}

/** `picks` with the name each shows by. */
function named(workflow, picks) {
    return picks.map(pick => ({ ...pick, name: pick.file === OWN ? t('aiStartOwnSettings') : workflow.presets.find(preset => preset.file === pick.file)?.name || pick.file }));
}

/** Runs `run` ({card, picks, close}) with no AI and says what was queued, or what stopped it. */
async function runNow(owner, run) {
    try {
        const result = await runPresets({ ...run, toGallery: () => { owner.show?.(); owner.goTo?.('gallery'); } });
        if (result.stopped) await anomalousAlert(t('aiPresetStopped', { preset: result.stopped.name, reason: result.stopped.reason, count: result.queued }));
        else showWorkbenchToast(t('aiPresetQueued', { count: result.queued, name: result.name }));
    } catch (error) {
        await anomalousAlert(error.message);
    }
}

/** The home page's line under the AI cards: the list run last, again with one press; null when none stands. */
export function againLine(owner, data) {
    const last = kept(data.workflows);
    if (!last) return null;
    const words = t('aiPresetAgain', { name: last.workflow.name, presets: last.picks.length, count: total(last.picks) });
    const node = button('anomalous-ai-preset-again', words, async () => {
        node.disabled = true; // a second press while the tab opens would queue it all twice
        await runNow(owner, { card: last.workflow, picks: named(last.workflow, last.picks), close: last.close });
        node.disabled = false;
    });
    return node;
}

/** The strip over the cards (and in the sheet with no saved workflow): what is on the canvas runs in versions on the Saves page, not here. */
export function savesStrip(owner, close) {
    const node = button('anomalous-ai-preset-to-saves', '', () => {
        close();
        void savesFromHome(owner);
    });
    const art = el('span', 'anomalous-ai-preset-to-saves-icon');
    art.innerHTML = PAGE_ICONS.saves; // static markup only
    const words = el('span', 'anomalous-ai-preset-to-saves-words');
    words.append(el('span', 'anomalous-ai-preset-to-saves-title', t('aiPresetToSaves')),
        el('span', 'anomalous-ai-preset-to-saves-hint', t('aiPresetToSavesHint')));
    node.append(art, words, icon('arrowRight', 18));
    return node;
}

/**
 * {steps, start()} of the sheet. `go` is its Start button, worded here by who will do the run; `close()`
 * shuts the sheet; start() returns what is missing, in words, or '' once it took over.
 */
export function presetFields({ data, owner, close, go }) {
    const last = kept(data.workflows);
    const state = { workflow: last?.workflow || data.workflows[0], picks: last?.picks || [{ file: OWN, times: 1 }] };
    const wfPicker = workflowCardGrid({
        workflows: data.workflows,
        selected: state.workflow?.file || '',
        showPresets: true,
        onPick: (workflow) => {
            state.workflow = workflow;
            state.picks = [{ file: OWN, times: 1 }];
            draw();
        },
        onConfirm: () => {
            const next = go.previousElementSibling;
            if (next && !next.hidden) next.click();
        },
    });
    const chips = el('div', 'anomalous-ai-preset-chips');
    const row = el('div', 'anomalous-ai-preset-run');
    const sum = el('div', 'anomalous-ai-preset-sum');
    const change = el('input', 'anomalous-ai-start-input');
    change.type = 'text';
    change.placeholder = t('aiStartChangeHint');
    change.setAttribute('aria-label', t('aiPresetStepChange'));
    change.maxLength = 300;
    const hidden = el('textarea', 'anomalous-ai-start-input');
    hidden.placeholder = t('aiPresetHiddenHint');
    hidden.maxLength = MAX_HIDDEN;
    hidden.rows = 3;
    const hiddenField = field(t('aiPresetHidden'), hidden);
    const privacy = check(t('aiPresetPrivate'));
    const closing = check(t('aiPresetClose'), last?.close !== false);
    const checks = el('div', 'anomalous-ai-preset-checks');
    checks.append(privacy.box, closing.box);
    const who = el('div', 'anomalous-ai-preset-who');

    const byAi = () => Boolean(change.value.trim() || (privacy.input.checked && hidden.value.trim()));

    /** Who runs it, in a line and on the button; the sum of the list. */
    function tell() {
        const count = total(state.picks);
        const ai = byAi();
        sum.textContent = t(count > MAX_TOTAL ? 'aiPresetTooMany' : 'aiPresetSum', { count, max: MAX_TOTAL });
        sum.classList.toggle('is-over', count > MAX_TOTAL);
        who.textContent = t(!ai ? 'aiPresetWhoSelf' : privacy.input.checked ? 'aiPresetWhoPrivate' : 'aiPresetWhoAi');
        who.classList.toggle('is-ai', ai);
        go.textContent = ai ? t('aiPresetGoAi') : t('aiPresetGo', { count });
        hiddenField.hidden = !privacy.input.checked;
        closing.input.disabled = ai;
    }

    function draw() {
        chips.replaceChildren(...[{ file: OWN, name: t('aiStartOwnSettings') }, ...state.workflow.presets].map((preset) => {
            const at = state.picks.findIndex(pick => pick.file === preset.file);
            return button(`anomalous-ai-preset-chip${at >= 0 ? ' is-on' : ''}`, at >= 0 ? `${at + 1} ${preset.name}` : preset.name, () => {
                state.picks = toggled(state.picks, preset.file);
                draw();
            });
        }));
        row.replaceChildren(...named(state.workflow, state.picks).map((pick, at) => {
            const item = el('span', 'anomalous-ai-preset-pick');
            const times = el('input', 'anomalous-ai-preset-times');
            times.type = 'number';
            times.min = '1';
            times.max = String(MAX_EACH);
            times.value = String(pick.times);
            times.setAttribute('aria-label', t('aiPresetTimes', { name: pick.name }));
            times.oninput = () => {
                state.picks = withTimes(state.picks, pick.file, times.value);
                tell();
            };
            times.onchange = () => { times.value = String(state.picks.find(item_ => item_.file === pick.file)?.times ?? 1); };
            item.append(el('span', 'anomalous-ai-preset-pick-name', `${at + 1} ${pick.name}`), el('span', 'anomalous-ai-preset-by', '×'), times);
            return item;
        }));
        if (!state.picks.length) row.append(el('span', 'anomalous-ai-preset-none', t('aiPresetNeedPick')));
        tell();
    }

    change.oninput = tell;
    hidden.oninput = tell;
    privacy.input.onchange = tell;
    draw();

    async function start() {
        if (!state.picks.length) return t('aiPresetNeedPick');
        if (total(state.picks) > MAX_TOTAL) return t('aiPresetTooMany', { count: total(state.picks), max: MAX_TOTAL });
        const picks = named(state.workflow, state.picks);
        if (!byAi()) {
            close();
            keep({ workflow: state.workflow.file, picks: state.picks, close: closing.input.checked });
            await runNow(owner, { card: state.workflow, picks, close: closing.input.checked });
            return '';
        }
        const secret = privacy.input.checked;
        const hide = secret ? marked : text => text;
        const list = picks.map((pick) => {
            const what = pick.file !== OWN ? `${hide(state.workflow.name)} / ${hide(pick.name)}` : hide(state.workflow.name);
            return `${what} × ${pick.times}`;
        }).join('; ');
        const note = [t('aiPresetSay', { list }), change.value.trim() ? t('aiPresetSayChange', { change: change.value.trim() }) : '',
            secret && hidden.value.trim() ? t('aiPresetSayPrompt', { prompt: marked(hidden.value.trim()) }) : ''].filter(Boolean).join(' ');
        if (note.length > MAX_NOTE) return t('aiPresetTooLong');
        const about = secret ? [] : [{ type: 'workflow', name: state.workflow.name, label: state.workflow.name }];
        const title = secret ? t('aiPresetTaskPrivate') : t('aiPresetTask', { name: state.workflow.name.slice(0, 40) });
        close();
        await startTask(owner, title, about, null, { canvas: 'new', ...(secret ? { privacy: true } : {}) }, note);
        return '';
    }

    const hint = key => el('p', 'anomalous-ai-start-step-hint', t(key));
    const steps = [
        { title: t('aiPresetStepWorkflow'), nodes: [savesStrip(owner, close), wfPicker.node] },
        { title: t('aiPresetStepPick'), nodes: [hint('aiPresetStepPickHint'), chips, row, sum],
            check: () => (!state.picks.length ? { errorText: t('aiPresetNeedPick') }
                : total(state.picks) > MAX_TOTAL ? { errorText: t('aiPresetTooMany', { count: total(state.picks), max: MAX_TOTAL }) } : null) },
        { title: t('aiPresetStepChange'), nodes: [hint('aiStartStepMoreHint'), change, checks, hiddenField, who] },
    ];
    return { steps, start, stop: () => wfPicker.stop() };
}
