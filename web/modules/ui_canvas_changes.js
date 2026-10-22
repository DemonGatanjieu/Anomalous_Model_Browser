/**
 * Shared read-only activity receipt (the AI workbench and the activity page): recorded
 * before/after values, never a live graph guess. A prompt written as tags shows what changed
 * first: the tags taken out (red, struck) and put in (green), with their meaning on request
 * (prompt_gloss.js, the translation service), then both texts with those tags marked. Other
 * text shows the part that differs marked in both; a value cut short in the log loses its cut
 * tag at either end, so a half tag is never called changed.
 */
import { resolveLocale, translate as t } from './locales.js';
import { changeLine } from './activity_log.js';
import { textDifference } from './param_compare.js';
import { promptTagsOf } from './prompt_tags.js';
import { fetchGlosses, glossOf } from './prompt_gloss.js';

const CUT = '…';

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** A logged value without the tag its cut ends broke in half. */
function whole(text) {
    let value = String(text ?? '');
    if (value.startsWith(CUT)) value = value.slice(value.search(/[,，]/) + 1 || value.length);
    if (value.endsWith(CUT)) value = value.slice(0, Math.max(0, value.search(/[,，][^,，]*$/)));
    return value;
}

/** The meaning language for tags: the page's own, when it is not English. */
const glossLang = () => (String(resolveLocale()).startsWith('zh') ? 'zh-CN' : '');

/** Taken-out and put-in tags as chips, each with its meaning once asked for. */
function tagChips(diff) {
    const box = el('div', 'anomalous-canvas-tags');
    const chips = [];
    for (const [kind, tags] of [['out', diff.onlyA], ['in', diff.onlyB]]) {
        if (!tags.length) continue;
        const line = el('div', `anomalous-canvas-tags-line is-${kind}`);
        line.append(el('span', 'anomalous-canvas-tags-label', t(kind === 'out' ? 'aiTagsOut' : 'aiTagsIn', { count: tags.length })));
        for (const tag of tags) {
            const chip = el('span', `anomalous-canvas-tag is-${kind}`);
            chip.append(el('span', 'anomalous-canvas-tag-text', tag));
            chips.push([chip, tag]);
            line.append(chip);
        }
        box.append(line);
    }
    const lang = glossLang();
    if (lang) {
        const show = () => chips.forEach(([chip, tag]) => {
            const meaning = glossOf(tag, lang);
            if (!meaning || chip.querySelector('.anomalous-canvas-tag-gloss')) return;
            chip.append(el('span', 'anomalous-canvas-tag-gloss', meaning));
        });
        const ask = button('anomalous-ai-link anomalous-canvas-tags-gloss', t('aiTagsMeaning'), async () => {
            ask.disabled = true;
            ask.textContent = t('aiTagsMeaningLoading');
            const ok = await fetchGlosses(chips.map(([, tag]) => tag), lang);
            show();
            if (ok) ask.remove();
            else {
                ask.disabled = false;
                ask.textContent = t('aiTagsMeaningFailed');
            }
        });
        box.append(ask);
        show(); // meanings asked for before in this session show at once
    }
    return box;
}

/** One side's text with the tags only it has marked. */
function markedTags(text, only, kind) {
    const marked = new Set(only);
    const box = el('div', 'anomalous-canvas-change-text');
    const tags = promptTagsOf(text);
    tags.forEach((tag, index) => {
        box.append(el('span', marked.has(tag) ? `anomalous-canvas-mark is-${kind}` : 'anomalous-canvas-same', tag));
        if (index < tags.length - 1) box.append(document.createTextNode(', '));
    });
    return box;
}

/** One side's text with the part that differs marked (context around it as it was logged). */
function markedPart(diff, side) {
    const box = el('div', 'anomalous-canvas-change-text');
    const part = side === 'before' ? diff.aPart : diff.bPart;
    box.append(document.createTextNode(diff.before));
    if (part) box.append(el('span', `anomalous-canvas-mark is-${side === 'before' ? 'out' : 'in'}`, part));
    box.append(document.createTextNode(diff.after));
    return box;
}

function values(change, diff) {
    const box = el('div', 'anomalous-canvas-change-values');
    for (const side of ['before', 'after']) {
        const cell = el('div', `anomalous-canvas-change-value is-${side}`);
        let text;
        if (!change[side]) text = el('div', 'anomalous-canvas-change-text', t('activityEmptyValue'));
        else if (diff?.tags) text = markedTags(whole(change[side]), side === 'before' ? diff.onlyA : diff.onlyB, side === 'before' ? 'out' : 'in');
        else if (diff) text = markedPart(diff, side);
        else text = el('div', 'anomalous-canvas-change-text', change[side]);
        cell.append(el('span', 'anomalous-canvas-change-label', t(side === 'before' ? 'aiChangeBefore' : 'aiChangeAfter')), text);
        box.append(cell);
    }
    return box;
}

function changeRow(change, locate) {
    const row = el('div', `anomalous-canvas-change is-${change.kind}`);
    const head = el('div', 'anomalous-canvas-change-head');
    head.append(el('span', 'anomalous-canvas-change-node', change.node));
    if (change.widget) head.append(el('span', 'anomalous-canvas-change-widget', change.widget));
    if (locate && change.kind !== 'removed') head.append(button('anomalous-ai-link', t('activityLocate'), () => locate(change)));
    row.append(head);
    if (change.kind !== 'changed') {
        row.append(el('div', 'anomalous-canvas-change-description', changeLine(change)));
        return row;
    }
    const before = String(change.before ?? '');
    const after = String(change.after ?? '');
    const diff = before && after ? textDifference(whole(before), whole(after)) : null;
    if (diff?.tags) {
        // A prompt: what changed comes first; both texts, marked, under it.
        row.append(tagChips(diff));
        const full = el('details', 'anomalous-canvas-change-full');
        full.append(el('summary', '', t('aiChangeFullText')));
        full.addEventListener('toggle', () => {
            if (full.open && full.children.length === 1) full.append(values(change, diff));
        });
        row.append(full);
    } else {
        row.append(values(change, diff && (diff.aPart || diff.bPart) ? diff : null));
    }
    return row;
}

export function canvasChanges(entry, { locate = null } = {}) {
    const box = el('div', 'anomalous-canvas-changes');
    const changes = (entry?.detail?.changes || []).filter(change => change.kind !== 'opened');
    if (!changes.length) {
        box.append(el('div', 'anomalous-canvas-change-note', t('aiChangesUnavailable')));
        return box;
    }
    box.append(el('div', 'anomalous-canvas-changes-title', t('aiCanvasReceipt', { count: entry.detail.total || changes.length })));
    box.append(...changes.slice(0, 3).map(change => changeRow(change, locate)));
    if (changes.length > 3) {
        const more = el('details', 'anomalous-canvas-change-more');
        more.append(el('summary', '', t('aiMoreChanges', { count: changes.length - 3 })));
        more.addEventListener('toggle', () => {
            if (more.open && more.children.length === 1) more.append(...changes.slice(3).map(change => changeRow(change, locate)));
        });
        box.append(more);
    }
    if (entry.detail.total > changes.length) box.append(el('div', 'anomalous-canvas-change-note', t('activityMore', { count: entry.detail.total - changes.length })));
    if (changes.some(change => String(change.before ?? '').includes(CUT) || String(change.after ?? '').includes(CUT))) {
        box.append(el('div', 'anomalous-canvas-change-note', t('aiChangeExcerpt')));
    }
    return box;
}
