/**
 * What the user lets an AI see of one model, from the materials window (api/ai_model_choice.py): a
 * small lock on its card while AIs get a code word ([M1]) for its name, nothing while they get the name;
 * in its detail the switch "The AI may see its name", chosen once and kept for every task; and its
 * author's description in paragraphs, the ticked ones being all an AI reads of it where the rest stays
 * home (its name hidden, or the task private), under a line saying what the AI gets. A model nobody
 * chose for follows the task (a private task's "hide unchosen models" switch), which the switch says.
 * Ticking paragraphs of a model not on the message is told on Done (remindUnpicked). Before a message goes,
 * a hidden model it names in words the way to the AI leaves as they are is asked about (guardNames, ai_name_guard.js).
 */

import { keptCatalog, loadCatalog } from './ai_toolbox_data.js';
import { namedHidden, swapNames } from './ai_name_guard.js';
import { anomalousConfirm } from './ui_dialog.js';
import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';
import { typeLabel } from './ui_model_types.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const draws = new WeakMap(); // a drawn button or line → how it draws itself again

function node(tag, className, text) {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
}

/** Whether AIs get `item`'s name as a code word in `task`: the user's choice for it, else the task's. */
export function nameHidden(item, task) {
    if (item.ai_name === 'hidden') return true;
    if (item.ai_name === 'shown') return false;
    return Boolean(task?.private) && task?.privacy_models !== false;
}

async function post(item, change) {
    const response = await fetch('/anomalous/ai_model_choice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: item.id, filename: item.file, ...change }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    item.ai_name = data.name || '';
    return data;
}

/** Draws again every button and line of `item` inside `root` (the card and the detail show one model). */
function redraw(root, item) {
    for (const drawn of root?.querySelectorAll?.(`[data-model-choice="${CSS.escape(String(item.id))}"]`) || []) draws.get(drawn)?.();
}

/** The card's lock: shown only while AIs get a code word for the name (the detail's switch changes it). */
export function nameBadge(item, ctx) {
    const badge = node('span', 'anomalous-tb-name-badge');
    badge.dataset.modelChoice = item.id;
    badge.title = t('aiTbNameBadgeHint');
    const draw = () => {
        badge.hidden = !nameHidden(item, ctx.task?.());
        badge.replaceChildren(icon('lock', 11), node('span', '', t('aiTbNameBadge')));
    };
    draws.set(badge, draw);
    draw();
    return badge;
}

/** The detail's switch "The AI may see its name": on, the name; off, a code word; chosen for every task. */
export function nameSwitch(item, ctx) {
    const row = node('label', 'anomalous-ai-priv-switch anomalous-tb-name-switch');
    row.dataset.modelChoice = item.id;
    const words = node('span', 'anomalous-tb-name-switch-words');
    const input = node('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    const draw = () => {
        const hidden = nameHidden(item, ctx.task?.());
        input.checked = !hidden;
        row.classList.toggle('is-chosen', Boolean(item.ai_name));
        const sub = item.ai_name ? (hidden ? 'aiTbNameSwitchOff' : 'aiTbNameSwitchOn') : 'aiTbNameSwitchDefault';
        words.replaceChildren(node('span', 'anomalous-tb-name-switch-title', t('aiTbNameSwitch')), node('span', 'anomalous-tb-name-switch-sub', t(sub)));
    };
    draws.set(row, draw);
    input.onchange = async () => {
        const root = row.closest('.anomalous-tb') || document;
        input.disabled = true;
        try {
            await post(item, { ai_name: input.checked ? 'shown' : 'hidden' });
        } catch (error) {
            showWorkbenchToast(t('aiTbNameFailed', { error: error.message }));
        } finally {
            input.disabled = false;
            redraw(root, item);
        }
    };
    draw();
    row.append(words, input);
    return row;
}

/** The words of a message about to go to `task`'s AI: as they are, with hidden models' loose names swapped for
 * their file names (which become code words on the way), or null to go back and edit. */
export async function guardNames(text, task) {
    if (!text) return text;
    let items = keptCatalog();
    if (!items) items = await loadCatalog().catch(() => null);
    const found = namedHidden(text, items, item => nameHidden(item, task));
    if (!found.length) return text;
    const names = [...new Set(found.flatMap(each => each.names))].join(t('listSeparator'));
    const answer = await anomalousConfirm(t('aiNameGuardAsk', { names }), t('aiNameGuardTitle'),
        { okLabel: t('aiNameGuardSwap'), noLabel: t('aiNameGuardAsIs'), okClass: 'anomalous-btn-primary' });
    if (answer === null) return null;
    return answer ? swapNames(text, found) : text;
}

/** On Done: models whose paragraphs were ticked here (`ticked`, id → item) but are not on the message are
 * offered to be put on it. Resolves true to close the window, false to stay. */
export async function remindUnpicked(ticked, picked, add) {
    const left = [...ticked.values()].filter(item => !picked(item));
    if (!left.length) return true;
    const names = left.map(item => item.short || item.title).join(t('listSeparator'));
    const answer = await anomalousConfirm(t('aiTbAboutNotPicked', { names }), t('aiToolboxTitle'),
        { okLabel: t('aiTbAboutAddAndClose'), noLabel: t('aiTbAboutJustClose'), okClass: 'anomalous-btn-primary' });
    if (answer === null) return false;
    if (answer) left.forEach(add);
    return true;
}

/** "The AI gets: a code word · LoRA · Illustrious · 2 picked paragraphs", as things stand. */
function getsLine(item, ctx, picked) {
    const line = node('div', 'anomalous-tb-ai-gets');
    line.dataset.modelChoice = item.id;
    const draw = () => {
        const task = ctx.task?.();
        const hidden = nameHidden(item, task);
        const whole = !hidden && !task?.private;
        const parts = [t(hidden ? 'aiTbGetsCode' : 'aiTbGetsName'), typeLabel({ type: item.type }), item.base || item.metadata?.base_guess || ''];
        if (whole) parts.push(t('aiTbGetsAll'));
        else parts.push(picked().length ? t('aiTbGetsPicked', { count: picked().length }) : t('aiTbGetsNoAbout'));
        line.replaceChildren(icon(hidden ? 'lock' : 'eye', 12), node('span', '', t('aiTbGets', { what: parts.filter(Boolean).join(' · ') })));
    };
    draws.set(line, draw);
    draw();
    return line;
}

/** The detail's section: one line of what the AI gets, and folded under it the author's description to tick
 * paragraphs of (its summary says how many are ticked). */
export function aboutSection(item, ctx) {
    const box = node('section', 'anomalous-tb-section anomalous-tb-about');
    let picked = [];
    const line = getsLine(item, ctx, () => picked);
    const list = node('div', 'anomalous-tb-about-list', t('aiTbAboutLoading'));
    const fold = node('details', 'anomalous-tb-more');
    const summary = node('summary');
    const count = () => { summary.textContent = picked.length ? t('aiTbAboutTitlePicked', { count: picked.length }) : t('aiTbAboutTitle'); };
    count();
    fold.append(summary, list);
    box.append(line, fold);
    const save = async () => {
        const ticked = [...list.querySelectorAll('input:checked')].map(input => input.value);
        ctx.ticked?.(item);
        try {
            picked = (await post(item, { ai_about: ticked })).picked || [];
        } catch (error) {
            showWorkbenchToast(t('aiTbNameFailed', { error: error.message }));
        }
        draws.get(line)?.();
        count();
    };
    void fetch(`/anomalous/ai_model_choice?model_id=${encodeURIComponent(item.id)}`)
        .then(response => response.json().then(data => (response.ok ? data : Promise.reject(new Error(data.error || `HTTP ${response.status}`)))))
        .then((data) => {
            picked = data.picked || [];
            item.ai_name = data.name || '';
            count();
            redraw(box.closest('.anomalous-tb') || box, item);
            if (!data.paragraphs?.length) {
                list.textContent = t('aiTbAboutNone');
                return;
            }
            list.replaceChildren(node('p', 'anomalous-tb-text is-soft', t('aiTbAboutHint')), ...data.paragraphs.map((text) => {
                const row = node('label', 'anomalous-tb-about-row');
                const tick = node('input');
                tick.type = 'checkbox';
                tick.value = text;
                tick.checked = picked.includes(text);
                tick.onchange = save;
                row.append(tick, node('span', '', text));
                return row;
            }));
        })
        .catch((error) => { list.textContent = t('aiTbNameFailed', { error: error.message }); });
    return box;
}
