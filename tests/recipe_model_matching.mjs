import assert from 'node:assert/strict';
import { fixture, Element } from './ui_fixture.mjs';

const f = fixture();
const matching = await f.module('ui_recipe_model_matching.js');
let refreshCount = 0;
f.fetch = async url => {
    if (String(url).includes('/update_recipe')) {
        return { ok: true, json: async () => ({ status: 'success' }) };
    }
    throw new Error(`Unexpected request: ${url}`);
};

const reference = {
    node_id: 1,
    node_type: 'CheckpointLoaderSimple',
    widget_index: 0,
    widget_name: 'ckpt_name',
    saved_value: 'old.safetensors',
    category: 'checkpoint',
    identity: { status: 'unverified' },
    localMatch: {
        filename: 'new.safetensors',
        identity: { status: 'verified', sha256: 'a'.repeat(64), size: 123 },
    },
};
const recipe = {
    workflow: { nodes: [{ id: 1, widgets_values: ['old.safetensors'] }], extra: {} },
    params: { baseModel: 'old.safetensors', model_references: [{ ...reference, localMatch: undefined }] },
};
const owner = {
    recipeDetailFilename: 'example.json',
    async refreshRecipes() { refreshCount += 1; },
};
const status = new Element('span');
let rerenderCount = 0;
const applied = await matching.applyLocalModelMatch(owner, recipe, reference, status, () => { rerenderCount += 1; });

assert.equal(applied, true);
assert.equal(recipe.workflow.nodes[0].widgets_values[0], 'new.safetensors');
assert.equal(recipe.params.baseModel, 'new.safetensors');
assert.equal(reference.saved_value, 'new.safetensors');
assert.equal(reference.localMatch, null);
assert.equal(refreshCount, 1);
assert.equal(rerenderCount, 1);
const request = f.requests.find(([url]) => url === '/anomalous/update_recipe');
assert.ok(request, 'accepted local matches persist through the recipe metadata endpoint');

console.log('Recipe model matching: accepted replacement updates workflow, metadata, and live state.');
