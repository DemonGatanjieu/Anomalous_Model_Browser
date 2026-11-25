import assert from 'node:assert/strict';
import { i18n } from '../web/modules/locales.js';
import { clearTaskCache, keptTask, readTask } from '../web/modules/ai_task_cache.js';
import { unseenReply } from '../web/modules/ai_call_lines.js';
import { floatState } from '../web/modules/ai_float_state.js';
import { taskStatus } from '../web/modules/ai_task_status.js';
import {
    groupSteps, openAsks, outputPicture, outputUrl, picturePreview, pictureShown, planFlow, QUESTIONS, taskFamilies, taskOutputs,
} from '../web/modules/ai_task_view.js';
import { answerRequest, createSandbox } from '../web/modules/review_sandbox_data.js';
import { hasReviewFetch, jsonResponse, ownAnomalousUrl, registerReviewFetch, unregisterReviewFetch } from '../web/modules/review_fetch.js';
import {
    answerWorkbenchRequest, createWorkbenchStore, setWorkbenchLocale, setWorkbenchRunPercent,
    setWorkbenchScene, workbenchTaskIdForScene, WORKBENCH_SCENES,
} from '../web/modules/review_workbench_data.js';

const NOW = 1_800_000_000;
const api = '/anomalous/ai_tasks';
const urlFor = path => new URL(path, 'http://amb.test');
const request = (store, path, { method = 'GET', body, now = NOW } = {}) => {
    const url = urlFor(path);
    return answerWorkbenchRequest(store, { method, path: url.pathname, query: url.searchParams, body, now });
};
function ok(store, path, options) {
    const answer = request(store, path, options);
    assert.equal(answer.matched, true, path);
    assert.equal(answer.status, 200, JSON.stringify(answer));
    return answer.body;
}
const idFor = workbenchTaskIdForScene;
const read = (store, scene, now = NOW) => ok(store, `${api}/${idFor(scene)}`, { now }).task;
const post = (store, path, body, now) => ok(store, path, { method: 'POST', body, now });
const act = (store, scene, action, body, now) => post(store, `${api}/${idFor(scene)}${action && `/${action}`}`, body, now);
const fresh = options => createWorkbenchStore({ now: NOW, ...options });
const presets = WORKBENCH_SCENES.map(scene => scene.id);
assert.deepEqual(presets, ['thinking', 'run', 'stage', 'gate', 'waiting', 'welcome']);
for (const locale of ['zh', 'en']) {
    for (const key of ['reviewWbTitle', 'reviewWbReset', 'reviewWbNoteIdle', 'reviewWbNoteActive', ...WORKBENCH_SCENES.map(scene => scene.labelKey)]) {
        assert.ok(i18n[locale][key], `${locale} has ${key}`);
    }
    for (const scene of presets) {
        const store = fresh({ scene, locale });
        const { tasks } = ok(store, api);
        assert.equal(tasks.length, scene === 'welcome' ? 0 : 7);
        if (scene === 'welcome') assert.equal(idFor(scene), null);
        else assert.equal(read(store, scene)._preview, true);
    }
}

const store = fresh();
const thinking = read(store, 'thinking', NOW + 600);
assert.equal(thinking.steps[0].tool, 'user_message');
assert.equal(thinking.steps[0].delivered, true);
assert.equal(unseenReply(thinking), false);
assert.ok(taskStatus(thinking, NOW + 600).age < 120);
assert.equal(floatState(thinking, NOW + 600).kind, 'thinking');
assert.equal(groupSteps(thinking.steps).find(item => item.type === 'chain').steps.length, 4);
assert.ok(groupSteps(thinking.steps).some(item => item.step?.kind === 'decision'));
assert.equal(thinking.decisions[0].step, 'decision');
assert.equal(thinking.links.next[0].id, idFor('done'));
const { calls } = ok(store, `${api}/${thinking.id}/sent`);
assert.equal(calls.length, 2);
assert.equal(JSON.parse(calls[1].arguments).positive, '[P1]');
assert.equal(ok(store, '/anomalous/ai_callers').last.client, 'Claude Desktop');
assert.deepEqual(ok(store, '/anomalous/ai_starters').workflows, []);
assert.ok(ok(store, api, { now: NOW + 900 }).tasks.find(task => task.id === thinking.id).updated >= NOW + 898);

const run = read(store, 'run', NOW + 1000);
assert.equal(run.cover.folder, 'preview');
assert.match(run.cover.preview_url, /^data:image\/svg\+xml/);
assert.equal(ok(store, api, { now: NOW + 1000 }).tasks.find(task => task.id === run.id).live, true);
for (const [value, expected] of [[-5, 0], [81, 81], [110, 100], [0, 0], [60, 60]]) {
    setWorkbenchRunPercent(store, value, { now: NOW + 1000 });
    assert.equal(read(store, 'run').steps[1].state, 'running');
    assert.equal(read(store, 'run').steps[1].progress.percent, expected);
}

const stage = read(store, 'stage');
const [plan, choices] = stage.steps.map(item => item.panel.blocks[0]);
assert.equal(plan.type, 'plan');
assert.equal(plan.steps.length, 3);
assert.equal(choices.type, 'choices');
assert.equal(choices.options.filter(option => option.recommended).length, 1);
assert.equal(openAsks(stage, [...QUESTIONS, 'plan']).length, 2);
assert.equal(ok(store, api).tasks.find(task => task.id === stage.id).asks, 2);
assert.equal(planFlow(stage).state, 'waiting');
assert.equal(act(store, 'stage', 'answer', { step: 'ask', block: 'palette', choice: ['teal'] }).answers.palette.delivered, true);
assert.equal(unseenReply(read(store, 'stage')), false);
assert.equal(openAsks(read(store, 'stage')).length, 0, 'only panel questions drive the inline asking strip');
assert.equal(act(store, 'stage', 'answer', { step: 'plan', block: 'blueprint', choice: ['build'],
    plan: { drop: [1], models: { 0: 'preview_mica' } }, auto: true }).answers.blueprint.delivered, true);
const built = planFlow(read(store, 'stage'));
assert.equal(built.state, 'built');
assert.equal(built.items[0].model, 'Mica Anime XL v4');
assert.equal(built.items.length, 3, 'two kept steps and the base pick');
assert.equal(ok(store, '/anomalous/ai_plans/auto').auto, true);
assert.equal(post(store, '/anomalous/ai_plans/auto', { auto: false }).auto, false);
const change = fresh();
act(change, 'stage', 'answer', { step: 'plan', block: 'blueprint', text: 'Keep the contour softer.' });
assert.equal(planFlow(read(change, 'stage')).state, 'change');

const done = read(store, 'done');
const yesterday = new Date(NOW * 1000);
yesterday.setDate(yesterday.getDate() - 1);
assert.equal(new Date(read(store, 'error').updated * 1000).toDateString(), yesterday.toDateString());
const family = taskFamilies(ok(store, api).tasks);
assert.ok(family.some(item => item.task.id === thinking.id && item.size === 2));
assert.ok(family.some(item => item.task.id === done.id && item.child && item.task.from === thinking.id));
const pictures = taskOutputs(done).runs[0].pictures;
assert.equal(pictures.length, 2);
for (const picture of pictures) {
    assert.equal(picture.folder, 'preview');
    assert.equal(outputPicture(picture), null);
    assert.match(picturePreview(picture), /^data:image\/svg\+xml/);
    assert.equal(outputUrl(picture), picturePreview(picture));
    assert.equal(pictureShown(picture), picturePreview(picture));
}
for (const verdict of ['bad', 'good', null]) {
    assert.equal(act(store, 'done', 'runs/finished/verdict', { verdict, issues: ['hands', 'dark', 'unknown'] }).verdict, verdict);
    assert.deepEqual(read(store, 'done').steps[0].issues, verdict === 'bad' ? ['hands', 'dark'] : []);
}

for (const decision of ['allow', 'deny']) {
    const demo = fresh();
    assert.equal(act(demo, 'gate', 'gate', { step: 'download', decision }).step.gate.decision, decision);
    assert.equal(read(demo, 'gate').steps[1].state, decision === 'allow' ? 'done' : 'error');
}
for (const [action, body, paused] of [['pause', {}, true], ['halt', { take_back: false }, true], ['halt', {}, false]]) {
    const demo = fresh();
    act(demo, 'run', action, body);
    assert.equal(read(demo, 'run').steps.at(-1).pause, paused);
    assert.equal(read(demo, 'run').steps[1].state, 'cancelled');
}
act(store, 'run', 'runs/run/stop');
assert.equal(read(store, 'run').steps[1].state, 'cancelled');
assert.equal(act(store, 'thinking', 'message', { text: 'One more variation.' }).step.delivered, true);
assert.equal(read(store, 'thinking').steps.at(-1).text, 'One more variation.');
assert.equal(act(store, 'thinking', '', { privacy: false }).privacy, false);
assert.equal(act(store, 'thinking', '', { title: 'My review' }).task.title, 'My review');
assert.equal(act(store, 'waiting', '', { remove: true }).removed, true);
assert.equal(request(store, `${api}/${idFor('waiting')}`).status, 404);
const newTask = post(store, api, { title: 'New waiting task', from: done.id }).task;
const newRecord = ok(store, `${api}/${newTask.id}`).task;
assert.ok(newRecord.waiting && newRecord._preview && newRecord.links.from.id === done.id);

setWorkbenchLocale(store, 'en', { now: NOW });
assert.equal(read(store, 'thinking').title, 'My review');
assert.equal(read(store, 'thinking').steps.at(-1).text, 'One more variation.');
assert.equal(read(store, 'stage').steps[1].panel.blocks[0].options[0].label, 'Teal aurora');
assert.equal(read(store, 'stage').steps[1].answers.palette.choice[0], 'teal');
assert.equal(read(store, 'done').title, 'Snow fox · Finished variations');
assert.equal(newRecord.title, ok(store, `${api}/${newTask.id}`).task.title);
for (const method of ['PUT', 'DELETE']) assert.equal(request(store, `${api}/${done.id}`, { method }).status, 403);
assert.equal(request(store, '/anomalous/ai_pictures/upload', { method: 'POST' }).status, 403);
assert.deepEqual(request(store, '/anomalous/models'), { matched: false });
assert.equal(read(fresh(), 'thinking').private, true, 'a new store has none of the edits');
setWorkbenchScene(store, 'welcome', { now: NOW });
assert.deepEqual(ok(store, api).tasks, []);
assert.equal(post(store, api, { title: 'From welcome' }).task.waiting, true);
setWorkbenchScene(store, 'run', { now: NOW });
assert.equal(ok(store, api).tasks.length, 7);

// Use the real registry and both data handlers, with the real network replaced at its boundary.
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
let network = 0;
const baseFetch = function (input) {
    assert.equal(this, window);
    network++;
    return jsonResponse({ input: String(input) });
};
try {
    globalThis.window = globalThis;
    window.location = urlFor('/');
    window.fetch = baseFetch;
    const turns = [];
    const demo = fresh();
    const sandbox = createSandbox();
    const sandboxHandler = (input) => {
        turns.push('sandbox');
        const url = ownAnomalousUrl(input);
        if (!url) return null;
        const answer = answerRequest(sandbox, { method: 'GET', path: url.pathname, now: NOW });
        return answer.pass ? null : jsonResponse(answer.body, answer.status);
    };
    const workbenchHandler = (input) => {
        turns.push('workbench');
        const url = ownAnomalousUrl(input);
        const answer = url && request(demo, url.href);
        return answer?.matched ? jsonResponse(answer.body, answer.status) : null;
    };
    for (const first of ['sandbox', 'workbench']) {
        const second = first === 'sandbox' ? 'workbench' : 'sandbox';
        const add = name => registerReviewFetch(name, name === 'sandbox' ? 20 : 10, name === 'sandbox' ? sandboxHandler : workbenchHandler);
        add(first);
        const wrapper = window.fetch;
        add(second);
        assert.equal(window.fetch, wrapper);
        turns.length = 0;
        const response = await fetch(new Request(urlFor(api)));
        assert.equal((await response.json()).tasks.length, 7);
        assert.deepEqual(turns, ['workbench']);
        turns.length = 0;
        assert.deepEqual(await (await fetch('https://elsewhere.test/anomalous/ai_tasks')).json(), { input: 'https://elsewhere.test/anomalous/ai_tasks' });
        assert.deepEqual(turns, ['workbench', 'sandbox']);
        unregisterReviewFetch(first);
        assert.equal(hasReviewFetch(first), false);
        assert.equal(hasReviewFetch(second), true);
        assert.equal(window.fetch, wrapper, 'non-LIFO exit keeps the remaining handler');
        assert.equal((await (await fetch(api)).json()).tasks.length, second === 'workbench' ? 7 : 0);
        unregisterReviewFetch(second);
        assert.equal(window.fetch, baseFetch);
    }
    assert.equal(network, 2);

    const pending = [];
    window.fetch = () => new Promise(resolve => pending.push(resolve));
    const stale = readTask('same');
    clearTaskCache();
    const current = readTask('same');
    pending[0](jsonResponse({ task: { title: 'stale' } }));
    await stale;
    assert.equal(keptTask('same'), null);
    assert.equal(readTask('same'), current, 'a stale response cannot evict a newer in-flight read');
    pending[1](jsonResponse({ task: { title: 'current' } }));
    await current;
    assert.equal(keptTask('same').title, 'current');
    clearTaskCache();
    assert.equal(keptTask('same'), null);
} finally {
    unregisterReviewFetch('workbench');
    unregisterReviewFetch('sandbox');
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    delete globalThis.location;
}
console.log('review_workbench passed');
