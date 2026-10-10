import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { buildTtsPrompt } from './audio_script.js';
import { startPromptJob } from './audio_tts_run.js';
import { fetchGptSovitsCharacter, saveGptSovitsSettings } from './audio_engines.js';

/**
 * GPT-SoVITS pronunciation table: "what the script says -> what this character
 * reads" (the node's `replace` setting, applied before synthesis). Each row can
 * be heard both ways through a short Preview Audio run (audio_tts_run.js):
 * "now" sends the original through the node, so the saved table applies; "after"
 * sends the replacement. Saving keeps every other settings field.
 */

let activeScope = null;
const LANGUAGES = ['auto', 'zh', 'ja', 'en'];

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

function textInput(className, value, placeholder) {
    const input = el('input', className);
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value || '';
    return input;
}

/** First problem as a message, or '' when the rows can be saved. */
export function validatePronunciationRows(rows) {
    const seen = new Set();
    for (const row of rows) {
        if (!row.from.trim()) return t('ttsPronounceFromMissing', { to: row.to });
        if (seen.has(row.from)) return t('ttsPronounceDuplicate', { from: row.from });
        seen.add(row.from);
    }
    return '';
}

/**
 * Open the table for one GPT-SoVITS voice group (audio_engines.gptSovitsGroups shape).
 * `onSaved(group)` receives the refreshed group after the node accepted the settings.
 */
export function openPronunciationEditor(group, { onSaved } = {}) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const raw = group.raw || {};
    const name = raw.name || group.character;
    let settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    let loaded = false;
    let job = null;
    const player = new Audio();
    const seed = Math.floor(Math.random() * 2 ** 31);

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-editor anomalous-tts-pronounce');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();
    scope.onDispose(() => {
        job?.cancel();
        player.pause();
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
        e.stopPropagation();
        close();
    }, true);

    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(
        el('div', 'anomalous-voice-modal-title', t('ttsPronounceTitle', { name })),
        el('div', 'anomalous-voice-modal-subtitle', t('ttsPronounceSubtitle')),
    );
    header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));

    const languageBar = el('label', 'anomalous-tts-pronounce-language');
    const language = el('select', 'anomalous-sd-run-select');
    for (const code of LANGUAGES) {
        const option = el('option', '', t(`scriptRunLang_${code}`));
        option.value = code;
        language.appendChild(option);
    }
    language.value = LANGUAGES.includes(settings.defaults?.language) ? settings.defaults.language : 'auto';
    languageBar.append(el('span', '', t('ttsPronounceLanguage')), language);

    /** Play `text` through the node (Preview Audio); one preview at a time. */
    const preview = async (text, btn) => {
        if (!text.trim() || job) return;
        player.pause();
        const label = btn.textContent;
        btn.textContent = '…';
        btn.classList.add('is-busy');
        job = startPromptJob(buildTtsPrompt({ character: name, speech: text.trim(), seed, language: language.value, preview: true }));
        try {
            const { outputs } = await job.result;
            const audio = outputs['2']?.audio?.[0];
            if (!audio || scope.signal.aborted) return;
            const query = new URLSearchParams({ filename: audio.filename, subfolder: audio.subfolder || '', type: audio.type || 'temp' });
            player.src = `/view?${query}&t=${Date.now()}`;
            player.play().catch(() => {});
        } catch (error) {
            if (!error.cancelled && !scope.signal.aborted) await anomalousAlert(t('scriptRunFailed', { error: error.message }));
        } finally {
            job = null;
            btn.textContent = label;
            btn.classList.remove('is-busy');
        }
    };

    const rowsBox = el('div', 'anomalous-tts-rows');
    const addRow = (from = '', to = '') => {
        const line = el('div', 'anomalous-tts-row');
        const fromInput = textInput('anomalous-tts-name-input', from, t('ttsPronounceFromPlaceholder'));
        const toInput = textInput('anomalous-tts-text-input', to, t('ttsPronounceToPlaceholder'));
        const nowBtn = button('anomalous-tts-listen', t('ttsPronounceNow'), () => preview(fromInput.value, nowBtn), t('ttsPronounceNowHint'));
        const afterBtn = button('anomalous-tts-listen', t('ttsPronounceAfter'), () => preview(toInput.value, afterBtn), t('ttsPronounceAfterHint'));
        line.append(fromInput, el('span', 'anomalous-tts-arrow', '→'), toInput, nowBtn, afterBtn,
            button('anomalous-tts-remove', '×', () => line.remove(), t('ttsEditorRemove')));
        rowsBox.appendChild(line);
        return fromInput;
    };
    const fillRows = () => {
        rowsBox.replaceChildren();
        for (const [from, to] of Object.entries(settings.replace || {})) addRow(from, to);
        if (!rowsBox.children.length) addRow();
    };
    fillRows();
    const addBtn = button('anomalous-tts-add', t('ttsPronounceAdd'), () => addRow().focus());

    const footer = el('div', 'anomalous-voice-modal-footer');
    const saveBtn = button('anomalous-voice-modal-submit', t('ttsEditorSave'), async () => {
        if (!loaded) return;
        const rows = [...rowsBox.querySelectorAll('.anomalous-tts-row')].map(line => {
            const [fromInput, toInput] = line.querySelectorAll('input');
            return { from: fromInput.value, to: toInput.value.trim() };
        }).filter(row => row.from.trim() || row.to);
        const problem = validatePronunciationRows(rows);
        if (problem) {
            await anomalousAlert(problem);
            return;
        }
        const next = { ...settings, format: 1 };
        if (rows.length) next.replace = Object.fromEntries(rows.map(row => [row.from, row.to]));
        else delete next.replace;
        saveBtn.disabled = true;
        try {
            const updated = await saveGptSovitsSettings(name, next);
            onSaved?.(updated);
            close();
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('ttsEditorSaveFailed', { error: e.message }));
        } finally {
            if (!scope.signal.aborted) saveBtn.disabled = !loaded;
        }
    });
    footer.append(button('anomalous-voice-modal-cancel', t('dialogCancel'), close), saveBtn);

    // The summary list may be up to a minute old: read the file as it is now before editing it.
    const status = el('div', 'anomalous-tts-hint anomalous-tts-status', t('ttsEditorLoadingFiles'));
    saveBtn.disabled = true;
    fetchGptSovitsCharacter(name, scope.signal).then(detail => {
        if (scope.signal.aborted) return;
        if (detail.settings_error) throw new Error(detail.settings_error);
        if (detail.settings && typeof detail.settings === 'object') settings = detail.settings;
        fillRows();
        status.hidden = true;
        loaded = true;
        saveBtn.disabled = false;
    }).catch(e => {
        if (scope.signal.aborted) return;
        status.textContent = t('ttsEditorLoadFailed', { error: e.message || String(e) });
        status.classList.add('is-error');
    });

    const body = el('div', 'anomalous-tts-editor-body');
    body.append(status, el('div', 'anomalous-tts-hint', t('ttsPronounceTips')), languageBar, rowsBox, addBtn);
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    rowsBox.querySelector('input')?.focus();
    return close;
}
