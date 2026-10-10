/** Prompt Studio's starter cards; a combo put on the canvas takes the common negative one. */
export const PROMPT_PRESETS = [
    { id: 'preset_quality', titleKey: 'promptPresetQuality', role: 'positive', content: 'masterpiece, best quality, highly detailed' },
    { id: 'preset_negative', titleKey: 'promptPresetNegative', role: 'negative', content: 'worst quality, low quality, lowres, blurry, jpeg artifacts, watermark, text' },
    { id: 'preset_anatomy', titleKey: 'promptPresetAnatomy', role: 'negative', content: 'bad anatomy, bad hands, extra fingers, missing fingers, deformed' },
];

export function composePromptPlan(plan) {
    if (!plan) return { positive: '', negative: '' };
    const parts = Array.isArray(plan.parts) ? plan.parts : [];
    const active = parts.filter(part => part && part.enabled !== false);

    return Object.fromEntries(['positive', 'negative'].map(role => {
        const activeParts = active.filter(p => (p.track || p.role) === role || (!p.track && !p.role && (role === 'positive' ? p.positive : p.negative)));
        const activeAssembled = assemblePromptBlocks(activeParts, role);
        const rawFieldText = String(plan[role] || '').trim();

        if (plan.version >= 2) {
            return [role, rawFieldText || activeAssembled];
        }

        if (activeParts.length > 0 && rawFieldText) {
            const activeJoinedNewline = activeParts.map(p => String(p.content ?? p[role] ?? '').trim()).filter(Boolean).join('\n');
            if (rawFieldText === activeAssembled || rawFieldText === activeJoinedNewline) {
                return [role, rawFieldText];
            }
        }

        const partsText = activeParts.map(part => part[role] || part.content || '').filter(Boolean);
        return [role, [...partsText, rawFieldText].filter(Boolean).join('\n')];
    }));
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
// Quality words most prompts start with: they say nothing about the picture.
const QUALITY_TAG = /^(?:masterpiece|best quality|high quality|highest quality|amazing quality|very aesthetic|aesthetic|newest|highres|absurdres|ultra[- ]?detailed|highly detailed|extremely detailed|detailed|8k|4k|hdr|uhd|score_\d+(?:_up)?|source_\w+|rating_\w+)$/i;

/** A short name from a prompt: its first few tags that are not quality words ("" when none). */
export function promptTitle(text = '') {
    const tags = String(text).split(/[,\n]/)
        .map(tag => tag.replace(/^[\s(\[{]+|[\s)\]}]+$/g, '').replace(/:[\d.]+$/, '').trim())
        .filter(tag => tag && !QUALITY_TAG.test(tag));
    const title = tags.slice(0, 3).join(', ');
    return title.length > 48 ? `${title.slice(0, 47)}…` : title;
}

export function categorizePromptSnippet(text = '') {
    const lower = String(text).toLowerCase();
    if (BASE_QUALITY_KEYWORDS.some(k => lower.includes(k))) return 'base';
    if (TRIGGER_KEYWORDS.some(k => lower.includes(k))) return 'trigger';
    if (STYLE_KEYWORDS.some(k => lower.includes(k))) return 'style';
    return 'subject';
}

/** Cleanly join prompt blocks with commas and proper spacing */
function assemblePromptBlocks(blocks = [], role = 'positive') {
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
