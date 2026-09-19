/** Help dialog for the browser shell. */

import { translate } from './locales.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { startSpotlightTour, ensureTourStyles } from './ui_spotlight_tour.js';

const t = (key, params) => translate(key, params);

export function showHelp() {
        ensureTourStyles();
        if (this.helpModal) {
            this.helpModal.remove();
        }
        this.helpModal = document.createElement('div');
        this.helpModal.style.position = 'absolute';
        this.helpModal.style.top = '0';
        this.helpModal.style.left = '0';
        this.helpModal.style.width = '100%';
        this.helpModal.style.height = '100%';
        this.helpModal.style.background = 'rgba(0,0,0,0.85)';
        this.helpModal.style.zIndex = '9999';
        this.helpModal.style.display = 'flex';
        this.helpModal.style.alignItems = 'center';
        this.helpModal.style.justifyContent = 'center';

        const box = document.createElement('div');
        box.style.background = 'var(--bg-color, #222)';
        box.style.border = '1px solid var(--border-color, #444)';
        box.style.borderRadius = '8px';
        box.style.width = '550px';
        box.style.maxWidth = '90%';
        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.8)';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.maxHeight = '90vh';

        const header = document.createElement('div');
        header.style.padding = '15px 20px';
        header.style.borderBottom = '1px solid #444';
        header.style.background = '#333';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';

        const title = document.createElement('h2');
        title.innerHTML = t('helpTitle');
        title.style.margin = '0';
        title.style.color = '#fff';
        title.style.fontSize = '1.2em';

        const closeX = document.createElement('div');
        closeX.innerHTML = '&times;';
        closeX.style.position = 'absolute';
        closeX.style.top = '10px';
        closeX.style.right = '15px';
        closeX.style.fontSize = '1.8em';
        closeX.style.cursor = 'pointer';
        closeX.style.color = '#ff4444';
        closeX.onclick = () => this.helpModal.remove();

        header.appendChild(title);
        header.appendChild(closeX);

        const body = document.createElement('div');
        body.style.padding = '20px';
        body.innerHTML = t('helpContent');
        body.style.overflowY = 'auto';
        body.style.flex = '1';

        const footer = document.createElement('div');
        footer.style.padding = '15px';
        footer.style.borderTop = '1px solid #444';
        footer.style.display = 'flex';
        footer.style.alignItems = 'center';
        footer.style.justifyContent = 'space-between';

        const leftButtons = document.createElement('div');
        leftButtons.style.display = 'flex';
        leftButtons.style.gap = '10px';

        const tourBtn = document.createElement('button');
        tourBtn.id = 'anomalous-help-tour-btn';
        tourBtn.className = 'anomalous-btn-tour';
        tourBtn.textContent = t('updateGuideStartTour') || (window.anomalous_browser_lang === 'zh' ? '🎯 界面按键遮罩导览' : '🎯 Spotlight Tour');
        tourBtn.type = 'button';
        tourBtn.onclick = () => {
            this.helpModal?.remove();
            startSpotlightTour(this);
        };

        const replayGuideBtn = document.createElement('button');
        replayGuideBtn.id = 'anomalous-help-replay-guide-btn';
        replayGuideBtn.textContent = t('updateGuideReplay');
        replayGuideBtn.type = 'button';
        replayGuideBtn.style.padding = '8px 12px';
        replayGuideBtn.style.background = 'transparent';
        replayGuideBtn.style.color = '#cbd5e1';
        replayGuideBtn.style.border = '1px solid rgba(255,255,255,0.2)';
        replayGuideBtn.style.borderRadius = '4px';
        replayGuideBtn.style.cursor = 'pointer';
        replayGuideBtn.onclick = () => {
            this.helpModal?.remove();
            showUpdateGuide(this, { force: true });
        };

        leftButtons.appendChild(tourBtn);
        leftButtons.appendChild(replayGuideBtn);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = t('closeHelp');
        closeBtn.style.padding = '8px 16px';
        closeBtn.style.background = '#444';
        closeBtn.style.color = '#fff';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => this.helpModal.remove();

        footer.appendChild(leftButtons);
        footer.appendChild(closeBtn);

        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        this.helpModal.appendChild(box);

        document.getElementById('anomalous-container').appendChild(this.helpModal);
    }

