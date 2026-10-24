/**
 * The way back to a task's newest step, over the message box (ui_ai_workbench.js puts it there): a
 * round button, there while the user reads more than a screen above the timeline's foot or the AI's
 * steps came in since they left it, with how many on its corner; a click takes them down. atFoot
 * tells the workbench whether a redraw keeps the timeline at its foot.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

const NEAR_BOTTOM = 60;
const JUMP_MS = 240;

const below = scroller => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;

/** Whether `scroller` is scrolled to (about) its foot. */
export const atFoot = scroller => below(scroller) < NEAR_BOTTOM;

/** The button for the timeline in `scroller`; `arrived(count)` after a redraw that brought the AI's new steps. */
export function newestButton(scroller) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anomalous-ai-newest';
    button.hidden = true;
    const count = document.createElement('span');
    count.className = 'anomalous-ai-newest-count';
    button.append(icon('chevronDown', 18), count);
    let unseen = 0;
    let cancelJump = () => {};
    button.jumping = false;
    const draw = () => {
        if (atFoot(scroller)) unseen = 0;
        button.hidden = !button.jumping && !unseen && below(scroller) < scroller.clientHeight;
        const text = unseen > 99 ? '99+' : unseen ? String(unseen) : '';
        if (count.textContent !== text) count.textContent = text;
        const title = unseen ? t('aiNewSteps', { count: unseen }) : t('aiToNewest');
        if (button.title !== title) {
            button.title = title;
            button.setAttribute('aria-label', title);
        }
    };
    button.onclick = () => {
        cancelJump();
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
            draw();
            return;
        }
        const start = scroller.scrollTop;
        const began = performance.now();
        const inputs = new AbortController();
        let frame;
        button.jumping = true;
        cancelJump = () => {
            cancelAnimationFrame(frame);
            inputs.abort();
            button.jumping = false;
            draw();
        };
        // Wheel, touch, or keyboard navigation immediately gives control back to the reader.
        for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
            scroller.addEventListener(name, cancelJump, { passive: true, signal: inputs.signal });
        }
        const tick = (now) => {
            if (!button.isConnected) { cancelJump(); return; }
            const progress = Math.min(1, (now - began) / JUMP_MS);
            // Re-read the foot: pictures and incoming steps can change its position mid-jump.
            const end = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTo({ top: start + (end - start) * (1 - (1 - progress) ** 3), behavior: 'instant' });
            if (progress < 1) frame = requestAnimationFrame(tick);
            else cancelJump();
        };
        frame = requestAnimationFrame(tick);
    };
    const scrolled = () => {
        if (!button.isConnected) scroller.removeEventListener('scroll', scrolled); // another task's view by now
        else draw();
    };
    scroller.addEventListener('scroll', scrolled, { passive: true });
    button.arrived = (steps) => {
        if (!atFoot(scroller)) unseen += steps;
        draw();
    };
    return button;
}
