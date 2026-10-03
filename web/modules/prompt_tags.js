/**
 * A prompt as a list of tags (Prompt Studio's chips), and back to text. Tags are split on
 * commas (also ，) and line breaks outside brackets, so `(a, b:1.2)` and `<lora:x:0.8>` stay
 * one tag and an escaped `\(` is text. Each tag keeps the separator after it, so editing one
 * tag leaves the rest of the text, line breaks included, as it was. No DOM here.
 */

const OPEN = '([{<';
const CLOSE = ')]}>';
const isSeparator = ch => ch === ',' || ch === '，' || ch === '\n' || ch === '\r';
const isSpace = ch => /\s/.test(ch);

/** { lead, items: [{ text, sep }] }: `lead + items.map(text + sep)` is the original text. */
export function splitPrompt(value) {
    const source = String(value ?? '');
    const lead = source.match(/^[\s,，]*/)[0];
    const items = [];
    let depth = 0;
    let start = lead.length;
    let i = start;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') { i += 2; continue; }
        if (OPEN.includes(ch)) depth++;
        else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
        else if (depth === 0 && isSeparator(ch)) {
            // The separator run: separators and the spaces around them.
            let end = i;
            while (end < source.length && (isSeparator(source[end]) || isSpace(source[end]))) end++;
            let textEnd = i;
            while (textEnd > start && isSpace(source[textEnd - 1])) textEnd--;
            items.push({ text: source.slice(start, textEnd), sep: source.slice(textEnd, end) });
            i = start = end;
            continue;
        }
        i++;
    }
    if (start < source.length) {
        const rest = source.slice(start);
        const text = rest.trimEnd();
        items.push({ text, sep: rest.slice(text.length) });
    }
    return { lead, items };
}

export function joinPrompt(parsed) {
    return parsed.lead + parsed.items.map(item => item.text + item.sep).join('');
}

/** The tags of a text typed or dropped in, split the same way. */
export function promptTagsOf(value) {
    return splitPrompt(value).items.map(item => item.text).filter(Boolean);
}

const WEIGHTED = /^\((.+):\s*(-?\d*\.?\d+)\s*\)$/s;

/** { core, weight }: `(red hair:1.2)` is red hair at 1.2; anything else is itself at 1. */
export function tagWeight(tag) {
    const match = String(tag).match(WEIGHTED);
    return match ? { core: match[1].trim(), weight: Number(match[2]) } : { core: String(tag), weight: 1 };
}

/** `tag` at `weight` (0.1 to 2, two decimals); weight 1 drops the brackets. */
export function withWeight(tag, weight) {
    const { core } = tagWeight(tag);
    const rounded = Math.round(Math.max(0.1, Math.min(2, weight)) * 100) / 100;
    return rounded === 1 ? core : `(${core}:${rounded})`;
}

const tagKey = tag => tagWeight(tag).core.trim().toLowerCase();

// New tags before item `at` (the end when past it); the text's ending stays at the end.
function spliceTags(parsed, at, texts) {
    const added = texts.map(text => ({ text, sep: ', ' }));
    if (at >= parsed.items.length) {
        const last = parsed.items[parsed.items.length - 1];
        added[added.length - 1].sep = last ? last.sep : '';
        if (last) last.sep = ', ';
        parsed.items.push(...added);
    } else {
        parsed.items.splice(Math.max(0, at), 0, ...added);
    }
    return joinPrompt(parsed);
}

/**
 * `tags` put into `value` before tag `index` (at the end when null); tags the text has
 * already, by their words whatever the weight, are left out. Returns { value, added, skipped }.
 */
export function insertTags(value, tags, index = null) {
    const parsed = splitPrompt(value);
    const have = new Set(parsed.items.map(item => tagKey(item.text)));
    const fresh = [];
    for (const tag of tags) {
        const text = String(tag).trim();
        if (!text || have.has(tagKey(text))) continue;
        have.add(tagKey(text));
        fresh.push(text);
    }
    if (!fresh.length) return { value: String(value ?? ''), added: 0, skipped: tags.length };
    const at = index === null ? parsed.items.length : index;
    return { value: spliceTags(parsed, at, fresh), added: fresh.length, skipped: tags.length - fresh.length };
}

/** `value` without tag `index`. */
export function removeTag(value, index) {
    const parsed = splitPrompt(value);
    const [gone] = parsed.items.splice(index, 1);
    // The last tag went: the one before it now ends the text, as that one did.
    if (gone && index === parsed.items.length && parsed.items.length) parsed.items[index - 1].sep = gone.sep;
    return joinPrompt(parsed);
}

/** `value` with tag `index` replaced by `text` (empty removes it). */
export function replaceTag(value, index, text) {
    const trimmed = String(text).trim();
    if (!trimmed) return removeTag(value, index);
    const parsed = splitPrompt(value);
    if (!parsed.items[index]) return String(value ?? '');
    parsed.items[index].text = trimmed;
    return joinPrompt(parsed);
}

/** `value` with tag `from` moved to before tag `to` (counted before the move; past the end is the end). */
export function moveTag(value, from, to) {
    const parsed = splitPrompt(value);
    if (!parsed.items[from] || from === to || from + 1 === to) return String(value ?? '');
    const text = parsed.items[from].text;
    return spliceTags(splitPrompt(removeTag(value, from)), to > from ? to - 1 : to, [text]);
}
