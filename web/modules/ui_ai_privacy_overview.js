/**
 * Privacy Overview window (the header's Privacy chip, ⋯ -> "隐私一览"), one column to read down:
 * - a head saying which privacy settings are in use (the recommended ones: both switches on, one press
 *   away), with its two switches (pictures and prompts kept from the AI, unchosen models hidden)
 * - three counts: hidden prompts, hidden model names, pictures sent
 * - "What the AI can't see": each hidden prompt as Prompt Studio's chips (pick words to let through),
 *   pictures and models (hide / show each, kept with the model for every task, api/ai_model_choice.py;
 *   a model's trigger words under it), each with the token the AI gets and a note for the AI
 * - "What the AI can see": the title, real model names, words let through, the messages as the AI
 *   got them (+ hide more words afterwards), the notes, the canvas
 * A model row unfolds what the AI gets of it and what stays here, and opens it in the materials window
 * (its switch and description paragraphs, ui_ai_toolbox.js), coming back here when that closes. The window
 * reads in one column or side by side (the choice kept in this browser), the prompts then mirrored slot by
 * slot on both sides (ui_ai_privacy_mirror.js); narrow windows stay one column.
 */

import { translate as t } from './locales.js';
import { MAX_SEALED_NOTE, buildPrivacyOverview, compareTokens } from './ai_privacy_view.js';
import { aiWindow } from './ui_ai_connect.js';
import { showStepRow } from './ui_ai_decisions.js';
import { icon } from './ui_ai_icons.js';
import { postPrivacyRule, renderHiddenPrompt, renderMessageSealer } from './ui_ai_privacy_adjust.js';
import { promptMirrors } from './ui_ai_privacy_mirror.js';
import { openToolbox } from './ui_ai_toolbox.js';
import { loadCatalog } from './ai_toolbox_data.js';
import { typeLabel } from './ui_model_types.js';
import { releasedOf, releasedThumbs, requestStandin } from './ui_ai_released.js';
import { openSent } from './ui_ai_sent.js';
import { anomalousAlert } from './ui_dialog.js';
import { outputThumbnail } from './ui_kept_toast.js';

const INITIAL_MESSAGES = 4;
const LAYOUT_KEY = 'anomalous_privacy_layout'; // 'split' (side by side) or one column

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

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function tokenBadge(token) {
    return el('span', 'anomalous-ai-priv-token', token);
}

/** What the AI gets in place of a hidden item. */
function seesPill(token) {
    const pill = el('span', 'anomalous-ai-priv-sees');
    pill.append(icon('lock', 11), el('span', '', t('aiPrivacySees', { token })));
    return pill;
}

function linkButton(text, onClick) {
    const button = el('button', 'anomalous-ai-priv-link', text);
    button.type = 'button';
    button.onclick = onClick;
    return button;
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

function stat(label, value, sub) {
    const box = el('div', 'anomalous-ai-priv-stat');
    box.append(el('span', 'anomalous-ai-priv-stat-label', label), el('strong', 'anomalous-ai-priv-stat-value', value));
    if (sub) box.append(el('span', 'anomalous-ai-priv-stat-sub', sub));
    return box;
}

function section(iconName, title) {
    const box = el('section', 'anomalous-ai-priv-section');
    const head = el('h3', 'anomalous-ai-priv-section-head');
    head.append(icon(iconName, 15), el('span', '', title));
    box.append(head);
    return box;
}

/** A row of "What the AI can see": what it is, then what the AI reads of it. */
function visibleRow(iconName, label, ...content) {
    const row = el('div', 'anomalous-ai-priv-vrow');
    const body = el('div', 'anomalous-ai-priv-vrow-body');
    body.append(el('div', 'anomalous-ai-priv-vrow-label', label), ...content);
    row.append(icon(iconName, 16), body);
    return row;
}

function noteStatusText(savedNotes, dirtyTokens, pendingOnServer) {
    if (dirtyTokens.size > 0) return t('aiPrivacyNoteSaving');
    if (!Object.keys(savedNotes).length) return '';
    return pendingOnServer ? t('aiPrivacyNotePending') : t('aiPrivacyNoteDelivered');
}

function attachNoteInput(row, token, currentNote, placeholder, ctx) {
    const note = el('label', 'anomalous-ai-priv-note');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-ai-priv-note-input';
    input.maxLength = MAX_SEALED_NOTE;
    input.value = ctx.draftNotes[token] ?? currentNote ?? '';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', t('aiPrivacyNoteLabel'));

    const state = el('span', 'anomalous-ai-priv-note-state');
    const syncState = (text = '') => { state.textContent = text; };
    input.oninput = () => {
        ctx.draftNotes[token] = input.value;
        ctx.onDraftChange(token, input.value, syncState);
    };
    input.onblur = () => { void ctx.onCommit(token, syncState); };
    input.onkeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        }
    };
    note.append(icon('pencil', 13), input, state);
    row.append(note);
}

/** A row of "What the AI can't see": its name, what it is, the token the AI gets instead. */
function itemRow(title, meta, token) {
    const row = el('div', 'anomalous-ai-priv-row');
    const head = el('div', 'anomalous-ai-priv-row-head');
    head.append(el('strong', 'anomalous-ai-priv-row-title', title));
    if (meta) head.append(el('span', 'anomalous-ai-priv-row-meta', meta));
    if (token) head.append(seesPill(token));
    row.append(head);
    return { row, head };
}

function renderPromptRow(item, n, task, ctx) {
    const tags = item.chunks.mode === 'tags' ? item.chunks.items.filter(part => part.text).length : 0;
    const { row } = itemRow(t(tags ? 'aiPrivacyPromptNth' : 'aiPrivacyTextNth', { n }),
        tags ? t('aiPrivacyPromptTags', { count: tags }) : '', item.token);
    row.append(renderHiddenPrompt(item, task, { onApplied: () => ctx.onAdjusted() }));
    attachNoteInput(row, item.token, item.note, t('aiPrivacyNotePlaceholderP'), ctx);
    return row;
}

function renderPictureRow(item, ctx) {
    const { row, head } = itemRow(item.path, '', item.token);
    const thumb = document.createElement('img');
    thumb.className = 'anomalous-ai-priv-thumb';
    thumb.src = outputThumbnail({ filename: item.filename, subfolder: item.subfolder || '' });
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = () => thumb.remove();
    head.prepend(thumb);
    attachNoteInput(row, item.token, item.note, t('aiPrivacyNotePlaceholderImg'), ctx);
    return row;
}

/** What the AI gets of `model` and what stays here, read when unfolded (the catalog's base model, the ticked paragraphs). */
function modelReach(model, task) {
    const box = el('details', 'anomalous-ai-priv-reach-model');
    box.append(el('summary', '', t('aiPrivacyReachSummary')));
    box.addEventListener('toggle', async () => {
        if (!box.open || box.dataset.read) return;
        box.dataset.read = '1';
        const [item, choice] = await Promise.all([
            loadCatalog().then(items => items.find(entry => entry.kind === 'models' && entry.id === model.id)).catch(() => null),
            fetch(`/anomalous/ai_model_choice?model_id=${encodeURIComponent(model.id)}`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
        ]);
        const whole = !model.hidden && !task.private; // as the materials window's "The AI gets" line says
        const picked = choice.picked?.length || 0;
        const base = item?.base || item?.metadata?.base_guess || '';
        const gets = [
            model.hidden ? t('aiPrivacyReachCode', { token: model.token || '[M…]' }) : t('aiPrivacyReachName'),
            t('aiPrivacyReachType', { type: typeLabel({ type: model.type || '' }) }), base ? t('aiPrivacyReachBase', { base }) : '',
            t('aiPrivacyReachSettings'),
            whole ? t('aiPrivacyReachAboutAll') : picked ? t('aiPrivacyReachAboutN', { count: picked }) : t('aiPrivacyReachAboutNone'),
            item?.words?.length ? t(model.hidden ? 'aiPrivacyReachWordsCode' : 'aiPrivacyReachWords') : '',
            t('aiPrivacyReachAiNote'),
        ];
        const keeps = model.hidden
            ? ['aiPrivacyKeepName', 'aiPrivacyKeepFolder', 'aiPrivacyKeepCover', 'aiPrivacyKeepCivitai', 'aiPrivacyKeepAboutRest', 'aiPrivacyKeepNotes']
            : [...(task.private ? ['aiPrivacyKeepCover'] : []), ...(whole ? [] : ['aiPrivacyKeepAboutRest'])];
        const column = (title, lines, kind) => {
            const list = el('div', `anomalous-ai-priv-reach-list is-${kind}`);
            list.append(el('strong', '', title), ...lines.filter(Boolean).map(line => el('span', '', line)));
            return list;
        };
        const columns = el('div', 'anomalous-ai-priv-reach-cols');
        columns.append(column(t('aiPrivacyReachGets'), gets, 'gets'), column(t('aiPrivacyReachKeeps'), keeps.length ? keeps.map(key => t(key)) : [t('aiPrivacyKeepNothing')], 'keeps'));
        box.append(columns);
    });
    return box;
}

function renderModelRow(model, task, ctx) {
    const { row, head } = itemRow(model.file || model.id, model.type, model.hidden ? model.token : '');
    if (!model.hidden) {
        const open = el('span', 'anomalous-ai-priv-sees is-open');
        open.append(icon('eye', 12), el('span', '', t('aiPrivacyModelPublicBadge')));
        head.append(open);
    }
    const flip = linkButton(t(model.hidden ? 'aiPrivacyModelMakePublic' : 'aiPrivacyModelMakeHidden'), async () => {
        flip.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'model_rule', model_id: model.id, hidden: !model.hidden });
            ctx.onAdjusted();
        } catch (error) {
            flip.disabled = false;
            await anomalousAlert(error.message);
        }
    });
    flip.title = t('aiPrivacyModelFlipHint');
    head.append(flip);
    const open = linkButton(t('aiPrivacyModelOpen'), () => ctx.openModel(model));
    open.title = t('aiPrivacyModelOpenHint');
    head.append(open);
    row.append(modelReach(model, task));
    if (model.words?.length) {
        const words = el('div', 'anomalous-ai-priv-model-words');
        words.append(el('span', '', t('aiPrivacyModelWords')));
        for (const word of model.words) words.append(el('span', 'anomalous-ai-priv-model-word', word.text), seesPill(word.token));
        row.append(words);
    }
    if (model.hidden && model.token) attachNoteInput(row, model.token, model.note, t('aiPrivacyNotePlaceholderM'), ctx);
    return row;
}

/** A message as the AI got it, whether it has read it, and the ways to hide more of it or find it. */
function renderMessagePreview(msg, task, { closeOverview, onAdjusted }) {
    const wrap = el('div', 'anomalous-ai-priv-msg');
    const body = el('div', 'anomalous-ai-priv-msg-text');
    const late = new Set(msg.late || []);
    for (const seg of msg.segments || []) {
        if (seg.type === 'token') body.append(Object.assign(tokenBadge(seg.token), late.has(seg.token) ? { className: 'anomalous-ai-priv-token is-late' } : {}));
        else body.append(document.createTextNode(seg.text));
    }
    wrap.append(body);
    if (late.size) {
        wrap.classList.add('is-late');
        const line = el('div', 'anomalous-ai-priv-msg-late');
        line.append(icon('alert', 12), el('span', '', t('aiPrivacyMsgLate', { tokens: [...late].join(t('listSeparator')) })));
        wrap.append(line);
    }
    if (!msg.hasPlaintext) wrap.append(el('div', 'anomalous-ai-priv-msg-only-tokens', t('aiPrivacyMsgAllSealed')));

    const foot = el('div', 'anomalous-ai-priv-msg-foot');
    foot.append(el('span', `anomalous-ai-priv-delivery${msg.delivered ? ' is-read' : ''}`,
        t(msg.delivered ? 'aiPrivacyMsgRead' : 'aiPrivacyMsgWaiting')));
    if (msg.hasPlaintext) {
        let sealer = null;
        foot.append(linkButton(t('aiPrivacySealMoreBtn'), () => {
            if (sealer) { sealer.remove(); sealer = null; return; }
            sealer = renderMessageSealer(msg, task, {
                onClose: () => { sealer?.remove(); sealer = null; },
                onApplied: () => onAdjusted(),
            });
            wrap.append(sealer);
        }));
    }
    const jump = linkButton(t('aiPrivacyMsgJump'), () => { closeOverview(); showStepRow(msg.stepId); });
    jump.title = t('aiPrivacyMsgJumpHint');
    foot.append(jump);
    wrap.append(foot);
    return wrap;
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
        const noteFor = (token) => {
            const line = el('div', 'anomalous-ai-priv-mirror-note');
            line.append(tokenBadge(token));
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
            }));
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

        const pictures = overview.hidden.generatedPictureCount;
        const stats = el('div', 'anomalous-ai-priv-stats');
        stats.append(
            stat(t('aiPrivacyStatPrompts'), t('aiPrivacyStatPromptsN', { n: overview.hidden.prompts.length })),
            stat(t('aiPrivacyStatModels'), t('aiPrivacyStatModelsN', { n: overview.modelCatalog.filter(m => m.hidden).length })),
            stat(t('aiPrivacyStatPictures'), !overview.private ? t('aiPrivacyStatPicturesAll')
                : releasedOf(task).length ? t('aiPrivacyStatPicturesReleased', { count: releasedOf(task).length }) : t('aiPrivacyStatPicturesNone'),
                overview.private && pictures ? t('aiPrivacyStatPicturesKept', { count: pictures }) : ''),
        );
        parts.push(stats);

        // What the AI can't see: each hidden item with its token and a note for the AI.
        const hiddenSec = section('lock', t('aiPrivacyHiddenHead'));
        if (overview.hidden.total || overview.modelCatalog.length) {
            const hint = el('p', 'anomalous-ai-priv-hint');
            hint.append(statusLine);
            hiddenSec.append(hint);
        }
        if (mirrors) hiddenSec.append(...mirrors.left);
        else overview.hidden.prompts.forEach((item, at) => hiddenSec.append(renderPromptRow(item, at + 1, task, rowCtx)));
        for (const item of overview.hidden.pictures) hiddenSec.append(renderPictureRow(item, rowCtx));
        for (const model of overview.modelCatalog) hiddenSec.append(renderModelRow(model, task, rowCtx));
        if (!overview.hidden.total && !overview.modelCatalog.length) {
            hiddenSec.append(el('div', 'anomalous-ai-priv-empty', t('aiPrivacyHiddenEmpty')));
        }
        // What the AI can see.
        const visibleSec = section('eye', t('aiPrivacyVisibleHead'));
        visibleSec.append(visibleRow('page', t('aiPrivacyVisibleTitle'),
            el('div', 'anomalous-ai-priv-vrow-value', overview.visible.title || t('aiPrivacyVisibleTitleEmpty'))));
        if (mirrors?.right.length) visibleSec.append(visibleRow('prompts', t('aiPrivacyMirrorHead'), ...mirrors.right));

        const publicModels = overview.modelCatalog.filter(m => !m.hidden);
        if (publicModels.length) {
            const row = visibleRow('models', t('aiPrivacyVisibleModelsReal'), ...publicModels.map(m => el('div', '', m.file || m.id)));
            row.classList.add('is-warn');
            visibleSec.append(row);
        }
        if (overview.exposedPrompts.length) {
            visibleSec.append(visibleRow('check', t('aiPrivacyVisibleExposedPrompts'),
                ...overview.exposedPrompts.slice(-4).reverse().map(item => el('div', '', item.text))));
        }

        const messages = overview.visible.messages;
        const preview = msg => renderMessagePreview(msg, task, { closeOverview: () => close(), onAdjusted });
        let msgContent;
        if (messages.length) {
            msgContent = el('div', 'anomalous-ai-priv-msgs');
            msgContent.append(...messages.slice(-INITIAL_MESSAGES).map(preview));
            if (messages.length > INITIAL_MESSAGES) {
                const more = linkButton(t('aiPrivacyShowAllMessages', { count: messages.length }), () => msgContent.replaceChildren(...messages.map(preview)));
                msgContent.append(more);
            }
        } else {
            msgContent = el('div', '', t('aiPrivacyVisibleMessagesNone'));
        }
        visibleSec.append(visibleRow('chat', t('aiPrivacyVisibleMessages'), msgContent));
        if (overview.private) { // the pictures the user released, every one in sight; and a stand-in to release
            const released = releasedOf(task);
            const standin = el('button', 'anomalous-ai-tool', t('aiPrivacyStandin'));
            standin.type = 'button';
            standin.title = t('aiPrivacyStandinHint');
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
            visibleSec.append(visibleRow('image', t('aiPrivacyVisibleReleased'),
                released.length ? releasedThumbs(task.id, released, window.anomalousBrowserInstance) : el('div', '', t('aiPrivacyVisibleReleasedNone')), standin, said));
        }
        visibleSec.append(visibleRow('pencil', t('aiPrivacyVisibleNotes'), visibleNotesList));
        const canvas = [el('div', '', t('aiPrivacyVisibleCanvasDesc'))];
        if (overview.visible.decisionsCount > 0) canvas.push(el('div', '', t('aiPrivacyVisibleDecisions', { n: overview.visible.decisionsCount })));
        visibleSec.append(visibleRow('nodes', t('aiPrivacyVisibleCanvas'), ...canvas));
        const columns = el('div', `anomalous-ai-priv-columns${split ? ' is-split' : ''}`);
        columns.append(hiddenSec, visibleSec);
        parts.push(columns);

        const foot = el('div', 'anomalous-ai-priv-foot');
        doneBtn = el('button', 'anomalous-ai-tool anomalous-ai-priv-done', t(dirtyTokens.size > 0 ? 'aiPrivacyOverviewSaveClose' : 'aiPrivacyOverviewSaveDone'));
        doneBtn.type = 'button';
        doneBtn.onclick = () => {
            if (dirtyTokens.size) void flushPatch([...dirtyTokens]).finally(() => close());
            else close();
        };
        foot.append(linkButton(t('aiSent'), () => void openSent(task)), doneBtn);
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
