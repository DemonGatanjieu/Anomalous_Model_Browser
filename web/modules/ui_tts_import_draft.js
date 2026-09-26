import { t } from './interface_settings.js';
import { formatSize } from './ui_tts_path_picker.js';
import { importKind, missingForLanguage, rowState, textFromFile, usableAsReference } from './tts_setup_api.js';

/**
 * The right side of the import workbench: one character being built (or the
 * unassigned tray). Name, the GPT and SoVITS slots, one compact line per clip,
 * line files, language and what still blocks the import. The workbench owns the
 * drafts and rows; this module builds each row's elements once (`row.els`) and
 * reports edits through `ctx`. Rows keep their elements when the pane is redrawn
 * or the row moves to another character.
 */

export const TRAY = '#unassigned';
export const ROW_DRAG_TYPE = 'application/x-anomalous-tts-row';
const LANGUAGES = ['', 'ja', 'zh', 'en'];

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
    row.els.state.textContent = t(view.key, view.params);
    row.els.state.title = row.els.state.textContent;
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
        row.els.main.title = usable ? t('ttsImportMainTitle') : t('ttsImportOutOfRange');
        row.els.emotion.disabled = on;
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
    const root = el('div', `anomalous-tts-batch-row is-${row.kind}`);
    const grip = el('span', 'anomalous-tts-batch-grip', '⋮⋮');
    grip.draggable = true;
    grip.title = t('ttsBatchDragRow');
    grip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(ROW_DRAG_TYPE, String(row.key));
        e.dataTransfer.effectAllowed = 'move';
    });
    const name = el('span', 'anomalous-tts-batch-name', row.name);
    name.title = row.path || row.name;
    const els = { root, meta: el('span', 'anomalous-tts-batch-meta'), state: el('span', 'anomalous-tts-import-state'),
        move: el('select', 'anomalous-tts-batch-move') };
    els.move.title = t('ttsBatchMoveTo');
    els.move.onchange = () => ctx.onMoveRow(row, els.move.value);
    const remove = button('anomalous-tts-remove', '×', () => ctx.onRemoveRow(row), t('ttsEditorRemove'));
    const nameBox = el('span', 'anomalous-tts-batch-file');
    nameBox.append(name, els.meta);
    if (row.kind === 'audio') {
        const play = button('anomalous-audio-play-btn', '▶', () => ctx.play(row), t('audioPlay'));
        play.hidden = !row.file; // local paths cannot be played from the browser
        els.main = button('anomalous-tag-chip', t('ttsImportMain'), () => ctx.onReference(row));
        els.emotion = input('anomalous-tts-name-input', t('ttsImportEmotionPlaceholder'));
        els.emotion.oninput = () => { row.emotion = els.emotion.value.trim(); ctx.onEdited(row); };
        els.text = input('anomalous-tts-text-input', t('ttsImportTextPlaceholder'));
        els.text.oninput = () => { row.text = els.text.value.trim(); row.textEdited = true; showSource(row, null); };
        root.append(grip, play, nameBox, els.main, els.emotion, els.text, els.move, els.state, remove);
    } else {
        root.append(grip, nameBox, els.move, els.state, remove);
    }
    row.els = els;
    if (els.text) {
        // Rows first shown after their inspect (another draft was open) start with what it found.
        els.text.value = row.text;
        els.emotion.value = row.emotion;
        if (row.info && !row.textEdited) showSource(row, row.info.text_source || 'none');
        bindTextDrop(row, ctx);
    }
    updateRow(row);
    return els;
}

/** Offer every other character (and the tray) as a place this row can go. */
function fillMove(row, draft, ctx) {
    const select = row.els.move;
    select.replaceChildren();
    for (const option of ctx.places()) {
        const node = el('option', '', option.label);
        node.value = option.id;
        select.append(node);
    }
    select.value = draft.id;
}

function section(title, count, pickKinds, ctx, draft) {
    const box = el('div', 'anomalous-tts-batch-section');
    const head = el('div', 'anomalous-tts-import-section-head');
    const label = el('span', 'anomalous-tts-import-section-title');
    label.append(el('span', 'anomalous-voice-field-label', title));
    if (count) label.append(el('span', 'anomalous-tts-import-mark', t('ttsImportMarkCount', { count })));
    head.append(label);
    if (pickKinds && draft.id !== TRAY) {
        const pick = el('span', 'anomalous-tts-import-section-pick');
        pick.append(button('anomalous-tts-link', t('ttsImportPick'), () => ctx.pick(draft, pickKinds, false)),
            button('anomalous-tts-link', t('ttsImportPickHere'), () => ctx.pick(draft, pickKinds, true)));
        head.append(pick);
    }
    const list = el('div', 'anomalous-tts-batch-list');
    box.append(head, list);
    return { box, list };
}

/** GPT or SoVITS: one file, or a slot saying it is still needed. */
function weightSlot(kind, draft, ctx) {
    const box = el('div', `anomalous-tts-batch-slot is-${kind}`);
    const row = draft.rows.find(r => r.kind === kind);
    const head = el('div', 'anomalous-tts-import-section-head');
    const label = el('span', 'anomalous-tts-import-section-title');
    label.append(el('span', 'anomalous-voice-field-label', t(kind === 'gpt' ? 'ttsImportSlotGpt' : 'ttsImportSlotSovits')));
    if (!row && !draft.target) label.append(el('span', 'anomalous-tts-import-mark is-needed', t('ttsImportMarkNeeded')));
    const pick = el('span', 'anomalous-tts-import-section-pick');
    pick.append(button('anomalous-tts-link', t('ttsImportPick'), () => ctx.pick(draft, [kind], false)),
        button('anomalous-tts-link', t('ttsImportPickHere'), () => ctx.pick(draft, [kind], true)));
    head.append(label, pick);
    box.append(head);
    if (row) {
        rowElements(row, ctx);
        fillMove(row, draft, ctx);
        box.append(row.els.root);
    } else {
        box.append(el('div', 'anomalous-tts-import-empty', t('ttsImportSlotEmpty')));
    }
    return box;
}

/**
 * Draw `draft` into `pane`. `ctx`: `{ status, signal, places(), play(row), pick(draft, kinds, local),
 * onName(draft, value), onSwitchToAdd(draft), onReference(row), onEdited(row), onLanguage(draft, value),
 * onMoveRow(row, id), onRemoveRow(row) }`. `view` is the draft's derived state,
 * `{ conflict, problem, problems, saveTo }`; the returned `refresh(view)` repaints it
 * without rebuilding the fields (typing a name must keep its focus).
 */
export function renderDraftPane(pane, draft, view, ctx) {
    const body = el('div', 'anomalous-tts-batch-pane');
    const conflictLine = el('div', 'anomalous-tts-import-conflict');
    const saveTo = el('div', 'anomalous-tts-hint');
    const problems = el('div', 'anomalous-tts-import-problems');
    const paint = (next) => {
        conflictLine.replaceChildren();
        if (next.conflict?.kind === 'exact') {
            conflictLine.append(el('span', '', t('ttsImportNameTaken', { name: next.conflict.name })),
                button('anomalous-tts-link', t('ttsImportSwitchToAdd'), () => ctx.onSwitchToAdd(draft)));
        } else if (next.conflict) {
            conflictLine.append(el('span', '', t('ttsImportNameTakenVariant', { name: next.conflict.name, variants: next.conflict.variants.join('、') })));
        }
        saveTo.textContent = t('ttsImportSaveTo', { path: next.saveTo });
        problems.replaceChildren();
        // Missing weights already show as "required" on their slots.
        if (next.problem && next.problem[0] !== 'ttsImportWeightsMissing') {
            problems.append(el('div', 'anomalous-tts-import-problem is-blocking', t(next.problem[0], next.problem[1])));
        }
        for (const text of next.problems) problems.append(el('div', 'anomalous-tts-import-problem', text));
    };
    if (draft.id === TRAY) {
        body.append(el('div', 'anomalous-tts-batch-tray-note', t('ttsBatchTrayNote')));
    } else if (draft.target) {
        body.append(el('div', 'anomalous-tts-batch-title', t('ttsImportAddTitle', { name: draft.target })),
            el('div', 'anomalous-tts-hint', t('ttsImportAddSubtitle')));
    } else {
        const nameInput = input('anomalous-uploader-input', t('ttsImportNamePlaceholder'));
        nameInput.value = draft.name;
        nameInput.oninput = () => ctx.onName(draft, nameInput.value);
        const nameField = el('label', 'anomalous-voice-field');
        nameField.append(el('span', 'anomalous-voice-field-label', t('ttsImportName')), nameInput);
        body.append(nameField, conflictLine, saveTo);
    }

    if (draft.id !== TRAY) {
        const weights = el('div', 'anomalous-tts-batch-weights');
        weights.append(weightSlot('gpt', draft, ctx), weightSlot('sovits', draft, ctx));
        body.append(weights);
    }

    const clips = draft.rows.filter(row => row.kind === 'audio');
    const audio = section(t('ttsImportSlotAudio'), clips.length, ['audio'], ctx, draft);
    for (const row of clips) {
        rowElements(row, ctx);
        fillMove(row, draft, ctx);
        audio.list.append(row.els.root);
    }
    if (!clips.length) audio.list.append(el('div', 'anomalous-tts-import-empty', t('ttsImportAudioEmpty')));
    body.append(audio.box);

    const lines = draft.rows.filter(row => row.kind === 'text');
    const text = section(t('ttsImportSlotText'), lines.length, ['text'], ctx, draft);
    for (const row of lines) {
        rowElements(row, ctx);
        fillMove(row, draft, ctx);
        text.list.append(row.els.root);
    }
    if (!lines.length) text.list.append(el('div', 'anomalous-tts-import-empty', t('ttsImportTextEmpty')));
    body.append(text.box);

    if (draft.id !== TRAY) {
        const languageSelect = el('select', 'anomalous-uploader-input');
        for (const code of LANGUAGES) {
            const option = el('option', '', code ? t(`ttsNeededFor_${code}`)
                : draft.detectedLanguage ? t('ttsImportLanguageAutoFound', { lang: t(`ttsNeededFor_${draft.detectedLanguage}`) }) : t('ttsImportLanguageAuto'));
            option.value = code;
            languageSelect.append(option);
        }
        languageSelect.value = draft.language;
        languageSelect.onchange = () => ctx.onLanguage(draft, languageSelect.value);
        const languageField = el('label', 'anomalous-voice-field anomalous-tts-import-language');
        languageField.append(el('span', 'anomalous-voice-field-label', t('ttsImportLanguage')), languageSelect);
        body.append(languageField);
        const missing = missingForLanguage(ctx.status, draft.language || draft.detectedLanguage || '');
        if (missing.length) {
            body.append(el('div', 'anomalous-tts-hint', t('ttsImportPretrainedNote', {
                files: missing.map(item => item.label).join('、'),
                size: formatSize(missing.reduce((sum, item) => sum + (item.size || 0), 0)),
            })));
        }
    }

    body.append(problems);
    paint(view);
    pane.replaceChildren(body);
    syncReference(draft);
    return { refresh: paint };
}
