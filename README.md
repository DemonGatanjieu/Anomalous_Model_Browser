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

In the rapidly evolving landscape of AI art tools, legacy plugins like `comfyui-browser` have become somewhat bloated. They introduced heavy frameworks like Svelte and complex `npm` dependency chains just to render a UI, leading to complicated installations and environment conflicts.

**Anomalous Model Browser** was born out of an extreme pursuit of minimalism and high performance:
- **True Zero Dependencies**: We completely abandoned Node.js, Webpack, Vue/React/Svelte, and other heavy frontend tools. The entire extension is written in pure **Native Python + Vanilla JS**!
- **Unmatched Performance**: With a total codebase of under 30KB, it delivers a much smoother experience than the original. No background polling, no memory leaks—just plug and play with millisecond response times.
- **Smart Association**: Say goodbye to complex database building. It smartly and seamlessly associates your `.safetensors` files with their corresponding `.info` descriptions and `.preview.png` images purely through file naming.

### ✨ Core Features

1. **🌳 Smart Tree View**
   - Automatically reads ComfyUI's physical hard drive mappings (including `extra_model_paths.yaml`).
   - Perfectly supports deep subfolders for Checkpoints, Loras, UNet, Diffusion_Models, etc.
   - Infinite subfolder collapsing allows you to hide cluttered categories with a single click, keeping your interface incredibly clean.

2. **🕵️‍♂️ Floating Quick-Access Button**
   - Provides a minimalist, draggable 📦 floating button globally. Click to open anytime, close when done.
   - Features local "drag memory"—it remembers its position and never blocks your workflow nodes.

3. **📋 Rich Detail Panel**
   - **Native Markdown Rendering**: Perfectly displays rich text and images fetched from Civitai.
   - **Flexible Resizer**: Drag the divider to adjust the ratio between the image area and text info area.
   - **One-Click Trigger Words**: Click any trigger word to instantly copy it to your clipboard for seamless pasting into your prompt box!
   - **One-Click Cleaner**: Features a dedicated 🗑️ **Delete Model** button that not only deletes the model file but also hunts down and deletes associated images and `.info` files, saving your precious disk space.

4. **🤖 Built-in Civitai Scraper**
   - Forget messy CMD windows and long Python environment setups!
   - Provides a visual `⚙️ Config` interface. Just paste your Civitai API Key and click `Scan Current Folder` to silently fetch cover images and descriptions for all models in the background.
   - **Absolute Privacy**: Includes a strict `.gitignore` defense layer to ensure your API Key is stored ONLY on your local machine.

### 📥 Installation

Say goodbye to `pip install` and `npm install`!

1. Navigate to your ComfyUI custom nodes directory:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. Clone this repository:
   ```bash
   git clone <YOUR_GITHUB_REPO_URL> Anomalous_Model_Browser
   ```
3. **Restart ComfyUI**. You will see the 📦 button in the bottom right corner—installation complete!

---

<h2 id="chinese">🇨🇳 中文说明</h2>

### 🌟 为什么选择 Anomalous Model Browser？

在 AI 绘画工具极速迭代的今天，旧时代的 `comfyui-browser` 已经显得有些水土不服。它为了实现复杂的界面，引入了庞大的 Svelte 框架和繁琐的 `npm` 依赖链，不仅让安装变得复杂，还容易引发各种环境冲突。

**Anomalous Model Browser** 诞生于对“极简主义”和“高性能”的极致追求：
- **真正的零依赖**：我们彻底抛弃了 Node.js、Webpack、Vue/React/Svelte 等前端重型武器。全端采用最纯粹的 **原生 Python + Vanilla JS** 编写！
- **降维打击的性能**：不到 30KB 的总代码量，却实现了比原版更丝滑的体验。没有后台轮询，没有内存泄漏，做到即插即用，毫秒级响应。
- **智能关联机制**：不再需要复杂的数据库构建，直接通过文件名级联，智能无缝关联你的 `.safetensors` 与其对应的 `.info` 描述、以及 `.preview.png` 预览图。

### ✨ 核心特性

1. **🌳 智能自动层级映射**
   - 自动读取 ComfyUI 的物理硬盘映射（包含 `extra_model_paths.yaml` 映射）。
   - 完美支持 Checkpoints、Loras、UNet、Diffusion_Models 等深层子文件夹。
   - 子文件夹无限折叠，一键收起冗杂的分类，界面清爽无比。

2. **🕵️‍♂️ 隐形式悬浮交互**
   - 全局提供一个极简可拖拽的 📦 悬浮按钮，随时点开，用完即关。
   - 拥有本地“拖拽记忆”功能，绝不遮挡你的工作流节点排版。

3. **📋 全能模型详情页**
   - **Markdown 原生渲染**：完美呈现 Civitai 传回的图文并茂长篇介绍。
   - **左右自由拉伸**：图片区域与文字信息区域支持自由拖拽调节比例。
   - **Trigger Words 一键复制**：点击任意触发词即可秒速复制，无缝填入你的 Prompt 提示词框！
   - **一键清道夫**：提供专属的 🗑️ **Delete Model** 按钮，不仅删除模型本体，还会顺藤摸瓜自动清理配套的图片和 info 文件，拯救你的硬盘空间。

4. **🤖 零代码内置刮削器**
   - 忘掉繁琐的 CMD 黑窗口和冗长的 Python 环境配置！
   - 提供可视化配置界面（`⚙️ Config`），填入 Civitai API Key，一键后台静默抓取本文件夹下所有模型的封面图与简介。
   - **绝对隐私安全**：内置 `.gitignore` 防御层，确保你的 API Key 永远只保存在本地电脑，哪怕开源也绝不泄漏。

### 📥 极简安装说明

告别 `pip install` 和 `npm install`！

1. 进入你的 ComfyUI 自定义节点目录：
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. 将本仓库克隆（或直接拖入）该目录中：
   ```bash
   git clone <你的GitHub仓库地址> Anomalous_Model_Browser
   ```
3. **彻底重启 ComfyUI**，在网页右下角看到 📦 按钮，即代表安装成功！

---

## 📜 License
MIT License
