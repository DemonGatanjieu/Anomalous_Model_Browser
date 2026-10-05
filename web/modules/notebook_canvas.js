/**
 * Puts the active combo (搭配) on the canvas as a new group of nodes: its main model loader,
 * its LoRA chain and a positive and a negative prompt node (the positive holds the combo's
 * prompt, the negative the common negative starter card), wired together. From a button the
 * group follows the pointer until a click, and Esc takes it off again; a card dropped on the
 * canvas builds it where it was dropped. Nothing already on the canvas changes, except that a
 * UNet combo's prompt nodes take the canvas's CLIP loader when there is exactly one. A combo with
 * its own node structure is put down the same way (combo_structure.js builds it).
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { recordCanvasStep } from './canvas_history.js';
import { PROMPT_PRESETS } from './prompt_composition.js';
import { anomalousAlert } from './ui_dialog.js';
import { STRUCTURED } from './combo_slots.js';
import { buildStructure } from './combo_structure.js';

const t = (key, params) => translate(key, params);

const NEGATIVE_PROMPT = PROMPT_PRESETS.find(card => card.id === 'preset_negative').content;
const STEP_X = 350;

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

const modelPath = (model) => {
    const sub = String(model.subfolder || '').replace(/^\/+/, '').replace(/\/+$/, '');
    return sub ? `${sub}/${model.filename}` : model.filename;
};

/** The pointer's position in canvas coordinates. */
function canvasPoint(event) {
    const canvas = app.canvas;
    if (canvas.convertEventToCanvasOffset) return canvas.convertEventToCanvasOffset(event);
    const rect = canvas.canvas.getBoundingClientRect();
    return [
        (event.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale,
        (event.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale,
    ];
}

/**
 * The group follows the pointer until a click puts it down (then `placed()`); Esc removes it
 * again. While it follows, `owner.placingCombo` holds back the activity log, which is told once
 * the group is down (after Esc there is nothing to log).
 */
function followPointer(owner, groupNodes, placed) {
    const half = (groupNodes[0].node.size?.[0] || 200) / 2;
    const move = (event) => {
        if (!app.canvas) return;
        const [x, y] = canvasPoint(event);
        groupNodes.forEach(item => { item.node.pos = [x - half + item.relX, y - 20 + item.relY]; });
        app.canvas.setDirty(true, true);
    };
    let armTimer = 0;
    const stop = (event) => {
        owner.placingCombo = false;
        clearTimeout(armTimer);
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('keydown', cancel, true);
        ['pointerdown', 'mousedown', 'click'].forEach(type => window.removeEventListener(type, drop, true));
        event.preventDefault();
        event.stopPropagation();
    };
    const drop = (event) => {
        stop(event);
        placed();
        owner.flushCanvasActivity?.();
    };
    const cancel = (event) => {
        if (event.key !== 'Escape') return;
        stop(event);
        groupNodes.forEach(item => app.graph.remove(item.node));
        app.graph.setDirtyCanvas?.(true, true);
    };

    owner.placingCombo = true;
    window.addEventListener('mousemove', move, true);
    window.addEventListener('keydown', cancel, true);
    // Later than the click that pressed the button, so that click does not put the group down.
    armTimer = setTimeout(() => {
        ['pointerdown', 'mousedown', 'click'].forEach(type => window.addEventListener(type, drop, true));
    }, 100);
}

/** What went wrong putting a structure down, for the alert after it is placed. */
function problemLines(problems) {
    return problems.map(problem => (problem.kind === 'slot_missing'
        ? t('comboPlaceSlotMissing', { label: problem.label, widget: problem.widget, node: problem.type })
        : t('comboPlaceLinkMissing', { from: problem.from, to: problem.to, type: problem.type }))).join('\n');
}

/** A combo with a node structure: its nodes and links, its slots filled (combo_structure.js). */
function placeStructure(owner, data, position) {
    let built;
    try {
        built = buildStructure(data.structure, data.values);
    } catch (error) {
        if (error.code !== 'missing_nodes') throw error;
        void anomalousAlert(t('comboPlaceMissingNodes', {
            nodes: error.missing.map(item => (item.pack ? `${item.type}（${item.pack}）` : item.type)).join('、'),
        }));
        return;
    }
    if (!built.made.length) return;
    const placed = () => {
        recordCanvasStep(app);
        if (built.problems.length) void anomalousAlert(`${t('comboPlaceProblems')}\n${problemLines(built.problems)}`);
    };
    owner.nbPanel.style.display = 'none';
    if (!position) {
        followPointer(owner, built.made, placed);
        owner.close();
        return;
    }
    owner.close();
    built.made.forEach(item => { item.node.pos = [position[0] + item.relX, position[1] + item.relY]; });
    app.graph.setDirtyCanvas?.(true, true);
    placed();
}

/** Builds the combo as a new group of nodes: at `position` (canvas coordinates), or following the pointer. */
export function sendNotebookToCanvas(position = null) {
    if (!this.currentNotebook) return;
    const data = this.currentNotebook.data || {};
    if (data.kind === STRUCTURED) {
        placeStructure(this, data, position);
        return;
    }
    if (!data.mainModel) {
        void anomalousAlert(t('notebookSelectMain'));
        return;
    }

    const groupNodes = [];
    const add = (type, relX, relY) => {
        const node = LiteGraph.createNode(type);
        app.graph.add(node);
        groupNodes.push({ node, relX, relY });
        return node;
    };
    const isUnet = isUnetModel(data.mainModel);

    const loader = add(isUnet ? 'UNETLoader' : 'CheckpointLoaderSimple', 0, 0);
    this.setWidgetValuePath(loader, modelPath(data.mainModel));
    let last = loader;
    const clipSlot = isUnet ? null : 1; // a checkpoint loader and a LoraLoader both give CLIP second
    let relX = STEP_X;
    (data.loras || []).forEach(lora => {
        const node = add(isUnet ? 'LoraLoaderModelOnly' : 'LoraLoader', relX, 0);
        this.setWidgetValuePath(node, modelPath(lora));
        last.connect(0, node, 0);
        if (clipSlot !== null) last.connect(clipSlot, node, 1);
        last = node;
        relX += STEP_X;
    });

    const promptNode = (title, text, relY) => {
        const node = add('CLIPTextEncode', relX, relY);
        node.title = title;
        const box = node.widgets?.find(w => w.name === 'text' || w.type === 'customtext');
        if (box) box.value = text;
        return node;
    };
    const prompts = [
        promptNode('CLIP Text Encode (Positive)', String(data.promptEn || ''), 0),
        promptNode('CLIP Text Encode (Negative)', NEGATIVE_PROMPT, 250),
    ];
    let clip = clipSlot === null ? null : { node: last, slot: clipSlot };
    if (!clip) {
        const source = canvasClipSource(groupNodes.map(item => item.node));
        if (source) clip = { node: source, slot: source.outputs.findIndex(output => output.type === 'CLIP') };
    }
    if (clip) prompts.forEach(node => clip.node.connect(clip.slot, node, 0));

    const placed = () => {
        recordCanvasStep(app);
        if (!clip) void anomalousAlert(t('noteNeedsClip'));
    };
    this.nbPanel.style.display = 'none';
    if (!position) {
        followPointer(this, groupNodes, placed); // first, so closing does not log the group yet
        this.close();
        return;
    }
    this.close();
    groupNodes.forEach(item => { item.node.pos = [position[0] + item.relX, position[1] + item.relY]; });
    app.graph.setDirtyCanvas?.(true, true);
    placed();
}
