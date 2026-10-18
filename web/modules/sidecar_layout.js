/**
 * Settings → Models → "Side files" requests (api/sidecar_layout.py): where the files only this
 * plugin uses sit beside each model ('beside', or 'hidden' in each folder's .amb), what putting
 * them there would move, and doing it (Civitai pictures kept twice go too). No DOM.
 */

async function json(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

/** { layout, moves, duplicates, models }: what putting the side files in `layout` would do. */
export const planSidecars = (layout) => json(`/anomalous/sidecars/plan?layout=${encodeURIComponent(layout)}`);

/** Saves `layout` and puts the side files there: { layout, moved, deduped, failed, more }. */
export const applySidecars = (layout) => json('/anomalous/sidecars/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout }),
});
