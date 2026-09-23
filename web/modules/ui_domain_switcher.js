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
    try {
        return localStorage.getItem(STORAGE_KEY) === 'audio' ? 'audio' : 'visual';
    } catch (_) {
        return 'visual';
    }
}

export function setActiveDomain(domain) {
    try {
        localStorage.setItem(STORAGE_KEY, domain === 'audio' ? 'audio' : 'visual');
    } catch (_) {
        // Private windows may refuse storage; the switch still applies to this page.
    }
}

export function createDomainSwitcher(browser) {
    const container = document.createElement('div');
    container.id = 'anomalous-domain-switcher';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'anomalous-domain-toggle-btn';
    toggleBtn.type = 'button';

    function updateButtonState(domain) {
        const isAudio = domain === 'audio';
        toggleBtn.innerHTML = isAudio ? SVG_ICONS.AUDIO : SVG_ICONS.VISUAL;
        toggleBtn.title = t(isAudio ? 'domainSwitchToVisual' : 'domainSwitchToAudio');
        toggleBtn.setAttribute('aria-label', toggleBtn.title);
        toggleBtn.classList.toggle('is-audio', isAudio);
    }

    updateButtonState(getActiveDomain());

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextDomain = getActiveDomain() === 'visual' ? 'audio' : 'visual';
        setActiveDomain(nextDomain);
        updateButtonState(nextDomain);
        browser.handleDomainChange?.(nextDomain);
    });

    container.appendChild(toggleBtn);
    return container;
}
