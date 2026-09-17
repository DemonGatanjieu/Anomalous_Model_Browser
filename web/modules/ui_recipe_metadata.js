/** Persistence for inline Workflow Recipe edits. */

export async function updateRecipeMetadata(owner, recipe, changes) {
    const filename = owner?.recipeDetailFilename;
    if (!filename) throw new Error('recipe metadata filename missing');
    const next = JSON.parse(JSON.stringify({ ...recipe, ...changes }));
    const response = await fetch('/anomalous/update_recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, ...next }),
    });
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success') throw new Error('recipe metadata update failed');
    Object.assign(recipe, changes, { updated_timestamp: Date.now() });
    await owner.refreshRecipes?.();
}

