/**
 * Pictures from the gallery for the AI workbench: pictureGrid, the grid itself (also on a waiting
 * task's "Put ready" page, ui_ai_ready.js), and the message box's panel (ui_ai_message.js) over
 * the box with the newest output pictures (GET /anomalous/gallery_images, as 512 px thumbnails),
 * searched the way the gallery searches (words of the prompt, a model, "seed:123"…), more as it
 * scrolls. Clicking pictures picks them, up to the number the message still takes; "Add" gives
 * them to `onPick([image])`, and the box names them as "@" does, so the AI gets the pictures
 * themselves with what made them. Esc, a click outside, or the button again closes it.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

const PAGE = 40;
const SEARCH_MS = 250;
const MORE_PX = 120;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** An output picture's 512 px thumbnail ({filename, subfolder}). */
export const thumbUrl = image => `/anomalous/output_thumbnail?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' })}`;

/** An output picture as "@" names it. */
export function pictureItem(image, gallery = false) {
    const id = [image.subfolder, image.filename].filter(Boolean).join('/');
    return { kind: 'pictures', id, title: image.filename, image, gallery, haystack: id.toLowerCase() };
}

/** Newest output pictures (matching `query`, when given): {images, pages}. */
export async function galleryPictures(page, limit, query = '', signal = undefined) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (query) params.set('q', query);
    const response = await fetch(`/anomalous/gallery_images?${params}`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { images: data.images || [], pages: data.pages || 0 };
}

/**
 * The gallery as a grid of pictures to pick: a search line and the newest pictures, more as it
 * scrolls. `picked(id)` says whether one is picked, `pick(item)` picks or drops it (the caller
 * keeps what is picked). Returns {search, grid, mark() (shows what is picked again), stop()}.
 */
export function pictureGrid({ picked, pick }) {
    const abort = new AbortController();
    let page = 0;
    let pages = 1;
    let query = '';
    let loading = false;
    let timer = null;
    let stopped = false;
    const search = el('input', 'anomalous-ai-pics-search');
    search.type = 'search';
    search.placeholder = t('aiPicsSearch');
    const grid = el('div', 'anomalous-ai-pics-grid');
    const mark = () => {
        for (const node of grid.querySelectorAll('.anomalous-ai-pics-tile')) node.classList.toggle('is-picked', picked(node.dataset.id));
    };
    function tile(image) {
        const item = pictureItem(image, true);
        const node = el('button', 'anomalous-ai-pics-tile');
        node.type = 'button';
        node.title = item.id;
        node.dataset.id = item.id;
        const img = el('img');
        img.src = thumbUrl(image);
        img.alt = '';
        img.loading = 'lazy';
        const check = el('span', 'anomalous-ai-pics-mark');
        check.append(icon('check', 12));
        node.append(img, check);
        node.onclick = () => {
            pick(item);
            mark();
        };
        node.classList.toggle('is-picked', picked(item.id));
        return node;
    }
    async function more() {
        if (loading || page >= pages) return;
        loading = true;
        const asked = query;
        try {
            const found = await galleryPictures(page + 1, PAGE, asked, abort.signal);
            if (asked !== query || stopped) return;
            page += 1;
            pages = found.pages;
            grid.querySelector('.anomalous-ai-pics-none')?.remove();
            grid.append(...found.images.filter(image => image.media_type !== 'video').map(tile));
            if (!grid.children.length) grid.append(el('div', 'anomalous-ai-pics-none', t(query ? 'aiPicsNone' : 'aiPicsEmpty')));
        } catch (error) {
            if (error.name !== 'AbortError') grid.replaceChildren(el('div', 'anomalous-ai-pics-none', error.message));
        } finally {
            loading = false;
        }
    }
    search.addEventListener('keydown', (event) => { if (event.key !== 'Escape') event.stopPropagation(); });
    search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            query = search.value.trim();
            page = 0;
            pages = 1;
            grid.replaceChildren();
            void more();
        }, SEARCH_MS);
    });
    grid.addEventListener('scroll', () => {
        if (grid.scrollTop + grid.clientHeight > grid.scrollHeight - MORE_PX) void more();
    });
    void more();
    return {
        search, grid, mark,
        stop() {
            stopped = true;
            clearTimeout(timer);
            abort.abort();
        },
    };
}

/**
 * The panel for message box `box`; `room()` says how many more pictures the message takes.
 * Returns {toggle(), close()}.
 */
export function galleryPicker(box, room, onPick) {
    let panel = null;
    let stop = null; // ends the open panel's listeners and requests

    function close() {
        stop?.();
        stop = null;
        panel?.remove();
        panel = null;
    }

    function open() {
        const chosen = new Map();
        const max = () => Math.max(0, room());
        const count = el('span', 'anomalous-ai-pics-count');
        const add = el('button', 'anomalous-ai-panel-send', t('aiPicsAdd'));
        add.type = 'button';
        const drawCount = () => {
            count.textContent = chosen.size ? t('aiPicsPicked', { count: chosen.size, max: max() }) : t(max() ? 'aiPicsHint' : 'aiPicsFull', { max: max() });
            add.disabled = !chosen.size;
        };
        const pictures = pictureGrid({
            picked: id => chosen.has(id),
            pick: (item) => {
                if (chosen.has(item.id)) chosen.delete(item.id);
                else if (chosen.size < max()) chosen.set(item.id, item);
                drawCount();
            },
        });
        panel = el('div', 'anomalous-ai-pics');
        panel.dataset.anomalousEscape = '1';
        const foot = el('div', 'anomalous-ai-pics-foot');
        foot.append(count, add);
        panel.append(pictures.search, pictures.grid, foot);
        box.append(panel);
        add.onclick = () => {
            const items = [...chosen.values()];
            close();
            onPick(items);
        };
        const outside = (event) => {
            if (!panel?.contains(event.target) && !event.target.closest?.('.anomalous-ai-message-pics')) close();
        };
        const escape = (event) => { if (event.key === 'Escape') setTimeout(close); }; // after the window's own Esc saw the panel
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape);
        stop = () => {
            pictures.stop();
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape);
        };
        drawCount();
        pictures.search.focus();
    }

    return {
        toggle: () => (panel ? close() : open()),
        close,
    };
}
