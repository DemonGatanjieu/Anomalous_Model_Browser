import { translate } from './locales.js';

const t = (key, params) => translate(key, params);
// Confirmations must remain above the image workbench (z-index: 1000000).
const DIALOG_Z_INDEX = '1000001';

/** Puts `text` on the clipboard; also on a page served over plain http, where only the old way works. */
export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        const done = document.execCommand('copy');
        area.remove();
        return done;
    }
}

/** A line to copy (a command), shown as typed, with a Copy button beside it; when the browser
 * refuses the clipboard, the line is selected for Ctrl+C. */
function copyLine(text) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    const line = document.createElement('code');
    line.textContent = text;
    line.style.flex = '1';
    line.style.minWidth = '0';
    line.style.padding = '8px 10px';
    line.style.borderRadius = '8px';
    line.style.background = 'var(--amb-bg-input)';
    line.style.border = '1px solid var(--amb-border-strong)';
    line.style.fontSize = '0.85rem';
    line.style.wordBreak = 'break-all';
    line.style.userSelect = 'all';
    const button = document.createElement('button');
    button.textContent = t('copy');
    button.className = 'anomalous-btn-ghost';
    button.style.padding = '8px 14px';
    button.onclick = async () => {
        if (await copyText(text)) {
            button.textContent = t('copied');
            return;
        }
        getSelection().selectAllChildren(line);
        button.textContent = t('dialogCopySelected');
    };
    row.append(line, button);
    return row;
}

/** `options.copy`: a line to copy, shown under the message. */
export function anomalousAlert(message, title = 'Anomalous', options = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.className = 'anomalous-dialog-overlay';
        overlay.style.zIndex = DIALOG_Z_INDEX;
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'var(--amb-scrim)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';
        
        const dialog = document.createElement('div');
        dialog.style.background = 'var(--amb-bg-dialog)';
        dialog.style.border = '1px solid var(--amb-border-strong)';
        dialog.style.borderRadius = '16px';
        dialog.style.padding = '24px';
        dialog.style.maxWidth = '400px';
        dialog.style.width = '100%';
        dialog.style.maxHeight = '90vh';
        dialog.style.overflowY = 'auto';
        dialog.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.55)';
        dialog.style.color = 'var(--amb-text-main)';
        dialog.style.display = 'flex';
        dialog.style.flexDirection = 'column';
        dialog.style.gap = '16px';
        
        const heading = document.createElement('h3');
        heading.textContent = title;
        heading.style.margin = '0';
        heading.style.fontSize = '1.25rem';
        
        const text = document.createElement('p');
        text.textContent = message;
        text.style.margin = '0';
        text.style.lineHeight = '1.5';
        text.style.whiteSpace = 'pre-wrap';
        text.style.color = 'var(--amb-text-soft)';
        
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.marginTop = '8px';
        
        const okBtn = document.createElement('button');
        okBtn.textContent = t('dialogOk');
        okBtn.className = 'anomalous-btn-primary';
        okBtn.style.padding = '8px 24px';
        
        const cleanup = () => {
            overlay.remove();
            resolve();
        };
        
        okBtn.onclick = cleanup;
        overlay.onkeydown = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            cleanup();
        };
        
        footer.appendChild(okBtn);
        dialog.append(heading, text);
        if (options.copy) dialog.append(copyLine(options.copy));
        dialog.append(footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        okBtn.focus();
    });
}

export function anomalousConfirm(message, title = 'Anomalous', options = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.className = 'anomalous-dialog-overlay';
        overlay.style.zIndex = DIALOG_Z_INDEX;
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'var(--amb-scrim)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';
        
        const dialog = document.createElement('div');
        dialog.style.background = 'var(--amb-bg-dialog)';
        dialog.style.border = '1px solid var(--amb-border-strong)';
        dialog.style.borderRadius = '16px';
        dialog.style.padding = '24px';
        dialog.style.maxWidth = '400px';
        dialog.style.width = '100%';
        dialog.style.maxHeight = '90vh';
        dialog.style.overflowY = 'auto';
        dialog.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.55)';
        dialog.style.color = 'var(--amb-text-main)';
        dialog.style.display = 'flex';
        dialog.style.flexDirection = 'column';
        dialog.style.gap = '16px';
        
        const heading = document.createElement('h3');
        heading.textContent = title;
        heading.style.margin = '0';
        heading.style.fontSize = '1.25rem';
        
        const text = document.createElement('p');
        text.textContent = message;
        text.style.margin = '0';
        text.style.lineHeight = '1.5';
        text.style.whiteSpace = 'pre-wrap';
        text.style.color = 'var(--amb-text-soft)';
        
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '12px';
        footer.style.marginTop = '8px';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = options.cancelLabel || t('dialogCancel');
        cancelBtn.className = 'anomalous-btn-ghost';
        cancelBtn.style.padding = '8px 24px';
        
        const okBtn = document.createElement('button');
        okBtn.textContent = options.okLabel || t('dialogOk');
        okBtn.className = 'anomalous-btn-danger';
        okBtn.style.padding = '8px 24px';
        
        const noBtn = options.noLabel ? document.createElement('button') : null;
        if (noBtn) {
            noBtn.textContent = options.noLabel;
            noBtn.className = 'anomalous-btn-ghost';
            noBtn.style.padding = '8px 24px';
        }

        const finish = (result) => {
            overlay.remove();
            resolve(result);
        };
        
        cancelBtn.onclick = () => finish(null);
        noBtn?.addEventListener('click', () => finish(false));
        okBtn.onclick = () => finish(true);
        overlay.onkeydown = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            finish(null); // as Cancel
        };
        
        footer.append(cancelBtn);
        if (noBtn) footer.append(noBtn);
        footer.append(okBtn);
        dialog.append(heading, text, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        cancelBtn.focus();
    });
}

export function anomalousPrompt(message, defaultValue = '', title = 'Anomalous', options = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.className = 'anomalous-dialog-overlay';
        overlay.style.zIndex = DIALOG_Z_INDEX;
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'var(--amb-scrim)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';

        const dialog = document.createElement('div');
        dialog.style.background = 'var(--amb-bg-dialog)';
        dialog.style.border = '1px solid var(--amb-border-strong)';
        dialog.style.borderRadius = '16px';
        dialog.style.padding = '24px';
        dialog.style.maxWidth = '420px';
        dialog.style.width = '100%';
        dialog.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.55)';
        dialog.style.color = 'var(--amb-text-main)';
        dialog.style.display = 'flex';
        dialog.style.flexDirection = 'column';
        dialog.style.gap = '16px';

        const heading = document.createElement('h3');
        heading.textContent = title;
        heading.style.margin = '0';
        heading.style.fontSize = '1.25rem';

        const text = document.createElement('p');
        text.textContent = message;
        text.style.margin = '0';
        text.style.lineHeight = '1.5';
        text.style.color = 'var(--amb-text-soft)';

        const input = document.createElement(options.multiline ? 'textarea' : 'input');
        if (!options.multiline) input.type = 'text';
        input.value = defaultValue;
        input.maxLength = options.maxLength || 200;
        if (options.multiline) input.rows = options.rows || 6;
        input.style.width = '100%';
        input.style.padding = '10px 14px';
        input.style.borderRadius = '8px';
        input.style.border = '1px solid var(--amb-border-strong)';
        input.style.background = 'var(--amb-bg-sunken)';
        input.style.color = 'var(--amb-text-main)';
        input.style.fontSize = '14px';
        input.style.boxSizing = 'border-box';
        input.style.outline = 'none';
        if (options.multiline) input.style.resize = 'vertical';
        input.onfocus = () => input.style.borderColor = '#1a73e8';
        input.onblur = () => input.style.borderColor = 'var(--amb-border-strong)';

        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '12px';
        footer.style.marginTop = '8px';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = t('dialogCancel');
        cancelBtn.className = 'anomalous-btn-ghost';
        cancelBtn.style.padding = '8px 24px';

        const okBtn = document.createElement('button');
        okBtn.textContent = t('dialogOk');
        okBtn.className = 'anomalous-btn-primary';
        okBtn.style.padding = '8px 24px';

        const finish = (result) => {
            overlay.remove();
            resolve(result);
        };

        cancelBtn.onclick = () => finish(null);
        okBtn.onclick = () => {
            const val = input.value.trim();
            finish(val);
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter' && (!options.multiline || e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                okBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelBtn.click();
            }
        };

        footer.append(cancelBtn, okBtn);
        dialog.append(heading, text, input, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    });
}
