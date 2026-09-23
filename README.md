<div align="center">

# 🚀 Anomalous Model Browser

**A Comprehensive Creative Workspace & Model Manager for ComfyUI**  
*零依赖 C 站元数据抓取 · 智能模型医生 · 可视化节点助手 · 工作流配方与参数笔记*

<br/>

[![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge&logo=comfyui)](https://github.com/ltdrdata/ComfyUI-Manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Changelog](https://img.shields.io/badge/📖_Changelog-v1.57_Beta-blue?style=for-the-badge)](CHANGELOG.md)
[![Bilibili Video](https://img.shields.io/badge/Bilibili-视频演示-00A1D6?style=for-the-badge&logo=bilibili)](https://www.bilibili.com/video/BV1a1bv68EuA/)
[![YouTube Video](https://img.shields.io/badge/YouTube-Video_Demo-red?style=for-the-badge&logo=youtube)](https://youtu.be/hAvsj7uiaCw)

<br/>

[**English**](#-english) | [**中文说明**](#-中文)

</div>

---

<h2 id="english">🇬🇧 English</h2>

> **Anomalous Model Browser** is an all-in-one management suite for ComfyUI. It empowers your generative workflow with hash-based model scraping, one-click broken-path resolution (Model Doctor), visual LoRA insertion/replacement (Node Assistant), and immutable Workflow Recipes with Parameter Notebooks.

### 🎬 Video Walkthrough & Demos
* 📺 **YouTube**: [Watch Quick Walkthrough on YouTube](https://youtu.be/hAvsj7uiaCw)
* 📺 **Bilibili**: [Watch Video Demo on Bilibili (在哔哩哔哩观看)](https://www.bilibili.com/video/BV1a1bv68EuA/)

### 🌟 Core Capabilities

| 🚀 Feature | 💡 Description |
| :--- | :--- |
| **Comprehensive Model Management** | Automatically extract Base Model architectures, cover images, trigger words, and author info via hash scanning. Customize names, notes, and covers with safe deletion & visual replacement. |
| **Workflow Repair (Model Doctor 🩺)** | Auto-detect missing model nodes when loading external workflows and swap them with matching local paths in one click. |
| **Node Assistant & Presets (🤖)** | Visually replace models or safely insert LoRAs into compatible chains directly from the canvas. Apply node parameters from Workflow Recipes transactionally. |
| **Workflow Recipes & Presets (🧰)** | Save partial or complete workflows with covers, notes, tags, model identities, and parameter snapshots. Partial recipes append to the current canvas; complete recipes open in a new canvas. |
| **Material Library & Polymorphic Drag (✨)** | Save curated bundles (embedded workflow, provenance, reusable node blocks). Polymorphic canvas drag: drop workflow to open, drop prompts to auto-spawn native CLIP text nodes, or drop onto existing nodes to inject parameters. |
| **Customizable Dock & Model Source Hub (🌐)** | Reorganize lower-left shortcuts (pin/unpin/reorder up to 4 tools). Unified Model Source Hub for dual-scope model URL inspection, Civitai/HuggingFace navigation, and canvas Note generation. |
| **Smart Prompt Notebook (📑)** | Architecture-aware compatibility matching for Checkpoints and LoRAs, built-in translation, auto-tagging, and 1-click canvas deployment. |
| **History Gallery (🖼️)** | Native viewer for your `output` folder with mouse-wheel zoom, deletion, and direct drag-and-drop workflow reconstruction onto the canvas. |

### 📦 Quick Installation

1. Open your terminal in the ComfyUI `custom_nodes` directory:
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. Restart ComfyUI. *(Alternatively, install via **ComfyUI Manager** by searching for `Anomalous Model Browser`)*

Open it with **Ctrl + Shift + M**, the floating **📦** button, or **Extensions → Anomalous Model Browser** in ComfyUI's top menu. **ComfyUI Settings → Anomalous Model Browser → Interface** shows the active shortcut and opens ComfyUI's native recorder for changing it, so conflict and reserved-key checks stay centralized. The same page lets the plugin language follow ComfyUI or use a Chinese/English override, and selects exactly one visual entry mode: floating button, native action-bar button, or Extensions menu only. Floating size and style controls appear only in floating mode. The selected mode remains authoritative during action-bar redraws, while the Extensions command stays registered as the recovery path.

<br/>

<details>
<summary><b>📖 Click to Expand: Step-by-Step Operating Guide</b></summary>

<br/>

#### 1. Initialization (Scan Wizard) 🔄
* **Location**: The Scan icon (**🔄**) at the bottom-left of the sidebar.
* **Operation**: Open the Scan Wizard, choose your configuration, and execute the scan with an active network connection to build your local model database.

#### 2. Workflow Repair (Model Doctor) 🩺
* **Location**: The second Stethoscope icon (**🩺**) from the bottom-left.
* **Operation**: When importing foreign workflows with red broken model nodes, click Model Doctor to automatically identify and batch-replace them with local equivalents.

#### 3. Visual Swapping & Presets (Node Assistant) 🤖
* **Location**: The third Robot icon (**🤖**) from the bottom-left.
* **Actions**: Select a node on the canvas to visually replace models or insert LoRAs before/after a compatible MODEL + CLIP chain.
* **Parameter Presets (Beta)**: Switch to **Parameter Presets** to apply recipe-saved parameters to matching canvas nodes in one click (seeds and volatile values are safely ignored).

#### 4. Workflow Recipes & Parameter Notebooks 🧰
* **Location**: Open **Creative Workspace (📑)** and switch to **Workflow Recipes**.
* **Features**: Save graphs with covers, notes, and model hashes. Append recipes to current canvas, inspect parameter differences against outputs, and compare versions. Package import/export is temporarily unavailable. The verified workflow share-code Import / Export Center is in Toolbox.

#### 5. Settings Panel ⚙️
* **Location**: The Gear icon (**⚙️**) at the bottom-left.
* **Options**: Language toggle, UI font scale, hover/autoplay video covers, card thumbnails, and custom folder management.

#### 6. Creative Workspace & Prompt Notes 📑
* **Location**: Top navigation tabs (**Models 📦**, **Gallery 🖼️**, **Workspace 📑**, **Dock Side ◧**).
* **Usage**: Select a Base Model architecture, attach compatible LoRAs, paste & auto-tag bilingual prompts, and click **Send to Canvas** to deploy directly.

#### 7. Material Library & Polymorphic Canvas Drag ✨
* **Capture**: Open a generated PNG's parameter details in Gallery or Recipes to save its image and complete workflow, or save selected node parameters. Repeated saves of the same image and selection ask before creating another copy.
* **Find and reuse**: In Workspace → Material Library, search names, tags, or node types; filter by type/tag; edit names and tags in a material's details.
* **Polymorphic Canvas Drag**: Dragging workflow materials to blank canvas opens the workflow. Dragging prompt-only materials to blank canvas automatically spawns native `CLIPTextEncode` nodes with pure prompt text and standard ComfyUI dark theme coloring. Dragging materials onto existing nodes injects parameters directly into compatible fields.
* **Storage**: Materials live in the ComfyUI user directory under `workflows/anomalous_materials`. Prompt Notes use `workflows/anomalous_notebooks`; old notes in the extension are copied on first access, retaining originals.

#### 8. Customizable Tool Dock & Model Source Hub 🌐
* **Customizable Shortcut Dock**: The lower-left navigation bar supports up to 4 user-customized tool slots (default: Scan, Doctor, Assistant, Materials). Drag tools between the Toolbox catalog and shortcut bar, or use the accessible "•••" card menu and button right-click menus to pin, unpin, and reorder shortcuts effortlessly.
* **Model Source Hub**: Access the Source Hub from Toolbox to inspect model download URLs across the active workflow and full library. Jump directly to Civitai, HuggingFace, Liblib, or ModelScope, edit custom source links, sync metadata, and create non-intrusive canvas Note documentation with one click.

> [!WARNING]
> **Beta Data Protection:** Workflow Recipes, Material Library, and Parameter Presets are currently in active preview. Please back up `workflows/anomalous_recipes`, `workflows/anomalous_materials`, and `workflows/anomalous_parameters` inside your ComfyUI user directory before updating.

</details>

---

<h2 id="中文">🇨🇳 中文说明</h2>

> **Anomalous Model Browser** 是为 ComfyUI 量身打造的全能创作工作台与模型管家。告别复杂的模型长路径，集成基于哈希的零依赖 C 站元数据抓取、一键拯救爆红节点的“模型医生”、可视化模型替换与 LoRA 插入的“节点助手”，以及支持参数复用的“工作流配方与笔记本”体系。

### 🎬 视频演示与教程
* 📺 **哔哩哔哩 (Bilibili)**：[在 B 站观看快速上手与使用演示](https://www.bilibili.com/video/BV1a1bv68EuA/)
* 📺 **YouTube**：[在 YouTube 观看视频演示](https://youtu.be/hAvsj7uiaCw)

### 🌟 核心特性速览

| 🚀 功能板块 | 💡 详细说明 |
| :--- | :--- |
| **全方位模型管理** | 通过文件哈希自动提取基础架构、封面图、触发词与作者信息；支持看图一键替换模型、自定义备注与安全删除。 |
| **节点智能修复 (模型医生 🩺)** | 导入他人工作流发生节点爆红时，模型医生可自动识别缺失模型并一键替换为本地有效路径。 |
| **节点助手与参数预设 (🤖)** | 画布选中节点即可可视化选图换模型、向兼容链路插入 LoRA，或一键应用工作流配方中沉淀的节点参数（自动跳过易变种子）。 |
| **工作流配方 (🧰)** | 保存局部或整体工作流及封面、标签、模型身份与参数快照；局部配方追加到当前画布，整体配方在新画布打开。 |
| **统一素材库与多态拖拽 (✨)** | 原生 PNG 资产一键打包保存（完整工作流、模型血缘与节点参数）；多态拖拽：拖至空白画布还原工作流或生成原生提示词节点，拖至已有节点智能注入参数。 |
| **自定义快捷栏与来源中控 (🌐)** | 底部左侧快捷栏自由定制（拖拽或右键最多容纳 4 个常用工具）；工具箱内嵌来源中控中心，双域检视模型来源 URL，一键直达主流平台并生成 Note 节点。 |
| **智能提示词笔记 (📑)** | 架构级兼容性匹配（主模型+兼容 LoRA），内置双语分块翻译与标签编辑，支持一键打包发送至画布。 |
| **原生出图图库 (🖼️)** | 原生读取本地 `output` 文件夹，支持滚轮缩放与安全删除，**直接将图片拖拽至画布即可原地还原工作流**。 |

### 📦 快速安装

1. 在 ComfyUI 的 `custom_nodes` 目录下打开终端执行：
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. 重启 ComfyUI 即可使用。（*也可以直接在 **ComfyUI Manager** 搜索 `Anomalous Model Browser` 点击安装*）

可以按 **Ctrl + Shift + M**、点击画布上的悬浮 **📦**，或从 ComfyUI 顶部菜单 **扩展 → Anomalous Model Browser** 打开。**ComfyUI 设置 → Anomalous Model Browser → 界面** 会显示当前快捷键，并可直接打开 ComfyUI 原生录入窗口修改，因此冲突与保留按键检查仍然只有一套。该页面还可以让插件语言跟随 ComfyUI 或单独固定为中文/English，并严格三选一显示悬浮入口、运行按钮旁的原生顶部入口或仅使用扩展菜单。只有选择悬浮入口时才显示大小和样式选项。顶部栏重绘不会擅自改变所选模式，扩展菜单命令则始终保留，便于恢复设置。

<br/>

<details>
<summary><b>📖 点击展开：标准操作指南（图文步骤）</b></summary>

<br/>

#### 1. 前置准备 (扫描向导) 🔄
* **入口位置**：侧边栏左下角 **扫描图标 (🔄)**。
* **操作步骤**：首次使用请先打开扫描向导，根据需要选择扫描模式并执行（请保持网络畅通）。扫描完成后即建立本地模型库，全面激活插件特性。

#### 2. 拯救爆红 (模型医生) 🩺
* **入口位置**：侧边栏左下角第二个 **听诊器图标 (🩺)**。
* **操作步骤**：载入他人工作流或图片出现红框缺失报错时，点击模型医生即可智能识别缺失项并一键批量映射为本地正确路径。

#### 3. 选中交互与预设 (节点助手) 🤖
* **入口位置**：侧边栏左下角第三个 **机器人图标 (🤖)**。
* **动作功能**：在画布选中模型节点后，可在“动作”页可视化换模，或在兼容的 MODEL + CLIP 链前后插入 LoRA。
* **参数预设（测试）**：切换至“参数笔记本”页，可读取配方中同类型节点的保存参数并一键应用（自动忽略易变种子）。

#### 4. 工作流配方与参数笔记本 🧰
* **入口位置**：顶部 **创作工作台 (📑)** ➔ 切换至 **工作流配方**。
* **主要功能**：保存当前节点图、封面、标签与参数快照；未闭合的局部配方追加到当前画布，可独立运行的整体配方在新画布打开，并支持出图参数差异对比、版本回滚。配方包导入和导出暂未开放；已验证的工作流分享码导入导出中心位于实用工具箱。

#### 5. 个性化配置 (设置面板) ⚙️
* **入口位置**：侧边栏左下角 **齿轮图标 (⚙️)**。
* **个性调节**：支持中英文界面切换、字体大小缩放、视频封面悬停/常开播放、缩略图优化与目录黑名单管理。

#### 6. 创作工作台与提示词笔记 📑
* **入口位置**：顶部导航栏 (**模型 📦**、**图库 🖼️**、**工作台 📑**、**侧栏停靠 ◧**)。
* **提示词组装**：选择基础模型架构过滤兼容 LoRA，粘贴提示词并一键双语翻译，点击 **发送到画布** 即可自动连线布署。

#### 7. 统一素材库与多态画布拖拽 ✨
* **保存素材**：在出图图库或配方详情中打开任意生成 PNG 的参数面板，可一键将图片、完整工作流、模型依赖与可复用节点参数打包收藏。相同图片与选区再次保存时会安全提示防重复。
* **查找与管理**：在「工作台 → 素材库」按名称、标签或节点类型实时搜索过滤；卡片详情支持内联重命名与标签修改。
* **多态画布拖拽**：将工作流素材直接拖至空白画布即可原地恢复工作流；将纯提示词素材拖至空白画布会自动创建带有正负区分色（深红/墨绿）的原生 `CLIPTextEncode` 节点；拖入已有节点时则会自动将匹配参数智能注入目标节点中。
* **本地安全存储**：素材存储于 ComfyUI 用户目录下的 `workflows/anomalous_materials`，提示词笔记保存于 `workflows/anomalous_notebooks`，支持原子写入与异常回滚。

#### 8. 自定义快捷栏与模型来源中控 🌐
* **自定义底部快捷栏**：侧边栏左下角原生支持最多 4 个用户自定义工具卡槽（默认：扫描、医生、助手、素材库）。可在实用工具箱与底栏之间自由拖拽工具，或通过卡片“•••”菜单及右键菜单一键 Pin、Unpin 与排序。
* **模型来源中控中心**：在工具箱打开来源中控，可在当前工作流或全局模型库双域下检视全部模型的下载链接，一键直达 Civitai、HuggingFace、Liblib 或 ModelScope，支持自定义模型来源并能一键向画布生成免干扰的 Note 记录节点。

> [!WARNING]
> **测试功能数据安全提醒：** 工作流配方、素材库与参数预设目前属于活跃测试阶段，更新插件前建议备份 ComfyUI 用户目录下的 `workflows/anomalous_recipes`、`workflows/anomalous_materials` 与 `workflows/anomalous_parameters` 文件夹。

</details>

---

### 📝 License & Branding (开源与品牌声明)

* **Code License (代码授权)**: The source code is released under the [MIT License](LICENSE). 本项目源代码基于 MIT 许可证开源，可自由使用、修改与分发。
* **Branding & Trademarks (商标与品牌保护)**: The name **Anomalous Model Browser** and the official logo identify official releases. Forks should use distinct names/branding. 详见 [Trademark and Brand Policy](TRADEMARKS.md)。
