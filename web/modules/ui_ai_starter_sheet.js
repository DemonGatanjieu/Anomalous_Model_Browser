/**
 * The home page's AI starter cards (ui_ai_starters.js draws them) and the sheet each one opens: what is in
 * place before Start (an AI app that has come, a base model for the cards that draw from one), a field or
 * two with ready-made words to press, then what happens on Start, what stays as it is or what the AI does
 * not get, and what to mind. Start
 * makes a task with its switches set (ui_ai_handoff.js startTask: a new tab, privacy for the private card) and
 * shows the sentence for the AI. A starter is a prepared task and a sentence, never a workflow template. Each
 * card's tags name only what Anomalous makes sure of (`TAGS`), never what rests on the AI obeying.
 */

import { translate as t } from './locales.js';
import { aiWindow } from './ui_ai_connect.js';
import { startTask } from './ui_ai_handoff.js';
import { pictureGrid } from './ui_ai_gallery_pick.js';
import { icon } from './ui_ai_icons.js';

const NEW_TAB = { canvas: 'new' };
const DRAWS = ['try', 'say', 'private']; // start from a base model of the user's
const EXAMPLES = {
    say: ['aiStartSayEx1', 'aiStartSayEx2', 'aiStartSayEx3'],
    private: ['aiStartGistEx1', 'aiStartGistEx2', 'aiStartGistEx3'],
    picture: ['aiStartHowEx1', 'aiStartHowEx2', 'aiStartHowEx3'],
};
// lines: [kind, key] shown in the sheet; kinds are the sheet's labels (aiStartSheet_<kind>).
export const STARTERS = [
    { id: 'try', icon: 'sparkle', tags: ['newTab', 'small'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'preset', icon: 'workflows', tags: ['newTab', 'saved'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'say', icon: 'pencil', tags: ['newTab', 'download'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'picture', icon: 'image', tags: ['original', 'newTab'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'private', icon: 'lock', tags: ['sealed', 'newTab'], lines: [['start'], ['hidden'], ['out'], ['mind']] },
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

function select(options) {
    const box = el('select', 'anomalous-ai-start-select');
    for (const [value, label] of options) {
        const option = el('option', '', label);
        option.value = value;
        box.append(option);
    }
    return box;
}

/** What is in place before Start: an AI app that came (GET /anomalous/ai_starters `app`, `came`), a base model to draw from. */
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

/** The card's fields and how they become the task: {nodes, task() -> {title, about} | an error key}. */
function fieldsOf(card, data, owner, close) {
    if (card.id === 'try') return { nodes: [], task: () => ({ title: t('aiStartTryTask') }) };
    if (card.id === 'preset') {
        if (!data.workflows.length) {
            return { nodes: [el('p', 'anomalous-ai-start-empty', t('aiStartNoWorkflows')),
                button('anomalous-ai-link', t('aiStartToWorkflows'), () => { close(); owner.goTo?.('recipes'); })], task: null };
        }
        const workflow = select(data.workflows.map((item, index) => [String(index), item.name]));
        const preset = select([]);
        const fill = () => {
            const item = data.workflows[Number(workflow.value)];
            preset.replaceChildren(...[['', t('aiStartOwnSettings')], ...item.presets.map(name => [name, name])].map(([value, label]) => {
                const option = el('option', '', label);
                option.value = value;
                return option;
            }));
        };
        workflow.onchange = fill;
        fill();
        const change = textInput(t('aiStartChangeHint'));
        return {
            nodes: [field(t('aiStartWorkflow'), workflow), field(t('aiStartPreset'), preset), field(t('aiStartChange'), change)],
            task: () => {
                const item = data.workflows[Number(workflow.value)];
                const name = preset.value ? `${item.name} / ${preset.value}` : item.name;
                const what = change.value.trim();
                return { title: what ? t('aiStartPresetTaskChange', { name, change: what }) : t('aiStartPresetTask', { name }),
                    about: [{ type: 'workflow', name: item.name, label: item.name }] };
            },
        };
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
    const words = textInput(t(card.id === 'private' ? 'aiStartGistHint' : 'aiStartSayHint'));
    return {
        nodes: [field(t(card.id === 'private' ? 'aiStartGist' : 'aiStartSay'), words), examples(words, EXAMPLES[card.id])],
        task: () => (words.value.trim() ? { title: words.value.trim() } : 'aiStartNeedText'),
    };
}

/** Opens `card`'s sheet; `data` is GET /anomalous/ai_starters. */
export function openStarter(owner, card, data) {
    const body = el('div', 'anomalous-ai-start-sheet');
    let close = () => {};
    const fields = fieldsOf(card, data, owner, () => close());
    const lines = el('div', 'anomalous-ai-start-lines');
    for (const [kind] of card.lines) {
        const line = el('div', `anomalous-ai-start-line is-${kind}`);
        line.append(el('span', 'anomalous-ai-start-line-label', t(`aiStartSheet_${kind}`)), el('span', '', t(`aiStart_${card.id}_${kind}`)));
        lines.append(line);
    }
    const error = el('div', 'anomalous-ai-start-error');
    const actions = el('div', 'anomalous-ai-start-actions');
    actions.append(button('anomalous-ai-link', t('dialogCancel'), () => close()));
    if (fields.task) {
        actions.append(button('anomalous-ai-start-go', t('aiStartGo'), async () => {
            const task = fields.task();
            if (typeof task === 'string') {
                error.textContent = t(task);
                return;
            }
            close();
            await startTask(owner, task.title, task.about || [], null, card.id === 'private' ? { ...NEW_TAB, privacy: true } : NEW_TAB);
        }));
    }
    body.append(readiness(card, data), ...fields.nodes, lines, error, actions);
    body.addEventListener('input', () => { error.textContent = ''; });
    const shut = aiWindow(t(`aiStart_${card.id}_title`), body);
    close = () => { fields.stop?.(); shut(); };
    body.querySelector('input, select')?.focus();
}

