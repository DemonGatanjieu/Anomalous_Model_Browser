/**
 * The voice-over drafts box, without DOM or storage: the shape of a kept script, the box that
 * holds them (one file in ComfyUI's user folder, ui_script_drafts.js), and how two copies of
 * it come together when another tab saved meanwhile.
 *
 * A box: `{ format: 1, current: id | null, drafts: [{ id, name, created, updated, deleted, script }] }`.
 * `script` is what the director keeps of a script: `{ format: 1, lines, groupKey, script, cast }`
 * (lines: `{ text, emotion, speaker, tune? }`; script and cast: the whole script's and each
 * character's settings, script_tune.js). `deleted` is when it went to Recently deleted (or null);
 * it comes back from there until DELETED_DAYS have passed.
 */

export const BOX_FORMAT = 1;
export const DELETED_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const NAME_MAX = 60;
const TITLE_FROM_LINE = 18;
const TUNE_FIELDS = { language: 'string', speed: 'number', preset: 'string' };

/** Only the line settings a draft may hold, with the right types (null when none). */
export function cleanTune(tune) {
    const out = {};
    for (const [field, type] of Object.entries(TUNE_FIELDS)) if (typeof tune?.[field] === type) out[field] = tune[field];
    return Object.keys(out).length ? out : null;
}

/** A kept script as the director can use it: lines without text or with a bad shape are left out. */
export function cleanScript(raw) {
    if (raw?.format !== 1 || !Array.isArray(raw.lines)) return null;
    const lines = raw.lines.filter(line => typeof line?.text === 'string' && line.text.trim()).map((line) => {
        const tune = cleanTune(line.tune);
        return {
            text: line.text,
            emotion: typeof line.emotion === 'string' ? line.emotion : 'main',
            speaker: typeof line.speaker === 'string' ? line.speaker : null,
            ...(tune ? { tune } : {}),
        };
    });
    const cast = {};
    for (const [character, own] of Object.entries(raw.cast && typeof raw.cast === 'object' ? raw.cast : {})) {
        if (cleanTune(own)) cast[character] = cleanTune(own);
    }
    return {
        format: 1,
        lines,
        groupKey: typeof raw.groupKey === 'string' ? raw.groupKey : null,
        script: cleanTune(raw.script) || {},
        cast,
    };
}

/** A script worth keeping: at least one line with text. */
export function hasLines(script) {
    return Boolean(script?.lines?.some(line => line.text.trim()));
}

export function emptyBox() {
    return { format: BOX_FORMAT, current: null, drafts: [] };
}

/** The box read from its file (anything unreadable gives an empty box; bad drafts are left out). */
export function cleanBox(raw) {
    if (raw?.format !== BOX_FORMAT || !Array.isArray(raw.drafts)) return emptyBox();
    const seen = new Set();
    const drafts = [];
    for (const item of raw.drafts) {
        const script = cleanScript(item?.script);
        if (typeof item?.id !== 'string' || !item.id || seen.has(item.id) || !script) continue;
        seen.add(item.id);
        const updated = Number.isFinite(item.updated) ? item.updated : 0;
        drafts.push({
            id: item.id,
            name: typeof item.name === 'string' ? item.name.slice(0, NAME_MAX) : '',
            created: Number.isFinite(item.created) ? item.created : updated,
            updated,
            deleted: Number.isFinite(item.deleted) ? item.deleted : null,
            script,
        });
    }
    const current = drafts.some(draft => draft.id === raw.current && !draft.deleted) ? raw.current : null;
    return { format: BOX_FORMAT, current, drafts };
}

export function newId(now = Date.now(), random = Math.random) {
    return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/** A new draft holding `script`. */
export function makeDraft(script, now = Date.now(), { name = '', id = newId(now) } = {}) {
    return { id, name: String(name).trim().slice(0, NAME_MAX), created: now, updated: now, deleted: null, script };
}

export const findDraft = (box, id) => box.drafts.find(draft => draft.id === id) || null;

/** Puts `draft` in the box (in place of the one with its id). */
export function putDraft(box, draft) {
    const at = box.drafts.findIndex(item => item.id === draft.id);
    if (at >= 0) box.drafts[at] = draft;
    else box.drafts.push(draft);
    return draft;
}

/** The script of draft `id` changed. */
export function keepScript(box, id, script, now = Date.now()) {
    const draft = findDraft(box, id);
    if (!draft) return null;
    draft.script = script;
    draft.updated = now;
    return draft;
}

export function renameDraft(box, id, name, now = Date.now()) {
    const draft = findDraft(box, id);
    if (!draft) return null;
    draft.name = String(name || '').trim().slice(0, NAME_MAX);
    draft.updated = now;
    return draft;
}

/** A copy of draft `id`, named after it. */
export function copyDraft(box, id, copyName, now = Date.now()) {
    const draft = findDraft(box, id);
    if (!draft) return null;
    return putDraft(box, makeDraft(structuredClone(draft.script), now, { name: copyName }));
}

/** To Recently deleted (it stops being the open one). */
export function deleteDraft(box, id, now = Date.now()) {
    const draft = findDraft(box, id);
    if (!draft) return null;
    draft.deleted = now;
    draft.updated = now;
    if (box.current === id) box.current = null;
    return draft;
}

export function restoreDraft(box, id, now = Date.now()) {
    const draft = findDraft(box, id);
    if (!draft) return null;
    draft.deleted = null;
    draft.updated = now;
    return draft;
}

/** Drops the drafts deleted more than DELETED_DAYS ago; true when any went. */
export function dropOldDeleted(box, now = Date.now()) {
    const before = box.drafts.length;
    box.drafts = box.drafts.filter(draft => !draft.deleted || now - draft.deleted < DELETED_DAYS * DAY);
    return box.drafts.length !== before;
}

/** The drafts to show, the last changed first. */
export function liveDrafts(box) {
    return box.drafts.filter(draft => !draft.deleted).sort((a, b) => b.updated - a.updated);
}

export function deletedDrafts(box) {
    return box.drafts.filter(draft => draft.deleted).sort((a, b) => b.deleted - a.deleted);
}

/**
 * This tab's box and the one in the file, together: each draft as it was changed last
 * (a deletion is a change). The draft open here stays as it is here.
 */
export function mergeBoxes(mine, theirs) {
    const byId = new Map(theirs.drafts.map(draft => [draft.id, draft]));
    for (const draft of mine.drafts) {
        const other = byId.get(draft.id);
        if (!other || draft.updated >= other.updated || draft.id === mine.current) byId.set(draft.id, draft);
    }
    const drafts = [...byId.values()];
    const current = drafts.some(draft => draft.id === mine.current && !draft.deleted) ? mine.current : null;
    return { format: BOX_FORMAT, current, drafts };
}

/** What a draft is called: its name, else its first line (shortened). '' when it has neither. */
export function draftTitle(draft) {
    if (draft?.name) return draft.name;
    const first = draft?.script?.lines?.find(line => line.text.trim())?.text.trim() || '';
    return first.length > TITLE_FROM_LINE ? `${first.slice(0, TITLE_FROM_LINE)}…` : first;
}

/** Who reads the draft, in the order they first speak (group keys; null lines read by the cast's pick). */
export function draftSpeakers(script) {
    const keys = [];
    for (const line of script?.lines || []) {
        const key = line.speaker || script.groupKey;
        if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
}

/**
 * When a draft was changed, as a locale key and its values: just now, minutes ago, today at,
 * yesterday at, or a date (month and day, with the year when it is not this one).
 */
export function whenKey(time, now = Date.now()) {
    const minutes = Math.floor((now - time) / 60000);
    if (minutes < 1) return { key: 'draftsJustNow' };
    if (minutes < 60) return { key: 'draftsMinutesAgo', values: { count: minutes } };
    const then = new Date(time);
    const today = new Date(now);
    const pad = n => String(n).padStart(2, '0');
    const clock = `${pad(then.getHours())}:${pad(then.getMinutes())}`;
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (time >= dayStart) return { key: 'draftsTodayAt', values: { time: clock } };
    if (time >= dayStart - DAY) return { key: 'draftsYesterdayAt', values: { time: clock } };
    const values = { month: then.getMonth() + 1, day: then.getDate(), year: then.getFullYear() };
    return { key: then.getFullYear() === today.getFullYear() ? 'draftsDate' : 'draftsDateYear', values };
}
