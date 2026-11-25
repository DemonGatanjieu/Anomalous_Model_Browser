/**
 * How a video cover plays in the model details (ui_detail.js): whether it starts by itself and whether it has
 * sound, both on until turned off in Settings → Look & Interaction (localStorage, this viewer only), as the details
 * always played them. Pure but the storage.
 */

const AUTOPLAY_KEY = 'anomalous_detail_video_autoplay';
const AUDIO_KEY = 'anomalous_detail_video_audio';

function isOn(key, store) {
    try {
        return store?.getItem(key) !== 'false';
    } catch {
        return true;
    }
}

function keepOn(key, on, store) {
    try {
        store?.setItem(key, on ? 'true' : 'false');
    } catch { /* it stays on next time */ }
}

export function detailVideoAutoplay(store = globalThis.localStorage) {
    return isOn(AUTOPLAY_KEY, store);
}

export function setDetailVideoAutoplay(on, store = globalThis.localStorage) {
    keepOn(AUTOPLAY_KEY, on, store);
}

export function detailVideoAudio(store = globalThis.localStorage) {
    return isOn(AUDIO_KEY, store);
}

export function setDetailVideoAudio(on, store = globalThis.localStorage) {
    keepOn(AUDIO_KEY, on, store);
}

/** `video` with the player's controls, looping, and starting and sound as chosen; returns it. */
export function applyDetailVideoPrefs(video, { autoplay, audio } = { autoplay: detailVideoAutoplay(), audio: detailVideoAudio() }) {
    video.controls = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = Boolean(autoplay);
    video.preload = autoplay ? 'auto' : 'metadata'; // waiting for play, it shows its first frame rather than black
    video.defaultMuted = !audio;
    video.muted = !audio;
    return video;
}
