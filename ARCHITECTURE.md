# Anomalous Model Browser Architecture

This is the short entry point for maintainers and AI agents. It describes the
system map, ownership boundaries, and rules that apply across subsystems. Read
only the linked topic document relevant to the task; do not load every document
by default.

## Reading map

Before implementation, follow [AGENTS.md](AGENTS.md), the canonical development
and maintenance rules. [GEMINI.md](GEMINI.md) is the Gemini reading entry point.

The prompt studio reads material prompt payloads through `web/modules/material_prompt_data.js`;
list summaries do not contain prompt bodies. See the Material Library contract below.

| When changing... | Read... |
| --- | --- |
| Python routes, storage, paths, metadata, covers, or scan state | [`docs/architecture/backend.md`](docs/architecture/backend.md) |
| Browser lifecycle, UI state, localization, media, or graph edits | [`docs/architecture/frontend.md`](docs/architecture/frontend.md) |
| Update-guide content/versioning or sidebar hover labels | [`docs/architecture/update-guide.md`](docs/architecture/update-guide.md) |
| Workflow Recipes, packages, galleries, Parameter Notebooks, or prompt roles | [`docs/architecture/recipes.md`](docs/architecture/recipes.md) |
| Material Library snapshots, image parameter details, or reusable node blocks | [`docs/architecture/material-library.md`](docs/architecture/material-library.md) |
| Model Doctor, provenance hashes, missing-model recovery, or deep scanning | [`docs/architecture/model-resolution.md`](docs/architecture/model-resolution.md) |
| Browser audits, E2E functional bug reports, or verification sign-offs | [`docs/audits/README.md`](docs/audits/README.md) |
| Why a current product boundary exists | [`docs/decisions/README.md`](docs/decisions/README.md) |
| Recurring implementation mistakes and post-mortems | [`.agents/logs/ai_lessons.md`](.agents/logs/ai_lessons.md) |

`README.md` is user-facing documentation and `CHANGELOG.md` is user-facing
release history. Neither is the source of truth for internal architecture.

## System shape

Anomalous Model Browser is a UI-only ComfyUI extension. It registers no custom
nodes (`NODE_CLASS_MAPPINGS` is empty). ComfyUI loads the Vanilla JavaScript/CSS
frontend from `web/`; the Python package registers `/anomalous/` `aiohttp`
routes and performs local filesystem, metadata, recipe, and scan operations.

```text
ComfyUI frontend
  web/main.js
    -> web/modules/*                 UI, graph integration, localization
    -> /anomalous/*                 JSON and bounded media requests

ComfyUI Python server
  __init__.py
    -> api/__init__.py               route registration
    -> api/*.py                      storage and domain operations
    -> scraper.py                    explicit metadata/hash enrichment

User-owned data
  ComfyUI model folders              models and sidecars
  user/.../anomalous_recipes         workflow recipes and recipe assets
  user/.../anomalous_parameters      immutable parameter snapshots
  user/.../anomalous_materials       curated image/workflow material bundles
  user/.../anomalous_notebooks       prompt notes, with legacy originals preserved
```

The frontend and backend communicate through narrow JSON contracts. The
frontend must not infer filesystem authority, and the backend must not depend on
DOM or live LiteGraph state.

## Ownership map

### Backend

- `api/config.py` owns configured paths and active model-folder types.
- `api/path_utils.py` owns containment, filename validation, and atomic JSON writes;
  `api/utils.py` is a compatibility export surface.
- `api/metadata.py` owns sidecar and safetensors metadata extraction.
- `api/model_catalog.py`, `api/model_resolution.py`, `api/model_metadata.py`, and
  `api/model_media.py` own model listing, identity recovery, mutation, and covers;
  `api/models.py` is a compatibility facade.
- `api/scanner.py` and `scraper.py` own scan orchestration and enrichment.
- `api/workflow_schema.py`, `api/recipe_schema.py`, `api/recipe_images.py`, and
  `api/recipe_store.py` own recipe validation/shaping, images, CRUD, history, and
  integrity receipts; `api/recipes.py` is the HTTP facade.
- `api/recipe_packages.py` owns bounded inspect-stage-commit package handling.
- `api/parameters.py` owns Parameter Notebook persistence and lookup.
- `api/notebooks.py` owns Prompt Note persistence and recoverable legacy copying.
- `api/material_schema.py`, `api/material_assets.py`, and `api/material_store.py`
  own curated material shaping, private assets, persistence/cache, search and
  lifecycle; `api/materials.py` owns HTTP mapping and compatibility entry points.
- `api/media_routes.py`, `api/gallery_routes.py`, `api/translation_routes.py`, and
  `api/folder_types.py` own the formerly mixed utility route families.
- `model_policies.py` owns shared backend rename and protected-category policy.
- `model_identity.py` owns file SHA-256 evidence shared with the standalone scanner.
- `api/image_search.py` powers the output gallery search (`gallery_images?q=`):
  it reads only the PNG text chunks before the pixel data (ComfyUI prompt and
  workflow, A1111 `parameters`), caches one record per image by mtime, and
  matches all query terms; hex terms of 8+ characters also match recorded model
  SHA256 values and, via `collect_model_hash_index` in `model_resolution.py`,
  local model files with that hash. Terms arrive as repeated `term` params, one
  phrase each. `ui_search_chips.js` is the reusable search-block input (Enter or a
  comma commits a block); `ui_gallery.js` places it above the gallery.
- `api/version_manager.py` owns the plugin's own version: the installed tag/branch
  (`/anomalous/version`, local only), published releases fetched only on request
  (GitHub releases API, falling back to `git ls-remote` tags; drafts skipped,
  pre-releases never counted as latest), switching to a published tag (detached
  checkout), returning to the default branch (fast-forward only), and undoing the
  last switch (recorded in the ignored `.anomalous_version.local.json`). Every
  switch refuses to run over modified tracked files. `ui_version_manager.js` is
  the version line (shown in the update guide opened by the header "!" button) and panel; nothing goes online until "check for updates"
  is clicked, and restarts go through ComfyUI Manager's reboot route when present.

- `web/main.js` coordinates extension registration (with `?v=...` versioned module imports busting aggressive browser ES Module caching and unconditional legacy storage key purging). `browser.js` owns the shared
  browser class and extracted-method wiring; `browser_entry.js` owns the single
  browser instance plus floating/topbar/menu entry behavior (with Dual-Binding PointerEvents drag capture, `lostpointercapture` fail-safe listeners, zero-drift viewport boundary clamping, flicker-free pre-mount coordinate binding and `anomalous-trigger-initializing` smooth opacity fade reveal, default safe placement in the top-left canvas area at `top: 80px; left: 80px;` gracefully avoiding the left sidebar dock, and versioned `anomalous_trigger_pos_v3` atomic JSON coordinate persistence); `entry_controls.js`
  owns entry mode, trigger sizing/styling normalization, mathematical viewport-safe boundary
  clamping (`clampFloatingTriggerPosition` with minimum safe boundary `minX=70` preventing left sidebar dock entrapment), clean `loadSavedTriggerPosition`/`saveTriggerPosition` storage drivers, and non-distorting coordinate validation
  (`isValidSavedTriggerPosition`); `api/__init__.py` injects an aiohttp no-cache middleware (`Cache-Control: no-cache, no-store, must-revalidate`) for extension static files to eliminate browser memory/disk cache desynchronization across regular page refreshes; and `interface_settings.js` owns language and theme preferences.
- `ui_sidebar.js` creates the browser shell and folder navigation.
  `ui_settings_hub.js` owns settings and model-card preferences;
  `ui_toolbox.js` owns the tool catalog, fixed shortcut bar, and tool dispatch;
  `ui_browser_navigation.js` owns shared panel hiding/cleanup and workspace return.
  Scan-wizard launch, single-model precision scans (`triggerDirectModelScan` with strictly factual Civitai vs non-Civitai feedback reporting inferred base-model or match status directly within the bottom-right progress panel and toasts without blocking browser alerts), modal lifecycle ergonomics (backdrop click and Escape key dismissal with listener detachment, scrollable content area with sticky footer actions), post-scan frontend hash and native combo refreshes (`app.refreshComboInNodes()`, `window.anomalous_reload_hashes()`), and polling live in `ui_scan_wizard.js`; folder visibility/order lives in
  `ui_folder_manager.js`; and help content lives in `ui_help.js`.
- `ui_model_sources.js` owns the Model Sources Hub, managing workflow-model and global-library source detection, Civitai/HuggingFace URL attribution, sidecar persistence, and resilient scope switching between active workflow and full local library (with cached library state preservation and reliable re-rendering).
- `ui_materials.js`, `ui_material_cards.js`, and `ui_material_application.js` own the Material Library UI, category navigation, card presentation (with grab cursor affordances, explicit drag tooltips, and polymorphic card dragging via `bindPolymorphicMaterialCardDrag`), context-aware drag guidance, relaxed third-party node prompt widget sniffing and injection, and the structured empty state onboarding blueprint guiding users through collection, canvas drag, and prompt studio mixing. Drag precedence prioritizes node hits over blank canvas drops; blank canvas drops auto-instantiate `CLIPTextEncode` nodes for prompt materials with standard colors or open full workflows.
- `ui_update_guide.js` and `update_guide_data.js` own the non-intrusive update guide modal (accessible via header button `#anomalous-update-notice-btn` and Help modal; version ID `2026-09-recipes-and-studios`), presenting a 4-step milestone walkthrough (Workflow Recipe Studio, Material Library & Prompt Studio, Model Sources Hub, and Precision Direct Scan with canvas addition) with full bilingual localization. `ui_spotlight_tour.js` provides the interactive spotlight mask tour (`startSpotlightTour`), gliding smooth focal box highlights across topbar workspaces and bottom dock actions with directional tooltip cards and keyboard navigation.
- `sidebar_actions.js` owns the sidebar bottom action hover-reveal short labels (100ms), singleton dynamic DOM tooltip bubbles (`#anomalous-sidebar-tooltip-bubble`, 600ms), click/pointerdown instant text/tooltip suppression guards, `isBottomModalOpen` tooltip occlusion guards, and anti-flicker pointer stability.
- `tool_registry.js` centralizes metadata, SVG icons (enlarged 20px crisp vector outlines with 2px stroke, #cbd5e1 contrast), and stable IDs for the 9 catalog tools (including Prompt Notes / 提示词笔记) and 2 fixed anchors (Toolbox and Settings).
- `shortcut_layout.js` provides tool layout utilities and fallbacks. The bottom shortcut bar maintains the clean fixed 4-tool setup (`scan`, `doctor`, `assistant`, `materials`) plus two anchors (`toolbox`, `settings`) housed in prominent 36px buttons with full click/active text suppression and `.is-active` toggled styling.
- `ui_toolbox.js`'s Toolbox modal strictly filters out all tools already present on the bottom bar, presenting a sleek 216px 3-row utility catalog with compact, frameless 44px tiles (providing an elevated silhouette with breathing room for catalog discovery), downward anchor caret pointing to the toolbox trigger button, 0.18s smooth spring pop-in animation, clean click action execution, and zero obstructive text or beta footers.
- `ui_grid.js` and model-detail modules own model presentation: `ui_grid.js` manages chunked card rendering,
  card placeholder ergonomics (eliminating misleading unclickable text in favor of pure centered icon and status),
  card action buttons (one-click canvas addition with plus icon, model metadata editor, direct precision scanner without wizard modal popups)
  with absolute positioning cascades immune to tooltip target conflicts, vibrant hover affordance,
  safe docked sidebar preservation upon node addition, and multi-type node dispatch; `ui_detail.js`
  coordinates detail display, `ui_model_editor.js` owns metadata editing, and
  `ui_model_selector.js` owns advanced selection. `ui_gallery.js` and
  `ui_gallery_detail.js` own generated-image browsing and workbench lifecycle,
  with stage interaction in `ui_image_stage.js` and metadata tabs in
  `ui_image_inspector.js`.
- `ui_recipes.js` / `ui_recipe_detail.js`, `ui_notebooks.js`, and `ui_materials.js`
  own their respective workspace surfaces and persistence flows. `ui_recipes.js` owns
  the Workflow Recipe studio catalog workspace with search/filter tags, grid/list layout toggle,
  dedicated top-right modal close anchor (permanently decoupled from the tool button row to prevent wrapping displacement),
  streamlined action header (preserving active workflow saving while pruning unfinished package
  import entrypoints), and card browsing. `ui_notebooks.js` owns Prompt Note catalog,
  sidebar dual-group management (note list + floor quick jump anchor navigation with scrollspy active tracking and tooltip hints),
  and persistence; `ui_notebook_editor.js` owns unfolded card editing (modularized into single-responsibility
  sub-functions adhering to the 50-line rule: sticky top action toolbar with floating More popover dropdown and timed two-step delete safety guard,
  unfolded companion models card with unconstrained multi-column tile flow eliminating nested gallery scrollbars,
  prompt composer with dynamic field-sizing and compact inline find & replace toolbar, flat material library archiving card with
  clean single-icon feedback, and unified dark slim scrollbar ergonomics with complete bilingual dictionary coverage in `locales.js`), and
  `notebook_canvas.js` owns LiteGraph creation. Prompt Notes are integrated as a standard tool in the Toolbox
  with defensive workspace return state restoration, TDZ-safe summary initialization, and responsive empty-state fallback rendering. `ui_recipe_detail.js`
  coordinates the Workflow Recipe detail session and model composition. `ui_recipe_overview.js`
  owns the Overview prompt showcase (with `entry.text` fallback, guarded non-shrinking primary action CTA, and floating Popover More dropdown menu), and `ui_recipe_parameters.js`
  owns the responsive Parameter Presets workspace (featuring default-expanded raw node parameter inspection,
  a `clamp(230px, 24vw, 290px)` sidebar with guarded card actions, uncluttered console action bars with deferred status feedback,
  `minmax(130px, 1fr)` Bento Grid with universal click-to-copy, LoRA cards with flexbox truncation guards,
  and sticky editor headers).
  `ui_materials.js` owns Material Library discovery and pagination,
  `ui_material_cards.js` owns catalog cards, `ui_material_detail.js` owns the
  full detail surface, and `ui_material_application.js` owns selected-node
  tracking and explicit material application.
  Within recipe detail, `ui_recipe_versions.js` owns history comparison/restore,
  `ui_recipe_gallery.js` owns result cards and direct Image Detail Workbench handoff,
  `ui_recipe_model_matching.js` owns preview resolution and explicit local replacement,
  `ui_recipe_metadata.js` owns inline persistence, and `ui_recipe_detail_dom.js` owns
  the DOM/copy helpers shared by detail subviews. `ui_recipe_catalog.js` owns recipe
  filters, navigation, dismissible topbar drag guidance strip with localStorage persistence, the 3-step empty-state onboarding blueprint (`renderRecipeEmptyGuide`), and background catalog-wide model readiness resolution (`resolveCatalogRecipeReadiness`), `ui_recipe_cards.js` owns cards and card actions
  (including `grab` drag affordance, cover `可拖拽` badge, harmonized multi-state model readiness pill with `getRecipeReadiness` synchronizing available, missing, and pending matches with detail overview, and direct canvas drag-and-drop), `ui_recipe_dialogs.js` owns save/edit dialogs, and `ui_recipe_media.js` owns shared cover helpers. Detail sessions synchronize detected model availability back to `owner.recipeRecords` via `syncRecipeReferencesToCatalog`.
- `ui_prompt_composer.js` owns the standalone Prompt Studio drawer. Its child
  views are `ui_prompt_source_deck.js`, `ui_prompt_workbench.js`, and
  `ui_prompt_inspector.js`. Assembly plan data, track-vs-role separation, and
  cross-role tail smart-sorting are owned by `prompt_composition.js` and `prompt_studio_data.js`.
  `ui_prompt_source_deck.js` owns the card preview popover with narrow bridging corridors,
  differentiated hide timers, and fast dismissal when hovering or clicking library blank space.
- `ui_prompt_translator.js` owns the standalone Prompt Translator, featuring robust multilingual/Chinese node prompt extraction (`extractPromptFromNode`), real-time canvas selection synchronization (`app.canvas.onNodeSelected`), automatic prompt injection on open/docked mode, on-demand read/sync controls, guarded selection writeback across single and multi-tab workflows, compact streamlined button ergonomics preventing multi-row wrapping, elastic vertical flex textareas maximizing canvas-side vertical space, and an expanded 460px default sidebar width with automatic backward-compatible width migration. Both translator and
  studio use `ui_lifecycle.js` for global listeners, request cancellation and
  resize cleanup. Translation requests go through `translation_service.js`.
- `ui_dom.js` provides small DOM/JSON helpers; `material_inspector.js` owns
  material-specific metadata and parameter rendering.
- `ui_doctor.js` owns diagnostics and global scans; `ui_node_assistant.js` owns
  selected-node assistant history, `ui_node_model_picker.js` owns native combo
  replacement, and `ui_node_presets.js` owns parameter preset rendering and
  application. `model_picker.js`, `node_material_actions.js`, and `graph_splice.js`
  own the remaining explicit graph changes.
- `ui_model_sources.js` owns the Model Source Hub (模型来源统一中控中心), providing dual-scope
  (Workflow and Library) source inspection, external platform jumping, canvas `Note` node generation,
  `workflow.extra.anomalous_model_sources` metadata synchronization, automated asynchronous model
  metadata resolution (`resolveWorkflowModelsMetadata`) via `/anomalous/resolve_paths_to_previews` with
  local sidecar priority detection, and protected read-only link display with deliberate edit-mode
  unlocking and dirty-state dynamic local persistence (hiding redundant `[Save Local]` buttons until links are modified).
- `locales.js` is the shared runtime string catalog. Existing inline bilingual
  UI strings remain migration debt; new strings belong in the catalog.
- `styles.css` is the ordered import manifest for `web/styles/*.css`, which own
  presentation and theme overrides. Color values, dimensions
  and visual design descriptions are not duplicated as architectural contracts.

## Cross-system invariants

These rules are intentionally summarized here and specified in the linked topic
documents.

1. **Identity is provenance, not naming.** Model Doctor may use a cryptographic
   hash, exact byte size under the allowed category policy, and target category.
   Paths, filenames, display names, previews, and fuzzy similarity are never
   identity evidence.
2. **Filesystem input is untrusted.** Backend request paths must pass the shared
   containment and filename helpers. Checking only for `..` is insufficient on
   Windows and in the presence of alternate separators, UNC paths, or symlinks.
3. **User files are changed transactionally and conservatively.** Recipe writes,
   imports, graph mutations, and sidecar operations validate before mutation and
   either complete coherently or restore the prior state.
4. **The event loop stays responsive.** Recursive walks, hashing, metadata
   parsing, and other potentially large disk operations run off the aiohttp
   event loop. UI rendering and media loading are bounded and cancellable.
5. **Host state is preserved.** Browser panels are mutually exclusive,
   Workspace/model-detail transitions are recoverable, and graph edits use
   ComfyUI's change/callback contracts.
6. **Runtime strings are localized safely.** User-visible copy comes from
   `locales.js`; dynamic values stay outside dictionaries and enter the DOM as
   text. Only allowlisted rich content goes through `safe_dom.js`.
7. **Optional integrations fail locally.** Missing graph APIs, metadata, network
   availability, or an optional resolver may disable that capability but must
   not make the main extension disappear.
8. **Presentation data is not authority.** Covers, thumbnails, summaries,
   cached names, and workflow fingerprints never replace the authoritative
   serialized workflow or model provenance record.

## Data and compatibility boundaries

- Runtime settings and newly saved API keys live in `api/config.json`.
  `scraper.py` may read the legacy root `config.json` only as a compatibility
  fallback. API keys are not stored in browser `localStorage`.
- Recipes, Parameter Notebooks, and Material Library records/assets are user data outside the extension directory.
  They are never bundled with or silently migrated into the plugin source.
- The extension may integrate with Civitai and optional translation services
  only through explicit product behavior. External content and dependencies keep
  their own terms.
- Project code and documentation use the MIT license. `TRADEMARKS.md` separately
  defines the project-name and official-branding boundary.
- Internal property names and established routes may remain stable when a
  user-facing surface is renamed. Do not churn compatibility contracts merely
  to match presentation wording.

## Change and snapshot protocol

Every product-code change should end as one coherent local Git snapshot:

1. Run checks proportional to the changed behavior.
2. Update architecture documentation **only** when the change modifies a module
   owner, data flow, public/internal interface contract, persistence format,
   security boundary, or critical invariant.
3. When architecture changes, update the narrowest relevant topic document.
   Update this entry point only if the system map, cross-system invariants, or
   reading map changed.
4. Do not add an architecture entry merely to say that existing boundaries were
   unchanged. Ordinary fixes belong in code, tests, Git history, and—when useful
   to users—`CHANGELOG.md`.
5. Record a durable lesson in `.agents/logs/ai_lessons.md` only for a recurring
   trap or a critical failure mode, not as a turn-by-turn work log.
6. Create a local commit after verification. Keep unrelated work out of the
   snapshot and do not push without explicit user authorization.
7. Leave a clean worktree, or identify every intentional uncommitted file in the
   handoff.

Decision records explain enduring choices; they are not a chronological diary.
Git history is the authoritative record of implementation changes. Planning-only
documents must be clearly labeled as proposals and must not describe unshipped
behavior as current architecture.
