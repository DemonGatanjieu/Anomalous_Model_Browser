import { t } from './interface_settings.js';
import { buildScriptPackage, joinSegments, splitScriptLines, usableEmotions } from './audio_script.js';
import { TTS_ENGINE, voiceGroupKey } from './audio_engines.js';
import { pickLines } from './ui_script_cast.js';
import { emotionLabel, renderLineCard } from './ui_script_cards.js';
import { createRunSection } from './ui_script_run.js';
import { ownTuneText } from './ui_script_tune.js';
import { bindSplitBar } from './ui_split_bar.js';
import { bindPackageDrag, copyScript, pushToNode } from './ui_script_workflow.js';

/**
 * The script director, the body of the Voices page's Voice-over view (ui_script_page.js):
 * paste a script, and every line is read by a character (at first the one picked in the list
 * on the left, the cast). The left side only picks: lines (ui_script_cards.js, ui_script_cast.js)
 * or a character in the cast; the side panel follows it (ui_script_tune.js): the whole script,
 * one character in it, or the picked lines, where who reads them and how (language, speed, mode,
 * each line following its character until set for itself) are changed. Choose an emotion per
 * line, then generate it right here (ui_script_run.js), or put the tagged script into the
 * workflow (ui_script_workflow.js). The node's own character is the first line's. The panel and
 * its lines live for the page session; the page mounts it again each time it is shown. The script
 * is kept as a draft in this browser (localStorage) and comes back after a reload.
 */

// From this width on, the cards get the full height and the generate side sits beside them.
const WIDE_FROM = 760;
const SIDE_WIDTH_KEY = 'anomalous_sd_side_width';
const WORKFLOW_OPEN_KEY = 'anomalous_sd_workflow_open';

const ICONS = {
    SPEAKER: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`,
    STOP: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`,
    GRIP: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
};

const state = {
    groups: [],
    groupKey: null,     // the character picked in the cast: new and pasted lines go to it
    focus: null,        // { character: key }: the side panel shows it (while no line is picked)
    lines: [],          // { text, emotion, take, speaker, tune? } — take > 1: retaken; speaker: its character's group key; tune: script_tune.js
    editing: true,
    splitMode: 'sentence',
    editLine: null,     // the card whose text is being edited in place
    listenIndex: 0,     // the line the modes are heard on (ui_script_run.js)
    picked: new Set(),  // lines picked: the side panel changes them
    anchor: null,       // where a Shift run of picked lines starts
};

let panel = null;
let refs = null;
let hooks = {};
let previewAudio = null;
let previewButton = null;
let runSection = null;
// bindMaterialDrag hides the browser modal while dragging; the owner is only known once the studio sets hooks.
const dragOwner = { get modal() { return hooks.owner?.modal; } };

// ---------- public API ----------

/** `{ owner, onPreviewStart(), onCharacterChange(), openGallery() }` from the page. */
export function setScriptDirectorHooks(next) {
    hooks = next || {};
}

/** The voice group key of the character picked in the cast. */
export function scriptCharacter() {
    return state.groupKey;
}

/** Lines to voice again (a generated file's `{ emotion, text, speaker? }` segments): one card per line. */
export function loadScriptLines(segments) {
    // A segment's own settings were written for its first line only.
    const lines = segments.flatMap(segment => String(segment.text || '').split(/\n+/)
        .map((text, at) => ({
            text: text.trim(), emotion: segment.emotion || 'main', take: 1, speaker: segment.speaker ? voiceGroupKey(segment.speaker) : state.groupKey,
            ...(segment.tune && at === 0 ? { tune: { ...segment.tune } } : {}),
        })))
        .filter(line => line.text);
    if (!lines.length) return;
    stopScriptDirectorPreview();
    state.lines = lines;
    state.picked = new Set();
    state.editing = false;
    if (panel) renderAll();
}

/** Puts the director into `parentContainer` (the Voice-over page). */
export function mountScriptDirector(parentContainer) {
    if (!panel) createPanel();
    if (panel.parentNode !== parentContainer) parentContainer.appendChild(panel);
    renderAll();
}

/**
 * The characters, after each voice fetch. Keeps the chosen character while it exists;
 * `choose`: switch to `preferredGroup` (a character card's "Voice-over").
 */
export function updateScriptDirectorVoices(groups, preferredGroup = null, { choose = false } = {}) {
    state.groups = Array.isArray(groups) ? groups : [];
    const exists = key => state.groups.some(group => group.group === key);
    if (choose && exists(preferredGroup)) {
        if (state.groupKey !== preferredGroup) stopScriptDirectorPreview();
        state.groupKey = preferredGroup;
    } else if (!exists(state.groupKey)) {
        state.groupKey = (preferredGroup && exists(preferredGroup) ? preferredGroup : null)
            || state.groups.find(group => usableEmotions(group).includes('main'))?.group
            || state.groups[0]?.group
            || null;
    }
    if (panel) renderAll();
}

/**
 * A character clicked in the list on Voice-over: the side panel shows how it reads in this
 * script (the picked lines are let go), and it reads the lines pasted or added from now on.
 */
export function castScriptCharacter(key) {
    if (!state.groups.some(group => group.group === key)) return;
    stopScriptDirectorPreview();
    state.picked = new Set();
    state.focus = { character: key };
    state.groupKey = key;
    hooks.onCharacterChange?.();
    if (panel) renderAll();
}

/** Back to the whole script in the side panel: nothing picked, no character shown. */
function focusScript() {
    state.picked = new Set();
    state.focus = null;
    if (panel) renderAll();
}

/** Lines `indexes` read by `key` from now on; emotions it lacks go back to its main voice. */
function giveLines(indexes, key) {
    const group = state.groups.find(item => item.group === key);
    for (const index of indexes) {
        const line = state.lines[index];
        if (!line || !group) continue;
        line.speaker = key;
        if (!usableEmotions(group).includes(line.emotion)) line.emotion = 'main';
    }
}

export function stopScriptDirectorPreview() {
    stopLinePreview();
    runSection?.stopPlayback();
}

function stopLinePreview() {
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
    }
    if (previewButton) {
        previewButton.innerHTML = ICONS.SPEAKER;
        previewButton.classList.remove('is-playing');
        previewButton = null;
    }
}

// ---------- state helpers ----------

function pickedGroup() {
    return state.groups.find(group => group.group === state.groupKey) || null;
}

/** Who reads `line`: its character, else the one picked in the cast. */
function speakerOf(line) {
    return (line?.speaker && state.groups.find(group => group.group === line.speaker)) || pickedGroup();
}

/** The node's own character: the first line's (the others are tagged where they take over). */
function nodeGroup() {
    return speakerOf(state.lines.find(line => line.text.trim()) || null);
}

/** How each line is read, as tags (the run section knows the characters' values). */
const tagsOf = (line, speaker) => runSection?.tagsOf(line, speaker) || '';

/** The script with retakes, for a run in the director, and what the side panel shows. */
function runScript() {
    const group = nodeGroup();
    return {
        group, lines: state.lines, listen: state.listenIndex, speakerOf,
        pkg: buildScriptPackage(state.lines, group, { takes: true, groups: state.groups, tagsOf }),
        groups: state.groups,
        picked: [...state.picked].sort((a, b) => a - b),
        focus: state.focus,
        assign: (indexes, key) => {
            giveLines(indexes, key);
            stopScriptDirectorPreview();
            renderAll();
        },
        focusCharacter: castScriptCharacter,
        focusScript,
    };
}

function currentPackage() {
    return buildScriptPackage(state.lines, nodeGroup(), { groups: state.groups, tagsOf });
}

// ---------- DOM ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) {
        btn.title = title;
        btn.setAttribute('aria-label', title);
    }
    btn.onclick = onClick;
    return btn;
}

function createPanel() {
    panel = el('div', 'anomalous-script-director-panel');

    const header = el('div', 'anomalous-sd-header');
    const subtitle = el('p', 'anomalous-sd-subtitle');
    header.append(subtitle);

    const inputArea = el('div', 'anomalous-sd-input-area');
    const textarea = el('textarea', 'anomalous-sd-textarea');
    textarea.placeholder = t('scriptDirectorInputPlaceholder');
    const inputActions = el('div', 'anomalous-sd-input-actions');
    const splitMode = el('select', 'anomalous-sd-split-mode');
    for (const [value, key] of [['sentence', 'scriptDirectorSplitSentence'], ['line', 'scriptDirectorSplitLine']]) {
        const option = el('option', '', t(key));
        option.value = value;
        splitMode.appendChild(option);
    }
    splitMode.value = state.splitMode;
    splitMode.onchange = () => { state.splitMode = splitMode.value; };
    const cancelEdit = button('anomalous-sd-btn', t('dialogCancel'), () => { state.editing = false; renderAll(); });
    inputActions.append(
        splitMode,
        button('anomalous-sd-btn', t('scriptDirectorClear'), () => { textarea.value = ''; textarea.focus(); }),
        cancelEdit,
        button('anomalous-sd-btn primary', t('scriptDirectorParse'), () => parseScript(textarea.value)),
    );
    const pasteFor = el('div', 'anomalous-sd-paste-for');
    inputArea.append(pasteFor, textarea, inputActions);

    const linesBar = el('div', 'anomalous-sd-lines-bar');
    const linesCount = el('span', 'anomalous-sd-lines-count');
    const castHint = el('span', 'anomalous-sd-cast-hint');
    linesBar.append(linesCount, castHint, button('anomalous-sd-link-btn', t('scriptDirectorEdit'), () => {
        textarea.value = state.lines.map(line => line.text).join('\n');
        state.editing = true;
        renderAll();
        textarea.focus();
    }));

    const linesContainer = el('div', 'anomalous-sd-lines-container');
    const scroll = el('div', 'anomalous-sd-scroll');

    const footer = el('div', 'anomalous-sd-footer');
    const summary = el('div', 'anomalous-sd-package-summary');
    const actions = el('div', 'anomalous-sd-package-actions');
    const dragHandle = el('div', 'anomalous-sd-drag-handle');
    dragHandle.innerHTML = ICONS.GRIP;
    dragHandle.append(el('span', '', t('scriptDirectorDragHandle')));
    bindPackageDrag(dragHandle, dragOwner, currentPackage, () => refs.pushBtn);
    const copyBtn = button('anomalous-sd-btn', t('scriptDirectorCopy'), () => copyScript(currentPackage(), refs.copyBtn));
    const pushBtn = button('anomalous-sd-btn', t('scriptDirectorInject'), () => pushToNode(currentPackage(), refs.pushBtn));
    actions.append(dragHandle, pushBtn, copyBtn);
    // Into your own workflow: second to generating here, so it sits below it, folded (remembered).
    const workflow = el('details', 'anomalous-sd-workflow');
    const workflowTitle = el('summary', 'anomalous-sd-workflow-title');
    workflow.append(workflowTitle, actions);
    try { workflow.open = localStorage.getItem(WORKFLOW_OPEN_KEY) === '1'; } catch (_) { /* folded */ }
    workflow.addEventListener('toggle', () => {
        try { localStorage.setItem(WORKFLOW_OPEN_KEY, workflow.open ? '1' : '0'); } catch (_) { /* convenience only */ }
    });
    runSection = createRunSection({
        getScript: runScript,
        getNodeGroup: nodeGroup,
        getGroups: () => state.groups,
        onPlay: () => {
            stopLinePreview();
            hooks.onPreviewStart?.();
        },
        resetTakes: () => state.lines.forEach(line => { line.take = 1; }),
        onBusyChange: () => renderAll(),
        onLinesChange: () => {
            renderLines();
            saveDraft();
        },
        openGallery: () => hooks.openGallery?.(),
    });
    scroll.append(linesContainer);
    footer.append(summary, runSection.bar);
    if (!state.lines.length) loadDraft();

    // Cards on one side, everything about generating on the other: below the cards
    // on a narrow page (docked browser), beside them once the page is wide.
    const main = el('div', 'anomalous-sd-main');
    main.append(linesBar, scroll);
    const side = el('div', 'anomalous-sd-side');
    side.append(footer, runSection.settings, workflow);
    const body = el('div', 'anomalous-sd-body');
    const splitter = el('div', 'anomalous-sd-splitter');
    splitter.title = t('scriptDirectorSplitter');
    body.append(main, splitter, side);
    bindSplitBar(splitter, { owner: panel, body, prop: '--sd-side-width', key: SIDE_WIDTH_KEY });
    // The panel lives for the page session, so the observer does too.
    new ResizeObserver(([entry]) => panel.classList.toggle('is-wide', entry.contentRect.width >= WIDE_FROM)).observe(panel);

    panel.append(header, inputArea, body);
    // Esc lets go of the picked lines first; the browser's own Esc leaves it to this then (ui_browser_navigation.js),
    // and with a character shown it presses the panel's back link.
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !state.picked.size || !panel.getClientRects().length) return;
        if (e.target?.closest?.('input, textarea, select')) return;
        focusScript();
    });
    refs = { subtitle, pasteFor, inputArea, textarea, cancelEdit, body, linesCount, castHint, linesContainer, summary, workflowTitle, dragHandle, copyBtn, pushBtn };
}

function renderAll() {
    if (!panel) return;
    const node = TTS_ENGINE.label;
    refs.subtitle.textContent = t('scriptDirectorSubtitle');
    refs.subtitle.hidden = state.lines.length > 0 && !state.editing; // the how-to, until there are lines
    refs.workflowTitle.textContent = t('scriptDirectorWorkflowTitle');
    refs.dragHandle.title = t('scriptDirectorDragHint', { node });
    refs.pushBtn.title = t('scriptDirectorPushHint', { node });
    refs.pushBtn.setAttribute('aria-label', refs.pushBtn.title);
    for (const line of state.lines) line.speaker ||= state.groupKey; // lines from before a character was picked
    const picked = pickedGroup();
    refs.pasteFor.textContent = !state.groups.length ? t('scriptDirectorNoCharacters')
        : picked ? t('scriptDirectorPasteFor', { name: picked.character }) : '';
    const hasLines = state.lines.length > 0;
    refs.inputArea.hidden = hasLines && !state.editing;
    refs.cancelEdit.hidden = !hasLines;
    refs.body.hidden = !hasLines || state.editing;
    refs.linesCount.textContent = t('scriptDirectorLinesCount', { count: state.lines.length });
    if (hasLines && !state.editing) renderLines();
    renderPackage();
}

function renderLines() {
    // Chips only when there is a choice, or a line still asks for an emotion its character lacks.
    const showChips = state.lines.some((line) => {
        const emotions = usableEmotions(speakerOf(line));
        return emotions.length > 1 || !emotions.includes(line.emotion);
    });
    const addLine = button('anomalous-sd-add-line', t('scriptDirectorAddLine'), () => {
        const last = state.lines.at(-1);
        state.lines.push({ text: '', emotion: last?.speaker === state.groupKey ? last.emotion : 'main', take: 1, speaker: state.groupKey });
        state.editLine = state.lines.length - 1;
        state.picked = new Set();
        renderAll();
    });
    if (state.listenIndex >= state.lines.length) state.listenIndex = 0;
    state.picked = new Set([...state.picked].filter(index => index < state.lines.length));
    const ctx = {
        groups: state.groups,
        speakerOf,
        picked: state.picked,
        listenIndex: state.listenIndex,
        editing: state.editLine,
        showSpeakers: state.groups.length > 1,
        showChips,
        count: state.lines.length,
        canListen: Boolean(runSection?.canListen()),
        canRetake: Boolean(runSection?.canRetake(nodeGroup())),
        tuneText: line => ownTuneText(runSection?.presetsView(), line),
        onPick: pickLine,
        onEdit: (index, quiet = false) => {
            state.editLine = index;
            if (index !== null) chooseListenLine(index);
            if (!quiet) renderLines();
        },
        onText: (index, text) => {
            state.lines[index].text = text;
            renderPackage();
        },
        onSplit: (index, first, second) => {
            const line = state.lines[index];
            line.text = first;
            state.lines.splice(index + 1, 0, { text: second, emotion: line.emotion, take: 1, speaker: line.speaker, ...(line.tune ? { tune: { ...line.tune } } : {}) });
            changeLines(index + 1);
        },
        onMerge: (index) => {
            const line = state.lines[index];
            line.text = joinSegments(line.text, state.lines[index + 1].text);
            state.lines.splice(index + 1, 1);
            changeLines(null);
        },
        onDelete: (index) => {
            state.lines.splice(index, 1);
            changeLines(null);
        },
        // The name on a card: that line, or every picked one when it is one of them.
        onSpeaker: (index, key) => {
            giveLines(state.picked.has(index) ? [...state.picked] : [index], key);
            stopScriptDirectorPreview();
            renderAll();
        },
        onEmotion: (reference) => {
            if (previewButton === reference) stopScriptDirectorPreview();
            renderPackage();
        },
        onListen: (index) => {
            chooseListenLine(index);
            runSection.listen();
        },
        onRetake: (index) => {
            const line = state.lines[index];
            line.take = (line.take || 1) + 1;
            runSection.generate();
        },
        onPreview: previewLine,
    };
    refs.linesContainer.replaceChildren(...state.lines.map((line, index) => renderLineCard(line, index, ctx)), addLine);
    renderCastHint();
}

/** After a split, merge or delete: the numbers move, so nothing stays picked; `edit` opens a card. */
function changeLines(edit) {
    state.picked = new Set();
    state.editLine = edit;
    stopScriptDirectorPreview();
    renderAll();
}

/** A click on a card: picks it (Ctrl / ⌘ adds, Shift a run), the side panel shows the picked lines. */
function pickLine(index, event) {
    state.picked = pickLines(state.picked, index, event, state.anchor);
    if (!event.shiftKey) state.anchor = index;
    refs.linesContainer.querySelectorAll('.anomalous-sd-line-card').forEach((card, at) => card.classList.toggle('is-picked', state.picked.has(at)));
    renderCastHint();
    chooseListenLine(index);
    runSection?.render();
}

/** How to work the cards: picking (the side panel changes them) and editing. */
function renderCastHint() {
    refs.castHint.textContent = state.picked.size
        ? t('scriptCastPicked', { count: state.picked.size })
        : t(state.groups.length > 1 ? 'scriptCastHint' : 'scriptDirectorCardsHint');
}

function chooseListenLine(index) {
    if (state.listenIndex === index) return;
    state.listenIndex = index;
    refs.linesContainer.querySelectorAll('.anomalous-sd-line-card').forEach((card, at) => card.classList.toggle('is-listen', at === index));
    runSection?.render();
}

function renderPackage() {
    if (!refs) return;
    const pkg = currentPackage();
    const ok = !pkg.error;
    refs.summary.classList.toggle('is-error', !ok);
    if (ok && pkg.speakers.length > 1) {
        refs.summary.textContent = t('scriptDirectorPackageSummaryCast', { count: pkg.lineCount, speakers: pkg.speakers.join('、') });
    } else if (ok) {
        const used = [...new Set(state.lines.filter(line => line.text.trim()).map(line => emotionLabel(line.emotion)))];
        refs.summary.textContent = t('scriptDirectorPackageSummary', { count: pkg.lineCount, emotions: used.join(' · ') });
    } else {
        refs.summary.textContent = t(pkg.error);
    }
    saveDraft();
    refs.copyBtn.disabled = !ok;
    refs.pushBtn.disabled = !ok;
    refs.dragHandle.draggable = ok;
    refs.dragHandle.classList.toggle('is-disabled', !ok);
    runSection.render();
}

// ---------- the draft ----------

const DRAFT_KEY = 'anomalous_sd_draft';
const DRAFT_FIELDS = { language: 'string', speed: 'number', preset: 'string' };
let draftTimer = null;

/** Only the line settings a draft may hold, with the right types. */
function cleanTune(tune) {
    const out = {};
    for (const [field, type] of Object.entries(DRAFT_FIELDS)) if (typeof tune?.[field] === type) out[field] = tune[field];
    return Object.keys(out).length ? out : null;
}

/** The script as it is, kept in this browser half a second after the last change (back after a reload). */
function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
        const lines = state.lines.map(line => ({ text: line.text, emotion: line.emotion, speaker: line.speaker, ...(line.tune ? { tune: line.tune } : {}) }));
        try {
            if (lines.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ format: 1, lines, groupKey: state.groupKey, ...runSection?.draft() }));
            else localStorage.removeItem(DRAFT_KEY);
        } catch (_) { /* a convenience: the script still works without it */ }
    }, 500);
}

/** The draft kept last time, once the panel is first made; lines without text or with a bad shape are left out. */
function loadDraft() {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { return; }
    if (draft?.format !== 1 || !Array.isArray(draft.lines)) return;
    state.lines = draft.lines.filter(line => typeof line?.text === 'string' && line.text.trim()).map(line => ({
        text: line.text,
        emotion: typeof line.emotion === 'string' ? line.emotion : 'main',
        take: 1,
        speaker: typeof line.speaker === 'string' ? line.speaker : null,
        ...(cleanTune(line.tune) ? { tune: cleanTune(line.tune) } : {}),
    }));
    if (typeof draft.groupKey === 'string') state.groupKey = draft.groupKey;
    const cast = {};
    for (const [character, own] of Object.entries(draft.cast || {})) if (cleanTune(own)) cast[character] = cleanTune(own);
    runSection.restoreDraft({ script: cleanTune(draft.script) || {}, cast });
    state.editing = !state.lines.length;
}

// ---------- actions ----------

function parseScript(text) {
    const parsed = splitScriptLines(text, state.splitMode);
    if (!parsed.length) return;
    // A line kept word for word keeps who reads it and how.
    const previous = new Map(state.lines.map(line => [line.text.trim(), line]));
    state.lines = parsed.map((lineText) => {
        const before = previous.get(lineText);
        return {
            text: lineText,
            emotion: before?.emotion || 'main',
            take: before?.take || 1,
            speaker: before?.speaker || state.groupKey,
            ...(before?.tune ? { tune: { ...before.tune } } : {}),
        };
    });
    state.picked = new Set();
    state.editing = false;
    renderAll();
}

function previewLine(line, slices, btn) {
    if (previewButton === btn) {
        stopScriptDirectorPreview();
        return;
    }
    stopScriptDirectorPreview();
    const slice = slices.get(line.emotion);
    if (!slice?.audio_url) return;
    hooks.onPreviewStart?.();
    const audio = new Audio(slice.audio_url);
    previewAudio = audio;
    previewButton = btn;
    btn.innerHTML = ICONS.STOP;
    btn.classList.add('is-playing');
    const done = () => { if (previewAudio === audio) stopScriptDirectorPreview(); };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
}
