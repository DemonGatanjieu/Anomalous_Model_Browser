<div align="center">

# 🚀 Anomalous Model Browser

**A model browser and creative workspace for ComfyUI**  
*模型库 · 出图图库 · 工作流配方 · 素材库 · 角色配音 · 模型检查 · 操作记录*

<br/>

[![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge&logo=comfyui)](https://github.com/ltdrdata/ComfyUI-Manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Changelog](https://img.shields.io/badge/📖_Changelog-v1.57.3_Beta-blue?style=for-the-badge)](CHANGELOG.md)
[![Bilibili Video](https://img.shields.io/badge/Bilibili-视频演示-00A1D6?style=for-the-badge&logo=bilibili)](https://www.bilibili.com/video/BV1a1bv68EuA/)
[![YouTube Video](https://img.shields.io/badge/YouTube-Video_Demo-red?style=for-the-badge&logo=youtube)](https://youtu.be/hAvsj7uiaCw)

<br/>

[**English**](#english) | [**中文说明**](#中文)

</div>

---

<h2 id="english">🇬🇧 English</h2>

> **Anomalous Model Browser** takes care of the chores around ComfyUI in one window: browse your models with their Civitai covers and trigger words, look back through your outputs, keep workflows you have tuned, collect prompts and materials, repair workflows whose models are missing, and, with the companion node pack [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS), give your characters a voice. An activity log shows everything the plugin changed.

### 🎬 Video Walkthrough & Demos
* 📺 **YouTube**: [Watch Quick Walkthrough on YouTube](https://youtu.be/hAvsj7uiaCw)
* 📺 **Bilibili**: [Watch Video Demo on Bilibili (在哔哩哔哩观看)](https://www.bilibili.com/video/BV1a1bv68EuA/)

### 🌟 What it does

Every page has an icon on the rail at the left of the window.

| Page | What you do there |
| :--- | :--- |
| **🏠 Home** | Pick what you want to do: a card per task, first steps (scan your model folders, a guided tour of the interface) and your latest activity. |
| **🕘 Activity** | Everything the plugin changed, by day: on the canvas (which node settings changed from what to what, nodes added or removed, workflows opened) and in files (models, covers, recipes, materials, notes, images, audio). **Find on canvas** jumps to the node. It records only; your own edits are not listed. |
| **📦 Models** | Your models with covers, trigger words and base model. Chips at the top switch between types (Checkpoint, LoRA, VAE…) and list a whole type, subfolders included; the folder list narrows it to one folder. **+** adds a loader node to the canvas; edit a model's name, notes and cover, or scan just that model. |
| **🖼️ Gallery** | Your ComfyUI `output` folder. Search by prompt, model, LoRA, seed, file name or model hash; open an image to see the parameters it was made with, or drag it onto the canvas to get its workflow back. |
| **🪡 Workflows** | Workflow recipes: save a whole workflow or a part of one together with its models, cover, notes and parameters. Each card shows whether the models are on this computer; drag it onto the canvas to load it. Versions can be compared and restored. |
| **✨ Materials** | Save an output with its workflow and node settings. Drop a material on an empty canvas to open the workflow, drop a prompt to create prompt nodes, or drop it on a node to fill in that node's settings. |
| **🎙️ Voices / 🎧 Audio** | With [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) installed: import GPT-SoVITS characters, pick a reference clip per emotion, fix pronunciations, write a script under Voice-over on the same page and generate it right there; generated audio is listed in the audio gallery. Without it, the page explains how to install it and nothing else depends on it. |

Tools on the rail:

* **Scan** reads your model folders and fetches covers, trigger words and base models from Civitai (by file hash, no extra Python packages).
* **Model Check** (formerly Model Doctor) checks each workflow you open: when models are missing, a bar over the canvas says so and puts back, with one press, the ones you have under another name or folder (recognised by hash and file size); its page lists the rest with what you can do.
* **Current node** (formerly Node Assistant) shows the model of the node you select, lets you swap it from the covers or insert a LoRA, and lists every set of values saved for that kind of node with exactly what applying it would change.
* **Each tool on its page**: workflow share codes (import / export) on Workflows, Prompt Studio and Prompt Notes on Materials, Model Sources (where each model can be downloaded) on Models and in Model Check, translation on the prompt boxes in Current node.
* **Settings** (at the bottom): language, font size, thumbnails, video covers, which model folders to show, and feedback.

**Light on your computer**: the plugin itself loads no models, so it takes no graphics memory from image generation; the browser shows small thumbnails instead of full images, and its pictures are released a minute and a half after you close it. The voice models of Anomalous_TTS give their graphics memory back whenever ComfyUI needs it for image generation, and all of it on **Unload models**.

### 📦 Quick Installation

1. Open your terminal in the ComfyUI `custom_nodes` directory:
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. Restart ComfyUI. *(Alternatively, install via **ComfyUI Manager** by searching for `Anomalous Model Browser`)*
3. For character voices, also install [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) the same way. It is optional.
4. **Updating**: click the **!** button at the top right of the browser; it shows the current version, and **Check for updates / switch version** opens the version panel. Update to the newest release, go back to an earlier one or return to the latest, then restart ComfyUI. The plugin never checks for updates on its own.

Open the browser with **Ctrl + Shift + M**, the floating button on the canvas, or **Extensions → Anomalous Model Browser** in ComfyUI's menu. **ComfyUI Settings → Anomalous Model Browser → Interface** changes the shortcut, the language and how the browser is opened (floating button, a button next to Run, or the Extensions menu only).

The first time you open it, start on **Home**: **Scan model folders** fills in covers and trigger words, and **Tour the interface** points at each part of the window.

> [!WARNING]
> **Beta data protection:** Workflow Recipes, the Material Library and parameter presets are still in preview. Before updating, back up `workflows/anomalous_recipes`, `workflows/anomalous_materials` and `workflows/anomalous_parameters` in your ComfyUI user folder.

---

<h2 id="中文">🇨🇳 中文说明</h2>

> **Anomalous Model Browser** 在一个窗口里帮你打理 ComfyUI 周边的杂事：
> - 带 C 站封面和触发词浏览模型；
> - 翻看以前的出图；
> - 保存调好的工作流，收藏提示词和素材；
> - 别人的工作流缺模型时自动找回；
> - 配合配套节点包 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) 给角色配音。
>
> 插件改动过什么，都能在“操作记录”里查到。

### 🎬 视频演示与教程
* 📺 **哔哩哔哩 (Bilibili)**：[在 B 站观看快速上手与使用演示](https://www.bilibili.com/video/BV1a1bv68EuA/)
* 📺 **YouTube**：[在 YouTube 观看视频演示](https://youtu.be/hAvsj7uiaCw)

### 🌟 能做什么

窗口左侧的图标栏，每个页面一个图标。

| 页面 | 在这里做什么 |
| :--- | :--- |
| **🏠 主页** | 想做什么就点哪张卡片。还有上手第一步（扫描模型文件夹、界面导览）和最近的操作记录。 |
| **🕘 记录** | 按天列出插件做过的每一处改动。<br>画布上：哪个节点的设置从什么改成了什么、加了或删了哪些节点、打开了哪个工作流。<br>文件上：模型、封面、配方、素材、笔记、图片、音频。<br>**在画布上找到** 可以直接跳到那个节点。只记录、不撤销；你自己在画布上的修改不会记进来。 |
| **📦 模型** | 模型带封面、触发词和底模信息。<br>顶部标签切换类型（Checkpoint、LoRA、VAE…），连同子文件夹一起列出；左侧文件夹列表可以只看某个文件夹。<br>**+** 一键在画布上创建加载节点；也可以改名、写备注、换封面，或只扫描这一个模型。 |
| **🖼️ 图库** | 读取 ComfyUI 的 `output` 文件夹。<br>可以按提示词、模型、LoRA、seed、文件名或模型哈希搜索。<br>点开图片能看到生成参数；拖到画布上可以还原当时的工作流。 |
| **🪡 工作流** | 工作流配方：把完整工作流或其中一段，连同模型、封面、备注和参数一起存下来。<br>卡片会显示这台电脑上模型是否齐全；拖到画布上即可载入。<br>可以比较、恢复历史版本。 |
| **✨ 素材** | 把一张出图连同工作流和节点参数一起收藏。<br>拖到画布空白处：打开工作流，提示词素材会自动生成提示词节点。<br>拖到已有节点上：把参数填进去。 |
| **🎙️ 角色语音 / 🎧 音频库** | 装了 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) 后可用：<br>导入 GPT-SoVITS 角色，给每种情绪选参考音频，修正读音；切到“配音”写台词并直接生成。<br>生成的音频都在音频库里。没装时，页面会说明怎么安装，其他功能不受影响。 |

图标栏上的工具：

* **扫描**：读取模型文件夹，按文件哈希从 C 站获取封面、触发词和底模。不需要额外安装 Python 包。
* **模型检查**（原“模型医生”）：打开工作流时自动检查，缺模型就在画布上方提示；本地改过名、换过文件夹的同一个文件（按哈希和文件大小认）一键换上，其余的在检查页里自己挑或去 Civitai 找。
* **当前节点**（原“节点助手”）：选中画布上的节点，查看它用的模型。可以看图换模型、插入 LoRA；存过的同类节点参数列在一起，每条写明会改哪几项，一键套用。
* **工具回到各自的页面**：工作流分享码（导入导出）在“工作流”页，提示词工坊和提示词笔记在“素材”页，模型来源（每个模型去哪下载）在“模型”页和模型检查里，翻译在“当前节点”的提示词框上。
* **设置**（最下面）：语言、字号、缩略图、视频封面、显示哪些模型文件夹，以及提交反馈。

**不占你的资源**：
- 插件本身不加载任何模型，不和生图抢显存。
- 浏览时显示的是小缩略图，不加载原图；关闭窗口一分半后，图片也会释放掉。
- Anomalous_TTS 的语音模型在 ComfyUI 生图需要显存时会自动让出，点 **卸载模型** 时全部释放。

### 📦 快速安装

1. 在 ComfyUI 的 `custom_nodes` 目录下打开终端执行：
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. 重启 ComfyUI 即可使用。（*也可以直接在 **ComfyUI Manager** 搜索 `Anomalous Model Browser` 安装*）
3. 想用角色配音的话，用同样的方法再装 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS)。不装也不影响其他功能。
4. **更新插件**：
   - 点窗口右上角的 **!**，可以看到当前版本；
   - 点 **检查更新 / 切换版本** 打开版本面板，可以更新到最新版、回退到以前的版本，或回到最新版；
   - 换完版本后重启 ComfyUI。插件不会自己联网检查更新。

打开方式有三种：按 **Ctrl + Shift + M**、点击画布上的悬浮按钮，或者从 ComfyUI 菜单 **扩展 → Anomalous Model Browser** 打开。在 **ComfyUI 设置 → Anomalous Model Browser → 界面** 里，可以修改快捷键、插件语言和打开方式（悬浮按钮、运行按钮旁的按钮，或只用扩展菜单）。

第一次打开时会停在 **主页**：点 **扫描模型文件夹** 补全封面和触发词；点 **界面导览** 会逐一指给你看窗口的各个部分。

> [!WARNING]
> **测试功能数据安全提醒：** 工作流配方、素材库与参数预设仍在测试阶段。更新插件前，建议备份 ComfyUI 用户目录下的 `workflows/anomalous_recipes`、`workflows/anomalous_materials` 与 `workflows/anomalous_parameters` 文件夹。

---

### 📝 License & Branding (开源与品牌声明)

* **Code License (代码授权)**: The source code is released under the [MIT License](LICENSE). 本项目源代码基于 MIT 许可证开源，可自由使用、修改与分发。
* **Branding & Trademarks (商标与品牌保护)**: The name **Anomalous Model Browser** and the official logo identify official releases. Forks should use distinct names/branding. 详见 [Trademark and Brand Policy](TRADEMARKS.md)。
