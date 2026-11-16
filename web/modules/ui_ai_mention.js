/**
 * "@" and "/" in the AI workbench's message box (ui_ai_message.js), as chat apps have them.
 * "@" lists what the user can point the AI at: this task's pictures, the gallery's newest ones
 * (and, for what is typed, those the gallery's search finds: prompt words, models, seed), combos,
 * models, workflows, prompts, custom node packs and node types (the materials picker's data,
 * ai_toolbox_data.js). Taking one writes "@name" into the text and keeps what it is; pictures
 * picked from the gallery (ui_ai_gallery_pick.js, the "Put ready" page) are attached without a
 * name in the text. The message carries exactly what each "@" points at and what is attached
 * (api/ai_message_refs.py), shown over the input until it is sent (ui_ai_tray.js). "/" at the
 * start lists the commands (ui_ai_commands.js): some act at once, some fill in words to send.
 * ↑↓ move, Enter or Tab take, Esc closes; the pointer works as well.
 */

import { resolveLocale, translate as t } from './locales.js';
import { serializeRefs } from './ai_chat_plus.js';
import { fetchUsableWays, keptCatalog, prefetchToolbox, searchItems } from './ai_toolbox_data.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { packItems, pageNodes } from './ui_ai_toolbox_sources.js';
import { sourceBadge } from './ui_ai_toolbox_icons.js';
import { icon } from './ui_ai_icons.js';
import { galleryPictures, pictureItem, thumbUrl } from './ui_ai_gallery_pick.js';
import { drawTray, syncTrayPrivacy } from './ui_ai_tray.js';

export const MAX_REFS = 12; // api/ai_message_refs.py
const SHOWN = 8;
const RECENT = 30; // the gallery's newest pictures "@" offers
const SEARCH_MS = 250;
const ORDER = ['pictures', 'combos', 'models', 'ways', 'workflows', 'prompts', 'packs', 'nodes'];

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
            if (item.type !== 'image' || item.gone || (item.folder && item.folder !== 'output')) continue; // deleted ones cannot be named
            const id = [item.subfolder, item.filename].filter(Boolean).join('/');
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(pictureItem(item));
        }
    }
    return out;
}

/** Everything "@" can name for `task`, in the order a tie is shown. */
function everything(task, waysLoaded) {
    prefetchToolbox();
    const nodes = pageNodes();
    const packs = packItems(nodes).map(pack => ({ ...pack, title: pack.source.label || pack.id, haystack: `${pack.id} ${pack.source.label || ''}`.toLowerCase() }));
    const catalog = keptCatalog() || [];
    const byKind = { pictures: pictures(task), ways: waysLoaded || [], packs, nodes };
    for (const item of catalog) (byKind[item.kind] ||= []).push(item);
    return ORDER.flatMap(kind => byKind[kind] || []);
}

export function lead(item) {
    const box = el('span', 'anomalous-ai-mention-lead');
    const url = item.kind === 'pictures' ? thumbUrl(item.image) : ['combos', 'workflows', 'models'].includes(item.kind) ? coverUrl(item) : '';
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
        box.append(icon({ packs: 'nodes', ways: 'blocks' }[item.kind] || item.kind, 15));
    }
    return box;
}

export const kindWords = item => [item.kind === 'pictures' ? t(item.gallery ? 'aiMentionGallery' : 'aiMentionPicture') : t(`aiToolboxKind_${item.kind}`),
    item.kind === 'models' ? item.type : item.kind === 'prompts' && item.source ? t(`aiTbPromptFrom_${item.source}`) : item.kind === 'ways' ? item.about : ''].filter(Boolean).join(' · ');

/**
 * "@" and "/" for `field` in the message box `box`, what they name drawn into `tray`. `source`:
 * {task(), commands(), mark(image, sent)? (marks a picture up for the AI)}. Returns {keydown(event)
 * (true when the list took the key), refs() (what the message carries), add(item) (attaches it),
 * pictures() and count() (how many pictures, and things, it carries),
 * clear()}. `box` hears "anomalous-refs" whenever that changes.
 */
export function mentions(field, box, source, tray) {
    const list = el('div', 'anomalous-ai-mention');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    box.append(list);
    let refs = []; // {kind, id, label, item, attached}: attached ones need no "@name" in the text
    const live = () => refs.filter(ref => ref.attached || field.value.includes(`@${ref.label}`));
    let open = null; // {mode: 'at' | 'slash', start, items, at}
    let recent = null; // the gallery's newest pictures, read when "@" first opens
    let found = { query: null, items: [] }; // what the gallery's search found for a query
    let timer = null;
    let ways = null; // usable and enabled ways, read when "@" first opens
    let waysAbort = null;

    function waysList() {
        if (ways === null && !waysAbort) {
            const controller = new AbortController();
            waysAbort = controller;
            fetchUsableWays(resolveLocale(), { signal: controller.signal }).then((loaded) => {
                if (controller.signal.aborted) return;
                ways = loaded;
                waysAbort = null;
                if (open?.mode === 'at') update();
            }).catch((error) => {
                if (error?.name !== 'AbortError') waysAbort = null;
            });
        }
        return ways || [];
    }

    /** The gallery's pictures for `query`: the newest at once, what its search finds once it answers. */
    function gallery(query) {
        const keep = images => images.filter(image => image.media_type !== 'video').map(image => pictureItem(image, true));
        if (!recent) {
            recent = [];
            galleryPictures(1, RECENT).then(({ images }) => {
                recent = keep(images);
                if (open?.mode === 'at') update();
            }).catch(() => {});
        }
        clearTimeout(timer);
        if (query.length >= 2 && found.query !== query) {
            timer = setTimeout(() => {
                galleryPictures(1, SHOWN, query).then(({ images }) => {
                    found = { query, items: keep(images) };
                    if (open?.mode === 'at') update();
                }).catch(() => {});
            }, SEARCH_MS);
        }
        return { newest: recent, searched: found.query === query ? found.items : [] };
    }

    const close = () => {
        open = null;
        waysAbort?.abort();
        waysAbort = null;
        list.hidden = true;
        list.replaceChildren();
    };

    function focusNoteOf(key) {
        const target = [...tray.querySelectorAll('.anomalous-ai-mention-chip-note')].find(node => node.dataset.refKey === key);
        target?.focus();
    }

    function drawChips(focusKey = '') {
        box.dispatchEvent(new Event('anomalous-refs'));
        drawTray(tray, live(), {
            lead,
            privateTask: () => Boolean(source.task?.()?.private),
            focusField: () => field.focus(),
            remove: (ref) => {
                drop(ref);
                field.focus();
            },
            // Marked up, the picture goes to the AI with its marks: not with this message too.
            mark: source.mark ? ref => source.mark(ref.item.image, () => drop(ref)) : null,
        });
        if (focusKey) focusNoteOf(focusKey);
    }

    function drop(ref) {
        refs = refs.filter(other => other !== ref);
        if (!ref.attached) field.value = field.value.replace(`@${ref.label} `, '').replace(`@${ref.label}`, '');
        drawChips();
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
        if (!refs.some(ref => ref.kind === item.kind && ref.id === item.id)) refs.push({ kind: item.kind, id: item.id, label, item, note: '' });
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
            const all = everything(source.task(), waysList());
            const { newest, searched } = gallery(query);
            const known = new Set(all.filter(item => item.kind === 'pictures').map(item => item.id));
            const matched = searchItems([...all, ...newest.filter(item => !known.has(item.id))], query);
            const shown = new Set(matched.filter(item => item.kind === 'pictures').map(item => item.id));
            items = [...matched, ...searched.filter(item => !shown.has(item.id))].slice(0, SHOWN);
        }
        open = { mode: slash ? 'slash' : 'at', start: caret - query.length - 1, items, at: 0 };
        draw();
    }

    field.addEventListener('input', () => {
        const before = refs.length;
        refs = live(); // an "@name" deleted from the text leaves the message too
        if (refs.length !== before) drawChips();
        update();
    });
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
        refs: () => serializeRefs(live()),
        has: (kind, id) => live().some(ref => ref.kind === kind && ref.id === id),
        countOf: kind => live().filter(ref => ref.kind === kind || (kind === 'nodes' && ref.kind === 'packs')).length,
        itemsOf: kind => live().filter(ref => ref.kind === kind),
        room: () => Math.max(0, MAX_REFS - live().length),
        add(item, { focusNote = false } = {}) {
            const key = `${item.kind}\0${item.id}`;
            if (live().some(ref => ref.kind === item.kind && ref.id === item.id)) {
                if (focusNote) focusNoteOf(key);
                return true;
            }
            if (live().length >= MAX_REFS) return false;
            refs.push({ kind: item.kind, id: item.id, label: item.title, item, attached: true, note: '' });
            drawChips(focusNote ? key : '');
            return true;
        },
        remove(kind, id) {
            const ref = live().find(other => other.kind === kind && other.id === id);
            if (!ref) return false;
            drop(ref);
            return true;
        },
        swap(kind, oldId, newItem) {
            const ref = live().find(other => other.kind === kind && other.id === oldId);
            if (!ref) return false;
            if (live().some(other => other !== ref && other.kind === newItem.kind && other.id === newItem.id)) {
                drop(ref);
                return true;
            }
            if (!ref.attached && ref.label) field.value = field.value.replace(`@${ref.label}`, `@${newItem.title}`);
            ref.id = newItem.id;
            ref.label = newItem.title;
            ref.item = newItem;
            drawChips();
            return true;
        },
        syncPrivacy: () => syncTrayPrivacy(tray, Boolean(source.task?.()?.private)),
        pictures: () => live().filter(ref => ref.kind === 'pictures').length,
        count: () => live().length,
        clear() {
            refs = [];
            close();
            drawChips();
        },
    };
}
