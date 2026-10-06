// Run: node tests/audio_node_targets.mjs  (pure rules, no DOM)
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { planVoiceDrop, targetForNode } =
    await import(pathToFileURL(path.join(root, 'web/modules/audio_node_targets.js')).href);

const ttsNode = (values = ['阿罗娜/日配数据集制', '普拉娜']) => ({
    type: 'AnomalousTTS_CharacterSpeech',
    widgets: [{ name: 'character', value: '', options: { values } }, { name: 'text', value: '' }],
});
const group = { character: '阿罗娜/日配数据集制', node_value: '阿罗娜/日配数据集制', has_main: true };

// A character name goes into `character`, in the node's own spelling.
const plan = planVoiceDrop(ttsNode(), group);
assert.equal(plan.ok, true);
assert.equal(plan.value, '阿罗娜/日配数据集制');
assert.equal(plan.widget.name, 'character');
assert.equal(planVoiceDrop(ttsNode(['阿罗娜\\日配数据集制']), group).value, '阿罗娜\\日配数据集制', 'Windows spelling');
assert.equal(targetForNode(ttsNode()).speechWidget, 'text');
assert.equal(targetForNode({ comfyClass: 'AnomalousTTS_CharacterSpeech' })?.id, 'anomalous-tts');

// Anything not listed is refused, even with a matching widget name; Load Audio and F5-TTS included.
const lookalike = { type: 'SomeOtherTTS', widgets: [{ name: 'character', options: { values: [group.node_value] } }] };
for (const node of [lookalike, { type: 'LoadAudio', widgets: [] }, { type: 'F5TTSAudio', widgets: [] }]) {
    assert.equal(targetForNode(node), null, node.type);
    assert.equal(planVoiceDrop(node, group).reason, 'unsupported', node.type);
}
assert.equal(planVoiceDrop(null, group).reason, 'unsupported');

// Refusals that explain themselves.
assert.equal(planVoiceDrop(ttsNode(['普拉娜']), group).reason, 'notListed');
assert.equal(planVoiceDrop(ttsNode(['普拉娜']), group).path, group.node_value);
assert.equal(planVoiceDrop(ttsNode(), { ...group, has_main: false }).reason, 'noMainVoice');
assert.equal(planVoiceDrop({ type: 'AnomalousTTS_CharacterSpeech', widgets: [] }, group).reason, 'unsupported');
console.log('audio node target rules OK');
