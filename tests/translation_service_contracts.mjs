import assert from 'node:assert/strict';
import { hasChinese, splitPromptTags, normalizePromptFormatting, translatePromptText } from '../web/modules/translation_service.js';

// 1. Test hasChinese
assert.equal(hasChinese(''), false);
assert.equal(hasChinese(null), false);
assert.equal(hasChinese('masterpiece, 1girl, highly detailed'), false);
assert.equal(hasChinese('masterpiece, 1girl, 杰作, 高画质'), true);
assert.equal(hasChinese('仅中文提示词'), true);

// 2. Test splitPromptTags with commas, enumeration marks (顿号), semicolons, pipes
const sample = '六个手指、低分辨率、糟糕的解剖结构；1girl，赛博朋克风格|neon lighting\ncinematic shadows';
const tags = splitPromptTags(sample);
assert.deepEqual(tags, [
    '六个手指',
    '低分辨率',
    '糟糕的解剖结构',
    '1girl',
    '赛博朋克风格',
    'neon lighting',
    'cinematic shadows',
]);

// 2b. Test normalizePromptFormatting
const normalized = normalizePromptFormatting('1boy、2boys、男性；肌肉发达，丑陋男人');
assert.equal(normalized, '1boy, 2boys, 男性, 肌肉发达, 丑陋男人');

// 3. Test translatePromptText with mocked fetch
let fetchCalls = 0;
let lastRequestBody = null;

globalThis.fetch = async (url, options = {}) => {
    fetchCalls++;
    lastRequestBody = JSON.parse(options.body || '{}');
    if (lastRequestBody.text === 'error_trigger') {
        return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal Server Error' }),
        };
    }
    return {
        ok: true,
        json: async () => ({
            status: 'success',
            translated: lastRequestBody.target_lang === 'en' ? 'masterpiece, 1girl' : '杰作，女孩',
        }),
    };
};

// Case 3a: Chinese input auto-selects 'en'
const res1 = await translatePromptText('杰作, 女孩');
assert.equal(res1.ok, true);
assert.equal(res1.targetLang, 'en');
assert.equal(res1.translated, 'masterpiece, 1girl');
assert.equal(fetchCalls, 1);

// Case 3b: Cached call (identical prompt & target) uses cache, does not hit fetch
const res1Cached = await translatePromptText('杰作, 女孩');
assert.equal(res1Cached.ok, true);
assert.equal(res1Cached.fromCache, true);
assert.equal(fetchCalls, 1); // No new network call

// Case 3c: English input auto-selects 'zh-CN'
const res2 = await translatePromptText('masterpiece, 1girl');
assert.equal(res2.ok, true);
assert.equal(res2.targetLang, 'zh-CN');
assert.equal(res2.translated, '杰作，女孩');
assert.equal(fetchCalls, 2);

// Case 3d: Error recovery - returns original text gracefully with ok: false on HTTP failure
const resError = await translatePromptText('error_trigger');
assert.equal(resError.ok, false);
assert.equal(resError.translated, 'error_trigger');

// Case 3e: Error recovery - backend returns status: 'error' JSON payload
globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'error', error: 'All translation providers failed', translated: 'untranslated_raw' }),
});
const resStatusError = await translatePromptText('untranslated_raw', { bypassCache: true });
assert.equal(resStatusError.ok, false);
assert.equal(resStatusError.error, 'All translation providers failed');
assert.equal(resStatusError.translated, 'untranslated_raw');

console.log('translation service contracts: hasChinese, splitPromptTags, auto language detection, LRU cache & error resilience passed');
