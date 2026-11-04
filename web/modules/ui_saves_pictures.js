/**
 * A save's pictures on the Saves page. Its line holds as many as fit, newest first, and the last place
 * folds the rest. A picture opens large, or with its parameters and the arrows through its save's
 * pictures. The fold opens all of them as the gallery's own cards (ui_gallery_card.js), in the list's
 * place until Back.
 */

import { loadKeptImages } from './image_keep.js';
import { translate as t } from './locales.js';
import { refreshGroup } from './snapshot_store.js';
import { createGalleryCard } from './ui_gallery_card.js';
import { showGalleryViewer } from './ui_gallery_viewer.js';
import { appendText, button } from './ui_recipe_detail_dom.js';
import { galleryWorkbenchItems, openGalleryImageDetail } from './ui_recipe_gallery.js';

const GAP = 6; // between the pictures of a line, as in 50-snapshot-bar.css
const TILE = 96 + GAP;

export function thumbUrl(picture) {
    const query = new URLSearchParams({ filename: picture.filename, subfolder: picture.subfolder });
    return picture.type === 'output' ? `/anomalous/output_thumbnail?${query}` : `/view?${query}&type=${picture.type}&preview=webp;60`;
}

export function image(url, className) {
    const node = document.createElement('img');
    node.alt = '';
    node.loading = 'lazy';
    node.src = url;
    node.className = className;
    return node;
}

const newestFirst = save => [...save.pictures].reverse();

/** One of `all`, a save's pictures: opens large, or with its parameters and the arrows through `all`. */
function pictureTile(owner, parent, all, picture) {
    const url = `/view?${new URLSearchParams({ filename: picture.filename, subfolder: picture.subfolder, type: picture.type })}`;
    const tile = appendText(parent, 'div', '', 'anomalous-wfd-image');
    const open = button(tile, '', 'anomalous-saves-picture');
    open.onclick = () => showGalleryViewer(url);
    open.append(image(thumbUrl(picture), ''));
    if (picture.type !== 'output') return; // a preview: the parameters are read from saved pictures only
    button(tile, t('materialViewParameters'), 'anomalous-wfd-image-btn').onclick = () => openGalleryImageDetail(owner, all, picture, url);
}

export function closeSaveGallery(owner) {
    owner.savesGalleryClose?.();
}

/** All of `save`'s pictures as gallery cards. `where`: its group's key, the canvas's name, its number. */
export function openSaveGallery(owner, where, save) {
    closeSaveGallery(owner);
    let all = newestFirst(save);
    let deleted = false;
    const box = document.createElement('div');
    box.className = 'anomalous-saves-gallery';
    const head = appendText(box, 'div', '', 'anomalous-saves-gallery-head');
    button(head, t('savesPicturesBack'), 'anomalous-wfd-back').onclick = () => closeSaveGallery(owner);
    const title = appendText(head, 'span', '', 'anomalous-saves-gallery-title');
    const name = () => { title.textContent = t('savesPicturesTitle', { name: where.name, number: where.number, count: all.length }); };
    name();
    const grid = appendText(box, 'div', '', 'anomalous-gallery-grid');
    const pictures = {
        items: () => galleryWorkbenchItems(all),
        remove: (gone) => {
            all = all.filter(picture => picture.filename !== gone.filename || picture.subfolder !== gone.subfolder);
            deleted = true;
            name();
        },
        compareHost: box,
    };
    owner.galleryKept = loadKeptImages().catch(() => new Map()); // the cards' stars
    for (const picture of all) {
        if (picture.type === 'output') grid.append(createGalleryCard(owner, picture, { showViewer: showGalleryViewer, pictures }));
        else pictureTile(owner, grid, all, picture);
    }
    owner.recipeView.append(box);
    owner.recipeView.classList.add('is-saves-gallery');
    owner.savesGalleryClose = () => {
        owner.savesGalleryClose = null;
        box.remove();
        owner.recipeView.classList.remove('is-saves-gallery');
        if (deleted) void refreshGroup(where.key).catch(error => console.warn('[AMB] Saves:', error));
    };
}

/** The last place of a line: the next picture under how many more there are. */
function foldTile(line, next, count, total, open) {
    const tile = appendText(line, 'div', '', 'anomalous-wfd-image');
    const more = button(tile, '', 'anomalous-saves-picture');
    more.title = t('savesPicturesAll', { count: total });
    more.onclick = open;
    more.append(image(thumbUrl(next), ''));
    appendText(more, 'span', `+${count}`, 'anomalous-saves-folded');
}

/** `save`'s pictures in `box`, or what is said in their place. A line is filled by fillLines once it has its width. */
export function pictureLine(owner, box, save, where) {
    const all = newestFirst(save);
    if (!all.length) return void appendText(box, 'div', save.running ? t('savesRunsLeft', { count: save.running }) : t('snapshotNoPictures'), 'anomalous-saves-none');
    const line = appendText(box, 'div', '', 'anomalous-saves-pictures');
    let room = 0;
    line.anomalousFill = () => {
        const fits = Math.floor((line.clientWidth + GAP) / TILE);
        if (!fits || fits === room) return;
        room = fits;
        const shown = all.length > room ? room - 1 : all.length;
        line.replaceChildren();
        for (const picture of all.slice(0, shown)) pictureTile(owner, line, all, picture);
        if (shown < all.length) foldTile(line, all[shown], all.length - shown, all.length, () => openSaveGallery(owner, where, save));
    };
}

/** Every line under `parent` holds what fits it now: after a draw, or when the list's width changes. */
export function fillLines(parent) {
    for (const line of parent.querySelectorAll('.anomalous-saves-pictures')) line.anomalousFill();
}
