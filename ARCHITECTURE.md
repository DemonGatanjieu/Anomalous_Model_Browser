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
│   ├── api_models.py            # Model listing & Metadata reading
│   ├── api_search.py            # Global search & find_model
│   ├── api_images.py            # Gallery and history parsing
│   ├── api_doctor.py            # Model Doctor hash resolution
│   ├── api_civitai.py           # Civitai scraping routes
│   └── scraper.py               # Async HTTP client logic
├── CHANGELOG.md                 # Version history
├── error_and_experience_summary.md # VERY IMPORTANT: Read this first to avoid past mistakes!
├── web/
│   ├── main.js                  # Frontend Vanilla JS Application (The entire UI logic - 5500 lines)
│   ├── hash_resolver.js         # Frontend auto-fix engine: scans workflows for missing models
│   ├── styles.css               # Vanilla CSS with scoped classes (.anomalous-*)
│   └── modules/
│       └── locales.js           # Dedicated multi-language dictionary (i18n)
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

## 4. Frontend Architecture (Vanilla JS)
Located in `web/main.js` (approx. 5000+ lines, currently undergoing ES Module Refactoring). Wraps its logic inside `app.registerExtension({ name: "Anomalous.ModelBrowser", ... })`.

### The Modular Extraction Strategy (模块化拆分架构)
We are actively transitioning from a monolithic `main.js` to a modular ES architecture. 
Instead of fragmenting the class scope and losing context, we extract large UI panels into `web/modules/` and bind them back to the `AnomalousBrowser.prototype`.
1. **Modules**: E.g., `web/modules/ui_doctor.js` contains the Doctor Panel logic.
2. **Shared State**: Everything continues to live on the `AnomalousBrowser` class instance (`this.xxx`). No complex context passing required.
3. **TOC (Table of Contents)**: The top of `main.js` contains a TOC.

### UI Components (Dynamically Created):
* **Sidebar (`anomalous-sidebar`)**: Renders the nested folder structure.
* **Grid (`anomalous-grid`)**: The main model display area. Emptied (`innerHTML = ''`) and repopulated on every folder click.
* **Detail Panel (`anomalous-detail-panel`)**: Slides out when a specific model is clicked.
* **Gallery Viewer (`anomalous-gallery-viewer`)**: A fullscreen modal for viewing images.
* **Notebook (`anomalous-notebook-modal`)**: A specialized editor for composing prompts and drag-dropping Lora/Model nodes.
* **Doctor Panel (`ui_doctor.js`)**: Diagnoses model health for individual nodes or the entire workflow. Includes "View Profile" functionality.

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

## 5. Hash Resolver Subsystem & Scanning Engine (`hash_resolver.js` & `scraper.py`)
A highly complex subsystem responsible for automatically resolving missing/broken model references in workflows, and aggressively scanning models to build local caches.

### The Global Hash Cache (`window.anomalous_hash_cache`)
* This is the absolute core of the resolution engine. It maps physical filenames to their exact SHA256 hashes.
* It is **ALWAYS fetched on startup** via `fetch('/anomalous/all_hashes')`. Without this dictionary, hash injection and resolution are mathematically impossible.
* Whenever a scan finishes (Scan Wizard or Deep Hash Scan), `window.anomalous_reload_hashes()` MUST be called to synchronize the frontend dictionary with the newly generated `.info` files on the disk.

### Model Provenance Binding (模型溯源绑定 - `anomalous_inject_hash`)
* Controls whether hashes are invisibly injected into the `extra_pnginfo` and workflow JSON when a user saves a workflow or generates an image.
* **Logic Flow**: `LGraph.prototype.serialize` is hooked. If enabled, it intercepts the serialization, looks up every model widget's filename in `window.anomalous_hash_cache`, and explicitly writes `extraObj.anomalous_hashes[node_id_filename] = {hash, size}`.

### The Triple-Fallback Scanning Engine (`api/scanner.py` & `scraper.py`)
When "Deep Hash Scan" is triggered, it runs in a background thread to prevent UI lockup. It uses a triple fallback to identify models:
1. **Fallback 1 (Header Hash Match)**: Extracts `modelspec.hash.sha256` or Blake3/AutoV2 directly from the `.safetensors` header (O(1) speed). Hits Civitai API to fetch official metadata.
2. **Fallback 2 (Full File SHA256)**: If the header has no hash, it brutally calculates the full file SHA256 (Slow) and hits Civitai.
3. **Fallback 3 (Offline Inference)**: If Civitai returns 404, it reads the Tensor Fingerprints (keys like `cond_stage_model`) from the header to guess the Base Model (SDXL, SD 1.5, Flux, SD3) and builds a local `.info` file.
* **CRITICAL INJECTION**: After a fallback succeeds, the engine **FORCE INJECTS** the matched hash into the resulting JSON dictionary at `["files"][0]["hashes"]["SHA256"]`. This guarantees that `get_metadata` will always find a matching hash for resolution.

### Resolution Execution (`window.anomalous_resolve_all_missing_nodes`)
Scans all nodes in `app.graph._nodes` that are colored red.
* Extracts the saved hash from the graph's `anomalous_hashes`.
* Sends it to `/anomalous/resolve_hash`, which does a fast O(1) file size match first, then falls back to reading `.info` hashes.
* If a match is found, it silently mutates the dropdown `value`, removes the red color, and flags it as `anomalous_auto_resolved`.

## 6. Known Gotchas & Critical Context (新接手必读)
* **Metadata Override Danger**: If you write to a `.civitai.info` file, ALWAYS read it first and update the dictionary. Never just dump `{custom_name: 'foo'}`.
* **Search Context Trap**: If the user searches using the sidebar while a detail panel is open, you MUST explicitly hide the detail panel and show the grid.
* **Media Leakage**: Destroying a DOM element that contains a playing `<video>` or `<audio>` does **not** stop the audio. You must `.pause()` it before doing `innerHTML = ''`.
* **Variable Naming Collisions**: When moving UI elements, search for ALL references to the old `const` declaration. A single duplicate `const` in the same scope kills the entire module at parse time.

> For a complete list of past mistakes and detailed post-mortems, refer to `error_and_experience_summary.md` in the root directory.
