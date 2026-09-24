import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { buildScriptPackage, comboValueForPath, joinSegments, splitScriptLines, splitSegmentAt, usableEmotions } from './audio_script.js';
import { isScriptTarget, targetForNode } from './audio_node_targets.js';
import { engineById } from './audio_engines.js';
import { bindMaterialDrag } from './material_drag.js';

/**
 * Script Director: paste a script, pick one character, choose an emotion per
 * line on the line cards, then push the bundle to an F5-TTS node or drag it
 * onto one (supported nodes: audio_node_targets.js). ComfyUI-F5-TTS resolves `{happy}` to `<sample>.happy.wav`, so the
 * node's `sample` becomes the character's main voice and `speech` the tagged text.
 * The panel and its lines live for the page session; the studio re-attaches it.
 */

const ICONS = {
    PLAY: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    STOP: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`,
    GRIP: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
};

const state = {
    engine: 'f5',       // audio_engines.js id; decides which nodes the bundle may go to
    groups: [],
    groupKey: null,
    lines: [],          // { text, emotion }
    editing: true,
    splitMode: 'sentence',
    focusIndex: null,   // card whose text box should receive focus after the next render
};

let panel = null;
let refs = null;
let hooks = {};
let previewAudio = null;
let previewButton = null;
// bindMaterialDrag hides the browser modal while dragging; the owner is only known once the studio sets hooks.
const dragOwner = { get modal() { return hooks.owner?.modal; } };

// ---------- public API ----------

/** `{ owner, onStateChange(open), onPreviewStart() }` from the studio. */
export function setScriptDirectorHooks(next) {
    hooks = next || {};
}

export function openScriptDirector(parentContainer) {
    if (!panel) createPanel();
    if (panel.parentNode !== parentContainer) parentContainer.appendChild(panel);
    panel.hidden = false;
    renderAll();
    hooks.onStateChange?.(true);
}

export function closeScriptDirector() {
    stopScriptDirectorPreview();
    if (panel) panel.hidden = true;
    hooks.onStateChange?.(false);
}

export function isScriptDirectorActive() {
    return Boolean(panel && !panel.hidden && panel.isConnected);
}

/** Called by the studio after each voice fetch; keeps the chosen character when it still exists. */
export function updateScriptDirectorVoices(groups, preferredGroup = null, engine = null) {
    if (engine && engine !== state.engine) {
        state.engine = engine;
        state.groupKey = null;
    }
    state.groups = Array.isArray(groups) ? groups : [];
    const exists = key => state.groups.some(group => group.group === key);
    if (!exists(state.groupKey)) {
        state.groupKey = (preferredGroup && exists(preferredGroup) ? preferredGroup : null)
            || state.groups.find(group => usableEmotions(group).includes('main'))?.group
            || state.groups[0]?.group
            || null;
    }
    if (panel) renderAll();
}

export function stopScriptDirectorPreview() {
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
    }
    if (previewButton) {
        previewButton.innerHTML = ICONS.PLAY;
        previewButton.classList.remove('is-playing');
        previewButton = null;
    }
}

// ---------- state helpers ----------

function selectedGroup() {
    return state.groups.find(group => group.group === state.groupKey) || null;
}

/** Node name shown in every hint, e.g. "F5-TTS" or "GPT-SoVITS". */
function nodeLabel() {
    return engineById(state.engine)?.label || state.engine;
}

/** Engine-specific wording for the few messages whose advice differs per engine. */
function engineKey(key) {
    return state.engine === 'gpt_sovits' && ['scriptDirectorMainMissing', 'scriptDirectorNoCharacters'].includes(key)
        ? `${key}GptSovits`
        : key;
}

function emotionLabel(emotion) {
    return emotion === 'main' ? t('scriptDirectorMainEmotion') : emotion;
}

function currentPackage() {
    return buildScriptPackage(state.lines, selectedGroup());
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
    panel.hidden = true;

    const header = el('div', 'anomalous-sd-header');
    const titleGroup = el('div');
    const subtitle = el('div', 'anomalous-sd-subtitle');
    titleGroup.append(el('div', 'anomalous-sd-title', t('scriptDirectorTitle')), subtitle);
    header.append(titleGroup, button('anomalous-sd-close-btn', '×', closeScriptDirector, t('scriptDirectorClose')));

    const characterBar = el('label', 'anomalous-sd-character-bar');
    const characterSelect = el('select', 'anomalous-sd-character-select');
    characterSelect.onchange = () => {
        state.groupKey = characterSelect.value;
        stopScriptDirectorPreview();
        renderAll();
    };
    const characterHint = el('div', 'anomalous-sd-character-hint');
    characterBar.append(el('span', 'anomalous-sd-step', t('scriptDirectorCharacter')), characterSelect);

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
    linesBar.append(linesCount, button('anomalous-sd-link-btn', t('scriptDirectorEdit'), () => {
        textarea.value = state.lines.map(line => line.text).join('\n');
        state.editing = true;
        renderAll();
        textarea.focus();
    }));

    const linesContainer = el('div', 'anomalous-sd-lines-container');

    const footer = el('div', 'anomalous-sd-footer');
    const summary = el('div', 'anomalous-sd-package-summary');
    const preview = el('pre', 'anomalous-sd-package-preview');
    const actions = el('div', 'anomalous-sd-package-actions');
    const dragHandle = el('div', 'anomalous-sd-drag-handle');
    dragHandle.innerHTML = ICONS.GRIP;
    dragHandle.append(el('span', '', t('scriptDirectorDragHandle')));
    bindPackageDrag(dragHandle);
    const copyBtn = button('anomalous-sd-btn', t('scriptDirectorCopy'), copyScript);
    const pushBtn = button('anomalous-sd-btn accent', t('scriptDirectorInject'), pushToNode);
    actions.append(dragHandle, copyBtn, pushBtn);
    footer.append(summary, preview, actions);

    panel.append(header, characterBar, characterHint, inputArea, linesBar, linesContainer, footer);
    refs = { subtitle, characterSelect, characterHint, inputArea, textarea, cancelEdit, linesBar, linesCount, linesContainer, footer, summary, preview, dragHandle, copyBtn, pushBtn };
}

function renderAll() {
    if (!panel) return;
    const node = nodeLabel();
    refs.subtitle.textContent = t('scriptDirectorSubtitle', { node });
    refs.dragHandle.title = t('scriptDirectorDragHint', { node });
    refs.pushBtn.title = t('scriptDirectorPushHint', { node });
    refs.pushBtn.setAttribute('aria-label', refs.pushBtn.title);
    renderCharacterBar();
    const hasLines = state.lines.length > 0;
    refs.inputArea.hidden = hasLines && !state.editing;
    refs.cancelEdit.hidden = !hasLines;
    refs.linesBar.hidden = !hasLines || state.editing;
    refs.linesContainer.hidden = !hasLines || state.editing;
    refs.footer.hidden = !hasLines || state.editing;
    refs.linesCount.textContent = t('scriptDirectorLinesCount', { count: state.lines.length });
    if (hasLines && !state.editing) renderLines();
    renderPackage();
}

function renderCharacterBar() {
    const select = refs.characterSelect;
    select.replaceChildren(...state.groups.map(group => {
        const showFolder = group.engine !== 'gpt_sovits' && group.folder && group.folder !== 'F5-TTS';
        const option = el('option', '', showFolder ? `${group.character} · ${group.folder}` : group.character);
        option.value = group.group;
        return option;
    }));
    select.disabled = state.groups.length === 0;
    if (state.groupKey) select.value = state.groupKey;

    const group = selectedGroup();
    let hint = '';
    if (!state.groups.length) hint = t(engineKey('scriptDirectorNoCharacters'));
    else if (group && !usableEmotions(group).includes('main')) {
        hint = state.engine === 'gpt_sovits' ? t('scriptDirectorMainMissingGptSovits') : t('audioMainMissing', { file: `${group.character}.wav` });
    }
    else if (group) hint = t('scriptDirectorEmotionsAvailable', { emotions: usableEmotions(group).map(emotionLabel).join(' · ') });
    refs.characterHint.textContent = hint;
    refs.characterHint.classList.toggle('is-warning', Boolean(group && !usableEmotions(group).includes('main')) || !state.groups.length);
}

function renderLines() {
    const group = selectedGroup();
    const emotions = usableEmotions(group);
    const slices = new Map((group?.slices || []).map(slice => [slice.emotion, slice]));
    const addLine = button('anomalous-sd-add-line', t('scriptDirectorAddLine'), () => {
        state.lines.push({ text: '', emotion: state.lines.at(-1)?.emotion || 'main' });
        state.focusIndex = state.lines.length - 1;
        renderAll();
    });
    refs.linesContainer.replaceChildren(...state.lines.map((line, index) => renderLineCard(line, index, emotions, slices)), addLine);
    if (state.focusIndex !== null) {
        refs.linesContainer.querySelectorAll('.anomalous-sd-line-text')[state.focusIndex]?.focus();
        state.focusIndex = null;
    }
}

function renderLineCard(line, index, emotions, slices) {
    const card = el('div', 'anomalous-sd-line-card');

    const head = el('div', 'anomalous-sd-line-head');
    const previewBtn = button('anomalous-sd-icon-btn', '', () => previewLine(line, slices, previewBtn), t('scriptDirectorPreview'));
    previewBtn.innerHTML = ICONS.PLAY;
    head.append(
        el('span', 'anomalous-sd-line-no', `#${index + 1}`),
        previewBtn,
        // Split at the text caret (the textarea keeps its caret after losing focus to this button).
        button('anomalous-sd-icon-btn', '✂', async () => {
            const parts = splitSegmentAt(line.text, text.selectionStart);
            if (!parts) {
                await anomalousAlert(t('scriptDirectorSplitHint'));
                text.focus();
                return;
            }
            line.text = parts[0];
            state.lines.splice(index + 1, 0, { text: parts[1], emotion: line.emotion });
            state.focusIndex = index + 1;
            stopScriptDirectorPreview();
            renderAll();
        }, t('scriptDirectorSplitAtCaret')),
    );
    if (index < state.lines.length - 1) {
        // Merge keeps this card's emotion: one card = one segment spoken with one voice.
        head.append(button('anomalous-sd-icon-btn', '↧', () => {
            line.text = joinSegments(line.text, state.lines[index + 1].text);
            state.lines.splice(index + 1, 1);
            stopScriptDirectorPreview();
            renderAll();
        }, t('scriptDirectorMergeNext')));
    }
    head.append(
        button('anomalous-sd-icon-btn is-danger', '×', () => {
            state.lines.splice(index, 1);
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

    const chips = el('div', 'anomalous-sd-emotion-row');
    // A choice this character cannot voice stays visible (and blocks the bundle) instead of being silently reset.
    const choices = emotions.includes(line.emotion) ? emotions : [...emotions, line.emotion];
    for (const emotion of choices) {
        const chip = button('anomalous-sd-emotion-chip', emotionLabel(emotion), () => {
            line.emotion = emotion;
            chips.querySelectorAll('.anomalous-sd-emotion-chip').forEach(item => item.classList.toggle('active', item === chip));
            if (previewButton === previewBtn) stopScriptDirectorPreview();
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

    card.append(head, text, chips);
    return card;
}

function renderPackage() {
    if (!refs) return;
    const pkg = currentPackage();
    const ok = !pkg.error;
    refs.summary.classList.toggle('is-error', !ok);
    if (ok) {
        const used = [...new Set(state.lines.filter(line => line.text.trim()).map(line => emotionLabel(line.emotion)))];
        refs.summary.textContent = t('scriptDirectorPackageSummary', { count: pkg.lineCount, emotions: used.join(' · ') });
        refs.preview.textContent = pkg.speech;
    } else {
        refs.summary.textContent = t(engineKey(pkg.error), { node: nodeLabel() });
        refs.preview.textContent = '';
    }
    refs.preview.hidden = !ok;
    refs.copyBtn.disabled = !ok;
    refs.pushBtn.disabled = !ok;
    refs.dragHandle.draggable = ok;
    refs.dragHandle.classList.toggle('is-disabled', !ok);
}

// ---------- actions ----------

function parseScript(text) {
    const parsed = splitScriptLines(text, state.splitMode);
    if (!parsed.length) return;
    const previous = new Map(state.lines.map(line => [line.text.trim(), line.emotion]));
    state.lines = parsed.map(lineText => ({ text: lineText, emotion: previous.get(lineText) || 'main' }));
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

async function copyScript() {
    const pkg = currentPackage();
    if (pkg.error || !navigator.clipboard?.writeText) return;
    try {
        await navigator.clipboard.writeText(pkg.speech);
        flash(refs.copyBtn, t('scriptDirectorCopied'), t('scriptDirectorCopy'));
    } catch (_) {
        // Clipboard permission refused: the preview text stays selectable.
    }
}

function flash(btn, text, restore) {
    btn.textContent = text;
    btn.classList.add('is-success');
    setTimeout(() => {
        btn.textContent = restore;
        btn.classList.remove('is-success');
    }, 1800);
}

function findTargetNode() {
    const fits = node => isScriptTarget(node, state.engine);
    const nodes = (app.graph?._nodes || []).filter(fits);
    if (!nodes.length) return { error: 'scriptDirectorNoNode' };
    const selected = Object.values(app.canvas?.selected_nodes || {}).filter(fits);
    if (selected.length === 1) return { node: selected[0] };
    if (nodes.length === 1) return { node: nodes[0] };
    return { error: 'scriptDirectorPickNode' };
}

async function pushToNode() {
    const pkg = currentPackage();
    if (pkg.error) return;
    const { node, error } = findTargetNode();
    if (error) {
        await anomalousAlert(t(error, { node: nodeLabel() }));
        return;
    }
    if (await applyPackageToNode(node, pkg)) flash(refs.pushBtn, t('scriptDirectorSuccess'), t('scriptDirectorInject'));
}

/** Write sample + speech into one node; re-checks the node after any dialog. Returns true when written. */
async function applyPackageToNode(node, pkg) {
    const graph = app.graph;
    const target = isScriptTarget(node, state.engine) ? targetForNode(node) : null;
    const speechWidget = target && node.widgets?.find(w => w.name === target.speechWidget);
    const sampleWidget = target && node.widgets?.find(w => w.name === target.voiceWidget);
    if (!speechWidget || !sampleWidget) {
        await anomalousAlert(t('scriptDirectorDropNotTts', { node: nodeLabel() }));
        return false;
    }
    if (target.overriddenBy && node.inputs?.some(input => input?.name === target.overriddenBy && input.link != null)) {
        await anomalousAlert(t('scriptDirectorOverridden', { input: target.overriddenBy }));
        return false;
    }
    const sampleValue = comboValueForPath(sampleWidget, pkg.sample);
    if (sampleValue == null) {
        await anomalousAlert(t('scriptDirectorSampleNotListed', { file: pkg.sample, node: nodeLabel() }));
        return false;
    }
    const previous = speechWidget.value;
    if (typeof previous === 'string' && previous.trim() && previous.trim() !== pkg.speech) {
        if (!await anomalousConfirm(t('scriptDirectorOverwriteConfirm'))) return false;
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || speechWidget.value !== previous) return false;
    }
    if (sampleWidget.value !== sampleValue) {
        sampleWidget.value = sampleValue;
        sampleWidget.callback?.(sampleValue, app.canvas, node);
    }
    speechWidget.value = pkg.speech;
    speechWidget.callback?.(pkg.speech, app.canvas, node);
    node.setDirtyCanvas?.(true, true);
    return true;
}

// ---------- drag the bundle onto a canvas node ----------

function bindPackageDrag(handle) {
    bindMaterialDrag(handle, dragOwner, {
        payload: () => {
            const pkg = currentPackage();
            return pkg.error ? null : { ...pkg, dragHint: t('scriptDirectorDragHint', { node: nodeLabel() }) };
        },
        accepts: node => isScriptTarget(node, state.engine),
        drop: async node => {
            if (await applyPackageToNode(node, currentPackage())) flash(refs.pushBtn, t('scriptDirectorSuccess'), t('scriptDirectorInject'));
        },
    });
}
