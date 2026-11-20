/**
 * The materials picker's cards and detail pane (ui_ai_toolbox.js). A card is one model, way,
 * combo, workflow, prompt, node type or whole custom node pack: a node shows itself in miniature
 * (its sockets in ComfyUI's colours, outputs on the right, how many settings) under its source's
 * badge; combos, workflows and models show their cover; a prompt shows its text, a way what it is
 * for. The star keeps it among the favourites; a press shows it in the detail column and its circle (or
 * the bar over its cover, or the detail's main button) puts it on the message being written or takes it
 * off; what the task already has says "Given" and, where the picker lists those, can be taken back. The detail pane shows the
 * card in focus in full, and for a combo or workflow can put just the prompt inside it on the
 * message. A model says its version apart from its name; one with several is one card, whose
 * version opens the list to show another (ctx.showVersion); a version its name already ends with is not said
 * twice. A model without a cover shows its type's picture (ui_ai_toolbox_icons.js). A model's card has a lock
 * while AIs get a code word for its name, its detail the switch and which paragraphs of its description
 * they read (ui_ai_model_lock.js).
 */

import { MAX_REF_NOTE } from './ai_chat_plus.js';
import { HIDE_BUTTON, hideButton } from './ai_hide_mark.js';
import { translate as t } from './locales.js';
import { outputThumbnail } from './ui_kept_toast.js';
import { recipeAssetUrl } from './ui_recipe_media.js';
import { icon } from './ui_ai_icons.js';
import { aboutSection, nameBadge, nameSwitch } from './ui_ai_model_lock.js';
import { socketColor, sourceBadge, standInCover } from './ui_ai_toolbox_icons.js';
import { versionLabel } from './ui_model_versions.js';
import { typeLabel } from './ui_model_types.js';
import { openPopupMenu } from './ui_popup_menu.js';

const SOCKETS_SHOWN = 4;
const withQuery = (url, query) => `${url}${url.includes('?') ? '&' : '?'}${query}`;
/** The icon of a kind of thing (ui_ai_icons.js): a pack shows as nodes do, a way as the ways view does. */
export const kindIcon = kind => ({ packs: 'nodes', ways: 'blocks' }[kind] || kind);

/** An element with its class and text; the picker's other parts build with it too. */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/** A button of the picker: `children` are nodes, or words that become spans. */
export function tbButton(className, children, onClick, title) {
    const node = el('button', className);
    node.type = 'button';
    node.append(...[].concat(children).map(child => (typeof child === 'string' ? el('span', '', child) : child)));
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

/** The picture of a combo, workflow or model: its cover, a kept output image, or nothing. */
export function coverUrl(item) {
    if (item.kind === 'workflows') {
        if (item.cover_asset) return recipeAssetUrl(item.filename, item.cover_asset);
        if (item.thumbnail) return item.thumbnail;
        return item.image?.filename ? outputThumbnail(item.image) : '';
    }
    if (item.cover) return withQuery(item.cover, /\.(mp4|webm)(?:&|$)/i.test(item.cover) ? 'variant=poster' : 'variant=card');
    return item.image?.filename ? outputThumbnail(item.image) : '';
}

function picture(item, className) {
    const box = el('div', className);
    const url = coverUrl(item);
    const fallback = () => box.replaceChildren(standInCover(item.kind, item.type));
    if (!url) {
        fallback();
        return box;
    }
    const img = el('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = url;
    img.onerror = fallback;
    box.append(img);
    return box;
}

function socketRow(socket, side) {
    const row = el('div', `anomalous-tb-socket is-${side}`);
    const dot = el('span', 'anomalous-tb-dot');
    dot.style.setProperty('--tb-dot', socketColor(socket.type));
    row.title = `${socket.name} · ${socket.type}`;
    row.append(dot, el('span', 'anomalous-tb-socket-name', socket.name));
    return row;
}

/** A node in miniature: title bar, inputs left, outputs right, its settings counted. */
function nodePreview(item) {
    const box = el('div', 'anomalous-tb-node');
    const head = el('div', 'anomalous-tb-node-head');
    head.append(sourceBadge(item.source, 18), el('span', 'anomalous-tb-node-title', item.title));
    const body = el('div', 'anomalous-tb-node-body');
    const left = el('div', 'anomalous-tb-node-col');
    const right = el('div', 'anomalous-tb-node-col is-out');
    left.append(...item.inputs.slice(0, SOCKETS_SHOWN).map(socket => socketRow(socket, 'in')));
    if (item.inputs.length > SOCKETS_SHOWN) left.append(el('span', 'anomalous-tb-more', `+${item.inputs.length - SOCKETS_SHOWN}`));
    right.append(...item.outputs.slice(0, SOCKETS_SHOWN).map(socket => socketRow(socket, 'out')));
    if (item.outputs.length > SOCKETS_SHOWN) right.append(el('span', 'anomalous-tb-more', `+${item.outputs.length - SOCKETS_SHOWN}`));
    body.append(left, right);
    box.append(head, body);
    if (item.page) {
        box.append(el('div', 'anomalous-tb-node-foot', t('aiTbPageTool')));
    } else if (item.settings.length) {
        const foot = el('div', 'anomalous-tb-node-foot');
        foot.append(icon('gear', 12), el('span', '', t('aiTbSettings', { count: item.settings.length })));
        box.append(foot);
    }
    return box;
}

function tags(item) {
    const row = el('div', 'anomalous-tb-tags');
    const add = (text, kind = '') => row.append(el('span', `anomalous-tb-tag${kind ? ` is-${kind}` : ''}`, text));
    if (item.kind === 'nodes') {
        if (item.paid) add(t('aiTbPaid'), 'warn');
        if (item.page) add(t('aiTbPageShort'), 'soft');
        if (item.deprecated) add(t('aiTbDeprecated'), 'soft');
        if (item.category) add(item.category.split('/').pop());
    } else if (item.kind === 'combos') {
        if (item.loras?.length) add(t('aiTbLoras', { count: item.loras.length }));
        if (item.base) add(item.base);
    } else if (item.kind === 'workflows') {
        if (item.partial) add(t('aiTbPartial'), 'soft');
        for (const tag of (item.tags || []).slice(0, 3)) add(tag);
    } else if (item.kind === 'prompts') {
        add(t(`aiTbPromptFrom_${item.source}`), item.source);
    } else if (item.kind === 'models') {
        add(typeLabel({ type: item.type }));
        if (item.base) add(item.base);
    } else if (item.kind === 'ways') {
        if (item.job) add(t(`aiBlocksJob_${item.job}`), 'soft');
    } else if (item.kind === 'packs') {
        add(t('aiTbPackCount', { count: item.count }));
    }
    return row;
}

/** "Given" on a thing the task already has (ctx.given). */
function givenBadge(ctx, item) {
    const badge = el('span', 'anomalous-tb-given-badge', t('aiTbGiven'));
    badge.hidden = !ctx.given(item);
    return badge;
}

/** Takes a thing the task has back from it: on its card where the picker lists those (ctx.showTakeBack), always in its detail. */
function takeBackButton(ctx, item, detailView = false) {
    const btn = el('button', `anomalous-tb-take-back${detailView ? ' is-detail' : ''}`, t('aiTbTakeBack'));
    btn.type = 'button';
    btn.hidden = !(ctx.given(item) && (detailView || ctx.showTakeBack));
    btn.onclick = (event) => {
        event.stopPropagation();
        void ctx.takeBack(item);
    };
    return btn;
}

/** A model's version: a word, or with several a button listing them; nothing for a model not found on Civitai. */
function versionMark(item, ctx) {
    const several = item.versions?.length > 1;
    if (!several && !item.metadata?.version_name) return null;
    const said = String(item.short || item.title || '').trim().toLowerCase(); // "Lantern Glow - v1" needs no "v1" under it
    if (!several && said.endsWith(String(item.metadata.version_name).trim().toLowerCase())) return null;
    if (!several) return el('span', 'anomalous-tb-version', item.metadata.version_name);
    const mark = el('button', 'anomalous-tb-version is-several');
    mark.type = 'button';
    mark.title = t('aiTbVersions', { count: item.versions.length });
    mark.append(el('span', 'anomalous-tb-version-name', versionLabel(item)), el('span', 'anomalous-tb-version-count', String(item.versions.length)), icon('chevronDown', 12));
    mark.onclick = (event) => {
        event.stopPropagation();
        openPopupMenu(mark, item.versions.map(version => ({ label: versionLabel(version), checked: version === item, run: () => ctx.showVersion(item, version) })));
    };
    return mark;
}

/**
 * One card. `ctx`: { picked(item), favorite(item), toggle(item), star(item), focus(item), select(item), isFocus(item) }.
 * A press shows it in the large window's detail column (ctx.select); its circle puts it on the message or
 * takes it off; ⓘ opens its detail (the side panel's way: there the detail covers the cards).
 */
export function card(item, ctx) {
    const node = el('div', `anomalous-tb-card is-${item.kind}${ctx.picked(item) ? ' is-picked' : ''}${ctx.given(item) ? ' is-given' : ''}${ctx.isFocus?.(item) ? ' is-focus' : ''}`);
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-pressed', String(ctx.picked(item)));
    node.dataset.key = `${item.kind}|${item.id}`;
    if (item.kind === 'nodes') {
        node.append(nodePreview(item));
    } else if (item.kind === 'packs') {
        const preview = el('div', 'anomalous-tb-quote is-pack');
        preview.append(sourceBadge(item.source, 28), el('div', 'anomalous-tb-card-sub', t('aiTbPackCount', { count: item.count })));
        node.append(preview);
    } else if (item.kind === 'prompts' || item.kind === 'ways') {
        const quote = el('div', `anomalous-tb-quote${item.kind === 'ways' ? ' is-way' : ''}`);
        quote.append(el('p', 'anomalous-tb-quote-text', item.kind === 'ways' ? (item.about || item.title) : (item.positive || item.negative || '')));
        node.append(quote);
    } else {
        node.append(picture(item, 'anomalous-tb-cover'));
    }
    const body = el('div', 'anomalous-tb-card-body');
    if (item.kind !== 'nodes') body.append(el('div', 'anomalous-tb-card-title', item.short || item.title));
    const version = item.kind === 'models' ? versionMark(item, ctx) : null;
    if (version) body.append(version);
    if (item.sub) body.append(el('div', 'anomalous-tb-card-sub', item.sub));
    const meta = tags(item);
    meta.prepend(givenBadge(ctx, item));
    body.append(meta, takeBackButton(ctx, item));
    node.append(body);
    if (item.kind === 'models') node.append(nameBadge(item, ctx));
    cardExtras(node, item, ctx);
    return controls(node, item, ctx);
}

/**
 * What a card in the large window offers on the pointer or focus, over the bottom of its cover: put it on
 * the message, and a model's own page. Once on the message, its note to the AI is a line on the card
 * itself, so nothing needs the detail column across the other cards.
 */
function cardExtras(node, item, ctx) {
    const body = node.querySelector('.anomalous-tb-card-body');
    if (!body || node.classList.contains('is-row')) return;
    let bar = body.querySelector('.anomalous-tb-card-bar');
    if (!bar) {
        bar = el('div', 'anomalous-tb-card-bar');
        const take = el('button', 'anomalous-tb-card-act is-pick');
        take.type = 'button';
        take.onclick = (event) => {
            event.stopPropagation();
            ctx.toggle(item);
        };
        bar.append(take);
        if (item.kind === 'models' && ctx.openModel) { // others: a press on the card shows its detail
            const page = el('button', 'anomalous-tb-card-act');
            page.type = 'button';
            page.title = t('aiTbOpenModelPageHint');
            page.append(icon('page', 14), el('span', '', t('aiTbOpenModelPage')));
            page.onclick = (event) => {
                event.stopPropagation();
                ctx.openModel(item);
            };
            bar.append(page);
        }
        body.prepend(bar);
    }
    const on = ctx.picked(item);
    const take = bar.querySelector('.is-pick');
    take.classList.toggle('is-on', on);
    take.replaceChildren(icon(on ? 'check' : 'plus', 14), el('span', '', t(on ? 'aiTbPicked' : 'aiTbPick')));
    const note = body.querySelector('.anomalous-tb-card-note');
    if (on && ctx.setNote && !note) body.append(cardNote(item, ctx));
    else if (!on) note?.remove();
    else if (note && document.activeElement !== note.querySelector('input')) note.querySelector('input').value = ctx.noteOf?.(item) || '';
}

/** The note to the AI on a picked card: written there, kept with the message like the detail column's. */
function cardNote(item, ctx) {
    const row = el('label', 'anomalous-tb-card-note');
    const input = el('input', 'anomalous-tb-note-input is-card');
    input.type = 'text';
    input.maxLength = MAX_REF_NOTE;
    input.dataset.refKey = `${item.kind}\0${item.id}`;
    input.value = ctx.noteOf?.(item) || '';
    input.placeholder = t('aiTbCardNote');
    for (const type of ['click', 'pointerdown', 'keydown']) input.addEventListener(type, event => event.stopPropagation());
    input.addEventListener('input', () => ctx.setNote(item, input.value));
    row.append(icon('pencil', 13), input);
    if (HIDE_BUTTON && ctx.privateTask?.()) row.append(hideButton(input, () => {}));
    return row;
}

/** A note written on a card or in the detail column shows in the other one too (not where it is being typed). */
export function syncNoteInputs(root, item, text) {
    const key = `${item.kind}\0${item.id}`;
    for (const input of root.querySelectorAll('.anomalous-tb-note-input')) {
        if (input.dataset.refKey === key && input !== document.activeElement) input.value = text;
    }
}

/** The circle and the star of a card, and what a press and a key do: a press shows the card's detail, the
 * circle puts it on the message. */
function controls(node, item, ctx) {
    node.classList.toggle('is-in-pack', Boolean(ctx.inPack?.(item))); // its whole pack is picked
    const check = el('button', 'anomalous-tb-check');
    check.type = 'button';
    check.title = t('aiTbPick');
    check.setAttribute('aria-label', t('aiTbPick'));
    check.append(icon('check', 14));
    check.onclick = (event) => {
        event.stopPropagation();
        ctx.toggle(item);
    };
    const star = el('button', `anomalous-tb-star${ctx.favorite(item) ? ' is-on' : ''}`);
    star.type = 'button';
    star.title = t(ctx.favorite(item) ? 'aiToolboxUnfavorite' : 'aiToolboxFavorite');
    star.append(icon(ctx.favorite(item) ? 'starOn' : 'star', 15));
    star.onclick = (event) => {
        event.stopPropagation();
        void ctx.star(item);
    };
    node.append(star, check);
    const press = () => ctx.select(item);
    node.onclick = press;
    node.onkeydown = (event) => {
        if (event.target === node && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            press();
        }
    };
    return node;
}

/** Updates a drawn card after a message ref change, task update, or star change, without drawing the grid again. */
export function refreshCard(node, item, ctx) {
    const on = ctx.picked(item);
    const isGiven = ctx.given(item);
    node.classList.toggle('is-picked', on);
    node.classList.toggle('is-given', isGiven);
    node.classList.toggle('is-in-pack', Boolean(ctx.inPack?.(item)));
    node.setAttribute('aria-pressed', String(on));
    const badge = node.querySelector('.anomalous-tb-given-badge');
    if (badge) badge.hidden = !isGiven;
    const takeBack = node.querySelector('.anomalous-tb-take-back');
    if (takeBack) takeBack.hidden = !(isGiven && ctx.showTakeBack);
    cardExtras(node, item, ctx);
    const star = node.querySelector('.anomalous-tb-star');
    if (star) {
        const liked = ctx.favorite(item);
        star.classList.toggle('is-on', liked);
        star.title = t(liked ? 'aiToolboxUnfavorite' : 'aiToolboxFavorite');
        star.replaceChildren(icon(liked ? 'starOn' : 'star', 15));
    }
}

function section(title, children) {
    const box = el('section', 'anomalous-tb-section');
    box.append(el('h4', 'anomalous-tb-section-title', title), ...children);
    return box;
}

function textBlock(text, className = '') {
    return el('p', `anomalous-tb-text${className ? ` ${className}` : ''}`, text);
}

function socketList(sockets, side) {
    const list = el('div', 'anomalous-tb-socket-list');
    for (const socket of sockets) {
        const row = socketRow(socket, side);
        row.append(el('span', 'anomalous-tb-socket-type', socket.type));
        list.append(row);
    }
    return list;
}

function settingList(settings) {
    const list = el('div', 'anomalous-tb-setting-list');
    for (const setting of settings) {
        const row = el('div', 'anomalous-tb-setting');
        const value = setting.type === 'choice' ? t('aiTbChoices', { count: setting.choices }) : setting.default !== undefined ? String(setting.default).slice(0, 40) : setting.type;
        row.append(el('span', 'anomalous-tb-setting-name', setting.name), el('span', 'anomalous-tb-setting-value', value));
        list.append(row);
    }
    return list;
}

/**
 * The detail pane for `item`. `ctx` as for card(), plus pickPrompt(id) and promptPicked(id)
 * for the prompt inside a combo or workflow.
 */
export function detail(item, ctx) {
    const box = el('div', `anomalous-tb-detail is-${item.kind}`);
    const head = el('div', 'anomalous-tb-detail-head');
    if (item.kind === 'nodes' || item.kind === 'packs') {
        head.append(sourceBadge(item.source, 40));
    } else if (['combos', 'workflows', 'models'].includes(item.kind)) {
        box.append(picture(item, 'anomalous-tb-detail-cover'));
    }
    const words = el('div', 'anomalous-tb-detail-words');
    words.append(el('div', 'anomalous-tb-detail-title', item.title));
    if (item.kind === 'nodes') {
        words.append(el('div', 'anomalous-tb-detail-sub', [item.id, item.source.kind === 'pack' ? item.source.label : t(`aiTbSource_${item.source.kind}`)].join(' · ')));
    } else if (item.kind === 'packs') {
        words.append(el('div', 'anomalous-tb-detail-sub', t('aiTbPackCount', { count: item.count })));
    } else if (item.sub) {
        words.append(el('div', 'anomalous-tb-detail-sub', item.sub));
    }
    head.append(words);
    const meta = tags(item);
    meta.prepend(givenBadge(ctx, item));
    box.append(head, meta);
    const actions = el('div', 'anomalous-tb-detail-actions');
    const take = el('button', `anomalous-tb-take${ctx.picked(item) ? ' is-on' : ''}`);
    take.type = 'button';
    take.append(icon(ctx.picked(item) ? 'check' : 'plus', 15), el('span', '', t(ctx.picked(item) ? 'aiTbPicked' : 'aiTbPick')));
    take.onclick = () => ctx.toggle(item, true);
    const star = el('button', `anomalous-tb-like${ctx.favorite(item) ? ' is-on' : ''}`);
    star.type = 'button';
    star.append(icon(ctx.favorite(item) ? 'starOn' : 'star', 15), el('span', '', t(ctx.favorite(item) ? 'aiToolboxUnfavorite' : 'aiToolboxFavorite')));
    star.onclick = () => void ctx.star(item);
    actions.append(take, star);
    const inner = item.kind === 'combos' ? `combo:${item.id}` : item.kind === 'workflows' ? `workflow:${item.id}` : null;
    if (inner && (item.prompt || item.negative)) {
        const on = ctx.promptPicked(inner);
        const prompt = el('button', `anomalous-tb-like${on ? ' is-on' : ''}`);
        prompt.type = 'button';
        prompt.append(icon('prompts', 15), el('span', '', t(on ? 'aiTbPromptPicked' : 'aiTbPickPrompt')));
        prompt.onclick = () => ctx.pickPrompt(inner);
        actions.append(prompt);
    }
    if (item.kind === 'models' && ctx.openModel) {
        const page = el('button', 'anomalous-tb-like');
        page.type = 'button';
        page.title = t('aiTbOpenModelPageHint');
        page.append(icon('page', 15), el('span', '', t('aiTbOpenModelPage')));
        page.onclick = () => ctx.openModel(item);
        actions.append(page);
    }
    actions.append(takeBackButton(ctx, item, true));
    box.append(actions);
    if (item.kind === 'models') box.append(nameSwitch(item, ctx));
    if (ctx.setNote && item.kind !== 'packs') box.append(pickedNoteBox(item, ctx)); // written first, it puts the thing on the message
    if (item.kind === 'nodes') {
        if (item.description) box.append(textBlock(item.description));
        if (item.category) box.append(section(t('aiTbCategory'), [textBlock(item.category.replaceAll('/', ' › '), 'is-soft')]));
        if (item.page) box.append(textBlock(t('aiTbPageExplain'), 'is-soft'));
        if (item.paid) box.append(textBlock(t('aiTbPaidExplain'), 'is-warn'));
        if (item.inputs.length) box.append(section(t('aiTbInputs'), [socketList(item.inputs, 'in')]));
        if (item.settings.length) box.append(section(t('aiTbSettingsTitle'), [settingList(item.settings)]));
        if (item.outputs.length) box.append(section(t('aiTbOutputs'), [socketList(item.outputs, 'out')]));
    } else if (item.kind === 'packs') {
        box.append(textBlock(t('aiTbPackHint'), 'is-soft'));
    } else if (item.kind === 'ways') {
        if (item.about) box.append(textBlock(item.about));
    } else if (item.kind === 'combos') {
        if (item.model) box.append(section(t('aiTbMainModel'), [textBlock(item.model)]));
        if (item.loras?.length) box.append(section(t('aiTbLoraList'), [textBlock(item.loras.join('\n'), 'is-list')]));
        if (item.prompt) box.append(section(t('aiTbPositive'), [textBlock(item.prompt, 'is-prompt')]));
    } else if (item.kind === 'workflows') {
        if (item.notes) box.append(textBlock(item.notes));
        const facts = [item.base, item.nodes ? t('aiTbNodeCount', { count: item.nodes }) : ''].filter(Boolean).join(' · ');
        if (facts) box.append(textBlock(facts, 'is-soft'));
        if (item.prompt) box.append(section(t('aiTbPositive'), [textBlock(item.prompt, 'is-prompt')]));
        if (item.negative) box.append(section(t('aiTbNegative'), [textBlock(item.negative, 'is-prompt is-negative')]));
    } else if (item.kind === 'prompts') {
        if (item.positive) box.append(section(t('aiTbPositive'), [textBlock(item.positive, 'is-prompt')]));
        if (item.negative) box.append(section(t('aiTbNegative'), [textBlock(item.negative, 'is-prompt is-negative')]));
    } else if (item.kind === 'models') { // where it lives and its trigger words fold away
        const more = el('details', 'anomalous-tb-more');
        more.append(el('summary', '', t(item.words?.length ? 'aiTbMoreFileWords' : 'aiTbMoreFile')), textBlock([item.folder, item.file].filter(Boolean).join('/'), 'is-soft'));
        if (item.words?.length) more.append(section(t('aiTbWords'), [tagsOf(item.words)]));
        box.append(aboutSection(item, ctx), more);
    }
    return box;
}

function pickedNoteBox(item, ctx) {
    const wrap = el('div', 'anomalous-tb-note-box');
    const head = el('div', 'anomalous-tb-note-head');
    head.append(el('span', 'anomalous-tb-section-title', t('aiTbRemarkLabel')));
    const input = el('input', 'anomalous-tb-note-input');
    input.type = 'text';
    input.maxLength = MAX_REF_NOTE;
    input.dataset.refKey = `${item.kind}\0${item.id}`;
    input.value = ctx.noteOf?.(item) || '';
    input.placeholder = t(ctx.privateTask?.() ? 'aiRefNotePrivate' : 'aiRefNote');
    const hint = el('div', 'anomalous-tb-note-hint');
    if (HIDE_BUTTON && ctx.privateTask?.()) head.append(hideButton(input, (text) => { hint.textContent = text; }));
    input.addEventListener('keydown', event => event.stopPropagation());
    input.addEventListener('input', () => {
        hint.textContent = '';
        ctx.setNote(item, input.value);
    });
    wrap.append(head, input, hint);
    return wrap;
}

/** Compact chips of the items currently on the message, for the full picker's tray. */
export function renderPickedBar(row, items, ctx) {
    row.hidden = !items.length;
    if (!items.length) {
        row.replaceChildren();
        return;
    }
    row.replaceChildren(el('span', 'anomalous-tb-picked-label', t('aiTbPickedBar')), ...items.map((ref) => {
        const chip = el('div', `anomalous-tb-picked-chip is-${ref.kind}`);
        const pick = el('button', 'anomalous-tb-picked-jump');
        pick.type = 'button';
        pick.title = ref.note ? `${ref.label} · ${ref.note}` : ref.label;
        pick.append(icon(kindIcon(ref.kind), 13), el('span', 'anomalous-tb-picked-name', ref.label));
        if (ref.note) pick.append(el('span', 'anomalous-tb-picked-note', ref.note));
        pick.onclick = () => ctx.focusPicked?.(ref);
        const drop = el('button', 'anomalous-tb-picked-x');
        drop.type = 'button';
        drop.title = t('aiMentionRemove');
        drop.setAttribute('aria-label', t('aiMentionRemove'));
        drop.append(icon('close', 11));
        drop.onclick = (event) => {
            event.stopPropagation();
            ctx.removePicked?.(ref);
        };
        chip.append(pick, drop);
        return chip;
    }));
}

function tagsOf(words) {
    const row = el('div', 'anomalous-tb-tags');
    for (const word of words) row.append(el('span', 'anomalous-tb-tag', word));
    return row;
}
