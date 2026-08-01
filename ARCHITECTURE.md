# Anomalous Model Browser - Architecture Summary (架构指南)

This document provides a high-level overview of the Anomalous Model Browser plugin for ComfyUI. It is designed to quickly onboard new AI agents or developers to the project's structure, design philosophy, and critical subsystems.

## 1. Project Philosophy (设计理念)
* **Zero Frameworks**: No React, Vue, or build tools. Everything is Vanilla JS and CSS for maximum compatibility, minimum overhead, and zero compilation steps.
* **Non-Intrusive Integration**: Operates as a floating Gemini-style popover (`#anomalous-container`) mounted via ComfyUI's standard UI extension system. It avoids altering the native ComfyUI canvas except when explicit interaction is required.
* **Strict DOM Obliteration**: Rather than caching complex DOM structures (like `display: none` for large grids), the UI strictly employs `innerHTML = ''` when navigating between folders. This enforces immediate Garbage Collection, crucial for performance when users have thousands of models.
* **Offline-First Resilience**: Model metadata is parsed from local `.info` and `.civitai.info` files or extracted directly from `.safetensors` headers via Python `struct`. API calls to Civitai are explicit, user-initiated actions.

## 2. Directory Structure (核心文件结构)

```text
Anomalous_Model_Browser/
├── __init__.py                  # ComfyUI Extension Entry Point. Registers nodes and sets WEB_DIRECTORY = "./web"
├── api/                         # Backend Python API (Modularized)
│   ├── __init__.py              # Appends all modular routes to server
│   ├── config.py                # Configuration and paths setup
│   ├── metadata.py              # Model metadata extraction and parsing
│   ├── models.py                # Core model listing and routing (API endpoints)
│   ├── notebooks.py             # Notebooks management logic
│   ├── scanner.py               # Scanning engine for hash resolution and caching
│   └── utils.py                 # Shared backend utilities and safe path boundary helpers
├── scraper.py                   # Async HTTP client logic & web scraping (Root Level)
├── CHANGELOG.md                 # Version history
├── error_and_experience_summary.md # VERY IMPORTANT: Read this first to avoid past mistakes!
├── web/
│   ├── main.js                  # Frontend Vanilla JS Entry (Under 1000 lines, mounts modules to prototype)
│   ├── hash_resolver.js         # Frontend auto-fix engine: scans workflows for missing models
│   ├── styles.css               # Vanilla CSS with scoped classes (.anomalous-*)
│   └── modules/                 # Extracted UI logic modules
│       ├── ui_sidebar.js        # Sidebar and folder tree logic
│       ├── ui_detail.js         # Model detail panel
│       ├── ui_doctor.js         # Model Doctor and Assistant panel
│       ├── ui_notebooks.js      # Notebooks editor
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
* **Notebook (`ui_notebooks.js`)**: A specialized editor for composing prompts and drag-dropping Lora/Model nodes.
* **Doctor Panel (`ui_doctor.js`)**: Diagnoses model health for individual nodes or the entire workflow. Includes "View Profile" functionality.

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
* Automatic identity evidence is limited to plugin-carried cryptographic hashes, exact physical byte size as a controlled fallback/disambiguator, and the model category required by the target widget. Byte size alone is acceptable only when it produces exactly one candidate inside the required category and no contradictory trustworthy hash exists.
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
* Sends hash, byte size, and the inferred model category to `/anomalous/resolve_hash`. The endpoint accepts a result only when the identity signals agree, or when a unique in-category size safely recovers a stale legacy hash.
* If a match is found, the frontend refreshes native ComfyUI combo definitions and requires the returned path to exist in that widget's native choices. Cross-category or otherwise invalid paths are rejected; the resolver must never append a foreign path to `widget.options.values` merely to report success.
* After native validation succeeds, it mutates the dropdown `value`, removes the red color, and flags it as `anomalous_auto_resolved`.

## 6. Known Gotchas & Critical Context (新接手必读)
* **Metadata Override Danger**: If you write to a `.civitai.info` file, ALWAYS read it first and update the dictionary. Never just dump `{custom_name: 'foo'}`.
* **Search Context Trap**: If the user searches using the sidebar while a detail panel is open, you MUST explicitly hide the detail panel and show the grid.
* **Media Leakage**: Destroying a DOM element that contains a playing `<video>` or `<audio>` does **not** stop the audio. You must `.pause()` it before doing `innerHTML = ''`.
* **Video Cover Compatibility & Interaction**: Any frontend component displaying model preview covers MUST check if the file is `.mp4`/`.webm`. The model-card setting owns the grid behavior: `always` may autoplay only while the card is near/in the viewport; `hover` loads/plays on pointer hover and pauses on leave. Both modes use muted/loop/playsinline and release their source when the browser closes. Single main covers may keep their established autoplay behavior. **CRITICAL GOTCHA**: Do NOT use `new URL(url).pathname` to check extensions! Our backend serves images via query parameters (e.g. `?filename=cover.mp4`), so `pathname` strips the filename. Always test the full URL using regex like `/\.(mp4|webm)(?:$|\?|&|#)/i`.
* **Variable Naming Collisions**: When moving UI elements, search for ALL references to the old `const` declaration. A single duplicate `const` in the same scope kills the entire module at parse time.
* **Data Scaling & Payload Limits**: When passing arrays/lists (e.g. hundreds of selected files), NEVER append them to URL query parameters (`GET` requests), or you will trigger `414 URI Too Long`. Use `POST` with a `JSON Body`. Similarly, NEVER pass massive arrays directly to `subprocess.run` via CLI arguments, as it will crash silently due to OS character limits (8191 on Windows). Always dump massive data to an intermediate `.json` file for the subprocess to read.

> For a complete list of past mistakes and detailed post-mortems, refer to `error_and_experience_summary.md` and `.agents/logs/ai_lessons.md` in the root directory.
