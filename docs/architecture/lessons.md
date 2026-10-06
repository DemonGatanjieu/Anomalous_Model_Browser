# 踩过的坑（Lessons）

反复出现的坑和严重故障。每条写清：现象、根因、怎么发现的、以后怎么做。

---

## 2026-09-26 · v1.57.2：一条 `:has()` 样式让拖动画布掉帧（严重）

**现象**：B 站用户反馈装了插件后拖动工作流 10% low 只有二十几帧；和 ComfyUI Prompt Assistant 一起装时，大工作流只剩个位数帧甚至卡死。插件界面关着也一样。

**根因**：`web/styles/01-shell-tools.css`（b6acd09，2026-09-19，进了 v1.57 / v1.57.1）

```css
body:has(#anomalous-toolbox-modal[style*="display: flex"]) #anomalous-sidebar-tooltip-bubble, …
```

`:has()` 里放属性选择器（这里是 `[style*=…]`），浏览器在页面上任何元素的该属性变化时，都要重新判断 `body:has(...)`。ComfyUI 平移、缩放画布时每一帧都在改每个 DOM 控件（文本框）的 `style`，于是每帧都要付出和页面元素数量成正比的样式计算。Prompt Assistant 给每个文本框加一组按钮，页面元素多十几倍，开销跟着放大。两个插件本身没有冲突。

**实测**（真 ComfyUI 前端 1.53.6 + Chromium，300 节点工作流平移 120 帧，样式重算合计）：

| 情况 | 修复前 | 修复后 |
| --- | --- | --- |
| 不装插件 | 60 ms | — |
| 只装 AMB | 690 ms | 63 ms |
| AMB + Prompt Assistant | 2300 ms（约 19 ms/帧，超过 60 帧的一整帧） | 86 ms |
| 只装 Prompt Assistant | 80 ms | — |

逐条删规则二分：只删掉这 7 条 `:has()` 就回到基线，其中罪魁是带 `[style*=…]` 的那条；`button:has(.x)` 等其他 `:has` 测不出开销。

**修复**：删掉这条规则。它是多余的：工具箱和设置窗口打开前都会调用 `hideTooltipImmediately()`，`showSharedTooltip` 在窗口开着时也会拒绝显示。

**以后怎么做**
- 不要用 `:has()` 或 `[style*="display: …"]` 去判断界面开关状态。要表示“开着”，由 JS 加减一个 class（作用在自己的容器上），或者直接在 JS 里处理。
- 全局生效的昂贵选择器（`body:has`、`html:has`、`*`、未限定作用域的 `button`、`textarea`）会作用在 ComfyUI 的每一帧上。新增前先问：它会不会在画布拖动时被反复判断？
- 性能问题要实测，别只看代码猜：
  - 装一个真的 ComfyUI（`--cpu` 即可），用 Playwright 在空白处拖动画布；
  - 用 CDP 的 `Performance.getMetrics` 比较 `RecalcStyleDuration`；
  - 再在页面里删掉可疑规则做二分（遍历 `document.styleSheets`，对插件自己的样式表 `deleteRule`）。
  - 没有显卡时总帧时间不准，但样式计算的倍数可信。

---

## 2026-09-26 · 修复只在本机 main，发布版没带上

**现象**：素材库“选中节点时卡片错位”（应用按钮重复、图标重复成 ⚡ ⚡、标签日期挤在一起）的修复 01fc925、9e761d0 早在 9 月 24 日就做了，但只进了 `feature/audio-engines`（通过“Merge main … into feature”）。GitHub 上的 `main` 并没有，发布版 v1.57.1 的用户一直带着这个问题。

**根因**：修复提交在本机 main 上，只把 main 合进了 feature，本机 main 从未推送。

**以后怎么做**
- 发布或回答“修了没有”之前，用 `git branch -r --contains <提交>` 确认修复在远端的哪个分支，别只看本机。
- 本机 main 有未推送提交时，先推送或说明，再做合并。
- 这次已把两个提交 cherry-pick 进远端 main（e1ac84f、4e8603b），随 v1.57.2 发布。

---

## 2026-09-26 · 发布热修复的检查项

- 改了 CSS 或 JS，要同步改缓存参数：`web/styles.css` 里对应的 `@import …?v=`、`browser_entry.js` 的 `styles.css?v=`、`main.js` 引用 `browser_entry.js` 的 `?v=`。不然用户刷新后浏览器可能还用旧文件。feature 分支已去掉部分 `?v=`，合并时以各分支现状为准。
- `CHANGELOG.md` 是 CRLF、LF 混合换行。用脚本编辑时按原字节读写（`newline=''`），否则整份文件都会显示成改动。
- 云端会话能推分支，推不了标签，GitHub 工具也不能创建 Release。发布要在网页上完成：Draft a new release → 填新标签 → Target 选 `main` 并核对提交号 → 粘贴说明 → Publish。插件的版本面板只列正式 Release，用 ComfyUI Manager 更新的用户则直接拉 main 最新提交。

---

## 2026-09-27 · 拆文件漏了 import，保存工作流在发布版里整个坏掉

**现象**：v1.57 到 v1.57.2，工作流页“保存当前工作流”只要工作流里有模型加载器就提示“保存工作流配方失败”。B 站用户反馈“就没成功过”。素材库走的是另一条路，所以能存。

**根因**：`refactor(recipes): separate schema images and storage`（6ad975c）把函数搬进 `recipe_images.py`，但它调用的 `_resolve_exact_model_reference` 和 `hashlib` 留在了旧文件里。同一轮拆分还让 `media_routes.py` 少了 `time`、`tempfile`：卡片缩略图出错后被 `except Exception` 吞掉，静默退回原图。另外 `model_metadata.py` 少了 `_resolve_paths_to_model_info_sync`。Python 只在那一行真正执行时才报 NameError，导入和其他测试都通过。唯一的保存测试关掉了模型预览快照，正好绕开了出错的那一行。

**以后怎么做**
- 拆模块后跑 `tests/test_backend_names.py`：后端文件读到却从没绑定的名字，它都会列出来。
- 行为测试要走默认路径。`recipe_payload` 默认关着快照，新测试 `test_saving_with_preview_snapshots_captures_the_model_cover` 专门走默认的“开着快照”。
- 真实按钮至少点一次：在隔离的 ComfyUI 里点“保存当前工作流”，一眼就能看出问题。
