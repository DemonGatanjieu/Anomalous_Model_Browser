import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { comboValueForPath, composeScript, planScriptVoices, splitScriptLines } from './audio_script.js';

/**
 * Script Director: split a script into lines, tag each line with a voice from
 * the Audio Studio, and write the tagged script into an F5TTSAudio node.
 *
 * ComfyUI-F5-TTS resolves `{happy}` to `<sample stem>.happy.wav` beside the
 * selected sample, so one script can only use one character's voices and the
 * node's `sample` must be that character's main file (`Arona.wav`).
 * The panel and its lines live for the page session; the studio re-attaches it.
 */

const TARGET_NODE_TYPE = 'F5TTSAudio';
const TARGET_WIDGET = 'speech';
const SAMPLE_WIDGET = 'sample';

let scriptDirectorPanel = null;
let linesContainer = null;
let injectButton = null;
let scriptLines = [];
let activeLineIndex = null;
let stateListener = null;

function notifyState() {
    stateListener?.(isScriptDirectorActive());
}

export function setScriptDirectorStateListener(listener) {
    stateListener = typeof listener === 'function' ? listener : null;
}

export function openScriptDirector(parentContainer) {
    if (!scriptDirectorPanel) createScriptDirectorUI();
    if (scriptDirectorPanel.parentNode !== parentContainer) parentContainer.appendChild(scriptDirectorPanel);
    scriptDirectorPanel.hidden = false;
    notifyState();
}

export function closeScriptDirector() {
    if (scriptDirectorPanel) scriptDirectorPanel.hidden = true;
    notifyState();
}

export function isScriptDirectorActive() {
    return Boolean(scriptDirectorPanel && !scriptDirectorPanel.hidden && scriptDirectorPanel.isConnected);
}

/** Called by the studio when a voice row is clicked while the director is open. */
export function handleVoiceSelectionForScript({ character, group, mainPath, tag, usable }) {
    if (activeLineIndex === null || !scriptLines[activeLineIndex] || !tag) return;
    scriptLines[activeLineIndex].voice = { character, group, mainPath, tag, usable: Boolean(usable) };
    const next = scriptLines.findIndex((line, index) => index > activeLineIndex && !line.voice);
    if (next !== -1) activeLineIndex = next;
    renderLines();
}

function createButton(label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `anomalous-sd-btn ${className}`.trim();
    btn.textContent = label;
    btn.onclick = onClick;
    return btn;
}

function createScriptDirectorUI() {
    scriptDirectorPanel = document.createElement('div');
    scriptDirectorPanel.className = 'anomalous-script-director-panel';
    scriptDirectorPanel.hidden = true;

    const header = document.createElement('div');
    header.className = 'anomalous-sd-header';

    const titleGroup = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'anomalous-sd-title';
    title.textContent = t('scriptDirectorTitle');
    const subtitle = document.createElement('div');
    subtitle.className = 'anomalous-sd-subtitle';
    subtitle.textContent = t('scriptDirectorSubtitle');
    titleGroup.append(title, subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'anomalous-sd-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = t('scriptDirectorClose');
    closeBtn.setAttribute('aria-label', t('scriptDirectorClose'));
    closeBtn.onclick = closeScriptDirector;
    header.append(titleGroup, closeBtn);

    const inputContainer = document.createElement('div');
    inputContainer.className = 'anomalous-sd-input-area';

    const textarea = document.createElement('textarea');
    textarea.className = 'anomalous-sd-textarea';
    textarea.placeholder = t('scriptDirectorInputPlaceholder');

    inputContainer.append(textarea, createButton(t('scriptDirectorParse'), 'primary', () => parseScriptText(textarea.value)));

    linesContainer = document.createElement('div');
    linesContainer.className = 'anomalous-sd-lines-container';

    const footer = document.createElement('div');
    footer.className = 'anomalous-sd-footer';
    injectButton = createButton(t('scriptDirectorInject'), 'accent', injectToNode);
    footer.append(createButton(t('scriptDirectorClear'), '', () => {
        scriptLines = [];
        activeLineIndex = null;
        textarea.value = '';
        renderLines();
    }), injectButton);

    scriptDirectorPanel.append(header, inputContainer, linesContainer, footer);
    renderLines();
}

function parseScriptText(text) {
    const lines = splitScriptLines(text);
    if (!lines.length) return;
    scriptLines = lines.map(line => ({ text: line, voice: null }));
    activeLineIndex = 0;
    renderLines();
}

function renderLines() {
    if (!linesContainer) return;
    if (!scriptLines.length) {
        const empty = document.createElement('div');
        empty.className = 'anomalous-sd-empty';
        empty.textContent = t('scriptDirectorEmpty');
        linesContainer.replaceChildren(empty);
        return;
    }
    linesContainer.replaceChildren(...scriptLines.map((line, index) => {
        const card = document.createElement('div');
        card.className = 'anomalous-sd-line-card';
        card.classList.toggle('active', activeLineIndex === index);
        card.onclick = () => {
            activeLineIndex = index;
            renderLines();
        };

        const badge = document.createElement('div');
        badge.className = 'anomalous-sd-voice-badge';
        const voiceName = document.createElement('span');
        voiceName.className = 'voice-name';
        if (line.voice) {
            badge.classList.add('has-voice');
            voiceName.textContent = `${line.voice.character} · ${line.voice.tag}`;
        } else {
            voiceName.classList.add('placeholder');
            voiceName.textContent = t('scriptDirectorNoVoice');
        }
        badge.appendChild(voiceName);

        const textElem = document.createElement('div');
        textElem.className = 'anomalous-sd-line-text';
        textElem.textContent = line.text;

        card.append(badge, textElem);
        return card;
    }));
}

function findTargetNode() {
    const nodes = app.graph?.findNodesByType?.(TARGET_NODE_TYPE) || [];
    if (!nodes.length) return { error: 'scriptDirectorNoNode' };
    const selected = Object.values(app.canvas?.selected_nodes || {}).filter(node => node?.type === TARGET_NODE_TYPE);
    if (selected.length === 1) return { node: selected[0] };
    if (nodes.length === 1) return { node: nodes[0] };
    return { error: 'scriptDirectorPickNode' };
}

async function injectToNode() {
    if (!scriptLines.length) return;
    const plan = planScriptVoices(scriptLines);
    if (plan.error) {
        await anomalousAlert(t(plan.error));
        return;
    }
    const script = composeScript(scriptLines);
    const graph = app.graph;
    const { node, error } = findTargetNode();
    if (error) {
        await anomalousAlert(t(error));
        return;
    }
    const speechWidget = node.widgets?.find(w => w.name === TARGET_WIDGET);
    const sampleWidget = node.widgets?.find(w => w.name === SAMPLE_WIDGET);
    if (!speechWidget || (plan.mainPath && !sampleWidget)) {
        await anomalousAlert(t('scriptDirectorNoNode'));
        return;
    }
    const sampleValue = plan.mainPath ? comboValueForPath(sampleWidget, plan.mainPath) : null;
    if (plan.mainPath && sampleValue == null) {
        await anomalousAlert(t('scriptDirectorSampleNotListed', { file: plan.mainPath }));
        return;
    }

    const previous = speechWidget.value;
    if (typeof previous === 'string' && previous.trim() && previous.trim() !== script) {
        if (!await anomalousConfirm(t('scriptDirectorOverwriteConfirm'))) return;
        // The canvas may have changed while the dialog was open.
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || speechWidget.value !== previous) return;
    }

    if (sampleValue != null && sampleWidget.value !== sampleValue) {
        sampleWidget.value = sampleValue;
        sampleWidget.callback?.(sampleValue, app.canvas, node);
    }
    speechWidget.value = script;
    speechWidget.callback?.(script, app.canvas, node);
    node.setDirtyCanvas?.(true, true);

    const originalText = t('scriptDirectorInject');
    injectButton.textContent = t('scriptDirectorSuccess');
    injectButton.classList.add('is-success');
    setTimeout(() => {
        injectButton.textContent = originalText;
        injectButton.classList.remove('is-success');
    }, 2000);
}
