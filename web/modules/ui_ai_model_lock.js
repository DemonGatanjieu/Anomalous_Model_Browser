/**
 * What the user lets an AI see of one model, from the materials window (api/ai_model_choice.py): a
 * button on its card and in its detail saying whether AIs get its name or a code word ([M1]), chosen
 * once and kept for every task; and in the detail its author's description in paragraphs, the ticked
 * ones being all an AI reads of it where the rest stays home (its name hidden, or the task private),
 * under a line saying what the AI gets. A model nobody chose for follows the task (a private task's
 * "hide unchosen models" switch); its button looks lighter and says so.
 */

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

/** The card's and the detail's button: the name or a code word; a press chooses the other, for every task. */
export function nameButton(item, ctx) {
    const button = node('button', 'anomalous-tb-name-lock');
    button.type = 'button';
    button.dataset.modelChoice = item.id;
    const draw = () => {
        const hidden = nameHidden(item, ctx.task?.());
        button.classList.toggle('is-hidden', hidden);
        button.classList.toggle('is-chosen', item.ai_name === 'hidden' || item.ai_name === 'shown');
        button.replaceChildren(icon(hidden ? 'lock' : 'eye', 13), node('span', '', t(hidden ? 'aiTbNameHidden' : 'aiTbNameShown')));
        button.title = t(item.ai_name ? 'aiTbNameChosenHint' : 'aiTbNameDefaultHint');
    };
    draws.set(button, draw);
    for (const type of ['pointerdown', 'keydown']) button.addEventListener(type, event => event.stopPropagation());
    button.onclick = async (event) => {
        event.stopPropagation();
        const root = button.closest('.anomalous-tb') || document;
        button.disabled = true;
        try {
            await post(item, { name: nameHidden(item, ctx.task?.()) ? 'shown' : 'hidden' });
        } catch (error) {
            showWorkbenchToast(t('aiTbNameFailed', { error: error.message }));
        } finally {
            button.disabled = false;
            redraw(root, item);
        }
    };
    draw();
    return button;
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

/** The detail's section: what the AI gets, and the author's description to tick paragraphs of. */
export function aboutSection(item, ctx) {
    const box = node('section', 'anomalous-tb-section anomalous-tb-about');
    let picked = [];
    const line = getsLine(item, ctx, () => picked);
    const list = node('div', 'anomalous-tb-about-list', t('aiTbAboutLoading'));
    box.append(node('h4', 'anomalous-tb-section-title', t('aiTbAboutTitle')), line, list);
    const save = async () => {
        const ticked = [...list.querySelectorAll('input:checked')].map(input => input.value);
        try {
            picked = (await post(item, { about: ticked })).picked || [];
        } catch (error) {
            showWorkbenchToast(t('aiTbNameFailed', { error: error.message }));
        }
        draws.get(line)?.();
    };
    void fetch(`/anomalous/ai_model_choice?model_id=${encodeURIComponent(item.id)}`)
        .then(response => response.json().then(data => (response.ok ? data : Promise.reject(new Error(data.error || `HTTP ${response.status}`)))))
        .then((data) => {
            picked = data.picked || [];
            item.ai_name = data.name || '';
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
