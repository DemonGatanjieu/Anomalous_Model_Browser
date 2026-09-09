import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text } from './material_inspector.js';
import { applyMaterialBlock, selectedMaterialNode } from './node_material_actions.js';

export function showMaterialApplication(parent, result) {
    parent.querySelector('.anomalous-material-application-result')?.remove();
    const receipt = text(parent, 'div', '', 'anomalous-material-application-result');
    receipt.setAttribute('role', 'status');
    const status = text(receipt, 'span', t('materialNodeApplied'));
    const undo = text(receipt, 'button', t('materialUndo'), 'anomalous-btn-ghost');
    undo.type = 'button';
    undo.onclick = () => {
        try { result.undo(); status.textContent = t('materialUndone'); undo.remove(); }
        catch (error) { status.textContent = t(error.message); }
    };
}

export function applyMaterialToSelectedNode(node, block, hashes, parent) {
    if (selectedMaterialNode(app) !== node) throw new Error('materialTargetChanged');
    const result = applyMaterialBlock(app, node, block, hashes);
    showMaterialApplication(parent, result);
    return result;
}
