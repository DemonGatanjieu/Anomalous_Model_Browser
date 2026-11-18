/**
 * Parts of the home page's private starter sheet (ui_ai_starter_sheet.js). The LoRAs to use besides the
 * main model: picked in the model window (ui_ai_model_pick.js), several at once, from the materials catalog
 * (ai_toolbox_data.js), each a chip with ×; the first message names them by file name, which the task's privacy hands the AI as
 * tokens (api/ai_sealed_models.py), so a LoRA the user lets the AI see by name is not offered. And what
 * happens to the prompt: the privacy picture (ui_ai_art.js) and one line in place of lines of text.
 */

import { loadCatalog } from './ai_toolbox_data.js';
import { translate as t } from './locales.js';
import { art } from './ui_ai_art.js';
import { icon } from './ui_ai_icons.js';
import { openModelPicker } from './ui_ai_model_pick.js';

const MAX_LORAS = 6;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The catalog's LoRAs as the model window lists them; none the user lets the AI see by name. */
function loraChoices(items) {
    return (items || [])
        .filter(item => item.kind === 'models' && item.type === 'loras' && item.ai_name !== 'shown')
        .map(item => ({ model_id: item.id, name: item.name, file: item.file, family: item.base || '', favourite: false, cover: item.cover, type: 'loras' }));
}

/** {node, read() -> [file names]}: the optional LoRAs; stays away while the library has none. */
export function loraPicker() {
    let chosen = [];
    let all = [];
    const node = el('div', 'anomalous-ai-start-field anomalous-ai-start-loras');
    node.hidden = true;
    const label = el('span', 'anomalous-ai-start-label', t('aiStartLoras'));
    label.prepend(icon('lock', 13));
    const chips = el('div', 'anomalous-ai-start-lora-chips');
    const add = el('button', 'anomalous-ai-start-pick');
    add.type = 'button';
    add.append(icon('models', 14), el('span', '', t('aiStartLorasAdd')));
    add.onclick = () => openModelPicker({
        title: t('aiPickLorasTitle'),
        models: all,
        picked: chosen.map(item => item.model_id),
        max: MAX_LORAS,
        hint: t('aiPickLorasHint', { max: MAX_LORAS }),
        from: add,
        onDone: (ids) => {
            chosen = ids.map(id => all.find(item => item.model_id === id));
            draw();
        },
    });

    function draw() {
        chips.replaceChildren(...chosen.map((item) => {
            const chip = el('span', 'anomalous-ai-start-lora-chip');
            const drop = el('button', 'anomalous-ai-start-lora-drop');
            drop.type = 'button';
            drop.setAttribute('aria-label', t('aiStartLorasDrop', { name: item.name }));
            drop.append(icon('close', 12));
            drop.onclick = () => {
                chosen.splice(chosen.indexOf(item), 1);
                draw();
            };
            chip.append(el('span', 'anomalous-ai-start-lora-name', item.name), drop);
            return chip;
        }));
        chips.hidden = !chosen.length;
    }

    loadCatalog().then((items) => {
        all = loraChoices(items);
        node.hidden = !all.length;
        draw();
    }).catch(() => { /* the sheet works without it */ });
    node.append(label, chips, add);
    return { node, read: () => chosen.map(item => item.file) };
}

/** What happens to the prompt: the picture (words → a locked code word → the AI) and one line. */
export function sealFlow() {
    const box = el('div', 'anomalous-ai-seal-flow');
    box.append(art('codes', 'anomalous-ai-seal-flow-art'), el('span', '', t('aiSealFlowCaption')));
    return box;
}
