import { createViewScope, bindDrawerResize } from './ui_lifecycle.js';
import { createPromptWorkbench } from './ui_prompt_workbench.js';
import { newDraft, normalizeBlock, syncDraftSynthesizedText } from './prompt_studio_data.js';
import { categorizePromptSnippet, planToWorkbenchDraft } from './prompt_composition.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { jsonResponse } from './ui_dom.js';
import { translate as t } from './locales.js';

let activeStudio = null;
let pendingPlanLoad = null;

export function closePromptStudio(owner) {
    pendingPlanLoad?.abort();
    pendingPlanLoad = null;
    if (!activeStudio) return;
    const previous = activeStudio;
    activeStudio = null;
    previous.scope.dispose();
    previous.owner.sidePromptComposerControl = null;
    document.body.classList.remove('anomalous-prompt-studio-open');
    if (!previous.owner.modal?.classList.contains('visible')) previous.owner.setTriggerVisible?.(true);
}

export async function openPromptStudio(owner = this) {
    closePromptStudio(owner);

    // Canvas Focus Mode: If left master browser is visible, auto-collapse it so canvas has 80%+ space
    if (owner?.modal?.classList.contains('visible')) {
        if (typeof owner.close === 'function') {
            owner.close();
        }
    }

    // Hide global floating trigger button while Studio Drawer is open
    owner?.setTriggerVisible?.(false);
    document.body.classList.add('anomalous-prompt-studio-open');

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-prompt-studio-overlay';
    const scope = createViewScope();
    activeStudio = { scope, owner };
    scope.onDispose(() => overlay.remove());

    const drawer = document.createElement('aside');
    drawer.className = 'anomalous-prompt-studio-drawer';
    overlay.appendChild(drawer);

    // Dock side persistence (default to left)
    const savedSide = localStorage.getItem('anomalous_studio_dock_side') || 'left';
    if (savedSide === 'left') {
        drawer.classList.add('is-dock-left');
    }

    // Sidebar width persistence & resize handle (default to 580px)
    const savedWidth = localStorage.getItem('anomalous_studio_sidebar_width') || '580';
    drawer.style.width = `${Math.max(420, Math.min(window.innerWidth * 0.85, (parseInt(savedWidth, 10) || 580)))}px`;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'anomalous-studio-resize-handle';
    resizeHandle.title = window.anomalous_browser_lang === 'zh'
        ? '拖动调整侧边栏宽度，双击恢复默认'
        : 'Drag to resize sidebar, double-click to reset';
    drawer.appendChild(resizeHandle);

    bindDrawerResize(resizeHandle, drawer, scope, {
        side: () => drawer.classList.contains('is-dock-left') ? 'left' : 'right',
        minWidth: 380,
        setWidth: width => { drawer.style.width = `${width}px`; },
        saveWidth: width => localStorage.setItem('anomalous_studio_sidebar_width', String(Math.round(width))),
    });

    resizeHandle.ondblclick = () => {
        drawer.style.width = '580px';
        localStorage.setItem('anomalous_studio_sidebar_width', '580');
    };

    const onKeydown = (e) => {
        if (e.key === 'Escape') {
            const inspector = document.querySelector('.anomalous-prompt-inspector-overlay');
            if (inspector) return;
            closePromptStudio(owner);
        }
    };
    scope.listen(window, 'keydown', onKeydown);

    const composer = createPromptWorkbench(owner, drawer, scope, {
        onClose: () => closePromptStudio(owner),
        onToggleDockSide: () => {
            const isLeft = drawer.classList.toggle('is-dock-left');
            localStorage.setItem('anomalous_studio_dock_side', isLeft ? 'left' : 'right');
            return isLeft;
        },
    });
    owner.sidePromptComposerControl = composer;

    document.body.appendChild(overlay);
}

export async function showPromptComposer(owner, material) {
    pendingPlanLoad?.abort();
    if (material) {
        const controller = new AbortController();
        pendingPlanLoad = controller;
        try {
            if (owner.promptPlanDraft && !await anomalousConfirm(t('promptReplaceDraft'))) return;
            if (controller.signal.aborted) return;
            const response = await fetch(`/anomalous/material_full?include_workflow=0&filename=${encodeURIComponent(material.filename)}`, { signal: controller.signal });
            const payload = await jsonResponse(response, 'material load failed');
            if (controller.signal.aborted) return;
            if (payload.data?.kind !== 'prompt_plan') throw new Error('invalid plan');
            const draft = planToWorkbenchDraft(payload.data.plan || {}, payload.data.name || '');
            draft.tags = payload.data.tags || [];
            owner.promptPlanDraft = draft;
        } catch (error) {
            if (error.name !== 'AbortError') await anomalousAlert(t('materialDetailLoadError'));
            return;
        } finally {
            if (pendingPlanLoad === controller) pendingPlanLoad = null;
        }
    }

    owner.promptPlanDraft ||= newDraft();
    await openPromptStudio(owner);
}

export function appendPromptToStudio(owner, textSnippet, isPositive = true, noteTitle = '') {
    if (!textSnippet || !textSnippet.trim()) return;
    const role = isPositive ? 'positive' : 'negative';
    const cat = isPositive ? categorizePromptSnippet(textSnippet) : 'base';
    const block = normalizeBlock({
        title: noteTitle || (window.anomalous_browser_lang === 'zh' ? '素材片段' : 'Material Snippet'),
        content: textSnippet.trim(),
        role,
        category: cat,
    });

    if (owner.sidePromptComposerControl?.addBlock) {
        owner.sidePromptComposerControl.addBlock(block);

    } else {
        owner.promptPlanDraft ||= newDraft();
        owner.promptPlanDraft.plan.parts ||= [];
        owner.promptPlanDraft.plan.parts.push(block);
        syncDraftSynthesizedText(owner.promptPlanDraft);
        if (!owner.promptPlanDraft.name?.trim() && noteTitle) owner.promptPlanDraft.name = noteTitle;
    }
}

