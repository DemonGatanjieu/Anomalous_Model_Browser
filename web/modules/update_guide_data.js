// Content only. Maintenance checklist: docs/architecture/update-guide.md.
// Change the ID only when users should see a new guide, never for typo fixes.
export const CURRENT_UPDATE_GUIDE = Object.freeze({
    id: '2026-09-recipes-and-studios',
    steps: Object.freeze([
        { id: 'recipes', icon: '📑', titleKey: 'updateGuideRecipesTitle', bodyKey: 'updateGuideRecipesBody' },
        { id: 'materials', icon: '✨', titleKey: 'updateGuideMaterialsTitle', bodyKey: 'updateGuideMaterialsBody' },
        { id: 'sources', icon: '🌐', titleKey: 'updateGuideSourcesTitle', bodyKey: 'updateGuideSourcesBody' },
        { id: 'precision-scan', icon: '🎯', titleKey: 'updateGuideScanTitle', bodyKey: 'updateGuideScanBody' },
    ]),
});

export function validateUpdateGuide(guide, locales) {
    if (!guide || typeof guide.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(guide.id)) return false;
    if (!Array.isArray(guide.steps) || guide.steps.length < 1 || guide.steps.length > 5) return false;
    const ids = new Set();
    return guide.steps.every(step => {
        if (!step || typeof step.id !== 'string' || !step.id || ids.has(step.id)) return false;
        ids.add(step.id);
        if (typeof step.icon !== 'string' || !step.icon || step.icon.length > 8) return false;
        return ['titleKey', 'bodyKey'].every(field => typeof step[field] === 'string'
            && ['zh', 'en'].every(locale => typeof locales[locale]?.[step[field]] === 'string'
                && locales[locale][step[field]].trim().length > 0));
    });
}
