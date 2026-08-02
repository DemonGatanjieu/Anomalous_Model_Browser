# AI Changelog

## [Snapshot] 2026-08-02

**Editable Workflow Recipes**

- Added safe in-place editing for recipe names, tags, notes, pinned parameters, and primitive widget values from standard or third-party nodes.
- Added an explicit canvas-edit path for structural workflow changes; saving from that path updates the original recipe instead of silently creating a duplicate.
- Added bounded local version history (20 snapshots) before every update, with restore controls and deletion of related history when a recipe is deleted.
- Kept recipe files and their history exclusively in ComfyUI user data, outside the plugin repository.

## [Snapshot] 2026-08-02 — `a9d767e`

**Workflow Recipe Detail Foundation**

- Added the demand-loaded recipe detail panel: Overview, Models & reproducibility, Parameters, and Versions.
- Added schema-v3 canonical workflow fingerprints, supported model-reference summaries, identity-status rendering, bounded exact-reference availability refresh, parameter search, and version fingerprint summaries.
- Kept recipe card listing light. Detail data and history are fetched only after a user opens a recipe.
- Preserved the Model Doctor boundary: filename, path, preview, and fuzzy matching are never identity proof; detail browsing does not trigger recursive scans or full-file model hashing.

**Design and architecture decisions**

- The future public umbrella label is **Workspace / 创作工作台**; internal notebook API and storage names stay unchanged in the first presentation-only rename.
- Current model previews are demand-loaded from exact references. Frozen model-preview snapshots are a future explicit, bounded recipe-asset feature; they must not be embedded in the authoritative workflow graph or used for identity.
- `workflow_recipe_detail_panel_design.md` now contains the schema-v4 preview-snapshot proposal, limits, ownership, API boundaries, delivery order, and acceptance criteria.

**Validation**

- `python -m py_compile api/recipes.py api/__init__.py`
- `node --check web/modules/recipe_identity.js`
- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/locales.js`

**Repository hygiene correction**

- `CHANGELOG.md` is reserved for user-visible release notes only. Internal decisions, implementation detail, checks, and agent handoff stay in this file.
- Moved the root experience summary to `.agents/logs/ai_lessons.md`; `.agents/logs/` now contains the intended changelog and lessons pair.
