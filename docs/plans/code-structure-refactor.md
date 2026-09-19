# 代码结构拆分计划（交给 GPT-5.6-sol）

日期：2026-09-17。代码基线：`29b14d2c7`。**状态：阶段 0–7 已完成；自动化验收通过，真实 ComfyUI 宿主视觉/交互验收仍需在运行中的宿主完成。**

用户当前优先级是整理代码结构，暂停其他 UI 美化与功能扩展。本文保留原实施任务单，并在末尾记录实际完成结果；当前架构以专题文档和代码为准。

## 1. 要达到的结果

将大文件按实际职责拆开，做到修改一个页面或一项行为时，不必理解整个浏览器。保留现有界面、操作、接口和用户数据。每完成一个可验证的小阶段就本地提交，继续下一阶段，不必逐项询问用户。

不是把大文件切成 `part1/part2`，也不是迁移到新框架。不得为拆分引入打包系统、事件总线、通用服务容器或新依赖。

阅读顺序：[AGENTS.md](../../AGENTS.md) → [架构入口](../../ARCHITECTURE.md) → 当前阶段对应的专题。不要每轮通读所有文档。本文的文件名是拟定归属，先搜索是否已有等价模块；存在时优先复用。

## 2. 当前规模与真正的拆分点

以下是含空行的物理行数，仅用于定位；执行时按函数和调用方搜索，不按固定行号切割。

| 文件 | 行数 | 主要问题 |
| --- | ---: | --- |
| `web/styles.css` | 14,620 | 多个页面、主题和响应式规则混在一起，层叠顺序容易被破坏 |
| `web/modules/ui_recipe_detail.js` | 3,348 | 总览、模型匹配、参数编辑、版本、图库集中在一个模块 |
| `web/modules/ui_sidebar.js` | 2,963 | `createDOM()` 约 2,250 行，包含扫描向导、设置、工具箱、导航和窗口交互 |
| `web/modules/ui_doctor.js` | 2,186 | 模型诊断、节点助手、替换图库、参数方案交叉放置 |
| `web/modules/ui_detail.js` | 1,938 | 模型详情、编辑弹窗、高级选择器合并 |
| `api/recipes.py` | 1,514 | 工作流规范化、身份信息、图片、文件存储、历史和 HTTP 路由混合 |
| `web/modules/ui_gallery_detail.js` | 1,453 | 图片工作台生命周期、媒体交互、参数检查与保存操作集中 |
| `web/main.js` / `api/models.py` | 各 1,413 | 前者注册、设置、实例、浮动入口耦合；后者目录、媒体、修改、匹配路由耦合 |
| `web/modules/ui_recipes.js` | 1,297 | 列表筛选、卡片、保存/编辑对话框与保存流程混合 |
| `api/materials.py` | 1,294 | 素材构建、提示词规则、资源存储、查询、路由混合 |
| `web/modules/ui_materials.js` | 1,186 | 目录、详情、节点选择监听、应用操作混合 |
| `web/modules/ui_notebooks.js` | 1,042 | 工作台返回、笔记目录、编辑器和节点创建混合 |

`locales.js` 为 2,373 行，主体是字典，不优先拆。已有提示词工坊、来源中控等模块虽然仍较大，已有明确边界，放到后续复核，避免第一轮同时动所有系统。

**已确认的耦合：**

- `main.js` 通过 `AnomalousBrowser.prototype` 接入各 UI 模块。首轮保留方法名、参数和 `this` 绑定，只调整导入归属；不要同时更换整个实例模式。
- `ui_sidebar.js` 的扫描状态、语言刷新、按钮和导航大量依赖 `createDOM()` 闭包。移动函数前必须列出它读取、修改的外部变量。
- `api/materials.py` 从 `recipes.py` 导入了 12 个名称；`parameters.py` 也导入其中的参数签名、读取与图库辅助函数。后端不能把每份文件单独移动后再补循环导入。
- `ui_gallery_detail.js` 有模块级 `wb` 和元数据缓存。它们不能在多个新文件各复制一份。
- `api/__init__.py` 目前用星号导入路由。最后接线时应改成明确的模块引用，防止移动后隐式导出丢失或名称覆盖。

## 3. 拆分时保持的边界

依赖方向采用现有结构：**宿主接线 → 页面协调与视图 → 领域逻辑/存储与已有公共工具**。纯逻辑不能反向导入页面，子视图不能导入 `main.js` 获取实例。

- 每项状态只保留一份。已有跨页返回状态先留在当前 owner；局部 DOM、请求和清理归所属视图。迁移状态和移动代码分开提交，避免难以区分故障来源。
- 为实际功能传入必要容器、数据和回调。若拆分需要几十个闭包参数，说明边界选错，应把相关状态和行为一起归入该功能模块。
- 模块接入时直接修改所有内部调用方。只有确有外部调用或兼容需求的入口才保留薄转接，不建立永久的重复实现。
- 同一阶段保持路由 URL、请求/响应结构、文件路径、字段、存储锁、撤销行为、节点连接与参数写入语义不变。不迁移用户数据。
- 复用 `ui_lifecycle.js`、`ui_dom.js`、`recipe_actions.js`、`recipe_parser.js`、`recipe_identity.js`、`node_material_actions.js` 等现有能力，不再复制一套。
- 普通逻辑模块通常以 200–600 行为参考。确有多个职责才继续拆，不能靠压缩代码、删注释或空壳包装达标。语言表和样式表不套这个阈值。
- 文件改放子目录时重新计算相对导入，特别是 ComfyUI 的 `scripts/app.js` 和图片 URL。导入无副作用的模块不应注册第二个扩展、启动扫描或立即创建页面。

## 4. 分阶段执行

每个阶段允许拆成几个提交；一个提交完成一个可验证的职责迁移。不要一次把以下所有文件建好再尝试运行。

### 阶段 0：建立本轮基线

1. 查看状态和最新差异，记录起始提交；保留他人的改动。
2. 为即将移动的职责记录：入口/调用方、读写状态、全局监听、请求、DOM/CSS 依赖、关闭路径。只写本阶段，不建立全仓超大清单。
3. 先运行本阶段已有的相关测试，记录已有失败。需要补测试时优先覆盖真实行为，而不是源码中是否存在某个字符串。
4. 记录相关页面的当前视觉和交互。后续比较必须使用同一主题、窗口尺寸和数据；不拿不同时期截图作基线。

### 阶段 1：先从侧栏移走独立功能

目标文件：`ui_sidebar.js`。第一刀选扫描向导，不先重写导航。

| 拟建模块 | 迁移范围与接口 |
| --- | --- |
| `ui_scan_wizard.js` | `createWizardModal()` 及其专属构建/扫描控制；接收全局或指定模型范围与完成回调，返回打开、关闭与语言刷新所需接口 |
| `ui_folder_manager.js` | `openFolderManager()` 与该对话框专属请求、DOM、关闭逻辑；原来的目录浏览 `renderSidebar/loadFolders` 暂时保留 |
| `ui_help.js` | `showHelp()` 及内容构建，仅在打开时创建所需内容 |

扫描进度继续使用 `scan_progress.js`，不能新增另一份“是否正在扫描”。若该状态也被全局按钮使用，明确由扫描功能拥有，按钮只读取/订阅实际状态。关闭向导是否取消扫描必须保持当前语义，不能把 UI 关闭误当成后台任务取消。

验收：扫描向导打开/关闭、单模型与全局入口、失败反馈、文件夹管理取消与保存刷新、帮助关闭。涉及扫描或写文件的验证优先使用隔离数据与桩服务，不自动扫描用户整个模型库。

### 阶段 2：收拢外壳和入口

在阶段 1 稳定后，从 `createDOM()` 提取：

- `ui_settings_hub.js`：设置中心与模型显示设置。接口覆盖 open/close/refreshLanguage，保留原来的设置来源、键名和生效时机。
- `ui_toolbox.js`：工具箱内容、开关和底部按钮装配；复用 `tool_registry.js`、`shortcut_layout.js`、`sidebar_actions.js`、`ui_shortcut_organizer.js`。按**当前代码**保持固定栏与工具过滤规则，不顺便实施旧计划中的另一种交互。
- `ui_browser_navigation.js`：主面板切换与返回协调。先收拢现有 `hideAllPanels/closeWorkspace` 相关调用，不引入新的路由系统；笔记模块最终不再独占其他工作台的公共关闭逻辑。
- 窗口拖动、缩放、停靠先保留在外壳；仍形成独立大段时再提取 `browser_window.js`，复用生命周期工具，不改变尺寸偏好。

`createDOM()` 最终只创建骨架、装配功能、连接明确回调。初始化完所有被引用的控件后再绑定/刷新语言，避免迁移后出现 TDZ 或读取尚未初始化的按钮。

随后整理 `main.js`：浏览器类与方法接线放到 `browser.js`，浮动入口放到 `browser_entry.js`，设置描述与语言/主题应用放到 `interface_settings.js`。扩展注册、实例创建顺序和宿主钩子仍由 `main.js` 统一协调。设置模块通过参数/回调工作，不能反向导入 main；保留被其他模块调用的现有全局入口，先核实调用者再删除。

验收：首次打开、关闭重开、各主页面切换、配方→模型详情→配方、语言切换、设置保存、工具箱提示、停靠、窗口拖动与调整尺寸。确认只有一个浏览器实例和一份全局监听。

### 阶段 3：拆配方详情，再拆目录

`ui_recipe_detail.js` 留下 `showRecipeDetail()`、活动页签、一次详情会话的状态与生命周期协调。按下面顺序逐块移动：

1. `ui_recipe_versions.js`：`renderVersions/renderDiffPanel`。继续用 `recipe_diff.js`；恢复版本后的刷新由明确回调交回详情协调器。
2. `ui_recipe_gallery.js`：`renderRecipeGallery/showGalleryComparison` 及专属资源处理；图片详情打开通过回调或直接依赖现有图片工作台入口，不能绕素材目录模块中转。
3. `recipe_model_matching.js` + `ui_recipe_models.js`：前者负责匹配操作与结果，后者负责组成卡片、来源编辑和本地匹配操作界面；复用身份规则，不能从名称/预览图推断同一模型。
4. `recipe_parameter_data.js` + `ui_recipe_parameters.js`：先移出 `parameterNodeOrder/topologicalSortNodes/parseEditorValue/paramsWithPromptRole` 等无 DOM 逻辑，再移参数方案 UI。较大的原始节点检查与编辑器可分别放 `ui_recipe_node_inspector.js`、`ui_recipe_parameter_editor.js`。
5. `ui_recipe_overview.js`：总览与元数据编辑，参数正文读取继续遵循真实工作流，不改用列表摘要。

不要把所有小函数扔进 `recipe_detail_utils.js`。格式化工具仅在确有多个调用者时共享；请求成功后的刷新由协调器处理，不让子页互相直接调用重绘。

接着将 `ui_recipes.js` 的 `showRecipeSaveDialog/showRecipeEditDialog` 放到 `ui_recipe_dialogs.js`，卡片渲染放 `ui_recipe_cards.js`；列表查询、筛选、分页与页面状态留在目录模块。`handleSaveRecipe` 继续协调实际捕获和保存，不能在新对话框中复制该流程。

验收：配方筛选与详情、长提示词、原始参数、参数方案保存再读回、模型详情往返、历史比较/恢复、图库打开/关闭。配方包导入导出保持当前关闭状态，移除的入口不恢复。

### 阶段 4：拆其余混合页面

逐行执行下表，每行独立提交与验证，禁止把全部页面同时改成半成品。

| 当前文件 | 拟定归属 | 重点验证 |
| --- | --- | --- |
| `ui_doctor.js` | 保留诊断面板和全局扫描；节点助手到 `ui_node_assistant.js`；`_openGalleryReplacer` 到 `ui_node_model_picker.js`；参数方案卡片与预览到 `ui_node_presets.js` | 哈希依据不变；替换正确节点；取消无写入；助手历史可用 |
| `ui_detail.js` | 保留 `showDetail`；`showEditModal` 到 `ui_model_editor.js`；`_openAdvancedModelSelector` 到 `ui_model_selector.js` | 详情往返、编辑保存、选择器取消、原节点与路径不串 |
| `ui_gallery_detail.js` | 保留工作台打开/关闭与唯一 `wb`；舞台缩放/胶片栏到 `ui_image_stage.js`；参数、提示词、模型与节点检查到 `ui_image_inspector.js` | 快速换图无旧结果覆盖；关闭释放媒体与请求；选中块保存准确 |
| `ui_materials.js` | 保留目录与分页；详情到 `ui_material_detail.js`；卡片到 `ui_material_cards.js`；应用和选择监听尽量归入已有 `ui_material_application.js` | 素材拖放仍整体替换；节点身份复核；详情读正文；翻页与筛选不丢 |
| `ui_notebooks.js` | 保留笔记目录与保存协调；编辑器到 `ui_notebook_editor.js`；画布创建到 `notebook_canvas.js`；公共返回已归阶段 2 | 保存队列和重开不丢内容；正负提示词隔离；节点创建与连接不变 |

图片元数据缓存可以留在协调模块，缓存上限和失效规则保持不变。需要跨模块使用时暴露窄访问接口，不复制缓存，不把 `wb` 作为可随意修改的全局对象导出。

### 阶段 5：样式独立拆分，不同时重新设计

保留 `web/styles.css` 作为外部入口。先核对 `main.js` 的 CSS 加载逻辑，再把样式拆到 `web/styles/` 下的基础控件、外壳、模型、图库、配方、素材、提示词、工具与主题等文件。

**首先保证原始层叠顺序。** 不能按关键词把分散的同名选择器直接合并搬走。先记录规则顺序与主题/媒体条件；需要时按连续职责块分两步迁移，稳定后再清理重复声明。混合多个领域的选择器先归公共部分，未经确认不拆成几个不同位置的规则。

低风险方案是入口顶部有序 `@import`。若使用多 link，也必须只有一份确定顺序的清单，并保留防重复加载。二选一，不能双重加载。不要引入 CSS cascade layers，因为它会改变已有优先级。

迁移时检查相对 `url(...)` 资源路径、`@keyframes`、主题限定、媒体查询和插件作用域；子样式的缓存刷新也要验证，不能只刷新入口版本。检查网络中是否缺文件、串行请求造成明显闪烁。没有测试依据，不顺便做按页面动态加载。

验收：同条件截图/关键计算样式对比，普通主题与深海血族、普通窗口与停靠、浮层层级、文件夹隐藏/恢复、提示定位、拖放与键盘焦点。此阶段不换配色、间距、动画或 DOM 结构。

### 阶段 6：先拆后端共享领域，再移动路由

先读 [后端专题](../architecture/backend.md)、[配方专题](../architecture/recipes.md)、[素材专题](../architecture/material-library.md)。

1. 从 `recipes.py` 提取 `workflow_schema.py`：工作流校验、指纹、参数签名、易变字段规则等纯计算。确属配方专有的规范化放 `recipe_schema.py`；不要把文件路径和 HTTP request 带入纯逻辑。
2. 提取 `recipe_store.py`：目录、读取、写入与历史操作；提取 `recipe_images.py`：来源图片验证、读取与封面处理。路径授权仍调用现有安全工具，I/O 仍放到原来的工作线程边界。
3. 同步改 `materials.py`、`parameters.py` 和 `recipe_packages.py` 的调用。后者目前是 `from . import recipes as recipe_store`，这个别名指向旧路由模块，不是拟建的存储模块。逐项检查其 `recipe_store.xxx` 访问，不能只搜索导入行或直接把别名换成新文件。
4. 路由模块依赖领域与存储模块，领域模块不得反向导入路由。锁和缓存只保留在实际拥有者中，同一类写入不能因拆文件变成两把独立锁。
5. `api/recipes.py` 最终保留 HTTP 参数解析、错误/状态码映射、调用和响应。不要为了“薄路由”把整个旧文件原封不动搬进另一个 1,500 行的 service。

随后拆 `api/models.py`：目录查询/列表、身份解析、元数据修改、媒体与封面分别归入 `model_catalog.py`、`model_resolution.py`、`model_metadata.py`、`model_media.py`。先按现有端点边界移动，公共路径与类别规则继续复用 `utils.py` 和根目录的 `model_policies.py/model_identity.py`。保留跨目录回退和受保护类别规则。

最后拆 `api/materials.py`：`material_schema.py` 负责构建与提示词规范化，`material_store.py` 负责记录及资源生命周期，路由模块负责请求响应和有界查询。若存储模块仍大，再将图片资产操作独立成 `material_assets.py`，不预先造空模块。

`api/__init__.py` 改成明确的模块引用和注册，例如 `from . import models`、`models.api_get_models`；比较拆分前后的 **HTTP method + path** 清单，避免少注册、多注册或重复注册。用户设置和导入导出 gate 保持不变。

验收全部使用临时目录与隔离配置：保存/读取往返、非法路径拒绝、失败保留旧文件、历史恢复、素材分页过滤、修改封面/元数据、禁用导入导出的 503。不能通过删除或覆盖用户真实数据测试。

### 阶段 7：收尾与剩余热点复核

- 再统计大文件，按职责复核 `ui_prompt_workbench.js`、`ui_prompt_source_deck.js`、`ui_model_sources.js`、`material_inspector.js` 和 `api/utils.py`。有独立职责才继续拆，并记录边界；不能仅因超过阈值机械拆分。
- 复核导入环、无人调用的旧导出、遗留重复实现和 `EXTRACTED` 占位。不要用任意 optional chaining 或空 catch 掩盖断掉的接线。
- 更新实际发生变化的架构专题与入口所有者列表。此时删除过时说明，不能把本文的拟定方案提前复制成已实现架构。
- 本计划逐阶段补充提交号、验证和剩余事项；发生中断时，下一轮从这里继续，不重新扫描整个仓库。

## 5. 验证与效率要求

每阶段先做 JS 语法/模块链接或 Python 编译/导入检查，再跑相关行为测试。涉及界面和宿主行为时还需真实 ComfyUI 验证，语法通过不能代替点击路径。移动模块后更新测试入口，尽量加载实际模块，不把待测行为本身 mock 成成功。

当前存在的定向检查（从插件根目录运行）。下表每个 JS 文件分别用 `node --experimental-vm-modules <文件路径>` 执行；此处参数表示替换成表内实际路径，不是一次执行整表：

| 影响范围 | 现有检查 |
| --- | --- |
| 外壳/快捷栏 | `tests/shortcut_layout.mjs`、`tests/shortcut_organizer.mjs`、`tests/update_guide.mjs` |
| 素材与节点应用 | `tests/material_workspace_flow.mjs`、`tests/studio_contracts.mjs` |
| 笔记 | `tests/notebook_render_test.mjs`、`tests/notebook_save_roundtrip.mjs` |
| 提示词工坊/读取 | `tests/prompt_ui_lifecycle.mjs`、`tests/prompt_material_source.mjs`、`tests/prompt_library_sync.mjs` |
| 模型来源 | `tests/model_sources_hub.mjs` |
| 导出 gate | `tests/export_availability.mjs`；Python 用便携环境执行 `python -B tests/test_export_availability.py` |

表中测试存在不等于本轮已经通过。配方详情、模型编辑、扫描向导、后端存储等未被这些测试充分覆盖的路径，需要有针对性地补行为验证，不能拿无关测试通过数充当覆盖。

新增测试先核对 `.gitignore`，必须明确哪些随仓库交付。每次只跑受影响的集合；阶段完成后不重复跑同一组，除非又改了代码或发现新问题。

完成标准：原调用方都接入新归属；原文件没有第二份实现；关键行为验证通过；入口和返回仍可用；无新增持续轮询、全量数据加载或监听泄漏。行数下降本身不是验收标准。

## 6. 交给 GPT-5.6-sol 的启动指令

> 请按 docs/plans/code-structure-refactor.md 整理 Anomalous_Model_Browser 的代码结构。先读 AGENTS.md 和相关架构专题，确认最新差异，从阶段 0、阶段 1 开始，然后按依赖顺序继续。保留现有外观、功能、数据和接口，不顺手美化，不恢复已关闭或移除的功能。
>
> 每次完成一个职责迁移，检查调用方、状态归属、闭包依赖和关闭路径，运行相关验证后本地提交，再继续。常规实现选择自行处理；遇到已有故障先区分基线与回归，不能隐藏或伪造成功。不要把所有文件一次拆完才验证。
>
> 每阶段在计划中记录实际模块归属、提交号、验证结果与未完成项。需要中断时留下可接续状态；不推送远端。最终说明职责如何变清楚、哪些行为已验证，以及还有哪些真实限制。

## 执行记录

- 阶段 0（完成）：以 `c39701773` 为本轮起点，开工时工作区干净。基线通过
  `shortcut_layout.mjs`、`shortcut_organizer.mjs`、`update_guide.mjs`；未建立真实
  ComfyUI 点击截图基线，因此后续不能把 DOM 模拟检查称为宿主视觉验收。
- 阶段 1（完成，`2a53e3edf`）：扫描向导归 `ui_scan_wizard.js`，文件夹管理归
  `ui_folder_manager.js`，帮助弹窗归 `ui_help.js`。单模型卡片与全局扫描入口共用
  `openScanWizard()`；新增行为检查覆盖帮助关闭、文件夹取消/保存刷新、单模型扫描请求
  与向导关闭不取消后台扫描。
- 阶段 2（代码拆分完成，`1e42033ac`、`67d5be6277`、`a984ee4a31`）：设置中心与模型卡显示设置归
  `ui_settings_hub.js`，工具目录、固定快捷栏和工具分派归 `ui_toolbox.js`，公共面板
  隐藏/配方详情清理归 `ui_browser_navigation.js`。`ui_sidebar.js` 已从约 2,963 行降至
  约 780 行，`createDOM()` 现在主要保留外壳、顶部导航、窗口交互和子模块装配。
  浏览器类和方法装配归 `browser.js`，浮动/顶栏/菜单入口及唯一实例归
  `browser_entry.js`，语言和主题设置归 `interface_settings.js`；`main.js` 现只协调
  扩展注册与宿主钩子。笔记、配方和素材共用的工作区返回协调也已迁入
  `ui_browser_navigation.js`。新增模块边界测试覆盖注册描述、入口设置、语言、主题与
  工作区恢复；真实 ComfyUI 拖动、停靠与窗口缩放仍待宿主验收。
- 阶段 3（代码拆分完成，`d8691d881`、`413b876dfe`、`56774a2d99`、`881570e887`、`e5f3301971`）：配方版本历史/差异/恢复归
  `ui_recipe_versions.js`，结果图库与图片工作台跳转归 `ui_recipe_gallery.js`，跨子页
  共用的 DOM、长值展示和复制控件归 `ui_recipe_detail_dom.js`。删除了无人调用的旧图库
  对比实现；图库不再借道素材目录模块打开图片工作台。目录筛选归
  `ui_recipe_catalog.js`，卡片与拖拽归 `ui_recipe_cards.js`，保存/编辑对话框归
  `ui_recipe_dialogs.js`，封面媒体归 `ui_recipe_media.js`；模型预览、匹配与显式替换归
  `ui_recipe_model_matching.js`，总览归 `ui_recipe_overview.js`，提示词角色、参数编辑、原始节点与
  参数预设归 `ui_recipe_parameters.js`，内联持久化归 `ui_recipe_metadata.js`。协调器
  `ui_recipe_detail.js` 从约 2,983 行降至约 760 行，`ui_recipes.js` 从约 1,297 行降至约
  690 行。新增检查覆盖版本恢复、图库交接、目录卡片隔离、模型替换持久化、参数拓扑/解析、
  总览和提示词提取；真实 ComfyUI 视觉与交互仍待宿主验收。
- 阶段 4（完成，`e6217bb557`、`12875f9053`、`3e3e26d2b2`、`2951d610c5`、`7afa7518bc`）：
  模型诊断保留诊断、全局扫描和哈希协调，助手、原生控件选择器、参数方案分别归
  `ui_node_assistant.js`、`ui_node_model_picker.js`、`ui_node_presets.js`。模型详情保留展示协调，
  编辑器与高级选择器归 `ui_model_editor.js`、`ui_model_selector.js`。图片工作台仍唯一持有 `wb`
  和元数据缓存，舞台/缩放/胶片条归 `ui_image_stage.js`，检查器标签归 `ui_image_inspector.js`。
  素材目录、卡片、详情与节点应用/监听分别归 `ui_materials.js`、`ui_material_cards.js`、
  `ui_material_detail.js`、`ui_material_application.js`。笔记目录与保存留在 `ui_notebooks.js`，
  编辑器归 `ui_notebook_editor.js`，画布节点创建归 `notebook_canvas.js`。新增边界与行为检查覆盖
  以上接线、监听器清理、控件路径、素材应用和笔记保存队列；真实 ComfyUI 视觉仍待宿主验收。
- 阶段 5（完成，`e8b50ecaf5`）：`web/styles.css` 保留为唯一外部入口，并按原始字节顺序有序导入
  `web/styles/00-foundation-models.css` 至 `10-model-sources.css`。所有子样式带同一缓存版本；
  `css_bundle_order.mjs` 校验导入唯一/有序，且子文件拼接 SHA-256 与拆分前完全一致
  (`d014a9d1826e2c48a46ac72389fe4e5bdd0b2ba85618f653d13852cd93812bc1`)。
  未引入 cascade layer、动态加载或视觉改版；真实主题、停靠和浮层对比仍需宿主验收。
- 阶段 6（完成，`6ad975c1cd`、`9cebdbd994`、`a0c6849878`）：配方的工作流规则、配方规范化、
  图片和存储分别归 `workflow_schema.py`、`recipe_schema.py`、`recipe_images.py`、`recipe_store.py`；
  模型目录、身份解析、元数据写入和媒体归 `model_catalog.py`、`model_resolution.py`、
  `model_metadata.py`、`model_media.py`；素材规范化、资产和单一锁/缓存存储归
  `material_schema.py`、`material_assets.py`、`material_store.py`。路由入口改为显式模块注册，
  `test_route_manifest.py` 固定 68 个 method/path 对。兼容门面仅保留历史内部测试/调用点，不复制状态。
- 阶段 7（完成，`a63a615514`）：复核后保留 `ui_prompt_workbench.js` 与
  `ui_prompt_source_deck.js` 的单工厂闭包边界，避免拆出大量可变状态参数；`ui_model_sources.js`
  仍是模型来源这一项功能的查询/编辑/持久化协调器；`material_inspector.js` 仍聚焦共享元数据与
  节点参数检查。发现 `api/utils.py` 确有五类独立职责，已拆为 `path_utils.py`、
  `media_routes.py`、`translation_routes.py`、`gallery_routes.py`、`folder_types.py`，原文件仅作兼容导出。
  Python/JavaScript 相对导入图均无环，未发现 `EXTRACTED`/待提取占位或旧模型/配方/素材星号路由导入。
  最终通过全部 29 个 `.mjs` 检查、89 个 Python `unittest`、全量 `api/*.py` 编译和路由清单检查。
  本轮未连接运行中的 ComfyUI，因此不声称已完成真实拖放、停靠、主题、媒体释放和点击路径视觉验收。
