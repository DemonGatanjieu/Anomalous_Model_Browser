// The UI map (tools/ui_map.mjs, tools/ui_map_scan.mjs): addresses as the code writes them, which
// backend route each reaches, and the check of the hand-written part against the screen's words.
import assert from 'node:assert/strict';
import { buildIndex, reaches, routeShape } from '../tools/ui_map_scan.mjs';
import { check } from '../tools/ui_map.mjs';

assert.equal(routeShape('/anomalous/ai_tasks/${encodeURIComponent(task.id)}/marks`'), '/anomalous/ai_tasks/{}/marks');
assert.equal(routeShape('/anomalous/ai_tasks/{task_id}/runs/{step_id}/stop'), '/anomalous/ai_tasks/{}/runs/{}/stop');
assert.equal(routeShape("/anomalous/gallery_images?${params}'"), '/anomalous/gallery_images', 'the query is not part of it');
assert.equal(routeShape('/anomalous/version/releases${force ? `?force=1` : ""}`'), '/anomalous/version/releases{}');
assert.ok(reaches('/anomalous/ai_tasks/{}', '/anomalous/ai_tasks/{}'));
assert.ok(reaches('/anomalous/ai_tasks/{}{}', '/anomalous/ai_tasks/{}/marks'), 'a part put together reaches the routes under it');
assert.ok(!reaches('/anomalous/ai_task', '/anomalous/ai_tasks'));

// The real page's words: a word on screen passes, a made-up one, a file or route that is not there, and a retired name fail.
const ok = await check('「新任务」「连接 AI」「改法：{mode}」「给 AI 留言，比如…」 `ui_ai_marker.js` `/anomalous/ai_tasks/{task_id}/marks`');
assert.deepEqual(ok, []);
const wrong = await check([
    '「这个按钮从来没有过」',
    '`ui_ai_nothing_here.js` `/anomalous/no_such_route`',
    '## 统一叫法',
    '| 说法 | English | 不再用 | 不再用（English） |',
    '| --- | --- | --- | --- |',
    '| 任务 | task | 新任务 | — |',
].join('\n'));
assert.equal(wrong.length, 4, wrong.join('\n'));
assert.match(wrong[0], /这个按钮从来没有过/);
assert.match(wrong[1], /ui_ai_nothing_here\.js/);
assert.match(wrong[2], /no_such_route/);
assert.match(wrong[3], /"新任务" is retired/);

// A retired name with where it is not that name: 配方包 and 搭配方案 are not 配方, {recipe} is no word on screen.
const glossary = (zh, en) => check(['## 统一叫法', '| 说法 | English | 不再用 | 不再用（English） |', '| --- | --- | --- | --- |', `| 工作流 | workflow | ${zh} | ${en} |`].join('\n'));
assert.deepEqual(await glossary('配方（配方包、搭配方案除外）', 'recipe（recipe package 除外）、recipes'), []);
assert.match((await glossary('配方', '—')).join('\n'), /"配方" is retired/, 'without the exceptions 配方包 counts');
assert.match((await glossary('—', 'recipe')).join('\n'), /"recipe" is retired/);

// A word the backend names for the page (an option's label_key) counts as used.
assert.ok((await buildIndex()).serverKeys.has('aiRepaintUseAi'));

console.log('ui map ok');
