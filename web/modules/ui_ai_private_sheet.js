/**
 * Parts of the home page's private starter sheet (ui_ai_starter_sheet.js). The LoRAs to use besides the
 * main model: picked one at a time (ui_ai_model_field.js) from the materials catalog (ai_toolbox_data.js),
 * each a chip with ×; the first message names them by file name, which the task's privacy hands the AI as
 * tokens (api/ai_sealed_models.py), so a LoRA the user lets the AI see by name is not offered. And what
 * happens to the prompt, drawn as four boxes in place of lines of text.
 */

import { loadCatalog } from './ai_toolbox_data.js';
import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';
import { modelField } from './ui_ai_model_field.js';

const MAX_LORAS = 6;
const FLOW = [['pencil', 1], ['lock', 2], ['sparkle', 3], ['image', 4]]; // aiSealFlow<n> / aiSealFlow<n>Sub

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The catalog's LoRAs as the model field lists them; none the user lets the AI see by name. */
function loraChoices(items) {
    return (items || [])
        .filter(item => item.kind === 'models' && item.type === 'loras' && item.ai_name !== 'shown')
        .map(item => ({ model_id: item.id, name: item.name, file: item.file, family: item.base || '', favourite: false, cover: item.cover }));
}

/** {node, read() -> [file names], stop}: the optional LoRAs; stays away while the library has none. */
export function loraPicker() {
    const chosen = [];
    let all = [];
    const node = el('div', 'anomalous-ai-start-field anomalous-ai-start-loras');
    node.hidden = true;
    const label = el('span', 'anomalous-ai-start-label', t('aiStartLoras'));
    label.prepend(icon('lock', 13));
    const chips = el('div', 'anomalous-ai-start-lora-chips');
    const field = modelField({
        noneLabel: t('aiStartLorasAdd'),
        noneInList: false,
        ariaLabel: t('aiStartLoras'),
        onChange: (id) => {
            const item = all.find(model => model.model_id === id);
            if (item && !chosen.includes(item) && chosen.length < MAX_LORAS) chosen.push(item);
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
        field.element.hidden = chosen.length >= MAX_LORAS;
        field.setModels(all.filter(model => !chosen.includes(model)), '');
    }

    loadCatalog().then((items) => {
        all = loraChoices(items);
        node.hidden = !all.length;
        draw();
    }).catch(() => { /* the sheet works without it */ });
    node.append(label, chips, field.element);
    return { node, read: () => chosen.map(item => item.file), stop: () => field.dispose() };
}

/** What happens to the prompt: written here, swapped for codes, the AI works with the codes, swapped back to run. */
export function sealFlow() {
    const list = el('ol', 'anomalous-ai-seal-flow');
    list.setAttribute('aria-label', t('aiSealFlowLabel'));
    for (const [name, step] of FLOW) {
        const item = el('li', 'anomalous-ai-seal-flow-step');
        const mark = el('span', 'anomalous-ai-seal-flow-icon');
        mark.append(icon(name, 16));
        item.append(mark, el('span', 'anomalous-ai-seal-flow-title', t(`aiSealFlow${step}`)), el('span', 'anomalous-ai-seal-flow-sub', t(`aiSealFlow${step}Sub`)));
        list.append(item);
    }
    return list;
}
