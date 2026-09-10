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
  the sidebar bottom-left scan action (`#anomalous-scan-btn`) features a dedicated high-precision
  vector radar SVG (`SCAN_RADAR_ICON_SVG`) with GPU-accelerated continuous sweep animation (`.anomalous-radar-spinning`),
  completely decoupling from the settings modal's default layout reset button (`sidebarResetLayout: '📐 恢复默认窗口布局'`)
  to eliminate visual collision and disambiguate user mental models;
  the default UI and iconography architecture (Task 8 & Task 9) is upgraded to a complete pure-code vector SVG system
  (`SIDEBAR_ICONS`), replacing legacy native emojis across all navigation and action buttons (Assistant, Doctor,
  Settings, Models, Gallery, Recipes, Dock, Help, Folders) with `stroke="currentColor"` dynamic theme inheritance,
  while breaking square box layouts through asymmetric chamfered model cards (`border-radius: 4px 14px 4px 14px;`),
  spatial depth shadows (`0 4px 20px rgba(0,0,0,0.45)`), and zero-cost micro-abrasive radial lighting gradients on `#anomalous-container`;
  Task 9 final visual enhancements introduce sharp geometric diagonal chamfering to the main modal
  (`#anomalous-container` via `clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px)`
  and `#anomalous-modal` `filter: drop-shadow(0 20px 50px rgba(0,0,0,0.85))`), seamless docking fallbacks,
  dynamic vertical energy breathing dividers on `#anomalous-sidebar-wrapper::after`, subtle vector watermarks
  on empty sidebar zones (`#anomalous-sidebar-actions::before`), and a micro-floating capsule tooltip system
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
- `ui_materials.js` owns the Workspace Material Library and material CRUD presentation;
  features an integrated single-row Studio topbar with category micro-pills (`all`, `workflow`, `params`, `prompts`),
  unified search with tag filtering, grid/list view mode toggle (persisted to localStorage),
  and a seamless split-screen side studio panel (`.anomalous-material-side-studio`);
  cards feature strict uniform height (248px) with rich micro-skeuomorphic fallbacks for non-image assets (prompt code snippets
  and 3D asset parameter previews) eliminating visual bumpiness, direct inline title editing, one-click dock to Prompt Mixer (`🎛️`),
  floating quick actions, floating status toast feedback, and lazy DOM rendering; delegates image inspection to `ui_gallery_detail.js`;
  `node_material_actions.js` owns shared transactional node application and guarded undo;
  the library and Node Assistant use `ui_material_application.js` for the same receipt.
- `ui_prompt_composer.js` owns the Prompt Studio Dual-Column Workbench (提示词工坊左右双分栏工作台);
  replaces the cramped 380px drawer with a dedicated full-width two-column workspace (`.anomalous-prompt-workbench`),
  immersed with an ultra-subtle cybernetic circuit board overlay (`web/assets/cyber_deck_bg.webp`, `mix-blend-mode: overlay; opacity: 0.15; pointer-events: none`):
  the Left Column hosts the Ready-to-use Prompt Cards Library (成型提示词库), featuring restrained dark grey card backgrounds (`#222630`)
  with category-specific left accent borders (`border-left: 3.5px solid ...`, Base/Style/Subject/Trigger) eliminating color-palette clutter,
  empty state container (`.anomalous-source-empty`) featuring an atmospheric holographic library backdrop (`empty_library_concept.webp`),
  non-wrapping title layout, a dedicated sub-action bar with one-click canvas node prompt extraction (`🎯 从节点提取`, powered by subtle cybernetic matrix micro-textures `btn_cyber_grid.webp`,
  reading selected ComfyUI text nodes like `CLIPTextEncode` with downstream link connection traversal for accurate negative conditioning detection, auto-generating categorised cards) and one-click
  Material Library batch sync (`📥 从素材库导入`, cancellable fetch scoped to `category=prompts`), plus on-demand persistent card creation
  (`➕ 新建词卡`, with explicit positive/negative role radios and `/anomalous/save_prompt_plan` backend persistence; temporary cards
  show `[未保存]` badge with one-click `💾 存入库`), completely eliminating default empty textareas; cards support native HTML5 drag-and-drop;
  dragging cards activates a pulsing dashed accent summon border (`@keyframes anomalousTrackPulse`, `border: 2px dashed #2dd4bf`) on the Assembler Stage;
  the Right Column hosts the expanded Assembler & Arranger Stage (顺序编排调音台, `minmax(460px, 1fr)`), featuring quick node reading
  (`🎯 读取选中节点`), compact modular Lego block cards (~56px height, expandable on focus) allowing generous top-to-bottom sequence stacking,
  a high-visibility dropzone (`.anomalous-assembly-dropzone`) that ingests dragged cards into positive/negative tracks with strict role isolation,
  supports bidirectional drag-and-drop reordering with ghost indicator lines, role-aware up/down swapping, instant A/B bypass toggles (greyscale dimming without deleting),
  interactive category pills, one-click Smart Sort (`🪄 按分类排序`, Base ➔ Style ➔ Subject ➔ Trigger, enhanced with cyber micro-texture `btn_cyber_grid.webp`), a target widget dropdown with sticky
  selection cache (`targetWidgetIndexByNodeId`), and a sticky floating frosted-glass output deck (`.anomalous-mixer-deck-output`, `position: sticky; bottom: 0; backdrop-filter: blur(12px)`)
  with real-time word/token counts, single-mount canvas dragging (`bindMaterialDrag` onto text nodes), direct target node injection toolbar, and seamless return to Material Library;
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
