/**
 * Covers of the voice characters (api/voice_covers.py) on the Voices page's cards (ui_audio_studio.js): the cover,
 * or the name's first letter, in the card's avatar, and a click there to change it: a picture from the gallery (the
 * AI box's grid, ui_ai_gallery_pick.js) or from the computer, cropped square by the page (a tall one keeps its top,
 * where a face mostly is) and sent small; or taken away. One per character's name: its versions share it.
 */

import { translate as t } from './locales.js';
import { aiWindow } from './ui_ai_connect.js';
import { pictureGrid, thumbUrl } from './ui_ai_gallery_pick.js';
import { anomalousAlert } from './ui_dialog.js';

const SIZE = 256;
const TOP_SHARE = 0.12; // of what a tall picture loses, taken from its top
let known = null; // {name: stamp}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, run) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = run;
    return node;
}

/** The character's name without its version ("角色/日配" -> "角色"). */
export function baseName(character) {
    const name = String(character || '').trim();
    const cut = name.lastIndexOf('/');
    return cut > 0 ? name.slice(0, cut).trim() : name;
}

/** Where a picture of `width` x `height` is cut square: {x, y, side}; a tall one keeps its top. */
export function squareCut(width, height) {
    const side = Math.min(width, height);
    return { x: Math.round((width - side) / 2), y: Math.round(height > width ? (height - side) * TOP_SHARE : (height - side) / 2), side };
}

/** The covers there are, read once (`again` reads them anew). */
export async function loadCovers(again = false) {
    if (known && !again) return known;
    try {
        known = (await (await fetch('/anomalous/voice_covers')).json()).covers || {};
    } catch {
        known = {};
    }
    return known;
}

const coverUrl = name => (known?.[name] ? `/anomalous/voice_cover?${new URLSearchParams({ name, v: known[name] })}` : '');

/** Fills avatar `box` for `character`: its cover, else its name's first letter. */
export function drawAvatar(box, character) {
    const name = baseName(character);
    const url = coverUrl(name);
    box.dataset.voiceCover = name;
    box.classList.toggle('has-cover', Boolean(url));
    if (url) {
        const picture = el('img');
        picture.src = url;
        picture.alt = '';
        box.replaceChildren(picture);
    } else {
        box.replaceChildren(el('span', 'anomalous-voice-initial', Array.from(name)[0] || '?'));
    }
}

/** Every avatar of `name` on the page, drawn again. */
function redraw(name) {
    document.querySelectorAll('[data-voice-cover]').forEach((box) => {
        if (box.dataset.voiceCover === name) drawAvatar(box, name);
    });
}

const loadPicture = url => new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error(t('voiceCoverUnreadable')));
    picture.src = url;
});

async function keep(name, url) {
    const picture = await loadPicture(url);
    const { x, y, side } = squareCut(picture.naturalWidth, picture.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.getContext('2d').drawImage(picture, x, y, side, side, 0, 0, SIZE, SIZE);
    const response = await fetch('/anomalous/voice_cover', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: canvas.toDataURL('image/png') }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    known = { ...known, [name]: data.stamp };
    redraw(name);
}

/** The window to change `character`'s cover: the gallery to pick from, a picture from the computer, or none. */
export function changeCover(character) {
    const name = baseName(character);
    const body = el('div', 'anomalous-voice-cover-pick');
    const said = el('div', 'anomalous-voice-cover-said');
    let close = () => {};
    let pictures = null;
    const done = async (work) => {
        said.textContent = t('voiceCoverSaving');
        try {
            await work();
            pictures?.stop();
            close();
        } catch (error) {
            said.textContent = '';
            await anomalousAlert(t('voiceCoverFailed', { why: String(error.message || error).slice(0, 200) }));
        }
    };
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.onchange = () => {
        const picked = file.files?.[0];
        if (!picked) return;
        const url = URL.createObjectURL(picked);
        void done(() => keep(name, url)).finally(() => URL.revokeObjectURL(url));
    };
    const actions = el('div', 'anomalous-voice-cover-actions');
    actions.append(button('anomalous-btn', t('voiceCoverFromFile'), () => file.click()));
    if (known?.[name]) {
        actions.append(button('anomalous-btn', t('voiceCoverRemove'), () => done(async () => {
            const response = await fetch('/anomalous/voice_cover/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            const { [name]: _gone, ...rest } = known;
            known = rest;
            redraw(name);
        })));
    }
    pictures = pictureGrid({ picked: () => false, pick: item => void done(() => keep(name, thumbUrl(item.image))) });
    body.append(el('p', 'anomalous-voice-cover-lead', t('voiceCoverLead')), actions, file, pictures.search, pictures.grid, said);
    const shut = aiWindow(t('voiceCoverTitle', { name }), body);
    close = () => {
        pictures.stop();
        shut();
    };
    pictures.search.focus();
}
