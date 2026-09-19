/**
 * Workflow Recipe version timeline, comparison, and restore actions.
 */

import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { shortHash } from './recipe_identity.js';
import { buildRecipeDiff, diffIsEmpty } from './recipe_diff.js';
import {
    appendCopyButton,
    appendText,
    appendValueViewer,
    button,
    dateText,
} from './ui_recipe_detail_dom.js';

const t = (key, params) => translate(key, params);

function fullDiffValue(value) {
    if (value === null || value === undefined || value === '') return t('recipeDetailUnavailable');
    if (typeof value === 'string') return value.trim();
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
}
export function fingerprintText(recipe) {
    return recipe?.workflow_fingerprint?.value || '';
}
export function diffCategoryLabel(category) {
    return t({
        pinned: 'recipeDiffPinned',
        prompts: 'recipeDiffPrompts',
        models: 'recipeDiffModels',
        parameters: 'recipeDiffParameters',
        workflow: 'recipeDiffWorkflow',
        presentation: 'recipeDiffPresentation',
    }[category] || 'recipeDiffOther');
}

export function appendDiffValue(parent, label, value, kind) {
    const item = document.createElement('div');
    item.className = `anomalous-recipe-diff-value anomalous-recipe-diff-value-${kind}`;
    appendText(item, 'small', label, 'anomalous-recipe-detail-muted');
    appendValueViewer(item, fullDiffValue(value));
    parent.appendChild(item);
}

export function renderDiffPanel(parent, owner, recipe, version, trigger) {
    const panel = document.createElement('div');
    panel.className = 'anomalous-recipe-version-diff';
    appendText(panel, 'strong', t('recipeDiffLoading'));
    parent.appendChild(panel);
    trigger.disabled = true;
    fetch(`/anomalous/recipe_version?filename=${encodeURIComponent(owner.recipeDetailFilename)}&version=${encodeURIComponent(version.version)}`)
        .then(async (response) => {
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('version diff request failed');
            return payload.data;
        })
        .then((historical) => {
            panel.replaceChildren();
            const changes = buildRecipeDiff(historical, recipe);
            if (diffIsEmpty(changes)) {
                appendText(panel, 'p', t('recipeDiffNoChanges'), 'anomalous-recipe-detail-muted');
                return;
            }
            appendText(panel, 'strong', `${t('recipeDiffSummary')} (${changes.length})`);
            const groups = new Map();
            for (const change of changes) {
                if (!groups.has(change.category)) groups.set(change.category, []);
                groups.get(change.category).push(change);
            }
            for (const [category, categoryChanges] of groups) {
                const group = document.createElement('section');
                group.className = 'anomalous-recipe-diff-group';
                appendText(group, 'h5', diffCategoryLabel(category));
                for (const change of categoryChanges) {
                    const row = document.createElement('article');
                    row.className = `anomalous-recipe-diff-row anomalous-recipe-diff-${change.kind}`;
                    const values = document.createElement('div');
                    values.className = 'anomalous-recipe-diff-values';
                    const marker = change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '→';
                    appendText(row, 'span', marker, 'anomalous-recipe-diff-marker');
                    appendText(row, 'strong', change.label || change.key, 'anomalous-recipe-diff-label');
                    if (change.kind !== 'added') appendDiffValue(values, t('recipeDiffBefore'), change.before, 'before');
                    if (change.kind === 'changed') appendText(row, 'span', '→', 'anomalous-recipe-diff-arrow');
                    if (change.kind !== 'removed') appendDiffValue(values, t('recipeDiffAfter'), change.after, 'after');
                    row.appendChild(values);
                    group.appendChild(row);
                }
                panel.appendChild(group);
            }
        })
        .catch((error) => {
            console.error('Could not compare Workflow Recipe version:', error);
            panel.replaceChildren();
            appendText(panel, 'p', t('recipeDiffError'), 'anomalous-recipe-dialog-error');
        })
        .finally(() => {
            trigger.disabled = false;
            trigger.textContent = t('recipeCompareVersion');
        });
}

export function renderVersions(content, owner, recipe, history, finish) {
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section';
    appendText(section, 'h4', t('recipeHistory'));
    const timeline = document.createElement('div');
    timeline.className = 'anomalous-recipe-version-timeline';
    const current = document.createElement('article');
    current.className = 'anomalous-recipe-version-row current';
    appendText(current, 'strong', t('recipeDetailCurrentVersion'));
    appendText(current, 'span', dateText(recipe.updated_timestamp || recipe.timestamp));
    const currentFingerprint = fingerprintText(recipe);
    appendText(current, 'code', shortHash(currentFingerprint) || t('recipeDetailNotIndexed'));
    if (currentFingerprint) appendCopyButton(current, currentFingerprint, t('recipeDetailCopyFingerprint'));
    timeline.appendChild(current);
    for (const version of history || []) {
        const row = document.createElement('article');
        row.className = 'anomalous-recipe-version-row';
        const copy = document.createElement('div');
        appendText(copy, 'strong', version.name || t('recipeUnknownVersion'));
        appendText(copy, 'span', dateText(version.timestamp));
        row.appendChild(copy);
        const versionFingerprint = version.workflow_fingerprint?.value || '';
        appendText(row, 'code', shortHash(versionFingerprint) || t('recipeDetailNotIndexed'));
        if (versionFingerprint) appendCopyButton(row, versionFingerprint, t('recipeDetailCopyFingerprint'));
        const compare = button(row, t('recipeCompareVersion'), 'anomalous-btn-primary');
        compare.onclick = () => {
            const existing = row.querySelector('.anomalous-recipe-version-diff');
            if (existing) {
                existing.remove();
                compare.textContent = t('recipeCompareVersion');
                return;
            }
            compare.textContent = t('recipeDiffLoading');
            renderDiffPanel(row, owner, recipe, version, compare);
        };
        const restore = button(row, t('recipeRestoreVersion'), 'anomalous-btn-danger');
        restore.onclick = async () => {
            if (!await anomalousConfirm(t('recipeRestoreVersionConfirm'))) return;
            try {
                const response = await fetch('/anomalous/restore_recipe_version', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: owner.recipeDetailFilename, version: version.version }),
                });
                if (!response.ok) throw new Error('restore failed');
                await owner.refreshRecipes();
                finish('restored');
            } catch (error) {
                console.error('Could not restore recipe version:', error);
                await anomalousAlert(t('recipeUpdateError'));
            }
        };
        timeline.appendChild(row);
    }
    if (!(history || []).length) appendText(timeline, 'p', t('recipeHistoryEmpty'), 'anomalous-recipe-detail-muted');
    section.appendChild(timeline);
    content.appendChild(section);
}
