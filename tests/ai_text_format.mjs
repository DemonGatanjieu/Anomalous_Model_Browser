// node tests/ai_text_format.mjs — the little layout of the AI's notes: blocks and inline pieces, never markup.
import assert from 'node:assert/strict';
import { inline, parseNote } from '../web/modules/ai_text_format.js';

assert.deepEqual(inline('删掉 **多出来的手**，负向词加 `extra arms`。'), [
    { text: '删掉 ' }, { text: '多出来的手', bold: true }, { text: '，负向词加 ' }, { text: 'extra arms', code: true }, { text: '。' },
]);
assert.deepEqual(inline('<b>不是网页</b>'), [{ text: '<b>不是网页</b>' }], 'tags stay text');

const blocks = parseNote([
    '### 发现的问题',
    '1. **多长了一只手**：腰部多出一截手腕',
    '2. 元素串色',
    '',
    '怎么修：',
    '第二行接着同一段',
    '- 方案 1：局部重绘',
    '* 方案 2：换 Seed',
    '---',
    '结论',
].join('\n'));
assert.deepEqual(blocks.map(block => [block.type, block.lines.length]), [
    ['heading', 1], ['numbers', 2], ['paragraph', 2], ['bullets', 2], ['rule', 0], ['paragraph', 1],
]);
assert.deepEqual(blocks[1].lines[0][0], { text: '多长了一只手', bold: true });
assert.deepEqual(parseNote(''), []);
console.log('ai_text_format: ok');
