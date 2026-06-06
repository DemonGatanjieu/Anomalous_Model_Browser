# 插件开发纠错与经验沉淀 (Error & Experience Summary)

在开发与完善 `Anomalous_Model_Browser` 插件的过程中，我们遇到了几个典型的技术陷阱与用户体验问题。为了便于后续维护和其他开发者参考，特在此归纳沉淀：

## 1. 后台 API 数据传递与作用域异常 (UnboundLocalError)
**问题描述**：在重构 `api.py` 中的 `api_compatible_models`（跨文件夹兼容模型扫描）逻辑时，遇到了前端抛出 500 错误（`Failed to load`）。
**根源分析**：在 Python 中，如果一个变量（如 `rel_subfolder`）在 `if` 语句块内部被赋值，但在执行时该 `if` 条件未满足，后续代码又尝试读取该变量，就会引发 `UnboundLocalError`。在我们早期的代码缩进修复中，因为缩进层级错乱，导致赋值语句和读取语句的逻辑层级脱节。
**解决方案**：严格对齐缩进，并确保所有分支（尤其是 `preview_url` 等变量）在被使用前都有安全的默认回退值（Fallback initialization, 如 `preview_url = ""`）。

## 2. 文件夹别名导致的重复加载问题 (Duplicate Models)
**问题描述**：前端模型兼容列表出现了两个完全一模一样的 Flux 模型。
**根源分析**：前端触发搜索时，同时传入了 `checkpoints,unet,diffusion_models` 三个目录作为扫描目标。而在 ComfyUI 的环境配置中，`unet` 和 `diffusion_models` 经常被映射到硬盘上的**同一个物理文件夹**。后台在遍历时，对同一个文件夹扫描了两次，导致相同文件被重复添加。
**解决方案**：使用 `seen_files = set()` 记录已处理文件的**绝对物理路径**（`os.path.realpath(file_path)`），即使软链接或不同挂载点指向同一文件，也能被精准去重拦截。

## 3. 增量扫描逻辑的盲区 (Scanner Skip Logic)
**问题描述**：用户手动删除了某个模型的 `.info` 文件或预览图，点击后台扫描引擎却没有补齐，依然直接跳过。
**根源分析**：早期的增量逻辑比较“偷懒”，只要发现同名的 `.info` 文件存在，就直接 `continue` 跳过，忽略了对预览图的二次检查。
**解决方案**：重写扫描引擎的短路逻辑。采用“三证合一”严苛检查：只有当 `.info` 文件存在，**且**同名的 `[.png, .jpg, .mp4, .webm]` 预览媒体中至少有一项存在时，才允许跳过；否则强制触发 C 站接口进行重扫补齐。

## 4. UI/UX 自适应排版 (Responsive UI)
**问题描述**：模型名称过长时，顶部固定栏被强行撑高并发生换行；说明面板太大导致底部关闭按钮超出屏幕外。
**根源分析**：未对弹性盒子（Flexbox）进行文本溢出控制，且模态框缺乏滚动边界限制。
**解决方案**：
- **单行溢出省略**：对可能超长的标题应用 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;`。
- **三明治模态布局**：对弹出面板应用 `max-height: 90vh`，并对其内部的文本内容层（Body）单独应用 `overflow-y: auto`。这样无论内容多长，只会在中间区域滚动，头部的“X”和底部的“关闭”按钮始终固定可见。

## 5. 安全性审计 (Security Audit)
对后端的关键路由进行了路径穿越（Path Traversal）核查：
- `api_delete_model`, `api_serve_image`, `api_get_models` 均内置了 `if '..' in subfolder` 和 `if '..' in filename` 的强拦截逻辑，确保用户无法通过构造相对路径去跨级删除或访问插件/工作流之外的核心系统文件。
- `api_serve_image` 增加了严格的文件拓展名（extension）白名单字典，强制转换 `Content-Type`，杜绝了把可执行脚本伪装成预览图返回的风险。
