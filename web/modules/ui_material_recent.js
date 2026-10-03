/**
 * The Material Library's "Recent" shelf: the newest generated images that carry their
 * workflow (GET /anomalous/recent_generations), each with what made it. The star keeps one
 * as a Workflow Recipe (recipe_save.js) named after its prompt, so a good result is kept
 * with one press; a starred image opens its recipe (or, kept before recipes took over, its
 * material). The picture opens the image workbench, where single nodes can be kept instead.
 */

import { translate as t } from './locales.js';
import { jsonResponse } from './ui_dom.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { keepImageAsRecipe } from './recipe_save.js';

const SHOWN = 36;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const viewUrl = item => `/view?${new URLSearchParams({ filename: item.filename, subfolder: item.subfolder, type: 'output' })}`;
const thumbUrl = item => `/anomalous/output_thumbnail?${new URLSearchParams({ filename: item.filename, subfolder: item.subfolder })}`;

/** "28 steps · CFG 5.5 · dpmpp_2m · 832×1216" */
function paramsLine(params) {
    return [
        params.steps != null ? t('recentSteps', { count: params.steps }) : '',
        params.cfg != null ? `CFG ${params.cfg}` : '',
        params.sampler_name || '',
        params.resolution || '',
    ].filter(Boolean).join(' · ');
}

/** A name people recognise: the prompt's first few tags (the server names it after the file otherwise). */
function keptName(item) {
    const name = String(item.prompt || '').split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 3).join(', ');
    return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}

function paintStar(star, item) {
    const kept = Boolean(item.recipe || item.material);
    star.textContent = kept ? '★' : '☆';
    star.classList.toggle('is-on', kept);
    star.setAttribute('aria-pressed', String(kept));
    star.title = t(kept ? 'recentStarredHint' : 'recentStarHint');
}

async function keep(owner, item, star) {
    star.disabled = true;
    try {
        // An image kept before gives its recipe back, not a copy.
        const recipe = await keepImageAsRecipe({ type: 'output', filename: item.filename, subfolder: item.subfolder }, { name: keptName(item) });
        item.recipe = { filename: recipe.filename, name: recipe.name };
        showWorkbenchToast(t('recentKept'), { label: t('recentOpenRecipe'), run: () => owner.openRecipeByFilename(recipe.filename) });
    } catch (error) {
        showWorkbenchToast(t('recentKeepFailed', { error: error.message }));
    } finally {
        star.disabled = false;
        paintStar(star, item);
    }
}

function renderCard(owner, item, items) {
    const card = el('article', 'anomalous-recent-card');
    const picture = el('button', 'anomalous-recent-picture');
    picture.type = 'button';
    picture.title = t('recentOpenHint');
    const img = el('img');
    img.src = thumbUrl(item);
    img.alt = item.prompt || item.filename;
    img.loading = 'lazy';
    img.decoding = 'async';
    picture.appendChild(img);
    picture.onclick = () => void showImageWorkbench(owner, { type: 'output', filename: item.filename, subfolder: item.subfolder }, viewUrl(item), {
        items: items.map(other => ({ filename: other.filename, subfolder: other.subfolder, url: viewUrl(other) })),
        currentIndex: items.indexOf(item),
    });

    const star = el('button', 'anomalous-recent-star');
    star.type = 'button';
    star.onclick = () => (item.recipe ? owner.openRecipeByFilename(item.recipe.filename)
        : item.material ? owner.openSavedMaterial(item.material) : keep(owner, item, star));
    paintStar(star, item);

    const body = el('div', 'anomalous-recent-body');
    body.append(el('time', 'anomalous-recent-time', `${dayLabel(item.mtime)} ${timeLabel(item.mtime)}`));
    const prompt = el('p', 'anomalous-recent-prompt', item.prompt || t('recentNoPrompt'));
    prompt.title = item.prompt;
    body.append(prompt);
    const params = paramsLine(item.params || {});
    if (params) body.append(el('div', 'anomalous-recent-params', params));
    if (item.model) body.append(el('div', 'anomalous-recent-model', item.model));
    card.append(picture, star, body);
    return card;
}

/** Fills the material list with the shelf; `signal` belongs to the list's current load. */
export async function renderRecentShelf(owner, signal) {
    const list = owner.materialList;
    const query = new URLSearchParams({ limit: SHOWN });
    if (owner.materialQuery) query.set('q', owner.materialQuery);
    try {
        const response = await fetch(`/anomalous/recent_generations?${query}`, { cache: 'no-store', signal });
        const { items = [] } = await jsonResponse(response, 'recent images');
        if (signal.aborted) return;
        list.replaceChildren(el('p', 'anomalous-recent-lead', t('recentLead')));
        if (!items.length) {
            list.append(el('p', 'anomalous-material-empty', t(owner.materialQuery ? 'materialNoMatches' : 'recentEmpty')));
            return;
        }
        for (const item of items) list.appendChild(renderCard(owner, item, items));
    } catch (error) {
        if (signal.aborted) return;
        console.warn('[AMB] Recent images did not load.', error);
        list.replaceChildren(el('p', 'anomalous-material-empty', t('materialLoadError')));
    }
}
