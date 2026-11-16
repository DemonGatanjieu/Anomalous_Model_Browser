/**
 * Privacy Overview modal (Privacy chip in the header & ⋯ -> "隐私一览"):
 * - Clean single outer scroll surface (3-line clamped prompts + progressive message list, thin auto-hide scrollbars)
 * - Left ("已隐藏"): [P*] prompts (with split/expose tags adjuster), [img*] thumbnails, [M*] / task models
 *   (with per-task and per-model hide/expose switch), plus one-line "Note for AI" inputs
 * - Right ("没隐藏"): title, masked message previews (+ retroactive "藏词" adjuster), exposed snippets,
 *   exposed models, live notes mirror, canvas structure/parameters
 */

import { translate as t } from './locales.js';
import { MAX_SEALED_NOTE, buildPrivacyOverview, compareTokens } from './ai_privacy_view.js';
import { aiWindow } from './ui_ai_connect.js';
import { showStepRow } from './ui_ai_decisions.js';
import { icon } from './ui_ai_icons.js';
import { postPrivacyRule, renderMessageSealer, renderPromptAdjuster } from './ui_ai_privacy_adjust.js';
import { openSent } from './ui_ai_sent.js';
import { anomalousAlert } from './ui_dialog.js';
import { outputThumbnail } from './ui_kept_toast.js';

const INITIAL_MESSAGES = 4;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function tokenBadge(token) {
    return el('span', 'anomalous-ai-priv-token', token);
}

function noteStatusText(savedNotes, dirtyTokens, pendingOnServer) {
    if (dirtyTokens.size > 0) return t('aiPrivacyNoteSaving');
    if (!Object.keys(savedNotes).length) return '';
    return pendingOnServer ? t('aiPrivacyNotePending') : t('aiPrivacyNoteDelivered');
}

function attachNoteInput(card, token, currentNote, placeholder, draftNotes, onDraftChange, onCommit) {
    const noteRow = el('div', 'anomalous-ai-priv-note-row');
    const label = el('label', 'anomalous-ai-priv-note-label', t('aiPrivacyNoteLabel'));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-ai-priv-note-input';
    input.maxLength = MAX_SEALED_NOTE;
    input.value = draftNotes[token] ?? currentNote ?? '';
    input.placeholder = placeholder;
    label.append(input);

    const state = el('span', 'anomalous-ai-priv-note-state');
    const syncState = (text = '') => { state.textContent = text; };
    input.oninput = () => {
        draftNotes[token] = input.value;
        onDraftChange(token, input.value, syncState);
    };
    input.onblur = () => { void onCommit(token, syncState); };
    input.onkeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        }
    };
    noteRow.append(label, state);
    card.append(noteRow);
}

function renderPromptCard(item, task, ctx) {
    const card = el('div', 'anomalous-ai-priv-item');
    const head = el('div', 'anomalous-ai-priv-item-head');
    head.append(tokenBadge(item.token));

    const splitBtn = el('button', 'anomalous-ai-priv-mini-btn', t('aiPrivacySplitBtn'));
    splitBtn.type = 'button';
    head.append(splitBtn);
    card.append(head);

    const textBox = el('div', 'anomalous-ai-priv-secret-text is-clamped', item.text);
    card.append(textBox);
    if (item.text.length > 105 || item.text.includes('\n')) {
        let expanded = false;
        const more = el('button', 'anomalous-ai-priv-expand-btn', t('aiPrivacyExpandText'));
        more.type = 'button';
        more.onclick = () => {
            expanded = !expanded;
            textBox.classList.toggle('is-clamped', !expanded);
            more.textContent = t(expanded ? 'aiPrivacyCollapseText' : 'aiPrivacyExpandText');
        };
        card.append(more);
    }

    let adjuster = null;
    splitBtn.onclick = () => {
        if (adjuster) {
            adjuster.remove();
            adjuster = null;
            return;
        }
        adjuster = renderPromptAdjuster(item, task, {
            onClose: () => { adjuster?.remove(); adjuster = null; },
            onApplied: () => ctx.onAdjusted(),
        });
        card.append(adjuster);
    };

    attachNoteInput(card, item.token, item.note, t('aiPrivacyNotePlaceholderP'),
        ctx.draftNotes, ctx.onDraftChange, ctx.onCommit);
    return card;
}

function renderPictureCard(item, ctx) {
    const card = el('div', 'anomalous-ai-priv-item');
    const head = el('div', 'anomalous-ai-priv-item-head');
    head.append(tokenBadge(item.token));

    const picRow = el('div', 'anomalous-ai-priv-pic-row');
    const thumb = document.createElement('img');
    thumb.className = 'anomalous-ai-priv-thumb';
    thumb.src = outputThumbnail({ filename: item.filename, subfolder: item.subfolder || '' });
    thumb.alt = item.path;
    thumb.loading = 'lazy';
    thumb.onerror = () => { thumb.style.display = 'none'; };
    picRow.append(thumb, el('span', 'anomalous-ai-priv-pic-path', item.path));
    card.append(head, picRow);

    attachNoteInput(card, item.token, item.note, t('aiPrivacyNotePlaceholderImg'),
        ctx.draftNotes, ctx.onDraftChange, ctx.onCommit);
    return card;
}

function renderModelCard(model, task, ctx) {
    const card = el('div', `anomalous-ai-priv-item${model.hidden ? '' : ' is-exposed-row'}`);
    const head = el('div', 'anomalous-ai-priv-item-head');
    if (model.hidden && model.token) head.append(tokenBadge(model.token));
    else if (!model.hidden) head.append(el('span', 'anomalous-ai-priv-exposed-pill', t('aiPrivacyModelPublicBadge')));
    if (model.type) head.append(el('span', 'anomalous-ai-priv-kind-tag', model.type));
    head.append(el('span', 'anomalous-ai-priv-model-name', model.file || model.id));

    const flipBtn = el('button', `anomalous-ai-priv-mini-btn${model.hidden ? '' : ' is-expose'}`,
        t(model.hidden ? 'aiPrivacyModelMakePublic' : 'aiPrivacyModelMakeHidden'));
    flipBtn.type = 'button';
    flipBtn.onclick = async () => {
        flipBtn.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'model_rule', model_id: model.id, hidden: !model.hidden });
            ctx.onAdjusted();
        } catch (error) {
            flipBtn.disabled = false;
            await anomalousAlert(error.message);
        }
    };
    head.append(flipBtn);
    card.append(head);

    if (model.hidden && model.token) {
        attachNoteInput(card, model.token, model.note, t('aiPrivacyNotePlaceholderM'),
            ctx.draftNotes, ctx.onDraftChange, ctx.onCommit);
    }
    return card;
}

function renderMessagePreview(msg, task, { closeOverview, onAdjusted }) {
    const wrap = el('div', 'anomalous-ai-priv-msg');
    const top = el('div', 'anomalous-ai-priv-msg-head');
    top.append(el('span', `anomalous-ai-priv-delivery${msg.delivered ? ' is-read' : ''}`,
        t(msg.delivered ? 'aiPrivacyMsgRead' : 'aiPrivacyMsgWaiting')));

    const btns = el('div', 'anomalous-ai-priv-msg-btns');
    if (msg.hasPlaintext) {
        const sealBtn = el('button', 'anomalous-ai-priv-mini-btn', t('aiPrivacySealMoreBtn'));
        sealBtn.type = 'button';
        let sealer = null;
        sealBtn.onclick = () => {
            if (sealer) { sealer.remove(); sealer = null; return; }
            sealer = renderMessageSealer(msg, task, {
                onClose: () => { sealer?.remove(); sealer = null; },
                onApplied: () => onAdjusted(),
            });
            wrap.append(sealer);
        };
        btns.append(sealBtn);
    }
    const jumpBtn = el('button', 'anomalous-ai-priv-mini-btn', t('aiPrivacyMsgJump'));
    jumpBtn.type = 'button';
    jumpBtn.title = t('aiPrivacyMsgJumpHint');
    jumpBtn.onclick = () => { closeOverview(); showStepRow(msg.stepId); };
    btns.append(jumpBtn);
    top.append(btns);

    const body = el('div', 'anomalous-ai-priv-msg-text');
    for (const seg of msg.segments || []) {
        if (seg.type === 'token') body.append(tokenBadge(seg.token));
        else body.append(document.createTextNode(seg.text));
    }
    if (!msg.hasPlaintext) body.append(el('div', 'anomalous-ai-priv-msg-only-tokens', t('aiPrivacyMsgAllSealed')));
    wrap.append(top, body);
    return wrap;
}

function renderVisibleNotes(box, notesMap) {
    box.replaceChildren();
    const entries = Object.entries(notesMap)
        .map(([token, text]) => [token, String(text || '').trim()])
        .filter(([, text]) => Boolean(text))
        .sort(([a], [b]) => compareTokens(a, b));
    if (!entries.length) {
        box.append(el('div', 'anomalous-ai-priv-empty-small', t('aiPrivacyVisibleNotesNone')));
        return;
    }
    for (const [token, text] of entries) {
        const line = el('div', 'anomalous-ai-priv-vnote');
        line.append(tokenBadge(token), el('span', 'anomalous-ai-priv-vnote-text', text));
        box.append(line);
    }
}

async function saveNotesPatch(taskId, patch) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/sealed_notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: patch }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
    return (await response.json()).sealed_notes || {};
}

/** Open the Privacy Overview modal for `task`. */
export function openPrivacyOverview(task, { onTogglePrivacy, onChanged } = {}) {
    if (!task) return;
    const body = el('div', 'anomalous-ai-priv-overview');
    const dirtyTokens = new Set();
    const stateSyncs = new Map();
    let anyChanged = false;
    let timer = null;
    let closed = false;
    let draftNotes = { ...(task.sealed_notes || {}) };
    let savedNotes = { ...(task.sealed_notes || {}) };

    const flushPatch = async (tokens) => {
        const patch = {};
        const touched = [];
        for (const tok of tokens) {
            if (!task.sealed?.[tok]) continue;
            const nextVal = String(draftNotes[tok] || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEALED_NOTE);
            if ((savedNotes[tok] || '') !== nextVal) {
                patch[tok] = nextVal;
                touched.push(tok);
            }
            dirtyTokens.delete(tok);
        }
        if (!touched.length) return;
        try {
            const serverNotes = await saveNotesPatch(task.id, patch);
            savedNotes = { ...serverNotes };
            if (Object.keys(serverNotes).length) task.sealed_notes = { ...serverNotes };
            else delete task.sealed_notes;
            task.sealed_notes_dirty = true;
            anyChanged = true;
            for (const tok of touched) stateSyncs.get(tok)?.(t('aiPrivacyNoteSaved'));
        } catch (error) {
            for (const tok of touched) stateSyncs.get(tok)?.('');
            if (!closed) await anomalousAlert(error.message);
        }
    };

    const draw = () => {
        const overview = buildPrivacyOverview(task);
        savedNotes = { ...overview.notes };
        for (const k of Object.keys(draftNotes)) if (!task.sealed?.[k]) delete draftNotes[k];
        for (const [k, v] of Object.entries(savedNotes)) if (!dirtyTokens.has(k)) draftNotes[k] = v;

        const statusLine = el('span', 'anomalous-ai-priv-save-status',
            noteStatusText(savedNotes, dirtyTokens, overview.dirty));
        const visibleNotesList = el('div', 'anomalous-ai-priv-vnotes-list');
        renderVisibleNotes(visibleNotesList, draftNotes);
        let doneBtn = null;
        const syncDoneLabel = () => {
            if (doneBtn) doneBtn.textContent = t(dirtyTokens.size > 0 ? 'aiPrivacyOverviewSaveClose' : 'aiPrivacyOverviewSaveDone');
        };

        const onDraftChange = (token, _val, syncState) => {
            stateSyncs.set(token, syncState);
            dirtyTokens.add(token);
            syncState(t('aiPrivacyNoteSaving'));
            syncDoneLabel();
            statusLine.textContent = t('aiPrivacyNoteSaving');
            renderVisibleNotes(visibleNotesList, draftNotes);
            clearTimeout(timer);
            timer = setTimeout(() => { void flushPatch([...dirtyTokens]).then(() => { statusLine.textContent = noteStatusText(savedNotes, dirtyTokens, task.sealed_notes_dirty); syncDoneLabel(); }); }, 650);
        };

        const onCommit = async (token, syncState) => {
            stateSyncs.set(token, syncState);
            clearTimeout(timer);
            await flushPatch(dirtyTokens.size ? [...dirtyTokens] : [token]);
            statusLine.textContent = noteStatusText(savedNotes, dirtyTokens, task.sealed_notes_dirty);
            syncDoneLabel();
        };

        const onAdjusted = () => {
            anyChanged = true;
            draw();
        };

        const rowCtx = { draftNotes, onDraftChange, onCommit, onAdjusted };
        const bar = el('div', 'anomalous-ai-priv-bar');
        const badges = el('div', 'anomalous-ai-priv-badges');
        badges.append(
            el('span', `anomalous-ai-priv-pill ${overview.private ? 'is-on' : 'is-off'}`,
                t(overview.private ? 'aiPrivacyStateOn' : 'aiPrivacyStateOff')),
            el('span', `anomalous-ai-priv-pill ${overview.privacyModels ? 'is-muted' : 'is-warn'}`,
                t(overview.privacyModels ? 'aiPrivacyModelsOn' : 'aiPrivacyModelsOff')),
        );
        const actions = el('div', 'anomalous-ai-priv-actions');
        const sentBtn = el('button', 'anomalous-ai-tool', t('aiSent'));
        sentBtn.type = 'button';
        sentBtn.onclick = () => void openSent(task);
        actions.append(sentBtn);
        if (onTogglePrivacy) {
            const toggleBtn = el('button', 'anomalous-ai-tool', t(overview.private ? 'aiPrivacyOverviewToggleOff' : 'aiPrivacyOverviewToggleOn'));
            toggleBtn.type = 'button';
            toggleBtn.onclick = () => { close(); void onTogglePrivacy(!overview.private); };
            actions.append(toggleBtn);
        }
        bar.append(badges, actions);

        const parts = [bar];
        if (overview.readsDisk) {
            const reach = el('div', 'anomalous-ai-priv-reach');
            reach.append(icon('alert', 15), el('span', '', t('aiPrivacyReach', { app: overview.client })));
            parts.push(reach);
        }
        const tip = el('div', 'anomalous-ai-priv-tip');
        tip.append(icon('info', 14), el('span', '', t('aiPrivacyNotesBanner')), statusLine);
        parts.push(tip);

        const columns = el('div', 'anomalous-ai-priv-columns');

        // Left column: hidden items + per-model controls
        const hiddenCol = el('section', 'anomalous-ai-priv-col is-hidden');
        const hiddenHead = el('div', 'anomalous-ai-priv-col-head');
        hiddenHead.append(icon('lock', 15), el('h3', '', t('aiPrivacyHiddenHead')),
            el('span', 'anomalous-ai-priv-count', t('aiPrivacyItemsCount', { n: overview.hidden.total })));
        hiddenCol.append(hiddenHead);
        if (overview.private) {
            hiddenCol.append(el('div', 'anomalous-ai-priv-rule',
                overview.hidden.generatedPictureCount > 0
                    ? t('aiPrivacyPicRuleCount', { count: overview.hidden.generatedPictureCount })
                    : t('aiPrivacyPicRule')));
        }
        if (overview.hidden.prompts.length) {
            const g = el('div', 'anomalous-ai-priv-group');
            g.append(el('div', 'anomalous-ai-priv-group-title', t('aiPrivacyGroupPrompts')),
                ...overview.hidden.prompts.map(item => renderPromptCard(item, task, rowCtx)));
            hiddenCol.append(g);
        }
        if (overview.hidden.pictures.length) {
            const g = el('div', 'anomalous-ai-priv-group');
            g.append(el('div', 'anomalous-ai-priv-group-title', t('aiPrivacyGroupPictures')),
                ...overview.hidden.pictures.map(item => renderPictureCard(item, rowCtx)));
            hiddenCol.append(g);
        }

        // Models section (always offers task-wide switch + per-model switches cleanly)
        const modelGroup = el('div', 'anomalous-ai-priv-group');
        const modelHead = el('div', 'anomalous-ai-priv-group-head');
        modelHead.append(el('span', 'anomalous-ai-priv-group-title', t('aiPrivacyGroupModels')));
        const modelTaskSwitch = el('button', 'anomalous-ai-priv-mini-btn',
            t(overview.privacyModels ? 'aiPrivacyTaskModelsTurnOff' : 'aiPrivacyTaskModelsTurnOn'));
        modelTaskSwitch.type = 'button';
        modelTaskSwitch.onclick = async () => {
            modelTaskSwitch.disabled = true;
            try {
                await postPrivacyRule(task, { action: 'model_rule', privacy_models: !overview.privacyModels });
                onAdjusted();
            } catch (error) {
                modelTaskSwitch.disabled = false;
                await anomalousAlert(error.message);
            }
        };
        modelHead.append(modelTaskSwitch);
        modelGroup.append(modelHead);
        for (const model of overview.modelCatalog) {
            modelGroup.append(renderModelCard(model, task, rowCtx));
        }
        hiddenCol.append(modelGroup);

        if (!overview.hidden.total && !overview.modelCatalog.length) {
            hiddenCol.append(el('div', 'anomalous-ai-priv-empty', t('aiPrivacyHiddenEmpty')));
        }

        // Right column: visible items
        const visibleCol = el('section', 'anomalous-ai-priv-col is-visible');
        const visibleHead = el('div', 'anomalous-ai-priv-col-head');
        visibleHead.append(icon('chat', 15), el('h3', '', t('aiPrivacyVisibleHead')));
        visibleCol.append(visibleHead);

        const titleCard = el('div', 'anomalous-ai-priv-vcard');
        const titleTop = el('div', 'anomalous-ai-priv-vcard-head');
        titleTop.append(el('span', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleTitle')),
            el('span', 'anomalous-ai-priv-tag', t('aiPrivacyVisibleAlways')));
        titleCard.append(titleTop, el('div', 'anomalous-ai-priv-vcard-val', overview.visible.title || t('aiPrivacyVisibleTitleEmpty')));
        visibleCol.append(titleCard);

        const publicModels = overview.modelCatalog.filter(m => !m.hidden);
        if (publicModels.length) {
            const pubCard = el('div', 'anomalous-ai-priv-vcard is-warn');
            pubCard.append(el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleModelsReal')));
            for (const m of publicModels) pubCard.append(el('div', 'anomalous-ai-priv-vcard-sub', m.file || m.id));
            visibleCol.append(pubCard);
        }
        if (overview.exposedPrompts.length) {
            const expCard = el('div', 'anomalous-ai-priv-vcard');
            expCard.append(el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleExposedPrompts')));
            for (const item of overview.exposedPrompts.slice(-4).reverse()) {
                expCard.append(el('div', 'anomalous-ai-priv-vcard-sub', item.text));
            }
            visibleCol.append(expCard);
        }

        const msgSection = el('div', 'anomalous-ai-priv-vcard');
        msgSection.append(el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleMessages')));
        if (overview.visible.messages.length) {
            const msgList = el('div', 'anomalous-ai-priv-msgs');
            const total = overview.visible.messages.length;
            const shown = overview.visible.messages.slice(-INITIAL_MESSAGES);
            for (const msg of shown) msgList.append(renderMessagePreview(msg, task, { closeOverview: () => close(), onAdjusted }));
            if (total > INITIAL_MESSAGES) {
                const showMore = el('button', 'anomalous-ai-priv-expand-btn', t('aiPrivacyShowAllMessages', { count: total }));
                showMore.type = 'button';
                showMore.onclick = () => {
                    msgList.replaceChildren(...overview.visible.messages.map(m => renderMessagePreview(m, task, { closeOverview: () => close(), onAdjusted })));
                };
                msgList.append(showMore);
            }
            msgSection.append(msgList);
        } else {
            msgSection.append(el('div', 'anomalous-ai-priv-empty-small', t('aiPrivacyVisibleMessagesNone')));
        }
        visibleCol.append(msgSection);

        const vNotesCard = el('div', 'anomalous-ai-priv-vcard');
        vNotesCard.append(el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleNotes')), visibleNotesList);
        visibleCol.append(vNotesCard);

        const canvasCard = el('div', 'anomalous-ai-priv-vcard');
        canvasCard.append(el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleCanvas')),
            el('div', 'anomalous-ai-priv-vcard-sub', t('aiPrivacyVisibleCanvasDesc')));
        if (overview.visible.decisionsCount > 0) {
            canvasCard.append(el('div', 'anomalous-ai-priv-vcard-foot', t('aiPrivacyVisibleDecisions', { n: overview.visible.decisionsCount })));
        }
        visibleCol.append(canvasCard);

        columns.append(hiddenCol, visibleCol);
        parts.push(columns);

        const foot = el('div', 'anomalous-ai-priv-foot');
        doneBtn = el('button', 'anomalous-ai-tool anomalous-ai-priv-done', t(dirtyTokens.size > 0 ? 'aiPrivacyOverviewSaveClose' : 'aiPrivacyOverviewSaveDone'));
        doneBtn.type = 'button';
        doneBtn.onclick = () => {
            if (dirtyTokens.size) void flushPatch([...dirtyTokens]).finally(() => close());
            else close();
        };
        foot.append(doneBtn);
        parts.push(foot);
        body.replaceChildren(...parts);
    };

    draw();
    const close = aiWindow(t('aiPrivacyOverview'), body, () => {
        closed = true;
        clearTimeout(timer);
        const unsaved = Object.keys(draftNotes).filter(tok => {
            const nextVal = String(draftNotes[tok] || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEALED_NOTE);
            return task.sealed?.[tok] && (savedNotes[tok] || '') !== nextVal;
        });
        if (unsaved.length) void flushPatch(unsaved).finally(() => onChanged?.());
        else if (anyChanged) onChanged?.();
    });
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-privacy-overview');
    return close;
}
