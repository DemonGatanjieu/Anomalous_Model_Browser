import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { mergeGptSovitsSettings, saveGptSovitsSettings, ttsAudioUrl } from './audio_engines.js';

/**
 * GPT-SoVITS (Anomalous_TTS) emotion editor: pick one reference audio from the
 * character's folder for the main voice and for each emotion. The node owns the
 * file; this modal only sends the new settings through its API, keeping every
 * field it does not edit.
 */

let activeScope = null;
const FORBIDDEN_IN_NAME = /[{}[\]]/;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
    btn.onclick = onClick;
    return btn;
}

/** Audio path input with a searchable list of the character's files (folders can hold thousands). */
function audioInput(listId, value) {
    const input = el('input', 'anomalous-tts-audio-input');
    input.type = 'text';
    input.setAttribute('list', listId);
    input.placeholder = t('ttsEditorAudioPlaceholder');
    input.value = value || '';
    return input;
}

function textInput(value) {
    const input = el('input', 'anomalous-tts-text-input');
    input.type = 'text';
    input.placeholder = t('ttsEditorTextPlaceholder');
    input.value = value || '';
    return input;
}

/**
 * Open the editor for one GPT-SoVITS voice group (audio_engines.gptSovitsGroups shape).
 * `onSaved(group)` receives the refreshed group after the node accepted the settings.
 */
export function openGptSovitsEditor(group, { onSaved } = {}) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const raw = group.raw || {};
    const name = raw.name || group.character;
    const audioList = Array.isArray(raw.audio) ? raw.audio : [];
    const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    let player = null;

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-editor');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();
    scope.onDispose(() => {
        player?.pause();
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
        e.stopPropagation();
        close();
    }, true);

    const play = (input) => {
        player?.pause();
        const path = input.value.trim();
        if (!audioList.includes(path)) return;
        player = new Audio(ttsAudioUrl(name, path));
        player.play().catch(() => {});
    };

    // Header
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(
        el('div', 'anomalous-voice-modal-title', t('ttsEditorTitle', { name })),
        el('div', 'anomalous-voice-modal-subtitle', t('ttsEditorSubtitle')),
    );
    header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));

    const listId = `anomalous-tts-audio-${Math.random().toString(36).slice(2)}`;
    const datalist = el('datalist');
    datalist.id = listId;
    datalist.append(...audioList.map(path => { const option = el('option'); option.value = path; return option; }));

    // Main reference
    const mainRow = el('div', 'anomalous-tts-row is-main');
    const mainAudio = audioInput(listId, settings.reference?.audio);
    const mainText = textInput(settings.reference?.text);
    mainRow.append(
        el('span', 'anomalous-tts-row-name', '{main}'),
        mainAudio,
        button('anomalous-audio-play-btn', '▶', () => play(mainAudio), t('audioPlay')),
        mainText,
    );
    const mainHint = el('div', 'anomalous-tts-hint', raw.reference?.audio && !settings.reference?.audio
        ? t('ttsEditorMainAuto', { file: raw.reference.audio })
        : t('ttsEditorMainHint'));

    // Emotion rows
    const rowsBox = el('div', 'anomalous-tts-rows');
    const addRow = (row = {}) => {
        const line = el('div', 'anomalous-tts-row');
        const nameInput = el('input', 'anomalous-tts-name-input');
        nameInput.type = 'text';
        nameInput.placeholder = t('ttsEditorEmotionPlaceholder');
        nameInput.value = row.name || '';
        const audio = audioInput(listId, row.audio);
        const text = textInput(row.text);
        line.append(
            nameInput,
            audio,
            button('anomalous-audio-play-btn', '▶', () => play(audio), t('audioPlay')),
            text,
            button('anomalous-tts-remove', '×', () => line.remove(), t('ttsEditorRemove')),
        );
        rowsBox.appendChild(line);
        return nameInput;
    };
    for (const [emotion, ref] of Object.entries(settings.emotions || {})) {
        addRow({ name: emotion, audio: ref?.audio, text: ref?.text });
    }
    const addBtn = button('anomalous-tts-add', t('ttsEditorAdd'), () => addRow().focus());

    const autoEmotions = Object.entries(raw.emotions || {}).filter(([, ref]) => ref?.source === 'filename').map(([emotion]) => `{${emotion}}`);
    const autoNote = el('div', 'anomalous-tts-hint', autoEmotions.length ? t('ttsEditorFilenameEmotions', { emotions: autoEmotions.join(' ') }) : '');
    autoNote.hidden = !autoEmotions.length;

    // Footer
    const footer = el('div', 'anomalous-voice-modal-footer');
    const saveBtn = button('anomalous-voice-modal-submit', t('ttsEditorSave'), async () => {
        const rows = [...rowsBox.querySelectorAll('.anomalous-tts-row')].map(line => {
            const [nameInput, audio, , text] = line.querySelectorAll('input, button');
            return { name: nameInput.value.trim(), audio: audio.value.trim(), text: text.value.trim() };
        }).filter(row => row.name || row.audio);
        const problem = validateRows(rows, mainAudio.value.trim(), audioList);
        if (problem) {
            await anomalousAlert(problem);
            return;
        }
        const next = mergeGptSovitsSettings(settings, {
            main: mainAudio.value.trim() ? { audio: mainAudio.value.trim(), text: mainText.value.trim() } : null,
            emotions: rows,
        });
        saveBtn.disabled = true;
        try {
            const updated = await saveGptSovitsSettings(name, next);
            onSaved?.(updated);
            close();
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('ttsEditorSaveFailed', { error: e.message }));
        } finally {
            if (!scope.signal.aborted) saveBtn.disabled = false;
        }
    });
    footer.append(button('anomalous-voice-modal-cancel', t('dialogCancel'), close), saveBtn);

    const body = el('div', 'anomalous-tts-editor-body');
    body.append(
        datalist,
        el('div', 'anomalous-tts-section', t('ttsEditorMainSection')), mainRow, mainHint,
        el('div', 'anomalous-tts-section', t('ttsEditorEmotionSection')), rowsBox, addBtn, autoNote,
    );
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    (mainAudio.value ? addBtn : mainAudio).focus();
    return close;
}

/** First problem as a message, or '' when the rows can be saved. */
export function validateRows(rows, mainAudio, audioList) {
    const files = new Set(audioList);
    if (mainAudio && !files.has(mainAudio)) return t('ttsEditorUnknownAudio', { file: mainAudio });
    const seen = new Set();
    for (const row of rows) {
        if (!row.name) return t('ttsEditorNameMissing', { file: row.audio });
        if (row.name === 'main' || FORBIDDEN_IN_NAME.test(row.name)) return t('ttsEditorNameInvalid', { name: row.name });
        if (seen.has(row.name)) return t('ttsEditorNameDuplicate', { name: row.name });
        seen.add(row.name);
        if (!row.audio) return t('ttsEditorAudioMissing', { name: row.name });
        if (!files.has(row.audio)) return t('ttsEditorUnknownAudio', { file: row.audio });
    }
    return '';
}
