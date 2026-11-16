/**
 * Pure classification and preview masking for the Privacy Overview window (no DOM): splits a task's
 * record into what stays hidden from the AI ([P*], [img*], [M*] tokens + pixel privacy) versus what
 * the AI reads directly (title, unsealed text in messages/gists, user notes on tokens, canvas wiring
 * and numeric settings), so the UI renders honestly and unit tests check the boundary.
 */

export const MAX_SEALED_NOTE = 160;

const TOKEN_KIND = { P: 'prompts', img: 'pictures', M: 'models' };
const TOKEN_ORDER = { P: 0, img: 1, M: 2 };
const TOKEN_RE = /^\[([A-Za-z]+)(\d+)\]$/;
const MODEL_PREFIX_RE = /^([\w-]+):\d+:(.+)$/;
const MODEL_EXT_RE = /\.(safetensors|ckpt|pt|pth|bin)$/i;
const ANY_TOKEN_RE = /^\[(?:P|img|M)\d+\]$/;
const USER_MSG_TOOLS = new Set(['user_message', 'user_route', 'user_marks', 'user_pictures', 'user_toolbox']);

/** Numeric order for `[P2]` before `[P10]`. */
export function tokenOrder(token) {
    const match = TOKEN_RE.exec(String(token || ''));
    return match ? [match[1], Number(match[2])] : [String(token || ''), 0];
}

export function compareTokens(a, b) {
    const [ka, na] = tokenOrder(a);
    const [kb, nb] = tokenOrder(b);
    if (ka === kb) return na - nb;
    return (TOKEN_ORDER[ka] ?? 9) - (TOKEN_ORDER[kb] ?? 9) || ka.localeCompare(kb);
}

/** Split `"sub/file.png"` (or Windows slashes) into `{ path, subfolder, filename }`. */
export function parsePictureRef(raw) {
    const normalized = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const cut = normalized.lastIndexOf('/');
    if (cut < 0) return { path: normalized, subfolder: '', filename: normalized };
    return { path: normalized, subfolder: normalized.slice(0, cut), filename: normalized.slice(cut + 1) };
}

/** Parse `"type:idx:dir/file.safetensors"` into `{ type, file, name, raw }`. */
export function formatModelRef(raw) {
    const text = String(raw || '');
    const match = MODEL_PREFIX_RE.exec(text);
    const cleanFile = (match ? match[2] : text).replace(/\\/g, '/');
    const cut = cleanFile.lastIndexOf('/');
    return {
        type: match ? match[1] : '',
        file: cleanFile,
        name: cut >= 0 ? cleanFile.slice(cut + 1) : cleanFile,
        raw: text,
    };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectReplacements(sealed, sealedParts, hideModels) {
    const pairs = new Map();
    const put = (needle, token) => {
        if (!needle || needle.length < 2 || ANY_TOKEN_RE.test(needle)) return;
        if (!pairs.has(needle)) pairs.set(needle, token);
    };
    if (Array.isArray(sealedParts)) {
        for (const part of sealedParts) {
            if (part?.text && part?.token) put(String(part.text), String(part.token));
        }
    }
    for (const [token, rawValue] of Object.entries(sealed || {})) {
        const val = String(rawValue || '');
        if (!val) continue;
        if (token.startsWith('[P')) {
            put(val, token);
        } else if (token.startsWith('[img')) {
            const pic = parsePictureRef(val);
            put(val, token);
            put(pic.path, token);
            if (pic.filename && pic.filename.length >= 4) put(pic.filename, token);
        } else if (token.startsWith('[M') && hideModels !== false) {
            const model = formatModelRef(val);
            const winFile = model.file.replace(/\//g, '\\');
            const stem = model.name.replace(MODEL_EXT_RE, '');
            put(val, token);
            put(model.file, token);
            if (winFile !== model.file) put(winFile, token);
            if (model.name.length >= 4) put(model.name, token);
            if (stem.length >= 4) put(stem, token);
        }
    }
    return [...pairs.entries()].sort((a, b) => b[0].length - a[0].length);
}

/**
 * Show `text` as the AI sees it (replacing sealed segments, hidden picture refs, and hidden model
 * names with `[P*]`, `[img*]`, `[M*]`). Also returns `{ preview, segments, hasPlaintext }`.
 */
export function maskTextForView(text, sealed = {}, sealedParts = null, { hideModels = true } = {}) {
    const source = String(text || '');
    if (!source) return { preview: '', segments: [], hasPlaintext: false };
    const replacements = collectReplacements(sealed, sealedParts, hideModels);
    const map = new Map(replacements);
    const parts = [String.raw`\[(?:P|img|M)\d+\]`];
    for (const [needle] of replacements) parts.push(escapeRegExp(needle));
    const scanner = new RegExp(`(${parts.join('|')})`, 'g');
    const segments = [];
    let cursor = 0;
    for (const match of source.matchAll(scanner)) {
        const at = match.index ?? 0;
        if (at > cursor) segments.push({ type: 'text', text: source.slice(cursor, at) });
        const hit = match[0];
        const token = ANY_TOKEN_RE.test(hit) ? hit : map.get(hit);
        segments.push(token ? { type: 'token', token } : { type: 'text', text: hit });
        cursor = at + hit.length;
    }
    if (cursor < source.length) segments.push({ type: 'text', text: source.slice(cursor) });
    const preview = segments.map(seg => (seg.type === 'token' ? seg.token : seg.text)).join('');
    const plainOnly = segments.filter(seg => seg.type === 'text').map(seg => seg.text).join('');
    const hasPlaintext = plainOnly.replace(/[\s，。、；：,.!?:;"'()（）[\]【】『』「」…—-]+/g, '').length > 0;
    return { preview, segments, hasPlaintext };
}

function collectVisibleMessages(task, { hideModels }) {
    const sealed = task?.sealed || {};
    const messages = [];
    for (const step of task?.steps || []) {
        if (!step) continue;
        if (step.kind === 'user' && USER_MSG_TOOLS.has(step.tool)) {
            const raw = String(step.note || step.text || '').trim();
            if (!raw) continue;
            const masked = maskTextForView(raw, sealed, step.sealed_parts, { hideModels });
            messages.push({
                stepId: step.id,
                at: step.at || 0,
                tool: step.tool,
                delivered: Boolean(step.delivered),
                raw,
                ...masked,
            });
        } else if (step.kind === 'panel' && step.answers && typeof step.answers === 'object') {
            const promptGist = String(step.answers?.prompts?.gist || '').trim();
            const answerText = String(step.answers?.answer?.text || '').trim();
            const raw = promptGist || answerText;
            if (!raw) continue;
            const masked = maskTextForView(raw, sealed, null, { hideModels });
            messages.push({
                stepId: step.id,
                at: step.at || 0,
                tool: 'panel',
                delivered: Boolean(step.answers?.prompts?.delivered || step.answers?.answer?.delivered),
                raw,
                ...masked,
            });
        }
    }
    return messages;
}

function countGeneratedPictures(task) {
    const seen = new Set();
    for (const step of task?.steps || []) {
        for (const res of step?.results || []) {
            if (res?.type === 'image' && res?.filename) {
                seen.add(`${res.subfolder || ''}/${res.filename}`);
            }
        }
    }
    return seen.size;
}

function countUnassignedToolboxModels(task, sealedModels) {
    const sealedIds = new Set(sealedModels.map(item => item.raw));
    let missing = 0;
    for (const item of task?.toolbox?.models || []) {
        const id = typeof item === 'string' ? item : item?.model_id || item?.id || '';
        if (id && !sealedIds.has(id)) missing += 1;
    }
    return missing;
}

/** Build the complete structured view model for Privacy Overview from `task`. */
export function buildPrivacyOverview(task) {
    const isPrivate = task?.private === true;
    const privacyModels = task?.privacy_models !== false;
    const sealed = (task?.sealed && typeof task.sealed === 'object') ? task.sealed : {};
    const notes = (task?.sealed_notes && typeof task.sealed_notes === 'object') ? task.sealed_notes : {};
    const hidden = { prompts: [], pictures: [], models: [], generatedPictureCount: countGeneratedPictures(task), total: 0 };

    for (const token of Object.keys(sealed).sort(compareTokens)) {
        const kind = TOKEN_RE.exec(token)?.[1];
        const group = TOKEN_KIND[kind];
        if (!group) continue;
        const val = String(sealed[token] ?? '');
        const note = String(notes[token] || '');
        if (group === 'prompts') hidden.prompts.push({ token, text: val, note });
        else if (group === 'pictures') hidden.pictures.push({ token, ...parsePictureRef(val), note });
        else if (group === 'models') hidden.models.push({ token, ...formatModelRef(val), note, activeHidden: privacyModels });
    }
    hidden.total = hidden.prompts.length + hidden.pictures.length + hidden.models.length;

    const noteItems = Object.keys(sealed)
        .sort(compareTokens)
        .map(token => ({ token, note: String(notes[token] || '').trim() }))
        .filter(item => Boolean(item.note));

    return {
        private: isPrivate,
        privacyModels,
        readsDisk: Boolean(isPrivate && task?.reads_disk),
        client: task?.client || 'AI',
        notes: { ...notes },
        dirty: Boolean(task?.sealed_notes_dirty),
        hidden,
        unassignedToolboxModels: countUnassignedToolboxModels(task, hidden.models),
        visible: {
            title: String(task?.title || '').trim(),
            messages: collectVisibleMessages(task, { hideModels: privacyModels }),
            notes: noteItems,
            decisionsCount: Array.isArray(task?.decisions) ? task.decisions.length : 0,
        },
    };
}
