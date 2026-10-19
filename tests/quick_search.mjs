// The canvas quick search's matching (web/modules/quick_search_data.js).
import assert from 'node:assert/strict';
import { comboItem, modelItem, promptItem, queryTerms, searchQuick } from '../web/modules/quick_search_data.js';

const models = [
    modelItem({ type: 'loras', subfolder: 'chars', filename: 'ahri_v2.safetensors', name: '', civitai_name: 'Ahri (LoL)', base: 'Illustrious', words: ['ahri', 'fox ears'] }),
    modelItem({ type: 'checkpoints', subfolder: '', filename: 'waiIllustrious.safetensors', name: 'WAI Illustrious', civitai_name: '', base: 'Illustrious', words: [] }),
    modelItem({ type: 'loras', subfolder: '', filename: 'kimono.safetensors', name: '', civitai_name: '', base: 'SDXL', words: ['kimono'] }),
];
const combos = [comboItem({ filename: 'a.json', name: 'Ahri · fox ears' }, { detail: 'WAI Illustrious · 1 LoRA' }), comboItem({ filename: 'b.json', name: 'Beach' })];
const prompts = [promptItem({ id: 'p1', title: 'Fox girl', content: '1girl, fox ears,\n kimono', role: 'positive' })];
const all = [...models, ...combos, ...prompts];

assert.deepEqual(queryTerms('  Fox  Ears '), ['fox', 'ears']);
// A model's name: its own, else Civitai's, else the file's.
assert.deepEqual(models.map(item => item.title), ['Ahri (LoL)', 'WAI Illustrious', 'kimono']);
assert.equal(prompts[0].detail, '1girl, fox ears, kimono');

// Every word must appear; groups in the order combos, models, prompts.
let groups = searchQuick(all, 'fox ears');
assert.deepEqual(groups.map(group => group.kind), ['combo', 'model', 'prompt']);
assert.equal(groups[1].items[0].title, 'Ahri (LoL)'); // by its trigger words
// Names starting with the words come first.
groups = searchQuick(all, 'illustrious');
assert.deepEqual(groups.find(group => group.kind === 'model').items.map(item => item.title), ['WAI Illustrious', 'Ahri (LoL)']);
// One kind only, and a cap with how many more.
groups = searchQuick(all, 'a', { kind: 'model', perKind: 1 });
assert.equal(groups.length, 1);
assert.equal(groups[0].more, 2);
// No words: the combos as they are.
groups = searchQuick(all, '');
assert.deepEqual(groups.map(group => group.kind), ['combo']);
assert.equal(groups[0].items.length, 2);
assert.equal(searchQuick(all, '', { kind: 'prompt' })[0].items.length, 1);
// Nothing matches.
assert.deepEqual(searchQuick(all, 'zzz'), []);
console.log('quick search: ok');
