/**
 * "@" and "/" in the AI workbench's message box (ui_ai_message.js), as chat apps have them.
 * "@" lists what the user can point the AI at: this task's pictures, combos, models, workflows,
 * prompts, custom node packs and node types (the materials picker's data, ai_toolbox_data.js).
 * Taking one writes "@name" into the text and keeps what it is; the message then carries exactly
 * what each "@" points at (api/ai_message_refs.py), shown as chips under the box until it is
 * sent. "/" at the start lists the commands (ui_ai_commands.js): some act at once, some fill in
 * words to send. ↑↓ move, Enter or Tab take, Esc closes; the pointer works as well.
 */

import { translate as t } from './locales.js';
import { keptCatalog, prefetchToolbox, searchItems } from './ai_toolbox_data.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { sourceBadge } from './ui_ai_toolbox_icons.js';
import { packItems, pageNodes } from './ui_ai_toolbox.js';
import { outputUrl } from './ai_task_view.js';
import { icon } from './ui_ai_icons.js';

const SHOWN = 8;
const ORDER = ['pictures', 'combos', 'models', 'workflows', 'prompts', 'packs', 'nodes'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The task's output pictures, newest first, as things to point at. */
function pictures(task) {
    const seen = new Set();
    const out = [];
    for (const step of [...(task?.steps || [])].reverse()) {
        for (const item of step.results || []) {
            if (item.type !== 'image' || (item.folder && item.folder !== 'output')) continue;
            const id = [item.subfolder, item.filename].filter(Boolean).join('/');
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({ kind: 'pictures', id, title: item.filename, image: item, haystack: id.toLowerCase() });
        }
    }
    return out;
}

/** Everything "@" can name for `task`, in the order a tie is shown. */
function everything(task) {
    prefetchToolbox();
    const nodes = pageNodes();
    const packs = packItems(nodes).map(pack => ({ ...pack, title: pack.source.label || pack.id, haystack: `${pack.id} ${pack.source.label || ''}`.toLowerCase() }));
    const catalog = keptCatalog() || [];
    const byKind = { pictures: pictures(task), packs, nodes };
    for (const item of catalog) (byKind[item.kind] ||= []).push(item);
    return ORDER.flatMap(kind => byKind[kind] || []);
}

function lead(item) {
    const box = el('span', 'anomalous-ai-mention-lead');
    const url = item.kind === 'pictures' ? outputUrl(item.image) : ['combos', 'workflows', 'models'].includes(item.kind) ? coverUrl(item) : '';
    if (url) {
        const img = el('img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => img.replaceWith(icon(item.kind, 15));
        box.append(img);
    } else if (item.kind === 'nodes' || item.kind === 'packs') {
        box.append(sourceBadge(item.source, 22));
    } else {
        box.append(icon(item.kind === 'packs' ? 'nodes' : item.kind, 15));
    }
    return box;
}

const kindWords = item => [item.kind === 'pictures' ? t('aiMentionPicture') : t(`aiToolboxKind_${item.kind}`),
    item.kind === 'models' ? item.type : item.kind === 'prompts' && item.source ? t(`aiTbPromptFrom_${item.source}`) : ''].filter(Boolean).join(' · ');

/**
 * "@" and "/" for `field` in the message box `box`. `source`: {task(), commands()}. Returns
 * {keydown(event) (true when the list took the key), refs(text) (what the "@" still in `text`
 * point at), clear()}.
 */
export function mentions(field, box, source) {
    const list = el('div', 'anomalous-ai-mention');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    const chips = el('div', 'anomalous-ai-mention-refs');
    chips.hidden = true;
    box.append(list, chips);
    let refs = [];
    let open = null; // {mode: 'at' | 'slash', start, items, at}

    const close = () => {
        open = null;
        list.hidden = true;
        list.replaceChildren();
    };

    function drawChips() {
        chips.hidden = !refs.length;
        chips.replaceChildren(...refs.map((ref) => {
            const chip = el('span', 'anomalous-ai-mention-chip');
            chip.append(lead(ref.item), el('span', 'anomalous-ai-mention-chip-name', ref.label));
            const x = el('button', 'anomalous-ai-mention-chip-x');
            x.type = 'button';
            x.title = t('aiMentionRemove');
            x.append(icon('close', 11));
            x.onclick = () => {
                refs = refs.filter(other => other !== ref);
                field.value = field.value.replace(`@${ref.label} `, '').replace(`@${ref.label}`, '');
                drawChips();
                field.focus();
            };
            chip.append(x);
            return chip;
        }));
    }

    function take(index) {
        const item = open?.items[index];
        if (!item) return;
        const after = field.value.slice(field.selectionStart ?? field.value.length);
        if (open.mode === 'slash') {
            close();
            field.value = item.fill || '';
            field.setSelectionRange(field.value.length, field.value.length);
            if (!item.fill) void item.run();
            return;
        }
        const label = item.title;
        const before = `${field.value.slice(0, open.start)}@${label} `;
        field.value = before + after.replace(/^\S*/, '').trimStart();
        field.setSelectionRange(before.length, before.length);
        if (!refs.some(ref => ref.kind === item.kind && ref.id === item.id)) refs.push({ kind: item.kind, id: item.id, label, item });
        close();
        drawChips();
    }

    function draw() {
        list.replaceChildren(el('div', 'anomalous-ai-mention-head', t(open.mode === 'slash' ? 'aiCommandHead' : 'aiMentionHead')));
        if (!open.items.length) list.append(el('div', 'anomalous-ai-mention-none', t(open.mode === 'slash' ? 'aiCommandNone' : 'aiMentionNone')));
        open.items.forEach((item, index) => {
            const row = el('div', `anomalous-ai-mention-row${index === open.at ? ' is-on' : ''}`);
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(index === open.at));
            if (open.mode === 'slash') {
                const mark = el('span', 'anomalous-ai-mention-lead');
                mark.append(icon(item.icon, 15));
                row.append(mark, el('span', 'anomalous-ai-mention-name', `/${item.name}`), el('span', 'anomalous-ai-mention-kind', item.hint));
            } else {
                row.append(lead(item), el('span', 'anomalous-ai-mention-name', item.title), el('span', 'anomalous-ai-mention-kind', kindWords(item)));
            }
            row.onpointerdown = event => event.preventDefault(); // the field keeps the caret
            row.onclick = () => take(index);
            row.onpointermove = () => {
                if (open.at === index) return;
                open.at = index;
                draw();
            };
            list.append(row);
        });
        list.hidden = false;
        list.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
    }

    function update() {
        const caret = field.selectionStart ?? field.value.length;
        const before = field.value.slice(0, caret);
        const slash = before.match(/^\/(\S*)$/);
        const at = slash ? null : before.match(/(?:^|\s)@([^\s@]*)$/);
        if (!slash && !at) return close();
        const query = (slash || at)[1];
        let items;
        if (slash) {
            const words = query.toLowerCase();
            items = source.commands().filter(command => !words || command.name.toLowerCase().includes(words) || command.id.includes(words));
        } else {
            items = searchItems(everything(source.task()), query).slice(0, SHOWN);
        }
        open = { mode: slash ? 'slash' : 'at', start: caret - query.length - 1, items, at: 0 };
        draw();
    }

    field.addEventListener('input', update);
    field.addEventListener('click', update);
    field.addEventListener('blur', () => setTimeout(close, 120));

    return {
        keydown(event) {
            if (!open || event.isComposing) return false;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (open.items.length) open.at = (open.at + (event.key === 'ArrowDown' ? 1 : -1) + open.items.length) % open.items.length;
                draw();
                return true;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && open.items.length) {
                event.preventDefault();
                take(open.at);
                return true;
            }
            if (event.key === 'Escape') {
                close();
                return true;
            }
            return false;
        },
        refs: text => refs.filter(ref => text.includes(`@${ref.label}`)).map(({ kind, id, label }) => ({ kind, id, label })),
        clear() {
            refs = [];
            close();
            drawChips();
        },
    };
}
