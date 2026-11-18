/**
 * The AI pages' pictures (web/assets, drawn with ChatGPT in one style: flat filled shapes in soft blue,
 * teal and yellow on a transparent ground, any stroke touching the ground blue so a dark theme shows it), so a picture can stand where a paragraph stood: the waiting page's steps, the empty views of
 * the side column (emptyState), the connect guide, the "Ask first" window. Static files only.
 * ComfyUI has the browser ask again for every plugin file on each page load, and a page asks for its pictures
 * only once it is drawn, behind its own requests (and right after a load ComfyUI asks for a hundred-odd things
 * at once, which a browser serves before pictures): so the first screens' pictures are asked for as the window
 * opens, first in line (warmArt), and a picture still on its way fades in when it arrives (fadeIn).
 */

const ART = {
    connect: 'ai_connect', notes: 'ai_tasks_empty', codes: 'ai_privacy_codes', askFirst: 'ask_first',
    write: 'step_write', copy: 'step_copy', paste: 'step_paste', board: 'empty_board', frame: 'empty_frame',
};

const FIRST_SCREENS = ['write', 'copy', 'paste', 'notes']; // a new task's three steps, the empty task list
let warmed = null; // the pictures asked for, held so this page keeps them

/** Asks for the first screens' pictures (with `files`, other web/assets names) once per page, as the window opens. */
export function warmArt(files = []) {
    if (warmed) return;
    warmed = [...FIRST_SCREENS.map(name => ART[name]), ...files].map(file => {
        const img = new Image();
        img.decoding = 'async';
        img.fetchPriority = 'high'; // not behind ComfyUI's own burst of requests after a load
        img.src = new URL(`../assets/${file}.webp`, import.meta.url).href;
        return img;
    });
}

/** `img` (its src set) fades in when it arrives if it is not here yet; one already here shows at once. */
export function fadeIn(img) {
    if (img.complete) return img;
    img.classList.add('anomalous-art-fade', 'is-arriving');
    const settle = () => img.classList.remove('is-arriving');
    img.addEventListener('load', settle, { once: true });
    img.addEventListener('error', settle, { once: true });
    return img;
}

/** Picture `name` (a key of ART) as an image with `className`. */
export function art(name, className) {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    img.src = new URL(`../assets/${ART[name]}.webp`, import.meta.url).href;
    return fadeIn(img);
}

/** An empty view: picture `name` over one short line. */
export function emptyState(name, text) {
    const box = document.createElement('div');
    box.className = 'anomalous-ai-stage-empty has-art';
    const words = document.createElement('span');
    words.textContent = text;
    box.append(art(name, 'anomalous-ai-empty-art'), words);
    return box;
}
