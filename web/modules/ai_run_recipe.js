/**
 * Pure recipe extraction for one `run_workflow` step (`step.map`, `step.changes`, `step.results`)
 * aligned with `task.sealed` tokens: shows the user which reference/input images, base models,
 * LoRAs + weights, prompts, sampler/size settings, and parameter deltas were actually fed into
 * the run that produced the output images, without guessing or duplicating the canvas diagram.
 */

import { matchingTokenFor, parsePictureRef } from './ai_privacy_view.js';

/** Candidate ComfyUI URLs (input folder first, output thumbnail fallback) for a `LoadImage` file. */
export function inputImageUrls(file) {
    const ref = parsePictureRef(file);
    if (!ref.filename) return [];
    const params = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder || '' });
    return [
        `/view?${params}&type=input`,
        `/anomalous/output_thumbnail?${params}`,
    ];
}

/** Extract `{ images, models, loras, prompts, sampler, changes, pictures, hasDetails }` from a run step. */
export function recipeOfRun(step, task = null) {
    const sealed = (task?.private === true && task?.sealed) ? task.sealed : null;
    const boxes = step?.map?.boxes || [];
    const seenImages = new Set();
    const images = [];
    const models = [];
    const loras = [];
    const prompts = [];
    const sampler = { steps: null, cfg: null, samplerName: '', scheduler: '', denoise: null, width: null, height: null, batch: null, upscale: '' };

    for (const box of boxes) {
        const facts = box?.facts || {};
        if (box.role === 'image' && facts.file) {
            const key = String(facts.file).replace(/\\/g, '/');
            if (!seenImages.has(key)) {
                seenImages.add(key);
                const parsed = parsePictureRef(key);
                images.push({
                    id: box.id,
                    ...parsed,
                    urls: inputImageUrls(key),
                    token: sealed ? matchingTokenFor(key, sealed, '[img') : '',
                });
            }
        } else if (box.role === 'model' && facts.file) {
            models.push({ id: box.id, file: facts.file, token: sealed ? matchingTokenFor(facts.file, sealed, '[M') : '' });
        } else if (box.role === 'lora' && facts.file) {
            loras.push({
                id: box.id,
                file: facts.file,
                strength: Number.isFinite(facts.strength) ? facts.strength : null,
                token: sealed ? matchingTokenFor(facts.file, sealed, '[M') : '',
            });
        } else if (box.role === 'prompt' && facts.text) {
            prompts.push({
                id: box.id,
                polarity: facts.polarity || 'positive',
                text: facts.text,
                token: sealed ? matchingTokenFor(facts.text, sealed, '[P') : '',
            });
        } else if (box.role === 'sampler') {
            if (facts.steps !== undefined) sampler.steps = facts.steps;
            if (facts.cfg !== undefined) sampler.cfg = facts.cfg;
            if (facts.sampler_name) sampler.samplerName = facts.sampler_name;
            if (facts.scheduler) sampler.scheduler = facts.scheduler;
            if (facts.denoise !== undefined && Number(facts.denoise) < 1) sampler.denoise = facts.denoise;
            if (facts.width && facts.height) {
                sampler.width = facts.width;
                sampler.height = facts.height;
                if (facts.batch > 1) sampler.batch = facts.batch;
            }
        } else if (box.role === 'size' && facts.width && facts.height && !sampler.width) {
            sampler.width = facts.width;
            sampler.height = facts.height;
            if (facts.batch > 1) sampler.batch = facts.batch;
        } else if (box.role === 'upscale' && facts.file) {
            sampler.upscale = facts.file;
        }
    }

    const changes = Array.isArray(step?.changes) ? step.changes : [];
    const pictures = (step?.results || []).filter(item => item?.type === 'image' && item?.filename);
    const hasDetails = Boolean(
        images.length || models.length || loras.length || prompts.length || changes.length
        || sampler.steps || sampler.width || sampler.samplerName || sampler.upscale,
    );

    return {
        isPrivate: task?.private === true,
        images,
        models,
        loras,
        prompts,
        sampler,
        changes,
        pictures,
        hasDetails,
    };
}
