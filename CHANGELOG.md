# 📈 Anomalous Model Browser Changelog

## Unreleased

### ✨ Interface & Access
- **Native Configurable Shortcut (原生可配置快捷键)**: Added `Ctrl + Shift + M` as the default shortcut for opening the browser. The plugin's Interface settings show the currently active binding and open ComfyUI's native key recorder for customization. Conflict detection, overwrite confirmation, removal, reserved-key guidance, and modal guards therefore remain centralized without a separate global keyboard listener.

### 🐛 Bug Fixes
- **Live Language Switching (语言即时切换)**: Changing the plugin language now immediately re-translates the open native Interface settings—including labels, tooltips, and combo choices—as well as the browser UI, without refreshing ComfyUI.

## v1.56.1 Beta (Interface Preferences & Scan Reliability) — 2026-08-26

### ✨ Interface & Access
- **Native Interface Preferences (原生界面偏好)**: Added one native ComfyUI entry-mode setting with three strictly exclusive choices: floating button, action-bar button beside the run controls, or Extensions menu only. Floating size/style controls now appear only when floating mode is selected. A colocated language preference follows ComfyUI by default or applies a plugin-only Chinese/English override, and the existing in-browser language shortcut updates that same native setting. Entry selection remains authoritative during action-bar redraws, and every entry reuses the same browser instance and open path.

### 🐛 Reliability & Scan Feedback
- **Interrupted Scan Recovery (异常扫描自动恢复)**: Closing ComfyUI during a folder or global scan no longer leaves the browser permanently locked. Versioned scan ownership records distinguish live workers from stale or legacy markers, clean interrupted state automatically, and allow an immediate retry without reinstalling the extension.
- **Real Scan Progress (真实扫描进度)**: Folder, custom-selection, and global scans now show a non-blocking localized progress panel backed by the scanner's actual folder/model counts and current filename. Reopening the browser reconnects to the running task through the existing status polling contract.

## v1.56 Beta (Model Doctor Intelligence & Smart Civitai Routing)

### 🚀 Major Improvements & Features
- **On-Demand Dynamic Hash Resolution (按需动态算哈希与智能认亲)**: Upgraded Model Doctor's fallback resolution engine. When a local candidate model matches the exact byte size of a missing reference but lacks local metadata (e.g., after renaming and deleting `.info` files), the backend dynamically calculates its SHA256 on demand. Upon cryptographic verification, the node is seamlessly resolved and an offline inferred `.info` record is saved locally.
- **Dedicated Hash Inspection Modal (🔑 查看哈希透视详情)**: Added a dedicated `🔑 查看哈希 (View Hash)` button on every model card in the Doctor Dashboard. Clicking it opens a crystal-clear inspection modal comparing the workflow-embedded provenance hash & size with local disk hash & size, featuring one-click clipboard copying.
- **Smart Civitai by-hash Routing & NSFW Domain Dispatch (C 站精准直达与 .red/.com 智能分流)**: Upgraded the "🌐 Civitai" action buttons across Model Doctor and Workflow Import. Instead of crude search bar queries, it now queries the official Civitai `by-hash` API to resolve exact Model IDs and Version IDs, automatically routing NSFW models to `civitai.red` and safe models to `civitai.com`.
- **UNET Default Scan Coverage (UNET 目录扫描补齐)**: Added `models/unet` to the default scanned model types, ensuring UNET / Diffusion Models are consistently indexed during background deep scans.
- **Parameter Notebook Renaming (参数笔记本重命名)**: Users can now rename saved parameter notebooks directly from both the recipe sidebar list and the detail heading via inline `✏️` action buttons and modal prompts, safely updating names with atomic writes without disrupting parameter provenance or canvas matching.
- **Cross-Platform Path Separator Normalization (跨平台斜杠全链路归一化)**: Fully unified Windows `\` and Unix `/` path handling across workflow serialization, hash retrieval, and node diagnostic matching, preventing lookup misses caused by cross-platform workflow exchange.

### 🐛 Bug Fixes & UX Polish
- Fixed a false-negative rejection issue where size-matching renamed models without local `.info` files were incorrectly rejected as `identity_conflict`.
- Fixed duplicate key icons on the Model Doctor Hash Inspection modal header.
- Fixed a loop duplication issue in the workflow import modal preflight inspection.
- Updated unit test suite with comprehensive coverage for dynamic hash resolution and unet folder discovery.

## v1.55 Beta (Workflow Recipes Preview)

> **Beta scope:** Workflow Recipes, Parameter Notebooks, and the recipe-powered Parameter Presets tab in Node Assistant are preview features. The Node Assistant's Actions tab—visual model replacement and LoRA insertion—is not part of this beta. Save the current canvas and back up `workflows/anomalous_recipes` plus `workflows/anomalous_parameters` before updating, importing, restoring, deleting, or applying recipe data. The stable target for these preview features is v1.6.

### 🚀 Major Features
- **Workflow Recipes (工作流配方)**: Save a complete workflow with a cover, name, tags, notes, model references, prompts, sampler settings, safe node parameters, and a reproducibility fingerprint. Recipes append to the current canvas without replacing it.
- **Recipe Detail Workspace (配方详情)**: Added Overview, Parameter Notebook, Gallery, and Versions tabs. Long values can be expanded or copied, model requirements are shown as separate cards, and the overview avoids exposing local model paths as display names.
- **Parameter Notebooks (参数笔记本)**: Create edited parameter notes, capture a fresh note from a matching live canvas, switch between saved notes with clear feedback, delete individual notes, and apply one note back to a workflow only after the complete recipe skeleton matches. Volatile values such as seeds are intentionally ignored.
- **Node Assistant Recipe Presets (节点助手配方预设)**: The Parameter Presets tab reads same-type node values saved by Workflow Recipes. Select a node such as KSampler and apply sampler, scheduler, steps, CFG, denoise, and other safe values in one click without replacing the rest of the workflow.
- **Model Identity and Local Matching (模型身份与本地匹配)**: Recipe model cards retain hashes, size, model category, available Civitai origin names/links, and previews. Imported recipes can match another author's model references to local files without trusting their folder paths.
- **Recipe Gallery and Parameter Comparison (配方图库与参数对比)**: Find historical outputs with the same node structure, inspect embedded generation data, compare differing parameters, and promote an output image to the recipe cover.
- **Version History (版本历史)**: Recipe updates retain bounded local history. Compare meaningful changes, restore an older version safely, and preserve the current version before restoration.
- **Portable Recipe Packages (便携配方包)**: Import or export recipes with optional preview snapshots and history. Model identity hashes can be removed for privacy. Preview snapshots contain presentation images only and never include model files.
- **Conservative Prompt Roles (保守的正负提示词识别)**: Native supported prompt paths are classified without title guessing. Unknown third-party text nodes remain unclassified until the user labels them as positive, negative, shared, or ignored.

### ✨ Interface and Interaction
- Renamed the combined Notes and Recipes area to **Creative Workspace / 创作工作台**, with separate Prompt Notes and Workflow Recipes sections.
- Recipe models, LoRAs, prompt text, common parameters, and generic node controls use dedicated responsive layouts with copy and full-content expansion where needed.
- Returning from a model detail page restores the previous recipe position instead of jumping back to the top.
- The main output gallery refreshes when opened, avoiding continuous background polling.
- Beta and data-protection guidance is available in the Recipe list, the Node Assistant Parameter Presets tab, Settings Help, and README in both Chinese and English.

### 🐛 Reliability Fixes
- Fixed a cross-panel state leak where opening a model from a Recipe Overview could overlap Node Assistant, then leave the next Workflow Recipe visit with an empty list. Returning normally, switching directly to another main panel, reopening Workspace, and closing Workspace mid-return now all restore one coherent surface.
- Fixed blank Workspace/Parameter Notebook surfaces and restored the plugin trigger when frontend module errors prevented registration.
- Fixed parameter application against current ComfyUI widget callbacks and added transactional rollback when a node update fails.
- Fixed positive/negative prompt duplication and legacy role recovery while keeping ambiguous third-party prompt nodes visibly unknown.
- Fixed panel closing and canvas handoff behavior, docked notebook confirmation controls, recipe scroll restoration, long model status text, and narrow parameter layouts.
- Added backend validation and regression coverage for recipe round-tripping, linked inputs, parameter-note deletion, model matching, and prompt-role metadata.

## v1.5.1 (The Workflow Exchange & Deep Scan Update)
### 🚀 Major Features
- **Lossless Workflow Exchange (无损工作流交互)**: Added dedicated Import/Export buttons to the bottom-left of the plugin UI. This feature allows users to directly extract, share, and import pure workflow data without relying on original PNG images, completely bypassing the metadata-stripping compression used by social platforms (like WeChat or Discord) that causes workflow loss.
- **Force Overwrite Configs (强制覆盖已有配置)**: Added a new "Force Overwrite" toggle in the Scan Wizard. When enabled, the scanner will deliberately ignore existing local `.info` files and force a fresh SHA256 hash calculation and a complete metadata pull from Civitai. This is a lifesaver for repairing incorrectly matched or corrupted model profiles.
- **Model Card Settings (模型卡片设置)**: The Settings Hub now opens one focused panel for video-cover playback (`Always play` or recommended `Play on hover`) and card image quality (`Optimized thumbnail` or `Original cover`). Existing autoplay preferences remain compatible, while image-quality choice is intentionally simple and local to the browser.

### 🐛 Bug Fixes
- **Base Model Hash Misattribution**: Fixed a critical bug in the fast scanner where it would aggressively fuzzy-match any 64-character hex string in the metadata. This previously caused LoRAs (trained via Kohya) to inherit their Base Model's hash (`ss_sd_model_hash`), resulting in totally incorrect Civitai mappings. The scanner now strictly adheres to the official `modelspec.hash.sha256/blake3` standard.
- **Lossless Cover Reset**: Reset now restores the persistent `.civitai_bak.*` copy first, falls back to a bare original cover for non-Civitai models, and preserves the active preview with a visible warning when no recoverable source exists.
- **Safe Sidecar Lifecycle**: Deleting a model cleans recognized sidecars, while renaming migrates them—including the Civitai backup—to the new stem. Same-stem model files with different model extensions are never treated as sidecar garbage.
- **Bounded Sidecar I/O**: Repeated extension literals in the API and scanner were replaced with fixed tuples and exact-path checks. Rename, delete, and reset remain constant-bounded and never scan an entire model directory.
- **Reset/Rename Extension Integrity**: Fixed a reused loop variable that could change a model's extension when cover reset and physical rename were requested together.
- **Signature-Aware Metadata Cache**: Unchanged model metadata and embedded safetensors hashes are now served from bounded caches keyed by physical file signatures. Sidecar or model changes invalidate entries automatically, while defensive copies prevent cache pollution.
- **Stable Cover Caching**: Removed per-refresh random cover URLs and switched to nanosecond file-version tokens, allowing the browser to reuse unchanged images and videos while still updating changed covers immediately.
- **Responsive Large Libraries**: Folder/model disk work now runs outside the aiohttp event loop, current-folder discovery uses one `os.scandir()` inventory, stale requests are aborted, and cards render in animation-frame chunks with lazy media activation.
- **Batched Model Doctor Resolution**: Provenance-rich workflows skip a redundant full hash-cache walk, then resolve missing nodes through a type-grouped batch endpoint so each required category is walked once per repair pass. Legacy workflows still refresh the filename cache when needed. The original hash/size/type/ambiguity rules remain unchanged, with automatic fallback to the single-item endpoint.
- **Direct Preview Fast Path**: Visual replacement resolves contained relative model paths directly and performs a full library walk only for unresolved basename fallbacks.
- **Balanced Cover Memory Use**: Static grid covers default to cached 512px WebP derivatives while detail views retain the original. Derived files are stored in ComfyUI's temporary area, capped at 256 MiB, and never alter source covers. Closing the browser releases active media immediately and releases the warm card DOM after 90 seconds of inactivity.

## v1.5.0 (The Workflow & UI Evolution Update)
### 🚀 Major Features
- **Node Assistant (节点助手)**: Introduced a dedicated "Assistant" tab within the Model Doctor. Selecting any node in the canvas instantly focuses the Assistant on that specific node, providing deep analysis and contextual controls without obscuring your view.
- **Visual Model Switcher (可视化模型选择)**: Eliminated blind dropdown menus! When replacing a model, a stunning visual grid pops up inside the Assistant panel, displaying full cover images and model names. You can now select replacements purely visually.
- **Global Health Dashboard (全图体检报表)**: A top-level dashboard in the Doctor panel provides a bird's-eye view of your entire workflow. It categorizes nodes into "Healthy", "Missing", "Replaced", and "Unrelated", giving you instant situational awareness.
- **Inline Node Notes (内联节点备注)**: Added the ability to view and edit model notes directly beneath the preview image in the Node Assistant, ensuring zero layout shifting and maintaining a continuous UX flow.
- **Local Metadata Parsing Toggle (非C站模型本地解析)**: Added a new explicit toggle in the Settings Hub. This allows users to enable deep local/offline metadata scanning (e.g. for HuggingFace models) without strictly enforcing a Civitai lookup.

### 🐛 Bug Fixes & UX Polish
- **Regex Replacement Bug**: Fixed a critical bug where regex backslashes were swallowed during update patching, causing a syntax error in `main.js` that made the plugin icon disappear.
- **Dynamic Regex Splitting**: Ensured file paths are split properly using both forward slashes and backslashes `/[\/]/` for complete cross-platform Windows/Linux compatibility.
- **Temporary Feature Suspension**: Temporarily commented out the WIP "Preflight Import Workflow" button while its parsing engine is being finalized.

## v1.4.4 (The Cover Decoupling Update)
### 🚀 Enhancements
- **Custom Cover Decoupling**: Manually selected covers (from the gallery or local uploads) now exclusively use a `.preview.*` suffix. The backend no longer artificially renames standard non-Civitai `.png` files to `.civitai_bak`, preventing semantic entanglement.
- **Intuitive Reset Logic**: Clicking 'Reset' now cleanly deletes the custom `.preview.*` file. For non-Civitai models, it organically falls back to your original manual cover. For Civitai models, it accurately restores the `.civitai_bak` file obtained from the initial scan.
- **UX Workflow Polish**: After changing a cover via the gallery or local upload, the UI no longer stubbornly bounces you back to the Model Edit modal. It gracefully returns you straight to the model grid to admire the new cover, eliminating the confusing implication that you still needed to click 'Save'.
- **Cache Busting for Covers**: Added a timestamp parameter when loading covers into the grid so that uploading a new custom cover instantly updates the display without requiring a manual browser refresh.

### 🐛 Bug Fixes
- **Video Cover Regex Fix**: Fixed a bug where `.mp4` and `.webm` video covers failed to play if cache-busting URL parameters were appended. The regex now gracefully handles trailing `&` or `?` parameters.
- **State Null-Reference Crash**: Fixed an `undefined` error where a missing `this.models` assignment during the model reload phase caused the UI to abort mid-transition, resulting in a blank screen.


## v1.4.3 (The Silent Load Update)
### 🚀 Enhancements
- **Silent Loading by Default**: Reversed the default behavior of the hash resolver. To prevent interrupting workflows for users with massive unindexed local libraries, the aggressive "Missing Models Alert" popups and heavy background hash fetching on startup are now **OFF by default**. You can enable the auto-detect feature manually via the Settings Hub.
- **Refined Settings UI**: Updated the terminology in the Settings Hub. The toggle has been re-worded from "Auto-Detect Missing: ON/OFF" to "🪄 Auto-Detect Missing on Load: [ON]" and "🔕 Auto-Detect Missing on Load: [OFF]" to eliminate any semantic confusion regarding the plugin's status.


## v1.4.2 (Language Sync & Gallery Patch)
### 🚀 Enhancements
- **ComfyUI Manager Ready**: The plugin is officially available in the ComfyUI Manager default node list!

### 🐛 Bug Fixes
- **Native Language Sync**: Fixed a bug where the plugin would not properly synchronize its UI language with ComfyUI's modern native `Comfy.Locale` settings. The language check has been migrated from local storage caching to a dynamic `app.ui.settings` API call during the extension setup phase.
- **Gallery Zoom Review**: Verified and confirmed that the mouse wheel zoom feature inside the gallery image viewer is functioning natively as intended.
## v1.4.1 (The Drag & Drop Resilience Update)
### 🚀 Enhancements
- **Silent Quick Scan Button**: Added a new dedicated `🔍 Check & Auto-Scan Missing Info` button to the Settings Hub. It silently finds unscanned models and extracts their hashes in the background without popping up the intrusive Civitai black-box prompt, keeping your workflow uninterrupted.
- **Hires Fix Drag Resilience**: Fixed a critical Chromium memory allocation crash where dragging extremely large (Hires. fix) images from the Gallery would silently fail to initiate. Implemented a lightweight, translucent SVG "Workflow" ghost using `setDragImage`, allowing massive 4K+ images to be dragged seamlessly onto the ComfyUI canvas without memory limits.
- **Operation Guide**: Added a highly requested `docs/核心按钮操作指南_大白话版.md` (Layman's Core Operation Guide) to clearly distinguish between the different scanning and fixing buttons for new users.

### 🐛 Bug Fixes
- **Orange Toast Eradication**: Completely ripped out the overly aggressive `app.queuePrompt` interceptor. Users will no longer be bombarded by the orange "Unscanned Models" warning toast every time they click Generate.
- **CSS Compatibility**: Added the standard `line-clamp` property alongside `-webkit-line-clamp` in the stylesheet for better cross-browser compatibility when truncating model names.

## v1.4.0 (The UI & Architecture Overhaul)
### 💎 Gemini-Style Popovers & UX
- **Lightweight Side Popovers**: Completely dismantled the heavy, center-screen settings modal with blurred backgrounds. Rebuilt the Settings Hub as a lightweight, non-intrusive side-popover that snaps to the sidebar—heavily inspired by Gemini's web UI.
- **Global Click-Outside**: Implemented a zero-leak Vanilla JS global `mousedown` listener. Clicking anywhere outside an active popover instantly and smoothly dismisses it, vastly improving workflow immersion.
- **Full-Width Action Dock**: Replaced the cramped bottom capsule with a 100% width solid Action Dock. This provides a stable visual foundation and properly balances the action buttons (Scan, Fix) against the Settings cog.
- **Gallery Letterboxing**: Switched the Image Gallery's thumbnail rendering from `object-fit: cover` to `object-fit: contain` with a deep `#000` background. Tall 9:16 vertical character portraits are now 100% visible, perfectly framed by natural letterboxing instead of being decapitated.

### ⚙️ Deep Architecture & Bounds Fixing
- **Banned CSS `zoom`**: Eradicated the CSS `zoom` property for UI scaling, which was severely distorting the browser's physical bounding boxes and causing the plugin to randomly "fly off-screen" when dragged to the top edge. 
- **Rem/Calc Sizing Engine**: Adopted a bottom-up relative scaling approach using `font-size: calc(16px * scale)`. The plugin container maintains stable physical dimensions while internals scale smoothly, restoring absolute precision to the drag-and-drop collision physics.
- **State Mutex Locks**: Implemented strict interaction locks. Entering an exclusive fullscreen view (like the Gallery) now aggressively disables the main hamburger menu to prevent rendering conflicts and DOM state overlapping.
- **Centralized i18n Mutator Engine**: Solved the "Fake Localization" bug where newly added dynamic buttons remained in Chinese. All persistent DOM elements are now strictly bound to the Top-Down language mutation hook, ensuring flawless 1-click bilingual swapping without Vue or React.

## v1.3.0 (Zero-API Tensor Fingerprinting Update)
### 🧠 HuggingFace Native Support
- **Offline Base Model Inference**: Added a zero-API local inference engine! For models downloaded purely from HuggingFace (or private unreleased models) that return a 404 on Civitai, the scanner no longer gives up. It now forcibly parses the .safetensors structure and uses **Tensor Fingerprinting** (e.g., detecting double_blocks.0.img_attn for Flux) to accurately deduce the underlying base architecture with 100% precision.
- **Universal UI Integration**: Successfully inferred offline models are dynamically assigned a virtual .info payload (ID: -1). This instantly grants them full VIP access to the frontend ecosystem—they seamlessly appear in the Cross-Folder Radar, interact perfectly with the bilingual Notebook, and support one-click Auto-Inject loaders, all completely completely offline!

# 📈 Anomalous Model Browser Changelog

## v2.0.0 (The Workflow & UI Evolution Update)
### 🚀 Major Features
- **Node Assistant (节点助手)**: Introduced a dedicated "Assistant" tab within the Model Doctor. Selecting any node in the canvas instantly focuses the Assistant on that specific node, providing deep analysis and contextual controls without obscuring your view.
- **Visual Model Switcher (可视化模型选择)**: Eliminated blind dropdown menus! When replacing a model, a stunning visual grid pops up inside the Assistant panel, displaying full cover images and model names. You can now select replacements purely visually.
- **Global Health Dashboard (全图体检报表)**: A top-level dashboard in the Doctor panel provides a bird's-eye view of your entire workflow. It categorizes nodes into "Healthy", "Missing", "Replaced", and "Unrelated", giving you instant situational awareness.
- **Inline Node Notes (内联节点备注)**: Added the ability to view and edit model notes directly beneath the preview image in the Node Assistant, ensuring zero layout shifting and maintaining a continuous UX flow.
- **Local Metadata Parsing Toggle (非C站模型本地解析)**: Added a new explicit toggle in the Settings Hub. This allows users to enable deep local/offline metadata scanning (e.g. for HuggingFace models) without strictly enforcing a Civitai lookup.

### 🐛 Bug Fixes & UX Polish
- **Regex Replacement Bug**: Fixed a critical bug where regex backslashes were swallowed during update patching, causing a syntax error in `main.js` that made the plugin icon disappear.
- **Dynamic Regex Splitting**: Ensured file paths are split properly using both forward slashes and backslashes `/[\/]/` for complete cross-platform Windows/Linux compatibility.
- **Temporary Feature Suspension**: Temporarily commented out the WIP "Preflight Import Workflow" button while its parsing engine is being finalized.

## v1.2.0 (The O(1) Speed & Tiered Resolution Update)
### 🚀 Architectural Breakthroughs
- **Tiered Fallback Resolution Engine**: The core hashing and scanning engine has been completely rewritten. When scanning new .safetensors files without an .info file, the scraper no longer blindly computes the SHA256 of the entire 7GB+ file. Instead, it extracts the uint64 header size and parses the internal JSON to retrieve the embedded modelspec.hash.sha256. This drops the hash time for new models from minutes down to O(1) milliseconds, achieving true instantaneous lightweight scans.

### 💄 UX Improvements
- **Gentle Workflow Error Reminder**: Removed the overly aggressive background ghost-clicker that attempted to clear Vue side-panel errors by simulating clicks. Replaced it with a clean, bilingual user alert gently reminding them to click the [Refresh] button if the ComfyUI Workflow Overview panel still shows red errors.
- **Documentation Badges**: Added quick-access badges to the README header for 1-click navigation to the Changelog and Developer Notes on GitHub.

# 馃搱 Anomalous Model Browser Changelog

## v1.1.1 (Ultimate Model Resolution & Diagnostic Overhaul)
### 馃殌 Enhancements
- **Lightweight Scan Speed Demon**: Rewrote the "Lightweight Scan" incremental skip condition. By recognizing that lightweight mode purposefully omits media (`--skip-media`), the scanner now skips models *instantly* if a `.info` file exists, bypassing the heavy SHA256 computation block. Lightweight scans are now truly lightweight, parsing hundreds of gigabytes in mere seconds instead of minutes.
- **One-Click Visual Residue Eradication**: Both the post-scan auto-fix and the "One-Click Fix Workflow" settings button have been supercharged. They now aggressively target `node.color`, `node.bgcolor`, and `node.has_errors`. Even if the string matches perfectly but the frontend dropdown cache is just stale, the script violently resets ComfyUI's native red error highlighting. The workflow immediately visually clears without requiring a browser refresh.

### 馃悰 Bug Fixes
- **The "Overlapping Directory" Deadlock**: Fixed a critical bug in `api.py` where fallback `target_size` matching completely aborted if `len(size_matches) > 1`. If users had `extra_model_paths.yaml` aliasing `checkpoints` and `diffusion_models` to the exact same physical folder, `os.walk` naturally duplicated the entries. Implemented an `os.path.realpath` deduplication matrix to fuse these ghosts into a single mathematical truth, restoring size-based missing node resolution to 100% reliability.
- **Silent Scanner Crashing**: Fixed a tiny but fatal Python `IndentationError` in `scraper.py` (introduced during the skip-media logic update) that caused the lightweight scanner to silently crash before doing anything. The UI DEVNULL suppression hid the error, creating the illusion of the scan "ignoring" models. The indentation is now strictly PEP-8 compliant.
## v1.1.0 (Integrated Gallery & Advanced UX Update)
### 鉁?Major Features
- **Integrated Image Gallery**: Added a brand new "Gallery" hub that seamlessly syncs with your ComfyUI `output` folder. Browse your generation history natively within the plugin!
- **Infinite Lazy Loading**: The gallery utilizes `IntersectionObserver` to automatically load images as you scroll, ensuring zero lag even with thousands of generations.
- **Drag-and-Drop Workflow Import**: Every gallery image acts exactly like native ComfyUI assets. You can directly drag any image onto the canvas or a `Load Image` node to effortlessly extract its metadata and workflow.
- **Foolproof Image Deletion**: Built an immersive, full-card confirmation overlay for deleting images, replacing the tiny inline buttons. It drastically increases click accuracy and perfectly follows Fitts's Law.

### 馃拕 UX & UI Polish
- **"Intent Delay" Hover Mechanics**: Fixed "Strobe Effects" where rapid mouse sweeping caused flickering UI. Added a customized `0.35s cubic-bezier` curve with a `0.08s` delay to all grid cards and notebook items, ensuring items only pop up when you actually mean to look at them.
- **Smart Sidebar Auto-Hide**: When clicking the "Gallery" top menu button, the left folder tree now intelligently auto-hides itself, leaving maximum screen space for viewing your images. It automatically restores when returning to the Models page.
- **CSS Grid Refinements**: The gallery uses responsive flex layout (`minmax(250px, 1fr)`), automatically balancing 4 beautiful thumbnails per row in expanded mode.


## v1.0.3 (Responsive UI & Critical Hotfixes)
### 馃殌 Enhancements
- **Settings Panel Redesign**: Transformed the raw API Key input field into a clean, dedicated `馃攽 API Key Config` modal button. Added detailed, beginner-friendly descriptions for all settings buttons (Scan, Clean, AutoPlay) to clarify their destructive/background behaviors.
- **Top Bar Layout Logic**: The header buttons (Models, Settings, etc.) now intelligently hide themselves when the left sidebar folder tree is expanded on narrow screens, automatically reappearing when the tree is collapsed to avoid layout breakage.
- **English Typography Polish**: Added specific CSS `.anomalous-lang-en` scaling to increase the English header buttons to `1.05em` with generous padding, perfectly matching the visual weight of the Chinese UI.
- **Pure Icon Narrow Sidebar**: The Notebook's internal left sidebar is now extremely responsive. On narrow screens (`< 600px`), it aggressively collapses to `60px` width, hiding all notebook names and displaying only pure document icons for a sleek micro-toolbar feel.
- **Logical Settings Order**: Swapped the positions of the language toggle and the Close button in the settings panel. The language toggle now sits proudly at the top with a distinct margin, while the red Close button acts as a final anchor at the bottom.

### 馃悰 Bug Fixes
- **The "Missing Plugin Button" Trap**: Completely eliminated a notorious "old bug" where the floating plugin button would vanish forever if a user resized their window or switched to a smaller monitor (due to `localStorage` caching out-of-bounds `left/top` coordinates like `3000px`). The button now forces a safe bottom-right fallback if the saved coordinates exceed `window.innerWidth`.
- **Fatal Vite Preload Crash**: Fixed a critical `SyntaxError` caused by a missing template literal backtick (`` ` ``) in the translation dictionary. This tiny missing character previously triggered a `[vite:preloadError]`, causing the entire `main.js` to abort loading before rendering the UI.
- **Double Icon Squashing**: Addressed a bug where the top header's "Notebooks" button would turn into a weird, empty dark gray rectangle on narrow screens. Extracted the `馃搼` emoji out of the translation string wrapper so the icon remains fully visible even when the text is responsively hidden.

---

# v1.0.2 (UX & Polish Hotfix)
## 馃殌 Enhancements
- **Magnetic Matrix Deployment**: When sending a Notebook to the canvas, the entire architecture (Checkpoint + Loras + CLIP Encoders) is now mathematically arranged in a clean, linear assembly line instead of clumping together. The entire node group magnetically sticks to your cursor until you click the canvas to drop it.
- **Smart Session Memory**: Re-opening the Notebook panel now instantly resumes your exact previous editing session rather than resetting to a blank state.
- **Auto-Focus First Notebook**: If no session is active, opening the Notebook modal will automatically open your first existing notebook to prevent "empty screen" fatigue.
- **Instant Save Feedback**: Added a satisfying 1.5-second green `鉁卄 transient animation to the notebook save button for psychological assurance.
- **Clearer Documentation**: Updated README codebase size estimation to reflect reality (~150KB - 200KB) due to the massive features added, while still maintaining pure Vanilla JS zero-dependency dominance.

## 馃悰 Bug Fixes
- **Double Icon Glitch**: Removed a hardcoded `鉃昤 emoji on the "Apply to Canvas" button that duplicated the icon injected by the translation engine.
- **Localization Override**: Fixed a critical bug where scan success dialogs were defaulting to English despite the UI being set to Chinese. This was caused by the plugin improperly reading the host ComfyUI root DOM `lang` attribute instead of the plugin's internal state.
- **Safer Reboot Advice**: Replaced misleading mentions of "Refresh ComfyUI" with strict advice to "Restart ComfyUI backend" after model scans to prevent deep path caching crashes.

---

# v1.0.1 (Notebook System Expansion)
## 馃専 New Features
- **Notebook System (`馃搼 Notebooks`)**: A powerful new drafting space designed for workflow preparation.
  - **Bilingual Prompt Editor**: A dual-pane translation workspace (English/Chinese) that supports Google and DeepL translation via local Python backend (caching in `translations.json`).
  - **Interactive Tag Engine**: Automatically splits prompts by commas into styled tags. Includes hover-sync between English and Chinese tags, individual tag editing, and 1-click clipboard copying.
  - **Dynamic Architecture Filtering**: The Notebook allows selecting a Base Model directly parsed from your local library (e.g., `SDXL`, `SD 1.5`, `Pony`), strictly omitting unowned default models. Selecting an architecture perfectly filters the Main Model and Lora galleries below it.
  - **One-Click Deployment**: The **"馃殌 Send to Canvas"** button seamlessly injects your configured Checkpoint loader, Lora loaders, and CLIP Text Encode nodes directly onto the ComfyUI canvas, fully wired and ready to go.

## 馃洜锔?Enhancements & UX Tweaks
- **Zero-Wait Delete Actions**: The "Delete Notebook" interaction has been overhauled. Instead of a mandatory 3-second wait, it now transforms into an explicit `[鈿狅笍 Sure?]` and `[鉁昡` cancellation button combo, dramatically improving the user experience for accidental clicks.
- **Buttery Smooth Hover Dynamics**: Replaced harsh instant hovers on model cards with a `cubic-bezier(0.2, 0.8, 0.2, 1)` transition and a micro `0.02s` delay. This eliminates strobe-flashing when the mouse sweeps quickly across galleries, providing an extremely premium damping feel.
- **Smart Startup Navigation**: The plugin no longer opens to an empty root directory by default. It now intelligently scans all loaded trees on startup and auto-focuses the first valid folder containing models, ensuring you dive straight into your library.
- **Deep i18n Integration**: Total internationalization coverage extended to all deep-layer UI elements, including Notebook buttons, translation triggers, and dynamic dialogs. Language toggling triggers an instant virtual DOM re-render without page refreshes.

## 馃悰 Bug Fixes
- **Base Model Metadata Pollution**: Fixed an issue where the `baseModel` dropdown forcefully injected unowned models (like `HunyuanVideo` or `OmniGen`) into the UI. The filter now strictly traverses actual local `.safetensors` headers and `.info` configurations to provide a 100% accurate reflection of your physical library.
- **Nested Scrolling Traps**: Eliminated a severe UX "scroll trap" within the Notebook dual-pane editor by removing inner `max-height` constraints, allowing natural flex expansion utilizing the modal's primary scrollbar.
- **Model Selection Jumping**: Fixed layout shifting caused by variable-length text tags by implementing a rigid CSS grid/flex architecture (`.anomalous-nb-tag-row`).


