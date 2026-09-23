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

> **Anomalous Model Browser** is an all-in-one management suite for ComfyUI. It equips your workspace with hash-based model scraping, one-click broken-path resolution (Model Doctor), visual LoRA insertion/replacement (Node Assistant), a unified Material Library with polymorphic canvas drag-and-drop, and immutable Workflow Recipes with Parameter Notebooks.

### 🎬 Video Walkthrough & Demos
* 📺 **YouTube**: [Watch Quick Walkthrough on YouTube](https://youtu.be/hAvsj7uiaCw)
* 📺 **Bilibili**: [Watch Video Demo on Bilibili (在哔哩哔哩观看)](https://www.bilibili.com/video/BV1a1bv68EuA/)

### 🌟 Core Capabilities

| 🚀 Feature | 💡 Description |
| :--- | :--- |
| **Comprehensive Model Management** | Automatically extract Base Model architectures, cover images, trigger words, and author info via hash scanning. Customize names, notes, and covers with safe deletion & visual replacement. |
| **Toolbox & Customizable Dock (🧰)** | Centralized toolbox catalog housing 9 built-in tools. Customizable lower-left navigation bar supporting up to 4 user-pinned tool slots via drag-and-drop or context menu. |
| **Workflow Repair (Model Doctor 🩺)** | Auto-detect missing model nodes when loading external workflows and swap them with matching local paths in one click, supported by on-demand dynamic SHA256 verification. |
| **Node Assistant & Presets (🤖)** | Visually replace models or safely insert LoRAs into compatible chains directly from canvas node selection. Apply recipe-saved parameters transactionally. |
| **Material Library & Polymorphic Drag (✨)** | Save curated bundles from output PNGs (embedded workflow, provenance, reusable node blocks). Polymorphic canvas drag: drop workflow to restore, drop prompts to auto-spawn native CLIP text nodes, or drop onto existing nodes to inject parameters. |
| **Workflow Recipes & Presets (🧰)** | Save partial or complete workflows with covers, notes, tags, model identities, and parameter snapshots. Partial recipes append to current canvas; complete recipes open in a new canvas. |
| **History Gallery & Search (🖼️)** | Native viewer for your `output` folder with mouse-wheel zoom, deletion, direct drag-and-drop workflow reconstruction, and multi-dimensional search (prompt, model, seed, hash) with removable filter blocks. |
| **Model Source Hub (🌐)** | Dual-scope (workflow & full library) model source URL inspection, one-click platform navigation (Civitai, HuggingFace, Liblib, ModelScope), and instant canvas Note node generation. |
| **Smart Prompt Notebook (📑)** | Architecture-aware compatibility matching for Checkpoints and LoRAs, built-in translation, auto-tagging, and 1-click canvas deployment. |

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

#### 1. Bottom Navigation & Toolbox Catalog 🧰
* **Location**: The first Toolbox icon at the lower-left of the sidebar.
* **Layout Structure**: The lower-left navigation bar consists of a fixed left anchor (**Toolbox 🧰**), a fixed right anchor (**Settings ⚙️**), and **up to 4 customizable middle tool slots** (default: Scan, Doctor, Assistant, Materials).
* **Toolbox Catalog**: Clicking Toolbox opens a windowed modal managing all 9 built-in tools:
  1. **Scan Wizard (🔄)**: Scans directories and builds local hash/metadata index.
  2. **Model Doctor (🩺)**: Analyzes broken workflow nodes and auto-resolves missing models.
  3. **Node Assistant (🤖)**: Links canvas selection for visual model swapping and parameter presets.
  4. **Material Library (✨)**: Opens curated image workflow bundles and reusable node blocks.
  5. **Workflow Transfer Center (⇄)**: Lossless AMB0/AMB1 workflow share code import and export.
  6. **Prompt Studio (🎛️)**: Modular prompt mixer deck with lego-block reordering and composition.
  7. **Prompt Translator (🌐)**: Bilingual English/Chinese prompt translation utility.
  8. **Model Source Hub (🔗)**: Dual-scope model provenance inspector and canvas Note generator.
  9. **Prompt Notes (📑)**: Workspace notebook storage persisted in user directory.
* **Dock Customization**: Drag cards between the Toolbox and the bottom bar to pin or unpin them, or use the "•••" card menu and button right-click menu to organize shortcuts without dragging.

#### 2. Scan Wizard 🔄
* **Location**: Accessible from Toolbox or bottom shortcut bar.
* **Operation**: Select scan target (all paths, missing-metadata only, or custom folder) and run with an active internet connection to download Civitai covers, tags, and architectures.

#### 3. Workflow Repair (Model Doctor) 🩺
* **Location**: Accessible from Toolbox or bottom shortcut bar.
* **Operation**: When loading an external workflow with red missing-node alerts, Model Doctor identifies model hashes and sizes to automatically reconnect matching local files. A dedicated Hash Inspection modal provides side-by-side SHA256 comparisons.

#### 4. Visual Swapping & Presets (Node Assistant) 🤖
* **Location**: Accessible from Toolbox or bottom shortcut bar.
* **Actions**: Select a model node on canvas to view high-res previews and trigger words, or swap models visually.
* **Parameter Presets**: Switch to Parameter Presets to apply recipe-saved parameters (e.g., KSampler steps, CFG, denoise) to matching canvas nodes in one click. Volatile values like seeds are safely preserved.

#### 5. Material Library & Polymorphic Canvas Drag ✨
* **Capture**: Open a generated PNG's parameter details in Gallery or Recipes to save its image, exact workflow, and node blocks as a curated material bundle.
* **Polymorphic Canvas Drag**:
  - Dragging a workflow material onto an empty canvas area opens the full workflow.
  - Dragging a prompt-only material onto an empty canvas automatically spawns native `CLIPTextEncode` nodes with pure prompt text and standard ComfyUI coloring (`#532323` negative / `#235327` positive).
  - Dragging materials onto an existing canvas node injects matching parameter values into compatible fields.
* **Storage**: Materials persist in `workflows/anomalous_materials` inside the ComfyUI user directory.

#### 6. Workflow Recipes & Parameter Sets 🧰
* **Location**: Top navigation tabs (**Workspace 📑** → **Workflow Recipes**).
* **Operation**: Save partial workflows (appended to current canvas) or complete workflows (opened in a new canvas). Inspect parameter differences against historical outputs and roll back versions safely.

#### 7. History Gallery & Multi-Dimensional Search 🖼️
* **Location**: Top navigation tab (**Gallery 🖼️**).
* **Viewing**: Immersion viewer for the ComfyUI `output` directory with mouse-wheel zoom and canvas drag-and-drop workflow reconstruction.
* **Multi-Dimensional Search**: Filter generated outputs by typing prompts, model names, random seeds, or model hashes into the top search bar. Each active search term is converted into an independent, clickable search block that can be individually removed with a single click.

#### 8. Global Settings Panel ⚙️
* **Location**: Fixed Gear icon (**⚙️**) at the far right of the lower-left navigation bar.
* **Options**: Interface language (follow ComfyUI or force Chinese/English), font scale, cover video autoplay/hover behavior, thumbnail optimization, and model folder blacklist management.

> [!WARNING]
> **Beta Data Protection:** Workflow Recipes, Material Library, and Parameter Presets are currently in active preview. Please back up `workflows/anomalous_recipes`, `workflows/anomalous_materials`, and `workflows/anomalous_parameters` inside your ComfyUI user directory before updating.

</details>

---

<h2 id="中文">🇨🇳 中文说明</h2>

> **Anomalous Model Browser** 是为 ComfyUI 设计的创作工作台与模型管理套件。系统集成了基于文件哈希的元数据提取、工作流缺失模型自愈（模型医生）、画布节点可视化换模与 LoRA 插入（节点助手）、支持多态画布拖拽的统一素材库，以及工作流配方与参数复用体系。

### 🎬 视频演示与教程
* 📺 **哔哩哔哩 (Bilibili)**：[在 B 站观看快速上手与使用演示](https://www.bilibili.com/video/BV1a1bv68EuA/)
* 📺 **YouTube**：[在 YouTube 观看视频演示](https://youtu.be/hAvsj7uiaCw)

### 🌟 核心特性速览

| 🚀 功能板块 | 💡 详细说明 |
| :--- | :--- |
| **全方位模型管理** | 通过文件哈希自动提取基础架构、封面图、触发词与作者信息；支持看图一键替换模型、自定义备注与安全删除。 |
| **实用工具箱与快捷栏 (🧰)** | 侧边栏左下角第一个图标为工具箱，内嵌 9 大功能工具；底部快捷栏原生支持最多 4 个自定义快捷槽位，支持拖拽或右键菜单免拖拽管理。 |
| **节点智能修复 (模型医生 🩺)** | 导入他人工作流发生节点爆红时，自动识别缺失模型并一键替换为本地有效路径；支持按需动态计算 SHA256 与透视比对。 |
| **节点助手与参数预设 (🤖)** | 画布选中节点即可可视化选图换模型、向兼容链路插入 LoRA，或一键应用工作流配方中沉淀的节点参数（自动跳过易变种子）。 |
| **统一素材库与多态拖拽 (✨)** | 原生 PNG 资产一键打包保存（完整工作流、模型血缘与节点参数）；多态拖拽：拖至空白画布还原工作流或生成原生提示词节点，拖至已有节点智能注入参数。 |
| **工作流配方 (🧰)** | 保存局部或整体工作流及封面、标签、模型身份与参数快照；局部配方追加到当前画布，整体配方在新画布打开。 |
| **出图图库与多维检索 (🖼️)** | 原生读取本地 `output` 文件夹，支持滚轮缩放与安全删除；顶部搜索栏支持按提示词、模型名、随机种子与哈希多维过滤，生成可点击独立移除的搜索标签块。 |
| **模型来源中控 (🌐)** | 工具箱内嵌来源中控中心，双域（当前工作流与全局库）检视模型在线下载源，一键直达主流平台并生成画布 Note 记录节点。 |
| **智能提示词笔记 (📑)** | 架构级兼容性匹配（主模型+兼容 LoRA），内置双语分块翻译与标签编辑，支持一键打包发送至画布。 |

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

#### 1. 底部导航与实用工具箱 🧰
* **入口位置**：侧边栏左下角第一个图标。
* **布局结构**：底部导航栏由左侧固定锚点（**实用工具箱 🧰**）、右侧固定锚点（**全局设置 ⚙️**），以及中间**最多 4 个自定义快捷工具槽位**（默认：扫描、医生、助手、素材库）组成。
* **工具箱内置工具（共 9 项）**：
  1. **扫描向导 (🔄)**：扫描模型目录，计算文件哈希并建立本地模型索引数据库。
  2. **模型医生 (🩺)**：分析工作流中的红框缺失节点，自动按哈希或字节自愈并提供哈希透视比对。
  3. **节点助手 (🤖)**：联动画布选中的模型节点，提供可视化看图换模与配方参数预设。
  4. **素材库 (✨)**：集中管理已收藏的 PNG 图像工作流快照与独立节点参数块。
  5. **工作流分享中心 (⇄)**：导入与导出带哈希验证的工作流分享码（AMB0/AMB1 格式）。
  6. **提示词工坊 (🎛️)**：乐高积木式提示词组装台，支持来源词卡提取与分块混音。
  7. **提示词翻译器 (🌐)**：中英文提示词双向互译工具。
  8. **模型来源中控 (🔗)**：检视工作流或全局模型的在线下载源，一键直达平台或生成画布 Note 节点。
  9. **提示词笔记 (📑)**：管理保存在 ComfyUI 用户目录下的轻量提示词草稿。
* **快捷栏定制**：可在工具箱与底部快捷栏之间自由拖拽工具进行固定或取消，也可以在卡片“•••”菜单及底栏按钮右键菜单中一键执行固定、解绑及调整排序。

#### 2. 前置准备 (扫描向导) 🔄
* **入口位置**：侧边栏快捷栏或实用工具箱内。
* **操作步骤**：首次使用或添加新模型后打开扫描向导，选择扫描范围（全部路径、仅缺失元数据或自定义目录）并执行，系统将自动建立本地模型库并拉取 C 站封面与标签。

#### 3. 拯救爆红 (模型医生) 🩺
* **入口位置**：侧边栏快捷栏或实用工具箱内。
* **操作步骤**：载入他人工作流或图片出现红框缺失报错时，点击模型医生即可自动比对本地模型哈希与字节大小，一键批量映射为本地正确路径。卡片上的“查看哈希”可展开内嵌指纹与磁盘文件的 SHA256 逐项比对面板。

#### 4. 选中交互与预设 (节点助手) 🤖
* **入口位置**：侧边栏快捷栏或实用工具箱内。
* **动作功能**：在画布选中模型节点后，可在“动作”页查看高清预览图与触发词，支持看图一键替换模型或在兼容链路前后插入 LoRA。
* **参数预设**：切换至“参数预设”页，可读取工作流配方中同类型节点的保存参数并一键注入画布（自动保留种子等易变数值）。

#### 5. 统一素材库与多态画布拖拽 ✨
* **保存素材**：在出图图库或配方详情中打开任意生成 PNG 的参数面板，可一键将图片、完整工作流、模型依赖与可复用节点参数打包收藏。
* **多态画布拖拽**：
  - 将工作流素材直接拖拽至空白画布，即可原地恢复并打开完整工作流。
  - 将纯提示词素材拖拽至空白画布，会自动创建带有正负区分色（深红 `#532323` 为负向 / 墨绿 `#235327` 为正向）的原生 `CLIPTextEncode` 节点。
  - 将素材拖拽至画布已有节点上时，会自动通过语义探针将匹配参数注入目标节点中。
* **本地存储**：素材存储于 ComfyUI 用户目录下的 `workflows/anomalous_materials`，支持原子写入。

#### 6. 工作流配方与参数方案 🧰
* **入口位置**：顶部 **创作工作台 (📑)** ➔ 切换至 **工作流配方**。
* **主要功能**：保存当前节点图、封面、标签与参数快照；未闭合的局部配方追加到当前画布，可独立运行的整体配方在新画布打开，并支持出图参数差异对比与版本安全回滚。

#### 7. 原生出图图库与多维检索 🖼️
* **入口位置**：顶部导航栏 **图库 (🖼️)**。
* **图库浏览**：原生读取本地 `output` 文件夹，支持滚轮缩放查看与安全删除，直接将图片拖拽至画布即可原地还原工作流。
* **多维检索**：在图库顶部搜索栏输入提示词 (Prompt)、模型名称 (Model)、随机种子 (Seed) 或模型哈希 (Hash) 进行实时检索。每个搜索条件会自动转化为独立的搜索标签块，支持点击单个标签块上的“×”精确移除，方便组合过滤。

#### 8. 全局设置面板 ⚙️
* **入口位置**：侧边栏左下角最右侧 **齿轮图标 (⚙️)**。
* **个性调节**：支持中英文界面切换、字体大小缩放、视频封面悬停/常开播放、缩略图优化与目录黑名单管理。

> [!WARNING]
> **测试功能数据安全提醒：** 工作流配方、素材库与参数预设目前属于活跃测试阶段，更新插件前建议备份 ComfyUI 用户目录下的 `workflows/anomalous_recipes`、`workflows/anomalous_materials` 与 `workflows/anomalous_parameters` 文件夹。

</details>

---

### 📝 License & Branding (开源与品牌声明)

* **Code License (代码授权)**: The source code is released under the [MIT License](LICENSE). 本项目源代码基于 MIT 许可证开源，可自由使用、修改与分发。
* **Branding & Trademarks (商标与品牌保护)**: The name **Anomalous Model Browser** and the official logo identify official releases. Forks should use distinct names/branding. 详见 [Trademark and Brand Policy](TRADEMARKS.md)。
