/**
 * The current-node panel's prompts: each prompt box of the node (prompt_boxes.js) with its role
 * and text. They are edited in Prompt Studio, which the section's button opens on this node.
 */

import { translate as t } from './locales.js';
import { promptBoxes } from './prompt_boxes.js';

const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative', both: 'recipePromptRoleBoth' };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function boxRow(box) {
    const row = el('div', 'anomalous-node-prompt');
    const head = el('div', 'anomalous-node-param-head');
    head.append(el('span', `anomalous-node-param-role is-${box.role || 'plain'}`, t(ROLE_KEYS[box.role] || 'currentNodePromptPlain')),
        el('span', 'anomalous-node-prompt-name', box.name));
    const value = String(box.widget.value ?? '').trim();
    const text = el('p', 'anomalous-node-prompt-text', value || t('currentNodePromptEmpty'));
    text.classList.toggle('is-empty', !value);
    row.append(head, text);
    return row;
}

/** Appends the prompts section for `node` to `container`, when the node has prompt boxes. */
export function renderNodePrompts(owner, node, container) {
    const boxes = promptBoxes(node);
    if (!boxes.length) return;
    const section = el('section', 'anomalous-node-section');
    const head = el('div', 'anomalous-node-section-head');
    const edit = el('button', 'anomalous-node-section-btn', t('currentNodeEditInStudio'));
    edit.type = 'button';
    edit.onclick = () => void owner.openPromptStudio();
    head.append(el('h3', '', t('currentNodePrompts')), edit);
    section.append(head, ...boxes.map(boxRow));
    container.append(section);
}