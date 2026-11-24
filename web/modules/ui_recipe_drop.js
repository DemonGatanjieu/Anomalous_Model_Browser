/**
 * Workflow files dropped on the Workflows page are kept as recipes at once, with no save window: a
 * workflow .json (ComfyUI's own, or a recipe AMB keeps), a picture ComfyUI saved with its workflow
 * (.png / .webp: POST /anomalous/inspect_workflow_file reads it, api/workflow_import.py; the cover is
 * made here from the file), or a recipe package (.zip, which asks in its own window, ui_recipe_package.js).
 * Not on the saves list, nor over a recipe's own page. The recipe keeps the workflow as the file has it:
 * it is laid on a graph of its own only to read its settings (detached_graph.js), never saved from there,
 * since that copy loses what nodes of packs not installed here carry. A file dropped here never reaches
 * the canvas behind the window. What workflow_file_import.js decides; one toast says what was kept.
 */

import { translate as t } from './locales.js';
import { captureRecipeDraft } from './recipe_parser.js';
import { readDetached } from './detached_graph.js';
import { persistRecipe, pictureCover } from './recipe_save.js';
import { importRecipePackageFile } from './ui_recipe_package.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import {
    buildDropSummary, classifyDroppedWorkflowFile, deriveDroppedRecipeName, parseDroppedWorkflowJson, stripSavesKey,
} from './workflow_file_import.js';

const MAX_BYTES = 64 * 1024 * 1024; // api/workflow_import.py MAX_WORKFLOW_IMAGE_BYTES

/** The workflow a picture carries: { ok, workflow } or { ok: false, reason }. */
async function pictureWorkflow(file) {
    const response = await fetch(`/anomalous/inspect_workflow_file?${new URLSearchParams({ name: file.name || '' })}`, {
        method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== 'success') return { ok: false, reason: data.code || 'save_failed' };
    return { ok: true, workflow: data.workflow, name: '', tags: [], notes: '' };
}

/** The draft persistRecipe keeps: settings read from a detached copy, the workflow itself as the file has it. */
function draftOf(workflow) {
    const kept = stripSavesKey(workflow);
    let draft;
    try {
        draft = readDetached(kept, captureRecipeDraft);
    } catch (error) {
        console.warn('[AMB] A dropped workflow could not be read for its settings; it is kept as it is.', error);
        draft = { metadata: {}, workflowScope: 'complete' };
    }
    return { ...draft, workflow: kept };
}

/** Keeps one dropped file: { name } once kept, { name, reason } when not, { name, shown } for a package's own window. */
async function keepFile(owner, file) {
    const kind = classifyDroppedWorkflowFile(file.name, file.type);
    if (kind === 'unsupported') return { name: file.name, reason: 'unsupported' };
    if (kind === 'zip') return await importRecipePackageFile(owner, file) ? { name: file.name, shown: true } : { name: file.name, reason: 'not_package' };
    if (file.size > MAX_BYTES) return { name: file.name, reason: 'too_large' };
    const found = kind === 'json' ? parseDroppedWorkflowJson(await file.text()) : await pictureWorkflow(file);
    if (!found.ok) return { name: file.name, reason: found.reason };
    const draft = draftOf(found.workflow);
    const name = deriveDroppedRecipeName({
        fileName: file.name, explicitName: found.name, promptPositive: draft.metadata?.promptPositive?.[0], fallback: t('recipeUntitled'),
    });
    const thumbnail = kind === 'image' ? await pictureCover(file).catch(() => null) : null;
    await persistRecipe(draft, {
        name, tags: found.tags, notes: found.notes, thumbnail, sourceImage: null,
        saveModelPreviewSnapshots: true, verifyModelIdentities: false,
    });
    return { name };
}

function tell({ saved, skipped }) {
    const parts = [];
    if (saved.length === 1) parts.push(t('recipePackageImported', { name: saved[0] }));
    else if (saved.length) parts.push(t('recipeDropSaved', { count: saved.length }));
    if (skipped.length) {
        const [first] = skipped;
        const reason = t(`recipeDropReason_${first.reason}`);
        parts.push(t(skipped.length === 1 ? 'recipeDropSkippedOne' : 'recipeDropSkipped', { count: skipped.length, name: first.name, reason }));
    }
    if (parts.length) showWorkbenchToast(parts.join(' · '), skipped.length ? { label: t('dialogOk'), run: () => {} } : null); // a reason stays to be read
}

/** Once, from showRecipes (ui_recipe_catalog.js): files dropped on `root`, the Workflows page, become recipes. */
export function attachRecipeDrop(owner, root) {
    const overlay = document.createElement('div');
    overlay.className = 'anomalous-wf-drop-overlay';
    const words = document.createElement('div');
    words.className = 'anomalous-wf-drop-words';
    overlay.append(words);
    root.append(overlay);
    let depth = 0; // dragenter / dragleave also come from the page's children
    let queue = Promise.resolve();
    const takes = event => !owner.savesListOn && !owner.recipeDetailView && [...(event.dataTransfer?.types || [])].includes('Files');
    const leave = () => {
        depth = 0;
        root.classList.remove('is-dropping');
    };
    root.addEventListener('dragenter', (event) => {
        if (!takes(event)) return;
        event.preventDefault();
        depth += 1;
        words.textContent = t('recipeDropHint');
        root.classList.add('is-dropping');
    });
    root.addEventListener('dragover', (event) => {
        if (!takes(event)) return;
        event.preventDefault();
        event.stopPropagation(); // ComfyUI's page would load it on the canvas behind the window
        event.dataTransfer.dropEffect = 'copy';
    });
    root.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (!depth) leave();
    });
    root.addEventListener('drop', (event) => {
        if (!takes(event)) return leave();
        event.preventDefault();
        event.stopPropagation();
        leave();
        const files = [...(event.dataTransfer.files || [])];
        queue = queue.then(async () => {
            words.textContent = t('recipeDropWorking');
            root.classList.add('is-importing');
            const results = [];
            for (const file of files) {
                results.push(await keepFile(owner, file).catch((error) => {
                    console.warn('[AMB] A dropped workflow file was not kept.', file.name, error);
                    return { name: file.name, reason: 'save_failed' };
                }));
            }
            root.classList.remove('is-importing');
            const summary = buildDropSummary(results);
            if (summary.saved.length) await owner.refreshRecipes();
            tell(summary);
        });
    });
}
