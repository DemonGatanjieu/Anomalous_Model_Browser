# Architecture Topic Guide

Start with the repository-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md), then
open only the topic needed for the current task.

- [`backend.md`](backend.md): Python routes, filesystem safety, persistence,
  scan state, model sidecars, and backend performance.
- [`frontend.md`](frontend.md): extension bootstrap, UI ownership, localization,
  media lifecycle, panel state, and graph mutations.
- [`recipes.md`](recipes.md): Workflow Recipes, packages, galleries, Parameter
  Notebooks, prompt roles, and recipe-to-model transitions.
- [`material-library.md`](material-library.md): saved prompts and node values
  (material files), keeping an output image, and dragging prompts onto the canvas.
- [`recipe-model-lifecycle.md`](recipe-model-lifecycle.md): authoritative model
  fields, Hash synchronization, local matching, partial append, and note privacy.
- [`model-resolution.md`](model-resolution.md): model provenance, Model Check,
  hash injection, model scanning, and recovery policy.
- [`../decisions/README.md`](../decisions/README.md): concise records of product
  and architectural decisions that still explain current behavior.

These documents describe current contracts rather than implementation history.
For exact changes, use Git history. For user-visible releases, use
`CHANGELOG.md`. For recurring implementation traps, use
`.agents/logs/ai_lessons.md`.
