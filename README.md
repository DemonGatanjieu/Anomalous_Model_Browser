# Anomalous Model Browser

[![Changelog](https://img.shields.io/badge/📖_Read_the-Changelog-blue?style=for-the-badge)](CHANGELOG.md) [![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge)](https://github.com/ltdrdata/ComfyUI-Manager)

[English](#english) | [中文](#中文)

---

<h2 id="english">🇬🇧 English</h2>

> A comprehensive Creative Workspace and Model Manager for ComfyUI. Features zero-dependency Civitai scraping, an auto-resolving Model Doctor, a visual Node Assistant, lossless Workflow Exchange, and reusable Workflow Recipes with Parameter Notebooks.

> [!WARNING]
> **Beta features and data protection:** Workflow Recipes and only the recipe-powered **Parameter Presets** tab inside Node Assistant are currently in testing; the Node Assistant's **Actions** tab is not part of this beta. Before updating the plugin, importing someone else's recipe, restoring or deleting recipe data, or applying saved parameters, save the current canvas and back up `workflows/anomalous_recipes` and `workflows/anomalous_parameters` inside your ComfyUI user directory. Recipe model-preview snapshots do not contain model files and are not model backups.

### 🌟 Core Capabilities

| 🚀 Feature | 💡 Description |
| :--- | :--- |
| **Comprehensive Model Management** | Automatically extract Base Model architectures, cover images, trigger words, and author info by scanning model hashes. Customize model names, notes, and covers. Safely delete unwanted models or quickly replace them visually with cover icons. |
| **Workflow Node Repair (🩺)** | As long as a workflow/image was exported with this plugin active, the **Model Doctor (🩺)** can auto-detect missing nodes and replace them with correct local paths. Stubborn models? Use "Deep Hash Scan" or get Civitai links. |
| **Node Assistant & Recipe Presets (🤖)** | Select a canvas node to visually replace a model, safely insert a LoRA into a compatible chain, or load same-type node parameters saved by Workflow Recipes. A saved KSampler note, for example, can apply sampler, scheduler, steps, CFG, and denoise in one click while volatile seeds are ignored. |
| **Workflow Recipes (🧰)** | Save a complete workflow with a cover, notes, tags, model identity, prompts, sampler settings, node parameters, matching output images, and version history. Append recipes to the canvas, compare output/version parameters, match foreign model references to local files, and import or export portable recipe packages. |
| **Smart Notebook (📑)** | Leveraging scanned local architectures, it offers rapid matching between Checkpoints, UNet, and compatible LoRAs. Features a built-in translation tool, auto-chunks prompts into tags, and supports 1-click canvas deployment. |
| **History Gallery (🖼️)** | Natively reads your local `output` folder. Supports 1-click viewing, deleting, and mouse-wheel zooming. Drag and drop any generated image directly onto the canvas to instantly load its embedded workflow! |
| **Additional Features** | Click the top-right `➕` of any model card to deploy it to the canvas. The UI supports side-docking to leave space for your canvas operations. |

### 📖 Step-by-Step Operating Guide

#### 1. Initialization (Scan Wizard) 🔄
* **Location**: The Scan icon (**🔄**) at the bottom left of the plugin interface.
* **Operation**: This is the most important prerequisite. Open the Scan Wizard, select your configuration, and execute the scan. Ensure your network is connected.
* **Result**: This activates all core features of the plugin by building your local model database.

#### 2. Workflow Repair (Model Doctor) 🩺
* **Location**: The second Stethoscope icon (**🩺**) from the bottom left.
* **Operation**: When you import someone else's workflow and the nodes turn red due to missing paths, click the Model Doctor. It will intelligently identify all broken nodes and replace them with your correct local paths.

#### 3. Visual Swapping (Node Assistant) 🤖
* **Location**: The third Robot icon (**🤖**) from the bottom left.
* **Actions**: Select a node on the ComfyUI canvas. For model nodes, the Actions tab can visually replace the current model or insert a LoRA before/after a compatible MODEL + CLIP chain. Picker cards support previews, model-category/base-model badges, folders, full-path search, sorting, and safe handling of ambiguous branches.
* **Parameter Presets (Beta)**: Switch to **Parameter Presets** to read parameter notes associated with Workflow Recipes. Presets are grouped by recipe and contain saved values for the same node type as the selected node. Clicking a preset applies it transactionally to that one node; runtime-changing values such as seeds are ignored.

#### 4. Workflow Recipes & Parameter Notebooks 🧰
* **Location**: Open **Creative Workspace (📑)** and switch from **Prompt Notes** to **Workflow Recipes**.
* **Save and reuse**: Save the complete current graph with a cover, name, tags, notes, model references, prompts, sampler settings, and bounded node summaries. Recipes can be appended to the current canvas without replacing it.
* **Details**: Overview shows model composition and reproducibility information. Models can be matched to local files by hash, size, and model category rather than the author's path; Civitai origin names/links and local previews can be retained when available.
* **Parameter Notebook**: Browse the recipe's saved values, copy or expand long fields, create an edited parameter note, or read a fresh matching canvas into a new note. **Apply to Current Workflow** first checks that the recipe skeleton matches, then updates safe widgets; volatile values such as seeds are ignored. Stored notes can be deleted individually. Unknown third-party prompt roles can be labelled manually.
* **Gallery and Versions**: Find historical outputs with the same node structure, open an image to compare parameter differences, set an output as the recipe cover, compare recipe versions, or restore an older version while archiving the current one.
* **Sharing**: Export/import portable recipe packages with optional model-preview snapshots and history. Identity hashes can be removed during export. A preview snapshot is presentation data only—it never includes a model file.

#### 5. Settings Panel ⚙️
* **Location**: The Gear icon (**⚙️**) at the bottom left.
* **Operation**: Adjust the UI language and main UI font size. Open **Model Settings** to choose always-play or hover-play video covers and optimized card thumbnails or original covers. Detail pages continue to use the original cover. **Folder Manager** can hide folders from both the sidebar and background reads, and reorder them. **Help** contains the current safety and feature guide.

#### 6. Top Navigation & Prompt Notes 📑
**Location**: The top tabs: **Models (📦)**, **Gallery (🖼️)**, **Creative Workspace (📑)**, and **Dock Side (◧)**.

**Prompt Notes Operation**:
1. Open **Creative Workspace (📑)**, choose **Prompt Notes**, then click the **➕ (New)** button and confirm.
2. Select a Base Model (e.g., SD1.5). You can then select compatible Main Models and LoRAs.
3. Click **📝 Edit Raw / Paste** to paste your prompts. Select the language at the top-left for bilingual translation.
4. After confirming, the plugin will automatically chunk your prompt into tags. You can find/replace or directly edit tags.
5. Click **🚀 Send to Canvas** to automatically wire and deploy the Checkpoint, LoRA, and CLIP Text Encode directly to your canvas!

---

### 📦 Installation

Open your terminal, go to your ComfyUI `custom_nodes` folder, and run:
```bash
cd custom_nodes
git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
```
> **Note**: Restart ComfyUI after cloning. Alternatively, search for `Anomalous Model Browser` inside the ComfyUI Manager and click Install!

---

<h2 id="中文">🇨🇳 中文</h2>

> 一个综合性的 ComfyUI 创作工作台与模型管家。集成零依赖的 C 站信息抓取、支持自动修复的模型医生、可视化节点助手、无损工作流交互，以及支持参数复用的工作流配方与笔记本体系。

> [!WARNING]
> **测试功能与数据保护：** 工作流配方以及节点助手中由配方驱动的“参数笔记本”目前属于测试功能；节点助手的“动作”页不在测试范围内。更新插件、导入他人配方、恢复或删除配方数据、应用已保存参数之前，请先保存当前画布，并备份 ComfyUI 用户目录中的 `workflows/anomalous_recipes` 与 `workflows/anomalous_parameters`。配方中的模型预览快照不包含模型文件，不能替代模型备份。

### 🌟 核心功能特性

| 🚀 功能板块 | 💡 详细说明 |
| :--- | :--- |
| **全方位模型管理** | 通过扫描哈希值，自动获取模型的基础架构、封面、提示词、作者简介等信息。支持自定义名称、备注和封面。点开模型即刻呈现封面图标，支持看图一键替换模型，彻底告别复杂的模型路径！ |
| **节点智能修复 (🩺)** | 凡是由本插件导出的工作流和图片，在载入他人工作流时出现节点爆红，只需点开**模型医生 (🩺)**，即可自动识别正确的模型路径并一键替换。内置深度扫描与 C 站直达链接。 |
| **节点助手与配方参数 (🤖)** | 选中画布节点后，可视化替换模型、向兼容链路安全插入 LoRA，或读取工作流配方保存的同类型节点参数。例如保存过的 K 采样器笔记可一键应用采样器、调度器、步数、CFG 与降噪，同时忽略易变的种子。 |
| **工作流配方 (🧰)** | 保存完整工作流及封面、备注、标签、模型身份、提示词、采样参数、节点参数、匹配出图与版本历史。支持追加到画布、比较出图/版本参数、将他人的模型引用匹配到本地文件，以及导入导出便携配方包。 |
| **智能笔记本 (📑)** | 基于本地基础架构，提供快速的架构匹配功能，极速选择兼容的主模型与 LoRA。内置强大的翻译功能，自动将提示词分块打上标签，实现双语对照，并支持一键发布组装到工作流画布中。 |
| **原生图库管理 (🖼️)** | 无缝读取本地的 `output` 文件夹。支持鼠标滚轮缩放、一键查看和安全删除。更绝的是，您可以**直接将图片拖动到画布上，瞬间原地加载内嵌的工作流！** |
| **其它便捷功能** | 点击模型卡片右上角的 `➕` 号，快捷将节点发布到画布。支持侧边栏停靠 (Dock)，将界面吸附在左侧，为您的画布留出充足的操作空间。 |

### 📖 标准操作指南

为了让插件发挥最大效能，请按照以下流程进行操作：

#### 1. 前置准备 (扫描向导) 🔄
* **具体位置**：界面左侧底部的 **扫描图标 (🔄)**。
* **操作步骤**：这是最重要的一步！请先打开扫描向导，根据需求选择扫描配置并执行扫描（切记保持网络畅通）。扫描完成后，您的本地数据库建立完毕，插件的各项核心功能全面激活。

#### 2. 拯救爆红 (模型医生) 🩺
* **具体位置**：左侧底部第二个 **听诊器按钮 (🩺)**。
* **操作步骤**：当导入别人使用该插件输出的工作流或者图片时，若发现模型路径爆红报错，点击模型医生，它就能智能识别报错节点，并一键实现正确路径的替换。

#### 3. 选中交互 (节点助手) 🤖
* **具体位置**：左侧底部第三个 **机器人按钮 (🤖)**。
* **动作**：打开后在 ComfyUI 画布上选中节点。对于模型节点，“动作”页可以可视化替换当前模型，或在兼容的 MODEL + CLIP 链前后插入 LoRA。选择器提供模型预览、模型类别/基础模型标记、文件夹、完整路径搜索、排序与多分支安全保护。
* **参数笔记本（测试）**：切换到“参数笔记本”，可以读取与工作流配方关联的参数笔记。内容会按配方分组，只展示和当前选中节点类型相同的保存记录。点击一条记录即可事务式应用到该节点；种子等每次运行都会变化的值会被忽略。

#### 4. 工作流配方与参数笔记本 🧰
* **具体位置**：打开 **创作工作台 (📑)**，从“提示词笔记”切换到 **工作流配方**。
* **保存与复用**：保存当前完整节点图，并附带封面、名称、标签、备注、模型引用、提示词、采样设置与受限节点摘要。配方可以追加到当前画布，不会覆盖当前内容。
* **详细信息**：概览展示模型组成与复现信息。模型匹配根据哈希、文件大小与模型类别查找本地文件，不依赖原作者路径；可用时还会保留 C 站官方名称/链接与本地预览。
* **参数笔记本**：查看配方保存的参数，复制或展开长内容，新建可编辑参数笔记，或者从骨架匹配的当前画布读取全新参数。点击“应用到当前工作流”时会先检查配方骨架，再更新安全控件；种子等易变值会被忽略。保存的参数笔记可以单独删除；无法可靠识别的第三方提示词节点可以手动标注正负角色。
* **图库与版本**：查找节点结构相同的历史出图，打开图片比较参数差异，将出图设为配方封面，比较配方历史版本，或在自动归档当前版本后恢复旧版本。
* **分享**：导入导出便携配方包，可选择包含模型预览快照与历史版本，也可在导出时移除身份哈希。预览快照只是展示数据，绝不会包含模型文件。

#### 5. 个性化配置 (设置面板) ⚙️
* **具体位置**：左侧底部的 **齿轮按钮 (⚙️)**。
* **操作步骤**：在此可以调节语言和主页面字体大小。进入 **模型设置** 后，可选择视频封面始终播放或悬停播放，也可选择卡片使用流畅缩略图或原始封面；模型详情页始终使用原始封面。**文件夹管理**可以让指定目录同时退出侧栏和后台读取，并支持调整顺序；**帮助**中会持续更新安全提醒与功能说明。

#### 6. 顶部导航与提示词笔记 📑
**具体位置**：右侧顶部的按钮分别为 **模型 (📦)**、**图库 (🖼️)**、**创作工作台 (📑)**、**停靠侧边栏 (◧)**。

**提示词笔记操作步骤**：
1. 打开**创作工作台 (📑)**，进入“提示词笔记”，点击新建 **➕** 号并确认。
2. 首先选择基础模型（例如 SD1.5），系统会过滤出兼容的主模型与对应的 LoRA 模型供你选择。
3. 点击下方的 **📝 纯文本/粘贴** 复制提示词进去，选择左上角的语言即可实现双语对照翻译。
4. 确认后，插件会自动生成标签 (Tags)，支持查找替换，也支持直接双击修改单个标签。
5. 最后，点击下方的 **🚀 发送到画布**，系统会将打包好的主模型、LoRA 和 CLIP，一键全自动连线发布到画布！

---

### 📦 安装指南

打开命令行终端，进入 ComfyUI 的 `custom_nodes` 文件夹，执行以下命令：
```bash
cd custom_nodes
git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
```
> **注意**：克隆完成后，重启 ComfyUI 即可。您也可以直接在 ComfyUI Manager（管理器）中搜索 `Anomalous Model Browser` 并一键点击安装！

---

### 📝 License & Branding (开源与品牌声明)

**Code License (代码授权)**
The source code of this project is released under the [MIT License](LICENSE). You are free to use, modify, and distribute the code.
本项目的源代码基于 MIT 许可证开源，您可以自由地使用、修改和分发代码。

**Branding & Trademarks (品牌与商标保护)**
The MIT License covers the repository's code, documentation, stylesheets, and ordinary UI resources. The name **Anomalous Model Browser** and the official project logo identify official releases; the MIT License does not imply that a modified distribution is official or endorsed. Publicly distributed forks should use a distinct primary name and logo, while they may truthfully say that they are based on Anomalous Model Browser. See the [Trademark and Brand Policy](TRADEMARKS.md).

MIT 许可证适用于本仓库的代码、文档、样式表和普通 UI 资源。名称 **Anomalous Model Browser** 与官方项目 Logo 用于识别官方版本；采用 MIT 许可证并不表示修改后的发行版属于官方版本或获得认可。公开分发的修改版本应使用不同的主要名称与 Logo，但可以如实说明其基于 Anomalous Model Browser。详见[商标与品牌政策](TRADEMARKS.md)。
