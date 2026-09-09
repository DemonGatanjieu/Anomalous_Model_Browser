/** Preserve fragment contents and order, including weights and commas. */
export function joinPromptText(existing, incoming, position) {
    if (!['before', 'after'].includes(position)) throw new Error('materialNoCompatibleValues');
    return (position === 'before' ? [incoming, existing] : [existing, incoming])
        .filter(value => value && value.trim()).join('\n');
}

export function composePromptPlan(plan) {
    const active = (plan.parts || []).filter(part => part.enabled !== false);
    return Object.fromEntries(['positive', 'negative'].map(role => [role,
        [...active.map(part => part[role] || ''), plan[role] || '']
            .filter(value => value && value.trim()).join('\n'),
    ]));
}

const BASE_QUALITY_KEYWORDS = [
    'masterpiece', 'best quality', 'highly detailed', 'ultra-detailed', '8k', 'hdr',
    'absurdres', 'highres', 'high resolution', 'perfect anatomy', 'clean background',
    'worst quality', 'low quality', 'normal quality', 'lowres', 'bad anatomy',
    'bad hands', 'missing fingers', 'extra digits', 'fewer digits', 'cropped',
    'jpeg artifacts', 'blurry', 'watermark', 'signature', 'artist name'
];

const TRIGGER_KEYWORDS = [
    '<lora:', 'trigger:', 'lora:', 'custom dress', 'specific', 'costume', 'outfit'
];

const STYLE_KEYWORDS = [
    'style', 'lighting', 'cinematic', 'illustration', 'oil painting', 'concept art',
    'unreal engine', 'octane render', 'vray', 'ray tracing', 'anime', 'photorealistic',
    'pastel', 'watercolor', 'cyberpunk', 'steampunk', 'glow', 'volumetric'
];

/** Categorize a prompt block based on its keywords and content */
export function categorizePromptSnippet(text = '') {
    const lower = String(text).toLowerCase();
    if (BASE_QUALITY_KEYWORDS.some(k => lower.includes(k))) return 'base';
    if (TRIGGER_KEYWORDS.some(k => lower.includes(k))) return 'trigger';
    if (STYLE_KEYWORDS.some(k => lower.includes(k))) return 'style';
    return 'subject';
}

/** Smart sort prompt blocks: Universal/Base first, Style in middle, Details/LoRA/Trigger last */
export function smartSortPromptBlocks(blocks = [], role = 'positive') {
    const priority = {
        base: 0,
        style: 1,
        subject: 2,
        trigger: 3,
    };
    return [...blocks].sort((a, b) => {
        const catA = a.category || categorizePromptSnippet(a.content || a[role] || '');
        const catB = b.category || categorizePromptSnippet(b.content || b[role] || '');
        const scoreA = priority[catA] ?? 2;
        const scoreB = priority[catB] ?? 2;
        return scoreA - scoreB;
    });
}

/** Cleanly join prompt blocks with commas and proper spacing */
export function assemblePromptBlocks(blocks = [], role = 'positive') {
    return blocks
        .filter(b => b && b.enabled !== false)
        .map(b => {
            const raw = String(b.content ?? b[role] ?? '').trim();
            // remove trailing/leading commas from snippet
            return raw.replace(/^[,，\s]+|[,，\s]+$/g, '');
        })
        .filter(Boolean)
        .join(',\n');
}
