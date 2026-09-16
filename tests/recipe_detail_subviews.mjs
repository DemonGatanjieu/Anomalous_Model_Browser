import assert from 'node:assert/strict';
import { all, fixture, Element } from './ui_fixture.mjs';

const f = fixture();
const versions = await f.module('ui_recipe_versions.js');
const gallery = await f.module('ui_recipe_gallery.js');

let refreshed = 0;
let finishReason = '';
const versionOwner = {
    recipeDetailFilename: 'example.json',
    async refreshRecipes() { refreshed += 1; },
};
const versionContent = new Element('div');
versions.renderVersions(
    versionContent,
    versionOwner,
    { timestamp: 1, workflow_fingerprint: { value: 'abcdef1234567890' } },
    [{ version: 'v1.json', name: 'Version 1', timestamp: 1, workflow_fingerprint: { value: '1234567890abcdef' } }],
    reason => { finishReason = reason; },
);
const restore = all(versionContent).find(element => element.classList.contains('anomalous-btn-danger'));
assert.ok(restore, 'version history renders a restore action');
await restore.click();
await f.flush();
assert.equal(refreshed, 1);
assert.equal(finishReason, 'restored');
const restoreRequest = f.requests.find(([url, options]) => url === '/anomalous/restore_recipe_version' && options.method === 'POST');
assert.deepEqual(JSON.parse(restoreRequest[1].body), { filename: 'example.json', version: 'v1.json' });

let openedDetail = null;
const galleryOwner = {
    recipeDetailFilename: 'example.json',
    showGalleryViewer() {},
    showImageWorkbench(sourceImage, imageUrl, options) { openedDetail = { sourceImage, imageUrl, options }; },
};
const galleryContent = new Element('div');
const images = [{ filename: 'image.png', subfolder: 'outputs', type: 'output' }];
gallery.renderRecipeGallery(galleryContent, galleryOwner, {}, { status: 'ready', scanned: 1, images }, () => {});
const details = all(galleryContent).find(element => element.tagName === 'button' && element.classList.contains('anomalous-btn-primary'));
assert.ok(details, 'gallery renders the image detail action');
await details.click();
assert.equal(openedDetail.options.items.length, 1);
assert.equal(openedDetail.options.items[0].sourceImage.filename, 'image.png');
assert.match(openedDetail.imageUrl, /^\/view\?/);

console.log('Recipe detail subviews: version restore and gallery workbench handoff passed.');
