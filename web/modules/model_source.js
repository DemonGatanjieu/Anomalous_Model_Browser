/**
 * Where a model's information came from, shown on cards and in the detail header.
 * Matched on Civitai is the normal case and looks as before; only the exceptions are
 * marked: base model inferred from the file (≈), a damaged file, not scanned yet, and set to
 * "don't scan" (metadata.scan_choice). The detail header also names the fields the user set
 * (metadata.user_fields, from <model>.anomalous.json), and for a model not scanned whose header
 * looks like no drawing model, or one set to "don't scan", a button to change that.
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
    if (meta.info_source === 'local' && meta.unmatched_reason === 'damaged') {
        badge.classList.add('is-inferred', 'is-damaged');
        badge.textContent = `⚠ ${t('modelSourceDamagedShort')}`;
        badge.title = reasonText('damaged');
    } else if (meta.info_source === 'local') {
        badge.classList.add('is-inferred', ...(baseModel ? [colourClass(baseModel)] : []));
        badge.textContent = `≈ ${baseModel || t('modelSourceLocalShort')}`;
        badge.title = t('modelSourceLocalHint', { reason: reasonText(meta.unmatched_reason) });
    } else if (!meta.info_source && scannable(model)) {
        const skipped = meta.scan_choice === 'skip';
        badge.classList.add('is-unscanned');
        badge.textContent = t(skipped ? 'modelSourceSkipped' : 'modelSourceNotScanned');
        badge.title = t(skipped ? 'modelSourceSkippedHint' : meta.not_drawing ? 'modelSourceNotDrawingHint' : 'modelSourceNotScannedHint');
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
    const skipped = meta.scan_choice === 'skip';
    const source = meta.info_source === 'civitai' ? t('modelSourceCivitai')
        : meta.info_source === 'local' ? t('modelSourceLocal')
            : scannable(model) ? t(skipped ? 'modelSourceSkipped' : 'modelSourceNotScanned') : '';
    if (source) parts.push(`<strong>${escapeHtml(t('modelSourceLabel'))}:</strong> ${escapeHtml(source)}`);
    if (skipped && meta.info_source) parts.push(escapeHtml(t('modelSourceSkipped')));
    if (meta.info_source === 'local' && meta.unmatched_reason === 'damaged') {
        parts.push(`<span class="anomalous-source-damaged">⚠ ${escapeHtml(t('modelSourceDamaged'))}</span>`);
    }
    const edited = (meta.user_fields || []).map(field => t(FIELD_KEYS[field] || field));
    if (edited.length) parts.push(escapeHtml(t('modelSourceEdited', { fields: edited.join(t('modelSourceListSep')) })));
    span.innerHTML = parts.join('<span class="anomalous-source-sep"> · </span>');
    span.title = meta.info_source === 'local' ? t('modelSourceLocalHint', { reason: reasonText(meta.unmatched_reason) })
        : skipped ? t('modelSourceSkippedHint')
            : !meta.info_source && scannable(model) ? t(meta.not_drawing ? 'modelSourceNotDrawingHint' : 'modelSourceNotScannedHint') : '';
    if (scannable(model) && (skipped || (!meta.info_source && meta.not_drawing))) span.append(choiceButton(span, model, meta));
}

/** "Don't scan" / "Scan it after all" in the detail header: saves the choice, then draws the line again. */
function choiceButton(span, model, meta) {
    const skip = meta.scan_choice !== 'skip';
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'anomalous-source-choice';
    node.textContent = t(skip ? 'modelSourceSetSkip' : 'modelSourceSetScan');
    node.onclick = async () => {
        node.disabled = true;
        const choice = skip ? 'skip' : '';
        try {
            const res = await fetch('/anomalous/scan_choice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ choice, targets: [{ type: model.type, path_idx: model.path_idx, subfolder: model.subfolder || '/', files: [model.filename] }] }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.status !== 'success' || data.changed !== 1) throw new Error(data.message || `HTTP ${res.status}`);
            meta.scan_choice = choice;
            renderSourceLine(span, model, meta);
        } catch (error) {
            console.error('Could not save the scan choice:', error);
            node.disabled = false;
            alert(t('scanChoiceFailed', { count: 1 }));
        }
    };
    return node;
}
