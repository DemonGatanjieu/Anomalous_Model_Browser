import { api } from '../../../scripts/api.js';
import { t } from './interface_settings.js';
import { anomalousAlert, anomalousPrompt } from './ui_dialog.js';
import {
    cleanBox, cleanScript, copyDraft, deleteDraft, deletedDrafts, draftSpeakers, draftTitle, dropOldDeleted, emptyBox,
    findDraft, hasLines, keepScript, liveDrafts, makeDraft, mergeBoxes, putDraft, renameDraft, restoreDraft, whenKey,
} from './script_drafts.js';

/**
 * The voice-over drafts box (草稿箱): every script is kept as a draft, saved on its own half a
 * second after a change, in one file in ComfyUI's user folder (user/default/…), so it outlives
 * the browser's storage and a change of browser. The bar over the director names the open
 * draft (a click renames it) and leads to New, the box and Close; the box shows the drafts as
 * cards (open, rename, copy, delete) and Recently deleted (back for DELETED_DAYS).
 *
 * The director gives `capture()` (its script as script_drafts.js keeps it), `apply(script)`
 * (null: a blank script), `nameOf(key)` for the characters, `busy()` while a line is being
 * generated, and `redraw()`. A script becomes a draft once it has a line; one left without
 * lines is dropped. Before each write the file is read again and joined with this tab's box
 * (mergeBoxes), so two tabs do not undo each other. The draft the earlier version kept in
 * localStorage moves in once.
 */

const BOX_FILE = 'anomalous_model_browser/voice_over_drafts.json';
const OLD_DRAFT_KEY = 'anomalous_sd_draft';
const SAVE_AFTER = 500;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) btn.title = title;
    btn.onclick = onClick;
    return btn;
}

const when = (time) => {
    const { key, values } = whenKey(time);
    return t(key, values);
};

async function readFile() {
    const response = await api.getUserData(BOX_FILE);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return cleanBox(await response.json());
}

/** The draft the earlier version kept in this browser, once (null when there is none). */
function oldDraft() {
    try {
        const script = cleanScript(JSON.parse(localStorage.getItem(OLD_DRAFT_KEY) || 'null'));
        return hasLines(script) ? script : null;
    } catch (_) {
        return null;
    }
}

export function createDrafts({ capture, apply, nameOf, busy, redraw }) {
    let box = emptyBox();
    let loaded = false;     // the file was read: only then is it written
    let status = 'idle';    // 'idle' | 'saving' | 'saved' | 'failed' | 'unreadable'
    let timer = null;
    let writing = Promise.resolve();
    const self = { showing: false };

    const bar = el('div', 'anomalous-sd-drafts-bar');
    const view = el('div', 'anomalous-sd-drafts');
    view.hidden = true;

    const current = () => (box.current ? findDraft(box, box.current) : null);

    async function write() {
        status = 'saving';
        renderBar();
        try {
            const theirs = await readFile();
            box = theirs ? mergeBoxes(box, theirs) : box;
            dropOldDeleted(box);
            await api.storeUserData(BOX_FILE, box, { overwrite: true, stringify: true, throwOnError: true });
            status = 'saved';
        } catch (error) {
            console.warn('[Anomalous] voice-over drafts not saved:', error);
            status = 'failed';
        }
        render();
    }

    function save(now = false) {
        if (!loaded) return writing;
        clearTimeout(timer);
        const run = () => { writing = writing.then(write); return writing; };
        if (now) return run();
        timer = setTimeout(run, SAVE_AFTER);
        return writing;
    }

    /** The director's script changed: into its draft (a new one once it has a line). */
    function changed() {
        if (!loaded) return;
        const script = cleanScript(capture());
        const draft = current();
        if (!draft) {
            if (!hasLines(script)) return;
            box.current = putDraft(box, makeDraft(script)).id;
        } else if (JSON.stringify(draft.script) === JSON.stringify(script)) {
            return;
        } else {
            keepScript(box, draft.id, script);
        }
        save();
        renderBar();
    }

    /** Leaves the open draft (kept now; dropped when it has no lines); the next lines make a new one. */
    function detach() {
        changed();
        const draft = current();
        if (draft && !hasLines(draft.script)) box.drafts = box.drafts.filter(item => item !== draft);
        box.current = null;
        save(true);
    }

    async function blocked() {
        if (!busy?.()) return false;
        await anomalousAlert(t('draftsBusy'));
        return true;
    }

    async function startNew() {
        if (await blocked()) return;
        detach();
        apply(null);
        show(false);
    }

    async function close() {
        if (await blocked()) return;
        detach();
        apply(null);
        show(true);
    }

    async function open(id) {
        if (id === box.current) return show(false);
        if (await blocked()) return;
        const draft = findDraft(box, id);
        if (!draft) return;
        detach();
        box.current = id;
        apply(structuredClone(draft.script));
        save(true);
        show(false);
    }

    async function rename(id) {
        const draft = findDraft(box, id);
        if (!draft) return;
        const name = await anomalousPrompt(t('draftsRenamePrompt'), draft.name || draftTitle(draft), t('draftsRename'));
        if (name === null || name === undefined) return;
        renameDraft(box, id, name);
        save(true);
        render();
    }

    function copy(id) {
        const draft = findDraft(box, id);
        if (!draft) return;
        changed();
        copyDraft(box, id, t('draftsCopyName', { name: draftTitle(draft) || t('draftsUntitled') }));
        save(true);
        render();
    }

    async function remove(id) {
        if (id === box.current && await blocked()) return;
        if (id === box.current) {
            detach();
            apply(null);
        }
        deleteDraft(box, id);
        save(true);
        show(true);
    }

    function bringBack(id) {
        restoreDraft(box, id);
        save(true);
        render();
    }

    function show(on) {
        self.showing = on;
        redraw();
    }

    // ---------- drawing ----------

    function renderBar() {
        const draft = current();
        const items = [];
        if (self.showing) {
            items.push(el('span', 'anomalous-sd-drafts-title', t('draftsBox')));
        } else {
            const title = draft ? (draftTitle(draft) || t('draftsUntitled')) : t('draftsNewScript');
            const name = draft
                ? button('anomalous-sd-drafts-title is-button', title, () => rename(draft.id), t('draftsRenameHint'))
                : el('span', 'anomalous-sd-drafts-title', title);
            items.push(name);
        }
        const note = status === 'unreadable' ? t('draftsUnreadable')
            : status === 'failed' ? t('draftsSaveFailed')
                : status === 'saving' ? t('draftsSaving')
                    : draft && status === 'saved' ? t('draftsSaved') : '';
        const noteEl = el('span', `anomalous-sd-drafts-note${status === 'failed' || status === 'unreadable' ? ' is-error' : ''}`, note);
        items.push(noteEl, el('span', 'anomalous-sd-drafts-gap'));
        const count = liveDrafts(box).length;
        if (self.showing) {
            if (draft) items.push(button('anomalous-sd-btn', t('draftsBackToScript'), () => show(false)));
        } else {
            items.push(button('anomalous-sd-btn', `＋ ${t('draftsNew')}`, startNew, t('draftsNewHint')));
            items.push(button('anomalous-sd-btn', count ? t('draftsBoxCount', { count }) : t('draftsBox'), () => show(true)));
            if (draft) items.push(button('anomalous-sd-btn', t('draftsClose'), close, t('draftsCloseHint')));
        }
        bar.replaceChildren(...items);
    }

    function card(draft) {
        const item = el('div', `anomalous-sd-draft-card${draft.id === box.current ? ' is-current' : ''}`);
        const openBtn = button('anomalous-sd-draft-open', '', () => open(draft.id));
        const speakers = draftSpeakers(draft.script).map(nameOf).filter(Boolean);
        const lineCount = draft.script.lines.length;
        openBtn.append(
            el('span', 'anomalous-sd-draft-name', draftTitle(draft) || t('draftsUntitled')),
            el('span', 'anomalous-sd-draft-who', [speakers.slice(0, 3).join(' · ') + (speakers.length > 3 ? ' …' : ''), t('draftsLines', { count: lineCount })].filter(Boolean).join(' · ')),
            el('span', 'anomalous-sd-draft-when', draft.id === box.current ? t('draftsEditingNow') : when(draft.updated)),
        );
        const tools = el('div', 'anomalous-sd-draft-tools');
        tools.append(
            button('anomalous-sd-link-btn', t('draftsRename'), () => rename(draft.id)),
            button('anomalous-sd-link-btn', t('draftsCopy'), () => copy(draft.id)),
            button('anomalous-sd-link-btn is-danger', t('draftsDelete'), () => remove(draft.id), t('draftsDeleteHint')),
        );
        item.append(openBtn, tools);
        return item;
    }

    function renderView() {
        const live = liveDrafts(box);
        const grid = el('div', 'anomalous-sd-drafts-grid');
        grid.append(...live.map(card), button('anomalous-sd-draft-card is-new', `＋ ${t('draftsNewBlank')}`, startNew));
        const parts = [grid];
        if (!live.length) parts.unshift(el('p', 'anomalous-sd-drafts-empty', t('draftsEmpty')));
        const gone = deletedDrafts(box);
        if (gone.length) {
            const fold = el('details', 'anomalous-sd-drafts-deleted');
            fold.append(el('summary', '', t('draftsDeletedCount', { count: gone.length })));
            fold.append(el('p', 'anomalous-sd-drafts-hint', t('draftsDeletedHint')));
            for (const draft of gone) {
                const row = el('div', 'anomalous-sd-drafts-deleted-row');
                row.append(
                    el('span', 'anomalous-sd-draft-name', draftTitle(draft) || t('draftsUntitled')),
                    el('span', 'anomalous-sd-draft-when', t('draftsDeletedAt', { when: when(draft.deleted) })),
                    button('anomalous-sd-link-btn', t('draftsRestore'), () => bringBack(draft.id)),
                );
                fold.append(row);
            }
            parts.push(fold);
        }
        view.replaceChildren(...parts);
    }

    function render() {
        renderBar();
        view.hidden = !self.showing;
        if (self.showing) renderView();
    }

    /** Reads the box once; opens the draft that was open, or the box when drafts wait there. */
    async function start() {
        let theirs = null;
        try {
            theirs = await readFile();
        } catch (error) {
            console.warn('[Anomalous] voice-over drafts not read:', error);
            status = 'unreadable';
            render();
            return;
        }
        box = theirs || emptyBox();
        loaded = true;
        status = 'saved';
        let moved = false;
        const old = theirs ? null : oldDraft();
        if (old) {
            box.current = putDraft(box, makeDraft(old)).id;
            moved = true;
        }
        const typed = cleanScript(capture());
        if (hasLines(typed)) {
            // Lines came in before the box was read: they are a script of their own.
            box.current = putDraft(box, makeDraft(typed)).id;
            moved = true;
        } else if (current()) {
            apply(structuredClone(current().script));
        } else if (liveDrafts(box).length) {
            self.showing = true;
        }
        if (moved) {
            await save(true);
            if (status === 'saved') try { localStorage.removeItem(OLD_DRAFT_KEY); } catch (_) { /* it moves again next time */ }
        }
        redraw();
    }

    Object.assign(self, { bar, view, start, changed, detach, render });
    return self;
}
