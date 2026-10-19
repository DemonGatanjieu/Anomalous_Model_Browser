import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { buildTtsPrompt, TTS_NODE_CLASS } from './audio_script.js';
import { startPromptJob } from './audio_tts_run.js';
import { fetchGptSovitsCharacter, loadGptSovitsStatus, saveGptSovitsSettings } from './audio_engines.js';
import {
    PRESETS_FORMAT, SAMPLE_LINES, lineTuning, loadPresets, presetLabel, presetsFile, savePresets, stateFromView, tuningRows,
} from './tts_presets_api.js';
import { AUTO_MODE, LINE_TAGS_FORMAT, clearLineTune, lineValues, setLineTune, tuneTags } from './script_tune.js';
import { keepParamFocus } from './ui_tts_preset_switch.js';
import { createModePreview } from './ui_tts_mode_preview.js';
import { openTtsSetup } from './ui_tts_setup.js';
import { openTuningEditor } from './ui_tts_tuning.js';
import { LANGUAGES, renderTunePanel } from './ui_script_tune.js';

/**
 * The Script Director's "Generate" section for GPT-SoVITS characters: runs the
 * script through ComfyUI's queue (audio_tts_run.js) without touching the canvas,
 * plays the result, and offers another take of the whole script (new seed) or of
 * one line (`[take:N]`, the other lines come from the node's cache).
 *
 * How each line is read: every character has its language, speed and mode in this script,
 * starting from its saved `defaults` (language and speed, which can be saved back) and Auto (the
 * presets and the character's generation settings decide line by line); a line follows its
 * character unless it was set for itself (script_tune.js). The side panel showing them follows
 * what is picked on the left (ui_script_tune.js). Anomalous_TTS interface 17 gets them as tags
 * on each line; an older node reads the whole script with the first line's character's values
 * through its inputs. The modes can be heard on a line (ui_tts_mode_preview.js); a preset's
 * numbers changed here are saved into that preset.
 *
 * The director owns the lines; this section owns the job, the characters' values and the
 * result, which live for the page session like the director's panel. It has two parts that
 * the director places together: `bar` (generate / retake / cancel and the result, with a way to
 * the audio gallery) and `settings` (the side panel).
 */

const MIN_FORMAT = 11; // Anomalous_TTS interface with [take:N] and `defaults`
const NUMBERS = ['speed'];

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
 * `getScript()` -> `{ group, lines, listen, speakerOf, pkg, groups, picked, focus, assign, focusCharacter,
 * focusScript }` (the node's character = the first line's, the director's lines, the one to listen
 * with, who reads a line, pkg from buildScriptPackage with takes, the characters, the picked line
 * indexes, the character shown, and the director's calls); `getGroups()` -> every voice group (for
 * the presets' "used by"); `onPlay()` when the result starts playing; `resetTakes()` when a new take
 * of the whole script starts; `onBusyChange()` when a job starts or ends (the director re-renders its
 * line cards, whose retake buttons depend on it); `onLinesChange()` after a line's values changed (the
 * cards' tags); `openGallery()` for the result's "saved to the audio gallery".
 */
export function createRunSection({ getScript, getGroups, onPlay, resetTakes, onBusyChange, onLinesChange, openGallery }) {
    const state = {
        seed: newSeed(),
        spec: null,           // node input ranges/defaults; null until loaded
        presets: null,        // loadPresets(); null without interface 16
        format: 0,            // the node's interface
        local: false,         // this computer (presets can be changed)
        options: new Map(),   // character -> { language, speed, preset } in this script
        settings: new Map(),  // character -> its settings as saved in this session
        saved: new Map(),     // character -> options saved in this session
        savedNow: null,       // the character just saved ("Saved" on its button for a moment)
        saving: false,
        presetNote: '',
        job: null,
        status: null,         // { state: 'queued' | 'running' | 'done' | 'cancelled', value?, max?, seconds? }
        result: null,         // { audio, url, warnings, character }
        supported: null,      // TTS interface >= MIN_FORMAT; null while unknown
    };

    const bar = el('div', 'anomalous-sd-run');
    const hint = el('div', 'anomalous-sd-run-hint is-warning', t('scriptRunNeedsUpdate'));

    // How it is read: what is picked on the left (ui_script_tune.js).
    const settings = el('div', 'anomalous-sd-run-settings');

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
    const canTag = () => state.format >= LINE_TAGS_FORMAT;

    /** The character's saved language and speed over the node's own defaults; the mode starts on Auto. */
    function storedOptions(group) {
        if (state.saved.has(group.character)) return state.saved.get(group.character);
        const defaults = characterSettings(group).defaults || {};
        return {
            language: LANGUAGES.includes(defaults.language) ? defaults.language : 'auto',
            speed: typeof defaults.speed === 'number' ? defaults.speed : state.spec?.speed?.default ?? null,
            preset: AUTO_MODE,
        };
    }

    function currentOptions(group) {
        if (!group) return { language: 'auto', speed: state.spec?.speed?.default ?? 1, preset: AUTO_MODE };
        if (!state.options.has(group.character)) state.options.set(group.character, { ...storedOptions(group) });
        const opts = state.options.get(group.character);
        if (opts.preset !== AUTO_MODE && !state.presets?.presets?.[opts.preset]) opts.preset = AUTO_MODE; // deleted meanwhile
        return opts;
    }

    const sameOptions = (a, b) => a.language === b.language && a.speed === b.speed;
    const valuesOfLine = line => lineValues(line, currentOptions(getScript().speakerOf(line)));

    /** The tags `line` needs (script_tune.js), for the director's packages; none for an older node. */
    function tagsOf(line, speaker) {
        if (!canTag() || !speaker) return '';
        return tuneTags(lineValues(line, currentOptions(speaker)), storedOptions(speaker));
    }

    /** The language Auto's numbers are shown for: the one chosen, else the character's own. */
    function autoKey(group, values) {
        const refLang = group.raw?.reference?.language || group.language || '';
        return values.language !== 'auto' ? values.language : (refLang || 'all');
    }

    /** A mode's four numbers for `group` reading with `values`: Auto's from the presets and its settings. */
    function modeNumbers(group, values, id) {
        if (id !== AUTO_MODE) return state.presets?.presets?.[id];
        const refLang = group.raw?.reference?.language || group.language || '';
        return lineTuning(state.presets, tuningRows(characterSettings(group)), refLang, autoKey(group, values)).values;
    }

    /** One line read by its character (`speaker`) in mode `mode`, for the listen row and a card's ▶. */
    function takeFor(line, mode, speaker = null, values = null) {
        const who = speaker || getScript().speakerOf(line);
        const own = values || (line ? valuesOfLine(line) : currentOptions(who));
        const id = mode ?? own.preset;
        const words = String(line?.text || '').trim();
        const refLang = who.raw?.reference?.language || who.language;
        const text = words
            ? `${line.emotion && line.emotion !== 'main' ? `{${line.emotion}}` : ''}${words}`
            : SAMPLE_LINES[refLang] || SAMPLE_LINES.zh;
        return { character: who.character, text, language: own.language, speed: own.speed, mode: id, preset: id, numbers: modeNumbers(who, own, id) };
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
            state.format = Number(status?.format) || 0;
            state.supported = state.format >= MIN_FORMAT && NUMBERS.every(name => spec[name]);
            state.local = status?.local !== false;
            if (state.format >= PRESETS_FORMAT) state.presets = await loadPresets();
        } catch (_) {
            state.supported = false;
        }
        state.options.clear(); // options built before the spec arrived lack the node's defaults
        render();
        onBusyChange?.(); // the director draws its cards again, now with their ▶
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
        keepParamFocus(settings, render);
    }

    async function generate() {
        const script = getScript();
        if (!script?.group || script.pkg.error || state.job || !state.supported) return;
        const character = script.group.character;
        let inputs = {};
        if (!canTag()) {
            // An older node: the whole script as the first line's character reads it.
            const { language, speed, preset } = currentOptions(script.group);
            inputs = { language, speed, ...(state.presets && preset !== AUTO_MODE ? { preset } : {}) };
        }
        const prompt = buildTtsPrompt({ character, speech: script.pkg.speech, seed: state.seed, ...inputs });
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

    async function storeDefaults(group) {
        const { character } = group;
        const opts = { ...currentOptions(group) };
        state.saving = true;
        render();
        try {
            // Start from the file as it is now, so edits made elsewhere (the generation settings) are kept.
            const fresh = await fetchGptSovitsCharacter(character);
            if (fresh.settings_error) throw new Error(t('scriptRunSettingsBroken', { error: fresh.settings_error }));
            const saved = { ...(fresh.settings || {}), format: 1 };
            // Only what differs from the node's own defaults, so the file stays short.
            const defaults = { ...(saved.defaults || {}) };
            if (opts.language !== 'auto') defaults.language = opts.language; else delete defaults.language;
            if (opts.speed !== state.spec.speed.default) defaults.speed = opts.speed; else delete defaults.speed;
            if (Object.keys(defaults).length) saved.defaults = defaults; else delete saved.defaults;
            await saveGptSovitsSettings(character, saved);
            state.settings.set(character, saved);
            state.saved.set(character, { ...opts, preset: AUTO_MODE });
            state.savedNow = character;
            setTimeout(() => { state.savedNow = null; render(); }, 1600);
        } catch (error) {
            await anomalousAlert(t('scriptRunDefaultsFailed', { error: error.message }));
        } finally {
            state.saving = false;
            render();
        }
    }

    function saveButton(group) {
        const label = state.savedNow === group.character ? t('scriptRunDefaultsSaved') : t('scriptRunSaveDefaults');
        const btn = button('anomalous-sd-link-btn', label, () => storeDefaults(group), t('scriptRunSaveDefaultsHint'));
        btn.disabled = state.saving;
        return btn;
    }

    /** The side panel's view of the moment (ui_script_tune.js). */
    function renderSettings(script, busy) {
        const changed = () => {
            onLinesChange?.();
            render();
        };
        renderTunePanel(settings, {
            script,
            view: state.presets,
            spec: state.spec,
            busy,
            local: state.local,
            canTag: canTag(),
            presetNote: state.presetNote,
            preview,
            redraw: render,
            options: currentOptions,
            lineValues: valuesOfLine,
            setCharacter: (group, field, value) => {
                currentOptions(group)[field] = value;
                state.presetNote = '';
                changed();
            },
            setLines: (indexes, field, value) => {
                setLineTune(indexes.map(index => script.lines[index]), field, value);
                state.presetNote = '';
                changed();
            },
            clearLines: (indexes) => {
                clearLineTune(indexes.map(index => script.lines[index]));
                changed();
            },
            modeNumbers,
            autoLanguage: (group, values) => {
                const key = autoKey(group, values);
                return key === 'all' ? t('ttsTuningAll') : t(`scriptRunLang_${key}`);
            },
            takeFor,
            editPreset,
            canSave: group => state.savedNow === group.character || !sameOptions(currentOptions(group), storedOptions(group)),
            saveButton,
            openPresets: () => openTtsSetup({ groups: getGroups?.() || [], showPresets: true, onChanged: reloadPresets }),
            openTuning: group => openTuningEditor(group, {
                onSaved: (saved) => {
                    if (saved?.raw?.settings) state.settings.set(group.character, saved.raw.settings);
                    render();
                },
            }),
        });
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
        if (ready) renderSettings(script, busy);

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
        tagsOf,
        /** A card's ▶: its line (the director set it as the one to listen with) as it will be read. */
        listen() {
            const script = getScript();
            const line = script?.lines?.[script.listen];
            if (!line || !this.canListen()) return;
            preview.play(takeFor(line));
        },
        /** Whether the cards show ▶ (the node has modes, a character is chosen, nothing runs). */
        canListen() {
            return Boolean(state.presets && state.supported && !state.job && getScript()?.group);
        },
        /** A line can be retaken once this character has a result and nothing is running. */
        canRetake(group) {
            return Boolean(state.supported && !state.job && state.result && group && state.result.character === group.character);
        },
        /** The presets, for the tags on the cards (ui_script_tune.js ownTuneText). */
        presetsView: () => state.presets,
        stopPlayback() {
            player.pause();
            preview.stop();
        },
    };
}
