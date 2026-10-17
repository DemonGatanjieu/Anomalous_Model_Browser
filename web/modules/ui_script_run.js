import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { buildTtsPrompt, TTS_NODE_CLASS } from './audio_script.js';
import { startPromptJob } from './audio_tts_run.js';
import { fetchGptSovitsCharacter, loadGptSovitsStatus, saveGptSovitsSettings } from './audio_engines.js';
import {
    PRESETS_FORMAT, SAMPLE_LINES, isBuiltin, lineTuning, loadPresets, presetLabel, presetsFile, savePresets, stateFromView, tuningRows,
} from './tts_presets_api.js';
import { keepParamFocus, renderPresetSwitch } from './ui_tts_preset_switch.js';
import { createModePreview } from './ui_tts_mode_preview.js';
import { openTtsSetup } from './ui_tts_setup.js';
import { openTuningEditor } from './ui_tts_tuning.js';

/**
 * The Script Director's "Generate" section for GPT-SoVITS characters: runs the
 * script through ComfyUI's queue (audio_tts_run.js) without touching the canvas,
 * plays the result, and offers another take of the whole script (new seed) or of
 * one line (`[take:N]`, the other lines come from the node's cache). Language and
 * speed start from the character's `defaults` and can be saved back to it.
 *
 * How it sounds is a mode (Anomalous_TTS interface 16): "Auto" lets the presets and the
 * character's generation settings decide line by line; a preset sends the node's `preset`
 * input, so every line uses it. The modes are shown against Auto (ui_tts_preset_switch.js,
 * compact: the scale and the numbers folded) and can be heard on the line you are on in the
 * director (ui_tts_mode_preview.js); a preset's numbers changed here are saved into that preset.
 * Links lead to the presets in GPT-SoVITS Settings and to the character's generation settings.
 *
 * The director owns the lines; this section owns the job, the options and the
 * result, which live for the page session like the director's panel. It has two
 * parts that the director places together: `bar` (generate / retake / cancel and the
 * result, with a way to the audio gallery) and `settings` (language, speed, mode).
 */

const LANGUAGES = ['auto', 'zh', 'ja', 'en'];
const MIN_FORMAT = 11; // Anomalous_TTS interface with [take:N] and `defaults`
const NUMBERS = ['speed'];
const AUTO = ''; // the mode that lets the presets decide

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

/** `{ speed: { default, min, max, step } }` from ComfyUI's description of the node. */
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
 * `getScript()` -> `{ group, lines, listen, pkg }` for the chosen character (the director's lines,
 * the index of the one to listen with, pkg from buildScriptPackage with takes); `getGroups()` -> every voice group (for the presets' "used by");
 * `onPlay()` when the result starts playing;
 * `resetTakes()` when a new take of the whole script starts; `onBusyChange()` when a job
 * starts or ends (the director re-renders its line cards, whose retake buttons depend on it);
 * `openGallery()` for the result's "saved to the audio gallery".
 */
export function createRunSection({ getScript, getGroups, onPlay, resetTakes, onBusyChange, openGallery }) {
    const state = {
        seed: newSeed(),
        spec: null,           // node input ranges/defaults; null until loaded
        presets: null,        // loadPresets(); null without interface 16
        local: false,         // this computer (presets can be changed)
        options: new Map(),   // character -> { language, speed, preset } being edited
        settings: new Map(),  // character -> its settings as saved in this session
        saved: new Map(),     // character -> options saved in this session
        presetNote: '',
        job: null,
        status: null,         // { state: 'queued' | 'running' | 'done' | 'cancelled', value?, max?, seconds? }
        result: null,         // { audio, url, warnings, character }
        supported: null,      // TTS interface >= MIN_FORMAT; null while unknown
    };

    const bar = el('div', 'anomalous-sd-run');
    const hint = el('div', 'anomalous-sd-run-hint is-warning', t('scriptRunNeedsUpdate'));

    // How it is read: language and speed, one per row, then the mode.
    const settings = el('div', 'anomalous-sd-run-settings');
    const commitSpeed = (raw) => {
        const script = getScript();
        const range = state.spec?.speed;
        let value = Number(raw);
        if (!Number.isFinite(value) || !range) value = range?.default ?? 1;
        value = Math.min(range?.max ?? value, Math.max(range?.min ?? value, value));
        if (script?.group) currentOptions(script.group).speed = value;
        render();
    };

    const languageRow = el('div', 'anomalous-sd-run-row');
    const languageChoices = el('div', 'anomalous-sd-run-segment');
    languageChoices.setAttribute('role', 'radiogroup');
    const languageButtons = new Map();
    for (const code of LANGUAGES) {
        const choice = button('anomalous-sd-run-choice', t(`scriptRunLang_${code}`), () => {
            const script = getScript();
            if (script?.group) currentOptions(script.group).language = code;
            render();
        });
        choice.setAttribute('role', 'radio');
        languageButtons.set(code, choice);
        languageChoices.append(choice);
    }
    languageRow.append(el('span', 'anomalous-sd-run-label', t('scriptRunLanguage')), languageChoices);

    const speedRow = el('label', 'anomalous-sd-run-row');
    const speed = el('input', 'anomalous-sd-run-slider');
    speed.type = 'range';
    speed.title = t('scriptRunParamHint_speed');
    const speedValue = el('span', 'anomalous-sd-run-value');
    speed.oninput = () => { speedValue.textContent = speed.value; };
    speed.onchange = () => commitSpeed(speed.value);
    speedRow.append(el('span', 'anomalous-sd-run-label', t('scriptRunSpeed')), speed, speedValue);

    const modeBox = el('div', 'anomalous-sd-run-mode');
    const saveDefaults = button('anomalous-sd-link-btn', t('scriptRunSaveDefaults'), () => storeDefaults(), t('scriptRunSaveDefaultsHint'));
    settings.append(el('div', 'anomalous-sd-run-heading', t('scriptRunHow')), languageRow, speedRow, modeBox, saveDefaults);

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
    const savedTo = button('anomalous-sd-link-btn anomalous-sd-run-saved', t('scriptRunSavedLink'), () => openGallery?.());
    const warnings = el('div', 'anomalous-sd-run-warnings');

    bar.append(hint, actions, player, savedTo, warnings);

    const characterSettings = group => state.settings.get(group.character) ?? group?.raw?.settings ?? {};
    const preview = createModePreview(() => render());

    /** The character's saved language and speed over the node's own defaults; the mode starts on Auto. */
    function storedOptions(group) {
        if (state.saved.has(group.character)) return state.saved.get(group.character);
        const defaults = characterSettings(group).defaults || {};
        return {
            language: LANGUAGES.includes(defaults.language) ? defaults.language : 'auto',
            speed: typeof defaults.speed === 'number' ? defaults.speed : state.spec?.speed?.default ?? null,
            preset: AUTO,
        };
    }

    function currentOptions(group) {
        if (!state.options.has(group.character)) state.options.set(group.character, { ...storedOptions(group) });
        return state.options.get(group.character);
    }

    const sameOptions = (a, b) => a.language === b.language && a.speed === b.speed;

    /** The numbers Auto gives this character's lines in the chosen language (its own one when that is Auto). */
    function autoTuning(group, opts) {
        const refLang = group.raw?.reference?.language || group.language || '';
        const key = opts.language !== 'auto' ? opts.language : (refLang || 'all');
        return { key, values: lineTuning(state.presets, tuningRows(characterSettings(group)), refLang, key).values };
    }

    async function reloadPresets() {
        try {
            state.presets = await loadPresets();
        } catch (_) { /* keep the last ones */ }
        render();
    }

    async function checkSupport() {
        try {
            const [status, spec] = await Promise.all([loadGptSovitsStatus(), loadNodeSpec()]);
            state.spec = spec;
            state.supported = Number(status?.format) >= MIN_FORMAT && NUMBERS.every(name => spec[name]);
            state.local = status?.local !== false;
            if (Number(status?.format) >= PRESETS_FORMAT) state.presets = await loadPresets();
        } catch (_) {
            state.supported = false;
        }
        state.options.clear(); // options built before the spec arrived lack the node's defaults
        render();
    }

    /** A preset's number changed here goes into the preset itself, for every character. */
    async function editPreset(name, key, value) {
        const next = stateFromView(state.presets);
        next.numbers[name][key] = value;
        try {
            state.presets = await savePresets(presetsFile(state.presets, next));
            state.presetNote = t('scriptRunModeSaved', { name: presetLabel(state.presets.labels, name, t) });
        } catch (error) {
            state.presetNote = t('ttsPresetsSaveFailed', { error: error.message });
        }
        keepParamFocus(modeBox, render);
    }

    function renderMode(group, busy) {
        modeBox.hidden = !state.presets;
        if (!state.presets) return;
        const opts = currentOptions(group);
        const view = state.presets;
        const auto = autoTuning(group, opts);
        const values = id => (id === AUTO ? auto.values : view.presets[id]);
        if (opts.preset !== AUTO && !view.presets[opts.preset]) opts.preset = AUTO; // deleted in the settings meanwhile
        const choices = [{ id: AUTO, label: t('scriptRunModeAuto') },
            ...Object.keys(view.presets).map(name => ({ id: name, label: presetLabel(view.labels, name, t), badge: isBuiltin(name) ? '' : t('ttsPresetCustom') }))];
        const pick = (id) => {
            opts.preset = id;
            state.presetNote = '';
            render();
        };
        // The same line for every mode: the one you are on in the director; an empty one, a line in the character's language.
        const script = getScript();
        const index = script?.listen ?? 0;
        const chosen = script?.lines?.[index];
        const words = String(chosen?.text || '').trim();
        const refLang = group.raw?.reference?.language || group.language;
        const text = words
            ? `${chosen.emotion && chosen.emotion !== 'main' ? `{${chosen.emotion}}` : ''}${words}`
            : SAMPLE_LINES[refLang] || SAMPLE_LINES.zh;
        const lineLabel = el('span', 'anomalous-sd-run-listen-line', words
            ? t('scriptRunListenLine', { n: index + 1, text: words })
            : t('scriptRunListenSample', { text }));
        lineLabel.title = t('scriptRunListenLineHint');
        const take = id => ({ character: group.character, text, language: opts.language, speed: opts.speed, mode: id, preset: id, numbers: values(id) });
        const lang = auto.key === 'all' ? t('ttsTuningAll') : t(`scriptRunLang_${auto.key}`);
        const modes = renderPresetSwitch({
            choices,
            selected: opts.preset,
            base: AUTO,
            baseName: t('scriptRunModeAutoBase'),
            baseText: t('scriptRunModeIsAuto'),
            values,
            describe: id => (id === AUTO ? t('scriptRunModeAutoShort', { lang })
                : t('scriptRunModeWhole', { about: isBuiltin(id) ? t(`ttsPresetDesc_${id}`) : t('ttsPresetDescCustom') })),
            builtin: id => (isBuiltin(id) ? view.builtin[id] : null),
            editable: id => id !== AUTO && state.local,
            onPick: pick,
            onEdit: editPreset,
            listen: preview.row({ takeFor: take, selected: opts.preset, modes: choices, onPick: pick, disabled: busy, lead: [lineLabel] }),
            disabled: busy,
            compact: true,
        });
        const note = el('div', 'anomalous-sd-run-note', state.presetNote);
        note.hidden = !state.presetNote;
        const links = el('div', 'anomalous-sd-run-links');
        links.append(
            button('anomalous-sd-link-btn', t('scriptRunOpenPresets'), () => openTtsSetup({ groups: getGroups?.() || [], showPresets: true, onChanged: reloadPresets })),
            button('anomalous-sd-link-btn', t('scriptRunOpenTuning'), () => openTuningEditor(group, {
                onSaved: (saved) => {
                    if (saved?.raw?.settings) state.settings.set(group.character, saved.raw.settings);
                    render();
                },
            })),
        );
        modeBox.replaceChildren(el('span', 'anomalous-sd-run-label', t('scriptRunMode')), modes, note, links);
    }

    async function generate() {
        const script = getScript();
        if (!script?.group || script.pkg.error || state.job || !state.supported) return;
        const character = script.group.character;
        const { language: lang, speed: speedValue, preset } = currentOptions(script.group);
        const chosen = state.presets && preset !== AUTO ? { preset } : {};
        const prompt = buildTtsPrompt({ character, speech: script.pkg.speech, seed: state.seed, language: lang, speed: speedValue, ...chosen });
        state.status = { state: 'queued' };
        const started = Date.now();
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
            // The first line is the node's own count (its sentences, batches, cache), not the reader's lines.
            const [, ...rest] = String(outputs['1']?.text?.[0] || '').split('\n');
            state.result = { audio, url: `${audioUrl(audio)}&t=${Date.now()}`, warnings: rest.filter(Boolean), character };
            state.status = { state: 'done', seconds: Math.max(1, Math.round((Date.now() - started) / 1000)) };
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
            // Start from the file as it is now, so edits made elsewhere (the generation settings) are kept.
            const fresh = await fetchGptSovitsCharacter(character);
            if (fresh.settings_error) throw new Error(t('scriptRunSettingsBroken', { error: fresh.settings_error }));
            const settings = { ...(fresh.settings || {}), format: 1 };
            // Only what differs from the node's own defaults, so the file stays short.
            const defaults = { ...(settings.defaults || {}) };
            if (opts.language !== 'auto') defaults.language = opts.language; else delete defaults.language;
            if (opts.speed !== state.spec.speed.default) defaults.speed = opts.speed; else delete defaults.speed;
            if (Object.keys(defaults).length) settings.defaults = defaults; else delete settings.defaults;
            await saveGptSovitsSettings(character, settings);
            state.settings.set(character, settings);
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
        else if (s?.state === 'done') text = t('scriptRunDone', { seconds: s.seconds });
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
            for (const [code, choice] of languageButtons) {
                choice.setAttribute('aria-checked', String(opts.language === code));
                choice.disabled = busy;
            }
            const range = state.spec.speed;
            Object.assign(speed, { min: String(range.min), max: String(range.max), step: String(range.step ?? 1) });
            speed.value = String(opts.speed);
            speed.disabled = busy;
            speedValue.textContent = String(opts.speed);
            renderMode(group, busy);
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
            savedTo.title = `output/${folder}/${state.result.audio.filename}`;
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
            preview.stop();
        },
    };
}
