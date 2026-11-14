/**
 * The Gates window's part for the darkroom helper (api/ai_darkroom.py): a model running on this
 * computer that reads for a private task what the AI app may not. Folded until one is in use; it
 * says which, looks for servers on this computer (Ollama, LM Studio) and lets the user pick one of
 * their models, or drop it. GET/POST /anomalous/ai_darkroom.
 */

import { translate as t } from './locales.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(label, run) {
    const node = el('button', 'anomalous-ai-gates-option', label);
    node.type = 'button';
    node.onclick = run;
    return node;
}

async function post(body) {
    const response = await fetch('/anomalous/ai_darkroom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || response.statusText);
    return answer;
}

/** The part, drawn with what is kept once it is read. */
export function darkroomPart() {
    const box = el('details', 'anomalous-ai-darkroom');
    const state = el('div', 'anomalous-ai-darkroom-state');
    const form = el('div', 'anomalous-ai-darkroom-form');
    box.append(el('summary', '', t('aiDarkroom')), el('div', 'anomalous-ai-gates-tools', t('aiDarkroomWhy')), state, form);
    const say = (error) => { state.textContent = error.message; };
    const draw = (helper) => {
        if (helper) box.open = true;
        state.textContent = helper ? t('aiDarkroomOn', { model: helper.model, does: t(helper.vision ? 'aiDarkroomLooks' : 'aiDarkroomWrites') }) : t('aiDarkroomOff');
        form.replaceChildren(button(t('aiDarkroomDetect'), detect),
            ...(helper ? [button(t('aiDarkroomTurnOff'), () => post({ off: true }).then(answer => draw(answer.helper), say))] : []));
    };
    const detect = async () => {
        state.textContent = t('aiDarkroomLooking');
        let found = [];
        try {
            found = (await post({ detect: true })).found || [];
        } catch (error) {
            say(error);
            return;
        }
        if (!found.length) {
            state.textContent = t('aiDarkroomNone');
            return;
        }
        const pick = el('select', 'anomalous-ai-darkroom-pick');
        for (const server of found) {
            for (const model of server.models) {
                const option = el('option', '', `${model}  (${server.url})`);
                option.value = JSON.stringify([server.url, model]);
                pick.append(option);
            }
        }
        const vision = el('input');
        vision.type = 'checkbox';
        const sees = el('label', 'anomalous-ai-darkroom-vision');
        sees.append(vision, el('span', '', t('aiDarkroomVision')));
        state.textContent = t('aiDarkroomPick');
        form.replaceChildren(pick, sees, button(t('aiDarkroomUse'), () => {
            const [url, model] = JSON.parse(pick.value);
            post({ url, model, vision: vision.checked }).then(answer => draw(answer.helper), say);
        }));
    };
    fetch('/anomalous/ai_darkroom').then(response => response.json()).then(answer => draw(answer.helper), () => draw(null));
    return box;
}
