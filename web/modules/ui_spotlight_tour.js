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
        titleZh: '四大专职工作室',
        titleEn: 'Dedicated Workspaces',
        bodyZh: '告别以往混杂的创作界面，独立划分出模型库（全库资产）、图库（出图成果）、工作流配方工坊（参数 Bento 拆解与版本快照）及素材库。随时随需切换！',
        bodyEn: 'Dedicated studios for your creative flow: Model Browser, Gallery, Recipe Studio, and Material Library. Seamlessly switch whenever needed!',
        position: 'bottom',
    },
    {
        id: 'update-notice',
        targetSelector: '#anomalous-update-notice-btn',
        icon: '💡',
        titleZh: '(!) 更新引导中心',
        titleEn: '(!) Update Guide Hub',
        bodyZh: '右上角常驻圆圈感叹号，随时点击可回顾核心版本演进与操作秘籍。右侧还提供使用手册与 ◧ 侧边栏停靠开关（支持吸附画布边缘或自由浮动）。',
        bodyEn: 'Click the exclamation mark anytime to review major milestone features. The rightmost controls also offer the user manual and canvas docking toggle.',
        position: 'bottom',
    },
    {
        id: 'scan',
        targetSelector: '#anomalous-scan-btn',
        icon: '🎯',
        titleZh: '🎯 扫描 · 雷达准星',
        titleEn: '🎯 Precision Radar Scan',
        bodyZh: '底栏第 1 键。点击启动全库深度扫描向导。更厉害的是：在任何模型卡片上悬浮点击雷达图标，即可原地极速直扫单个模型，实时获取底模与 C 站元数据，绝无弹窗阻塞！',
        bodyEn: 'Bottom key 1. Click for global scan wizard. Or hover over any model card and click the radar icon for instant single-model scanning without blocking alerts!',
        position: 'top',
    },
    {
        id: 'doctor',
        targetSelector: '#anomalous-doctor-btn',
        icon: '🩺',
        titleZh: '🩺 模型医生 · 拯救爆红',
        titleEn: '🩺 Model Doctor · Fix Red Nodes',
        bodyZh: '底栏第 2 键。当导入他人工作流或分享图片时，若模型节点爆红报错，点击医生即可一键智能基于 Hash 比对，精准批量替换为本地同类模型的正确路径。',
        bodyEn: 'Bottom key 2. When imported workflows turn red from missing models, Doctor auto-matches and restores paths using your local files in one click.',
        position: 'top',
    },
    {
        id: 'assistant',
        targetSelector: '#anomalous-assistant-btn',
        icon: '🤖',
        titleZh: '🤖 节点助手 · 智能芯片',
        titleEn: '🤖 Node Assistant · Hot Swap',
        bodyZh: '底栏第 3 键。选中画布节点即刻联动：可视化热替换模型、在 MODEL+CLIP 链前后无缝插入 LoRA，或一键注入配方中的同类参数方案（步数、CFG、采样器等）。',
        bodyEn: 'Bottom key 3. Select a canvas node to visually swap models, insert LoRAs, or inject parameter presets (steps, CFG, samplers) in one click.',
        position: 'top',
    },
    {
        id: 'materials',
        targetSelector: '#anomalous-materials-btn',
        icon: '✨',
        titleZh: '✨ 素材库 · 画布直接拖拽',
        titleEn: '✨ Materials · Direct Canvas Drag',
        bodyZh: '底栏第 4 键。集中归档优质图像快照与工作流资产。绝杀手势：按住卡片直接拖到 ComfyUI 画布节点上，即可一键将参数注入该节点；拖到空白处释放整套工作流！',
        bodyEn: 'Bottom key 4. Curated visual & workflow assets. Killer gesture: Drag cards directly onto canvas nodes to inject values, or onto empty canvas to load the full graph!',
        position: 'top',
    },
    {
        id: 'toolbox',
        targetSelector: '#anomalous-toolbox-btn',
        icon: '🧰',
        titleZh: '🧰 实用工具箱 · 扩展抽屉',
        titleEn: '🧰 Utility Toolbox Drawer',
        bodyZh: '底栏第 5 键。点击弹出紧凑九宫格悬浮面板，收纳了模型来源中心（一键寻源 C 站/HF 官方主页）、提示词笔记、文件夹管理等 9 大实用扩展工具。',
        bodyEn: 'Bottom key 5. Opens a compact utility drawer hosting Model Sources Hub (official Civitai/HF links), Prompt Notes, Folder Manager, and 9 tools.',
        position: 'top',
    },
    {
        id: 'settings',
        targetSelector: '#anomalous-global-settings-btn',
        icon: '⚙️',
        titleZh: '⚙️ 全局设置 · 偏好中心',
        titleEn: '⚙️ Global Settings Hub',
        bodyZh: '底栏第 6 键。支持实时中英双语切换、UI 缩放无级调节、模型卡片网格密度切换、视频封面播放偏好设置及缩略图缓存一键清理。',
        bodyEn: 'Bottom key 6. Instant bilingual toggle, smooth UI zoom scaling, card grid density, hover-video playback preferences, and thumbnail cache clearing.',
        position: 'top',
    },
]);

function ensureTourStyles() {
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
