import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const f = fixture();
f.document.getElementById = id => f.document.body.querySelector(`#${id}`);
const stage = await f.module('ui_image_stage.js');
const inspector = await f.module('ui_image_inspector.js');
const gallery = await f.module('ui_gallery.js');

assert.deepEqual(Object.keys(stage).sort(), [
    'buildFilmstripRail',
    'buildWorkbenchHeader',
    'preloadAdjacentImages',
    'setupStagePanZoom',
]);
assert.deepEqual(Object.keys(inspector).sort(), ['renderImageInspectorContent']);

let dismissed = false;
const workbench = { isFilmstripVisible: true, filmstripEl: null };
const header = stage.buildWorkbenchHeader(
    { filename: 'sample.png', subfolder: 'outputs' },
    0,
    2,
    () => {},
    { workbench, onDismiss: () => { dismissed = true; } },
);
header.querySelector('.anomalous-workbench-close-btn').click();
assert.equal(dismissed, true);

const rail = stage.buildFilmstripRail([
    { filename: 'one.png', url: '/one.png' },
    { filename: 'two.png', url: '/two.png' },
], 1, () => {}, workbench);
assert.equal(rail.querySelectorAll('.anomalous-workbench-filmstrip-thumb').length, 2);
assert.equal(rail.querySelectorAll('.is-active').length, 1);

const stageEl = f.document.createElement('div');
const imageEl = f.document.createElement('img');
const listenersBefore = f.window.listenerCount();
const panZoom = stage.setupStagePanZoom(stageEl, imageEl);
assert.equal(f.window.listenerCount(), listenersBefore + 2);
panZoom.zoomIn();
assert.match(imageEl.style.transform, /scale\(1\.3\)/);
panZoom.cleanup();
assert.equal(f.window.listenerCount(), listenersBefore);

await inspector.renderImageInspectorContent({ workbench: null }, {}, {});

let parameterWorkbenchOpens = 0;
const galleryGrid = f.document.createElement('div');
const gallerySentinel = f.document.createElement('div');
galleryGrid.appendChild(gallerySentinel);
f.document.body.appendChild(galleryGrid);
const galleryOwner = {
    galleryGrid,
    gallerySentinel,
    galleryLoading: false,
    galleryRefreshLoading: false,
    galleryImagesList: [],
    showImageWorkbench() { parameterWorkbenchOpens += 1; },
};
galleryOwner.loadGalleryImages = gallery.loadGalleryImages.bind(galleryOwner);
f.fetch = async () => ({
    ok: true,
    json: async () => ({ images: [{ filename: 'sample.png', subfolder: 'outputs' }], pages: 1 }),
});
await galleryOwner.loadGalleryImages(1, true);
const galleryImage = galleryGrid.querySelector('img');
galleryImage.click();
assert.equal(f.document.getElementById('anomalous-gallery-viewer')?.open, true, 'image click opens the zoom viewer');
assert.equal(parameterWorkbenchOpens, 0, 'image click does not open parameter inspection');
galleryGrid.querySelector('.anomalous-gallery-details').click();
assert.equal(parameterWorkbenchOpens, 1, 'the dedicated parameter button still opens inspection');

console.log('Image workbench modules: stage lifecycle, filmstrip, and inspector boundary passed.');
