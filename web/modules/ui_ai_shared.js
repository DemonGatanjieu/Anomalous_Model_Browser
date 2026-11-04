/**
 * What the parts of the AI page share: AMB's window, the task shown, its canvas entries, the player and
 * the way to a run's map. It imports nothing, so it stands before any of them runs: ui_ai_workbench.js
 * writes here as it loads, and ComfyUI may run any of AMB's modules first (tests/module_cycles.mjs).
 */

export const shared = { owner: null, taskId: null, entries: new Map(), player: null, openMap: null };
