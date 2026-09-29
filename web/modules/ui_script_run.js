import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { buildTtsPrompt, TTS_NODE_CLASS } from './audio_script.js';
import { startPromptJob } from './audio_tts_run.js';
import { fetchGptSovitsCharacter, loadGptSovitsStatus, saveGptSovitsSettings } from './audio_engines.js';

/**
 * The Script Director's "Generate" section for GPT-SoVITS characters: runs the
 * script through ComfyUI's queue (audio_tts_run.js) without touching the canvas,
 * plays the result, and offers another take of the whole script (new seed) or of
 * one line (`[take:N]`, the other lines come from the node's cache). Language,
 * speed and the sampling parameters start from the character's `defaults` and a
 * setting that worked can be saved back to it.
 *
 * The director owns the lines; this section owns the job, the options and the
 * result, which live for the page session like the director's panel. It has two
 * parts that the director places together: `settings` (one folded line) and `bar`
 * (generate / retake / cancel and the result).
 */

const LANGUAGES = ['auto', 'zh', 'ja', 'en'];
const MIN_FORMAT = 11; // Anomalous_TTS interface with [take:N] and `defaults`
// Folded under "Advanced"; ranges and defaults come from the node's own input spec.
const SAMPLING = ['top_k', 'top_p', 'temperature', 'repetition_penalty'];
const NUMBERS = ['speed', ...SAMPLING];
const OPEN_KEY = 'anomalous_script_run_settings_open';

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

function audioUrl(audio) {
    const query = new URLSearchParams({ filename: audio.filename, subfolder: audio.subfolder || '', type: audio.type || 'output' });
    return `/view?${query}`;
}

/** `{ speed: { default, min, max, step }, top_k: … }` from ComfyUI's description of the node. */
async function loadNodeSpec() {
    const resp = await fetch(`/object_info/${TTS_NODE_CLASS}`);
    const info = (await resp.json())?.[TTS_NODE_CLASS]?.input || {};
    const inputs = { ...(info.required || {}), ...(info.optional || {}) };
    const spec = {};
    for (const name of NUMBERS) {
        const options = inputs[name]?.[1];
        if (options && typeof options.default === 'number') spec[name] = options;
    }
    return spec;
}

/**
 * `getScript()` -> `{ group, pkg }` for the chosen character (pkg from buildScriptPackage
 * with takes); `onPlay()` when the result starts playing;
 * `resetTakes()` when a new take of the whole script starts; `onBusyChange()` when a job
 * starts or ends (the director re-renders its line cards, whose retake buttons depend on it).
 */
export function createRunSection({ getScript, onPlay, resetTakes, onBusyChange }) {
    const state = {
        seed: newSeed(),
        spec: null,           // node input ranges/defaults; null until loaded
        options: new Map(),   // character -> options being edited
        saved: new Map(),     // character -> options saved in this session
        job: null,
        status: null,         // { state: 'queued' | 'running' | 'done' | 'cancelled', value?, max?, summary? }
        result: null,         // { audio, url, warnings, character }
        supported: null,      // TTS interface >= MIN_FORMAT; null while unknown
    };

    const bar = el('div', 'anomalous-sd-run');
    const hint = el('div', 'anomalous-sd-run-hint is-warning', t('scriptRunNeedsUpdate'));

    const settings = el('details', 'anomalous-sd-run-settings');
    const settingsSummary = el('summary');
    try { settings.open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) { /* folded by default */ }
    settings.addEventListener('toggle', () => {
        try { localStorage.setItem(OPEN_KEY, settings.open ? '1' : '0'); } catch (_) { /* convenience only */ }
    });
    const language = el('select', 'anomalous-sd-run-select');
    for (const code of LANGUAGES) {
        const option = el('option', '', t(`scriptRunLang_${code}`));
        option.value = code;
        language.appendChild(option);
    }
    const fields = {};
    const numberField = name => {
        const input = el('input', 'anomalous-sd-run-number');
        input.type = 'number';
        input.title = t(`scriptRunParamHint_${name}`);
        input.onchange = () => {
            const script = getScript();
            const range = state.spec?.[name];
            let value = Number(input.value);
            if (!Number.isFinite(value) || !range) value = range?.default ?? 1;
            value = Math.min(range?.max ?? value, Math.max(range?.min ?? value, name === 'top_k' ? Math.round(value) : value));
            if (script?.group) currentOptions(script.group)[name] = value;
            render();
        };
        fields[name] = input;
        return input;
    };
    const grid = el('div', 'anomalous-sd-run-grid');
    const param = (label, control) => {
        const row = el('label', 'anomalous-sd-run-param');
        row.append(el('span', '', label), control);
        grid.appendChild(row);
    };
    param(t('scriptRunLanguage'), language);
    param(t('scriptRunSpeed'), numberField('speed'));
    for (const name of SAMPLING) param(name, numberField(name));
    const saveDefaults = button('anomalous-sd-link-btn', t('scriptRunSaveDefaults'), () => storeDefaults(), t('scriptRunSaveDefaultsHint'));
    settings.append(settingsSummary, grid, el('div', 'anomalous-sd-run-note', t('scriptRunAdvancedNote')), saveDefaults);

    const actions = el('div', 'anomalous-sd-run-actions');
    const generateBtn = button('anomalous-sd-btn accent', t('scriptRunGenerate'), () => generate());
    const newTakeBtn = button('anomalous-sd-btn', t('scriptRunNewTake'), () => {
        state.seed = newSeed();
        resetTakes?.();
        generate();
    }, t('scriptRunNewTakeHint'));
    const cancelBtn = button('anomalous-sd-btn', t('scriptRunCancel'), () => state.job?.cancel());
    const status = el('span', 'anomalous-sd-run-status');
    actions.append(generateBtn, newTakeBtn, cancelBtn, status);

    const player = el('audio', 'anomalous-sd-run-player');
    player.controls = true;
    player.preload = 'auto';
    player.addEventListener('play', () => onPlay?.());
    const savedTo = el('div', 'anomalous-sd-run-saved');
    const warnings = el('div', 'anomalous-sd-run-warnings');

    bar.append(hint, actions, player, savedTo, warnings);

    /** The character's saved defaults over the node's own defaults. */
    function storedOptions(group) {
        if (state.saved.has(group.character)) return state.saved.get(group.character);
        const defaults = group?.raw?.settings?.defaults || {};
        const out = { language: LANGUAGES.includes(defaults.language) ? defaults.language : 'auto' };
        for (const name of NUMBERS) {
            out[name] = typeof defaults[name] === 'number' ? defaults[name] : state.spec?.[name]?.default ?? null;
        }
        return out;
    }

    function currentOptions(group) {
        if (!state.options.has(group.character)) state.options.set(group.character, { ...storedOptions(group) });
        return state.options.get(group.character);
    }

    const sameOptions = (a, b) => ['language', ...NUMBERS].every(name => a[name] === b[name]);

    language.onchange = () => {
        const script = getScript();
        if (script?.group) currentOptions(script.group).language = language.value;
        render();
    };

    async function checkSupport() {
        try {
            const [status, spec] = await Promise.all([loadGptSovitsStatus(), loadNodeSpec()]);
            state.spec = spec;
            state.supported = Number(status?.format) >= MIN_FORMAT && NUMBERS.every(name => spec[name]);
        } catch (_) {
            state.supported = false;
        }
        state.options.clear(); // options built before the spec arrived lack the node's defaults
        render();
    }

    async function generate() {
        const script = getScript();
        if (!script?.group || script.pkg.error || state.job || !state.supported) return;
        const character = script.group.character;
        const { language: lang, ...numbers } = currentOptions(script.group);
        const prompt = buildTtsPrompt({ character, speech: script.pkg.speech, seed: state.seed, language: lang, ...numbers });
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
            // Only what differs from the node's own defaults, so the file stays short.
            const defaults = {};
            if (opts.language !== 'auto') defaults.language = opts.language;
            for (const name of NUMBERS) {
                if (opts[name] !== state.spec[name].default) defaults[name] = opts[name];
            }
            if (Object.keys(defaults).length) settings.defaults = defaults; else delete settings.defaults;
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
        if (state.supported === null) {
            state.supported = false;
            checkSupport();
        }
        const { group, pkg } = script;
        const busy = Boolean(state.job);
        const ready = Boolean(state.supported && group);
        hint.hidden = Boolean(state.supported);
        generateBtn.title = t('scriptRunHint', { character: group?.character || '' });

        settings.hidden = actions.hidden = !ready;
        if (ready) {
            const opts = currentOptions(group);
            const tuned = SAMPLING.some(name => opts[name] !== state.spec[name].default);
            settingsSummary.textContent = t('scriptRunSettingsSummary', {
                language: t(`scriptRunLang_${opts.language}`),
                speed: opts.speed,
            }) + (tuned ? t('scriptRunSettingsTuned') : '');
            language.value = opts.language;
            for (const name of NUMBERS) {
                const range = state.spec[name];
                Object.assign(fields[name], { min: String(range.min), max: String(range.max), step: String(range.step ?? 1) });
                fields[name].value = String(opts[name]);
                fields[name].disabled = busy;
            }
            language.disabled = busy;
            saveDefaults.hidden = sameOptions(opts, storedOptions(group));
        } else {
            saveDefaults.hidden = true;
        }

        generateBtn.disabled = !ready || Boolean(pkg.error) || busy;
        const hasResult = Boolean(state.result && group && state.result.character === group.character);
        newTakeBtn.hidden = !hasResult;
        newTakeBtn.disabled = generateBtn.disabled;
        cancelBtn.hidden = !busy;

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
        settings,
        bar,
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
