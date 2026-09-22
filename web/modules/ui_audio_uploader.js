import { t } from './interface_settings.js';

/**
 * Audio & Voice Asset Ingestion Modal
 * Provides drag-and-drop audio uploading with live preview, character/emotion classification,
 * companion transcript text pairing, and automated persistence into F5-TTS directories.
 */

const PRESET_EMOTIONS = ['normal', 'happy', 'angry', 'sad', 'surprised', 'whisper', 'tsundere'];
const ALLOWED_EXTS = ['.wav', '.mp3', '.flac', '.ogg', '.m4a'];

function renderModalHeader(onClose) {
    const header = document.createElement('div');
    header.className = 'anomalous-voice-modal-header';

    const info = document.createElement('div');
    info.style.display = 'flex';
    info.style.flexDirection = 'column';
    info.style.gap = '4px';

    const title = document.createElement('div');
    title.style.fontSize = '16px';
    title.style.fontWeight = '700';
    title.style.display = 'flex';
    title.style.alignItems = 'center';
    title.style.gap = '8px';
    title.innerHTML = `<span>🎙️</span><span>${t('audioUploadModalTitle')}</span>`;

    const subtitle = document.createElement('div');
    subtitle.style.fontSize = '12px';
    subtitle.style.color = '#94a3b8';
    subtitle.textContent = t('audioUploadModalSubtitle');

    info.appendChild(title);
    info.appendChild(subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:color 0.15s;';
    closeBtn.onmouseenter = () => { closeBtn.style.color = '#fff'; };
    closeBtn.onmouseleave = () => { closeBtn.style.color = '#94a3b8'; };
    closeBtn.onclick = onClose;

    header.appendChild(info);
    header.appendChild(closeBtn);
    return header;
}

function createDropzone(onFileSelected) {
    const dropzone = document.createElement('div');
    dropzone.className = 'anomalous-audio-dropzone';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.wav,.mp3,.flac,.ogg,.m4a';
    fileInput.style.display = 'none';

    dropzone.innerHTML = `
        <div style="font-size: 28px; opacity: 0.85;">📁</div>
        <div style="font-size: 13px; font-weight: 500; color: #e2e8f0;">${t('audioDropzoneHint')}</div>
        <div style="font-size: 11px; color: #64748b;">WAV, MP3, FLAC, OGG, M4A (Max 100MB)</div>
    `;

    dropzone.appendChild(fileInput);
    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelected(e.target.files[0]);
        }
    };

    dropzone.ondragover = (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelected(e.dataTransfer.files[0]);
        }
    };

    return dropzone;
}

function createPreviewPlayer(file) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:8px;';

    const info = document.createElement('div');
    info.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#cbd5e1;';
    
    const sizeKb = (file.size / 1024).toFixed(1);
    info.innerHTML = `<span style="font-weight:600;color:#38bdf8;">🎵 ${file.name}</span><span style="color:#64748b;">${sizeKb} KB</span>`;

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.width = '100%';
    audio.style.height = '36px';
    audio.src = URL.createObjectURL(file);

    wrap.appendChild(info);
    wrap.appendChild(audio);
    return wrap;
}

function createCharacterSection(initialChar = 'Arona') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    const label = document.createElement('label');
    label.style.cssText = 'font-size:12px;font-weight:600;color:#cbd5e1;';
    label.textContent = t('audioCharLabel');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-uploader-input';
    input.value = initialChar;
    input.placeholder = t('audioCharPlaceholder');

    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap, input };
}

function createEmotionSection() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    const label = document.createElement('label');
    label.style.cssText = 'font-size:12px;font-weight:600;color:#cbd5e1;';
    label.textContent = t('audioEmotionLabel');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-uploader-input';
    input.value = 'normal';
    input.placeholder = t('audioEmotionPlaceholder');

    const chipsRow = document.createElement('div');
    chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;';

    PRESET_EMOTIONS.forEach(emo => {
        const chip = document.createElement('span');
        chip.className = `anomalous-tag-chip ${emo === 'normal' ? 'active' : ''}`;
        chip.textContent = emo;
        chip.onclick = () => {
            chipsRow.querySelectorAll('.anomalous-tag-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            input.value = emo;
        };
        chipsRow.appendChild(chip);
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(chipsRow);
    return { wrap, input };
}

function createTranscriptHeader(textarea) {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

    const label = document.createElement('label');
    label.style.cssText = 'font-size:12px;font-weight:600;color:#cbd5e1;';
    label.textContent = t('audioRefTextLabel');

    const romanizeBtn = document.createElement('button');
    romanizeBtn.type = 'button';
    romanizeBtn.className = 'anomalous-romanize-btn';
    romanizeBtn.innerHTML = `<span>✨</span> <span>${t('audioRomanizeBtn')}</span>`;
    romanizeBtn.title = '将输入的日文（假名/汉字）或韩文（谚文）一键转换为标准罗马音';

    romanizeBtn.onclick = async () => {
        const originalText = textarea.value.trim();
        if (!originalText) {
            alert(t('audioRomanizeEmptyHint'));
            textarea.focus();
            return;
        }

        const prevHtml = romanizeBtn.innerHTML;
        romanizeBtn.disabled = true;
        romanizeBtn.innerHTML = `<span>⏳</span> <span>${t('audioRomanizeConverting')}</span>`;

        try {
            const resp = await fetch('/anomalous/romanize_text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: originalText })
            });
            const data = await resp.json();
            if (data.success && data.romanized) {
                textarea.value = data.romanized;
                romanizeBtn.innerHTML = `<span>✅</span> <span>${t('audioRomanizeSuccess')}</span>`;
                setTimeout(() => {
                    romanizeBtn.innerHTML = prevHtml;
                    romanizeBtn.disabled = false;
                }, 1800);
            } else {
                alert(t('audioRomanizeFailed') + ': ' + (data.error || ''));
                romanizeBtn.innerHTML = prevHtml;
                romanizeBtn.disabled = false;
            }
        } catch (err) {
            console.error('Failed to romanize text:', err);
            alert(t('audioRomanizeFailed'));
            romanizeBtn.innerHTML = prevHtml;
            romanizeBtn.disabled = false;
        }
    };

    header.appendChild(label);
    header.appendChild(romanizeBtn);
    return header;
}

function createTranscriptSection() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    const textarea = document.createElement('textarea');
    textarea.className = 'anomalous-uploader-textarea';
    textarea.rows = 3;
    textarea.placeholder = t('audioRefTextPlaceholder');

    const header = createTranscriptHeader(textarea);

    wrap.appendChild(header);
    wrap.appendChild(textarea);
    return { wrap, textarea };
}

async function handleUploadSubmit({ selectedFile, charInput, emoInput, txtArea, submitBtn, overlay, onSaved }) {
    if (!selectedFile) {
        alert(t('audioUploadRequiredError'));
        return;
    }

    const charVal = charInput.value.trim();
    const emoVal = emoInput.value.trim();
    const textVal = txtArea.value.trim();

    if (!charVal || !emoVal) {
        alert(t('audioUploadRequiredError'));
        return;
    }

    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    submitBtn.textContent = t('audioSaving');

    try {
        const formData = new FormData();
        formData.append('audio', selectedFile);
        formData.append('character', charVal);
        formData.append('emotion', emoVal);
        formData.append('text', textVal);
        formData.append('target_subfolder', 'F5-TTS');

        const resp = await fetch('/anomalous/upload_audio_voice', {
            method: 'POST',
            body: formData
        });

        const result = await resp.json();
        if (result.success) {
            overlay.remove();
            if (typeof onSaved === 'function') {
                onSaved(result.slice);
            }
        } else {
            alert('Upload failed: ' + (result.error || 'Unknown error'));
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.textContent = t('audioSaveAndIngest');
        }
    } catch (e) {
        console.error('Failed to upload audio voice:', e);
        alert('Upload request failed: ' + e.message);
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.textContent = t('audioSaveAndIngest');
    }
}

export function openAudioUploaderModal(options = {}) {
    const existing = document.querySelector('.anomalous-voice-modal-overlay');
    if (existing) existing.remove();

    let selectedFile = null;
    let previewEl = null;

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-voice-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.className = 'anomalous-voice-modal';

    const header = renderModalHeader(() => overlay.remove());
    modal.appendChild(header);

    const dropzoneContainer = document.createElement('div');
    const dropzone = createDropzone((file) => {
        selectedFile = file;
        if (previewEl) previewEl.remove();
        previewEl = createPreviewPlayer(file);
        dropzoneContainer.insertBefore(previewEl, dropzone.nextSibling);
    });
    dropzoneContainer.appendChild(dropzone);
    modal.appendChild(dropzoneContainer);

    const charSection = createCharacterSection(options.defaultCharacter || 'Arona');
    modal.appendChild(charSection.wrap);

    const emoSection = createEmotionSection();
    modal.appendChild(emoSection.wrap);

    const transcriptSection = createTranscriptSection();
    modal.appendChild(transcriptSection.wrap);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:8px;border-top:1px solid rgba(255,255,255,0.08);padding-top:14px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('dialogCancel');
    cancelBtn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#cbd5e1;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;';
    cancelBtn.onclick = () => overlay.remove();

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = t('audioSaveAndIngest');
    submitBtn.style.cssText = 'background:linear-gradient(135deg, #6366f1, #38bdf8);border:none;color:#fff;font-weight:600;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;box-shadow:0 4px 12px rgba(99,102,241,0.3);transition:transform 0.15s;';
    submitBtn.onmouseenter = () => { submitBtn.style.transform = 'translateY(-1px)'; };
    submitBtn.onmouseleave = () => { submitBtn.style.transform = 'translateY(0)'; };

    submitBtn.onclick = () => handleUploadSubmit({
        selectedFile,
        charInput: charSection.input,
        emoInput: emoSection.input,
        txtArea: transcriptSection.textarea,
        submitBtn,
        overlay,
        onSaved: options.onSaved
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const escListener = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escListener);
        }
    };
    document.addEventListener('keydown', escListener);
}
