# 📖 Error & Experience Summary (开发避坑与经验总结)

This document serves as an architectural retrospective and UX diagnostic log for the development of the Anomalous Model Browser.
这份文档旨在记录 Anomalous 插件开发过程中的架构演进、UX 设计教训以及核心 Bug 排查经验。

---

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

## 4. "Hostage" Inline Confirmations (被“绑架”的内联确认)
**The Problem (问题)**: Clicking "Delete" changed the button to "Are you sure?" with a 3-second timeout, but lacked a "Cancel" button. Users misclicking were held hostage for 3 seconds.
(点击删除后会变成“确定删除吗？”并锁定 3 秒，但没有“取消”按钮。用户如果不小心点错，只能像被绑架一样干等 3 秒它恢复。)
**The Solution (方案)**: Wrapped the logic to instantly reveal a secondary `[✕]` cancel button upon the first click, giving control back immediately.
(在点击删除时，立马在旁边弹出 `[✕]` 取消按钮。点击取消直接清空倒计时，立刻把控制权还给用户。)

## 5. First-load "Dead Interface" Avoidance (首次加载的“白屏假死”)
**The Problem (问题)**: Initializing the sidebar to the root directory `/` presented a blank screen if users only had models nested deep in subfolders.
(插件默认打开根目录 `/`。如果用户的模型全都在很深的子文件夹里，打开插件就会看到一片空白，以为插件坏了。)
**The Solution (方案)**: Implemented `firstLoadDone` to automatically force the UI to open the very first directory possessing `model_count > 0`.
(加入了智能寻路逻辑，插件首次加载时自动扫描目录树，直接定位并打开第一个存有模型的文件夹。)

## 6. Structural Layout Breakages (流式布局的坍塌)
**The Problem (问题)**: Placing varying lengths of translation tags sequentially caused extreme layout jitter when hovering.
(把中英文标签简单并排放在一起，由于字符串长度不一，鼠标悬浮时极容易发生换行挤压，导致整个界面疯狂跳动。)
**The Solution (方案)**: Enforced a strict "Row-based" flex architecture (`align-items: stretch`). Each tag pair is locked into a geometrical row.
(采用极其严格的行级 Flex 布局，把中英文双语硬性锁死在同一个拉伸行内，无论字数多少，几何结构绝对稳定。)

## 7. Modal State Persistence (弹窗状态的幽灵)
**The Problem (问题)**: Closing and reopening the Notebook modal showed a blank editor because the JS object cached `this.currentNotebook` but the DOM was obliterated.
(关掉笔记本弹窗再打开，右侧编辑器全空。因为 JS 内存里还记着上一次的状态，但 DOM 节点已经被销毁重建了。)
**The Solution (方案)**: Explicitly check cached state during modal initialization and force `renderNotebookEditor()` if necessary.
(在弹窗初始化时主动校验缓存，强制触发重新渲染，实现了完美的“会话级记忆”。)

## 8. Missing Visual Feedback for Background Operations (无反馈的幽灵进程)
**The Problem (问题)**: The Notebook "Save" button executed a background `fetch` perfectly, but provided absolutely no visual feedback. Users assumed it was broken.
(点击“保存”按钮后，后台默默完成了请求，但按钮本身没有任何变化。用户以为没点上，引发数据丢失的焦虑。)
**The Solution (方案)**: Clicking Save instantly changes the button to a green `✅` state for 1.5 seconds.
(点击保存后强制变绿 `✅` 1.5 秒，给用户极强的心理安全感。)

## 9. Spatial Geometry for Multi-Node Spawning (多节点生成的空间重叠)
**The Problem (问题)**: Spawning an entire Notebook (Main Model + Loras + CLIPs) caused all nodes to clump perfectly at `(0,0)`.
(一键生成整个笔记本（主模型+N个Lora+提示词）到画布时，所有节点全叠在同一个坐标上，变成了一坨。)
**The Solution (方案)**: Implemented a "Relative Offset Matrix Layout" (`X + 350*N`, `Y + 250`) and bound it to the `mousemove` event (Magnetic Sticking).
(加入了偏移矩阵计算，并绑定鼠标移动。用户可以直观地拖着排成流水的节点序列在画布上移动，然后再点击放下。)

## 10. Localization Host-Environment Constraints (寄生环境的本地化陷阱)
**The Problem (问题)**: Reading `document.documentElement.lang` failed because ComfyUI forces the host HTML to `en-US`, breaking our Chinese translations.
(插件试图读取网页根节点的 lang 属性来决定语言。但 ComfyUI 强行把底座设成了纯英文，导致中国用户永远看不到中文提示。)
**The Solution (方案)**: Never trust the host document properties. Rerouted localization strictly to our internal `currentLang` variable.
(永远不要相信宿主环境。彻底切断外部依赖，纯靠插件内部自己的 `currentLang` 变量来统治中英文环境。)

## 11. Strict Path Separator Validation (路径分隔符的玄学崩溃)
**The Problem (问题)**: Windows uses backslashes (`\`), but assigning `anime/model` to a node's combo widget failed ComfyUI's strict string matching, causing red nodes.
(Windows 的底层模型路径带反斜杠，但前端组件要求精确匹配字符串，哪怕是一个斜杠方向不对，节点也会标红报错。)
**The Solution (方案)**: Built `setWidgetValuePath` to normalize both target paths and native options with `.replace(/\\/g, '/')` before assignment.
(做了一个拦截器，强行把系统内的选项和我们要赋的值全部统一转成正斜杠再进行比较，直接绕过操作系统的路径陷阱。)

## 12. Backend Starvation During Inference (算力挤兑导致的接口饿死)
**The Problem (问题)**: Fetching plugin data while ComfyUI is generating an image causes timeouts because of PyTorch GIL-locking.
(在 ComfyUI 画图满载的时候，点插件会导致接口超时。因为单线程的 Python 完全被 GPU 推理抢占了。)
**The Solution (方案)**: Accept it gracefully. Database management and intense GPU inference are mutually exclusive workflows.
(优雅地接受这个现实。不需要过度工程化地去做离线队列，画图和管理模型本来就不该同时进行。)

## 13. DOM Obliteration vs Virtual DOM Hoarding (物理毁灭 vs 虚拟回收)
**The Problem (问题)**: Maintaining performance when navigating folders containing thousands of models.
(当一个文件夹里有上千个模型时，频繁切换文件夹会导致浏览器内存爆炸。)
**The Solution (方案)**: Instead of `display: none` hoarding, strictly enforce `this.grid.innerHTML = ''` to physically obliterate nodes and trigger immediate Garbage Collection.
(放弃“隐藏重用”的传统思路。切文件夹时直接暴力清空内部的 HTML 节点，强迫浏览器立马回收内存，保持零负担。)

## 14. The "Missing Plugin Icon" Trap (LocalStorage 坐标越界飞天)
**The Problem (问题)**: If the floating trigger button was saved at `X=3000px` on a 4K monitor, loading it on a `1920px` laptop rendered it permanently off-screen.
(在大显示器上把插件按钮拖到了最右边，换到小笔记本上时，坐标超出了屏幕，按钮彻底消失，再也点不出来了。)
**The Solution (方案)**: Implemented a bounds clamp checking coordinates against `window.innerWidth`. If out of bounds, snap it to the bottom-right corner.
(在启动时强制对比当前屏幕大小，一旦发现越界，立刻把它抓回到右下角的安全区内。)

## 15. The `[vite:preloadError]` Template Literal Crash (一个反引号引发的血案)
**The Problem (问题)**: A missing backtick in a dynamic ES Module dictionary crashed the entire ComfyUI extension loader before execution.
(在汉化字典里不小心删掉了一个反引号，导致 Vite 打包工具报语法错误，整个插件直接在加载前暴毙，UI 按钮全都没了。)
**The Solution (方案)**: JS zero-tolerance for syntax errors requires extreme validation. Fixed the missing backtick.
(原生 JS 没有任何编译容错，任何语法拼写都必须如履薄冰，及时修复了那个反引号。)

## 16. Target Size Deduplication Bug (重叠目录的体积匹配悖论)
**The Problem (问题)**: Fixing models by file size required finding *exactly one* matching file. But users mapping `checkpoints` and `diffusion_models` to the same folder caused `os.walk` to find the same physical file twice, aborting the fix.
(物理寻址兜底算法要求“体积必须唯一”。但用户配置了多个虚拟路径指向同一个物理文件夹，导致同一个文件被扫出两次，系统误判为“体积不唯一”而放弃修复。)
**The Solution (方案)**: Added `os.path.realpath` deduplication matrix to condense multiple virtual paths back to a single hard drive sector.
(引入了绝对物理地址 `realpath` 去重机制，无论虚拟路径怎么重叠，物理层面上都将其归一化。)

## 17. The "Lightweight Scan" Re-Hash Catastrophe (轻量扫描的重算灾难)
**The Problem (问题)**: The lightweight scan (`--skip-media`) demanded *both* an `.info` file and a preview image to skip hashing. Since it didn't download images, it forcefully re-hashed hundreds of GBs of models every time.
(轻量化极速扫描因为不会下载图片，导致“是否跳过计算”的判断条件（既有 info 又有图）永远不成立。引发了灾难性的全盘重新计算 SHA256，慢如蜗牛。)
**The Solution (方案)**: Modified skip logic conditionally: if explicitly skipping media, the existence of `.info` is sufficient to bypass hashing.
(加入了情境判断：只要是在极速模式下，不管有没有图，只要有文字信息就无条件跳过，恢复了真正的极速。)

## 18. The Stale Dropdown Visual Residue (顽固的红框残留)
**The Problem (问题)**: Even after a model path was auto-fixed, ComfyUI maintained a permanent red error border on the node if the frontend cache was stale.
(底层其实已经修复并加载了正确的模型，但因为前端选项缓存没刷过来，ComfyUI 死死把节点标红，看着十分闹心。)
**The Solution (方案)**: Forcefully execute `delete node.color; delete node.bgcolor;` to violently strip native error states without requiring a refresh.
(既然修好了，就直接暴力删除节点的 `color` 属性，强行洗白红框，无需刷新网页。)

## 19. The Silent Subprocess Death (DEVNULL 黑洞)
**The Problem (问题)**: `scraper.py` crashed due to Python indentation, but piping `stderr` to `DEVNULL` made it totally invisible. The UI waited forever.
(后台脚本缩进写错了导致崩溃，但代码里把报错信息塞进了无尽深渊 `DEVNULL`，没有任何提示，前端界面只能干等着，陷入死局。)
**The Solution (方案)**: Never pipe `stderr` to DEVNULL during active development. Let it log.
(开发阶段绝对不要屏蔽底层报错，必须让 `stderr` 打印到控制台以便排查。)

## 20. Tiered Fallback Resolution for O(1) Scans (多级降级寻址打造 O(1) 扫描)
**The Problem (问题)**: Unscanned 10GB models required full disk read to calculate SHA256, taking minutes.
(即便是第一次扫描，遇到几十 GB 的新模型，完整计算 SHA256 也要几分钟，用户体验极度卡顿。)
**The Solution (方案)**: 
1. 0ms: Read existing `.info`. (直接读取已有的 info)
2. 0.01s: Extract 64KB JSON header from `.safetensors` via `struct` for pre-computed hash. (用 struct 撬开文件头瞬间提取内置的 Hash，降维打击)
3. Fallback: Full SHA256 only for legacy models. (真找不到了才迫不得已做全量计算)

## 21. Zero-API Tensor Fingerprinting (零API脱机张量基因识别)
**The Problem (问题)**: HuggingFace or private models returned 404 from Civitai, failing to generate `.info` and completely breaking UI integration.
(从 HF 拿到的或者是自己练的私模，由于 C站 没有记录，API 直接报错 404，导致模型彻底被忽略，前端里连看都看不到。)
**The Solution (方案)**: Read the first 500 Tensor Keys via struct. Identifying `double_blocks.0.img_attn` strictly confirms Flux.1 D architecture completely offline.
(不管你有没有网，强行读取模型前 500 层的网络结构。只要看到里面有 `double_blocks`，直接盖章确认为 Flux 架构。完全脱机，无缝融入前端兼容雷达。)

## 22. Gemini-Style Popover UI (告别全屏遮罩，采用悬浮弹窗)
**The Problem (问题)**: Center-screen settings modals with blur backgrounds felt heavy and disconnected users from the workspace.
(原本的设置面板是个带有大面积模糊遮罩的全屏居中弹窗，显得特别笨重，像个垃圾网页游戏。)
**The Solution (方案)**: Refactored to a lightweight side-popover (`left: 100%; bottom: 15px;`) imitating Gemini's web UI, maintaining deep workflow immersion.
(改成绝对定位，像 Gemini 网页端那样从侧边栏右侧悄悄弹出一个悬浮气泡，点外侧自动收起，极大保证了沉浸感。)

## 23. Dock & Mode Lock (全宽底座与多状态锁死)
**The Problem (问题)**: Floating capsules looked cramped, and entering fullscreen Gallery while the Sidebar menu remained clickable caused DOM rendering conflicts.
(底部按钮挤在一起极其难看。而且进入全屏图库的时候，居然还能点左上角的汉堡菜单，导致页面状态直接崩溃交织在一起。)
**The Solution (方案)**: Extended to a 100% width solid Dock. Disabled sidebar triggers during fullscreen views via strict State Locks.
(把底部做成了满宽的实体底座，稳固了视觉重心。一旦进入图库这种排他性的全视图，强行给菜单上互斥锁，彻底断绝乱按引发的 Bug。)

## 24. Resolving "Missing" vs "Unscanned" Conflicts (防重叠逻辑拦截自相踩踏)
**The Problem (问题)**: Deleting a model and reloading the workflow popped BOTH the "Missing Model" dark modal and the "Unscanned Model" orange toast.
(把一个模型删掉后重新加载图片，系统一方面觉得“模型丢了”弹出黑框，一方面因为缓存里没它又觉得它是“没扫过的新模型”弹出橙黄色的警告，两个弹窗叠在一块极其弱智。)
**The Solution (方案)**: The unscanned detector now ignores nodes already flagged with red error colors (`node.color === "#FF3333"`), preventing system overlapping.
(加入了双轨防踩踏：未扫描检测器只要看到这个节点已经红了（彻底丢了），就主动闭嘴放弃拦截，边界极其清晰。)

## 25. The CSS `zoom` Devastation (Zoom 属性对坐标系的降维打击)
**The Problem (问题)**: Using `zoom` to scale the UI broke bounding boxes. `container.offsetHeight > window.innerHeight` caused `Y` coordinates to become negative, permanently launching the window off-screen into the void.
(早期为了偷懒，用 CSS `zoom` 属性来做 UI 缩放。结果它彻底破坏了浏览器的物理坐标系，一旦窗口过大，防越界系统就算出了个负数坐标，导致插件整个闪现飞出屏幕外，再也拖不回来了。)
**The Solution (方案)**: Banned `zoom`. Transitioned to relative scaling via `font-size: calc(16px * var(--anomalous-scale))`. Fixed bounding clamps to execute `< 0` checks last.
(彻底封杀 zoom。改用 `calc(16px * scale)` 的底层字体相对推算放大法。并且把防负数的保底检测代码调到了逻辑的最后一行，永远杜绝负数坐标。)

## 26. Vanilla JS "Fake" i18n Failure (原生状态管理漏斗下的假性汉化失效)
**The Problem (问题)**: Newly added permanent buttons ("UI Scale", "Reset") remained in Chinese when English was toggled. Since we lacked React/Vue two-way binding, they missed the global state update and got stuck.
(新加了“UI缩放”等按钮后，即使点了切换英文，它们还是中文。因为我们没有使用 Vue 的数据绑定，纯靠原生 JS。如果新加了常驻按钮，却忘了把它登记到顶层 `langBtn.onclick` 突变循环里，它就永远被隔离在旧时间线里了。)
(只要是常驻的按钮，必须强制在语言切换中枢里注册重写一遍。同时开发过程中如果遇到“代码没变”的灵异现象，第一反应永远是按 Ctrl+F5 强制破除浏览器静态缓存。)

## 27. The Image Cropping Dilemma (图库的裁切与留白博弈)
**The Problem (问题)**: Using `object-fit: cover` in the image gallery created perfectly uniform grid squares, but brutally decapitated tall images (like 9:16 vertical character portraits).
(在图库排版时，为了让网格看起来绝对整齐，使用了 `object-fit: cover`。结果导致偏长的图片（如 9:16 的人物竖图）顶部和底部被无情裁掉，经常出现“砍头”现象。)
**The Solution (方案)**: Changed to `object-fit: contain` and paired it with a deep black background (`#000`). The images now scale down to fit entirely, and the resulting letterboxing seamlessly blends into the dark UI as a natural frame.
(改为 `object-fit: contain`，完整显示图片。由于底层卡片背景本身就是极黑（`#000`），缩小后产生的黑边完美融入了 UI 背景，不仅没有任何违和感，反而像是一圈高级的画框，一举两得。)

## 28. Vanilla JS Global Click-Outside (原生悬浮面板的全局点击收起)
**The Problem (问题)**: The settings popover only closed if the user explicitly clicked the gear icon again. Clicking elsewhere on the canvas did nothing, making the popover feel rigid and intrusive.
(点击齿轮打开设置悬浮气泡后，必须再点一次齿轮才能关掉。如果随手点一下旁边或者点画布，面板居然不收回，交互显得非常死板和占眼。)
**The Solution (方案)**: Attached a temporary `mousedown` event listener to the `document` when the popover opens. If the click target is outside the modal, it triggers `display: none` and instantly `removeEventListener` to prevent memory leaks.
(面板弹出时，立刻给全局 `document` 挂载一个监听器。只要检测到鼠标点击了面板外部区域，立刻收缩面板，并且**顺手注销掉这个监听器**，实现了极度顺滑的 Gemini 式收放体验且毫无性能负担。)
