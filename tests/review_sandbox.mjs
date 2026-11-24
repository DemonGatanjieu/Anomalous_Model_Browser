// The review console's blank sandbox (web/modules/review_sandbox_data.js, review_sandbox_workflow.js): an empty library and one model, Civitai
// answering or not, a scan and a download moving on by the clock, the shared workflow's four models as Model Check
// and the Workflows page meet them, and changes it does not stand in for refused, never sent on.
import assert from 'node:assert/strict';
import {
    answerRequest, createSandbox, downloadsRunning, resetProgress, sandboxModelValues, scanRunning, setLibrary, setNetwork, shareDemoWorkflow,
} from '../web/modules/review_sandbox_data.js';
import { SANDBOX_HASHES, demoWorkflow } from '../web/modules/review_sandbox_workflow.js';
import { i18n } from '../web/modules/locales.js';
import { findWorkflowHashRecord } from '../web/modules/recipe_provenance.js';

const ask = (sandbox, method, route, { body = null, now = 0 } = {}) => {
    const url = new URL(route, 'http://amb.test');
    return answerRequest(sandbox, { method, path: url.pathname, query: url.searchParams, body, now });
};
const get = (sandbox, route, now = 0) => {
    const answer = ask(sandbox, 'GET', route, { now });
    assert.equal(answer.status, 200, `${route} answered ${answer.status}`);
    return answer.body;
};
const post = (sandbox, route, body, now = 0) => ask(sandbox, 'POST', route, { body, now });

// ---- an empty library and one model
const empty = createSandbox({ library: 'empty' });
assert.deepEqual(get(empty, '/anomalous/last_scan'), {});
assert.deepEqual([get(empty, '/anomalous/scan_summary').total, get(empty, '/anomalous/scan_summary').new], [0, 0]);
assert.equal(get(empty, '/anomalous/type_models?type=checkpoints&path_idx=0').models.length, 0);
assert.deepEqual(get(empty, '/anomalous/folders').folders.map(group => group.type), ['checkpoints', 'loras', 'vae']);

const sandbox = createSandbox();
const summary = get(sandbox, '/anomalous/scan_summary');
assert.deepEqual([summary.total, summary.new, summary.matched], [1, 1, 0], 'one model, not scanned yet');
const [card] = get(sandbox, '/anomalous/type_models?type=checkpoints&path_idx=0').models;
assert.equal(card.filename, 'amb_pastel_demo_v1.safetensors');
assert.equal(card.metadata.name, 'Pastel Dream Demo');
assert.equal(card.metadata.baseModel, 'Illustrious');
assert.match(card.metadata.hash, /^[0-9a-f]{64}$/);
assert.ok(card.metadata.trainedWords.length && /CFG/.test(card.metadata.description), 'trigger words and settings');
assert.match(card.preview_url, /default_cover_1\.webp\?demo=1$/, 'a cover address pages can add "&variant=card" to');
assert.equal(get(sandbox, '/anomalous/folders').folders[0].folders['/'].model_count, 1);
assert.equal(get(sandbox, '/anomalous/models?type=checkpoints&path_idx=0&subfolder=/').total, 1);
assert.equal(get(sandbox, '/anomalous/find_model?search=amb_pastel_demo_v1.safetensors').model.subfolder, '/');
assert.deepEqual(get(sandbox, '/anomalous/compatible_models?base_model=Illustrious&target_type=loras').models, [], 'no LoRA yet');
assert.equal(post(sandbox, '/anomalous/update_metadata', { type: 'checkpoints', path_idx: 0, subfolder: '/', filename: card.filename, custom_notes: ' mine ' }).body.status, 'success');
assert.equal(get(sandbox, '/anomalous/type_models?type=checkpoints&path_idx=0').models[0].metadata.custom_notes, 'mine', 'notes kept in memory');
assert.deepEqual(sandboxModelValues(sandbox, ['checkpoints']), ['amb_pastel_demo_v1.safetensors']);
assert.deepEqual(sandboxModelValues(sandbox, ['loras']), []);

// ---- Civitai answering or not; the key only in memory
assert.equal(get(sandbox, '/anomalous/civitai_check').reachable, true);
setNetwork(sandbox, 'offline');
assert.deepEqual(['reachable', 'failure', 'error'].map(key => get(sandbox, '/anomalous/civitai_check')[key]), [false, 'timeout', 'Simulated timeout']);
setNetwork(sandbox, 'online');
assert.equal(get(sandbox, '/anomalous/config').has_api_key, false);
assert.equal(post(sandbox, '/anomalous/save_config', { api_key: 'abc' }).body.status, 'ok');
assert.equal(get(sandbox, '/anomalous/config').has_api_key, true);
assert.equal(get(sandbox, '/anomalous/civitai_check').key, 'set');

// ---- a scan by the clock: preparing, scanning, done at 3 s
assert.equal(post(sandbox, '/anomalous/scan_all', { offline_only: false }, 1000).body.status, 'ok');
assert.equal(post(sandbox, '/anomalous/scan_all', {}, 1100).status, 409, 'one scan at a time');
assert.deepEqual(['scanning', 'phase'].map(key => get(sandbox, '/anomalous/global_scan_status', 1300)[key]), [true, 'preparing']);
assert.deepEqual(['scanning', 'phase', 'total'].map(key => get(sandbox, '/anomalous/global_scan_status', 2500)[key]), [true, 'scanning', 1]);
assert.ok(scanRunning(sandbox, 3999));
assert.equal(get(sandbox, '/anomalous/global_scan_status', 4000).scanning, false);
const result = get(sandbox, '/anomalous/last_scan', 4000);
assert.deepEqual([result.kind, result.counts.matched, result.files[0].status, result.files[0].cover], ['all', 1, 'matched', 'kept']);
assert.deepEqual([get(sandbox, '/anomalous/scan_summary').matched, get(sandbox, '/anomalous/scan_summary').new], [1, 0]);
assert.equal(get(sandbox, '/anomalous/scan_matched').total, 1);

// Civitai not answering: an offline scan reads the files only, and the next online scan asks.
const offline = createSandbox({ network: 'offline' });
post(offline, '/anomalous/scan_all', { offline_only: true }, 0);
const offlineResult = get(offline, '/anomalous/last_scan', 3000);
assert.deepEqual([offlineResult.counts.inferred, offlineResult.files[0].reason], [1, 'offline']);
assert.deepEqual([get(offline, '/anomalous/scan_summary').pending, get(offline, '/anomalous/scan_summary').new], [1, 0]);

// ---- the shared workflow, as Model Check meets it
const workflow = demoWorkflow();
assert.deepEqual(workflow.nodes.map(node => node.type), ['CheckpointLoaderSimple', 'LoraLoader', 'LoraLoader', 'VAELoader']);
assert.ok(workflow.nodes.every(node => node.type.match(/^(CheckpointLoaderSimple|LoraLoader|VAELoader)$/)), 'ComfyUI\'s own nodes only');
assert.notEqual(demoWorkflow().nodes[0], workflow.nodes[0], 'a fresh copy each time');
const record = id => findWorkflowHashRecord(workflow, id, workflow.nodes[id - 1].widgets_values[0]);
assert.equal(record(1).hash, SANDBOX_HASHES.pastel, 'the workflow names the checkpoint by the local file\'s fingerprint');
assert.equal(workflow.extra.anomalous_model_sources['characters/miko_style_v2.safetensors'].nodeId, 2);
const batch = post(sandbox, '/anomalous/resolve_hash_batch', { items: [1, 2, 3, 4].map(id => ({ key: String(id), hash: record(id).hash, size: record(id).size, type: id === 1 ? 'checkpoints' : id === 4 ? 'vae' : 'loras' })) }).body;
assert.deepEqual(batch.results[0].result, { found: true, type: 'checkpoints', filename: 'amb_pastel_demo_v1.safetensors' }, 'the same file: fixable');
assert.ok(batch.results.slice(1).every(entry => !entry.result.found), 'the other three are not here');
assert.equal(Object.keys(get(sandbox, '/anomalous/all_hashes').hashes).includes('amb_pastel_demo_v1.safetensors'), true);

const looked = post(sandbox, '/anomalous/download/lookup', {
    items: [2, 3, 4].map(id => ({ key: String(id), hash: record(id).hash, value: workflow.nodes[id - 1].widgets_values[0], types: [id === 4 ? 'vae' : 'loras'] })),
}).body;
const [miko, neon, vae] = looked.results;
assert.deepEqual([miko.found, miko.source, miko.size, miko.sha256], [true, 'civitai', 155189248, SANDBOX_HASHES.miko], 'a download of ~148 MB');
assert.deepEqual([neon.found, neon.reason, /^https:\/\//.test(neon.page)], [false, 'gated', true]);
assert.deepEqual([vae.found, vae.reason], [false, 'not_found']);
assert.ok(looked.roots.loras[0].exists && looked.roots.loras[0].free > miko.size, 'a models folder with room');
assert.equal(post(sandbox, '/anomalous/download/lookup', { items: [{ key: '0', known: true, types: ['loras'] }] }).body.results[0].reason, 'known');

// ---- a download by the clock: queued, running, verifying, done; then the LoRA is in the library
const rel = 'characters/miko_style_v2.safetensors';
const start = { key: rel, value: rel, download_url: miko.download_url, type: 'loras', root: 0, rel, size: miko.size, sha256: miko.sha256, source: 'civitai' };
const job = post(sandbox, '/anomalous/download/start', start, 10000).body;
assert.equal(job.state, 'queued');
assert.equal(post(sandbox, '/anomalous/download/start', start, 10050).status, 409, 'already downloading');
const stateAt = now => get(sandbox, '/anomalous/download/status', now).jobs[0];
assert.equal(stateAt(10100).state, 'queued');
assert.deepEqual([stateAt(11350).state, stateAt(11350).received > 0, stateAt(11350).received < miko.size], ['running', true, true]);
assert.equal(stateAt(12600).state, 'verifying');
assert.ok(downloadsRunning(sandbox, 12900));
assert.deepEqual([stateAt(13000).state, stateAt(13000).received, stateAt(13000).verified], ['done', miko.size, true]);
assert.deepEqual(sandboxModelValues(sandbox, ['loras']), [rel], 'the LoRA box can take it now');
assert.equal(post(sandbox, '/anomalous/download/start', start, 13100).status, 409, 'it exists');
const lora = get(sandbox, '/anomalous/type_models?type=loras&path_idx=0').models[0];
assert.deepEqual([lora.metadata.name, lora.preview_url, get(sandbox, '/anomalous/scan_summary').new], ['', '', 1], 'not scanned: no name, no cover');
post(sandbox, '/anomalous/scan_all', { targets: [{ type: 'loras', path_idx: 0, subfolder: '/characters', files: ['miko_style_v2.safetensors'] }] }, 14000);
assert.equal(get(sandbox, '/anomalous/last_scan', 17000).files.length, 1, 'only the downloaded file');
const scanned = get(sandbox, '/anomalous/type_models?type=loras&path_idx=0').models[0];
assert.deepEqual([scanned.metadata.name, /default_cover_3/.test(scanned.preview_url)], ['Miko Style', true]);
assert.equal(get(sandbox, '/anomalous/last_scan', 17000).counts.covers, 1);
assert.equal(get(sandbox, '/anomalous/compatible_models?base_model=Illustrious&target_type=loras').models.length, 1);

// A download cancelled halfway stays cancelled.
const cancelled = createSandbox();
const second = post(cancelled, '/anomalous/download/start', start, 0).body;
assert.equal(post(cancelled, '/anomalous/download/cancel', { id: second.id }, 1000).body.state, 'cancelled');
assert.equal(get(cancelled, '/anomalous/download/status', 5000).jobs[0].state, 'cancelled');
assert.deepEqual(sandboxModelValues(cancelled, ['loras']), []);
assert.equal(post(cancelled, '/anomalous/download/cancel', { id: 'nope' }).status, 404);

// ---- the Workflows page: the shared workflow, what is here by its exact name
assert.deepEqual(get(sandbox, '/anomalous/recipes').recipes, []);
shareDemoWorkflow(sandbox, { name: 'Shared', notes: 'n', thumbnail: 'data:image/webp;base64,AAAA' });
const [listed] = get(sandbox, '/anomalous/recipes').recipes;
assert.equal(listed.data.name, 'Shared');
assert.equal(listed.data.workflow, undefined, 'the list has no graph');
assert.equal(listed.data.params.model_references.length, 4);
const full = get(sandbox, `/anomalous/recipe_full?filename=${listed.filename}`);
assert.deepEqual([full.status, full.data.workflow.nodes.length], ['success', 4]);
assert.equal(ask(sandbox, 'GET', '/anomalous/recipe_full?filename=other.json').status, 404);
const identity = post(sandbox, '/anomalous/refresh_recipe_identity', { references: listed.data.params.model_references }).body;
assert.deepEqual(identity.results.map(item => item.availability), ['missing', 'available', 'missing', 'missing'],
    'by exact name, as the server checks: the downloaded LoRA is here, the checkpoint only under another name');
const previews = post(sandbox, '/anomalous/resolve_paths_to_previews', { paths: [rel, 'elsewhere/amb_pastel_demo_v1.safetensors', 'none.safetensors'] }).body;
assert.deepEqual(Object.keys(previews.models), [rel, 'elsewhere/amb_pastel_demo_v1.safetensors'], 'by path, else by file name');

// ---- reads it leaves alone, reads it does not know, changes it refuses
assert.deepEqual(ask(sandbox, 'GET', '/anomalous/version'), { pass: true });
const unknown = ask(sandbox, 'GET', '/anomalous/something_new');
assert.deepEqual([unknown.status, unknown.body, unknown.fallback], [200, {}, true]);
for (const [method, route] of [['POST', '/anomalous/delete_model'], ['POST', '/anomalous/save_recipe'], ['PUT', '/anomalous/import/upload'],
    ['DELETE', '/anomalous/saves/remove'], ['POST', '/anomalous/backup/apply'], ['POST', '/anomalous/translate_description']]) {
    assert.deepEqual(ask(sandbox, method, route, { body: {} }), { blocked: true }, `${method} ${route}`);
}
assert.equal(post(sandbox, '/anomalous/clear_cache', {}).body.status, 'ok', 'asked on its own by other pages: answered quietly');
assert.deepEqual(get(sandbox, '/anomalous/gallery_images?page=1&limit=8').images, []);
for (const route of ['/anomalous/kept_images', '/anomalous/saves', '/anomalous/notebooks', '/anomalous/materials', '/anomalous/parameters',
    '/anomalous/activity', '/anomalous/ai_tasks', '/anomalous/ai_callers', '/anomalous/rail_hints', '/anomalous/placement/check', '/anomalous/quick_index']) {
    const body = get(sandbox, route);
    assert.ok(body && typeof body === 'object' && !Array.isArray(body), route);
}

// ---- starting over leaves nothing behind
resetProgress(sandbox);
assert.deepEqual(get(sandbox, '/anomalous/last_scan'), {});
assert.deepEqual(get(sandbox, '/anomalous/download/status').jobs, []);
assert.deepEqual(sandboxModelValues(sandbox, ['loras']), []);
assert.equal(get(sandbox, '/anomalous/config').has_api_key, false);
assert.equal(get(sandbox, '/anomalous/type_models?type=checkpoints&path_idx=0').models[0].metadata.custom_notes, '');
assert.equal(get(sandbox, '/anomalous/recipes').recipes.length, 1, 'the shared workflow stays until the sandbox ends');
setLibrary(sandbox, 'empty');
assert.equal(get(sandbox, '/anomalous/scan_summary').total, 0);
assert.throws(() => setLibrary(sandbox, 'two'));
assert.throws(() => setNetwork(sandbox, 'sometimes'));
assert.equal(createSandbox().models[0].meta.custom_notes, undefined, 'one sandbox\'s notes are not another\'s');

// ---- the console's words, in both languages
const KEYS = ['reviewSandboxTitle', 'reviewSandboxEnter', 'reviewSandboxExit', 'reviewSandboxLeaving', 'reviewSandboxBadge', 'reviewSandboxNote',
    'reviewSandboxBusy', 'reviewSandboxLibrary', 'reviewSandboxLibrary_empty', 'reviewSandboxLibrary_one', 'reviewSandboxNetwork',
    'reviewSandboxNetwork_online', 'reviewSandboxNetwork_offline', 'reviewSandboxWorkflow', 'reviewSandboxWorkflowAgain', 'reviewSandboxReset',
    'reviewSandboxBlocked', 'reviewSandboxTab', 'reviewSandboxWorkflowTab', 'reviewSandboxWorkflowName', 'reviewSandboxWorkflowNotes',
    'reviewSandboxWorkflowPlaced'];
for (const lang of ['zh', 'en']) {
    for (const key of KEYS) assert.ok(i18n[lang][key], `${lang} has no '${key}'`);
}
console.log('review sandbox: ok');
