/**
 * Inline privacy adjusters inside Privacy Overview (ui_ai_privacy_overview.js):
 * - Split a `[P*]` prompt into kept-hidden tags/phrases + exposed plaintext (tag pills + text highlight)
 * - Retroactively seal an unsealed phrase from a user message in the "Visible" column
 * - Toggle per-task model hiding or individual model hide/expose (`POST /privacy_rules`)
 */

import { translate as t } from './locales.js';
import { splitPromptParts } from './ai_privacy_view.js';
import { icon } from './ui_ai_icons.js';
import { anomalousAlert } from './ui_dialog.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** Call `POST /anomalous/ai_tasks/{id}/privacy_rules` and sync `task` fields in place. */
export async function postPrivacyRule(task, payload) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/privacy_rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
    const snapshot = await response.json();
    task.privacy_models = snapshot.privacy_models;
    task.privacy_models_source = snapshot.privacy_models_source;
    task.sealed = snapshot.sealed || {};
    if (snapshot.sealed_legacy && Object.keys(snapshot.sealed_legacy).length) task.sealed_legacy = snapshot.sealed_legacy;
    else delete task.sealed_legacy;
    if (snapshot.sealed_notes && Object.keys(snapshot.sealed_notes).length) task.sealed_notes = snapshot.sealed_notes;
    else delete task.sealed_notes;
    if (snapshot.public_models?.length) task.public_models = snapshot.public_models;
    else delete task.public_models;
    if (snapshot.private_models?.length) task.private_models = snapshot.private_models;
    else delete task.private_models;
    if (snapshot.exposed_prompts?.length) task.exposed_prompts = snapshot.exposed_prompts;
    else delete task.exposed_prompts;
    return snapshot;
}

/**
 * Inline tag-pill / phrase splitter mounted inside a `[P*]` card.
 * `onClose()` closes the panel; `onApplied()` redraws Privacy Overview cleanly.
 */
export function renderPromptAdjuster(item, task, { onClose, onApplied }) {
    const box = el('div', 'anomalous-ai-priv-adjust');
    box.append(el('div', 'anomalous-ai-priv-adjust-warn', t('aiPrivacySplitWarn')));
    const split = item.split || splitPromptParts(item.text);

    let mode = split.mode === 'tags' ? 'tags' : 'text';
    const exposedIdx = new Set();
    let exposedPhrase = '';

    const stage = el('div', 'anomalous-ai-priv-adjust-stage');
    const modeSwitch = el('div', 'anomalous-ai-priv-adjust-modes');
    const applyBtn = el('button', 'anomalous-ai-tool is-primary', t('aiPrivacySplitApply'));
    applyBtn.type = 'button';

    const syncApply = () => {
        if (mode === 'tags') applyBtn.disabled = exposedIdx.size === 0;
        else applyBtn.disabled = !exposedPhrase.trim() || exposedPhrase.trim() === item.text.trim() ? (!exposedPhrase.trim()) : false;
    };

    const drawStage = () => {
        stage.replaceChildren();
        modeSwitch.replaceChildren();
        if (split.mode === 'tags') {
            for (const kind of ['tags', 'text']) {
                const tab = el('button', `anomalous-ai-priv-mode${mode === kind ? ' is-on' : ''}`, t(kind === 'tags' ? 'aiPrivacyModeTags' : 'aiPrivacyModeText'));
                tab.type = 'button';
                tab.onclick = () => { mode = kind; drawStage(); syncApply(); };
                modeSwitch.append(tab);
            }
            stage.append(modeSwitch);
        }

        if (mode === 'tags') {
            stage.append(el('div', 'anomalous-ai-priv-adjust-hint', t('aiPrivacySplitTagsHint')));
            const pills = el('div', 'anomalous-ai-priv-tags');
            split.parts.forEach((part, idx) => {
                const pill = el('button', `anomalous-ai-priv-tagpill${exposedIdx.has(idx) ? ' is-exposed' : ''}`, part);
                pill.type = 'button';
                pill.prepend(icon(exposedIdx.has(idx) ? 'check' : 'lock', 11));
                pill.onclick = () => {
                    if (exposedIdx.has(idx)) exposedIdx.delete(idx);
                    else exposedIdx.add(idx);
                    pill.classList.toggle('is-exposed', exposedIdx.has(idx));
                    pill.replaceChildren(icon(exposedIdx.has(idx) ? 'check' : 'lock', 11), document.createTextNode(part));
                    syncApply();
                };
                pills.append(pill);
            });
            stage.append(pills);
        } else {
            stage.append(el('div', 'anomalous-ai-priv-adjust-hint', t('aiPrivacySplitTextHint')));
            const area = document.createElement('textarea');
            area.className = 'anomalous-ai-priv-adjust-area';
            area.readOnly = true;
            area.rows = Math.min(4, Math.max(2, Math.ceil(item.text.length / 48)));
            area.value = item.text;
            const pickLine = el('div', 'anomalous-ai-priv-pick-line');
            const chosenPreview = el('span', 'anomalous-ai-priv-pick-preview', exposedPhrase ? t('aiPrivacyPickedExpose', { words: exposedPhrase }) : t('aiPrivacyPickNone'));
            const markBtn = el('button', 'anomalous-ai-tool', t('aiPrivacyMarkExposeBtn'));
            markBtn.type = 'button';
            markBtn.onmousedown = (e) => e.preventDefault();
            markBtn.onclick = () => {
                const start = area.selectionStart ?? 0;
                const end = area.selectionEnd ?? 0;
                const picked = area.value.slice(start, end).trim();
                if (picked.length < 2) return;
                exposedPhrase = picked;
                chosenPreview.textContent = t('aiPrivacyPickedExpose', { words: exposedPhrase });
                syncApply();
            };
            pickLine.append(markBtn, chosenPreview);
            stage.append(area, pickLine);
        }
        syncApply();
    };

    const actions = el('div', 'anomalous-ai-priv-adjust-actions');
    const cancelBtn = el('button', 'anomalous-ai-tool', t('aiPrivacyAdjustCancel'));
    cancelBtn.type = 'button';
    cancelBtn.onclick = onClose;

    applyBtn.onclick = async () => {
        let keepText = '';
        let exposeText = '';
        if (mode === 'tags') {
            const kept = [];
            const exposed = [];
            split.parts.forEach((part, idx) => (exposedIdx.has(idx) ? exposed : kept).push(part));
            keepText = kept.join(', ');
            exposeText = exposed.join(', ');
        } else {
            exposeText = exposedPhrase.trim();
            const at = item.text.indexOf(exposeText);
            keepText = (at >= 0 ? `${item.text.slice(0, at)} ${item.text.slice(at + exposeText.length)}` : item.text)
                .replace(/\s*[,，]\s*[,，]+\s*/g, ', ')
                .replace(/^\s*[,，]\s*|\s*[,，]\s*$/g, '')
                .trim();
        }
        applyBtn.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'split_prompt', token: item.token, keep_text: keepText, expose_text: exposeText });
            onApplied();
        } catch (error) {
            applyBtn.disabled = false;
            await anomalousAlert(error.message);
        }
    };

    actions.append(cancelBtn, applyBtn);
    drawStage();
    box.append(stage, actions);
    return box;
}

/**
 * Inline phrase sealer mounted on an unsealed message card in the right ("Visible") column.
 */
export function renderMessageSealer(msg, task, { onClose, onApplied }) {
    const box = el('div', 'anomalous-ai-priv-adjust');
    if (msg.delivered) box.append(el('div', 'anomalous-ai-priv-adjust-warn', t('aiPrivacySealRetroWarn')));
    box.append(el('div', 'anomalous-ai-priv-adjust-hint', t('aiPrivacySealPhraseHint')));

    const area = document.createElement('textarea');
    area.className = 'anomalous-ai-priv-adjust-area';
    area.readOnly = true;
    area.rows = Math.min(4, Math.max(2, Math.ceil(msg.raw.length / 48)));
    area.value = msg.raw;

    const actions = el('div', 'anomalous-ai-priv-adjust-actions');
    const cancelBtn = el('button', 'anomalous-ai-tool', t('aiPrivacyAdjustCancel'));
    cancelBtn.type = 'button';
    cancelBtn.onclick = onClose;

    const sealBtn = el('button', 'anomalous-ai-tool is-primary', t('aiPrivacySealPhraseBtn'));
    sealBtn.type = 'button';
    sealBtn.onmousedown = (e) => e.preventDefault();
    sealBtn.onclick = async () => {
        const picked = area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0).trim();
        if (picked.length < 2) {
            await anomalousAlert(t('aiHideMarkNone'));
            return;
        }
        sealBtn.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'seal_message_phrase', step_id: msg.stepId || '', phrase: picked });
            onApplied();
        } catch (error) {
            sealBtn.disabled = false;
            await anomalousAlert(error.message);
        }
    };

    actions.append(cancelBtn, sealBtn);
    box.append(area, actions);
    return box;
}
