// The models page's base model filter (web/modules/model_bases.js).
import assert from 'node:assert/strict';
import { baseFamily, countBases, inFamily } from '../web/modules/model_bases.js';

const model = (baseModel, base_guess = '') => ({ metadata: { baseModel, base_guess } });

// Spellings of one family are one; the header's guess counts when nothing was scanned.
assert.equal(baseFamily(model('SDXL 1.0')), 'SDXL');
assert.equal(baseFamily(model('', 'SDXL')), 'SDXL');
assert.equal(baseFamily(model('Flux.1 D')), 'Flux');
assert.equal(baseFamily(model('Illustrious')), 'Illustrious');
assert.equal(baseFamily(model('Unknown')), '');
assert.equal(baseFamily({}), '');

const list = [model('SDXL 1.0'), model('SDXL'), model('Illustrious'), model(''), model('Pony'), model('Pony')];
assert.deepEqual(countBases(list), [['Pony', 2], ['SDXL', 2], ['Illustrious', 1], ['', 1]]);
assert.equal(list.filter(item => inFamily(item, 'SDXL')).length, 2);
assert.equal(list.filter(item => inFamily(item, '')).length, 1);
assert.equal(list.filter(item => inFamily(item, null)).length, 6);

console.log('model_bases: ok');
