import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text } from './ui_dom.js';
import { materialNodeHeading } from './material_inspector.js';
import { anomalousAlert } from './ui_dialog.js';
import { recordCanvasStep } from './canvas_history.js';

let activeDrag = null;

export function getCanvasPosition(event, canvas) {
    if (!canvas) return null;
    let position = null;
    if (canvas.convertEventToCanvasOffset) position = canvas.convertEventToCanvasOffset(event);
    else if (canvas.adjustMouseEvent) { canvas.adjustMouseEvent(event); position = [event.canvasX, event.canvasY]; }
    return position && position.every(Number.isFinite) ? position : null;
}

export function materialDropNode(event, canvas, graph) {
    const surface = canvas?.canvas;
    if (!surface || !graph || canvas.graph !== graph) return null;
    const rect = surface.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    // DOM text widgets overlay the canvas, so accept their drop surface too.
    if (event.target !== surface && !event.target?.closest?.('.dom-widget')) return null;
    const position = getCanvasPosition(event, canvas);
    if (!position) return null;
    const node = graph.getNodeOnPos?.(position[0], position[1]);
    return node && graph.getNodeById(node.id) === node ? node : null;
}

/**
 * Only this page's active drag can mutate a node; transfer data is never trusted.
 * `accepts`, `targetHint`, `rejectHint` and `drop` also get the drag event, for what is
 * under the pointer. Optional `targetHint(node, data, event)` says what dropping on an
 * accepted node will do; optional `rejectHint(node, data, event)` explains why a hovered
 * node is refused. Optional `onStart(data)` may return what to undo when the drag ends;
 * optional `onMove(node, data, event)` follows the accepted node under the pointer (or null).
 * Optional `passThrough(event)` leaves events over some part of the page (a drop zone of its
 * own) alone; `effectAllowed` defaults to 'copy'. `owner` may be null (no browser to fold).
 * After a drop handler finishes the canvas is recorded as a ComfyUI history step, so a drop
 * survives a reload and Ctrl+Z takes it back even when the handler forgot to.
 */
export function bindMaterialDrag(element, owner, { payload, accepts, drop, dropOnCanvas, targetHint, rejectHint, onStart, onMove, passThrough, effectAllowed = 'copy' }) {
    element.draggable = true;
    element.addEventListener('dragstart', event => {
        if (event.target !== element && event.target?.closest?.('button, input, textarea, select')) { event.preventDefault(); return; }
        const data = payload();
        const graph = app.graph;
        const canvas = app.canvas;
        if (!data || !event.dataTransfer || !canvas?.canvas) { event.preventDefault(); return; }
        activeDrag?.();
        event.stopPropagation();
        event.dataTransfer.setData('application/x-anomalous-material', 'local-drag');
        event.dataTransfer.effectAllowed = effectAllowed;
        const defaultHint = data.dragHint || t('materialDropHint');
        const hint = text(document.body, 'div', defaultHint, 'anomalous-material-drag-hint');
        hint.setAttribute('role', 'status');
        const stopStart = onStart?.(data);
        const cleanup = () => {
            clearTimeout(reveal);
            stopStart?.();
            owner?.modal?.classList.remove('anomalous-material-dragging');
            hint.remove();
            for (const [name, fn] of listeners) window.removeEventListener(name, fn, true);
            if (activeDrag === cleanup) activeDrag = null;
        };
        const isOverCanvasSurface = event => {
            const surface = canvas?.canvas;
            if (!surface || app.graph !== graph || app.canvas !== canvas || canvas.graph !== graph) return false;
            if (event.target !== surface && !event.target?.closest?.('.dom-widget')) return false;
            const rect = surface.getBoundingClientRect();
            return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        };
        const target = event => app.graph === graph && app.canvas === canvas ? materialDropNode(event, canvas, graph) : null;
        const over = event => {
            if (passThrough?.(event)) {
                hint.style.visibility = 'hidden';
                onMove?.(null, data, event);
                return;
            }
            hint.style.visibility = '';
            event.preventDefault(); event.stopImmediatePropagation();
            const node = target(event);
            const validNode = !!node && accepts?.(node, data, event);
            // A node that says why it refuses is not "blank canvas".
            const refusal = node && !validNode ? rejectHint?.(node, data, event) || '' : '';
            onMove?.(validNode ? node : null, data, event);
            if (validNode) {
                event.dataTransfer.dropEffect = 'copy';
                hint.classList.add('is-target-valid');
                hint.classList.remove('is-target-refused');
                hint.textContent = targetHint?.(node, data, event) || t('materialDropTarget', { name: materialNodeHeading(node) });
            } else if (!refusal && dropOnCanvas && isOverCanvasSurface(event)) {
                event.dataTransfer.dropEffect = 'copy';
                hint.classList.add('is-target-valid');
                hint.textContent = data.dragTargetHint || defaultHint;
            } else {
                event.dataTransfer.dropEffect = 'none';
                hint.classList.remove('is-target-valid');
                hint.classList.toggle('is-target-refused', Boolean(refusal));
                hint.textContent = refusal || defaultHint;
            }
            hint.style.left = `${Math.max(8, Math.min(event.clientX + 16, window.innerWidth - 250))}px`;
            hint.style.top = `${Math.max(8, event.clientY - 48)}px`;
        };
        const finish = async event => {
            if (passThrough?.(event)) {
                cleanup();
                return;
            }
            event.preventDefault(); event.stopImmediatePropagation();
            const node = target(event);
            const validNode = !!node && accepts?.(node, data, event);
            const refused = node && !validNode && Boolean(rejectHint?.(node, data, event));
            const overCanvas = isOverCanvasSurface(event);
            cleanup();
            if (validNode) {
                try { await drop(node, data, graph, event); recordCanvasStep(app); }
                catch (error) { await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message)); }
                return;
            }
            if (!refused && dropOnCanvas && overCanvas) {
                const pos = getCanvasPosition(event, canvas);
                try { await dropOnCanvas(event, data, graph, pos); recordCanvasStep(app); }
                catch (error) { await anomalousAlert(t(error.message) === error.message ? t('recipeOpenError') : t(error.message)); }
                return;
            }
        };
        const escape = event => { if (event.key === 'Escape') cleanup(); };
        const listeners = [['dragover', over], ['drop', finish], ['dragend', cleanup], ['keydown', escape], ['blur', cleanup]];
        // Let the browser capture the card's drag image before revealing the canvas.
        const reveal = setTimeout(() => owner?.modal?.classList.add('anomalous-material-dragging'), 0);
        activeDrag = cleanup;
        for (const [name, fn] of listeners) window.addEventListener(name, fn, true);
    });
}
