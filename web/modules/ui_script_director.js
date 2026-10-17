import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { buildScriptPackage, joinSegments, splitScriptLines, splitSegmentAt, usableEmotions } from './audio_script.js';
import { TTS_ENGINE, voiceGroupKey } from './audio_engines.js';
import { pickLines, speakerChip, speakerColor } from './ui_script_cast.js';
import { createRunSection } from './ui_script_run.js';
import { bindSplitBar } from './ui_split_bar.js';
import { bindPackageDrag, copyScript, pushToNode } from './ui_script_workflow.js';

/**
 * The script director, the body of the Voices page's Voice-over view (ui_script_page.js):
 * pick who reads by default, paste a script, choose an emotion per line on the line cards,
 * give picked lines to other characters from the list on the left (the cast, ui_script_cast.js),
 * then generate it right here (ui_script_run.js), or put the tagged script into the
 * workflow (ui_script_workflow.js). The panel and its lines live for the page
 * session; the page mounts it again each time it is shown.
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
    groupKey: null,
    lines: [],          // { text, emotion, take, speaker } — take > 1: retaken; speaker: a group key, null = the default
    editing: true,
    splitMode: 'sentence',
    focusIndex: null,   // card whose text box should receive focus after the next render
    listenIndex: 0,     // the line the modes are heard on (ui_script_run.js)
    picked: new Set(),  // lines picked to give to a character (castScriptCharacter)
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

/** The voice group key of who speaks. */
export function scriptCharacter() {
    return state.groupKey;
}

/** Lines to voice again (a generated file's `{ emotion, text, speaker? }` segments): one card per line. */
export function loadScriptLines(segments) {
    const lines = segments.flatMap(segment => String(segment.text || '').split(/\n+/)
        .map(text => ({ text: text.trim(), emotion: segment.emotion || 'main', take: 1, speaker: segment.speaker ? voiceGroupKey(segment.speaker) : null })))
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
 * A character clicked in the list on Voice-over: it reads the picked lines, or, with none
 * picked, it becomes the one who reads by default.
 */
export function castScriptCharacter(key) {
    const group = state.groups.find(item => item.group === key);
    if (!group) return;
    stopScriptDirectorPreview();
    if (state.picked.size && state.lines.length && !state.editing) {
        for (const index of state.picked) {
            const line = state.lines[index];
            if (!line) continue;
            line.speaker = key === state.groupKey ? null : key;
            if (!usableEmotions(group).includes(line.emotion)) line.emotion = 'main';
        }
    } else {
        chooseDefault(key);
    }
    if (panel) renderAll();
}

/** Who reads the lines not given to anyone; lines given to that character before follow it now. */
function chooseDefault(key) {
    if (state.groupKey === key) return;
    state.groupKey = key;
    for (const line of state.lines) if (line.speaker === key) line.speaker = null;
    hooks.onCharacterChange?.();
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

function selectedGroup() {
    return state.groups.find(group => group.group === state.groupKey) || null;
}

/** Who reads `line`: the character it was given to, else the default one. */
function speakerOf(line) {
    return (line?.speaker && state.groups.find(group => group.group === line.speaker)) || selectedGroup();
}

/** Whether some line is read by another character than the default one (the cards then say who). */
function hasCast() {
    return state.lines.some(line => line.speaker && line.speaker !== state.groupKey);
}

/** The script with retakes, for a run in the director. */
function runScript() {
    const group = selectedGroup();
    return {
        group, lines: state.lines, listen: state.listenIndex, speakerOf,
        pkg: buildScriptPackage(state.lines, group, { takes: true, groups: state.groups }),
    };
}

function emotionLabel(emotion) {
    return emotion === 'main' ? t('scriptDirectorMainEmotion') : emotion;
}

function currentPackage() {
    return buildScriptPackage(state.lines, selectedGroup(), { groups: state.groups });
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

    const characterBar = el('label', 'anomalous-sd-character-bar');
    const characterSelect = el('select', 'anomalous-sd-character-select');
    characterSelect.onchange = () => {
        stopScriptDirectorPreview();
        chooseDefault(characterSelect.value);
        renderAll();
    };
    const characterHint = el('div', 'anomalous-sd-character-hint');
    characterBar.append(el('span', 'anomalous-sd-step', t('scriptDirectorCharacter')), characterSelect);
    // Who reads and what voices they have, on one row.
    const who = el('div', 'anomalous-sd-who');
    who.append(characterBar, characterHint);

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
    inputArea.append(textarea, inputActions);

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
    // One voice only: emotion chips would all say "main", so one line says how to get more.
    const onlyMain = el('div', 'anomalous-sd-only-main');

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
        getGroups: () => state.groups,
        onPlay: () => {
            stopLinePreview();
            hooks.onPreviewStart?.();
        },
        resetTakes: () => state.lines.forEach(line => { line.take = 1; }),
        onBusyChange: () => renderAll(),
        openGallery: () => hooks.openGallery?.(),
    });
    scroll.append(linesContainer);
    footer.append(summary, runSection.bar);

    // Cards on one side, everything about generating on the other: below the cards
    // on a narrow page (docked browser), beside them once the page is wide.
    const main = el('div', 'anomalous-sd-main');
    main.append(linesBar, onlyMain, scroll);
    const side = el('div', 'anomalous-sd-side');
    side.append(footer, runSection.settings, workflow);
    const body = el('div', 'anomalous-sd-body');
    const splitter = el('div', 'anomalous-sd-splitter');
    splitter.title = t('scriptDirectorSplitter');
    body.append(main, splitter, side);
    bindSplitBar(splitter, { owner: panel, body, prop: '--sd-side-width', key: SIDE_WIDTH_KEY });
    // The panel lives for the page session, so the observer does too.
    new ResizeObserver(([entry]) => panel.classList.toggle('is-wide', entry.contentRect.width >= WIDE_FROM)).observe(panel);

    panel.append(header, who, inputArea, body);
    // Esc lets go of the picked lines first; the browser's own Esc leaves it to this then (ui_browser_navigation.js).
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !state.picked.size || !panel.getClientRects().length) return;
        state.picked = new Set();
        refs.linesContainer.querySelectorAll('.anomalous-sd-line-card.is-picked').forEach(card => card.classList.remove('is-picked'));
        renderCastHint();
    });
    refs = { subtitle, characterSelect, characterHint, inputArea, textarea, cancelEdit, body, linesCount, castHint, onlyMain, linesContainer, summary, workflowTitle, dragHandle, copyBtn, pushBtn };
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
    renderCharacterBar();
    const hasLines = state.lines.length > 0;
    refs.inputArea.hidden = hasLines && !state.editing;
    refs.cancelEdit.hidden = !hasLines;
    refs.body.hidden = !hasLines || state.editing;
    refs.linesCount.textContent = t('scriptDirectorLinesCount', { count: state.lines.length });
    if (hasLines && !state.editing) renderLines();
    renderPackage();
}

function renderCharacterBar() {
    const select = refs.characterSelect;
    select.replaceChildren(...state.groups.map(group => {
        const option = el('option', '', group.character);
        option.value = group.group;
        return option;
    }));
    select.disabled = state.groups.length === 0;
    if (state.groupKey) select.value = state.groupKey;

    const group = selectedGroup();
    let hint = '';
    if (!state.groups.length) hint = t('scriptDirectorNoCharacters');
    else if (group && !usableEmotions(group).includes('main')) hint = t('scriptDirectorMainMissing');
    else if (group) hint = t('scriptDirectorEmotionsAvailable', { emotions: usableEmotions(group).map(emotionLabel).join(' · ') });
    refs.characterHint.textContent = hint;
    refs.characterHint.classList.toggle('is-warning', Boolean(group && !usableEmotions(group).includes('main')) || !state.groups.length);
}

function renderLines() {
    // Chips only when there is a choice, or a line still asks for an emotion its character lacks.
    const showChips = state.lines.some((line) => {
        const emotions = usableEmotions(speakerOf(line));
        return emotions.length > 1 || !emotions.includes(line.emotion);
    });
    refs.onlyMain.hidden = showChips;
    refs.onlyMain.textContent = t('scriptDirectorOnlyMain');
    const addLine = button('anomalous-sd-add-line', t('scriptDirectorAddLine'), () => {
        const last = state.lines.at(-1);
        state.lines.push({ text: '', emotion: last?.emotion || 'main', take: 1, speaker: last?.speaker || null });
        state.focusIndex = state.lines.length - 1;
        state.picked = new Set();
        renderAll();
    });
    if (state.listenIndex >= state.lines.length) state.listenIndex = 0;
    state.picked = new Set([...state.picked].filter(index => index < state.lines.length));
    const cast = hasCast();
    refs.linesContainer.replaceChildren(...state.lines.map((line, index) => renderLineCard(line, index, showChips, cast)), addLine);
    renderCastHint();
    if (state.focusIndex !== null) {
        refs.linesContainer.querySelectorAll('.anomalous-sd-line-text')[state.focusIndex]?.focus();
        state.focusIndex = null;
    }
}

function renderLineCard(line, index, showChips, cast) {
    const speaker = speakerOf(line);
    const emotions = usableEmotions(speaker);
    const slices = new Map((speaker?.slices || []).map(slice => [slice.emotion, slice]));
    const card = el('div', `anomalous-sd-line-card${index === state.listenIndex ? ' is-listen' : ''}${state.picked.has(index) ? ' is-picked' : ''}`);
    // The line you are on is the one the modes are heard on; a click also picks it for the cast.
    card.addEventListener('focusin', () => chooseListenLine(index));
    card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) pickLine(index, e);
    });
    if (cast) {
        card.classList.add('has-speaker');
        card.style.setProperty('--speaker', speakerColor(speaker?.group, state.groups));
    }

    // Editing buttons (.is-edit) show on hover; another take of this line stays visible.
    const head = el('div', 'anomalous-sd-line-head');
    head.append(
        el('span', 'anomalous-sd-line-no', `#${index + 1}`),
        ...(cast ? [speakerChip(speaker, speakerColor(speaker?.group, state.groups))] : []),

        // Split at the text caret (the textarea keeps its caret after losing focus to this button).
        button('anomalous-sd-icon-btn is-edit', '✂', async () => {
            const parts = splitSegmentAt(line.text, text.selectionStart);
            if (!parts) {
                await anomalousAlert(t('scriptDirectorSplitHint'));
                text.focus();
                return;
            }
            line.text = parts[0];
            state.lines.splice(index + 1, 0, { text: parts[1], emotion: line.emotion, take: 1, speaker: line.speaker || null });
            state.picked = new Set();
            state.focusIndex = index + 1;
            stopScriptDirectorPreview();
            renderAll();
        }, t('scriptDirectorSplitAtCaret')),
    );
    if (index < state.lines.length - 1) {
        // Merge keeps this card's emotion: one card = one segment spoken with one voice.
        head.append(button('anomalous-sd-icon-btn is-edit', '↧', () => {
            line.text = joinSegments(line.text, state.lines[index + 1].text);
            state.lines.splice(index + 1, 1);
            state.picked = new Set();
            stopScriptDirectorPreview();
            renderAll();
        }, t('scriptDirectorMergeNext')));
    }
    if (runSection?.canListen()) {
        // This line in the mode picked on the side; the side keeps the takes heard to compare.
        head.append(button('anomalous-sd-icon-btn anomalous-sd-line-play', '▶', () => {
            chooseListenLine(index);
            runSection.listen();
        }, t('scriptDirectorListenLine')));
    }
    if (runSection?.canRetake(selectedGroup())) {
        const retake = button('anomalous-sd-icon-btn', '↻', () => {
            line.take = (line.take || 1) + 1;
            runSection.generate();
        }, t('scriptRunRetakeLine'));
        if (line.take > 1) retake.append(el('span', 'anomalous-sd-take-no', String(line.take)));
        head.append(retake);
    }
    head.append(
        button('anomalous-sd-icon-btn is-edit is-danger', '×', () => {
            state.lines.splice(index, 1);
            state.picked = new Set();
            stopScriptDirectorPreview();
            renderAll();
        }, t('scriptDirectorDeleteLine')),
    );

    const text = el('textarea', 'anomalous-sd-line-text');
    text.rows = 1;
    text.value = line.text;
    text.oninput = () => {
        line.text = text.value;
        renderPackage();
    };

    if (!showChips) {
        card.append(head, text);
        return card;
    }
    const chips = el('div', 'anomalous-sd-emotion-row');
    // The reference clip of the chosen emotion: how this voice sounds, not this line's result.
    const reference = button('anomalous-sd-ref-btn', '', () => previewLine(line, slices, reference),
        t('scriptDirectorPreviewEmotion', { emotion: emotionLabel(line.emotion) }));
    reference.innerHTML = ICONS.SPEAKER;
    // A choice this character cannot voice stays visible (and blocks the bundle) instead of being silently reset.
    const choices = emotions.includes(line.emotion) ? emotions : [...emotions, line.emotion];
    for (const emotion of choices) {
        const chip = button('anomalous-sd-emotion-chip', emotionLabel(emotion), () => {
            line.emotion = emotion;
            chips.querySelectorAll('.anomalous-sd-emotion-chip').forEach(item => item.classList.toggle('active', item === chip));
            if (previewButton === reference) stopScriptDirectorPreview();
            reference.title = t('scriptDirectorPreviewEmotion', { emotion: emotionLabel(emotion) });
            reference.setAttribute('aria-label', reference.title);
            reference.disabled = !slices.get(emotion)?.audio_url;
            renderPackage();
        });
        chip.classList.toggle('active', line.emotion === emotion);
        chip.classList.toggle('is-main', emotion === 'main');
        if (!emotions.includes(emotion)) {
            chip.classList.add('is-missing');
            chip.title = t('scriptDirectorEmotionMissing');
        }
        const sample = slices.get(emotion);
        if (sample?.text) chip.title = sample.text;
        chips.appendChild(chip);
    }
    reference.disabled = !slices.get(line.emotion)?.audio_url;
    chips.appendChild(reference);

    card.append(head, text, chips);
    return card;
}

/** A click on a card: picks it (Ctrl / ⌘ adds, Shift a run) and makes it the line to listen with. */
function pickLine(index, event) {
    state.picked = pickLines(state.picked, index, event, state.anchor);
    if (!event.shiftKey) state.anchor = index;
    refs.linesContainer.querySelectorAll('.anomalous-sd-line-card').forEach((card, at) => card.classList.toggle('is-picked', state.picked.has(at)));
    renderCastHint();
    chooseListenLine(index);
}

/** What a click on the list does now: give the picked lines, or (none picked) change who reads by default. */
function renderCastHint() {
    refs.castHint.hidden = state.groups.length < 2;
    refs.castHint.textContent = state.picked.size
        ? t('scriptCastPicked', { count: state.picked.size })
        : t('scriptCastHint');
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
    refs.copyBtn.disabled = !ok;
    refs.pushBtn.disabled = !ok;
    refs.dragHandle.draggable = ok;
    refs.dragHandle.classList.toggle('is-disabled', !ok);
    runSection.render();
}

// ---------- actions ----------

function parseScript(text) {
    const parsed = splitScriptLines(text, state.splitMode);
    if (!parsed.length) return;
    const previous = new Map(state.lines.map(line => [line.text.trim(), line]));
    state.lines = parsed.map(lineText => ({
        text: lineText,
        emotion: previous.get(lineText)?.emotion || 'main',
        take: previous.get(lineText)?.take || 1,
        speaker: previous.get(lineText)?.speaker || null,
    }));
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
