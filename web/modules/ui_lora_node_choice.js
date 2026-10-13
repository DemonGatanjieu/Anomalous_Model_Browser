/**
 * The default combo's LoRA node (放到画布时 LoRA 用哪种节点), under its LoRA heading: ComfyUI's
 * own or an installed third-party one (lora_nodes.js), as a row of small buttons. A node this
 * ComfyUI lacks shows only while the combo still uses it, marked. Hidden when there is no choice.
 */

import { translate as t } from './locales.js';
import { LORA_NODES, isInstalled, loraNodeKind } from './lora_nodes.js';

/** `onChange()` saves the combo after `data.loraNode` changed. */
export function createLoraNodeChoice(data, onChange) {
    const current = loraNodeKind(data.loraNode);
    const kinds = LORA_NODES.filter(kind => isInstalled(kind) || kind === current);
    const row = document.createElement('div');
    row.className = 'anomalous-nb-lora-node';
    row.hidden = kinds.length < 2;
    const label = document.createElement('span');
    label.textContent = t('comboLoraNodeLabel');
    row.append(label);
    for (const kind of kinds) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'anomalous-nb-lora-node-option';
        item.textContent = isInstalled(kind) ? t(kind.labelKey) : `${t(kind.labelKey)}${t('comboLoraNodeMissingMark')}`;
        item.title = t(kind.hintKey);
        item.setAttribute('aria-pressed', String(kind === current));
        item.onclick = () => {
            if (loraNodeKind(data.loraNode) === kind) return;
            data.loraNode = kind.id;
            row.querySelectorAll('.anomalous-nb-lora-node-option').forEach(other => other.setAttribute('aria-pressed', String(other === item)));
            onChange();
        };
        row.append(item);
    }
    return row;
}
