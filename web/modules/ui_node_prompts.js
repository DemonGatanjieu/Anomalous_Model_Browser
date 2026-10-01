/**
 * The current-node panel's prompts: each prompt box of the node (prompt_boxes.js) with its
 * role and text, and translation in place: a box with Chinese is translated to English and
 * written back (one undo in the receipt); any other text can show its Chinese meaning
 * underneath without writing anything. Translation goes through translation_service.js.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { applyNodeMaterialValues } from './node_material_actions.js';
import { promptBoxes } from './prompt_boxes.js';
import { hasChinese, translatePromptText } from './translation_service.js';
import { showMaterialApplication } from './ui_material_application.js';

const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative', both: 'recipePromptRoleBoth' };

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

function boxRow(node, box, receiptHost) {
    const row = el('div', 'anomalous-node-prompt');
    const head = el('div', 'anomalous-node-param-head');
    head.append(el('span', `anomalous-node-param-role is-${box.role || 'plain'}`, t(ROLE_KEYS[box.role] || 'currentNodePromptPlain')),
        el('span', 'anomalous-node-prompt-name', box.name));
    const textEl = el('p', 'anomalous-node-prompt-text');
    const note = el('p', 'anomalous-node-prompt-note');
    note.hidden = true;
    const actions = el('div', 'anomalous-node-prompt-actions');
    row.append(head, textEl, note, actions);

    const draw = () => {
        const value = box.widget.value;
        textEl.textContent = value.trim() || t('currentNodePromptEmpty');
        textEl.classList.toggle('is-empty', !value.trim());
        actions.replaceChildren();
        if (!value.trim()) return;
        if (hasChinese(value)) actions.append(button('anomalous-node-section-btn', t('currentNodeToEnglish'), toEnglish));
        else actions.append(button('anomalous-node-section-btn', t('currentNodeShowChinese'), showChinese));
    };
    const busy = (target, label) => {
        target.disabled = true;
        target.textContent = label;
    };
    const say = (message) => {
        note.hidden = false;
        note.textContent = message;
    };

    async function toEnglish(event) {
        const before = box.widget.value;
        busy(event.currentTarget, t('currentNodeTranslating'));
        const result = await translatePromptText(before, { targetLang: 'en' });
        if (!row.isConnected) return;
        if (!result.ok || !result.translated) {
            draw();
            say(t('currentNodeTranslateFailed'));
            return;
        }
        // The box may have been edited while the translation was on its way.
        if (node.widgets?.[box.index] !== box.widget || box.widget.value !== before) {
            draw();
            say(t('currentNodeChangedMeanwhile'));
            return;
        }
        const applied = applyNodeMaterialValues(app, node, [{ index: box.index, value: result.translated }]);
        showMaterialApplication(receiptHost, { undo() { applied.undo(); draw(); } }, node);
        note.hidden = true;
        draw();
    }

    async function showChinese(event) {
        busy(event.currentTarget, t('currentNodeTranslating'));
        const result = await translatePromptText(box.widget.value, { targetLang: 'zh-CN' });
        if (!row.isConnected) return;
        draw();
        say(result.ok ? result.translated : t('currentNodeTranslateFailed'));
    }

    draw();
    return row;
}

/** Appends the prompts section for `node` to `container`, when the node has prompt boxes. */
export function renderNodePrompts(node, container) {
    const boxes = promptBoxes(node);
    if (!boxes.length) return;
    const section = el('section', 'anomalous-node-section');
    const head = el('div', 'anomalous-node-section-head');
    head.append(el('h3', '', t('currentNodePrompts')));
    section.append(head, ...boxes.map(box => boxRow(node, box, section)));
    container.append(section);
}
