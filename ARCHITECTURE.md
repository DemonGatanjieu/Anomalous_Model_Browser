# Anomalous Model Browser - Architecture Summary (架构指南)

This document provides a high-level overview of the Anomalous Model Browser plugin for ComfyUI. It is designed to quickly onboard new AI agents or developers to the project's structure, design philosophy, and critical subsystems.

Workspace lifecycle note: reopening an already initialized Workspace must restore the visible notebook body and reset the hidden recipe body before refreshing data. Hiding the overlay alone is not enough because the next open reuses the existing DOM tree.

Origin refresh is an explicit enrichment mode passed into `_enrich_recipe`; it must not mutate the Python list of references with ad-hoc state. Origin refresh writes schema v5, while normal updates preserve previously imported identity/origin records when the current machine cannot re-resolve them.

Recipe identity badges use short, bounded labels in the card layout; detailed explanations belong in the help tooltip. Identity badges and model-name rows must remain shrinkable flex children so localized or imported text cannot expand the recipe card beyond its container.

Availability refresh actions expose immediate busy feedback, an accessible `aria-busy` state, and a recoverable error state; a disabled button without visible progress is not considered sufficient interaction feedback.

Identity help uses a click-to-expand inline explanation attached to the badge. The explanation stays in normal card flow with bounded width and wrapping, so it cannot be duplicated by a native `title` tooltip or cover adjacent flex content.

Recipe origin editing has two supported update paths: complete recipe updates for metadata/workflow edits, and a refresh-only request containing `filename` plus `refreshIdentities`. The latter must clone the stored recipe before enrichment so the refresh action cannot be rejected by complete-recipe validation or accidentally discard the saved workflow.

Origin edit dialogs locate a saved model reference by stable provenance fields (`node_id`, `widget_index`, category, and saved value), not by display-only fields such as `type`. Localized action labels must use keys that exist in the shared locale catalog; a missing key must never make a visible dialog action appear inert.

Recipe import matching is a separate, explicit local-recovery action. The recipe detail entry point sends all unresolved references to the hash-resolution batch endpoint, constrained by the reference's model category; the saved author path and filename are never identity evidence. A found local candidate is presentation-only until the user clicks `Apply match`, which updates the corresponding workflow widget through the full-recipe update contract and archives the prior recipe. Exact saved-path availability checks remain a separate lightweight preview operation.

## Current recipe interaction correction (2026-08-03)

The recipe detail view keeps Overview, Parameters, and Versions tabs. The Overview contains the model composition blocks; each resolved model name or preview is an explicit entry into the browser model detail view. Model previews are demand-loaded when Overview opens, and returning from model detail restores the recipe detail view. The model browser stores the active grid folder and scroll coordinates before opening detail and restores them when returning to the grid. List-card Append actions await the shared canvas transaction before reporting success or restoring the button state. Export confirmation uses three states (cancel, exclude, include); cancellation must stop the export flow rather than silently becoming an exclusion.

The Workspace close action is a state restoration boundary. Opening the Workspace records which main-browser panel was visible; closing it hides recipe/notebook content and restores that panel, falling back to the model grid when the previous state is unavailable. All Workspace close affordances use the same cleanup function.

## Recipe result gallery (2026-08-04)

Recipe detail has an on-demand Gallery tab for reusing the user's own generated results. Gallery discovery uses a separate `sha256-node-types-v1` signature: it compares the sorted node class composition and count, deliberately ignoring seeds, prompts, model values, and other parameters so ordinary variations still appear. The original `sha256-structural-v1` fingerprint remains the recipe/history integrity fingerprint. Opening a detail view scans at most the newest 200 PNG files below ComfyUI's output directory and reads only bounded embedded `workflow` or API `prompt` metadata; there is no background polling or persistent output index. Clicking a result loads bounded node parameters and shows recipe-versus-image differences; the match itself remains node-only. The main output Gallery refreshes on each open and has no persistent toolbar refresh strip. A chosen result becomes a recipe-owned, compressed WebP cover in `.assets/<recipe-stem>/`, so it survives output cleanup and follows the recipe during package export/import. The original output image remains a local convenience link, never package data or identity evidence.

## Parameter Notebook & Gallery (2026-08-04)

Parameter management has been explicitly extracted from Workflow Recipes into dedicated Parameter Notebooks. A recipe represents a structural template, whereas a parameter notebook represents an immutable snapshot of a recipe's generation values. Saving a recipe automatically provisions a corresponding Parameter Notebook in `user/default/workflows/anomalous_parameters`. Parameter notebooks are read-only in the viewer and may be deleted explicitly. They use a distinct `sha256-params-v1` signature over node types and serialized widget/API-input values, ignoring known run-volatile fields and UI coordinates; it intentionally does not claim graph-link identity. The Parameter Notebook UI is a dedicated modal accessed from the Sidebar, remaining visually separated from the legacy Prompt Notes.

## 1. Project Philosophy (设计理念)
* **Zero Frameworks**: No React, Vue, or build tools. Everything is Vanilla JS and CSS for maximum compatibility, minimum overhead, and zero compilation steps.
* **Non-Intrusive Integration**: Operates as a floating Gemini-style popover (`#anomalous-container`) mounted via ComfyUI's standard UI extension system. It avoids altering the native ComfyUI canvas except when explicit interaction is required.
* **Strict DOM Obliteration**: Rather than caching complex DOM structures (like `display: none` for large grids), the UI strictly employs `innerHTML = ''` when navigating between folders. This enforces immediate Garbage Collection, crucial for performance when users have thousands of models.
* **Offline-First Resilience**: Model metadata is parsed from local `.info` and `.civitai.info` files or extracted directly from `.safetensors` headers via Python `struct`. API calls to Civitai are explicit, user-initiated actions.

## 2. Directory Structure (核心文件结构)

```text
Anomalous_Model_Browser/
├── .agents/                     # Local, ignored AI handoff material
│   ├── logs/
│   │   ├── ai_changelog.md      # Engineering snapshots, decisions, checks, and handoff notes
│   │   └── ai_lessons.md        # Curated experience summary and recurring pitfalls
│   └── plans/                   # Product/design proposals that are not runtime behavior
├── __init__.py                  # ComfyUI Extension Entry Point. Registers nodes and sets WEB_DIRECTORY = "./web"
├── api/                         # Backend Python API (Modularized)
│   ├── __init__.py              # Appends all modular routes to server
│   ├── config.py                # Configuration and paths setup
│   ├── metadata.py              # Model metadata extraction and parsing
│   ├── models.py                # Core model listing and routing (API endpoints)
│   ├── notebooks.py             # Notebooks management logic (Prompt Notes)
│   ├── parameters.py            # Parameter Notebook CRUD and Gallery logic
│   ├── recipes.py               # Local Workflow Recipe CRUD and validation
│   ├── recipe_packages.py       # Bounded ZIP inspection, export, staging, and import commit
│   ├── scanner.py               # Scanning engine for hash resolution and caching
│   └── utils.py                 # Shared backend utilities and safe path boundary helpers
├── scraper.py                   # Async HTTP client logic & web scraping (Root Level)
├── CHANGELOG.md                 # Version history
├── web/
│   ├── main.js                  # Frontend Vanilla JS Entry (Under 1000 lines, mounts modules to prototype)
│   ├── hash_resolver.js         # Frontend auto-fix engine: scans workflows for missing models
│   ├── styles.css               # Vanilla CSS with scoped classes (.anomalous-*)
│   └── modules/                 # Extracted UI logic modules
│       ├── ui_sidebar.js        # Sidebar and folder tree logic
│       ├── ui_detail.js         # Model detail panel
│       ├── ui_doctor.js         # Model Doctor and Assistant panel
│       ├── ui_notebooks.js      # Prompt Notes editor
│       ├── ui_parameters.js     # Parameter Notebook gallery and read-only parameter viewer
│       ├── ui_recipes.js        # Workflow Recipe cards, search/filter, save dialog, and actions
│       ├── recipe_parser.js     # Read-only LiteGraph recipe metadata extraction
│       ├── recipe_identity.js   # Pure recipe model-reference and identity normalization
│       ├── recipe_diff.js       # Pure bounded semantic version comparison
│       ├── recipe_actions.js    # Transactional canvas-append actions
│       ├── ui_recipe_detail.js  # Demand-loaded recipe detail panel and tab rendering
│       ├── ui_gallery.js        # Fullscreen Gallery Viewer
│       ├── ui_grid.js           # Main grid and model loading
│       ├── graph_splice.js      # Transactional MODEL/CLIP chain insertion and rollback
│       ├── locales.js           # Dedicated multi-language dictionary (i18n)
│       └── safe_dom.js          # HTML escaping and allowlisted rich-text sanitization
├── tests/                       # Backend security and path-boundary regression tests
├── docs/                        # Supplemental documentation
```

## 3. Backend Architecture (Python API)
Modularized into the `api/` package. Registered with ComfyUI's internal `aiohttp` server.
All endpoints are prefixed with `/anomalous/`.

### Python Rules of Engagement:
1. **Never block the event loop**: File I/O should ideally be offloaded or fast. Large files are handled via `struct` (reading only the first 64KB for metadata), avoiding full reads.
2. **Handle missing dependencies gracefully**: Avoid 3rd-party pip requirements if possible.
3. **Always Restart ComfyUI**: Any changes to the `api/` package **REQUIRE** a full ComfyUI server restart to take effect.
4. **Never use hardcoded backslash strings**: When writing path manipulation code, use `os.sep` or `os.path.normpath()` instead of `replace('\\', '/')`. Editing tools may corrupt escaped backslashes silently.
5. **Dynamic Folder Resolution (Config-Driven)**: Never hardcode folder types (like `checkpoints`, `loras`). Always use `api.utils.get_active_folder_types()` to enforce whitelist logic. Folders disabled by the user in `config.json` are completely skipped during `os.walk`, ensuring zero I/O overhead for hidden directories.
6. **Strict Path Containment**: Every request path must go through `resolve_folder_subdir()`, `resolve_within()`, and `require_filename()` as appropriate. Checking only for `..` is forbidden: absolute Windows paths, UNC paths, alternate separators, and symlinks can otherwise escape the configured model/output/notebook directory. File-serving endpoints must also enforce an explicit media-extension allowlist.
7. **Canonical Configuration**: Runtime UI settings and newly saved API keys live in `api/config.json`. `scraper.py` reads that file first and falls back to the legacy root `config.json` only for backward compatibility. API keys must never be persisted in browser `localStorage`.
8. **Atomic Background State**: Set scan state or create the exclusive marker file before launching a worker thread/process. Folder scans use `.scan_in_progress`; global quick scans use `.global_scan_in_progress`; deep missing-model scans use `GLOBAL_SCAN_STATE`, exposed by `/anomalous/scan_missing_models_status`.
9. **Private Development Tests**: The local `tests/` directory contains backend and frontend regression tests for maintainers only. It is intentionally ignored by `.gitignore` and must not be included in the installable/plugin Git distribution. Keep these files locally for validation; do not import them from runtime code or move them into the shipped extension bundle.
10. **Workflow Recipes Are User Data**: Recipes live only in `ComfyUI/user/default/workflows/anomalous_recipes`, never in the extension repository. `GET /anomalous/recipes` returns card metadata only; the graph is fetched separately through `GET /anomalous/recipe_full`. Recipe writes are bounded, validate local-only data-image thumbnails and contained output-image references, validate graph node IDs/widget bounds/link endpoints before writing, and use atomic replacement. Successful save, update, and restore responses include a compact integrity receipt (node/link/group counts and the persisted workflow fingerprint). A bound output stores a compressed cover plus a local source reference; it never copies an arbitrary path supplied by the browser. Export packages strip machine-local `source_image` paths, include the union of current and selected-history snapshot assets, and preserve imported model identity records independently from transient local availability. Replacement import stages recipe/assets/history and restores the prior set if the commit fails. `recipe_packages.py` accepts only bounded ZIP packages with `manifest.json`, `recipe.json`, declared contained WebP assets, and optional bounded history. Import is inspect-then-commit, rejects traversal/symlinks/archive bombs/checksum failures, never installs code or dependencies, and stages before atomic rename.

### NON-NEGOTIABLE: Model Sidecar & Cover Lifecycle / 模型伴生文件与封面生命周期死规矩
* `.civitai_bak.*` is a persistent restore source created from a real Civitai download. Setting a custom cover MUST modify only `.preview.*`; it MUST NOT delete, overwrite, or repurpose `.civitai_bak.*`.
* Reset cover priority is fixed: restore `.civitai_bak.*` to `.preview.*`; otherwise remove `.preview.*` only when a bare original cover (`model.png`, etc.) can take over naturally. If the active `.preview.*` is the only image, preserve it and return a visible warning instead of causing irreversible cover loss. Reset does not silently redownload from the network.
* Physical rename means **move/rename** every recognized sidecar, including `.civitai_bak.*`, to the new model stem. It never means deleting the Civitai backup. Model deletion may clean sidecars only after the selected main model was successfully deleted.
* Main model extensions (`.safetensors`, `.ckpt`, `.pt`, `.bin`) are never sidecar suffixes. A cleanup operation MUST NOT delete a same-stem model with another extension. If such a sibling survives, stem-keyed sidecars are ambiguous and must be preserved for it.
* Performance boundary: sidecar operations use centralized immutable suffix tuples and a constant number of exact-path checks. Do not use `os.walk`, directory-wide globbing, full-directory indexing, hashes, or network calls for rename/delete/reset. This keeps the operation independent of model-folder size.
* Preserve the product-language distinction in documentation and UI: **delete cleans sidecars; rename migrates sidecars**. Never describe both operations as deleting or "taking away" the files.

### NON-NEGOTIABLE: Lossless Performance Boundaries / 无损性能优化死规矩
* Metadata and embedded safetensors-header hashes may be cached only with a bounded cache whose key includes the real path and physical file signatures (`size`, `mtime_ns`, and `ctime_ns`) for the model and both metadata sidecars. Callers receive independent copies; cached mutable dictionaries/lists must never be exposed directly.
* Preview URLs use the preview file's stable nanosecond modification time as their cache version. Never append `Date.now()` or another per-request random token during ordinary listing: doing so disables the browser cache and redownloads unchanged media. A changed cover must still produce a changed URL.
* Folder listing must inventory a directory once with `os.scandir()` and preserve the established preview priority (`.preview.*` before bare media). Do not perform one `exists()` sequence per model when the directory inventory already contains the answer.
* Recursive directory walks, metadata parsing, and other potentially large disk operations must run through `asyncio.to_thread()` rather than blocking ComfyUI's aiohttp event loop. This improves responsiveness without skipping files.
* Large grids keep the complete ordered result set but create cards in bounded animation-frame chunks. Images use native lazy loading/async decoding; videos delay their source until near the viewport and retain the configured autoplay/hover behavior once activated. A new folder request must cancel the previous request and stale render generation.
* Card-quality choice is deliberately user-facing but bounded to two understandable modes: `balanced` requests a derived longest-edge-512px WebP for static grid covers, while `original` serves the source cover. Detail pages continue to use the original in both modes. Derived thumbnails live only in ComfyUI's temporary area, are keyed by the source real path plus physical signatures, and are capped at 256 MiB with oldest-accessed eviction. They MUST NOT modify, replace, rename, or sit beside the user's source cover; unsupported/animated images and any generation failure fall back to the original.
* Closing the browser immediately aborts listing work, disconnects observers, pauses all media, and releases grid video/audio sources. Lightweight card DOM may remain warm for 90 seconds for a smooth reopen, after which cards and retained model payloads are released automatically. Folder replacement must stop old media before removing DOM nodes. Non-grid panels retain their established UI state, so their paused media is rebuilt only by the panel's existing lifecycle rather than being left visibly broken on reopen.
* Model Doctor batch resolution is an I/O optimization only. Provenance-rich workflows skip the redundant full filename-to-hash cache refresh; legacy workflows missing injected provenance still refresh it for compatibility. Requests are grouped by the exact required model-type tuple so each group is scanned once, while every item still uses the same cryptographic hash, exact byte-size, category constraint, conflict rejection, and ambiguity rules as `/anomalous/resolve_hash`. Batch failure must fall back to the single-item endpoint; batching must never introduce filename/path evidence.
* Preview resolution should try contained exact relative paths first and walk the library only for unresolved basename fallbacks. Exact-path lookup here locates a preview for a model value already supplied by ComfyUI; it is not Model Doctor identity discovery.

## 4. Frontend Architecture (Vanilla JS)
Located in `web/main.js` (Under 1000 lines, fully refactored into ES Modules). Wraps its logic inside `app.registerExtension({ name: "Anomalous.ModelBrowser", ... })`.

### The Modular Extraction Strategy (模块化拆分架构)
We have successfully transitioned from a monolithic `main.js` to a modular ES architecture. 
Instead of fragmenting the class scope and losing context, we extracted all UI panels into `web/modules/` and bound them back to the `AnomalousBrowser.prototype`.
1. **Modules**: All major UI components (`ui_sidebar.js`, `ui_detail.js`, `ui_doctor.js`, `ui_notebooks.js`, `ui_gallery.js`, `ui_grid.js`) are decoupled ES modules.
2. **Shared State**: Everything continues to live on the `AnomalousBrowser` class instance (`this.xxx`). No complex context passing required.
3. **TOC (Table of Contents)**: The top of `main.js` contains a TOC mapping out the extracted module bindings.

### UI Components (Dynamically Created):
* **Sidebar (`anomalous-sidebar`)**: Renders the nested folder structure.
* **Folder Manager (📁 Manage Folders)**: An interactive modal in `ui_sidebar.js` allowing drag-and-drop reordering and visibility toggling of folders. Drives backend I/O optimization.
* **Grid (`anomalous-grid`)**: The main model display area. Emptied (`innerHTML = ''`) and repopulated on every folder click.
* **Detail Panel (`anomalous-detail-panel`)**: Slides out when a specific model is clicked.
* **Gallery Viewer (`ui_gallery.js`)**: A fullscreen modal for viewing images.
* **Prompt Notes (`ui_notebooks.js`, legacy internal name)**: A specialized editor for composing prompts and drag-dropping LoRA/model nodes. Its shared user-facing surface is **Workspace / 创作工作台**, with **Prompt Notes / 提示词笔记** and **Workflow Recipes / 工作流配方** as its two sections. This presentation rename intentionally leaves notebook routes, storage, and internal property names stable for compatibility.
* **Workflow Recipes (`ui_recipes.js`, `ui_recipe_detail.js`)**: A second section inside the shared Workspace modal, not a separate top-level navigation surface. Recipes save the complete serialized graph and add two summary layers: adapters for common model/LoRA/prompt/sampling semantics, plus bounded generic widget summaries for every node (including third-party nodes). Save captures the serialized graph exactly once before the dialog; that snapshot, not a later live-canvas serialization, is the workflow sent to the API. Schema v3 introduced a canonical SHA-256 workflow fingerprint and explicit model-reference identity records; schema v4 adds optional recipe-owned model-preview snapshot descriptors. Schema v5 separates model identity from C-site Official origin metadata (model_name/model_url, which can be manually edited or auto-fetched via Civitai API by hash directly from the detail view), ensuring UI rendering prioritizes official names over obfuscated physical filenames. The card API stays light; the full graph and history are fetched only after edit, restore, or “View details.” The detail panel owns Overview, Parameters, and Versions tabs. Parameters are sorted topologically (using Kahn's algorithm on graph links) to match workflow execution order, and their display names dynamically resolve through `LiteGraph.registered_node_types` (and dummy node instantiation for widgets) to automatically support translation plugins. The save dialog may pin any safe JSON-serializable widget, restores only pins still present on a canvas update, bind an output cover, and explicitly retain bounded model-preview snapshots. The edit dialog resolves safe primitive values from the full workflow by node ID/widget index before updating the matching serialized slot; bounded summaries are never the edit source. Structural edits are explicitly loaded onto the canvas and saved back through the same update path. Every update archives the previous full recipe locally (bounded to 20 versions). Missing-node preflight also reads authoritative workflow node types. `recipe_parser.js` never mutates the live canvas.
* **Recipe interaction extensions (`recipe_diff.js`, `recipe_actions.js`)**: Recipe cards filter only lightweight name/notes/tags metadata. Version comparison fetches one validated historical JSON and returns bounded semantic changes without instantiating or mutating either graph. Append clones serialized nodes into the live graph with collision-free IDs, transactional link remapping, placement, selection, and rollback. Card and detail actions use a shared busy/restore discipline so a network or canvas failure cannot leave a button permanently disabled or trigger duplicate mutations. Open/Append UI actions share the same exported handlers from `ui_recipe_detail.js`. All Quick Queue functionality was removed to enforce a single execution path through the canvas.
* **Recipe detail presentation**: Copy actions use visible temporary success/failure feedback. Name, notes, and tags can be edited inline from the loaded detail view and are persisted through the existing full-recipe update contract, preserving the serialized workflow and history behavior. Workflow fingerprints and model SHA-256 values are advanced information shown only inside collapsed disclosure panels; card and detail surfaces use bounded glass-style cards, responsive grids, and restrained hover transitions. The Overview separates base model and each LoRA into one full-width composition block; sampling values remain in a compact key-value grid.
* **Doctor Panel (`ui_doctor.js`)**: Diagnoses model health for individual nodes or the entire workflow. Includes "View Profile" functionality.

### NON-NEGOTIABLE: Recipe Presentation & Model Preview Boundaries / 配方展示与模型预览边界
* Recipe cover, current local model preview, and optional frozen model-preview snapshot are three different concepts. None is model identity evidence.
* The authoritative `workflow` field contains only the serialized ComfyUI graph. Recipe covers, preview descriptors, and future snapshot asset IDs belong to additive recipe presentation data; never inject preview bytes or local preview URLs into the graph.
* Recipe cards perform no per-model preview lookup. Current previews are demand-loaded only after the Models & reproducibility tab opens and must use a bounded exact-reference/category lookup. Detail opening must not recursively walk model folders.
* Do not persist preview URLs as truth: they are current-machine cache locators and may change after rename or cover replacement. Display precedence is future frozen snapshot, then current local preview, then category placeholder.
* Frozen preview snapshots are schema-v4, opt-in runtime behavior. Assets live in a contained recipe-owned `.assets/<recipe-stem>/` directory, are immutable/content-addressed, and are served only through `GET /anomalous/recipe_asset`. Snapshot generation accepts static local preview files only, writes WebP thumbnails no larger than 320 px or 96 KiB each, is capped at 12 images and 1.25 MiB per save/update, and never copies videos or original full-resolution media. Deleting a recipe removes only its contained assets after the recipe file is deleted; retained history may share an asset ID.
* Preview hashes, filenames, paths, images, and visual similarity MUST NEVER create a Verified identity badge or participate in Model Doctor matching. Workflow fingerprints also exclude covers and preview presentation.
* Recipe model cards may display the basename and current local preview by default, with full saved paths and hashes behind Advanced information. Overview and compact recipe summaries must use the basename only; a filesystem path is never a model display name. Exact local references are used only for current-machine preview lookup and temporary navigation into the browser detail panel. Imported or unresolved references remain visually inactive until the user explicitly requests matching through the existing hash/size/category resolver; filename or path alone can never activate a match. A successful match activates only the current detail view and does not rewrite the authoritative workflow path.
* Navigating from a resolved recipe model reference to the model browser detail panel must preserve the main browser modal. The recipe workspace child overlay is hidden after the detail panel is shown; it must not call the browser-wide `close()` lifecycle, because that lifecycle also hides and releases the target detail panel. The navigation stores a lightweight recipe return token (recipe payload, active tab, and scroll position); the model detail Back action consumes that token, hides/cleans the model panel, and restores the recipe detail view rather than falling back to the model grid.
* Local model-preview media may include image, MP4, or WebM files and uses hover playback for video. Recipe save/export never embeds original video media: a bound output video may contribute only a bounded static first-frame thumbnail, while package assets remain contained WebP snapshots.
* Detail readability is not card-summary readability: a compact card may use bounded summaries, but the detail panel may resolve the corresponding safe widget value from the already-loaded contained `workflow` by node ID and widget index. Sensitive/button widgets remain excluded. Long values and positive/negative prompts must use a visible collapse/expand control plus a copy action; never silently truncate a detail value. Overview may show normalized positive/negative prompt summaries, while Parameters preserves native node names and renders each saved `CLIPTextEncode` text widget separately. If the bounded summary omits an old native CLIP node, Parameters must recover it from the authoritative serialized workflow's `widgets_values` without changing the saved graph, then keep native CLIP rows together in the presentation order.

### NON-NEGOTIABLE: Recipe Action Boundaries / 配方动作边界
* `Open in Canvas` replaces the live graph only after an explicit dirty-canvas confirmation and never queues automatically. `Append to Canvas` clones saved nodes, remaps IDs/links, validates the complete insertion, and rolls back all inserted nodes on failure. Detail actions use one busy/settle path so a successful canvas action resolves the detail controller and a failed action restores the button state.
* Append must not call `loadGraphData` on the live graph. It must not mutate the saved recipe, existing nodes, existing links, or external model files. Unsupported/missing node types produce a visible error instead of a destructive fallback.
* Append accepts both LiteGraph tuple links and object-shaped link records, treats groups as first-class inserted items, rejects subgraph definitions until a dedicated ID-remapping path exists, and removes every item created by the action when any insertion step fails.
* `recipe_diff.js` compares bounded semantic records only. It must not expose newly-unfiltered sensitive widget values, render a full graph diff, instantiate saved nodes for display, or mutate either recipe.

### Graph Splicing and Picker Context (`graph_splice.js`, `model_picker.js`)
Manual LoRA insertion is an explicit canvas mutation and is isolated from Model Doctor identity recovery. The graph helper analyzes ports by their declared `MODEL` and `CLIP` types, never by fixed slot indexes or display names. It supports inserting a compatible loader before a node with connected MODEL/CLIP inputs, or after a node with MODEL/CLIP outputs. Downstream fan-out is rejected as ambiguous until the user can choose a concrete branch.

Graph edits are transactional: validate the complete topology before mutation, wrap the operation in `graph.beforeChange()` / `graph.afterChange()`, and restore every original connection if node creation or any link operation fails. A successful insertion must be one undoable graph change and must dirty the canvas. The helper must not move, delete, or rewrite existing nodes or widgets, and model choices supplied by the UI must remain constrained to ComfyUI's native combo values for the inserted node.

The Node Assistant owns the corresponding picker UI. Replacement actions live in the selected-node toolbar, while insert-before/insert-after actions are enabled only when graph analysis reports a safe topology. The picker derives its complete candidate set from the target widget's native combo values, then provides client-side folder browsing, full-path search, and sorting. It must not broaden the list with models from another category or require metadata scanning merely to select a filename.

`model_picker.js` owns pure picker-type inference, base-model family normalization, and bounded upstream MODEL/CLIP traversal used to discover the nearest non-LoRA main model. Picker presentation metadata is resolved in one batch through `/anomalous/resolve_paths_to_previews`. The request supplies the native folder-type boundary inferred from the target widget, and the response may include preview URLs, model category, and cached sidecar metadata for each requested path. Picker cards expose category and `baseModel` badges using text-only DOM assignment. LoRA compatibility filtering uses the connected main model's `baseModel` metadata, falling back to the current LoRA's metadata only when the main model cannot be identified. This is a user-visible browsing filter, not Model Doctor identity evidence; missing metadata must remain accessible through an explicit unfiltered option.

### JavaScript Rules of Engagement:
1. **Strict Localization (双语)**: 
   - Never use hardcoded UI strings. 
   - Always use the ternary operator bounded to the global state: `window.anomalous_browser_lang === 'zh' ? '中文' : 'English'`.
   - Never use variables like `currentLang === 'zh'` for DOM rendering, because they fail when closure scopes diverge from the global state.
2. **Avoid Global Scope Pollution**: Scope all IDs and classes with `anomalous-`.
3. **Z-Index Tiers & Overlap Prevention (层叠规范)**: 
   - Base UI: `10000`
   - Overlay Modals: `10001` to `999999`
   - *Critical Rule*: Never arbitrarily assign z-indexes. A child modal MUST have a strictly higher z-index to prevent the parent from consuming clicks.
4. **DOM ID Conflicts with CSS**: When assigning an `id` to an element dynamically, always `grep_search` `styles.css` first.
5. **Untrusted Text and Rich HTML**: Filenames, folder names, notebook names, workflow values, and metadata are untrusted. Use `textContent` or `escapeHtml()` for normal text. Only Civitai description/notes fields may retain formatting, and they must be inserted with `setSafeRichHtml()` from `safe_dom.js`; direct metadata assignment to `innerHTML` is forbidden.

## 5. Hash Resolver Subsystem & Scanning Engine (`hash_resolver.js` & `scraper.py`)
A highly complex subsystem responsible for automatically resolving missing/broken model references in workflows, and aggressively scanning models to build local caches.

### NON-NEGOTIABLE: Model Doctor Identity Boundary / 模型医生身份判定死规矩
* Model Doctor exists to recover the same physical model referenced by provenance data embedded by this plugin in an exported workflow or image. Local path differences and local renames are the problem being solved; therefore a path, filename, display name, custom name, source filename, or fuzzy name similarity MUST NEVER be used as evidence that two models are identical.
* Automatic identity evidence is limited to plugin-carried cryptographic hashes, exact physical byte size as a controlled fallback/disambiguator, and the model category required by the target widget. Byte size alone is acceptable only when it produces exactly one candidate inside the required category and no target hash contradicts it; a supplied hash mismatch never falls back to a filename or size-only guess.
* Paths and filenames may be used only after model identity has already been established: to return the resolved local dropdown value and to verify that value against ComfyUI's native combo choices. They must not participate in candidate selection, ranking, tie-breaking, or ambiguity resolution.
* Normalizing slash direction for a value that already has an exact equivalent in the widget's native ComfyUI options is representation normalization, not model discovery, and does not weaken this identity boundary.
* If a legacy/corrupt hash cannot be recovered uniquely from allowed evidence (for example several in-category files have the same byte size), Model Doctor MUST report ambiguity or remain unresolved. It must never guess from the old filename/path. Manual replacement is the explicit fallback.
* This boundary is part of the plugin's native product contract. Do not weaken, reinterpret, or bypass it without explicit user authorization.

### The Global Hash Cache (`window.anomalous_hash_cache`)
* This is the absolute core of the resolution engine. It maps physical filenames to their exact SHA256 hashes.
* It is **ALWAYS fetched on startup** via `fetch('/anomalous/all_hashes')`. Without this dictionary, hash injection and resolution are mathematically impossible.
* Whenever a scan finishes (Scan Wizard or Deep Hash Scan), `window.anomalous_reload_hashes()` MUST be called to synchronize the frontend dictionary with the newly generated `.info` files on the disk.
* The cache exposes relative-path and basename aliases only when they are unambiguous. If two local models share a key but have different hash/size values, that alias is omitted instead of silently choosing one. Frontend lookups must prefer the full widget value before falling back to a basename.

### Model Provenance Binding (模型溯源绑定 - `anomalous_inject_hash`)
* Controls whether hashes are invisibly injected into the `extra_pnginfo` and workflow JSON when a user saves a workflow or generates an image.
* **Logic Flow**: `LGraph.prototype.serialize` is hooked. If enabled, it intercepts the serialization, looks up every model widget's filename in `window.anomalous_hash_cache`, and explicitly writes `extraObj.anomalous_hashes[node_id_filename] = {hash, size}`.
* Exact-path checks are limited to pre-flight verification that an already-resolved local reference exists; they are outside Model Doctor provenance recovery and must never be used as its fallback. For provenance recovery, the backend constrains the search to the model category inferred from the node/widget and intersects the saved hash with the saved byte size. If no file in that category owns a legacy/stale hash, only a unique in-category byte-size match may recover the model as `stale_hash`. Equal-sized candidates remain unresolved, and a real hash/size conflict is rejected instead of choosing arbitrarily.
* Civitai `.info` files may describe several physical files (for example a diffusion model, text encoder, and VAE). `get_metadata()` must select the matching `files[]` entry by exact physical byte size and may use an unmatched entry only when it is the sole hash candidate. It must never take the first SHA256 or use a filename to choose between entries.

### The Triple-Fallback Scanning Engine (`api/scanner.py` & `scraper.py`)
When "Deep Hash Scan" is triggered, it runs in a background thread to prevent UI lockup. It uses a triple fallback to identify models:
1. **Fallback 1 (Header Hash Match)**: Extracts `modelspec.hash.sha256` or Blake3/AutoV2 directly from the `.safetensors` header (O(1) speed). Hits Civitai API to fetch official metadata.
2. **Fallback 2 (Full File SHA256)**: If the header has no hash, it brutally calculates the full file SHA256 (Slow) and hits Civitai.
3. **Fallback 3 (Offline Inference)**: If Civitai returns 404, it reads the Tensor Fingerprints (keys like `cond_stage_model`) from the header to guess the Base Model (SDXL, SD 1.5, Flux, SD3) and builds a local `.info` file.
* **Offline hash injection**: After a fallback succeeds, the engine injects the discovered hash into the generated JSON. Consumers must still associate that entry with the current physical file using size/name matching; array position is not an identity guarantee.
* Physical rename conflicts are non-destructive. When the target filename already exists, both files must be hashed; deletion is permitted only when their complete SHA256 values match. Different files with the same generated display name must both be preserved.

### Resolution Execution (`window.anomalous_resolve_all_missing_nodes`)
Scans all nodes in `app.graph._nodes` that are colored red.
* Extracts the saved hash from the graph's `anomalous_hashes`.
* Sends hash, byte size, and the inferred model category to `/anomalous/resolve_hash`. The endpoint accepts a result only when the identity signals agree, or when a unique in-category size resolves a request that has no usable hash; a contradictory supplied hash remains unresolved.
* If a match is found, the frontend refreshes native ComfyUI combo definitions and requires the returned path to exist in that widget's native choices. Cross-category or otherwise invalid paths are rejected; the resolver must never append a foreign path to `widget.options.values` merely to report success.
* After native validation succeeds, it mutates the dropdown `value`, removes the red color, and flags it as `anomalous_auto_resolved`.

## 6. Known Gotchas & Critical Context (新接手必读)
* **Metadata Override Danger**: If you write to a `.civitai.info` file, ALWAYS read it first and update the dictionary. Never just dump `{custom_name: 'foo'}`.
* **Search Context Trap**: If the user searches using the sidebar while a detail panel is open, you MUST explicitly hide the detail panel and show the grid.
* **Media Leakage**: Destroying a DOM element that contains a playing `<video>` or `<audio>` does **not** stop the audio. You must `.pause()` it before doing `innerHTML = ''`.
* **Video Cover Compatibility & Interaction**: Any frontend component displaying model preview covers MUST check if the file is `.mp4`/`.webm`. The model-card setting owns the grid behavior: `always` may autoplay only while the card is near/in the viewport; `hover` loads/plays on pointer hover and pauses on leave. Both modes use muted/loop/playsinline and release their source when the browser closes. Single main covers may keep their established autoplay behavior. **CRITICAL GOTCHA**: Do NOT use `new URL(url).pathname` to check extensions! Our backend serves images via query parameters (e.g. `?filename=cover.mp4`), so `pathname` strips the filename. Always test the full URL using regex like `/\.(mp4|webm)(?:$|\?|&|#)/i`.
* **Variable Naming Collisions**: When moving UI elements, search for ALL references to the old `const` declaration. A single duplicate `const` in the same scope kills the entire module at parse time.
* **Data Scaling & Payload Limits**: When passing arrays/lists (e.g. hundreds of selected files), NEVER append them to URL query parameters (`GET` requests), or you will trigger `414 URI Too Long`. Use `POST` with a `JSON Body`. Similarly, NEVER pass massive arrays directly to `subprocess.run` via CLI arguments, as it will crash silently due to OS character limits (8191 on Windows). Always dump massive data to an intermediate `.json` file for the subprocess to read.

> For a complete list of past mistakes and detailed post-mortems, refer to `.agents/logs/ai_lessons.md`. Engineering snapshots and handoff notes belong in `.agents/logs/ai_changelog.md`.

## 7. Mandatory Change Snapshot Protocol (强制变更快照流程)

Every product-code change in this plugin must finish as one coherent local Git snapshot:

1. Run checks proportional to the touched behavior before committing.
2. Update `.agents/logs/ai_changelog.md` in the same change with the implementation summary, architectural decision, checks run, and handoff notes.
3. Update this `ARCHITECTURE.md` in the same change so directory ownership, data flow, API contracts, naming boundaries, and non-negotiable rules remain accurate. If the code does not alter an architectural boundary, record that the existing boundary is intentionally unchanged rather than inventing a new abstraction.
4. Create a local Git commit after verification. Keep unrelated work out of the snapshot and do not push unless the user explicitly requests it.
5. Leave a clean worktree for the next agent, or document every intentional uncommitted file in the handoff.

`CHANGELOG.md` is public user-facing release communication. Update it only for intentional user-visible release notes; never use it for internal design decisions, implementation details, test output, or agent handoff. Planning-only documentation may be committed separately, but proposals must be labeled clearly and must not be described as implemented runtime behavior.

## 66. Recipe Canvas Actions Use Append as the Safe Composition Path

Recipe cards and detail views intentionally expose only “Append to Canvas”. The removed “Open to canvas” action was ambiguous across ComfyUI versions: the legacy API replaced the current graph, while the current workflow-tab API opens a new temporary tab unless an internal active-workflow object is supplied. Keeping only append avoids both meanings and preserves the user's current canvas.

The separate structural-edit action may still load a recipe into a new canvas for editing; it is not a recipe composition action and remains explicitly confirmed. Successful append actions continue to hide the notebook body, recipe view, recipe modal panel, and outer modal before invoking the existing close/media cleanup.

## 67. Recipe Save Does Not Ask for Presentation Pins

The save dialog records recipe identity, notes, tags, cover/source image, and model-preview snapshot preference. It no longer renders the expandable “Choose key parameters” section: the complete serialized workflow already remains the source of truth, and this extra presentation selection added friction without improving restoration. Existing `params.pinned` data is preserved when editing an older recipe so removing the control is not a destructive metadata migration; new saves use an empty pin list.

## 68. Docked Notebook Controls Must Shrink as a Unit

The notebook create row contains a text input and a confirmation button. In the 660px docked browser, the notebook sidebar is reduced to 80px, so the input must have `min-width: 0` and the confirmation button must remain a non-shrinking fixed-size item. Otherwise the input's placeholder intrinsic width pushes the check button outside the clickable sidebar.

The output gallery is a user-refreshed view of ComfyUI's output directory. Opening the gallery performs one page-one scan, and the toolbar's Refresh button explicitly repeats that scan on demand. There is no background polling; the grid preserves scroll position when manually refreshed.
