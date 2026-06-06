<div align="center">
  <h1>📦 Anomalous Model Browser</h1>
  <p><strong>A blazing fast, zero-dependency model browser and Civitai scraper for ComfyUI.</strong></p>
  <p>
    <a href="#english">English</a> | <a href="#chinese">中文</a>
  </p>
</div>

---

<h2 id="english">🇬🇧 English</h2>

### 🌟 Why Anomalous Model Browser?

In the rapidly evolving landscape of AI art tools, legacy plugins have become bloated. They introduce heavy frameworks like Svelte and complex `npm` dependency chains just to render a UI, leading to complicated installations and environment conflicts.

**Anomalous Model Browser** was born out of an extreme pursuit of minimalism and high performance:
- **True Zero Dependencies**: We completely abandoned Node.js, Webpack, Vue/React/Svelte, and other heavy frontend tools. The entire extension is written in pure **Native Python + Vanilla JS**!
- **Unmatched Performance**: With a total codebase of under 100KB, it delivers a much smoother experience. No background polling loops, no memory leaks—just plug and play with millisecond response times.
- **Smart Association & Synchronization**: Say goodbye to complex database building. It smartly and seamlessly associates your `.safetensors` files with their corresponding `.info` descriptions and `.png`/`.mp4` previews purely through file naming.

### ✨ Core Features

1. **🌳 Smart Tree View & Infinite Collapse**
   - Automatically reads ComfyUI's physical hard drive mappings (including `extra_model_paths.yaml`).
   - Perfectly supports deep subfolders for Checkpoints, Loras, UNet, Diffusion_Models, etc.
   - Infinite subfolder collapsing allows you to hide cluttered categories with a single click, keeping your interface incredibly clean.
   - Features a smart **One-click Expand / Collapse All** button for rapid structural navigation.

2. **🕵️‍♂️ Floating Quick-Access Button with Drag Memory**
   - Provides a minimalist, draggable 📦 floating button globally. Click to open anytime, close when done.
   - Features local "Drag Memory" (using LocalStorage)—it remembers its exact coordinates across browser refreshes and never blocks your workflow nodes.

3. **📋 Rich Detail Panel & Clipboard Integration**
   - **Native Markdown Rendering**: Perfectly displays rich text fetched from Civitai.
   - **Immersive Full-Panel Scroll**: The entire detail panel scrolls seamlessly, automatically hiding headers to maximize reading space for model descriptions.
   - **Base Model Badges**: The grid view automatically displays glowing Base Model badges (e.g., SDXL, SD 1.5) on the corners of model cards.
   - **One-Click Trigger Words**: Click any individual trained word to instantly copy it, or use the "Copy All" button to copy everything!
   - **One-Click Cleaner**: A dedicated 🗑️ Delete button that not only deletes the model file but also hunts down and deletes associated images and `.info` files.

4. **🤖 Smart Media Civitai Scraper (Multi-Threaded Daemon)**
   - Forget messy CMD windows! Paste your Civitai API Key in the UI (safely saved to both local server config and browser cache).
   - Click `Scan Folder` to silently launch a background daemon thread that computes SHA256, fetches metadata, and automatically renames your local `.safetensors` files to a clean format.
   - **Detailed Scan Reports**: After scanning, the system alerts you exactly how many models were successfully downloaded, renamed, or skipped, and logs any failures.
   - **Strict Verification Engine**: The scraper uses a "triple-check" strict requirement (.safetensors + .info + preview) to ensure your model library is flawless; missing parts trigger an automatic redownload.
   - **Smart Version Deduplication**: Have you ever accidentally downloaded the same version of a model twice with different names? The scanner will detect identical Civitai versions and cleanly permanently delete the redundant clones, ensuring your disk is free of duplicates!
   - **Smart Content-Type Detection**: The new scraper engine dynamically parses HTTP network headers. If a Civitai preview is a video, it perfectly saves it as an `.mp4` or `.webm` file rather than a corrupted PNG.
   - **Standalone Cleanup Button**: We extracted the `.civitai.info` cleanup process into a fast, dedicated `🧹 Clean Duplicate Info` button in the UI.
   - **Energy-Saving Previews**: Video previews only play on mouse hover!

5. **⚡ Workflow Superchargers**
   - **Cross-Folder Compatible Models**: Looking at a Base Model (like Flux.1 D)? The detail panel auto-magically scans all your Loras and Checkpoints across your entire disk and lists 100% compatible models based on internal metadata logic. It strictly de-duplicates models even if your extra paths alias the same folders!
   - **One-Click Auto-Inject**: Don't manually type filenames into nodes anymore! Use the "Apply to Canvas" floating button on any model. It creates the perfect node (CheckpointLoaderSimple, LoraLoader, UNETLoader) and magnetically sticks it to your cursor for precision placement!

6. **🌐 Pure Bilingual Engine & Built-in Manual**
   - **Seamless i18n**: Switch between beautifully formatted pure English or pure Chinese UI with a single click, instantly transforming all buttons, dialogs, and dynamic text.
   - **Interactive Help Modal**: Never feel lost with the built-in `❓ Help` manual explaining every feature natively within the plugin. The sandwich layout ensures the close button is never pushed off-screen regardless of how long the text is.

### 📥 Installation

Say goodbye to `pip install` and `npm install`!

1. Navigate to your ComfyUI custom nodes directory:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. Clone this repository:
   ```bash
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git Anomalous_Model_Browser
   ```
3. **Restart ComfyUI**. You will see the 📦 button in the bottom right corner—installation complete!

---

<h2 id="chinese">🇨🇳 中文说明</h2>

### 🌟 为什么选择 Anomalous Model Browser？

在 AI 绘画工具极速迭代的今天，旧时代的插件已经显得有些臃肿。为了实现复杂的界面，往往引入庞大的框架和繁琐的 `npm` 依赖链，不仅让安装变得复杂，还容易引发各种环境冲突。

**Anomalous Model Browser** 诞生于对“极简主义”和“高性能”的极致追求：
- **真正的零依赖**：我们彻底抛弃了 Node.js、Webpack、Vue/React 等重型武器。全端采用最纯粹的 **原生 Python + Vanilla JS** 编写！
- **降维打击的性能**：不到 100KB 的总代码量，实现了极度丝滑的体验。没有内存泄漏，即插即用，毫秒级响应。
- **智能级联关联机制**：不再需要复杂的数据库，直接通过底层文件名映射，无缝关联 `.safetensors` 与其对应的 `.info` 描述及动态预览媒体。

### ✨ 核心特性

1. **🌳 智能自动层级映射 & 树状折叠**
   - 自动读取 ComfyUI 的物理硬盘映射（包含 `extra_model_paths.yaml`）。
   - 完美支持 Checkpoints、Loras、UNet、Diffusion_Models 等深层子文件夹。
   - 子文件夹无限折叠，一键收起冗杂的分类，界面清爽无比。
   - 侧边栏自带智能 **一键展开 / 收起全部** 按钮，轻松管理海量模型库分类结构。

2. **🕵️‍♂️ 隐形式悬浮交互与“拖拽记忆”**
   - 全局提供一个极简可拖拽的 📦 悬浮按钮，随时点开，用完即关。
   - 拥有浏览器级“拖拽记忆”功能，刷新页面后按钮依然留在你设定的坐标，绝不遮挡工作流节点。

3. **📋 沉浸式详情页与剪贴板神器**
   - **全局滑动沉浸空间**：向下滚动时自动隐藏顶部面板，把 100% 的视觉空间让给模型介绍。
   - **底模高亮角标**：网格视图中，卡片封面会自动贴上 SDXL / SD 1.5 等专属发光底模标签，一目了然。
   - **闪电触发词**：点击任意 Trained Word 闪亮复制，或者点击【复制全部】一键打包。
   - **一键清道夫**：专属的 🗑️ Delete 按钮，不仅删除模型本体，还会顺藤摸瓜清理残余的 `.mp4` 和 `.info`。

4. **🤖 全格式动态刮削引擎 (后台多线程守护)**
   - 全局双端持久化保存 Civitai API Key，一键静默扫描本文件夹。
   - 真正的独立后台多线程，计算海量 7GB 模型 SHA256 时前端 UI 完全不卡顿。
   - **详尽扫描报告**：扫描结束后，系统会弹窗向您详细汇报成功下载的数量、重命名的数量以及失败的信息，进度一目了然。
   - **严苛三证合一**：采用严厉的补齐逻辑，只要发现模型缺失 `.info` 配置文件或预览图其中任何一项，刮削器便会毫不犹豫地向服务器请求补齐残缺，确保您的模型生态完美无瑕。
   - **智能版本号去重守护**：后台扫描不仅会匹配信息，一旦发现某个模型在同文件夹下存在版本号完全一致的“多余分身”，它会毫不犹豫地将冗余副本永久删除，保证你的模型库只有唯一规范的版本！
   - **独立重复 Info 清理**：历史遗留的冗余 `.civitai.info` 文件清理功能被独立为顶部的 `🧹 清理重复 Info` 按钮，一秒即可全盘扫描并完成清理。
   - **全媒体探测雷达**：不仅能抓图片，遇到新世代模型的 `.mp4` / `.webm` 视频封面，爬虫会根据 `Content-Type` 报文头精准保存对应的视频格式，彻底告别“损坏的图片”。
   - **节能渲染**：视频只在鼠标悬浮时播放，杜绝显卡资源浪费！

5. **⚡ 生产力飞跃 (Workflow Superchargers)**
   - **跨次元兼容模型雷达**：当你在查看 UNet (比如 Flux.1 D) 时，详情页底部会自动跨硬盘、跨文件夹为您检索出全部绝对兼容的 Lora / Checkpoints！并且完美自带系统级别的物理路径去重机制，即便你的 `extra_model_paths.yaml` 怎么套娃映射，都绝不显示重复项。
   - **一键磁吸加载器**：告别手动搜索文件名！鼠标悬停在模型上点击【投放到画布】，系统会自动为你生成匹配的节点 (如 LoraLoader、UNETLoader)，并将其磁吸在你的鼠标上！你只需要在画布的合适位置点一下左键，节点就会被优雅地放置好，丝滑无比。

6. **🌐 纯净双语引擎与内置说明书**
   - **无缝 i18n 切换**：一键在纯中文与纯英文界面间自由切换，告别拥挤的双语混排，所有弹窗与提示会瞬间自适应目标语言。并针对英文排版做了动态文字缩放，确保界面永不换行崩塌。
   - **交互式帮助面板**：内置随叫随到的 `❓ 帮助` 面板，提供中英文纯血的详细说明书，再也不用切回 GitHub 看使用文档了！三明治结构设计保证关闭按钮永远固定在视野内，不会因为文字过多而点不到。

### 📥 极简安装说明

告别 `pip install` 和 `npm install`！

1. 进入你的 ComfyUI 自定义节点目录：
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. 将本仓库克隆（或直接拖入）该目录中：
   ```bash
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git Anomalous_Model_Browser
   ```
3. **彻底重启 ComfyUI**，在网页右下角看到 📦 按钮，即代表安装成功！

---

## 📜 License
MIT License
