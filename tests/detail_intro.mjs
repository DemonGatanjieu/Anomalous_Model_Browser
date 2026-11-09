// The model details' author text (web/modules/detail_intro.js): folded as last left, which language to offer, paragraphs.
import assert from 'node:assert/strict';
import { introFolded, introLanguage, keepIntroFolded, paragraphsOf } from '../web/modules/detail_intro.js';

const memory = () => {
    const items = new Map();
    return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
};
const store = memory();
assert.equal(introFolded(store), true, 'folded at first');
keepIntroFolded(false, store);
assert.equal(introFolded(store), false, 'unfolded once, it opens unfolded');
keepIntroFolded(true, store);
assert.equal(introFolded(store), true);
assert.equal(introFolded(null), true);

const english = 'Kirazuri (Anima) is a full fine-tune of the Anima Base model focused on several goals.';
assert.equal(introLanguage(english, 'zh'), 'zh-CN');
assert.equal(introLanguage('这是一个二次元模型，适合画插画。', 'zh'), '', 'Chinese on the Chinese window reads as it is');
assert.equal(introLanguage('short', 'zh'), '', 'too little to translate');
assert.equal(introLanguage(english, 'en'), '');
assert.equal(introLanguage('これはアニメ調のイラストに向いたモデルです。', 'en'), 'en');

assert.deepEqual(paragraphsOf({ innerText: 'Title\n\n  First   line \n- a point\n\n' }), ['Title', 'First line', '- a point']);
assert.deepEqual(paragraphsOf({ textContent: 'one only' }), ['one only']);

console.log('detail_intro: ok');
