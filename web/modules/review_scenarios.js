/**
 * What the review console (ui_review_console.js) rehearses, without DOM. AI tasks shaped as
 * api/ai_tasks.py keeps them, one for each state of the canvas card, shown through the card's own rules
 * and drawing (ai_float_state.js, ui_ai_float.js); what a press on the card does to such a task, so the
 * rehearsal goes on with no server; and the rail pins of a new, an upgraded or a full user (rail_pins.js),
 * shown and never kept. A task's words stand for an AI's own (its name, its question and options), so they
 * are here in both languages, beside the task they belong to.
 */

import { gateOf } from './ai_float_state.js';
import { CORE_RAIL_ENTRIES, OPTIONAL_RAIL_ENTRIES } from './rail_pins.js';

/** The rehearsals, in the console's order: `group` live (the AI at work), action (waits on the user), other. */
export const REVIEW_SCENARIOS = Object.freeze([
    ['tool', 'live'], ['run', 'live'], ['thinking', 'live'],
    ['ask_choice', 'action'], ['ask_input', 'action'], ['ask_workbench', 'action'], ['gate', 'action'],
    ['paused', 'other'], ['done', 'other'], ['error', 'other'], ['chat_only_quiet', 'other'], ['chat_only_gate', 'other'],
].map(([id, group]) => Object.freeze({ id, group, labelKey: `reviewScene_${id}` })));

const UPGRADED_PINS = ['combos', 'prompts', 'ai', 'saves', 'scan']; // what an earlier version's user had used
const RUN_STEPS = 20;

const WORDS = {
    zh: {
        titles: {
            tool: '给人物加上动漫风格', run: '画一只雪地里的狐狸', thinking: '把画面改得更有冬天的感觉', ask_choice: '给狐狸挑一种光线',
            ask_input: '做一张冬日海报', ask_workbench: '从四张草图里挑两张', gate: '补上缺的细节 LoRA', paused: '重画背景',
            done: '画两张不同角度的狐狸', error: '放大到 4K', chat_only_quiet: '在 AI 软件里改提示词', chat_only_gate: '在 AI 软件里补模型',
        },
        prompt: 'masterpiece, a red fox in the snow, morning light',
        choice: { question: '狐狸身上的光，要哪一种？', options: ['清晨的冷光', '黄昏的暖光', '夜里的月光'] },
        input: { question: '海报上写一句什么标题？', placeholder: '比如：冬日的守望者' },
        picks: { question: '这四张草图里，留下哪两张接着画？', options: ['草图 A', '草图 B', '草图 C', '草图 D'] },
        failure: '显存不够，放大没有做完',
        denied: '你没有允许',
    },
    en: {
        titles: {
            tool: 'Give the character an anime style', run: 'A red fox in the snow', thinking: 'Make the scene feel more like winter',
            ask_choice: 'Pick a light for the fox', ask_input: 'A winter poster', ask_workbench: 'Keep two of four sketches',
            gate: 'Get the missing detail LoRA', paused: 'Redraw the background', done: 'The fox from two angles', error: 'Upscale to 4K',
            chat_only_quiet: 'Prompt changes in the AI app', chat_only_gate: 'A model for the AI app',
        },
        prompt: 'masterpiece, a red fox in the snow, morning light',
        choice: { question: 'Which light should fall on the fox?', options: ['Cool morning light', 'Warm dusk light', 'Moonlight'] },
        input: { question: 'What title goes on the poster?', placeholder: 'e.g. The Winter Watcher' },
        picks: { question: 'Which two of these four sketches should go on?', options: ['Sketch A', 'Sketch B', 'Sketch C', 'Sketch D'] },
        failure: 'Out of video memory, the upscale did not finish',
        denied: 'You did not allow it',
    },
};

const wordsIn = locale => WORDS[locale === 'en' ? 'en' : 'zh'];

const stepOf = (id, tool, kind, at, extra = {}) => ({ id, at, ms: 600, tool, kind, stage: null, ok: true, state: 'done', summary: tool, results: [], ...extra });

const progressOf = percent => ({ state: percent >= 100 ? 'done' : 'running', node: 'KSampler', value: Math.round((percent / 100) * RUN_STEPS), max: RUN_STEPS, percent });

const gateStep = (id, at) => stepOf(id, 'download_missing_models', 'download', at, {
    state: 'asking', ms: 0, summary: 'download_missing_models: illustrious_detail_v2.safetensors',
    gate: { gate: 'download', lines: [{ label: 'name', value: 'illustrious_detail_v2.safetensors' }, { label: 'folder', value: 'loras' }] },
});

const panelStep = (id, tool, at, block) => stepOf(id, tool, 'panel', at, { panel: { title: block.question, blocks: [block] }, answers: {} });

const options = (labels, recommended = -1) => labels.map((label, at) => ({ id: `o${at + 1}`, label, ...(at === recommended ? { recommended: true } : {}) }));

/** What the task of `scenarioId` holds after its first look at the canvas. */
function stepsFor(scenarioId, words, now, percent) {
    const prompt = stepOf('p2', 'set_prompt', 'canvas', now - 20, { summary: `set_prompt: ${words.prompt}`, results: [{ type: 'canvas' }] });
    const run = extra => stepOf('p4', 'run_workflow', 'run', now - 12, { prompt_ids: ['preview-prompt-1'], ...extra });
    switch (scenarioId) {
    case 'tool': return [stepOf('p2', 'add_lora', 'canvas', now - 2, { state: 'running', ms: 0, summary: 'add_lora: anime_style_v2.safetensors (0.75)' })];
    case 'run': return [prompt, run({ state: 'running', ms: 0, progress: progressOf(percent) })];
    case 'thinking': return [{ ...prompt, at: now - 3 }];
    case 'ask_choice': return [panelStep('p2', 'ask_user', now - 4, { id: 'light', type: 'choices', question: words.choice.question, options: options(words.choice.options, 1) })];
    case 'ask_input': return [panelStep('p2', 'ask_user', now - 4, { id: 'title', type: 'input', question: words.input.question, placeholder: words.input.placeholder })];
    case 'ask_workbench': return [panelStep('p2', 'show_panel', now - 4, { id: 'keep', type: 'picks', question: words.picks.question, options: options(words.picks.options) })];
    case 'gate': case 'chat_only_gate': return [gateStep('p2', now - 3)];
    case 'paused': return [prompt, stepOf('p3', 'user_halt', 'user', now - 5, { pause: true, delivered: false })];
    case 'done': {
        const pictures = [1, 2].map(n => ({ type: 'image', folder: 'output', subfolder: '', filename: `preview_fox_0000${n}_.png` }));
        return [prompt, stepOf('p3', 'add_lora', 'canvas', now - 16, { summary: 'add_lora: anime_style_v2.safetensors (0.75)', results: [{ type: 'canvas' }] }),
            run({ ms: 9000, results: pictures })];
    }
    case 'error': return [prompt, run({ ok: false, state: 'error', error: words.failure })];
    case 'chat_only_quiet': return [{ ...prompt, at: now - 1, state: 'running', ms: 0, results: [] }];
    default: return [];
    }
}

/**
 * A fresh task for the rehearsal `scenarioId` (REVIEW_SCENARIOS), with an id of its own (preview_…) the
 * server never knew, words in `locale`, times around `now` (seconds), a run at `percent`.
 */
export function buildPreviewTask(scenarioId, { locale = 'zh', now = Date.now() / 1000, percent = 60 } = {}) {
    const words = wordsIn(locale);
    const ended = scenarioId === 'done' || scenarioId === 'error';
    return {
        id: `preview_${scenarioId}`, _preview: true, format: 1, title: words.titles[scenarioId] || scenarioId, title_from: 'ai',
        client: 'Preview AI', started: now - 60, updated: now, ended: ended ? now : null, waiting: false,
        ...(scenarioId.startsWith('chat_only') ? { chat_only: true } : {}),
        steps: [stepOf('p1', 'describe_canvas', 'look', now - 40), ...stepsFor(scenarioId, words, now, percent)],
    };
}

/**
 * What a press on the card (or the console) does to the rehearsed `task`, as the server would have it:
 * { task, receiptKey, receiptParams }, `task` a new object, `receiptKey` the locale key of the console's
 * line saying what was pressed (null: nothing to say). `action.type`: allow, deny, answer ({step, block,
 * choice, text}), skip, pause, stop, say ({text}), progress ({percent}), inject_gate, open_workbench.
 */
export function applyPreviewAction(task, action, { locale = 'zh', now = Date.now() / 1000 } = {}) {
    const next = structuredClone(task);
    const steps = next.steps;
    const fresh = () => `p${Math.max(0, ...steps.map(step => Number(String(step.id).slice(1)) || 0)) + 1}`; // never one in use
    const said = (receiptKey, receiptParams = {}) => ({ task: next, receiptKey, receiptParams });
    next.updated = now;
    switch (action?.type) {
    case 'allow':
    case 'deny': {
        const gate = gateOf(next);
        if (!gate) return said(null);
        const allowed = action.type === 'allow';
        Object.assign(gate, { state: allowed ? 'done' : 'error', ok: allowed, at: now, gate: { ...gate.gate, decision: action.type } },
            allowed ? {} : { error: wordsIn(locale).denied });
        return said(`reviewDid_${action.type}`);
    }
    case 'answer':
    case 'skip': {
        const step = steps.find(item => item.id === action.step);
        const block = step?.panel?.blocks?.find(item => item.id === action.block);
        if (!block) return said(null);
        step.answers = { ...step.answers, [block.id]: action.type === 'skip' ? { skipped: true, at: now } : { choice: action.choice, text: action.text, at: now } };
        if (action.type === 'skip') return said('reviewDid_skip');
        const picked = (block.options || []).find(option => option.id === action.choice?.[0]);
        return picked ? said('reviewDid_choice', { choice: picked.label }) : said('reviewDid_text', { text: action.text || '' });
    }
    case 'pause':
        steps.push(stepOf(fresh(), 'user_halt', 'user', now, { pause: true, delivered: false }));
        return said('reviewDid_pause');
    case 'stop': {
        const run = steps.findLast(step => step.tool === 'run_workflow' && step.state === 'running');
        if (!run) return said(null);
        Object.assign(run, { stop: 'user', progress: { ...run.progress, stopping: true } });
        return said('reviewDid_stop');
    }
    case 'say':
        steps.push(stepOf(fresh(), 'user_message', 'user', now, { text: action.text, summary: 'user_message' }));
        return said('reviewDid_say', { text: action.text });
    case 'progress': {
        const run = steps.findLast(step => step.tool === 'run_workflow' && step.state === 'running');
        if (run) run.progress = progressOf(Math.min(100, Math.max(0, Number(action.percent) || 0)));
        return said(null);
    }
    case 'inject_gate': // a new step waiting for an OK: it lifts the user's × (ai_float_state.js liftDismissal)
        next.ended = null;
        steps.push(gateStep(fresh(), now));
        return said('reviewDid_gate');
    case 'open_workbench':
        return said('reviewDid_open');
    default:
        return said(null);
    }
}

/** The rail pins of a user: 'fresh' (core only), 'upgraded' (what an earlier version's user used), 'full' (every entry). */
export function railPreset(mode) {
    const extra = mode === 'full' ? OPTIONAL_RAIL_ENTRIES : mode === 'upgraded' ? UPGRADED_PINS : [];
    return {
        version: 1, pinned: [...CORE_RAIL_ENTRIES, ...OPTIONAL_RAIL_ENTRIES.filter(id => extra.includes(id))],
        seeded: mode === 'upgraded' ? 'upgraded' : 'fresh', hintsApplied: true, customized: mode === 'full', ttsAutoPinned: false,
    };
}
