# Anomalous Model Browser

[![Changelog](https://img.shields.io/badge/📖_Read_the-Changelog-blue?style=for-the-badge)](CHANGELOG.md) [![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge)](https://github.com/ltdrdata/ComfyUI-Manager)

[English](#english) | [中文](#中文)

---

<h2 id="english">English</h2>

A lightweight (< 250KB), zero-dependency ComfyUI model browser plugin featuring hash-level workflow repair, a powerful smart notebook, deep local scanning, and gallery management.

### Core Feature 1: Hash-Level Workflow Repair (Gene-Level Self-Healing)

**Workflows and images generated or saved while this plugin is active will have their models' Civitai Hashes automatically embedded.**

> ⚠️ **Crucial Prerequisite**: After installing the plugin, you MUST run a **[Scan]** from the UI to build your local hash database. Once scanned, any workflows or images you generate thereafter will automatically carry the hash metadata required for self-healing.

When loading a workflow or image that was saved with this plugin, if you encounter red "Missing Node" errors due to mismatched model names:
1. Click the **Repair Workflow** button.
2. The plugin will scan your local directory using the embedded Hash data.
3. Once a match is found, it automatically reconnects and replaces the missing nodes.

*(Note: The plugin relies on these injected hashes for precise matching. Historical workflows or images generated without this plugin will lack the necessary hash data and cannot be automatically repaired.)*

> 💡 **Auto-Detect Missing Models**: By default, the plugin will NOT silently scan your disk or interrupt your workflow loading with popups if you have missing models. You can turn this feature **ON** manually in the Settings Hub if you want active workflow monitoring and auto-healing prompts.

### Core Feature 2: Smart Notebook (Workflow Drafting)

Since the local scanner natively identifies the architecture (Base Model) of your files, the Notebook acts as a powerful drafting area:
* **Architecture Filtering**: Select a Base Model, and the notebook will strictly filter and display only the compatible Main Models and Loras.
* **Visual Selection**: Displays preview images for your models directly within the notebook interface.
* **Prompt Management**: Paste your prompts to instantly receive a bilingual translation for easy side-by-side editing.
* **One-Click Deploy**: Press "Send to Canvas" and your entire selected stack (Main Model, Loras, Prompts) will drop onto the canvas fully wired up.

### Core Feature 3: Deep Scanning & Metadata Management

> 📌 **Important Note**: The plugin's core metadata retrieval is exclusively integrated with **Civitai**. It fetches `.info` files and preview images directly from Civitai's database. Models downloaded purely from HuggingFace (without a Civitai counterpart) will rely on our Offline Tensor Inference for Base Model detection instead.

* **O(1) Instant Hash Extraction**: Instead of computing hashes for gigabytes of data, the plugin reads the header of `.safetensors` files to extract the hash instantly. It then automatically downloads the corresponding `.info` and previews from Civitai.
* **Offline Tensor Gene Inference**: For private models or models not on Civitai, the plugin analyzes the internal tensor structure (e.g., detecting `double_blocks` for Flux) to accurately deduce the Base Model architecture, ensuring even orphaned models work seamlessly with the Notebook filtering.
* **Model Deduplication**: Physically identifies and cleans up redundant `.safetensors` files that share the exact same hash under different names.
* **Model Details**: Read usage instructions and 1-click copy trigger words directly from the model page UI.

### Other Practical Features

* **Sidebar Docking & Node Dropping**: Dock the browser to the sidebar. Click the `+` icon in the top right of any model card to instantly drop its loader node onto your canvas.
* **O(1) Fast Scanning**: No Node.js required. Exceptional scroll performance with Eco Mode (hover to play) and Auto-play toggles.
* **Native Output Gallery**: Browse ComfyUI output history with infinite lazy loading, and drag-and-drop images directly to the canvas to restore workflows.
* **Model Management**: Securely delete models from the UI, automatically cleaning up associated metadata and preview images.

### Installation Guide

Open your terminal, navigate to the ComfyUI `custom_nodes` folder, and run the following commands:

```bash
cd custom_nodes
git clone https://github.com/your-username/Anomalous_Model_Browser.git
```
*(Note: Restart ComfyUI after cloning to load the plugin. Alternatively, search for `Anomalous Model Browser` in the ComfyUI Manager and click Install!)*

### Quick Start

**Initial Setup (Required):**
1. **Step 1**: Click the **Model Browser** button to open the panel.
2. **Step 2**: Navigate to the Settings tab and run a **Full Scan** (or scan individual folders) to build your local hash database.

**Standard Usage (Adding Nodes):**
- Browse your local models. Click the **`+`** icon on any model card to instantly drop its loader node onto the canvas.

**Repairing Broken Workflows:**
1. **Step 1**: Drag and drop a reference image containing Hash info (generated with this plugin) into the ComfyUI canvas.
2. **Step 2**: If nodes turn red, click the prompted **Repair Workflow** button and wait for the plugin to restore node connections.

---

<h2 id="中文">中文</h2>

一个不到 250KB、零依赖、集成了哈希级工作流修复、智能笔记本、深度本地扫描与图库管理的 ComfyUI 模型浏览器插件。

### 核心特性一：哈希级工作流修复（基因级自愈）

**在启用本插件的状态下，生成或保存的工作流与图片，都会被自动注入模型对应的 Civitai Hash 和文件信息。** 

> ⚠️ **重要前置条件**：安装插件后，请务必先在界面内运行一次**【扫描】**，建立本地哈希数据库。此后，您导出的所有工作流与图片才会自带模型特征，享有自愈能力。

当你拖入一张由此插件保存的图片或工作流时，如果因为环境不同导致模型找不到、节点全红报错：
1. 点一下界面上的**修复工作流**按钮。
2. 插件会自动根据内置的 Hash 数据，在你的本地目录中精准寻找对应的模型。
3. 找到后自动重新连线替换，哪怕你把模型改成了任意名字。

*(注意：系统依赖模型哈希进行精准匹配。如果在没有安装本插件前生成的旧工作流，或他人未使用本插件生成的图片，由于缺失哈希信息，将无法触发全自动修复，仍需手动重选。)*

> 💡 **自动检测缺失模型**：为了避免打断用户加载工作流的连贯性，插件**默认不会**在后台静默扫描本地磁盘，也**不会**在发现缺失模型时自动弹窗。如果您希望开启工作流缺失模型的主动监控与弹窗提示，请前往设置面板中手动将其**开启**。

### 核心特性二：智能笔记本（工作流草稿本）

得益于本地扫描功能可以精准识别并提取模型的基础架构 (Base Model)，笔记本模块提供了极为强大的草稿与组装功能：
* **架构隔离筛选**：在笔记本中选定 Base Model 后，系统会自动为你筛选出与之完全兼容的主模型和 Lora，杜绝搭配错误。
* **可视化挑选**：直接在笔记本页面中显示模型的关联预览图（利用抓取的 C站 数据）。
* **提示词翻译对照**：粘贴提示词后，支持一键翻译，形成双语对照，方便打草稿和修改。
* **免连线一键发布**：配置好模型和提示词后，点击“发送到画布”，整套节点配置会被直接打包投放到画布并自动完成连线，彻底告别一个个拉节点和连线的折磨。

### 核心特性三：深度扫描与元数据管理

> 📌 **重要提示**：本插件的元数据获取核心**专为 Civitai（C站）服务**。插件仅会从 C站 抓取对应的 `.info` 配置文件和预览图。如果您第一时间从 HuggingFace 手动下载了纯净版模型（且未同步至C站），插件将无法获取它的封面与介绍，但仍可通过“脱机张量推断”识别其底层架构。

* **O(1) 极速哈希提取**：无需计算几十 GB 模型的完整哈希。插件直接解析 `.safetensors` 文件头，瞬间截获 Hash 值，并自动去 C站 下载对应的 `.info` 说明与预览图。
* **脱机张量推断（万能 Base 提取）**：即便是不在 C站 上的私模或其它平台模型，插件会强行解析网络结构（如发现 `double_blocks` 则识别为 Flux），在本地生成虚拟配置。让孤儿模型也能完美参与笔记本的 UI 筛选匹配。
* **物理版本去重**：自动识别并清理不同名字但 Hash 完全相同的冗余 `.safetensors` 文件。
* **快捷详情查阅**：在模型页面可以直接查看模型使用说明，并支持**一键复制触发词 (Trigger Words)**。

### 其他实用功能

* **侧边栏停靠与快捷投放**：支持将插件停靠在侧边栏。点击模型卡片右上角的 **`+`** 号图标，即可瞬间将该模型的加载器 (Loader) 节点拍到画布上。
* **前端极致性能**：不安装 Node.js，列表滚动性能极佳。提供节能模式（悬浮播放）与自动播放开关。
* **原生生成图库 (Gallery)**：无缝浏览 output 文件夹的历史记录，无限懒加载，支持将图片直接拖拽至画布瞬间还原工作流。
* **内置空间管理**：支持在界面安全删除模型，并自动清理配套的垃圾信息文件及预览图。

### 安装指南

请打开命令行终端，进入 ComfyUI 的 `custom_nodes` 文件夹，执行以下命令即可完成安装：

```bash
cd custom_nodes
git clone https://github.com/your-username/Anomalous_Model_Browser.git
```
*(提示：克隆完成后，重启 ComfyUI 即可加载插件。你也可以直接在 ComfyUI Manager 中搜索 `Anomalous Model Browser` 并一键安装！)*

### 快速上手 (Quick Start)

**初始配置 (必做)：**
1. **第一步**：点击界面主菜单或侧边栏的 **Model Browser** 按钮打开面板。
2. **第二步**：务必运行一次**【扫描】**（可全局或分文件夹扫描），建立本地模型哈希数据库。此后保存的工作流才会具备自愈基因。

**常规使用 (浏览与添加模型)：**
- 浏览模型库，点击任意模型卡片右上角的 **`+` (加号)** 图标，即可将该模型的加载节点直接丢到画布上。

**修复报错工作流：**
1. **第一步**：将带有 Hash 信息的图片（须在使用本插件且扫描建库后生成）拖入 ComfyUI 画布。
2. **第二步**：若发生模型路径不匹配导致的飘红报错，点击提示的 **一键修复工作流** 按钮，等待插件在本地检索 Hash 并自动恢复节点连接。
