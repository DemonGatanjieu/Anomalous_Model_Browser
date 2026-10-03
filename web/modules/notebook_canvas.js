/**
 * The active combo (搭配) on the canvas. Use puts it into the open workflow
 * (notebook_apply.js) after showing what changes, or, when the canvas has no main model
 * loader, builds a new group of nodes that follows the pointer until a click.
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { recordCanvasStep } from './canvas_history.js';
import { applyNotePlan, planNoteApply } from './notebook_apply.js';
import { selectedMaterialNode } from './node_material_actions.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';

const t = (key, params) => translate(key, params);

/** Base-model value the backend uses for models whose metadata names no base model. */
export const UNLABELED_BASE_MODEL = '__unlabeled__';

/** UNet / diffusion models carry no text encoder, so their LoRAs patch the model only. */
export function isUnetModel(model) {
    return model?.type === 'unet' || model?.type === 'diffusion_models';
}

/** Makes `plan` (planNoteApply) after a confirmation listing each change. */
async function applyPlan(owner, plan) {
    const say = ([key, params = {}]) => t(key, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === '' ? t('noteApplyNone') : v])));
    const reasons = plan.skipped.map(item => t('noteApplySkipped', { reason: say(item) }));
    if (!plan.lines.length) {
        await anomalousAlert([t('noteApplyNothing'), ...reasons].join('\n'), t('noteApplyTitle'));
        return;
    }
    const message = [...plan.lines.map(say), ...reasons, '', t('noteApplyUndoHint')].join('\n');
    if (!await anomalousConfirm(message, t('noteApplyTitle'), { okLabel: t('noteApplyConfirm') })) return;
    applyNotePlan(app, plan);
    owner.nbPanel.style.display = 'none';
    owner.close();
}

/**
 * Use (用上): into the open workflow when the canvas has a main model loader; with none, a
 * new group of nodes; with several and none selected, asks before making a new group.
 */
export async function useNotebook() {
    if (!this.currentNotebook) return;
    const data = this.currentNotebook.data || {};
    const plan = planNoteApply(app, data, selectedMaterialNode(app));
    if (!plan.loader && data.mainModel) {
        const many = plan.skipped.find(([key]) => key === 'noteApplyManyLoaders');
        if (many && !await anomalousConfirm(t('comboManyLoaders', many[1]), t('noteApplyTitle'), { okLabel: t('sendToCanvas') })) return;
        this.sendNotebookToCanvas();
        return;
    }
    await applyPlan(this, plan);
}

/** The one text-encoder output already on the canvas (a loader), for a UNet note's prompts. */
function canvasClipSource(exclude) {
    const sources = (app.graph?._nodes || []).filter(node => !exclude.includes(node)
        && (node.outputs || []).some(output => output.type === 'CLIP')
        && !(node.inputs || []).some(input => input.type === 'CLIP' || input.type === 'MODEL'));
    return sources.length === 1 ? sources[0] : null;
}

export function sendNotebookToCanvas() {
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

        recordCanvasStep(app);
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
