/**
 * The way back to a task's newest step, over the message box (ui_ai_workbench.js puts it there): a
 * round button, there while the user reads more than a screen above the timeline's foot or the AI's
 * steps came in since they left it, with how many on its corner; a click takes them down. atFoot
 * tells the workbench whether a redraw keeps the timeline at its foot.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

const NEAR_BOTTOM = 60;

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
    const draw = () => {
        if (atFoot(scroller)) unseen = 0;
        button.hidden = !unseen && below(scroller) < scroller.clientHeight;
        count.textContent = unseen > 99 ? '99+' : unseen ? String(unseen) : '';
        button.title = unseen ? t('aiNewSteps', { count: unseen }) : t('aiToNewest');
        button.setAttribute('aria-label', button.title);
    };
    button.onclick = () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
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
