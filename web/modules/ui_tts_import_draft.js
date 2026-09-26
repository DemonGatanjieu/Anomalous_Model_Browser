import { t } from './interface_settings.js';
import { formatSize } from './ui_tts_path_picker.js';
import { importKind, missingForLanguage, rowState, textFromFile, usableAsReference } from './tts_setup_api.js';

/**
 * One character card of the import window (and the card of files nobody claims).
 * Folded, a card is one line: name, how many steps are left, how many clips.
 * Unfolded it leads with a checklist (tts_import_groups.js draftChecklist) that
 * lights up the next step and offers its button right there; the chosen weights
 * sit in their checklist lines, then come the clips, line files and language.
 * The import window owns drafts and rows; this module builds each row's elements
 * once (`row.els`), so they keep what was typed when cards are redrawn or a file moves.
 */

export const TRAY = '#unassigned';
const LANGUAGES = ['', 'ja', 'zh', 'en'];
const PICKS = { gpt: ['gpt'], sovits: ['sovits'], audio: ['audio'], files: null };

/** The card's short status for reasons the checklist does not already show. */
const SHORT = {
    ttsBatchRowProblem: 'ttsCardFileProblem',
    ttsImportExistingDifferent: 'ttsCardFileProblem',
    ttsImportFailed: 'ttsCardFailed',
    ttsEditorNameInvalid: 'ttsCardEmotionProblem',
    ttsEditorNameDuplicate: 'ttsCardEmotionProblem',
};
/** Problems the checklist already shows. */
const LIST_LIMIT = 60; // clips shown before "show all": a character can bring hundreds
const IN_CHECKLIST = ['ttsImportWeightsMissing', 'ttsImportNameTaken', 'ttsImportNameTakenVariant', 'ttsBatchNoAudio', 'ttsBatchNoMain',
    'ttsImportNameMissing', 'ttsImportNoFiles', 'ttsBatchDuplicateName', 'ttsImportUnsupportedBlock'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
    btn.onclick = onClick;
    return btn;
}

function input(className, placeholder) {
    const node = el('input', className);
    node.type = 'text';
    node.placeholder = placeholder;
    return node;
}

/** Name (a renamed file says what it was), state text, size / version / length, and the row's colour. */
export function updateRow(row) {
    if (!row.els) return;
    const info = row.info || {};
    const from = [row.dir, row.original].filter(Boolean).join('/');
    row.els.name.textContent = row.name;
    row.els.name.title = row.name !== row.original ? t('ttsImportRenamedFrom', { file: row.path || from }) : row.path || from;
    const parts = row.size ? [formatSize(row.size)] : [];
    if (info.version) parts.push(info.supported ? info.version : t('ttsImportUnsupported', { version: info.version }));
    if (info.seconds !== undefined) parts.push(t('ttsImportSeconds', { seconds: info.seconds }));
    row.els.meta.textContent = parts.join(' · ');
    const outOfRange = row.kind === 'audio' && info.seconds !== undefined && !usableAsReference(info.seconds);
    row.els.root.classList.toggle('is-out-of-range', outOfRange);
    const view = rowState({ error: row.error, uploaded: Boolean(row.spec), queued: row.queued, progress: row.progress,
        existing: info.existing ?? null, unsupported: info.supported === false });
    row.els.root.dataset.tone = view.tone;
    const leftOut = outOfRange && view.tone === 'ready';
    row.els.state.textContent = leftOut ? t('ttsImportLeftOut') : view.tone === 'ready' ? '' : t(view.key, view.params);
    row.els.state.title = leftOut ? t('ttsImportOutOfRange') : t(view.key, view.params);
}

/** Where a clip's line came from, shown as the text box's tooltip and colour. */
export function showSource(row, source, file = '') {
    if (!row.els?.text) return;
    row.els.text.title = source ? t(`ttsTextSource_${source}`, { file }) : '';
    row.els.text.dataset.source = source || '';
}

/** Mark the main clip of a draft; clips outside 3–10 s cannot be it. */
export function syncReference(draft) {
    for (const row of draft.rows) {
        if (!row.els?.main) continue;
        const usable = usableAsReference(row.info?.seconds);
        if (!usable && draft.referenceKey === row.key) draft.referenceKey = null;
        const on = row.key === draft.referenceKey;
        row.els.main.setAttribute('aria-pressed', String(on));
        row.els.main.classList.toggle('active', on);
        row.els.main.disabled = !usable;
        row.els.main.title = usable ? t(on ? 'ttsCardMainOn' : 'ttsImportMainTitle') : t('ttsImportOutOfRange');
        row.els.emotion.disabled = on;
        row.els.emotion.placeholder = on ? t('ttsCardMainEmotion') : t('ttsImportEmotionPlaceholder');
    }
}

/** A .txt / .lab / .list dropped on a clip's text box fills that clip's line. */
function bindTextDrop(row, ctx) {
    const box = row.els.text;
    box.addEventListener('dragover', (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        box.classList.add('dragover');
    });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', async (e) => {
        box.classList.remove('dragover');
        const file = [...(e.dataTransfer?.files || [])].find(f => importKind(f.name) === 'text');
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        const line = textFromFile(await file.text(), row.name);
        if (ctx.signal.aborted) return;
        if (line === null) { showSource(row, 'missing', file.name); return; }
        box.value = line;
        row.text = line;
        row.textEdited = true;
        showSource(row, 'file', file.name);
    });
}

/** Build a row's elements the first time it is shown. */
function rowElements(row, ctx) {
    if (row.els) return row.els;
    const root = el('div', `anomalous-tts-file is-${row.kind}`);
    const name = el('span', 'anomalous-tts-file-name', row.name);
    const els = { root, name, meta: el('span', 'anomalous-tts-file-meta'), state: el('span', 'anomalous-tts-file-state'),
        move: el('select', 'anomalous-tts-file-move') };
    row.els = els;
    els.move.title = t('ttsBatchMoveTo');
    els.move.onchange = () => ctx.onMoveRow(row, els.move.value);
    // The full list is built when the menu is about to open: thousands of rows each
    // holding every character would make each redraw slow.
    const fill = () => { if (els.movePlace) fillMoveOptions(els.move, els.movePlace, ctx.places()); };
    els.move.addEventListener('pointerdown', fill);
    els.move.addEventListener('focus', fill);
    const remove = button('anomalous-tts-file-remove', '×', () => ctx.onRemoveRow(row), t('ttsEditorRemove'));
    const label = el('span', 'anomalous-tts-file-label');
    label.append(name, els.meta);
    if (row.kind === 'audio') {
        els.play = button('anomalous-tts-file-play', '▶', () => ctx.play(row), t('audioPlay'));
        els.main = button('anomalous-tts-file-main', t('ttsImportMain'), () => ctx.onReference(row));
        els.emotion = input('anomalous-tts-file-emotion', t('ttsImportEmotionPlaceholder'));
        els.emotion.value = row.emotion;
        els.emotion.oninput = () => { row.emotion = els.emotion.value.trim(); ctx.onEdited(row); };
        els.text = input('anomalous-tts-file-text', t('ttsImportTextPlaceholder'));
        els.text.value = row.text;
        els.text.oninput = () => { row.text = els.text.value.trim(); row.textEdited = true; showSource(row, null); };
        if (row.info && !row.textEdited) showSource(row, row.info.text_source || 'none');
        const top = el('div', 'anomalous-tts-file-top');
        top.append(els.play, label, els.state, els.main, els.move, remove);
        const bottom = el('div', 'anomalous-tts-file-bottom');
        bottom.append(els.emotion, els.text);
        root.append(top, bottom);
        bindTextDrop(row, ctx);
    } else {
        root.append(label, els.state, els.move, remove);
    }
    updateRow(row);
    return els;
}

function fillMoveOptions(select, place, places) {
    if (select.options.length === places.length) return;
    select.replaceChildren();
    for (const option of places) {
        const label = option.id === place.id ? t('ttsCardMoveHere', { name: option.label }) : t('ttsCardMoveTo', { name: option.label });
        const node = el('option', '', label);
        node.value = option.id;
        select.append(node);
    }
    select.value = place.id;
}

/** Where this row can go (the list itself is filled on open); hidden while there is nowhere else. */
function showRow(row, place, ctx) {
    const els = rowElements(row, ctx);
    const places = ctx.places();
    els.move.hidden = places.length < 2;
    els.movePlace = place;
    const here = places.find(option => option.id === place.id);
    const node = el('option', '', here ? t('ttsCardMoveHere', { name: here.label }) : '');
    node.value = place.id;
    els.move.replaceChildren(node);
    return els.root;
}

function statusOf(view) {
    const key = view.tone === 'ready' ? 'ttsCardReady' : view.tone === 'busy' ? 'ttsCardBusy' : view.tone === 'done' ? 'ttsCardDone'
        : SHORT[view.problem?.[0]] || null;
    const next = view.checklist.find(item => !item.done);
    const text = key ? t(key) : t('ttsCardSteps', { count: view.checklist.filter(item => !item.done).length });
    return { text, title: view.problem ? t(view.problem[0], view.problem[1]) : next ? t(next.key, next.params) : text };
}

/** What a checklist line offers: file buttons, "fill in the name", "pick in the list". */
function checkActions(item, isNext, draft, view, ctx, parts) {
    const side = el('span', 'anomalous-tts-check-actions');
    if (item.id in PICKS && !item.done) {
        if (isNext) {
            side.append(button('anomalous-tts-pick', t('ttsCardPickFile'), () => ctx.pick(draft, PICKS[item.id], false)),
                button('anomalous-tts-link', t('ttsCardFromThisPc'), () => ctx.pick(draft, PICKS[item.id], true)));
        } else {
            side.append(button('anomalous-tts-link', t('ttsCardPickShort'), () => ctx.pick(draft, PICKS[item.id], false)));
        }
    } else if (item.id === 'main' && !item.done && isNext) {
        side.append(button('anomalous-tts-pick', t('ttsCheckMainGo'), () => parts.clips.scrollIntoView({ block: 'nearest', behavior: 'smooth' })));
    } else if (item.id === 'name' && !item.done) {
        if (view.conflict?.kind === 'exact') side.append(button('anomalous-tts-link', t('ttsImportSwitchToAdd'), () => ctx.onSwitchToAdd(draft)));
        else if (isNext) side.append(button('anomalous-tts-pick', t('ttsCheckNameGo'), () => parts.name?.focus()));
    }
    return side;
}

function renderChecklist(list, draft, view, ctx, parts) {
    list.replaceChildren();
    const next = view.checklist.find(item => !item.done);
    view.checklist.forEach((item, i) => {
        const isNext = item === next;
        const line = el('div', `anomalous-tts-check-item ${item.done ? 'is-done' : isNext ? 'is-next' : 'is-todo'}`);
        line.dataset.check = item.id;
        line.append(el('span', 'anomalous-tts-check-mark', item.done ? '✓' : String(i + 1)), el('span', 'anomalous-tts-check-text', t(item.key, item.params)));
        const weight = (item.id === 'gpt' || item.id === 'sovits') && draft.rows.find(row => row.kind === item.id);
        if (weight) line.append(showRow(weight, draft, ctx));
        else line.append(checkActions(item, isNext, draft, view, ctx, parts));
        list.append(line);
    });
}

/**
 * A character card. `ctx`: `{ status, signal, places(), play(row), pick(draft, kinds, local),
 * onToggle(draft), onName(draft, value), onSwitchToAdd(draft), onReference(row), onEdited(row),
 * onLanguage(draft, value), onMoveRow(row, id), onRemoveRow(row), onRemoveDraft(draft),
 * onDropFiles(draft, dataTransfer) }`. `view`: `{ tone, problem, conflict, problems, checklist }`;
 * `solo` = the only card of the window (always open, cannot be removed). The returned
 * `refresh(view)` repaints status, checklist and problems without touching the fields.
 */
export function renderDraftCard(draft, view, ctx, { solo = false } = {}) {
    const open = solo || draft.expanded;
    const card = el('section', `anomalous-tts-card${open ? ' is-open' : ''}${solo ? ' is-solo' : ''}`);
    const head = el('div', 'anomalous-tts-card-head');
    const avatar = el('span', 'anomalous-tts-card-avatar', (draft.target || draft.name).trim().slice(0, 1).toUpperCase() || '?');
    const parts = { name: null, clips: null };
    if (!solo) head.append(button('anomalous-tts-card-chevron', '', () => ctx.onToggle(draft), t(open ? 'ttsCardFold' : 'ttsCardUnfold')));
    head.append(avatar);
    if (draft.target) {
        const title = el('span', 'anomalous-tts-card-title');
        title.append(el('span', 'anomalous-tts-card-addto', t('ttsCardAddTo')), el('span', 'anomalous-tts-card-name', draft.target));
        head.append(title);
    } else {
        const title = input('anomalous-tts-card-name-input', t('ttsCardNamePlaceholder'));
        title.value = draft.name;
        title.title = t('ttsCardNameTitle');
        title.oninput = () => {
            avatar.textContent = title.value.trim().slice(0, 1).toUpperCase() || '?';
            ctx.onName(draft, title.value);
        };
        parts.name = title;
        head.append(title);
    }
    const pill = el('span', 'anomalous-tts-card-pill');
    const clipCount = draft.rows.filter(row => row.kind === 'audio' && !view.skipped.has(row.key)).length;
    head.append(pill, el('span', 'anomalous-tts-card-meta', t('ttsCardClips', { count: clipCount })));
    if (!solo && !draft.target) head.append(button('anomalous-tts-card-remove', '×', () => ctx.onRemoveDraft(draft), t('ttsCardRemove')));
    if (!solo) head.addEventListener('click', (e) => { if (!e.target.closest('input, button')) ctx.onToggle(draft); });
    card.append(head);

    // Files dropped on a card are this character's.
    card.addEventListener('dragover', (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        card.classList.add('is-drop-target');
    });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('is-drop-target'); });
    card.addEventListener('drop', (e) => {
        card.classList.remove('is-drop-target');
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        ctx.onDropFiles(draft, e.dataTransfer);
    });

    const checklist = el('div', 'anomalous-tts-check');
    const problems = el('div', 'anomalous-tts-card-problems');
    const paint = (next) => {
        card.dataset.tone = next.tone;
        const status = statusOf(next);
        pill.textContent = status.text;
        pill.title = status.title;
        if (!open) return;
        renderChecklist(checklist, draft, next, ctx, parts);
        problems.replaceChildren();
        if (next.problem && !IN_CHECKLIST.includes(next.problem[0])) {
            problems.append(el('div', 'anomalous-tts-card-problem is-blocking', t(next.problem[0], next.problem[1])));
        }
        for (const text of next.problems) problems.append(el('div', 'anomalous-tts-card-problem', text));
    };
    if (!open) {
        paint(view);
        return { root: card, refresh: paint };
    }

    const body = el('div', 'anomalous-tts-card-body');
    body.append(checklist);

    const kept = draft.rows.filter(row => !view.skipped.has(row.key));
    const audioRows = kept.filter(row => row.kind === 'audio');
    const clips = el('div', 'anomalous-tts-card-clips');
    parts.clips = clips;
    if (audioRows.length) {
        const audioHead = el('div', 'anomalous-tts-card-section');
        audioHead.append(el('span', 'anomalous-tts-card-section-title', t('ttsCardClipsTitle', { count: audioRows.length })),
            el('span', 'anomalous-tts-card-section-hint', t('ttsCardClipsHint')),
            button('anomalous-tts-link', t('ttsCardAddClips'), () => ctx.pick(draft, ['audio'], false)));
        const audioList = el('div', 'anomalous-tts-card-files');
        const shown = draft.showAll ? audioRows : audioRows.filter((row, i) => i < LIST_LIMIT || row.key === draft.referenceKey);
        for (const row of shown) audioList.append(showRow(row, draft, ctx));
        clips.append(audioHead, audioList);
        if (shown.length < audioRows.length) {
            clips.append(button('anomalous-tts-link anomalous-tts-card-more', t('ttsCardShowAll', { count: audioRows.length }), () => ctx.onShowAll(draft)));
        }
        body.append(clips);
    }
    const skippedRows = draft.rows.filter(row => view.skipped.has(row.key));
    if (skippedRows.length) {
        const count = skippedRows.filter(row => row.kind === 'audio').length;
        body.append(foldedRows(skippedRows, draft, ctx, t('ttsCardLeftOut', { count })));
    }

    const textRows = kept.filter(row => row.kind === 'text');
    const extras = el('div', 'anomalous-tts-card-extras');
    const lines = el('div', 'anomalous-tts-card-lines');
    lines.append(el('span', 'anomalous-tts-card-extra-label', t('ttsCardLineFiles')));
    for (const row of textRows) lines.append(showRow(row, draft, ctx));
    lines.append(button('anomalous-tts-link', t('ttsCardAddLineFile'), () => ctx.pick(draft, ['text'], false)));
    extras.append(lines);
    if (!draft.target) {
        const languageSelect = el('select', 'anomalous-tts-card-language');
        for (const code of LANGUAGES) {
            const option = el('option', '', code ? t(`ttsNeededFor_${code}`)
                : draft.detectedLanguage ? t('ttsImportLanguageAutoFound', { lang: t(`ttsNeededFor_${draft.detectedLanguage}`) }) : t('ttsImportLanguageAuto'));
            option.value = code;
            languageSelect.append(option);
        }
        languageSelect.value = draft.language;
        languageSelect.onchange = () => ctx.onLanguage(draft, languageSelect.value);
        const language = el('label', 'anomalous-tts-card-lang');
        language.append(el('span', 'anomalous-tts-card-extra-label', t('ttsImportLanguage')), languageSelect);
        extras.append(language);
    }
    body.append(extras);
    const missing = missingForLanguage(ctx.status, draft.language || draft.detectedLanguage || '');
    if (missing.length && !draft.target) {
        body.append(el('div', 'anomalous-tts-card-note', t('ttsImportPretrainedNote', {
            files: missing.map(item => item.label).join('、'),
            size: formatSize(missing.reduce((sum, item) => sum + (item.size || 0), 0)),
        })));
    }
    body.append(problems);
    card.append(body);
    paint(view);
    syncReference(draft);
    return { root: card, refresh: paint };
}

/** Files that did not match any character: each says where it should go. */
export function renderTrayCard(tray, ctx) {
    const card = el('section', 'anomalous-tts-card is-tray is-open');
    const head = el('div', 'anomalous-tts-card-head');
    head.append(el('span', 'anomalous-tts-card-avatar', '?'),
        el('span', 'anomalous-tts-card-title', t('ttsCardTrayTitle', { count: tray.rows.length })));
    const body = el('div', 'anomalous-tts-card-body');
    body.append(el('div', 'anomalous-tts-card-note', t('ttsCardTrayHint')));
    const folders = new Map();
    for (const row of tray.rows) {
        if (!folders.has(row.dir)) folders.set(row.dir, []);
        folders.get(row.dir).push(row);
    }
    if (tray.rows.length <= LIST_LIMIT && folders.size === 1) {
        const list = el('div', 'anomalous-tts-card-files');
        for (const row of tray.rows) list.append(showRow(row, tray, ctx));
        body.append(list);
    } else {
        // One line per folder: assign the whole folder, or open it to sort file by file.
        for (const [dir, rows] of folders) {
            const fold = foldedRows(rows, tray, ctx, t('ttsCardTrayFolder', { folder: dir || t('ttsCardTrayTop'), count: rows.length }));
            const move = el('select', 'anomalous-tts-file-move');
            move.title = t('ttsBatchMoveTo');
            const first = el('option', '', t('ttsCardTrayMoveAll'));
            first.value = '';
            move.append(first);
            move.addEventListener('pointerdown', () => {
                if (move.options.length > 1) return;
                for (const place of ctx.places().filter(option => option.id !== TRAY)) {
                    const node = el('option', '', t('ttsCardMoveTo', { name: place.label }));
                    node.value = place.id;
                    move.append(node);
                }
            });
            move.onchange = () => { if (move.value) ctx.onMoveRows(rows, move.value); };
            fold.querySelector('summary').append(move);
            body.append(fold);
        }
    }
    card.append(head, body);
    return card;
}

/** Rows folded under a summary line; built the first time it is opened. */
function foldedRows(rows, place, ctx, label) {
    const box = el('details', 'anomalous-tts-card-fold');
    const summary = el('summary', 'anomalous-tts-card-fold-summary');
    summary.append(el('span', 'anomalous-tts-card-fold-label', label));
    const list = el('div', 'anomalous-tts-card-files');
    box.append(summary, list);
    box.addEventListener('toggle', () => {
        if (box.open && !list.childElementCount) for (const row of rows) list.append(showRow(row, place, ctx));
    });
    return box;
}
