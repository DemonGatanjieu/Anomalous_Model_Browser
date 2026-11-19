/**
 * "Take a saved prompt" beside a prompt the user writes for a private task (the private card's sealed prompt,
 * ui_ai_starter_sheet.js; the prompt box an AI asks with, ui_ai_prompt_box.js): a list under the button, with a
 * search, of the saved prompts and those inside combos and workflows (the materials picker's catalogue,
 * ai_toolbox_data.js), each with where it comes from and its first line. A press puts its text in the field
 * (after what is there) and its negative in the negative field while that is empty. Nothing leaves the page: the
 * AI gets the field as a token, as it would typed text.
 */

import { translate as t } from './locales.js';
import { keptCatalog, loadCatalog, searchItems } from './ai_toolbox_data.js';
import { icon } from './ui_ai_icons.js';

const SHOWN = 60;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** `text` after what `field` holds (a comma between), as far as the field takes. */
function put(field, text) {
    const value = String(text || '').trim();
    if (!field || !value) return;
    const now = field.value.trim();
    const joined = now ? `${now}${/[,，]$/.test(now) ? ' ' : ', '}${value}` : value;
    field.value = field.maxLength > 0 ? joined.slice(0, field.maxLength) : joined;
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Builds `{ button, panel }`: the button goes by the field's name, the panel (the list, shown while open) under it.
 * `target()` gives the field a pick fills (it may make one), `negative()` the negative field or null.
 */
export function promptFetch({ target, negative = () => null }) {
    const button = el('button', 'anomalous-ai-prompt-fetch');
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.append(icon('prompts', 13), el('span', '', t('aiPromptFetch')));
    const panel = el('div', 'anomalous-ai-prompt-fetch-panel');
    panel.hidden = true;
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiPromptFetchSearch');
    search.setAttribute('aria-label', t('aiPromptFetchSearch'));
    const list = el('div', 'anomalous-ai-prompt-fetch-list');
    list.setAttribute('role', 'listbox');
    panel.append(search, list);

    const prompts = () => (keptCatalog() || []).filter(item => item.kind === 'prompts');

    function draw() {
        const found = searchItems(prompts(), search.value);
        if (!keptCatalog()) {
            list.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('aiPromptFetchLoading')));
            return;
        }
        if (!found.length) {
            list.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t(prompts().length ? 'recipeNoMatches' : 'aiPromptFetchNone')));
            return;
        }
        list.replaceChildren(...found.slice(0, SHOWN).map((item) => {
            const row = el('button', 'anomalous-ai-prompt-fetch-row');
            row.type = 'button';
            row.setAttribute('role', 'option');
            const head = el('span', 'anomalous-ai-prompt-fetch-head');
            head.append(el('span', 'anomalous-ai-prompt-fetch-name', item.title || item.name || item.id),
                el('span', 'anomalous-ai-prompt-fetch-from', t(`aiTbPromptFrom_${item.source || 'saved'}`)));
            const first = String(item.positive || item.negative || '').split('\n')[0];
            row.append(head, el('span', 'anomalous-ai-prompt-fetch-text', first));
            row.title = item.positive || item.negative || '';
            row.onclick = () => {
                const field = target();
                put(field, item.positive);
                if (item.negative && !negative()?.value.trim()) put(negative(), item.negative); // once, not again with each prompt
                toggle(false);
                field?.focus();
            };
            return row;
        }));
    }

    function toggle(open = panel.hidden) {
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        button.classList.toggle('is-on', open);
        if (!open) return;
        draw();
        if (!keptCatalog()) loadCatalog().then(draw, () => list.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('materialLoadError'))));
        search.focus();
    }

    button.onclick = () => toggle();
    search.oninput = draw;
    panel.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (event.key === 'Escape') {
            toggle(false);
            button.focus();
        }
    });
    return { button, panel };
}
