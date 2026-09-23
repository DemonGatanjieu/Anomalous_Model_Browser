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

/**
 * Split a script into segments. `sentence`: sentence punctuation and newlines
 * ('.' only before whitespace, so 3.5 stays whole). `line`: one segment per line.
 */
export function splitScriptLines(text, mode = 'sentence') {
    const pattern = mode === 'line' ? /\n+/ : /\n+|(?<=[。！？!?…])|(?<=\.)(?=\s)/;
    return String(text || '')
        .split(pattern)
        .map(line => line.trim())
        .filter(Boolean);
}

/** Join two segments: a space only between Latin words/digits, none for CJK text. */
export function joinSegments(first, second) {
    const a = String(first || '').trim();
    const b = String(second || '').trim();
    if (!a || !b) return a || b;
    return /[A-Za-z0-9,.;:!?]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : `${a}${b}`;
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

/** Emotions of a voice group that F5-TTS can load as `{emotion}` (main first). */
export function usableEmotions(group) {
    return (group?.slices || []).filter(slice => slice.tag_usable).map(slice => slice.emotion);
}

/**
 * Bundle script lines for one F5TTSAudio node. `lines` are `{ text, emotion }`;
 * the node's sample becomes the group's main voice and every emotion must be a
 * usable variant of that group. Returns `{ sample, speech, lineCount }` or `{ error: localeKey }`.
 */
export function buildScriptPackage(lines, group) {
    if (!group) return { error: 'scriptDirectorPickCharacter' };
    const usable = new Set(usableEmotions(group));
    if (!group.main_relative_path || !usable.has('main')) return { error: 'scriptDirectorMainMissing' };
    const voiced = [];
    for (const line of lines || []) {
        const text = String(line?.text || '').trim();
        if (!text) continue;
        const emotion = line.emotion || 'main';
        if (!usable.has(emotion)) return { error: 'scriptDirectorVoiceUnusable' };
        voiced.push({ text, voice: emotion === 'main' ? null : { tag: `{${emotion}}` } });
    }
    if (!voiced.length) return { error: 'scriptDirectorEmpty' };
    return { sample: group.main_relative_path, speech: composeScript(voiced), lineCount: voiced.length };
}
