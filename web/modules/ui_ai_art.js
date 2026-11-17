/**
 * The AI pages' pictures (web/assets, drawn with ChatGPT in one style: glossy icons on a transparent
 * ground), so a picture can stand where a paragraph stood: the waiting page's steps, the empty views of
 * the side column (emptyState), the connect guide, the "Ask first" window. Static files only.
 */

const ART = {
    connect: 'ai_connect', notes: 'ai_tasks_empty', codes: 'ai_privacy_codes', askFirst: 'ask_first',
    write: 'step_write', copy: 'step_copy', paste: 'step_paste', board: 'empty_board', frame: 'empty_frame',
};

/** Picture `name` (a key of ART) as an image with `className`. */
export function art(name, className) {
    const img = document.createElement('img');
    img.className = className;
    img.src = new URL(`../assets/${ART[name]}.webp`, import.meta.url).href;
    img.alt = '';
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    return img;
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
