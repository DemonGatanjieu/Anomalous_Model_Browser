/**
 * Which tools the AI app is offered (api/mcp_tool_sets.py), picked in the Connect an AI guide above the
 * address: every tool (the address as it is; a task handed over in Anomalous needs the workbench tools),
 * Anomalous's short set for drawing in the AI app's own chat (?tools=core), or the user's own pick
 * (?tools=mine, a checklist by stage of the work). The guide's address and the lines carrying it follow
 * the choice; which one was picked last is remembered in this browser only. GET/POST /anomalous/ai_tool_sets.
 */

import { translate as t } from './locales.js';

const KEY = 'anomalous-ai-tool-set';
const SETS = ['all', 'core', 'mine'];
const STAGES = [['run', 'Run'], ['canvas', 'Canvas'], ['model', 'Model'], ['prompt', 'Prompt'], ['combo', 'Combo'],
    ['picture', 'Picture'], ['library', 'Library'], ['voice', 'Voice'], [null, 'Task']];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function remembered() {
    try {
        const value = localStorage.getItem(KEY);
        return SETS.includes(value) ? value : 'all';
    } catch {
        return 'all';
    }
}

function remember(value) {
    try {
        localStorage.setItem(KEY, value);
    } catch {
        // only a convenience: the guide starts on every tool next time
    }
}

async function request(body) {
    const response = await fetch('/anomalous/ai_tool_sets', body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || response.statusText);
    return answer;
}

/** How much of the whole list `names` is, in percent (the card's own tools come along with a tool showing it). */
function share(info, names) {
    const picked = new Set(names);
    let size = info.tools.reduce((sum, tool) => sum + (picked.has(tool.name) ? tool.size : 0), 0);
    if (info.card.tools.some(name => picked.has(name))) size += info.card.size;
    return Math.round((size * 100) / info.all_size);
}

const label = (name) => {
    const text = t(`aiToolSetTool_${name}`);
    return text === `aiToolSetTool_${name}` ? name : text;
};

/** The checklist for the user's own pick: `start` ticked; save(names) keeps it, close() folds it away. */
function checklist(info, start, save, close) {
    const box = el('div', 'anomalous-ai-toolset-editor');
    const count = el('div', 'anomalous-ai-toolset-count');
    const warn = el('div', 'anomalous-ai-toolset-warn');
    const boxes = new Map();
    const picked = () => info.tools.filter(tool => boxes.get(tool.name).checked).map(tool => tool.name);
    const update = () => {
        const names = picked();
        count.textContent = t('aiToolSetCount', { count: names.length, share: names.length ? share(info, names) : 0 });
        warn.hidden = info.needed.every(name => names.includes(name));
        saveButton.disabled = !names.length;
    };
    const tick = (names) => {
        for (const [name, input] of boxes) input.checked = names.includes(name);
        update();
    };
    const groups = el('div', 'anomalous-ai-toolset-groups');
    for (const [stage, word] of STAGES) {
        const tools = info.tools.filter(tool => tool.stage === stage);
        if (!tools.length) continue;
        const group = el('div', 'anomalous-ai-toolset-group');
        group.append(el('div', 'anomalous-ai-toolset-stage', t(`aiToolSetStage${word}`)));
        for (const tool of tools) {
            const row = el('label', 'anomalous-ai-toolset-tool');
            const input = el('input');
            input.type = 'checkbox';
            input.onchange = update;
            boxes.set(tool.name, input);
            row.title = tool.name;
            row.append(input, el('span', 'anomalous-ai-toolset-label', label(tool.name)), el('code', 'anomalous-ai-toolset-name', tool.name));
            group.append(row);
        }
        groups.append(group);
    }
    warn.textContent = t('aiToolSetNoWorkbench', { tools: info.needed.join(', ') });
    const saveButton = button('anomalous-ai-toolset-save', t('aiToolSetSave'), async () => {
        saveButton.disabled = true;
        try {
            await save(picked());
        } catch (error) {
            count.textContent = error.message;
            saveButton.disabled = false;
        }
    });
    const actions = el('div', 'anomalous-ai-toolset-actions');
    actions.append(saveButton, button('anomalous-ai-gates-option', t('aiToolSetFromCore'), () => tick(info.core)),
        button('anomalous-ai-gates-option', t('aiToolSetEvery'), () => tick(info.tools.map(tool => tool.name))),
        button('anomalous-ai-gates-option', t('aiToolSetFold'), close));
    box.append(count, warn, groups, actions);
    tick(start);
    return box;
}

/** The picker. onChange('all' | 'core' | 'mine') whenever the address should change, also once it has loaded. */
export function toolSetPicker(onChange) {
    const box = el('div', 'anomalous-ai-toolset');
    const choices = el('div', 'anomalous-ai-gates-choice');
    const note = el('div', 'anomalous-ai-connect-note');
    const editor = el('div');
    box.append(choices, note, editor);
    let info = null;
    let value = remembered();
    const effective = () => (value === 'mine' && !info.mine.length ? 'all' : value);
    const draw = () => {
        const counts = { all: info.tools.length, core: info.core.length, mine: info.mine.length };
        choices.replaceChildren(...SETS.map((key) => {
            const option = button(`anomalous-ai-gates-option${key === value ? ' is-on' : ''}`, t(`aiToolSet_${key}`, { count: counts[key] }), () => pick(key));
            option.setAttribute('aria-pressed', String(key === value));
            return option;
        }));
        const words = value === 'all' ? t('aiToolSetAllNote')
            : value === 'core' ? t('aiToolSetCoreNote', { share: share(info, info.core) })
                : info.mine.length ? t('aiToolSetMineNote', { share: share(info, info.mine) }) : t('aiToolSetMineEmpty');
        note.replaceChildren(words);
        if (value === 'mine' && editor.hidden !== false) note.append(' ', button('anomalous-ai-toolset-edit', t('aiToolSetEdit'), openEditor));
    };
    const closeEditor = () => {
        editor.replaceChildren();
        editor.hidden = true;
        draw();
    };
    const openEditor = () => {
        editor.hidden = false;
        editor.replaceChildren(checklist(info, info.mine.length ? info.mine : info.core, async (names) => {
            info = await request({ mine: names });
            closeEditor();
            onChange(effective());
        }, closeEditor));
        draw();
    };
    const pick = (key) => {
        value = key;
        remember(key);
        if (key === 'mine' && !info.mine.length) openEditor();
        else closeEditor();
        onChange(effective());
    };
    editor.hidden = true;
    box.hidden = true;
    request().then((answer) => {
        info = answer;
        box.hidden = false;
        draw();
        if (effective() !== 'all') onChange(effective());
    }, () => { value = 'all'; });
    return box;
}
