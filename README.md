<div align="center">

# 🚀 Anomalous Model Browser

**A Comprehensive Creative Workspace & Model Manager for ComfyUI**  
*零依赖 C 站元数据抓取 · 智能模型医生 · 可视化节点助手 · 工作流配方与参数笔记*

<br/>

[![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge&logo=comfyui)](https://github.com/ltdrdata/ComfyUI-Manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Changelog](https://img.shields.io/badge/📖_Changelog-v1.57.1_Beta-blue?style=for-the-badge)](CHANGELOG.md)
[![Bilibili Video](https://img.shields.io/badge/Bilibili-视频演示-00A1D6?style=for-the-badge&logo=bilibili)](https://www.bilibili.com/video/BV1a1bv68EuA/)
[![YouTube Video](https://img.shields.io/badge/YouTube-Video_Demo-red?style=for-the-badge&logo=youtube)](https://youtu.be/hAvsj7uiaCw)

<br/>

[**English**](#-english) | [**中文说明**](#-中文)

</div>

---

<h2 id="english">🇬🇧 English</h2>

> **Anomalous Model Browser** is a comprehensive creative workspace and model management suite for ComfyUI. It integrates hash-based metadata indexing, workflow healing (Model Doctor), canvas visual model swapping (Node Assistant), a unified Material Library with polymorphic canvas drag-and-drop, and immutable Workflow Recipes.

### 🎬 Video Walkthrough & Demos
* 📺 **YouTube**: [Watch Quick Walkthrough on YouTube](https://youtu.be/hAvsj7uiaCw)
* 📺 **Bilibili**: [Watch Video Demo on Bilibili (在哔哩哔哩观看)](https://www.bilibili.com/video/BV1a1bv68EuA/)

### 🌟 Core Capabilities

| 🚀 Primary View | 💡 Description |
| :--- | :--- |
| **Model Browser (📦 Models)** | Browse models categorized by folder (checkpoints, unet, loras). Displays Civitai metadata, triggers, architectures, and high-res covers. Supports visual swapping, renaming, and notes. |
| **History Gallery (🖼️ Gallery)** | Native viewer for the ComfyUI `output` directory. Features multi-dimensional search (prompt, model, seed, hash) with removable filter blocks, mouse-wheel zoom, and drag-to-canvas workflow reconstruction. |
| **Workflow Recipes (🪡 Workflows)** | Save full workflows or partial subgraphs. Displays live model readiness status (e.g. all models ready). Open recipes in a new canvas or drag cards directly onto the canvas to load. |
| **Toolbox & Bottom Dock (🧰)** | Lower-left navigation bar featuring the Toolbox as the first icon. Directly hosts 4 frequent tools (Scan, Doctor, Assistant, Material Library) plus Settings. Clicking the Toolbox opens a panel containing 5 secondary utilities (Workflow Transfer, Prompt Studio, Prompt Translator, Model Source Hub, Prompt Notes). |
| **Workflow Repair (Model Doctor 🩺)** | Automatically detects broken nodes in external workflows and reconnects them to local models by comparing SHA-256 hashes and file sizes. |
| **Node Assistant & Presets (🤖)** | Canvas-linked sidebar. Select any node on the canvas to inspect covers/triggers, visually swap models, or apply recipe parameters transactionally. |
| **Material Library & Polymorphic Drag (✨)** | Save curated bundles from output PNGs (workflow, provenance, node parameters). Drop onto canvas to open workflow, drop prompts to auto-create native CLIP nodes, or drop onto existing nodes to inject parameters. |

### 📦 Quick Installation

1. Open your terminal in the ComfyUI `custom_nodes` directory:
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. Restart ComfyUI. *(Alternatively, install via **ComfyUI Manager** by searching for `Anomalous Model Browser`)*
3. **Updating**: click the **!** button in the browser header; the current version is shown at the top, and **Check for updates / switch version** opens the version panel. From there you can update to the newest published release, roll back to an earlier one, or return to the latest version, then restart ComfyUI. The plugin never checks for updates on its own.

Open the browser via **Ctrl + Shift + M**, the floating canvas orb (**📦**), or **Extensions → Anomalous Model Browser** in ComfyUI's menu. **ComfyUI Settings → Anomalous Model Browser → Interface** lets you customize the shortcut, configure the UI language, and select an entry mode (floating button, action-bar button, or Extensions menu only).

<br/>

<details>
<summary><b>📖 Click to Expand: Step-by-Step Operating Guide</b></summary>

<br/>

#### 1. Top Navigation Views (三大顶栏视图)
The header provides 3 primary workspaces:
* **Models (📦)**: Main model catalog. The left panel shows folder trees (`checkpoints`, `unet`, `loras`), while the center grid displays model cards with previews, trigger tags, and metadata.
* **Gallery (🖼️)**: Historical output browser. The top search bar filters outputs by prompt, model name, seed, filename, or model hash; each search keyword forms an independent block with a `×` button for instant removal. Dragging an image onto the canvas reconstructs its embedded workflow.
* **Workflows (🪡)**: Workflow Recipe studio. Filter by `[All]`, `[Full Workflows]`, or `[Subgraphs]`. Click `Save Current Workflow` to save the active canvas, or drag any recipe card directly onto the canvas to load it.

#### 2. Bottom Navigation & Toolbox Catalog (🧰 第一个图标：实用工具箱)
* **Dock Layout**: The lower-left navigation bar hosts 6 permanent buttons in a fixed layout:
  1. **Toolbox (🧰)**: First anchor on the left. Opens the Toolbox panel for secondary tools.
  2. **Scan Wizard (🔄)**: Direct shortcut to launch model library scanning.
  3. **Model Doctor (🩺)**: Direct shortcut to diagnose and repair missing workflow nodes.
  4. **Node Assistant (🤖)**: Direct shortcut to inspect canvas node models and inject parameter presets.
  5. **Material Library (✨)**: Direct shortcut to manage curated bundles and drag assets to the canvas.
  6. **Settings (⚙️)**: Fixed anchor on the far right for global preferences.
* **Toolbox Catalog**: Clicking the first icon (**🧰 实用工具箱**) opens a dedicated popup panel containing 5 secondary utilities:
  1. **Workflow Transfer Center (⇄ 导入导出)**: Lossless AMB format workflow share code import and export. Allows importing workflows from text codes or exporting the current canvas with embedded hashes.
  2. **Prompt Studio (🎛️ 提示词工坊)**: Modular prompt mixer deck. Extract prompt cards from history or materials, reorder segments, and assemble positive/negative prompts.
  3. **Prompt Translator (🌐 翻译助手)**: Built-in bilingual prompt translation between Chinese and English without leaving the interface.
  4. **Model Source Hub (🔗 模型来源)**: Dual-scope (workflow and library) download URL inspector. Navigates to Civitai, HuggingFace, Liblib, or ModelScope, and generates non-intrusive canvas Note nodes.
  5. **Prompt Notes (📑 提示词笔记)**: Lightweight notebook for drafting, editing, and managing reusable prompt snippets saved locally in the user directory (`workflows/anomalous_notebooks`).

#### 3. Scan Wizard (🔄 扫描向导)
* **Location**: Direct shortcut on the bottom dock (2nd icon).
* **Operation**: Scan configured model directories to compute file hashes, download Civitai covers, tags, and architectures, and build the local offline database.

#### 4. Model Doctor (🩺 模型医生)
* **Location**: Direct shortcut on the bottom dock (3rd icon).
* **Operation**: When loading an external workflow with missing red nodes, Model Doctor inspects embedded provenance hashes and file sizes to reconnect local matches automatically. The "View Hash" button opens a side-by-side SHA256 comparison modal.

#### 5. Node Assistant & Parameter Presets (🤖 节点助手)
* **Location**: Direct shortcut on the bottom dock (4th icon).
* **Actions**: Select a model node on the canvas to view high-res previews and trigger words, or swap models visually. Switch to **Parameter Presets** to inject recipe-saved node values (e.g., KSampler steps, CFG, denoise) into matching canvas nodes with safe seed preservation.

#### 6. Material Library & Polymorphic Canvas Drag (✨ 素材库与多态拖拽)
* **Location**: Direct shortcut on the bottom dock (5th icon).
* **Capture**: In Gallery or Workflows, open an image's parameter inspector to save its image, workflow, and node blocks as a curated material bundle (`workflows/anomalous_materials`).
* **Polymorphic Canvas Drag**:
  - Dragging a workflow material to an empty canvas area opens the full workflow.
  - Dragging a prompt-only material to an empty canvas auto-creates native `CLIPTextEncode` nodes with distinct negative (`#532323`) and positive (`#235327`) styling.
  - Dragging materials onto existing canvas nodes injects matching parameter values directly.

#### 7. Global Settings (⚙️ 设置)
* **Location**: Direct shortcut on the far right of the lower-left navigation bar (6th icon).
* **Options**: Interface language, font scale, thumbnail rendering, video cover hover behavior, and model folder blacklist.

> [!WARNING]
> **Beta Data Protection:** Workflow Recipes, Material Library, and Parameter Presets are currently in active preview. Please back up `workflows/anomalous_recipes`, `workflows/anomalous_materials`, and `workflows/anomalous_parameters` inside your ComfyUI user directory before updating.

</details>

---

<h2 id="中文">🇨🇳 中文说明</h2>

> **Anomalous Model Browser** 是为 ComfyUI 设计的综合创作工作台与模型管理套件。系统集成了基于文件哈希的元数据提取、工作流缺失模型自愈（模型医生）、画布节点可视化换模与 LoRA 插入（节点助手）、支持多态画布拖拽的统一素材库，以及工作流配方体系。

### 🎬 视频演示与教程
* 📺 **哔哩哔哩 (Bilibili)**：[在 B 站观看快速上手与使用演示](https://www.bilibili.com/video/BV1a1bv68EuA/)
* 📺 **YouTube**：[在 YouTube 观看视频演示](https://youtu.be/hAvsj7uiaCw)

### 🌟 核心特性速览

| 🚀 核心视图与工具 | 💡 详细说明 |
| :--- | :--- |
| **模型浏览 (📦 模型)** | 本地模型管理网格。左侧树状目录分类（checkpoints、unet、loras），卡片展示 C 站元数据、触发词、基础架构与高清封面，支持看图换模与自定义备注。 |
| **出图图库 (🖼️ 图库)** | 原生读取本地 `output` 文件夹，支持滚轮缩放与安全删除；顶部搜索栏支持按提示词、模型名、LoRA、seed、文件名或模型哈希多维检索，生成可点击独立移除的搜索标签块；拖拽图片原地还原工作流。 |
| **工作流配方 (🪡 工作流)** | 工作流配方工坊。支持保存完整工作流或局部子图，实时显示模型就绪状态（如“全部模型就绪”）；支持一键在新画布打开或直接拖拽卡片到画布空白处载入。 |
| **实用工具箱与底栏 (🧰)** | 侧边栏左下角第一个图标为工具箱，底栏直达 4 大常用工具（扫描向导、模型医生、节点助手、素材库）与全局设置；点击工具箱弹出浮窗面板，提供 5 大扩展工具（导入导出、提示词工坊、翻译助手、模型来源、提示词笔记）。 |
| **节点智能修复 (模型医生 🩺)** | 导入他人工作流发生节点爆红时，自动比对本地模型 SHA256 哈希与字节大小，一键替换为有效路径，支持哈希透视比对。 |
| **节点助手与参数预设 (🤖)** | 画布选中节点即可可视化选图换模型、向兼容链路插入 LoRA，或一键应用工作流配方中沉淀的节点参数（自动跳过易变种子）。 |
| **统一素材库与多态拖拽 (✨)** | 原生 PNG 资产一键打包保存（完整工作流、模型血缘与节点参数）；多态拖拽：拖至空白画布还原工作流或生成原生红绿提示词节点，拖至已有节点智能注入参数。 |

### 📦 快速安装

1. 在 ComfyUI 的 `custom_nodes` 目录下打开终端执行：
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. 重启 ComfyUI 即可使用。（*也可以直接在 **ComfyUI Manager** 搜索 `Anomalous Model Browser` 点击安装*）
3. **更新插件**：点击顶栏的 **!** 按钮，顶部会显示当前版本，点 **检查更新 / 切换版本** 进入版本面板。可以一键更新到最新发布版本、回退到以前的版本，或回到最新版，之后重启 ComfyUI 即可。插件不会自己联网检查更新。

可以按 **Ctrl + Shift + M**、点击画布上的悬浮 **📦**，或从 ComfyUI 顶部菜单 **扩展 → Anomalous Model Browser** 打开。**ComfyUI 设置 → Anomalous Model Browser → 界面** 会显示当前快捷键，并可直接打开 ComfyUI 原生录入窗口修改，因此冲突与保留按键检查仍然只有一套。该页面还可以让插件语言跟随 ComfyUI 或单独固定为中文/English，并严格三选一显示悬浮入口、运行按钮旁的原生顶部入口或仅使用扩展菜单。只有选择悬浮入口时才显示大小和样式选项。顶部栏重绘不会擅自改变所选模式，扩展菜单命令则始终保留，便于恢复设置。

<br/>

<details>
<summary><b>📖 点击展开：标准操作指南（图文步骤）</b></summary>

<br/>

#### 1. 顶部主工作区导航 (三大顶栏视图)
插件顶部居中提供 3 个核心工作区入口：
* **模型 (📦)**：主模型浏览器。左侧为模型文件夹分类树（`checkpoints`、`unet`、`loras` 等），中间展示模型卡片网格、封面图预览与触发词。
* **图库 (🖼️)**：出图历史浏览器。原生读取本地 `output` 目录。顶部搜索栏支持输入提示词、模型名、LoRA、seed、文件名或模型哈希，回车即可生成独立的搜索标签块，点击标签块上的 `×` 可快速移除该过滤项；直接将图片拖拽至 ComfyUI 画布可原地恢复内嵌工作流。
* **工作流 (🪡)**：工作流配方工坊。提供 `[全部]`、`[完整工作流]`、`[局部子图]` 子过滤器与标签筛选；点击右上角 `保存当前工作流` 即可将当前画布打包为配方；直接按住配方卡片拖拽到 ComfyUI 画布空白处释放即可立即载入。

#### 2. 底部导航与实用工具箱 (🧰 第一个图标：实用工具箱)
* **布局结构**：侧边栏左下角常驻 6 个固定图标按钮：
  1. **实用工具箱 (🧰)**：左侧首个图标，点击展开工具箱浮窗面板。
  2. **扫描向导 (🔄)**：直达本地模型扫描与哈希/元数据建立。
  3. **模型医生 (🩺)**：直达工作流爆红诊断与缺失模型自动自愈。
  4. **节点助手 (🤖)**：直达画布选中节点模型信息查看、可视化换模与参数预设注入。
  5. **素材库 (✨)**：直达素材资产管理与多态画布拖拽。
  6. **全局设置 (⚙️)**：最右侧齿轮图标，直达全局偏好设置。
* **实用工具箱浮窗**：点击首个图标（**🧰 实用工具箱**）打开工具箱窗口，集中收纳了未在底栏常驻的 5 大扩展工具：
  1. **导入导出 (⇄)**：无损 AMB 格式工作流分享码导入与导出，支持从文本分享码原地解析还原画布，或将当前画布打包生成带校验哈希的分享码。
  2. **提示词工坊 (🎛️)**：模块化提示词积木组装台，支持从出图历史或素材中抽取词卡并分块混音、正负词排序与组合。
  3. **翻译助手 (🌐)**：内置中英双向提示词互译工具，无需离开 ComfyUI 即可完成提示词中英翻译。
  4. **模型来源 (🔗)**：检视当前工作流或模型库中模型的在线下载来源（Civitai、HuggingFace、Liblib、ModelScope），支持一键在画布生成包含模型来源信息的 Note 说明节点。
  5. **提示词笔记 (📑)**：保存在 ComfyUI 用户目录（`workflows/anomalous_notebooks`）下的轻量提示词草稿本，用于随时记录、整理与复用常用提示词片段。

#### 3. 扫描向导 (🔄 扫描向导)
* **入口位置**：底部快捷栏第 2 个图标。
* **操作步骤**：首次使用或添加新模型后打开，选择扫描范围（全部路径、仅缺失元数据或自定义目录）并执行，系统将自动建立本地模型库并拉取 C 站封面、标签与架构信息。

#### 4. 拯救爆红 (🩺 模型医生)
* **入口位置**：底部快捷栏第 3 个图标。
* **操作步骤**：载入他人工作流或图片出现红框缺失报错时，点击模型医生即可自动比对本地模型哈希与字节大小，一键批量映射为本地正确路径。卡片上的“查看哈希”可展开内嵌指纹与磁盘文件的 SHA256 逐项比对面板。

#### 5. 选中交互与预设 (🤖 节点助手)
* **入口位置**：底部快捷栏第 4 个图标。
* **动作功能**：在画布选中模型节点后，可在“动作”页查看高清预览图与触发词，支持看图一键替换模型或在兼容链路前后插入 LoRA。
* **参数预设**：切换至“参数预设”页，可读取工作流配方中同类型节点的保存参数并一键注入画布（自动保留种子等易变数值）。

#### 6. 统一素材库与多态画布拖拽 (✨ 素材库与多态拖拽)
* **入口位置**：底部快捷栏第 5 个图标。
* **保存素材**：在出图图库或配方详情中打开任意生成 PNG 的参数面板，可一键将图片、完整工作流、模型依赖与可复用节点参数打包收藏。
* **多态画布拖拽**：
  - 将工作流素材直接拖拽至空白画布，即可原地恢复并打开完整工作流。
  - 将纯提示词素材拖拽至空白画布，会自动创建带有正负区分色（深红 `#532323` 为负向 / 墨绿 `#235327` 为正向）的原生 `CLIPTextEncode` 节点。
  - 将素材拖拽至画布已有节点上时，会自动通过语义探针将匹配参数注入目标节点中。
* **本地存储**：素材存储于 ComfyUI 用户目录下的 `workflows/anomalous_materials`，支持原子写入。

#### 7. 全局设置面板 (⚙️ 设置)
* **入口位置**：侧边栏左下角最右侧第 6 个图标（**齿轮图标 ⚙️**）。
* **个性调节**：支持中英文界面切换、字体大小缩放、视频封面悬停/常开播放、缩略图优化与目录黑名单管理。

> [!WARNING]
> **测试功能数据安全提醒：** 工作流配方、素材库与参数预设目前属于活跃测试阶段，更新插件前建议备份 ComfyUI 用户目录下的 `workflows/anomalous_recipes`、`workflows/anomalous_materials` 与 `workflows/anomalous_parameters` 文件夹。

</details>

---

### 📝 License & Branding (开源与品牌声明)

* **Code License (代码授权)**: The source code is released under the [MIT License](LICENSE). 本项目源代码基于 MIT 许可证开源，可自由使用、修改与分发。
* **Branding & Trademarks (商标与品牌保护)**: The name **Anomalous Model Browser** and the official logo identify official releases. Forks should use distinct names/branding. 详见 [Trademark and Brand Policy](TRADEMARKS.md)。
