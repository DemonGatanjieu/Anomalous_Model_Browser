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

The old `comfyui-browser` was once a great "Swiss Army Knife" for managing images and workflows. However, as ComfyUI officially introduced built-in local model and workflow managers, the legacy browser's heavy "everything-in-one" approach (requiring Node.js, Svelte, and complex `npm` dependencies) became bloated and prone to environment conflicts.

**Anomalous Model Browser** takes a different path. Instead of reinventing the wheel with a heavy all-in-one file manager, it acts as a **surgical scalpel 100% focused on Model Management and Civitai Integration**.

- **True Zero Dependencies**: We completely abandoned Node.js, Webpack, Vue/React/Svelte, and other heavy frontend tools. The entire extension is written in pure **Native Python + Vanilla JS**!
- **Unmatched Performance**: With a total codebase of under 30KB, it delivers a much smoother experience than the original. No background polling, no memory leaks—just plug and play with millisecond response times.
- **Dedicated to Models**: We don't touch your images or workflows (let the native UI handle that). Instead, we focus on smart association of your `.safetensors` files with their corresponding `.info` descriptions, Civitai markdown scraping, and 1-click trigger word copying.

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
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
3. **Restart ComfyUI**. You will see the 📦 button in the bottom right corner—installation complete!

---

<h2 id="chinese">🇨🇳 中文说明</h2>

### 🌟 为什么选择 Anomalous Model Browser？

早期的 `comfyui-browser` 曾经是一款伟大的“全家桶”式管理工具。但随着 ComfyUI 官方逐渐内置了模型和工作流管理器，这款旧时代插件由于囊括了太多功能，并引入了庞大的 Svelte 框架和繁琐的 `npm` 依赖链，变得异常臃肿且极易引发安装报错。

**Anomalous Model Browser** 拒绝造多余的轮子。我们不去做官方已经内置的图片和工作流管理，而是做一把**专注处理模型管理与 Civitai 联动的“锋利手术刀”**。

- **真正的零依赖**：我们彻底抛弃了 Node.js、Webpack、Vue/React/Svelte 等前端重型武器。全端采用最纯粹的 **原生 Python + Vanilla JS** 编写！
- **降维打击的性能**：不到 30KB 的总代码量，完美避开了重度框架的内存泄漏和环境冲突，做到即插即用，毫秒级响应。
- **只为模型而生**：我们将 100% 的精力倾注在模型刮削上。直接通过文件名级联，智能无缝关联你的 `.safetensors` 与其对应的 `.info` 描述，并提供官方原生管理器完全不具备的富文本 markdown 渲染与一键触发词复制功能。

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
2. 将本仓库整个文件夹放入该目录中。
   如果你使用 git，只需执行：
   ```bash
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
3. **彻底重启 ComfyUI**，在网页右下角看到 📦 按钮，即代表安装成功！

---

## 📜 License
MIT License
