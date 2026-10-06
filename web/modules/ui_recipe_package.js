/**
 * Recipe packages (配方包, api/recipe_packages.py): exporting one Workflow Recipe as a .zip to
 * give to someone (the recipe, its cover and its models' thumbnails; its versions when asked),
 * and taking one in as a new recipe card, optionally opened on the canvas too. A recipe of the
 * same name is never replaced: the new card gets " (2)". Dialogs look like the backup's.
 */

import { translate as t } from './locales.js';
import { openDialog } from './ui_backup.js';
import { applyRecipeToCanvas } from './ui_recipe_detail.js';
import { formatSize } from './ui_model_download.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

async function errorOf(response) {
    const data = await response.json().catch(() => ({}));
    return new Error(data.message || data.error || `HTTP ${response.status}`);
}

/** The browser's file name from the server's Content-Disposition (filename*), else a plain one. */
function nameFrom(response) {
    const header = response.headers.get('Content-Disposition') || '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    return encoded ? decodeURIComponent(encoded[1]) : 'recipe.anomalous-recipe.zip';
}

/** Export: whether to add the versions, then the .zip downloads. */
export function exportRecipePackage(recipe) {
    const name = recipe?.data?.name || recipe?.name || '';
    const { dialog, footer, close } = openDialog(t('recipePackageExportTitle', { name }));
    const history = el('label', 'anomalous-backup-choice');
    const historyBox = el('input');
    historyBox.type = 'checkbox';
    const copy = el('span', 'anomalous-backup-choice-copy');
    copy.append(el('span', '', t('recipePackageHistory')), el('small', 'anomalous-backup-note', t('recipePackageHistoryHint')));
    history.append(historyBox, copy);
    const status = el('p', 'anomalous-backup-note');
    dialog.append(el('p', 'anomalous-backup-text', t('recipePackageExportIntro')), history, status);
    const go = button('anomalous-scan-primary', t('recipePackageExportStart'), async () => {
        go.disabled = true;
        status.classList.remove('is-bad');
        status.textContent = t('backupExporting');
        try {
            const response = await fetch('/anomalous/export_recipe_package', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: recipe.filename, include_history: historyBox.checked }),
            });
            if (!response.ok) throw await errorOf(response);
            const blob = await response.blob();
            const file = nameFrom(response);
            const url = URL.createObjectURL(blob);
            const link = el('a');
            link.href = url;
            link.download = file;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            status.textContent = t('recipePackageExported', { name: file, size: formatSize(blob.size) });
            go.remove();
            cancel.textContent = t('dialogOk');
        } catch (error) {
            status.textContent = t('backupFailed', { error: error.message });
            status.classList.add('is-bad');
            go.disabled = false;
        }
    });
    const cancel = button('anomalous-scan-secondary', t('dialogCancel'), close);
    footer.append(cancel, go);
    go.focus();
}

/**
 * Reads `file` as a recipe package and offers to keep it. Resolves false when it is no recipe
 * package (the caller may try it as a backup), true once the dialog is shown.
 */
export async function importRecipePackageFile(owner, file) {
    const response = await fetch('/anomalous/import_recipe_package_inspect', { method: 'POST', body: file });
    if (response.status === 400) return false;
    if (!response.ok) throw await errorOf(response);
    const info = await response.json();
    const { dialog, footer, close } = openDialog(t('recipePackageImportTitle'));
    const lines = [t('recipePackageImportWhat', { name: info.recipe?.name || '?', pictures: info.asset_count })];
    if (info.history_count) lines.push(t('recipePackageImportHistory', { count: info.history_count }));
    if (info.imported_name && info.imported_name !== info.recipe?.name) lines.push(t('recipePackageImportRenamed', { name: info.imported_name }));
    dialog.append(...lines.map(line => el('p', 'anomalous-backup-text', line)),
        el('p', 'anomalous-backup-note', t('recipePackageImportModels')));
    const status = el('p', 'anomalous-backup-note');
    dialog.append(status);
    const keep = async (open) => {
        buttons.forEach((item) => { item.disabled = true; });
        try {
            const commit = await fetch('/anomalous/import_recipe_package_commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: info.token }),
            });
            if (!commit.ok) throw await errorOf(commit);
            const saved = await commit.json();
            close();
            await owner?.refreshRecipes?.();
            showWorkbenchToast(t('recipePackageImported', { name: saved.name }));
            if (open) {
                const full = await (await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(saved.filename)}`)).json();
                if (full?.data) await applyRecipeToCanvas(owner, full.data);
            }
        } catch (error) {
            status.textContent = t('backupFailed', { error: error.message });
            status.classList.add('is-bad');
            buttons.forEach((item) => { item.disabled = false; });
        }
    };
    const buttons = [
        button('anomalous-scan-secondary', t('recipePackageKeepAndOpen'), () => keep(true)),
        button('anomalous-scan-primary', t('recipePackageKeep'), () => keep(false)),
    ];
    footer.append(button('anomalous-scan-secondary', t('dialogCancel'), close), ...buttons);
    buttons[1].focus();
    return true;
}
