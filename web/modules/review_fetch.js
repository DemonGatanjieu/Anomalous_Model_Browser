/** One fetch wrapper for the review console's independent, overlapping rehearsals. */
let baseFetch = null;
const handlers = new Map();

async function reviewFetch(input, init) {
    const realFetch = baseFetch;
    const ordered = [...handlers.values()].sort((a, b) => a.priority - b.priority);
    for (const entry of ordered) {
        // A rehearsal may have ended while an earlier handler was reading a request.
        if (handlers.get(entry.name) !== entry) continue;
        const pending = entry.handle(input, init, realFetch);
        const hit = pending instanceof Response ? pending : pending && await pending;
        if (hit instanceof Response) return hit;
    }
    return realFetch.call(window, input, init);
}

export function registerReviewFetch(name, priority, handle) {
    if (!handlers.size) {
        baseFetch = window.fetch;
        window.fetch = reviewFetch;
    }
    handlers.set(name, { name, priority, handle });
}

export function unregisterReviewFetch(name) {
    if (handlers.delete(name) && !handlers.size) {
        window.fetch = baseFetch;
        baseFetch = null;
    }
}

export const hasReviewFetch = name => handlers.has(name);

export function ownAnomalousUrl(input) {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/anomalous/') ? url : null;
}

export const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
