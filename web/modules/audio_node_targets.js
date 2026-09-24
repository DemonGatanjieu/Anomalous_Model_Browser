import { comboValueForPath } from './audio_script.js';

/**
 * The only canvas nodes the audio studio writes into, and what each accepts.
 * No guessing by widget name: a node that is not listed here is refused.
 *
 * engine: whose voices the node takes (audio_engines.js); voices of another engine are refused.
 * takes:
 *   'character' — the node picks a character and switches emotions itself through
 *                 `{emotion}` tags in its text (F5-TTS multi-voice, Anomalous_TTS).
 *   'clip'      — the node uses exactly one audio file (ComfyUI's Load Audio; files
 *                 from the input folder, i.e. the F5-TTS voice library).
 * listedOnly: write only values the node's own dropdown offers (in its spelling).
 * overriddenBy: an input that, when linked, makes the node ignore voiceWidget.
 * speechWidget: where the Script Director writes the tagged script.
 *
 * To support a new node, add one entry and a test; nothing else changes.
 */
export const AUDIO_NODE_TARGETS = Object.freeze([
    Object.freeze({
        id: 'f5-tts',
        label: 'F5-TTS',
        engine: 'f5',
        types: Object.freeze(['F5TTSAudio', 'F5TTSAudioAdvanced', 'F5TTSAudioFromModel']),
        typeLabels: Object.freeze(['F5-TTS Audio', 'F5-TTS Audio Advanced', 'F5-TTS Audio From Model']),
        takes: 'character',
        voiceWidget: 'sample',
        listedOnly: true,
        overriddenBy: 'sample_audio',
        speechWidget: 'speech',
    }),
    Object.freeze({
        id: 'anomalous-tts',
        label: 'GPT-SoVITS',
        engine: 'gpt_sovits',
        types: Object.freeze(['AnomalousTTS_CharacterSpeech']),
        typeLabels: Object.freeze(['角色语音 (GPT-SoVITS)']),
        takes: 'character',
        voiceWidget: 'character',
        listedOnly: true,
        speechWidget: 'text',
    }),
    Object.freeze({
        id: 'load-audio',
        label: 'Load Audio',
        engine: 'f5',
        types: Object.freeze(['LoadAudio']),
        typeLabels: Object.freeze(['Load Audio']),
        takes: 'clip',
        voiceWidget: 'audio',
        // Load Audio lists only the top of input/, but validates by file existence, so subfolders work.
        listedOnly: false,
    }),
]);

export const SUPPORTED_TARGET_LABELS = AUDIO_NODE_TARGETS.map(target => target.label);

export function targetForNode(node) {
    const type = node?.type || node?.comfyClass;
    return AUDIO_NODE_TARGETS.find(target => target.types.includes(type)) || null;
}

/** Nodes the Script Director can write a tagged script into; `engine` narrows to one engine's nodes. */
export function isScriptTarget(node, engine = null) {
    const target = targetForNode(node);
    return Boolean(target?.speechWidget && target.takes === 'character' && (!engine || target.engine === engine));
}

function widgetOf(node, name) {
    return name ? node?.widgets?.find(widget => widget.name === name) || null : null;
}

function inputLinked(node, name) {
    return Boolean(name && node?.inputs?.some(input => input?.name === name && input.link != null));
}

const forwardSlashes = value => String(value ?? '').replace(/\\/g, '/');

/**
 * Decide what dropping `item` on `node` does, without touching the node.
 * item: { kind: 'character', group } or { kind: 'clip', slice }.
 * Returns { ok: true, target, widget, value, voice } or { ok: false, reason, target?, ... }.
 */
export function planVoiceDrop(node, item) {
    const target = targetForNode(node);
    if (!target) return { ok: false, reason: 'unsupported' };
    const engine = item?.kind === 'character' ? item.group?.engine : item?.slice?.engine;
    if ((engine || 'f5') !== target.engine) return { ok: false, reason: 'otherEngine', target };
    if (item?.kind !== target.takes) {
        return { ok: false, reason: target.takes === 'character' ? 'needsCharacter' : 'needsClip', target };
    }
    const path = item.kind === 'character'
        ? (item.group?.has_main === false ? null : item.group?.node_value ?? item.group?.main_relative_path)
        : item.slice?.relative_path;
    if (!path) return { ok: false, reason: 'noMainVoice', target };
    if (inputLinked(node, target.overriddenBy)) return { ok: false, reason: 'overridden', target };
    const widget = widgetOf(node, target.voiceWidget);
    if (!widget) return { ok: false, reason: 'unsupported', target };
    const value = target.listedOnly ? comboValueForPath(widget, path) : forwardSlashes(path);
    if (value == null) return { ok: false, reason: 'notListed', target, path };
    return { ok: true, target, widget, value };
}

/** Rewrite template values ("F5-TTS/x.wav") to the node's own spelling where the node lists them. */
export function alignedVoiceValue(node) {
    const target = targetForNode(node);
    if (!target?.listedOnly) return null;
    const widget = widgetOf(node, target.voiceWidget);
    if (!widget || typeof widget.value !== 'string') return null;
    const value = comboValueForPath(widget, widget.value);
    return value != null && value !== widget.value ? { widget, value } : null;
}
