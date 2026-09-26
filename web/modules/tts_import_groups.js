import { importProblem, rowState, usableAsReference } from './tts_setup_api.js';

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
 * What a character still needs, in the order to do it: `{ id, done, key, params }`.
 * A new character needs a name, both weights, a clip and a main voice (GPT-SoVITS
 * takes 3–10 s references); adding to one needs any file. The first item not
 * done is the next step the card offers.
 */
export function draftChecklist({ target = null, name = '', rows, main = null, conflict = null, duplicate = false }) {
    if (target) {
        return [{ id: 'files', done: rows.length > 0, key: rows.length ? 'ttsCheckFilesDone' : 'ttsCheckFiles', params: { count: rows.length } }];
    }
    const weight = kind => rows.find(row => row.kind === kind && !row.error);
    const clips = rows.filter(row => row.kind === 'audio' && !row.error);
    const trimmed = name.trim();
    const sovits = weight('sovits');
    return [
        { id: 'gpt', done: Boolean(weight('gpt')), key: weight('gpt') ? 'ttsCheckGptDone' : 'ttsCheckGpt', params: {} },
        { id: 'sovits', done: Boolean(sovits) && sovits.supported !== false,
          key: !sovits ? 'ttsCheckSovits' : sovits.supported === false ? 'ttsCheckSovitsUnsupported' : 'ttsCheckSovitsDone', params: { version: sovits?.version || '?' } },
        { id: 'audio', done: clips.length > 0, key: clips.length ? 'ttsCheckAudioDone' : 'ttsCheckAudio', params: { count: clips.length } },
        { id: 'main', done: Boolean(main),
          key: main ? 'ttsCheckMainDone' : clips.length && clips.every(row => row.seconds !== undefined && !usableAsReference(row.seconds)) ? 'ttsCheckMainNone' : 'ttsCheckMain',
          params: { file: main || '' } },
        { id: 'name', done: Boolean(trimmed) && !conflict && !duplicate,
          key: !trimmed ? 'ttsCheckName' : conflict ? 'ttsCheckNameTaken' : duplicate ? 'ttsCheckNameTwice' : 'ttsCheckNameDone', params: { name: trimmed } },
    ];
}

/**
 * Where one character stands in the list: `done`, `busy` (uploading or importing),
 * `error` (a failed or refused file, a failed import), `needed` (still missing
 * something, `problem` = the reason's locale key and params) or `ready`. Each row is
 * `{ kind, name, emotion, error, uploaded, progress, existing, supported, version, seconds }`;
 * `main` is the main clip's name (a new character needs one).
 */
export function draftState({ target = null, name = '', rows, main = null, conflict = null, duplicate = false, done = false, failed = '', importing = false }) {
    if (done) return { tone: 'done', problem: null };
    const views = rows.map(row => rowState({ ...row, unsupported: row.supported === false }));
    if (importing || views.some(view => view.tone === 'busy')) return { tone: 'busy', problem: null };
    if (failed) return { tone: 'error', problem: ['ttsImportFailed', { error: failed }] };
    if (views.some(view => view.tone === 'error')) return { tone: 'error', problem: ['ttsBatchRowProblem', {}] };
    if (duplicate) return { tone: 'needed', problem: ['ttsBatchDuplicateName', { name: name.trim() }] };
    const problem = importProblem({ target, character: name, conflict, rows });
    if (problem) return { tone: 'needed', problem };
    if (!target && !rows.some(row => row.kind === 'audio')) return { tone: 'needed', problem: ['ttsBatchNoAudio', {}] };
    if (!target && !main) return { tone: 'needed', problem: ['ttsBatchNoMain', {}] };
    return { tone: 'ready', problem: null };
}
