/**
 * The fields of the "Run my preset" sheet (ui_ai_starter_sheet.js opens it): which workflow (a saved one,
 * or an open canvas with the saved workflow whose presets go onto it), the presets as chips that a press
 * lines up to run, each so many times, and what to change this time. With nothing to change Anomalous
 * runs the list itself (preset_runs.js), no AI app needed, and keeps a saved workflow's list in this
 * browser: the home page's line runs it again with one press (againLine). With a change the list goes to
 * an AI as a task and a message; in privacy mode the names in it (the workflow's and each preset's, a
 * token each) and a prompt of the user's go marked to hide (ai_hide_mark.js), so the AI gets tokens.
 */

import { marked } from './ai_hide_mark.js';
import { translate as t } from './locales.js';
import { MAX_EACH, MAX_TOTAL, OWN, still, toggled, total, withTimes } from './preset_run_list.js';
import { fitsTab, openTabs, presetSets, runPresets } from './preset_runs.js';
import { startTask } from './ui_ai_handoff.js';
import { anomalousAlert } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const KEY = 'anomalous_ai_preset_last';
const SEARCH_FROM = 8; // saved workflows from which their list gets a line to search it
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

function option(value, label) {
    const node = el('option', '', label);
    node.value = value;
    return node;
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

/** `picks` with the name each shows by; `own`: what the settings a canvas stands with are called. */
function named(workflow, picks, own = t('aiStartOwnSettings')) {
    return picks.map(pick => ({ ...pick, name: pick.file === OWN ? own : workflow.presets.find(preset => preset.file === pick.file)?.name || pick.file }));
}

/** Runs `run` ({card, tab, picks, close}) with no AI and says what was queued, or what stopped it. */
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

/**
 * {nodes, start()} of the sheet. `go` is its Start button, worded here by who will do the run; `close()`
 * shuts the sheet; start() returns what is missing, in words, or '' once it took over.
 */
export function presetFields({ data, owner, close, go }) {
    const tabs = openTabs();
    const last = kept(data.workflows);
    const state = { tab: '', workflow: last?.workflow || data.workflows[0], picks: last?.picks || [{ file: OWN, times: 1 }], fits: null };
    const tabOf = () => tabs.find(tab => tab.path === state.tab) || null;
    const usable = file => file === OWN || !state.tab || Boolean(state.fits?.has(file));

    const fromCard = button('anomalous-ai-start-pill', t('aiPresetFromCard'), () => setSource(''));
    const fromTab = button('anomalous-ai-start-pill', t('aiPresetFromTab'), () => setSource(tabs[0].path));
    const sources = el('div', 'anomalous-ai-start-pills');
    sources.append(fromCard, ...(tabs.length ? [fromTab] : []));
    const tabPick = el('select', 'anomalous-ai-start-select');
    tabPick.append(...tabs.map(tab => option(tab.path, tab.name)));
    tabPick.onchange = () => setSource(tabPick.value);
    const tabNote = el('div', 'anomalous-ai-preset-note');
    const tabField = field(t('aiPresetTab'), tabPick, tabNote);
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiPresetSearch');
    search.hidden = data.workflows.length < SEARCH_FROM;
    const cardPick = el('select', 'anomalous-ai-start-select');
    const cardLabel = el('span', 'anomalous-ai-start-label');
    const cardField = el('div', 'anomalous-ai-start-field');
    cardField.append(cardLabel, search, cardPick);
    const chips = el('div', 'anomalous-ai-preset-chips');
    const row = el('div', 'anomalous-ai-preset-run');
    const sum = el('div', 'anomalous-ai-preset-sum');
    const change = el('input', 'anomalous-ai-start-input');
    change.type = 'text';
    change.placeholder = t('aiStartChangeHint');
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

    function drawCards() {
        const words = search.value.trim().toLowerCase();
        const shown = data.workflows.filter(item => item === state.workflow || !words || item.name.toLowerCase().includes(words));
        cardPick.replaceChildren(...shown.map(item => option(item.file, item.name)));
        cardPick.value = state.workflow.file;
    }

    function draw() {
        const tab = tabOf();
        fromCard.classList.toggle('is-on', !tab);
        fromTab.classList.toggle('is-on', Boolean(tab));
        tabField.hidden = !tab;
        cardLabel.textContent = t(tab ? 'aiPresetFrom' : 'aiStartWorkflow');
        drawCards();
        const own = t(tab ? 'aiPresetAsIs' : 'aiStartOwnSettings');
        chips.replaceChildren(...[{ file: OWN, name: own }, ...state.workflow.presets].map((preset) => {
            const at = state.picks.findIndex(pick => pick.file === preset.file);
            const chip = button(`anomalous-ai-preset-chip${at >= 0 ? ' is-on' : ''}`, at >= 0 ? `${at + 1} ${preset.name}` : preset.name, () => {
                state.picks = toggled(state.picks, preset.file);
                draw();
            });
            chip.disabled = !usable(preset.file);
            if (chip.disabled) chip.title = t(state.fits ? 'aiPresetNoFit' : 'aiPresetChecking');
            return chip;
        }));
        row.replaceChildren(...named(state.workflow, state.picks, own).map((pick, at) => {
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

    let asked = 0;
    /** In canvas mode: which presets of the saved workflow can be put on the tab; the others cannot be pressed. */
    async function checkFits() {
        const mine = ++asked;
        state.fits = null;
        draw();
        if (!state.tab || !state.workflow.presets.length) return;
        const sets = await presetSets(state.workflow.file).catch(() => ({}));
        if (mine !== asked || !chips.isConnected) return;
        state.fits = new Set(state.workflow.presets.filter(preset => fitsTab(sets[preset.file], state.tab)).map(preset => preset.file));
        state.picks = state.picks.filter(pick => usable(pick.file));
        draw();
    }

    function setWorkflow(workflow) {
        state.workflow = workflow;
        state.picks = [{ file: OWN, times: 1 }];
        void checkFits();
    }

    /** `path`: an open tab, or '' for a saved workflow. A tab holding a saved workflow's nodes is taken for it. */
    function setSource(path) {
        state.tab = path;
        const tab = tabOf();
        if (!tab) return setWorkflow(state.workflow);
        tabPick.value = path;
        const same = tab.shape ? data.workflows.find(item => item.shape === tab.shape) : null;
        tabNote.textContent = !tab.runs ? t('aiPresetTabNoOutput') : same ? t('aiPresetTabIs', { name: same.name }) : t('aiPresetTabUnknown');
        tabNote.classList.toggle('is-warn', !tab.runs);
        setWorkflow(same || state.workflow);
    }

    cardPick.onchange = () => setWorkflow(data.workflows.find(item => item.file === cardPick.value));
    search.oninput = drawCards;
    change.oninput = tell;
    hidden.oninput = tell;
    privacy.input.onchange = tell;
    draw();

    async function start() {
        const tab = tabOf();
        if (!state.picks.length) return t('aiPresetNeedPick');
        if (total(state.picks) > MAX_TOTAL) return t('aiPresetTooMany', { count: total(state.picks), max: MAX_TOTAL });
        if (tab && !tab.runs) return t('aiPresetTabNoOutput');
        const picks = named(state.workflow, state.picks, t(tab ? 'aiPresetAsIs' : 'aiStartOwnSettings'));
        const presets = picks.some(pick => pick.file !== OWN);
        if (!byAi()) {
            close();
            if (!tab) keep({ workflow: state.workflow.file, picks: state.picks, close: closing.input.checked });
            await runNow(owner, { card: tab && !presets ? null : state.workflow, tab: state.tab, picks, close: closing.input.checked });
            return '';
        }
        const secret = privacy.input.checked;
        const hide = secret ? marked : text => text;
        const list = picks.map((pick) => {
            const what = pick.file !== OWN ? `${hide(state.workflow.name)} / ${hide(pick.name)}` : tab ? t('aiPresetSayCanvas') : hide(state.workflow.name);
            return `${what} × ${pick.times}`;
        }).join('; ');
        const note = [t('aiPresetSay', { list }), change.value.trim() ? t('aiPresetSayChange', { change: change.value.trim() }) : '',
            secret && hidden.value.trim() ? t('aiPresetSayPrompt', { prompt: marked(hidden.value.trim()) }) : ''].filter(Boolean).join(' ');
        if (note.length > MAX_NOTE) return t('aiPresetTooLong');
        const onCanvas = tab && picks.some(pick => pick.file === OWN);
        const about = [...(!secret && (presets || !tab) ? [{ type: 'workflow', name: state.workflow.name, label: state.workflow.name }] : []),
            ...(onCanvas ? [{ type: 'canvas', tab: tab.path, label: tab.name }] : [])];
        const title = secret ? t('aiPresetTaskPrivate') : t('aiPresetTask', { name: (tab && !presets ? tab.name : state.workflow.name).slice(0, 40) });
        close();
        await startTask(owner, title, about, null, { ...(onCanvas ? {} : { canvas: 'new' }), ...(secret ? { privacy: true } : {}) }, note);
        return '';
    }

    const nodes = [field(t('aiPresetSource'), sources), tabField, cardField, field(t('aiPresetPick'), chips, row, sum),
        field(t('aiStartChange'), change), checks, hiddenField, who];
    return { nodes, start };
}
