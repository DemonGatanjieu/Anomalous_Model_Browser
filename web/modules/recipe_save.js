/**
 * Saving a Workflow Recipe, shared by the canvas save (ui_recipes.js, after its dialog) and
 * by keeping an output image's workflow: Recent's star, the image workbench, and moving the
 * workflows kept as materials before recipes took over. An image's workflow is laid on a
 * canvas of its own first, so its recipe is summarised exactly like one saved from the canvas.
 */

import { captureRecipeDraft } from './recipe_parser.js';
import { promptTitle } from './prompt_composition.js';
import { outputImageUrl, previewIsVideo } from './ui_recipe_media.js';
import { jsonResponse } from './ui_dom.js';
import { detachedGraph } from './detached_graph.js';

const post = (url, body) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

/** A small cover from an output image (a video's first frame), as a data URL. */
export async function captureOutputThumbnail(image) {
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

/**
 * Saves `draft` (captureRecipeDraft) as a new recipe, or over `editing`, with its first
 * parameter set. `details`: { name, tags, notes, thumbnail, sourceImage,
 * saveModelPreviewSnapshots, verifyModelIdentities }. Returns { payload, filename }.
 */
export async function persistRecipe(draft, details, editing = null) {
    let thumbnail = details.thumbnail || null;
    if (details.sourceImage) {
        try {
            thumbnail = await captureOutputThumbnail(details.sourceImage);
        } catch (error) {
            console.warn('Could not persist bound recipe image thumbnail:', error);
        }
    }
    const response = await post(editing ? '/anomalous/update_recipe' : '/anomalous/save_recipe', {
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
    });
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success') throw new Error('recipe save request failed');
    const filename = payload.filename || editing?.filename;
    if (filename) {
        try {
            const parameterResponse = await post('/anomalous/save_parameter', {
                name: details.name,
                tags: details.tags,
                notes: details.notes,
                params: draft.metadata,
                workflow: draft.workflow,
                recipe_filename: filename,
            });
            if (!parameterResponse.ok) throw new Error('parameter snapshot request failed');
        } catch (error) {
            // Recipe persistence is already successful; a snapshot failure
            // must not make the user retry and create a duplicate recipe.
            console.warn('Could not save the recipe parameter snapshot:', error);
        }
    }
    return { payload, filename };
}

const sameImage = (a, b) => Boolean(a?.filename && b?.filename) && a.filename === b.filename && (a.subfolder || '') === (b.subfolder || '');

/**
 * Keeps an output image's workflow as a recipe; an image kept before gives that recipe back
 * (`existed`). `workflow` when the caller has it, else it is read from the image.
 * Returns { filename, name, existed }.
 */
export async function keepImageAsRecipe(sourceImage, { name = '', tags = [], workflow = null } = {}) {
    if (sourceImage) {
        const { recipes = [] } = await jsonResponse(await fetch('/anomalous/recipes', { cache: 'no-store' }), 'list recipes');
        const kept = recipes.find(recipe => sameImage(recipe.data?.source_image, sourceImage));
        if (kept) return { filename: kept.filename, name: kept.data?.name || '', existed: true };
    }
    let suggested = '';
    if (!workflow) {
        const info = await jsonResponse(await post('/anomalous/inspect_image_material', { source_image: sourceImage }), 'read image workflow');
        workflow = info.workflow;
        suggested = info.suggested_name || '';
    }
    const draft = captureRecipeDraft(detachedGraph(workflow));
    const recipeName = String(name || promptTitle(draft.metadata.promptPositive?.[0]) || suggested || sourceImage?.filename || 'Workflow').trim().slice(0, 120);
    const { filename } = await persistRecipe(draft, {
        name: recipeName, tags, notes: '', sourceImage,
        saveModelPreviewSnapshots: true, verifyModelIdentities: false,
    });
    return { filename, name: recipeName, existed: false };
}

/** How many whole workflows are still kept as materials. */
export async function workflowMaterialCount() {
    const payload = await jsonResponse(await fetch('/anomalous/materials?category=workflow&limit=1&page=1', { cache: 'no-store' }), 'count kept workflows');
    return Number(payload.total) || 0;
}

/**
 * Saves each workflow kept as a material as a recipe; the material file stays, marked as
 * moved, so it is not listed again. `onProgress(done, total)`. Returns how many moved; one that fails stays a material.
 */
export async function moveWorkflowMaterials(onProgress = null) {
    const { materials = [] } = await jsonResponse(await fetch('/anomalous/materials?category=workflow', { cache: 'no-store' }), 'list kept workflows');
    let moved = 0;
    for (const material of materials) {
        try {
            const url = `/anomalous/material_full?filename=${encodeURIComponent(material.filename)}&include_workflow=1`;
            const data = (await jsonResponse(await fetch(url), 'read kept workflow')).data || {};
            const image = data.source?.image?.type === 'output' ? data.source.image : null;
            const recipe = await keepImageAsRecipe(image, { name: data.name, tags: data.tags || [], workflow: data.workflow });
            await jsonResponse(await post('/anomalous/mark_material_moved', { filename: material.filename, recipe: recipe.filename }), 'mark moved');
            moved += 1;
        } catch (error) {
            // One that cannot be read or saved stays a material; the others still move.
            console.warn('[AMB] A kept workflow did not move to the recipes.', material.filename, error);
        }
        onProgress?.(moved, materials.length);
    }
    return moved;
}
