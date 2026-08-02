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

## [Snapshot] 2026-08-02 — Workspace and saved preview completion

**Implemented**

- Renamed the visible Notebook surface to Workspace / 创作工作台 and its first section to Prompt Notes / 提示词笔记. Existing notebook routes, local storage, and internal property names remain unchanged.
- Extended `/anomalous/resolve_paths_to_previews` with `exact_only`. Recipe detail preview requests now use keyed, category-bounded exact references, so opening a recipe model tab cannot fall back to a recursive library walk.
- Added demand-loaded static/video current-preview rendering to Models & reproducibility. Video previews remain muted, metadata-preloaded, and play only while hovered.
- Added an opt-in save-dialog choice for model preview snapshots. Schema v4 writes small static WebP assets under the recipe user-data `.assets/<recipe-stem>/` directory and references them from model metadata.
- Snapshot limits: 320 px longest edge, 96 KiB per asset, 12 assets, 1.25 MiB per save/update, 20 MiB source cap. Videos are never copied. Recipe deletion removes only that recipe's contained asset directory.

**Boundary checks**

- Snapshots and current previews are presentation only: neither enters the authoritative `workflow` graph, affects the workflow fingerprint, nor participates in Model Doctor identity resolution.
- Current previews load only on the Models tab; compact cards do not request per-model preview data.

**Validation**

- `python -m py_compile api/models.py api/recipes.py api/__init__.py`
- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_notebooks.js`
- `node --check web/modules/ui_sidebar.js`
- `node --check web/modules/locales.js`

## [Snapshot] 2026-08-02 — Recipe discovery and semantic comparison

**Implemented**

- Added lightweight recipe search across name, notes, and tags with Unicode-normalized term matching and clickable tag filters.
- Added localized empty/no-match states, active filter controls, result counts, and keyboard-capable tag buttons.
- Added `GET /anomalous/recipe_version` with validated recipe/version filenames for one bounded historical read.
- Added pure `recipe_diff.js` comparison for pinned parameters, prompts, model references, safe parameter summaries, graph counts/fingerprint, and presentation metadata.
- Added lazy version comparison UI. History restore remains a separate action and still archives the current recipe first.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py`
- `node --check` for every JavaScript file under `web/`
- `recipe_diff.js` smoke comparison passed
- `git diff --check`

## [Snapshot] 2026-08-02 — Contained recipe package transfer

**Implemented**

- Added versioned ZIP export with manifest checksums and explicit inclusion controls for preview snapshots, history, and model identity fields.
- Added bounded upload inspection plus single-use short-lived inspection tokens before import commit.
- Added archive path, symlink, compression, entry-count, expanded-size, JSON-depth, checksum, and WebP signature validation.
- Added staged import with generated local recipe identity, name collision rename flow, optional replace-with-history-backup support, and contained asset/history placement.
- Added Workspace Import package action and per-card Export package action with a privacy summary.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- ZIP export → inspect smoke round trip passed with a contained WebP asset
- `git diff --check`

## [Snapshot] 2026-08-02 — Runtime-safe append and Quick Queue handoff

**Implemented**

- Audited the action layer against the installed ComfyUI frontend's LiteGraph and prompt-queue contracts.
- Made append accept tuple and object-shaped serialized links, restore serialized groups with the same placement offset, reject subgraph definitions until ID remapping is implemented, and roll back nodes and groups together.
- Corrected Quick Queue to preserve the `{ output, workflow }` envelope returned by `app.graphToPrompt(...)`, which is the shape consumed by `api.queuePrompt`, while preserving the no-live-canvas-mutation boundary.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- `git diff --check`

## [Snapshot] 2026-08-02 — Recipe action feedback and queue contract fix

**Implemented**

- Fixed Quick Queue to pass the complete host prompt envelope instead of only its `output` field.
- Awaited canvas loading before closing the Workspace and added a shared close path for detail-panel open/append actions.
- Added visible failure handling for asynchronous recipe-to-canvas loading.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- `git diff --check`
