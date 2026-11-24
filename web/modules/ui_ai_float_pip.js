/**
 * The AI's canvas card (ui_ai_float.js) in a small window of its own that stays on top of every app
 * (Chrome / Edge's Document Picture-in-Picture), so the user sees it over an AI app's terminal or
 * anything else they work in. The card itself moves into that window, still drawn by ui_ai_float.js,
 * and comes back to the canvas when the window closes, by its own × or closeDesktopPip. The window gets
 * AMB's stylesheet and the theme's classes on <html>, kept in step while it is open. Browsers without it
 * (Firefox, Safari, a page that is neither https nor on this computer) offer no button for it.
 */

const THEME_CLASSES = ['amb-theme-light', 'theme-abyssal-scarlet', 'amb-comfy-dark'];

let pipWin = null;
let release = null; // puts the card back and drops the listeners of the window open now, once

export const supportsDesktopPip = () => Boolean(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');

export const isDesktopPipOpen = () => Boolean(pipWin && !pipWin.closed);

function paintTheme(doc) {
    for (const name of THEME_CLASSES) doc.documentElement.classList.toggle(name, document.documentElement.classList.contains(name));
}

/**
 * Moves `card` into a desktop window (from the user's click: the browser asks for one). `title` names
 * the window; `onReturn()` once the card is back on the canvas because the window closed. Resolves
 * false when the browser refused the window.
 */
export async function openDesktopPip(card, { title, onReturn } = {}) {
    if (isDesktopPipOpen()) {
        pipWin.focus();
        return true;
    }
    const height = Math.min(460, Math.max(170, Math.ceil((card.offsetHeight || 180) + 24)));
    let win;
    try {
        win = await window.documentPictureInPicture.requestWindow({ width: 360, height });
    } catch (error) {
        console.warn('[AMB] The browser gave no desktop window for the AI card.', error);
        return false;
    }
    const doc = win.document;
    doc.title = title || 'AI';
    // AMB's stylesheet, by its full address: its @imports (the --amb-* tokens, the card's own) come along.
    const loads = [];
    for (const link of document.head.querySelectorAll('link[rel="stylesheet"]')) {
        if (!link.href.includes('styles.css')) continue;
        const copy = doc.createElement('link');
        copy.rel = 'stylesheet';
        copy.href = link.href;
        loads.push(new Promise((done) => { copy.onload = copy.onerror = done; }));
        doc.head.append(copy);
    }
    paintTheme(doc);
    doc.body.classList.add('anomalous-ai-float-pip-body');
    await Promise.race([Promise.all(loads), new Promise(done => setTimeout(done, 1500))]); // the card moves in dressed
    if (win.closed || !card.isConnected) { // closed meanwhile, or the card went (AMB's window opened)
        win.close();
        return false;
    }
    const onTheme = () => paintTheme(doc);
    const onLeave = () => closeDesktopPip({ suppressReturn: true });
    window.addEventListener('anomalous-theme-change', onTheme);
    window.addEventListener('beforeunload', onLeave);
    card.style.left = '';
    card.style.top = '';
    card.classList.add('is-pip');
    doc.body.append(card);
    pipWin = win;
    let done = false;
    const back = (suppressReturn) => {
        if (done) return;
        done = true;
        if (release === back) release = null;
        if (pipWin === win) pipWin = null;
        window.removeEventListener('anomalous-theme-change', onTheme);
        window.removeEventListener('beforeunload', onLeave);
        card.classList.remove('is-pip');
        if (suppressReturn) {
            card.remove();
            return;
        }
        (document.querySelector('.graph-canvas-panel') || document.body).append(card);
        onReturn?.();
    };
    release = back;
    win.addEventListener('pagehide', () => back(false)); // its own ×: the card goes back to the canvas
    return true;
}

/** Closes the desktop window; the card goes back to the canvas, or away with `suppressReturn` (the card hides). */
export function closeDesktopPip({ suppressReturn = false } = {}) {
    const win = pipWin;
    release?.(suppressReturn); // first, so the window's pagehide finds nothing left to do
    try {
        win?.close();
    } catch { /* gone already */ }
}

/** Brings ComfyUI's own browser window forward, from a click in the desktop window. */
export function focusOpenerWindow() {
    try {
        window.focus();
    } catch { /* the browser may keep its focus where it is */ }
}
