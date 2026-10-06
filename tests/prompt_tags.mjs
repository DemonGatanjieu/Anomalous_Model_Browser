import assert from 'node:assert/strict';
import { insertTags, joinPrompt, moveTag, promptTagsOf, removeTag, replaceTag, splitPrompt, tagWeight, withWeight } from '../web/modules/prompt_tags.js';

const texts = value => splitPrompt(value).items.map(item => item.text);

// Round trip keeps every character.
for (const value of ['', 'a', 'a, b', ' a ,b,\n\nc\n', 'masterpiece, (red hair:1.2), <lora:x:0.8>, c', 'a，b、c', ', a, , b,']) {
    assert.equal(joinPrompt(splitPrompt(value)), value, JSON.stringify(value));
}
assert.deepEqual(texts('a, (b, c:1.2), <lora:x, y:0.5>\nd，e,'), ['a', '(b, c:1.2)', '<lora:x, y:0.5>', 'd', 'e']);
const backslash = String.fromCharCode(92);
assert.deepEqual(texts(`artist ${backslash}(x, y${backslash}), z`), [`artist ${backslash}(x`, `y${backslash})`, 'z']);
assert.deepEqual(promptTagsOf(',, a ,, b ,'), ['a', 'b']);

// Weights.
assert.deepEqual(tagWeight('(red hair:1.2)'), { core: 'red hair', weight: 1.2 });
assert.deepEqual(tagWeight('red hair'), { core: 'red hair', weight: 1 });
assert.equal(withWeight('red hair', 1.1), '(red hair:1.1)');
assert.equal(withWeight('(red hair:1.1)', 1), 'red hair');
assert.equal(withWeight('(red hair:1.95)', 5), '(red hair:2)');

// Insert: at the end the text's ending stays last; duplicates by words are skipped.
assert.deepEqual(insertTags('a, b', ['c']), { value: 'a, b, c', added: 1, skipped: 0 });
assert.deepEqual(insertTags('a, b,\n', ['c']), { value: 'a, b, c,\n', added: 1, skipped: 0 });
assert.deepEqual(insertTags('', ['a', 'b']), { value: 'a, b', added: 2, skipped: 0 });
assert.deepEqual(insertTags('a, (B:1.2)', ['b', 'c', 'c']), { value: 'a, (B:1.2), c', added: 1, skipped: 2 });
assert.equal(insertTags('a, b', ['x'], 0).value, 'x, a, b');
assert.equal(insertTags('a,\nb', ['x'], 1).value, 'a,\nx, b');

// Remove, replace, move.
assert.equal(removeTag('a, b, c', 1), 'a, c');
assert.equal(removeTag('a, b, c,\n', 2), 'a, b,\n');
assert.equal(removeTag('a', 0), '');
assert.equal(replaceTag('a, b, c', 1, '(b:1.2)'), 'a, (b:1.2), c');
assert.equal(replaceTag('a, b, c', 1, '  '), 'a, c');
assert.equal(moveTag('a, b, c', 0, 3), 'b, c, a');
assert.equal(moveTag('a, b, c', 2, 0), 'c, a, b');
assert.equal(moveTag('a, b, c', 0, 1), 'a, b, c');
assert.equal(moveTag('a, b, c,\n', 0, 3), 'b, c, a,\n');

console.log('prompt_tags ok');
