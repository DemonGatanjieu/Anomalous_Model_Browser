/** Create a movable LiteGraph group from the active Prompt Note. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

export function sendNotebookToCanvas() {
        if (!this.currentNotebook) return;
        const data = this.currentNotebook.data || {};
        if (!data.mainModel) {
            alert(t('notebookSelectMain'));
            return;
        }

        const groupNodes = [];
        const isUnet = data.mainModel.type === 'unet' || data.mainModel.type === 'diffusion_models';

        const ckptNode = LiteGraph.createNode(isUnet ? "UNETLoader" : "CheckpointLoaderSimple");
        app.graph.add(ckptNode);
        groupNodes.push({ node: ckptNode, relX: 0, relY: 0 });

        const sub = data.mainModel.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${data.mainModel.filename}` : data.mainModel.filename;
        this.setWidgetValuePath(ckptNode, relPath);

        let lastNode = ckptNode;
        let lastModelSlot = isUnet ? 0 : 0;
        let lastClipSlot = isUnet ? null : 1;

        let relX = 350;
        let relY = 0;

        data.loras.forEach((lora, idx) => {
            const loraNode = LiteGraph.createNode("LoraLoader");
            app.graph.add(loraNode);
            groupNodes.push({ node: loraNode, relX: relX, relY: relY });

            const lsub = lora.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
            const lrelPath = lsub ? `${lsub}/${lora.filename}` : lora.filename;
            this.setWidgetValuePath(loraNode, lrelPath);

            lastNode.connect(lastModelSlot, loraNode, 0);
            if (lastClipSlot !== null) lastNode.connect(lastClipSlot, loraNode, 1);

            lastNode = loraNode;
            lastModelSlot = 0;
            lastClipSlot = 1;
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
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, posNode, 0);
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
            }
        }

        this.nbPanel.style.display = 'none';
        this.close();

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
