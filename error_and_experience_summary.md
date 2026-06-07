# 📖 Error & Experience Summary

This document serves as an architectural retrospective and UX diagnostic log for the development of the Anomalous Model Browser.

## 1. UX Scroll Traps (Nested Scrollbars)
**The Problem**:
In the Notebook modal, the translation dual-pane editor was initially assigned a `max-height: 400px` and `overflow-y: auto`. Since the parent container (the entire notebook editor body) was also scrollable, this created a severe "Scroll Trap". When users scrolled down the translation tags, hitting the bottom would unpredictably transfer the scroll event to the outer body, making navigation feel disjointed and frustrating.
**The Solution**:
Removed the `max-height` and internal scrollbar from the translation pane entirely. Letting the translation editor expand naturally utilizing the primary window scrollbar guarantees a continuous, smooth scrolling experience.

## 2. Artificial Metadata Pollution
**The Problem**:
When building the "Base Model" dropdown filter, the backend `api.py` attempted to aggregate local `baseModel` strings but fell back to aggressively injecting a hardcoded list of modern architectures (`SDXL`, `HunyuanVideo`, `OmniGen`) to ensure the dropdown looked "complete." This completely backfired, confusing the user who saw architectures they didn't even own installed on their drive.
**The Solution**:
Data truth must strictly reflect the local disk state. The backend was rewritten to strictly parse the `.safetensors`/`.civitai.info` headers without any artificial list padding. The UI dropdown now acts as an accurate mirror of the physical file ecosystem.

## 3. UI Strobe Effects on Grid Hovers
**The Problem**:
Setting standard `transition: all 0.2s` for the hover states on model cards meant that quickly sweeping the mouse across the grid caused all cards to rapidly light up and drop down like a strobe light. It felt cheap and unresponsive.
**The Solution**:
UI damping is critical for premium feel. We introduced a customized `cubic-bezier(0.2, 0.8, 0.2, 1)` transition with a microscopically tiny `transition-delay: 0.02s` on the hover pseudo-class. This 20ms delay is imperceptible for intentional interactions but acts as a low-pass filter, completely eliminating strobe flashes from fast, accidental mouse sweeps.

## 4. "Hostage" Inline Confirmations
**The Problem**:
To avoid browser `alert()` dialogs during deletion, an inline confirmation was built: clicking "Delete" changed the button to "Are you sure?" with a 3-second `setTimeout`. However, there was no explicit "Cancel" button. If the user misclicked, they were held "hostage" for 3 seconds waiting for the button to revert.
**The Solution**:
Never lock a user out without an exit hatch. The delete button logic was wrapped in an inline flex container that instantly reveals a secondary `[✕]` cancel button upon the first click. Clicking `[✕]` instantly clears the timeout and resets the state, giving control back to the user immediately.

## 5. First-load "Dead Interface" Avoidance
**The Problem**:
The plugin initialized its sidebar to the root directory `/`. If a user had deeply nested categories but no models in the root, opening the plugin presented a blank screen, creating the illusion that it had failed to load.
**The Solution**:
Implemented an intelligent `firstLoadDone` routine. During the initial folder fetch, the JS client parses the dictionary of directories, scanning the `model_count` parameters. It automatically forces the UI `currentSubfolder` to the very first directory that possesses `model_count > 0`. The user is instantly greeted with their content upon opening.

## 6. Structural Layout Breakages (Flex vs Block)
**The Problem**:
When rendering translation tags side-by-side, placing varying lengths of text blocks sequentially caused extreme layout jitter. Hovering over a long English tag to highlight the Chinese counterpart caused the UI to "jump" if the lines didn't align perfectly.
**The Solution**:
Enforced a strict "Row-based" flex architecture (`.anomalous-nb-tag-row`). By slicing both the Source and Target arrays simultaneously and wrapping them in an `align-items: stretch` flex container, each tag pair is locked into a row, guaranteeing perfect geometric stability regardless of string length.

## 7. Modal State Persistence vs DOM Lifecycle
**The Problem**:
When users closed the Notebook modal and reopened it, the right-side editor was blank. The JS application retained `this.currentNotebook` in memory from the previous session, skipping the "auto-open first notebook" logic, but because the DOM modal was completely destroyed and recreated via `.innerHTML`, the editor function `renderNotebookEditor()` was never invoked, leaving a desynced blank UI.
**The Solution**:
Explicitly check the cached state during modal initialization. If `this.currentNotebook` exists upon modal creation, force a call to `this.renderNotebookEditor()` instead of assuming it's already rendered. This achieves perfect "session memory" for the user.

## 8. Missing Visual Feedback for Background Operations
**The Problem**:
The Notebook "Save" button executed a background `fetch` request perfectly, but provided absolutely no visual feedback. Users complained the button was "unresponsive" because nothing flashed or changed on screen, causing anxiety about data loss.
**The Solution**:
Transient UI states are mandatory for background tasks. We added a temporary state swap: clicking Save instantly changes the button to a green `✅` state for 1.5 seconds before reverting, providing the crucial psychological closure needed.

## 9. Spatial Geometry for Multi-Node Spawning
**The Problem**:
When deploying an entire Notebook (Main Model + N Loras + 2 CLIP Prompts) to the ComfyUI canvas, spawning them all at `app.canvas.graph_mouse` or `(0,0)` would cause all nodes to perfectly overlap into an indistinguishable clump, forcing the user to manually detangle them.
**The Solution**:
Implemented a "Relative Offset Matrix Layout". The code iteratively calculates spatial offsets (`X + 350*N`, `Y + 250`) to construct a perfect assembly line of nodes. Combined with binding these coordinates to a `mousemove` event (Magnetic Sticking), the user can visually preview the massive node chain dragging with their cursor before clicking to drop it onto the canvas, preserving workflow layout sanity.

## 10. Localization Host-Environment Constraints
**The Problem**:
Our localization engine was reading `document.documentElement.lang` to decide whether to show English or Chinese error popups. However, because our plugin runs inside ComfyUI, ComfyUI controls the root HTML element and keeps it permanently set to `en-US`. Consequently, Chinese users always received English system popups regardless of the plugin's internal language toggle.
**The Solution**:
Never trust the host document properties when building an embedded plugin. Localization logic was strictly re-routed to rely on our internal `currentLang` variable state, ensuring correct i18n rendering.
