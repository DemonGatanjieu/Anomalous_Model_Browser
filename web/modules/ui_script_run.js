import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { buildTtsPrompt } from './audio_script.js';
import { startPromptJob } from './audio_tts_run.js';
import { fetchGptSovitsCharacter, loadGptSovitsStatus, saveGptSovitsSettings } from './audio_engines.js';

/**
 * The Script Director's "Generate" section for GPT-SoVITS characters: runs the
 * script through ComfyUI's queue (audio_tts_run.js) without touching the canvas,
 * plays the result, and offers another take of the whole script (new seed) or of
 * one line (`[take:N]`, the other lines come from the node's cache). Language and
 * speed start from the character's `defaults` and can be saved back to it.
 *
 * The director owns the lines; this section owns the job, the options and the
 * result, which live for the page session like the director's panel.
 */

const LANGUAGES = ['auto', 'zh', 'ja', 'en'];
const MIN_FORMAT = 11; // Anomalous_TTS interface with [take:N] and `defaults`

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) btn.title = title;
    btn.onclick = onClick;
    return btn;
}

function newSeed() {
    return Math.floor(Math.random() * 2 ** 31);
}

function savedDefaults(group) {
    const defaults = group?.raw?.settings?.defaults;
    return {
        language: LANGUAGES.includes(defaults?.language) ? defaults.language : 'auto',
        speed: typeof defaults?.speed === 'number' ? defaults.speed : 1,
    };
}

function audioUrl(audio) {
    const query = new URLSearchParams({ filename: audio.filename, subfolder: audio.subfolder || '', type: audio.type || 'output' });
    return `/view?${query}`;
}

/**
 * `getScript()` -> `{ group, pkg }` for a GPT-SoVITS character (pkg from buildScriptPackage
 * with takes) or null for other engines; `onPlay()` when the result starts playing;
 * `resetTakes()` when a new take of the whole script starts; `onBusyChange()` when a job
 * starts or ends (the director re-renders its line cards, whose retake buttons depend on it).
 */
export function createRunSection({ getScript, onPlay, resetTakes, onBusyChange }) {
    const state = {
        seed: newSeed(),
        options: new Map(),   // character -> { language, speed } being edited
        saved: new Map(),     // character -> defaults saved in this session
        job: null,
        status: null,         // { state: 'queued' | 'running' | 'done' | 'cancelled', value?, max?, summary? }
        result: null,         // { audio, url, warnings, character }
        supported: null,      // TTS interface >= MIN_FORMAT; null while unknown
    };

    const root = el('div', 'anomalous-sd-run');
    const hint = el('div', 'anomalous-sd-run-hint');

    const options = el('div', 'anomalous-sd-run-options');
    const language = el('select', 'anomalous-sd-run-select');
    for (const code of LANGUAGES) {
        const option = el('option', '', t(`scriptRunLang_${code}`));
        option.value = code;
        language.appendChild(option);
    }
    const speed = el('input', 'anomalous-sd-run-speed');
    Object.assign(speed, { type: 'number', min: '0.5', max: '2', step: '0.05' });
    const saveDefaults = button('anomalous-sd-link-btn', t('scriptRunSaveDefaults'), () => storeDefaults());
    options.append(
        el('span', 'anomalous-sd-step', t('scriptRunLanguage')), language,
        el('span', 'anomalous-sd-step', t('scriptRunSpeed')), speed,
        saveDefaults,
    );

    const actions = el('div', 'anomalous-sd-run-actions');
    const generateBtn = button('anomalous-sd-btn accent', t('scriptRunGenerate'), () => generate());
    const newTakeBtn = button('anomalous-sd-btn', t('scriptRunNewTake'), () => {
        state.seed = newSeed();
        resetTakes?.();
        generate();
    }, t('scriptRunNewTakeHint'));
    const cancelBtn = button('anomalous-sd-btn', t('scriptRunCancel'), () => state.job?.cancel());
    actions.append(generateBtn, newTakeBtn, cancelBtn);

    const status = el('div', 'anomalous-sd-run-status');
    const player = el('audio', 'anomalous-sd-run-player');
    player.controls = true;
    player.preload = 'auto';
    player.addEventListener('play', () => onPlay?.());
    const savedTo = el('div', 'anomalous-sd-run-saved');
    const warnings = el('div', 'anomalous-sd-run-warnings');

    root.append(hint, options, actions, status, player, savedTo, warnings);

    function currentOptions(group) {
        if (!state.options.has(group.character)) state.options.set(group.character, { ...(state.saved.get(group.character) || savedDefaults(group)) });
        return state.options.get(group.character);
    }

    language.onchange = () => {
        const script = getScript();
        if (script?.group) currentOptions(script.group).language = language.value;
        render();
    };
    speed.onchange = () => {
        const script = getScript();
        const value = Math.min(2, Math.max(0.5, Number(speed.value) || 1));
        speed.value = String(value);
        if (script?.group) currentOptions(script.group).speed = value;
        render();
    };

    async function checkSupport() {
        try {
            const status = await loadGptSovitsStatus();
            state.supported = Number(status?.format) >= MIN_FORMAT;
        } catch (_) {
            state.supported = false;
        }
        render();
    }

    async function generate() {
        const script = getScript();
        if (!script?.group || script.pkg.error || state.job || !state.supported) return;
        const character = script.group.character;
        const opts = currentOptions(script.group);
        const prompt = buildTtsPrompt({ character, speech: script.pkg.speech, seed: state.seed, language: opts.language, speed: opts.speed });
        state.status = { state: 'queued' };
        state.job = startPromptJob(prompt, {
            onStatus: next => {
                state.status = next;
                renderStatus();
            },
        });
        onBusyChange?.();
        try {
            const { outputs } = await state.job.result;
            const audio = outputs['2']?.audio?.[0];
            if (!audio) throw new Error(t('scriptRunNoAudio'));
            const [summary = '', ...rest] = String(outputs['1']?.text?.[0] || '').split('\n');
            state.result = { audio, url: `${audioUrl(audio)}&t=${Date.now()}`, warnings: rest.filter(Boolean), character };
            state.status = { state: 'done', summary };
            state.job = null;
            onBusyChange?.();
            player.play().catch(() => {});
        } catch (error) {
            state.job = null;
            state.status = error.cancelled ? { state: 'cancelled' } : null;
            onBusyChange?.();
            if (!error.cancelled) await anomalousAlert(t('scriptRunFailed', { error: error.message }));
        }
    }

    async function storeDefaults() {
        const script = getScript();
        if (!script?.group) return;
        const { character } = script.group;
        const opts = { ...currentOptions(script.group) };
        saveDefaults.disabled = true;
        try {
            // Start from the file as it is now, so edits made elsewhere are kept.
            const fresh = await fetchGptSovitsCharacter(character);
            if (fresh.settings_error) throw new Error(t('scriptRunSettingsBroken', { error: fresh.settings_error }));
            const settings = { ...(fresh.settings || {}), format: 1 };
            settings.defaults = { ...(settings.defaults || {}), language: opts.language, speed: opts.speed };
            await saveGptSovitsSettings(character, settings);
            state.saved.set(character, opts);
            saveDefaults.textContent = t('scriptRunDefaultsSaved');
            setTimeout(() => { saveDefaults.textContent = t('scriptRunSaveDefaults'); render(); }, 1600);
        } catch (error) {
            await anomalousAlert(t('scriptRunDefaultsFailed', { error: error.message }));
        } finally {
            saveDefaults.disabled = false;
            render();
        }
    }

    function renderStatus() {
        const s = state.status;
        let text = '';
        if (s?.state === 'queued') text = t('scriptRunQueued');
        else if (s?.state === 'running') text = s.max ? t('scriptRunProgress', { value: s.value, max: s.max }) : t('scriptRunRunning');
        else if (s?.state === 'done') text = t('scriptRunDone', { summary: s.summary });
        else if (s?.state === 'cancelled') text = t('scriptRunCancelled');
        status.textContent = text;
        status.hidden = !text;
    }

    function render() {
        const script = getScript();
        root.hidden = !script;
        if (!script) return;
        if (state.supported === null) {
            state.supported = false;
            checkSupport();
        }
        const { group, pkg } = script;
        const busy = Boolean(state.job);
        hint.textContent = state.supported ? t('scriptRunHint', { character: group?.character || '' }) : t('scriptRunNeedsUpdate');
        hint.classList.toggle('is-warning', !state.supported);

        const opts = group ? currentOptions(group) : { language: 'auto', speed: 1 };
        language.value = opts.language;
        speed.value = String(opts.speed);
        const stored = group ? (state.saved.get(group.character) || savedDefaults(group)) : opts;
        saveDefaults.hidden = !group || (stored.language === opts.language && stored.speed === opts.speed);
        options.hidden = !state.supported || !group;
        language.disabled = speed.disabled = busy;

        const ready = state.supported && group && !pkg.error;
        generateBtn.disabled = !ready || busy;
        const hasResult = Boolean(state.result && group && state.result.character === group.character);
        newTakeBtn.hidden = !hasResult;
        newTakeBtn.disabled = !ready || busy;
        cancelBtn.hidden = !busy;
        actions.hidden = !state.supported;

        renderStatus();
        player.hidden = !hasResult;
        if (hasResult && player.getAttribute('src') !== state.result.url) player.src = state.result.url;
        savedTo.hidden = !hasResult;
        if (hasResult) {
            const folder = String(state.result.audio.subfolder || '').replace(/\\/g, '/');
            savedTo.textContent = t('scriptRunSavedTo', { path: `output/${folder}/${state.result.audio.filename}` });
        }
        warnings.hidden = !hasResult || !state.result.warnings.length;
        if (hasResult) warnings.textContent = state.result.warnings.join('\n');
    }

    return {
        element: root,
        render,
        generate,
        /** A line can be retaken once this character has a result and nothing is running. */
        canRetake(group) {
            return Boolean(state.supported && !state.job && state.result && group && state.result.character === group.character);
        },
        stopPlayback() {
            player.pause();
        },
    };
}
