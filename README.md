<div align="center">

# 🚀 Anomalous Model Browser

**A Comprehensive Creative Workspace & Model Manager for ComfyUI**  
*零依赖 C 站元数据抓取 · 智能模型医生 · 可视化节点助手 · 工作流配方与参数笔记*

<br/>

[![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge&logo=comfyui)](https://github.com/ltdrdata/ComfyUI-Manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Changelog](https://img.shields.io/badge/📖_Changelog-v1.56_Beta-blue?style=for-the-badge)](CHANGELOG.md)
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
| **Workflow Recipes & Presets (🧰)** | Save complete workflows with covers, notes, tags, model identities, and parameter snapshots. Append to canvas, compare versions, and export portable packages. |
| **Smart Prompt Notebook (📑)** | Architecture-aware compatibility matching for Checkpoints and LoRAs, built-in translation, auto-tagging, and 1-click canvas deployment. |
| **History Gallery (🖼️)** | Native viewer for your `output` folder with mouse-wheel zoom, deletion, and direct drag-and-drop workflow reconstruction onto the canvas. |

### 📦 Quick Installation

1. Open your terminal in the ComfyUI `custom_nodes` directory:
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. Restart ComfyUI. *(Alternatively, install via **ComfyUI Manager** by searching for `Anomalous Model Browser`)*

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
* **Features**: Save graphs with covers, notes, and model hashes. Append recipes to current canvas, inspect parameter differences against outputs, compare versions, and import/export portable packages.

#### 5. Settings Panel ⚙️
* **Location**: The Gear icon (**⚙️**) at the bottom-left.
* **Options**: Language toggle, UI font scale, hover/autoplay video covers, card thumbnails, and custom folder management.

#### 6. Creative Workspace & Prompt Notes 📑
* **Location**: Top navigation tabs (**Models 📦**, **Gallery 🖼️**, **Workspace 📑**, **Dock Side ◧**).
* **Usage**: Select a Base Model architecture, attach compatible LoRAs, paste & auto-tag bilingual prompts, and click **Send to Canvas** to deploy directly.

> [!WARNING]
> **Beta Data Protection:** Workflow Recipes and Parameter Presets are currently in testing. Please back up `workflows/anomalous_recipes` and `workflows/anomalous_parameters` inside your ComfyUI user directory before updating.

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
| **工作流配方 (🧰)** | 保存完整工作流及封面、标签、模型身份与参数快照；支持追加到画布、历史版本比对、参数差异分析及便携分享包导入导出。 |
| **智能提示词笔记 (📑)** | 架构级兼容性匹配（主模型+兼容 LoRA），内置双语分块翻译与标签编辑，支持一键打包发送至画布。 |
| **原生出图图库 (🖼️)** | 原生读取本地 `output` 文件夹，支持滚轮缩放与安全删除，**直接将图片拖拽至画布即可原地还原工作流**。 |

### 📦 快速安装

1. 在 ComfyUI 的 `custom_nodes` 目录下打开终端执行：
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. 重启 ComfyUI 即可使用。（*也可以直接在 **ComfyUI Manager** 搜索 `Anomalous Model Browser` 点击安装*）

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
* **主要功能**：完整保存当前节点图、封面、标签与参数快照；支持无损追加到当前画布、出图参数差异对比、版本回滚与便携包分享。

#### 5. 个性化配置 (设置面板) ⚙️
* **入口位置**：侧边栏左下角 **齿轮图标 (⚙️)**。
* **个性调节**：支持中英文界面切换、字体大小缩放、视频封面悬停/常开播放、缩略图优化与目录黑名单管理。

#### 6. 创作工作台与提示词笔记 📑
* **入口位置**：顶部导航栏 (**模型 📦**、**图库 🖼️**、**工作台 📑**、**侧栏停靠 ◧**)。
* **提示词组装**：选择基础模型架构过滤兼容 LoRA，粘贴提示词并一键双语翻译，点击 **发送到画布** 即可自动连线布署。

> [!WARNING]
> **测试功能数据安全提醒：** 工作流配方与参数预设目前属于测试阶段，更新插件前建议备份 ComfyUI 用户目录下的 `workflows/anomalous_recipes` 与 `workflows/anomalous_parameters` 文件夹。

</details>

---

### 📝 License & Branding (开源与品牌声明)

* **Code License (代码授权)**: The source code is released under the [MIT License](LICENSE). 本项目源代码基于 MIT 许可证开源，可自由使用、修改与分发。
* **Branding & Trademarks (商标与品牌保护)**: The name **Anomalous Model Browser** and the official logo identify official releases. Forks should use distinct names/branding. 详见 [Trademark and Brand Policy](TRADEMARKS.md)。
