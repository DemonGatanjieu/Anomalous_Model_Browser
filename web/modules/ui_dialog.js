import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

export function anomalousAlert(message, title = 'Anomalous') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0, 0, 0, 0.6)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';
        
        const dialog = document.createElement('div');
        dialog.style.background = 'linear-gradient(145deg, rgba(48, 49, 55, 0.98), rgba(27, 28, 33, 0.98))';
        dialog.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        dialog.style.borderRadius = '16px';
        dialog.style.padding = '24px';
        dialog.style.maxWidth = '400px';
        dialog.style.width = '100%';
        dialog.style.maxHeight = '90vh';
        dialog.style.overflowY = 'auto';
        dialog.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.55)';
        dialog.style.color = '#f3f4f6';
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
        text.style.color = '#ccc';
        
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
        
        footer.appendChild(okBtn);
        dialog.append(heading, text, footer);
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
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0, 0, 0, 0.6)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';
        
        const dialog = document.createElement('div');
        dialog.style.background = 'linear-gradient(145deg, rgba(48, 49, 55, 0.98), rgba(27, 28, 33, 0.98))';
        dialog.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        dialog.style.borderRadius = '16px';
        dialog.style.padding = '24px';
        dialog.style.maxWidth = '400px';
        dialog.style.width = '100%';
        dialog.style.maxHeight = '90vh';
        dialog.style.overflowY = 'auto';
        dialog.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.55)';
        dialog.style.color = '#f3f4f6';
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
        text.style.color = '#ccc';
        
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
        
        footer.append(cancelBtn);
        if (noBtn) footer.append(noBtn);
        footer.append(okBtn);
        dialog.append(heading, text, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        cancelBtn.focus();
    });
}

export function anomalousPrompt(message, defaultValue = '', title = 'Anomalous') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0, 0, 0, 0.6)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';

        const dialog = document.createElement('div');
        dialog.style.background = 'linear-gradient(145deg, rgba(48, 49, 55, 0.98), rgba(27, 28, 33, 0.98))';
        dialog.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        dialog.style.borderRadius = '16px';
        dialog.style.padding = '24px';
        dialog.style.maxWidth = '420px';
        dialog.style.width = '100%';
        dialog.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.55)';
        dialog.style.color = '#f3f4f6';
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
        text.style.color = '#ccc';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.maxLength = 200;
        input.style.width = '100%';
        input.style.padding = '10px 14px';
        input.style.borderRadius = '8px';
        input.style.border = '1px solid rgba(255, 255, 255, 0.18)';
        input.style.background = 'rgba(0, 0, 0, 0.35)';
        input.style.color = '#fff';
        input.style.fontSize = '14px';
        input.style.boxSizing = 'border-box';
        input.style.outline = 'none';
        input.onfocus = () => input.style.borderColor = '#1a73e8';
        input.onblur = () => input.style.borderColor = 'rgba(255, 255, 255, 0.18)';

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
            if (e.key === 'Enter') {
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
