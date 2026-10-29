// node tests/model_versions.mjs — versions of one model grouped by their Civitai page only (never by a
// similar file name), newest first, the picked one shown; the free name for a version's download.
import assert from 'node:assert/strict';
import { freeName, groupByPage, pageId, versionsOf } from '../web/modules/model_versions.js';

const file = (filename, model_id, version_id) => ({ filename, metadata: model_id ? { model_id, version_id } : {} });
const v1 = file('style.safetensors', 10, 100);
const v3 = file('style_v3.safetensors', 10, 300);
const v2 = file('style (1).safetensors', 10, 200);
const lone = file('style.safetensors.bak', 0, 0);
const sameName = file('style.safetensors', 0, 0); // the same file name, nothing on Civitai: not a version
const other = file('other.safetensors', 11, 110);
const unmatched = file('broken.safetensors', -1, -1); // id -1: the scanner found no match

const entries = groupByPage([v1, lone, other, v3, sameName, v2, unmatched]);
assert.deepEqual(entries.map(entry => entry.model.filename),
    ['style_v3.safetensors', 'style.safetensors.bak', 'other.safetensors', 'style.safetensors', 'broken.safetensors'],
    'a page at the place of its first file, shown by its newest version; the rest alone');
assert.deepEqual(entries[0].versions, [v3, v2, v1], 'newest first');
assert.equal(entries[3].model, sameName);
assert.deepEqual(entries[3].versions, [sameName], 'a like name does not join a model');
assert.equal(pageId(unmatched), 0);

const picked = groupByPage([v1, v3, v2], page => (page === 10 ? 100 : 0));
assert.equal(picked[0].model, v1, 'the version picked last is shown');
assert.equal(groupByPage([v1, v3], () => 999)[0].model, v3, 'a pick no longer here: the newest');

assert.deepEqual(versionsOf([v1, other, v3], v1), [v3, v1]);
assert.deepEqual(versionsOf([v1, v3], sameName), [sameName]);

const taken = new Set(['style.safetensors', 'style_v2.0.safetensors']);
assert.equal(freeName('new.safetensors', 'v2.0', taken), 'new.safetensors');
assert.equal(freeName('style.safetensors', 'v1 / Illustrious', taken), 'style_v1_Illustrious.safetensors');
assert.equal(freeName('style.safetensors', 'v2.0', taken), 'style_v2.0_2.safetensors');
console.log('model_versions ok');
