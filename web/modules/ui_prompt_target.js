/**
 * The prompt side of Prompt Studio: the prompt boxes of the prompt node last selected on the
 * canvas, edited in place (each change is a node write and a Ctrl+Z step; Undo here takes the
 * studio's own changes back one by one), or a positive and a negative draft when there is no
 * such node, kept while ComfyUI stays open. The node stays the target when the selection moves
 * to empty canvas or another kind of node; selecting another prompt node switches to it, and
 * "Draft" switches to the draft. The boxes follow edits made on the canvas.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { materialNodeHeading } from './material_inspector.js';
import { applyNodeMaterialValues, selectedMaterialNode } from './node_material_actions.js';
import { promptBoxes } from './prompt_boxes.js';
import { createPromptBoxEditor } from './ui_prompt_box_editor.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const POLL_MS = 400;
const MAX_UNDO = 50;
const ROLE_NAMES = { positive: 'promptStudioPositive', negative: 'promptStudioNegative' };

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

const inOpenGraph = node => Boolean(node?.graph && node.graph.getNodeById(node.id) === node
    && (node.graph === app.graph || node.graph === app.canvas?.graph));

/** Why a card of its role may not go into a box of `boxRole` ('' when it may). */
function refusal(card, boxRole) {
    const cardRole = card.role === 'negative' ? 'negative' : 'positive';
    if ((boxRole === 'positive' || boxRole === 'negative') && boxRole !== cardRole) {
        return t('promptStudioWrongBox', { card: t(ROLE_NAMES[cardRole]), box: t(ROLE_NAMES[boxRole]) });
    }
    return '';
}

/**
 * Fills `parent`. `owner` keeps the draft; `prefs` is the studio's { view, gloss };
 * `onSave(text, role)` keeps a box's text as a card. Returns { addCard(card), render() }.
 */
export function createPromptTarget(parent, { owner, drawer, scope, prefs, onSave }) {
    const draft = owner.promptStudioDraft ||= { positive: '', negative: '' };
    const panel = el('section', 'anomalous-ps-target');
    const head = el('header', 'anomalous-ps-target-head');
    const label = el('div', 'anomalous-ps-target-label');
    const toDraft = button('anomalous-ps-mini', t('promptStudioUseDraft'), t('promptStudioUseDraftHint'), () => show(null));
    const undoButton = button('anomalous-ps-mini', t('promptStudioUndo'), t('promptStudioUndoHint'), undo);
    head.append(label, toDraft, undoButton);
    const note = el('p', 'anomalous-ps-target-note', t('promptStudioDraftHint'));
    const boxesEl = el('div', 'anomalous-ps-boxes');
    panel.append(head, note, boxesEl);
    parent.append(panel);

    let targetNode = null;
    let seen = null; // the selection last looked at
    let editors = [];
    let history = [];

    function setHistory(next) {
        history = next;
        undoButton.disabled = !history.length;
    }

    function undo() {
        const entry = history[history.length - 1];
        if (!entry) return;
        setHistory(history.slice(0, -1));
        try {
            entry();
        } catch {
            showWorkbenchToast(t('materialUndoChanged'));
            setHistory([]);
        }
        editors.forEach(editor => editor.render());
    }

    function nodeEditor(node, box, many) {
        const role = box.role === 'negative' ? 'negative' : 'positive';
        return createPromptBoxEditor({
            role: box.role,
            name: many || box.name !== 'text' ? box.name : '',
            getValue: () => String(box.widget.value ?? ''),
            write(value) {
                try {
                    const applied = applyNodeMaterialValues(app, node, [{ index: box.index, value }]);
                    setHistory([...history.slice(1 - MAX_UNDO), () => applied.undo()]);
                    return true;
                } catch (error) {
                    showWorkbenchToast(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message));
                    return false;
                }
            },
            refuse: card => refusal(card, box.role),
            onSave: value => onSave(value, role),
            prefs, drawer, scope,
        });
    }

    function draftEditor(role) {
        return createPromptBoxEditor({
            role,
            name: '',
            getValue: () => draft[role],
            write(value) {
                const before = draft[role];
                draft[role] = value;
                setHistory([...history.slice(1 - MAX_UNDO), () => {
                    if (draft[role] !== value) throw new Error('materialUndoChanged');
                    draft[role] = before;
                }]);
                return true;
            },
            refuse: card => refusal(card, role),
            onSave: value => onSave(value, role),
            prefs, drawer, scope,
        });
    }

    /** Edits `node`'s prompt boxes, or the draft (null). */
    function show(node) {
        targetNode = node;
        setHistory([]);
        const boxes = node ? promptBoxes(node) : [];
        panel.classList.toggle('is-draft', !node);
        toDraft.hidden = !node;
        note.hidden = Boolean(node);
        label.textContent = node
            ? t('promptStudioEditing', { node: `${materialNodeHeading(node) || node.type} #${node.id}` })
            : t('promptStudioDraft');
        editors = node ? boxes.map(box => nodeEditor(node, box, boxes.length > 1)) : ['positive', 'negative'].map(draftEditor);
        boxesEl.replaceChildren(...editors.map(editor => editor.element));
        editors.forEach(editor => editor.render());
    }

    function tick() {
        const selected = selectedMaterialNode(app);
        if (selected !== seen) {
            seen = selected;
            if (selected && selected !== targetNode && promptBoxes(selected).length) { show(selected); return; }
        }
        if (targetNode && !inOpenGraph(targetNode)) { show(null); return; }
        editors.forEach(editor => editor.refresh());
    }

    seen = selectedMaterialNode(app);
    show(seen && promptBoxes(seen).length ? seen : null);
    const timer = setInterval(tick, POLL_MS);
    scope.onDispose(() => clearInterval(timer));

    return {
        /** A card clicked: into the box of its role (or one that takes either), at the end. */
        addCard(card) {
            const role = card.role === 'negative' ? 'negative' : 'positive';
            const editor = editors.find(item => item.role === role) || editors.find(item => !refusal(card, item.role));
            if (!editor) {
                showWorkbenchToast(t('promptStudioNoBoxFor', { card: t(ROLE_NAMES[role]) }));
                return;
            }
            void editor.addText(card.content);
        },
        render: () => editors.forEach(editor => editor.render()),
    };
}