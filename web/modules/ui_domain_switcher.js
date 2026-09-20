import { t } from './interface_settings.js';

/**
 * Domain Switcher component (Visual Studio <-> Audio & Voice Studio)
 * Ultra-compact 26x26px icon button matching Anomalous Browser shell standards.
 */

const STORAGE_KEY = 'anomalous_active_domain';

const SVG_ICONS = {
    // Elegant waveform / microphone for audio mode
    AUDIO: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    // Elegant palette / grid for visual mode
    VISUAL: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`
};

export function getActiveDomain() {
    return localStorage.getItem(STORAGE_KEY) || 'visual';
}

export function setActiveDomain(domain) {
    localStorage.setItem(STORAGE_KEY, domain);
}

export function createDomainSwitcher(browser) {
    const container = document.createElement('div');
    container.id = 'anomalous-domain-switcher';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'anomalous-domain-toggle-btn';
    toggleBtn.type = 'button';
    toggleBtn.style.display = 'inline-flex';
    toggleBtn.style.alignItems = 'center';
    toggleBtn.style.justifyContent = 'center';
    toggleBtn.style.width = '26px';
    toggleBtn.style.height = '26px';
    toggleBtn.style.borderRadius = '6px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    toggleBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    toggleBtn.style.background = 'rgba(255, 255, 255, 0.05)';
    toggleBtn.style.boxSizing = 'border-box';
    toggleBtn.style.padding = '0';
    toggleBtn.style.flexShrink = '0';

    function updateButtonState(domain) {
        if (domain === 'audio') {
            toggleBtn.innerHTML = SVG_ICONS.AUDIO;
            toggleBtn.title = t('domainSwitchToVisual');
            toggleBtn.style.color = '#818cf8';
            toggleBtn.style.background = 'rgba(99, 102, 241, 0.18)';
            toggleBtn.style.borderColor = 'rgba(129, 140, 248, 0.45)';
            toggleBtn.style.boxShadow = '0 0 10px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255,255,255,0.1)';
        } else {
            toggleBtn.innerHTML = SVG_ICONS.VISUAL;
            toggleBtn.title = t('domainSwitchToAudio');
            toggleBtn.style.color = '#94a3b8';
            toggleBtn.style.background = 'rgba(255, 255, 255, 0.05)';
            toggleBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            toggleBtn.style.boxShadow = 'none';
        }
    }

    const currentDomain = getActiveDomain();
    updateButtonState(currentDomain);

    toggleBtn.addEventListener('mouseenter', () => {
        if (getActiveDomain() === 'audio') {
            toggleBtn.style.background = 'rgba(99, 102, 241, 0.28)';
            toggleBtn.style.borderColor = 'rgba(129, 140, 248, 0.6)';
        } else {
            toggleBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            toggleBtn.style.color = '#e2e8f0';
        }
    });

    toggleBtn.addEventListener('mouseleave', () => {
        updateButtonState(getActiveDomain());
    });

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
