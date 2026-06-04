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
   - **Smart Content-Type Detection**: The new scraper engine dynamically parses HTTP network headers. If a Civitai preview is a video, it perfectly saves it as an `.mp4` or `.webm` file rather than a corrupted PNG.
   - **Energy-Saving Previews**: Video previews only play on mouse hover!

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
   - **全媒体探测雷达**：不仅能抓图片，遇到新世代模型的 `.mp4` / `.webm` 视频封面，爬虫会根据 `Content-Type` 报文头精准保存对应的视频格式，彻底告别“损坏的图片”。
   - **节能渲染**：视频只在鼠标悬浮时播放，杜绝显卡资源浪费！

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
