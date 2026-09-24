import { comboValueForPath } from './audio_script.js';

/**
 * The only canvas nodes the audio studio writes into, and what each accepts.
 * No guessing by widget name: a node that is not listed here is refused.
 *
 * takes:
 *   'character' — the node picks a character's main voice and switches emotions itself
 *                 through `{emotion}` tags in its text (ComfyUI-F5-TTS multi-voice).
 *   'clip'      — the node uses exactly one audio file (ComfyUI's Load Audio).
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
        types: Object.freeze(['F5TTSAudio', 'F5TTSAudioAdvanced', 'F5TTSAudioFromModel']),
        takes: 'character',
        voiceWidget: 'sample',
        listedOnly: true,
        overriddenBy: 'sample_audio',
        speechWidget: 'speech',
    }),
    Object.freeze({
        id: 'load-audio',
        label: 'Load Audio',
        types: Object.freeze(['LoadAudio']),
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

/** Nodes the Script Director can write a tagged script into. */
export function isScriptTarget(node) {
    const target = targetForNode(node);
    return Boolean(target?.speechWidget && target.takes === 'character');
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
    if (item?.kind !== target.takes) {
        return { ok: false, reason: target.takes === 'character' ? 'needsCharacter' : 'needsClip', target };
    }
    const path = item.kind === 'character' ? item.group?.main_relative_path : item.slice?.relative_path;
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
