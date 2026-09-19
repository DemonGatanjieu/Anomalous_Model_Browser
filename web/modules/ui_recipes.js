/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import {
    showRecipes as showRecipeCatalog,
    refreshRecipes as refreshRecipeCatalog,
    renderRecipeList as renderRecipeCatalog,
} from './ui_recipe_catalog.js';
import { formatRecipeText, showRecipeEditDialog, showRecipeSaveDialog } from './ui_recipe_dialogs.js';
import { outputImageUrl, previewIsVideo } from './ui_recipe_media.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import {
    captureCanvasThumbnail,
    captureRecipeDraft,
} from './recipe_parser.js';
import {
    canVerifyRecipeModelReference,
    deriveRecipeModelReferences,
    normaliseIdentity,
} from './recipe_identity.js';

const t = (key, params) => translate(key, params);
export async function showRecipes() {
    return showRecipeCatalog.call(this);
}

export async function refreshRecipes() {
    return refreshRecipeCatalog.call(this);
}

export function renderRecipeList(recipes) {
    return renderRecipeCatalog.call(this, recipes, {
        editRecipe,
        fetchRecipeBundle,
        fetchRecipeData,
    });
}

function recipeAuditKey(reference) {
    return `${reference?.node_id ?? ''}\u001f${reference?.widget_index ?? ''}\u001f${reference?.saved_value ?? ''}`;
}

async function inspectRecipeModelIdentities(draft) {
    const references = deriveRecipeModelReferences({
        workflow: draft?.workflow,
        params: draft?.metadata,
    });
    if (!references.length) return { verifiableMissing: [] };

    try {
        const response = await fetch('/anomalous/refresh_recipe_identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ references }),
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error('recipe identity inspection failed');
        const results = new Map((payload.results || []).map((result) => [recipeAuditKey(result), result]));
        for (const reference of references) {
            const result = results.get(recipeAuditKey(reference));
            if (!result) continue;
            reference.currentAvailability = result.availability;
            const current = normaliseIdentity(reference.identity);
            const inspected = normaliseIdentity(result.identity);
            if (current.status !== 'verified' && inspected.status === 'verified') {
                reference.identity = inspected;
            }
        }
    } catch (error) {
        // The audit is advisory. A temporary inspection failure must never
        // prevent the workflow snapshot itself from being saved.
        console.warn('Could not inspect recipe model identities:', error);
    }

    return {
        verifiableMissing: references.filter((reference) => (
            canVerifyRecipeModelReference(reference)
            && normaliseIdentity(reference.identity).status !== 'verified'
            && reference.currentAvailability !== 'missing'
        )),
    };
}

async function captureOutputThumbnail(image) {
    const url = outputImageUrl(image);
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (previewIsVideo(url) || /^video\//i.test(blob.type)) {
        const objectUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.src = objectUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        try {
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = reject;
                video.load();
            });
            if (video.duration > 0.2) {
                await new Promise((resolve) => {
                    video.onseeked = resolve;
                    video.currentTime = 0.1;
                });
            }
            const maxEdge = 720;
            const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) return null;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/webp', 0.72);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }
    const bitmap = await createImageBitmap(blob);
    try {
        const maxEdge = 720;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.72);
    } finally {
        bitmap.close?.();
    }
}

async function fetchRecipeBundle(filename) {
    const [fullResponse, historyResponse] = await Promise.all([
        fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(filename)}`),
        fetch(`/anomalous/recipe_history?filename=${encodeURIComponent(filename)}`),
    ]);
    const payload = await fullResponse.json();
    const historyPayload = historyResponse.ok ? await historyResponse.json() : { versions: [] };
    if (!fullResponse.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
    return { data: JSON.parse(JSON.stringify(payload.data)), history: historyPayload.versions || [] };
}

async function fetchRecipeData(filename) {
    const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(filename)}`);
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
    return JSON.parse(JSON.stringify(payload.data));
}

async function editRecipe(owner, recipe, filename, history = null) {
    try {
        const bundle = history ? { data: JSON.parse(JSON.stringify(recipe)), history } : await fetchRecipeBundle(filename);
        const editable = bundle.data;
        const result = await showRecipeEditDialog(owner, editable, filename, bundle.history);
        if (!result || result.mode === 'restored') return;
        if (result.mode === 'canvas') {
            if (!await anomalousConfirm(t('recipeEditCanvasConfirm'))) return;
            app.loadGraphData(editable.workflow);
            app.canvas?.setDirty?.(true, true);
            owner.recipeEditing = { filename, data: editable };
            const saveButton = owner.recipeView?.querySelector('[data-recipe-save-current]');
            if (saveButton) saveButton.textContent = t('recipeUpdateCurrent');
            return;
        }

        editable.name = result.name;
        editable.tags = result.tags;
        editable.notes = result.notes;
        const response = await fetch('/anomalous/update_recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, ...editable }),
        });
        const updatedPayload = await response.json();
        if (!response.ok || updatedPayload.status !== 'success') throw new Error('recipe update failed');
        await owner.refreshRecipes();
    } catch (error) {
        console.error('Could not edit Workflow Recipe:', error);
        await anomalousAlert(t('recipeUpdateError'));
    }
}

export async function handleSaveRecipe() {
    if (!app.graph?.serialize) {
        await anomalousAlert(t('recipeSaveError'));
        return;
    }
    const draft = captureRecipeDraft(app.graph);
    if (!draft.workflow || !Array.isArray(draft.workflow.nodes)) {
        await anomalousAlert(t('recipeSaveError'));
        return;
    }
    const canvasThumbnail = captureCanvasThumbnail(app.canvas?.canvas);
    const editing = this.recipeEditing || null;
    const modelAudit = await inspectRecipeModelIdentities(draft);
    const details = await showRecipeSaveDialog(
        this,
        canvasThumbnail,
        draft.workflowScope,
        modelAudit,
        editing?.data || null,
    );
    if (!details) return;

    // Prompt-role labels belong to the recipe skeleton. Preserve labels whose
    // node id and type still match when an existing recipe is refreshed from
    // the live canvas; stale labels are discarded safely.
    const previousPromptRoles = editing?.data?.params?.promptRoleOverrides;
    if (previousPromptRoles && typeof previousPromptRoles === 'object') {
        const workflowNodes = new Map((draft.workflow.nodes || []).map((node) => [String(node?.id), node]));
        const retained = {};
        for (const [nodeId, override] of Object.entries(previousPromptRoles)) {
            const node = workflowNodes.get(String(nodeId));
            if (!node || !override || typeof override !== 'object') continue;
            if (override.nodeType && override.nodeType !== node.type) continue;
            retained[nodeId] = { ...override, nodeType: node.type || override.nodeType || 'Unknown' };
        }
        if (Object.keys(retained).length) draft.metadata.promptRoleOverrides = retained;
    }

    const saveButton = this.recipeView?.querySelector('[data-recipe-save-current]');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = t('recipeSaving');
    }
    try {
        let thumbnail = details.thumbnail;
        if (details.sourceImage) {
            try {
                thumbnail = await captureOutputThumbnail(details.sourceImage);
            } catch (error) {
                console.warn('Could not persist bound recipe image thumbnail:', error);
            }
        }
        const response = await fetch(editing ? '/anomalous/update_recipe' : '/anomalous/save_recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...(editing ? { filename: editing.filename } : {}),
                name: details.name,
                tags: details.tags,
                notes: details.notes,
                params: draft.metadata,
                workflow: draft.workflow,
                workflow_scope: draft.workflowScope,
                thumbnail,
                source_image: details.sourceImage,
                presentation: { save_model_preview_snapshots: details.saveModelPreviewSnapshots },
                verify_model_identities: details.verifyModelIdentities,
            }),
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error('recipe save request failed');

        const recipeFilename = payload.filename || editing?.filename;
        if (recipeFilename) {
            try {
                const parameterResponse = await fetch('/anomalous/save_parameter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: details.name,
                        tags: details.tags,
                        notes: details.notes,
                        params: draft.metadata,
                        workflow: draft.workflow,
                        recipe_filename: recipeFilename,
                    }),
                });
                if (!parameterResponse.ok) throw new Error('parameter snapshot request failed');
            } catch (error) {
                // Recipe persistence is already successful; a snapshot failure
                // must not make the user retry and create a duplicate recipe.
                console.warn('Could not save the recipe parameter snapshot:', error);
            }
        }

        const receipt = payload.receipt || {};
        const receiptMatchesDraft = receipt.node_count === draft.stats.nodeCount
            && receipt.link_count === draft.stats.linkCount
            && receipt.group_count === draft.stats.groupCount;
        if (this.recipeSaveStatus) {
            this.recipeSaveStatus.textContent = receiptMatchesDraft
                ? formatRecipeText('recipeSaveReceipt', {
                    nodes: receipt.node_count,
                    links: receipt.link_count,
                    groups: receipt.group_count,
                })
                : t('recipeSaveReceiptMismatch');
            this.recipeSaveStatus.classList.toggle('is-warning', !receiptMatchesDraft);
        }
        this.recipeEditing = null;
        await this.refreshRecipes();
    } catch (error) {
        console.error('Could not save Workflow Recipe:', error);
        await anomalousAlert(t('recipeSaveError'));
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = this.recipeEditing ? t('recipeUpdateCurrent') : t('recipeSaveCurrent');
        }
    }
}
