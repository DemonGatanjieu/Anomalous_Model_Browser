// The voice-over drafts box without storage (web/modules/script_drafts.js): what a kept script
// may hold, the box's moves, two tabs' boxes joined, and the titles and times on its cards.
import assert from 'node:assert/strict';
import {
    cleanBox, cleanScript, copyDraft, deleteDraft, deletedDrafts, draftSpeakers, draftTitle, dropOldDeleted, emptyBox,
    hasLines, keepScript, liveDrafts, makeDraft, mergeBoxes, putDraft, renameDraft, restoreDraft, whenKey,
} from '../web/modules/script_drafts.js';

const DAY = 24 * 60 * 60 * 1000;
const script = (...texts) => ({ format: 1, lines: texts.map(text => ({ text, emotion: 'main', speaker: 'gpt_sovits:Aris' })), groupKey: 'gpt_sovits:Aris', script: {}, cast: {} });

// A kept script: blank lines and bad settings go, the right ones stay in a fixed order.
const cleaned = cleanScript({
    format: 1,
    groupKey: 'gpt_sovits:Aris',
    lines: [{ text: '  ' }, { text: 'a', tune: { speed: 1.2, language: 'ja', odd: 1 } }, { text: 'b', speaker: 3 }, null],
    script: { speed: 'fast', preset: 'stable' },
    cast: { 'gpt_sovits:Aris': { language: 'ja' }, 'gpt_sovits:Momoi': { speed: '1' } },
});
assert.deepEqual(cleaned, {
    format: 1,
    lines: [{ text: 'a', emotion: 'main', speaker: null, tune: { language: 'ja', speed: 1.2 } }, { text: 'b', emotion: 'main', speaker: null }],
    groupKey: 'gpt_sovits:Aris',
    script: { preset: 'stable' },
    cast: { 'gpt_sovits:Aris': { language: 'ja' } },
});
assert.equal(cleanScript({ format: 2, lines: [] }), null);
assert.equal(hasLines(cleanScript({ format: 1, lines: [{ text: ' ' }] })), false);
assert.deepEqual(cleanBox(null), emptyBox());
assert.deepEqual(cleanBox({ format: 1, current: 'x', drafts: [{ id: 'x', script: { format: 9 } }, { id: '', script: script('a') }] }), emptyBox());

// The box: new, renamed, copied, deleted, brought back; the last changed first.
const box = emptyBox();
const first = putDraft(box, makeDraft(script('おはよう、先生！今日もいい天気ですね'), 1000, { id: 'a' }));
const second = putDraft(box, makeDraft(script('b'), 2000, { id: 'b' }));
box.current = 'a';
assert.deepEqual(liveDrafts(box).map(draft => draft.id), ['b', 'a']);
keepScript(box, 'a', script('c'), 3000);
assert.deepEqual(liveDrafts(box).map(draft => draft.id), ['a', 'b']);
assert.equal(draftTitle(first), 'c');
renameDraft(box, 'a', '  第 3 集开场  ', 3500);
assert.equal(draftTitle(first), '第 3 集开场');
assert.equal(draftTitle(makeDraft(script('おはよう、先生！今日もいい天気ですね。'))), 'おはよう、先生！今日もいい天気ですね…');
assert.equal(draftTitle(makeDraft(script())), '');
const copy = copyDraft(box, 'a', '第 3 集开场（副本）', 4000);
assert.equal(copy.name, '第 3 集开场（副本）');
copy.script.lines[0].text = 'changed';
assert.equal(first.script.lines[0].text, 'c', 'a copy is its own');
deleteDraft(box, 'a', 5000);
assert.equal(box.current, null, 'the open draft is let go when deleted');
assert.deepEqual(deletedDrafts(box).map(draft => draft.id), ['a']);
assert.equal(liveDrafts(box).some(draft => draft.id === 'a'), false);
restoreDraft(box, 'a', 6000);
assert.equal(first.deleted, null);
deleteDraft(box, 'b', 7000);
assert.equal(dropOldDeleted(box, 7000 + 29 * DAY), false);
assert.equal(dropOldDeleted(box, 7000 + 30 * DAY), true);
assert.equal(box.drafts.some(draft => draft.id === 'b'), false);
assert.equal(second.deleted, 7000);

// Who reads, in the order they first speak (a line without a speaker is the cast's pick).
assert.deepEqual(draftSpeakers({ groupKey: 'k:A', lines: [{ text: 'x', speaker: 'k:B' }, { text: 'y', speaker: null }, { text: 'z', speaker: 'k:B' }] }), ['k:B', 'k:A']);

// Two tabs: each draft as it was changed last; the draft open here stays this tab's.
const mine = { format: 1, current: 'm', drafts: [
    makeDraft(script('mine'), 100, { id: 'm' }),
    makeDraft(script('old here'), 100, { id: 's' }),
] };
const theirs = { format: 1, current: 'o', drafts: [
    makeDraft(script('newer there'), 200, { id: 'm' }),
    makeDraft(script('newer there'), 200, { id: 's' }),
    makeDraft(script('only there'), 150, { id: 'o' }),
] };
const joined = mergeBoxes(mine, theirs);
const text = id => joined.drafts.find(draft => draft.id === id).script.lines[0].text;
assert.equal(joined.current, 'm');
assert.equal(text('m'), 'mine');
assert.equal(text('s'), 'newer there');
assert.equal(text('o'), 'only there');
const gone = { format: 1, current: null, drafts: [{ ...makeDraft(script('x'), 100, { id: 's' }), deleted: 300, updated: 300 }] };
assert.equal(mergeBoxes(gone, theirs).drafts.find(draft => draft.id === 's').deleted, 300, 'a deletion is a change');

// When: just now, minutes, today, yesterday, a date (with the year when it is another one).
const now = new Date(2026, 9, 20, 15, 30).getTime();
assert.deepEqual(whenKey(now - 20 * 1000, now), { key: 'draftsJustNow' });
assert.deepEqual(whenKey(now - 5 * 60000, now), { key: 'draftsMinutesAgo', values: { count: 5 } });
assert.deepEqual(whenKey(new Date(2026, 9, 20, 9, 5).getTime(), now), { key: 'draftsTodayAt', values: { time: '09:05' } });
assert.deepEqual(whenKey(new Date(2026, 9, 19, 23, 0).getTime(), now), { key: 'draftsYesterdayAt', values: { time: '23:00' } });
assert.deepEqual(whenKey(new Date(2026, 9, 18, 8, 0).getTime(), now), { key: 'draftsDate', values: { month: 10, day: 18, year: 2026 } });
assert.equal(whenKey(new Date(2025, 11, 31).getTime(), now).key, 'draftsDateYear');

console.log('script drafts: ok');
