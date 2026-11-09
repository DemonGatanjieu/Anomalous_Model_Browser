/**
 * The model details' author text from Civitai (ui_detail.js): whether it opens folded, as the user last left it
 * (localStorage, this viewer only), whether a Translate is offered and into which language (English text on the
 * Chinese window, Chinese or Japanese text on the English one), and the paragraphs sent to be translated
 * (api/description_translation.py). Pure but the storage.
 */

const FOLDED_KEY = 'anomalous_detail_intro_folded';
const EAST_ASIAN = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
const LATIN = /[A-Za-z]/g;

/** Whether the author's text opens folded: yes unless the user unfolded it last. */
export function introFolded(store = globalThis.localStorage) {
    try {
        return store?.getItem(FOLDED_KEY) !== '0';
    } catch {
        return true;
    }
}

export function keepIntroFolded(folded, store = globalThis.localStorage) {
    try {
        store?.setItem(FOLDED_KEY, folded ? '1' : '0');
    } catch { /* it opens folded next time */ }
}

/** The language to translate `text` into on a window in `locale`, or '' when it reads as it is. */
export function introLanguage(text, locale) {
    const east = (String(text || '').match(EAST_ASIAN) || []).length;
    const latin = (String(text || '').match(LATIN) || []).length;
    if (locale === 'zh') return latin > east * 2 && latin >= 20 ? 'zh-CN' : '';
    return east >= 10 ? 'en' : '';
}

/** The text of `node` (the author's HTML laid out) as paragraphs: a line each, empty ones dropped. */
export function paragraphsOf(node) {
    const text = node.innerText || node.textContent || '';
    return text.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
