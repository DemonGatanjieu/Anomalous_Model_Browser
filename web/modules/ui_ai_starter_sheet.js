/**
 * The home page's AI starter cards (ui_ai_starters.js draws them) and the sheet each one opens: what is in
 * place before Start (an AI app that has come, a base model for the cards that draw from one), a field or
 * two with ready-made words to press, then what happens on Start, what stays as it is or what the AI does
 * not get, and what to mind. Start
 * makes a task with its switches set (ui_ai_handoff.js startTask: a new tab, privacy for the private card) and
 * shows the sentence for the AI. A starter is a prepared task and a sentence, never a workflow template. Each
 * card's tags name only what Anomalous makes sure of (`TAGS`), never what rests on the AI obeying. The
 * private card takes the prompt itself in a field the AI gets as a token (ai_hide_mark.js marked). "Run my
 * preset" has its own fields (ui_ai_preset_sheet.js) and, with nothing to change, runs with no AI. The
 * private card puts that prompt first, then where to start, optional LoRAs and, second and said so, the line
 * that goes to the AI as it is; a drawing (ui_ai_private_sheet.js) says what happens to the prompt.
 */

import { marked } from './ai_hide_mark.js';
import { composeFirstNote, startFactSentence } from './ai_start_from.js';
import { translate as t } from './locales.js';
import { aiWindow } from './ui_ai_connect.js';
import { startTask } from './ui_ai_handoff.js';
import { pictureGrid } from './ui_ai_gallery_pick.js';
import { icon } from './ui_ai_icons.js';
import { presetFields } from './ui_ai_preset_sheet.js';
import { loraPicker, sealFlow } from './ui_ai_private_sheet.js';
import { applyTaskRoute, startFromSection } from './ui_ai_start_from.js';

const NEW_TAB = { canvas: 'new' };
const MAX_SEALED = 1500; // the prompt the private card hands on, inside a message to the AI
const DRAWS = ['try', 'say', 'private']; // start from a base model of the user's
const EXAMPLES = {
    say: ['aiStartSayEx1', 'aiStartSayEx2', 'aiStartSayEx3'],
    private: ['aiStartGistEx1', 'aiStartGistEx2', 'aiStartGistEx3'],
    picture: ['aiStartHowEx1', 'aiStartHowEx2', 'aiStartHowEx3'],
};
// lines: [kind, key] shown in the sheet; kinds are the sheet's labels (aiStartSheet_<kind>).
export const STARTERS = [
    { id: 'try', icon: 'sparkle', tags: ['newTab', 'small'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'preset', icon: 'workflows', tags: ['newTab', 'saved'], lines: [['kept']] },
    { id: 'say', icon: 'pencil', tags: ['newTab', 'download'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'picture', icon: 'image', tags: ['original', 'newTab'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'private', icon: 'lock', tags: ['sealed', 'newTab'], lines: [['out']] },
    { id: 'canvas', icon: 'nodes', tags: ['undo'] },
];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** The tags a card shows: "asks before downloads" only while the gates do. */
export function cardTags(card, data) {
    return card.tags.filter(tag => tag !== 'download' || data.download_asks);
}

function field(label, control) {
    const box = el('label', 'anomalous-ai-start-field');
    box.append(el('span', 'anomalous-ai-start-label', label), control);
    return box;
}

function textInput(placeholder) {
    const input = el('input', 'anomalous-ai-start-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = 300;
    return input;
}

/** What is in place before Start, for a card that hands a task to an AI: an AI app that came (GET /anomalous/ai_starters `app`, `came`), a base model to draw from. */
function readiness(card, data) {
    const box = el('div', 'anomalous-ai-start-ready');
    const line = (ok, text) => {
        const node = el('div', `anomalous-ai-start-ready-line${ok ? ' is-ok' : ''}`);
        node.append(icon(ok ? 'check' : 'alert', 13), el('span', '', text));
        box.append(node);
    };
    const came = Boolean(data.app || data.came);
    line(came, came ? t(data.app ? 'aiStartReadyApp' : 'aiStartReadyCame', { client: data.app?.client }) : t('aiStartReadyNoApp'));
    if (DRAWS.includes(card.id)) line(data.models > 0, data.models > 0 ? t('aiStartReadyModels', { count: data.models }) : t('aiStartReadyNoModels'));
    return box;
}

/** Ready-made words under `input`; a press writes them in, to send or to change. */
function examples(input, keys) {
    const row = el('div', 'anomalous-ai-start-examples');
    for (const key of keys) {
        row.append(button('anomalous-ai-start-example', t(key), () => {
            input.value = t(key);
            input.dispatchEvent(new Event('input', { bubbles: true })); // the line that said it was missing goes
            input.focus();
        }));
    }
    return row;
}

const postRoute = picked => taskId => applyTaskRoute(taskId, picked);

/** The card's fields and how they become the task: {nodes, task() -> {title, about, note, beforeNote} | error}. */
function fieldsOf(card, data, owner, close) {
    if (card.id === 'try') return { nodes: [], task: () => ({ title: t('aiStartTryTask') }) };
    if (card.id === 'preset') { // nothing saved to run yet
        return { nodes: [el('p', 'anomalous-ai-start-empty', t('aiStartNoWorkflows')),
            button('anomalous-ai-link', t('aiStartToWorkflows'), () => { close(); owner.goTo?.('recipes'); })], task: null };
    }
    if (card.id === 'picture') {
        let chosen = null;
        const grid = pictureGrid({
            picked: id => chosen?.id === id,
            pick: (item) => { chosen = chosen?.id === item.id ? null : item; },
        });
        const how = textInput(t('aiStartHowHint'));
        const pictures = el('div', 'anomalous-ai-start-pictures');
        pictures.append(grid.search, grid.grid);
        return {
            nodes: [field(t('aiStartPicture'), pictures), field(t('aiStartHow'), how), examples(how, EXAMPLES.picture)],
            stop: () => grid.stop(),
            task: () => {
                if (!chosen) return 'aiStartNeedPicture';
                if (!how.value.trim()) return 'aiStartNeedText';
                return { title: how.value.trim(), about: [{ type: 'image', image: chosen.id, label: chosen.title }] };
            },
        };
    }
    if (card.id === 'private') {
        const from = startFromSection({ data });
        const loras = loraPicker();
        const gist = textInput(t('aiStartGistHint'));
        const prompt = el('textarea', 'anomalous-ai-start-input');
        prompt.placeholder = t('aiStartSealedHint');
        prompt.maxLength = MAX_SEALED;
        prompt.rows = 4;
        const promptField = field(t('aiStartSealed'), prompt);
        promptField.classList.add('is-sealed');
        promptField.querySelector('.anomalous-ai-start-label')?.prepend(icon('lock', 13));
        const gistField = field(t('aiStartGist'), gist);
        gistField.classList.add('is-plain'); // goes to the AI as it is: second, and quieter
        return {
            nodes: [promptField, from.node, loras.node, gistField, examples(gist, EXAMPLES.private), sealFlow()],
            stop: () => { from.stop(); loras.stop(); },
            task: () => {
                const picked = from.read();
                if (picked.errorKey || picked.errorText) return picked;
                const sealed = prompt.value.trim();
                if (!gist.value.trim() && !sealed) return 'aiStartNeedGist';
                from.save();
                const fact = startFactSentence({ ...picked, secret: true }, t, marked);
                const files = loras.read(); // by file name: the task's privacy makes each a token
                const cardNote = [sealed ? t('aiPresetSayPrompt', { prompt: marked(sealed) }) : '',
                    files.length ? t('aiStartUseLoras', { loras: files.join(t('listSeparator')) }) : ''].filter(Boolean).join(' ');
                return {
                    title: gist.value.trim() || t('aiStartPrivateTask'),
                    note: composeFirstNote(fact, cardNote),
                    beforeNote: picked.mode === 'new' ? postRoute(picked) : null,
                };
            },
        };
    }
    const from = startFromSection({ data });
    const words = textInput(t('aiStartSayHint'));
    return {
        nodes: [from.node, field(t('aiStartSay'), words), examples(words, EXAMPLES.say)],
        stop: () => from.stop(),
        task: () => {
            const picked = from.read();
            if (picked.errorKey || picked.errorText) return picked;
            if (!words.value.trim()) return 'aiStartNeedText';
            from.save();
            const fact = startFactSentence({ ...picked, secret: false }, t);
            return {
                title: words.value.trim(),
                about: picked.mode === 'card' && picked.cardName ? [{ type: 'workflow', name: picked.cardName }] : [],
                note: composeFirstNote(fact, ''),
                beforeNote: picked.mode === 'new' ? postRoute(picked) : null,
            };
        },
    };
}

/** Opens `card`'s sheet; `data` is GET /anomalous/ai_starters. */
export function openStarter(owner, card, data) {
    const body = el('div', 'anomalous-ai-start-sheet');
    let close = () => {};
    const error = el('div', 'anomalous-ai-start-error');
    const go = button('anomalous-ai-start-go', t('aiStartGo'), async () => {
        if (fields.start) {
            go.disabled = true; // a second press while it starts would run it twice
            error.textContent = await fields.start();
            go.disabled = false;
            return;
        }
        const task = fields.task();
        if (typeof task === 'string') {
            error.textContent = t(task);
            return;
        }
        if (task?.errorKey || task?.errorText) {
            error.textContent = task.errorKey ? t(task.errorKey) : task.errorText;
            return;
        }
        close();
        await startTask(owner, task.title, task.about || [], null,
            card.id === 'private' ? { ...NEW_TAB, privacy: true } : NEW_TAB,
            task.note || '', task.beforeNote || null);
    });
    const fields = card.id === 'preset' && data.workflows.length ? presetFields({ data, owner, close: () => close(), go })
        : fieldsOf(card, data, owner, () => close());
    const lines = el('div', 'anomalous-ai-start-lines');
    for (const [kind] of card.lines) {
        const line = el('div', `anomalous-ai-start-line is-${kind}`);
        line.append(el('span', 'anomalous-ai-start-line-label', t(`aiStartSheet_${kind}`)), el('span', '', t(`aiStart_${card.id}_${kind}`)));
        lines.append(line);
    }
    const actions = el('div', 'anomalous-ai-start-actions');
    actions.append(button('anomalous-ai-link', t('dialogCancel'), () => close()));
    if (fields.task || fields.start) actions.append(go);
    // The fields scroll; what is missing and the buttons stay in sight at the foot of the window.
    const scroll = el('div', 'anomalous-ai-start-scroll');
    scroll.append(...(fields.start ? [] : [readiness(card, data)]), ...fields.nodes, lines);
    body.append(scroll, error, actions);
    body.addEventListener('input', () => { error.textContent = ''; });
    body.addEventListener('change', () => { error.textContent = ''; });
    body.addEventListener('click', (event) => {
        if (event.target.closest('button') && event.target.closest('button') !== go) error.textContent = '';
    });
    close = aiWindow(t(`aiStart_${card.id}_title`), body, () => fields.stop?.());
    body.querySelector('textarea, input:not([hidden]), select')?.focus();
}

