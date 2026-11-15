/**
 * Rules for the "从哪开始 / Start from" choice in the AI starter sheets (`say` and `private`):
 * which LoadImage nodes on a canvas are active (matching web/modules/mcp_fill.js), how remembered
 * choices still hold, which models and routes match, and what fact sentence starts the first message.
 * Pure: no DOM, no network.
 */

export const START_FROM_KEY = 'anomalous_ai_starter_start_from';
export const SEARCH_FROM = 8; // show a search box above lists this long or longer (as in ui_ai_preset_sheet.js)

const off = node => node?.mode === 2 || node?.mode === 4;
const imageWidget = node => (node?.widgets || []).find(widget => widget?.name === 'image') || null;
const basename = value => String(value ?? '').trim().split(/[\\/]/).pop() || '';

/** Active LoadImage nodes in `graph` and their picture file names: { count, names }. */
export function loadImageInfo(graph) {
    const nodes = graph?._nodes || graph?.nodes || [];
    const active = nodes.filter(node => node && !off(node) && /LoadImage/.test(String(node.type || '')) && imageWidget(node));
    return {
        count: active.length,
        names: active.map(node => basename(imageWidget(node).value)).filter(Boolean),
    };
}

/** Models in `models` that can follow `firstId` (distinct from it, same non-empty family). */
export function secondModelChoices(models, firstId) {
    const first = (models || []).find(item => item.model_id === firstId);
    if (!first || !first.family) return [];
    return (models || []).filter(item => item.model_id !== first.model_id && item.family === first.family);
}

/** Filters `models` by `query` on model name, always keeping `keepId` visible. */
export function filterModels(models, query, keepId = '') {
    const words = String(query || '').trim().toLowerCase();
    return (models || []).filter(item => item.model_id === keepId || !words || String(item.name || '').toLowerCase().includes(words));
}

/** Filters saved workflows by `query` on name, always keeping `keepFile` visible. */
export function filterWorkflows(workflows, query, keepFile = '') {
    const words = String(query || '').trim().toLowerCase();
    return (workflows || []).filter(item => item.file === keepFile || !words || String(item.name || '').toLowerCase().includes(words));
}

/** Whether `remembered` ({mode, first, second, route, card}) still holds under `ctx`. */
export function stillValidStartFrom(remembered, { hasNew = false, models = null, ways = null, canOpen = false, workflows = [] } = {}) {
    if (!remembered || typeof remembered !== 'object') return false;
    switch (remembered.mode) {
    case 'ai':
        return true;
    case 'open':
        return Boolean(canOpen);
    case 'card':
        return Array.isArray(workflows) && workflows.some(item => item.file === remembered.card || item.name === remembered.card);
    case 'new': {
        if (!hasNew) return false;
        if (models === null) return Boolean(remembered.first && remembered.route);
        const first = models.find(item => item.model_id === remembered.first);
        if (!first) return false;
        if (remembered.second) {
            const validSecond = secondModelChoices(models, first.model_id).some(item => item.model_id === remembered.second);
            if (!validSecond) return false;
        }
        return Array.isArray(ways) && ways.some(way => way.id === remembered.route);
    }
    default:
        return false;
    }
}

/** Picks the starting choice and clean defaults: `{ mode, first, second, route, card }`. */
export function resolveStartFrom(remembered, ctx = {}) {
    const { hasNew = false, models = null, ways = null, workflows = [] } = ctx;
    const defaultMode = hasNew ? 'new' : 'ai';
    const defaultFirst = models?.[0]?.model_id || '';
    const defaultRoute = ways?.[0]?.id || '';
    const defaultCard = workflows?.[0]?.file || '';
    if (stillValidStartFrom(remembered, ctx)) {
        if (remembered.mode === 'card') {
            const match = workflows.find(item => item.file === remembered.card || item.name === remembered.card);
            return { mode: 'card', first: defaultFirst, second: '', route: defaultRoute, card: match ? match.file : defaultCard };
        }
        if (remembered.mode === 'new') {
            return {
                mode: 'new',
                first: remembered.first || defaultFirst,
                second: remembered.second || '',
                route: remembered.route || defaultRoute,
                card: defaultCard,
            };
        }
        return { mode: remembered.mode, first: defaultFirst, second: '', route: defaultRoute, card: defaultCard };
    }
    return { mode: defaultMode, first: defaultFirst, second: '', route: defaultRoute, card: defaultCard };
}

/**
 * The way shown pressed among `ways` ([{id, models}]): `current` while it is offered and draws with as many
 * models as were chosen (`two`: a second one), else the first that does, so choosing a second model
 * presses a way that uses it.
 */
export function pickWay(ways, current, two) {
    const fits = way => (way.models === 2) === Boolean(two);
    const list = ways || [];
    return (list.find(way => way.id === current && fits(way)) || list.find(fits) || list.find(way => way.id === current) || list[0])?.id || '';
}

/** The `models` array sent to POST /route for `routeKey`: one model for `one_pass`, else [first, second] when present. */
export function routeModels(routeKey, firstId, secondId) {
    if (!firstId) return [];
    if (routeKey === 'one_pass' || !secondId) return [firstId];
    return [firstId, secondId];
}

/** Short summary strip for what `new` will build before the AI starts. */
export function buildStrip(routeKey, firstName, secondName, translate) {
    if (!routeKey || !firstName) return '';
    const head = translate('aiStartStripDraw', { model: firstName });
    if (routeKey === 'one_pass' || !secondName) return head;
    return translate('aiStartStripPair', { first: head, way: translate(`aiRouteShort_${routeKey}`), second: secondName });
}

/** The fact sentence at the front of the first message to the AI for `choice`, or `''`. */
export function startFactSentence(choice, translate, mark = text => text) {
    if (!choice) return '';
    if (choice.mode === 'open') {
        const count = Number(choice.count || 0);
        if (count === 0) return translate('aiStartNoteOpen');
        if (count === 1) return translate('aiStartNoteOpenOne');
        return translate('aiStartNoteOpenImages', { count });
    }
    if (choice.mode === 'card' && choice.cardName) {
        const name = choice.secret ? mark(choice.cardName) : choice.cardName;
        return translate('aiStartNoteCard', { name });
    }
    return '';
}

/** Puts `factSentence` ahead of `cardNote`. */
export function composeFirstNote(factSentence, cardNote) {
    return [factSentence, cardNote].map(item => String(item || '').trim()).filter(Boolean).join(' ');
}

/** Human short name from a `model_id` (`type:idx:sub/file.safetensors` -> `file`). */
export function modelStem(id) {
    return String(id || '').split(':').pop().split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
}
