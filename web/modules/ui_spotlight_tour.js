/**
 * ui_spotlight_tour.js - Interactive Spotlight Mask Tour for Anomalous Model Browser
 *
 * Provides a comfortable, smooth, and pleasant guided walkthrough:
 * 1. Dark translucent backdrop with smooth gliding spotlight cutout (box-shadow).
 * 2. Floating directional speech bubble card explaining key buttons step-by-step.
 * 3. Keyboard navigation (ArrowRight/Enter, ArrowLeft, Escape) & viewport auto-scroll.
 * 4. Zero CSS-bundle modifications (injected scoped stylesheet).
 *
 * The browser tour uses TOUR_STEPS, in the order the pages are used (rail, gallery and what
 * its ☆ keeps, then the tools); other views pass their own steps. A step's text is the locale
 * keys `titleKey` / `bodyKey`.
 */

import { translate as t } from './locales.js';
import { text } from './ui_dom.js';

let activeTourInstance = null;

const TOUR_STEPS = Object.freeze([
    {
        id: 'rail',
        targetSelector: '.anomalous-rail-nav',
        fallbackSelector: '#anomalous-rail',
        icon: '🏠',
        titleKey: 'tourRailTitle',
        bodyKey: 'tourRailBody',
        position: 'right',
    },
    {
        id: 'gallery',
        targetSelector: '#anomalous-gallery-btn',
        icon: '🖼️',
        titleKey: 'tourGalleryTitle',
        bodyKey: 'tourGalleryBody',
        position: 'right',
    },
    {
        id: 'recipes',
        targetSelector: '#anomalous-notebook-btn',
        icon: '📚',
        titleKey: 'tourRecipesTitle',
        bodyKey: 'tourRecipesBody',
        position: 'right',
    },
    {
        id: 'combos',
        targetSelector: '#anomalous-combos-btn',
        icon: '🧩',
        titleKey: 'tourCombosTitle',
        bodyKey: 'tourCombosBody',
        position: 'right',
    },
    {
        id: 'prompts',
        targetSelector: '#anomalous-prompts-btn',
        icon: '✍️',
        titleKey: 'tourPromptsTitle',
        bodyKey: 'tourPromptsBody',
        position: 'right',
    },
    {
        id: 'node',
        targetSelector: '#anomalous-assistant-btn',
        icon: '🤖',
        titleKey: 'tourNodeTitle',
        bodyKey: 'tourNodeBody',
        position: 'right',
    },
    {
        id: 'scan',
        targetSelector: '#anomalous-scan-btn',
        icon: '🎯',
        titleKey: 'tourScanTitle',
        bodyKey: 'tourScanBody',
        position: 'right',
    },
    {
        id: 'doctor',
        targetSelector: '#anomalous-doctor-btn',
        icon: '🩺',
        titleKey: 'tourDoctorTitle',
        bodyKey: 'tourDoctorBody',
        position: 'right',
    },
    {
        id: 'notice',
        targetSelector: '#anomalous-update-notice-btn',
        icon: '💡',
        titleKey: 'tourNoticeTitle',
        bodyKey: 'tourNoticeBody',
        position: 'bottom',
    },
    {
        id: 'settings',
        targetSelector: '#anomalous-global-settings-btn',
        icon: '⚙️',
        titleKey: 'tourSettingsTitle',
        bodyKey: 'tourSettingsBody',
        position: 'right',
    },
]);

export function ensureTourStyles() {
    if (typeof document === 'undefined') return;
    if (document.querySelector?.('#anomalous-spotlight-tour-styles')) return;

    const style = document.createElement('style');
    style.id = 'anomalous-spotlight-tour-styles';
    style.textContent = `
        .anomalous-spotlight-overlay {
            position: fixed;
            inset: 0;
            z-index: 999999;
            pointer-events: auto;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            animation: anomalous-spotlight-fade-in 0.25s ease-out forwards;
        }
        @keyframes anomalous-spotlight-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .anomalous-spotlight-box {
            position: absolute;
            border-radius: 10px;
            box-shadow: 0 0 0 9999px rgba(10, 12, 18, 0.78),
                        0 0 0 2px color-mix(in srgb, var(--amb-link) 90%, transparent),
                        0 0 22px color-mix(in srgb, var(--amb-link) 45%, transparent);
            transition: all 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
            pointer-events: none;
            box-sizing: border-box;
        }
        .anomalous-spotlight-card {
            position: absolute;
            width: 330px;
            max-width: calc(100vw - 32px);
            background: var(--amb-bg-panel);
            border: 1px solid var(--amb-border-strong);
            border-radius: 12px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 1px rgba(var(--amb-ink-rgb), 0.2);
            color: var(--amb-text-main);
            padding: 16px 18px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-sizing: border-box;
            transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
                        left 0.32s cubic-bezier(0.2, 0.8, 0.2, 1),
                        top 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
            z-index: 1000000;
        }
        .anomalous-spotlight-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .anomalous-spotlight-card-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            font-weight: 600;
            color: var(--amb-link);
            background: color-mix(in srgb, var(--amb-link) 15%, transparent);
            border: 1px solid color-mix(in srgb, var(--amb-link) 30%, transparent);
            border-radius: 9999px;
            padding: 2px 8px;
        }
        .anomalous-spotlight-card-close {
            background: transparent;
            border: none;
            color: var(--amb-text-muted);
            font-size: 16px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            transition: color 0.15s, background 0.15s;
        }
        .anomalous-spotlight-card-close:hover {
            color: var(--amb-text-main);
            background: rgba(var(--amb-ink-rgb), 0.1);
        }
        .anomalous-spotlight-card-title {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            color: var(--amb-text-main);
            display: flex;
            align-items: center;
            gap: 6px;
            line-height: 1.3;
        }
        .anomalous-spotlight-card-body {
            margin: 0;
            font-size: 13px;
            line-height: 1.55;
            color: var(--amb-text-soft);
        }
        .anomalous-spotlight-card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 4px;
            padding-top: 10px;
            border-top: 1px solid var(--amb-border);
        }
        .anomalous-spotlight-dots {
            display: flex;
            gap: 5px;
            align-items: center;
        }
        .anomalous-spotlight-dot {
            width: 6px;
            height: 6px;
            border-radius: 9999px;
            background: rgba(var(--amb-ink-rgb), 0.2);
            transition: all 0.2s;
        }
        .anomalous-spotlight-dot.active {
            width: 14px;
            background: var(--amb-btn-primary-bg);
        }
        .anomalous-spotlight-btn-group {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .anomalous-spotlight-btn {
            font-size: 12px;
            font-weight: 600;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
            border: none;
        }
        .anomalous-spotlight-btn-secondary {
            background: rgba(var(--amb-ink-rgb), 0.08);
            color: var(--amb-text-soft);
        }
        .anomalous-spotlight-btn-secondary:hover:not(:disabled) {
            background: rgba(var(--amb-ink-rgb), 0.15);
            color: var(--amb-text-main);
        }
        .anomalous-spotlight-btn-secondary:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }
        .anomalous-spotlight-btn-primary {
            background: var(--amb-btn-primary-bg);
            color: var(--amb-btn-primary-text);
            box-shadow: 0 2px 8px color-mix(in srgb, var(--amb-link) 40%, transparent);
        }
        .anomalous-spotlight-btn-primary:hover {
            background: #1d4ed8;
        }
        .anomalous-update-guide-tour-banner {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            margin: 2px auto 14px auto;
            padding: 6px 16px;
            background: rgba(var(--amb-ink-rgb), 0.04);
            border: 1px solid var(--amb-border);
            border-radius: 20px;
            color: var(--amb-text-muted);
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            max-width: fit-content;
            text-align: center;
            user-select: none;
            letter-spacing: 0.2px;
        }
        .anomalous-update-guide-tour-banner[hidden] {
            display: none;
        }
        .anomalous-update-guide-tour-banner:hover {
            background: color-mix(in srgb, var(--amb-link) 12%, transparent);
            border-color: color-mix(in srgb, var(--amb-link) 40%, transparent);
            color: var(--amb-link);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        }
        .anomalous-update-guide-tour-banner:active {
            transform: translateY(0);
            background: color-mix(in srgb, var(--amb-link) 20%, transparent);
        }
    `;
    (document.head || document.body)?.appendChild(style);
}

function resolveStepTarget(step) {
    if (typeof document === 'undefined') return null;
    const shown = el => Boolean(el?.isConnected && el.getClientRects().length); // hidden targets are skipped
    let el = document.querySelector(step.targetSelector);
    if (!shown(el) && step.fallbackSelector) {
        el = document.querySelector(step.fallbackSelector);
    }
    return shown(el) ? el : null;
}

function computeCardPosition(rect, position, cardWidth = 330, cardHeight = 220) {
    const margin = 12;
    const padding = 16;
    let left = rect.left + rect.width / 2 - cardWidth / 2;
    let top = 0;

    if (position === 'right') {
        left = rect.right + margin;
        top = rect.top + rect.height / 2 - cardHeight / 2;
    } else if (position === 'top') {
        top = rect.top - cardHeight - margin;
        if (top < padding) {
            top = rect.bottom + margin; // flip to bottom if offscreen
        }
    } else {
        top = rect.bottom + margin;
        if (top + cardHeight > window.innerHeight - padding) {
            top = rect.top - cardHeight - margin; // flip to top if offscreen
        }
    }

    // Clamp horizontally to viewport
    left = Math.max(padding, Math.min(window.innerWidth - cardWidth - padding, left));
    top = Math.max(padding, Math.min(window.innerHeight - cardHeight - padding, top));

    return { left, top };
}

export function isSpotlightTourActive() {
    return Boolean(activeTourInstance);
}

export function closeSpotlightTour() {
    if (!activeTourInstance) return;
    const { overlay, cleanupListeners, onClose } = activeTourInstance;
    activeTourInstance = null;
    if (typeof cleanupListeners === 'function') cleanupListeners();
    onClose?.();
    if (overlay && overlay.parentNode) {
        overlay.style.animation = 'none';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s ease-out';
        setTimeout(() => overlay.remove(), 200);
    }
}

/** `steps` defaults to the browser tour; `onClose` runs however the tour ends. */
export function startSpotlightTour(owner, { steps = TOUR_STEPS, onClose = null } = {}) {
    if (typeof document === 'undefined') return false;
    if (activeTourInstance) closeSpotlightTour();

    ensureTourStyles();

    // Filter steps to those with targets present on current DOM
    const availableSteps = steps.filter(step => Boolean(resolveStepTarget(step)));
    if (!availableSteps.length) {
        console.warn('[AMB] No tour targets visible on screen.');
        return false;
    }

    let currentIndex = 0;

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-spotlight-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Spotlight Tour');

    const spotlightBox = document.createElement('div');
    spotlightBox.className = 'anomalous-spotlight-box';

    const card = document.createElement('div');
    card.className = 'anomalous-spotlight-card';

    overlay.appendChild(spotlightBox);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const renderCurrentStep = () => {
        const step = availableSteps[currentIndex];
        const target = resolveStepTarget(step);
        if (!target) {
            if (currentIndex < availableSteps.length - 1) {
                currentIndex++;
                renderCurrentStep();
            } else {
                closeSpotlightTour();
            }
            return;
        }

        // Scroll target into view if out of sight
        target.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

        const rect = target.getBoundingClientRect?.() || { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 };
        const buffer = 5;

        // Position spotlight box smoothly
        spotlightBox.style.left = `${Math.max(0, rect.left - buffer)}px`;
        spotlightBox.style.top = `${Math.max(0, rect.top - buffer)}px`;
        spotlightBox.style.width = `${rect.width + buffer * 2}px`;
        spotlightBox.style.height = `${rect.height + buffer * 2}px`;

        // Card content
        const titleText = t(step.titleKey);
        const bodyText = t(step.bodyKey);
        const total = availableSteps.length;
        const stepNum = currentIndex + 1;

        card.replaceChildren();

        const cardHeader = text(card, 'div', '', 'anomalous-spotlight-card-header');
        const badge = text(cardHeader, 'span', '', 'anomalous-spotlight-card-badge');
        text(badge, 'span', step.icon);
        text(badge, 'span', t('updateGuideProgress', { current: stepNum, total }));

        const closeBtn = text(cardHeader, 'button', '×', 'anomalous-spotlight-card-close');
        closeBtn.type = 'button';
        closeBtn.title = t('tourExit');
        closeBtn.onclick = () => closeSpotlightTour();

        text(card, 'h4', titleText, 'anomalous-spotlight-card-title');
        text(card, 'p', bodyText, 'anomalous-spotlight-card-body');

        const cardFooter = text(card, 'div', '', 'anomalous-spotlight-card-footer');
        const dotsWrap = text(cardFooter, 'div', '', 'anomalous-spotlight-dots');
        for (let i = 0; i < total; i++) {
            text(dotsWrap, 'span', '', `anomalous-spotlight-dot ${i === currentIndex ? 'active' : ''}`);
        }

        const btnGroup = text(cardFooter, 'div', '', 'anomalous-spotlight-btn-group');
        const prevBtn = text(btnGroup, 'button', `‹ ${t('updateGuideBack')}`, 'anomalous-spotlight-btn anomalous-spotlight-btn-secondary');
        prevBtn.id = 'anomalous-tour-prev';
        prevBtn.type = 'button';
        prevBtn.disabled = currentIndex === 0;
        prevBtn.onclick = () => {
            if (currentIndex > 0) {
                currentIndex--;
                renderCurrentStep();
            }
        };

        const nextBtnText = currentIndex === total - 1 ? `${t('tourDone')} ✓` : `${t('updateGuideNext')} ›`;
        const nextBtn = text(btnGroup, 'button', nextBtnText, 'anomalous-spotlight-btn anomalous-spotlight-btn-primary');
        nextBtn.id = 'anomalous-tour-next';
        nextBtn.type = 'button';
        nextBtn.onclick = () => {
            if (currentIndex < total - 1) {
                currentIndex++;
                renderCurrentStep();
            } else {
                closeSpotlightTour();
            }
        };

        // Position card
        const cardPos = computeCardPosition(rect, step.position);
        card.style.left = `${cardPos.left}px`;
        card.style.top = `${cardPos.top}px`;
    };

    // Keyboard navigation
    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSpotlightTour();
        } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
            if (currentIndex < availableSteps.length - 1) {
                currentIndex++;
                renderCurrentStep();
            } else {
                closeSpotlightTour();
            }
        } else if (e.key === 'ArrowLeft') {
            if (currentIndex > 0) {
                currentIndex--;
                renderCurrentStep();
            }
        }
    };

    const onResize = () => {
        renderCurrentStep();
    };

    const onOverlayClick = (e) => {
        if (e.target === overlay) {
            closeSpotlightTour();
        }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);
    overlay.addEventListener('click', onOverlayClick);

    const cleanupListeners = () => {
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onResize);
        overlay.removeEventListener('click', onOverlayClick);
    };

    activeTourInstance = { overlay, cleanupListeners, owner, onClose };

    renderCurrentStep();
    return true;
}

if (typeof window !== 'undefined') {
    window.anomalous_start_tour = () => startSpotlightTour(window.anomalousBrowserInstance);
}
