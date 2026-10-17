<div align="center">

# 🚀 Anomalous Model Browser

**A model browser and creative workspace for ComfyUI**  
*模型库 · 出图图库 · 工作流配方 · 搭配 · 提示词 · 角色配音 · 模型检查 · 操作记录*

<br/>

[![ComfyUI Manager](https://img.shields.io/badge/ComfyUI-Manager-green?style=for-the-badge&logo=comfyui)](https://github.com/ltdrdata/ComfyUI-Manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Changelog](https://img.shields.io/badge/📖_Changelog-v1.60.1-blue?style=for-the-badge)](CHANGELOG.md)
[![Bilibili Video](https://img.shields.io/badge/Bilibili-视频演示-00A1D6?style=for-the-badge&logo=bilibili)](https://www.bilibili.com/video/BV1boHx61Enc/)
[![Bilibili Voices](https://img.shields.io/badge/Bilibili-配音演示-00A1D6?style=for-the-badge&logo=bilibili)](https://www.bilibili.com/video/BV1bkpZ6uEZQ/)
[![Reddit](https://img.shields.io/badge/Reddit-r%2Fcomfyui-FF4500?style=for-the-badge&logo=reddit)](https://www.reddit.com/r/comfyui/s/n38ihf3DLf)

<br/>

[**English**](#english) | [**中文说明**](#中文)

<br/>

<img src="docs/images/en-models.webp" width="900" alt="Models with their Civitai covers, base model and real names">

</div>

---

<h2 id="english">🇬🇧 English</h2>

> **Anomalous Model Browser** takes care of the chores around ComfyUI in one window: browse your models with their Civitai covers and trigger words, look back through your outputs, keep workflows you have tuned, keep model combos and prompts, repair workflows whose models are missing, and, with the companion node pack [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS), give your characters a voice. An activity log shows everything the plugin changed.

### 🎬 Videos and discussion
* 📺 **Bilibili** (Chinese): [Video demo](https://www.bilibili.com/video/BV1boHx61Enc/) · [Character voices demo](https://www.bilibili.com/video/BV1bkpZ6uEZQ/)
* 💬 **Reddit**: [The post on r/comfyui](https://www.reddit.com/r/comfyui/s/n38ihf3DLf)

### 💡 What it helps with

**1. "Which LoRA was that again?"** A file called `download (3).safetensors` tells you nothing. Press **Scan** once: every model is looked up on Civitai by its file hash and gets its real name, cover, trigger words and base model. From then on you pick models by their covers.

<p align="center"><img src="docs/images/en-scan.webp" width="520" alt="Scan results: each file matched on Civitai"></p>

**2. Someone else's workflow opens with red nodes.** Model Check says which models are missing. When the workflow carries model fingerprints (the plugin writes them into the workflows and images of everyone who has it, unless they turn it off), the ones you already have under another name or in another folder go back in with one press, and the rest can be downloaded from Civitai or Hugging Face, each download checked against its fingerprint. A workflow without fingerprints can only be matched by file name: a file of the same name elsewhere on your computer is offered for you to confirm.

<p align="center"><img src="docs/images/en-model-check.webp" width="760" alt="Model Check puts back three missing models with one press"></p>

**3. "How did I make this picture?"** Search your outputs by prompt words, model or LoRA, then drag the picture onto the canvas: its workflow comes back.

<p align="center"><img src="docs/images/en-gallery.webp" width="760" alt="Gallery search, then drag an image onto the canvas"></p>

**4. The same model, LoRAs and prompt, again and again.** Pick those nodes on the canvas, right-click → **Save as combo**, and they are kept as a card beside the canvas. Next time press **Put on canvas** (or drag the card) and the wired group comes back where you click; nothing already on the canvas changes. Models and prompts in a combo can be changed later.

<p align="center"><img src="docs/images/en-combo.webp" width="760" alt="Picked nodes saved as a combo, then put back on the canvas as wired nodes"></p>

**5. Long prompts are hard to edit.** Select a prompt node and Prompt Studio shows its text as tags: click to weight, drag to reorder, type to add (Chinese and other languages become English).

<p align="center"><img src="docs/images/en-prompt-studio.webp" width="760" alt="Prompt Studio editing a prompt node as tags"></p>

**6. Characters that talk.** With the companion node pack [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS): GPT-SoVITS characters with a reference clip per emotion, and a script page to voice them.

<p align="center"><img src="docs/images/en-voices.webp" width="760" alt="Character voices page"></p>

**Changed your mind?** Everything the plugin changes is listed in **Activity**, with **Undo** and **Find on canvas**.

<p align="center"><img src="docs/images/en-activity.webp" width="620" alt="Activity log with an undo button"></p>

**Light on your computer**: the plugin itself loads no models, so it takes no graphics memory from image generation; the browser shows small thumbnails instead of full images, and its pictures are released a minute and a half after you close it. The voice models of Anomalous_TTS give their graphics memory back whenever ComfyUI needs it for image generation, and all of it on **Unload models**.

### 📦 Install

1. In **ComfyUI Manager**, search `Anomalous Model Browser`, install it and restart ComfyUI. Or clone it into `custom_nodes`:
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. Press **Shift + B** to open it. On **Home**, **Scan model folders** fills in covers and trigger words, and **Tour the interface** points at each part of the window.
3. Optional: for character voices, also install [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) (search `Anomalous TTS` in ComfyUI Manager).

Scanning needs to reach Civitai. Without it, scan offline: base models are read from the files, and a later online scan fills in the rest (see **Network and backups** below).

<details>
<summary><b>📖 Every page and tool, in detail</b></summary>

Every page has an icon on the rail at the left of the window.

| Page | What you do there |
| :--- | :--- |
| **🏠 Home** | Pick what you want to do: a card per task, first steps (scan your model folders, a guided tour of the interface) and your latest activity. |
| **🕘 Activity** | Everything the plugin changed, by day: on the canvas (which node settings changed from what to what, nodes added or removed, workflows opened) and in files (models, covers, recipes, materials, notes, images, audio). **Find on canvas** jumps to the node; a canvas change can be undone with **Undo** until something changes it again, the rest is recorded only. Your own edits are not listed. |
| **📦 Models** | Your models with covers, trigger words and base model. Chips at the top switch between types (Checkpoint, LoRA, VAE…) and list a whole type, subfolders included; the folder list narrows it to one folder. **+** adds a loader node to the canvas; edit a model's name, notes and cover, or scan just that model. |
| **🖼️ Gallery** | Your ComfyUI `output` folder. Search by prompt, model, LoRA, seed, file name or model hash; open an image to see the parameters it was made with, or drag it onto the canvas to get its workflow back. **☆** keeps a good one as a whole workflow, a combo (model, LoRAs, prompt) or just its prompts. |
| **🪡 Workflows** | Workflow recipes: save a whole workflow or a part of one together with its models, cover, notes and parameters. Each card shows whether the models are on this computer; drag it onto the canvas to load it. Versions can be compared and restored. A card's export button makes a **recipe package** (.zip) to give to someone; dropped into their ⇅, it becomes a recipe card. |
| **🧩 Combos** | A main model, a few LoRAs and a prompt you like, kept together. **Put on canvas** (or dragging the card onto the canvas) lays them out as a wired group of nodes; nothing already on the canvas changes. |
| **✍️ Prompts** | Prompt Studio, a page of the browser; **Beside the canvas** moves it next to the canvas to see both. Select a prompt node and its prompt boxes appear as tags, edited in place: click a tag to make it stronger or weaker, double-click to edit, drag to reorder, type to add (Chinese, Japanese and other languages are translated to English), and show each tag's meaning in Chinese, Japanese, Korean and other languages. Click a card (a few common ones, plus your saved prompts) to add it, or drag it straight onto a prompt box on the canvas (outlined green for positive, red for negative) or onto empty canvas for a new prompt node. With no prompt node selected you write a draft. |
| **🎙️ Voices / 🎧 Audio** | With [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) installed: import GPT-SoVITS characters, pick a reference clip per emotion, fix pronunciations, write a script under Voice-over on the same page and generate it right there; generated audio is listed in the audio gallery. Without it, the page explains how to install it and nothing else depends on it. |

Tools on the rail:

* **Scan** reads your model folders and fetches covers, trigger words and base models from Civitai (by file hash, no extra Python packages).
* **Model Check** (formerly Model Doctor) checks each workflow you open: when models are missing, a bar over the canvas says so and puts back, with one press, the ones you have under another name or folder, recognised by the fingerprints (hash and file size) the plugin records in workflows and images (**Settings → Record model fingerprints in workflows**, on by default); without them, a file of the same name is offered for you to confirm. Its page lists the rest with what you can do.
* **Current node** (formerly Node Assistant) shows the model of the node you select, lets you swap it from the covers or insert a LoRA, and lists every set of values saved for that kind of node with exactly what applying it would change; saved values can be deleted there.
* **Each tool on its page**: share and import on Workflows (⇅: a short share code of the canvas workflow, in Chinese characters or letters; paste a code, or drop a workflow file, an image or a backup .zip), Model Sources (where each model can be downloaded) on Models and in Model Check, translation on the prompt boxes in Current node.
* **Settings** (at the bottom): language, font size, thumbnails, video covers, which model folders to show, and feedback. Home and Settings have **Report a problem**, which opens a GitHub issue with your versions and GPU already filled in.

**AI apps (MCP)**: Claude, Cursor, Cherry Studio and other apps that support MCP can use your library through `http://127.0.0.1:8188/anomalous/mcp`: answer questions about your models, outputs and saved prompts, and change the open workflow for you (prompts, models, LoRAs, combos, missing models), each change one Ctrl+Z step. Local only; setup in [docs/guides/mcp.md](docs/guides/mcp.md).

</details>

<details>
<summary><b>⚙️ Opening, shortcuts and updating</b></summary>

Open the browser with **Shift + B** (again to close), the floating button on the canvas, or **Extensions → Anomalous Model Browser** in ComfyUI's menu. **ComfyUI Settings → Anomalous Model Browser → Interface** changes the shortcut, the language and how the browser is opened (floating button, a button next to Run, or the Extensions menu only).

**Updating**: click the **!** button at the top right of the browser; it shows the current version, and **Check for updates / switch version** opens the version panel. Update to the newest release, go back to an earlier one or return to the latest, then restart ComfyUI. The plugin never checks for updates on its own.

</details>

<details>
<summary><b>🌐 Network and backups</b></summary>

**On a cloud server (AutoDL, RunPod…):** fully supported on overseas servers; on servers in mainland China only in part (Civitai is mostly out of reach there: lookups are unreliable, covers rarely download). Not fully tested yet (one AutoDL server so far). The guide has a section for AI assistants to walk you through it. Opened from another computer, the plugin is view only by default. Open ComfyUI through an SSH tunnel, or see [docs/guides/cloud-server.md](docs/guides/cloud-server.md).

**Network:** Scan looks models up on Civitai and prompt translation uses Google Translate, so both need to reach those sites (from mainland China usually through a proxy; when civitai.com cannot be reached the plugin tries Civitai's other address, civitai.red, which some networks reach, a cloud server in mainland China among them: names and trigger words come, covers usually not). Without them, pick **Offline** on the scan page (an online scan does the same by itself when it cannot connect): base models are read from the files, without covers or trigger words, and a later online scan fills in the rest. Downloading missing models needs the network too; for Hugging Face, **Settings → Model downloads** can use the hf-mirror.com mirror (Civitai has none). Browsing models, outputs, workflows and combos needs no network.

**Keep a copy of your own data:** **Settings → Backup → Export** packs Workflow Recipes, combos, saved prompts and node values, parameter presets, and the names, notes and covers you gave your models into one .zip; keep it on a cloud drive or a USB stick, and **Import** puts it back, also on another computer. (They live in `workflows/anomalous_recipes`, `workflows/anomalous_notebooks`, `workflows/anomalous_materials` and `workflows/anomalous_parameters` in your ComfyUI user folder.)

</details>

---

<h2 id="中文">🇨🇳 中文说明</h2>

> **Anomalous Model Browser** 在一个窗口里帮你打理 ComfyUI 周边的杂事：
> - 带 C 站封面和触发词浏览模型；
> - 翻看以前的出图；
> - 保存调好的工作流，存下常用的模型搭配和提示词；
> - 别人的工作流缺模型时自动找回；
> - 配合配套节点包 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) 给角色配音。
>
> 插件改动过什么，都能在“操作记录”里查到。

### 🎬 视频与讨论
* 📺 **哔哩哔哩 (Bilibili)**：[功能演示](https://www.bilibili.com/video/BV1boHx61Enc/) · [角色配音演示](https://www.bilibili.com/video/BV1bkpZ6uEZQ/)
* 💬 **Reddit**：[r/comfyui 上的介绍帖](https://www.reddit.com/r/comfyui/s/n38ihf3DLf)

### 💡 它能帮你解决什么

**1. 模型太多，认不出谁是谁。** 文件叫 `下载 (3).safetensors`，根本看不出是什么。点一次 **扫描**，每个模型都按文件哈希去 C 站认一遍，显示出它真正的名字、封面、触发词和底模。以后看封面挑模型就行。

<p align="center"><img src="docs/images/scan.webp" width="520" alt="扫描结果：每个文件都在 C 站认出来了"></p>

**2. 打开别人的工作流，一片红框。** 模型检查会告诉你缺哪些模型。如果工作流里带着模型指纹（装了本插件的人出图、保存工作流时会自动记下，除非他在设置里关掉），你电脑里其实有、只是改了名或换了文件夹的，点一下就换上；真没有的可以从 C 站或 Hugging Face 下载，下载完按指纹核对过才用。没有指纹的工作流只能按文件名找：别处有同名文件，会列出来让你确认。

<p align="center"><img src="docs/images/model-check.webp" width="760" alt="模型检查一键换上 3 个缺失的模型"></p>

**3. 这张图当时是怎么出的？** 在图库里按提示词、模型或 LoRA 搜，再把图拖到画布上，当时的工作流就回来了。

<p align="center"><img src="docs/images/gallery.webp" width="760" alt="图库搜索后把图拖到画布"></p>

**4. 每次都要重新配一遍模型、LoRA 和提示词。** 存成一个搭配。把卡片拖到画布空白处，就放出一组连好线的节点，画布上原有的东西不动。

<p align="center"><img src="docs/images/combo.webp" width="760" alt="搭配卡片拖到画布变成连好线的节点"></p>

**5. 提示词太长，改起来麻烦。** 选中提示词节点，提示词工坊把它拆成词块：点一下调权重，拖动换位置，输入就加（中文会自动译成英文）。

<p align="center"><img src="docs/images/prompt-studio.webp" width="760" alt="提示词工坊按词块编辑提示词节点"></p>

**6. 想让角色开口说话。** 配合配套节点包 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS)：导入 GPT-SoVITS 角色，每种情绪一段参考音频，在配音页写台词直接生成。

<p align="center"><img src="docs/images/voices.webp" width="760" alt="角色语音页面"></p>

**改错了也不怕。** 插件做的每一处改动都列在“操作记录”里，带 **撤销** 和 **在画布上找到**。

<p align="center"><img src="docs/images/activity.webp" width="560" alt="操作记录和撤销按钮"></p>

**不占你的资源**：
- 插件本身不加载任何模型，不和生图抢显存。
- 浏览时显示的是小缩略图，不加载原图；关闭窗口一分半后，图片也会释放掉。
- Anomalous_TTS 的语音模型在 ComfyUI 生图需要显存时会自动让出，点 **卸载模型** 时全部释放。

### 📦 安装

1. 在 **ComfyUI Manager** 里搜索 `Anomalous Model Browser`，安装后重启 ComfyUI。也可以在 `custom_nodes` 目录下手动安装：
   ```bash
   cd custom_nodes
   git clone https://github.com/DemonGatanjieu/Anomalous_Model_Browser.git
   ```
2. 按 **Shift + B** 打开。在 **主页** 点 **扫描模型文件夹** 补全封面和触发词；点 **界面导览** 会逐一指给你看窗口的各个部分。
3. 想用角色配音的话，再装 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS)（在 ComfyUI Manager 搜索 `Anomalous TTS`）。不装也不影响其他功能。

扫描要连 C 站。连不上也能用：选离线扫描，只从模型文件推断底模，以后能连上时再扫一次会自动补上（见下面的“网络和备份”）。

<details>
<summary><b>📖 每个页面和工具的详细说明</b></summary>

窗口左侧的图标栏，每个页面一个图标。

| 页面 | 在这里做什么 |
| :--- | :--- |
| **🏠 主页** | 想做什么就点哪张卡片。还有上手第一步（扫描模型文件夹、界面导览）和最近的操作记录。 |
| **🕘 记录** | 按天列出插件做过的每一处改动。<br>画布上：哪个节点的设置从什么改成了什么、加了或删了哪些节点、打开了哪个工作流。<br>文件上：模型、封面、配方、素材、笔记、图片、音频。<br>**在画布上找到** 可以直接跳到那个节点；画布上的改动在没被再改过之前可以点 **撤销**，其余只记录。你自己在画布上的修改不会记进来。 |
| **📦 模型** | 模型带封面、触发词和底模信息。<br>顶部标签切换类型（Checkpoint、LoRA、VAE…），连同子文件夹一起列出；左侧文件夹列表可以只看某个文件夹。<br>**+** 一键在画布上创建加载节点；也可以改名、写备注、换封面，或只扫描这一个模型。 |
| **🖼️ 图库** | 读取 ComfyUI 的 `output` 文件夹。<br>可以按提示词、模型、LoRA、seed、文件名或模型哈希搜索。<br>点开图片能看到生成参数；拖到画布上可以还原当时的工作流。<br>觉得好就点 **☆**：存成整个工作流、搭配（模型 + LoRA + 提示词），或者只存提示词。 |
| **🪡 工作流** | 工作流配方：把完整工作流或其中一段，连同模型、封面、备注和参数一起存下来。<br>卡片会显示这台电脑上模型是否齐全；拖到画布上即可载入。<br>可以比较、恢复历史版本。<br>卡片上的导出按钮能打成**配方包**（压缩包）发给别人，对方拖进 ⇅ 就多一张配方卡片。 |
| **🧩 搭配** | 把常用的主模型、几个 LoRA 和一段提示词存成一个搭配。<br>按 **放到画布**（或把卡片拖到画布上），就放出一组连好线的节点；画布上原有的东西不动。 |
| **✍️ 提示词** | 提示词工坊，浏览器里的一个页面；点“停到画布旁”可以移到画布旁边，边看画布边改。选中一个提示词节点，它的提示词框就以词块的样子出现在工坊里，直接改：点一下调权重，双击改字，拖动换位置，输入就加（中文、日文等会自动译成英文），还能在每个词下面显示它的中文、日文、韩文等语言的意思。<br>点词卡（几张常用的，加上你存的）加进去，或者直接拖到画布的提示词框里（正面绿框、负面红框），拖到空白处就新建一个提示词节点。没选中提示词节点时写的是草稿。 |
| **🎙️ 角色语音 / 🎧 音频库** | 装了 [Anomalous_TTS](https://github.com/DemonGatanjieu/Anomalous_TTS) 后可用：<br>导入 GPT-SoVITS 角色，给每种情绪选参考音频，修正读音；切到“配音”写台词并直接生成。<br>生成的音频都在音频库里。没装时，页面会说明怎么安装，其他功能不受影响。 |

图标栏上的工具：

* **扫描**：读取模型文件夹，按文件哈希从 C 站获取封面、触发词和底模。不需要额外安装 Python 包。
* **模型检查**（原“模型医生”）：打开工作流时自动检查，缺模型就在画布上方提示；本地改过名、换过文件夹的同一个文件一键换上，靠的是插件记在工作流和图片里的模型指纹（哈希和文件大小；**设置 → 在工作流里记下模型指纹**，默认打开）；没有指纹时，同名文件会列出来让你确认。其余的在检查页里自己挑或去 Civitai 找。
* **当前节点**（原“节点助手”）：选中画布上的节点，查看它用的模型。可以看图换模型、插入 LoRA；存过的同类节点参数列在一起，每条写明会改哪几项，一键套用；存下的参数也在这里删除。
* **工具回到各自的页面**：分享与导入在“工作流”页（⇅：把画布上的工作流变成一段短短的分享码，有汉字码和字母码；也能粘贴分享码，或拖入工作流文件、图片、备份压缩包），模型来源（每个模型去哪下载）在“模型”页和模型检查里，翻译在“当前节点”的提示词框上。
* **设置**（最下面）：语言、字号、缩略图、视频封面、显示哪些模型文件夹，以及提交反馈。主页和设置里的 **报告问题** 会打开一个已经填好版本和显卡信息的 GitHub 页面。

**接入 AI 软件（MCP）**：Claude、Cursor、Cherry Studio 等支持 MCP 的 AI 软件，可以通过 `http://127.0.0.1:8188/anomalous/mcp` 查你的模型、出图和存下的提示词，回答相关问题；也能帮你改当前工作流（提示词、模型、LoRA、搭配、缺失的模型），每次改动都能用 Ctrl+Z 撤销。只限本机。设置方法见 [docs/guides/mcp.md](docs/guides/mcp.md)。

</details>

<details>
<summary><b>⚙️ 打开方式、快捷键和更新</b></summary>

打开方式有三种：按 **Shift + B**（再按一次关闭）、点击画布上的悬浮按钮，或者从 ComfyUI 菜单 **扩展 → Anomalous Model Browser** 打开。在 **ComfyUI 设置 → Anomalous Model Browser → 界面** 里，可以修改快捷键、插件语言和打开方式（悬浮按钮、运行按钮旁的按钮，或只用扩展菜单）。

**更新插件**：
- 点窗口右上角的 **!**，可以看到当前版本；
- 点 **检查更新 / 切换版本** 打开版本面板，可以更新到最新版、回退到以前的版本，或回到最新版；
- 换完版本后重启 ComfyUI。插件不会自己联网检查更新。

</details>

<details>
<summary><b>🌐 网络和备份</b></summary>

**在云服务器上（AutoDL 等）：** 海外的云服务器完整支持；国内的云服务器只能部分支持（多半连不上 Civitai，查模型不稳定，封面基本下不来）。目前还没有完整测过（只实测过一台 AutoDL 服务器），用的时候请留意。说明里有一节写给 AI 看的步骤，把链接丢给 AI 就能让它带你做。从别的电脑打开时插件默认只能浏览。用 SSH 隧道打开就能照常用，或者见 [docs/guides/cloud-server.md](docs/guides/cloud-server.md)。

**关于网络：** 扫描模型要连 Civitai（C 站）查封面和触发词，提示词翻译默认用谷歌翻译，这两样在国内一般要开网络代理才能用。不开代理也行：扫描页选 **离线**（联网扫描连不上时也会自动改成这样），只从模型文件推断底模，没有封面和触发词，以后能连上时再扫一次会自动补上。下载缺失的模型也要联网：Hugging Face 的模型可以在 **设置 → 模型下载** 里打开“Hugging Face 用国内镜像”，不用代理；C 站的没有镜像。（civitai.com 连不上时插件会自动试 Civitai 的另一个地址 civitai.red，有的网络能连上，比如国内的云服务器，这时能认出模型名字和触发词，封面多半还是下不来。）浏览模型、图库、工作流和搭配都不用联网。

**备份自己的数据：** **设置 → 备份 → 导出**，把工作流配方、搭配、存下的提示词和节点参数、参数预设，以及你给模型改的名字、备注和封面打成一个压缩包，放到云端硬盘或 U 盘里；换电脑或重装后用 **导入** 恢复。（它们存在 ComfyUI 用户目录下的 `workflows/anomalous_recipes`、`workflows/anomalous_notebooks`、`workflows/anomalous_materials` 与 `workflows/anomalous_parameters`。）

</details>

---

### 🧪 Tests (测试)

The plugin's tests are in `tests/`; run them all with `node tools/run_tests.mjs` from the plugin folder. See [docs/guides/testing.md](docs/guides/testing.md).
插件的测试在 `tests/` 里，在插件文件夹运行 `node tools/run_tests.mjs` 一次跑完。改代码或提 PR 之前跑一遍，说明见 [docs/guides/testing.md](docs/guides/testing.md)。

### 📝 License & Branding (开源与品牌声明)

* **Code License (代码授权)**: The source code is released under the [MIT License](LICENSE). 本项目源代码基于 MIT 许可证开源，可自由使用、修改与分发。
* **Branding & Trademarks (商标与品牌保护)**: The name **Anomalous Model Browser** and the official logo identify official releases. Forks should use distinct names/branding. 详见 [Trademark and Brand Policy](TRADEMARKS.md)。
