# 工作流配方专项审计与加固计划

状态：规划完成，尚未实施运行代码  
审计基线：`8b6128a` (`Keep native CLIP parameters together`)  
日期：2026-08-03  
范围：工作流配方的保存、更新、详情展示、画布动作、模型复现、版本历史、导入导出、Workspace/模型浏览器交互。

> 本文是下一轮实现模型的执行图纸，不代表下面列出的修复已经完成。`CHANGELOG.md` 不应记录本计划；实际代码变更仍需同步 `.agents/logs/ai_changelog.md`、必要时更新 `.agents/logs/ai_lessons.md` 和 `ARCHITECTURE.md`，并按阶段创建 Git 快照。

## 1. 结论先行

当前配方系统不是“完全没有保存成功”，而是存在三层数据被混用的问题：

1. `workflow` 是权威的完整 ComfyUI 序列化工作流；
2. `params` 是为了卡片、搜索、编辑和复现而生成的语义摘要；
3. 详情页为了显示完整值，会再从 `workflow.nodes[].widgets_values` 回读。

本机真实配方证明完整 `workflow` 基本保存成功，但 `params.nodes` 会按设计截断和限量，因此绝不能作为完整参数备份。当前最大的风险不在首次保存，而在“摘要编辑、画布更新、导入后模型匹配、历史资产恢复”这些二次操作。

实施顺序必须是：

```text
建立可验证的保存基线
  → 修复会改坏数据或错误匹配模型的 P0 问题
  → 统一跨组件状态和异步动作
  → 重做信息层级与交互细节
  → 优化列表载荷、封面和包传输
```

不要先继续堆 CSS。数据真值和动作状态没有稳定之前，UI 越丰富，错误入口越多。

## 2. 本次审计做了什么

### 2.1 阅读范围

- `web/modules/ui_recipes.js`
- `web/modules/ui_recipe_detail.js`
- `web/modules/recipe_parser.js`
- `web/modules/recipe_identity.js`
- `web/modules/recipe_actions.js`
- `web/modules/recipe_diff.js`
- `api/recipes.py`
- `api/recipe_packages.py`
- `api/models.py` 中 `/anomalous/resolve_hash`
- `web/styles.css` 中全部配方与 Workspace 相关样式
- `ARCHITECTURE.md`
- 现有三份配方规划文档

### 2.2 当前可运行检查

已通过：

- `python_embeded/python.exe -m py_compile api/recipes.py api/recipe_packages.py`
- `node --check`：`recipe_parser.js`、`recipe_actions.js`、`recipe_diff.js`、`recipe_identity.js`、`ui_recipes.js`、`ui_recipe_detail.js`
- `git diff --check`

当前 `tests/` 目录只有 `__pycache__`，没有可复用的源测试。也就是说，现有保存、更新、导入导出和画布动作主要依赖人工试用，无法证明回归安全。

### 2.3 本机真实配方只读核验

核验文件位于 ComfyUI 用户数据目录，不属于仓库：

`ComfyUI/user/workflows/anomalous_recipes/recipe_1785698011_b3501f2c.json`

结果：

| 项目 | 结果 |
| --- | --- |
| Schema | 4 |
| 文件大小 | 156,380 bytes |
| 工作流节点 / 连线 | 13 / 17 |
| `params.nodes` / `params.nodeCount` | 13 / 13 |
| 正面 / 负面提示词摘要 | 1 / 1 |
| 完整提示词长度 | 正面 236，负面 451 |
| 原生 `CLIPTextEncode` | 2 个，均存在于完整工作流和参数节点摘要 |
| 主模型、4 个 LoRA、采样摘要 | 与工作流对应值一致 |
| 模型引用 | 7 个；6 verified，1 unverified |
| 工作流指纹 | 存在有效 SHA-256 |
| 钉选参数 | 0，当前样本无法验证钉选参数往返 |

31 个摘要控件中有 30 个与完整工作流值完全一致。唯一不一致的是负面提示词：完整值 451 字，`params.nodes` 摘要为 320 字。这符合 `MAX_WIDGET_TEXT = 320` 的当前实现，但也证明摘要不能进入“无损编辑”链路。

列表接口目前只删除 `workflow`，仍返回大尺寸内嵌封面和完整 `params`。这份配方的列表记录约 144,541 bytes，是完整文件的 92.4%；其中封面 Data URL 约 135,431 字符。配方数量增长后会直接影响 Workspace 打开速度和内存占用。

## 3. 必须明确的数据真值契约

### 3.1 权威数据

- `recipe.workflow`：唯一可恢复画布的权威数据，保存与更新必须无损往返。
- `workflow_fingerprint`：只根据 canonical workflow 计算，用于证明工作流是否改变。
- 版本历史：保存更新前的完整 recipe 快照，不是仅保存摘要。

### 3.2 派生数据

- `params.baseModel`、`params.loras`、提示词、采样参数、分辨率：方便 UI 的语义索引。
- `params.nodes`：有明确上限的浏览摘要，不保证覆盖全部节点和完整长文本。
- `params.model_references`：模型引用、历史身份与可选快照描述；其中“保存身份”和“本机可用性”必须分开。

### 3.3 展示规则

- 卡片可以截断；详情必须从 `workflow` 读取完整安全值。
- 编辑器不得把 `params.nodes` 的截断值写回 `workflow`。
- Parameters 使用原生节点名和控件名；Overview 可以提供正负提示词等语义摘要。
- 当前机器的路径、预览和可用状态是临时状态，不能覆盖导入包携带的历史身份。

## 4. 风险清单

## P0-A：保存与编辑可能损坏参数

### A1. 长文本编辑使用截断摘要

`extractRecipeParameterChoicesFromMetadata(params)` 直接读取 `params.nodes[].widgets[].value`。超过 320 字的提示词已经被截断；从编辑弹窗修改或重新提交时，可能把截断内容当成原值。

修复方向：

- 新增从 `recipe.workflow` 解析完整控件值的 `extractRecipeEditableChoices(recipe)`；
- 节点 ID + widget index 是首选定位，名称/旧值匹配只用于旧数据兼容且必须拒绝歧义；
- 长提示词、重复值、同名控件必须有测试。

### A2. 画布更新会清空已有钉选参数

`showRecipeSaveDialog()` 的 `selection.pinnedKeys` 总是空集合。通过“载入画布编辑 → 更新当前配方”保存时，即使初始配方有 `params.pinned`，也不会预选，最终可能被清空。

修复方向：

- 初始化时从 `initial.params.pinned` 恢复 stable key；
- 如果节点 ID 发生变化，显示“钉选参数失效”而不是静默丢弃；
- 保存回执显示保留/失效/新增的钉选数量。

### A3. `params` 与 `workflow` 不是同一快照

当前先从 live graph 提取 metadata，等待用户完成保存弹窗后，再调用 `app.graph.serialize()`。通常弹窗阻止用户修改画布，但架构上没有保证二者来自同一个瞬时快照。

修复方向：

- 增加一个同步的 `captureRecipeDraft(graph)`；一次性得到 `workflow`、metadata、parameter choices 和结构统计；
- 保存弹窗只编辑 presentation/metadata 选择，不重新推导工作流；
- 若保存期间图发生变化，要求重新捕获或明确提示。

### A4. 后端只验证 `workflow` 是对象

空对象、重复节点 ID、畸形 links、异常 widgets 仍可能被保存或导入。

修复方向：

- 建立 bounded workflow validator：nodes/links/groups/reroutes 类型、节点 ID 唯一性、链接端点存在、JSON 深度与数量上限；
- 保存成功响应返回 fingerprint、节点数、连线数和参数摘要计数；
- 前端展示短暂但可核对的保存回执。

### A5. 缺失节点检查读取有上限的 `params.nodes`

`missingRecipeNodeTypes()` 当前依赖 `params.nodes`，超过 120 个节点时可能漏报。

修复方向：始终从 `recipe.workflow.nodes` 检查节点类型。

## P0-B：模型身份和其他组件之间存在逻辑冲突

### B1. `/resolve_hash` 先按文件名命中

`api/models.py::_resolve_from_candidates()` 当前先执行 filename 匹配。Recipe 的“匹配本地模型”也把保存路径作为 `filename` 传入。这违反 `ARCHITECTURE.md` 的身份边界：文件名、路径和相似名称不能证明是同一物理模型。

后果：同名但内容不同的模型可能被激活为“已匹配本地模型”。

修复方向：

- 从身份解析器移除 filename-first 分支；
- Recipe 显式匹配只传 hash、size 和受限 category；
- exact path 只用于“当前机器是否有这个原路径”和预览，不用于身份恢复；
- 增加同名不同 hash、相同大小多候选、跨类别、stale hash 的回归测试。

### B2. 导入时丢失包内模型身份

`_commit_import()` 先 normalise，再 `_enrich_recipe()`；后者重建 `params.model_references`，覆盖导入包携带的 SHA-256/size/provenance。之后 UI 可能只剩 filename，恰好又触发 B1 的错误匹配。

修复方向：

- 以 `(node_id, widget_index, category, saved_value)` 为 key 合并导入历史身份；
- 当前机器 availability 放临时 UI 字段，不覆写保存身份；
- `include_identity` 导出选项必须有 round-trip 测试，证明包含时保留、脱敏时确实删除。

## P0-C：版本和包资产不是真正闭环

### C1. 导出历史没有收集历史独有快照

导出只打包当前 recipe 引用的 assets；包含 history 时，历史 JSON 可能引用当前版本没有引用的 WebP，导入后历史快照丢失。

修复方向：导出资产集合必须是“当前版本 + 所选历史”的引用并集；manifest/checksum 同步覆盖。

### C2. 恢复历史会重新生成当前机器快照

restore 会 normalise/enrich，历史 reference 的 snapshot 描述被重建；如果开启保存快照，可能用当前模型预览生成新图，而不是恢复当时的 asset ID。

修复方向：恢复时保留历史 snapshot descriptor；只在明确“重新捕获快照”时生成新 asset。

### C3. 包携带 `source_image` 的本地 output 引用

导出包中的 `source_image` 是发送者本地输出路径。接收者可能不存在该文件，甚至恰好存在同名但无关文件。

修复方向：

- 包格式默认移除 `source_image`，只保留压缩后的 recipe cover；
- 若未来需要来源信息，存非可执行、非本地路径的描述字段；
- 导出 UI 明确展示隐私选项。

### C4. replace 导入不是完整事务

替换导入先覆盖 recipe，再移动 assets/history。后续资产步骤失败时，旧 assets 可能恢复，但 recipe 已被替换，产生 recipe/asset 不一致。

修复方向：recipe、assets、history 都先 staging；旧三者统一备份；全部验证成功后再一次 commit，失败全部回滚。

## P0-D：跨组件导航和异步状态没有统一生命周期

### D1. Recipe detail Promise 可能永远不 resolve

`showRecipeDetail()` 返回等待 `finish()` 的 Promise；切换到模型详情、关闭 Workspace 或 `showRecipes()` 直接移除 detail DOM 时，并不总会执行 finish。

修复方向：

- 引入明确的 recipe view controller：`list/detail/edit/navigating/closed`；
- 所有离开路径统一走 dispose/resolve；
- 取消预览请求、停止视频、恢复列表状态。

### D2. 从配方跳模型详情没有返回配方的路径

当前会清空 `owner.historyStack`，隐藏 Workspace，模型详情的返回按钮回到模型网格，不回到原 recipe/tab/scroll。

修复方向：保存一个轻量 navigation token：recipe filename、active tab、scrollTop；模型详情 Back 恢复 Workspace 和原位置。不要把完整 recipe DOM 长期藏在后台。

### D3. 异步按钮缺少统一 busy/失败状态

保存、导出、导入、版本恢复、可用性检查等使用分散的 disable/alert 逻辑；有的按钮可重复点击，有的失败只弹通用 alert。

修复方向：建立小型 `runRecipeAction(button, action, messages)`；负责 disabled、loading label、成功提示、错误详情、finally 恢复和重复提交保护。

## P1：UI 与交互重构

### 1. 配方卡片动作降噪

当前每张卡片同时放“详情、编辑、导出、打开、追加、删除”六个按钮。

推荐层级：

- 主操作：查看详情；
- 次操作：打开到画布；
- `…` 菜单：编辑、追加、导出、删除；
- 删除保持二次确认且与普通操作分区。

卡片只回答“这是什么”，不要展开所有节点参数。节点详情和完整 prompt 留到详情页，这也能减轻列表接口载荷。

### 2. 保存弹窗变成分步但单滚动的结构

建议区块：

1. 名称、标签、备注；
2. 封面来源；
3. 关键参数（搜索、按节点折叠、显示已选数量）；
4. 模型预览快照选项；
5. 保存前摘要：节点/连线/模型/提示词/钉选数量。

底部动作固定，支持 Escape 取消、焦点圈定、Enter 不误提交 textarea。保存失败不关闭弹窗，并显示后端返回的具体原因。

### 3. 详情页信息层级

- Overview：名称、封面、简短状态、模型组成、正负提示词、采样参数、主要动作；
- Models：每个引用独立卡片，身份/可用性/预览严格分开；
- Parameters：原生节点名 + 原生控件名，按语义组或画布顺序稳定排序，完整值可复制/展开；同名节点显示短 node ID 辅助区分；
- Versions：变更摘要优先，指纹放高级信息，恢复是危险操作；
- 记住当前 tab 和 scroll；刷新模型状态时不把整个 tab 滚回顶部。

### 4. 导出/导入改为真正的对话框

当前导出连续调用三个 `confirm()`，Cancel 实际表示“不包含”，用户没有清晰的“取消整个导出”。应改为一个对话框：

- 包含模型快照；
- 包含历史；
- 包含模型身份；
- 隐私说明和预计文件数；
- Cancel / Export 两个明确动作。

导入 inspect 对话框应显示：名称、schema、节点数、缺失节点、模型引用数、身份数、快照/历史数、冲突策略，并在 commit 前不改变本地库。

### 5. 反馈和可访问性

- 通用 alert 只保留灾难性错误；普通结果使用 Workspace 内 toast/status；
- 所有 icon button 有 aria-label；
- 对话框有 focus trap、Escape、恢复焦点；
- loading、disabled、missing、unverified 不只靠颜色；
- 680/560 px 下检查 header、模型卡、长文本和操作菜单。

## P2：性能和长期维护

### 1. 列表 API 真正轻量化

新增明确的 `recipe_card_summary`，只包含：

- filename、name、tags、notes 摘要、时间；
- 小尺寸 cover locator/thumbnail；
- base model basename、LoRA 数量、steps/CFG/resolution；
- 缺失/验证计数（可保存的静态摘要）。

不要返回 `params.nodes`、完整 prompts、完整 model references 或 135KB 的 720px Data URL。封面建议存 recipe-owned 320px WebP，并通过受控 endpoint 懒加载。

### 2. 视频封面内存边界

当前绑定视频会先在浏览器下载整个 blob 再截帧。应增加源大小/时长限制，优先后端从已验证 output 路径提取 bounded poster，失败时明确提示并保留用户选择。

### 3. 模块拆分

`ui_recipes.js` 与 `ui_recipe_detail.js` 都已超过 1,100 行。建议在行为稳定后拆分：

```text
recipe_capture.js          # 单次工作流捕获与保存回执比较
recipe_editing.js          # 完整值选择、钉选、参数更新
recipe_navigation.js       # Workspace/list/detail/model-return 生命周期
recipe_package_ui.js       # 导入导出对话框
ui_recipe_models.js        # 模型引用卡片
ui_recipe_parameters.js    # 原生参数渲染与搜索
```

拆分必须在回归测试之后进行，不能把“修 bug”和“大搬家”放在同一个提交。

## 5. 分阶段执行计划

## Phase 0 — 建立无损保存测试基线（只加测试/夹具）

新增本地私有测试（继续遵守仓库不发布 `tests/` 的约束）：

- `tests/recipe_fixtures/standard.json`
- `tests/recipe_fixtures/advanced_sampler.json`
- `tests/recipe_fixtures/third_party_widgets.json`
- `tests/recipe_fixtures/large_graph.json`
- `tests/test_recipe_roundtrip.py`
- `tests/test_recipe_packages.py`
- `tests/recipe_parser_roundtrip.mjs`
- `tests/recipe_actions_smoke.mjs`

退出条件：当前失败点被测试准确捕获，不先改实现让测试“看起来全绿”。

## Phase 1 — 修复保存、完整值编辑和钉选参数（P0-A）

任务：

1. 单次捕获 workflow + metadata；
2. 后端 bounded workflow validator；
3. 编辑选择读取完整 workflow 值；
4. 保留/迁移 pinned stable keys；
5. missing node 从 workflow 检查；
6. 保存返回并显示 integrity receipt。

退出条件：新建、metadata edit、parameter edit、canvas update、history restore 五条链路都通过深度相等/预期差异测试。

## Phase 2 — 修复身份、导入和历史资产（P0-B/P0-C）

任务：

1. 移除 filename 身份匹配；
2. 保留导入身份，分离 transient availability；
3. 历史快照 asset union；
4. restore 保留历史 asset ID；
5. export 移除本地 source_image；
6. replace import 全事务回滚。

退出条件：包在另一套空模型目录中导入后，身份仍可验证、路径不被误认、历史快照不丢失、失败不产生半导入状态。

## Phase 3 — 统一 Workspace/详情/模型导航状态（P0-D）

任务：

1. recipe view controller/dispose；
2. model detail 返回 recipe token；
3. 统一 async action runner；
4. tab/scroll 恢复；
5. 媒体和 fetch 取消。

退出条件：任意路径打开、返回、关闭、重开都没有悬挂 Promise、隐藏 DOM、重复请求或丢失返回位置。

## Phase 4 — UI 信息架构和交互打磨（P1）

按“卡片动作降噪 → 保存弹窗 → 详情 tab → 导入导出 dialog → accessibility/mobile”顺序逐项完成。每一步先截屏验收，不在同一提交里同时重写全部 CSS。

退出条件：用户可以明确回答“我正在看哪个配方、这个按钮会不会替换画布、保存了多少内容、模型是否只是同名、失败后下一步怎么办”。

## Phase 5 — 列表/封面性能与模块拆分（P2）

先测量 1/20/100/500 配方的列表 JSON、首屏时间、DOM 数量、图片内存，再决定分页或虚拟化。模块拆分作为最后阶段，保证每次搬迁都有行为测试保护。

## 6. 保存完整性验证矩阵

| 场景 | 必须验证 |
| --- | --- |
| 新建保存 | workflow 深度相等；fingerprint、node/link/group/reroute 数一致；语义摘要匹配 |
| metadata inline edit | workflow fingerprint 不变；名称/标签/备注改变；history +1 |
| 参数弹窗编辑 | 仅目标 node/widget slot 改变；长文本不截断；重复值不误改其他控件 |
| 载入画布后更新 | 结构变化进入新 fingerprint；原有 pinned 保留或明确失效 |
| 历史恢复 | 当前版本先归档；恢复 workflow 与历史完全一致；历史快照 ID 保留 |
| Open in Canvas | 缺失节点从完整 workflow 检测；用户画布确认后才替换；不排队 |
| Append | 原画布不变；ID/link remap 正确；失败完整回滚；subgraph/reroute 有明确禁用原因 |
| Export/Import | workflow/fingerprint/identity/assets/history 按选项往返；source path 不泄漏 |
| 模型匹配 | 只允许 hash/size/category；同名不同文件绝不激活 |

## 7. 必备测试夹具

- 标准 Checkpoint + 两个 `CLIPTextEncode` + KSampler；
- KSampler Advanced / SamplerCustom；
- Flux/SD3 的 Dual/Triple CLIP、UNET、VAE；
- 4+ LoRA、重复模型 basename、跨目录模型；
- 451 字和 3,000+ 字提示词；
- 两个控件拥有完全相同值；
- 第 121 个节点才是关键节点的大工作流；
- groups、reroutes、object links、subgraphs；
- 缺失自定义节点、缺失模型、同名错误模型、相同 size 多候选；
- 静态封面、视频 source、无封面、模型快照；
- package：无身份、带身份、带历史独有 assets、恶意 ZIP、替换失败回滚。

## 8. 每阶段提交与文档要求

每个 Phase 至少独立一个 Git 快照，禁止把以下内容混在一起：

- 数据修复与大规模 CSS 改版；
- 身份边界修复与模糊匹配新功能；
- package 事务修复与模块搬家；
- 测试夹具与无关产品功能。

每次运行代码变更：

1. 先运行对应自动化测试和静态检查；
2. 更新 `.agents/logs/ai_changelog.md`；
3. 有可复用教训时更新 `.agents/logs/ai_lessons.md`；
4. 更新 `ARCHITECTURE.md` 的真实边界；
5. 创建本地 Git commit；
6. 不修改用户发布用的 `CHANGELOG.md`，除非明确进入发布整理阶段。

当前工作树中用户已删除但尚未提交的两个旧计划文件：

- `.agents/plans/gpt_recipe_interaction_fix.md`
- `.agents/plans/gpt_recipe_ui_refactor.md`

后续实现不得擅自恢复或纳入其他阶段的提交。

## 9. 第一轮实现模型的明确起手式

下一轮不要从 UI 开始。按以下顺序行动：

1. 阅读本文、`ARCHITECTURE.md`、`recipe_parser.js`、`ui_recipes.js::handleSaveRecipe`、`api/recipes.py::_normalise_recipe/_enrich_recipe`；
2. 建立 standard/long-prompt/pinned/large-graph 四个最小夹具；
3. 写出当前会失败的测试：长 prompt 编辑、canvas update 保留 pinned、missing node >120；
4. 实施 Phase 1，保存一个新配方并 GET 回读，比较完整 workflow；
5. 仅在 Phase 1 全绿后进入模型身份和包传输；
6. UI 改版必须等 Phase 1–3 的状态契约稳定。

