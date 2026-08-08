# AI Changelog

## [Snapshot] 2026-08-07 - Core: Topological Prompt Tracing Engine & Crash Fix

**Implemented**

- **Topological Backward-Tracing Fix**: Replaced the fragile regex/fuzzy-name matching for Positive/Negative prompts in `recipe_parser.js`. Implemented `collectConditioningNodes` to trace upstream from KSampler inputs (like `positive`, `negative`, `conditioning`). Critically, fixed a blindspot where custom sampler inputs named `uncond`, `model_cond`, or `cond` were ignored, ensuring negative prompts are strictly traced across all sampler varieties.
- **Node Assistant Dynamic Role Injection**: Fixed an issue where the Node Assistant failed to render `[🟢 正面]` and `[🔴 负面]` tags for old/new parameter notebooks. The backend (`api/parameters.py`) now dynamically reads the bounded recipe's `metadata.nodes` to resolve topological `role` by `node.id`, injecting it directly into the parameter responses. Added a smart fallback for global unbound notebooks to default to Positive if "negative" isn't in the title.
- **ES Module Syntax Crash Fix**: Fixed a massive unclosed-bracket syntax error in `recipe_parser.js` resulting from a malformed code replacement. The error caused the UI to disappear silently due to the browser aborting the ES Module parsing.

## [Snapshot] 2026-08-07 - Node Assistant Preset Hierarchy Clarity Update

**Implemented**

- **UI Hierarchy Clarification**: Fixed a UX issue in the Node Assistant's "Parameter Presets" tab where users confused Recipe Group folders with Notebooks. Added explicit prefixes `🍱 配方:` (Recipe Group) and `📓 笔记本:` (Notebook) to clarify the data structure.
- **Graceful Fallbacks for Deleted/Unbound Recipes**: 
  - Parameter notebooks that belong to a deleted recipe (previously showing raw `recipe_xxx.json` filenames) now correctly display as `⚠️ 已删除配方 (Deleted)`.
  - Notebooks without a specific recipe (`unbound`) are now labeled as `🌍 全局无绑定 (Global/Unbound)`.
- **Apply Button Clarity**: Added the `✨ 应用到 -> (Apply To)` prefix on the terminal buttons that inject parameters to the selected node, clarifying their function.

## [Snapshot] 2026-08-07 - Node Assistant Layout & Bug Fixes

**Implemented**

- **Tabs Layout in Node Assistant**: Redesigned the Node Assistant panel (`ui_doctor.js`) to use a dual-tab layout ("🛠️ Quick Actions" and "📚 Parameter Presets"). This prevents the UI from becoming cluttered with both action buttons and preset trees simultaneously.
- **Node Detection Bug Fix**: Fixed an issue in `diagnoseNode` where non-model nodes (like `KSampler` or `CLIPTextEncode`) were incorrectly short-circuited and prevented from rendering Parameter Presets. Now, if a node has no model parameters, the Node Assistant defaults to opening the "Parameter Presets" tab directly rather than displaying a blocking error.
- **Human-Readable Recipe Names**: Updated `api/parameters.py` to cross-reference the actual `name` property from the source Recipe files instead of displaying raw file paths (e.g., `recipe_1786017329_37f3947d.json`). This ensures the UI properly displays human-readable names for grouped parameter presets.

**Validation**

- Verified `diagnoseNode` correctly falls back to the parameter preset tab for nodes without model parameters.
- Verified recipe names are accurately fetched and displayed in the tree structure.

## [Snapshot] 2026-08-07 - Node Assistant and Parameter Notebook Integration

**Implemented**

- **Auto-Filtering by Node Type**: Extended `api/parameters.py` with `/anomalous/parameters/by_node_type` to parse parameter notebooks across all recipes and return node values filtered precisely by the requested node `type`.
- **In-Memory Caching**: Added a lightweight 2-second in-memory cache to the parameter endpoint to optimize consecutive UI interactions without slamming the disk.
- **Hierarchical Node Assistant Integration**: Updated `ui_doctor.js` to render contextual parameter presets whenever a specific node is selected. Parameters are neatly grouped by Recipe -> Notebook -> Parameter Summary.
- **One-Click Local Application**: Implemented `applyLocalNodeParameters` in `ui_doctor.js`, allowing users to safely overlay specific notebook parameters onto a single active node while preserving other canvas components and invoking appropriate ComfyUI widget callbacks.
- **Logic Guidelines**: Created the `parameter_notebook_integration_guide.md` guideline document outlining the newly merged subsystem architecture and troubleshooting steps.

**Validation**

- Parameter fetching is fast and correctly matches the node type.
- Tree UI properly defaults to a collapsed state for inactive recipes.
- Target widgets receive correctly injected values and UI update callbacks without crashing.

## [Snapshot] 2026-08-06 - Parameter Notebook UI Redesign & Hero Gallery

**Implemented**

- **Parameter Notebook Layout**: Completely redesigned the parameter notebook to use a modern Dashboard layout. The parameter summary now uses a spacious CSS Grid format (`.anomalous-recipe-detail-summary-grid`).
- **Node Cards & Smart Expansion**: Each node's parameters are wrapped in a styled card (`.anomalous-recipe-detail-parameter-node`). The inner widgets use a responsive grid layout to eliminate vertical cramming. Overly long nodes automatically collapse to a maximum height (`is-collapsed`) with a smooth gradient mask and a bottom expand button.
- **Hero Image Gallery (Plan B)**: Replaced the bottom inline gallery section with a prominent Hero Section (`.anomalous-recipe-detail-hero`) at the top. The first generated image acts as a large cover banner.
- **Modal Gallery Viewer**: If a recipe has multiple generated images, a sleek glassmorphism button overlay appears on the hero image (e.g., `🖼️ 图库 (5)`). Clicking it opens a native HTML `<dialog>` containing the full gallery grid, preventing the parameter view from bloating vertically while keeping the core browsing experience focused.
- **Gallery Grid Refactor**: Removed the cluttered action buttons ("Set Cover", "Compare", "View Image") from all gallery cards across the application. Gallery grids now use a sleek, uniform responsive layout (`aspect-ratio: 1`, `object-fit: cover`) with a subtle hover zoom effect, relying on a direct click to view the original image.
- **Node Widget Layout Fix**: Addressed a bug where very long text widgets (like prompts in CLIP nodes) were squished into narrow columns. Lowered the `.is-wide` threshold from 90 to 50 characters and ensured `.is-wide` elements span the full width of the node grid (`grid-column: 1 / -1`).
- **Label Overflow Fix**: Fixed an issue where long, continuous parameter names (like `control_after_generate`) would overlap their values in the grid by adding `word-break: break-all` and `overflow-wrap: anywhere` to `.anomalous-recipe-detail-label`.
- **Node Widget Copy**: Enabled the one-click copy button for all non-volatile node parameters inside the parameter notebook view by removing the `copy: false` restriction.
- **Gallery Viewer Z-Index Fix**: Upgraded the full-screen image viewer (`showGalleryViewer`) from a standard `<div>` to a native `<dialog>` element. By utilizing `.showModal()`, the viewer now reliably renders in the browser's top-layer, preventing it from being occluded by other newly introduced modal dialogs (like the gallery grid).
- **Gallery Viewer Close Fix**: Fixed a bug where the full-screen viewer would not disappear when closed. Removed a hardcoded `display: flex` override in CSS that forced the native `<dialog>` to remain visible even without the `open` attribute.
- **Gallery Button Optimization**: Removed the explicit image count from the hero gallery button (e.g., `(2)`) and ensured the button always displays even if there is only 1 image. This aligns with a lazy-loading philosophy, as the modal DOM is only generated when clicked, saving initial render performance.
- **Node Parameter Layout Fix**: Fixed an issue where moderate-length text values (like 39-character model filenames) were being aggressively squished and word-broken into a tiny box. Increased the base node widget grid column width from `200px` to `280px` (`.anomalous-recipe-detail-node-widgets`), and lowered the `.is-wide` full-width threshold from 50 characters to 35 characters.
- **Sidebar Button Refactor**: Restructured the layout of the "Parameter Snapshots" sidebar. Moved the "New Snapshot" and "Read Current" buttons into a dedicated, vertically-stacked action block below the title. Converted the bulky "Refresh" text button into a sleek `↻` icon button aligned to the right of the section title, drastically improving the visual hierarchy.
- **Recipe Detail Top Bar Removal**: Addressed UX confusion where action buttons (Match Models, Append to Canvas, Edit) remained visible even when switching to unrelated tabs like Parameter Notebook. Completely removed the persistent top bar (`.anomalous-recipe-detail-header`). Integrated the "Back" button seamlessly into the tab navigation bar as the first element (`← 返回...`), and relocated all recipe-level action buttons directly into the Hero section of the "Overview" tab. This eliminates duplicate title display and ensures context-specific actions only appear where relevant.
- **Critical UI Crash Fix**: Fixed a silent `SyntaxError` (Identifier has already been declared) introduced during the top bar refactor, which caused the entire frontend module to fail and the main plugin icon to disappear. Renamed conflicting block-scoped variables in `renderOverview`.
- **Parameter Collapse Overlay Removal**: Removed the aggressive "collapse if > 4 widgets" behavior (`▼` button overlay) from parameter nodes in both read-only and edit modes, as it was visually overlapping with parameter values like `steps` and causing UX annoyance.

**Validation**

- Node widget grid correctly scales based on available width.
- Smart expansion accurately toggles `max-height` via CSS classes without recalculating DOM dimensions.
- Native `<dialog>` modal manages z-index and backdrop natively, avoiding clashes with the main UI shell.

## [Snapshot] 2026-08-06 - Parameter Notebook UI Tweaks

**Implemented**

- **Parameter Notebook Animation**: Enhanced the CSS animation for parameter notebook switching (`.anomalous-recipe-detail-parameters.is-switching`) to use a staggered waterfall effect. Fixed a bug in `ui_recipe_detail.js` where synchronous double-rendering swallowed the animation class by deferring the `switchToken` clearance to a microtask.
- **LoRA Formatting**: Improved the display of the LoRA parameter in the recipe details summary (`ui_recipe_detail.js`). Instead of a raw stringified JSON array, LoRAs are now formatted into clean, multi-line blocks with itemized bullets and explicit model/clip strengths.
- **Agent Rules**: Added a mandatory handoff and documentation protocol to `AGENTS.md`.

**Validation**

- Verified parameter switching correctly triggers the CSS transition sequence without flashing.
- LoRA strings render nicely with `white-space: pre-wrap`.

## [Snapshot] 2026-08-06 - Complete Recipe and hash resolver i18n migration

**Implemented**

- Migrated `web/modules/ui_recipes.js` and `web/modules/ui_recipe_detail.js` from direct dictionary access to the shared `translate` contract.
- Verified the supporting Recipe modules already use the shared translation keys and included them in coverage checks.
- Migrated `web/hash_resolver.js` manual repair feedback to `hashResolverFixed` with `{count}` interpolation.
- Added the missing Chinese `recipeDialogNo` translation key required by Recipe package export confirmation.

**Validation**

- JavaScript syntax checks passed for every file under `web/`.
- Recipe/hash translator coverage passed for 185 static keys in both `zh` and `en`.
- Hash repair count interpolation passed.
- `node tests/recipe_parser_roundtrip.mjs` passed.
- Python compilation passed for every `api/*.py` module and `scraper.py` using the bundled Python runtime.
- Targeted `git diff --check` passed; the existing user change in `README.md` was kept outside this snapshot.

**Next**

- Stage 2 i18n migration is complete. MIT licensing, Russian localization, final ComfyUI validation, and remote delivery remain explicitly deferred.

## [Decision] 2026-08-06 - Defer license, Russian PR, and remote delivery

**Decision**

- MIT licensing work is deferred to the user's separate Gemini workflow; the existing local `LICENSE` remains untouched and uncommitted by this task.
- Russian localization is deferred until the contributor submits the promised PR.
- Remote pushes, Issue #9 synchronization, and community delivery are deferred until the user explicitly authorizes them after feature work is complete.
- Local work continues only on the remaining Recipe and `hash_resolver.js` i18n migration, using the existing snapshot discipline.

## [Snapshot] 2026-08-06 - Migrate sidebar, scan wizard, settings, and folder manager i18n

**Implemented**

- Migrated `web/modules/ui_sidebar.js` to the shared translator.
- Extracted navigation titles, scan wizard choices/descriptions, metadata/hash controls, model-card settings, language-toggle refresh labels, layout controls, and folder-manager copy into the locale dictionaries.
- Converted wizard/list helpers to key-based translation calls and preserved trusted rich-text descriptions as dictionary-owned content.
- Kept dynamic model filenames, selection counts, API error messages, folder data, and scan status values as runtime data with parameter interpolation or text content.

**Validation**

- JavaScript syntax checks passed for every file under `web/`.
- Sidebar translator coverage passed for 83 static keys in both `zh` and `en`, including count and filename interpolation.
- `node tests/recipe_parser_roundtrip.mjs` passed.
- Python compilation passed for every `api/*.py` module and `scraper.py` using the bundled Python runtime.
- Targeted `git diff --check` passed; the existing user change in `README.md` was kept outside this snapshot.

**Next**

- Migrate the Recipe-related modules and `hash_resolver.js` as the final Stage 2 language batch; Russian locale and MIT licensing remain separate later stages.

## [Snapshot] 2026-08-06 - Migrate main workflow import and share-code i18n

**Implemented**

- Migrated `web/main.js` preflight workflow import UI to the shared translator.
- Migrated workflow share-code export, import, and unified modal labels, status messages, placeholders, and node-count interpolation.
- Composed preflight result headings and empty states with DOM nodes while keeping workflow/model/node data dynamic.
- Kept the locale conditional used by the translation API only for the backend `zh-CN`/`en` service code mapping; it is not a user-facing copy branch.

**Validation**

- JavaScript syntax checks passed for every file under `web/`.
- All 218 static translator calls in the migrated UI modules resolve in both `zh` and `en` dictionaries.
- `node tests/recipe_parser_roundtrip.mjs` passed.
- Targeted `git diff --check` passed; the existing user change in `README.md` was kept outside this snapshot.

**Next**

- Migrate `web/modules/ui_sidebar.js` as its own reviewable snapshot; Recipe and hash-resolver branches remain untouched.

## [Snapshot] 2026-08-06 - Migrate detail, doctor, assistant, picker, and notebook i18n

**Implemented**

- Migrated `web/modules/ui_detail.js`, `web/modules/ui_doctor.js`, and `web/modules/ui_notebooks.js` to the shared translator.
- Added locale entries for model editing, batch selection, Doctor diagnostics, Node Assistant actions, model replacement/insertion, history cards, and Notebook validation.
- Replaced language-condition branches with parameterized translation calls while keeping model names, paths, node types, scan filenames, and API messages dynamic.
- Preserved status styling for selected counts, empty/error states, healthy Doctor output, compatible-model messages, and missing-cover messages through DOM composition.
- Added the missing `galleryCancel` key used by the previous Gallery migration snapshot.

**Validation**

- JavaScript syntax checks passed for every file under `web/`.
- All 189 static translator calls in the migrated UI modules resolve in both `zh` and `en` dictionaries.
- Locale interpolation checks passed for Doctor scan status, picker selection, Assistant history counts, and Detail selection counts.
- `node tests/recipe_parser_roundtrip.mjs` passed.
- Python compilation passed for every `api/*.py` module and `scraper.py` using the bundled Python runtime.
- Targeted `git diff --check` passed; the existing user change in `README.md` was kept outside this snapshot.

**Next**

- Continue with the next Stage 2 group only after review; Sidebar, Recipe, and hash-resolver branches remain untouched.

## [Snapshot] 2026-08-06 - Migrate grid and gallery i18n

**Implemented**

- Migrated `web/modules/ui_grid.js` and `web/modules/ui_gallery.js` to the shared translator.
- Added the grid and gallery locale keys, including parameterized generated-history titles.
- Rebuilt the gallery delete confirmation and cover-selection banner with DOM composition and `textContent`, keeping user-controlled model names out of translated HTML.

**Validation**

- JavaScript syntax checks passed for every file under `web/`.
- Shared i18n lookup/interpolation checks passed for the new grid and gallery keys.
- `node tests/recipe_parser_roundtrip.mjs` passed.
- Python compilation passed for every `api/*.py` module and `scraper.py` using the bundled Python runtime.
- Targeted `git diff --check` passed; the existing user change in `README.md` was kept outside this snapshot.

**Next**

- Continue with the next Stage 2 module group only after review; Sidebar, Detail, Doctor, Notebook, Recipe, and hash-resolver branches remain untouched.

## [Snapshot] 2026-08-06 - Establish shared i18n foundation and migrate dialog pilot

**Implemented**

- Added normalized locale handling and a shared translation contract to `web/modules/locales.js`: supported-locale discovery, locale normalization, safe fallback, parameter interpolation, and reusable translators.
- Added `dialogOk` and `dialogCancel` keys to the existing Chinese and English dictionaries.
- Updated `web/main.js` to consume the shared locale contract instead of reading the dictionary directly, while preserving the existing zh/en detection behavior.
- Migrated `web/modules/ui_dialog.js` to the shared translator for alert/confirm buttons. No larger UI module, Russian locale, or MIT license was changed in this snapshot.

**Validation**

- `node --check` passed for every JavaScript file under `web/`.
- Direct i18n foundation checks passed for locale normalization, unsupported-locale fallback, translation lookup, and missing-key fallback.
- `node tests/recipe_parser_roundtrip.mjs` passed.
- Python compilation passed for every `api/*.py` module and `scraper.py` using the bundled Python runtime.
- `git diff --check` passed.

**Next**

- Continue only with the next explicitly approved migration batch. The remaining inline branches stay unchanged so each later batch remains independently reviewable and reversible.

## [Plan Snapshot] 2026-08-06 - Full project audit and staged i18n plan

**Audited**

- Completed a read-only inventory of the local extension: Vanilla JS/CSS frontend, Python `aiohttp` backend, empty ComfyUI node mappings, current locale ownership, inline language branches, ignored local tests, runtime service URLs, and bundled-resource/dependency state.
- Confirmed the repository currently has no LICENSE file or bundled third-party assets, while runtime integrations with ComfyUI, Civitai, and optional translation services remain external boundaries.
- Confirmed that `locales.js` is already the dictionary center but language detection, fallback, and inline UI strings are not yet governed by one contract.

**Planned**

- Replaced the broad i18n/licensing proposal with a staged, reversible plan: establish a shared translation contract and migrate one small module first; migrate the remaining UI by module; add MIT separately; then invite the Russian localization PR.
- Added explicit constraints for parameter interpolation, safe HTML, dynamic/user data, locale fallback, contribution licensing, and local snapshot commits.

**Validation**

- Read-only repository status was clean before this documentation snapshot at baseline `f9f52a6f65883e9c9082d72c31131862d9b56865`.
- Audited runtime files, API route registration, language call sites, ignored tests, dependency manifests, external URLs, and project rules.
- No runtime code was changed in this snapshot.

**Next**

- Await explicit approval to implement only Stage 1: the shared i18n foundation plus one small pilot module.

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

## [Snapshot] 2026-08-04 - Restore browser entry after recipe module parse failure

**Implemented**

- Diagnosed the missing plugin icon against a live ComfyUI runtime instead of treating it as a CSS-only issue.
- Confirmed `/extensions/Anomalous_Model_Browser/*` was served and the hash resolver registered, while the main browser extension was absent from ComfyUI's extension registry.
- Removed the duplicate `summaryValue` and `createBadge` declarations in `web/modules/ui_recipes.js`. The duplicate top-level declarations caused `SyntaxError: Identifier 'summaryValue' has already been declared`, which stopped `main.js` from loading and prevented the trigger from being mounted.
- Added the parseability and runtime-entry-point rule to `ARCHITECTURE.md`.

**Validation**

- All plugin JavaScript files passed `node --check`.
- Live ComfyUI runtime on port 8199 loaded the plugin and created `#anomalous-trigger-btn` with the established `📦` mark, visible at the bottom-right of the viewport.
- Temporary module probe was removed after diagnosis.
- `git diff --check`.

## [Snapshot] 2026-08-04 - Restore the original plugin mark

- Restored the original 📦 floating trigger mark after the startup-resilience audit; no functional behavior changed.
- `node --check web/main.js`
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
## [Snapshot] 2026-08-03 â€” Complete recipe model return cleanup

- When returning from a model detail opened by a recipe, explicitly hide and clean the model panel before restoring the Workspace recipe detail view.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Guard recipe card actions

**Implemented**

- Added a single card-action runner for detail, edit, export, open, append, and delete actions.
- Buttons are disabled while their asynchronous operation is active and always restored in `finally`, including cancellation and failed requests.
- Removed duplicated card-level error handling where the runner now owns the failure feedback.

**Validation**

- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Stabilize recipe detail navigation lifecycle

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

## [Snapshot] 2026-08-03 â€” Preserve recipe identity across packages

**Implemented**

- Removed filename/path-first matching from `/anomalous/resolve_hash`; model matches now require allowed hash/size/category evidence, and a contradictory hash no longer degrades to a size-only guess.
- Preserved imported model identity and frozen preview descriptors by stable `(node_id, widget_index, category, saved_value)` reference keys while keeping current local availability transient.
- Exported packages now omit machine-local `source_image` paths and include snapshot assets referenced by selected historical versions as well as the current recipe.
- Restore keeps historical preview asset descriptors instead of recapturing from the current machine.
- Replacement import now stages all components and restores the previous recipe/assets/history state when a commit step fails.
- Updated the second missing-node preflight path to use authoritative workflow nodes as well.

**Validation**

- `python_embeded/python.exe tests/test_recipe_roundtrip.py` â€” 9 tests passed
- `python_embeded/python.exe -m py_compile api/recipes.py api/models.py api/recipe_packages.py`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Harden Workflow Recipe save integrity

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

## [Planning Audit] 2026-08-03 â€” Workflow Recipe integrity and UX hardening

- Added `.agents/plans/workflow_recipe_audit_and_hardening_plan.md` after a read-only audit of recipe save/update, detail rendering, canvas actions, model identity, history, package transfer, Workspace lifecycle, and CSS interaction structure.
- Verified one real schema-v4 recipe: the authoritative 13-node/17-link workflow, semantic model/sampler values, and full positive/negative prompts were saved; one 451-character prompt was intentionally truncated only in the 320-character generic summary.
- Identified P0 risks before further UI polish: truncated-summary editing, canvas-update pin loss, filename-first model matching, imported identity loss, incomplete history asset export, non-transactional replacement import, and unresolved cross-panel navigation state.
- Confirmed no source tests currently remain under `tests/`; the plan starts with private golden fixtures and round-trip tests.
- Runtime code and `ARCHITECTURE.md` were intentionally unchanged by this planning-only audit.

**Checks**

- Python compile check for `api/recipes.py` and `api/recipe_packages.py`
- `node --check` for all recipe frontend modules
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Keep native CLIP parameters together

**Implemented**

- Ordered parameter nodes against the serialized workflow before rendering, so fallback-recovered native nodes do not jump to the end.
- Grouped native `CLIPTextEncode` rows at the start of the Parameters view while preserving each node's original title and widget name.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Preserve native CLIP prompt parameters

**Implemented**

- Removed the extra abstract prompt block from the Parameters tab; the tab now keeps the native node/title and widget names.
- Added a bounded fallback that supplements `params.nodes` with every serialized `CLIPTextEncode` node whose prompt lives in `workflow.nodes[].widgets_values`.
- The existing Overview prompt summary remains unchanged, while Parameters now shows both positive and negative native CLIP text nodes when the older summary omitted one.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Show saved prompts in Parameters

**Implemented**

- Added the saved positive/negative prompt section to the Parameters tab.
- Reused the existing prompt extraction, full-workflow fallback, copy, and expand/collapse behavior already used by Overview.
- Kept generic node parameters separate; prompt visibility no longer depends on the bounded node-widget summary.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Split model composition in recipe overview

**Implemented**

- Replaced the Overview's combined model/LoRA key-value rows with a dedicated Model composition section.
- Rendered the base model and every LoRA as separate full-width blocks, preserving readable wrapping for long names and adding the existing copy/expand affordances.
- Kept steps, CFG, sampler, and resolution in the compact summary grid so model text no longer controls the layout of unrelated parameters.
- Added localized labels for the new composition and base-model blocks.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/locales.js`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Recipe model navigation and presentation cleanup

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

## [Snapshot] 2026-08-02 â€” `a9d767e`

**Workflow Recipe Detail Foundation**

- Added the demand-loaded recipe detail panel: Overview, Models & reproducibility, Parameters, and Versions.
- Added schema-v3 canonical workflow fingerprints, supported model-reference summaries, identity-status rendering, bounded exact-reference availability refresh, parameter search, and version fingerprint summaries.
- Kept recipe card listing light. Detail data and history are fetched only after a user opens a recipe.
- Preserved the Model Doctor boundary: filename, path, preview, and fuzzy matching are never identity proof; detail browsing does not trigger recursive scans or full-file model hashing.

**Design and architecture decisions**

- The future public umbrella label is **Workspace / åˆ›ä½œå·¥ä½œå�°**; internal notebook API and storage names stay unchanged in the first presentation-only rename.
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

## [Snapshot] 2026-08-02 â€” Workspace and saved preview completion

**Implemented**

- Renamed the visible Notebook surface to Workspace / åˆ›ä½œå·¥ä½œå�° and its first section to Prompt Notes / æ��ç¤ºè¯�ç¬”è®°. Existing notebook routes, local storage, and internal property names remain unchanged.
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

## [Snapshot] 2026-08-02 â€” Recipe discovery and semantic comparison

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

## [Snapshot] 2026-08-02 â€” Contained recipe package transfer

**Implemented**

- Added versioned ZIP export with manifest checksums and explicit inclusion controls for preview snapshots, history, and model identity fields.
- Added bounded upload inspection plus single-use short-lived inspection tokens before import commit.
- Added archive path, symlink, compression, entry-count, expanded-size, JSON-depth, checksum, and WebP signature validation.
- Added staged import with generated local recipe identity, name collision rename flow, optional replace-with-history-backup support, and contained asset/history placement.
- Added Workspace Import package action and per-card Export package action with a privacy summary.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- ZIP export â†’ inspect smoke round trip passed with a contained WebP asset
- `git diff --check`

## [Snapshot] 2026-08-02 â€” Runtime-safe append and Quick Queue handoff

**Implemented**

- Audited the action layer against the installed ComfyUI frontend's LiteGraph and prompt-queue contracts.
- Made append accept tuple and object-shaped serialized links, restore serialized groups with the same placement offset, reject subgraph definitions until ID remapping is implemented, and roll back nodes and groups together.
- Corrected Quick Queue to preserve the `{ output, workflow }` envelope returned by `app.graphToPrompt(...)`, which is the shape consumed by `api.queuePrompt`, while preserving the no-live-canvas-mutation boundary.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- `git diff --check`

## [Snapshot] 2026-08-02 â€” Recipe action feedback and queue contract fix

**Implemented**

- Fixed Quick Queue to pass the complete host prompt envelope instead of only its `output` field.
- Awaited canvas loading before closing the Workspace and added a shared close path for detail-panel open/append actions.
- Added visible failure handling for asynchronous recipe-to-canvas loading.

**Validation**

- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `node --check` for every JavaScript file under `web/`
- `git diff --check`

## [Snapshot] 2026-08-02 â€” Recipe detail readability pass

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

## [Snapshot] 2026-08-03 â€” Remove Quick Queue and unify recipe canvas actions

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

## [Snapshot] 2026-08-03 â€” Refine recipe detail UI

**Implemented**

- Added visible success/failure feedback to detail and card parameter-copy actions.
- Added inline editing for recipe name, notes, and tags; metadata updates send the complete existing recipe payload through `/anomalous/update_recipe` and preserve normal history behavior.
- Moved workflow fingerprints and model SHA-256 values into collapsed Advanced information disclosures.
- Added restrained glass card styling, responsive grid spacing, modern font fallbacks, rounded action controls, and hover transitions.

**Validation**

- `node --check` for every JavaScript file under `web/`
- `python_embeded/python.exe -m py_compile api/__init__.py api/models.py api/recipes.py api/recipe_packages.py`
- `git diff --check`

## [Snapshot] 2026-08-03 â€” Add recipe advanced asset features

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

## [2026-08-03] UI ÖØ¹¹Óë¼Ü¹¹¾«¼ò
- **Recipe UI ÏÖ´ú»¯**: ºÏ²¢ÁËÈßÔÓµÄ Tabs£¬½« Ä£ÐÍÓë¸´ÏÖ ºÍ ²ÎÊý ºÏ²¢½øÈë ¸ÅÀÀ Ãæ°å£¬²¢½«µ×²ã²ÎÊýÊÕÈëÕÛµþ×é¼þ£¬¼«´ó¼õÇáÁËÐÅÏ¢ÔëÒô¡£
- **Åä·½¿¨Æ¬ÁÐ±í½µÔë**: ÒÆ³ýÁËÔ­Åä·½ÁÐ±í¿¨Æ¬ÉÏµÄÈ«Á¿²ÎÊýÕ¹Ê¾£¬½ö±£Áô·âÃæÍ¼¡¢±êÌâ¡¢±êÇ©ÓëÄ£ÐÍ»ÕÕÂ£¬²¢ÖØ¹¹ÁË²Ù×÷°´Å¥²¼¾Ö¡£
- **½»»¥Âß¼­ÐÞ¸´**: ·ÏÆúÁË¼«Ò×³ö Bug µÄ Quick Queue Âß¼­£¬Í³Ò»ÁË¡º´ò¿ªµ½»­²¼¡»Óë¡º×·¼Óµ½»­²¼¡»µÄÂß¼­·â×°¡£
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
## [Snapshot] 2026-08-04 - Keep recipe canvas loads in the active tab

**Implemented**

- Updated recipe Open-to-canvas and recipe-edit canvas loading for the current ComfyUI workflow-tab API. The frontend Pinia workflow store is discovered through the mounted Vue app and the active workflow is passed to `app.loadGraphData()` as its fourth argument, preventing an unintended new temporary tab.
- Kept the legacy three-argument fallback for older ComfyUI builds that do not expose the workflow store.
- Made successful recipe canvas actions explicitly hide notebook content, recipe content, the recipe panel, and the outer plugin modal before running the existing close/media cleanup, preventing a blank workspace shell after the canvas transition.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
## [Snapshot] 2026-08-04 - Remove ambiguous recipe Open action

**Implemented**

- Removed â€œOpen to Canvasâ€� buttons from recipe cards and recipe detail views.
- Kept â€œAppend to Canvasâ€� as the only recipe composition action, so saved recipes never replace the user's current canvas or depend on ComfyUI workflow-tab semantics.
- Kept the separate structural-edit action as an explicitly confirmed new-canvas editing flow.
- Removed obsolete open-action locale strings and the unused active-workflow loader.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/locales.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `python_embeded/python.exe -m py_compile api/recipes.py api/metadata.py api/models.py api/recipe_packages.py`
## [Snapshot] 2026-08-04 - Remove key-parameter selection from recipe save

**Implemented**

- Removed the expandable â€œChoose key parametersâ€� section from the save-recipe dialog.
- Removed the now-unused save-dialog pin-selection state and locale text.
- Kept the serialized workflow and all existing save fields unchanged; editing an older recipe preserves its existing `params.pinned` metadata, while new saves use an empty pin list.
- Removed the unused parameter-choice field from the save draft payload.

**Validation**

- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/recipe_parser.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
## [Snapshot] 2026-08-04 - Fix docked notebook creation and live output gallery

**Implemented**

- Fixed the docked notebook create row by giving it a bounded layout, allowing the name input to shrink, and keeping the confirmation button visible and clickable in the 80px compact sidebar.
- Added cache-free gallery head refreshes when the gallery opens and a three-second live poll while it is visible.
- Rebuild the gallery only when output image count or the newest page signature changes, preserving scroll position and stopping the timer when the panel/plugin closes.
- Fixed gallery cover-selection initialization to use the existing `galleryLoaded` state instead of reading an uninitialized image array.

**Validation**

- `node --check web/modules/ui_notebooks.js`
- `node --check web/modules/ui_gallery.js`
- `node --check web/modules/ui_sidebar.js`
- `node --check web/main.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
## [Snapshot] 2026-08-04 - Make gallery refresh user-triggered

**Implemented**

- Removed the continuous gallery polling timer.
- The main gallery performs one scan when opened.
- Added a visible Refresh button to the gallery toolbar; clicking it rescans the output directory, preserves scroll position, and shows a disabled/loading state during the request.
- Kept cover-selection gallery loading compatible with the same loaded-state behavior.

**Validation**

- `node --check web/modules/ui_gallery.js`
- `node --check web/modules/ui_sidebar.js`
- `node --check web/main.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
## [Snapshot] 2026-08-04 - Parameter Notebook Redesign Planning & Handoff

**Planned**

- Drafted `parameter_notebook_plan.md` to define the architectural shift of embedding Parameter Notebooks directly into the Workflow Recipe detail view.
- Handed off backend implementation of `api/parameters.py` to GPT (associating notebooks with recipes and supporting `recipe_filename` filtering).
- Frontend will subsequently refactor `renderRecipeParameters` in `ui_recipe_detail.js` to serve as the notebook browser for the active recipe.
- Updated `ARCHITECTURE.md` to reflect the upcoming Parameter Notebooks paradigm.

**Validation**

- Planning phase only; no runtime code changes applied yet.

## [Snapshot] 2026-08-04 - Extract parameter management to dedicated Parameter Notebooks and implement Parameter Gallery

**Implemented**

- Decoupled parameter saving and viewing from Workflow Recipes. Saving a recipe automatically saves a read-only Parameter Notebook to `user/default/workflows/anomalous_parameters`.
- Added a new `sha256-params-v1` hash algorithm that strictly matches structural topology and all non-volatile parameters (ignoring seeds, coordinates).
- Implemented a dedicated Parameter Notebooks UI in the sidebar, separating it from the legacy Prompt Notes.
- Integrated a Parameter Gallery that automatically discovers and displays recent output images that precisely match the parameter signature.

**Validation**

- `node --check web/modules/ui_parameters.js`
- `node --check web/modules/ui_recipes.js`
- `python_embeded/python.exe -m py_compile api/parameters.py api/recipes.py api/__init__.py`
- `git diff --check`

## [Snapshot] 2026-08-04 - Add recipe result gallery and portable covers

**Implemented**

- Added an on-demand Workflow Recipe Gallery tab that scans at most the newest 200 output PNGs for matching embedded ComfyUI workflows.
- Replaced the recipe fingerprint with `sha256-structural-v1`, which ignores known run-volatile seed and batch fields while retaining graph structure and generation settings.
- Added explicit gallery refresh, masonry result cards, full-image viewing, and a Set as recipe cover action.
- Recipe covers are compressed WebP assets stored under the recipe-owned `.assets` directory, take precedence in cards/detail, and are included in package export/import even when optional model snapshots are excluded.
- Added bounded metadata/source-image limits and regression coverage for structural matching and cover-package behavior.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/locales.js`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `python_embeded/python.exe -m py_compile api/recipes.py api/metadata.py api/models.py api/recipe_packages.py api/__init__.py`
- `git diff --check`
## [Snapshot] 2026-08-04 - Make recipe gallery matching tolerant

**Implemented**

- Recipe gallery discovery now matches the sorted node class composition and count instead of requiring parameter-level workflow equality.
- Added bounded image parameter inspection and an inline recipe-versus-image difference view; full-image viewing remains available as a separate action.
- PNG metadata can use either embedded UI `workflow` data or API `prompt` data for node discovery.
- Removed the main output gallery's standalone refresh toolbar. Opening the gallery now performs the refresh, keeping the gallery surface focused on images.

**Validation**

- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_sidebar.js`
- `node --check web/modules/ui_gallery.js`
- `node --check web/modules/locales.js`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py`
- `python_embeded/python.exe -m py_compile api/recipes.py api/__init__.py api/recipe_packages.py`
- `git diff --check`
## [Snapshot] 2026-08-04 - Harden Parameter Notebook backend and workspace lifecycle

**Implemented**

- Added missing asynchronous runtime support for the Parameter Gallery endpoint.
- Made parameter signatures understand both UI workflow widget values and API prompt inputs, while retaining volatile-field filtering.
- Added parameter notebook object/workflow validation, bounded payloads, safe atomic writes, strict fingerprint validation, and background directory reads.
- Ensured the Parameter Notebook overlay participates in panel hiding and Workspace close/restore behavior; stale selections and failed deletes now recover visibly.

**Validation**

- `node --check web/main.js`
- `node --check web/modules/ui_parameters.js`
- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/ui_sidebar.js`
- `python_embeded/python.exe -m py_compile api/__init__.py api/parameters.py api/recipes.py api/recipe_packages.py`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed)
- `node tests/recipe_parser_roundtrip.mjs`
## [Snapshot] 2026-08-04 - Finalize Gemini parameter-management audit

**Implemented**

- Reviewed the eight-file Parameter Notebook/Parameter Gallery extraction and preserved the intentional removal of experimental recipe records.
- Confirmed the new backend route wiring, parameter signature flow, recipe auto-provisioning path, and panel lifecycle integration.
- Recorded the follow-up hardening snapshot as `ce3f4dba`.

**Validation**

- 15 recipe/backend regression tests passed.
- Related frontend modules passed `node --check`.
- Parameter and recipe API modules passed Python compilation.

## [Snapshot] 2026-08-04 - Restore plugin trigger visibility

**Implemented**

- Mounted the floating plugin trigger independently before browser panel initialization, with a retry path and an explicit error state when panel construction fails.
- Replaced the legacy trigger label with a stable puzzle icon and accessible label.
- Guarded the recipe gallery's optional `IntersectionObserver` so embedded webviews without that API can still initialize the plugin and load the first gallery page.
- Synchronized `ARCHITECTURE.md` with the trigger lifecycle and initialization-resilience rule.

**Validation**

- `node --check web/main.js`
- `node --check web/modules/ui_sidebar.js`
- `node --check web/modules/ui_parameters.js`
- `node --check web/modules/locales.js`
- `node tests/recipe_parser_roundtrip.mjs`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed)
- `python_embeded/python.exe -m py_compile api/__init__.py api/parameters.py api/recipes.py api/recipe_packages.py`
- `git diff --check`

## [Snapshot] 2026-08-04 - Isolate optional hash resolver startup

**Implemented**

- Audited the full ComfyUI extension loading path instead of treating the trigger button as the only entry point.
- Made `hash_resolver.js` resolve the active graph constructor from `app.graph` and disable itself safely when the legacy global `LGraph` API is unavailable.
- Prevented duplicate serializer patching and guarded the optional `loadGraphData` hook.
- Raised the floating entry point above ComfyUI overlays and forced its visibility; synchronized the architecture rules for optional resolver startup.

**Validation**

- ComfyUI custom-node initialization with `--quick-test-for-ci --disable-all-custom-nodes --whitelist-custom-nodes Anomalous_Model_Browser` completed without an Anomalous import error.
- Full custom-node initialization reported `Anomalous_Model_Browser` loaded and registered its web directory.
- All JavaScript files passed `node --check`.
- `git diff --check`

## [Snapshot] 2026-08-04 - Merge recipe parameters and fix blank panel

**Implemented**

- Fixed the legacy parameter panel mount crash caused by querying `.anomalous-container` while the actual host is `#anomalous-container`.
- Removed the standalone Sidebar Parameter Notebook button and stopped automatically creating duplicate `anomalous_parameters` files when saving a recipe.
- Added a Parameters tab to the individual recipe detail view. It reads exact widget values from the saved workflow, preserves native node/widget labels, separates positive and negative CLIP text, and provides expand/copy controls for long values.
- Added `GET /anomalous/recipe_parameter_gallery`, which computes the server-side `sha256-params-v1` signature from the recipe rather than trusting a browser-supplied path or stale notebook.
- Synchronized `ARCHITECTURE.md`; legacy parameter notebook files/routes remain compatibility-only.

**Validation**

- All 20 JavaScript files passed `node --check`.
- `python_embeded/python.exe -m py_compile api/__init__.py api/parameters.py api/recipes.py api/recipe_packages.py`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- `git diff --check`.

## [Snapshot] 2026-08-05 - Widen common parameter summary layout

**Implemented**

- Replaced the narrow six-column common-parameter grid with a responsive minimum-width grid.
- Kept labels in a horizontal column and values in a flexible column so sampler, scheduler, and seed no longer render one character per line.
- Summary values now wrap in a full-width row instead of being silently truncated; the existing copy action still copies the complete value.
- Synchronized the layout boundary in `ARCHITECTURE.md`.

**Validation**

- All JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- `git diff --check`.

## [Snapshot] 2026-08-05 - Hide volatile values and add editable notes

**Implemented**

- Kept the Seed label but redacted runtime-changing seed values from parameter summaries, detailed display, copy actions, and the new-note editor; the serialized workflow slot remains untouched for ComfyUI compatibility.
- Removed summary ellipsis for common values and made long model, LoRA, and resolution values span a full row with wrapping and copy support.
- Renamed the Parameters tab to “Parameter Notebook / 参数笔记本”.
- Added “New parameter note”: it clones the selected snapshot or recipe skeleton, lets users edit safe node widget values, hides volatile/sensitive controls, and saves a new immutable snapshot without modifying history.
- Synchronized the parameter notebook boundaries in `ARCHITECTURE.md`.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- `git diff --check`.

## [Snapshot] 2026-08-05 - Add current-read and safe parameter apply actions

**Implemented**

- Added “Read current and create” to capture the current canvas as a new parameter-note draft only when every recipe skeleton node is present.
- Added animated active/pressed feedback and explicit selected state to parameter-note switching.
- Added “Apply to current workflow”; it preflights node type/shape and widget slots, ignores volatile values, marks the canvas dirty, and rolls back widget values if application callbacks fail.
- Synchronized the skeleton matching and rollback contract in `ARCHITECTURE.md`.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- `git diff --check`.

## [Snapshot] 2026-08-05 - Make current-canvas capture one-click

**Implemented**

- “Read current and create” now saves the captured parameter note immediately after skeleton validation instead of opening an intermediate editor.
- The editable “New parameter note” flow remains available separately for deliberate parameter changes.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- `git diff --check`.

## [Snapshot] 2026-08-06 - Hide the floating trigger while browser is open

**Implemented**

- Opening the Anomalous Model Browser now hides the floating trigger icon.
- Closing the browser restores the icon, including the existing Workspace/recipe close path that delegates to the browser close lifecycle.
- Initialization failures leave the trigger visible so it remains a recovery entry point.
- Synchronized the trigger lifecycle rule in `ARCHITECTURE.md`.

**Validation**

- All 19 JavaScript files passed `node --check`.
- The unrelated pre-existing `README.md` and untracked `LICENSE` were left untouched.

## [Snapshot] 2026-08-06 - Enable portable model covers by default

**Implemented**

- New recipe saves now enable model-preview snapshot packaging by default.
- Legacy recipes without an explicit snapshot preference receive the same default when edited.
- An explicit `false` preference remains an opt-out, so this change does not silently re-enable a user's deliberate choice.
- Updated `ARCHITECTURE.md` to document why export-ready snapshots are enabled at save time and that export still has its own include/exclude choice.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- Changed-file `git diff --check` passed; unrelated pre-existing `README.md` and untracked `LICENSE` were left untouched.

## [Snapshot] 2026-08-04 - Bind parameter snapshots to recipes

**Implemented**

- Added optional `recipe_filename` persistence and exact filtering to the parameter notebook API.
- Recipe save and update now create one immutable parameter snapshot after the recipe itself succeeds; snapshot failure is reported to the console without duplicating or invalidating the recipe save.
- Reworked the recipe Parameters tab into a two-pane read-only snapshot history with per-snapshot parameter values and parameter gallery matching.
- Removed the unused global parameter UI module after removing its Sidebar entry.
- Deleted completed/superseded plans: `gpt_recipe_advanced_features.md`, `recipe_gallery_plan.md`, and `recipe_improvements_proposal.md`.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe -m py_compile api/__init__.py api/parameters.py api/recipes.py api/recipe_packages.py`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- `git diff --check`.

## [Snapshot] 2026-08-06 - Simplify presentation defaults and clarify notebook switching

**Implemented**

- Removed the per-recipe model-preview snapshot checkbox from the save dialog; the bounded sharing-friendly default is now internal, while legacy explicit `false` values remain compatible until a future Workflow Recipe global setting exists.
- Aligned the backend recipe normalizer with the same default, so non-UI saves and imported recipes without a stored preference also receive portable model previews.
- Added a prominent right-side active-notebook banner with the selected note name, timestamp, and current-state badge.
- Added a short panel transition when switching parameter notebooks so the right pane visibly confirms the change.
- Added request-token guards so a slow parameter-gallery response from the previous notebook cannot replace the newly selected notebook's gallery.
- Updated `ARCHITECTURE.md` and `ai_lessons.md` with the simplified default and right-pane state contract.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- Changed-file `git diff --check` passed; unrelated pre-existing `README.md` and untracked `LICENSE` were left untouched.

## [Snapshot] 2026-08-06 - Apply parameter notes to live widgets

**Implemented**

- Fixed parameter-note application to resolve matched serialized nodes back to the current live ComfyUI nodes before reading or writing widget values.
- Kept skeleton matching based on bounded serialized records, but no longer assumes those records contain runtime `widgets` or callback methods.
- Added precise status feedback for widget mismatches and live-node resolution failures instead of reporting every failure as a generic apply error.
- Updated `ARCHITECTURE.md` and `ai_lessons.md` with the serialized-vs-runtime node boundary.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- Changed-file `git diff --check` passed.

## [Snapshot] 2026-08-06 - Harden parameter apply diagnostics

**Implemented**

- Safe-cloned `undefined` widget slots instead of throwing before the transactional apply phase.
- Guarded widget and node callbacks by function type so optional or non-callable custom-node properties cannot abort a valid parameter update.
- Unknown apply exceptions now include their concrete local error message in the status feedback and tooltip.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- Changed-file `git diff --check` passed.

## [Snapshot] 2026-08-06 - Match ComfyUI widget-change callback signature

**Implemented**

- Fixed the `onWidgetChanged` invocation used during parameter application.
- The current ComfyUI frontend expects the live widget as the fourth argument; omitting it caused its error-clearing hook to evaluate `sourceNodeId in undefined` and abort the transaction.
- Parameter changes now pass `(index, value, previousValue, liveWidget)` while retaining the existing rollback behavior.
- Synchronized the callback contract in `ARCHITECTURE.md` and `ai_lessons.md`.

**Validation**

- All 19 JavaScript files passed `node --check`.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed).
- `node tests/recipe_parser_roundtrip.mjs`.
- Changed-file `git diff --check` passed.

## [2026-08-07] Refactor Node Assistant Presets
- Flattened Node Assistant parameter presets list (removed Recipe Group folders as per user feedback).
- Hid unbound and deleted recipes from the Node Assistant preset list.
- Switched Apply button text to use the Notebook Name instead of node titles.
- Added missing localization keys for Node Assistant to locales.js (ssistantTabActions, ssistantTabPresets, etc.).
- Cleaned up hardcoded English strings in ui_doctor.js.

## [2026-08-07] Refactor Node Assistant Presets (Follow-up)
- Reintroduced single-level folding by Recipe for Node Assistant parameter presets.
- The first group expands by default while subsequent groups are collapsed to keep the UI compact.
- Retained the flat notebook-styled buttons inside each group for a clean hierarchy without excessive nesting.

## [2026-08-07] Core: Robust Prompt Tracing
- Replaced fuzzy name-matching for prompts with a robust topological backward-tracing algorithm.
- Any node with an input slot named positive or negative will now correctly trace upstream to identify the true role of the CLIPTextEncode nodes.
- A permanent role tag is now assigned to these nodes and saved inside recipe.params.nodes metadata.
- Node Assistant parameter presets now read this tag directly to accurately prepend [🟢 正面] or [🔴 负面] on the buttons, ensuring absolute stability for custom workflows.
## [2026-08-07] Recipe/Node Assistant Integration Stabilization

**Implemented**

- Fixed the assistant refresh path that referenced an out-of-scope `forceRefresh`, which prevented parameter presets from rendering after refresh or node changes.
- Removed calls to the deleted `diagnoseNodeForDoctor` method from canvas selection hooks; existing ComfyUI selection callbacks remain chained safely.
- Made node-preset application transactional and observable: volatile seed slots are ignored, callback failures roll back and report failure, successful changes dirty the host graph/canvas, and `graphChanged` is emitted.
- Kept the current ComfyUI widget hook contract by passing the live widget as the fourth `onWidgetChanged` argument.
- Hardened prompt tracing for `Map` links, mixed numeric/string node IDs, and duplicate semantic inputs where the first matching input is unlinked.
- Synchronized legacy and topological prompt fallback so multiple positive and negative CLIP prompts are retained.
- Synchronized the legacy model-picker write path back into `widgets_values`, host change callbacks, and graph dirty state.
- Invalidated the node-assistant notebook cache after parameter-note save/delete operations.

**Validation**

- All JavaScript modules passed `node --check`.
- `node tests/recipe_parser_roundtrip.mjs` passed, including linked-input and `Map`-link coverage.
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` passed (15 tests).
- `python_embeded/python.exe -m py_compile api/parameters.py api/recipes.py` passed.
- `git diff --check` passed.

**Handoff**

- Two pre-existing untracked investigation files (`test.mjs`, `test2.mjs`) were not staged or modified.

## [2026-08-07] Fix Legacy Positive/Negative Role Recovery

- Fixed Node Assistant labels for recipes saved before per-node prompt roles existed.
- The backend now matches a complete CLIP text widget value against the saved recipe/parameter `promptPositive` and `promptNegative` arrays when no explicit role is available.
- Explicit metadata roles remain authoritative; prompts appearing in both lists remain intentionally unresolved instead of being guessed.
- Added regression coverage for negative-role recovery and ambiguous prompt values.

Validation: all JS syntax checks passed, the parser test passed, and the Python suite passed (17 tests).

## [2026-08-08] Conservative Prompt Roles and Manual Labels

- Limited automatic prompt-role analysis to native `CLIPTextEncode` and an explicit set of official sampler, Guider, and conditioning pass-through nodes.
- Removed title/descriptor guessing and the Node Assistant's default-positive fallback; unresolved and third-party text candidates now remain visibly unknown.
- Added per-node role controls in Recipe Parameters: automatic, positive, negative, shared positive/negative, and ignored.
- Persisted manual labels in `params.promptRoleOverrides`, guarded them with node type, retained valid labels across recipe refreshes, and shared them with the Node Assistant API.
- Fixed the Node Assistant recipe lookup to read the actual `params` field instead of the obsolete `metadata` field.
- Added `both` handling for one native text node connected to both official roles and changed role tracing to inspect all matching linked inputs.

Validation: affected JavaScript modules passed `node --check`; the local parser regression passed; Python compilation passed; the local Python suite passed 19 tests; `git diff --check` passed.

Handoff: automatic compatibility with arbitrary third-party text/conditioning nodes is intentionally not claimed. The registry/conflict-evidence stages remain in `.agents/plans/prompt_role_recognition_hardening_plan.md`. Pre-existing untracked `test.mjs` and `test2.mjs` remain untouched.

## [2026-08-08] Parameter Notebook Deletion

- Added a compact delete control beside every stored parameter note in the Recipe Parameters sidebar.
- Added explicit confirmation, busy feedback, localized failure reporting, and immediate notebook-list refresh.
- Deleting the selected note now clears its selection and invalidates stale parameter-gallery requests before choosing the newest remaining note.
- Reused the existing contained `/anomalous/delete_parameter` endpoint; the current recipe baseline remains non-deletable.
- Reviewed the repository licensing without changing legal text: `LICENSE` is the standard MIT grant with a 2026 copyright line, while README branding restrictions remain a separate boundary that should be clarified before release.

Validation: affected JavaScript modules passed `node --check`; the parser and Python regression suites still passed; `git diff --check` passed.

Handoff: pre-existing untracked `test.mjs` and `test2.mjs` remain untouched.

## [2026-08-08] Clarify MIT and Brand Boundaries

- Kept `LICENSE` as the standard OSI-approved MIT text without project-specific additions.
- Added bilingual `TRADEMARKS.md` separating copyright permission from source-identifying project marks.
- Explicitly kept repository code, documentation, stylesheets, and ordinary UI resources under MIT unless a file states otherwise.
- Limited the brand policy to the project name, its official stylized presentation, and graphics expressly designated as official logos.
- Permitted truthful references, links, compatibility statements, unmodified redistribution, screenshots, and clear “based on” attribution.
- Replaced README's ambiguous “official UI assets are proprietary” language with a concise MIT/brand distinction and a link to the full policy.

Validation: compared the local license text with the Open Source Initiative MIT text; reviewed repository assets for existing logo files; `git diff --check` passed.

Handoff: this is a policy clarification rather than legal advice. No public release changelog entry was added. Pre-existing untracked `test.mjs` and `test2.mjs` remain untouched.

## [2026-08-08] Refresh Beta Feature Documentation and Help

- Compared the published GitHub README with the local feature set; the cloud copy covered model actions but did not document Workflow Recipes, Parameter Notebooks, recipe-powered Node Assistant presets, or current data-safety boundaries.
- Rewrote the README's English and Chinese overview/guide sections for Node Assistant, Workflow Recipes, model matching, parameters, output comparison, version history, and package sharing.
- Added prominent bilingual beta warnings that name the recipe/parameter data folders to back up and clarify that preview snapshots never contain model files.
- Updated Settings Help in both languages with the same current workflows and safety guidance.
- Added localized, compact beta notices to the Workflow Recipe list and Node Assistant without hardcoding their copy in UI modules.
- Marked live beta-notice elements with locale keys and rebuilt the active Node Assistant state so an in-place Chinese/English switch refreshes both warnings and selected-node/placeholder content instead of leaving stale text.
- Removed four obsolete English-suffixed keys from the Chinese dictionary, removed duplicate `recipeDetailWidget` declarations, and added missing shared `loading`/`refresh` keys.

Validation: all JavaScript modules passed `node --check`; Chinese and English dictionaries each contain 636 unique keys with no parity differences; every statically referenced `t('key')` resolves in both dictionaries; parser and Python regression suites passed; `git diff --check` passed. A live ComfyUI browser check confirmed the Recipe warning, Node Assistant warning, expanded Settings Help, and in-place English warning refresh.

Handoff: public `CHANGELOG.md` was not changed. Pre-existing untracked `test.mjs` and `test2.mjs` remain untouched.
