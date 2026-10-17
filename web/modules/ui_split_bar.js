/**
 * A bar between two columns that shares the width: dragged, the right column's width goes
 * into the CSS variable `prop` on `owner` and is remembered under `key`; a double-click goes
 * back to the stylesheet's default. The Script Director's divider between its line cards and
 * the generating side (ui_script_director.js).
 */

/** `body`: the row holding both columns; `min` / `rest`: px kept by the right and the left column. */
export function bindSplitBar(bar, { owner, body, prop, key, min = 320, rest = 340 }) {
    let width = 0;
    try { width = Number(localStorage.getItem(key)) || 0; } catch (_) { /* the default share */ }
    if (width) owner.style.setProperty(prop, `${width}px`);
    bar.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        const right = body.getBoundingClientRect().right;
        const move = (ev) => {
            width = Math.round(Math.max(min, Math.min(body.clientWidth - rest, right - ev.clientX)));
            owner.style.setProperty(prop, `${width}px`);
        };
        const up = () => {
            bar.removeEventListener('pointermove', move);
            bar.removeEventListener('pointerup', up);
            try { localStorage.setItem(key, String(width)); } catch (_) { /* convenience only */ }
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
    });
    bar.addEventListener('dblclick', () => {
        owner.style.removeProperty(prop);
        try { localStorage.removeItem(key); } catch (_) { /* convenience only */ }
    });
}
