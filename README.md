# Anomalous Model Browser

[English](#english) | [中文](#中文)

---

<h2 id="english">English</h2>

A lightweight (< 250KB), zero-dependency ComfyUI model browser plugin featuring hash-level workflow repair.

### Core Feature: Hash-Level Workflow Repair (Gene-Level Self-Healing)

**All workflows generated while this plugin is active will automatically embed the corresponding Civitai Hash of the models.**

When you load an image or workflow shared by others and encounter red "Missing Node" errors due to mismatched model names:
1. Click the **Repair Workflow** button.
2. The plugin will automatically scan your local directory using the embedded Hash data.
3. Once found, it automatically reconnects and replaces the missing nodes.

**Even if you have completely renamed your local models, as long as the file content remains identical, the plugin will recognize and repair them.**

### Other Practical Features

* **O(1) Fast Scanning & Zero Dependencies**
  * No Node.js required, no bloated dependencies. Built natively for ComfyUI.
  * Exceptional scroll performance: smoothly browse thousands of models without UI lag.
  * Hover preview: simply hover over a model to automatically play its video or view its image.
* **Smart Node Assembly**
  * Built-in interactive bilingual prompt notebook.
  * Automatically matches Lora models based on your selected Base Model.
  * One-click drop to canvas: eliminates tedious manual wiring by automatically creating and connecting nodes.
* **Built-in Translation & Model Management**
  * Native prompt translation powered by DeepL and Google Translate.
  * Securely delete models from the UI, which also automatically cleans up associated metadata and preview images.

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
1. **Step 1**: Drag and drop a reference image containing Hash info into the ComfyUI canvas (nodes may turn red if your environment differs).
2. **Step 2**: Click the prompted **Repair Workflow** button and wait for the plugin to retrieve the Hash locally and restore node connections.

---

<h2 id="中文">中文</h2>

一个不到 250KB、零依赖、支持哈希级工作流修复的 ComfyUI 模型浏览器插件。

### 核心痛点解决：基因级自愈（哈希级工作流修复）

**只要是用本插件生成的图，都会自动注入模型对应的 Civitai Hash。** 

当你拖入一张他人分享、但模型全红报错的图片时：
1. 点一下界面上的**修复工作流**按钮。
2. 插件会自动根据内置的 Hash 数据，在你的本地目录中寻找对应的模型。
3. 找到后自动重新连线替换。

**哪怕你把本地模型的名字改得面目全非，只要文件内容没变，插件就能认出来并完成修复。**

### 其他实用功能

* **O(1) 极速扫描与零依赖**
  * 不安装 Node.js，没有臃肿的依赖项，纯原生实现。
  * 列表滚动性能极佳，加载几千个模型依然流畅不卡顿。
  * 支持悬停预览，鼠标放上去即可播放视频或查看图片。
* **智能节点组装**
  * 内置交互式双语提示词本。
  * 自动匹配与之（Base Model）关联的 Lora。
  * 免除繁琐的手动连线，一键即可投放到画布中完成节点组装。
* **内置翻译与模型管理**
  * 支持 DeepL 与 Google 翻译，方便编写提示词。
  * 支持在界面直接删除模型，并会自动清理配套的垃圾信息文件及预览图。

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
1. **第一步**：将带有 Hash 信息的参考图拖入 ComfyUI 画布（因环境不同，部分节点可能会变红报错）。
2. **第二步**：点击提示的 **修复工作流** 按钮，等待插件在本地检索 Hash 并自动恢复节点连接。
