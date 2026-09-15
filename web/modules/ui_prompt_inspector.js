import { createViewScope } from './ui_lifecycle.js';
import { syncDraftSynthesizedText, replaceDraftRoleText } from './prompt_studio_data.js';
import { translatePromptText } from './translation_service.js';
import { translate as t } from './locales.js';

let activeInspector = null;

export function openPromptInspectorModal(draft, defaultRole = 'positive', onApplyToNode = null, onChange = () => {}) {
    activeInspector?.dispose();
    const scope = createViewScope();
    activeInspector = scope;

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-prompt-inspector-overlay';
    scope.onDispose(() => { overlay.remove(); if (activeInspector === scope) activeInspector = null; });

    const modal = document.createElement('div');
    modal.className = 'anomalous-prompt-inspector-modal';
    overlay.appendChild(modal);

    let currentRole = defaultRole || 'positive';

    // Header
    const header = document.createElement('header');
    header.className = 'anomalous-inspector-header';
    const h3 = document.createElement('h3');
    h3.textContent = window.anomalous_browser_lang === 'zh' ? '🔍 提示词深度全览与精修' : '🔍 Prompt Inspector & Editor';
    h3.style.margin = '0';
    h3.style.fontSize = '0.92rem';
    h3.style.color = '#e2e8f0';
    header.appendChild(h3);

    // Role Tabs
    const tabsWrap = document.createElement('div');
    tabsWrap.style.display = 'flex';
    tabsWrap.style.gap = '6px';

    const posTab = document.createElement('button');
    posTab.className = `anomalous-btn-ghost anomalous-btn-sm${currentRole === 'positive' ? ' is-active' : ''}`;
    posTab.textContent = `🔆 ${window.anomalous_browser_lang === 'zh' ? '正向提示词' : 'Positive'}`;

    const negTab = document.createElement('button');
    negTab.className = `anomalous-btn-ghost anomalous-btn-sm${currentRole === 'negative' ? ' is-active' : ''}`;
    negTab.textContent = `🌙 ${window.anomalous_browser_lang === 'zh' ? '负向提示词' : 'Negative'}`;

    tabsWrap.appendChild(posTab);
    tabsWrap.appendChild(negTab);
    header.appendChild(tabsWrap);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    closeBtn.textContent = '✕';
    closeBtn.title = window.anomalous_browser_lang === 'zh' ? '关闭 (Esc)' : 'Close (Esc)';
    closeBtn.onclick = () => scope.dispose();
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'anomalous-inspector-body';

    const editHint = document.createElement('small');
    editHint.textContent = t('promptFullTextEditHint');
    body.appendChild(editHint);

    const textarea = document.createElement('textarea');
    textarea.className = 'anomalous-inspector-textarea';
    textarea.spellcheck = false;

    syncDraftSynthesizedText(draft);
    textarea.value = draft?.plan?.[currentRole] || '';

    const updateStats = () => {
        const val = textarea.value;
        const words = val.split(/[,，\s\n]+/).filter(Boolean).length;
        statsEl.textContent = `${val.length} ${window.anomalous_browser_lang === 'zh' ? '字符' : 'chars'} · ~${words} ${window.anomalous_browser_lang === 'zh' ? '词' : 'words'}`;
    };

    const updateTabStyles = () => {
        posTab.classList.toggle('is-active', currentRole === 'positive');
        negTab.classList.toggle('is-active', currentRole === 'negative');
        textarea.value = draft?.plan?.[currentRole] || '';
        updateStats();
    };

    posTab.onclick = () => { currentRole = 'positive'; updateTabStyles(); };
    negTab.onclick = () => { currentRole = 'negative'; updateTabStyles(); };

    body.appendChild(textarea);

    // Footer
    const footer = document.createElement('footer');
    footer.className = 'anomalous-inspector-footer';

    const statsEl = document.createElement('div');
    statsEl.style.fontSize = '0.75rem';
    statsEl.style.color = '#94a3b8';
    statsEl.style.fontFamily = 'monospace';

    const saveEdits = () => {
        replaceDraftRoleText(draft, currentRole, textarea.value);
        onChange();
        updateStats();
    };
    textarea.oninput = saveEdits;
    updateStats();

    footer.appendChild(statsEl);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';

    // Normalize formatting
    const normBtn = document.createElement('button');
    normBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    normBtn.textContent = `🧹 ${window.anomalous_browser_lang === 'zh' ? '规范化' : 'Normalize'}`;
    normBtn.title = window.anomalous_browser_lang === 'zh' ? '清理多余顿号、分号与重复逗号' : 'Clean formatting and punctuation';
    normBtn.onclick = () => {
        const cleaned = textarea.value
            .replace(/[,，、;；|｜\n\r]+/g, ', ')
            .replace(/\s+,/g, ',')
            .replace(/,\s*,/g, ', ')
            .replace(/^\s*,\s*|\s*,\s*$/g, '')
            .trim();
        textarea.value = cleaned;
        saveEdits();
    };
    actions.appendChild(normBtn);

    // Translate
    const transBtn = document.createElement('button');
    transBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    transBtn.textContent = `🌐 ${window.anomalous_browser_lang === 'zh' ? '翻译' : 'Translate'}`;
    transBtn.onclick = async () => {
        const raw = textarea.value.trim();
        const role = currentRole;
        if (!raw) return;
        const orig = transBtn.textContent;
        transBtn.textContent = '⏳';
        try {
            const res = await translatePromptText(raw, { signal: scope.signal });
            if (!scope.signal.aborted && currentRole === role && textarea.value.trim() === raw && res.ok && res.translated) {
                textarea.value = res.translated;
                saveEdits();
            }
        } finally {
            transBtn.textContent = orig;
        }
    };
    actions.appendChild(transBtn);

    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    copyBtn.textContent = `📋 ${window.anomalous_browser_lang === 'zh' ? '复制' : 'Copy'}`;
    copyBtn.onclick = async () => {
        await navigator.clipboard.writeText(textarea.value);
        copyBtn.textContent = '✓';
        setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = `📋 ${window.anomalous_browser_lang === 'zh' ? '复制' : 'Copy'}`; }, 1200);
    };
    actions.appendChild(copyBtn);

    // Apply to node & close
    if (typeof onApplyToNode === 'function') {
        const applyBtn = document.createElement('button');
        applyBtn.className = 'anomalous-btn-primary anomalous-btn-sm';
        applyBtn.textContent = `🚀 ${window.anomalous_browser_lang === 'zh' ? '写入节点并关闭' : 'Write Node & Close'}`;
        applyBtn.onclick = async () => {
            if (await onApplyToNode(currentRole, textarea.value)) scope.dispose();
        };
        actions.appendChild(applyBtn);
    }

    footer.appendChild(actions);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);

    overlay.onclick = (e) => {
        if (e.target === overlay) scope.dispose();
    };

    const onKey = (e) => {
        if (e.key === 'Escape') {
            scope.dispose();
        }
    };
    scope.listen(window, 'keydown', onKey);

    document.body.appendChild(overlay);
    return () => scope.dispose();
}
