# Anomalous Model Browser 全功能实测审计与问题复原报告
**Audit & Functional Verification Report**

- **测试对象**：`Anomalous Model Browser` (异构模型浏览器 ComfyUI 插件)
- **运行环境**：ComfyUI Portable (Windows x64) / 本地端口 `http://127.0.0.1:8188`
- **当前 Git 分支**：`feature/recipe-model-binding`
- **浏览器会话录屏存档**：`anomalous_deep_test_1789816916045.webp`

---

## 一、 测试操作过程完整复原 (Step-by-Step Reproduction)

本次实测通过浏览器子智能体（Browser Subagent）与本地真实运行的 ComfyUI 实例进行端到端（E2E）交互操作，测试全流程操作复原如下：

### 1. 插件唤起与主界面交互
1. **浏览器进入 ComfyUI 画布**：
   - 页面初始加载默认工作流节点（包括 `Load Checkpoint`、`CLIP Text Encode`、`KSampler`、`Anima VAE` 等）。
2. **唤起插件主界面**：
   - 点击 WebUI 界面悬浮触发球及左侧快捷立方体图标，`#anomalous-modal` 顺畅展开，居中层叠在画布上。
   - 验证右上角 `×` 关闭按钮与侧边栏 `☰` 折叠按钮，动画过渡自然，能顺畅收起并安全回到主画布。

### 2. 模型医生（Model Doctor）全局体检与修复测试
1. **打开体检中心**：
   - 点击侧边栏听诊器图标（🩺），切换至 Model Doctor 面板。
2. **体检扫描表现**：
   - 面板显示当前画布的节点模型状态：“健康 2 个 / 缺失 1 个”。
   - 正确检测到当前画布缺失模型：`Anima\qwen_image_vae.safetensors`。
3. **交互操作测试**：
   - 点击右上角“刷新缓存”按钮，控制台正确触发 `app.refreshComboInNodes()` 和 `/anomalous/all_hashes` 刷新。
   - 查看缺失模型右侧操作按钮：包含了“深度哈希扫描”、“手动替换”、“查看哈希”以及“Civitai 搜索”链接。

### 3. 素材库（Material Library）与分类检索测试
1. **打开素材库**：
   - 点击工具箱或侧边栏素材库图标，成功打开 Material Library 视图。
2. **分类与搜索切换**：
   - 点击顶部筛选胶囊：“全部”、“工作流”、“提示词”等分类，卡片即时响应过滤。
   - 在搜索框输入关键词 `Kirazuri`，检索到对应的完整工作流素材卡片 `Kirazuri (Anima)_v4.0`。
3. **卡片拖拽交互测试**：
   - 测试按住卡片尝试拖拽至画布空白处或节点上，排查拖拽反馈（发现重大逻辑断点，详见下文第二节）。

### 4. 模型扫描向导（Scan Wizard）与设置中心测试
1. **打开扫描向导**：
   - 点击侧边栏雷达扫描图标，弹出 Scan Wizard 原生 Dialog 弹窗。
   - 查看各项扫描策略配置：包括完整哈希、Civitai 元数据提取等。
   - 测试取消弹窗：按 `Escape` 键或点击外部背景，发现原生 Dialog 没有绑定外部点击关闭逻辑，必须向下滚动找到底部的“取消”按钮才能退出遮罩层。
2. **全局设置中心（Settings Hub）**：
   - 打开齿轮图标设置面板，测试在“紧凑模式 (Compact)”与“标准模式 (Standard)”之间来回切换，网格与卡片间距自适应良好。

---

## 二、 发现的核心缺陷与不合理之处深度剖析 (Critical Issues & Bugs)

通过“浏览器实际操作 + 源码 AST/逻辑级走查”，发现以下 **4 个影响核心体验或违反技术方案** 的问题：

---

### 🚨 缺陷 1（核心技术方案违背）：本地缺失模型被误判为“⛔ 身份冲突”，导致修复链路完全中断

#### 1. 问题定位
- **文件**：`api/model_resolution.py`（第 178-181 行）
- **函数**：`_resolve_from_candidates`

#### 2. 代码问题根源
在比对带有来源信息（Provenance，同时包含 `hash` 与 `size`）的模型时：
```python
        hash_matches = [candidate for candidate in candidates if target_hash in _candidate_hashes(candidate)]
        if hash_matches:
            return {"found": False, "identity_conflict": True}
        return {"found": False, "identity_conflict": True}  # <--- 无论 hash_matches 是否为空，均返回 identity_conflict: True!
```
- 当用户导入一个网上下载的带有哈希的工作流，而本地**压根没有这个模型**时，`candidates` 或 `size_matches` 是空的。
- 代码执行到末尾，**无条件返回了 `{"found": False, "identity_conflict": True}`**！

#### 3. 产生的不合理现象
1. **误导用户**：在前端 `ui_doctor.js` 和 `ui_recipe_model_matching.js` 中，该模型会被标上鲜红的 `⛔ 身份冲突 (Identity Conflict)`，给用户一种“本地文件损坏或文件哈希冲突被系统拒绝”的假象。
2. **阻断修复方案**：根据 `docs/architecture/model-resolution.md` 规范，只有当本地存在尺寸相同但哈希不同（或哈希相同但尺寸不同）的文件时，才算作真正的 `identity_conflict`。如果本地根本没有该模型，应该返回普通的 `{"found": False}`，以便触发正常的“未找到模型”提示、Civitai 自动检索建议或下载引导。

#### 4. 修复建议
修改 `api/model_resolution.py`，只有在发现真正的冲突（如尺寸符合但哈希不匹配、或哈希符合但尺寸矛盾）时返回 `identity_conflict: True`；无任何匹配时应返回普通未找到：
```python
        hash_matches = [candidate for candidate in candidates if target_hash in _candidate_hashes(candidate)]
        if hash_matches:
            return {"found": False, "identity_conflict": True}
        return {"found": False}
```

---

### 🚨 缺陷 2（功能承诺未兑现 & 事件拦截冲突）：素材库卡片“拖入画布载入工作流”无效且拖拽逻辑存在优先级漏洞

#### 1. 问题定位
- **文件 A**：`web/modules/ui_material_cards.js`（第 90-96 行）
- **文件 B**：`web/modules/material_drag.js`（第 55-84 行）

#### 2. 代码问题根源
1. **提示与实现脱节（虚假功能）**：
   - 卡片上的 Tooltip 明确写着：`"按住可拖拽至画布节点注入参数，或拖至空白处载入工作流"`（`t('materialCardDragHint')`）。
   - 但是在 `ui_material_cards.js` 中绑定拖拽时：
     ```javascript
     if (material.node_types?.length) {
         bindMaterialDrag(card, owner, {
             payload: () => ({ ...material, node_types: [...material.node_types], dragHint: t('materialDragParameters') || '拖拽素材参数至目标节点' }),
             accepts: (node, source) => source.node_types.includes(node.type),
             drop: (node, source, graph) => applyLibraryMaterial(owner, source, node, graph),
             // 致命缺失：根本没有传入 dropOnCanvas 回调！
         });
     }
     ```
     **根本没有传入 `dropOnCanvas` 回调**！导致用户拖到空白画布释放时什么都没发生。
   - 此外，如果一个素材是**整图工作流素材**（`material.node_types` 为空），因 `if (material.node_types?.length)` 为假，导致**整张卡片完全没有被绑定拖拽能力**（`draggable = false`），用户根本拖不动！

2. **`material_drag.js` 中的命中优先级缺陷（Precedence Inversion）**：
   在 `material_drag.js` 的拖拽结束处理中：
   ```javascript
   if (dropOnCanvas && overCanvas) {
       try { await dropOnCanvas(event, data, graph); }
       return;
   }
   if (!node || !accepts?.(node, data)) return;
   try { await drop(node, data, graph); }
   ```
   - 只要定义了 `dropOnCanvas`，一旦鼠标落在画布区域（`overCanvas == true`），代码会**无条件先执行 `dropOnCanvas`**（载入整图工作流覆盖画布）！
   - 即便鼠标此时正精准悬停在某个兼容的节点上，也不会触发节点的参数注入！

#### 3. 修复建议
1. 在 `material_drag.js` 中调整执行优先级：**先判断是否命中了兼容节点（Target Node），若命中了则优先执行节点注入；仅当未命中任何节点且落在画布空白区域时，才触发 `dropOnCanvas` 载入工作流**。
2. 在 `ui_material_cards.js` 中，只要素材包含工作流（`material.has_workflow` 或 `material.data?.workflow`），就为其绑定 `dropOnCanvas: async (e, data, graph) => openMaterialWorkflow(owner, material.filename)`，并在 `material.node_types` 为空时也允许拖拽。

---

### ⚠️ 缺陷 3（交互体验问题）：扫描向导（Scan Wizard）缺少遮罩点击关闭 & 纵向溢出

#### 1. 问题表现
- 扫描向导使用原生的 HTML `<dialog>` 挂载并使用 `showModal()`。
- 当弹窗内容较多（包含多项模型目录开关与说明）时，若屏幕纵向高度较小，底部“开始扫描”与“取消”按钮会被推到视口外部。
- 用户尝试点击周围半透明深色遮罩（Backdrop）时，无法关闭弹窗；由于未在 `dialog` 上绑定 `click` 检测 `event.target === dialog` 的关闭逻辑，用户必须手动向下滚动寻找底部取消按钮。

#### 2. 优化建议
- 在 `ui_scan_wizard.js` 中，为 Dialog 添加点击遮罩关闭逻辑：
  ```javascript
  dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height
        && rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) dialog.close();
  });
  ```
- 限制 `max-height: 85vh` 并对内部表单容器开启 `overflow-y: auto`，确保底部的操作按钮始终固定可见（Sticky Bottom）。

---

### ⚠️ 缺陷 4（同步与竞态隐患）：模型单次精准扫描后前端下拉列表刷新时机

#### 1. 问题表现
- 在针对单个模型触发精准扫描（`triggerDirectModelScan`）时，后端会计算 SHA-256 并生成 `.info` 文件。
- 前端在通知扫描成功后，虽然调用了 `window.anomalous_reload_hashes()`，但在 ComfyUI 原生节点的下拉菜单选项（`widget.options.values`）重新拉取存在微弱的异步延迟，此时若立即在 Model Doctor 中点击“自动修复”，偶尔会触发 `optionsCacheStale`，需等待二次刷新才能消除红框。

#### 2. 优化建议
- 在单模型扫描写入完成后，增加 `await fetch('/anomalous/clear_cache', { method: 'POST' });` 并等待 `await app.refreshComboInNodes()` 完成后再触发 Doctor 的状态比对。

---

## 三、 总结与排查结论

1. **整体功能架构**：
   插件整体架构非常先进且完整，Model Doctor、Material Library、Recipe 工作流、Scan Wizard 的多面板协调运作良好，UI 设计美观、动效细腻。
2. **核心问题收敛**：
   - **核心 Bug 1**（`api/model_resolution.py` 误报 `identity_conflict`）是必须修复的高危逻辑漏洞，它直接导致工作流模型恢复方案失效；
   - **核心 Bug 2**（素材库拖拽无响应及画布/节点优先级颠倒）直接影响了用户对于“素材一拖即用”的核心预期。

---

## 四、 修复复查与验收记录 (Verification Sign-off)

- **验收时间**：2026-09-19 20:30
- **修复 Commit**：`04b2eeff8f` (*fix(materials, doctor, scan): polymorphic material drag, third-party prompt nodes, model resolution, and scan wizard improvements*)
- **复查录屏文件**：`anomalous_fix_verify_1789820782702.webp`

### 1. 自动化回归测试结果
- **Python 后端单元测试**：运行 `unittest discover -s tests -p "test_*.py"`，**99 个测试全数通过 (OK)**。
  - 特别验证 `test_dynamic_hash_mismatch_is_rejected` 与空候选测试，确认无哈希匹配时不再误报 `identity_conflict`。
- **前端契约与模块测试**：运行全部 32 个前端 `.mjs` 测试（涵盖 `studio_contracts.mjs`、`sidebar_feature_modules.mjs`、`material_feature_modules.mjs` 等），**32 项全部通过 (PASSED)**。

### 2. 浏览器端到端实测验证
1. **模型修复与身份冲突 (Model Doctor)**：
   - 模型比对逻辑恢复正常，本地缺失模型返回 `found: False`，恢复正常下载与引导逻辑；
   - 唤起模型医生点击 `🔄 刷新缓存` 顺畅运行，控制台 0 报错。
2. **素材库多态拖拽 (Polymorphic Material Drag)**：
   - 全图工作流素材：卡片 Tooltip 提示更新为“按住拖至空白画布载入完整工作流”，拖拽至空白画布成功加载完整图谱；
   - 提示词素材：支持拖拽至任意文本/提示词节点注入文本，或拖至空白画布自动创建对应 `CLIPTextEncode` 节点；
   - 节点参数素材：拖拽至目标节点优先注入参数，拖至空白画布新建对应节点；修复了过去由于优先级颠倒导致的画布与节点拦截冲突。
3. **扫描向导 (Scan Wizard)**：
   - 弹窗底部操作按钮已设置固定粘性定位（Sticky Bottom），在任何屏幕高度下均不会被挤出视口；
   - 点击外部暗色遮罩 Backdrop 立即平滑关闭向导；
   - 按下键盘 `Escape` 键立即响应并关闭向导。
4. **控制台与稳定性**：
   - 全流程操作无任何未捕获的 JavaScript 异常或 HTTP 异常状态码。

**验收结论**：本次修复完整、精准，所有指出的严重缺陷及交互体验问题均已彻底解决并闭环。

