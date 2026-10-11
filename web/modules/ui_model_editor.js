/**
 * The model editor (the details' Edit, a notes card's pencil, the "read from the file" note):
 * the cover on the left (the one shown, Civitai's own when the one shown is the user's, recent
 * pictures, a file to upload, or the whole gallery), the name, the source link and the notes on
 * the right, Reset, Cancel and Save always in view. Nothing is written before Save; then the
 * cover goes first and the fields after (renaming the file takes its cover along). Fields left as
 * they were are not sent, so they do not count as the user's own. Esc or a click outside closes.
 */

import { translate } from './locales.js';
import { isPhysicalRenameProtectedType } from './model_policies.js';
import { detectPlatform, normalizeUrl } from './model_source_links.js';
import { usableSourceUrl } from './model_source_data.js';
import { reasonText } from './scan_results.js';

const t = (key, params) => translate(key, params);
const RECENT_PICTURES = 6;
const VIDEO = /\.(mp4|webm|mov|avi)(?:[?&#]|$)/i;
const PICTURE = /\.(png|jpe?g|webp|gif|avif)$/i;
let fieldCount = 0;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** A field: its label (for `input`, the control itself unless it is a row holding one), the control, the lines under it. */
function field(parent, label, control, under = [], input = control) {
    const box = el('div', 'anomalous-medit-field');
    const name = el('label', 'anomalous-medit-label', label);
    input.id = `anomalous-medit-field-${++fieldCount}`;
    name.htmlFor = input.id;
    box.append(name, control, ...under);
    parent.append(box);
    return box;
}

/** The model's own place, as the cover and metadata routes take it. */
function placeOf(owner, model) {
    const sub = String(model.subfolder ?? '').replace(/^\/+/, '');
    return {
        type: model.type || owner.currentType,
        path_idx: model.path_idx ?? owner.currentPathIdx ?? 0,
        subfolder: model.subfolder == null ? owner.currentSubfolder || '/' : sub ? `/${sub}` : '/',
        filename: model.filename,
    };
}

async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

/** The line under the title: where the model's information came from ('' for files scans never read). */
function originLine(model, meta) {
    if (meta.info_source === 'civitai') return t('modelEditFromCivitai');
    if (meta.info_source === 'local') {
        return meta.unmatched_reason === 'damaged' ? `⚠ ${t('modelSourceDamaged')}`
            : `≈ ${t('modelSourceLocal')} · ${reasonText(meta.unmatched_reason)}`;
    }
    return /\.safetensors$/i.test(model.filename) ? t('modelSourceNotScanned') : '';
}

/** A web address to keep ('' for none), or null when it is not one. */
function linkValue(raw) {
    const text = raw.trim();
    if (!text) return '';
    const url = normalizeUrl(text);
    return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url) && usableSourceUrl(url) ? url : null;
}

/**
 * The cover side: the chosen cover large, the choices under it. `pick(change)` gets what Save is
 * to do: null keeps the cover, { picture } copies an output picture, { file } uploads one,
 * { civitai: true } brings Civitai's own back. Returns { dispose } (object URLs to give back).
 */
function coverSide(parent, model, place, pick, toGallery) {
    const side = el('div', 'anomalous-medit-cover-side');
    const preview = el('div', 'anomalous-medit-cover');
    const hint = el('small', 'anomalous-medit-hint');
    const choices = el('div', 'anomalous-medit-choices');
    const objectUrls = [];
    side.append(preview, el('span', 'anomalous-medit-label', t('modelEditCover')), choices, hint);
    parent.append(side);

    const show = (url, video = VIDEO.test(url || '')) => {
        preview.replaceChildren();
        if (!url) {
            preview.append(el('span', 'anomalous-medit-cover-empty', t('modelEditNoCover')));
            return;
        }
        const media = el(video ? 'video' : 'img');
        if (video) Object.assign(media, { muted: true, autoplay: true, loop: true, playsInline: true });
        else media.alt = '';
        media.src = url;
        preview.append(media);
    };
    const choose = (tile, url, change, note, video) => {
        choices.querySelectorAll('.is-selected').forEach(other => other.classList.remove('is-selected'));
        tile.classList.add('is-selected');
        show(url, video);
        hint.textContent = note;
        pick(change);
    };
    const tile = (title, thumb, onClick, className = '') => {
        const node = button(`anomalous-medit-choice${className ? ` ${className}` : ''}`, undefined, onClick);
        node.title = title;
        node.setAttribute('aria-label', title);
        if (thumb) {
            const img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = thumb;
            img.onerror = () => img.remove();
            node.append(img);
        }
        return node;
    };
    const thumbOf = url => `${url}&variant=${VIDEO.test(url) ? 'poster' : 'card'}`;

    const current = model.preview_url || '';
    const now = tile(t('modelEditCoverNow'), current ? thumbOf(current) : '', () => choose(now, current, null, ''), 'is-selected');
    if (!current) now.append(el('span', 'anomalous-medit-choice-mark', '∅'));
    const upload = tile(t('modelEditCoverUpload'), '', () => input.click(), 'is-action');
    upload.append(el('span', 'anomalous-medit-choice-mark', '⤒'));
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*,video/mp4,video/webm';
    input.hidden = true;
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const video = file.type.startsWith('video/');
        objectUrls.push(url);
        const chosen = tile(file.name, video ? '' : url, () => choose(chosen, url, { file }, t('modelEditCoverHint'), video));
        if (video) chosen.append(el('span', 'anomalous-medit-choice-mark', '▶'));
        upload.before(chosen);
        chosen.click();
        input.value = '';
    };
    const gallery = tile(t('modelEditCoverGallery'), '', toGallery, 'is-action');
    gallery.append(el('span', 'anomalous-medit-choice-mark', '…'));
    choices.append(now, upload, gallery, input);
    show(current);

    // Civitai's own cover, when the one shown is the user's; then the newest pictures.
    const query = new URLSearchParams(place);
    fetch(`/anomalous/model_covers?${query}`).then(res => (res.ok ? res.json() : null)).then((covers) => {
        if (!covers?.custom || !covers.civitai || !side.isConnected) return;
        const civitai = tile(t('modelEditCoverCivitai'), thumbOf(covers.civitai), () => choose(civitai, covers.civitai, { civitai: true }, t('modelEditCoverCivitaiHint')));
        now.after(civitai);
    }).catch(() => {});
    fetch(`/anomalous/gallery_images?page=1&limit=${RECENT_PICTURES * 2}`).then(res => (res.ok ? res.json() : null)).then((data) => {
        if (!side.isConnected) return;
        const pictures = (data?.images || []).filter(image => PICTURE.test(image.filename || '')).slice(0, RECENT_PICTURES);
        for (const image of pictures) {
            const thumb = `/anomalous/output_thumbnail?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' })}`;
            const source = image.subfolder ? `${image.subfolder}/${image.filename}` : image.filename;
            const chosen = tile(image.filename, thumb, () => choose(chosen, thumb, { picture: source }, t('modelEditCoverHint'), false));
            upload.before(chosen);
        }
    }).catch(() => {});
    return { dispose: () => objectUrls.forEach(url => URL.revokeObjectURL(url)) };
}

/** Puts the cover change in (before the fields, so a renamed file takes it along). */
async function applyCover(place, change) {
    if (change?.picture) {
        await postJson('/anomalous/set_custom_cover', { ...place, source_image: change.picture });
    } else if (change?.file) {
        const form = new FormData();
        for (const [key, value] of Object.entries(place)) form.append(key, value);
        form.append('image', change.file);
        const res = await fetch('/anomalous/upload_custom_cover', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${res.status}`);
    }
}

/** After a save: the grid again, and the details of this model when they are open. */
async function refresh(owner, model, place, filename) {
    owner.loadModels?.();
    const open = owner.currentDetailModel;
    if (!open || (open.filename !== model.filename && open.filename !== filename)) return;
    const rel = [place.subfolder.replace(/^\/+|\/+$/g, ''), filename].filter(Boolean).join('/');
    const params = new URLSearchParams({ type: place.type, path_idx: place.path_idx, rel });
    const data = await fetch(`/anomalous/scan_model?${params}`).then(res => res.json()).catch(() => ({}));
    if (data.model) {
        owner.currentDetailModel = data.model;
        owner.showDetail(data.model);
    }
}

export function showEditModal(model) {
    const owner = this;
    const meta = model.metadata || {};
    const place = placeOf(owner, model);
    let coverChange = null;
    let busy = false;

    const overlay = el('div', 'anomalous-medit-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const dialog = el('div', 'anomalous-medit');
    overlay.append(dialog);

    const head = el('div', 'anomalous-medit-head');
    const titles = el('div', 'anomalous-medit-titles');
    titles.append(el('h3', '', t('modelEditTitle')), el('p', 'anomalous-medit-file', model.filename));
    const origin = originLine(model, meta);
    if (origin) titles.append(el('p', `anomalous-medit-origin is-${meta.info_source || 'none'}`, origin));
    const shut = button('anomalous-medit-close', '×', () => close());
    shut.setAttribute('aria-label', t('modelEditClose'));
    head.append(titles, shut);

    const body = el('div', 'anomalous-medit-body');
    const dirty = () => coverChange || nameInput.value.trim() !== (meta.custom_name || '')
        || notesInput.value.trim() !== (meta.custom_notes || '').trim() || linkInput.value.trim() !== (meta.source_url || '');
    const cover = coverSide(body, model, place, (change) => { coverChange = change; }, () => {
        if (dirty() && !confirm(t('modelEditLeaveForGallery'))) return;
        close();
        owner.showGallerySelectMode(model);
    });
    const fields = el('div', 'anomalous-medit-fields');
    body.append(fields);

    const nameInput = el('input', 'anomalous-medit-input');
    nameInput.type = 'text';
    nameInput.maxLength = 200;
    nameInput.value = meta.custom_name || '';
    nameInput.placeholder = meta.name || model.filename;
    const renameRow = el('label', 'anomalous-medit-check');
    const rename = el('input');
    rename.type = 'checkbox';
    const locked = isPhysicalRenameProtectedType(place.type);
    rename.disabled = locked;
    renameRow.classList.toggle('is-disabled', locked);
    renameRow.append(rename, el('span', '', t('modelEditRename')));
    const renameHint = el('small', 'anomalous-medit-hint', t(locked ? 'modelEditRenameProtected' : 'modelEditNameHint'));
    rename.onchange = () => { renameHint.textContent = t(rename.checked ? 'modelEditRenameHint' : 'modelEditNameHint'); };
    field(fields, t('modelEditName'), nameInput, [renameRow, renameHint]);

    const linkRow = el('div', 'anomalous-medit-link');
    const linkInput = el('input', 'anomalous-medit-input');
    linkInput.type = 'text';
    linkInput.inputMode = 'url';
    linkInput.spellcheck = false;
    linkInput.maxLength = 2048;
    linkInput.value = meta.source_url || '';
    linkInput.placeholder = t('modelEditLinkPlaceholder');
    const site = el('span', 'anomalous-medit-site');
    const showSite = () => {
        const platform = linkInput.value.trim() ? detectPlatform(linkInput.value) : null;
        site.hidden = !platform;
        site.textContent = platform?.name === 'Web Link' ? t('modelEditLinkWeb') : platform?.name || '';
        site.style.color = platform?.color || '';
        site.style.borderColor = platform?.border || '';
    };
    linkInput.oninput = showSite;
    showSite();
    linkRow.append(linkInput, site);
    const linkHint = meta.info_source === 'local' ? 'modelEditLinkLocalHint' : meta.civitai_url ? 'modelEditLinkCivitaiHint' : 'modelEditLinkHint';
    field(fields, t('modelEditLink'), linkRow, [el('small', 'anomalous-medit-hint', t(linkHint))], linkInput);

    const notesInput = el('textarea', 'anomalous-medit-input anomalous-medit-notes');
    notesInput.maxLength = 5000;
    notesInput.rows = 6;
    notesInput.value = meta.custom_notes || '';
    notesInput.placeholder = t('modelEditNotesPlaceholder');
    field(fields, t('modelEditNotes'), notesInput);

    const foot = el('div', 'anomalous-medit-foot');
    const reset = button('anomalous-medit-reset', t('modelEditReset'), () => resetAll());
    reset.title = t('modelEditResetHint');
    const error = el('div', 'anomalous-medit-error');
    error.setAttribute('role', 'alert');
    const cancel = button('anomalous-medit-cancel', t('modelEditCancel'), () => close());
    const save = button('anomalous-btn-primary anomalous-medit-save', t('modelEditSave'), () => submit());
    foot.append(reset, error, cancel, save);
    dialog.append(head, body, foot);

    function close() {
        cover.dispose();
        overlay.remove();
    }
    function setBusy(on) {
        busy = on;
        for (const node of [reset, cancel, save]) node.disabled = on;
        save.textContent = t(on ? 'modelEditSaving' : 'modelEditSave');
    }
    function fail(message, focus) {
        error.textContent = message;
        focus?.focus();
    }

    async function submit() {
        if (busy) return;
        const name = nameInput.value.trim();
        const notes = notesInput.value.trim();
        const link = linkValue(linkInput.value);
        if (link === null) return fail(t('modelEditLinkInvalid'), linkInput);
        if (rename.checked && !name) return fail(t('modelEditRenameNeedsName'), nameInput);
        const request = { ...place, physical_rename: rename.checked };
        if (name !== (meta.custom_name || '') || rename.checked) request.custom_name = name;
        if (notes !== (meta.custom_notes || '').trim()) request.custom_notes = notes;
        if (link !== (meta.source_url || '')) request.custom_source_url = link;
        if (coverChange?.civitai) request.reset_cover = true;
        setBusy(true);
        error.textContent = '';
        let filename = model.filename;
        try {
            await applyCover(place, coverChange);
            const data = await postJson('/anomalous/update_metadata', request);
            filename = data.new_filename || filename;
        } catch (failure) {
            setBusy(false);
            return fail(t('modelEditSaveFailed', { error: failure.message }));
        }
        close();
        await refresh(owner, model, place, filename);
    }

    async function resetAll() {
        if (busy || !confirm(t('modelEditResetConfirm'))) return;
        setBusy(true);
        try {
            const data = await postJson('/anomalous/update_metadata', { ...place, custom_name: '', custom_notes: '', reset_cover: true, physical_rename: false });
            close();
            if (data.cover_reset === false) alert(t(data.cover_reset_source === 'preserved_current' ? 'modelEditResetCoverKept' : 'modelEditResetCoverFailed'));
            await refresh(owner, model, place, model.filename);
        } catch (failure) {
            setBusy(false);
            fail(t('modelEditSaveFailed', { error: failure.message }));
        }
    }

    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay && !busy) close();
    });
    overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (!busy) close();
        } else if (event.key === 'Enter' && (event.target.tagName === 'INPUT' && event.target.type === 'text' || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
        }
    });
    document.body.append(overlay);
    nameInput.focus();
}
