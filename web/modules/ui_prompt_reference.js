/**
 * Prompt Studio's reference column: a clicked card opens here, between the cards and the prompt
 * boxes, as its tags (with their meanings when a language is picked), so single tags can be
 * taken from it: a click puts that tag into the box the card goes into (ui_prompt_target.js),
 * "Add all" the whole card. Tags the box has already are ticked. Read only: the card itself is
 * never changed here. In the drawer it widens the drawer by the column while it is open; where
 * three columns do not fit it takes the cards' place, and "‹ Cards" goes back (the stylesheet).
 */

import { translate as t } from './locales.js';
import { fetchGlosses, glossOf } from './prompt_gloss.js';
import { promptTagsOf, tagKey, tagWeight } from './prompt_tags.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const POLL_MS = 400;
const EXTRA_WIDTH = 280; // the drawer grows by this while the column is open
const HINT_KEY = 'anomalous_prompt_reference_hint';
const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative' };

function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
}

function button(className, label, title, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.onclick = onClick;
    return node;
}

/** Says once, the first time a card opens here, that a click no longer adds the whole card. */
function hintOnce() {
    try {
        if (localStorage.getItem(HINT_KEY)) return;
        localStorage.setItem(HINT_KEY, '1');
    } catch { /* no storage here: say it each visit */ }
    showWorkbenchToast(t('promptStudioRefHint'));
}

/**
 * Fills `grid` (between the cards and the boxes). `target` is the prompt side ({ addCard(card,
 * text), valueFor(card) }); `prefs` the studio's { glossLang }. Returns { open(card), close(), render() }.
 */
export function createPromptReference(grid, { drawer, scope, prefs, target }) {
    const panel = el('section', 'anomalous-ps-ref');
    panel.hidden = true;
    const head = el('header', 'anomalous-ps-target-head');
    const label = el('div', 'anomalous-ps-target-label');
    const title = el('span', 'anomalous-ps-target-name');
    const closeButton = button('anomalous-ps-target-x', '✕', t('promptStudioRefClose'), () => close());
    closeButton.setAttribute('aria-label', t('promptStudioRefClose'));
    label.append(title, closeButton);
    const addAll = button('anomalous-ps-mini', t('promptStudioRefAddAll'), t('promptStudioRefAddAllHint'), () => {
        if (card) void target.addCard(card).then(render);
    });
    const back = button('anomalous-ps-mini anomalous-ps-ref-back', t('promptStudioRefBack'), t('promptStudioRefClose'), () => close());
    head.append(back, label, addAll);
    const role = el('span', 'anomalous-ps-role');
    const note = el('p', 'anomalous-ps-target-note', t('promptStudioRefNote'));
    const tagsEl = el('div', 'anomalous-ps-tags');
    panel.append(head, role, note, tagsEl);
    grid.insertBefore(panel, grid.children[1] || null); // right after the cards

    let card = null;
    let seen = null; // the box text the ticks were drawn from
    let taken = new Set(); // tags taken from this card here (a translated one reads differently in the box)
    let widened = null; // { from, to } drawer widths while the column is open
    let glossTimer = null;
    let glossFailed = '';
    const timer = setInterval(() => {
        if (card && target.valueFor(card) !== seen) render();
    }, POLL_MS);
    scope.onDispose(() => { clearInterval(timer); clearTimeout(glossTimer); });

    function widen(open) {
        if (!drawer.classList.contains('anomalous-prompt-studio-drawer')) return;
        if (open && !widened) {
            const from = drawer.getBoundingClientRect().width;
            const to = Math.round(Math.min(window.innerWidth * 0.85, from + EXTRA_WIDTH));
            drawer.style.width = `${to}px`;
            widened = { from, to };
        } else if (!open && widened) {
            // Dragged wider or narrower meanwhile: that width is the user's now.
            if (Math.round(drawer.getBoundingClientRect().width) === widened.to) drawer.style.width = `${widened.from}px`;
            widened = null;
        }
    }

    function glossText(tag) {
        const meaning = glossOf(tag, prefs.glossLang);
        return meaning === undefined ? (glossFailed === prefs.glossLang ? '' : '…') : meaning;
    }

    function wantGlosses(tags) {
        clearTimeout(glossTimer);
        const lang = prefs.glossLang;
        if (!lang || glossFailed === lang || tags.every(tag => glossOf(tag, lang) !== undefined)) return;
        glossTimer = setTimeout(async () => {
            const ok = await fetchGlosses(tags, lang, scope.signal);
            if (scope.signal.aborted || !card) return;
            if (!ok) glossFailed = lang;
            render();
        }, 250);
    }

    function chipFor(tag, have) {
        const { core, weight } = tagWeight(tag);
        const there = have.has(tagKey(tag)) || taken.has(tagKey(tag));
        const chip = el('button', `anomalous-ps-tag is-ref${there ? ' is-there' : ''}`);
        chip.type = 'button';
        chip.title = t(there ? 'promptStudioRefThere' : 'promptStudioRefTake');
        const main = el('span', 'anomalous-ps-tag-main');
        if (there) main.append(el('span', 'anomalous-ps-ref-tick', '✓'));
        main.append(el('span', 'anomalous-ps-tag-text', core));
        if (weight !== 1) main.append(el('span', 'anomalous-ps-tag-weight', String(weight)));
        chip.append(main);
        if (prefs.glossLang) chip.append(el('span', 'anomalous-ps-tag-gloss', glossText(tag)));
        chip.onclick = async () => {
            if (there) return;
            chip.disabled = true;
            if (await target.addCard(card, tag)) taken.add(tagKey(tag));
            render();
        };
        return chip;
    }

    /** Draws the open card's tags, ticking those its box has. */
    function render() {
        if (!card) return;
        seen = target.valueFor(card);
        const have = new Set(promptTagsOf(seen ?? '').map(tagKey));
        const tags = promptTagsOf(card.content);
        title.textContent = t('promptStudioRefTitle', { name: card.title });
        const cardRole = card.role === 'negative' ? 'negative' : 'positive';
        role.className = `anomalous-ps-role is-${cardRole}`;
        role.textContent = t(ROLE_KEYS[cardRole]);
        tagsEl.replaceChildren(...tags.map(tag => chipFor(tag, have)));
        wantGlosses(tags);
    }

    function open(next) {
        hintOnce();
        if (card?.id !== next.id) taken = new Set();
        card = next;
        panel.hidden = false;
        grid.classList.add('has-ref');
        widen(true);
        render();
    }

    function close() {
        card = null;
        panel.hidden = true;
        grid.classList.remove('has-ref');
        widen(false);
    }

    return { open, close, render };
}
