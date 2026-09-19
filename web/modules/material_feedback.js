import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';

/** Shared save receipt; navigation is owned by the browser instance. */
export function showMaterialSaved(owner, material, beforeOpen) {
    document.querySelector('.anomalous-material-receipt')?.remove();
    const receipt = document.createElement('div');
    receipt.className = 'anomalous-material-receipt';
    receipt.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.textContent = t('materialSavedToLibrary');
    receipt.appendChild(message);
    if (typeof owner?.openSavedMaterial === 'function' && material?.filename) {
        const view = document.createElement('button');
        view.type = 'button';
        view.textContent = t('materialViewSaved');
        view.onclick = async () => {
            view.disabled = true;
            try {
                beforeOpen?.();
                await owner.openSavedMaterial(material);
                receipt.remove();
            } catch (error) {
                await anomalousAlert(t('materialDetailLoadError'));
                view.disabled = false;
            }
        };
        receipt.appendChild(view);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', t('materialDismissReceipt'));
    close.onclick = () => receipt.remove();
    receipt.appendChild(close);
    document.body.appendChild(receipt);
}
