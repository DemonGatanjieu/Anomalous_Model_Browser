/**
 * The feedback window: a problem or a suggestion is written here first, in the browser's
 * own language and look, before GitHub opens with it filled in (feedback.js). One text
 * box; the environment is attached only when ticked, and can be looked at first.
 */

import { translate } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { collectDiagnostics, openIssue } from './feedback.js';

const t = (key, params) => translate(key, params);

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** `kind`: 'bug' | 'idea'. */
export function openFeedbackDialog(owner, kind = 'bug') {
    const scope = createViewScope();
    const isBug = kind === 'bug';
    const overlay = el('div', 'anomalous-feedback-overlay');
    const dialog = el('div', 'anomalous-feedback-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const text = el('textarea', 'anomalous-feedback-text');
    text.rows = 5;
    text.placeholder = t(isBug ? 'feedbackReportPlaceholder' : 'feedbackSuggestPlaceholder');

    const attach = el('input');
    attach.type = 'checkbox';
    attach.checked = true;
    const attachRow = el('label', 'anomalous-feedback-attach');
    attachRow.append(attach, el('span', '', t('feedbackAttach')));
    const preview = el('pre', 'anomalous-feedback-preview');
    preview.hidden = true;
    const showPreview = button('anomalous-feedback-link', t('feedbackShowAttach'), async () => {
        preview.hidden = !preview.hidden;
        if (!preview.hidden && !preview.textContent) preview.textContent = await collectDiagnostics(owner);
    });

    const close = () => scope.dispose();
    const submit = button('anomalous-feedback-submit', t('feedbackSubmit'), async () => {
        submit.disabled = true;
        await openIssue(owner, kind, text.value, { environment: attach.checked });
        close();
    });
    submit.disabled = true;
    text.oninput = () => { submit.disabled = !text.value.trim(); };

    const actions = el('div', 'anomalous-feedback-actions');
    actions.append(button('anomalous-feedback-cancel', t('dialogCancel'), close), submit);
    dialog.append(
        el('h3', 'anomalous-feedback-title', t(isBug ? 'feedbackReport' : 'feedbackSuggest')),
        el('p', 'anomalous-feedback-lead', t(isBug ? 'feedbackDialogLead' : 'feedbackDialogSuggestLead')),
        text,
        ...(isBug ? [el('p', 'anomalous-feedback-hint', t('feedbackScreenshotHint'))] : []),
        attachRow, showPreview, preview, actions,
    );
    overlay.append(dialog);
    document.body.append(overlay);
    scope.onDispose(() => overlay.remove());
    scope.listen(overlay, 'mousedown', (event) => { if (event.target === overlay) close(); });
    scope.listen(window, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation(); // the browser window behind stays open
        close();
    }, true);
    text.focus();
}
