import assert from 'node:assert/strict';
import { all, fixture, Element } from './ui_fixture.mjs';

const f = fixture();
const recipes = await f.module('ui_recipes.js');
const good = { filename: 'sample.json', data: { name: 'Visible recipe', params: { baseModel: '<Model>' } } };
const broken = { filename: 'bad.json', data: { name: 'Broken card', get params() { throw new Error('test-only invalid card'); } } };
const owner = {
    recipeListContainer: new Element('div'),
    refreshRecipes: async () => {},
};

const errors = [];
const originalConsoleError = console.error;
console.error = (...args) => errors.push(args);
try {
    recipes.renderRecipeList.call(owner, [good]);
    assert.equal(errors.length, 0, 'Model metadata must not make a recipe disappear');
    assert.equal(owner.recipeListContainer.children[0].className, 'anomalous-recipe-card');
    assert.ok(all(owner.recipeListContainer).some(element => element.tagName === 'span' && element.textContent === '<Model>'));

    recipes.renderRecipeList.call(owner, [broken, good]);
    assert.equal(errors.length, 1);
    assert.equal(owner.recipeListContainer.children[0].attrs.role, 'alert');
    assert.equal(owner.recipeListContainer.children[1].className, 'anomalous-recipe-card');
} finally {
    console.error = originalConsoleError;
}

console.log('PASS recipe model label stays text; failed card shows an alert and does not hide other recipes.');
