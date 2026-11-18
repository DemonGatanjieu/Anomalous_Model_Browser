/**
 * A starter sheet in steps (the private card's, ui_ai_starter_sheet.js): numbered dots on top, one step's
 * question and fields at a time, and at the foot Back (Cancel on the first step) and Next, Start on the last.
 * A step's `check()` returns what is missing, to stay on that step; `shown()` runs each time it opens.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** `steps`: [{title, nodes, check?, shown?}]; `go` is the sheet's Start button, `say(missing)` shows what is
 * missing ('' clears it). Returns the sheet's {nodes, actions}. */
export function startSteps(steps, { go, cancel, say }) {
    const last = steps.length - 1;
    let at = 0;
    const dots = el('ol', 'anomalous-ai-start-steps');
    const marks = steps.map((step, index) => {
        const mark = el('li', 'anomalous-ai-start-steps-dot');
        mark.setAttribute('aria-label', t('aiStartStepOf', { n: index + 1, title: step.title }));
        dots.append(mark);
        return mark;
    });
    const pages = steps.map((step) => {
        const page = el('section', 'anomalous-ai-start-step');
        page.append(el('h3', 'anomalous-ai-start-step-title', step.title), ...step.nodes);
        return page;
    });
    const back = el('button', 'anomalous-ai-link');
    back.type = 'button';
    back.onclick = () => (at ? show(at - 1) : cancel());
    const next = el('button', 'anomalous-ai-start-go', t('aiStartNext'));
    next.type = 'button';
    next.onclick = () => {
        const missing = steps[at].check?.();
        if (missing) say(missing);
        else show(at + 1);
    };

    function show(index) {
        at = index;
        say('');
        pages.forEach((page, i) => { page.hidden = i !== at; });
        marks.forEach((mark, i) => {
            mark.className = `anomalous-ai-start-steps-dot${i === at ? ' is-on' : i < at ? ' is-done' : ''}`;
            mark.replaceChildren(i < at ? icon('check', 12) : String(i + 1));
            if (i === at) mark.setAttribute('aria-current', 'step');
            else mark.removeAttribute('aria-current');
        });
        back.textContent = t(at ? 'aiStartBack' : 'dialogCancel');
        next.hidden = at === last;
        go.hidden = at !== last;
        steps[at].shown?.();
        pages[at].querySelector('textarea, input:not([hidden]), button:not(:disabled):not([hidden])')?.focus();
    }

    show(0);
    return { nodes: [dots, ...pages], actions: [back, next, go] };
}
