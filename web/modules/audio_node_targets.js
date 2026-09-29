import { comboValueForPath } from './audio_script.js';

/**
 * The only canvas nodes the audio studio writes into. No guessing by widget name:
 * a node that is not listed here is refused. Each node picks a character in
 * `voiceWidget` (only values its own dropdown offers, in its spelling) and
 * switches emotions itself through `{emotion}` tags in `speechWidget`, where the
 * Script Director writes the tagged script.
 *
 * To support a new node, add one entry and a test; nothing else changes.
 */
export const AUDIO_NODE_TARGETS = Object.freeze([
    Object.freeze({
        id: 'anomalous-tts',
        label: 'GPT-SoVITS',
        types: Object.freeze(['AnomalousTTS_CharacterSpeech']),
        voiceWidget: 'character',
        speechWidget: 'text',
    }),
]);

export function targetForNode(node) {
    const type = node?.type || node?.comfyClass;
    return AUDIO_NODE_TARGETS.find(target => target.types.includes(type)) || null;
}

/**
 * Decide what dropping the character `group` on `node` does, without touching the node.
 * Returns { ok: true, target, widget, value } or { ok: false, reason, target?, path? }.
 */
export function planVoiceDrop(node, group) {
    const target = targetForNode(node);
    if (!target) return { ok: false, reason: 'unsupported' };
    if (!group?.has_main) return { ok: false, reason: 'noMainVoice', target };
    const widget = node.widgets?.find(item => item.name === target.voiceWidget);
    if (!widget) return { ok: false, reason: 'unsupported', target };
    const value = comboValueForPath(widget, group.node_value);
    if (value == null) return { ok: false, reason: 'notListed', target, path: group.node_value };
    return { ok: true, target, widget, value };
}
