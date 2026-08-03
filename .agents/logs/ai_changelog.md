# AI Changelog

## [Snapshot] 2026-08-03 - Restore the panel under the Workspace

**Implemented**

- Added one shared Workspace close path for the header close button and backdrop click.
- Recorded the visible main-browser panel before opening the Workspace and restored it on close.
- Added a model-grid fallback when the previous panel state is unavailable, preventing blank host screens.

**Validation**

- `node --check web/main.js web/modules/ui_notebooks.js web/modules/ui_sidebar.js web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `git diff --check`
## [Snapshot] 2026-08-03 - Preserve model grid return position

**Implemented**

- Renamed the model-detail fallback action from "Back to grid" to the shorter "Back" label.
- Captured the active model folder plus grid `scrollTop` and `scrollLeft` before opening detail.
- Restored the saved grid viewport when returning from the root model detail view, while leaving recipe-detail return state isolated.

**Validation**

- `node --check web/modules/ui_detail.js web/modules/ui_grid.js web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `git diff --check`
## [Snapshot] 2026-08-03 - Keep model navigation inside Overview

**Implemented**

- Removed the duplicate standalone Models tab from recipe detail.
- Kept model composition blocks inside Overview and made their resolved model names/previews the model-detail entry points.
- Moved demand-loaded preview refresh back to Overview and removed an undefined scroll-container reference from model navigation.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`
## [Snapshot] 2026-08-03 - Restore recipe interaction contracts

**Implemented**

- Restored the dedicated recipe Models tab and bound preview loading to that tab, so model cards and preview navigation remain reachable after the visual refactor.
- Awaited the list-card Append to Canvas transaction before treating the action as successful.
- Extended the custom confirmation dialog with an optional explicit No choice and a distinct Cancel result; export now stops on cancellation and preserves the requested include/exclude values.

**Validation**

- `node --check web/modules/ui_dialog.js web/modules/ui_recipes.js web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `python_embeded/python.exe -m py_compile api/recipes.py api/models.py api/recipe_packages.py`
- `git diff --check`
## [Snapshot] 2026-08-03 ‚Äî Complete recipe model return cleanup

- When returning from a model detail opened by a recipe, explicitly hide and clean the model panel before restoring the Workspace recipe detail view.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Guard recipe card actions

**Implemented**

- Added a single card-action runner for detail, edit, export, open, append, and delete actions.
- Buttons are disabled while their asynchronous operation is active and always restored in `finally`, including cancellation and failed requests.
- Removed duplicated card-level error handling where the runner now owns the failure feedback.

**Validation**

- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Stabilize recipe detail navigation lifecycle

**Implemented**

- Detail Open/Append actions now settle the detail controller after success instead of leaving its Promise unresolved.
- External Workspace navigation disposes the active detail view through one finish callback, preventing hidden stale detail DOM.
- Model reference navigation stores a lightweight recipe return token and restores the recipe detail tab/scroll position from the model detail Back action.
- Added busy-state guarding for detail canvas actions and cleared stale recipe return callbacks when the browser returns to ordinary model-grid navigation.
- Both missing-node checks now read authoritative workflow node types.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_detail.js`
- `node --check web/modules/ui_sidebar.js`
- `node --check web/modules/ui_grid.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Preserve recipe identity across packages

**Implemented**

- Removed filename/path-first matching from `/anomalous/resolve_hash`; model matches now require allowed hash/size/category evidence, and a contradictory hash no longer degrades to a size-only guess.
- Preserved imported model identity and frozen preview descriptors by stable `(node_id, widget_index, category, saved_value)` reference keys while keeping current local availability transient.
- Exported packages now omit machine-local `source_image` paths and include snapshot assets referenced by selected historical versions as well as the current recipe.
- Restore keeps historical preview asset descriptors instead of recapturing from the current machine.
- Replacement import now stages all components and restores the previous recipe/assets/history state when a commit step fails.
- Updated the second missing-node preflight path to use authoritative workflow nodes as well.

**Validation**

- `python_embeded/python.exe tests/test_recipe_roundtrip.py` ‚Äî 9 tests passed
- `python_embeded/python.exe -m py_compile api/recipes.py api/models.py api/recipe_packages.py`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Harden Workflow Recipe save integrity

**Implemented**

- Captured the serialized canvas once before the recipe save dialog; the exact snapshot, rather than a later live-canvas serialization, is now sent to save/update.
- Kept generic node summaries bounded for browsing, but resolve saved editable/pinnable values from the authoritative workflow by node ID and widget index. Long prompt edits therefore retain their complete value.
- Preserved only valid existing pinned parameters during a canvas-based recipe update and display a localized count when prior pins no longer match the edited graph.
- Added backend graph topology validation (node IDs, widget bounds, link endpoint existence, and bounded node/link/group counts) plus save/update/restore integrity receipts containing persisted counts and fingerprint.
- Switched missing-node preflight to the saved workflow instead of bounded presentation metadata, and added a concise save receipt beside the Workspace action controls.

**Validation**

- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- Validated the real schema-v4 fixture: 13 nodes, 17 links, 0 groups
- `python_embeded/python.exe -m py_compile api/recipes.py`
- `git diff --check`

## [Planning Audit] 2026-08-03 ‚Äî Workflow Recipe integrity and UX hardening

- Added `.agents/plans/workflow_recipe_audit_and_hardening_plan.md` after a read-only audit of recipe save/update, detail rendering, canvas actions, model identity, history, package transfer, Workspace lifecycle, and CSS interaction structure.
- Verified one real schema-v4 recipe: the authoritative 13-node/17-link workflow, semantic model/sampler values, and full positive/negative prompts were saved; one 451-character prompt was intentionally truncated only in the 320-character generic summary.
- Identified P0 risks before further UI polish: truncated-summary editing, canvas-update pin loss, filename-first model matching, imported identity loss, incomplete history asset export, non-transactional replacement import, and unresolved cross-panel navigation state.
- Confirmed no source tests currently remain under `tests/`; the plan starts with private golden fixtures and round-trip tests.
- Runtime code and `ARCHITECTURE.md` were intentionally unchanged by this planning-only audit.

**Checks**

- Python compile check for `api/recipes.py` and `api/recipe_packages.py`
- `node --check` for all recipe frontend modules
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Keep native CLIP parameters together

**Implemented**

- Ordered parameter nodes against the serialized workflow before rendering, so fallback-recovered native nodes do not jump to the end.
- Grouped native `CLIPTextEncode` rows at the start of the Parameters view while preserving each node's original title and widget name.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Preserve native CLIP prompt parameters

**Implemented**

- Removed the extra abstract prompt block from the Parameters tab; the tab now keeps the native node/title and widget names.
- Added a bounded fallback that supplements `params.nodes` with every serialized `CLIPTextEncode` node whose prompt lives in `workflow.nodes[].widgets_values`.
- The existing Overview prompt summary remains unchanged, while Parameters now shows both positive and negative native CLIP text nodes when the older summary omitted one.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Show saved prompts in Parameters

**Implemented**

- Added the saved positive/negative prompt section to the Parameters tab.
- Reused the existing prompt extraction, full-workflow fallback, copy, and expand/collapse behavior already used by Overview.
- Kept generic node parameters separate; prompt visibility no longer depends on the bounded node-widget summary.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Split model composition in recipe overview

**Implemented**

- Replaced the Overview's combined model/LoRA key-value rows with a dedicated Model composition section.
- Rendered the base model and every LoRA as separate full-width blocks, preserving readable wrapping for long names and adding the existing copy/expand affordances.
- Kept steps, CFG, sampler, and resolution in the compact summary grid so model text no longer controls the layout of unrelated parameters.
- Added localized labels for the new composition and base-model blocks.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/locales.js`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Recipe model navigation and presentation cleanup

**Implemented**

- Fixed recipe model links and previews so they switch to the existing model detail panel without closing the main browser modal. Only the Workspace recipe overlay is hidden after the detail panel becomes visible.
- Changed the Models & reproducibility reference area from a dense vertical shared list to independent responsive cards with larger previews and isolated status/actions.
- Normalized base-model and LoRA values in the Overview and compact recipe cards to display filenames without filesystem paths or known model extensions. Full saved paths remain available only through the model reference Advanced information disclosure.

**Architecture decision**

- A recipe reference is a presentation/link boundary, not a second browser lifecycle. It may temporarily navigate to a local model detail record, but it must not invoke the browser-wide close/release path.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `git diff --check`

## [Snapshot] 2026-08-02

**Editable Workflow Recipes**

- Added safe in-place editing for recipe names, tags, notes, pinned parameters, and primitive widget values from standard or third-party nodes.
- Added an explicit canvas-edit path for structural workflow changes; saving from that path updates the original recipe instead of silently creating a duplicate.
- Added bounded local version history (20 snapshots) before every update, with restore controls and deletion of related history when a recipe is deleted.
- Kept recipe files and their history exclusively in ComfyUI user data, outside the plugin repository.

## [Snapshot] 2026-08-02 ‚Äî `a9d767e`

**Workflow Recipe Detail Foundation**

- Added the demand-loaded recipe detail panel: Overview, Models & reproducibility, Parameters, and Versions.
- Added schema-v3 canonical workflow fingerprints, supported model-reference summaries, identity-status rendering, bounded exact-reference availability refresh, parameter search, and version fingerprint summaries.
- Kept recipe card listing light. Detail data and history are fetched only after a user opens a recipe.
- Preserved the Model Doctor boundary: filename, path, preview, and fuzzy matching are never identity proof; detail browsing does not trigger recursive scans or full-file model hashing.

**Design and architecture decisions**

- The future public umbrella label is **Workspace / Âàõ‰ΩúÂ∑•‰ΩúÂè∞**; internal notebook API and storage names stay unchanged in the first presentation-only rename.
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

## [Snapshot] 2026-08-02 ‚Äî Workspace and saved preview completion

**Implemented**

- Renamed the visible Notebook surface to Workspace / Âàõ‰ΩúÂ∑•‰ΩúÂè∞ and its first section to Prompt Notes / ÊèêÁ§∫ËØçÁ¨îËÆ∞. Existing notebook routes, local storage, and internal property names remain unchanged.
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

## [Snapshot] 2026-08-02 ‚Äî Recipe discovery and semantic comparison

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

## [Snapshot] 2026-08-02 ‚Äî Contained recipe package transfer

**Implemented**

- Added versioned ZIP export with manifest checksums and explicit inclusion controls for preview snapshots, history, and model identity fields.
- Added bounded upload inspection plus single-use short-lived inspection tokens before import commit.
- Added archive path, symlink, compression, entry-count, expanded-size, JSON-depth, checksum, and WebP signature validation.
- Added staged import with generated local recipe identity, name collision rename flow, optional replace-with-history-backup support, and contained asset/history placement.
- Added Workspace Import package action and per-card Export package action with a privacy summary.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- ZIP export ‚Üí inspect smoke round trip passed with a contained WebP asset
- `git diff --check`

## [Snapshot] 2026-08-02 ‚Äî Runtime-safe append and Quick Queue handoff

**Implemented**

- Audited the action layer against the installed ComfyUI frontend's LiteGraph and prompt-queue contracts.
- Made append accept tuple and object-shaped serialized links, restore serialized groups with the same placement offset, reject subgraph definitions until ID remapping is implemented, and roll back nodes and groups together.
- Corrected Quick Queue to preserve the `{ output, workflow }` envelope returned by `app.graphToPrompt(...)`, which is the shape consumed by `api.queuePrompt`, while preserving the no-live-canvas-mutation boundary.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- `git diff --check`

## [Snapshot] 2026-08-02 ‚Äî Recipe action feedback and queue contract fix

**Implemented**

- Fixed Quick Queue to pass the complete host prompt envelope instead of only its `output` field.
- Awaited canvas loading before closing the Workspace and added a shared close path for detail-panel open/append actions.
- Added visible failure handling for asynchronous recipe-to-canvas loading.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- `git diff --check`

## [Snapshot] 2026-08-02 ‚Äî Recipe detail readability pass

**Implemented**

- Added a dedicated Overview prompt section for positive and negative prompts, including per-value expansion and copy controls.
- Detail Parameters now resolve full safe widget values from the saved serialized workflow instead of reusing the card's bounded 320-character summary.
- Added visible copy feedback for parameter values, model references, and hashes; long values are explicitly collapsible rather than silently ellipsized.
- Reworked version-diff text into before/after value blocks so long prompts and JSON remain readable, expandable, and copyable without forcing a wide row.
- Tightened Recipe detail spacing, card padding, thumbnail height, and summary grid sizing to reduce empty vertical space.

**Validation**

- `recipe_parser.js` positive/negative prompt fallback smoke test passed
- `node --check` for every JavaScript file under `web/`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Remove Quick Queue and unify recipe canvas actions

**Implemented**

- Removed the detached Quick Queue UI, prompt-conversion path, API queue call, localization entries, and unused styles.
- Exported the detail panel's Open/Append handlers so list cards use the same dirty-canvas confirmation, missing-node warning, error handling, and Workspace-close behavior.
- Added a list-card Append to Canvas action and a bounded full-recipe fetch helper for both card actions.
- Updated the architecture and implementation plans to make canvas actions the only recipe execution path.

**Validation**

- `rg` confirmed no active Quick Queue references remain in runtime modules or styles
- `node --check` for every JavaScript file under `web/`
- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Refine recipe detail UI

**Implemented**

- Added visible success/failure feedback to detail and card parameter-copy actions.
- Added inline editing for recipe name, notes, and tags; metadata updates send the complete existing recipe payload through `/anomalous/update_recipe` and preserve normal history behavior.
- Moved workflow fingerprints and model SHA-256 values into collapsed Advanced information disclosures.
- Added restrained glass card styling, responsive grid spacing, modern font fallbacks, rounded action controls, and hover transitions.

**Validation**

- `node --check` for every JavaScript file under `web/`
- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `git diff --check`

## [Snapshot] 2026-08-03 ‚Äî Add recipe advanced asset features

**Implemented**

- Turned detail model references into short-name preview cards with full path and hash disclosure under Advanced information.
- Added temporary links from exact local model matches into the main browser detail view; unresolved imported references remain inactive and expose an explicit Match Local Model action.
- Reused the existing hash/size/category resolver for lazy matching and the exact preview resolver for the activated card.
- Added MP4/WebM hover playback for bound output and model previews, plus first-frame WebP/JPEG thumbnail extraction for saved output videos.
- Kept recipe package export media-safe: original videos are not included and only bounded static WebP assets are exportable.

**Validation**

- `node --check` for every JavaScript file under `web/`
- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- Advanced recipe locale-key smoke check passed
- `git diff --check`

## [2026-08-03] UI ÷ÿππ”Îº‹ππæ´ºÚ
- **Recipe UI œ÷¥˙ªØ**: ∫œ≤¢¡À»ﬂ‘”µƒ Tabs£¨Ω´ ƒ£–Õ”Î∏¥œ÷ ∫Õ ≤Œ ˝ ∫œ≤¢Ω¯»Î ∏≈¿¿ √Ê∞Â£¨≤¢Ω´µ◊≤„≤Œ ˝ ’»Î’€µ˛◊Èº˛£¨º´¥Ûºı«·¡À–≈œ¢‘Î“Ù°£
- **≈‰∑Ωø®∆¨¡–±ÌΩµ‘Î**: “∆≥˝¡À‘≠≈‰∑Ω¡–±Ìø®∆¨…œµƒ»´¡ø≤Œ ˝’π æ£¨Ωˆ±£¡Ù∑‚√ÊÕº°¢±ÍÃ‚°¢±Í«©”Îƒ£–Õª’’¬£¨≤¢÷ÿππ¡À≤Ÿ◊˜∞¥≈•≤ºæ÷°£
- **Ωªª•¬ﬂº≠–ﬁ∏¥**: ∑œ∆˙¡Àº´“◊≥ˆ Bug µƒ Quick Queue ¬ﬂº≠£¨Õ≥“ª¡À°∫¥Úø™µΩª≠≤º°ª”Î°∫◊∑º”µΩª≠≤º°ªµƒ¬ﬂº≠∑‚◊∞°£
 
 # #   [ S n a p s h o t ]   2 0 2 6 - 0 8 - 0 3   -   R e c i p e   s c h e m a   v 5   o r i g i n   e x t r a c t i o n   a n d   r e n d e r i n g  
 * * I m p l e m e n t e d * *  
 -   S e p a r a t e d   m o d e l   p h y s i c a l   f i l e n a m e s   f r o m   o f f i c i a l   C - s i t e   o r i g i n   n a m e s .  
 -   U p d a t e d   g e t _ m e t a d a t a   t o   e x p o r t   m o d e l _ i d   a n d   v e r s i o n _ i d .  
 -   R e c i p e s   n o w   s t o r e   o r i g i n   i n f o   w h e n   s a v i n g / u p d a t i n g .  
 -   U I   p r i o r i t i z e s   o r i g i n . m o d e l _ n a m e   a n d   p r o v i d e s   a   C i v i t a i   l i n k   i f   a v a i l a b l e .  
 -   A d d e d   r e f r e s h   i d e n t i t i e s   b u t t o n   f o r   o l d e r   r e c i p e s .  
 -   L o c a l i z e d   i d e n t i t y   p h r a s e s   t o   b e   m o r e   h u m a n - c e n t r i c .  
 
## [Snapshot] 2026-08-03 - Fix Workspace reopen blank state and recipe identity compatibility

**Implemented**

- Rehydrated the notebook body and active section when reopening an already initialized Workspace after close.
- Kept recipe body hidden while reopening the default notebook section, preventing an empty Workspace overlay.
- Made recipe model-reference enrichment accept both the new identity-plus-origin helper result and the legacy identity-only contract.

**Validation**

- `node --check web/main.js web/modules/ui_notebooks.js web/modules/ui_sidebar.js web/modules/ui_recipes.js`
- `python_embeded/python.exe -m py_compile api/recipes.py api/metadata.py`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`

## [2026-08-03] UI Refactor: Parameter Sorting & Localization
- Removed redundant overview parameter summary.
- Added Kahn topological sort for parameter nodes to match workflow execution order.
- Integrated LiteGraph native node and widget translations via dynamic dummy node creation.

## [Snapshot] 2026-08-03 - Fix origin refresh enrichment

**Implemented**

- Replaced the invalid list-attribute refresh flag with an explicit enrichment argument.
- Origin refresh now recomputes identity and Civitai origin metadata without preserving stale values.
- Normal enrichment continues to preserve imported identity/origin records when appropriate.
- Recipe writes now emit schema version 5 for the origin metadata extension.

**Validation**

- `python_embeded/python.exe -m py_compile api/recipes.py api/metadata.py`
- `node --check web/modules/ui_recipe_detail.js web/modules/ui_notebooks.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`

## [Snapshot] 2026-08-03 - Bound recipe identity labels

**Implemented**

- Shortened identity badge labels and kept their full explanations in the help tooltip.
- Added shrink and wrapping constraints to identity badges, model names, and model-reference header rows.
- Prevented localized or imported model status text from expanding recipe cards beyond their container.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `git diff --check` (apart from the pre-existing historical log whitespace warning)

## [Snapshot] 2026-08-03 - Add availability refresh feedback

**Implemented**

- Added an immediate loading label and rotating indicator to the model availability button.
- Added `aria-busy` and polite status updates for assistive feedback.
- Restored the original button state when the request fails, while successful refreshes rebuild the updated control.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`

## [Snapshot] 2026-08-03 - Improve identity help feedback

**Implemented**

- Replaced the weak native-only question-mark hint with a custom high-contrast tooltip.
- Tooltip text wraps within a bounded width and appears on hover or keyboard focus.
- Retained the native `title` and added an accessible label as fallbacks.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`

## [Snapshot] 2026-08-03 - Redesign identity explanation interaction

**Implemented**

- Replaced the duplicated hover/native tooltip behavior with a clickable question-mark control.
- Identity explanations now expand inline below the badge in normal document flow.
- Removed the overlapping absolute tooltip so adjacent text cannot cover or hide the explanation.
- Added `aria-expanded` and keyboard-focus styling to the help control.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`

## [2026-08-03] UI Refactor: Manual Origin Editing & Civitai Fetching
- Added Edit Origin dialog for workflow recipe models.
- Implemented auto-fetching of official model information from Civitai via hash.
- Added robust modal overlay and new translation strings.

## [Snapshot] 2026-08-03 - Repair manual origin editing and refresh command

**Implemented**

- Fixed Edit Origin to locate references by node/widget/category/saved value instead of nonexistent `type`.
- Restored localized Save/Cancel labels for the origin dialog.
- Allowed the refresh-origin endpoint to enrich an existing recipe when called with the compact refresh-only request.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `python_embeded/python.exe -m py_compile api/recipes.py api/metadata.py`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
## [Snapshot] 2026-08-03 - Match imported recipe models locally

**Implemented**

- Replaced the detail-header origin refresh action with batch local model matching.
- Matching is constrained by model hash, file size, and model category; author paths and filenames are not identity evidence.
- Added an explicit Apply match action that updates the workflow only after confirmation and keeps the full-recipe history path.
- Added visible progress, summary, error feedback, and localized labels for the new flow.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/locales.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`