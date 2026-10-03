/**
 * The receipt of values written to a node from a panel (Current node's parameters):
 * which node took them, with Undo.
 */

import { translate as t } from './locales.js';
import { text } from './ui_dom.js';
import { materialNodeHeading } from './material_inspector.js';

/** Shows the receipt of `result` (with `undo()`) in `parent`, replacing the one there. */
export function showApplyReceipt(parent, result, node) {
    parent.querySelector('.anomalous-material-application-result')?.remove();
    const receipt = text(parent, 'div', '', 'anomalous-material-application-result');
    receipt.setAttribute('role', 'status');
    const status = text(receipt, 'span', node ? t('materialAppliedTarget', { name: materialNodeHeading(node), id: node.id }) : t('materialNodeApplied'));
    const undo = text(receipt, 'button', t('materialUndo'), 'anomalous-btn-ghost');
    undo.type = 'button';
    undo.onclick = () => {
        try {
            result.undo();
            status.textContent = t('materialUndone');
            undo.remove();
        } catch (error) {
            status.textContent = t(error.message);
        }
    };
}
