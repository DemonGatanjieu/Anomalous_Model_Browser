import { importProblem, rowState } from './tts_setup_api.js';

/**
 * Batch import: sort dropped or scanned files into the characters being built.
 * Pure rules, no DOM. A GPT / SoVITS weight names its character (the file name
 * without the epoch part); clips and line files follow the folder they are in or
 * the start of their name, else the only character there is, else they wait
 * unassigned for the user.
 */

const WEIGHT_TAIL = { gpt: /-e\d+.*$/i, sovits: /_e\d+.*$/i };

/** Grouping key: case, spaces, `_`, `-` and `.` do not count. */
export function groupKey(name) {
    return String(name || '').toLowerCase().replace(/[\s_.-]+/g, '');
}

/** The character a weight file belongs to: `ALuoNa-e15.ckpt` and `ALuoNa_e16_s224.pth` → `ALuoNa`. */
export function weightStem(name, kind) {
    const base = String(name || '').replace(/\.[^.]+$/, '');
    return base.replace(WEIGHT_TAIL[kind], '').replace(/^[\s_-]+|[\s_-]+$/g, '') || base;
}

/** Longest draft key a folder on `dir` or the file name points at, or null. */
function matchKey(item, keys) {
    const segments = String(item.dir || '').split('/').map(groupKey).filter(segment => segment.length >= 2);
    const byFolder = keys.filter(key => segments.some(segment => segment === key || segment.startsWith(key) || key.startsWith(segment)));
    const byName = keys.filter(key => groupKey(item.name).startsWith(key));
    const pick = list => list.reduce((best, key) => (best === null || key.length > best.length ? key : best), null);
    return pick(byFolder) ?? pick(byName);
}

/**
 * `items`: `{ name, dir, kind }`; `drafts`: the characters already open, `{ key, target }`.
 * Returns `{ added: [{ key, name }], assign: [key | null per item] }`: new characters to
 * open (one per weight stem not open yet, or one blank one when nothing else is open),
 * and where each item goes. Adding to one existing character takes everything into it.
 */
export function groupFiles(items, drafts) {
    const keys = drafts.map(draft => draft.key);
    const added = [];
    const soleTarget = drafts.length === 1 && drafts[0].target ? drafts[0].key : null;
    if (!soleTarget) {
        for (const item of items) {
            if (item.kind !== 'gpt' && item.kind !== 'sovits') continue;
            const name = weightStem(item.name, item.kind);
            const key = groupKey(name);
            if (key && !keys.includes(key)) {
                keys.push(key);
                added.push({ key, name });
            }
        }
    }
    if (!keys.length) {
        keys.push('');
        added.push({ key: '', name: '' });
    }
    const only = keys.length === 1 ? keys[0] : null;
    const assign = items.map(item => {
        if (soleTarget !== null) return soleTarget;
        if (item.kind === 'gpt' || item.kind === 'sovits') return groupKey(weightStem(item.name, item.kind)) || only;
        return matchKey(item, keys.filter(Boolean)) ?? only;
    });
    return { added, assign };
}

/**
 * Where one character stands in the list: `done`, `busy` (uploading or importing),
 * `error` (a failed or refused file, a failed import), `needed` (still missing
 * something, `problem` = the reason's locale key and params) or `ready`. Each row is
 * `{ kind, name, emotion, error, uploaded, progress, existing, supported, version }`.
 */
export function draftState({ target = null, name = '', rows, conflict = null, duplicate = false, done = false, failed = '', importing = false }) {
    if (done) return { tone: 'done', problem: null };
    const views = rows.map(row => rowState({ ...row, unsupported: row.supported === false }));
    if (importing || views.some(view => view.tone === 'busy')) return { tone: 'busy', problem: null };
    if (failed) return { tone: 'error', problem: ['ttsImportFailed', { error: failed }] };
    if (views.some(view => view.tone === 'error')) return { tone: 'error', problem: ['ttsBatchRowProblem', {}] };
    if (duplicate) return { tone: 'needed', problem: ['ttsBatchDuplicateName', { name: name.trim() }] };
    const problem = importProblem({ target, character: name, conflict, rows });
    if (problem) return { tone: 'needed', problem };
    if (!target && !rows.some(row => row.kind === 'audio')) return { tone: 'needed', problem: ['ttsBatchNoAudio', {}] };
    return { tone: 'ready', problem: null };
}
