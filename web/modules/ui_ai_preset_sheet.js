/**
 * The steps of the "Run my preset" sheet (ui_ai_starter_sheet.js opens it, ui_ai_start_steps.js steps it):
 * which saved workflow (a card grid; running what is on the canvas, a few versions together, is the Saves
 * page's job, and a strip over the grid goes there), then the presets as chips that a press lines up to run,
 * each so many times. Anomalous runs the list itself (preset_runs.js), no AI app needed, and keeps the list in
 * this browser: the home page's line runs it again with one press (againLine). Letting an AI plan the run is
 * the home page's "Say what you want" card (ui_ai_starter_sheet.js `plan`).
 */

import { translate as t } from './locales.js';
import { MAX_EACH, MAX_TOTAL, OWN, still, toggled, total, withTimes } from './preset_run_list.js';
import { runPresets } from './preset_runs.js';
import { icon } from './ui_ai_icons.js';
import { anomalousAlert } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { PAGE_ICONS } from './ui_shell_rail.js';
import { savesFromHome } from './ui_snapshot_bar.js';
import { workflowCardGrid } from './ui_workflow_pick.js';

const KEY = 'anomalous_ai_preset_last';

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
 * {steps, start()} of the sheet. `go` is its Start button, worded here with the count; `close()`
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
    const closing = check(t('aiPresetClose'), last?.close !== false);
    const who = el('div', 'anomalous-ai-preset-who', t('aiPresetWhoSelf'));

    /** The sum of the list, on its line and the button. */
    function tell() {
        const count = total(state.picks);
        sum.textContent = t(count > MAX_TOTAL ? 'aiPresetTooMany' : 'aiPresetSum', { count, max: MAX_TOTAL });
        sum.classList.toggle('is-over', count > MAX_TOTAL);
        go.textContent = t('aiPresetGo', { count });
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

    draw();

    async function start() {
        if (!state.picks.length) return t('aiPresetNeedPick');
        if (total(state.picks) > MAX_TOTAL) return t('aiPresetTooMany', { count: total(state.picks), max: MAX_TOTAL });
        close();
        keep({ workflow: state.workflow.file, picks: state.picks, close: closing.input.checked });
        await runNow(owner, { card: state.workflow, picks: named(state.workflow, state.picks), close: closing.input.checked });
        return '';
    }

    const hint = key => el('p', 'anomalous-ai-start-step-hint', t(key));
    const steps = [
        { title: t('aiPresetStepWorkflow'), nodes: [savesStrip(owner, close), wfPicker.node] },
        { title: t('aiPresetStepPick'), nodes: [hint('aiPresetStepPickHint'), chips, row, sum, closing.box, who] },
    ];
    return { steps, start, stop: () => wfPicker.stop() };
}
