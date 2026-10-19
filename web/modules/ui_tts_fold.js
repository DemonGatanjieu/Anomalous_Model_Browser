import { el } from './usage_view.js';

/**
 * A folded part of GPT-SoVITS Settings (ui_tts_setup.js, ui_tts_presets.js): a title and one line
 * about it, the content under them. It opens by itself while it needs you (`attention`: a file
 * to download, a missing package); otherwise it stays as the user left it, across the dialog's
 * redraws and openings in this page session.
 */

const opened = new Map(); // id -> open, as the user left it

export function foldSection(id, title, meta, content, attention = false) {
    const fold = el('details', `anomalous-tts-fold${attention ? ' needs-you' : ''}`);
    fold.open = attention || opened.get(id) === true;
    const summary = el('summary', 'anomalous-tts-fold-head');
    summary.append(el('span', 'anomalous-tts-fold-title', title));
    if (meta) summary.append(el('span', 'anomalous-tts-fold-meta', meta));
    fold.append(summary, ...content);
    fold.addEventListener('toggle', () => opened.set(id, fold.open));
    return fold;
}
