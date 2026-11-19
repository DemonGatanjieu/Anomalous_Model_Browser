/**
 * The reusable model picker window shared by starter sheets (base models and private LoRAs), the
 * message box's route builder, and future model-picking features. Reuses the Models page's visual card
 * face (ui_grid.js `modelCardFace`: cover, base/inferred badge, version pill, display name, filename),
 * type chips (ui_model_types.js), fine-grained Base Model chips (model_bases.js), and same-model
 * version grouping (model_versions.js via ai_model_pick.js), keeping all versions expanded and side
 * by side so any version is one click away.
 */

import { adaptPickerModel, expandModelGroups, filterPickerModels, modelTypes } from './ai_model_pick.js';
import { translate as t } from './locales.js';
import { baseFamily, countBases } from './model_bases.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { standInCover } from './ui_ai_toolbox_icons.js';
import { modelCardFace, stopMediaInContainer } from './ui_grid.js';
import { typeLabel } from './ui_model_types.js';
import { versionLabel } from './ui_model_versions.js';

const PAGE_STEP = 120;
const CARD_OWNER = { cardThumbnailMode: 'card', energySaving: true };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

/** Concise `Type · Base · Version` label for picked chips and summaries. */
export function modelMetaSummary(model) {
    if (!model) return '';
    const base = baseFamily(model) || model.metadata?.baseModel || model.base || model.family || '';
    const type = model.type ? typeLabel({ type: model.type }) : '';
    const version = String(model.metadata?.version_name || '').trim();
    return [type, base, version].filter(Boolean).join(' · ');
}

/** `model`'s cover in a box of `className`; its type's picture while it has none or it does not load. */
export function modelThumb(model, className) {
    const box = el('span', className);
    const url = coverUrl({ kind: 'models', cover: model.cover || model.preview_url });
    const fallback = () => box.replaceChildren(standInCover('models', model.type || ''));
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

function buildFilterButton(className, label, pressed, count, onClick) {
    const node = el('button', className);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(pressed));
    node.append(...(Array.isArray(label) ? label : [el('span', '', label)]));
    if (count !== undefined) node.append(el('span', 'anomalous-model-type-count', String(count)));
    node.onclick = onClick;
    return node;
}

/**
 * Opens the reusable model picker dialog. `models`: list of model objects (`{model_id|id, name, ...}`);
 * `picked`: selected model ids in order; `max`, `min`, `numbered`, `fits(ids, model)`, `unfit`,
 * `role(index)`, `note`, `hint`, `from` (focus restore element), `onDone(ids)`.
 */
export function openModelPicker({ title, models, picked = [], max = 1, min = 0, numbered = false, fits = () => true, unfit = '', role = () => '', note = '', hint = '', from = null, onDone }) {
    const adapted = (models || []).map(adaptPickerModel);
    const byId = new Map(adapted.map(model => [model.model_id, model]));
    const chosen = picked.filter(id => byId.has(id));
    const initialPriority = [...chosen];
    let query = '';
    let selectedType = null;
    let selectedBase = null;
    let favouritesOnly = false;
    let limit = PAGE_STEP;

    const body = el('div', 'anomalous-ai-pick');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiStartModelSearch');
    const searchRow = el('label', 'anomalous-ai-pick-search');
    searchRow.append(icon('search', 14), search);

    const pickedBar = el('div', 'anomalous-ai-pick-picked');
    const typeBar = el('div', 'anomalous-model-types anomalous-ai-pick-types');
    typeBar.setAttribute('role', 'toolbar');
    typeBar.setAttribute('aria-label', t('modelTypesLabel'));

    const baseBar = el('div', 'anomalous-model-bases anomalous-ai-pick-bases');
    baseBar.setAttribute('role', 'toolbar');
    baseBar.setAttribute('aria-label', t('modelBasesLabel'));

    const grid = el('div', 'anomalous-ai-pick-grid');
    const more = el('div', 'anomalous-ai-pick-more');
    const say = el('span', 'anomalous-ai-pick-hint');
    const done = el('button', 'anomalous-ai-start-go', t('aiPickDone'));
    done.type = 'button';
    const foot = el('div', 'anomalous-ai-pick-foot');
    foot.append(say, done);

    body.append(searchRow, ...(note ? [el('div', 'anomalous-ai-pick-note', note)] : []), pickedBar, typeBar, baseBar, grid, more, foot);

    const tell = (words = hint, warn = false) => {
        say.textContent = words;
        say.classList.toggle('is-warn', warn);
    };

    function drawPickedBar() {
        pickedBar.hidden = !chosen.length;
        if (!chosen.length) {
            pickedBar.replaceChildren();
            return;
        }
        const chips = chosen.map((id, at) => {
            const model = byId.get(id);
            if (!model) return null;
            const chip = el('span', 'anomalous-ai-pick-chip');
            const badgeText = numbered ? String(at + 1) : '✓';
            const sub = [role(at), modelMetaSummary(model)].filter(Boolean).join(' · ');
            const words = el('span', 'anomalous-ai-pick-chip-words');
            words.append(el('span', 'anomalous-ai-pick-chip-name', model.name));
            if (sub) words.append(el('span', 'anomalous-ai-pick-chip-meta', sub));
            const drop = el('button', 'anomalous-ai-start-lora-drop');
            drop.type = 'button';
            drop.setAttribute('aria-label', t('aiPickPickedDrop', { name: model.name }));
            drop.append(icon('close', 12));
            drop.onclick = () => {
                const pos = chosen.indexOf(id);
                if (pos >= 0) chosen.splice(pos, 1);
                tell();
                syncCardStates();
                drawPickedBar();
            };
            chip.append(modelThumb(model, 'anomalous-ai-pick-chip-thumb'), el('span', 'anomalous-ai-pick-chip-num', badgeText), words, drop);
            chip.title = sub ? `${model.name} (${sub})` : model.name;
            return chip;
        }).filter(Boolean);
        pickedBar.replaceChildren(el('span', 'anomalous-ai-pick-picked-head', t('aiPickPickedHead', { count: chosen.length, max })), ...chips);
    }

    function drawTypeBar() {
        const types = modelTypes(adapted);
        typeBar.hidden = types.length < 2;
        if (typeBar.hidden) {
            typeBar.replaceChildren();
            return;
        }
        const total = adapted.length;
        typeBar.replaceChildren(
            buildFilterButton(`anomalous-model-type-chip${selectedType === null ? ' is-active' : ''}`, t('modelBasesAll'), selectedType === null, total, () => {
                selectedType = null;
                limit = PAGE_STEP;
                drawFilters();
                drawGrid();
            }),
            ...types.map(([type, count]) => buildFilterButton(
                `anomalous-model-type-chip${selectedType === type ? ' is-active' : ''}`,
                typeLabel({ type }),
                selectedType === type,
                count,
                () => {
                    selectedType = selectedType === type ? null : type;
                    limit = PAGE_STEP;
                    drawFilters();
                    drawGrid();
                },
            )),
        );
    }

    function drawBaseBar() {
        const scoped = filterPickerModels(adapted, { query, type: selectedType });
        const bases = countBases(scoped);
        if (selectedBase !== null && !bases.some(([family]) => family === selectedBase)) selectedBase = null;
        const starred = scoped.filter(model => model.favourite).length;
        const buttons = [];
        if (bases.length > 1) {
            buttons.push(buildFilterButton('anomalous-model-base-chip', t('modelBasesAll'), selectedBase === null && !favouritesOnly, scoped.length, () => {
                selectedBase = null;
                favouritesOnly = false;
                limit = PAGE_STEP;
                drawBaseBar();
                drawGrid();
            }));
            for (const [family, count] of bases) {
                buttons.push(buildFilterButton('anomalous-model-base-chip', family || t('modelBasesUnknown'), selectedBase === family, count, () => {
                    selectedBase = selectedBase === family ? null : family;
                    favouritesOnly = false;
                    limit = PAGE_STEP;
                    drawBaseBar();
                    drawGrid();
                }));
            }
        }
        if (starred) {
            buttons.push(buildFilterButton(
                'anomalous-model-base-chip',
                [icon('starOn', 12), el('span', '', t('aiPickFavourites'))],
                favouritesOnly,
                starred,
                () => {
                    favouritesOnly = !favouritesOnly;
                    limit = PAGE_STEP;
                    drawBaseBar();
                    drawGrid();
                },
            ));
        }
        baseBar.hidden = !buttons.length;
        baseBar.replaceChildren(...buttons);
    }

    function drawFilters() {
        drawTypeBar();
        drawBaseBar();
    }

    function syncCardStates() {
        for (const card of grid.children) {
            const model = byId.get(card.dataset.modelId);
            if (!model) continue;
            const at = chosen.indexOf(model.model_id);
            const on = at >= 0;
            const compatible = on || fits(chosen, model);
            card.classList.toggle('is-on', on);
            card.classList.toggle('is-unfit', !compatible);
            card.setAttribute('aria-pressed', String(on));
            card.setAttribute('aria-disabled', String(!compatible));
            const badge = card.querySelector('.anomalous-ai-pick-badge');
            if (badge) {
                badge.hidden = !on;
                if (on) {
                    const roleText = role(at);
                    badge.textContent = numbered ? (roleText ? `${at + 1} · ${roleText}` : String(at + 1)) : '✓';
                }
            }
        }
    }

    function toggle(model) {
        const at = chosen.indexOf(model.model_id);
        if (at >= 0) chosen.splice(at, 1);
        else if (!fits(chosen, model)) return tell(unfit, true);
        else if (chosen.length >= max) return tell(t('aiPickMax', { max }), true);
        else chosen.push(model.model_id);
        tell();
        syncCardStates();
        drawPickedBar();
    }

    function buildCard(entry, index) {
        const { model, groupSize, versionIndex } = entry;
        const siblingPin = groupSize > 1
            ? el('span', 'anomalous-ai-pick-sibling', t('aiPickGroupTag', { n: versionIndex + 1, total: groupSize }))
            : null;
        const card = modelCardFace(CARD_OWNER, model, index, siblingPin);
        // Ensure sibling cards always display a distinguishing version/file pill even without Civitai version_name.
        if (groupSize > 1 && !model.metadata?.version_name) {
            const versionEl = card.querySelector('.anomalous-card-version');
            if (versionEl) versionEl.textContent = versionLabel(model);
        }
        card.classList.add('anomalous-picker-card', 'anomalous-ai-pick-card');
        if (groupSize > 1) {
            card.classList.add('is-version-open', 'is-group-member');
            if (entry.isGroupStart) card.classList.add('is-group-start');
            if (entry.isGroupEnd) card.classList.add('is-group-end');
            card.title = `${model.name} — ${t('aiPickGroupTitle', { total: groupSize })}`;
        } else {
            card.title = `${model.name}${model.filename ? ` (${model.filename})` : ''}`;
        }
        card.dataset.modelId = model.model_id;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');

        const topRight = el('div', 'anomalous-ai-pick-top');
        const badge = el('span', 'anomalous-ai-pick-badge');
        badge.hidden = true;
        topRight.append(badge);
        if (model.favourite) {
            const star = el('span', 'anomalous-ai-pick-star');
            star.append(icon('starOn', 12));
            topRight.append(star);
        }
        if (model.type) topRight.append(el('span', 'anomalous-ai-pick-type', typeLabel({ type: model.type })));
        card.append(topRight);

        card.onclick = () => toggle(model);
        card.onkeydown = (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            toggle(model);
        };
        return card;
    }

    function drawGrid() {
        stopMediaInContainer(grid);
        const found = filterPickerModels(adapted, { query, type: selectedType, baseFamily: selectedBase, favouritesOnly });
        const expanded = expandModelGroups(found, initialPriority);
        const visible = expanded.slice(0, limit);
        grid.replaceChildren(...visible.map((entry, idx) => buildCard(entry, idx)));
        syncCardStates();
        if (!expanded.length) {
            more.replaceChildren(el('span', '', t('aiMentionNone')));
            more.hidden = false;
        } else if (expanded.length > limit) {
            const left = expanded.length - limit;
            const step = Math.min(PAGE_STEP, left);
            const showMore = el('button', 'anomalous-ai-pick-more-btn', t('aiPickShowMore', { count: step, left }));
            showMore.type = 'button';
            showMore.onclick = () => {
                limit += PAGE_STEP;
                drawGrid();
            };
            more.replaceChildren(showMore, el('span', '', t('aiPickMore', { count: left })));
            more.hidden = false;
        } else {
            more.replaceChildren();
            more.hidden = true;
        }
    }

    search.addEventListener('input', () => {
        query = search.value;
        limit = PAGE_STEP;
        drawBaseBar();
        drawGrid();
    });
    const close = aiWindow(title, body, () => {
        stopMediaInContainer(grid);
        from?.focus();
    });
    done.onclick = () => {
        if (chosen.length < min) return tell(t('aiPickNone'), true);
        onDone([...chosen]);
        close();
    };
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-model-pick');
    tell();
    drawPickedBar();
    drawFilters();
    drawGrid();
    search.focus();
}
