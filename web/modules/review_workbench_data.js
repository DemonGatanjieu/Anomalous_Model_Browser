/** Demo tasks and the workbench API they exercise, kept entirely in memory. */
import { KINDS, openAsks, QUESTIONS } from './ai_task_view.js';
import { haltOf } from './ai_task_status.js';
import { unresolvedFailures } from './ai_float_state.js';

export const WORKBENCH_SCENES = ['thinking', 'run', 'stage', 'gate', 'waiting', 'welcome'].map(id => ({
    id, labelKey: `reviewWbScene_${id}`,
}));
export const workbenchTaskIdForScene = scene => scene === 'welcome' ? null : `preview_wb_${scene}`;
const validScene = scene => WORKBENCH_SCENES.some(item => item.id === scene) ? scene : 'thinking';
const seconds = () => Date.now() / 1000;
const localized = locale => (zh, en) => locale === 'zh' ? zh : en;
const ASK_KINDS = [...QUESTIONS, 'plan'];
const ISSUES = ['hands', 'face', 'body', 'composition', 'dark', 'bright', 'blurry', 'style', 'subject', 'extra'];
const TASKS = '/anomalous/ai_tasks';

function illustration(filename, sky, glow, snow) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 416">
      <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${snow}"/></linearGradient>
      <linearGradient id="ice" x2="0" y2="1"><stop stop-color="${snow}"/><stop offset="1" stop-color="#e0f2f1"/></linearGradient></defs>
      <path fill="url(#sky)" d="M0 0h640v416H0z"/>
      <circle cx="447" cy="116" r="67" fill="${glow}" opacity=".75"/>
      <path fill="${snow}" d="m0 252 95-115 67 79 107-88 89 91 73-66 107 87 102-87v263H0z"/>
      <path fill="url(#ice)" d="M0 276q153-41 293 2t347-9v147H0z"/>
      <path fill="${sky}" opacity=".7" d="m70 293 40-108 39 108zm460-4 38-111 40 111zM25 300l28-82 29 82zm570 4 27-79 26 79z"/>
      <ellipse cx="323" cy="362" rx="109" ry="13" fill="${sky}" opacity=".22"/>
      <path fill="#c25e49" d="M303 331q64-50 126-26-37 57-118 54l-38-11z"/>
      <path fill="#fff2e7" d="M397 304q23-2 32 1-10 21-32 31l-9-12z"/>
      <path fill="#d77a54" d="M259 351q6-67 67-63 32 16 12 65-33 16-79-2zM250 311l-3-54 35 25 21-33 19 44-27 30z"/>
      <path fill="#fff2e7" d="m242 305 34-10 31 11-25 21q-23-2-40-22z"/>
      <path stroke="#443849" stroke-width="4" fill="none" stroke-linecap="round" d="m249 306 5 1m29-6 5 1"/>
      <path fill="#fff" opacity=".75" d="M61 84h5v5h-5zm142 28h5v5h-5zm116-51h4v4h-4zm231 42h5v5h-5zm38 31h4v4h-4z"/>
    </svg>`;
    return { type: 'image', folder: 'preview', subfolder: '', filename, preview_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}

const PICTURES = [
    illustration('fox_pass_01.png', '#28386e', '#8ddbd7', '#86b6c2'),
    illustration('fox_pass_02.png', '#51417c', '#f8ad9a', '#ae9dbd'),
];

function step(id, kind, tool, at, extra = {}) {
    return { id, kind, tool, at, state: 'done', ok: true, ms: 0, summary: tool, results: [], ...extra };
}

const userMessage = (id, at, text, extra) => step(id, 'user', 'user_message', at, { text, delivered: true, ...extra });

function makeTask(name, title, started, updated, extra) {
    return { id: workbenchTaskIdForScene(name), _preview: true, format: 1, title, title_from: 'ai', client: 'Claude Desktop',
        started, updated, ended: null, waiting: false, private: false, canvas_mode: 'new', steps: [], ...extra };
}

function planBlocks(w) {
    const model = (block, zh, en, id, name, alternative, altName) => ({
        block, title: { zh, en }, model: id, model_name: name, choices: [{ model_id: alternative, name: altName }],
    });
    return {
        plan: { id: 'blueprint', type: 'plan', steps: [
            model('base', '建立构图', 'Build the composition', 'preview_nova', 'Nova Anime XL v18', 'preview_mica', 'Mica Anime XL v4'),
            model('detail', '细化狐狸与雪地', 'Refine the fox and snow', 'preview_detail', 'Winter Detail XL', 'preview_soft', 'Soft Detail XL'),
            { block: 'upscale', title: { zh: '放大并保留轮廓', en: 'Upscale and preserve the silhouette' } },
        ] },
        choice: { id: 'palette', type: 'choices', question: w('这张图用哪组配色？', 'Which palette should this image use?'),
            other: true, multiple: false, options: [
                { id: 'teal', label: w('蓝绿极光', 'Teal aurora'), detail: w('冷色雪地衬出狐狸的暖色。', 'Cool snow sets off the warm fox.'), recommended: true },
                { id: 'coral', label: w('珊瑚暮色', 'Coral dusk'), detail: w('低饱和暖光，保留雪地层次。', 'Muted warmth keeps the snow layered.') },
                { id: 'indigo', label: w('靛蓝夜景', 'Indigo night'), detail: w('用剪影和月光突出轮廓。', 'Silhouettes and moonlight define the shape.') },
            ] },
    };
}

function demoTasks(locale, now) {
    const w = localized(locale);
    const task = (name, zh, en, started, updated, extra) => makeTask(name, w(zh, en), now - started, now - updated, extra);
    const at = (id, kind, tool, age, extra) => step(id, kind, tool, now - age, extra);
    const thinking = task('thinking', '雪夜狐狸 · 主构图', 'Snow fox · Main composition', 420, 2, {
        private: true, privacy_models: true, reads_disk: true,
        steps: [
            userMessage('brief', now - 420, w('画一只坐在雪地里的狐狸，月光从右后方照过来。', 'Draw a fox sitting in the snow, with moonlight from behind on the right.')),
            at('canvas', 'look', 'describe_canvas', 400),
            at('model', 'canvas', 'set_model', 370),
            at('detail', 'canvas', 'add_lora', 340),
            at('prompt', 'canvas', 'set_prompt', 300),
            // Prose ends the work chain so this decision also has its own card in the timeline.
            at('note', 'note', 'report', 30, { text: w(
                '我先锁定了狐狸的轮廓和月光方向。\n\n第一遍只看构图。等前景和远山分开，再补毛发和雪的细节。',
                'I set the fox silhouette and the direction of the moonlight.\n\nThe first pass is for composition. Once the foreground and distant hills read separately, I can refine the fur and snow.') }),
            at('decision', 'decision', 'log_decision', 3, { decision: {
                title: w('先定轮廓', 'Set the silhouette first'), by: 'together',
                decision: w('采用低机位和冷暖对比。', 'Use a low viewpoint and contrast cool snow with the warm fox.'),
                reason: w('低机位可以把狐狸和远山分开。', 'The low viewpoint keeps the fox distinct from the hills.'),
                rejected: [w('先放大再改构图', 'Upscale before adjusting composition')], related: ['prompt'],
            } }),
        ],
    });
    const run = task('run', '雪夜狐狸 · 第一遍', 'Snow fox · First pass', 150, 8, {
        cover: PICTURES[0], steps: [
            at('run-prompt', 'canvas', 'set_prompt', 135, { stage: 'prompt' }),
            at('run', 'run', 'run_workflow', 75, { state: 'running', stage: 'picture', prompt_ids: ['preview-wb-run-1'] }),
        ],
    });
    const { plan, choice } = planBlocks(w);
    const panel = (id, title, block) => ({ id, title, blocks: [block] });
    const stage = task('stage', '雪夜狐狸 · 选方案', 'Snow fox · Choose a plan', 195, 14, {
        client: 'Cursor AI', steps: [
            at('plan', 'panel', 'show_panel', 24, { panel: panel('blueprint-panel', w('三步蓝图', 'Three-step blueprint'), plan) }),
            at('ask', 'panel', 'ask_user', 15, { panel: panel('palette-panel', w('选一组配色', 'Choose a palette'), choice) }),
        ],
    });
    const gate = task('gate', '雪夜狐狸 · 下载确认', 'Snow fox · Confirm a download', 220, 20, {
        steps: [
            at('gate-prompt', 'canvas', 'set_prompt', 44),
            at('download', 'download', 'download_missing_models', 21, { state: 'asking', gate: {
                gate: 'download', lines: [{ label: 'name', value: 'illustrious_detail_v2.safetensors' }, { label: 'folder', value: 'loras' }],
            } }),
        ],
    });
    const done = task('done', '雪夜狐狸 · 成图对照', 'Snow fox · Finished variations', 4200, 3500, {
        from: thinking.id, ended: now - 3500,
        steps: [at('finished', 'run', 'run_workflow', 3600, { state: 'done', stage: 'picture', verdict: null, results: PICTURES })],
    });
    const waiting = task('waiting', '试一张雪夜插画', 'Try a snowy night illustration', 100, 90, {
        waiting: true, client: '',
        about: [{ type: 'model', label: 'Nova Anime XL v18' }, { type: 'canvas', tab: 'winter_fox_draft.json' }],
        steps: [userMessage('ready', now - 90, w('先帮我检查画布，再出一张小图。', 'Check the canvas first, then render a small image.'))],
    });
    const yesterday = new Date(now * 1000);
    yesterday.setDate(yesterday.getDate() - 1);
    const failedAt = yesterday.setHours(12, 0, 0, 0) / 1000;
    const error = makeTask('error', w('练习 · 缺少模型', 'Practice · Missing model'), failedAt - 300, failedAt, {
        ended: failedAt, steps: [step('failed', 'run', 'run_workflow', failedAt, {
            ok: false, state: 'error', stage: 'picture', error: w('找不到练习用的模型。', 'The practice model could not be found.'),
        })],
    });
    return new Map([thinking, run, stage, gate, done, waiting, error].map(item => [item.id, item]));
}

export function createWorkbenchStore({ locale = 'zh', scene = 'thinking', percent = 60, now = seconds() } = {}) {
    const store = { locale, scene: validScene(scene), createdAt: now, tasks: new Map(), sequence: 0, planAuto: false };
    if (store.scene !== 'welcome') store.tasks = demoTasks(locale, now);
    setWorkbenchRunPercent(store, percent, { now });
    return store;
}

export function setWorkbenchScene(store, scene, { now = seconds() } = {}) {
    const next = validScene(scene);
    if (next === 'welcome' || store.scene === 'welcome') {
        store.tasks = next === 'welcome' ? new Map() : demoTasks(store.locale, now);
        setWorkbenchRunPercent(store, store.percent, { now });
    }
    store.scene = next;
}

export function setWorkbenchRunPercent(store, percent, { now = seconds() } = {}) {
    store.percent = Math.max(0, Math.min(100, Number(percent) || 0));
    const task = store.tasks.get('preview_wb_run');
    const run = task?.steps.find(item => item.id === 'run' && item.state === 'running');
    if (run) {
        run.progress = { state: 'running', node: 'KSampler', value: Math.round(store.percent / 5), max: 20, percent: store.percent };
        task.updated = Math.max(task.updated, now - 8);
    }
}

export function setWorkbenchLocale(store, locale, { now = seconds() } = {}) {
    if (store.locale === locale) return;
    store.locale = locale;
    for (const [id, seed] of demoTasks(locale, now)) {
        const task = store.tasks.get(id);
        if (!task) continue;
        if (task.title_from === 'ai') task.title = seed.title;
        for (const original of seed.steps) {
            const current = task.steps.find(item => item.id === original.id);
            if (!current) continue;
            for (const key of ['text', 'decision', 'error']) {
                if (key in original) current[key] = original[key];
            }
            if (original.panel) current.panel = { ...current.panel, ...original.panel };
        }
    }
}

function heartbeat(task, now) {
    if (task.ended || haltOf(task)) return;
    const timing = {
        preview_wb_thinking: ['decision', 2, 'done'], preview_wb_run: ['run', 8, 'running'],
        preview_wb_stage: ['ask', 14, 'done'], preview_wb_gate: ['download', 20, 'asking'],
    }[task.id];
    if (!timing) return;
    const [id, age, state] = timing;
    const last = task.steps.find(item => item.id === id && item.state === state);
    if (!last) return;
    last.at = Math.max(last.at, now - age - 1);
    task.updated = Math.max(task.updated, now - age);
}

export function summarizeTask(task, now = seconds()) {
    const { id, title, title_from, client, started, updated, ended, from = null, private: secret, steps } = task;
    const runImages = new Set();
    const pictures = [];
    const kinds = {};
    for (const item of steps) {
        kinds[item.kind] = (kinds[item.kind] || 0) + 1;
        for (const image of item.results || []) {
            if (image.type !== 'image') continue;
            pictures.push(image);
            if (item.kind === 'run') runImages.add(JSON.stringify([image.folder, image.subfolder, image.filename]));
        }
    }
    const halt = haltOf(task);
    return { id, title, title_from, client: client || (task.waiting ? '' : 'AI'), started, updated, ended,
        waiting: Boolean(task.waiting && !ended), live: steps.some(item => item.state === 'running' && now - item.at < 1800),
        asks: openAsks(task, ASK_KINDS).length + steps.filter(item => item.state === 'asking').length,
        errors: unresolvedFailures(steps), halted: Boolean(halt), paused: Boolean(halt?.pause), steps: steps.length,
        kinds: Object.fromEntries(KINDS.filter(kind => kinds[kind]).map(kind => [kind, kinds[kind]])),
        images: runImages.size, cover: task.cover || pictures.at(-1) || null, from, private: secret, chat_only: false };
}

const link = task => ({ id: task.id, title: task.title, title_from: task.title_from });

function taskDetails(store, task) {
    const parent = store.tasks.get(task.from);
    return { ...task, links: { from: parent ? link(parent) : null,
        next: [...store.tasks.values()].filter(item => item.from === task.id).map(link) },
    decisions: task.steps.filter(item => item.decision).map(item => ({ ...item.decision, type: 'logged', step: item.id, at: item.at })) };
}

const reply = (body, status = 200) => ({ matched: true, status, body: structuredClone(body) });
const unavailable = () => reply({ error: 'rehearsal_only' }, 403);
const invalid = () => reply({ error: 'invalid_rehearsal_action' }, 400);
const missing = () => reply({ error: 'not_found' }, 404);

function addUserStep(store, task, tool, now, extra) {
    const item = step(`user-${++store.sequence}`, 'user', tool, now, { delivered: true, ...extra });
    task.steps.push(item);
    return item;
}

function answerPanel(store, step, body, now) {
    const block = step?.panel?.blocks.find(item => item.id === body.block);
    if (!block || step.panel.closed || step.answers?.[block.id]) return invalid();
    const answer = { at: now, delivered: true };
    if (body.skip === true) answer.skipped = true;
    else if (typeof body.text === 'string' && body.text.trim()) answer.text = body.text.trim();
    else if (Array.isArray(body.choice) && body.choice.length) answer.choice = [...body.choice];
    else return invalid();
    if (block.type === 'plan' && answer.choice?.includes('build')) {
        answer.plan = block.steps.flatMap((item, index) => {
            if (index && body.plan?.drop?.includes?.(index)) return [];
            const picked = item.choices?.find(option => option.model_id === body.plan?.models?.[index]);
            const model = picked?.model_id || item.model;
            return [{ block: item.block, ...(model ? { model } : {}) }];
        });
        answer.auto = body.auto === true;
        if (answer.auto) store.planAuto = true;
    }
    (step.answers ||= {})[block.id] = answer;
    return reply({ answers: step.answers });
}

function decideGate(step, decision, now, w, text) {
    if (step?.state !== 'asking' || !step.gate || !['allow', 'deny'].includes(decision)) return invalid();
    const ok = decision === 'allow';
    Object.assign(step.gate, { decision, at: now, delivered: true, ...(text ? { text } : {}) });
    Object.assign(step, { state: ok ? 'done' : 'error', ok, at: now });
    if (!ok) step.error = w('你没有允许', 'You said no');
    return reply({ step });
}

function stopRun(run, now) {
    Object.assign(run, { state: 'cancelled', stop: 'user', ok: true, ms: (now - run.at) * 1000 });
    delete run.progress;
}

function runAction(store, task, run, action, body, now) {
    if (run?.tool !== 'run_workflow') return invalid();
    if (action === 'stop' && run.state === 'running') {
        stopRun(run, now);
        addUserStep(store, task, 'user_stop', now, { stopped: run.id });
        return reply({ task: task.id, removed: 0, interrupted: 1 });
    }
    if (action !== 'verdict' || run.state !== 'done' || !['good', 'bad', null].includes(body.verdict)) return invalid();
    run.verdict = body.verdict;
    run.issues = run.verdict === 'bad' && Array.isArray(body.issues) ? ISSUES.filter(issue => body.issues.includes(issue)) : [];
    return reply({ verdict: run.verdict });
}

function changeTask(store, task, body, now) {
    if (body.remove === true) {
        store.tasks.delete(task.id);
        for (const item of store.tasks.values()) if (item.from === task.id) delete item.from;
        return reply({ removed: true });
    }
    if (typeof body.privacy === 'boolean') {
        task.private = body.privacy;
        return reply({ privacy: task.private });
    }
    if (['new', 'current'].includes(body.canvas)) {
        task.canvas_mode = body.canvas;
        return reply({ canvas: task.canvas_mode });
    }
    if (typeof body.title === 'string') {
        task.title = body.title.trim().slice(0, 80);
        task.title_from = task.title ? 'user' : 'auto';
        task.updated = now;
        return reply({ task: summarizeTask(task, now) });
    }
    if ('from' in body) {
        const parent = store.tasks.get(body.from);
        for (let item = parent; item; item = store.tasks.get(item.from)) if (item === task) return invalid();
        task.from = parent?.id || null;
        return reply({ from: task.from });
    }
    return invalid();
}

function mutateTask(store, task, parts, body, now) {
    const [action, runId, runCommand] = parts;
    const w = localized(store.locale);
    const step = task.steps.find(item => item.id === body.step);
    switch (action) {
    case undefined: return changeTask(store, task, body, now);
    case 'typing': return reply({ ok: true });
    case 'answer': return answerPanel(store, step, body, now);
    case 'gate': return decideGate(step, body.decision, now, w, body.text);
    case 'message': {
        if (typeof body.text !== 'string' || !body.text.trim()) return invalid();
        const item = addUserStep(store, task, 'user_message', now, { text: body.text.trim(), refs: body.refs });
        task.ended = null;
        return reply({ step: item });
    }
    case 'halt':
    case 'pause': {
        const runs = task.steps.filter(item => item.tool === 'run_workflow' && item.state === 'running');
        for (const run of runs) stopRun(run, now);
        for (const item of task.steps.filter(item => item.state === 'asking')) decideGate(item, 'deny', now, w);
        addUserStep(store, task, 'user_halt', now, { pause: action === 'pause' || body.take_back === false, stopped: runs.length });
        return reply({ task: task.id, stopped: runs.length });
    }
    case 'runs': return runAction(store, task, task.steps.find(item => item.id === runId), runCommand, body, now);
    case 'route':
        task.route = body.route;
        return reply({ route: task.route, models: body.models || [] });
    default: return unavailable();
    }
}

function listOrStart(store, method, query, body, now) {
    if (method === 'GET') {
        const limit = Math.max(1, Math.min(300, Number.parseInt(query.get('limit'), 10) || 100));
        const tasks = [...store.tasks.values()];
        tasks.forEach(task => heartbeat(task, now));
        return reply({ tasks: tasks.sort((a, b) => b.updated - a.updated).slice(0, limit).map(task => summarizeTask(task, now)) });
    }
    if (method !== 'POST') return unavailable();
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
    const task = makeTask(`new_${++store.sequence}`, title, now, now, { client: '', waiting: true,
        title_from: title ? 'user' : 'auto', about: body.about || [], from: store.tasks.has(body.from) ? body.from : null });
    store.tasks.set(task.id, task);
    return reply({ task: summarizeTask(task, now) });
}

function sentCalls(task, w) {
    return task.id === 'preview_wb_thinking' ? [
        { at: task.started + 20, tool: 'describe_canvas', arguments: '{}', text: w('画布上有一个基础采样流程。', 'The canvas contains a basic sampler workflow.'), pictures: 0, error: false },
        { at: task.started + 120, tool: 'set_prompt', arguments: '{"positive":"[P1]"}', text: w('已记录提示词占位符。', 'The prompt placeholder was recorded.'), pictures: 0, error: false },
    ] : [];
}

export const handlesWorkbenchRequest = path => path.startsWith('/anomalous/ai_');

export function answerWorkbenchRequest(store, { method = 'GET', path, query = new URLSearchParams(), body, now = seconds() }) {
    method = method.toUpperCase();
    if (!handlesWorkbenchRequest(path)) return { matched: false };
    body = body && typeof body === 'object' && !Array.isArray(body) ? structuredClone(body) : {};
    if (path === '/anomalous/ai_callers') return method === 'GET'
        ? reply({ last: store.tasks.size ? { client: 'Claude Desktop', at: now - 3 } : null }) : unavailable();
    if (path === '/anomalous/ai_starters' && method === 'GET') return reply({
        workflows: [], download_asks: true, app: null, came: false, models: 0,
    });
    if (path === '/anomalous/ai_plans/auto') {
        if (method === 'POST') store.planAuto = body.auto === true;
        return method === 'GET' || method === 'POST' ? reply({ auto: store.planAuto }) : unavailable();
    }
    if (path === TASKS) return listOrStart(store, method, query, body, now);
    if (!path.startsWith(`${TASKS}/`)) return method === 'GET' ? reply({}) : unavailable();
    const [id, ...parts] = path.slice(TASKS.length + 1).split('/');
    const task = store.tasks.get(id);
    if (!task) return missing();
    if (method === 'GET') {
        heartbeat(task, now);
        if (!parts.length) return reply({ task: taskDetails(store, task) });
        if (parts.join('/') === 'sent') return reply({ calls: sentCalls(task, localized(store.locale)) });
        return missing();
    }
    if (method !== 'POST') return unavailable();
    const result = mutateTask(store, task, parts, body, now);
    if (result.status === 200 && parts[0] !== 'typing') task.updated = now;
    return result;
}
