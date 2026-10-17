import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { comboValueForPath } from './audio_script.js';
import { targetForNode } from './audio_node_targets.js';
import { TTS_ENGINE } from './audio_engines.js';
import { bindMaterialDrag } from './material_drag.js';
import { recordCanvasStep } from './canvas_history.js';

/**
 * The Script Director's "Into your own workflow": the bundle (buildScriptPackage) copied,
 * pushed to the selected / only GPT-SoVITS node, or dragged onto one (supported nodes:
 * audio_node_targets.js). Writing the character and script widgets together is one Ctrl+Z step.
 */

function flash(btn, text, restore) {
    btn.textContent = text;
    btn.classList.add('is-success');
    setTimeout(() => {
        btn.textContent = restore;
        btn.classList.remove('is-success');
    }, 1800);
}

export async function copyScript(pkg, btn) {
    if (pkg.error || !navigator.clipboard?.writeText) return;
    try {
        await navigator.clipboard.writeText(pkg.speech);
        flash(btn, t('scriptDirectorCopied'), t('scriptDirectorCopy'));
    } catch (_) {
        // Clipboard permission refused: the line cards still hold the text.
    }
}

function findTargetNode() {
    const nodes = (app.graph?._nodes || []).filter(targetForNode);
    if (!nodes.length) return { error: 'scriptDirectorNoNode' };
    const selected = Object.values(app.canvas?.selected_nodes || {}).filter(targetForNode);
    if (selected.length === 1) return { node: selected[0] };
    if (nodes.length === 1) return { node: nodes[0] };
    return { error: 'scriptDirectorPickNode' };
}

export async function pushToNode(pkg, btn) {
    if (pkg.error) return;
    const { node, error } = findTargetNode();
    if (error) {
        await anomalousAlert(t(error, { node: TTS_ENGINE.label }));
        return;
    }
    if (await applyPackageToNode(node, pkg)) flash(btn, t('scriptDirectorSuccess'), t('scriptDirectorInject'));
}

/** Write character + script into one node; re-checks the node after any dialog. Returns true when written. */
async function applyPackageToNode(node, pkg) {
    const graph = app.graph;
    const target = targetForNode(node);
    const speechWidget = target && node.widgets?.find(w => w.name === target.speechWidget);
    const sampleWidget = target && node.widgets?.find(w => w.name === target.voiceWidget);
    if (!speechWidget || !sampleWidget) {
        await anomalousAlert(t('scriptDirectorDropNotTts', { node: TTS_ENGINE.label }));
        return false;
    }
    const sampleValue = comboValueForPath(sampleWidget, pkg.sample);
    if (sampleValue == null) {
        await anomalousAlert(t('scriptDirectorSampleNotListed', { file: pkg.sample, node: TTS_ENGINE.label }));
        return false;
    }
    const previous = speechWidget.value;
    if (typeof previous === 'string' && previous.trim() && previous.trim() !== pkg.speech) {
        if (!await anomalousConfirm(t('scriptDirectorOverwriteConfirm'))) return false;
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || speechWidget.value !== previous) return false;
    }
    if (sampleWidget.value !== sampleValue) {
        sampleWidget.value = sampleValue;
        sampleWidget.callback?.(sampleValue, app.canvas, node);
    }
    speechWidget.value = pkg.speech;
    speechWidget.callback?.(pkg.speech, app.canvas, node);
    node.setDirtyCanvas?.(true, true);
    recordCanvasStep(app);
    return true;
}

/** Drag the bundle onto a canvas node; `dragOwner` hides the browser while dragging, `pushBtn()` flashes on success. */
export function bindPackageDrag(handle, dragOwner, getPackage, pushBtn) {
    bindMaterialDrag(handle, dragOwner, {
        payload: () => {
            const pkg = getPackage();
            return pkg.error ? null : { ...pkg, dragHint: t('scriptDirectorDragHint', { node: TTS_ENGINE.label }) };
        },
        accepts: node => Boolean(targetForNode(node)),
        drop: async node => {
            if (await applyPackageToNode(node, getPackage())) flash(pushBtn(), t('scriptDirectorSuccess'), t('scriptDirectorInject'));
        },
    });
}
