# 📖 AI Lessons — Error & Experience Summary (开发避坑与经验总结)

This document serves as an architectural retrospective and UX diagnostic log for the development of the Anomalous Model Browser.

## 56. UI Refactors Must Preserve Reachable Semantic Tabs

When a visual refactor merges information into a compact overview, do not remove a semantic tab until every dependent interaction has an intentional replacement. Model preview loading, model navigation, and return-state restoration were still designed around a Models tab, so removing only the tab made those actions unreachable. Keep tab state, asynchronous loading conditions, and return paths aligned with the visible navigation.

## 57. Detail Return Must Restore the List Viewport

Opening a detail panel should capture the list's semantic location and viewport, not only the selected item. Restore the folder/type and `scrollTop`/`scrollLeft` when the user returns to the grid, while keeping recipe-detail return state separate from browser-grid state. This prevents a visually correct Back action from still feeling like a navigation reset.

## 58. Overlay Close Must Restore Its Covered Panel

An overlay that only toggles its own visibility can reveal a blank host surface if the underlying panel was hidden by an earlier navigation path. Record the covered panel at overlay entry and restore it through one shared close function. Keep a safe visible fallback, such as the main grid, for stale or missing return state.

## 59. Reused Overlay DOM Must Be Rehydrated on Reopen

When an overlay is closed by hiding both its shell and its child sections, the already-initialized fast path must restore the active child section before returning. Refreshing data alone does not make a hidden DOM subtree visible and can produce a blank overlay on the second open.

## 60. Refresh Modes Must Be Explicit Data, Not List Attributes

Python lists cannot carry ad-hoc control flags. When enrichment needs a refresh mode, pass it as an explicit function argument so the code remains valid for every list implementation and the preserve-versus-recompute behavior is visible at the call site.

## 61. Long Status Explanations Do Not Belong in Bounded Badges

Keep status badges short and move the explanation to a tooltip or disclosure. Long localized text inside a `white-space: nowrap` flex item can overflow its card even when the parent has a nominal width; use concise labels plus `min-width: 0` and explicit wrapping for resilient layouts.

## 62. Disabled Is Not the Same as Feedback

For network-backed buttons, disabling the control prevents duplicate requests but does not tell the user that anything happened. Pair the disabled state with an immediate loading label, a visible progress cue, and a failure path that restores the original action.

## 63. Native Title Tooltips Are Not Reliable UI Feedback

Browser `title` hints are delayed, low-contrast, difficult to style, and poor for keyboard users. For explanations that must not cover neighboring content, an inline click-to-expand note is safer than an absolutely positioned tooltip and avoids duplicate browser/custom hints.
这份文档旨在记录 Anomalous 插件开发过程中的架构演进、UX 设计教训以及核心 Bug 排查经验。

---

## 60. Async UI Actions Need One Ownership Boundary

**The Problem**: Card actions each implemented their own `try/catch`, disabled state, or no state at all. A failed request could leave a control stuck, while a double click could start two recipe mutations.

**The Solution**: Put busy-state ownership, duplicate-click prevention, error reporting, and `finally` restoration in one small action runner. Individual actions should only describe their domain operation and return/throw normally.

## 59. Cross-Panel Navigation Needs an Explicit Return Token

**The Problem**: A recipe detail panel can launch a model detail panel owned by the main browser. Without a return token, the model Back button correctly returned to the model grid but lost the recipe tab, scroll position, and active view. Separately, Open/Append actions performed their work but left the detail Promise unresolved.

**The Solution**: Treat recipe detail as a small controller with an idempotent finish/dispose path. Store only a lightweight payload, active tab, and scroll position for model navigation; consume that token from the main detail Back action. Every successful action must settle the controller, while external Workspace changes must dispose it as well.

## 58. Identity, Preview, and Filename Are Different Evidence Classes

**The Problem**: A recipe's saved model filename is useful for showing the user a basename and for locating a current-machine preview, but it cannot prove that a same-named local file is the same model. Package enrichment also rebuilt model references and accidentally discarded imported identity and historical preview descriptors.

**The Solution**: Keep identity records and presentation descriptors keyed by node/widget/category/saved value, then rebuild only transient local availability around them. Resolver matching must use hash, exact size, and category rules; filename/path remains a locator only. Export must collect assets from every selected recipe version, remove local output paths, and commit replacement packages with rollback across recipe, assets, and history.

## 57. A Summary Must Never Become the Save/Edit Source

**The Problem**: Recipe metadata deliberately truncates generic widget values for fast cards and detail browsing. Reusing it for edit controls meant a long prompt could be saved back as its truncated preview. A canvas-based update also started with an empty pin selection, silently dropping valid prior key parameters.

**The Solution**: Capture one serialized workflow snapshot before the save dialog, use it as the only outbound graph, and resolve editable/pinnable widget values from that snapshot by stable node ID plus widget index. Carry forward only pin keys that still resolve on the current graph and make dropped pins explicit. Server acceptance must validate basic graph topology and return a compact receipt so the UI can show what was accepted.

## 51. A Bounded Card Summary Is Not a Detail Value (卡片摘要不能冒充详情值)

**The Problem (问题)**: The recipe card intentionally limits generic widget text for fast browsing, but the detail panel reused that same summary. Long prompts and output settings looked saved yet could not be inspected or copied in full, while the negative prompt was hidden behind a positive-only overview layout.

**The Solution (方案)**: Keep the compact summary for cards, then resolve the matching safe value from the already-loaded serialized workflow only in the detail panel. Present positive and negative prompts explicitly. Any long value must offer visible expand/collapse and copy actions; do not replace available data with an unexplained ellipsis.

## 50. Host Prompt APIs Often Return an Envelope (宿主 Prompt API 可能返回包装对象)

**The Problem (问题)**: ComfyUI's `api.queuePrompt` destructures the `{ output, workflow }` envelope returned by `app.graphToPrompt(graph)`. Passing only the nested `output` object loses the workflow metadata and produces an invalid queue payload.

**The Solution (方案)**: When bridging a plugin action to a host API, inspect both the producer and consumer contracts and preserve the complete envelope at the boundary. Keep temporary graph conversion separate from the live canvas so this compatibility fix cannot introduce canvas mutation.

## 52. Child Overlay Navigation Must Not Close Its Host (子覆盖层跳转不能关闭宿主)

**The Problem (问题)**: Recipe model cards lived in a child Workspace overlay, but their local-model click handler called the browser-wide `close()` method. That method hides the host modal and releases its grid state, so the target model detail panel appeared to close immediately.

**The Solution (方案)**: Treat the click as an in-place host-panel transition: prepare the model detail state, ensure the host modal remains visible, render the detail panel, and hide only the child recipe overlay. Keep the full close/release lifecycle reserved for explicit browser dismissal.

**Related presentation rule (相关展示规则)**: Repeated model references need independent responsive cards. A shared dense container makes preview, identity, availability, and actions appear mixed together; a card grid preserves one-reference-per-unit without changing the saved workflow data.

## 53. Model Composition Is Not a Generic Parameter Row (模型组成不能当作普通参数行)

**The Problem (问题)**: Putting the base model and a comma-joined LoRA list into the same responsive key-value grid made long names compete with labels and unrelated sampling values. The browser wrapped the text into narrow columns, producing a tall, visually mixed summary.

**The Solution (方案)**: Give model composition its own vertical section. Render the base model and each LoRA as an independent full-width block with safe wrapping and copy/expand controls; reserve the compact grid for short scalar values such as steps, CFG, sampler, and resolution.

## 54. Saved Prompt Metadata Needs a Detail-Tab Contract (已保存提示词必须有明确详情页入口)

**The Problem (问题)**: Prompt extraction already persisted `params.promptPositive` and `params.promptNegative`, but only the Overview invoked the prompt renderer. The Parameters tab only walked bounded generic node summaries, so a valid saved positive prompt looked absent.

**The Solution (方案)**: Treat prompt summaries as first-class recipe parameters and render them in both Overview and Parameters. Keep the existing full-workflow lookup, copy control, and expand/collapse behavior so prompt display does not depend on the generic node summary limit.

## 55. Native Prompt Nodes Must Survive Bounded Summaries (原生提示词节点不能被摘要限制吞掉)

**The Problem (问题)**: A separate prompt summary in Parameters duplicated the native `CLIPTextEncode` rows, while older native nodes could be omitted from `params.nodes` when their text was only available in serialized `workflow.nodes[].widgets_values`. This made one polarity, commonly the positive prompt, appear missing.

**The Solution (方案)**: Keep prompt summaries as an Overview convenience only. Parameters must use native node names and supplement the bounded summary with serialized `CLIPTextEncode` nodes, preserving each node's `text` widget and full-value lookup.

## 56. Fallback Rows Must Have a Presentation Order (补回的参数行必须有展示顺序)

**The Problem (问题)**: Appending a fallback-recovered positive CLIP node to the end of the parameter list left it far away from the existing negative CLIP node.

**The Solution (方案)**: Rebuild the parameter presentation order from serialized workflow order, then group native `CLIPTextEncode` rows together. This changes only display ordering; node names, widget values, and the authoritative workflow remain unchanged.

## 1. UX Scroll Traps (交互嵌套滚动陷阱)
**The Problem (问题)**: In the Notebook modal, the translation editor had a `max-height` and `overflow-y`. Since the parent modal was also scrollable, it created a "Scroll Trap". Hitting the bottom of the editor unpredictably transferred the scroll event to the outer body.
(在笔记本弹窗中，由于翻译编辑器固定了最大高度并允许滚动，导致与父级弹窗的滚动条发生冲突。用户滚动到底部时会突然把外层页面卷走，体验极差。)
**The Solution (方案)**: Removed the `max-height` and internal scrollbar. Letting the translation editor expand naturally utilizing the primary window scrollbar guarantees a continuous experience.
(彻底移除内部最大高度和滚动条。让编辑器自然撑开，统一使用最外层的主滚动条，保证心流不断档。)

## 2. Artificial Metadata Pollution (伪造数据的反噬)
**The Problem (问题)**: To make the "Base Model" dropdown look complete, the backend artificially injected hardcoded architectures (`SDXL`, `HunyuanVideo`) even if the user didn't own them. This confused users.
(为了让“模型架构”下拉菜单看起来更“丰满”，后端硬编码注入了一些用户根本没下载过的新架构。结果让用户极度困惑，以为自己眼花了。)
**The Solution (方案)**: Data truth must strictly reflect the local disk state. Dropped artificial padding; the UI dropdown now accurately mirrors only the physical files on disk.
(数据必须绝对忠于本地磁盘。删除了所有的硬编码注入，确保下拉菜单严格反映本地真实的生态。)

## 3. UI Strobe Effects on Grid Hovers (网格悬浮的“光污染”)
**The Problem (问题)**: Standard `transition: all 0.2s` meant quickly sweeping the mouse across the model grid caused all cards to rapidly light up like a strobe light.
(为卡片设置了标准的 0.2秒 悬浮动画，导致鼠标快速扫过网格时，所有卡片像迪厅频闪一样疯狂亮起，显得非常廉价。)
**The Solution (方案)**: Introduced a `transition-delay: 0.08s` low-pass filter. The recommended UX range for hover intent is 50ms - 100ms. This 80ms delay is imperceptible for intentional clicks but completely eliminates flashes from accidental sweeps.
(引入了 `0.08s` 动画延迟作为低通滤波器。根据人机交互体验，区分“无意滑过”与“有意悬停”的黄金推荐区间是 50ms - 100ms。我们采用的 80ms 延迟对正常点击毫无察觉，但完美过滤了鼠标无意扫过造成的闪烁。)

## 4. The ComfyUI Manager Auto-Update File Wipe (Manager自动更新导致文件丢失)
**The Problem (问题)**: A custom documentation file (`docs/核心按钮操作指南_大白话版.md`) generated by AI locally was silently deleted when clicking "Update" on the node inside ComfyUI Manager.
(本地让 AI 写的说明文件，在点击 ComfyUI Manager 的更新按钮后离奇失踪了。)
**The Solution (方案)**: ComfyUI Manager's update mechanism often performs a raw `git pull` or hard reset. If a local file is not tracked in the remote GitHub repository (i.e., you haven't committed and pushed it), it is highly likely to be overwritten or wiped during the sync process. Always commit and push your documentation, or keep personal untracked notes outside the extension directory!
(ComfyUI Manager 的更新机制依赖 Git 同步（类似 `git reset --hard` 或强制 pull）。如果你在本地创建了文件却没有提交并推送到 GitHub，更新时 Manager 会强行把本地状态与云端对齐，导致这些“未追踪（untracked）”的文件被直接抹杀。教训：重要的文档一定要及时 push，或者别放在插件目录下！)

## 5. "Hostage" Inline Confirmations (被“绑架”的内联确认)
**The Problem (问题)**: Clicking "Delete" changed the button to "Are you sure?" with a 3-second timeout, but lacked a "Cancel" button. Users misclicking were held hostage for 3 seconds.
(点击删除后会变成“确定删除吗？”并锁定 3 秒，但没有“取消”按钮。用户如果不小心点错，只能像被绑架一样干等 3 秒它恢复。)
**The Solution (方案)**: Wrapped the logic to instantly reveal a secondary `[✕]` cancel button upon the first click, giving control back immediately.
(在点击删除时，立马在旁边弹出 `[✕]` 取消按钮。点击取消直接清空倒计时，立刻把控制权还给用户。)

## 6. First-load "Dead Interface" Avoidance (首次加载的“白屏假死”)
**The Problem (问题)**: Initializing the sidebar to the root directory `/` presented a blank screen if users only had models nested deep in subfolders.
(插件默认打开根目录 `/`。如果用户的模型全都在很深的子文件夹里，打开插件就会看到一片空白，以为插件坏了。)
**The Solution (方案)**: Implemented `firstLoadDone` to automatically force the UI to open the very first directory possessing `model_count > 0`.
(加入了智能寻路逻辑，插件首次加载时自动扫描目录树，直接定位并打开第一个存有模型的文件夹。)

## 7. Structural Layout Breakages (流式布局的坍塌)
**The Problem (问题)**: Placing varying lengths of translation tags sequentially caused extreme layout jitter when hovering.
(把中英文标签简单并排放在一起，由于字符串长度不一，鼠标悬浮时极容易发生换行挤压，导致整个界面疯狂跳动。)
**The Solution (方案)**: Enforced a strict "Row-based" flex architecture (`align-items: stretch`). Each tag pair is locked into a geometrical row.
(采用极其严格的行级 Flex 布局，把中英文双语硬性锁死在同一个拉伸行内，无论字数多少，几何结构绝对稳定。)

## 8. Modal State Persistence (弹窗状态的幽灵)
**The Problem (问题)**: Closing and reopening the Notebook modal showed a blank editor because the JS object cached `this.currentNotebook` but the DOM was obliterated.
(关掉笔记本弹窗再打开，右侧编辑器全空。因为 JS 内存里还记着上一次的状态，但 DOM 节点已经被销毁重建了。)
**The Solution (方案)**: Explicitly check cached state during modal initialization and force `renderNotebookEditor()` if necessary.
(在弹窗初始化时主动校验缓存，强制触发重新渲染，实现了完美的“会话级记忆”。)

## 9. Missing Visual Feedback for Background Operations (无反馈的幽灵进程)
**The Problem (问题)**: The Notebook "Save" button executed a background `fetch` perfectly, but provided absolutely no visual feedback. Users assumed it was broken.
(点击“保存”按钮后，后台默默完成了请求，但按钮本身没有任何变化。用户以为没点上，引发数据丢失的焦虑。)
**The Solution (方案)**: Clicking Save instantly changes the button to a green `✅` state for 1.5 seconds.
(点击保存后强制变绿 `✅` 1.5 秒，给用户极强的心理安全感。)

## 10. Spatial Geometry for Multi-Node Spawning (多节点生成的空间重叠)
**The Problem (问题)**: Spawning an entire Notebook (Main Model + Loras + CLIPs) caused all nodes to clump perfectly at `(0,0)`.
(一键生成整个笔记本（主模型+N个Lora+提示词）到画布时，所有节点全叠在同一个坐标上，变成了一坨。)
**The Solution (方案)**: Implemented a "Relative Offset Matrix Layout" (`X + 350*N`, `Y + 250`) and bound it to the `mousemove` event (Magnetic Sticking).
(加入了偏移矩阵计算，并绑定鼠标移动。用户可以直观地拖着排成流水的节点序列在画布上移动，然后再点击放下。)

## 11. Localization Host-Environment Constraints (寄生环境的本地化陷阱)
**The Problem (问题)**: Reading `document.documentElement.lang` failed because ComfyUI forces the host HTML to `en-US`, breaking our Chinese translations.
(插件试图读取网页根节点的 lang 属性来决定语言。但 ComfyUI 强行把底座设成了纯英文，导致中国用户永远看不到中文提示。)
**The Solution (方案)**: Never trust the host document properties. Rerouted localization strictly to our internal `currentLang` variable.
(永远不要相信宿主环境。彻底切断外部依赖，纯靠插件内部自己的 `currentLang` 变量来统治中英文环境。)

## 12. Strict Path Separator Validation (路径分隔符的玄学崩溃)
**The Problem (问题)**: Windows uses backslashes (`\`), but assigning `anime/model` to a node's combo widget failed ComfyUI's strict string matching, causing red nodes.
(Windows 的底层模型路径带反斜杠，但前端组件要求精确匹配字符串，哪怕是一个斜杠方向不对，节点也会标红报错。)
**The Solution (方案)**: Built `setWidgetValuePath` to normalize both target paths and native options with `.replace(/\\/g, '/')` before assignment.
(做了一个拦截器，强行把系统内的选项和我们要赋的值全部统一转成正斜杠再进行比较，直接绕过操作系统的路径陷阱。)

## 13. Backend Starvation During Inference (算力挤兑导致的接口饿死)
**The Problem (问题)**: Fetching plugin data while ComfyUI is generating an image causes timeouts because of PyTorch GIL-locking.
(在 ComfyUI 画图满载的时候，点插件会导致接口超时。因为单线程的 Python 完全被 GPU 推理抢占了。)
**The Solution (方案)**: Accept it gracefully. Database management and intense GPU inference are mutually exclusive workflows.
(优雅地接受这个现实。不需要过度工程化地去做离线队列，画图和管理模型本来就不该同时进行。)

## 14. DOM Obliteration vs Virtual DOM Hoarding (物理毁灭 vs 虚拟回收)
**The Problem (问题)**: Maintaining performance when navigating folders containing thousands of models.
(当一个文件夹里有上千个模型时，频繁切换文件夹会导致浏览器内存爆炸。)
**The Solution (方案)**: Instead of `display: none` hoarding, strictly enforce `this.grid.innerHTML = ''` to physically obliterate nodes and trigger immediate Garbage Collection.
(放弃“隐藏重用”的传统思路。切文件夹时直接暴力清空内部的 HTML 节点，强迫浏览器立马回收内存，保持零负担。)

## 15. The "Missing Plugin Icon" Trap (LocalStorage 坐标越界飞天)
**The Problem (问题)**: If the floating trigger button was saved at `X=3000px` on a 4K monitor, loading it on a `1920px` laptop rendered it permanently off-screen.
(在大显示器上把插件按钮拖到了最右边，换到小笔记本上时，坐标超出了屏幕，按钮彻底消失，再也点不出来了。)
**The Solution (方案)**: Implemented a bounds clamp checking coordinates against `window.innerWidth`. If out of bounds, snap it to the bottom-right corner.
(在启动时强制对比当前屏幕大小，一旦发现越界，立刻把它抓回到右下角的安全区内。)

## 16. The `[vite:preloadError]` Template Literal Crash (一个反引号引发的血案)
**The Problem (问题)**: A missing backtick in a dynamic ES Module dictionary crashed the entire ComfyUI extension loader before execution.
(在汉化字典里不小心删掉了一个反引号，导致 Vite 打包工具报语法错误，整个插件直接在加载前暴毙，UI 按钮全都没了。)
**The Solution (方案)**: JS zero-tolerance for syntax errors requires extreme validation. Fixed the missing backtick.
(原生 JS 没有任何编译容错，任何语法拼写都必须如履薄冰，及时修复了那个反引号。)

## 17. Target Size Deduplication Bug (重叠目录的体积匹配悖论)
**The Problem (问题)**: Fixing models by file size required finding *exactly one* matching file. But users mapping `checkpoints` and `diffusion_models` to the same folder caused `os.walk` to find the same physical file twice, aborting the fix.
(物理寻址兜底算法要求“体积必须唯一”。但用户配置了多个虚拟路径指向同一个物理文件夹，导致同一个文件被扫出两次，系统误判为“体积不唯一”而放弃修复。)
**The Solution (方案)**: Added `os.path.realpath` deduplication matrix to condense multiple virtual paths back to a single hard drive sector.
(引入了绝对物理地址 `realpath` 去重机制，无论虚拟路径怎么重叠，物理层面上都将其归一化。)

## 18. The "Lightweight Scan" Re-Hash Catastrophe (轻量扫描的重算灾难)
**The Problem (问题)**: The lightweight scan (`--skip-media`) demanded *both* an `.info` file and a preview image to skip hashing. Since it didn't download images, it forcefully re-hashed hundreds of GBs of models every time.
(轻量化极速扫描因为不会下载图片，导致“是否跳过计算”的判断条件（既有 info 又有图）永远不成立。引发了灾难性的全盘重新计算 SHA256，慢如蜗牛。)
**The Solution (方案)**: Modified skip logic conditionally: if explicitly skipping media, the existence of `.info` is sufficient to bypass hashing.
(加入了情境判断：只要是在极速模式下，不管有没有图，只要有文字信息就无条件跳过，恢复了真正的极速。)

## 19. The Stale Dropdown Visual Residue (顽固的红框残留)
**The Problem (问题)**: Even after a model path was auto-fixed, ComfyUI maintained a permanent red error border on the node if the frontend cache was stale.
(底层其实已经修复并加载了正确的模型，但因为前端选项缓存没刷过来，ComfyUI 死死把节点标红，看着十分闹心。)
**The Solution (方案)**: Forcefully execute `delete node.color; delete node.bgcolor;` to violently strip native error states without requiring a refresh.
(既然修好了，就直接暴力删除节点的 `color` 属性，强行洗白红框，无需刷新网页。)

## 20. The Silent Subprocess Death (DEVNULL 黑洞)
**The Problem (问题)**: `scraper.py` crashed due to Python indentation, but piping `stderr` to `DEVNULL` made it totally invisible. The UI waited forever.
(后台脚本缩进写错了导致崩溃，但代码里把报错信息塞进了无尽深渊 `DEVNULL`，没有任何提示，前端界面只能干等着，陷入死局。)
**The Solution (方案)**: Never pipe `stderr` to DEVNULL during active development. Let it log.
(开发阶段绝对不要屏蔽底层报错，必须让 `stderr` 打印到控制台以便排查。)

## 21. Tiered Fallback Resolution for O(1) Scans (多级降级寻址打造 O(1) 扫描)
**The Problem (问题)**: Unscanned 10GB models required full disk read to calculate SHA256, taking minutes.
(即便是第一次扫描，遇到几十 GB 的新模型，完整计算 SHA256 也要几分钟，用户体验极度卡顿。)
**The Solution (方案)**:
1. 0ms: Read existing `.info`. (直接读取已有的 info)
2. 0.01s: Extract 64KB JSON header from `.safetensors` via `struct` for pre-computed hash. (用 struct 撬开文件头瞬间提取内置的 Hash，降维打击)
3. Fallback: Full SHA256 only for legacy models. (真找不到了才迫不得已做全量计算)

## 22. Zero-API Tensor Fingerprinting (零API脱机张量基因识别)
**The Problem (问题)**: HuggingFace or private models returned 404 from Civitai, failing to generate `.info` and completely breaking UI integration.
(从 HF 拿到的或者是自己练的私模，由于 C站 没有记录，API 直接报错 404，导致模型彻底被忽略，前端里连看都看不到。)
**The Solution (方案)**: Read the first 500 Tensor Keys via struct. Identifying `double_blocks.0.img_attn` strictly confirms Flux.1 D architecture completely offline.
(不管你有没有网，强行读取模型前 500 层的网络结构。只要看到里面有 `double_blocks`，直接盖章确认为 Flux 架构。完全脱机，无缝融入前端兼容雷达。)

## 23. Gemini-Style Popover UI (告别全屏遮罩，采用悬浮弹窗)
**The Problem (问题)**: Center-screen settings modals with blur backgrounds felt heavy and disconnected users from the workspace.
(原本的设置面板是个带有大面积模糊遮罩的全屏居中弹窗，显得特别笨重，像个垃圾网页游戏。)
**The Solution (方案)**: Refactored to a lightweight side-popover (`left: 100%; bottom: 15px;`) imitating Gemini's web UI, maintaining deep workflow immersion.
(改成绝对定位，像 Gemini 网页端那样从侧边栏右侧悄悄弹出一个悬浮气泡，点外侧自动收起，极大保证了沉浸感。)

## 24. Dock & Mode Lock (全宽底座与多状态锁死)
**The Problem (问题)**: Floating capsules looked cramped, and entering fullscreen Gallery while the Sidebar menu remained clickable caused DOM rendering conflicts.
(底部按钮挤在一起极其难看。而且进入全屏图库的时候，居然还能点左上角的汉堡菜单，导致页面状态直接崩溃交织在一起。)
**The Solution (方案)**: Extended to a 100% width solid Dock. Disabled sidebar triggers during fullscreen views via strict State Locks.
(把底部做成了满宽的实体底座，稳固了视觉重心。一旦进入图库这种排他性的全视图，强行给菜单上互斥锁，彻底断绝乱按引发的 Bug。)

## 25. Resolving "Missing" vs "Unscanned" Conflicts (防重叠逻辑拦截自相踩踏)
**The Problem (问题)**: Deleting a model and reloading the workflow popped BOTH the "Missing Model" dark modal and the "Unscanned Model" orange toast.
(把一个模型删掉后重新加载图片，系统一方面觉得“模型丢了”弹出黑框，一方面因为缓存里没它又觉得它是“没扫过的新模型”弹出橙黄色的警告，两个弹窗叠在一块极其弱智。)
**The Solution (方案)**: The unscanned detector now ignores nodes already flagged with red error colors (`node.color === "#FF3333"`), preventing system overlapping.
(加入了双轨防踩踏：未扫描检测器只要看到这个节点已经红了（彻底丢了），就主动闭嘴放弃拦截，边界极其清晰。)

## 26. The CSS `zoom` Devastation (Zoom 属性对坐标系的降维打击)
**The Problem (问题)**: Using `zoom` to scale the UI broke bounding boxes. `container.offsetHeight > window.innerHeight` caused `Y` coordinates to become negative, permanently launching the window off-screen into the void.
(早期为了偷懒，用 CSS `zoom` 属性来做 UI 缩放。结果它彻底破坏了浏览器的物理坐标系，一旦窗口过大，防越界系统就算出了个负数坐标，导致插件整个闪现飞出屏幕外，再也拖不回来了。)
**The Solution (方案)**: Banned `zoom`. Transitioned to relative scaling via `font-size: calc(16px * var(--anomalous-scale))`. Fixed bounding clamps to execute `< 0` checks last.
(彻底封杀 zoom。改用 `calc(16px * scale)` 的底层字体相对推算放大法。并且把防负数的保底检测代码调到了逻辑的最后一行，永远杜绝负数坐标。)

## 27. Vanilla JS "Fake" i18n Failure (原生状态管理漏斗下的假性汉化失效)
**The Problem (问题)**: Newly added permanent buttons ("UI Scale", "Reset") remained in Chinese when English was toggled. Since we lacked React/Vue two-way binding, they missed the global state update and got stuck.
(新加了“UI缩放”等按钮后，即使点了切换英文，它们还是中文。因为我们没有使用 Vue 的数据绑定，纯靠原生 JS。如果新加了常驻按钮，却忘了把它登记到顶层 `langBtn.onclick` 突变循环里，它就永远被隔离在旧时间线里了。)
(只要是常驻的按钮，必须强制在语言切换中枢里注册重写一遍。同时开发过程中如果遇到“代码没变”的灵异现象，第一反应永远是按 Ctrl+F5 强制破除浏览器静态缓存。)

## 28. The Image Cropping Dilemma (图库的裁切与留白博弈)
**The Problem (问题)**: Using `object-fit: cover` in the image gallery created perfectly uniform grid squares, but brutally decapitated tall images (like 9:16 vertical character portraits).
(在图库排版时，为了让网格看起来绝对整齐，使用了 `object-fit: cover`。结果导致偏长的图片（如 9:16 的人物竖图）顶部和底部被无情裁掉，经常出现“砍头”现象。)
**The Solution (方案)**: Changed to `object-fit: contain` and paired it with a deep black background (`#000`). The images now scale down to fit entirely, and the resulting letterboxing seamlessly blends into the dark UI as a natural frame.
(改为 `object-fit: contain`，完整显示图片。由于底层卡片背景本身就是极黑（`#000`），缩小后产生的黑边完美融入了 UI 背景，不仅没有任何违和感，反而像是一圈高级的画框，一举两得。)

## 29. Vanilla JS Global Click-Outside (原生悬浮面板的全局点击收起)
**The Problem (问题)**: The settings popover only closed if the user explicitly clicked the gear icon again. Clicking elsewhere on the canvas did nothing, making the popover feel rigid and intrusive.
(点击齿轮打开设置悬浮气泡后，必须再点一次齿轮才能关掉。如果随手点一下旁边或者点画布，面板居然不收回，交互显得非常死板和占眼。)
**The Solution (方案)**: Attached a temporary `mousedown` event listener to the `document` when the popover opens. If the click target is outside the modal, it triggers `display: none` and instantly `removeEventListener` to prevent memory leaks.
(面板弹出时，立刻给全局 `document` 挂载一个监听器。只要检测到鼠标点击了面板外部区域，立刻收缩面板，并且**顺手注销掉这个监听器**，实现了极度顺滑的 Gemini 式收放体验且毫无性能负担。)

## 30. Context Preservation vs UX Intention (上下文保留与用户意图的冲突)
**The Problem (问题)**: After picking a new cover from the Gallery while inside the Model Edit Modal, the UI destroyed the modal, showed the gallery, and then *restored* the modal upon completion to 'preserve context'. However, users who just wanted to change the cover felt confused, thinking they still needed to click 'Save' to apply it.
(在编辑面板中点击更换封面后，UI 会先销毁面板，进入图库，选完后再把编辑面板弹回来以“保留上下文”。但用户其实只想换个封面，重新弹出的面板反而让他们误以为必须再点一次“保存”才算数。)
**The Solution (方案)**: Respect the primary intention. When the cover is changed, directly return to the model card/grid. Do not stubbornly restore intermediate modals unless necessary.
(顺应主要意图。换完封面直接回到网格卡片，干脆利落。不要去死板地恢复中间态面板。)

## 31. The Missing Reference Crash (引用丢失导致的状态黑洞)
**The Problem (问题)**: A refactor failed to assign `this.models = data.models` in the load function. When a UI callback later tried to find the updated model using `this.models.find()`, JS threw an `undefined` error and aborted execution midway. This left the UI with both the gallery and grid hidden, resulting in a completely blank screen.
(重构时忘了一行赋值代码，导致 `this.models` 为空。后续 UI 切换时试图从中查找模型直接报错崩溃。由于崩溃发生在显示/隐藏面板的切换中途，导致所有面板都被隐藏，屏幕变成了彻底的“真空空白”。)
**The Solution (方案)**: Always ensure foundational state variables are populated before executing callbacks that depend on them.
(底层状态变量必须绝对可靠，一旦中途崩溃，UI 的半途状态是毁灭性的。)

## 32. Backup Entanglement of Non-Platform Models (非平台模型的备份污染)
**The Problem (问题)**: To ensure a 'Reset' always had a fallback, changing any cover backed up the original file to `.civitai_bak`. For non-Civitai models, this meant user's manual `.png` covers were forcefully renamed to `.civitai_bak`, causing severe semantic confusion.
(为了保证“重置”功能永远有退路，之前的逻辑会把任何被替换的封面强行改名为 `.civitai_bak`。这就导致用户自己放的非 C 站模型封面，也被莫名其妙打上了 C 站的烙印，逻辑极其混乱。)
**The Solution (方案)**: Decouple custom covers by strictly saving them as `.preview.*` and leaving original standard `.png` files untouched. Resetting now just deletes the `.preview.*` file, naturally falling back to the untouched original, or copying the true `.civitai_bak` if it actually came from Civitai.
(让自定义封面独占 `.preview.*` 后缀，绝不触碰原有的标准封面。重置时只需删掉自定义后缀，系统就会自然回退。彻底切断了非 C 站模型与 C 站备份标识的无理纠缠。)


## 33. DOM Video Audio Leaks on innerHTML Clear (DOM 销毁导致的幽灵音频泄漏)
**The Problem (问题)**: When navigating from a model detail view containing an actively playing <video> to another model, setting container.innerHTML = '' removed the video from the DOM, but its audio continued playing infinitely in the background because the browser engine did not immediately garbage-collect the orphaned playing media.
(在模型详细页如果有视频正在播放，当用户点击兼容模型跳转到另一个模型时，虽然通过 innerHTML = '' 清空了面板，DOM 节点被移除了，但由于浏览器没有立刻回收这个还在播放的媒体对象，导致旧视频的音频在后台像幽灵一样继续循环播放，并且再也无法通过 UI 停止。)
**The Solution (方案)**: Implemented a strict cleanup lifecycle. Before destroying or overwriting a container's DOM, explicitly query all ideo and udio elements within it, invoke .pause(), and remove their src attributes to force the browser to release the media resources instantly.
(引入了严格的 DOM 销毁生命周期。在清空任何面板前，必须先获取里面所有的音视频元素，显式调用 .pause() 并剥夺它们的 src，强制浏览器当场释放媒体资源，彻底杜绝后台泄漏。)

## 34. The Search Bar "Hidden State" Trap (搜索框的隐藏状态盲区)
**The Problem (问题)**: Users typing in the global search bar while viewing a Model Detail panel thought search was broken because the filtered results were successfully generated but the grid container was hidden (`display: none`).
(用户在模型详细页里直接使用全局搜索框搜索，后台成功过滤了网格卡片，但因为当前网格容器是隐藏状态，用户看不见结果，误以为搜索功能坏了。)
**The Solution (方案)**: Added an explicit state-exit in the `searchInput.oninput` event. If a detail panel is open, it destroys the panel and forces the grid back to `display: grid` so results are immediately visible.
(在搜索输入事件中强制介入。只要开始搜索，立刻销毁详情面板并强行把网格视图切换回可见状态，保证搜索结果永远“所见即所得”。)

## 35. The Metadata Overwrite Paradox (伪元数据强行覆盖的惨案)
**The Problem (问题)**: A background script updating a model's custom name without fetching full Civitai data wrote a `.civitai.info` file containing *only* the custom name. This obliterated the real Civitai data (description, tags) and caused the frontend to render an empty detail page.
(后台在更新自定义名字时，遇到了一个没有 `.info` 的模型，直接暴力生成了一个只包含自定义名字的 `.civitai.info`。结果反而把原本应有的全量 C 站详情数据给“排挤”掉了，导致详细页一片空白。)
**The Solution (方案)**: Never trust partial updates to structural files. If it's corrupted or just a stub, delete it so the frontend can freshly pull real data from the Civitai API via the Scan Wizard.
(对于结构性文件，宁缺毋滥。发现被污染成只有两个空字段的残疾文件后直接删除，让向导重新去 C 站抓取原汁原味的完整数据。)

## 36. The API Response Mismatch & Cache Deadlock (前后端格式割裂与缓存死锁)
**The Problem (问题)**: `api.py` was updated to send an array of strings (`['/view?...']`) but `main.js` expected objects (`[{url: '/view?...'}]`). When trying to fix `main.js`, the browser's aggressive caching of ComfyUI extensions meant the fix never propagated. Changing `api.py` to match the cached JS failed until the ComfyUI server was restarted, causing a "nothing works" deadlock.
(后端发送字符串，前端却按对象去读取，导致图片全部变成 `undefined` 的隐形方块。试图修改前端修复时，遇到浏览器死忠缓存；试图修改后端去迎合缓存时，又遇到 ComfyUI 不重启不重新加载后端的死锁，导致两头受堵。)
**The Solution (方案)**: Implement "Double-Blind Compatibility". The backend strictly returns structural objects `{'url': ...}` to satisfy legacy cached frontends, and the frontend JS falls back via `el.src = img.url || img;` to parse anything. Most importantly: ALWAYS restart ComfyUI completely when touching backend Python APIs.
(实施"双盲兼容"。后端退回发送对象格式来迎合那些死活不肯刷新的旧版缓存；前端同时加上 `img.url || img` 双轨读取能力。最核心的教训：只要改了后端的 Python 文件，别折腾了，必须彻底重启整个控制台黑框。)

## 37. The Identifier Collision Catastrophe (变量重名引发的插件暴毙)
**The Problem (问题)**: When moving the "Model Doctor" button from TopNav to the Sidebar, a new `const doctorBtn` declaration was injected without removing the original one. Since both lived in the same function scope, JavaScript threw `SyntaxError: Identifier 'doctorBtn' has already been declared` at parse time, which silently killed the **entire** plugin before any code executed — including the trigger icon.
(把"模型医生"按钮从顶部导航栏搬到底部侧边栏时，新代码里声明了一个新的 `const doctorBtn`，但旧的那个忘删了。由于两个 `const` 在同一个函数作用域里，JS 直接在编译阶段就报语法错误，整个插件的代码一行都不会执行——连那个 📦 入口图标都跟着蒸发了。)
**The Solution (方案)**: When relocating UI elements across DOM zones, always perform a full-text search for the old declaration and its associated event handlers. Remove **both** the element creation AND its `appendChild` call. A single leftover `const` can nuke an entire 5000-line module.
(搬家 UI 元素时，必须全局搜索旧的变量声明和所有关联调用（创建、事件绑定、appendChild），全部清理干净。一个多余的 `const` 就能让整个 5000 行模块原地爆炸。)

## 38. The `this` vs Closure Scope Mismatch (this 指向错误导致的静默失败)
**The Problem (问题)**: `hideAllPanels()` was defined as a plain `const` closure function inside `createDOM()`, but the doctor button's click handler called it as `this.hideAllPanels()`. Since it was never defined as a class method, `this.hideAllPanels` resolved to `undefined`, and calling `undefined()` threw a TypeError — silently aborting the entire click handler. The doctor panel never became visible, and the node listener never activated, making it look like the button "did nothing".
(`hideAllPanels()` 是 `createDOM()` 内部的一个普通闭包函数，但医生按钮的点击回调里错误地用 `this.hideAllPanels()` 去调用它。由于它并不是类方法，`this.hideAllPanels` 为 `undefined`，直接抛出 TypeError。这个错误静默中断了整个 onclick 执行链——面板没打开、节点监听没激活，用户只看到"按钮点了没反应"。)
**The Solution (方案)**: Audit every function reference in click handlers. If it's a closure-scoped `const`, call it directly (`hideAllPanels()`). If it's a class method, call via `this.`. Mixing the two is the most common silent-failure trap in Vanilla JS class patterns.
(必须逐一审计点击回调里的每个函数引用。闭包函数直接裸调，类方法才走 `this.`。两者混用是原生 JS 类模式中最常见的静默失败陷阱。)

## 39. The Tool-Escaped Backslash Corruption (编辑工具转义反斜杠的连环陷阱)
**The Problem (问题)**: When fixing a Python `str.replace('\\', '/')` call via code-editing tools, the tool's internal escaping mechanism quadrupled the backslashes: the file ended up containing `replace('\\\\', '/')`, which searches for a **four-character** literal string `\\\\` that never exists in real Windows paths. The fix was invisible because the diff output *looked* correct due to terminal rendering also escaping backslashes. This wasted two full restart-debug cycles.
(通过代码编辑工具修复 Python 的 `replace('\\', '/')` 时，工具内部的转义机制把反斜杠翻了四倍：文件里实际写入的是 `replace('\\\\\\\\', '/')`，也就是在搜索一个根本不存在的四字符字符串。更可怕的是，diff 输出看起来是对的，因为终端渲染本身也会做转义，所以肉眼完全看不出问题。白白浪费了两轮重启调试。)
**The Solution (方案)**: **Never use hardcoded backslash literals in Python path operations when editing through intermediary tools.** Use `os.sep` or `os.path.normpath()` instead. These are immune to any escaping chain and are also cross-platform correct. Always verify the actual file content with `view_file` after editing path-related strings.
(通过中间工具编辑路径代码时，**永远不要手写反斜杠字面量**。用 `os.sep` 或 `os.path.normpath()` 代替，它们对任何转义链路完全免疫，且天然跨平台。编辑完路径相关字符串后，务必用 `view_file` 验证文件里的实际内容。)

## 40. The Uninitialized State Guard (未初始化状态的跨入口崩溃)
**The Problem (问题)**: When a user clicked "View Model Profile" from the Model Doctor panel *without ever having opened the main browser grid*, `showDetail()` → `renderSidebar()` was called. But `renderSidebar()` internally accessed `this.foldersData.length`, and since `loadFolders()` (which populates `foldersData`) only runs when the main grid initializes, `foldersData` was `undefined`. The resulting `Cannot read properties of undefined (reading 'length')` error aborted the entire transition. Similarly, `this.historyStack` could be undefined if accessed before the class constructor's initialization path completed.
(用户直接从模型医生面板点击"查看模型档案"，但此时**从未打开过主浏览器网格**。`showDetail()` 内部调用了 `renderSidebar()`，而 `renderSidebar()` 访问了 `this.foldersData.length`。由于 `loadFolders()`（负责填充 `foldersData`）只在主网格初始化时运行，此时 `foldersData` 还是 `undefined`，直接报错崩溃。类似地，`historyStack` 如果在构造函数初始化路径完成前被访问，也会 undefined。)
**The Solution (方案)**: Any cross-entry-point function (accessible from multiple UI paths like Doctor → Detail, or Grid → Detail) must defensively guard ALL state dependencies. Use `this.historyStack = this.historyStack || [];` and `if (this.foldersData) this.renderSidebar();`. Never assume the "happy path" initialization order.
(任何可以从多个 UI 入口调用的函数，必须对所有状态依赖做防御性守卫。用 `this.x = this.x || []` 和 `if (this.x)` 兜底。永远不要假设"正常流程"的初始化顺序。)

## 41. Ternary String Replace Crash (暴力替换引发的连锁崩溃)
**The Problem (问题)**: Using Python `code.replace()` to globally replace localized strings with `window.anomalous_browser_lang === 'zh' ? ... : ...` was efficient but dangerous. A previous script accidentally deleted the declaration of `const checkUnscannedBtnRef` in the language toggle handler while doing a replacement. The missing declaration caused a `ReferenceError`, which crashed the `langBtn.onclick` event silently halfway through execution. This left the user permanently stuck in an English interface with no way to switch back, as the re-render code was never reached.
(在使用脚本暴力全局替换双语三元运算符时，不小心干掉了某一个不相干按钮的 const 声明，导致点击语言切换时直接触发 `ReferenceError` 崩溃。最终结果是，界面再也无法切换回中文，用户被死死锁在英文界面里且没有任何明显报错。)
**The Solution (方案)**: Always test interactive elements (like Language toggles) thoroughly after bulk string replacements. If a bulk replace is needed, verify syntax with `node -c web/main.js` and double-check variable scopes.
(每次用脚本跑完正则替换后，一定要检查所有的点击事件是否还能完整跑完。或者用 `node -c` 检查语法。)

## 42. The CSS ID "Display None" Trap (幽灵般的 CSS ID 冲突)
**The Problem (问题)**: We tried to fix a dynamic translation bug by adding an ID to a DOM element (`settingsBtn.id = 'anomalous-settings-btn'`). However, the original developer had previously written a CSS rule `#anomalous-settings-btn { display: none !important; }` in `styles.css` (inside a narrow-mode `@container` query). By adding the ID, we unintentionally activated the CSS trap, causing the settings button to vanish completely!
(为了让 JS 能够抓取齿轮按钮更新中英文，我们给它加上了 `anomalous-settings-btn` 这个 ID。没想到 CSS 样式表里竟然潜伏着一条专门针对这个 ID 的 `display: none` 隐藏规则。加上 ID 的瞬间，齿轮按钮就因为命中规则而原地蒸发了！)
**The Solution (方案)**: Never assign generic DOM IDs without `grep` searching the `.css` files first! We changed the ID to `anomalous-global-settings-btn`, completely sidestepping the hidden CSS rule.
(在给已有组件加上新的 ID 时，必须先搜索整个 `.css` 文件确认是否撞名！最终我们用 `anomalous-global-settings-btn` 作为新 ID 绕过了这个地雷。)

## 43. The Hash Injection Toggle Misunderstanding (哈希注入总闸的认知错位)
**The Problem (问题)**: The system relied on `anomalous_inject_hash` (Model Provenance Binding) to inject and read hashes. Users misunderstood this toggle, thinking they could turn it off and still use the Model Doctor to auto-fix nodes. Without the injected hashes, the Model Doctor was completely blind.
(用户误以为关掉“模型溯源绑定”不影响模型医生的工作，结果关掉后生成的工作流完全没有哈希值，导致不论怎么用深度扫描，医生都无法替换爆红节点，形成了一个逻辑认知死锁。)
**The Solution (方案)**: Explicitly documented in the README and Help Panel that the Model Doctor STRICTLY REQUIRES workflows to be exported with this plugin's hash injection enabled.
(在所有文档和帮助面板中加上极其醒目的警告，明确指出模型医生的前提条件，打破用户的认知盲区。)

## 44. UI Documentation Factual Disconnect (UI 文档的物理错位)
**The Problem (问题)**: The `Deep Hash Scan` button was physically moved to the `Model Doctor` panel, but the README and in-app Help Panel still told users to find it in the `Scan Wizard` / `Settings` panel.
(把“深度哈希扫描”按钮从设置面板搬到了模型医生面板里，但说明书和 UI 帮助文本没跟着改，还在让用户去设置面板里找，导致用户完全找不到。)
**The Solution (方案)**: Restructured the documentation into a strict visual-flow-based SOP (Standard Operating Procedure). Every UI feature mentioned in the docs is now paired with its exact corresponding Emoji icon (e.g., 🩺, 🤖) and location, completely eliminating navigational ambiguity.
(按视觉动线重构了整份说明书。给文档里提到的每一个按钮都加上了精准的 Emoji 图标（如 🩺、🤖）和精确位置定位，实现了文档与界面的 100% 物理映射。)

## 45. Backup Files Are State, Not Garbage (`.civitai_bak.*` 不是垃圾而是恢复状态)
**The Problem (问题)**: A broad sidecar-cleanup rule made deletion and rename sound identical and treated every matching suffix as disposable. This hid two risks: `.civitai_bak.*` is the persistent source used by Reset, and model extensions in a cleanup list can delete a legitimate same-stem model. A missing backup could also leave Reset deleting the only active preview.
(过宽的伴生文件清理规则把“删除”和“重命名”说成了同一件事，还把所有同后缀文件都当成垃圾。这掩盖了两个风险：`.civitai_bak.*` 是重置封面的永久恢复源；把模型扩展名放进清理列表还可能误删同名但不同格式的真实模型。备份缺失时，重置也可能删掉唯一封面。)

**The Solution (方案)**: Treat the operations as separate lifecycle transitions. Custom covers only replace `.preview.*`; Reset restores a Civitai backup atomically, falls back to an untouched bare cover, or preserves the only preview and warns. Rename migrates sidecars, while deletion cleans them only after the main model is gone and only when no same-stem model survives. Use fixed suffix tuples and bounded exact-path checks so cost does not grow with directory size.
(把这些操作视为不同的生命周期转换：自定义封面只替换 `.preview.*`；重置优先原子恢复 C 站备份，其次回退到未动过的裸封面；若当前预览是唯一图片则保留并提示。重命名是迁移伴生文件，删除则只在主模型成功删除且没有同名模型存活时清理。扩展名使用固定元组和有上限的精确路径检查，性能不随目录文件数量增长。)

## 46. Cache Busting Can Become Cache Destruction (缓存刷新不能变成缓存摧毁)
**The Problem (问题)**: The backend already versioned preview URLs with the file modification time, but the frontend appended `Date.now()` after every model-list refresh. Every unchanged image/video therefore received a brand-new URL and had to be fetched and decoded again. At the same time, synchronous metadata/header reads and one full model-library walk per missing node multiplied disk work on large installations.
(后端本来已经用封面修改时间生成版本号，前端却在每次列表刷新时继续追加 `Date.now()`。于是完全没变化的图片和视频也会得到新 URL，被浏览器重新读取和解码。同时，同步元数据/模型头读取以及“每个爆红节点遍历一次全库”又把大型模型库的磁盘开销成倍放大。)

**The Solution (方案)**: Use stable nanosecond file-version tokens, bounded signature-aware metadata/header caches, one `os.scandir()` inventory per current folder, worker threads for large disk operations, chunked/lazy media rendering, and type-grouped batch resolution. Cache invalidation remains tied to physical file signatures, and batch resolution delegates every item to the unchanged identity decision function.
(使用稳定的纳秒文件版本号、带物理签名的有界元数据/模型头缓存、当前目录单次 `os.scandir()` 清单、磁盘任务工作线程、分帧与懒加载媒体，以及按模型类型分组的批量解析。缓存仍由真实文件签名失效；批量接口中的每一项仍交给完全相同的身份判定函数，因此提速不以削减效果为代价。)

## 47. A Small Card Can Decode a Huge Cover (小卡片也可能吃掉整张大图的内存)
**The Problem (问题)**: CSS makes a 4K cover look like a small card, but Chromium may still fetch and decode the full-resolution source into RAM/GPU textures. Native lazy loading delays that cost; it does not reduce the decoded size. Always-playing video cards can add more decode buffers even when most cards are offscreen.
(CSS 虽然把 4K 封面显示成一张小卡片，但 Chromium 仍可能把完整原图下载并解码进内存/GPU 纹理。原生懒加载只能延后成本，不能缩小解码尺寸；若视频卡片始终播放，视野外的视频解码缓冲还会继续增加负担。)

**The Solution (方案)**: Give users one understandable Model Settings panel. The balanced image mode serves a cached 512px WebP only to grid cards, while original mode remains available and detail views always retain the source cover. Limit thumbnail generation concurrency, store derivatives only in a bounded temporary cache, activate autoplay only near the viewport, release media immediately on close, and release warm card state after a short idle period. Never resize or rewrite the user's cover in place.
(把选择集中在一个普通用户能理解的“模型设置”面板：流畅模式只给卡片提供缓存的 512px WebP，仍允许用户选择原始封面，且详情页始终保留原图。缩略图生成限制并发，派生文件只进入有上限的临时缓存；自动播放只在视野附近激活，关闭时立即释放媒体，短暂保留卡片热状态后再自动回收。任何时候都不能原地压缩或改写用户封面。)

## 48. Semantic Diff Must Not Become a Graph Diff (语义 Diff 不能偷偷膨胀成整图 Diff)
**The Problem (问题)**: Recipe history contains complete serialized graphs, but showing a raw JSON or visual node/link diff would expose noisy internal details, overwhelm the detail panel, and risk surfacing sensitive widget values that the normal parameter view intentionally keeps opaque.
(配方历史保存的是完整序列化图，但直接展示 JSON 或可视化节点/连线差异会制造大量噪声、压垮详情面板，还可能暴露参数页刻意隐藏的敏感控件。)
**The Solution (方案)**: Compare bounded semantic summaries only: prompts, pinned primitives, known model references, safe sampler/resolution fields, graph counts/fingerprint, and presentation metadata. Keep comparison pure and read-only; history restoration remains a separate destructive action with its own confirmation.
(只比较有上限的语义摘要：提示词、钉选原始值、已知模型引用、安全的采样/分辨率字段、图数量/指纹和展示信息。比较器必须是纯只读逻辑，历史恢复仍是独立的破坏性动作并单独确认。)

## 49. Inspect Before Import (导入必须先检查再提交)
**The Problem (问题)**: A recipe package contains user-controlled archive names, JSON, and image bytes. Writing entries directly into the recipe directory would make traversal, symlink, decompression-bomb, dangling-asset, and silent-overwrite failures possible before the UI can explain them.
(配方包里的归档名称、JSON 和图片字节都由用户控制。若直接写进配方目录，路径穿越、符号链接、解压炸弹、悬空资源和静默覆盖都可能在界面解释前发生。)
**The Solution (方案)**: Keep the upload in a bounded single-use inspection record, validate every entry and checksum, show a dry-run summary, then stage the normalized recipe and contained assets before atomic commit. Imports never execute code or install dependencies.
(上传包先保存在有上限、一次性的检查记录中，逐项校验路径、大小、压缩比、校验和和资源引用，展示预检摘要后再把规范化配方和资产写入临时目录并原子提交。导入永远不执行代码，也不安装依赖。)

## 48. Semantic Diff Must Not Become a Graph Diff (语义 Diff 不能偷偷膨胀成整图 Diff)
**The Problem (问题)**: Recipe history contains complete serialized graphs, but showing a raw JSON or visual node/link diff would expose noisy internal details, overwhelm the detail panel, and risk surfacing sensitive widget values that the normal parameter view intentionally keeps opaque.
(配方历史保存的是完整序列化图，但直接展示 JSON 或可视化节点/连线差异会制造大量噪声、压垮详情面板，还可能暴露参数页刻意隐藏的敏感控件。)
**The Solution (方案)**: Compare bounded semantic summaries only: prompts, pinned primitives, known model references, safe sampler/resolution fields, graph counts/fingerprint, and presentation metadata. Keep comparison pure and read-only; history restoration remains a separate destructive action with its own confirmation.
(只比较有上限的语义摘要：提示词、钉选原始值、已知模型引用、安全的采样/分辨率字段、图数量/指纹和展示信息。比较器必须是纯只读逻辑，历史恢复仍是独立的破坏性动作并单独确认。)

## 52. Execution Actions Need One Canvas-Owned Path (执行动作必须统一回到画布)
**The Problem (问题)**: A detached queue action created a second workflow-execution path beside the normal ComfyUI canvas. Maintaining prompt conversion, queue contracts, validation, and UI feedback separately from Open/Append made interaction drift likely and made failures hard to explain.
(脱离画布的快速排队在正常 ComfyUI 画布之外又建立了一条执行路径。提示词转换、排队契约、校验和 UI 反馈都要单独维护，容易造成不同入口行为漂移，也难以解释失败原因。)
**The Solution (方案)**: Remove the detached execution surface and make recipe actions load or transactionally append the saved workflow through shared handlers. List cards and detail panels now reuse the same confirmation, missing-node warning, error feedback, and successful Workspace closure behavior.
(移除脱离画布的执行入口，让配方动作通过共享处理器加载或事务性追加已保存工作流。列表卡片和详情面板统一复用确认、缺失节点提示、错误反馈和成功关闭工作台的行为。)

## 53. Inline Metadata Editing Must Preserve the Full Recipe Contract (内联元数据编辑也必须保留完整配方契约)
**The Problem (问题)**: The update endpoint validates a complete recipe, not a partial metadata patch. A convenient inline editor that sends only `name` or `notes` would either fail validation or tempt the backend to grow a second partial-update contract with weaker history semantics.
(更新接口校验的是完整配方，而不是局部元数据补丁。内联编辑如果只发送 `name` 或 `notes`，要么直接失败，要么会诱导后端新增一套历史语义更弱的局部更新契约。)
**The Solution (方案)**: Keep the inline editor lightweight at the UI layer, but clone and submit the already-loaded complete recipe through the existing update endpoint. Mutate the local view only after a successful response, then refresh the lightweight card list.
(界面可以轻量内联编辑，但仍复制已加载的完整配方并走现有更新接口。只有收到成功响应后才更新当前视图，并刷新轻量卡片列表。)

## 54. Local Matching Must Activate Presentation, Not Rewrite Provenance (本地匹配只激活展示，不改写来源)
**The Problem (问题)**: Imported recipes may contain a model path that is absent on the current machine. Treating a basename or preview hit as authoritative would silently change the workflow's model input or incorrectly promote a visual match to a verified identity.
(导入配方可能引用本机不存在的模型路径。若把文件名或预览命中直接当成权威依据，就会静默改写工作流模型输入，或把视觉命中错误提升为已验证身份。)
**The Solution (方案)**: Keep the saved workflow path and stored identity immutable during lazy matching. Use the existing explicit hash/size/category resolver only after the user requests a match; attach the current local model descriptor transiently for preview and browser navigation, while leaving identity status and workflow content unchanged.
(延迟匹配期间保持已保存工作流路径和身份记录不变。只有用户明确请求后才调用现有哈希/大小/类别解析器；本地模型描述只临时用于预览和跳转，不改变身份状态或工作流内容。)

## 55. Recipe Detail UI Refactoring: Consolidate Information and Guard State Transitions (合并信息噪音与状态切换守卫)
**The Problem (问题)**: The Recipe Detail UI originally had too many tabs separating 'Overview', 'Models', and 'Parameters', causing unnecessary cognitive load. The Quick Queue feature was also highly prone to state bugs due to bypassing the canvas. During refactoring, removing the separate 'Models' tab and injecting them into the 'Overview' caused the preview loading mechanism (which was tied to checking `activeTab === 'models'`) to break.
(Recipe 详情页原本分了太多的 Tab（概览、模型、参数），导致信息过于分散、认知负担过重。同时 Quick Queue 功能由于绕过了画布，极易产生状态 Bug。在重构时，把模型和参数全塞进概览页后，原本绑定在“当处于模型 Tab 时才加载预览图”的机制断裂，导致模型封面无法显示。)
**The Solution (方案)**: Consolidate noisy parameters into a `<details>` fold inside the Overview, simplifying the UI visually. Strip out Quick Queue and standardize on Open/Append logic. Most importantly, when changing Tab semantic structures, carefully audit and update any conditional logic tying background fetching (like preview loading) to active Tab state.
(将杂乱的参数收纳进详情页的 `<details>` 折叠组件中，极大降低视觉噪音。彻底删除 Quick Queue 逻辑并统一为在画布中操作。最重要的是，在改变 Tab 结构时，必须仔细审计并更新那些依赖 Tab 状态的后台加载逻辑（如模型封面预加载），保证从卡片到详情面板的心流与数据流一致。)

## 64. Refresh Commands Need an Explicit Compact Contract
**The Problem**: A UI action that only asks the server to refresh model identities may send `{filename, refreshIdentities}`. Routing that request through a complete-recipe validator makes the button fail even though the stored recipe is valid; a second partial-update path would also risk losing history guarantees.
**The Solution**: Detect the narrowly defined refresh-only payload, deep-copy the existing recipe, and run the same enrichment and archive/write path as a full update. Keep all other update payloads on complete-recipe validation, and match manual origin edits using stable reference provenance rather than display-only fields.
## 65. Imported Recipe Recovery Must Separate Matching from Applying
**The Problem**: An imported workflow stores the author's model path, which is often invalid on the current machine. Treating an exact-path availability refresh as identity matching makes the feature look broken; silently replacing the workflow after a hash match is also unsafe.
**The Solution**: Batch-resolve unresolved references by hash, exact size, and constrained model category while ignoring saved filenames and paths as identity evidence. Show the local candidate first, then require an explicit Apply action that updates the matching widget through the full-recipe update path and preserves history.
## 66. ComfyUI workflow-tab loads need an explicit active workflow

In current ComfyUI frontend builds, `app.loadGraphData(data)` without its fourth argument creates or opens a temporary workflow tab. A plugin that intends to replace the current canvas must pass the active `ComfyWorkflow` object. For legacy-compatible extensions, discover the workflow store from the mounted Vue app's provided Pinia instance when available, then retain the old call as a fallback. Also make plugin-shell cleanup explicit after a successful canvas transition; hiding only the inner panel can leave an empty modal visible when the frontend changes workflow tabs.
## 67. Prefer one unambiguous recipe canvas action

When ComfyUI versions give “Open” different meanings—replace the current graph in one version and open a new workflow tab in another—do not preserve a confusing button merely for compatibility. If append is the user's reliable composition primitive, remove Open from cards and detail views. Keep structural editing separate and label it as a confirmed new-canvas edit flow.
## 68. Remove obsolete save-dialog choices without deleting stored data

If a save-dialog option no longer provides value, remove its controls and transient state rather than preserving a misleading interaction. Keep the serialized workflow unchanged, and preserve legacy metadata when editing existing records unless the user explicitly requests a data migration.
## 69. Compact sidebars need explicit flex shrink rules

A responsive sidebar can become unusable even when its parent is correctly sized: text inputs keep a min-content width and push adjacent action buttons out of the hit area. Give the input `min-width: 0` and make the compact action fixed-width. For file-backed galleries, use a no-store head signature poll instead of rebuilding on every timer tick; this keeps live updates without needless DOM churn.
## 70. Use explicit refresh for filesystem-backed galleries when polling is unnecessary

For a gallery whose source is a directory walk, querying only when the panel opens plus an explicit Refresh action is a better default than background polling when users do not require live monitoring. Keep the button visibly busy during the scan and preserve scroll position after rebuilding the first page.
## 71. Recipe galleries must match a structural workflow, not exact run data

**The Problem**: Exact serialized-workflow hashes make a generated image disappear from the recipe that created it as soon as a sampler seed or batch counter changes.

**The Solution**: Canonicalize a narrow, documented set of run-volatile fields before fingerprinting. Retain topology, model values, prompts, sampler choices, and all nonvolatile parameters so the gallery remains a recipe result view rather than a fuzzy similarity search. Keep the scan on demand and bounded; output folders are user data and must never be continuously walked just to decorate a panel.

## 72. A selected output is a cover asset, not a fragile filesystem reference

**The Problem**: An output image can be cleaned up, moved, or unavailable on an imported recipe, so storing only its `/view` locator makes the chosen recipe cover disappear.

**The Solution**: Treat the output path as an input to a one-time, bounded WebP conversion. Save the derived cover in the recipe-owned asset directory, validate its ID, package it independently of optional model-preview snapshots, and keep the original output locator only as local convenience metadata.
## 73. Separate gallery discovery identity from parameter comparison

**The Problem**: A parameter-level workflow fingerprint is useful for integrity, but it is too strict for finding related output images. ComfyUI can emit a UI workflow or an API prompt with different serialization details, and users commonly vary prompts, models, seeds, or sampler settings while using the same graph.

**The Solution**: Use a separate node-composition signature for discovery: sorted node class names with multiplicity, independent of parameters and node IDs. Keep the structural fingerprint for recipe/history integrity. Load one matched image's bounded metadata only after the user asks to inspect it, then show parameter differences explicitly.

## 74. Opening a filesystem gallery is a natural refresh boundary

**The Problem**: A permanent refresh strip adds visual weight to an image-first gallery, while continuous polling is unnecessary for a directory the user can reopen.

**The Solution**: Refresh the main output gallery when its panel is opened. Remove the dedicated toolbar button and keep any future manual refresh as an unobtrusive secondary action only if real usage proves it necessary.
## [Snapshot] 2026-08-04 - Harden Parameter Notebook backend and workspace lifecycle

**Implemented**

- Added missing asynchronous runtime support for the Parameter Gallery endpoint.
- Made parameter signatures understand both UI workflow widget values and API prompt inputs, while retaining volatile-field filtering.
- Added parameter notebook object/workflow validation, bounded payloads, safe atomic writes, strict fingerprint validation, and background directory reads.
- Ensured the Parameter Notebook overlay participates in panel hiding and Workspace close/restore behavior; stale selections and failed deletes now recover visibly.

**Validation**

- `node --check web/main.js`
- `node --check web/modules/ui_parameters.js`
- `node --check web/modules/ui_recipe_detail.js`
- `node --check web/modules/ui_recipes.js`
- `node --check web/modules/ui_sidebar.js`
- `python_embeded/python.exe -m py_compile api/__init__.py api/parameters.py api/recipes.py api/recipe_packages.py`
- `python_embeded/python.exe tests/test_recipe_roundtrip.py` (15 tests passed)
- `node tests/recipe_parser_roundtrip.mjs`