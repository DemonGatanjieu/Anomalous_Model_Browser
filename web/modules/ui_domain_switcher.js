import { t } from './interface_settings.js';

/**
 * Domain Switcher component (Visual Studio 🎨 <-> Audio & Voice Studio 🎙️)
 * Embedded at the header between brand badge and sidebar menu button.
 */

const STORAGE_KEY = 'anomalous_active_domain';

export function getActiveDomain() {
    return localStorage.getItem(STORAGE_KEY) || 'visual';
}

export function setActiveDomain(domain) {
    localStorage.setItem(STORAGE_KEY, domain);
}

export function createDomainSwitcher(browser) {
    const container = document.createElement('div');
    container.id = 'anomalous-domain-switcher';
    container.style.display = 'inline-flex';
    container.style.alignItems = 'center';
    container.style.gap = '4px';
    container.style.marginLeft = '8px';
    container.style.marginRight = '8px';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'anomalous-domain-toggle-btn';
    toggleBtn.type = 'button';
    toggleBtn.style.display = 'inline-flex';
    toggleBtn.style.alignItems = 'center';
    toggleBtn.style.justifyContent = 'center';
    toggleBtn.style.height = '26px';
    toggleBtn.style.padding = '0 8px';
    toggleBtn.style.borderRadius = '13px';
    toggleBtn.style.fontSize = '11px';
    toggleBtn.style.fontWeight = '600';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    toggleBtn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    toggleBtn.style.userSelect = 'none';

    function updateButtonState(domain) {
        if (domain === 'audio') {
            toggleBtn.innerHTML = '<span style="margin-right:4px;">🎙️</span>' + t('domainAudioBadge');
            toggleBtn.title = t('domainSwitchToVisual');
            toggleBtn.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(59, 130, 246, 0.35))';
            toggleBtn.style.color = '#c4b5fd';
            toggleBtn.style.borderColor = 'rgba(167, 139, 250, 0.6)';
            toggleBtn.style.boxShadow = '0 0 10px rgba(139, 92, 246, 0.35)';
        } else {
            toggleBtn.innerHTML = '<span style="margin-right:4px;">🎨</span>' + t('domainVisualBadge');
            toggleBtn.title = t('domainSwitchToAudio');
            toggleBtn.style.background = 'rgba(255, 255, 255, 0.06)';
            toggleBtn.style.color = '#cbd5e1';
            toggleBtn.style.borderColor = 'rgba(255, 255, 255, 0.12)';
            toggleBtn.style.boxShadow = 'none';
        }
    }

    const currentDomain = getActiveDomain();
    updateButtonState(currentDomain);

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextDomain = getActiveDomain() === 'visual' ? 'audio' : 'visual';
        setActiveDomain(nextDomain);
        updateButtonState(nextDomain);
        if (typeof browser.handleDomainChange === 'function') {
            browser.handleDomainChange(nextDomain);
        }
    });

    container.appendChild(toggleBtn);
    return container;
}
