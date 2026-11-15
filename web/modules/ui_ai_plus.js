/**
 * The message box's "+" button menu (plugged into web/modules/ui_ai_message.js): pick a model
 * (favourites first, searchable) or an active usable way without inserting "@name" into the text,
 * or open the shared "Build a new one (text to image)" dialog for this task.
 */

import { resolveLocale, translate as t } from './locales.js';
import { orderModelsFavoritesFirst } from './ai_chat_plus.js';
import { fetchUsableWays, keptCatalog, loadCatalog, searchItems } from './ai_toolbox_data.js';
import { icon } from './ui_ai_icons.js';
import { createViewScope } from './ui_lifecycle.js';

const MAX_LIST = 100;
const INTERACTIVE = '.anomalous-ai-message-tool, button, input, textarea, select, a';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

async function fetchFavorites(signal) {
    try {
        const response = await fetch('/anomalous/ai_toolbox/favorites', { signal });
        if (!response.ok) return [];
        const data = await response.json().catch(() => ({}));
        return data?.favorites?.models || [];
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return [];
    }
}

/**
 * The "+" menu over `box`: second press on `button`, Esc and a press outside close it and return
 * focus to `field`. `opts`: `{button, lead, kindWords, onOpen, onPick(item), onBuild}`.
 */
export function plusMenu(box, field, { button, lead, kindWords, onOpen, onPick, onBuild }) {
    let panel = null;
    let stop = null;

    function close(refocus = true) {
        if (!panel) return;
        stop?.();
        stop = null;
        panel.remove();
        panel = null;
        button.classList.remove('is-on');
        button.setAttribute('aria-expanded', 'false');
        if (refocus) field.focus();
    }

    function open() {
        onOpen?.();
        const scope = createViewScope();
        let viewAbort = null;
        scope.onDispose(() => viewAbort?.abort());

        panel = el('div', 'anomalous-ai-plus');
        panel.dataset.anomalousEscape = '1';
        box.append(panel);
        button.classList.add('is-on');
        button.setAttribute('aria-expanded', 'true');

        const outside = (event) => {
            if (!panel?.contains(event.target) && !event.target.closest?.('.anomalous-ai-message-plus')) {
                close(!event.target.closest?.(INTERACTIVE));
            }
        };
        const escape = (event) => {
            if (event.key === 'Escape') setTimeout(() => close(true));
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape);
        stop = () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape);
            scope.dispose();
        };

        function showMenu(focusAt = 0) {
            viewAbort?.abort();
            viewAbort = null;
            const list = el('div', 'anomalous-ai-plus-menu');
            list.setAttribute('role', 'menu');
            const makeItem = (iconName, label, onSelect, arrow = false) => {
                const item = el('button', 'anomalous-ai-plus-item');
                item.type = 'button';
                item.setAttribute('role', 'menuitem');
                item.append(icon(iconName, 16), el('span', 'anomalous-ai-plus-item-label', label));
                if (arrow) item.append(icon('chevronRight', 14, 'anomalous-ai-plus-arrow'));
                item.onclick = onSelect;
                return item;
            };
            const items = [
                makeItem('models', t('aiPlusModel'), () => showPicker('models'), true),
                makeItem('blocks', t('aiPlusWay'), () => showPicker('ways'), true),
                makeItem('workflows', t('aiStartFrom_new'), () => {
                    close(false);
                    onBuild();
                }),
            ];
            list.append(...items);
            list.addEventListener('keydown', (event) => {
                const index = items.indexOf(document.activeElement);
                if (index < 0) return;
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    items[(index + 1) % items.length].focus();
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    items[(index + items.length - 1) % items.length].focus();
                } else if (event.key === 'Home') {
                    event.preventDefault();
                    items[0].focus();
                } else if (event.key === 'End') {
                    event.preventDefault();
                    items[items.length - 1].focus();
                }
            });
            panel.replaceChildren(list, el('div', 'anomalous-ai-plus-hint', t('aiPlusAtHint')));
            items[focusAt]?.focus();
        }

        function showPicker(kind) {
            viewAbort?.abort();
            viewAbort = new AbortController();
            const signal = viewAbort.signal;

            const back = el('button', 'anomalous-ai-plus-back');
            back.type = 'button';
            back.setAttribute('aria-label', `${t('aiPlusBack')}: ${t(kind === 'models' ? 'aiPlusModel' : 'aiPlusWay')}`);
            back.append(icon('chevronLeft', 15), el('span', '', t(kind === 'models' ? 'aiPlusModel' : 'aiPlusWay')));
            back.onclick = () => showMenu(kind === 'models' ? 0 : 1);

            const head = el('div', 'anomalous-ai-plus-head');
            head.append(back);

            const search = el('input', 'anomalous-ai-pics-search');
            search.type = 'search';
            search.placeholder = t(kind === 'models' ? 'aiStartModelSearch' : 'aiPlusWaySearch');

            const list = el('div', 'anomalous-ai-plus-list');
            list.setAttribute('role', 'listbox');
            panel.replaceChildren(head, search, list);

            const cached = kind === 'models' ? keptCatalog()?.filter(item => item.kind === 'models') || null : null;
            let raw = cached || [];
            let favIds = [];
            let loading = true;
            let loadError = '';
            let shown = [];
            let at = 0;

            function moveHighlight(next) {
                if (!shown.length || next === at) return;
                const rows = list.children;
                rows[at]?.classList.remove('is-on');
                rows[at]?.setAttribute('aria-selected', 'false');
                at = next;
                rows[at]?.classList.add('is-on');
                rows[at]?.setAttribute('aria-selected', 'true');
                rows[at]?.scrollIntoView({ block: 'nearest' });
            }

            function pick(index) {
                const item = shown[index];
                if (!item) return;
                close(false);
                onPick(item);
            }

            function drawRows() {
                shown = (kind === 'models'
                    ? orderModelsFavoritesFirst(raw, favIds, search.value)
                    : searchItems(raw, search.value)).slice(0, MAX_LIST);
                at = 0;
                if (loading && !raw.length) {
                    list.replaceChildren(el('div', 'anomalous-ai-mention-none', t('aiPlusLoading')));
                    return;
                }
                if (loadError) {
                    list.replaceChildren(el('div', 'anomalous-ai-mention-none', loadError));
                    return;
                }
                if (!shown.length) {
                    const emptyKey = kind === 'ways' && !search.value.trim() ? 'aiPlusWayNone' : 'aiMentionNone';
                    list.replaceChildren(el('div', 'anomalous-ai-mention-none', t(emptyKey)));
                    return;
                }
                list.replaceChildren(...shown.map((item, index) => {
                    const row = el('div', `anomalous-ai-mention-row${index === at ? ' is-on' : ''}`);
                    row.setAttribute('role', 'option');
                    row.setAttribute('aria-selected', String(index === at));
                    if (kind === 'ways') {
                        const text = el('div', 'anomalous-ai-plus-row-text');
                        text.append(el('div', 'anomalous-ai-plus-row-title', item.title));
                        if (item.about) text.append(el('div', 'anomalous-ai-plus-row-about', item.about));
                        row.append(lead(item), text);
                    } else {
                        row.append(
                            lead(item),
                            el('span', 'anomalous-ai-mention-name', item.title),
                            ...(item.favourite ? [icon('starOn', 13, 'anomalous-ai-plus-fav')] : []),
                            el('span', 'anomalous-ai-mention-kind', kindWords(item)),
                        );
                    }
                    row.onpointerdown = event => event.preventDefault();
                    row.onclick = () => pick(index);
                    row.onpointermove = () => moveHighlight(index);
                    return row;
                }));
                list.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
            }

            search.addEventListener('input', drawRows);
            search.addEventListener('keydown', (event) => {
                if (event.isComposing) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (shown.length) moveHighlight((at + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
                } else if (event.key === 'Enter' && shown.length) {
                    event.preventDefault();
                    pick(at);
                }
            });

            drawRows();
            search.focus();

            if (kind === 'models') {
                Promise.all([
                    cached || loadCatalog().then(items => items.filter(item => item.kind === 'models')), // the picker's read, shared
                    fetchFavorites(signal),
                ]).then(([models, favs]) => {
                    if (signal.aborted || scope.signal.aborted) return;
                    raw = models;
                    favIds = favs;
                    loading = false;
                    drawRows();
                }, (err) => {
                    if (err?.name === 'AbortError' || signal.aborted || scope.signal.aborted) return;
                    loading = false;
                    loadError = err?.message || String(err);
                    drawRows();
                });
            } else {
                fetchUsableWays(resolveLocale(), { signal }).then((ways) => {
                    if (signal.aborted || scope.signal.aborted) return;
                    raw = ways;
                    loading = false;
                    drawRows();
                }, (err) => {
                    if (err?.name === 'AbortError' || signal.aborted || scope.signal.aborted) return;
                    loading = false;
                    loadError = err?.message || String(err);
                    drawRows();
                });
            }
        }

        showMenu();
    }

    return {
        toggle: () => (panel ? close(true) : open()),
        close,
    };
}
