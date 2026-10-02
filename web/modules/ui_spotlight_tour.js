/**
 * ui_spotlight_tour.js - Interactive Spotlight Mask Tour for Anomalous Model Browser
 *
 * Provides a comfortable, smooth, and pleasant guided walkthrough:
 * 1. Dark translucent backdrop with smooth gliding spotlight cutout (box-shadow).
 * 2. Floating directional speech bubble card explaining key buttons step-by-step.
 * 3. Keyboard navigation (ArrowRight/Enter, ArrowLeft, Escape) & viewport auto-scroll.
 * 4. Zero CSS-bundle modifications (injected scoped stylesheet).
 *
 * The browser tour uses TOUR_STEPS; other views pass their own steps, whose text
 * may come from locale keys (`titleKey` / `bodyKey`) instead of titleZh/titleEn.
 */

import { translate as t } from './locales.js';
import { text } from './ui_dom.js';

let activeTourInstance = null;

const TOUR_STEPS = Object.freeze([
    {
        id: 'workspaces',
        targetSelector: '.anomalous-rail-nav',
        fallbackSelector: '#anomalous-rail',
        icon: '🏠',
        titleZh: '左侧图标栏',
        titleEn: 'The rail',
        bodyZh: '主页、模型库、图库、工作流、素材库和角色语音都在这里。再点一下当前页的图标（或顶栏最左边的按钮），可以收起、展开旁边的列表。',
        bodyEn: 'Home, models, gallery, workflows, materials and voices live here. Click the current page\'s icon again (or the button at the top left) to show or hide its list.',
        position: 'right',
    },
    {
        id: 'update-notice',
        targetSelector: '#anomalous-update-notice-btn',
        icon: '💡',
        titleZh: '(!) 更新引导与停靠设置',
        titleEn: '(!) Update Guide & Docking',
        bodyZh: '点击 (!) 可查看关键改动说明与本导览；右侧的 ◧ 按钮用于在 ComfyUI 侧边吸附模式与独立浮动窗口之间切换。',
        bodyEn: 'Click (!) to review changes and launch this tour. The ◧ icon toggles sidebar docking vs a free-floating window.',
        position: 'bottom',
    },
    {
        id: 'scan',
        targetSelector: '#anomalous-scan-btn',
        icon: '🎯',
        titleZh: '🎯 扫描 (向导与单模型直扫)',
        titleEn: '🎯 Model Scanning',
        bodyZh: '点击此按钮可打开扫描向导，对模型目录建立索引与哈希。在模型网格中悬浮卡片点击雷达图标，则仅原地扫描该单个模型。',
        bodyEn: 'Click to open the scan wizard for folder indexing. You can also hover over any model card and click the radar icon to scan only that model.',
        position: 'right',
    },
    {
        id: 'doctor',
        targetSelector: '#anomalous-doctor-btn',
        icon: '🩺',
        titleZh: '🩺 模型检查 (缺模型)',
        titleEn: '🩺 Model Check (Missing Models)',
        bodyZh: '打开工作流时会自动检查，缺模型就在画布上方提示。改过名、换过文件夹的同一个文件（按 SHA256 指纹认）可以一键换上；其余的在这里自己挑，或看模型去哪下载。',
        bodyEn: 'Each workflow you open is checked; missing models show a bar over the canvas. The same file under another name or folder (recognised by its SHA256) is put back with one press; for the rest, pick one here or see where to download it.',
        position: 'right',
    },
    {
        id: 'assistant',
        targetSelector: '#anomalous-assistant-btn',
        icon: '🤖',
        titleZh: '🤖 当前节点 (模型、提示词、参数)',
        titleEn: '🤖 Current node',
        bodyZh: '选中画布节点后：上面换模型、插 LoRA；提示词框可以翻成英文；下面列出这类节点存过的参数，每条写明会改哪几项，点“套用”只改这几项。',
        bodyEn: 'Select a canvas node: swap its model or insert a LoRA on top; translate its prompt boxes; below, every saved set of values for this kind of node says what it would change, and Apply changes only that.',
        position: 'right',
    },
    {
        id: 'materials',
        targetSelector: '#anomalous-materials-btn',
        icon: '✨',
        titleZh: '✨ 素材库 (资产归档与画布拖拽)',
        titleEn: '✨ Material Library',
        bodyZh: '存图片、提示词和工作流片段的地方。拖提示词时画布上的提示词框会按正负标出颜色，拖到哪个框就填哪个框；拖到空白处新建提示词节点或打开工作流。右上角是提示词工坊和提示词笔记。',
        bodyEn: 'Where images, prompts and workflow snippets are kept. While you drag a prompt, the canvas prompt boxes are outlined by role and the one you drop on is filled; empty canvas makes a prompt node or opens the workflow. Prompt Studio and Prompt Notes are at the top right.',
        position: 'right',
    },
    {
        id: 'settings',
        targetSelector: '#anomalous-global-settings-btn',
        icon: '⚙️',
        titleZh: '⚙️ 全局设置',
        titleEn: '⚙️ Global Settings',
        bodyZh: '用于切换界面中英文、调节 UI 缩放比例、设置卡片网格列数与密度、选择视频封面悬停播放模式，以及清理本地缓存。',
        bodyEn: 'Adjust language (ZH/EN), UI zoom scaling, card grid density, hover-video playback behavior, and manage local cache.',
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
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2);
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
            background: rgba(255, 255, 255, 0.1);
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
            background: rgba(255, 255, 255, 0.2);
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
            background: rgba(255, 255, 255, 0.08);
            color: var(--amb-text-soft);
        }
        .anomalous-spotlight-btn-secondary:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.15);
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
        .anomalous-btn-tour {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: var(--amb-btn-primary-bg);
            color: var(--amb-btn-primary-text);
            border: 1px solid var(--amb-border-strong);
            border-radius: 6px;
            padding: 7px 16px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .anomalous-btn-tour:hover {
            background: #1d4ed8;
            border-color: rgba(255, 255, 255, 0.4);
        }
        .anomalous-update-guide-tour-banner {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            margin: 2px auto 14px auto;
            padding: 6px 16px;
            background: rgba(255, 255, 255, 0.04);
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

    const isZh = () => (window.anomalous_browser_lang === 'zh');

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
        const titleText = step.titleKey ? t(step.titleKey) : isZh() ? step.titleZh : step.titleEn;
        const bodyText = step.bodyKey ? t(step.bodyKey) : isZh() ? step.bodyZh : step.bodyEn;
        const total = availableSteps.length;
        const stepNum = currentIndex + 1;

        card.replaceChildren();

        const cardHeader = text(card, 'div', '', 'anomalous-spotlight-card-header');
        const badge = text(cardHeader, 'span', '', 'anomalous-spotlight-card-badge');
        text(badge, 'span', step.icon);
        text(badge, 'span', isZh() ? `第 ${stepNum} / ${total} 步` : `Step ${stepNum} of ${total}`);

        const closeBtn = text(cardHeader, 'button', '×', 'anomalous-spotlight-card-close');
        closeBtn.type = 'button';
        closeBtn.title = isZh() ? '退出导览 (Esc)' : 'Exit Tour (Esc)';
        closeBtn.onclick = () => closeSpotlightTour();

        text(card, 'h4', titleText, 'anomalous-spotlight-card-title');
        text(card, 'p', bodyText, 'anomalous-spotlight-card-body');

        const cardFooter = text(card, 'div', '', 'anomalous-spotlight-card-footer');
        const dotsWrap = text(cardFooter, 'div', '', 'anomalous-spotlight-dots');
        for (let i = 0; i < total; i++) {
            text(dotsWrap, 'span', '', `anomalous-spotlight-dot ${i === currentIndex ? 'active' : ''}`);
        }

        const btnGroup = text(cardFooter, 'div', '', 'anomalous-spotlight-btn-group');
        const prevBtn = text(btnGroup, 'button', isZh() ? '‹ 上一步' : '‹ Back', 'anomalous-spotlight-btn anomalous-spotlight-btn-secondary');
        prevBtn.id = 'anomalous-tour-prev';
        prevBtn.type = 'button';
        prevBtn.disabled = currentIndex === 0;
        prevBtn.onclick = () => {
            if (currentIndex > 0) {
                currentIndex--;
                renderCurrentStep();
            }
        };

        const nextBtnText = currentIndex === total - 1 ? (isZh() ? '完成体验 ✓' : 'Done ✓') : (isZh() ? '下一步 ›' : 'Next ›');
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
