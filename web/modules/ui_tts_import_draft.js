import { t } from './interface_settings.js';
import { formatSize } from './ui_tts_path_picker.js';
import { importKind, missingForLanguage, rowState, textFromFile, usableAsReference } from './tts_setup_api.js';

/**
 * One character card of the import window (and the card of files nobody claims).
 * Folded, a card is one line: name, a short status, what it holds. Unfolded it
 * shows the two weight tiles, one line per clip, line files and language. The
 * import window owns drafts and rows; this module builds each row's elements once
 * (`row.els`), so they keep what was typed when cards are redrawn or a file moves.
 */

export const TRAY = '#unassigned';
const LANGUAGES = ['', 'ja', 'zh', 'en'];

/** The card's short status for each reason a draft cannot be imported yet. */
const SHORT = {
    ttsImportNameMissing: 'ttsCardNeedName',
    ttsImportWeightsMissing: 'ttsCardNeedWeights',
    ttsBatchNoAudio: 'ttsCardNeedAudio',
    ttsImportNameTaken: 'ttsCardNameTaken',
    ttsImportNameTakenVariant: 'ttsCardNameTaken',
    ttsBatchDuplicateName: 'ttsCardNameTwice',
    ttsBatchRowProblem: 'ttsCardFileProblem',
    ttsImportExistingDifferent: 'ttsCardFileProblem',
    ttsImportUnsupportedBlock: 'ttsCardUnsupported',
    ttsImportFailed: 'ttsCardFailed',
    ttsEditorNameInvalid: 'ttsCardEmotionProblem',
    ttsEditorNameDuplicate: 'ttsCardEmotionProblem',
    ttsImportNoFiles: 'ttsCardEmpty',
};
/** Problems the card already shows in place (the name field, the empty tiles). */
const SHOWN_IN_PLACE = ['ttsImportWeightsMissing', 'ttsImportNameTaken', 'ttsImportNameTakenVariant', 'ttsBatchNoAudio', 'ttsImportNameMissing', 'ttsImportNoFiles'];

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

/** State text, size / version / length, and the row's colour. */
export function updateRow(row) {
    if (!row.els) return;
    const info = row.info || {};
    const parts = row.size ? [formatSize(row.size)] : [];
    if (info.version) parts.push(info.supported ? info.version : t('ttsImportUnsupported', { version: info.version }));
    if (info.seconds !== undefined) parts.push(t('ttsImportSeconds', { seconds: info.seconds }));
    row.els.meta.textContent = parts.join(' · ');
    row.els.root.classList.toggle('is-out-of-range', row.kind === 'audio' && info.seconds !== undefined && !usableAsReference(info.seconds));
    const view = rowState({ error: row.error, uploaded: Boolean(row.spec), progress: row.progress,
        existing: info.existing ?? null, unsupported: info.supported === false });
    row.els.root.dataset.tone = view.tone;
    row.els.state.textContent = view.tone === 'ready' ? '' : t(view.key, view.params);
    row.els.state.title = t(view.key, view.params);
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
    name.title = row.path || row.name;
    const els = { root, meta: el('span', 'anomalous-tts-file-meta'), state: el('span', 'anomalous-tts-file-state'),
        move: el('select', 'anomalous-tts-file-move') };
    row.els = els;
    els.move.title = t('ttsBatchMoveTo');
    els.move.onchange = () => ctx.onMoveRow(row, els.move.value);
    const remove = button('anomalous-tts-file-remove', '×', () => ctx.onRemoveRow(row), t('ttsEditorRemove'));
    const label = el('span', 'anomalous-tts-file-label');
    label.append(name, els.meta);
    if (row.kind === 'audio') {
        const play = button('anomalous-tts-file-play', '▶', () => ctx.play(row), t('audioPlay'));
        play.hidden = !row.file; // local paths cannot be played from the browser
        els.main = button('anomalous-tts-file-main', t('ttsImportMain'), () => ctx.onReference(row));
        els.emotion = input('anomalous-tts-file-emotion', t('ttsImportEmotionPlaceholder'));
        els.emotion.value = row.emotion;
        els.emotion.oninput = () => { row.emotion = els.emotion.value.trim(); ctx.onEdited(row); };
        els.text = input('anomalous-tts-file-text', t('ttsImportTextPlaceholder'));
        els.text.value = row.text;
        els.text.oninput = () => { row.text = els.text.value.trim(); row.textEdited = true; showSource(row, null); };
        if (row.info && !row.textEdited) showSource(row, row.info.text_source || 'none');
        const top = el('div', 'anomalous-tts-file-top');
        top.append(play, label, els.state, els.main, els.move, remove);
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

/** Where this row can go; hidden while there is nowhere else to put it. */
function fillMove(row, place, ctx) {
    const select = row.els.move;
    const places = ctx.places();
    select.hidden = places.length < 2;
    select.replaceChildren();
    for (const option of places) {
        const node = el('option', '', option.id === place.id ? t('ttsCardMoveHere', { name: option.label }) : t('ttsCardMoveTo', { name: option.label }));
        node.value = option.id;
        select.append(node);
    }
    select.value = place.id;
}

function showRow(row, place, ctx) {
    rowElements(row, ctx);
    fillMove(row, place, ctx);
    return row.els.root;
}

/** GPT or SoVITS: the file, or an empty tile that opens the file dialog. */
function weightTile(kind, draft, ctx) {
    const row = draft.rows.find(r => r.kind === kind);
    const tile = el('div', `anomalous-tts-tile is-${kind}${row ? '' : ' is-empty'}${!row && !draft.target ? ' is-needed' : ''}`);
    const head = el('div', 'anomalous-tts-tile-head');
    head.append(el('span', 'anomalous-tts-tile-kind', t(kind === 'gpt' ? 'ttsCardGpt' : 'ttsCardSovits')),
        el('span', 'anomalous-tts-tile-ext', kind === 'gpt' ? '.ckpt' : '.pth'));
    tile.append(head);
    if (row) {
        tile.append(showRow(row, draft, ctx));
    } else {
        const actions = el('div', 'anomalous-tts-tile-actions');
        actions.append(button('anomalous-tts-pick', draft.target ? t('ttsCardWeightOptional') : t('ttsCardWeightPick'), () => ctx.pick(draft, [kind], false)),
            button('anomalous-tts-link', t('ttsCardFromThisPc'), () => ctx.pick(draft, [kind], true)));
        tile.append(actions);
    }
    return tile;
}

function statusOf(view) {
    const key = view.tone === 'ready' ? 'ttsCardReady' : view.tone === 'busy' ? 'ttsCardBusy' : view.tone === 'done' ? 'ttsCardDone'
        : SHORT[view.problem?.[0]] || 'ttsCardNeedLook';
    return { text: t(key), title: view.problem ? t(view.problem[0], view.problem[1]) : t(key) };
}

/**
 * A character card. `ctx`: `{ status, signal, places(), play(row), pick(draft, kinds, local),
 * onToggle(draft), onName(draft, value), onSwitchToAdd(draft), onReference(row), onEdited(row),
 * onLanguage(draft, value), onMoveRow(row, id), onRemoveRow(row), onRemoveDraft(draft),
 * onDropFiles(draft, dataTransfer) }`. `view`: `{ tone, problem, conflict, problems }`.
 * The returned `refresh(view)` repaints status and problems without touching the fields.
 */
export function renderDraftCard(draft, view, ctx) {
    const card = el('section', `anomalous-tts-card${draft.expanded ? ' is-open' : ''}`);
    const head = el('div', 'anomalous-tts-card-head');
    const chevron = button('anomalous-tts-card-chevron', '', () => ctx.onToggle(draft), t(draft.expanded ? 'ttsCardFold' : 'ttsCardUnfold'));
    const avatar = el('span', 'anomalous-tts-card-avatar', (draft.target || draft.name).trim().slice(0, 1).toUpperCase() || '?');
    let title;
    if (draft.target) {
        title = el('span', 'anomalous-tts-card-title');
        title.append(el('span', 'anomalous-tts-card-addto', t('ttsCardAddTo')), el('span', 'anomalous-tts-card-name', draft.target));
    } else {
        title = input('anomalous-tts-card-name-input', t('ttsCardNamePlaceholder'));
        title.value = draft.name;
        title.title = t('ttsCardNameTitle');
        title.oninput = () => {
            avatar.textContent = title.value.trim().slice(0, 1).toUpperCase() || '?';
            ctx.onName(draft, title.value);
        };
    }
    const pill = el('span', 'anomalous-tts-card-pill');
    const clips = draft.rows.filter(row => row.kind === 'audio').length;
    const holds = el('span', 'anomalous-tts-card-holds');
    for (const kind of ['gpt', 'sovits']) {
        const has = draft.rows.some(row => row.kind === kind);
        // An existing character already has its models: only new ones are worth a mention.
        if (has || !draft.target) holds.append(el('span', `anomalous-tts-card-hold${has ? ' is-on' : ''}`, t(kind === 'gpt' ? 'ttsCardGpt' : 'ttsCardSovits')));
    }
    holds.append(el('span', `anomalous-tts-card-hold${clips ? ' is-on' : ''}`, t('ttsCardClips', { count: clips })));
    head.append(chevron, avatar, title, pill, holds);
    // Adding to a character is what the window is for; its files can still be removed one by one.
    if (!draft.target) head.append(button('anomalous-tts-card-remove', '×', () => ctx.onRemoveDraft(draft), t('ttsCardRemove')));
    // The whole line folds and unfolds, except where it is a field or a button.
    head.addEventListener('click', (e) => { if (!e.target.closest('input, button')) ctx.onToggle(draft); });
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

    const conflictLine = el('div', 'anomalous-tts-card-problem is-conflict');
    const problems = el('div', 'anomalous-tts-card-problems');
    const paint = (next) => {
        card.dataset.tone = next.tone;
        const status = statusOf(next);
        pill.textContent = status.text;
        pill.title = status.title;
        conflictLine.replaceChildren();
        conflictLine.hidden = !next.conflict;
        if (next.conflict?.kind === 'exact') {
            conflictLine.append(el('span', '', t('ttsImportNameTaken', { name: next.conflict.name })),
                button('anomalous-tts-link', t('ttsImportSwitchToAdd'), () => ctx.onSwitchToAdd(draft)));
        } else if (next.conflict) {
            conflictLine.append(el('span', '', t('ttsImportNameTakenVariant', { name: next.conflict.name, variants: next.conflict.variants.join('、') })));
        }
        problems.replaceChildren();
        if (next.problem && !SHOWN_IN_PLACE.includes(next.problem[0])) {
            problems.append(el('div', 'anomalous-tts-card-problem is-blocking', t(next.problem[0], next.problem[1])));
        }
        for (const text of next.problems) problems.append(el('div', 'anomalous-tts-card-problem', text));
    };
    paint(view);
    if (!draft.expanded) return { root: card, refresh: paint };

    const body = el('div', 'anomalous-tts-card-body');
    body.append(conflictLine);
    const weights = el('div', 'anomalous-tts-card-weights');
    weights.append(weightTile('gpt', draft, ctx), weightTile('sovits', draft, ctx));
    body.append(weights);

    const audioRows = draft.rows.filter(row => row.kind === 'audio');
    const audioHead = el('div', 'anomalous-tts-card-section');
    audioHead.append(el('span', 'anomalous-tts-card-section-title', t('ttsCardClipsTitle', { count: audioRows.length })),
        el('span', 'anomalous-tts-card-section-hint', t('ttsCardClipsHint')));
    const audioList = el('div', 'anomalous-tts-card-files');
    for (const row of audioRows) audioList.append(showRow(row, draft, ctx));
    const addAudio = el('div', `anomalous-tts-card-add${audioRows.length ? '' : ' is-empty'}${!audioRows.length && !draft.target ? ' is-needed' : ''}`);
    addAudio.append(button('anomalous-tts-pick', t(audioRows.length ? 'ttsCardAddClips' : 'ttsCardFirstClips'), () => ctx.pick(draft, ['audio'], false)),
        button('anomalous-tts-link', t('ttsCardFromThisPc'), () => ctx.pick(draft, ['audio'], true)));
    body.append(audioHead, audioList, addAudio);

    const textRows = draft.rows.filter(row => row.kind === 'text');
    const extras = el('div', 'anomalous-tts-card-extras');
    const lines = el('div', 'anomalous-tts-card-lines');
    lines.append(el('span', 'anomalous-tts-card-extra-label', t('ttsCardLineFiles')));
    for (const row of textRows) lines.append(showRow(row, draft, ctx));
    lines.append(button('anomalous-tts-link', t('ttsCardAddLineFile'), () => ctx.pick(draft, ['text'], false)));
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
    extras.append(lines, language);
    body.append(extras);
    const missing = missingForLanguage(ctx.status, draft.language || draft.detectedLanguage || '');
    if (missing.length) {
        body.append(el('div', 'anomalous-tts-card-note', t('ttsImportPretrainedNote', {
            files: missing.map(item => item.label).join('、'),
            size: formatSize(missing.reduce((sum, item) => sum + (item.size || 0), 0)),
        })));
    }
    body.append(problems);
    card.append(body);
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
    const list = el('div', 'anomalous-tts-card-files');
    for (const row of tray.rows) list.append(showRow(row, tray, ctx));
    body.append(list);
    card.append(head, body);
    return card;
}
