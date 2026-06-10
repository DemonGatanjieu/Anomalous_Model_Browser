# Anomalous Model Browser

[English](#english) | [中文](#中文)

---

<h2 id="english">English</h2>

A lightweight (< 250KB), zero-dependency ComfyUI model browser plugin featuring hash-level workflow repair, a powerful smart notebook, and gallery management.

### Core Feature 1: Hash-Level Workflow Repair (Gene-Level Self-Healing)

**Workflows and images generated or saved while this plugin is active will have their models' Civitai Hashes automatically embedded.**

When loading a workflow or image that was saved with this plugin, if you encounter red "Missing Node" errors due to mismatched model names:
1. Click the **Repair Workflow** button.
2. The plugin will scan your local directory using the embedded Hash data.
3. Once a match is found, it automatically reconnects and replaces the missing nodes.

*(Note: The plugin relies on these injected hashes for precise matching. Historical workflows or images generated without this plugin will lack the necessary hash data and cannot be automatically repaired.)*

### Core Feature 2: Smart Notebook (Workflow Drafting)

Since the local scanner natively identifies the architecture (Base Model) of your files, the Notebook acts as a powerful drafting area:
* **Architecture Filtering**: Select a Base Model, and the notebook will strictly filter and display only the compatible Main Models and Loras.
* **Visual Selection**: Displays preview images for your models directly within the notebook interface, natively utilizing scraped Civitai data.
* **Prompt Management**: Paste your prompts to instantly receive a bilingual translation for easy side-by-side editing.
* **One-Click Deploy**: Press "Send to Canvas" and your entire selected stack (Main Model, Loras, Prompts) will drop onto the canvas fully wired up, saving you from placing and connecting nodes one by one.

### Other Practical Features

* **O(1) Fast Scanning & Zero Dependencies**
  * No Node.js required, no bloated dependencies. Built natively for ComfyUI.
  * Exceptional scroll performance: smoothly browse thousands of models.
  * Eco Mode toggle: play previews on hover to save performance, or enable auto-play.
* **Native Output Gallery**
  * Natively browse your ComfyUI output history with infinite lazy loading.
  * Drag and drop any image from the gallery directly onto the canvas to restore its workflow.
* **Model Management**
  * Securely delete models from the UI, which also cleans up associated metadata and preview images.

### Installation Guide

Open your terminal, navigate to the ComfyUI `custom_nodes` folder, and run the following commands:

```bash
cd custom_nodes
git clone https://github.com/your-username/Anomalous_Model_Browser.git
```
*(Note: Restart ComfyUI after cloning to load the plugin. Please replace the URL with the actual repository URL)*

### Quick Start

**Standard Usage:**
1. **Step 1**: Click the new **Model Browser** button on the main menu or sidebar to open the model panel.
2. **Step 2**: Browse and locate your desired model. Click the **Add to Canvas** button on the model card, and the node will automatically appear on the canvas and connect.

**Repairing Broken Workflows:**
1. **Step 1**: Drag and drop a reference image containing Hash info (generated with this plugin) into the ComfyUI canvas.
2. **Step 2**: If environment paths differ and nodes turn red, click the prompted **Repair Workflow** button and wait for the plugin to restore node connections.

---

<h2 id="中文">中文</h2>

一个不到 250KB、零依赖、集成了哈希级工作流修复、智能笔记本与图库管理的 ComfyUI 模型浏览器插件。

### 核心特性一：哈希级工作流修复（基因级自愈）

**在启用本插件的状态下，生成或保存的工作流与图片，都会被自动注入模型对应的 Civitai Hash 和文件信息。** 

当你拖入一张由此插件保存的图片或工作流时，如果因为环境不同导致模型找不到、节点全红报错：
1. 点一下界面上的**修复工作流**按钮。
2. 插件会自动根据内置的 Hash 数据，在你的本地目录中精准寻找对应的模型。
3. 找到后自动重新连线替换，哪怕你把模型改成了任意名字。

*(注意：系统依赖模型哈希进行精准匹配。如果在没有安装本插件前生成的旧工作流，或他人未使用本插件生成的图片，由于缺失哈希信息，将无法触发全自动修复，仍需手动重选。)*

### 核心特性二：智能笔记本（工作流草稿本）

得益于本地扫描功能可以精准识别并提取模型的基础架构 (Base Model)，笔记本模块提供了极为强大的草稿与组装功能：
* **架构隔离筛选**：在笔记本中选定 Base Model 后，系统会自动为你筛选出与之完全兼容的主模型和 Lora，杜绝搭配错误。
* **可视化挑选**：直接在笔记本页面中显示模型的关联预览图（利用抓取的 C站 数据）。
* **提示词翻译对照**：粘贴提示词后，支持一键翻译，形成双语对照，方便打草稿和修改。
* **免连线一键发布**：配置好模型和提示词后，点击“发送到画布”，整套节点配置会被直接打包投放到画布并自动完成连线，彻底告别一个个拉节点和连线的折磨。

### 其他实用功能

* **O(1) 极速扫描与零依赖**
  * 不安装 Node.js，没有臃肿的依赖项，纯原生实现。
  * 列表滚动性能极佳，加载几千个模型依然流畅。
  * 提供节能模式与自动播放开关，鼠标悬浮即可预览视频或图片。
* **原生生成图库 (Gallery)**
  * 无缝浏览 ComfyUI output 文件夹内的历史生成记录，支持无限懒加载。
  * 支持将图库中的图片直接拖拽至画布，瞬间还原内嵌工作流。
* **内置模型与空间管理**
  * 支持在界面安全删除模型，并自动清理配套的垃圾信息文件及预览图。

### 安装指南

请打开命令行终端，进入 ComfyUI 的 `custom_nodes` 文件夹，执行以下命令即可完成安装：

```bash
cd custom_nodes
git clone https://github.com/your-username/Anomalous_Model_Browser.git
```
*(提示：克隆完成后，重启 ComfyUI 即可加载插件。请注意将 URL 替换为您实际的仓库地址)*

### 快速上手 (Quick Start)

**常规使用：**
1. **第一步**：点击界面主菜单或侧边栏新增的 **Model Browser** 按钮，展开模型面板。
2. **第二步**：在面板中浏览并找到需要的模型，点击卡片上的 **一键投放** 按钮，节点会自动出现在画布上并连好线。

**修复报错工作流：**
1. **第一步**：将带有 Hash 信息的图片（须在使用本插件的环境下生成）拖入 ComfyUI 画布。
2. **第二步**：若发生模型路径不匹配导致的飘红报错，点击提示的 **一键修复工作流** 按钮，等待插件在本地检索 Hash 并自动恢复节点连接。
