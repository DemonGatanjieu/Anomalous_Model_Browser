/**
 * A desktop notification when a task waits for the user while they are in another window, the AI
 * app most likely (ai_notice.js says for what). Off until the user turns it on (a task's ⋯, the
 * page of a task waiting for an AI): the browser asks for its permission at that press, and the
 * choice stays in this browser. Nothing shows while this page has the focus; a press on the
 * notification brings the window back with the AI workbench open. The browser gives none on a
 * page reached over plain http from another computer: the switch is not offered there.
 */

import { api } from '../../../scripts/api.js';
import { translate as t } from './locales.js';
import { noticeOf } from './ai_notice.js';
import { anomalousAlert } from './ui_dialog.js';

const KEY = 'anomalous_ai_notify';
let host = null; // the browser, to open on a press

function kept() {
    try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
}

function keep(on) {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* a browser that keeps nothing: it stays off */ }
}

/** 'none' (this browser or this address cannot), 'on' or 'off'. */
export function notifyState() {
    if (typeof Notification !== 'function' || !window.isSecureContext) return 'none';
    return kept() && Notification.permission === 'granted' ? 'on' : 'off';
}

function show(title, body) {
    const note = new Notification(title, { body, tag: 'anomalous-ai' });
    note.onclick = () => {
        window.focus();
        host?.show?.();
        host?.goTo?.('ai');
        note.close();
    };
}

/** Turns it on (asking for the browser's permission where it was not given yet, and showing one as a sample) or off. */
export async function toggleNotify() {
    if (notifyState() === 'on') {
        keep(false);
        return;
    }
    const allowed = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (allowed !== 'granted') {
        await anomalousAlert(t('aiNotifyBlocked'), t('aiNotifyTurnOn'));
        return;
    }
    keep(true);
    if (notifyState() === 'on') show(t('aiNotifyOnTitle'), t('aiNotifyOnBody'));
}

/** Once: what waits for the user is told while they are elsewhere. `owner`: the browser. */
export function watchForUser(owner) {
    host = owner;
    api.addEventListener('anomalous.ai_task', (event) => {
        const notice = noticeOf(event?.detail);
        if (!notice || notifyState() !== 'on' || (!document.hidden && document.hasFocus())) return;
        show(t(notice.title), notice.text ?? t(notice.body));
    });
}

/** The switch as a line, saying which way it stands, for a page that sends the user to their AI app; null where it cannot work. */
export function notifyLine() {
    if (notifyState() === 'none') return null;
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'anomalous-ai-link anomalous-ai-notify';
    line.title = t('aiNotifyHint');
    const draw = () => { line.textContent = t(notifyState() === 'on' ? 'aiNotifyIsOn' : 'aiNotifyTurnOn'); };
    line.onclick = async () => {
        await toggleNotify();
        draw();
    };
    draw();
    return line;
}
