/**
 * A gallery card's right-click menu: put the picture on the canvas as a Load Image node, or
 * open its parameters. The picture is uploaded into the input folder the way a dropped file is
 * (ComfyUI keeps one copy of the same picture): a "name.png [output]" value would be flagged
 * as a missing file by ComfyUI's checks for any picture not made since ComfyUI started.
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

/** The output picture uploaded into the input folder; its name there for a Load Image node. */
async function copyToInput(image) {
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: 'output' });
    const picture = await fetch(`/view?${query}`);
    if (!picture.ok) throw new Error(`view ${picture.status}`);
    const blob = await picture.blob();
    const form = new FormData();
    form.append('image', new File([blob], image.filename, { type: blob.type }));
    form.append('type', 'input');
    const response = await fetch('/upload/image', { method: 'POST', body: form });
    if (!response.ok) throw new Error(`upload ${response.status}`);
    const data = await response.json();
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/** A Load Image node in the middle of the visible canvas, showing `image`. */
export async function insertLoadImageNode(image) {
    const node = globalThis.LiteGraph?.createNode('LoadImage');
    const widget = node?.widgets?.find(item => item.name === 'image');
    let file = null;
    try {
        if (node && widget && app.graph) file = await copyToInput(image);
    } catch (error) {
        console.error('[AMB] Could not copy the picture into the input folder:', error);
    }
    if (!file) {
        showWorkbenchToast(t('galleryInsertNodeFailed'));
        return;
    }
    const [x, y, width, height] = app.canvas?.visible_area || [0, 0, 0, 0];
    node.pos = [x + width / 2 - node.size[0] / 2, y + height / 2 - node.size[1] / 2];
    app.graph.add(node);
    const choices = widget.options?.values;
    if (Array.isArray(choices) && !choices.includes(file)) choices.push(file);
    widget.value = file;
    widget.callback?.(file); // shows the picture in the node
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
