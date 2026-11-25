// How a video cover plays in the model details (web/modules/detail_video_prefs.js): on by default, each switch kept apart, the player set up.
import assert from 'node:assert/strict';
import {
    applyDetailVideoPrefs, detailVideoAudio, detailVideoAutoplay, setDetailVideoAudio, setDetailVideoAutoplay,
} from '../web/modules/detail_video_prefs.js';

const memory = () => {
    const items = new Map();
    return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
};

// Never set: both on, as the details always played.
const store = memory();
assert.equal(detailVideoAutoplay(store), true);
assert.equal(detailVideoAudio(store), true);

// Each switch is kept on its own.
setDetailVideoAutoplay(false, store);
assert.equal(store.items.get('anomalous_detail_video_autoplay'), 'false');
assert.equal(detailVideoAutoplay(store), false);
assert.equal(detailVideoAudio(store), true, 'turning autoplay off leaves the sound on');
setDetailVideoAudio(false, store);
assert.equal(store.items.get('anomalous_detail_video_audio'), 'false');
assert.equal(detailVideoAudio(store), false);
setDetailVideoAutoplay(true, store);
assert.equal(store.items.get('anomalous_detail_video_autoplay'), 'true');
assert.equal(detailVideoAutoplay(store), true);
assert.equal(detailVideoAudio(store), false, 'turning autoplay back on leaves the sound off');
setDetailVideoAudio(true, store);
assert.equal(store.items.get('anomalous_detail_video_audio'), 'true');
assert.equal(detailVideoAudio(store), true);

// Storage that cannot be read or written (blocked site data): on, and nothing thrown.
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
assert.equal(detailVideoAutoplay(broken), true);
assert.equal(detailVideoAudio(broken), true);
assert.doesNotThrow(() => setDetailVideoAutoplay(false, broken));
assert.doesNotThrow(() => setDetailVideoAudio(false, broken));
assert.equal(detailVideoAutoplay(null), true);
assert.equal(detailVideoAudio(null), true);

// The player, for each choice.
for (const autoplay of [true, false]) {
    for (const audio of [true, false]) {
        const video = {};
        assert.equal(applyDetailVideoPrefs(video, { autoplay, audio }), video, 'returns the element it set up');
        assert.deepEqual(video, {
            controls: true,
            loop: true,
            playsInline: true,
            autoplay,
            preload: autoplay ? 'auto' : 'metadata',
            defaultMuted: !audio,
            muted: !audio,
        }, `autoplay ${autoplay}, audio ${audio}`);
    }
}

console.log('detail_video_prefs: ok');
