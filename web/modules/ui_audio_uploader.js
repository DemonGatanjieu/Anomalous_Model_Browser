import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';

/**
 * Voice ingestion modal: pick an audio file, name it as a ComfyUI-F5-TTS voice
 * (`Character.wav` for the main voice, `Character.<emotion>.wav` for variants),
 * enter its transcript, optionally romanize it, and save it to input/F5-TTS.
 */

const MAIN_VOICE = 'main';
const PRESET_EMOTIONS = [MAIN_VOICE, 'normal', 'happy', 'angry', 'sad', 'surprised', 'whisper'];
const TARGET_SUBFOLDER = 'F5-TTS';

let activeScope = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderModalHeader(onClose) {
    const header = el('div', 'anomalous-voice-modal-header');
    const info = el('div', 'anomalous-voice-modal-heading');
    info.append(
        el('div', 'anomalous-voice-modal-title', t('audioUploadModalTitle')),
        el('div', 'anomalous-voice-modal-subtitle', t('audioUploadModalSubtitle')),
    );
    const closeBtn = el('button', 'anomalous-voice-modal-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = t('close');
    closeBtn.setAttribute('aria-label', t('close'));
    closeBtn.onclick = onClose;
    header.append(info, closeBtn);
    return header;
}

function createDropzone(onFileSelected) {
    const dropzone = el('div', 'anomalous-audio-dropzone');
    dropzone.tabIndex = 0;
    dropzone.setAttribute('role', 'button');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.wav,.mp3,.flac,.ogg,.m4a';
    fileInput.hidden = true;

    dropzone.append(
        el('div', 'anomalous-audio-dropzone-hint', t('audioDropzoneHint')),
        el('div', 'anomalous-audio-dropzone-formats', 'WAV, MP3, FLAC, OGG, M4A (Max 100MB)'),
        fileInput,
    );

    dropzone.onclick = () => fileInput.click();
    dropzone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
    fileInput.onchange = () => { if (fileInput.files?.[0]) onFileSelected(fileInput.files[0]); };
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer?.files?.[0]) onFileSelected(e.dataTransfer.files[0]);
    };
    return dropzone;
}

function createPreviewPlayer(file, objectUrl) {
    const wrap = el('div', 'anomalous-voice-preview');
    const info = el('div', 'anomalous-voice-preview-info');
    info.append(el('span', 'anomalous-voice-preview-name', file.name), el('span', '', `${(file.size / 1024).toFixed(1)} KB`));
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = objectUrl;
    wrap.append(info, audio);
    return wrap;
}

function createField(labelText, control) {
    const wrap = el('label', 'anomalous-voice-field');
    wrap.append(el('span', 'anomalous-voice-field-label', labelText), control);
    return wrap;
}

function createCharacterSection(initialChar) {
    const input = el('input', 'anomalous-uploader-input');
    input.type = 'text';
    input.value = initialChar || '';
    input.placeholder = t('audioCharPlaceholder');
    return { wrap: createField(t('audioCharLabel'), input), input };
}

function createEmotionSection() {
    const input = el('input', 'anomalous-uploader-input');
    input.type = 'text';
    input.value = MAIN_VOICE;
    input.placeholder = t('audioEmotionPlaceholder');

    const chipsRow = el('div', 'anomalous-voice-chip-row');
    const syncChips = () => chipsRow.querySelectorAll('.anomalous-tag-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.value === input.value.trim().toLowerCase());
    });
    PRESET_EMOTIONS.forEach(emo => {
        const chip = el('button', 'anomalous-tag-chip', emo);
        chip.type = 'button';
        chip.dataset.value = emo;
        chip.onclick = () => { input.value = emo; syncChips(); };
        chipsRow.appendChild(chip);
    });
    input.oninput = syncChips;
    syncChips();

    const wrap = createField(t('audioEmotionLabel'), input);
    wrap.append(chipsRow, el('span', 'anomalous-voice-field-hint', t('audioEmotionMainHint')));
    return { wrap, input };
}

function createTranscriptSection(scope) {
    const textarea = el('textarea', 'anomalous-uploader-textarea');
    textarea.rows = 3;
    textarea.placeholder = t('audioRefTextPlaceholder');

    const originalHint = el('span', 'anomalous-voice-field-hint', t('audioOriginalKeptHint'));
    originalHint.hidden = true;
    const state = { originalText: '' };
    textarea.addEventListener('input', () => {
        if (!textarea.value.trim()) {
            state.originalText = '';
            originalHint.hidden = true;
        }
    });

    const romanizeBtn = el('button', 'anomalous-romanize-btn', t('audioRomanizeBtn'));
    romanizeBtn.type = 'button';
    romanizeBtn.title = t('audioRomanizeTitle');
    romanizeBtn.onclick = async () => {
        const source = textarea.value.trim();
        if (!source) {
            await anomalousAlert(t('audioRomanizeEmptyHint'));
            textarea.focus();
            return;
        }
        romanizeBtn.disabled = true;
        romanizeBtn.textContent = t('audioRomanizeConverting');
        try {
            const resp = await fetch('/anomalous/romanize_text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: source }),
                signal: scope.signal,
            });
            const data = await resp.json().catch(() => ({}));
            if (scope.signal.aborted) return;
            if (!data.success) {
                const key = data.code === 'missing_dependency' ? 'audioRomanizeMissingDep' : 'audioRomanizeFailed';
                await anomalousAlert(t(key, { error: data.error || `HTTP ${resp.status}` }));
            } else if (data.lang === 'unchanged') {
                await anomalousAlert(t('audioRomanizeUnchanged'));
            } else {
                state.originalText = state.originalText || source;
                textarea.value = data.romanized;
                originalHint.hidden = false;
            }
        } catch (err) {
            if (!scope.signal.aborted) await anomalousAlert(t('audioRomanizeFailed'));
        } finally {
            romanizeBtn.disabled = false;
            romanizeBtn.textContent = t('audioRomanizeBtn');
        }
    };

    const wrap = el('div', 'anomalous-voice-field');
    const header = el('div', 'anomalous-voice-field-header');
    header.append(el('span', 'anomalous-voice-field-label', t('audioRefTextLabel')), romanizeBtn);
    wrap.append(header, textarea, originalHint);
    return { wrap, textarea, state };
}

/** Not tied to the modal's AbortSignal: closing the modal must not pretend to cancel a server write. */
async function postVoice(fields, overwrite) {
    const formData = new FormData();
    formData.append('audio', fields.file);
    formData.append('character', fields.character);
    formData.append('emotion', fields.emotion);
    formData.append('text', fields.text);
    formData.append('original_text', fields.originalText);
    formData.append('target_subfolder', TARGET_SUBFOLDER);
    if (overwrite) formData.append('overwrite', '1');
    const resp = await fetch('/anomalous/upload_audio_voice', { method: 'POST', body: formData });
    const result = await resp.json().catch(() => ({ success: false, error: `HTTP ${resp.status}` }));
    return { status: resp.status, result };
}

function voiceName(character, emotion) {
    return emotion === MAIN_VOICE ? character : `${character}.${emotion}`;
}

export function openAudioUploaderModal(options = {}) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;

    let selectedFile = null;
    let objectUrl = null;
    let previewEl = null;

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();

    scope.onDispose(() => {
        overlay.remove();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (activeScope === scope) activeScope = null;
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
        e.stopPropagation();
        close();
    }, true);

    const dropzoneContainer = el('div', 'anomalous-voice-dropzone-wrap');
    const dropzone = createDropzone((file) => {
        selectedFile = file;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(file);
        previewEl?.remove();
        previewEl = createPreviewPlayer(file, objectUrl);
        dropzone.after(previewEl);
    });
    dropzoneContainer.appendChild(dropzone);

    const charSection = createCharacterSection(options.defaultCharacter);
    const emoSection = createEmotionSection();
    const transcriptSection = createTranscriptSection(scope);

    const footer = el('div', 'anomalous-voice-modal-footer');
    const cancelBtn = el('button', 'anomalous-voice-modal-cancel', t('dialogCancel'));
    cancelBtn.type = 'button';
    cancelBtn.onclick = close;
    const submitBtn = el('button', 'anomalous-voice-modal-submit', t('audioSaveAndIngest'));
    submitBtn.type = 'button';

    submitBtn.onclick = async () => {
        const fields = {
            file: selectedFile,
            character: charSection.input.value.trim(),
            emotion: emoSection.input.value.trim().toLowerCase() || MAIN_VOICE,
            text: transcriptSection.textarea.value.trim(),
            originalText: transcriptSection.state.originalText,
        };
        if (!fields.file || !fields.character) {
            await anomalousAlert(t('audioUploadRequiredError'));
            return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = t('audioSaving');
        try {
            let { status, result } = await postVoice(fields, false);
            if (status === 409 && result.code === 'exists') {
                const confirmed = await anomalousConfirm(t('audioUploadExistsConfirm', { name: voiceName(fields.character, fields.emotion) }));
                if (!confirmed || scope.signal.aborted) return;
                ({ status, result } = await postVoice(fields, true));
            }
            if (!result.success) {
                if (!scope.signal.aborted) await anomalousAlert(t('audioUploadFailed', { error: result.error || `HTTP ${status}` }));
                return;
            }
            // The files are saved even if the modal was closed meanwhile; refresh the list either way.
            options.onSaved?.(result.slice);
            if (result.main_missing && !scope.signal.aborted) {
                await anomalousAlert(t('audioMainMissing', { file: `${result.slice.character}.wav` }));
            }
            close();
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('audioUploadFailed', { error: e.message }));
        } finally {
            if (!scope.signal.aborted) {
                submitBtn.disabled = false;
                submitBtn.textContent = t('audioSaveAndIngest');
            }
        }
    };

    footer.append(cancelBtn, submitBtn);
    modal.append(renderModalHeader(close), dropzoneContainer, charSection.wrap, emoSection.wrap, transcriptSection.wrap, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    charSection.input.focus();
    return close;
}
