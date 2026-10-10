/**
 * Where a model's information came from, shown on cards and in the detail header.
 * Matched on Civitai is the normal case and looks as before; only the exceptions are
 * marked: base model inferred from the file (≈), and not scanned yet. The detail header
 * also names the fields the user set (metadata.user_fields, from <model>.anomalous.json).
 */

import { translate as t } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { reasonText } from './scan_results.js';

const FIELD_KEYS = { custom_name: 'modelSourceFieldName', custom_notes: 'modelSourceFieldNotes', source_url: 'modelSourceFieldLink' };

function colourClass(baseModel) {
    const lower = baseModel.toLowerCase();
    if (lower.includes('flux')) return 'badge-flux';
    if (lower.includes('pony') || lower.includes('illustrious') || lower.includes('anime')) return 'badge-rose';
    if (lower.includes('sdxl') || lower.includes('xl')) return 'badge-gold';
    return 'badge-amber';
}

/** Only .safetensors files are scanned, so only they can be "not scanned yet". */
function scannable(model) {
    return /\.safetensors$/i.test(String(model?.filename || ''));
}

/** The card's top-left badge, or null. */
export function renderSourceBadge(model) {
    const meta = model?.metadata || {};
    const baseModel = String(meta.baseModel || '');
    const badge = document.createElement('div');
    badge.className = 'anomalous-card-badge';
    if (meta.info_source === 'local') {
        badge.classList.add('is-inferred', ...(baseModel ? [colourClass(baseModel)] : []));
        badge.textContent = `≈ ${baseModel || t('modelSourceLocalShort')}`;
        badge.title = t('modelSourceLocalHint', { reason: reasonText(meta.unmatched_reason) });
    } else if (!meta.info_source && scannable(model)) {
        badge.classList.add('is-unscanned');
        badge.textContent = t('modelSourceNotScanned');
        badge.title = t('modelSourceNotScannedHint');
    } else if (baseModel) {
        badge.classList.add(colourClass(baseModel));
        badge.textContent = baseModel;
    } else {
        return null;
    }
    return badge;
}

/** The detail header's line: size, base model, where the information came from, what the user set. */
export function renderSourceLine(span, model, meta) {
    const parts = [`<strong>Size:</strong> ${escapeHtml(model.size_mb)} MB`];
    if (meta.baseModel) parts.push(`<strong>Base:</strong> ${meta.info_source === 'local' ? '≈ ' : ''}${escapeHtml(meta.baseModel)}`);
    const source = meta.info_source === 'civitai' ? t('modelSourceCivitai')
        : meta.info_source === 'local' ? t('modelSourceLocal')
            : scannable(model) ? t('modelSourceNotScanned') : '';
    if (source) parts.push(`<strong>${escapeHtml(t('modelSourceLabel'))}:</strong> ${escapeHtml(source)}`);
    const edited = (meta.user_fields || []).map(field => t(FIELD_KEYS[field] || field));
    if (edited.length) parts.push(escapeHtml(t('modelSourceEdited', { fields: edited.join(t('modelSourceListSep')) })));
    span.innerHTML = parts.join('<span class="anomalous-source-sep"> · </span>');
    span.title = meta.info_source === 'local' ? t('modelSourceLocalHint', { reason: reasonText(meta.unmatched_reason) })
        : !meta.info_source && scannable(model) ? t('modelSourceNotScannedHint') : '';
}
