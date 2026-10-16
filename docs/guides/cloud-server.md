# 在云服务器上使用（AutoDL 等）

> **先说清楚支持到什么程度：**
> - **海外的云服务器**（RunPod 等）：完整支持。能连上 Civitai，扫描能拿到名字、触发词和封面。
> - **国内的云服务器**（AutoDL 等）：只能部分支持。浏览、离线扫描、整理模型都能用，但服务器多半连不上 Civitai：查模型不稳定，封面基本下不来。
>
> 下面的开关两种服务器都要用。
>
> **还没有完整测过：** 作者只在一台 AutoDL 服务器上实测过，海外服务器还没测过。用的时候请自己留意，遇到问题欢迎反馈。
>
> **想让 AI 帮你弄？** 把这页的链接发给 ChatGPT、Claude 之类的 AI，说“照着这页最后的 For AI assistants 一节带我做”就行。

ComfyUI 装在租来的云服务器上（AutoDL、RunPod 之类），你在自己电脑的浏览器里打开它时，对插件来说页面是从“别的设备”打开的。为了不让别人远程改动你的文件，插件默认只让这种页面浏览：标题旁会显示 **仅浏览**，扫描、下载、移动、删除、保存这类改动会被拒绝。

想在云服务器上照常使用，有两个办法，选一个就行。

## 办法一：用 SSH 隧道打开（推荐，什么都不用改）

SSH 隧道把服务器上 ComfyUI 的端口接到你自己电脑上，浏览器打开的是 `http://127.0.0.1:端口`。请求在服务器上也是从本机发出的，插件就当成本机，所有功能都能用，也不会把页面开放给别人。

AutoDL 控制台里每台实例都有 SSH 登录指令和密码，平台也提供了现成的隧道小工具；按平台说明把 ComfyUI 的端口（常见是 6006 或 8188）映射到本地，再用浏览器打开映射出来的 127.0.0.1 地址即可。

## 办法二：在服务器上放一个开关文件

如果你只能用平台给的网址打开 ComfyUI，最简单的做法：

1. 点标题旁的 **仅浏览**，在弹出的说明里点 **复制**。复制的是一行命令，已经填好了你服务器上插件的真实位置。
2. 打开服务器的终端（AutoDL：JupyterLab → 终端），粘贴，按回车。
3. 重启 ComfyUI。启动日志里会出现一行提示，标题旁的标签变成黄色的 **远程可修改**。

想自己动手也可以：

1. 在服务器上打开插件文件夹 `ComfyUI/custom_nodes/Anomalous_Model_Browser`（AutoDL 可以用 JupyterLab 的文件浏览器，或在终端里操作）。
2. 新建一个空文件，名字是 `allow_remote_changes`（没有扩展名）。终端里可以这样做：

   ```bash
   touch ComfyUI/custom_nodes/Anomalous_Model_Browser/allow_remote_changes
   ```

3. 重启 ComfyUI。启动日志里会出现一行提示，标题旁的标签变成黄色的 **远程可修改**。

**风险：** 打开之后，任何能打开这个网址的人都能扫描、移动、删除（进回收站）你的模型，改插件设置，也能用你的 Civitai Key。只在网址不外传时这样做；不需要了就删掉这个文件（点黄色的 **远程可修改**，里面也有一行可以复制的命令），再重启 ComfyUI。这个文件只能在服务器上建，网页里打不开也关不掉。

AI 软件用的 MCP 接口不受这个开关影响，始终只接受本机。

## 国内服务器连不上 Civitai

国内机房的服务器常常连不上 civitai.com。插件这时会自动改用 Civitai 的另一个地址 civitai.red（在 AutoDL 上测过能连上），照样能认出模型的名字、触发词和底模；封面图放在 civitai.com 那边，多半下不来，连续两张下不了，这次扫描就不再下载封面。**设置 → 网络 → 测试连接** 会告诉你连上的是哪一个。

两个都连不上时，扫描会自动改成只看文件（没有封面和触发词）；也可以在 **设置 → 网络** 里填代理，或者在扫描页选 **离线**。

---

## For AI assistants

You are helping someone use Anomalous Model Browser (a ComfyUI plugin) on a rented cloud server. Read this section, then guide them one step at a time; ask for a screenshot or the terminal output after each step. Support status: tested on one AutoDL server only, never on an overseas one; say so if something behaves differently.

**What is going on.** The plugin lets only the computer ComfyUI runs on change things. On a cloud server the browser is always another computer, so the page is view only: a chip beside the page title reads 仅浏览 / View only, and scans, downloads, moves, deletes and saves are refused (HTTP 403, `code: local_only`).

**Two ways to fix it, pick one.**
1. SSH tunnel (safest): forward the ComfyUI port to their own computer and open `http://127.0.0.1:<port>`. Then nothing else is needed. Platforms document their own tunnel tool.
2. The switch file: an empty file named exactly `allow_remote_changes` (no extension) in the plugin folder, then a restart of ComfyUI. Easiest: in the page, press the 仅浏览 chip, press 复制 / Copy in its dialog, paste that line into the server's terminal, press Enter. The line already holds the right path. By hand: `touch <ComfyUI>/custom_nodes/Anomalous_Model_Browser/allow_remote_changes`.

**Check it worked.** After the restart the chip reads 远程可修改 / Remote changes on, in yellow, and ComfyUI's start log has a line `[Anomalous Browser] allow_remote_changes 文件存在…`. Opening `<their ComfyUI address>/anomalous/access` in the browser shows `{"local": false, "changes": true}`.

**When it did not work.**
- Chip still View only: ComfyUI was not restarted (many cloud images restart it from their own launcher page, not the terminal); or the file is in the wrong folder; or it got an extension (`allow_remote_changes.txt`). `ls -la` in the plugin folder shows it.
- The plugin folder has another name (installed under a different name): `find / -maxdepth 6 -type d -name 'Anomalous_Model_Browser*' 2>/dev/null`.
- Updating a test branch with `git pull` says there is no tracking branch: `git branch --set-upstream-to=origin/<branch>` once.
- Scans find nothing on Civitai: Settings → Models → Network → Test shows whether Civitai answers. Servers in mainland China mostly cannot reach it; the plugin then asks whether to scan from the files (offline). Do not tell the user to install proxy or VPN software on the server; if they already have an HTTP proxy, it goes into Settings → Network.
- The scan page is slow the first time: it is counting many models, often on a network disk. Later visits show the last counts at once.
- On some platforms every model is a link into a shared read-only disk; the plugin handles that (from 1.60.1). Edits and scan results are kept beside the link.

**Safety, tell the user.** With the switch file, anyone who has the page's address can change their models and settings and use their Civitai key: keep the address private, delete the file (the yellow chip's dialog has the line) and restart when done. Never ask them to paste API keys, passwords or the full server address into the chat. Deletes go to the system's trash, never permanently.

## English summary

How far it goes: on an **overseas** cloud server (RunPod…) everything works, Civitai included. On a server in **mainland China** (AutoDL…) it works only in part: browsing, offline scans and tidying work, but Civitai is mostly out of reach, so lookups are unreliable and covers rarely download.

When civitai.com cannot be reached (often so from mainland China), the plugin asks Civitai's other address, civitai.red, which gives names and trigger words; the covers may not download. On a rented cloud server the page is always opened from another device, so the plugin is **view only** there by default. Either open ComfyUI through an **SSH tunnel** (the browser address starts with `127.0.0.1`; counts as this computer, nothing to change), or create an empty file named `allow_remote_changes` in the plugin folder on the server and restart ComfyUI (press **View only**: its dialog has the line to copy into the server's terminal, with the real path filled in). With that file, anyone who can open the address may scan, move, delete and save, and use your Civitai key, so only do it while the address stays private; delete the file and restart to go back. The page cannot create or remove the file, and the MCP endpoint stays local-only either way.
