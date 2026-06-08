# 📈 Anomalous Model Browser Changelog

## v1.1.0 (Integrated Gallery & Advanced UX Update)
### ✨ Major Features
- **Integrated Image Gallery**: Added a brand new "Gallery" hub that seamlessly syncs with your ComfyUI `output` folder. Browse your generation history natively within the plugin!
- **Infinite Lazy Loading**: The gallery utilizes `IntersectionObserver` to automatically load images as you scroll, ensuring zero lag even with thousands of generations.
- **Drag-and-Drop Workflow Import**: Every gallery image acts exactly like native ComfyUI assets. You can directly drag any image onto the canvas or a `Load Image` node to effortlessly extract its metadata and workflow.
- **Foolproof Image Deletion**: Built an immersive, full-card confirmation overlay for deleting images, replacing the tiny inline buttons. It drastically increases click accuracy and perfectly follows Fitts's Law.

### 💄 UX & UI Polish
- **"Intent Delay" Hover Mechanics**: Fixed "Strobe Effects" where rapid mouse sweeping caused flickering UI. Added a customized `0.35s cubic-bezier` curve with a `0.08s` delay to all grid cards and notebook items, ensuring items only pop up when you actually mean to look at them.
- **Smart Sidebar Auto-Hide**: When clicking the "Gallery" top menu button, the left folder tree now intelligently auto-hides itself, leaving maximum screen space for viewing your images. It automatically restores when returning to the Models page.
- **CSS Grid Refinements**: The gallery uses responsive flex layout (`minmax(250px, 1fr)`), automatically balancing 4 beautiful thumbnails per row in expanded mode.


## v1.0.3 (Responsive UI & Critical Hotfixes)
### 🚀 Enhancements
- **Settings Panel Redesign**: Transformed the raw API Key input field into a clean, dedicated `🔑 API Key Config` modal button. Added detailed, beginner-friendly descriptions for all settings buttons (Scan, Clean, AutoPlay) to clarify their destructive/background behaviors.
- **Top Bar Layout Logic**: The header buttons (Models, Settings, etc.) now intelligently hide themselves when the left sidebar folder tree is expanded on narrow screens, automatically reappearing when the tree is collapsed to avoid layout breakage.
- **English Typography Polish**: Added specific CSS `.anomalous-lang-en` scaling to increase the English header buttons to `1.05em` with generous padding, perfectly matching the visual weight of the Chinese UI.
- **Pure Icon Narrow Sidebar**: The Notebook's internal left sidebar is now extremely responsive. On narrow screens (`< 600px`), it aggressively collapses to `60px` width, hiding all notebook names and displaying only pure document icons for a sleek micro-toolbar feel.
- **Logical Settings Order**: Swapped the positions of the language toggle and the Close button in the settings panel. The language toggle now sits proudly at the top with a distinct margin, while the red Close button acts as a final anchor at the bottom.

### 🐛 Bug Fixes
- **The "Missing Plugin Button" Trap**: Completely eliminated a notorious "old bug" where the floating plugin button would vanish forever if a user resized their window or switched to a smaller monitor (due to `localStorage` caching out-of-bounds `left/top` coordinates like `3000px`). The button now forces a safe bottom-right fallback if the saved coordinates exceed `window.innerWidth`.
- **Fatal Vite Preload Crash**: Fixed a critical `SyntaxError` caused by a missing template literal backtick (`` ` ``) in the translation dictionary. This tiny missing character previously triggered a `[vite:preloadError]`, causing the entire `main.js` to abort loading before rendering the UI.
- **Double Icon Squashing**: Addressed a bug where the top header's "Notebooks" button would turn into a weird, empty dark gray rectangle on narrow screens. Extracted the `📑` emoji out of the translation string wrapper so the icon remains fully visible even when the text is responsively hidden.

---

# v1.0.2 (UX & Polish Hotfix)
## 🚀 Enhancements
- **Magnetic Matrix Deployment**: When sending a Notebook to the canvas, the entire architecture (Checkpoint + Loras + CLIP Encoders) is now mathematically arranged in a clean, linear assembly line instead of clumping together. The entire node group magnetically sticks to your cursor until you click the canvas to drop it.
- **Smart Session Memory**: Re-opening the Notebook panel now instantly resumes your exact previous editing session rather than resetting to a blank state.
- **Auto-Focus First Notebook**: If no session is active, opening the Notebook modal will automatically open your first existing notebook to prevent "empty screen" fatigue.
- **Instant Save Feedback**: Added a satisfying 1.5-second green `✅` transient animation to the notebook save button for psychological assurance.
- **Clearer Documentation**: Updated README codebase size estimation to reflect reality (~150KB - 200KB) due to the massive features added, while still maintaining pure Vanilla JS zero-dependency dominance.

## 🐛 Bug Fixes
- **Double Icon Glitch**: Removed a hardcoded `➕` emoji on the "Apply to Canvas" button that duplicated the icon injected by the translation engine.
- **Localization Override**: Fixed a critical bug where scan success dialogs were defaulting to English despite the UI being set to Chinese. This was caused by the plugin improperly reading the host ComfyUI root DOM `lang` attribute instead of the plugin's internal state.
- **Safer Reboot Advice**: Replaced misleading mentions of "Refresh ComfyUI" with strict advice to "Restart ComfyUI backend" after model scans to prevent deep path caching crashes.

---

# v1.0.1 (Notebook System Expansion)
## 🌟 New Features
- **Notebook System (`📑 Notebooks`)**: A powerful new drafting space designed for workflow preparation.
  - **Bilingual Prompt Editor**: A dual-pane translation workspace (English/Chinese) that supports Google and DeepL translation via local Python backend (caching in `translations.json`).
  - **Interactive Tag Engine**: Automatically splits prompts by commas into styled tags. Includes hover-sync between English and Chinese tags, individual tag editing, and 1-click clipboard copying.
  - **Dynamic Architecture Filtering**: The Notebook allows selecting a Base Model directly parsed from your local library (e.g., `SDXL`, `SD 1.5`, `Pony`), strictly omitting unowned default models. Selecting an architecture perfectly filters the Main Model and Lora galleries below it.
  - **One-Click Deployment**: The **"🚀 Send to Canvas"** button seamlessly injects your configured Checkpoint loader, Lora loaders, and CLIP Text Encode nodes directly onto the ComfyUI canvas, fully wired and ready to go.

## 🛠️ Enhancements & UX Tweaks
- **Zero-Wait Delete Actions**: The "Delete Notebook" interaction has been overhauled. Instead of a mandatory 3-second wait, it now transforms into an explicit `[⚠️ Sure?]` and `[✕]` cancellation button combo, dramatically improving the user experience for accidental clicks.
- **Buttery Smooth Hover Dynamics**: Replaced harsh instant hovers on model cards with a `cubic-bezier(0.2, 0.8, 0.2, 1)` transition and a micro `0.02s` delay. This eliminates strobe-flashing when the mouse sweeps quickly across galleries, providing an extremely premium damping feel.
- **Smart Startup Navigation**: The plugin no longer opens to an empty root directory by default. It now intelligently scans all loaded trees on startup and auto-focuses the first valid folder containing models, ensuring you dive straight into your library.
- **Deep i18n Integration**: Total internationalization coverage extended to all deep-layer UI elements, including Notebook buttons, translation triggers, and dynamic dialogs. Language toggling triggers an instant virtual DOM re-render without page refreshes.

## 🐛 Bug Fixes
- **Base Model Metadata Pollution**: Fixed an issue where the `baseModel` dropdown forcefully injected unowned models (like `HunyuanVideo` or `OmniGen`) into the UI. The filter now strictly traverses actual local `.safetensors` headers and `.info` configurations to provide a 100% accurate reflection of your physical library.
- **Nested Scrolling Traps**: Eliminated a severe UX "scroll trap" within the Notebook dual-pane editor by removing inner `max-height` constraints, allowing natural flex expansion utilizing the modal's primary scrollbar.
- **Model Selection Jumping**: Fixed layout shifting caused by variable-length text tags by implementing a rigid CSS grid/flex architecture (`.anomalous-nb-tag-row`).
