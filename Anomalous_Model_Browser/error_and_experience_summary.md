# Anomalous Model Browser - 开发经验与踩坑总结日志

这份文档记录了在开发和重构 `Anomalous_Model_Browser` 插件过程中遇到的核心 Bug、崩溃原因以及对应的终极解决方案。供后续开发维护时参考，避免重蹈覆辙。

## 1. 前端 UI 注入陷阱：引号转义地狱 (DOM vs innerHTML)
*   **症状**：按钮凭空消失、点击事件无法触发、页面结构错乱。
*   **死因**：在 `main.js` 中重构右侧详细面板时，使用了极长且复杂的 ES6 模板字符串拼接 HTML，并通过 `innerHTML` 暴力注入。在这个过程中，大量的单引号、双引号、反引号以及 JS 变量相互嵌套，只要有一个未正确转义，整个浏览器的 HTML 解析器就会崩溃，导致后续 DOM 元素被直接截断。
*   **解决方案**：**彻底抛弃复杂字符串注入**。必须老老实实使用原生的 `document.createElement()`、`el.appendChild()` 逐层构建 DOM 树，这样不仅彻底杜绝了转义问题，还能干净利落地绑定 `el.onclick` 等事件监听器，稳定性直接拉满。

## 2. Python 字符串拼接陷阱：正则表达式换行符 (SyntaxError)
*   **症状**：扫描脚本 `scraper.py` 在启动的瞬间直接闪退报错 `SyntaxError: unterminated string literal`。
*   **死因**：在用 Python 脚本去 patch (热更新) 另一段 Python 代码时，使用了普通的 `'''` 三引号字符串去包裹一段含有 `\r\n` 的正则表达式：`r'[\r\n\t]+'`。因为没有使用 Raw String (`r'''`)，Python 在执行替换时直接把 `\r\n` 转译成了**真实的物理换行符**，导致最终写进目标文件里的正则字符串被硬生生劈成了两半，引发语法错误。
*   **解决方案**：在涉及代码注入或正则拼接时，**永远小心对待反斜杠**。优先使用 `replace_file_content`，或者在 Python 热更代码中必须使用 Raw 多行字符串 `r'''...'''`。

## 3. Windows 控制台的致命伤：Emoji 编码崩溃 (UnicodeEncodeError)
*   **症状**：当扫描到带有特殊符号（如“Plant Milk 🌿”）的模型时，整个扫描脚本瞬间崩溃，后续所有模型全部罢工。
*   **死因**：Windows 系统的终端默认使用 `GBK` 编码。当 `scraper.py` 试图用 `print()` 打印含有 `🌿` (`\U0001f33f`) 这种多字节 Unicode 字符的文件名时，GBK 无法对其进行编码，直接抛出 `UnicodeEncodeError` 异常终止程序。
*   **解决方案**：在任何需要输出日志的 Python 脚本开头，**强制接管系统标准输出的编码**：
    ```python
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except:
        pass
    ```

## 4. 虚假的异步完成：多线程与进度锁 (Architecture Bug)
*   **症状**：点击“扫描”后，网页立刻弹窗提示“扫描完成”，但此时大模型根本还没有下载任何图片。用户一旦此时刷新，只能看到旧的错乱文件。
*   **死因**：后端 `api.py` 调用扫描脚本时使用了 `subprocess.Popen`，它是非阻塞的。`api.py` 把脚本丢到后台运行后，自己立刻就返回了 HTTP 200 OK。前端收到 OK 就以为扫描结束了，实际上后台还在吭哧吭哧计算几十 GB 文件的 SHA256。
*   **解决方案**：引入**文件级进度锁**与**守护线程**。
    在启动扫描前，生成一个 `.scan_in_progress` 的占位文件，然后开启一个 `threading.Thread` 去运行 `subprocess.run` (阻塞等待)。等到线程里的扫描任务真实结束后，再利用 `finally` 代码块删掉 `.scan_in_progress` 锁文件。前端必须轮询检测这个锁文件是否存在，消失了才算真正的 Complete。

## 5. 盲人摸象的媒体下载：图片损坏之谜 (Content-Type)
*   **症状**：部分最新的模型（如 MiaoMiao RealSkin）下载下来的 `.png` 预览图在系统中显示“文件已损坏”或无法打开。
*   **死因**：随着 Civitai 的升级，部分模型的首张预览图变成了 `.mp4` 或 `.webm` 格式的视频。而旧版下载函数 `download_image` 是“一刀切”的瞎子，不管三七二十一直接把下载流重命名为 `.png`。把视频文件强行加个 `.png` 后缀，图片浏览器自然无法解析。
*   **解决方案**：重写下载器为 `download_media`，必须依靠解析 HTTP 报文头的 `Content-Type` 来决定最终命运：
    - `video/mp4` -> `.mp4`
    - `video/webm` -> `.webm`
    - `image/jpeg` -> `.jpg`
    - 其他 -> `.png`
    并在重命名循环中把 `.mp4` 和 `.webm` 加入“连带重命名套餐”，确保媒体文件与底模同生共死。

---
*Created by Antigravity Assistant on 2026-06-05*
