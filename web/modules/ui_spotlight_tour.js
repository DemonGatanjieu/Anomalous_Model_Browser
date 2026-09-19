/**
 * ui_spotlight_tour.js - Interactive Spotlight Mask Tour for Anomalous Model Browser
 *
 * Provides a comfortable, smooth, and pleasant guided walkthrough:
 * 1. Dark translucent backdrop with smooth gliding spotlight cutout (box-shadow).
 * 2. Floating directional speech bubble card explaining key buttons step-by-step.
 * 3. Keyboard navigation (ArrowRight/Enter, ArrowLeft, Escape) & viewport auto-scroll.
 * 4. Zero CSS-bundle modifications (injected scoped stylesheet).
 */

import { translate as t } from './locales.js';
import { text } from './ui_dom.js';

let activeTourInstance = null;

const TOUR_STEPS = Object.freeze([
    {
        id: 'workspaces',
        targetSelector: '#anomalous-models-btn',
        fallbackSelector: '.anomalous-header-left',
        icon: '🏠',
        titleZh: '顶栏工作区切换',
        titleEn: 'Workspace Navigation',
        bodyZh: '用于在模型库、图库、工作流配方工坊和素材库之间切换。各个页面保持独立的视图状态与筛选条件。',
        bodyEn: 'Switch between Model Browser, Gallery, Recipe Studio, and Material Library. Each maintains independent view and filter states.',
        position: 'bottom',
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
        position: 'top',
    },
    {
        id: 'doctor',
        targetSelector: '#anomalous-doctor-btn',
        icon: '🩺',
        titleZh: '🩺 模型医生 (节点路径修复)',
        titleEn: '🩺 Model Doctor (Node Repair)',
        bodyZh: '用于排查当前画布中因模型缺失而报错的节点。系统通过文件的 SHA256 哈希值与文件名，匹配本地现有模型并执行路径替换。',
        bodyEn: 'Inspects red error nodes in the active graph caused by missing models, matching local files by SHA256 hash and filename for replacement.',
        position: 'top',
    },
    {
        id: 'assistant',
        targetSelector: '#anomalous-assistant-btn',
        icon: '🤖',
        titleZh: '🤖 节点助手 (模型替换与参数注入)',
        titleEn: '🤖 Node Assistant',
        bodyZh: '选中画布节点后，可在动作页直接更换该节点的模型或追加 LoRA；在参数方案页可将配方保存的采样器、步数等参数写入该节点。',
        bodyEn: 'Select a canvas node to swap its model or insert a LoRA via Actions, or apply saved sampler/step parameters via Parameter Presets.',
        position: 'top',
    },
    {
        id: 'materials',
        targetSelector: '#anomalous-materials-btn',
        icon: '✨',
        titleZh: '✨ 素材库 (资产归档与画布拖拽)',
        titleEn: '✨ Material Library',
        bodyZh: '用于管理已归档的图片、提示词与工作流片段。按住卡片拖拽到画布节点上可注入对应参数；拖拽到画布空白处可直接加载该工作流。',
        bodyEn: 'Manages saved images, prompts, and workflow snippets. Drag a card onto a canvas node to inject values, or drop on empty canvas to load the workflow.',
        position: 'top',
    },
    {
        id: 'toolbox',
        targetSelector: '#anomalous-toolbox-btn',
        icon: '🧰',
        titleZh: '🧰 实用工具箱',
        titleEn: '🧰 Utility Toolbox',
        bodyZh: '点击展开九宫格面板，收纳了模型来源中心（检测工作流模型对应的 Civitai/HuggingFace 链接）、提示词笔记、文件夹管理等工具。',
        bodyEn: 'Opens the drawer hosting Model Sources Hub (detects Civitai/HuggingFace links for workflow models), Prompt Notes, and Folder Manager.',
        position: 'top',
    },
    {
        id: 'settings',
        targetSelector: '#anomalous-global-settings-btn',
        icon: '⚙️',
        titleZh: '⚙️ 全局设置',
        titleEn: '⚙️ Global Settings',
        bodyZh: '用于切换界面中英文、调节 UI 缩放比例、设置卡片网格列数与密度、选择视频封面悬停播放模式，以及清理本地缓存。',
        bodyEn: 'Adjust language (ZH/EN), UI zoom scaling, card grid density, hover-video playback behavior, and manage local cache.',
        position: 'top',
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
                        0 0 0 2px rgba(96, 165, 250, 0.9),
                        0 0 22px rgba(59, 130, 246, 0.45);
            transition: all 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
            pointer-events: none;
            box-sizing: border-box;
        }
        .anomalous-spotlight-card {
            position: absolute;
            width: 330px;
            max-width: calc(100vw - 32px);
            background: #18181f;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 12px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2);
            color: #f1f5f9;
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
            color: #60a5fa;
            background: rgba(59, 130, 246, 0.15);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 9999px;
            padding: 2px 8px;
        }
        .anomalous-spotlight-card-close {
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 16px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            transition: color 0.15s, background 0.15s;
        }
        .anomalous-spotlight-card-close:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }
        .anomalous-spotlight-card-title {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            color: #f8fafc;
            display: flex;
            align-items: center;
            gap: 6px;
            line-height: 1.3;
        }
        .anomalous-spotlight-card-body {
            margin: 0;
            font-size: 13px;
            line-height: 1.55;
            color: #cbd5e1;
        }
        .anomalous-spotlight-card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 4px;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
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
            background: #3b82f6;
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
            color: #cbd5e1;
        }
        .anomalous-spotlight-btn-secondary:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.15);
            color: #fff;
        }
        .anomalous-spotlight-btn-secondary:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }
        .anomalous-spotlight-btn-primary {
            background: #2563eb;
            color: #fff;
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
        }
        .anomalous-spotlight-btn-primary:hover {
            background: #1d4ed8;
        }
        .anomalous-btn-tour {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: #2563eb;
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.2);
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
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            color: #94a3b8;
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            max-width: fit-content;
            text-align: center;
            user-select: none;
            letter-spacing: 0.2px;
        }
        .anomalous-update-guide-tour-banner:hover {
            background: rgba(59, 130, 246, 0.12);
            border-color: rgba(96, 165, 250, 0.4);
            color: #93c5fd;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        }
        .anomalous-update-guide-tour-banner:active {
            transform: translateY(0);
            background: rgba(59, 130, 246, 0.2);
        }
    `;
    (document.head || document.body)?.appendChild(style);
}

function resolveStepTarget(step) {
    if (typeof document === 'undefined') return null;
    let el = document.querySelector(step.targetSelector);
    if ((!el || !el.isConnected) && step.fallbackSelector) {
        el = document.querySelector(step.fallbackSelector);
    }
    return el && el.isConnected ? el : null;
}

function computeCardPosition(rect, position, cardWidth = 330, cardHeight = 220) {
    const margin = 12;
    const padding = 16;
    let left = rect.left + rect.width / 2 - cardWidth / 2;
    let top = 0;

    if (position === 'top') {
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
    const { overlay, cleanupListeners } = activeTourInstance;
    activeTourInstance = null;
    if (typeof cleanupListeners === 'function') cleanupListeners();
    if (overlay && overlay.parentNode) {
        overlay.style.animation = 'none';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s ease-out';
        setTimeout(() => overlay.remove(), 200);
    }
}

export function startSpotlightTour(owner) {
    if (typeof document === 'undefined') return false;
    if (activeTourInstance) closeSpotlightTour();

    ensureTourStyles();

    // Filter steps to those with targets present on current DOM
    const availableSteps = TOUR_STEPS.filter(step => Boolean(resolveStepTarget(step)));
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
        const titleText = isZh() ? step.titleZh : step.titleEn;
        const bodyText = isZh() ? step.bodyZh : step.bodyEn;
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

    activeTourInstance = { overlay, cleanupListeners, owner };

    renderCurrentStep();
    return true;
}

if (typeof window !== 'undefined') {
    window.anomalous_start_tour = () => startSpotlightTour(window.anomalousBrowserInstance);
}
