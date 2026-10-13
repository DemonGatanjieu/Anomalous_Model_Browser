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
import { canvasPoint, followPointer } from './notebook_canvas.js';
import { openActionMenu } from './action_menu.js';

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

/**
 * A Load Image node showing `image`: the browser closes and the node follows the pointer until a
 * click puts it down (Esc takes it off again), like a combo's Put on canvas. `at` is the click
 * that chose it, where the node starts.
 */
export async function insertLoadImageNode(owner, image, at) {
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
    const [x, y] = canvasPoint(at);
    node.pos = [x - node.size[0] / 2, y - 20];
    app.graph.add(node);
    const choices = widget.options?.values;
    if (Array.isArray(choices) && !choices.includes(file)) choices.push(file);
    widget.value = file;
    widget.callback?.(file); // shows the picture in the node
    app.graph.setDirtyCanvas(true, true);
    owner.close();
    followPointer(owner, [{ node, relX: 0, relY: 0 }], () => recordCanvasStep(app));
    showWorkbenchToast(t('galleryInsertNodeFollow'));
}

/** Opens the menu at the pointer; `openDetails()` opens the picture's parameters. */
export function openGalleryCardMenu(event, image, { owner, openDetails }) {
    event.preventDefault();
    openActionMenu(event, [
        { icon: '🖼️', label: t('galleryInsertAsNode'), run: (click) => insertLoadImageNode(owner, image, click) },
        { icon: '🔍', label: t('materialViewParameters'), run: openDetails },
    ]);
}
