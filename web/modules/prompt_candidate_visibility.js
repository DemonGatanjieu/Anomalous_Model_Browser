/** Only opaque, versioned field identities leave memory. No candidate text or display labels. */
const STORE = 'anomalous_prompt_candidate_visibility_v1';
const LIMIT = 512;
const validKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);

function decode(raw) {
    if (!raw) return new Set();
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.keys)) return new Set();
    return new Set(saved.keys.slice(-LIMIT).filter(validKey));
}

function boundedAdd(set, key) {
    set.add(key);
    if (set.size > LIMIT) set.delete(set.values().next().value);
}

export function createCandidateVisibility(host = globalThis) {
    let persistent = new Set();
    let memoryOnly = false;
    const session = new Set();
    const listeners = new Set();

    function refresh() {
        if (memoryOnly) return;
        try {
            persistent = decode(host.localStorage.getItem(STORE));
        } catch {
            memoryOnly = true;
        }
    }

    function notify() {
        for (const fn of listeners) fn();
    }

    function onStorage(event) {
        if (event.key !== STORE && event.key !== null) return;
        refresh();
        notify();
    }

    function update(rows, scope, hide) {
        refresh();
        let save = false;
        for (const row of rows) {
            if (!validKey(row.hide_key)) continue;
            const set = row.stable ? persistent : session;
            const key = row.stable ? row.hide_key : JSON.stringify([scope, row.hide_key]);
            if (hide) boundedAdd(set, key);
            else set.delete(key);
            if (row.stable) save = true;
        }
        if (save && !memoryOnly) {
            try {
                host.localStorage.setItem(STORE, JSON.stringify({ version: 1, keys: [...persistent] }));
            } catch {
                memoryOnly = true;
            }
        }
        notify();
    }

    return {
        hidden(row, scope) {
            return row.stable ? persistent.has(row.hide_key) : session.has(JSON.stringify([scope, row.hide_key]));
        },
        hide(row, scope) { update([row], scope, true); },
        restore(rows, scope) { update(rows, scope, false); },
        subscribe(fn) {
            if (!listeners.size) host.addEventListener('storage', onStorage);
            refresh();
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
                if (!listeners.size) host.removeEventListener('storage', onStorage);
            };
        },
    };
}

export const candidateVisibility = createCandidateVisibility();
