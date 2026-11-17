/**
 * Pure classification and preview masking for the Privacy Overview window (no DOM): splits a task's
 * record into what stays hidden from the AI ([P*], [img*], [M*] tokens + pixel privacy) versus what
 * the AI reads directly (title, unsealed text in messages/gists, exposed prompt pieces, user notes
 * on tokens, canvas wiring and numeric settings), plus per-model exposure states and tag-split helpers,
 * and the prompts as written, slot by slot, for the side-by-side view (promptMirror).
 */

import { splitPrompt } from './prompt_tags.js';

export const MAX_SEALED_NOTE = 160;

const TOKEN_KIND = { P: 'prompts', img: 'pictures', M: 'models' };
const TOKEN_ORDER = { P: 0, img: 1, M: 2 };
const TOKEN_RE = /^\[([A-Za-z]+)(\d+)\]$/;
const MODEL_PREFIX_RE = /^([\w-]+):\d+:(.+)$/;
const MODEL_EXT_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$/i;
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

/**
 * A hidden prompt as Prompt Studio cuts it (prompt_tags.js): { mode, items: [{ text, sep }] }. Three or more
 * short tags are picked one by one ('tags'); anything else is one text, picked by selecting ('text').
 */
export function promptChunks(text) {
    const { items } = splitPrompt(text);
    const tags = items.filter(item => item.text);
    return { mode: tags.length >= 3 && tags.every(item => item.text.length <= 72) ? 'tags' : 'text', items };
}

/**
 * The parts ({ text, hide }) of `text` for a split (POST privacy_rules split_prompt): they spell `text`
 * exactly, the tags at `shown` (indexes into promptChunks().items) let through. A separator between two
 * hidden tags stays hidden with them, so the AI gets one token for each run of hidden tags.
 */
export function partsShowingTags(text, shown) {
    const { lead, items } = splitPrompt(text);
    const parts = [{ text: lead, hide: false }];
    items.forEach((item, index) => {
        const hide = !shown.has(index);
        parts.push({ text: item.text, hide }, { text: item.sep, hide: hide && index + 1 < items.length && !shown.has(index + 1) });
    });
    return parts.filter(part => part.text).reduce((runs, part) => {
        const last = runs[runs.length - 1];
        if (last && last.hide === part.hide) last.text += part.text;
        else runs.push({ ...part });
        return runs;
    }, []);
}

/** The parts of `text` with `text.slice(start, end)` let through and the rest hidden. */
export function partsShowingRange(text, start, end) {
    return [[0, start, true], [start, end, false], [end, text.length, true]]
        .map(([from, to, hide]) => ({ text: text.slice(from, to), hide }))
        .filter(part => part.text);
}

/**
 * The prompts as the user wrote them, for the overview's side-by-side view: each written once (a prompt split
 * by letting words through, `sealed_views`, as its first text, the tokens kept of it inside it), as
 * { token, slots } in its own order. A slot { text, shown } let through is shown; hidden again afterwards
 * (seal_message_phrase) it names the token now covering it. A hidden slot names the active token holding
 * it and its index among that token's tags (partsShowingTags), -1 when the token is one text.
 */
export function promptMirror(task, prompts) {
    const sealed = task?.sealed || {};
    const legacy = task?.sealed_legacy || {};
    const views = task?.sealed_views || {};
    const kept = new Set((task?.exposed_prompts || []).flatMap(item => item?.kept || []));
    const byText = new Map(prompts.map(item => [item.text, item.token]));
    const inside = new Set();
    const hiddenSlots = (token, asTags) => {
        inside.add(token);
        const own = String(sealed[token] ?? '');
        if (!asTags) return [{ text: own, shown: false, token, index: -1 }];
        return splitPrompt(own).items.map((item, index) => ({ text: item.text, shown: false, token, index })).filter(slot => slot.text);
    };
    const shownSlots = text => splitPrompt(text).items.filter(item => item.text).map((item) => {
        const token = byText.get(item.text);
        if (!token) return { text: item.text, shown: true };
        inside.add(token);
        return { text: item.text, shown: false, token, index: -1 };
    });
    const rows = [];
    for (const [token, view] of Object.entries(views)) {
        if (legacy[token] === undefined || kept.has(token)) continue;
        const asTags = promptChunks(String(legacy[token])).mode === 'tags';
        const slots = [];
        for (const piece of String(view).split(/(\[P\d+\])/)) {
            if (/^\[P\d+\]$/.test(piece)) {
                if (sealed[piece] !== undefined) slots.push(...hiddenSlots(piece, asTags));
            } else if (piece.trim()) {
                slots.push(...(asTags ? shownSlots(piece) : [{ text: piece.trim(), shown: true }]));
            }
        }
        rows.push({ token, slots });
    }
    for (const item of prompts) {
        if (!kept.has(item.token) && !inside.has(item.token)) rows.push({ token: item.token, slots: hiddenSlots(item.token, item.chunks?.mode === 'tags') });
    }
    return rows.sort((a, b) => compareTokens(a.token, b.token));
}

/** Find a matching token like `[img1]` or `[M1]` for a raw value / basename inside `sealed`. */
export function matchingTokenFor(value, sealed, prefix = '[') {
    const needle = String(value || '').replace(/\\/g, '/').trim();
    if (!needle || !sealed) return '';
    const lower = needle.toLowerCase();
    const needleStem = lower.split('/').pop().replace(MODEL_EXT_RE, '');
    for (const [token, rawVal] of Object.entries(sealed)) {
        if (!token.startsWith(prefix)) continue;
        const val = String(rawVal || '').replace(/\\/g, '/').toLowerCase();
        const file = MODEL_PREFIX_RE.test(rawVal) ? rawVal.replace(MODEL_PREFIX_RE, '$2').replace(/\\/g, '/').toLowerCase() : val;
        const stem = file.split('/').pop().replace(MODEL_EXT_RE, '');
        if (val === lower || file === lower || file.split('/').pop() === lower || (needleStem.length >= 3 && stem === needleStem)) {
            return token;
        }
    }
    return '';
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectReplacements(sealed, sealedParts, hideModels, publicSet, privateSet) {
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
        } else if (token.startsWith('[M')) {
            const isHidden = privateSet?.has(val) ? true : publicSet?.has(val) ? false : hideModels !== false;
            if (!isHidden) continue;
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
 * names with `[P*]`, `[img*]`, `[M*]`). Returns `{ preview, segments, hasPlaintext }`.
 */
export function maskTextForView(text, sealed = {}, sealedParts = null, { hideModels = true, publicModels = [], privateModels = [] } = {}) {
    const source = String(text || '');
    if (!source) return { preview: '', segments: [], hasPlaintext: false };
    const replacements = collectReplacements(sealed, sealedParts, hideModels, new Set(publicModels), new Set(privateModels));
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

function collectVisibleMessages(task, opts) {
    const sealed = task?.sealed || {};
    const messages = [];
    for (const step of task?.steps || []) {
        if (!step) continue;
        if (step.kind === 'user' && USER_MSG_TOOLS.has(step.tool)) {
            const raw = String(step.note || step.text || '').trim();
            if (!raw) continue;
            const masked = maskTextForView(raw, sealed, step.sealed_parts, opts);
            // Words hidden after the AI read the message: it saw them as they were.
            const late = step.delivered && step.delivered_at
                ? [...new Set((step.sealed_parts || []).filter(part => Number(part?.at) > step.delivered_at).map(part => part.token))] : [];
            messages.push({
                stepId: step.id,
                at: step.at || 0,
                tool: step.tool,
                delivered: Boolean(step.delivered),
                late,
                raw,
                ...masked,
            });
        } else if (step.kind === 'panel' && step.answers && typeof step.answers === 'object') {
            const promptGist = String(step.answers?.prompts?.gist || '').trim();
            const answerText = String(step.answers?.answer?.text || '').trim();
            const raw = promptGist || answerText;
            if (!raw) continue;
            const masked = maskTextForView(raw, sealed, step.sealed_parts, opts);
            messages.push({
                stepId: step.id,
                at: step.at || 0,
                tool: 'panel',
                delivered: Boolean(step.answers?.prompts?.delivered || step.answers?.answer?.delivered),
                late: [],
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

function buildModelCatalog(task, sealed, legacy, notes, privacyModels, publicSet, privateSet) {
    const byId = new Map();
    const upsert = (rawId, token = '', legacyToken = '') => {
        const id = String(rawId || '').trim();
        if (!id) return;
        const parsed = formatModelRef(id);
        const existing = byId.get(id);
        const override = privateSet.has(id) ? 'private' : publicSet.has(id) ? 'public' : 'default';
        const hidden = override === 'private' ? true : override === 'public' ? false : privacyModels;
        const activeToken = token || existing?.token || '';
        const prevToken = legacyToken || existing?.legacyToken || '';
        byId.set(id, {
            ...parsed,
            id,
            token: activeToken,
            legacyToken: prevToken,
            override,
            hidden,
            note: activeToken ? String(notes[activeToken] || '') : existing?.note || '',
        });
    };
    for (const tok of Object.keys(sealed).sort(compareTokens)) {
        if (tok.startsWith('[M')) upsert(sealed[tok], tok, '');
    }
    for (const tok of Object.keys(legacy).sort(compareTokens)) {
        if (tok.startsWith('[M')) upsert(legacy[tok], '', tok);
    }
    for (const item of task?.toolbox?.models || []) {
        upsert(typeof item === 'string' ? item : item?.model_id || item?.id || '');
    }
    for (const item of task?.about || []) {
        if (item?.type === 'model' && item?.model_id) upsert(item.model_id);
    }
    return [...byId.values()];
}

/** Build the complete structured view model for Privacy Overview from `task`. */
export function buildPrivacyOverview(task) {
    const isPrivate = task?.private === true;
    const privacyModels = task?.privacy_models !== false;
    const sealed = (task?.sealed && typeof task.sealed === 'object') ? task.sealed : {};
    const legacy = (task?.sealed_legacy && typeof task.sealed_legacy === 'object') ? task.sealed_legacy : {};
    const notes = (task?.sealed_notes && typeof task.sealed_notes === 'object') ? task.sealed_notes : {};
    const publicModels = Array.isArray(task?.public_models) ? task.public_models : [];
    const privateModels = Array.isArray(task?.private_models) ? task.private_models : [];
    const publicSet = new Set(publicModels);
    const privateSet = new Set(privateModels);

    const hidden = { prompts: [], pictures: [], models: [], generatedPictureCount: countGeneratedPictures(task), total: 0 };

    for (const token of Object.keys(sealed).sort(compareTokens)) {
        const kind = TOKEN_RE.exec(token)?.[1];
        const group = TOKEN_KIND[kind];
        if (!group) continue;
        const val = String(sealed[token] ?? '');
        const note = String(notes[token] || '');
        if (group === 'prompts') hidden.prompts.push({ token, text: val, note, chunks: promptChunks(val) });
        else if (group === 'pictures') hidden.pictures.push({ token, ...parsePictureRef(val), note });
        else if (group === 'models') {
            const override = privateSet.has(val) ? 'private' : publicSet.has(val) ? 'public' : 'default';
            const activeHidden = override === 'private' ? true : override === 'public' ? false : privacyModels;
            hidden.models.push({ token, ...formatModelRef(val), id: val, override, note, activeHidden });
        }
    }
    const modelCatalog = buildModelCatalog(task, sealed, legacy, notes, privacyModels, publicSet, privateSet);
    // A hidden model's trigger words go out as tokens too: shown under the model, not as prompts of their own.
    const wordsOf = (task?.model_words && typeof task.model_words === 'object') ? task.model_words : {};
    for (const model of modelCatalog) {
        const words = new Set(wordsOf[model.id] || []);
        model.words = hidden.prompts.filter(item => words.has(item.text)).map(item => ({ token: item.token, text: item.text }));
        hidden.prompts = hidden.prompts.filter(item => !model.words.some(word => word.token === item.token));
    }
    hidden.total = hidden.prompts.length + hidden.pictures.length + hidden.models.length;
    const unassignedToolboxModels = modelCatalog.filter(m => !m.token && m.hidden).length;

    const noteItems = Object.keys(sealed)
        .sort(compareTokens)
        .map(token => ({ token, note: String(notes[token] || '').trim() }))
        .filter(item => Boolean(item.note));

    return {
        private: isPrivate,
        privacyModels,
        privacyModelsSource: task?.privacy_models_source || 'default',
        publicModels,
        privateModels,
        modelCatalog,
        exposedPrompts: Array.isArray(task?.exposed_prompts) ? task.exposed_prompts : [],
        readsDisk: Boolean(isPrivate && task?.reads_disk),
        client: task?.client || 'AI',
        notes: { ...notes },
        dirty: Boolean(task?.sealed_notes_dirty),
        hidden,
        unassignedToolboxModels,
        visible: {
            title: String(task?.title || '').trim(),
            messages: collectVisibleMessages(task, { hideModels: privacyModels, publicModels, privateModels }),
            notes: noteItems,
            decisionsCount: Array.isArray(task?.decisions) ? task.decisions.length : 0,
        },
    };
}
