# Changelog v1.0.2 (UX & Polish Hotfix)

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
