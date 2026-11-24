/**
 * Subtle, dismissible first-visit tip strips for the Models (ui_grid.js) and Gallery (ui_sidebar.js)
 * pages, plus a memory-only preview toggle for the hidden review console (ui_review_console.js).
 */

import { translate as t } from './locales.js';
import { PAGE_TIPS, markPageTipSeen, shouldShowPageTip } from './page_tips_state.js';

const mounted = new Set();
const sessionDismissed = new Set();
let previewMode = null; // 'models' | 'gallery' | null
let previewPages = null; // Set of page ids active in review-console preview, or null
let previewOnChange = null;
let langBound = false;

function tipIcon() {
    const icon = document.createElement('span');
    icon.className = 'anomalous-page-tip-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1.2 1.3 1.4 2.3h5.2c.2-1 .7-1.8 1.4-2.3A7 7 0 0 0 12 2z"/></svg>'; // static markup only
    return icon;
}

function renderTipNode(node) {
    const page = node?.dataset?.anomalousPageTip;
    if (!page || !Object.hasOwn(PAGE_TIPS, page)) {
        if (node) {
            node.hidden = true;
            node.replaceChildren();
        }
        return;
    }
    const visible = previewPages
        ? shouldShowPageTip(page, { preview: previewPages })
        : (!sessionDismissed.has(page) && shouldShowPageTip(page));
    node.setAttribute('aria-label', t('pageTipAria'));
    node.hidden = !visible;
    if (!visible) {
        node.replaceChildren();
        return;
    }
    const copy = document.createElement('p');
    copy.className = 'anomalous-page-tip-text';
    copy.textContent = t(PAGE_TIPS[page].textKey);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'anomalous-page-tip-dismiss';
    dismiss.textContent = t('pageTipGotIt');
    dismiss.onclick = () => {
        if (previewPages) {
            previewPages.delete(page);
            if (!previewPages.size) {
                previewPages = null;
                previewMode = null;
            }
            renderTipNode(node);
            previewOnChange?.();
            return;
        }
        sessionDismissed.add(page);
        markPageTipSeen(page);
        renderTipNode(node);
    };

    node.replaceChildren(tipIcon(), copy, dismiss);
}

/** Re-renders all connected tip strips (language change or review-console preview toggles). */
export function refreshPageTips() {
    for (const node of [...mounted]) {
        if (!node.isConnected) {
            mounted.delete(node);
            continue;
        }
        renderTipNode(node);
    }
}

/**
 * Creates a `<aside>` tip strip for `page` ('models' | 'gallery'), optionally tagged with layout
 * modifier class `is-${variant}` ('grid' or 'gallery'). Hidden automatically once seen or on upgrades.
 */
export function createPageTip(page, variant = '') {
    if (!langBound && typeof window !== 'undefined') {
        langBound = true;
        window.addEventListener('anomalous-language-change', refreshPageTips);
    }
    for (const existing of [...mounted]) {
        if (!existing.isConnected) mounted.delete(existing);
    }
    const node = document.createElement('aside');
    node.className = `anomalous-page-tip${variant ? ` is-${variant}` : ''}`;
    node.dataset.anomalousPageTip = page;
    node.setAttribute('role', 'note');
    mounted.add(node);
    renderTipNode(node);
    return node;
}

/** Active review-console preview page ('models' | 'gallery' | null). */
export function pageTipPreviewMode() {
    return previewMode;
}

/**
 * Opens `page` ('models' | 'gallery') and forces first-visit tips visible strictly in memory.
 * Never touches localStorage.
 */
export function previewPageTip(owner, page, onChange = null) {
    if (!Object.hasOwn(PAGE_TIPS, page)) return;
    previewMode = page;
    previewPages = new Set(['models', 'gallery']);
    previewOnChange = onChange;
    if (owner) {
        if (page === 'models' && (owner.modelView === 'tidy' || owner.modelView === 'sources')) {
            owner.modelView = '';
            owner.show?.({ page: 'models' });
            owner.loadModels?.();
        } else {
            owner.show?.({ page });
        }
    }
    refreshPageTips();
}

/** Ends any review-console page-tip preview without writing to localStorage. */
export function clearPageTipPreview() {
    previewMode = null;
    previewPages = null;
    previewOnChange = null;
    refreshPageTips();
}
