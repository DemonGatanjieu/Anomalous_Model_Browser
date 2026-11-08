/**
 * The job sheet's rules (api/job_sheets.py keeps the sheet, job_sheet_run.js runs it, ui_job_sheet.js draws
 * it): pasted text into prompts, prompts into rows, which row and round a run is, the seed of a run, a row as
 * run_workflow's blanks (mcp_fill.js) and how a run ended by ComfyUI's history. The limits are the server's.
 * Pure.
 */

export const MAX_ROWS = 200;
export const MAX_COUNT = 50;
export const MAX_TOTAL = 1000;
export const MAX_PAUSE = 3600;

/** The prompts in pasted `text`: a line each, or with `blocks` a block each, blocks parted by an empty line. */
export function promptsOf(text, blocks = false) {
    const parts = String(text || '').replace(/\r\n?/g, '\n').split(blocks ? /\n[ \t]*\n/ : '\n');
    return parts.map(part => part.trim()).filter(Boolean);
}

/** A whole number in [low, high], else `fallback`. */
export function bounded(value, low, high, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(high, Math.max(low, Math.round(number))) : fallback;
}

/** The rows of `prompts`, each run `count` times; none: the workflow as it is, `count` times. */
export const rowsOf = (prompts, count) => (prompts.length ? prompts.map(prompt => ({ prompt, count })) : [{ count }]);

export const totalOf = rows => rows.reduce((sum, row) => sum + row.count, 0);

/** Run `index` of the sheet (0 based, rows in order, each row's runs together): its row and its round in the row. */
export function jobAt(rows, index) {
    let left = index;
    for (let row = 0; row < rows.length; row++) {
        if (left < rows[row].count) return { row, round: left };
        left -= rows[row].count;
    }
    return null;
}

/** The seed run `round` of a row gets: with the same seeds, round r has the same one in every row; else new ones (null). */
export const seedOf = (sheet, round) => (sheet.same_seeds ? sheet.base + round : null);

/** A row as run_workflow's blanks. */
export function slotsOf(row) {
    const slots = {};
    for (const key of ['prompt', 'negative', 'values']) if (row[key] != null) slots[key] = row[key];
    return slots;
}

/** How a run ended, from its record in ComfyUI's history (none: taken out of the queue): {outcome, why}. */
export function outcomeOf(record) {
    if (!record) return { outcome: 'gone', why: '' };
    const status = record.status || {};
    if (status.status_str !== 'error') return { outcome: 'ok', why: '' };
    const messages = (status.messages || []).filter(Array.isArray);
    if (messages.some(([kind]) => kind === 'execution_interrupted')) return { outcome: 'interrupted', why: '' };
    const failure = messages.find(([kind]) => kind === 'execution_error')?.[1] || {};
    const where = failure.node_type ? `${failure.node_type}: ` : '';
    return { outcome: 'error', why: `${where}${failure.exception_message || ''}`.trim().slice(0, 300) };
}

/** Milliseconds left of the pause after a run that ended at `ended` (0 at the start or with no pause). */
export const restLeft = (sheet, ended, now) => (sheet.pause > 0 && ended ? Math.max(0, ended + sheet.pause * 1000 - now) : 0);

/** Whether another run may go into ComfyUI's queue: none waits behind the one going with a pause, one without. */
export const room = sheet => (sheet.pending?.length || 0) < (sheet.pause > 0 ? 1 : 2);
