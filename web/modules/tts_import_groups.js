import { importProblem, rowState, usableAsReference } from './tts_setup_api.js';

/**
 * Batch import: sort dropped or scanned files into the characters being built.
 * Pure rules, no DOM. A folder holding one character's GPT and SoVITS weights is
 * that character, named by the folder; other weights name their character by the
 * file name without the epoch part. Clips and line files follow the character
 * folder they are in, then the folder their weights are in, the start of their
 * name, else the only character there is, else they wait unassigned for the user.
 */

const WEIGHT_TAIL = { gpt: /-e\d+.*$/i, sovits: /_e\d+.*$/i };
const SIDECAR = /\.(txt|lab)$/i;
const ANNOTATION = /\.list$/i;
const WEIGHT_DIR = /^(gpt|sovits)_weights/i;
const VERSION_DIR = /^v\d/i; // `v2`, `v2Pro`: named with the folder above (`派蒙 v2`)

/**
 * Folders never walked: Python environments and base models, anywhere; the program
 * and training folders of a GPT-SoVITS package (checkpoints, dataset slices, tool
 * models) only inside a package, since users name their own folders `output` or
 * `GPT_SoVITS` too. The same rules as the node's folder scan (Anomalous_TTS
 * `core/browse.py`, `skip_folder` / `is_package`).
 */
const ALWAYS_SKIP = new Set(['runtime', 'pretrained_models', '__pycache__', 'site-packages', 'venv', 'node_modules']);
const PACKAGE_SKIP = new Set(['gpt_sovits', 'logs', 'output', 'temp', 'tools']);
const PACKAGE_FILES = new Set(['webui.py', 'api.py', 'api_v2.py', 'inference_webui.py', 's1_train.py', 's2_train.py']);
export const DROP_FILE_LIMIT = 5000; // files taken from one drop or folder, like the node's scan

/** Whether a folder holding `names` (its sub-folders and files) is a GPT-SoVITS package or program. */
export function isPackage(names) {
    return [...names].some((name) => {
        const lower = String(name).toLowerCase();
        return lower === 'runtime' || PACKAGE_FILES.has(lower) || WEIGHT_DIR.test(lower);
    });
}

/** Whether sub-folder `name` of a folder is left out (`inPackage`: that folder is a package); hidden ones always are. */
export function skipFolder(name, inPackage) {
    const lower = String(name || '').toLowerCase();
    return lower.startsWith('.') || ALWAYS_SKIP.has(lower) || (inPackage && PACKAGE_SKIP.has(lower));
}

/**
 * For a flat file list (the browser's folder dialog): `{ kept, skipped }`, the indexes of
 * files outside left-out folders and those folders. `files`: `{ dir, name }`, `dir` starting
 * with the chosen folder, which is never left out.
 */
export function sortOutFolders(files) {
    const children = new Map(); // folder -> names of its files and sub-folders
    const addChild = (dir, name) => {
        if (!children.has(dir)) children.set(dir, new Set());
        children.get(dir).add(name);
    };
    for (const file of files) {
        const parts = String(file.dir || '').split('/').filter(Boolean);
        parts.forEach((part, i) => addChild(parts.slice(0, i).join('/'), part));
        addChild(parts.join('/'), file.name);
    }
    const verdict = new Map(); // dir -> the left-out folder above it, or ''
    const skippedOf = (dir) => {
        if (verdict.has(dir)) return verdict.get(dir);
        const parts = dir.split('/').filter(Boolean);
        let found = '';
        for (let i = 1; i < parts.length && !found; i++) {
            const parent = parts.slice(0, i).join('/');
            if (skipFolder(parts[i], isPackage(children.get(parent) || []))) found = parts.slice(0, i + 1).join('/');
        }
        verdict.set(dir, found);
        return found;
    };
    const kept = [];
    const skipped = new Set();
    files.forEach((file, i) => {
        const folder = skippedOf(String(file.dir || ''));
        if (folder) skipped.add(folder);
        else kept.push(i);
    });
    return { kept, skipped: [...skipped] };
}

/**
 * Rows the import leaves out: clips whose measured length is outside 3–10 s (the node
 * cannot use them as a reference or an emotion) and their same-name .txt / .lab line
 * files. Rows are `{ kind, name, seconds }`; returns a Set of their indexes.
 */
export function leftOut(rows) {
    const stem = name => String(name || '').replace(/\.[^.]+$/, '').toLowerCase();
    const out = new Set();
    const kept = new Set();
    rows.forEach((row, i) => {
        if (row.kind !== 'audio') return;
        if (row.seconds !== undefined && !usableAsReference(row.seconds)) out.add(i);
        else kept.add(stem(row.name));
    });
    const outStems = new Set([...out].map(i => stem(rows[i].name)));
    rows.forEach((row, i) => {
        if (row.kind === 'text' && SIDECAR.test(row.name) && outStems.has(stem(row.name)) && !kept.has(stem(row.name))) out.add(i);
    });
    return out;
}

const keptRows = (rows) => {
    const out = leftOut(rows);
    return rows.filter((_, i) => !out.has(i));
};

/** Grouping key: case, spaces, `_`, `-` and `.` do not count. */
export function groupKey(name) {
    return String(name || '').toLowerCase().replace(/[\s_.-]+/g, '');
}

/** The character a weight file belongs to: `ALuoNa-e15.ckpt` and `ALuoNa_e16_s224.pth` → `ALuoNa`. */
export function weightStem(name, kind) {
    const base = String(name || '').replace(/\.[^.]+$/, '');
    return base.replace(WEIGHT_TAIL[kind], '').replace(/^[\s_-]+|[\s_-]+$/g, '') || base;
}

const parentOf = dir => (dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
const baseOf = dir => dir.slice(dir.lastIndexOf('/') + 1);
const within = (dir, folder) => dir === folder || dir.startsWith(`${folder}/`);

/** Longest draft key a folder on `dir` or the file name points at, or null. */
function matchKey(item, keys) {
    const segments = String(item.dir || '').split('/').map(groupKey).filter(segment => segment.length >= 2);
    const byFolder = keys.filter(key => segments.some(segment => segment === key || segment.startsWith(key) || key.startsWith(segment)));
    const byName = keys.filter(key => groupKey(item.name).startsWith(key));
    const pick = list => list.reduce((best, key) => (best === null || key.length > best.length ? key : best), null);
    return pick(byFolder) ?? pick(byName);
}

/**
 * The character a file belongs to by where it sits: the nearest folder above it
 * (its own folder first) that holds weights decides, when those weights name one
 * character, or several where one name starts all the others (`Guang` and
 * `Guang_v4` → `Guang`). `weights`: `[{ dir, key }]`. null when no folder decides
 * (the top of the drop is left to the name rules).
 */
function ownerByFolder(dir, weights) {
    let at = String(dir || '');
    while (at) {
        const inside = new Set(weights.filter(w => within(w.dir, at)).map(w => w.key));
        if (inside.size) {
            const list = [...inside];
            return list.find(key => list.every(other => other.startsWith(key))) ?? null;
        }
        at = parentOf(at);
    }
    return null;
}

/**
 * Character folders: the deepest folders whose weights (sub-folders included) are GPT
 * weights of one name and SoVITS weights of one name, and which hold clips or line
 * files too: `派蒙/model-e10.ckpt` + `派蒙/model_e10.pth` + `派蒙/1.wav` → `派蒙`
 * (`派蒙/模型/`, weights only, is not). Not the top of what was added when that has no
 * name, and not a folder whose weights sit in `GPT_weights*` / `SoVITS_weights*`
 * folders (a package: its characters are named by their weights). A version folder
 * (`v2`) is named with the folder above it. `weights`: `[{ dir, kind, stem }]`;
 * `otherDirs`: the folders of the other files. Returns `Map(folder → { key, name })`,
 * keys unique among themselves.
 */
function characterFolders(weights, otherDirs) {
    const candidates = new Set();
    for (const w of weights) for (let at = w.dir; at; at = parentOf(at)) candidates.add(at);
    const qualifies = [...candidates].filter((folder) => {
        const inside = weights.filter(w => within(w.dir, folder));
        const stems = kind => new Set(inside.filter(w => w.kind === kind).map(w => w.stem));
        if (stems('gpt').size !== 1 || stems('sovits').size !== 1) return false;
        if (!otherDirs.some(dir => within(dir, folder))) return false;
        return !inside.some(w => w.dir.slice(folder.length).split('/').some(part => WEIGHT_DIR.test(part)));
    });
    const deepest = qualifies.filter(folder => !qualifies.some(other => other !== folder && within(other, folder)));
    const found = new Map();
    const used = new Set();
    for (const folder of deepest.sort()) {
        const base = baseOf(folder);
        const name = VERSION_DIR.test(base) && parentOf(folder) ? `${baseOf(parentOf(folder))} ${base}` : base;
        let key = groupKey(name);
        if (!key || used.has(key)) key = groupKey(folder);
        used.add(key);
        found.set(folder, { key, name });
    }
    return found;
}

/** The segments all `dirs` share at their start: the chosen folder, when one folder was added. */
function commonRoot(dirs) {
    const lists = dirs.map(dir => String(dir || '').split('/').filter(Boolean));
    const root = [];
    for (let i = 0; lists.length && lists.every(parts => parts.length > i && parts[i] === lists[0][i]); i++) root.push(lists[0][i]);
    return root.length;
}

/**
 * `items`: `{ name, dir, kind }`; `drafts`: the characters already open, `{ key, target }`.
 * Returns `{ added: [{ key, name }], assign: [key | null per item], shared: [index] }`: new
 * characters to open (character folders and weight stems not open yet, or one blank one
 * when nothing else is open), where each item goes (see the module comment), and
 * annotation files (`.list`) no character claims: they hold lines for everyone's clips,
 * so each character gets a copy. Adding to one existing character takes everything into it.
 */
export function groupFiles(items, drafts) {
    const keys = drafts.map(draft => draft.key);
    const added = [];
    const addKey = (key, name) => {
        if (key && !keys.includes(key)) {
            keys.push(key);
            added.push({ key, name });
        }
    };
    const soleTarget = drafts.length === 1 && drafts[0].target ? drafts[0].key : null;
    const isWeight = item => item.kind === 'gpt' || item.kind === 'sovits';
    const weights = items.map((item, index) => ({ item, index })).filter(({ item }) => isWeight(item))
        .map(({ item, index }) => ({ index, dir: String(item.dir || ''), kind: item.kind, name: weightStem(item.name, item.kind) }))
        .map(w => ({ ...w, stem: groupKey(w.name) }))
        .filter(w => w.stem);
    const otherDirs = items.filter(item => !isWeight(item)).map(item => String(item.dir || ''));
    const folders = soleTarget ? new Map() : characterFolders(weights, otherDirs);
    const folderOf = (dir) => {
        for (let at = String(dir || ''); at; at = parentOf(at)) if (folders.has(at)) return folders.get(at);
        return null;
    };
    for (const w of weights) {
        const folder = folderOf(w.dir);
        w.key = folder ? folder.key : w.stem;
        if (!soleTarget) addKey(w.key, folder ? folder.name : w.name);
    }
    if (!keys.length) {
        keys.push('');
        added.push({ key: '', name: '' });
    }
    const only = keys.length === 1 ? keys[0] : null;
    const weightKey = new Map(weights.map(w => [w.index, w.key]));
    // The only character takes the rest, unless its weights sit in their own folder and the
    // file in another one: then it is someone else's (or nobody's) and waits unassigned.
    const depth = commonRoot(items.map(item => item.dir));
    const topFolder = (dir) => {
        const top = String(dir || '').split('/').filter(Boolean)[depth] || '';
        return WEIGHT_DIR.test(top) ? '' : top; // a package's own weight folders count as the top
    };
    const weightTops = new Set(weights.map(w => topFolder(w.dir)));
    const fallback = item => (weightTops.size && !weightTops.has('') && !weightTops.has(topFolder(item.dir)) ? null : only);
    const assign = items.map((item, index) => {
        if (soleTarget !== null) return soleTarget;
        if (isWeight(item)) return weightKey.get(index) ?? only;
        return folderOf(item.dir)?.key ?? ownerByFolder(item.dir, weights) ?? matchKey(item, keys.filter(Boolean)) ?? fallback(item);
    });
    const shared = keys.some(Boolean) ? items.map((item, i) => i).filter(i => assign[i] === null && ANNOTATION.test(items[i].name)) : [];
    return { added, assign, shared };
}

/**
 * One add as groups, one per character it goes to: `{ key, name, open, tray, items }`,
 * characters already open first (`open`), then new ones in the order they were found,
 * then the files no character claims (`tray`). Shared annotation files go into every
 * character group of the add. `drafts` as for groupFiles.
 */
export function planGroups(items, drafts) {
    const { added, assign, shared } = groupFiles(items, drafts);
    const groups = new Map(drafts.map(draft => [draft.key, { key: draft.key, name: '', open: true, tray: false, items: [] }]));
    for (const add of added) groups.set(add.key, { key: add.key, name: add.name, open: false, tray: false, items: [] });
    const tray = { key: null, name: '', open: false, tray: true, items: [] };
    const common = new Set(shared);
    items.forEach((item, i) => {
        if (!common.has(i)) (assign[i] === null ? tray : groups.get(assign[i])).items.push(item);
    });
    const list = [...groups.values()].filter(group => group.items.length);
    for (const group of list.length ? list : [tray]) group.items.push(...shared.map(i => items[i]));
    return tray.items.length ? [...list, tray] : list;
}

/**
 * New names for files that would clash inside one character: two `01.wav` from the
 * folders `开心` and `难过` (GPT-SoVITS keeps clips in one folder). The first folder
 * keeps its names; files from another folder get its name in front (`难过_01.wav`),
 * clip and same-name line file alike, so they still pair up. `items`: `{ name, dir, kind }`
 * to place; `taken`: `{ name, dir }` already there. Weights are never renamed (one per
 * character). Returns the name for each item.
 */
export function clashFreeNames(items, taken = []) {
    const stem = name => name.replace(/\.[^.]+$/, '');
    const used = new Set();
    const owner = new Map(); // lower-case stem -> the folder whose files use it
    const claim = (name, dir) => {
        used.add(name.toLowerCase());
        if (!owner.has(stem(name.toLowerCase()))) owner.set(stem(name.toLowerCase()), dir);
    };
    for (const row of taken) claim(String(row.name), String(row.dir || ''));
    return items.map((item) => {
        const name = String(item.name);
        const dir = String(item.dir || '');
        if (item.kind === 'gpt' || item.kind === 'sovits') return name;
        const lower = name.toLowerCase();
        const holder = owner.get(stem(lower));
        if (!used.has(lower) && (holder === undefined || holder === dir)) {
            claim(name, dir);
            return name;
        }
        const prefix = (baseOf(dir) || 'file').replace(/[<>:"/\\|?*]/g, '_');
        let candidate = `${prefix}_${name}`;
        for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${prefix}${n}_${name}`;
        claim(candidate, dir);
        return candidate;
    });
}

/**
 * How much of a large add opens now: groups going to characters already open always,
 * then new characters in order until `characters` of them or `files` files (at least
 * one), and the unassigned files. The rest waits for "next batch", so a big folder
 * does not open hundreds of cards and uploads at once. `groups`: `{ open, tray, items }`.
 */
export function splitBatch(groups, { characters = 20, files = 800 } = {}) {
    const now = [];
    const later = [];
    let count = 0;
    let size = 0;
    for (const group of groups) {
        if (group.open || group.tray) { now.push(group); continue; }
        if (later.length || (count && (count >= characters || size + group.items.length > files))) { later.push(group); continue; }
        now.push(group);
        count++;
        size += group.items.length;
    }
    return { now, later };
}

/**
 * What a character still needs, in the order to do it: `{ id, done, key, params }`.
 * A new character needs a name, both weights, a clip and a main voice (GPT-SoVITS
 * takes 3–10 s references); adding to one needs any file. The first item not
 * done is the next step the card offers.
 */
export function draftChecklist({ target = null, name = '', rows: all, main = null, conflict = null, duplicate = false }) {
    const rows = keptRows(all);
    const skipped = all.length - rows.length;
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
        { id: 'audio', done: clips.length > 0, key: clips.length ? 'ttsCheckAudioDone' : skipped ? 'ttsCheckAudioNoneUsable' : 'ttsCheckAudio',
          params: { count: clips.length } },
        { id: 'main', done: Boolean(main), key: main ? 'ttsCheckMainDone' : 'ttsCheckMain', params: { file: main || '' } },
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
export function draftState({ target = null, name = '', rows: all, main = null, conflict = null, duplicate = false, done = false, failed = '', importing = false }) {
    if (done) return { tone: 'done', problem: null };
    const rows = keptRows(all);
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
