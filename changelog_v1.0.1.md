# 📈 Changelog v1.0.1

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

---
*Anomalous Model Browser - Continuing the pursuit of absolute minimalism and uncompromised performance.*
