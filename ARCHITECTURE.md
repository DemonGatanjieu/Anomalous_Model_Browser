# Anomalous Model Browser Architecture

This is the short entry point for maintainers and AI agents. It describes the
system map, ownership boundaries, and rules that apply across subsystems. Read
only the linked topic document relevant to the task; do not load every document
by default.

## Reading map

The prompt studio reads material prompt payloads through `web/modules/material_prompt_data.js`;
list summaries do not contain prompt bodies. See the Material Library contract below.

| When changing... | Read... |
| --- | --- |
| Python routes, storage, paths, metadata, covers, or scan state | [`docs/architecture/backend.md`](docs/architecture/backend.md) |
| Browser lifecycle, UI state, localization, media, or graph edits | [`docs/architecture/frontend.md`](docs/architecture/frontend.md) |
| Workflow Recipes, packages, galleries, Parameter Notebooks, or prompt roles | [`docs/architecture/recipes.md`](docs/architecture/recipes.md) |
| Material Library snapshots, image parameter details, or reusable node blocks | [`docs/architecture/material-library.md`](docs/architecture/material-library.md) |
| Model Doctor, provenance hashes, missing-model recovery, or deep scanning | [`docs/architecture/model-resolution.md`](docs/architecture/model-resolution.md) |
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
- `api/utils.py` owns containment and filename validation helpers.
- `api/metadata.py` owns sidecar and safetensors metadata extraction.
- `api/models.py` owns model listing, media serving, and model-facing routes.
- `api/scanner.py` and `scraper.py` own scan orchestration and enrichment.
- `api/recipes.py` owns recipe validation, CRUD, history, and integrity receipts.
- `api/recipe_packages.py` owns bounded inspect-stage-commit package handling.
- `api/parameters.py` owns Parameter Notebook persistence and lookup.
- `api/notebooks.py` owns Prompt Note persistence and recoverable legacy copying.
- `api/materials.py` owns curated material persistence, private image assets,
  summary search/pagination, editable names/tags, and node-type lookup.
- `model_policies.py` owns shared backend rename and protected-category policy.
- `model_identity.py` owns file SHA-256 evidence shared with the standalone scanner.

### Frontend

- `web/main.js` is the extension entry and shared browser-instance owner.
- `web/modules/entry_controls.js` and `shortcut_controls.js` own entry modes and
  native command/keybinding integration.
- `ui_sidebar.js`, `ui_grid.js`, `ui_detail.js`, and `ui_gallery.js` own the
  primary model-browser surfaces, including the frosted-glass capsule parameter inspection
  button with lightweight vector SVG icons and GPU-accelerated micro-interactions;
  the sidebar bottom action bar (`#anomalous-sidebar-actions`) features intuitive, highly restrained glyphic vector SVG icons (`SIDEBAR_ICONS`):
   (1) Toolbox Hub (`#anomalous-toolbox-btn`): Precision 18px vector toolbox icon (`TOOLBOX`) anchoring the leftmost action slot, triggering an elevated 236px zero-scrollbar micro-utility drawer popover (`#anomalous-toolbox-modal`, z-index 999999, `overflow: hidden`) anchored directly above the action bar in the bottom-left corner (`bottom: 50px; left: 10px;`, collapsed `left: 68px`), presenting a high-density 3-column app/utility icon grid palette (`.anomalous-toolbox-grid`, `.anomalous-toolbox-tile`) hosting the Prompt Studio (`🎛️ 提示词工坊`, `openPromptStudio`) as the primary active online tool alongside utility helpers, with instant tooltips, emerald ready indicator dots (`.is-ready`), amber planned status dots, extensible tool registry (`this.registerToolboxItem`), zero obstruction to the central model grid, and mutual exclusivity against Settings Hub;
   (2) Scan Wizard (`#anomalous-scan-btn`): Clean circular radar scope with range ring, crosshairs, and sweep beacon (`SCAN_RADAR_ICON_SVG`), animated only during active scanning;
   (3) Model Doctor (`#anomalous-doctor-btn`): Sleek diagnostic medical stethoscope, instantly conveying health check semantics;
   (4) AI Assistant (`#anomalous-assistant-btn`): Radiant AI copilot sparkles (`✦`), representing copilot intelligence;
   (5) Material Library (`#anomalous-materials-btn`): 3D layered preset stack, distinguishing from individual model boxes;
   (6) Settings Hub (`#anomalous-global-settings-btn`): Precision 8-tooth mechanical engineering gear with elevated popover (`#anomalous-settings-hub-modal`) mounted directly to container with `z-index: 999999` and dynamic responsive offset; hosts a clean 3-way Display Mode segmented controller (`#anomalous-view-mode-container` for Standard, Compact, and Aesthetic modes), UI scale controls, dynamic background atmosphere controls, folder manager, language toggles, a restrained inline 13px glyph question icon for Help (decoupling from `.anomalous-btn-icon` 32px box trap), and an intuitive reload arrow (`↺`) for window layout reset replacing esoteric drafting ruler emojis;
   (7) Models & Floating Trigger: Precision 3D Isometric Asset Model Cube SVG (`box`), universally conveying 3D model, mesh, and asset package semantics with zero visual ambiguity;
   adhering to a "low-stimulus idle, subtle-illumination on hover" philosophy where icons use calm `currentColor` in idle state and gently illuminate on interaction;
   critical tool workbenches (`#anomalous-doctor-panel`, `#anomalous-assistant-panel`) strictly enforce 100% opaque, solid backgrounds (`background: var(--amb-bg-page, #131315) !important`) to eliminate background distraction during diagnostics;
   the UI palette strictly adheres to a true neutral dark charcoal / obsidian studio aesthetic (`#131315`, `#1a1a1d`, `#202024`, `#28282d`) with zero cool-blue/navy cast, matching ComfyUI, Blender, and DaVinci Resolve workstation standards;
   the sidebar action bar's circular astrological runic compass watermark (`#anomalous-sidebar-actions::before`) is completely disabled (`display: none !important`), and any backdrop textures are desaturated with `grayscale(100%)` to prevent blue color bleeding;
   all primary action highlights, scan wizard controls, and switches use titanium white (`#e5e7eb` / `#ffffff`) with warm studio amber (`#f59e0b`) accents instead of cold blue/cyan;
   the modal adopts a disciplined "workshop / archive" aesthetic: removing exaggerated `clip-path` chamfers in favor of clean 8px architectural engineering geometry (`border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1)`);
   the master header (`#anomalous-header`) and sidebar brand bar (`#anomalous-brand-bar`) are tightly calibrated to a 48px slim industrial profile; header navigation tabs (`#anomalous-models-btn`, `#anomalous-gallery-btn`, `#anomalous-notebook-btn`) and window control buttons (`#anomalous-dock-btn`, `#anomalous-close`) are unified to a compact 28px height, 6px border radius, 13px vector icons, active tab tracking, and persistent bilingual text labels (`[ 📦 模型 ]`, `[ 🖼️ 图库 ]`, `[ 🔗 工作流 ]` - simplified from "工作流配方" to balance width and match ComfyUI workflow mental model), perfectly harmonizing with adjacent dock and close controls;
   cards feature restored and refined top-right micro-action buttons (`.anomalous-card-action-btn`: Apply ➕, Edit ✏️, Scan 🎯) with 22px frosted glass styling, smooth hover fade-in, and auto-clipping avoidance against the base model badge (`.anomalous-card-badge`);
   supports 3 unified Display Modes sharing identical DOM structure and UX logic:
  - Compact Mode (紧凑模式, primary default): 140px min-width, 220px card height, tight 10px gaps/14px rows, 5px sidebar folder rows, optimized for high-density scanning and instant visual discovery (Blender Asset Browser inspired);
  - Standard Mode (标准模式, comfortable): Balanced 200px cards, 340px height, comfortable whitespace rhythm;
  - Aesthetic Mode (沉浸模式): Subtle 8% grayscale ambient archive watermark with frosted glass borders;
  cards feature unified 6px/8px geometry, restrained elevation (`translateY(-2px)`, `scale(1.02)`), spatial depth shadows (`0 4px 14px rgba(0,0,0,0.35)`),
  seamless docking fallbacks, and a micro-floating capsule tooltip system
  (`.anomalous-tooltip-target`) providing unambiguous, bilingual action semantics across all vector tools.
- `ui_gallery_detail.js` owns the studio modal Image Detail Workbench,
  multi-dimensional image navigation (keyboard shortcuts, floating glass arrows,
  left vertical thumbnail rail), streamlined workflow/material action buttons,
  seamless non-shifting click-to-copy Bento spec tiles with error retry state,
  keyboard accessible focus indicators, full-width generation parameter saving to Material Library,
  and segmented Bento parameter inspection with ComfyUI canvas injection (`app.loadGraphData`).
- `ui_notebooks.js`, `ui_recipes.js`, and `ui_recipe_detail.js` own Workspace
  presentation, featuring an integrated Studio topbar (`.anomalous-recipe-topbar`) with responsive `flex-wrap: wrap`,
  a subtle 1px border-bottom (`rgba(255,255,255,0.05)`), scope filter micro-pills (`all`, `complete`, `partial`) with high-transparency default backgrounds,
  unified search & tag dropdown, and dual view modes (uniform 264px Bento grid & compact list view);
  cards feature 136px golden-ratio top covers, clean titles without badge clutter (relocating isolated readiness dots into a sleek frosted-glass
  `anomalous-recipe-readiness-pill` chip at the bottom-left of the cover alongside base model pills), single-row ellipsis text tags (`white-space: nowrap; text-overflow: ellipsis`),
  top-right scope pills, and one-click canvas load (`🚀 载入画布` / `🧩 追加画布`, powered by quantum energy fluid micro-textures `btn_energy_core.webp` with sharp text drop-shadows);
  filter pills (`.anomalous-recipe-pill.is-active`, `.anomalous-workbench-pill.is-active`) feature micro-crystalline quantum glow underlays (`pill_active_glow.webp`);
  cards without custom thumbnails automatically receive deterministic AI-generated abstract material blind-box artwork (`web/assets/default_cover_1.webp` ~ `default_cover_6.webp`),
  eliminating dry grey placeholder boxes. Empty state displays (`.anomalous-recipe-empty`) seamlessly blend with the futuristic cyber library concept art (`empty_library_concept.webp`)
  using vertical gradient alpha masks (`mask-image: linear-gradient(...)`).
  Direct canvas drag-drop ("一拖直达画布") allows dragging any recipe card across the translucent
  modal directly onto the ComfyUI canvas to immediately load the workflow into a fresh canvas
  (or append subgraphs), mimicking native ComfyUI image-drop behavior.
  Recipe Detail Studio View (`showRecipeDetail`) is completely overhauled: dynamically hides
  outer `.anomalous-recipe-topbar` on entry and cleanly restores it on exit to reclaim 100% of the
  vertical workspace; replaces clumsy text copy buttons with sleek SVG micro-copy icons with instant
  green checkmark feedback; rebuilds the Parameters Tab (`renderRecipeParameters`) into a modern
  Bento Matrix (`.anomalous-recipe-bento-grid`, steps/CFG/sampler/resolution/denoise/seed tiles,
  independent base model card, and structured LoRA pill stacks); prompts section (`renderPromptSection`)
  is upgraded into full-width streamlined cards eliminating the cramped two-column split, clumsy
  "调整用途" buttons, and isolated square copy boxes, moving actions into a top-right action tray
  (save to material + micro copy) and making the role badge interactively clickable; snapshot rail
  replaces legacy `<details>` and vertical text badges with smooth hover-reveal micro-actions and a glowing
  green active pulse dot (`.anomalous-preset-active-dot`); enforces 48px bottom safety padding to eliminate
  clipping and overlap.
  `ui_notebooks.js` resolves the long-text input bottleneck through 300ms Debounce on `rawArea.oninput`,
  `DocumentFragment` batch mounting in `updateVisualTags`, and modern CSS Grid layout (`.anomalous-nb-tag-row`)
  with hover-revealed copy buttons (`.anomalous-nb-copy-btn`); LoRA gallery performance is hardened via
  `content-visibility: auto`, `contain-intrinsic-size: 70px`, and fixed `aspect-ratio: 1/1` preventing Layout Shift.
- `ui_materials.js` owns the unified Material Library (素材库) view and its lifecycle;
  features a top-level unified toolbar with capsule category filter tabs (`[全部 | 工作流 | 参数方案 | 提示词]`),
  integrated search bar with live tag filter dropdown, dedicated view switcher (`[网格 | 列表]`),
  refresh and transfer center; cards feature strict uniform height (248px) with rich micro-skeuomorphic fallbacks for non-image assets (prompt code snippets
  and 3D asset parameter previews) eliminating visual bumpiness, direct inline title editing,
  floating quick actions, and lazy DOM rendering; completely decoupled from Prompt Studio (no studio toggle, no docked side panel, and no card-level mixer buttons); delegates image inspection to `ui_gallery_detail.js`;
  `node_material_actions.js` owns shared transactional node application and guarded undo;
  the library and Node Assistant use `ui_material_application.js` for the same receipt.
- `ui_prompt_composer.js` owns the Prompt Studio Dual-Column Workbench (提示词工坊左右双分栏工作台), an independent tool accessed exclusively from the Toolbox Hub (`openPromptStudio`);
  rendered in its dedicated container (`owner.promptStudioContainer`) with its own header title and close button (`[✕]`), completely decoupled from the Material Library;
  provides a clean, professional studio workspace (`.anomalous-prompt-workbench`) stripped of gaudy neon effects, cyberpunk backgrounds, and pulsing glow animations;
  features compact vertical spacing with an inline topbar hosting the preset name input (`.anomalous-prompt-name-input`), direct `[💾 保存方案]` button, secondary action dropdown (`[··· 更多]` for new draft, preset tags, and JSON export), and window close button (`[✕]`), completely eliminating bulky standalone metadata strips;
  in docked sidebar mode (`#anomalous-container.anomalous-docked`) and narrow screen layouts (<860px), adopts a Unified Dual-Zone Flow (上下联动一体流): completely eliminates clumsy tab switching (`[词卡库 | 拼装台 | 全部]`), arranging the Assembler Stage on top (`order: 1`, max-height 54%) and Candidate Cards Deck on bottom (`order: 2`, max-height 50%), both with independent scroll containers to ensure candidate cards and assembled Lego blocks remain simultaneously visible;
  the Cards Deck hosts candidate prompt cards in a compact 2-column chip grid (`repeat(auto-fill, minmax(130px, 1fr))`) with 1-tap instant assembly (`cardEl.onclick` adds card to the active track with `@keyframes anomalous-just-added` animated feedback) alongside native HTML5 drag-and-drop,
  features tactile glassmorphic card styling (dual-layer elevation shadows, top edge highlight, and category glow accents), a physical drag grip (`⠿`), a usage tip banner (`💡 点击词卡或拖拽至右侧拼装台`), monospace prompt snippet chips, and high-visibility `[+ 加入拼装台]` action buttons with instant click feedback,
  minimalist empty state container (`.anomalous-source-empty`), a streamlined col-header holding a unified action button group (`[🎯 提取]`, `[📥 导入]`, `[➕ 新建]`),
  one-click canvas node prompt extraction (`🎯 提取`, reading selected ComfyUI text nodes like `CLIPTextEncode` with downstream link connection traversal for accurate negative conditioning detection, auto-generating categorised cards) and one-click
  Material Library batch sync (`📥 导入`, cancellable fetch scoped to `category=prompts`), plus on-demand persistent card creation
  (`➕ 新建`, with explicit positive/negative role radios and `/anomalous/save_prompt_plan` backend persistence; temporary cards
  show `[未保存]` badge with one-click `💾 存入库`);
  the Assembler Stage hosts the sequential Lego block track (`anomalous-assembly-track`), compact modular blocks (~52px height) allowing generous top-to-bottom sequence stacking,
  supports bidirectional drag-and-drop reordering with ghost indicator lines, role-aware up/down swapping, instant A/B bypass toggles (greyscale dimming without deleting),
  interactive category pills, one-click Smart Sort (`🪄 按分类排序`, Base ➔ Style ➔ Subject ➔ Trigger),
  an interactive Auto-snap Dock (`.anomalous-assembly-snap-dock`) positioned at the bottom of the track that magnetically detects dragover across the empty lower track area to auto-snap dragged cards or blocks to the end with animated visual guidance,
  and a permanently visible sticky Action Dock (`.anomalous-prompt-action-dock`) at the bottom of the assembler stage: displays live synthesis statistics (`✨ X字 · Y块`), quick copy button (`[📋]`), expandable compiled text preview drawer (`[📄 最终文本 ▾]`), insertion position selector (`[在后 ▾] / [在前 ▾]`), and the ComfyUI canvas node direct injection bar (`[#ID 节点名称] [⬇️ 写入正向/负向]`), ensuring canvas node injection is always 1-click away and never buried inside collapsed drawers;
  `prompt_composition.js` provides bidirectional schema mapping (`planToWorkbenchDraft` and `workbenchDraftToSavedPlan`) ensuring
  100% roundtrip data integrity across `anomalous-prompt-plan-v1` and `version: 2`, lossless legacy dual-role splitting and trailing text retention,
  `categorizePromptSnippet`, `smartSortPromptBlocks`, `assemblePromptBlocks`, as well as backward-compatible text joining;
  `api/materials.py` validates prompt plans with extended categories (`general`, `specific`, `base`, `style`, `subject`, `trigger`)
  while preserving schema version, part role, and card id.
- `material_drag.js` owns temporary canvas drop listeners, target hit testing and
  window restoration. During active dragging, the main modal smoothly transitions to
  full transparency (`opacity: 0; pointer-events: none`) to fully reveal the underlying
  ComfyUI canvas, restoring on drop/cancel. Supports both node-targeted drops (materials replace,
  prompt notes insert text) and whole-canvas drops via `dropOnCanvas` (recipes load new workflows
  or append subgraphs).
- `material_inspector.js` owns shared image-metadata parsing and node-parameter
  rendering used by the library and Image Detail Workbench. Node cards feature leading
  aligned frosted-glass checkboxes with cyan micro-interactions for batch selection.
  The workbench does not import the library UI.
- `recipe_parser.js`, `recipe_identity.js`, `recipe_diff.js`, and
  `recipe_actions.js` own pure or transactional recipe behavior.
- `ui_doctor.js`, `model_picker.js`, and `graph_splice.js` own assistant and
  explicit graph-edit behavior.
- Dual-Mode Theme Architecture (双形态主题架构与材质光影精细化):
  - **Base Design System Tokens (`--amb-*`)**: Scoped on `:root` and overridden under `.theme-abyssal-scarlet`. Defines unified background, panel, card, text, border, and control radii tokens (`--amb-radius-control: 6px`, `--amb-radius-card: 10px`, `--amb-radius-panel: 12px`).
  - **Normal Mode (Default / 标准中性黑曜石图书档案馆模式)**: Restrained, clean, neutral dark obsidian (`#0b0d13` / `#141519` / `#1c1e24`) styling; overlaid with the "Anime Celestial Library Archive" AI Concept Art with glowing holographic magic circles, golden blueprint wireframes, and constellation starmap textures (`assets/archive_library_bg.webp`) across `#anomalous-container::before` at `0.65` opacity with radial dark vignette; **全界面毛玻璃一体化融合 (Unified Frosted Glass Architecture)**: 侧边栏 (`#anomalous-sidebar-wrapper`, 24px 模糊，52% 透光) 与顶部导航栏 (`#anomalous-header`, 20px 模糊，48% 透光) 全面采用磨砂毛玻璃透光，品牌徽章与搜索框微晶质感化，底图星轨、宏大书阁与发光符文在全窗口贯通流淌，与透明网格主视图形成高度沉浸式二次元魔法图书馆终端界面；银白高对比主操作按钮 (`#D7D9E0` 搭配 `#15171C` 字色)。
  - **Abyssal Scarlet Easter Egg Mode (`.theme-abyssal-scarlet` / 深海血族彩蛋领域 - 丝绒与暗血轻量质感)**: Strictly scoped under `.theme-abyssal-scarlet`; eliminates all cheap neon outer glows; deep gothic velvet backgrounds (`#161014` / `#21171d` / `#2b1e26`), razor-sharp crimson (`#dc143c`) and antique gold (`#b38728`) borders, crimson primary buttons (`#87384E` with `#FFF5F7` text), and concept art backdrops `assets/abyssal_scarlet_mansion.webp` and `assets/abyssal_bg_concept.webp`.
  - **Three-Tier Button Architecture**: Unifies button morphology across primary, secondary/ghost, and auxiliary actions. Primary buttons (`.anomalous-btn-primary`, `.anomalous-recipe-btn-primary-action`) feature solid fills, 32px height, 6px border-radius, clean SVG icons, and zero pseudo-element clutter (purged legacy `::before` diamonds, `::after` gradient lightbars, text-shadows, and heavy glows); secondary ghost buttons (`.anomalous-btn-ghost`) feature subtle borders and panel backgrounds; auxiliary action buttons provide clear, non-distracting tool semantics.
  - **Floating Trigger Button & Anomalous Hypercube Core (悬浮入口魔晶重构)**:
    - 重绘旧版扁平纸箱立方体为 **「异象超维魔方核 (Anomalous Hypercube Core)」**：外层等轴测立体超维立方体轮廓，内嵌悬浮发光微晶棱镜（`--amb-accent` 随主题自适应为天青/猩红），核心凝聚一枚四芒星辉奇点（`✦`），兼具 3D 模型容器特征与魔法档案馆星辰意象。
    - 悬浮球体容器 (`#anomalous-trigger-btn`) 升级为亚克力磨砂深色毛玻璃材质 (`backdrop-filter: blur(16px)`)，悬停微移提亮，图标伴随 12° 优雅微旋与天青/猩红柔和微光，保持高度克制的同时极具辨识度与高级质感。
  - **Prompt Studio Dual-Column Workbench (提示词工坊两行顶栏与容器自适应)**:
    - Topbar restructured into two clean rows: Row 1 hosts Back, shortened title ("提示词组合"), New, "更多 ▾" dropdown (containing Export), and primary Save Plan; Row 2 hosts expanded preset name and tag inputs.
    - Insert position ("添加到前面/后面") relocated into the target node write bar, adjacent to widget selection and write triggers where execution actually happens.
    - Left Column ("词卡库"): 280-320px width, clean cards with explicit text role badges (`[正向]` / `[负向]`), 2-line preview, single top drag hint, and secondary node/material extract buttons.
    - Responsive Container Query: Uses `@container prompt-workbench (max-width: 850px)` to smoothly stack panels vertically in narrow dock/floating windows without clipping or forced 100% heights.
  - **Uniform Card Skeletons**: Recipe and material cards enforce "Preview -> 2-Line Clamped Title -> Key Specs -> Footer Action Bar" order, preventing Chinese title clipping; Model cards display titles and filenames at rest without `translateY` collapse and without `backdrop-filter: blur`, fading in action buttons on hover.
  - **Custom Tooltip System (`[data-tooltip]`)**: Solid dark capsules (`rgba(18, 20, 26, 0.98)`), 350ms standard hover delay, and keyboard focus-visible support.

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
