# 📈 Anomalous Model Browser Changelog

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


