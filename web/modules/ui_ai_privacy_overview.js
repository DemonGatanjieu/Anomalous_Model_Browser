/**
 * Privacy Overview modal (Privacy chip in the header & ⋯ -> "隐私一览"): shows side-by-side what
 * stays hidden from the AI ([P*], [img*], [M*] + pictures) versus what the AI reads directly, and
 * lets the user write one brief note per hidden token ("给 AI 的备注", POST /sealed_notes).
 */

import { translate as t } from './locales.js';
import { MAX_SEALED_NOTE, buildPrivacyOverview, compareTokens } from './ai_privacy_view.js';
import { aiWindow } from './ui_ai_connect.js';
import { showStepRow } from './ui_ai_decisions.js';
import { icon } from './ui_ai_icons.js';
import { openSent } from './ui_ai_sent.js';
import { anomalousAlert } from './ui_dialog.js';
import { outputThumbnail } from './ui_kept_toast.js';

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

function renderHiddenCard(item, placeholder, draftNotes, onDraftChange, onCommit) {
    const card = el('div', 'anomalous-ai-priv-item');
    const head = el('div', 'anomalous-ai-priv-item-head');
    head.append(tokenBadge(item.token));

    if (item.filename) {
        const picRow = el('div', 'anomalous-ai-priv-pic-row');
        const thumb = document.createElement('img');
        thumb.className = 'anomalous-ai-priv-thumb';
        thumb.src = outputThumbnail({ filename: item.filename, subfolder: item.subfolder || '' });
        thumb.alt = item.path;
        thumb.loading = 'lazy';
        thumb.onerror = () => { thumb.style.display = 'none'; };
        picRow.append(thumb, el('span', 'anomalous-ai-priv-pic-path', item.path));
        card.append(head, picRow);
    } else if (item.file !== undefined) {
        if (item.type) head.append(el('span', 'anomalous-ai-priv-kind-tag', item.type));
        head.append(el('span', 'anomalous-ai-priv-model-name', item.file || item.raw));
        card.append(head);
    } else {
        card.append(head, el('div', 'anomalous-ai-priv-secret-text', item.text));
    }

    const noteRow = el('div', 'anomalous-ai-priv-note-row');
    const label = el('label', 'anomalous-ai-priv-note-label', t('aiPrivacyNoteLabel'));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-ai-priv-note-input';
    input.maxLength = MAX_SEALED_NOTE;
    input.value = draftNotes[item.token] ?? item.note ?? '';
    input.placeholder = placeholder;
    label.append(input);

    const state = el('span', 'anomalous-ai-priv-note-state');
    const syncState = (text = '') => { state.textContent = text; };
    input.oninput = () => {
        draftNotes[item.token] = input.value;
        onDraftChange(item.token, input.value, syncState);
    };
    input.onblur = () => { void onCommit(item.token, syncState); };
    input.onkeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        }
    };
    noteRow.append(label, state);
    card.append(noteRow);
    return card;
}

function renderMessagePreview(msg, closeOverview) {
    const row = el('button', 'anomalous-ai-priv-msg');
    row.type = 'button';
    row.title = t('aiPrivacyMsgJumpHint');
    const top = el('div', 'anomalous-ai-priv-msg-head');
    top.append(el('span', `anomalous-ai-priv-delivery${msg.delivered ? ' is-read' : ''}`,
        t(msg.delivered ? 'aiPrivacyMsgRead' : 'aiPrivacyMsgWaiting')));
    const body = el('div', 'anomalous-ai-priv-msg-text');
    for (const seg of msg.segments || []) {
        if (seg.type === 'token') body.append(tokenBadge(seg.token));
        else body.append(document.createTextNode(seg.text));
    }
    if (!msg.hasPlaintext) body.append(el('div', 'anomalous-ai-priv-msg-only-tokens', t('aiPrivacyMsgAllSealed')));
    row.append(top, body);
    row.onclick = () => {
        closeOverview();
        showStepRow(msg.stepId);
    };
    return row;
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
    const overview = buildPrivacyOverview(task);
    const body = el('div', 'anomalous-ai-priv-overview');
    const savedNotes = { ...overview.notes };
    const draftNotes = { ...overview.notes };
    const dirtyTokens = new Set();
    const stateSyncs = new Map();
    let anySaved = false;
    let timer = null;
    let closed = false;
    let pendingOnServer = overview.dirty;

    const statusLine = el('span', 'anomalous-ai-priv-save-status', noteStatusText(savedNotes, dirtyTokens, pendingOnServer));
    const visibleNotesList = el('div', 'anomalous-ai-priv-vnotes-list');
    renderVisibleNotes(visibleNotesList, draftNotes);
    let doneBtn = null;
    const syncDoneLabel = () => {
        if (doneBtn) doneBtn.textContent = t(dirtyTokens.size > 0 ? 'aiPrivacyOverviewSaveClose' : 'aiPrivacyOverviewSaveDone');
    };

    const headRight = el('div', 'anomalous-ai-priv-bar');
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
        toggleBtn.onclick = () => {
            close();
            void onTogglePrivacy(!overview.private);
        };
        actions.append(toggleBtn);
    }
    headRight.append(badges, actions);
    body.append(headRight);

    if (overview.readsDisk) {
        const reach = el('div', 'anomalous-ai-priv-reach');
        reach.append(icon('alert', 15), el('span', '', t('aiPrivacyReach', { app: overview.client })));
        body.append(reach);
    }

    const tip = el('div', 'anomalous-ai-priv-tip');
    tip.append(icon('info', 14), el('span', '', t('aiPrivacyNotesBanner')), statusLine);
    body.append(tip);

    const flushPatch = async (tokens) => {
        const patch = {};
        const touched = [];
        for (const tok of tokens) {
            const nextVal = String(draftNotes[tok] || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEALED_NOTE);
            if ((savedNotes[tok] || '') !== nextVal) {
                patch[tok] = nextVal;
                touched.push(tok);
            }
            dirtyTokens.delete(tok);
        }
        syncDoneLabel();
        if (!touched.length) {
            statusLine.textContent = noteStatusText(savedNotes, dirtyTokens, pendingOnServer);
            return;
        }
        statusLine.textContent = t('aiPrivacyNoteSaving');
        try {
            const serverNotes = await saveNotesPatch(task.id, patch);
            Object.keys(savedNotes).forEach(k => delete savedNotes[k]);
            Object.assign(savedNotes, serverNotes);
            if (Object.keys(serverNotes).length) task.sealed_notes = { ...serverNotes };
            else delete task.sealed_notes;
            task.sealed_notes_dirty = pendingOnServer = true;
            anySaved = true;
            for (const tok of touched) stateSyncs.get(tok)?.(t('aiPrivacyNoteSaved'));
            statusLine.textContent = noteStatusText(savedNotes, dirtyTokens, pendingOnServer);
        } catch (error) {
            statusLine.textContent = '';
            for (const tok of touched) stateSyncs.get(tok)?.('');
            if (!closed) await anomalousAlert(error.message);
        }
    };

    const onDraftChange = (token, _val, syncState) => {
        stateSyncs.set(token, syncState);
        dirtyTokens.add(token);
        syncState(t('aiPrivacyNoteSaving'));
        syncDoneLabel();
        statusLine.textContent = t('aiPrivacyNoteSaving');
        renderVisibleNotes(visibleNotesList, draftNotes);
        clearTimeout(timer);
        timer = setTimeout(() => { void flushPatch([...dirtyTokens]); }, 650);
    };

    const onCommit = async (token, syncState) => {
        stateSyncs.set(token, syncState);
        clearTimeout(timer);
        await flushPatch(dirtyTokens.size ? [...dirtyTokens] : [token]);
    };

    const columns = el('div', 'anomalous-ai-priv-columns');

    // Left column: hidden items
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

    const groups = [
        [overview.hidden.prompts, 'aiPrivacyGroupPrompts', 'aiPrivacyNotePlaceholderP'],
        [overview.hidden.pictures, 'aiPrivacyGroupPictures', 'aiPrivacyNotePlaceholderImg'],
        [overview.hidden.models, 'aiPrivacyGroupModels', 'aiPrivacyNotePlaceholderM'],
    ];
    for (const [items, groupKey, placeholderKey] of groups) {
        if (!items.length) continue;
        const groupBox = el('div', 'anomalous-ai-priv-group');
        groupBox.append(el('div', 'anomalous-ai-priv-group-title', t(groupKey)));
        if (groupKey === 'aiPrivacyGroupModels' && !overview.privacyModels) {
            groupBox.append(el('div', 'anomalous-ai-priv-warn-inline', t('aiPrivacyModelsVisibleWarn')));
        }
        for (const item of items) {
            groupBox.append(renderHiddenCard(item, t(placeholderKey), draftNotes, onDraftChange, onCommit));
        }
        hiddenCol.append(groupBox);
    }
    if (!overview.hidden.total) {
        hiddenCol.append(el('div', 'anomalous-ai-priv-empty', t('aiPrivacyHiddenEmpty')));
    }
    if (overview.unassignedToolboxModels > 0) {
        hiddenCol.append(el('div', 'anomalous-ai-priv-pending-hint', t('aiPrivacyToolboxPending', { n: overview.unassignedToolboxModels })));
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

    if (!overview.privacyModels) {
        visibleCol.append(el('div', 'anomalous-ai-priv-vcard is-warn', t('aiPrivacyVisibleModelsReal')));
    }

    const msgSection = el('div', 'anomalous-ai-priv-vcard');
    msgSection.append(el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleMessages')));
    if (overview.visible.messages.length) {
        const msgList = el('div', 'anomalous-ai-priv-msgs');
        for (const msg of overview.visible.messages) {
            msgList.append(renderMessagePreview(msg, () => close()));
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
    canvasCard.append(
        el('div', 'anomalous-ai-priv-vcard-label', t('aiPrivacyVisibleCanvas')),
        el('div', 'anomalous-ai-priv-vcard-sub', t('aiPrivacyVisibleCanvasDesc')),
    );
    if (overview.visible.decisionsCount > 0) {
        canvasCard.append(el('div', 'anomalous-ai-priv-vcard-foot',
            t('aiPrivacyVisibleDecisions', { n: overview.visible.decisionsCount })));
    }
    visibleCol.append(canvasCard);

    columns.append(hiddenCol, visibleCol);
    body.append(columns);

    const foot = el('div', 'anomalous-ai-priv-foot');
    doneBtn = el('button', 'anomalous-ai-tool anomalous-ai-priv-done', t('aiPrivacyOverviewSaveDone'));
    doneBtn.type = 'button';
    doneBtn.onclick = () => {
        if (dirtyTokens.size) void flushPatch([...dirtyTokens]).finally(() => close());
        else close();
    };
    foot.append(doneBtn);
    body.append(foot);

    const close = aiWindow(t('aiPrivacyOverview'), body, () => {
        closed = true;
        clearTimeout(timer);
        const unsaved = Object.keys(draftNotes).filter(tok => {
            const nextVal = String(draftNotes[tok] || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEALED_NOTE);
            return (savedNotes[tok] || '') !== nextVal;
        });
        if (unsaved.length) {
            void flushPatch(unsaved).finally(() => onChanged?.());
        } else if (anySaved) {
            onChanged?.();
        }
    });
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-privacy-overview');
    return close;
}
