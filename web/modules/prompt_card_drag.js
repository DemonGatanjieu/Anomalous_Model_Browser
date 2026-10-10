/**
 * Dragging a Prompt Studio card out of the drawer onto the canvas (material_drag.js runs the
 * drag, prompt_drop.js outlines the boxes and shows what lands where): on a prompt box the
 * card's text fills it; on empty canvas it becomes a prompt node of the card's role. Inside
 * the drawer the drag passes through, so the studio's prompt boxes still take the card. A box's
 * own handle drags it as a card whose text is the box's text when the drag starts. A fill or
 * new node is one Ctrl+Z step, and the toast's Undo takes it back.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { recordCanvasStep } from './canvas_history.js';
import { bindMaterialDrag } from './material_drag.js';
import { fillPrompt } from './node_material_actions.js';
import {
    clearDropPreview, markTargetBox, outlinePromptBoxes, prepareTextDrag, previewPromptDrop, promptBoxAt,
    promptDropHint, promptRefusal,
} from './prompt_drop.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const NODE_COLOURS = { positive: ['#235327', '#143818'], negative: ['#532323', '#381616'] };

/** A card's text as the envelope prompt boxes are filled from. */
function envelopeOf(card) {
    const negative = card.role === 'negative';
    return {
        positive: negative ? '' : card.content,
        negative: negative ? card.content : '',
        singleText: card.content,
        primaryRole: negative ? 'negative' : 'positive',
        hasPrompt: Boolean(card.content.trim()),
    };
}

function undoToast(message, undo) {
    showWorkbenchToast(message, { label: t('activityUndo'), run: undo });
}

function fillBox(node, box, envelope) {
    if (node.widgets?.[box.index] !== box.widget) throw new Error('materialTargetChanged');
    const result = fillPrompt(app, node, envelope, box, { record: false });
    recordCanvasStep(app);
    undoToast(t('promptFilledOne', { node: `#${node.id}` }), () => {
        result.undo();
        recordCanvasStep(app);
    });
}

function addPromptNode(graph, position, card) {
    const node = globalThis.LiteGraph?.createNode('CLIPTextEncode');
    if (!node) return;
    const role = card.role === 'negative' ? 'negative' : 'positive';
    node.title = t(role === 'negative' ? 'promptNodeNegative' : 'promptNodePositive');
    [node.color, node.bgcolor] = NODE_COLOURS[role];
    node.pos = [position[0], position[1]];
    graph.add(node);
    const box = node.widgets?.find(widget => widget.name === 'text');
    if (box) {
        box.value = card.content;
        box.callback?.call(box, card.content, app.canvas, node);
    }
    app.canvas?.selectNode?.(node);
    graph.setDirtyCanvas?.(true, true);
    recordCanvasStep(app);
    undoToast(t('promptNodesCreated', { count: 1 }), () => {
        const loose = graph.getNodeById(node.id) === node
            && !(node.inputs || []).some(input => input?.link != null) && !(node.outputs || []).some(output => output?.links?.length);
        if (app.graph !== graph || !loose) {
            showWorkbenchToast(t('materialUndoChanged'));
            return;
        }
        graph.remove(node);
        graph.setDirtyCanvas?.(true, true);
        recordCanvasStep(app);
    });
}

/**
 * Lets `element`, the card of `card` ({ id, title, content, role }), be dragged onto the
 * canvas; `drawer` is the studio drawer the drag passes through. The text is read when the
 * drag starts; an empty one does not drag.
 */
export function bindPromptCardDrag(element, card, drawer) {
    const key = `card:${card.id}`;
    let envelope = envelopeOf(card);
    bindMaterialDrag(element, null, {
        effectAllowed: 'copyMove',
        passThrough: event => drawer.contains(event.target),
        payload: () => {
            envelope = envelopeOf(card);
            if (!envelope.hasPrompt) return null;
            return { filename: key, name: card.title, kind: 'prompt_plan', envelope, dragHint: t('promptDragHint'), dragTargetHint: t('promptCardDragCanvas') };
        },
        accepts: (node, data, event) => !promptRefusal(node, event),
        targetHint: (node, data, event) => promptDropHint(data, node, promptBoxAt(node, event)),
        rejectHint: (node, data, event) => promptRefusal(node, event),
        onStart: () => {
            prepareTextDrag(key, envelope);
            const removeOutlines = outlinePromptBoxes(app.graph);
            return () => { clearDropPreview(); removeOutlines(); };
        },
        onMove: (node, data, event) => {
            const box = node && promptBoxAt(node, event);
            markTargetBox(box);
            previewPromptDrop(data, node, box);
        },
        drop: (node, data, graph, event) => {
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            const box = promptBoxAt(node, event);
            if (!box) throw new Error('promptDropPickBox');
            fillBox(node, box, envelope);
        },
        dropOnCanvas: async (event, data, graph, position) => {
            if (app.graph !== graph || !position) throw new Error('materialTargetChanged');
            addPromptNode(graph, position, card);
        },
    });
}
