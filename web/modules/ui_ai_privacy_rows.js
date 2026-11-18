/**
 * The Privacy overview's rows (ui_ai_privacy_overview.js), every one a badge at its left and then what it is:
 * a lock with the token when the AI gets only the token, an eye when it reads the thing as it is. A hidden
 * prompt as Prompt Studio's chips (ui_ai_privacy_adjust.js), a hidden picture, a model (its name switch,
 * kept with the model for every task, api/ai_model_choice.py; what the AI gets of it unfolded; its trigger
 * words; the materials window on it), and the note for the AI behind a small button until it has words.
 */

import { translate as t } from './locales.js';
import { MAX_SEALED_NOTE } from './ai_privacy_view.js';
import { loadCatalog } from './ai_toolbox_data.js';
import { icon } from './ui_ai_icons.js';
import { postPrivacyRule, renderHiddenPrompt } from './ui_ai_privacy_adjust.js';
import { anomalousAlert } from './ui_dialog.js';
import { outputThumbnail } from './ui_kept_toast.js';
import { typeLabel } from './ui_model_types.js';

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** A small grey button, an icon before its words when `iconName` is given. */
export function linkButton(text, onClick, iconName = '') {
    const button = el('button', 'anomalous-ai-priv-link');
    button.type = 'button';
    if (iconName) button.append(icon(iconName, 12));
    button.append(el('span', '', text));
    button.onclick = onClick;
    return button;
}

/** The AI gets only `token` in place of the thing. */
export function lockBadge(token = '') {
    const badge = el('span', 'anomalous-ai-priv-badge is-lock');
    badge.title = token ? t('aiPrivacySees', { token }) : t('aiPrivacyBadgeKept');
    badge.append(icon('lock', 11));
    if (token) badge.append(el('span', '', token));
    return badge;
}

/** The AI reads the thing as it is (`title` says what it reads, on hover). */
export function eyeBadge(title = t('aiPrivacyBadgeSeen')) {
    const badge = el('span', 'anomalous-ai-priv-badge is-eye');
    badge.title = title;
    badge.append(icon('eye', 12));
    return badge;
}

/** A row: the badge, then the content. */
export function trow(badge, ...content) {
    const row = el('div', 'anomalous-ai-priv-trow');
    const body = el('div', 'anomalous-ai-priv-trow-body');
    body.append(...content);
    row.append(el('div', 'anomalous-ai-priv-trow-badge'), body);
    row.firstChild.append(badge);
    return row;
}

/** A row's first line: its name, what it is, and buttons. */
function rowHead(title, meta, ...buttons) {
    const head = el('div', 'anomalous-ai-priv-row-head');
    head.append(el('strong', 'anomalous-ai-priv-row-title', title));
    if (meta) head.append(el('span', 'anomalous-ai-priv-row-meta', meta));
    if (buttons.length) {
        const tools = el('div', 'anomalous-ai-priv-row-tools');
        tools.append(...buttons);
        head.append(tools);
    }
    return head;
}

/** The note for the AI on `token`: a small button until it has words, then the field (saved as typed). */
export function attachNoteInput(box, token, currentNote, placeholder, ctx) {
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
    if (input.value) {
        box.append(note);
        return;
    }
    const add = el('button', 'anomalous-ai-priv-note-add');
    add.type = 'button';
    add.append(icon('pencil', 12), el('span', '', t('aiPrivacyNoteLabel')));
    add.onclick = () => {
        add.replaceWith(note);
        input.focus();
    };
    box.append(add);
}

export function promptRow(item, task, ctx) {
    const body = el('div', 'anomalous-ai-priv-trow-stack');
    body.append(renderHiddenPrompt(item, task, { onApplied: () => ctx.onAdjusted() }));
    attachNoteInput(body, item.token, item.note, t('aiPrivacyNotePlaceholderP'), ctx);
    return trow(lockBadge(item.token), body);
}

export function pictureRow(item, ctx) {
    const head = el('div', 'anomalous-ai-priv-row-head');
    const thumb = document.createElement('img');
    thumb.className = 'anomalous-ai-priv-thumb';
    thumb.src = outputThumbnail({ filename: item.filename, subfolder: item.subfolder || '' });
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = () => thumb.remove();
    head.append(thumb, el('strong', 'anomalous-ai-priv-row-title', item.path));
    const body = el('div', 'anomalous-ai-priv-trow-stack');
    body.append(head);
    attachNoteInput(body, item.token, item.note, t('aiPrivacyNotePlaceholderImg'), ctx);
    return trow(lockBadge(item.token), body);
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

function modelBadge(model) {
    return model.hidden ? lockBadge(model.token) : eyeBadge(t('aiPrivacyModelPublicBadge'));
}

export function modelRow(model, task, ctx) {
    const flip = linkButton(t(model.hidden ? 'aiPrivacyModelMakePublic' : 'aiPrivacyModelMakeHidden'), async () => {
        flip.disabled = true;
        try {
            await postPrivacyRule(task, { action: 'model_rule', model_id: model.id, hidden: !model.hidden });
            ctx.onAdjusted();
        } catch (error) {
            flip.disabled = false;
            await anomalousAlert(error.message);
        }
    }, model.hidden ? 'eye' : 'lock');
    flip.title = t('aiPrivacyModelFlipHint');
    const open = linkButton(t('aiPrivacyModelOpen'), () => ctx.openModel(model), 'pencil');
    open.title = t('aiPrivacyModelOpenHint');
    const body = el('div', 'anomalous-ai-priv-trow-stack');
    body.append(rowHead(model.file || model.id, model.type, flip, open), modelReach(model, task));
    if (model.words?.length) {
        const words = el('div', 'anomalous-ai-priv-model-words');
        words.append(el('span', '', t('aiPrivacyModelWords')));
        for (const word of model.words) words.append(el('span', 'anomalous-ai-priv-model-word', word.text), lockBadge(word.token));
        body.append(words);
    }
    if (model.hidden && model.token) attachNoteInput(body, model.token, model.note, t('aiPrivacyNotePlaceholderM'), ctx);
    return trow(modelBadge(model), body);
}

/** Side by side, the AI's side of a model row: the token it gets, or the name it reads. */
export function modelSeesRow(model) {
    return trow(modelBadge(model), el('div', model.hidden ? 'anomalous-ai-priv-row-value' : 'anomalous-ai-priv-row-title', model.hidden ? t('aiPrivacyModelSeesCode') : (model.file || model.id)));
}
