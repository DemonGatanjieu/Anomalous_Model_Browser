/**
 * Notes for a newcomer to the AI workbench, in two kinds and never as paragraphs on the page:
 * - the workbench's tour (the spotlight tour of ui_spotlight_tour.js with its own steps): a new task,
 *   connecting, the gates, the list, a task's ⋯, the timeline and the message box. It runs by itself the
 *   first time the workbench shows a task, and again from the home page's "How it works" (startAiTour).
 *   A task list the user folded away slides in for the tour (as the title bar's button peeks it) and
 *   folds again when the tour ends.
 * - firstHint(): one line under a control that only shows up later (a run's verdict, undo for the AI's
 *   canvas changes, the Hide button of a private task), shown until the user says Got it.
 * What was seen is remembered in this browser only; without storage the notes simply come again.
 */

import { translate as t } from './locales.js';
import { isSpotlightTourActive, startSpotlightTour } from './ui_spotlight_tour.js';

const TOUR_KEY = 'anomalous_ai_tour_seen';
const HINTS_KEY = 'anomalous_ai_hints_seen';
const step = (id, targetSelector, icon, position) => ({ id, targetSelector, icon, position, titleKey: `aiTour_${id}_title`, bodyKey: `aiTour_${id}_body` });
export const AI_TOUR = Object.freeze([
    step('new', '.anomalous-ai-tasks .anomalous-ai-new-task', '➕', 'right'),
    step('connect', '.anomalous-ai-tasks-ways .anomalous-ai-way:nth-child(1)', '🔌', 'right'),
    step('gates', '.anomalous-ai-tasks-ways .anomalous-ai-way:nth-child(2)', '🛡️', 'right'),
    step('list', '.anomalous-ai-tasks .anomalous-ai-task-filters', '📋', 'right'),
    step('menu', '.anomalous-ai-task-head .anomalous-ai-task-menu', '⋯', 'bottom'),
    step('timeline', '.anomalous-ai-timeline', '🕘', 'left'),
    step('message', '.anomalous-ai-task .anomalous-ai-message', '💬', 'top'),
]);

function seen(key) {
    try {
        const ids = JSON.parse(localStorage.getItem(key) || '[]');
        return new Set(Array.isArray(ids) ? ids : []);
    } catch (_) {
        return new Set();
    }
}

function remember(key, id) {
    try {
        localStorage.setItem(key, JSON.stringify([...seen(key).add(id)]));
    } catch (_) {
        // a convenience only: the note comes again next time
    }
}

/** Whether the workbench shows a task at its full size (not mid-animation, not folded into tabs). */
const settled = page => (page.querySelector('.anomalous-ai-timeline')?.getBoundingClientRect().width || 0) > 200;

const PEEK_MS = 220; // the folded list's slide-in (45-ai-side-views.css) is over by then

/** Starts the tour; resolves whether it started. */
export function startAiTour() {
    const page = document.querySelector('.anomalous-ai');
    const folded = Boolean(page?.classList.contains('tasks-collapsed') && !page.classList.contains('is-narrow'));
    const unfold = () => { if (folded) page.classList.remove('is-peeking'); };
    if (folded) page.classList.add('is-peeking');
    return new Promise((done) => {
        setTimeout(() => {
            const started = startSpotlightTour(null, { steps: AI_TOUR, onClose: unfold });
            if (!started) unfold();
            done(started);
        }, folded ? PEEK_MS : 0);
    });
}

/** The tour as soon as the workbench shows a task (after going there from the home page); gives up after a few seconds. */
export function tourWhenShown(tries = 20) {
    const page = document.querySelector('.anomalous-ai');
    if (page && settled(page)) {
        remember(TOUR_KEY, 'workbench');
        void startAiTour();
    } else if (tries > 0) {
        setTimeout(() => tourWhenShown(tries - 1), 200);
    }
}

/** The tour by itself, once, when `page` (the workbench) shows a task and nothing else is in front; after the
 * window has finished opening, since a tour started in its animation points at a squeezed layout. */
export function aiTourOnce(page) {
    if (seen(TOUR_KEY).has('workbench') || isSpotlightTourActive() || !page?.isConnected) return;
    setTimeout(() => {
        if (!page.isConnected || isSpotlightTourActive() || !settled(page)) return;
        void startAiTour().then(started => started && remember(TOUR_KEY, 'workbench'));
    }, 900);
}

/** The line for `id` (words `text`) until the user said Got it, or null; one of each on the page at a time. */
export function firstHint(id, text) {
    if (seen(HINTS_KEY).has(id) || document.querySelector(`.anomalous-ai-first-hint[data-hint="${id}"]`)) return null;
    const line = document.createElement('div');
    line.className = 'anomalous-ai-first-hint';
    line.dataset.hint = id;
    const words = document.createElement('span');
    words.textContent = text;
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'anomalous-ai-first-hint-done';
    done.textContent = t('aiFirstHintDone');
    done.onclick = () => {
        remember(HINTS_KEY, id);
        line.remove();
    };
    line.append(words, done);
    return line;
}
