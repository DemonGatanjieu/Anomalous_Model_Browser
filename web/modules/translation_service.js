/**
 * Prompt translation: the backend /anomalous/translate bridge (DeepL when a key is set, then
 * Google, then MyMemory) with an in-memory cache, and which text needs translating to English
 * before it goes into a prompt.
 */

const translationCache = new Map();
// A letter that is not plain English: Chinese, kana, hangul, Cyrillic, accented Latin…
const NON_ENGLISH_LETTER = /(?![A-Za-z])\p{L}/u;

/** Whether `text` has letters other than English ones, so it goes to English before a prompt. */
export function needsEnglish(text) {
    return typeof text === 'string' && NON_ENGLISH_LETTER.test(text);
}

/**
 * Translates prompt text using the backend /anomalous/translate endpoint.
 * Without a target, text that needs English goes to English and other text to Chinese.
 *
 * @param {string} text - Raw prompt text to translate
 * @param {Object} [options]
 * @param {string} [options.targetLang] - Target language ('en' | 'zh-CN' | 'ja' | etc.)
 * @param {AbortSignal} [options.signal] - Cancels requests when their owning view closes
 * @param {boolean} [options.bypassCache=false] - If true, ignores in-memory cache
 * @returns {Promise<{ ok: boolean, translated: string, targetLang: string, error?: string }>}
 */
export async function translatePromptText(text, options = {}) {
    if (options.signal?.aborted) return { ok: false, cancelled: true, translated: '', targetLang: options.targetLang || 'en' };
    const raw = String(text || '').trim();
    if (!raw) {
        return { ok: true, translated: '', targetLang: options.targetLang || 'en' };
    }

    const targetLang = options.targetLang || (needsEnglish(raw) ? 'en' : 'zh-CN');
    const cacheKey = `${targetLang}:::${raw}`;

    if (!options.bypassCache && translationCache.has(cacheKey)) {
        return { ok: true, translated: translationCache.get(cacheKey), targetLang, fromCache: true };
    }

    try {
        const response = await fetch('/anomalous/translate', {
            method: 'POST',
            signal: options.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: raw,
                target_lang: targetLang,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        options.signal?.throwIfAborted();
        if (data.status === 'error' || data.error) {
            throw new Error(data.error || 'Translation service failed');
        }

        const translated = String(data.translated ?? '').trim();
        if (!translated) {
            throw new Error('Empty translation response');
        }

        // Cache the successful result (limit cache to 500 items)
        if (translationCache.size >= 500 && !translationCache.has(cacheKey)) {
            const oldestKey = translationCache.keys().next().value;
            translationCache.delete(oldestKey);
        }
        translationCache.set(cacheKey, translated);

        return { ok: true, translated, targetLang, engine: data.engine };
    } catch (err) {
        if (options.signal?.aborted || err.name === 'AbortError') return { ok: false, cancelled: true, translated: raw, targetLang };
        console.warn('[Anomalous Translation] Translate failed:', err);
        return {
            ok: false,
            translated: raw,
            targetLang,
            error: err.message || 'Translation request failed',
        };
    }
}