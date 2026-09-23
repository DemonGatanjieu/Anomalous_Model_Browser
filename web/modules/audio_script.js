/**
 * Pure rules for ComfyUI-F5-TTS voices (no DOM, no canvas access).
 *
 * F5-TTS multi-voice layout: the node's `sample` is a main voice such as
 * `F5-TTS/Arona.wav`; `{happy}` in the speech loads `F5-TTS/Arona.happy.wav`
 * beside it, and `{main}` is the sample itself. Speech is split only at tags.
 */

export const MAIN_TAG = '{main}';

const normalisePath = value => String(value ?? '').replace(/\\/g, '/');

/** Return the widget's own spelling of `relativePath` (Windows combos use "F5-TTS\\x.wav"), or null when not offered. */
export function comboValueForPath(widget, relativePath) {
    const wanted = normalisePath(relativePath);
    if (!wanted) return null;
    const values = Array.isArray(widget?.options?.values) ? widget.options.values : null;
    if (!values) return wanted;
    return values.find(value => normalisePath(value) === wanted) ?? null;
}

/** Split on sentence punctuation and newlines; '.' only ends a line before whitespace (keeps 3.5). */
export function splitScriptLines(text) {
    return String(text || '')
        .split(/\n+|(?<=[。！？!?…])|(?<=\.)(?=\s)/)
        .map(line => line.trim())
        .filter(Boolean);
}

/** Once any line is tagged, untagged lines get {main} instead of inheriting the previous voice. */
export function composeScript(lines) {
    const anyTagged = lines.some(line => line.voice?.tag);
    return lines
        .map(line => {
            const tag = line.voice?.tag || (anyTagged ? MAIN_TAG : '');
            return tag ? `${tag} ${line.text}` : line.text;
        })
        .join('\n')
        .trim();
}

/** Check the tagged voices can run in one F5TTSAudio node; returns { mainPath } or { error: localeKey }. */
export function planScriptVoices(lines) {
    const voices = lines.map(line => line.voice).filter(Boolean);
    if (!voices.length) return { mainPath: null };
    if (new Set(voices.map(voice => voice.group)).size > 1) return { error: 'scriptDirectorMixedCharacters' };
    if (voices.some(voice => !voice.usable)) return { error: 'scriptDirectorVoiceUnusable' };
    if (!voices[0].mainPath) return { error: 'scriptDirectorMainMissing' };
    return { mainPath: voices[0].mainPath };
}
