# Architecture Topic Guide

Start with the repository-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md), then
open only the topic needed for the current task.

- [`ui-flows.md`](ui-flows.md): the UI map's hand-written part, in Chinese: what each part of
  a page is for, what a click does and why, and one name per thing (a glossary the structure
  check enforces). Where a word on screen is drawn and what it calls comes from the code:
  `node tools/ui_map.mjs find <words>` (`tools/ui_map.mjs`, its index `tools/ui_map_scan.mjs`;
  `build` writes the whole map to the untracked `docs/ui-map.md`).
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
[`lessons.md`](lessons.md).
