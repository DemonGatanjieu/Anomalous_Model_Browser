/**
 * The materials picker's cards and detail pane (ui_ai_toolbox.js). A card is one node type,
 * combo, workflow, prompt or model: a node shows itself in miniature (its sockets in ComfyUI's
 * colours, outputs on the right, how many settings) under its source's badge; combos,
 * workflows and models show their cover; a prompt shows its text. A press picks or unpicks,
 * the star keeps it among the favourites. The detail pane shows the card in focus in full,
 * and for a combo or workflow can pick just the prompt inside it.
 */

import { translate as t } from './locales.js';
import { outputThumbnail } from './ui_kept_toast.js';
import { recipeAssetUrl } from './ui_recipe_media.js';
import { icon } from './ui_ai_icons.js';
import { socketColor, sourceBadge, standInCover } from './ui_ai_toolbox_icons.js';

const SOCKETS_SHOWN = 4;
const withQuery = (url, query) => `${url}${url.includes('?') ? '&' : '?'}${query}`;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
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
    const fallback = () => box.replaceChildren(standInCover(item.kind));
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
        add(item.type);
        if (item.base) add(item.base);
    }
    return row;
}

/**
 * One card. `ctx`: { picked(item), favorite(item), toggle(item), star(item), focus(item) }.
 * A press picks or unpicks; focus or the pointer shows it in the detail pane.
 */
export function card(item, ctx) {
    const node = el('div', `anomalous-tb-card is-${item.kind}${ctx.picked(item) ? ' is-picked' : ''}`);
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-pressed', String(ctx.picked(item)));
    node.dataset.key = `${item.kind}|${item.id}`;
    if (item.kind === 'nodes') {
        node.append(nodePreview(item));
    } else if (item.kind === 'prompts') {
        const quote = el('div', 'anomalous-tb-quote');
        quote.append(el('p', 'anomalous-tb-quote-text', item.positive || item.negative || ''));
        node.append(quote);
    } else {
        node.append(picture(item, 'anomalous-tb-cover'));
    }
    const body = el('div', 'anomalous-tb-card-body');
    if (item.kind !== 'nodes') body.append(el('div', 'anomalous-tb-card-title', item.title));
    if (item.sub) body.append(el('div', 'anomalous-tb-card-sub', item.sub));
    body.append(tags(item));
    const check = el('span', 'anomalous-tb-check');
    check.append(icon('check', 14));
    const star = el('button', `anomalous-tb-star${ctx.favorite(item) ? ' is-on' : ''}`);
    star.type = 'button';
    star.title = t(ctx.favorite(item) ? 'aiToolboxUnfavorite' : 'aiToolboxFavorite');
    star.append(icon(ctx.favorite(item) ? 'starOn' : 'star', 15));
    star.onclick = (event) => {
        event.stopPropagation();
        void ctx.star(item);
    };
    node.append(body, check, star);
    node.onclick = () => ctx.toggle(item);
    node.onkeydown = (event) => {
        if (event.target === node && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            ctx.toggle(item);
        }
    };
    node.onfocus = () => ctx.focus(item);
    node.onpointerenter = () => ctx.focus(item);
    return node;
}

/** Updates a drawn card after a pick or a star, without drawing the grid again. */
export function refreshCard(node, item, ctx) {
    const on = ctx.picked(item);
    node.classList.toggle('is-picked', on);
    node.setAttribute('aria-pressed', String(on));
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
    if (item.kind === 'nodes') {
        head.append(sourceBadge(item.source, 40));
    } else if (item.kind !== 'prompts') {
        box.append(picture(item, 'anomalous-tb-detail-cover'));
    }
    const words = el('div', 'anomalous-tb-detail-words');
    words.append(el('div', 'anomalous-tb-detail-title', item.title));
    if (item.kind === 'nodes') {
        words.append(el('div', 'anomalous-tb-detail-sub', [item.id, item.source.kind === 'pack' ? item.source.label : t(`aiTbSource_${item.source.kind}`)].join(' · ')));
    } else if (item.sub) {
        words.append(el('div', 'anomalous-tb-detail-sub', item.sub));
    }
    head.append(words);
    box.append(head, tags(item));
    const actions = el('div', 'anomalous-tb-detail-actions');
    const take = el('button', `anomalous-tb-take${ctx.picked(item) ? ' is-on' : ''}`);
    take.type = 'button';
    take.append(icon(ctx.picked(item) ? 'check' : 'plus', 15), el('span', '', t(ctx.picked(item) ? 'aiTbPicked' : 'aiTbPick')));
    take.onclick = () => ctx.toggle(item);
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
    box.append(actions);
    if (item.kind === 'nodes') {
        if (item.description) box.append(textBlock(item.description));
        if (item.category) box.append(section(t('aiTbCategory'), [textBlock(item.category.replaceAll('/', ' › '), 'is-soft')]));
        if (item.page) box.append(textBlock(t('aiTbPageExplain'), 'is-soft'));
        if (item.paid) box.append(textBlock(t('aiTbPaidExplain'), 'is-warn'));
        if (item.inputs.length) box.append(section(t('aiTbInputs'), [socketList(item.inputs, 'in')]));
        if (item.settings.length) box.append(section(t('aiTbSettingsTitle'), [settingList(item.settings)]));
        if (item.outputs.length) box.append(section(t('aiTbOutputs'), [socketList(item.outputs, 'out')]));
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
    } else if (item.kind === 'models') {
        box.append(textBlock([item.folder, item.file].filter(Boolean).join('/'), 'is-soft'));
        if (item.words?.length) box.append(section(t('aiTbWords'), [tagsOf(item.words)]));
    }
    return box;
}

function tagsOf(words) {
    const row = el('div', 'anomalous-tb-tags');
    for (const word of words) row.append(el('span', 'anomalous-tb-tag', word));
    return row;
}
