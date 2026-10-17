import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { button, el } from './usage_view.js';
import { buildTtsPrompt } from './audio_script.js';
import { startPromptJob } from './audio_tts_run.js';

/**
 * Listening to the generation modes: one sentence read by one character with the same seed,
 * only the mode changing, through the node's Preview Audio (temp files, out of the audio
 * gallery). Takes are kept for the page session by character, sentence, language, speed and the
 * mode's numbers, so a mode heard before plays again at once and a changed number makes a new
 * take; one take is made at a time.
 */

const SEED = 20261017;

/** `onChange()` when a take starts or is done (the caller draws its row again). */
export function createModePreview(onChange) {
    const takes = new Map(); // key -> url
    const player = new Audio();
    let job = null;
    let making = null; // the key of the take being made

    const keyOf = take => JSON.stringify([take.character, take.text, take.language, take.speed, take.mode, take.numbers]);

    /** `take`: `{character, text, language, speed, mode, preset, numbers}`; `preset` empty = Auto. */
    async function play(take) {
        const key = keyOf(take);
        player.pause();
        if (takes.has(key)) {
            player.src = takes.get(key);
            player.play().catch(() => {});
            return;
        }
        if (job || !take.text || !take.character) return;
        making = key;
        onChange?.();
        const chosen = take.preset ? { preset: take.preset } : {};
        job = startPromptJob(buildTtsPrompt({
            character: take.character, speech: take.text, seed: SEED, language: take.language, speed: take.speed, preview: true, ...chosen,
        }));
        try {
            const { outputs } = await job.result;
            const audio = outputs['2']?.audio?.[0];
            if (!audio) throw new Error(t('scriptRunNoAudio'));
            const query = new URLSearchParams({ filename: audio.filename, subfolder: audio.subfolder || '', type: audio.type || 'temp' });
            takes.set(key, `/view?${query}&t=${Date.now()}`);
            player.src = takes.get(key);
            player.play().catch(() => {});
        } catch (error) {
            if (!error.cancelled) await anomalousAlert(t('scriptRunFailed', { error: error.message }));
        } finally {
            job = null;
            making = null;
            onChange?.();
        }
    }

    /**
     * The listen row: "Listen to this one" for the picked mode, then the modes already heard
     * with this sentence (a click picks the mode and plays its take). `takeFor(id)` builds a take;
     * `lead`: elements before the button (which line is read); `withButton` false leaves the
     * button to the caller (the Script Director's cards) and says "Making it…" instead.
     */
    function row({ takeFor, selected, modes, onPick, disabled = false, lead = [], withButton = true }) {
        const box = el('div', 'anomalous-tts-takes');
        box.append(...lead);
        const current = takeFor(selected);
        const key = keyOf(current);
        if (withButton) {
            const label = making === key ? 'ttsListenMaking' : (takes.has(key) ? 'ttsListenAgain' : 'ttsListen');
            const listen = button('anomalous-sd-btn', t(label), () => play(current));
            listen.title = t('ttsListenHint');
            listen.disabled = disabled || (Boolean(job) && !takes.has(key)) || !current.text || !current.character;
            box.append(listen);
        } else if (making === key) {
            box.append(el('span', 'anomalous-tts-setup-meta', t('ttsListenMaking')));
        }
        const heard = modes.filter(mode => takes.has(keyOf(takeFor(mode.id))));
        if (heard.length) {
            box.append(el('span', 'anomalous-tts-setup-meta', t('ttsListenHeard')));
            for (const mode of heard) {
                const take = button(`anomalous-tts-listen-take${mode.id === selected ? ' is-current' : ''}`, `▶ ${mode.label}`, () => {
                    if (mode.id !== selected) onPick(mode.id);
                    play(takeFor(mode.id));
                });
                box.append(take);
            }
        }
        return box;
    }

    return { row, play, stop: () => player.pause() };
}
