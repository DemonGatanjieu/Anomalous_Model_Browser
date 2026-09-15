import { categorizePromptSnippet, assemblePromptBlocks } from './prompt_composition.js';
export const newDraft = () => ({
    name: '',
    tags: [],
    plan: {
        version: 2,
        parts: [],
        positive: '',
        negative: '',
    },
});

export const CATEGORY_META = {
    base: { zh: '通用底模', en: 'Base Quality', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' },
    style: { zh: '风格氛围', en: 'Art Style', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.4)' },
    subject: { zh: '主体内容', en: 'Subject', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)' },
    trigger: { zh: 'LoRA/触发', en: 'LoRA / Trigger', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.4)' },
};

// Built-in starter prompt cards for left source deck
export const STARTER_SOURCE_PROMPTS = [
    {
        id: 'preset_base_quality',
        title: '画质底模词 (Quality Base)',
        content: 'masterpiece, best quality, highly detailed, ultra-detailed, 8k, hdr, absurdres',
        role: 'positive',
        category: 'base',
    },
    {
        id: 'preset_real_detail',
        title: '写实与材质增强 (Realistic Detail)',
        content: 'highres, realistic skin texture, sharp focus, subsurface scattering, 35mm photograph',
        role: 'positive',
        category: 'base',
    },
    {
        id: 'preset_cinematic_light',
        title: '电影胶片光影 (Cinematic Lighting)',
        content: 'cinematic lighting, dramatic shadows, soft volumetric glow, ray tracing, atmospheric',
        role: 'positive',
        category: 'style',
    },
    {
        id: 'preset_anime_cyber',
        title: '赛博霓虹风 (Cyberpunk Neon)',
        content: 'anime style, cyberpunk aesthetic, vibrant neon reflections, futuristic metropolis backdrop',
        role: 'positive',
        category: 'style',
    },
    {
        id: 'preset_girl_face',
        title: '美少女面部特写 (Portrait 1girl)',
        content: '1girl, beautiful detailed expressive eyes, smile, delicate face, soft wind-blown hair',
        role: 'positive',
        category: 'subject',
    },
    {
        id: 'preset_neg_filter',
        title: '通用负向过滤词 (Negative Base Filter)',
        content: 'worst quality, low quality, normal quality, lowres, bad anatomy, bad hands, missing fingers, extra digits, cropped, blurry, watermark',
        role: 'negative',
        category: 'base',
    },
];

export function normalizeBlock(part, index = 0) {
    const id = part.id || `blk_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;
    const role = part.role || (part.negative && !part.positive ? 'negative' : 'positive');
    const track = part.track || role;
    const content = String(part.content ?? (role === 'positive' ? part.positive : part.negative) ?? '').trim();
    let category = part.category;
    if (!CATEGORY_META[category]) {
        category = categorizePromptSnippet(content);
    }
    const meta = CATEGORY_META[category] || CATEGORY_META.subject;
    const defaultTitle = (window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en) + (index ? ` #${index + 1}` : '');
    return {
        id,
        title: part.name || part.title || defaultTitle,
        content,
        role,
        track,
        category,
        enabled: part.enabled !== false,
    };
}

export function syncDraftSynthesizedText(draft) {
    if (!draft || !draft.plan) return;
    draft.plan.parts ||= [];
    const posParts = draft.plan.parts.filter(p => (p.track || p.role) === 'positive');
    const negParts = draft.plan.parts.filter(p => (p.track || p.role) === 'negative');
    draft.plan.positive = assemblePromptBlocks(posParts, 'positive');
    draft.plan.negative = assemblePromptBlocks(negParts, 'negative');
}

// Full-text edits replace the enabled blocks of one role. Keep disabled blocks
// and the other role intact; synthesized fields are always derived from parts.
export function replaceDraftRoleText(draft, role, content) {
    const parts = draft.plan.parts || [];
    const first = parts.findIndex(part => (part.track || part.role) === role && part.enabled !== false);
    const replacement = content.trim() ? normalizeBlock({ content, role, track: role }) : null;
    const next = [];
    parts.forEach((part, index) => {
        if (index === first && replacement) next.push(replacement);
        if ((part.track || part.role) !== role || part.enabled === false) next.push(part);
    });
    if (first < 0 && replacement) next.push(replacement);
    draft.plan.parts = next;
    syncDraftSynthesizedText(draft);
}
