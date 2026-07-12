# Anomalous Model Browser

[![Changelog](https://img.shields.io/badge/📖_Read_the-Changelog-blue?style=for-the-badge)](CHANGELOG.md) [![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge)](https://github.com/ltdrdata/ComfyUI-Manager)

[English](#english) | [中文](#中文)

---

<h2 id="english">English</h2>

A highly professional, multi-functional ComfyUI model browser plugin. It integrates advanced model management, workflow healing, an intelligent drafting notebook, and a native output gallery.

### 🌟 Core Capabilities

1. **Comprehensive Model Management**: Automatically extract Base Model architectures, cover images, trigger words, and author info by scanning model hashes. It allows you to customize model names, notes, and covers. You can quickly view detailed info, history gallery, and trigger words. Furthermore, you can replace models visually with cover icons instead of complex file paths, and safely delete unwanted models.
2. **Workflow Node Repair**: As long as a workflow or image was exported with this plugin active (Identity Hash enabled), the **Model Doctor (🩺)** can auto-detect missing nodes and replace them with the correct local paths. For stubborn models, it provides a "Deep Hash Scan" or links directly to Civitai.
3. **Smart Notebook (Drafting Area 📑)**: Leveraging scanned local architectures, the Notebook offers rapid matching between Checkpoints, UNet, and compatible LoRA models. It features a built-in translation tool, auto-chunks prompts into bilingual tags, and supports 1-click deployment to the ComfyUI canvas.
4. **History Gallery**: Natively reads your local `output` folder. Supports 1-click viewing, deleting, and mouse-wheel zooming. You can drag and drop any generated image directly onto the canvas to instantly load its embedded workflow.
5. **Additional Features**: Click the top-right `➕` of any model card to deploy it to the canvas. The UI supports side-docking to leave space for your canvas operations.

### 📖 Step-by-Step Operating Guide

#### 1. Initialization (Scan Wizard)
* **Location**: The Scan icon (**🔄**) at the bottom left of the plugin interface.
* **Operation**: This is the most important prerequisite. Open the Scan Wizard, select your configuration, and execute the scan. Ensure your network is connected (entering an API-KEY in the settings is recommended for fetching specific Civitai model data).
* **Result**: This activates all core features of the plugin by building your local model database.

#### 2. Workflow Repair (Model Doctor)
* **Location**: The second Stethoscope icon (**🩺**) from the bottom left.
* **Operation**: When you import someone else's workflow (or an image exported with this plugin) and the nodes turn red due to missing paths, click the Model Doctor. It will intelligently identify all broken nodes and replace them with your correct local paths.

#### 3. Visual Swapping (Node Assistant)
* **Location**: The third Robot icon (**🤖**) from the bottom left.
* **Operation**: After opening, select any model node on your ComfyUI canvas. The Assistant will recognize the node's info, displaying its history gallery, notes, cover, details, and trigger words. It also allows you to quickly visually replace it with other models based on cover images.

#### 4. Settings Panel
* **Location**: The Gear icon (**⚙️**) at the bottom left.
* **Operation**: Here you can adjust the UI language (Language is adjusted here), main UI font size, and video cover auto-play modes.

#### 5. Top Navigation & Smart Notebook
* **Location**: The top tabs: **Models (📦)**, **Gallery (🖼️)**, **Notebook (📑)**, and **Dock Side (◧)**.
* **Notebook Operation**: 
  1. Click the **Notebook (📑)** tab, then click the **➕ (New)** button and confirm.
  2. Select a Base Model (e.g., SD1.5). You can then select compatible Main Models and LoRAs.
  3. Click **📝 Edit Raw / Paste** to paste your prompts. Select the language at the top-left of the input box for bilingual translation.
  4. After confirming, the plugin will automatically chunk your prompt into tags. You can find/replace or directly edit individual tags.
  5. Finally, click **🚀 Send to Canvas** to automatically wire and deploy the Checkpoint, LoRA, and CLIP Text Encode directly to your canvas!

---

### 📦 Installation

Open your terminal, go to your ComfyUI `custom_nodes` folder, and run:
```bash
cd custom_nodes
git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
```
*(Restart ComfyUI after cloning. Alternatively, search for `Anomalous Model Browser` inside the ComfyUI Manager and click Install!)*

---

<h2 id="中文">中文</h2>

一个高度专业、多功能的 ComfyUI 模型浏览器插件。集成了模型管理、工作流自愈修复、智能草稿本与原生图库管理。

### 🌟 核心功能特性

1. **全方位模型管理**：通过扫描哈希值，自动获取模型的 Base Model (基础架构)、封面、提示词、作者简介等信息，方便您快速比对并调节操作流程。支持自定义模型名称、备注和封面。提供快捷查看详细信息与历史生成图片的功能。此外，点开模型即刻呈现封面图标，方便您快捷替换模型，彻底告别复杂的模型路径带来的头疼；遇到不想用的模型，还提供了极其便捷的快捷删除功能。
2. **节点智能修复功能**：凡是由本插件导出的工作流和图片（只要开启了哈希身份证），在载入他人或旧工作流时出现节点爆红，只需点开**模型医生 (🩺)**，即可自动根据工作流内嵌的身份信息识别出本地正确的模型路径并一键替换。遇到简单扫描未能识别的顽固模型，可选择“深度扫描”进一步识别，若本地确实缺失，还提供了相关的 Civitai C站下载链接。
3. **智能笔记本 (📑) 功能**：基于扫描获取的本地模型基础架构，笔记本提供了快速的架构匹配功能，让您极速选择兼容的 Checkpoint、UNet 模型与对应的 LoRA 模型。内置强大的翻译功能，能自动将提示词分块打上标签，实现多语言提示词完美对照，并支持一键发布组装到工作流画布中。
4. **原生图库功能**：支持无缝读取本地的 `output` 输出文件夹。支持鼠标滚轮放大缩小，一键查看和安全删除历史图像。更绝的是，您可以直接将图片拖动到画布上，瞬间加载内嵌的工作流。
5. **其它便捷功能**：点击模型卡片右上角的 `➕` 号，可以快捷将相关的节点发布粘贴到画布。支持侧边栏停靠功能，将界面吸附在左侧，为您的画布留出充足的操作空间。

### 📖 标准操作说明

为了让插件发挥最大效能，请按照以下流程进行操作：

#### 1. 前置准备 (扫描向导)
* **具体位置**：界面左侧底部的 **扫描图标 (🔄)**。
* **操作步骤**：这是最重要的前置说明！请先打开扫描向导，根据需求选择扫描配置并执行扫描。**切记保持网络畅通**。部分 C站（Civitai）限制级模型信息需要在设置中填入 API-KEY。
* **功能激活**：扫描完成后，插件的各项核心功能即被全面激活，您的本地数据库已建立完毕。

#### 2. 拯救爆红 (模型医生)
* **具体位置**：左侧底部第二个 **听诊器按钮 (🩺)**。
* **操作步骤**：当导入别人使用该插件输出的工作流或者图片时，若发现模型路径爆红报错，点击模型医生，它就能智能识别当前所有的报错节点，并一键实现正确路径的替换。

#### 3. 选中交互 (节点助手)
* **具体位置**：左侧底部第三个 **机器人按钮 (🤖)**。
* **操作步骤**：打开节点助手后，在 ComfyUI 画布上点击选择任意一个模型节点。助手便会瞬间识别到该节点的各项信息，支持查看它的历史图库、备注、封面、模型详细页、触发词等。最强大的是，它能让您通过视觉化的模型封面，直接在侧边栏快捷替换其他模型。

#### 4. 个性化配置 (设置面板)
* **具体位置**：左侧底部的 **齿轮按钮 (⚙️)**。
* **操作步骤**：在此可以调节语言（多语言切换在这里调节）、主页面字体大小、以及视频封面的播放方式（节能或自动播放）等。

#### 5. 顶部导航与笔记本 (Notebook) 实战
* **具体位置**：右侧顶部的按钮分别为 **模型 (📦)**、**图库 (🖼️)**、**笔记本 (📑)**、**停靠侧边栏 (◧)**。
* **笔记本操作步骤**：
  1. 点击**笔记本 (📑)** 按钮，点击新建 **➕** 号，确认后进入草稿本。
  2. 首先选择基础模型（例如 SD1.5），随后系统会为你过滤出兼容的的主模型 (Checkpoint) 和对应的 LoRA 模型供你选择。
  3. 点击下方的 **📝 纯文本/粘贴**，把你的提示词复制进去，选择输入框左上角的语言，即可实现双语对照翻译。
  4. 确认后，插件会自动将提示词分块生成标签 (Tags)，支持查找替换，也支持直接双击修改单个标签。
  5. 最后，点击下方的 **🚀 发送到画布** 按钮，系统会将你打包好的主模型、LoRA 以及 CLIP 文本编码器，一键自动连线并发布到画布上！

---

### 📦 安装指南

打开命令行终端，进入 ComfyUI 的 `custom_nodes` 文件夹，执行以下命令：
```bash
cd custom_nodes
git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
```
*(克隆完成后，重启 ComfyUI 即可。您也可以直接在 ComfyUI Manager（管理器）中搜索 `Anomalous Model Browser` 并一键点击安装！)*
