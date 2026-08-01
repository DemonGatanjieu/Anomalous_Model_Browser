# Anomalous Model Browser

[![Changelog](https://img.shields.io/badge/📖_Read_the-Changelog-blue?style=for-the-badge)](CHANGELOG.md) [![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge)](https://github.com/ltdrdata/ComfyUI-Manager)

[English](#english) | [中文](#中文)

---

<h2 id="english">🇬🇧 English</h2>

> A highly professional, multi-functional ComfyUI model browser plugin. It integrates advanced model management, workflow healing, an intelligent drafting notebook, and a native output gallery.

### 🌟 Core Capabilities

| 🚀 Feature | 💡 Description |
| :--- | :--- |
| **Comprehensive Model Management** | Automatically extract Base Model architectures, cover images, trigger words, and author info by scanning model hashes. Customize model names, notes, and covers. Safely delete unwanted models or quickly replace them visually with cover icons. |
| **Workflow Node Repair (🩺)** | As long as a workflow/image was exported with this plugin active, the **Model Doctor (🩺)** can auto-detect missing nodes and replace them with correct local paths. Stubborn models? Use "Deep Hash Scan" or get Civitai links. |
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
* **Operation**: After opening, select a model node on your ComfyUI canvas. The redesigned action card can visually replace its current model or insert a LoRA before/after a compatible MODEL + CLIP chain. Picker cards show both model category and base-model badges. When choosing a LoRA, the connected main model's type is selected automatically when metadata is available; the filter can always be switched back to all LoRAs. Folder browsing, full-path search, sorting, and safe handling of ambiguous branches remain available.

#### 4. Settings Panel ⚙️
* **Location**: The Gear icon (**⚙️**) at the bottom left.
* **Operation**: Here you can adjust the UI language and main UI font size. Open **Model Settings** to choose always-play or hover-play video covers and optimized card thumbnails or original covers. Detail pages continue to use the original cover.

#### 5. Top Navigation & Smart Notebook 📑
**Location**: The top tabs: **Models (📦)**, **Gallery (🖼️)**, **Notebook (📑)**, and **Dock Side (◧)**.

**Notebook Operation**: 
1. Click the **Notebook (📑)** tab, then click the **➕ (New)** button and confirm.
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

> 一个高度专业、多功能的 ComfyUI 模型浏览器插件。集成了模型管理、工作流自愈修复、智能草稿本与原生图库管理。

### 🌟 核心功能特性

| 🚀 功能板块 | 💡 详细说明 |
| :--- | :--- |
| **全方位模型管理** | 通过扫描哈希值，自动获取模型的基础架构、封面、提示词、作者简介等信息。支持自定义名称、备注和封面。点开模型即刻呈现封面图标，支持看图一键替换模型，彻底告别复杂的模型路径！ |
| **节点智能修复 (🩺)** | 凡是由本插件导出的工作流和图片，在载入他人工作流时出现节点爆红，只需点开**模型医生 (🩺)**，即可自动识别正确的模型路径并一键替换。内置深度扫描与 C 站直达链接。 |
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
* **操作步骤**：打开后，在画布上选择模型节点。重新设计的操作卡可以替换当前模型，也可在兼容的 MODEL + CLIP 链前方或后方插入 LoRA。选择器卡片会标注模型类别和基础模型类型；选择 LoRA 时，如元数据可用，会自动按照已连接主模型的类型筛选，也可以随时切回全部 LoRA。文件夹浏览、完整路径搜索、排序和多分支安全保护仍然保留。

#### 4. 个性化配置 (设置面板) ⚙️
* **具体位置**：左侧底部的 **齿轮按钮 (⚙️)**。
* **操作步骤**：在此可以调节语言和主页面字体大小。进入 **模型设置** 后，可选择视频封面始终播放或悬停播放，也可选择卡片使用流畅缩略图或原始封面；模型详情页始终使用原始封面。

#### 5. 顶部导航与笔记本 (Notebook) 实战 📑
**具体位置**：右侧顶部的按钮分别为 **模型 (📦)**、**图库 (🖼️)**、**笔记本 (📑)**、**停靠侧边栏 (◧)**。

**笔记本操作步骤**：
1. 点击**笔记本 (📑)** 按钮，点击新建 **➕** 号，确认后进入草稿本。
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
