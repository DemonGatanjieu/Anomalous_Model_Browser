/**
 * Which hidden models a message names in a way Anomalous would let through (no DOM; ui_ai_model_lock.js
 * guardNames asks before the message goes). On the way to the AI a hidden model's file name, and its card
 * name or file stem when more than one plain word, become its code word (api/ai_sealed_models.py), written
 * exactly so: same letters, same case, same separators. Anything else stays as written: a name of one plain
 * Latin word ("Anima") or under four letters, the same name written another way ("Meadow Light" for
 * meadow_light), the name the cards show without its version ("Lantern Glow" of "Lantern Glow - v1"), or
 * the first word of a longer name ("Lantern").
 * swapNames writes the model's file name there instead, which does become the code word.
 */

const PLAIN = /^[A-Za-z]+$/;
const SEP = /[\s_-]+/;
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stemOf = file => String(file || '').replace(/\.[^.]+$/, '').split(/[\\/]/).pop();
const wordsOf = name => String(name || '').split(SEP).filter(Boolean);
const flexible = name => wordsOf(name).map(escapeRe).join('[\\s_-]+'); // "meadow_light" finds "Meadow Light"

/** Whether the way to the AI leaves `name` in a text as it is even written exactly (ai_sealed_models._distinct says no). */
export const slipsThrough = name => name.length < 4 || PLAIN.test(name);

/** The ways `item` may be named: whole names, those the way swaps when written exactly, and first words. */
function formsOf(item) {
    const title = String(item.title || '').trim();
    const stem = stemOf(item.file);
    const whole = [...new Set([title, String(item.short || '').trim(), stem, item.file].filter(name => name && name.length >= 3))];
    const first = [title, stem].map(wordsOf).filter(words => words.length > 1).map(words => words[0]).filter(word => /^[A-Za-z]{6,}$/.test(word));
    const caught = [title, stem, item.file].filter(name => name && !slipsThrough(name)); // the forms ai_sealed_models looks for
    return { whole, caught: new Set(caught), first: [...new Set(first)] };
}

/** Each loose naming of `item` in `text`, passed to `hit(said)` for what goes in its place; an exact caught
 * name stays, and so does a first word inside one ("Lantern" of "Lantern Glow - v1"). */
function scan(text, item, hit) {
    const { whole, caught, first } = formsOf(item);
    const forms = [...whole].sort((a, b) => b.length - a.length).map(flexible).concat(first.map(escapeRe));
    if (!forms.length) return String(text || '');
    const finder = new RegExp(`(?<![A-Za-z0-9_])(?:${forms.join('|')})(?![A-Za-z0-9_])`, 'gi');
    return String(text || '').replace(finder, said => (caught.has(said) ? said : hit(said)));
}

/** [{item, names}] of the models in `items` that `isHidden(item)` says the AI gets as a code word and `text` names loosely. */
export function namedHidden(text, items, isHidden) {
    const found = [];
    for (const item of items || []) {
        if (item?.kind !== 'models' || !item.file || !isHidden(item)) continue;
        const names = new Set();
        scan(text, item, (said) => { names.add(said); return said; });
        if (names.size) found.push({ item, names: [...names] });
    }
    return found;
}

/** `text` with each loose naming of `found` (namedHidden) as its model's file name. */
export function swapNames(text, found) {
    return found.reduce((out, { item }) => scan(out, item, () => item.file), String(text || ''));
}
