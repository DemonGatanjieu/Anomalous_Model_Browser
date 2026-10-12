/**
 * A gallery card's right-click menu: put the picture on the canvas as a Load Image node, or
 * open its parameters. The node reads the output file where it is ("name.png [output]",
 * ComfyUI's own way to name an output file), so nothing is copied into the input folder.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { recordCanvasStep } from './canvas_history.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

let closeOpenMenu = null;

function row(icon, label, run, close) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'anomalous-keep-row';
    item.setAttribute('role', 'menuitem');
    const mark = document.createElement('span');
    mark.className = 'anomalous-keep-row-icon';
    mark.textContent = icon;
    const text = document.createElement('strong');
    text.textContent = label;
    item.append(mark, text);
    item.onclick = () => {
        close();
        run();
    };
    return item;
}

/** A Load Image node in the middle of the visible canvas, showing `image` from the output folder. */
export function insertLoadImageNode(image) {
    const node = globalThis.LiteGraph?.createNode('LoadImage');
    const widget = node?.widgets?.find(item => item.name === 'image');
    if (!node || !widget || !app.graph) {
        showWorkbenchToast(t('galleryInsertNodeFailed'));
        return;
    }
    const [x, y, width, height] = app.canvas?.visible_area || [0, 0, 0, 0];
    node.pos = [x + width / 2 - node.size[0] / 2, y + height / 2 - node.size[1] / 2];
    app.graph.add(node);
    const file = image.subfolder ? `${image.subfolder}/${image.filename}` : image.filename;
    widget.value = `${file} [output]`;
    widget.callback?.(widget.value); // shows the picture in the node
    app.canvas?.selectNode?.(node);
    app.graph.setDirtyCanvas(true, true);
    recordCanvasStep(app);
    showWorkbenchToast(t('galleryInsertNodeDone'));
}

/** Opens the menu at the pointer; `openDetails()` opens the picture's parameters. */
export function openGalleryCardMenu(event, image, { openDetails }) {
    event.preventDefault();
    closeOpenMenu?.();
    const menu = document.createElement('div');
    menu.className = 'anomalous-keep-menu anomalous-gallery-card-menu';
    menu.setAttribute('role', 'menu');
    const onPointer = (pointer) => { if (!menu.contains(pointer.target)) close(); };
    const onKey = (key) => {
        if (key.key !== 'Escape') return;
        key.stopPropagation();
        close();
    };
    const close = () => {
        menu.remove();
        window.removeEventListener('pointerdown', onPointer, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('wheel', close, true);
        if (closeOpenMenu === close) closeOpenMenu = null;
    };
    menu.append(
        row('🖼️', t('galleryInsertAsNode'), () => insertLoadImageNode(image), close),
        row('🔍', t('materialViewParameters'), openDetails, close),
    );
    document.body.append(menu);
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', close, true);
    closeOpenMenu = close;
}
