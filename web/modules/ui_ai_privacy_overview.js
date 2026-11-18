/**
 * Privacy Overview window (the header's Privacy chip, ⋯ -> "隐私一览"), sorted by kind so a glance says where
 * to look:
 * - a head saying which privacy settings are in use (the recommended ones: both switches on, one press
 *   away), with its two switches (pictures and prompts kept from the AI, unchosen models hidden)
 * - a row of doors, one per kind (prompts, models, pictures, messages, the rest): how many, and a dot saying
 *   whether the AI gets only tokens (warm), reads them (green) or both; a press scrolls to that kind's table
 * - one table per kind, each row with a badge at its left (ui_ai_privacy_rows.js): a lock with the token the
 *   AI gets, or an eye where it reads the thing as it is. Prompts (as Prompt Studio's chips, words let
 *   through), models (their name switch, what the AI gets of them, the materials window on them), pictures
 *   (kept here, released: a boxed part or a stand-in), messages as the AI got them (ui_ai_privacy_messages.js)
 *   with the notes for the AI, and the rest (the title, the canvas)
 * Side by side (the choice kept in this browser; narrow windows stay one column), each table splits into
 * what stays here on the left and what the AI reads on the right, the prompts mirrored slot by slot
 * (ui_ai_privacy_mirror.js).
 */

import { translate as t } from './locales.js';
import { MAX_SEALED_NOTE, buildPrivacyOverview, compareTokens } from './ai_privacy_view.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { postPrivacyRule } from './ui_ai_privacy_adjust.js';
import { renderMessagePreview, tokenBadge } from './ui_ai_privacy_messages.js';
import { promptMirrors } from './ui_ai_privacy_mirror.js';
import { attachNoteInput, el, eyeBadge, linkButton, lockBadge, modelRow, modelSeesRow, pictureRow, promptRow, trow } from './ui_ai_privacy_rows.js';
import { openToolbox } from './ui_ai_toolbox.js';
import { releasedOf, releasedThumbs, requestStandin } from './ui_ai_released.js';
import { openSent } from './ui_ai_sent.js';
import { anomalousAlert } from './ui_dialog.js';

const INITIAL_MESSAGES = 4;
const LAYOUT_KEY = 'anomalous_privacy_layout'; // 'split' (side by side) or one column
const KINDS = { prompts: 'prompts', models: 'models', pictures: 'image', messages: 'chat', other: 'nodes' }; // kind -> its icon

function readLayout() {
    try {
        return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'single';
    } catch (_) {
        return 'single';
    }
}

function keepLayout(layout) {
    try {
        localStorage.setItem(LAYOUT_KEY, layout);
    } catch (_) { /* this browser keeps nothing: one column next time */ }
}

/** An on/off switch: a checkbox drawn as a switch (`role="switch"`; `<input switch>` is not in Chromium yet). */
function switchRow(label, on, onChange) {
    const row = el('label', 'anomalous-ai-priv-switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = on;
    input.onchange = () => onChange(input);
    row.append(el('span', '', label), input);
    return row;
}

/** A row's words: what it is in bold, then what the AI reads of it. */
function labelled(label, ...values) {
    const box = el('div', 'anomalous-ai-priv-labelled');
    box.append(el('strong', 'anomalous-ai-priv-row-title', label), ...values.map(value => (typeof value === 'string' ? el('div', 'anomalous-ai-priv-row-value', value) : value)));
    return box;
}

/**
 * The table of `kind`: one column of `single`; side by side, `pairs` ([left, right], either may be null) with
 * what stays here on the left and what the AI reads on the right, when both sides have something.
 */
function kindTable(kind, { single, pairs }, split) {
    const box = el('section', `anomalous-ai-priv-table is-${kind}`);
    const head = el('h3', 'anomalous-ai-priv-table-head');
    head.append(icon(KINDS[kind], 15), el('span', '', t(`aiPrivacyKind_${kind}`)));
    box.append(head);
    if (!(split && pairs?.some(([left]) => left) && pairs.some(([, right]) => right))) {
        box.append(...single);
        return box;
    }
    const grid = el('div', 'anomalous-ai-priv-pairs');
    grid.append(el('div', 'anomalous-ai-priv-side is-here', t('aiPrivacyHiddenHead')), el('div', 'anomalous-ai-priv-side is-ai', t('aiPrivacyVisibleHead')));
    for (const [left, right] of pairs) grid.append(left || el('div'), right || el('div'));
    box.append(grid);
    return box;
}

/** A door to `table`: the kind, a dot (`state`: lock, eye, mixed or none) and a line or two of how it stands. */
function door(kind, state, lines, table) {
    const button = el('button', `anomalous-ai-priv-door is-${state}`);
    button.type = 'button';
    const name = el('span', 'anomalous-ai-priv-door-name');
    name.append(icon(KINDS[kind], 14), el('span', '', t(`aiPrivacyKind_${kind}`)));
    const say = el('span', 'anomalous-ai-priv-door-lines');
    say.append(el('i', 'anomalous-ai-priv-door-dot'), ...lines.filter(Boolean).map(line => el('span', '', line)));
    button.append(name, say);
    button.onclick = () => table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return button;
}

function noteStatusText(savedNotes, dirtyTokens, pendingOnServer) {
    if (dirtyTokens.size > 0) return t('aiPrivacyNoteSaving');
    if (!Object.keys(savedNotes).length) return '';
    return pendingOnServer ? t('aiPrivacyNotePending') : t('aiPrivacyNoteDelivered');
}

function renderVisibleNotes(box, notesMap) {
    box.replaceChildren();
    const entries = Object.entries(notesMap)
        .map(([token, text]) => [token, String(text || '').trim()])
        .filter(([, text]) => Boolean(text))
        .sort(([a], [b]) => compareTokens(a, b));
    if (!entries.length) {
        box.append(el('div', '', t('aiPrivacyVisibleNotesNone')));
        return;
    }
    for (const [token, text] of entries) {
        const line = el('div', 'anomalous-ai-priv-vnote');
        line.append(tokenBadge(token), el('span', '', text));
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
        const visibleNotesList = el('div', 'anomalous-ai-priv-vnotes');
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

        const split = readLayout() === 'split';
        const openModel = (model) => { // the materials window on it; closing it comes back here
            close();
            void openToolbox(task, () => onChanged?.(), { kind: 'models', focus: model.id, layout: 'full', onClose: () => openPrivacyOverview(task, { onTogglePrivacy, onChanged }) });
        };
        const rowCtx = { draftNotes, onDraftChange, onCommit, onAdjusted, openModel };
        const noteFor = (token, named) => {
            const line = el('div', 'anomalous-ai-priv-mirror-note');
            if (named) line.append(tokenBadge(token));
            attachNoteInput(line, token, savedNotes[token], t('aiPrivacyNotePlaceholderP'), rowCtx);
            return line;
        };
        const mirrors = split ? promptMirrors(task, overview.hidden.prompts, { noteFor, onApplied: onAdjusted }) : null;

        // Head: the privacy settings as they stand (the recommended ones: both switches on), a press for those,
        // and the two switches; models the user chose for hold in every task (ui_ai_model_lock.js).
        const recommended = overview.private && overview.privacyModels;
        const state = recommended ? 'On' : overview.private ? 'Custom' : 'Off';
        const head = el('div', 'anomalous-ai-priv-head');
        // A picture says what the settings do (words → a code word → the AI): the words can be one line.
        const mark = el('img', `anomalous-ai-priv-head-art${overview.private ? ' is-on' : ''}`);
        mark.src = new URL('../assets/ai_privacy_codes.webp', import.meta.url).href;
        mark.alt = '';
        const copy = el('div', 'anomalous-ai-priv-head-copy');
        copy.append(el('strong', '', t(`aiPrivacyHead${state}`)), el('span', '', t(`aiPrivacyHead${state}Sub`)));
        if (!recommended && onTogglePrivacy) {
            copy.append(linkButton(t('aiPrivacyUseRecommended'), async (event) => {
                event.currentTarget.disabled = true;
                try {
                    if (!overview.privacyModels) await postPrivacyRule(task, { action: 'model_rule', privacy_models: true });
                } catch (error) {
                    await anomalousAlert(error.message);
                }
                if (overview.private) {
                    onAdjusted();
                    return;
                }
                close();
                void onTogglePrivacy(true);
            }, 'shield'));
        }
        const switches = el('div', 'anomalous-ai-priv-switches');
        if (onTogglePrivacy) {
            switches.append(switchRow(t('aiPrivacySwitchMain'), overview.private, (input) => { close(); void onTogglePrivacy(input.checked); }));
        }
        const modelSwitch = switches.appendChild(switchRow(t('aiPrivacyHideModels'), overview.privacyModels, async (input) => {
            input.disabled = true;
            try {
                await postPrivacyRule(task, { action: 'model_rule', privacy_models: input.checked });
                onAdjusted();
            } catch (error) {
                input.disabled = false;
                input.checked = !input.checked;
                await anomalousAlert(error.message);
            }
        }));
        modelSwitch.title = t('aiPrivacyLocksLine');
        head.append(mark, copy, switches);
        const parts = [head];

        if (overview.readsDisk) {
            const reach = el('div', 'anomalous-ai-priv-reach');
            reach.title = t('aiPrivacyReach', { app: overview.client }); // the whole of it on hover
            reach.append(icon('alert', 15), el('span', '', t('aiPrivacyReachLine', { app: overview.client })), icon('info', 13));
            parts.push(reach);
        }

        // Prompts: each hidden one with its token; words let through; side by side, mirrored slot by slot.
        const prompts = overview.hidden.prompts.map(item => promptRow(item, task, rowCtx));
        const exposed = overview.exposedPrompts.slice(-4).reverse().map(item => trow(eyeBadge(), el('div', 'anomalous-ai-priv-row-value', item.text)));
        const promptSingle = prompts.length || exposed.length ? [...prompts, ...exposed] : [el('div', 'anomalous-ai-priv-empty', t('aiPrivacyPromptsNone'))];
        const promptPairs = mirrors ? [...mirrors.left.map((left, at) => [left, mirrors.right[at]]), ...exposed.map(row => [null, row])] : null;

        const models = overview.modelCatalog.map(model => modelRow(model, task, rowCtx));

        // Pictures: hidden ones and the pictures made here stay; released parts and stand-ins go to the AI.
        const pictures = overview.hidden.pictures.map(item => [pictureRow(item, rowCtx), null]);
        const released = releasedOf(task);
        const kept = overview.hidden.generatedPictureCount;
        if (overview.private) {
            if (kept) pictures.push([trow(lockBadge(), el('div', 'anomalous-ai-priv-row-value', t('aiPrivacyStatPicturesKept', { count: kept }))), null]);
            const standin = el('button', 'anomalous-ai-tool');
            standin.type = 'button';
            standin.title = t('aiPrivacyStandinHint');
            standin.append(icon('image', 13), el('span', '', t('aiPrivacyStandin')));
            const said = el('div', 'anomalous-ai-priv-standin-state');
            standin.onclick = async () => {
                standin.disabled = true;
                said.textContent = t('aiPrivacyStandinRunning');
                try {
                    await requestStandin(task);
                    const fresh = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
                    if (Array.isArray(fresh?.task?.steps)) task.steps = fresh.task.steps;
                    onAdjusted();
                } catch (error) {
                    standin.disabled = false;
                    said.textContent = error.message;
                }
            };
            const none = el('div', 'anomalous-ai-priv-row-value', t('aiPrivacyVisibleReleasedNone'));
            none.title = t('aiPrivacyVisibleReleasedHow');
            pictures.push([null, trow(eyeBadge(), labelled(t('aiPrivacyVisibleReleased'),
                released.length ? releasedThumbs(task.id, released, window.anomalousBrowserInstance) : none, standin, said))]);
        } else {
            pictures.push([null, trow(eyeBadge(), el('div', 'anomalous-ai-priv-row-value', t('aiPrivacyDoorPicturesAll')))]);
        }

        // Messages as the AI got them, then the notes written for it.
        const messages = overview.visible.messages;
        const preview = msg => trow(eyeBadge(), renderMessagePreview(msg, task, { closeOverview: () => close(), onAdjusted }));
        const messageRows = [];
        if (messages.length) {
            const list = el('div', 'anomalous-ai-priv-msgs');
            list.append(...messages.slice(-INITIAL_MESSAGES).map(preview));
            if (messages.length > INITIAL_MESSAGES) {
                list.append(linkButton(t('aiPrivacyShowAllMessages', { count: messages.length }), () => list.replaceChildren(...messages.map(preview)), 'chevronDown'));
            }
            messageRows.push(list);
        } else {
            messageRows.push(el('div', 'anomalous-ai-priv-empty', t('aiPrivacyVisibleMessagesNone')));
        }
        messageRows.push(trow(eyeBadge(), labelled(t('aiPrivacyVisibleNotes'), visibleNotesList)));

        const canvas = [t('aiPrivacyVisibleCanvasDesc')];
        if (overview.visible.decisionsCount > 0) canvas.push(t('aiPrivacyVisibleDecisions', { n: overview.visible.decisionsCount }));
        const other = [
            trow(eyeBadge(), labelled(t('aiPrivacyVisibleTitle'), overview.visible.title || t('aiPrivacyVisibleTitleEmpty'))),
            trow(eyeBadge(), labelled(t('aiPrivacyVisibleCanvas'), ...canvas)),
        ];

        const tables = {
            prompts: kindTable('prompts', { single: promptSingle, pairs: promptPairs }, split),
            models: models.length ? kindTable('models', { single: models, pairs: models.map((row, at) => [row, modelSeesRow(overview.modelCatalog[at])]) }, split) : null,
            pictures: kindTable('pictures', { single: pictures.map(pair => pair[0] || pair[1]), pairs: pictures }, split),
            messages: kindTable('messages', { single: messageRows }, split),
            other: kindTable('other', { single: other }, split),
        };

        // Doors: how each kind stands, one press to its table.
        const hiddenModels = overview.modelCatalog.filter(m => m.hidden).length;
        const publicModels = overview.modelCatalog.length - hiddenModels;
        const lettered = overview.exposedPrompts.length;
        const doors = el('div', 'anomalous-ai-priv-doors');
        doors.append(
            door('prompts', overview.hidden.prompts.length ? (lettered ? 'mixed' : 'lock') : lettered ? 'eye' : 'none', [
                overview.hidden.prompts.length ? t('aiPrivacyDoorPromptsHidden', { n: overview.hidden.prompts.length }) : '',
                lettered ? t('aiPrivacyDoorPromptsShown', { n: lettered }) : '',
                overview.hidden.prompts.length || lettered ? '' : t('aiPrivacyDoorNone'),
            ], tables.prompts),
        );
        if (tables.models) {
            doors.append(door('models', hiddenModels ? (publicModels ? 'mixed' : 'lock') : 'eye', [
                hiddenModels ? t('aiPrivacyDoorModelsHidden', { n: hiddenModels }) : '',
                publicModels ? t('aiPrivacyDoorModelsShown', { n: publicModels }) : '',
            ], tables.models));
        }
        doors.append(
            door('pictures', !overview.private ? 'eye' : released.length ? 'mixed' : 'lock',
                [!overview.private ? t('aiPrivacyDoorPicturesAll') : released.length ? t('aiPrivacyDoorPicturesReleased', { count: released.length }) : t('aiPrivacyDoorPicturesNone')], tables.pictures),
            door('messages', messages.length ? 'eye' : 'none', [messages.length ? t('aiPrivacyDoorMessages', { count: messages.length }) : t('aiPrivacyDoorNone')], tables.messages),
            door('other', 'eye', [t('aiPrivacyDoorSeen')], tables.other),
        );
        parts.push(doors, ...Object.values(tables).filter(Boolean));

        const foot = el('div', 'anomalous-ai-priv-foot');
        doneBtn = el('button', 'anomalous-ai-tool anomalous-ai-priv-done', t(dirtyTokens.size > 0 ? 'aiPrivacyOverviewSaveClose' : 'aiPrivacyOverviewSaveDone'));
        doneBtn.type = 'button';
        doneBtn.onclick = () => {
            if (dirtyTokens.size) void flushPatch([...dirtyTokens]).finally(() => close());
            else close();
        };
        foot.append(linkButton(t('aiSent'), () => void openSent(task), 'tray'), statusLine, doneBtn);
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
    const dialog = body.closest('.anomalous-ai-connect-dialog');
    dialog?.classList.add('is-privacy-overview');
    dialog?.classList.toggle('is-split', readLayout() === 'split');
    // One column or side by side, beside the close button; the choice stays in this browser.
    const layouts = el('div', 'anomalous-ai-priv-layouts');
    layouts.setAttribute('role', 'radiogroup');
    layouts.setAttribute('aria-label', t('aiPrivacyLayout'));
    for (const layout of ['single', 'split']) {
        const choice = el('button', 'anomalous-ai-priv-layout');
        choice.type = 'button';
        choice.setAttribute('role', 'radio');
        choice.append(icon(layout === 'split' ? 'sidebar' : 'list', 13), el('span', '', t(layout === 'split' ? 'aiPrivacyLayoutSplit' : 'aiPrivacyLayoutSingle')));
        const mark = () => choice.setAttribute('aria-checked', String(readLayout() === layout));
        choice.onclick = () => {
            keepLayout(layout);
            dialog?.classList.toggle('is-split', layout === 'split');
            for (const each of layouts.children) each.dispatchEvent(new Event('anomalous-layout'));
            draw();
        };
        choice.addEventListener('anomalous-layout', mark);
        mark();
        layouts.append(choice);
    }
    dialog?.querySelector('.anomalous-ai-connect-close')?.before(layouts);
    return close;
}
