/**
 * The review console's blank sandbox (review_sandbox_data.js): its made-up files. The model of the one-model
 * library; the workflow someone shared, naming that model under another name with three more (one a download
 * finds, one behind a login, one foundation component nobody has), with the fingerprints and links a shared
 * workflow carries; how the Workflows page lists it; and where each file can be downloaded from, the sandbox's
 * pretend internet. Nothing here exists anywhere. No DOM and no window.
 */

export const RECIPE_FILE = 'recipe_sandbox_shared.json';
const SAVED_AT = 1795400000000;

// The pictures ship with AMB. `?demo=1`: pages add `&variant=card` to a cover's address.
const cover = name => `${new URL(`../assets/${name}`, import.meta.url).href}?demo=1`;
export const SHARED_COVER = cover('default_cover_2.webp');

export const SANDBOX_HASHES = Object.freeze({
    pastel: 'd7684aade803d447f6bd754f4ef4b19a8246bf883b03cef106a78353bb63e915',
    miko: 'a2388878c87ed547f97c956474f0a22f41d8925a9e188a1f90cc205ab1eabb31',
    neon: '395d562fbe5d747dbc36d64f10e4a65913e33e046cec4a3f8aa473eabc6bf24c',
    vae: 'c2797475660d7dac4757adc36a91cb9011beb822b52d2adcf5f729bd1d6c3ffd',
});

/** The model of the one-model library: the workflow names it under another name, found by its fingerprint. */
export const LIBRARY_MODEL = {
    type: 'checkpoints', rel: 'amb_pastel_demo_v1.safetensors', size: 6938040682, cover: cover('default_cover_1.webp'), known: true,
    meta: {
        name: 'Pastel Dream Demo', version_name: 'v1.0', baseModel: 'Illustrious', hash: SANDBOX_HASHES.pastel,
        trainedWords: ['pastel colors', 'soft lighting', 'dreamy atmosphere'],
        description: '<p>A soft pastel anime checkpoint for AMB\'s sandbox. No such file exists anywhere.</p>'
            + '<p>Recommended: Euler a · 28 steps · CFG 5.5 · Clip skip 2 · 832×1216.</p>',
    },
};

/** The one model of the workflow a download finds, as the library has it once downloaded. */
export const DOWNLOADED_LORA = {
    size: 155189248, coverAfterScan: cover('default_cover_3.webp'),
    meta: {
        name: 'Miko Style', version_name: 'v2', baseModel: 'Illustrious', hash: SANDBOX_HASHES.miko,
        trainedWords: ['miko style', 'red hakama'],
        description: '<p>A shrine maiden style LoRA for AMB\'s sandbox.</p><p>Weight 0.7–0.9.</p>',
    },
};

// The shared workflow: [node id, type, widget values, sha256, size].
const SHARED_NODES = [
    [1, 'CheckpointLoaderSimple', ['shared/author_pastel_final.safetensors'], SANDBOX_HASHES.pastel, LIBRARY_MODEL.size],
    [2, 'LoraLoader', ['characters/miko_style_v2.safetensors', 0.8, 0.8], SANDBOX_HASHES.miko, DOWNLOADED_LORA.size],
    [3, 'LoraLoader', ['private/neon_rain_v1.safetensors', 0.6, 0.6], SANDBOX_HASHES.neon, 228170184],
    [4, 'VAELoader', ['custom_sdxl_vae_fp16.safetensors'], SANDBOX_HASHES.vae, 334641164],
];
const NEON_PAGE = 'https://huggingface.co/amb-sandbox/neon-rain';
const SHARED_SOURCES = {
    'characters/miko_style_v2.safetensors': { url: 'https://civitai.com/models/0/miko-style', platform: 'Civitai', node: 2, hash: SANDBOX_HASHES.miko },
    'private/neon_rain_v1.safetensors': { url: `${NEON_PAGE}/resolve/main/neon_rain_v1.safetensors`, platform: 'Hugging Face', node: 3, hash: SANDBOX_HASHES.neon },
};

const baseName = value => String(value ?? '').replace(/\\/g, '/').split('/').pop();

/** The four-node workflow someone shared, as ComfyUI keeps a workflow (a fresh copy each time). */
export function demoWorkflow() {
    const outputs = {
        CheckpointLoaderSimple: [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']],
        LoraLoader: [['MODEL', 'MODEL'], ['CLIP', 'CLIP']],
        VAELoader: [['VAE', 'VAE']],
    };
    const links = [[1, 1, 0, 2, 0, 'MODEL'], [2, 1, 1, 2, 1, 'CLIP'], [3, 2, 0, 3, 0, 'MODEL'], [4, 2, 1, 3, 1, 'CLIP']];
    const nodes = SHARED_NODES.map(([id, type, values], order) => ({
        id, type, pos: id === 4 ? [40, 320] : [40 + (id - 1) * 380, 120], size: [320, type === 'VAELoader' ? 58 : 110],
        flags: {}, order, mode: 0,
        inputs: type === 'LoraLoader' ? [['model', 'MODEL', 0], ['clip', 'CLIP', 1]].map(([name, kind, slot]) => ({
            name, type: kind, link: links.find(link => link[3] === id && link[4] === slot)?.[0] ?? null,
        })) : [],
        outputs: outputs[type].map(([name, kind], slot) => ({
            name, type: kind, slot_index: slot, links: links.filter(link => link[1] === id && link[2] === slot).map(link => link[0]),
        })),
        properties: { 'Node name for S&R': type },
        widgets_values: [...values],
    }));
    const hashes = Object.fromEntries(SHARED_NODES.map(([id, , [value], hash, size]) => [`${id}_${value}`, { hash, size }]));
    const sources = Object.fromEntries(Object.entries(SHARED_SOURCES).map(([value, source]) => [value, {
        name: baseName(value), url: source.url, platform: source.platform, nodeId: source.node, hash: source.hash, updated_at: SAVED_AT,
    }]));
    return {
        last_node_id: 4, last_link_id: 4, nodes, links, groups: [], config: {},
        extra: { anomalous_hashes: hashes, anomalous_model_sources: sources }, version: 0.4,
    };
}

/** Where a looked-up item can come from in the sandbox's pretend internet. */
export function sourceFor(item) {
    const hash = String(item.hash || '').toLowerCase();
    const name = baseName(item.value).toLowerCase();
    if (hash === SANDBOX_HASHES.miko || name === 'miko_style_v2.safetensors') {
        return {
            found: true, source: 'civitai', download_url: 'https://civitai.com/api/download/models/0', file_name: 'miko_style_v2.safetensors',
            size: DOWNLOADED_LORA.size, sha256: SANDBOX_HASHES.miko, format: 'SafeTensor', base_model: 'Illustrious', model_name: 'Miko Style',
            version_name: 'v2', page: '',
        };
    }
    if (hash === SANDBOX_HASHES.neon || name === 'neon_rain_v1.safetensors') return { found: false, reason: 'gated', page: NEON_PAGE };
    return { found: false, reason: 'not_found' };
}

function references() {
    const categories = { CheckpointLoaderSimple: ['checkpoint', 'checkpoint'], LoraLoader: ['lora', 'lora'], VAELoader: ['vae', 'vae'] };
    return SHARED_NODES.map(([id, type, [value], hash, size]) => ({
        node_id: id, node_type: type, node_title: type, widget_index: 0, widget_name: categories[type][1], saved_value: value,
        category: categories[type][0], base_model: null, identity: { status: 'verified', sha256: hash, provenance: 'workflow snapshot', size },
    }));
}

/** The workflow as the Workflows page lists it (`withWorkflow`: and opens it); `shared` = { name, notes, thumbnail }. */
export function sharedRecipe(shared, withWorkflow) {
    const data = {
        schema_version: 7, name: shared.name, tags: [], notes: shared.notes, params: { model_references: references() },
        workflow_scope: 'complete', thumbnail: shared.thumbnail, source_image: null, presentation: { save_model_preview_snapshots: true },
        timestamp: SAVED_AT, created_timestamp: SAVED_AT, updated_timestamp: SAVED_AT,
    };
    if (withWorkflow) data.workflow = demoWorkflow();
    return data;
}
