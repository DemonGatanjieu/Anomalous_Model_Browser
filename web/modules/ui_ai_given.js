/**
 * The AI workbench's materials view (ui_ai_side_views.js shows it in the side column): what a task gives
 * its AI, at one look and by kind. First the pictures handed over (named when the task started, sent from
 * the gallery, or attached to a message), then the picks (api/ai_toolbox.py: models, ways, combos,
 * workflows, prompts, node types and packs, or the favourites standing in while the task has none of its
 * own) under how strictly the AI keeps to them; a pick's × takes it back, and a model's lock (in a private task, or
 * while its name is kept) says whether the AI gets its name or a code word and turns it, for every task, as Privacy
 * Overview does (POST /anomalous/ai_tasks/{id}/privacy_rules model_rule). What is on the message and not
 * sent yet is said over them. "Add materials" opens the picker's window (ui_ai_toolbox.js); "Add
 * pictures" a gallery grid whose pictures go to the task at once (POST /anomalous/ai_tasks/{id}/pictures).
 */

import { resolveLocale, translate as t } from './locales.js';
import { PICK_KINDS, fetchUsableWays, keptCatalog, loadCatalog, prefetchToolbox, wayTitle } from './ai_toolbox_data.js';
import { emptyPicks, keyOf, standingInWithFavorites, taskEffectivePicks, totalPicks } from './ai_toolbox_state.js';
import { taskTitle } from './ai_task_title.js';
import { emptyState } from './ui_ai_art.js';
import { aiWindow } from './ui_ai_connect.js';
import { pictureGrid } from './ui_ai_gallery_pick.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { imageCard } from './ui_ai_images.js';
import { sideHead } from './ui_ai_side.js';
import { coverUrl, kindIcon } from './ui_ai_toolbox_cards.js';
import { packItems, pageNodes, renderModes } from './ui_ai_toolbox_sources.js';
import { standInCover } from './ui_ai_toolbox_icons.js';
import { anomalousAlert } from './ui_dialog.js';
import { nameHidden } from './ui_ai_model_lock.js';
import { postPrivacyRule } from './ui_ai_privacy_adjust.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const SHOWN_KINDS = ['models', 'ways', 'combos', 'workflows', 'prompts', 'nodes', 'packs'];
const MAX_PICTURES = 8; // pictures handed at once (api/ai_pictures.py MAX_PICTURES)

let favorites = null; // the user's standing picks, read while a task without picks of its own is shown
let ways = null; // the usable ways, for their names
let saving = false;
let last = null; // {pane, task, ctx}: drawn again when names, favourites or the message change
let turned = 0; // models whose name lock was turned here: the view is drawn again
const watched = new WeakSet(); // message boxes whose changes redraw the view

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, children, onClick, title = '') {
    const node = el('button', className);
    node.type = 'button';
    node.append(...[].concat(children).map(child => (typeof child === 'string' ? el('span', '', child) : child)));
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

const pictureOf = (id) => {
    const at = String(id).lastIndexOf('/');
    return { type: 'image', folder: 'output', subfolder: at < 0 ? '' : String(id).slice(0, at), filename: String(id).slice(at + 1) };
};

/** The pictures `task` handed its AI, each once, oldest first: named at its start, sent, attached to a message. */
export function givenPictures(task) {
    const seen = new Map();
    const add = (image) => {
        const id = [image?.subfolder, image?.filename].filter(Boolean).join('/');
        if (image?.filename && !seen.has(id)) seen.set(id, image);
    };
    for (const item of task?.about || []) if (item?.type === 'image' && item.image) add(pictureOf(item.image));
    for (const step of task?.steps || []) {
        if (step.tool === 'user_pictures') (step.results || []).forEach(add);
        if (step.tool === 'user_message') for (const ref of step.refs || []) if (ref.kind === 'pictures') add(pictureOf(ref.id));
    }
    return [...seen.values()];
}

/** How many things `task` gives its AI (the switch's badge); reads the picker's catalogue ahead. */
export function givenCount(task) {
    prefetchToolbox();
    return totalPicks(task.toolbox, PICK_KINDS) + givenPictures(task).length;
}

function redraw() {
    if (last?.pane.isConnected) renderGivenView(last.pane, last.task, last.ctx, true);
}

/** Names and covers: the picker's catalogue, the page's node types and packs, the usable ways; else the bare name. */
function namer(picks) {
    const index = new Map();
    const nodes = picks.nodes?.length || picks.packs?.length ? pageNodes() : [];
    for (const item of [...(keptCatalog() || []), ...nodes, ...packItems(nodes), ...(ways || [])]) index.set(keyOf(item.kind, item.id), item);
    return (kind, id) => index.get(keyOf(kind, id))
        || { kind, id, title: kind === 'ways' ? wayTitle(id, resolveLocale()) : kind === 'models' ? String(id).split(/[:/]/).pop() : String(id) };
}

function lead(item) {
    const box = el('span', 'anomalous-ai-given-lead');
    const url = coverUrl(item);
    const fallback = () => box.replaceChildren(item.kind === 'models' && item.type ? standInCover('models', item.type) : icon(kindIcon(item.kind), 16));
    if (!url) {
        fallback();
        return box;
    }
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = url;
    img.onerror = fallback;
    box.append(img);
    return box;
}

async function save(task, next, ctx) {
    saving = true;
    redraw();
    try {
        const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/toolbox`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        ctx.changed();
    } catch (error) {
        await anomalousAlert(error.message);
    } finally {
        saving = false;
        redraw();
    }
}

/** `picks` with `drop` ({kind, id}) left out, and `mode` (else its own). */
function without(picks, drop = null, mode = picks.mode || 'prefer') {
    const next = { mode, ...emptyPicks(PICK_KINDS) };
    for (const kind of PICK_KINDS) next[kind] = (picks[kind] || []).filter(id => !(drop && kind === drop.kind && id === drop.id));
    return next;
}

function part(name, title, count, ...children) {
    const box = el('section', 'anomalous-ai-given-part');
    const head = el('div', 'anomalous-ai-given-head');
    head.append(icon(name, 15), el('span', 'anomalous-ai-given-title', title), el('span', 'anomalous-ai-given-count', count));
    box.append(head, ...children);
    return box;
}

function picturesPart(pictures, task, ctx) {
    if (!pictures.length) return null;
    const grid = el('div', 'anomalous-ai-given-pictures');
    grid.append(...pictures.map(image => imageCard(image, ctx.owner, { compact: true, set: pictures })));
    const box = part('image', t('aiGivenPictures'), pictures.length, grid);
    box.firstChild.append(el('span', 'anomalous-ai-given-hint', t('aiGivenPicturesKept')));
    return box;
}

function kindPart(kind, ids, name, picks, task, ctx) {
    const rows = ids.map((id) => {
        const item = name(kind, id);
        const row = el('div', 'anomalous-ai-given-row');
        const words = el('span', 'anomalous-ai-given-words');
        words.append(el('span', 'anomalous-ai-given-name', item.title || item.name || id));
        const sub = kind === 'models' ? item.metadata?.version_name || item.base || '' : kind === 'ways' ? item.about || '' : item.sub || '';
        if (sub) words.append(el('span', 'anomalous-ai-given-sub', sub));
        row.title = item.title || id;
        row.append(lead(item), words);
        if (kind === 'models' && !task.ended && (task.private === true || nameHidden(item, task))) row.append(nameLock(item, id, task, ctx));
        if (!task.ended) {
            const back = iconButton('anomalous-ai-given-back', 'close', t('aiGivenTakeBack'), () => void save(task, without(picks, { kind, id }), ctx), { iconOnly: true, size: 14 });
            back.disabled = saving;
            row.append(back);
        }
        return row;
    });
    return part(kindIcon(kind), t(`aiToolboxKind_${kind}`), ids.length, ...rows);
}

/** A model's lock: the AI gets a code word for its name (its token once it has one) or the name; a press turns it. */
function nameLock(item, id, task, ctx) {
    const hidden = nameHidden(item, task);
    const token = Object.entries(task.sealed || {}).find(([key, value]) => key.startsWith('[M') && value === id)?.[0] || '';
    const lock = iconButton(`anomalous-ai-given-lock${hidden ? ' is-hidden' : ''}`, hidden ? 'lock' : 'eye', hidden ? token || t('aiTbNameBadge') : t('aiGivenNameShown'), async () => {
        lock.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'model_rule', model_id: id, hidden: !hidden });
            item.ai_name = hidden ? 'shown' : 'hidden'; // kept with the model, for every task (ai_model_choice.py)
            turned += 1;
            ctx.changed();
        } catch (error) {
            lock.disabled = false;
            await anomalousAlert(error.message);
        }
    }, { title: t(hidden ? 'aiGivenNameHiddenHint' : 'aiGivenNameShownHint', { token: token || '[M]' }), size: 13 });
    lock.setAttribute('aria-pressed', String(hidden));
    return lock;
}

/** Pictures from the gallery, handed to `task` at once. */
function addPictures(task, ctx) {
    const chosen = new Map();
    const body = el('div', 'anomalous-ai-given-pick');
    const note = el('span', 'anomalous-ai-given-pick-note');
    const send = button('anomalous-ai-start-go', '', async () => {
        if (!chosen.size) return;
        send.disabled = true;
        try {
            const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/pictures`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: [...chosen.keys()], text: '' }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
        } catch (error) {
            send.disabled = false;
            await anomalousAlert(error.message);
            return;
        }
        close();
        showWorkbenchToast(t('aiPicturesSent', { count: chosen.size, task: taskTitle(task) }));
        ctx.changed();
    });
    const tell = () => {
        send.textContent = t('aiPicturesSend', { count: chosen.size });
        send.disabled = !chosen.size;
        note.textContent = t('aiGivenPickNote', { max: MAX_PICTURES });
    };
    const grid = pictureGrid({
        picked: id => chosen.has(id),
        pick: (item) => {
            if (chosen.has(item.id)) chosen.delete(item.id);
            else if (chosen.size < MAX_PICTURES) chosen.set(item.id, item);
            tell();
        },
    });
    const actions = el('div', 'anomalous-ai-start-actions');
    actions.append(note, button('anomalous-ai-link', t('dialogCancel'), () => close()), send);
    body.append(grid.search, grid.grid, actions);
    tell();
    const close = aiWindow(t('aiGivenAddPictures'), body, () => grid.stop());
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-given-pick');
    grid.search.focus();
}

/**
 * The view into `pane` for `task`. `ctx`: {close, owner, changed(), message() (the task's message box),
 * openPicker()}. Drawn again only when what it shows changed (`force`: names or favourites came in).
 */
export function renderGivenView(pane, task, ctx, force = false) {
    last = { pane, task, ctx };
    const box = ctx.message?.();
    if (box && !watched.has(box)) {
        watched.add(box);
        box.addEventListener('anomalous-refs', redraw);
    }
    if (!task.toolbox && favorites === null) {
        favorites = emptyPicks(PICK_KINDS);
        fetch('/anomalous/ai_toolbox/favorites').then(response => (response.ok ? response.json() : null))
            .then((data) => { if (data?.favorites) favorites = { ...emptyPicks(PICK_KINDS), ...data.favorites }; redraw(); }).catch(() => {});
    }
    const picks = taskEffectivePicks(task, favorites || emptyPicks(PICK_KINDS), PICK_KINDS);
    if (picks && !keptCatalog()) loadCatalog().then(redraw, () => {});
    if (picks?.ways?.length && !ways) fetchUsableWays(resolveLocale()).then((items) => { ways = items; redraw(); }, () => {});
    const pictures = givenPictures(task);
    const pending = box?.refs?.items?.() || [];
    const key = JSON.stringify([resolveLocale(), task.id, Boolean(task.ended), picks, pictures.map(image => [image.subfolder, image.filename, image.gone]),
        pending.map(ref => [ref.kind, ref.id]), Boolean(keptCatalog()), Boolean(ways), saving, turned, task.private, task.privacy_models, task.sealed]);
    if (!force && pane.dataset.key === key) return;
    pane.dataset.key = key;

    const count = totalPicks(picks, PICK_KINDS);
    const parts = [];
    if (pending.length) {
        parts.push(el('div', 'anomalous-ai-given-pending', t('aiGivenPending', {
            count: pending.length, names: pending.map(ref => ref.title || ref.label || ref.id).join(t('listSeparator')),
        })));
    }
    if (count) {
        parts.push(renderModes({ active: picks.mode || 'prefer', disabled: saving || Boolean(task.ended), onPick: mode => void save(task, without(picks, null, mode), ctx) }));
        if (standingInWithFavorites(task, favorites, PICK_KINDS)) parts.push(el('div', 'anomalous-ai-given-note', t('aiTbFavStandIn', { count })));
    }
    const name = namer(picks || {});
    const sections = [picturesPart(pictures, task, ctx), ...SHOWN_KINDS.filter(kind => picks?.[kind]?.length).map(kind => kindPart(kind, picks[kind], name, picks, task, ctx))].filter(Boolean);
    parts.push(...(sections.length ? sections : [emptyState('board', t('aiGivenNone'))]));
    if (!task.ended) {
        const actions = el('div', 'anomalous-ai-given-actions');
        actions.append(button('anomalous-ai-given-add is-primary', [icon('plus', 15), t('aiGivenAdd')], () => {
            favorites = null; // the picker may change them: read again when it closes
            ctx.openPicker();
        }),
            button('anomalous-ai-given-add', [icon('image', 15), t('aiGivenAddPictures')], () => addPictures(task, ctx)));
        parts.push(actions);
    }
    const body = el('div', 'anomalous-ai-stage-body anomalous-ai-given');
    body.append(...parts);
    const total = el('span', 'anomalous-ai-given-total', count + pictures.length || '');
    pane.replaceChildren(sideHead(t('aiToolboxTitle'), ctx.close, total), body);
}
