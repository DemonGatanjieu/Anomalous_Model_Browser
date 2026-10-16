# 在云服务器上使用（AutoDL 等）

ComfyUI 装在租来的云服务器上（AutoDL、RunPod 之类），你在自己电脑的浏览器里打开它时，对插件来说页面是从“别的设备”打开的。为了不让别人远程改动你的文件，插件默认只让这种页面浏览：标题旁会显示 **仅浏览**，扫描、下载、移动、删除、保存这类改动会被拒绝。

想在云服务器上照常使用，有两个办法，选一个就行。

## 办法一：用 SSH 隧道打开（推荐，什么都不用改）

SSH 隧道把服务器上 ComfyUI 的端口接到你自己电脑上，浏览器打开的是 `http://127.0.0.1:端口`。请求在服务器上也是从本机发出的，插件就当成本机，所有功能都能用，也不会把页面开放给别人。

AutoDL 控制台里每台实例都有 SSH 登录指令和密码，平台也提供了现成的隧道小工具；按平台说明把 ComfyUI 的端口（常见是 6006 或 8188）映射到本地，再用浏览器打开映射出来的 127.0.0.1 地址即可。

## 办法二：在服务器上放一个开关文件

如果你只能用平台给的网址打开 ComfyUI：

1. 在服务器上打开插件文件夹 `ComfyUI/custom_nodes/Anomalous_Model_Browser`（AutoDL 可以用 JupyterLab 的文件浏览器，或在终端里操作）。
2. 新建一个空文件，名字是 `allow_remote_changes`（没有扩展名）。终端里可以这样做：

   ```bash
   touch ComfyUI/custom_nodes/Anomalous_Model_Browser/allow_remote_changes
   ```

3. 重启 ComfyUI。启动日志里会出现一行提示，标题旁的标签变成黄色的 **远程可修改**。

**风险：** 打开之后，任何能打开这个网址的人都能扫描、移动、删除（进回收站）你的模型，改插件设置，也能用你的 Civitai Key。只在网址不外传时这样做；不需要了就删掉这个文件，再重启 ComfyUI。这个文件只能在服务器上建，网页里打不开也关不掉。

AI 软件用的 MCP 接口不受这个开关影响，始终只接受本机。

## 国内服务器连不上 Civitai

国内机房的服务器访问 Civitai 常常不稳定。扫描连不上时会自动改成只看文件（没有封面和触发词）；也可以在 **设置 → 网络** 里填代理，或者在扫描页选 **离线**。

---

## English summary

On a rented cloud server the page is always opened from another device, so the plugin is **view only** there by default. Either open ComfyUI through an **SSH tunnel** (the browser address starts with `127.0.0.1`; counts as this computer, nothing to change), or create an empty file named `allow_remote_changes` in the plugin folder on the server and restart ComfyUI. With that file, anyone who can open the address may scan, move, delete and save, and use your Civitai key, so only do it while the address stays private; delete the file and restart to go back. The page cannot create or remove the file, and the MCP endpoint stays local-only either way.
