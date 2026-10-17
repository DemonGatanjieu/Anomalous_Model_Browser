/**
 * Pure script rules for GPT-SoVITS (Anomalous_TTS) scripts (no DOM, no canvas access).
 *
 * The node takes a character and a script in which `{happy}` switches to that
 * emotion's reference, `{main}` back to the main one, and `[take:N]` asks for
 * another take of one line. `buildTtsPrompt` runs a script without a canvas.
 */

export const MAIN_TAG = '{main}';

const normalisePath = value => String(value ?? '').replace(/\\/g, '/');

/** Return the widget's own spelling of `relativePath` (slashes may differ on Windows), or null when not offered. */
export function comboValueForPath(widget, relativePath) {
    const wanted = normalisePath(relativePath);
    if (!wanted) return null;
    const values = Array.isArray(widget?.options?.values) ? widget.options.values : null;
    if (!values) return wanted;
    return values.find(value => normalisePath(value) === wanted) ?? null;
}

const SENTENCE_END = new Set(['。', '！', '？', '!', '?']);
// Closing quotes/brackets and trailing marks that belong to the sentence they follow.
const TRAILING = new Set(['。', '！', '？', '!', '?', '」', '』', '”', '’', '"', "'", '）', ')', '】', '》', '〉', '~', '～']);
const SPEAKABLE = /[\p{L}\p{N}]/u;

function splitSentences(line) {
    const chars = [...line];
    const segments = [];
    let current = '';
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        current += char;
        // A single '.' ends an English sentence only before whitespace; '3.5', '...' and '……' do not split.
        const isPeriod = char === '.' && chars[i - 1] !== '.' && chars[i + 1] !== '.' && (i + 1 >= chars.length || /\s/.test(chars[i + 1]));
        if (!SENTENCE_END.has(char) && !isPeriod) continue;
        while (i + 1 < chars.length && TRAILING.has(chars[i + 1])) current += chars[++i];
        segments.push(current);
        current = '';
    }
    segments.push(current);
    return segments;
}

/** Punctuation-only pieces ("……", "！」") cannot be spoken on their own: attach them to a neighbour. */
function attachUnspeakable(segments) {
    const result = [];
    let pending = '';
    for (const segment of segments) {
        if (SPEAKABLE.test(segment)) {
            result.push(pending + segment);
            pending = '';
        } else if (result.length) {
            result[result.length - 1] += segment;
        } else {
            pending += segment;
        }
    }
    if (pending) result.push(pending);
    return result;
}

/**
 * Split a script into segments. `sentence`: at 。！？!? (with trailing quotes or
 * brackets) and newlines; ellipses never split. `line`: one segment per line.
 */
export function splitScriptLines(text, mode = 'sentence') {
    const lines = String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
    const segments = mode === 'line' ? lines : lines.flatMap(splitSentences);
    return attachUnspeakable(segments.map(segment => segment.trim()).filter(Boolean));
}

/** Split one segment at a caret position; null when either side would be empty. */
export function splitSegmentAt(text, position) {
    const value = String(text || '');
    const before = value.slice(0, position).trim();
    const after = value.slice(position).trim();
    return before && after ? [before, after] : null;
}

/** Join two segments: a space only between Latin words/digits, none for CJK text. */
export function joinSegments(first, second) {
    const a = String(first || '').trim();
    const b = String(second || '').trim();
    if (!a || !b) return a || b;
    return /[A-Za-z0-9,.;:!?]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : `${a}${b}`;
}

/**
 * Once any line is tagged, untagged lines get {main} instead of inheriting the previous voice.
 * A line with `take` > 1 (GPT-SoVITS only) gets `[take:N]` right before its text; a line's
 * `speaker` (`[name]`, where another character takes over) goes first.
 */
export function composeScript(lines) {
    const anyTagged = lines.some(line => line.voice?.tag);
    return lines
        .map(line => {
            const tag = line.voice?.tag || (anyTagged ? MAIN_TAG : '');
            const text = line.take > 1 ? `[take:${line.take}]${line.text}` : line.text;
            return `${line.speaker || ''}${tag ? `${tag} ${text}` : text}`;
        })
        .join('\n')
        .trim();
}

/** Emotions of a voice group the node can switch to with `{emotion}` (main first). */
export function usableEmotions(group) {
    return (group?.slices || []).map(slice => slice.emotion);
}

const speaks = group => Boolean(group?.node_value) && group.has_main !== false && usableEmotions(group).includes('main');

/**
 * Bundle script lines for one TTS node. `lines` are `{ text, emotion, speaker? }`; the node's
 * `character` widget gets the group's `node_value`. A line's `speaker` (a voice group key from
 * `groups`) is read by that character instead: `[name]` goes in where the speaker changes
 * (Anomalous_TTS's script syntax). Every emotion must be usable for its line's character.
 * `takes` (runs in the director) writes each line's `take` as `[take:N]`.
 * Returns `{ sample, speech, lineCount, speakers }` (the characters heard, the node's first)
 * or `{ error: localeKey }`.
 */
export function buildScriptPackage(lines, group, { takes = false, groups = [] } = {}) {
    if (!group) return { error: 'scriptDirectorPickCharacter' };
    if (!speaks(group)) return { error: 'scriptDirectorMainMissing' };
    const byKey = new Map(groups.map(item => [item.group, item]));
    const voiced = [];
    const speakers = [group.node_value];
    let current = group;
    for (const line of lines || []) {
        const text = String(line?.text || '').trim();
        if (!text) continue;
        const speaker = line.speaker && line.speaker !== group.group ? byKey.get(line.speaker) : group;
        if (!speaks(speaker)) return { error: 'scriptDirectorSpeakerUnusable' };
        const emotion = line.emotion || 'main';
        if (!usableEmotions(speaker).includes(emotion)) return { error: 'scriptDirectorVoiceUnusable' };
        voiced.push({
            text,
            voice: emotion === 'main' ? null : { tag: `{${emotion}}` },
            take: takes ? line.take || 1 : 1,
            speaker: speaker === current ? '' : `[${speaker.node_value}]`,
        });
        current = speaker;
        if (!speakers.includes(speaker.node_value)) speakers.push(speaker.node_value);
    }
    if (!voiced.length) return { error: 'scriptDirectorEmpty' };
    return { sample: group.node_value, speech: composeScript(voiced), lineCount: voiced.length, speakers };
}

/** Save Audio prefix for a character: `output/audio/<character>/…`, keeping file names Windows accepts. */
export function ttsOutputPrefix(character) {
    const parts = String(character || '').split('/')
        .map(part => part.replace(/[<>:"\\|?*\u0000-\u001f]/g, '_').trim().replace(/^\.+$/, '_') || '_');
    return `audio/${parts.join('/')}/${parts[parts.length - 1]}`;
}

export const TTS_NODE_CLASS = 'AnomalousTTS_CharacterSpeech';

/**
 * ComfyUI API prompt for one GPT-SoVITS script: the character node, then Save Audio
 * (`preview: true`: Preview Audio, a temp file that stays out of the audio gallery).
 * `inputs` are more node inputs by name (speed, top_k …); left out, the node's defaults apply.
 */
export function buildTtsPrompt({ character, speech, seed, language = 'auto', preview = false, ...inputs }) {
    return {
        1: {
            class_type: TTS_NODE_CLASS,
            inputs: { character, text: speech, seed, language, ...inputs },
        },
        2: preview
            ? { class_type: 'PreviewAudio', inputs: { audio: ['1', 0] } }
            : { class_type: 'SaveAudio', inputs: { audio: ['1', 0], filename_prefix: ttsOutputPrefix(character) } },
    };
}

const TAKE_TAG = /^\s*(?:take|版本)\s*[:：]\s*\d+\s*$/i;
const PAUSE_TAG = /^\s*(?:pause|wait|stop|停顿|暂停)\s*[:：]/i;

/**
 * Read a tagged script back into segments, splitting at `{emotion}` and `[name]` tags
 * (`speaker`: the name, only on segments after one; the emotion goes back to main there).
 * Text before the first tag belongs to the main voice; `[take:N]` is left out, pauses stay.
 */
export function parseTaggedSpeech(speech) {
    const segments = [];
    let speaker = null;
    let emotion = 'main';
    let text = '';
    const flush = () => {
        const words = text.trim();
        if (words) segments.push({ emotion, text: words, ...(speaker ? { speaker } : {}) });
        text = '';
    };
    for (const part of String(speech || '').split(/(\{[^{}]+\}|\[[^[\]]+\])/)) {
        const tag = /^\{([^{}]+)\}$/.exec(part);
        const bracket = /^\[([^[\]]+)\]$/.exec(part);
        if (tag) {
            flush();
            emotion = tag[1].trim();
        } else if (bracket && TAKE_TAG.test(bracket[1])) {
            continue; // another take only meant something for that run
        } else if (bracket && !PAUSE_TAG.test(bracket[1])) {
            flush();
            speaker = bracket[1].trim();
            emotion = 'main';
        } else {
            text += part;
        }
    }
    flush();
    return segments;
}
