/** Preserve fragment contents and order, including weights and commas. */
export function composePromptPlan(plan) {
    const active = (plan.parts || []).filter(part => part.enabled !== false);
    return Object.fromEntries(['positive', 'negative'].map(role => [role,
        [...active.map(part => part[role] || ''), plan[role] || '']
            .filter(value => value.trim()).join('\n'),
    ]));
}
