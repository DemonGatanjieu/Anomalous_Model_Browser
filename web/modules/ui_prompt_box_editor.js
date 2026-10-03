/**
 * One prompt box in Prompt Studio (ui_prompt_target.js makes one per box of the selected node,
 * or two for the draft). Its text shows as tags (prompt_tags.js) or as the whole text; with the
 * meanings on, each tag has its Chinese meaning under it (prompt_gloss.js). A tag is clicked to
 * select it (weight − / +, edit, remove; Delete and + / − on the keyboard), double-clicked to
 * edit, dragged to move. Cards dropped on the box go in where they land, typed text at the end;
 * Chinese is translated to English first, and tags the box has already are not added twice.
 * Every change goes through `write`, which the target turns into a node write or a draft edit.
 */

import { translate as t } from './locales.js';
import { bindPromptCardDrag } from './prompt_card_drag.js';
import { fetchGlosses, glossOf } from './prompt_gloss.js';
import { insertTags, moveTag, promptTagsOf, removeTag, replaceTag, splitPrompt, tagWeight, withWeight } from './prompt_tags.js';
import { hasChinese, translatePromptText } from './translation_service.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const TAG_TYPE = 'application/x-anomalous-prompt-tag';
const CARD_TYPE = 'application/json';
const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative', both: 'recipePromptRoleBoth' };
const WEIGHT_STEP = 0.1;
let nextEditorId = 1;

function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
}

function button(className, label, title, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.onclick = onClick;
    return node;
}

// Translators capitalise the first word; prompt tags are lower case.
const asTag = text => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

/**
 * `role` and `name` label the box; `getValue()` reads its text and `write(value)` changes it
 * (false when it did not). `prefs` is the studio's { view: 'tags' | 'text', gloss }. `refuse(card)`
 * says why a card may not go in ('' when it may); `onSave(value)` keeps the text as a card.
 * `drawer` is the studio drawer, for the handle that drags the text onto the canvas.
 * Returns { element, role, render(), refresh(), addText(text) }.
 */
export function createPromptBoxEditor({ role, name, getValue, write, prefs, refuse, onSave, drawer, scope }) {
    const id = nextEditorId++;
    let lastValue = '';
    let selected = null;
    let editing = false;
    let busy = false;
    let glossTimer = null;
    let glossFailed = false;
    let textTimer = null;
    scope.onDispose(() => { clearTimeout(glossTimer); clearTimeout(textTimer); });

    const element = el('section', `anomalous-ps-box is-${role || 'plain'}`);
    const head = el('header', 'anomalous-ps-box-head');
    head.append(el('span', `anomalous-ps-role is-${role || 'plain'}`, t(ROLE_KEYS[role] || 'currentNodePromptPlain')));
    if (name) head.append(el('span', 'anomalous-ps-box-name', name));
    const actions = el('span', 'anomalous-ps-box-actions');
    const copy = button('anomalous-ps-mini', t('promptStudioCopy'), '', async () => {
        try {
            await navigator.clipboard.writeText(getValue());
            copy.textContent = t('promptStudioCopied');
            setTimeout(() => { if (copy.isConnected) copy.textContent = t('promptStudioCopy'); }, 1200);
        } catch {
            showWorkbenchToast(t('materialCopyError'));
        }
    });
    const save = button('anomalous-ps-mini', t('promptStudioSave'), t('promptStudioSaveHint'), () => {
        if (getValue().trim()) onSave(getValue());
    });
    // The box's text as a card, for dragging onto the canvas (prompt_card_drag.js reads it at drag start).
    const card = { id: `box_${id}`, title: '', content: '', role: role === 'negative' ? 'negative' : 'positive' };
    const handle = el('span', 'anomalous-ps-drag', '⠿');
    handle.title = t('promptStudioDragOut');
    bindPromptCardDrag(handle, card, drawer);
    actions.append(copy, save, handle);
    head.append(actions);

    const chineseBar = el('div', 'anomalous-ps-chinese');
    chineseBar.append(el('span', '', t('promptStudioHasChinese')),
        button('anomalous-ps-mini is-accent', t('promptStudioToEnglish'), '', () => void translateChinese()));

    const tagsEl = el('div', 'anomalous-ps-tags');
    const addInput = el('input', 'anomalous-ps-add');
    addInput.placeholder = t('promptStudioAddPlaceholder');
    addInput.title = t('promptStudioAddHint');
    addInput.onkeydown = async (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        if (await addText(addInput.value)) addInput.value = '';
        addInput.focus();
    };
    const tools = el('div', 'anomalous-ps-tools');
    const textArea = el('textarea', 'anomalous-ps-text');
    textArea.rows = 6;
    textArea.oninput = () => {
        clearTimeout(textTimer);
        textTimer = setTimeout(flushText, 500);
    };
    textArea.onblur = () => flushText();
    element.append(head, chineseBar, tagsEl, tools, textArea);

    const toast = message => showWorkbenchToast(message);

    function flushText() {
        clearTimeout(textTimer);
        if (textArea.value === getValue()) return;
        if (write(textArea.value) !== false) lastValue = textArea.value;
    }

    function commit(next) {
        if (write(next) !== false) render();
    }

    /** Runs `change(text)` on the box's text, unless it changed since it was drawn. */
    function act(change) {
        const now = getValue();
        if (now !== lastValue) { render(); return; }
        const next = change(now);
        if (next !== now) commit(next);
    }

    function setBusy(on) {
        busy = on;
        addInput.disabled = on;
        addInput.placeholder = t(on ? 'promptStudioTranslating' : 'promptStudioAddPlaceholder');
    }

    async function toEnglish(text) {
        if (!hasChinese(text)) return text;
        setBusy(true);
        const result = await translatePromptText(text, { targetLang: 'en', signal: scope.signal });
        setBusy(false);
        if (scope.signal.aborted || !element.isConnected) return null;
        if (!result.ok) { toast(t('promptStudioTranslateFailed')); return null; }
        return result.translated;
    }

    /** Puts `text` (several tags may be in it) in before tag `index`, or at the end. */
    async function addText(text, index = null) {
        const typed = String(text || '').trim();
        if (!typed || busy) return false;
        const english = await toEnglish(typed);
        if (english === null) return false;
        const now = getValue();
        const at = now === lastValue ? index : null;
        const result = insertTags(now, promptTagsOf(english).map(asTag), at);
        if (!result.added) { toast(t('promptStudioAllThere')); return true; }
        if (write(result.value) === false) return false;
        selected = null;
        if (result.skipped) toast(t('promptStudioAddedSkipped', { count: result.added, skipped: result.skipped }));
        render();
        return true;
    }

    async function translateChinese() {
        if (busy) return;
        const now = getValue();
        const targets = splitPrompt(now).items.map((item, index) => ({ index, ...tagWeight(item.text) }))
            .filter(item => hasChinese(item.core));
        if (!targets.length) return;
        setBusy(true);
        const results = await Promise.all(targets.map(item => translatePromptText(item.core, { targetLang: 'en', signal: scope.signal })));
        setBusy(false);
        if (scope.signal.aborted || !element.isConnected) return;
        if (getValue() !== now) { toast(t('currentNodeChangedMeanwhile')); render(); return; }
        let next = now;
        // From the last tag back, so a translation that splits into several tags moves nothing before it.
        for (let position = targets.length - 1; position >= 0; position--) {
            const result = results[position];
            if (result.ok && result.translated) next = replaceTag(next, targets[position].index, withWeight(asTag(result.translated), targets[position].weight));
        }
        if (results.some(result => !result.ok)) toast(t('promptStudioTranslateFailed'));
        if (next !== now) commit(next);
    }

    function weigh(index, step) {
        act(value => {
            const tag = splitPrompt(value).items[index]?.text;
            return tag ? replaceTag(value, index, withWeight(tag, tagWeight(tag).weight + step)) : value;
        });
    }

    function remove(index) {
        // The selection stays on its tag.
        if (selected === index) selected = null;
        else if (selected !== null && selected > index) selected--;
        act(value => removeTag(value, index));
    }

    function startEdit(index, chip) {
        const tag = splitPrompt(getValue()).items[index]?.text;
        if (tag === undefined) return;
        editing = true;
        const input = el('input', 'anomalous-ps-tag-input');
        input.value = tag;
        input.size = Math.max(6, tag.length);
        chip.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (keep) => {
            if (done) return;
            done = true;
            editing = false;
            const typed = input.value.trim();
            if (!keep || typed === tag) { render(); return; }
            const english = await toEnglish(typed);
            if (english === null) { render(); return; }
            act(value => replaceTag(value, index, asTag(english)));
            render();
        };
        input.onkeydown = (event) => {
            if (event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void finish(false); }
        };
        input.onblur = () => void finish(true);
    }

    function glossText(tag) {
        const meaning = glossOf(tag);
        return meaning === undefined ? (glossFailed ? '' : '…') : meaning;
    }

    function showGlosses() {
        for (const span of tagsEl.querySelectorAll('.anomalous-ps-tag-gloss')) span.textContent = glossText(span.dataset.tag);
    }

    function wantGlosses(tags) {
        clearTimeout(glossTimer);
        if (!prefs.gloss || glossFailed || tags.every(tag => glossOf(tag) !== undefined)) return;
        glossTimer = setTimeout(async () => {
            const ok = await fetchGlosses(tags, scope.signal);
            if (scope.signal.aborted || !element.isConnected) return;
            if (!ok) glossFailed = true;
            showGlosses();
        }, 250);
    }

    function chipFor(item, index) {
        const { core, weight } = tagWeight(item.text);
        const chip = el('span', 'anomalous-ps-tag');
        chip.classList.toggle('is-selected', index === selected);
        chip.classList.toggle('is-chinese', hasChinese(core));
        chip.classList.toggle('is-up', weight > 1);
        chip.classList.toggle('is-down', weight < 1);
        chip.draggable = true;
        chip.tabIndex = 0;
        chip.dataset.index = String(index);
        chip.title = t('promptStudioTagHint');
        const main = el('span', 'anomalous-ps-tag-main');
        main.append(el('span', 'anomalous-ps-tag-text', core));
        if (weight !== 1) main.append(el('span', 'anomalous-ps-tag-weight', String(weight)));
        main.append(button('anomalous-ps-tag-x', '×', t('promptStudioRemoveTag'), (event) => {
            event.stopPropagation();
            remove(index);
        }));
        chip.append(main);
        if (prefs.gloss) {
            const gloss = el('span', 'anomalous-ps-tag-gloss', glossText(item.text));
            gloss.dataset.tag = item.text;
            chip.append(gloss);
        }
        chip.onclick = () => {
            selected = selected === index ? null : index;
            render();
            tagsEl.querySelector(`[data-index="${index}"]`)?.focus();
        };
        chip.ondblclick = (event) => {
            event.preventDefault();
            startEdit(index, chip);
        };
        chip.onkeydown = (event) => {
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(index); }
            else if (event.key === '+' || event.key === '=') { event.preventDefault(); weigh(index, WEIGHT_STEP); }
            else if (event.key === '-') { event.preventDefault(); weigh(index, -WEIGHT_STEP); }
            else if (event.key === 'Enter') { event.preventDefault(); startEdit(index, chip); }
            else if (event.key === 'Escape' && selected !== null) { event.stopPropagation(); selected = null; render(); }
        };
        chip.ondragstart = (event) => {
            event.dataTransfer.setData(TAG_TYPE, JSON.stringify({ editor: id, index }));
            event.dataTransfer.setData('text/plain', item.text);
            event.dataTransfer.effectAllowed = 'move';
            chip.classList.add('is-dragging');
        };
        chip.ondragend = () => chip.classList.remove('is-dragging');
        return chip;
    }

    function renderTools(items) {
        tools.replaceChildren();
        const item = selected === null ? null : items[selected];
        tools.hidden = !item;
        if (!item) return;
        const index = selected;
        const { weight } = tagWeight(item.text);
        tools.append(
            button('anomalous-ps-mini', '−', t('promptStudioWeightDown'), () => weigh(index, -WEIGHT_STEP)),
            el('span', 'anomalous-ps-tools-weight', t('promptStudioWeight', { weight })),
            button('anomalous-ps-mini', '+', t('promptStudioWeightUp'), () => weigh(index, WEIGHT_STEP)),
            button('anomalous-ps-mini', t('promptStudioEditTag'), '', () => {
                const chip = tagsEl.querySelector(`[data-index="${index}"]`);
                if (chip) startEdit(index, chip);
            }),
            button('anomalous-ps-mini is-danger', t('promptStudioRemoveTag'), '', () => remove(index)),
        );
    }

    /** Draws the box from its text. */
    function render() {
        const value = getValue();
        lastValue = value;
        card.content = value;
        card.title = name || t(ROLE_KEYS[role] || 'currentNodePromptPlain');
        chineseBar.hidden = !hasChinese(value);
        const asText = prefs.view === 'text';
        element.classList.toggle('is-text-view', asText);
        tagsEl.hidden = asText;
        textArea.hidden = !asText;
        if (asText) {
            tools.hidden = true;
            if (document.activeElement !== textArea) textArea.value = value;
            return;
        }
        const items = splitPrompt(value).items;
        if (selected !== null && selected >= items.length) selected = null;
        const focused = document.activeElement === addInput;
        tagsEl.replaceChildren(...items.map(chipFor));
        if (!items.length) tagsEl.append(el('span', 'anomalous-ps-empty', t('promptStudioEmpty')));
        tagsEl.append(addInput);
        if (focused) addInput.focus();
        renderTools(items);
        wantGlosses(items.map(item => item.text));
    }

    // Where a drop lands: before the tag under or after the pointer, else the end (null).
    function dropIndex(event) {
        for (const chip of tagsEl.querySelectorAll('.anomalous-ps-tag')) {
            const rect = chip.getBoundingClientRect();
            if (event.clientY < rect.top || (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2)) return Number(chip.dataset.index);
        }
        return null;
    }

    function markDrop(index) {
        for (const chip of tagsEl.querySelectorAll('.anomalous-ps-tag')) chip.classList.toggle('is-drop-before', Number(chip.dataset.index) === index);
        addInput.classList.toggle('is-drop-here', index === null);
    }

    function clearDrop() {
        element.classList.remove('is-drop-target');
        for (const chip of tagsEl.querySelectorAll('.is-drop-before')) chip.classList.remove('is-drop-before');
        addInput.classList.remove('is-drop-here');
    }

    const carries = event => [...(event.dataTransfer?.types || [])].some(type => type === TAG_TYPE || type === CARD_TYPE);
    element.addEventListener('dragover', (event) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(TAG_TYPE) ? 'move' : 'copy';
        element.classList.add('is-drop-target');
        if (prefs.view !== 'text') markDrop(dropIndex(event));
    });
    element.addEventListener('dragleave', (event) => {
        if (!element.contains(event.relatedTarget)) clearDrop();
    });
    element.addEventListener('drop', (event) => {
        if (!carries(event)) return;
        event.preventDefault();
        const at = prefs.view === 'text' ? null : dropIndex(event);
        clearDrop();
        const tagData = event.dataTransfer.getData(TAG_TYPE);
        if (tagData) {
            const moved = JSON.parse(tagData);
            if (moved.editor !== id) return; // tags move within their own box
            selected = null;
            act(value => moveTag(value, moved.index, at ?? splitPrompt(value).items.length));
            return;
        }
        let dropped = null;
        try { dropped = JSON.parse(event.dataTransfer.getData(CARD_TYPE)); } catch { return; }
        if (!dropped?.content) return;
        const refusal = refuse(dropped);
        if (refusal) toast(refusal);
        else void addText(dropped.content, at);
    });

    return {
        element,
        role,
        render,
        /** Redraws when the text changed elsewhere (not while it is being edited here). */
        refresh() {
            if (editing || busy || document.activeElement === textArea || getValue() === lastValue) return;
            selected = null;
            render();
        },
        addText,
    };
}