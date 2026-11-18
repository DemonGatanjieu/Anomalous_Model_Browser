/**
 * A message in the Privacy overview's "What the AI can see", as the AI got it (hidden words as their tokens).
 * The user's own words show in full; what Anomalous wrote for the AI (the route or materials the user chose)
 * is one line of what it is with its tokens, the words themselves a press away. Under each: whether the AI
 * has read it, and two small buttons, hide more of its words and find it on the timeline.
 */

import { translate as t } from './locales.js';
import { showStepRow } from './ui_ai_decisions.js';
import { icon } from './ui_ai_icons.js';
import { renderMessageSealer } from './ui_ai_privacy_adjust.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** A token as the AI reads it; `late` when the AI read the words before they were hidden. */
export function tokenBadge(token, late = false) {
    return el('span', `anomalous-ai-priv-token${late ? ' is-late' : ''}`, token);
}

function iconButton(name, label, onClick) {
    const button = el('button', 'anomalous-ai-priv-icon-btn');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(name, 14));
    button.onclick = onClick;
    return button;
}

export function renderMessagePreview(msg, task, { closeOverview, onAdjusted }) {
    const wrap = el('div', 'anomalous-ai-priv-msg');
    const late = new Set(msg.late || []);
    const body = el('div', 'anomalous-ai-priv-msg-text');
    for (const seg of msg.segments || []) body.append(seg.type === 'token' ? tokenBadge(seg.token, late.has(seg.token)) : document.createTextNode(seg.text));
    if (msg.own) wrap.append(body);
    else {
        const line = el('div', 'anomalous-ai-priv-msg-kind');
        line.append(el('span', '', t(`aiPrivacyMsgKind_${msg.tool}`)));
        const tokens = new Set((msg.segments || []).filter(seg => seg.type === 'token').map(seg => seg.token));
        for (const token of tokens) line.append(tokenBadge(token, late.has(token)));
        const words = el('button', 'anomalous-ai-priv-link', t('aiPrivacyMsgWords'));
        words.type = 'button';
        words.setAttribute('aria-expanded', 'false');
        words.onclick = () => {
            const open = !body.isConnected;
            if (open) line.after(body);
            else body.remove();
            words.setAttribute('aria-expanded', String(open));
        };
        line.append(words);
        wrap.append(line);
    }
    if (late.size) {
        wrap.classList.add('is-late');
        const line = el('div', 'anomalous-ai-priv-msg-late');
        line.append(icon('alert', 12), el('span', '', t('aiPrivacyMsgLate', { tokens: [...late].join(t('listSeparator')) })));
        wrap.append(line);
    }
    if (msg.own && !msg.hasPlaintext) wrap.append(el('div', 'anomalous-ai-priv-msg-only-tokens', t('aiPrivacyMsgAllSealed')));

    const foot = el('div', 'anomalous-ai-priv-msg-foot');
    const state = el('span', `anomalous-ai-priv-delivery${msg.delivered ? ' is-read' : ''}`);
    state.append(icon(msg.delivered ? 'check' : 'clock', 12), el('span', '', t(msg.delivered ? 'aiPrivacyMsgRead' : 'aiPrivacyMsgWaiting')));
    foot.append(state);
    if (msg.hasPlaintext) {
        let sealer = null;
        foot.append(iconButton('lock', t('aiPrivacySealMoreBtn'), () => {
            if (sealer) { sealer.remove(); sealer = null; return; }
            sealer = renderMessageSealer(msg, task, {
                onClose: () => { sealer?.remove(); sealer = null; },
                onApplied: () => onAdjusted(),
            });
            wrap.append(sealer);
        }));
    }
    foot.append(iconButton('arrowRight', t('aiPrivacyMsgJump'), () => { closeOverview(); showStepRow(msg.stepId); }));
    wrap.append(foot);
    return wrap;
}
