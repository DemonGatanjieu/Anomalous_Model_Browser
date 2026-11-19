/**
 * The home page's AI starter cards (ui_ai_starters.js draws them) and the spacious in-workbench
 * starter composer opened directly inside the AI workbench (`renderStarterComposer`: `private`,
 * `picture`, `say`, `canvas`, `try`). "Run my preset" (`preset`) stays in its own dialog
 * (`openStarter` -> ui_ai_preset_sheet.js + ui_ai_start_steps.js) since without changes it runs on
 * its own with no AI. `STARTERS` keeps each card's shape and locale keys (`tests/test_ai_starters.py`).
 */

import { marked } from './ai_hide_mark.js';
import { composeFirstNote, startFactSentence } from './ai_start_from.js';
import { translate as t } from './locales.js';
import { fadeIn } from './ui_ai_art.js';
import { CANVAS_WISHES, frontTab } from './ui_ai_canvas_hand.js';
import { aiWindow } from './ui_ai_connect.js';
import { pictureGrid, thumbUrl } from './ui_ai_gallery_pick.js';
import { startTask } from './ui_ai_handoff.js';
import { icon } from './ui_ai_icons.js';
import { presetFields } from './ui_ai_preset_sheet.js';
import { loraPicker, sealFlow } from './ui_ai_private_sheet.js';
import { applyTaskRoute, startFromSection } from './ui_ai_start_from.js';
import { startSteps } from './ui_ai_start_steps.js';
import { createViewScope } from './ui_lifecycle.js';

const NEW_TAB = { canvas: 'new' };
const MAX_SEALED = 1500;
const DRAWS = ['try', 'say', 'private'];
export const COMPOSER_STARTERS = ['private', 'picture', 'say', 'canvas', 'try'];
const EXAMPLES = {
    say: ['aiStartSayEx1', 'aiStartSayEx2', 'aiStartSayEx3'],
    private: ['aiStartGistEx1', 'aiStartGistEx2', 'aiStartGistEx3'],
    picture: ['aiStartHowEx1', 'aiStartHowEx2', 'aiStartHowEx3'],
};

// lines: [kind] shown under "What happens on Start?" (`aiStartSheet_<kind>`).
export const STARTERS = [
    { id: 'try', icon: 'sparkle', tags: ['newTab', 'small'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'preset', icon: 'workflows', tags: ['newTab', 'saved'], lines: [['kept']] },
    { id: 'say', icon: 'pencil', tags: ['newTab', 'download'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'picture', icon: 'image', tags: ['original', 'newTab'], lines: [['start'], ['kept'], ['mind']] },
    { id: 'private', icon: 'lock', tags: ['sealed', 'newTab'], lines: [['out']] },
    { id: 'canvas', icon: 'nodes', tags: ['undo'] },
];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** The tags a card shows: "asks before downloads" only while the gates do. */
export function cardTags(card, data) {
    return card.tags.filter(tag => tag !== 'download' || data.download_asks);
}

function field(label, control) {
    const box = el('label', 'anomalous-ai-start-field');
    box.append(el('span', 'anomalous-ai-start-label', label), control);
    return box;
}

function textInput(placeholder) {
    const input = el('input', 'anomalous-ai-start-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = 300;
    return input;
}

function readyLines(card, data) {
    if (!data) return [];
    const came = Boolean(data.app || data.came);
    const lines = [{ ok: came, text: came ? t(data.app ? 'aiStartReadyApp' : 'aiStartReadyCame', { client: data.app?.client }) : t('aiStartReadyNoApp') }];
    if (DRAWS.includes(card.id)) lines.push({ ok: data.models > 0, text: data.models > 0 ? t('aiStartReadyModels', { count: data.models }) : t('aiStartReadyNoModels') });
    return lines;
}

function readyBox(lines, box = el('div', 'anomalous-ai-start-ready')) {
    box.replaceChildren(...lines.map(({ ok, text }) => {
        const node = el('div', `anomalous-ai-start-ready-line${ok ? ' is-ok' : ''}`);
        node.append(icon(ok ? 'check' : 'alert', 13), el('span', '', text));
        return node;
    }));
    return box;
}

function examples(input, keys) {
    const row = el('div', 'anomalous-ai-start-examples');
    for (const key of keys) {
        row.append(button('anomalous-ai-start-example', t(key), () => {
            input.value = t(key);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        }));
    }
    return row;
}

const postRoute = picked => taskId => applyTaskRoute(taskId, picked);

function pictureFields() {
    let chosen = null;
    const preview = el('div', 'anomalous-ai-composer-pic-preview');
    const how = textInput(t('aiStartHowHint'));
    how.setAttribute('aria-label', t('aiStartStepHow'));
    const drawPreview = () => {
        if (!chosen) {
            preview.classList.add('is-empty');
            preview.replaceChildren(icon('image', 22), el('span', '', t('aiComposerPickPicEmpty')));
            return;
        }
        preview.classList.remove('is-empty');
        const img = el('img');
        img.src = thumbUrl(chosen.image);
        img.alt = chosen.title || '';
        const meta = el('div', 'anomalous-ai-composer-pic-meta');
        meta.append(el('span', 'anomalous-ai-composer-pic-name', chosen.title || chosen.id));
        preview.replaceChildren(img, meta);
    };
    const grid = pictureGrid({
        picked: id => chosen?.id === id,
        pick: (item) => {
            chosen = chosen?.id === item.id ? null : item;
            drawPreview();
            if (chosen && !how.value.trim()) how.focus();
        },
    });
    drawPreview();
    const editBox = el('div', 'anomalous-ai-composer-pic-edit');
    editBox.append(field(t('aiStartStepHow'), how), examples(how, EXAMPLES.picture));
    const top = el('div', 'anomalous-ai-composer-pic-top');
    top.append(preview, editBox);
    const gallery = el('div', 'anomalous-ai-composer-section anomalous-ai-composer-pictures');
    gallery.append(el('h3', 'anomalous-ai-composer-h', t('aiStartStepPicture')), grid.search, grid.grid);
    return {
        nodes: [top, gallery],
        stop: () => grid.stop(),
        task: () => {
            if (!chosen) return 'aiStartNeedPicture';
            if (!how.value.trim()) return 'aiStartNeedText';
            return { title: how.value.trim(), about: [{ type: 'image', image: chosen.id, label: chosen.title }] };
        },
    };
}

function privateFields(data) {
    const from = startFromSection({ data, cards: true });
    const loras = loraPicker();
    const gist = textInput(t('aiStartGistHint'));
    const prompt = el('textarea', 'anomalous-ai-start-input');
    prompt.placeholder = t('aiStartSealedHint');
    prompt.maxLength = MAX_SEALED;
    prompt.rows = 4;
    const promptField = field(t('aiStartSealed'), prompt);
    promptField.classList.add('is-sealed');
    promptField.querySelector('.anomalous-ai-start-label')?.prepend(icon('lock', 13));
    const gistField = field(t('aiStartGist'), gist);
    gistField.classList.add('is-plain');

    const promptSec = el('section', 'anomalous-ai-composer-section');
    promptSec.append(el('h3', 'anomalous-ai-composer-h', t('aiStartStepWrite')), promptField, sealFlow());
    const fromSec = el('section', 'anomalous-ai-composer-section');
    fromSec.append(el('h3', 'anomalous-ai-composer-h', t('aiStartStepFrom')), from.node);
    const moreSec = el('section', 'anomalous-ai-composer-section');
    moreSec.append(el('h3', 'anomalous-ai-composer-h', t('aiStartStepMore')),
        el('p', 'anomalous-ai-start-step-hint', t('aiStartStepMoreHint')), loras.node, gistField, examples(gist, EXAMPLES.private));

    return {
        nodes: [promptSec, fromSec, moreSec],
        stop: () => from.stop(),
        task: () => {
            const picked = from.read();
            if (picked.errorKey || picked.errorText) return picked;
            const sealed = prompt.value.trim();
            if (!gist.value.trim() && !sealed) return 'aiStartNeedGist';
            from.save();
            const fact = startFactSentence({ ...picked, secret: true }, t, marked);
            const files = loras.read();
            const cardNote = [sealed ? t('aiPresetSayPrompt', { prompt: marked(sealed) }) : '',
                files.length ? t('aiStartUseLoras', { loras: files.join(t('listSeparator')) }) : ''].filter(Boolean).join(' ');
            return {
                title: gist.value.trim() || t('aiStartPrivateTask'),
                note: composeFirstNote(fact, cardNote),
                beforeNote: picked.mode === 'new' ? postRoute(picked) : null,
            };
        },
    };
}

function sayFields(data) {
    const from = startFromSection({ data, cards: true });
    const words = textInput(t('aiStartSayHint'));
    words.setAttribute('aria-label', t('aiStartStepWrite'));
    const writeSec = el('section', 'anomalous-ai-composer-section');
    writeSec.append(el('h3', 'anomalous-ai-composer-h', t('aiStartStepWrite')), words, examples(words, EXAMPLES.say));
    const fromSec = el('section', 'anomalous-ai-composer-section');
    fromSec.append(el('h3', 'anomalous-ai-composer-h', t('aiStartStepFrom')), from.node);
    return {
        nodes: [writeSec, fromSec],
        stop: () => from.stop(),
        task: () => {
            const picked = from.read();
            if (picked.errorKey || picked.errorText) return picked;
            if (!words.value.trim()) return 'aiStartNeedText';
            from.save();
            const fact = startFactSentence({ ...picked, secret: false }, t);
            return {
                title: words.value.trim(),
                about: picked.mode === 'card' && picked.cardName ? [{ type: 'workflow', name: picked.cardName }] : [],
                note: composeFirstNote(fact, ''),
                beforeNote: picked.mode === 'new' ? postRoute(picked) : null,
            };
        },
    };
}

function canvasFields() {
    const tab = frontTab();
    const line = el('textarea', 'anomalous-ai-start-input');
    line.rows = 3;
    line.maxLength = 1000;
    const wishes = el('div', 'anomalous-ai-canvas-wishes');
    for (const key of CANVAS_WISHES) {
        const text = t(`aiCanvasWish_${key}`);
        wishes.append(button('anomalous-ai-canvas-wish', text, () => { line.value = text; line.focus(); }));
    }
    line.value = wishes.firstChild?.textContent || '';
    const sec = el('section', 'anomalous-ai-composer-section');
    sec.append(
        el('div', 'anomalous-ai-composer-canvas-note', tab.name ? t('aiComposerCanvasAt', { name: tab.name }) : t('aiComposerCanvasNone')),
        el('h3', 'anomalous-ai-composer-h', t('aiComposerCanvasWishLabel')),
        wishes,
        line,
    );
    return {
        nodes: [sec],
        task: () => {
            const text = String(line.value || '').trim();
            if (!text) return 'aiStartNeedText';
            return {
                title: `${text}${t('aiCanvasOfCanvas', { name: tab.name })}`,
                about: tab.path ? [{ type: 'canvas', tab: tab.path, label: tab.name }] : [],
                switches: {},
            };
        },
    };
}

function composerFields(card, data) {
    if (card.id === 'try') return { nodes: [el('p', 'anomalous-ai-start-empty', t('aiStart_try_body'))], task: () => ({ title: t('aiStartTryTask') }) };
    if (card.id === 'picture') return pictureFields();
    if (card.id === 'private') return privateFields(data);
    if (card.id === 'canvas') return canvasFields();
    return sayFields(data);
}

function cardLinesBlock(card) {
    if (!card.lines?.length) return null;
    const lines = el('details', 'anomalous-ai-start-lines');
    lines.append(el('summary', '', t('aiStartSheetMore')));
    for (const [kind] of card.lines) {
        const line = el('div', `anomalous-ai-start-line is-${kind}`);
        line.append(el('span', 'anomalous-ai-start-line-label', t(`aiStartSheet_${kind}`)), el('span', '', t(`aiStart_${card.id}_${kind}`)));
        lines.append(line);
    }
    return lines;
}

/**
 * Draws the in-workbench starter workspace inside `host` ('.anomalous-ai-task'). Returns a dispose
 * function cancelling any open media / async work.
 */
export function renderStarterComposer(host, { owner, cardId, data, onBack, onSwitch, onDone, onCancel }) {
    const scope = createViewScope();
    const card = STARTERS.find(item => item.id === cardId) || STARTERS.find(item => item.id === 'private');
    let stopFields = null;
    scope.onDispose(() => stopFields?.());

    const bar = el('div', 'anomalous-ai-composer-bar');
    const back = button('anomalous-ai-back', `‹ ${t('aiAllTasks')}`, () => onBack?.());
    const tabs = el('div', 'anomalous-ai-composer-tabs');
    tabs.setAttribute('role', 'toolbar');
    tabs.setAttribute('aria-label', t('aiStartTitle'));
    for (const id of COMPOSER_STARTERS) {
        const item = STARTERS.find(s => s.id === id);
        if (!item) continue;
        const tab = el('button', `anomalous-ai-composer-tab${id === card.id ? ' is-on' : ''}`);
        tab.type = 'button';
        tab.setAttribute('aria-pressed', String(id === card.id));
        tab.append(icon(item.icon, 14), el('span', '', t(`aiStart_${id}_title`)));
        tab.onclick = () => { if (id !== card.id) onSwitch?.(id); };
        tabs.append(tab);
    }
    const closeBtn = button('anomalous-ai-link anomalous-ai-composer-close', t('dialogCancel'), () => onCancel?.());
    bar.append(back, tabs, closeBtn);

    const head = el('div', 'anomalous-ai-composer-head');
    const art = el('img', 'anomalous-ai-start-sheet-art');
    art.alt = '';
    art.src = new URL(`../assets/start_${card.id}.webp`, import.meta.url).href;
    art.onerror = () => art.replaceWith(icon(card.icon, 28));
    fadeIn(art);
    const titleWords = el('div', 'anomalous-ai-composer-title-words');
    const readyHolder = el('div', 'anomalous-ai-composer-ready');
    titleWords.append(el('h2', 'anomalous-ai-composer-title', t(`aiStart_${card.id}_title`)),
        el('p', 'anomalous-ai-composer-sub', t(`aiStart_${card.id}_body`)), readyHolder);
    head.append(art, titleWords);

    const scroll = el('div', 'anomalous-ai-composer-scroll');
    const fieldsHost = el('div', 'anomalous-ai-composer-fields');
    const lines = cardLinesBlock(card);
    scroll.append(head, fieldsHost, ...(lines ? [lines] : []));

    const error = el('div', 'anomalous-ai-start-error');
    const say = (missing) => {
        error.textContent = !missing ? '' : typeof missing === 'string' ? t(missing) : missing.errorKey ? t(missing.errorKey) : missing.errorText;
    };
    let currentFields = null;
    const go = button('anomalous-ai-start-go', t('aiStartGo'), async () => {
        if (!currentFields || go.disabled) return;
        const task = currentFields.task();
        if (typeof task === 'string' || task?.errorKey || task?.errorText) return say(task);
        go.disabled = true;
        try {
            const switches = task.switches || (card.id === 'private' ? { ...NEW_TAB, privacy: true } : NEW_TAB);
            // `openAiTask` inside `startTask` closes the composer once created; on error, typed fields stay intact.
            await startTask(owner, task.title, task.about || [], onDone, switches, task.note || '', task.beforeNote || null);
        } finally {
            go.disabled = false;
        }
    });
    const dock = el('div', 'anomalous-ai-composer-dock');
    const actions = el('div', 'anomalous-ai-start-actions');
    actions.append(button('anomalous-ai-link', t('dialogCancel'), () => onCancel?.()), go);
    dock.append(error, actions);

    const composer = el('div', 'anomalous-ai-composer');
    composer.append(bar, scroll, dock);
    composer.addEventListener('input', () => { error.textContent = ''; });
    composer.addEventListener('change', () => { error.textContent = ''; });
    composer.addEventListener('click', (event) => {
        if (event.target.closest('button:not(.anomalous-ai-start-go)')) error.textContent = '';
    });
    host.replaceChildren(composer);

    void Promise.resolve(data).then((resolved) => {
        if (scope.signal.aborted) return;
        const safeData = resolved || { workflows: [], models: 0 };
        const readiness = readyLines(card, safeData);
        if (readiness.length) readyHolder.replaceChildren(readyBox(readiness));
        currentFields = composerFields(card, safeData);
        stopFields = currentFields.stop || null;
        fieldsHost.replaceChildren(...currentFields.nodes);
        fieldsHost.querySelector('textarea, input:not([hidden]), button:not(:disabled):not([hidden])')?.focus();
    });

    return () => scope.dispose();
}

/** Opens the standalone modal sheet (currently used for "Run my preset"). */
export function openStarter(owner, card, data) {
    const body = el('div', 'anomalous-ai-start-sheet');
    let close = () => {};
    const error = el('div', 'anomalous-ai-start-error');
    const go = button('anomalous-ai-start-go', t('aiStartGo'), async () => {
        if (!fields.start) return;
        go.disabled = true;
        error.textContent = await fields.start();
        go.disabled = false;
    });
    const fields = data.workflows.length
        ? presetFields({ data, owner, close: () => close(), go })
        : {
            nodes: [el('p', 'anomalous-ai-start-empty', t('aiStartNoWorkflows')),
                button('anomalous-ai-link', t('aiStartToWorkflows'), () => { close(); owner.goTo?.('recipes'); })],
            start: null,
        };
    const lines = cardLinesBlock(card);
    const actions = el('div', 'anomalous-ai-start-actions');
    const scroll = el('div', 'anomalous-ai-start-scroll');
    if (fields.steps) {
        if (lines) fields.steps.at(-1).nodes.push(lines);
        const stepped = startSteps(fields.steps, { go, cancel: () => close(), say: msg => { error.textContent = msg ? t(msg) : ''; } });
        scroll.replaceChildren(...stepped.nodes);
        actions.append(...stepped.actions);
    } else {
        const head = el('div', 'anomalous-ai-start-sheet-head');
        const picture = el('img', 'anomalous-ai-start-sheet-art');
        picture.alt = '';
        picture.src = new URL(`../assets/start_${card.id}.webp`, import.meta.url).href;
        fadeIn(picture);
        head.append(picture);
        scroll.append(head, ...fields.nodes, ...(lines ? [lines] : []));
        actions.append(button('anomalous-ai-link', t('dialogCancel'), () => close()));
    }
    body.append(scroll, error, actions);
    close = aiWindow(t(`aiStart_${card.id}_title`), body);
    body.querySelector('textarea, input:not([hidden]), select, button')?.focus();
}
