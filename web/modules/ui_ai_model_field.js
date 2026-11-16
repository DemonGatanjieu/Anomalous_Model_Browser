/**
 * Single-model inline expandable picker field (used by web/modules/ui_ai_start_from.js):
 * expands inline (pushing content below down, not floating) with search, base-family chips
 * when >=2 families exist, scrollable rows with cover/name/star/family (favourites first),
 * keyboard ↑↓ / Enter / Esc (data-anomalous-escape), and outside-click close.
 */

import { translate as t } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { filterModels, modelFamilies } from './ai_start_from.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { standInCover } from './ui_ai_toolbox_icons.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

/** A base model family as the routes name it ("anima", "SDXL") in the words shown: its first letter a capital. */
const familyName = family => family.charAt(0).toUpperCase() + family.slice(1);

function modelThumb(model) {
    const box = el('span', 'anomalous-ai-model-field-thumb');
    if (!model) {
        box.classList.add('is-none');
        box.append(icon('models', 15));
        return box;
    }
    const url = coverUrl({ kind: 'models', cover: model.cover });
    const fallback = () => box.replaceChildren(standInCover('models'));
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

/**
 * Builds an inline model selector returning `{ element, value, setModels, setValue, dispose }`.
 */
export function modelField({ models = [], value = '', noneLabel = '', ariaLabel = '', onChange } = {}) {
    const scope = createViewScope();
    let allModels = [...(models || [])];
    let selectedId = value || '';
    let isOpen = false;
    let query = '';
    let family = null;
    let entries = [];
    let rows = [];
    let activeIdx = 0;

    const root = el('div', 'anomalous-ai-model-field');
    const toggle = el('button', 'anomalous-ai-model-field-btn');
    toggle.type = 'button';
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    if (ariaLabel) toggle.setAttribute('aria-label', ariaLabel);

    const panel = el('div', 'anomalous-ai-model-field-panel');
    panel.hidden = true;
    const searchWrap = el('label', 'anomalous-ai-model-field-search');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiStartModelSearch');
    searchWrap.append(icon('search', 14), search);

    const baseBar = el('div', 'anomalous-model-bases anomalous-ai-model-field-bases');
    const list = el('div', 'anomalous-ai-model-field-list');
    list.setAttribute('role', 'listbox');
    panel.append(searchWrap, baseBar, list);
    root.append(toggle, panel);

    const selectedModel = () => allModels.find(item => item.model_id === selectedId) || null;

    function drawButton() {
        const picked = selectedModel();
        const label = picked ? picked.name : noneLabel;
        const nodes = [
            modelThumb(picked),
            el('span', 'anomalous-ai-model-field-name', label),
        ];
        if (picked?.favourite) {
            const star = el('span', 'anomalous-ai-model-field-star');
            star.append(icon('starOn', 13));
            nodes.push(star);
        }
        if (picked?.family) nodes.push(el('span', 'anomalous-ai-model-field-family', familyName(picked.family)));
        const arrow = el('span', 'anomalous-ai-model-field-arrow');
        arrow.append(icon('chevronDown', 14));
        nodes.push(arrow);
        toggle.classList.toggle('is-none', !picked && Boolean(noneLabel));
        toggle.replaceChildren(...nodes);
    }

    function drawBases() {
        const counts = modelFamilies(allModels);
        if (counts.length < 2) {
            family = null;
            baseBar.hidden = true;
            baseBar.replaceChildren();
            return;
        }
        if (family !== null && !counts.some(([itemFamily]) => itemFamily === family)) family = null;
        baseBar.hidden = false;
        baseBar.replaceChildren(...[[null, allModels.length], ...counts].map(([itemFamily, count]) => {
            const chip = el('button', 'anomalous-model-base-chip');
            chip.type = 'button';
            chip.setAttribute('aria-pressed', String(itemFamily === family));
            chip.append(
                el('span', '', itemFamily === null ? t('modelBasesAll') : familyName(itemFamily) || t('modelBasesUnknown')),
                el('span', 'anomalous-model-type-count', String(count)),
            );
            chip.onclick = () => {
                family = itemFamily;
                activeIdx = 0;
                drawBases();
                drawList(true);
                search.focus();
            };
            return chip;
        }));
    }

    function paintActive(scroll = false) {
        rows.forEach((row, idx) => row.classList.toggle('is-active', idx === activeIdx));
        if (scroll) rows[activeIdx]?.scrollIntoView?.({ block: 'nearest' });
    }

    function drawList(resetCursor = false) {
        const words = query.trim().toLowerCase();
        const filtered = filterModels(allModels, { query, family });
        const includeNone = Boolean(noneLabel) && (!words || noneLabel.toLowerCase().includes(words));
        entries = includeNone ? [{ isNone: true, model_id: '', name: noneLabel }, ...filtered] : filtered;
        rows = [];
        if (!entries.length) {
            activeIdx = -1;
            list.replaceChildren(el('div', 'anomalous-ai-model-field-empty', t('aiMentionNone')));
            return;
        }
        const selectedIndex = entries.findIndex(item => item.model_id === selectedId);
        activeIdx = resetCursor ? 0 : (selectedIndex >= 0 ? selectedIndex : Math.min(Math.max(activeIdx, 0), entries.length - 1));
        const nodes = entries.map((entry, idx) => {
            const selected = entry.model_id === selectedId;
            const row = el('button', `anomalous-ai-model-field-row${selected ? ' is-on' : ''}${idx === activeIdx ? ' is-active' : ''}`);
            row.type = 'button';
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(selected));
            row.append(
                modelThumb(entry.isNone ? null : entry),
                el('span', 'anomalous-ai-model-field-row-name', entry.name),
            );
            if (entry.favourite) {
                const star = el('span', 'anomalous-ai-model-field-star');
                star.append(icon('starOn', 13));
                row.append(star);
            }
            if (entry.family) row.append(el('span', 'anomalous-ai-model-field-row-family', familyName(entry.family)));
            if (selected) row.append(icon('check', 14));
            row.onmouseenter = () => {
                if (activeIdx === idx) return;
                activeIdx = idx;
                paintActive(false);
            };
            row.onclick = () => pick(entry.model_id);
            rows.push(row);
            return row;
        });
        list.replaceChildren(...nodes);
        if (!resetCursor) rows[activeIdx]?.scrollIntoView?.({ block: 'nearest' });
    }

    function open() {
        if (isOpen) return;
        isOpen = true;
        query = '';
        search.value = '';
        panel.hidden = false;
        panel.dataset.anomalousEscape = '1';
        root.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        drawBases();
        drawList(false);
        search.focus();
    }

    function close(refocus = false) {
        if (!isOpen) return;
        isOpen = false;
        query = '';
        search.value = '';
        panel.hidden = true;
        delete panel.dataset.anomalousEscape;
        root.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        if (refocus) toggle.focus();
    }

    function pick(nextId) {
        const changed = nextId !== selectedId;
        selectedId = nextId || '';
        drawButton();
        close(true);
        if (changed) onChange?.(selectedId);
    }

    function moveActive(delta) {
        if (!entries.length) return;
        activeIdx = (activeIdx + delta + entries.length) % entries.length;
        paintActive(true);
    }

    toggle.onclick = () => { if (isOpen) close(false); else open(); };
    toggle.addEventListener('keydown', (event) => {
        if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            open();
        }
    }, { signal: scope.signal });

    search.addEventListener('input', () => {
        query = search.value;
        drawList(true);
    }, { signal: scope.signal });

    root.addEventListener('keydown', (event) => {
        if (!isOpen) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveActive(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(-1);
        } else if (event.key === 'Enter' && panel.contains(event.target)) {
            event.preventDefault();
            const chosen = entries[activeIdx];
            if (chosen) pick(chosen.model_id);
        }
    }, { signal: scope.signal });

    document.addEventListener('pointerdown', (event) => {
        if (isOpen && !root.contains(event.target)) close(false);
    }, { capture: true, signal: scope.signal });

    document.addEventListener('keydown', (event) => {
        if (!isOpen || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setTimeout(() => { if (isOpen) close(true); });
    }, { signal: scope.signal });

    drawButton();

    return {
        element: root,
        get value() { return selectedId; },
        setModels(nextModels, nextValue = selectedId) {
            allModels = [...(nextModels || [])];
            selectedId = nextValue || '';
            drawButton();
            if (isOpen) {
                drawBases();
                drawList(false);
            }
        },
        setValue(nextValue) {
            selectedId = nextValue || '';
            drawButton();
            if (isOpen) drawList(false);
        },
        dispose: () => scope.dispose(),
    };
}
