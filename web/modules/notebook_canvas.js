/**
 * Puts the active combo (搭配) on the canvas as a new group of nodes: its main model loader,
 * its LoRA chain and a positive and a negative prompt node, wired together. From a button the
 * group follows the pointer until a click; a card dropped on the canvas builds it where it
 * was dropped. Nothing already on the canvas changes, except that a UNet combo's prompt nodes
 * take the canvas's CLIP loader when there is exactly one.
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { recordCanvasStep } from './canvas_history.js';
import { anomalousAlert } from './ui_dialog.js';

const t = (key, params) => translate(key, params);

/** Base-model value the backend uses for models whose metadata names no base model. */
export const UNLABELED_BASE_MODEL = '__unlabeled__';

/** UNet / diffusion models carry no text encoder, so their LoRAs patch the model only. */
export function isUnetModel(model) {
    return model?.type === 'unet' || model?.type === 'diffusion_models';
}

/** The one text-encoder output already on the canvas (a loader), for a UNet note's prompts. */
function canvasClipSource(exclude) {
    const sources = (app.graph?._nodes || []).filter(node => !exclude.includes(node)
        && (node.outputs || []).some(output => output.type === 'CLIP')
        && !(node.inputs || []).some(input => input.type === 'CLIP' || input.type === 'MODEL'));
    return sources.length === 1 ? sources[0] : null;
}

/** Builds the combo as a new group of nodes: at `position` (canvas coordinates), or following the pointer. */
export function sendNotebookToCanvas(position = null) {
        if (!this.currentNotebook) return;
        const data = this.currentNotebook.data || {};
        if (!data.mainModel) {
            void anomalousAlert(t('notebookSelectMain'));
            return;
        }

        const groupNodes = [];
        const isUnet = isUnetModel(data.mainModel);

        const ckptNode = LiteGraph.createNode(isUnet ? "UNETLoader" : "CheckpointLoaderSimple");
        app.graph.add(ckptNode);
        groupNodes.push({ node: ckptNode, relX: 0, relY: 0 });

        const sub = data.mainModel.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${data.mainModel.filename}` : data.mainModel.filename;
        this.setWidgetValuePath(ckptNode, relPath);

        let lastNode = ckptNode;
        let lastModelSlot = 0;
        let lastClipSlot = isUnet ? null : 1;

        let relX = 350;
        let relY = 0;

        data.loras.forEach((lora, idx) => {
            const loraNode = LiteGraph.createNode(isUnet ? "LoraLoaderModelOnly" : "LoraLoader");
            app.graph.add(loraNode);
            groupNodes.push({ node: loraNode, relX: relX, relY: relY });

            const lsub = lora.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
            const lrelPath = lsub ? `${lsub}/${lora.filename}` : lora.filename;
            this.setWidgetValuePath(loraNode, lrelPath);

            lastNode.connect(lastModelSlot, loraNode, 0);
            if (lastClipSlot !== null) lastNode.connect(lastClipSlot, loraNode, 1);

            lastNode = loraNode;
            lastModelSlot = 0;
            if (!isUnet) lastClipSlot = 1;
            relX += 350;
        });

        if (data.promptEn) {
            const posNode = LiteGraph.createNode("CLIPTextEncode");
            posNode.title = "CLIP Text Encode (Positive)";
            app.graph.add(posNode);
            groupNodes.push({ node: posNode, relX: relX, relY: 0 });

            if (posNode.widgets && posNode.widgets.length > 0) {
                const tw = posNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = data.promptEn;
            }
            const clipSource = lastClipSlot === null ? canvasClipSource(groupNodes.map(item => item.node)) : null;
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, posNode, 0);
            } else if (clipSource) {
                clipSource.connect(clipSource.outputs.findIndex(output => output.type === 'CLIP'), posNode, 0);
            } else {
                anomalousAlert(t('noteNeedsClip'));
            }

            const negNode = LiteGraph.createNode("CLIPTextEncode");
            negNode.title = "CLIP Text Encode (Negative)";
            app.graph.add(negNode);
            groupNodes.push({ node: negNode, relX: relX, relY: 250 });

            if (negNode.widgets && negNode.widgets.length > 0) {
                const tw = negNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = "text, watermark, ugly, bad anatomy";
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, negNode, 0);
            } else if (clipSource) {
                clipSource.connect(clipSource.outputs.findIndex(output => output.type === 'CLIP'), negNode, 0);
            }
        }

        if (position) {
            groupNodes.forEach(item => { item.node.pos = [position[0] + item.relX, position[1] + item.relY]; });
            app.graph.setDirtyCanvas?.(true, true);
        }
        recordCanvasStep(app);
        this.nbPanel.style.display = 'none';
        this.close();
        if (position) return;

        // Magnetic Sticking Logic
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;

            let canvasX, canvasY;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                canvasX = pos[0];
                canvasY = pos[1];
            } else {
                const rect = canvas.canvas.getBoundingClientRect();
                canvasX = (e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale;
                canvasY = (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale;
            }

            groupNodes.forEach(item => {
                const w = (item.node.size && item.node.size[0]) ? item.node.size[0] : 200;
                item.node.pos = [canvasX - (w / 2) + item.relX, canvasY - 20 + item.relY];
            });
            canvas.setDirty(true, true);
        };

        const dropHandler = (e) => {
            if (!isSticking) return;
            isSticking = false;
            window.removeEventListener('mousemove', stickHandler, true);
            window.removeEventListener('pointerdown', dropHandler, true);
            window.removeEventListener('mousedown', dropHandler, true);
            window.removeEventListener('click', dropHandler, true);
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener('mousemove', stickHandler, true);
        setTimeout(() => {
            window.addEventListener('pointerdown', dropHandler, true);
            window.addEventListener('mousedown', dropHandler, true);
            window.addEventListener('click', dropHandler, true);
        }, 100);
    }
