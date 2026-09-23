import { CURRENT_UPDATE_GUIDE, validateUpdateGuide } from './update_guide_data.js';
import { i18n, translate as t } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { text } from './ui_dom.js';
import { startSpotlightTour, ensureTourStyles } from './ui_spotlight_tour.js';
import { createVersionLine } from './ui_version_manager.js';

const acknowledgedThisSession = new Set();
let activeGuide = null;
const storageKey = id => `anomalous_update_guide_seen:${id}`;

export function hasAcknowledged(id = CURRENT_UPDATE_GUIDE.id) {
    if (acknowledgedThisSession.has(id)) return true;
    try { return localStorage.getItem(storageKey(id)) === '1'; }
    catch (error) { return false; } // Storage may be unavailable; session state still works.
}

export function closeUpdateGuide(owner, acknowledge = false) {
    if (!activeGuide || activeGuide.owner !== owner) return;
    const current = activeGuide;
    activeGuide = null;
    if (acknowledge) {
        acknowledgedThisSession.add(current.id);
        try { localStorage.setItem(storageKey(current.id), '1'); }
        catch (error) { console.warn('[AMB] Update guide dismissal is saved for this session only.', error); }
    }
    current.scope.dispose();
}

/** Opened only by explicit user action in the header or Help. No graph or file writes. */
export function showUpdateGuide(owner, { force = false, guide = CURRENT_UPDATE_GUIDE } = {}) {
    if (!owner.modal?.classList.contains('visible')) return false;
    if (!validateUpdateGuide(guide, i18n)) {
        console.warn('[AMB] Invalid update guide configuration; guide skipped.');
        return false;
    }
    if (activeGuide?.owner === owner && activeGuide.id === guide.id) return false;
    if (!force && hasAcknowledged(guide.id)) return false;
    if (activeGuide) closeUpdateGuide(activeGuide.owner);

    ensureTourStyles();

    const scope = createViewScope();
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'anomalous-update-guide';
    dialog.setAttribute('aria-labelledby', 'anomalous-update-guide-title');
    dialog.setAttribute('aria-describedby', 'anomalous-update-guide-body');
    activeGuide = { owner, id: guide.id, scope };
    scope.onDispose(() => {
        if (dialog.open) dialog.close();
        dialog.remove();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });

    const header = text(dialog, 'div', '', 'anomalous-update-guide-header');
    text(header, 'span', t('updateGuideTitle'));
    const dismiss = text(header, 'button', '×', 'anomalous-update-guide-close');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', t('close'));
    dismiss.onclick = () => closeUpdateGuide(owner, true);
    dialog.appendChild(createVersionLine(owner, { beforeOpen: () => closeUpdateGuide(owner, true) }));
    const icon = text(dialog, 'div', '', 'anomalous-update-guide-icon');
    icon.setAttribute('aria-hidden', 'true');
    const title = text(dialog, 'h2', '');
    title.id = 'anomalous-update-guide-title';
    const body = text(dialog, 'p', '');
    body.id = 'anomalous-update-guide-body';
    const tourBanner = text(dialog, 'button', t('updateGuideTourBanner') || '💡 想在主界面实地体验？点击开启按键遮罩导览 ›', 'anomalous-update-guide-tour-banner');
    tourBanner.type = 'button';
    tourBanner.id = 'anomalous-update-guide-tour-btn';
    tourBanner.onclick = () => {
        closeUpdateGuide(owner, true);
        startSpotlightTour(owner);
    };
    const progress = text(dialog, 'p', '', 'anomalous-update-guide-progress');
    progress.setAttribute('aria-live', 'polite');
    const footer = text(dialog, 'div', '', 'anomalous-update-guide-footer');
    const skip = text(footer, 'button', t('updateGuideSkip'), 'anomalous-btn-ghost');
    const navGroup = text(footer, 'div', '', 'anomalous-update-guide-nav-group');
    navGroup.style.display = 'flex';
    navGroup.style.gap = '8px';
    navGroup.style.alignItems = 'center';
    const back = text(navGroup, 'button', t('updateGuideBack'), 'anomalous-btn-ghost');
    const next = text(navGroup, 'button', '', 'anomalous-btn-primary');
    for (const button of [skip, back, next, tourBanner]) button.type = 'button';
    let index = 0;
    const render = () => {
        const step = guide.steps[index];
        icon.textContent = step.icon;
        title.textContent = t(step.titleKey);
        body.textContent = t(step.bodyKey);
        tourBanner.textContent = t('updateGuideTourBanner') || '💡 想在主界面实地体验？点击开启按键遮罩导览 ›';
        progress.textContent = t('updateGuideProgress', { current: index + 1, total: guide.steps.length });
        back.disabled = index === 0;
        next.textContent = t(index === guide.steps.length - 1 ? 'updateGuideDone' : 'updateGuideNext');
    };
    skip.onclick = () => closeUpdateGuide(owner, true);
    back.onclick = () => { if (index > 0) { index--; render(); } };
    next.onclick = () => {
        if (index === guide.steps.length - 1) closeUpdateGuide(owner, true);
        else { index++; render(); }
    };
    scope.listen(dialog, 'keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeUpdateGuide(owner, true);
        }
    });
    scope.listen(dialog, 'cancel', event => { event.preventDefault(); closeUpdateGuide(owner, true); });
    scope.listen(dialog, 'close', () => closeUpdateGuide(owner));
    scope.listen(dialog, 'click', event => { if (event.target === dialog) closeUpdateGuide(owner, true); });
    render();
    document.body.appendChild(dialog);
    dialog.showModal();
    next.focus();
    return true;
}
