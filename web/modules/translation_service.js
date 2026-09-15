/**
 * translation_service.js
 * Atomic prompt translation service for Anomalous Model Browser.
 * Handles DeepL / Google Translate backend bridge, smart language detection,
 * in-memory caching, and prompt tag splitting.
 */

const translationCache = new Map();

/**
 * Checks if the given text contains any Chinese characters.
 * @param {string} text 
 * @returns {boolean}
 */
export function hasChinese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * Splits a prompt string into trimmed comma-separated tags or phrases.
 * Supports English/Chinese commas, enumeration marks (顿号 、), semicolons, pipes, and newlines.
 * @param {string} text 
 * @returns {string[]}
 */
export function splitPromptTags(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .split(/[,，、;；|｜\n\r]+/)
        .map(t => t.trim())
        .filter(Boolean);
}

/**
 * Normalizes punctuation and formatting of a prompt text into standard comma-separated tags.
 * Converts Chinese commas, enumeration marks (顿号), semicolons, pipes, and newlines into clean `, `.
 * @param {string} text 
 * @param {string} [delimiter=', ']
 * @returns {string}
 */
export function normalizePromptFormatting(text, delimiter = ', ') {
    const tags = splitPromptTags(text);
    return tags.join(delimiter);
}

/**
 * Translates prompt text using the backend /anomalous/translate endpoint.
 * Automatically selects target language if omitted:
 * - If text contains Chinese -> translates to English ('en')
 * - If text is English/Latin -> translates to Simplified Chinese ('zh-CN')
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

    const targetLang = options.targetLang || (hasChinese(raw) ? 'en' : 'zh-CN');
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

/**
 * Clears the in-memory translation cache.
 */
export function clearTranslationCache() {
    translationCache.clear();
}
