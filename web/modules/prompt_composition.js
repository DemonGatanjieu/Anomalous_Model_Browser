/** Preserve fragment contents and order, including weights and commas. */
export function joinPromptText(existing, incoming, position) {
    if (!['before', 'after'].includes(position)) throw new Error('materialNoCompatibleValues');
    return (position === 'before' ? [incoming, existing] : [existing, incoming])
        .filter(value => value && value.trim()).join('\n');
}

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
export function categorizePromptSnippet(text = '') {
    const lower = String(text).toLowerCase();
    if (BASE_QUALITY_KEYWORDS.some(k => lower.includes(k))) return 'base';
    if (TRIGGER_KEYWORDS.some(k => lower.includes(k))) return 'trigger';
    if (STYLE_KEYWORDS.some(k => lower.includes(k))) return 'style';
    return 'subject';
}

/** Smart sort prompt blocks: Same-role blocks first, cross-role blocks at the tail */
export function smartSortPromptBlocks(blocks = [], trackRole = 'positive') {
    const priority = {
        base: 0,
        style: 1,
        subject: 2,
        trigger: 3,
    };
    return [...blocks].sort((a, b) => {
        const aCross = (a.role && a.role !== trackRole) ? 1 : 0;
        const bCross = (b.role && b.role !== trackRole) ? 1 : 0;
        if (aCross !== bCross) {
            return aCross - bCross;
        }

        const catA = a.category || categorizePromptSnippet(a.content || a[trackRole] || '');
        const catB = b.category || categorizePromptSnippet(b.content || b[trackRole] || '');
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

/**
 * Losslessly converts any prompt plan (legacy v1 with dual-role blocks or loose text, or v2)
 * into the standardized workbench draft representation with role isolation.
 */
export function planToWorkbenchDraft(planData = {}, defaultName = '') {
    const rawParts = Array.isArray(planData.parts) ? planData.parts : [];
    const convertedBlocks = [];
    const makeId = (prefix, idx) => `${prefix}_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;

    rawParts.forEach((part, idx) => {
        if (!part) return;
        const name = String(part.name || part.title || '').trim();
        const enabled = part.enabled !== false;
        const category = part.category || 'general';

        const hasPos = typeof part.positive === 'string' && part.positive.trim().length > 0;
        const hasNeg = typeof part.negative === 'string' && part.negative.trim().length > 0;

        if (hasPos && hasNeg) {
            convertedBlocks.push({
                id: part.id ? `${part.id}_pos` : makeId('blk_pos', idx),
                title: name ? `${name} (Pos)` : 'Positive',
                content: part.positive.trim(),
                role: 'positive',
                category: category === 'general' ? categorizePromptSnippet(part.positive) : category,
                enabled,
            });
            convertedBlocks.push({
                id: part.id ? `${part.id}_neg` : makeId('blk_neg', idx),
                title: name ? `${name} (Neg)` : 'Negative',
                content: part.negative.trim(),
                role: 'negative',
                category: category === 'general' ? 'base' : category,
                enabled,
            });
        } else if (hasNeg || part.role === 'negative') {
            const content = String(part.content ?? part.negative ?? '').trim();
            if (content) {
                convertedBlocks.push({
                    id: part.id || makeId('blk', idx),
                    title: name || 'Negative',
                    content,
                    role: 'negative',
                    category: category === 'general' ? 'base' : category,
                    enabled,
                });
            }
        } else {
            const content = String(part.content ?? part.positive ?? '').trim();
            if (content) {
                convertedBlocks.push({
                    id: part.id || makeId('blk', idx),
                    title: name || 'Positive',
                    content,
                    role: 'positive',
                    category: category === 'general' ? categorizePromptSnippet(content) : category,
                    enabled,
                });
            }
        }
    });

    // Check for legacy trailing unassigned text (for legacy v1 plans)
    if (!planData.version || planData.version < 2) {
        ['positive', 'negative'].forEach(role => {
            const rawText = String(planData[role] || '').trim();
            if (!rawText) return;

            const existingRoleBlocks = convertedBlocks.filter(b => b.role === role);
            const assembledRoleText = assemblePromptBlocks(existingRoleBlocks, role);
            const joinedRoleText = existingRoleBlocks.map(b => b.content).join('\n');

            if (rawText !== assembledRoleText && rawText !== joinedRoleText) {
                if (existingRoleBlocks.length === 0) {
                    convertedBlocks.push({
                        id: makeId(`blk_${role}_init`, convertedBlocks.length),
                        title: role === 'positive' ? '正向提示词' : '负向提示词',
                        content: rawText,
                        role,
                        category: role === 'positive' ? categorizePromptSnippet(rawText) : 'base',
                        enabled: true,
                    });
                } else {
                    let trailing = rawText;
                    if (trailing.startsWith(assembledRoleText)) {
                        trailing = trailing.slice(assembledRoleText.length).replace(/^[,，\n\s]+/, '').trim();
                    } else if (trailing.startsWith(joinedRoleText)) {
                        trailing = trailing.slice(joinedRoleText.length).replace(/^[,，\n\s]+/, '').trim();
                    }
                    if (trailing) {
                        convertedBlocks.push({
                            id: makeId(`blk_${role}_tail`, convertedBlocks.length),
                            title: role === 'positive' ? '附加正向词' : '附加负向词',
                            content: trailing,
                            role,
                            category: role === 'positive' ? categorizePromptSnippet(trailing) : 'base',
                            enabled: true,
                        });
                    }
                }
            }
        });
    }

    const draft = {
        name: String(planData.name || defaultName || '').trim(),
        tags: Array.isArray(planData.tags) ? planData.tags : [],
        plan: {
            version: 2,
            parts: convertedBlocks,
            positive: assemblePromptBlocks(convertedBlocks.filter(p => p.role === 'positive'), 'positive'),
            negative: assemblePromptBlocks(convertedBlocks.filter(p => p.role === 'negative'), 'negative'),
        },
    };

    return draft;
}

/**
 * Converts a workbench draft into the standard backend-storable prompt plan object.
 */
export function workbenchDraftToSavedPlan(draft) {
    const parts = Array.isArray(draft?.plan?.parts) ? draft.plan.parts : [];
    const posParts = parts.filter(p => p.role === 'positive');
    const negParts = parts.filter(p => p.role === 'negative');

    return {
        name: String(draft.name || '').trim(),
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        plan: {
            version: 2,
            parts: parts.map(p => ({
                name: String(p.title || p.name || '').trim().slice(0, 120),
                positive: p.role === 'positive' ? String(p.content || '').trim() : '',
                negative: p.role === 'negative' ? String(p.content || '').trim() : '',
                category: p.category || (p.role === 'negative' ? 'base' : categorizePromptSnippet(p.content)),
                enabled: p.enabled !== false,
            })),
            positive: assemblePromptBlocks(posParts, 'positive'),
            negative: assemblePromptBlocks(negParts, 'negative'),
        },
    };
}

