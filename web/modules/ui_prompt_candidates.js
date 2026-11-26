import { translate as t } from './locales.js';
import { text } from './ui_dom.js';
import { byPromptRole, renderDetailedNodeCards } from './material_inspector.js';
import { candidateVisibility as visibility } from './prompt_candidate_visibility.js';

/**
 * Build Prompts Station
 */
export function buildPromptsStation(blocks, fallbackPrompt, item, suggestedName, context) {
    const { workbench: wb, saveSelectedBlocks, copyToClipboard } = context;
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-prompts-wrap';

    const promptBlocks = (blocks || []).filter(block =>
        /cliptextencode/i.test(block.type || '') &&
        (block.resolvedPromptText || (!block.promptTextLinked && (block.widgets_values || []).some(value => typeof value === 'string' && value.trim())))
    );
    if (promptBlocks.length) {
        text(wrap, 'p', t('materialPromptRoleHelp'), 'anomalous-workbench-muted');
        renderDetailedNodeCards(wrap, byPromptRole(promptBlocks), {
            onSaveBlock: (block, button) => saveSelectedBlocks(item, suggestedName, [block], button),
            onPromptRoleChange: async (block, selectedRole) => {
                const key = String(block.node_id);
                if (!wb.promptRoleOverrides || typeof wb.promptRoleOverrides !== 'object') wb.promptRoleOverrides = {};
                if (selectedRole === 'auto') {
                    delete wb.promptRoleOverrides[key];
                    block.promptRole = block.promptRoleAutomatic || 'unknown';
                    block.promptRoleManual = false;
                    block.promptRoleSource = 'automatic';
                } else {
                    wb.promptRoleOverrides[key] = { role: selectedRole, nodeType: block.type || null };
                    block.promptRole = selectedRole;
                    block.promptRoleManual = true;
                    block.promptRoleSource = 'manual';
                }
            },
        });
    } else if (fallbackPrompt) {
        const card = document.createElement('div');
        card.className = 'anomalous-workbench-prompt-card';
        const topBar = document.createElement('div');
        topBar.className = 'anomalous-workbench-prompt-bar';
        text(topBar, 'span', t('materialPromptText') || '提示词', 'anomalous-workbench-prompt-title');
        const copyBtn = text(topBar, 'button', t('materialCopyPrompt'), 'anomalous-workbench-mini-action-btn');
        copyBtn.type = 'button';
        copyBtn.onclick = () => copyToClipboard(fallbackPrompt, copyBtn, t('materialCopied'), t('materialCopyPrompt'));
        card.appendChild(topBar);
        text(card, 'div', fallbackPrompt, 'anomalous-workbench-prompt-content is-expanded');
        wrap.appendChild(card);
    } else {
        text(wrap, 'div', t('materialNoPromptData'), 'anomalous-workbench-muted');
    }

    return candidatePanel(wrap, Boolean(promptBlocks.length || fallbackPrompt), item, wb, copyToClipboard);
}

function action(parent, label, callback) {
    const btn = text(parent, 'button', label, 'anomalous-workbench-mini-action-btn');
    btn.type = 'button';
    btn.onclick = () => callback(btn);
    return btn;
}

function candidatePanel(element, hasPrompt, item, wb, copy) {
    const host = document.createElement('div');
    element.appendChild(host);
    const source = item.sourceImage || { type: 'output', subfolder: item.subfolder || '', filename: item.filename };
    const scope = JSON.stringify([source.type, source.subfolder, source.filename]);
    const lifetime = wb.abortController.signal;
    let request = null;
    let unsubscribe = null;
    let data = null;
    let expanded = !hasPrompt;
    let restoreOpen = false;
    let focusAt = null;

    function render() {
        if (!data) return;
        host.replaceChildren();
        const visible = [], hidden = [];
        for (const row of data.candidates) (visibility.hidden(row, scope) ? hidden : visible).push(row);
        if (data.api_only) text(host, 'p', t('candidateApiOnly'), 'anomalous-workbench-muted');
        if (data.status === 'partial') text(host, 'p', t('candidatePartial'), 'anomalous-workbench-muted');
        if (!visible.length && !hidden.length) return;
        const group = document.createElement('details');
        group.className = 'anomalous-candidate-list';
        group.open = expanded;
        group.ontoggle = () => { if (group.isConnected) expanded = group.open; };
        host.appendChild(group);
        const summary = text(group, 'summary', t('candidateHeading', { count: visible.length }));
        text(group, 'p', t('candidateHelp'), 'anomalous-workbench-muted');
        const hideButtons = [];
        const label = row => [row.title, row.field].filter(Boolean).join(' · ') || t('candidateUnnamed');
        for (const [index, row] of visible.entries()) {
            const card = document.createElement('div');
            card.className = 'anomalous-workbench-prompt-card';
            group.appendChild(card);
            const bar = document.createElement('div');
            bar.className = 'anomalous-workbench-prompt-bar';
            card.appendChild(bar);
            const towards = [...new Set(row.destinations.filter(Boolean))].join(', ');
            text(bar, 'span', [label(row), t(row.source === 'api' ? 'candidateApi' : 'candidateWidget'), towards].filter(Boolean).join(' · '));
            action(bar, t('materialCopyPrompt'), b => copy(row.text, b, t('materialCopied'), t('materialCopyPrompt')));
            hideButtons.push(action(bar, t('candidateHide'), () => {
                focusAt = index;
                visibility.hide(row, scope);
            }));
            text(card, 'div', row.text, 'anomalous-workbench-prompt-content is-expanded');
        }
        let restore;
        if (hidden.length) {
            restore = action(host, t('candidateHidden', { count: hidden.length }), () => {
                restoreOpen = !restoreOpen;
                focusAt = 'restore';
                render();
            });
            restore.setAttribute('aria-expanded', String(restoreOpen));
            if (restoreOpen) {
                const restoreRows = rows => {
                    focusAt = 'restore';
                    visibility.restore(rows, scope);
                };
                for (const row of hidden) action(host, t('candidateRestoreOne', { name: label(row) }), () => restoreRows([row]));
                action(host, t('candidateRestoreAll'), () => restoreRows(hidden));
            }
        } else restoreOpen = false;
        if (focusAt !== null) {
            (hideButtons[focusAt] || restore || summary).focus();
            focusAt = null;
        }
    }

    function deactivate() {
        request?.abort();
        request = null;
        unsubscribe?.();
        unsubscribe = null;
    }
    lifetime.addEventListener('abort', deactivate, { once: true });
    async function activate() {
        if (lifetime.aborted || wb.items[wb.currentIndex] !== item) return;
        if (!unsubscribe) unsubscribe = visibility.subscribe(render);
        if (data) { render(); return; }
        if (request) return;
        const current = request = new AbortController();
        try {
            const response = await fetch('/anomalous/inspect_image_material', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: current.signal,
                body: JSON.stringify({ source_image: source, include_candidates: true }),
            });
            if (!response.ok) throw new Error('inspection failed');
            const payload = await response.json();
            if (current.signal.aborted || lifetime.aborted || wb.items[wb.currentIndex] !== item || !host.isConnected) return;
            if (payload.version === 1 && Array.isArray(payload.candidates)) {
                data = payload;
                render();
            }
        } catch {
            if (!current.signal.aborted && host.isConnected) host.textContent = t('candidateUnavailable');
        } finally {
            if (request === current) request = null;
        }
    }
    return { element, activate, deactivate };
}
