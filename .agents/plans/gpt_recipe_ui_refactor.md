# Recipe 交互与视觉全面重构方案 (GPT 执行计划)

根据用户的最新反馈，当前的 Recipe 工作台存在以下痛点：
1. **复制按钮无反馈**：点击某些复制按钮（如“复制提示词”、“复制指纹”）虽然实际复制成功，但视觉上没有任何变化，导致用户以为没点上。
2. **编辑体验反人类**：修改名称等基本信息需要弹出一个巨大的复杂对话框，操作繁琐。
3. **UI 过于“极客”**：界面展示了太多哈希值、底层标识，且缺乏现代美感。
4. **历史负担为零**：现有的本地测试数据可以无视，直接重构数据结构或展示逻辑即可，无需为了向下兼容丑陋的老数据而妥协设计。

请严格按照以下步骤对代码进行大修：

---

## 步骤 1：修复复制反馈缺失 (Copy Feedback)

**目标文件**：`web/modules/ui_recipe_detail.js`

1. **统一的反馈封装**：编写一个全局的 `copyTextWithFeedback(buttonElement, text)` 辅助函数。
   - 内部调用 `navigator.clipboard.writeText(text)`。
   - 成功后，记录按钮原始的 `textContent`，将文本暂时改为 `✓ 已复制`（或带有 check 图标），并给按钮加上 `copied-success` 的 CSS 类（用于变绿等动画）。
   - 设置 `setTimeout` 在 1.2 秒后恢复原状。
2. **替换无反馈的按钮调用**：
   - 在 `renderOverview` 中，找到 `copyPrompt.onclick` 和 `copyFingerprint.onclick`。
   - 将它们改为调用 `copyTextWithFeedback(copyPrompt, promptBundle)`，确保用户点击大按钮时有明显的成功提示。

---

## 步骤 2：告别反人类的编辑，实现“内联编辑 (Inline Edit)”

**目标文件**：`web/modules/ui_recipe_detail.js` (以及对应的 CSS 文件)

目前的 `editRecipe` 会弹出一个包含参数、封面、名字的巨大弹窗，极其笨重。我们改为**所见即所得**的内联编辑：
1. **名称支持点击修改**：
   - 在 `renderOverview` 渲染 `<h3>${recipe.name}</h3>` 的地方，增加一个轻量的编辑图标（如 ✏️）。
   - 点击该标题后，将其替换为一个 `<input type="text">`，自动获得焦点。
   - 监听 `blur` 和 `keydown (Enter)` 事件。触发时，读取新值并直接调用 `fetch('/anomalous/update_recipe')` 保存到后台，保存成功后重新渲染标题。
2. **备注 (Notes) 与标签 (Tags) 内联化**：
   - 对 Notes 文本同样应用内联编辑逻辑（点击变成 `<textarea>`）。
   - 让用户可以直接在详情页快速改名和改备注，日常使用中几乎再也不需要打开原先那个巨大的 `editRecipe` 弹窗。

---

## 步骤 3：UI 现代化与“去极客化” (Modern UI & De-geekify)

**目标文件**：`web/modules/ui_recipes.js` / `web/modules/ui_recipe_detail.js` / 对应 CSS

1. **隐藏冗余的硬核数据**：
   - 诸如 “工作流指纹 (Fingerprint)”、“模型 SHA-256 哈希值”等过于底层的信息，对普通画图用户来说视觉噪音极大。
   - 将这些信息包裹在一个原生的 `<details><summary>开发者/高级信息</summary>... </details>` 折叠面板中，默认收起。
2. **引入高级的卡片设计 (Glassmorphism & Micro-animations)**：
   - 修改卡片（`.anomalous-recipe-card`）的 CSS，抛弃干瘪的实色背景。引入毛玻璃效果：`background: rgba(255,255,255,0.05); backdrop-filter: blur(10px);`（如果是暗色主题适用）。
   - 增加微动画交互：悬浮时增加轻微上浮 `transform: translateY(-2px);` 和发光阴影 `box-shadow: 0 8px 24px rgba(0,0,0,0.15);`。
   - 确保列表布局采用响应式 Grid 布局：`display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;`。
3. **按钮与排版升级**：
   - 使用现代无衬线字体（如 Inter, Roboto）。
   - 将主按钮的边角变得更加圆润 (`border-radius: 6px` 或 `8px`)，去除默认边框，增加柔和的 Hover 过渡效果 `transition: all 0.2s ease;`。
   - 减少 Emoji 的滥用，可以使用更协调的 SVG 图标或者更纯净的排版。

## 执行记录

2026-08-03：已完成。复制反馈、名称/备注/标签内联编辑、高级信息折叠、玻璃卡片与响应式间距已落地；更新请求沿用完整配方契约，未新增数据结构或破坏性兼容分支。
