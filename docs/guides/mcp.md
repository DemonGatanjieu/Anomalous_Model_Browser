# 让 AI 读你的模型库（MCP）

支持 MCP 的 AI 软件（Claude、Cursor、Cherry Studio、VS Code 等）连上以后，就能直接查你的 ComfyUI 资料：有哪些模型和触发词、某张图当时用的什么参数、存过哪些搭配和提示词，然后据此回答你的问题或者帮你写提示词。

**它只读，不改任何东西。** 想改什么，AI 会告诉你去插件的哪个页面改。

English summary at the end.

---

## 1. 地址

ComfyUI 开着的时候，插件自动提供：

```
http://127.0.0.1:8188/anomalous/mcp
```

`8188` 换成你 ComfyUI 实际的端口。不需要装别的东西，也不占内存和显存：没人连接的时候它什么也不做。

**只有运行 ComfyUI 的这台电脑能连。** 别的电脑、经过反向代理的请求、网页里的脚本都会被拒绝。

## 2. 在 AI 软件里添加

**Cherry Studio**：设置 → MCP → 添加 → 快速创建，类型选 **可流式传输的 HTTP（streamableHttp）**，URL 填上面的地址。需要较新的版本。

**Claude Code**：

```bash
claude mcp add --transport http anomalous http://127.0.0.1:8188/anomalous/mcp
```

**Cursor**：在 `~/.cursor/mcp.json` 里加：

```json
{ "mcpServers": { "anomalous": { "url": "http://127.0.0.1:8188/anomalous/mcp" } } }
```

**VS Code（Copilot）**：在项目的 `.vscode/mcp.json` 里加：

```json
{ "servers": { "anomalous": { "type": "http", "url": "http://127.0.0.1:8188/anomalous/mcp" } } }
```

**Claude 桌面版**：它的配置文件只能启动本地程序，要借 `mcp-remote` 转一下（需要装 Node.js）。在 `claude_desktop_config.json` 里加：

```json
{
  "mcpServers": {
    "anomalous": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:8188/anomalous/mcp", "--transport", "http-only"]
    }
  }
}
```

## 3. 可以这样问

- “我有哪些 Flux 的 LoRA？各自的触发词是什么？”
- “找找用过『某某』这个 LoRA 的出图，看看当时的种子和采样器。”
- “哪些模型还没在 C 站匹配上？为什么？”
- “用我库里合适的模型和 LoRA，帮我写一段赛博朋克夜景的提示词。”
- “我上周存的那个搭配用的是哪个底模？”

## 4. 能查什么

| 工具 | 查什么 |
|---|---|
| library_overview | 各类模型的数量、底模分布、扫描情况，存了多少搭配、工作流和提示词 |
| search_models / get_model | 按名字、触发词、底模、来源找模型；看某个模型的 C 站信息、描述、你写的备注，可以附上封面 |
| scan_report | 哪些模型匹配上了 C 站，哪些没有、原因是什么，哪些还没扫，上次扫描做了什么 |
| search_images / get_image_info | 按提示词、模型、参数找出图；看某张图的全部生成参数，可以附上缩略图 |
| list_combos | 你的搭配（主模型 + LoRA + 提示词） |
| list_workflows | 你的工作流配方，带标签、备注和主要设置 |
| list_saved_prompts | 提示词工坊里存的提示词 |
| search_audio | 用 Anomalous TTS 生成过的语音，带台词和角色 |
| recent_activity | 插件最近改过什么（操作记录） |

## 5. 注意

- **隐私**：如果 AI 软件用的是云端模型，查询结果（模型名、提示词、图片的生成参数）会发给那家 AI 服务商。附上封面或缩略图时，图片也会一起发过去。介意的话可以用本地模型，或者不让 AI 附图。
- 附图时会用到插件自己的缩略图缓存，和浏览图库时一样，不动你的原图。
- 改模型名、扫描、往工作流里加 LoRA 这类操作，目前还得在插件里自己点。

---

## English

While ComfyUI runs, Anomalous serves an MCP endpoint at `http://127.0.0.1:8188/anomalous/mcp` (use your ComfyUI port). Add it as a Streamable HTTP server in your AI app (Claude Code: `claude mcp add --transport http anomalous <url>`; Cursor and VS Code: a `url` / `"type": "http"` entry; Claude Desktop: through `npx mcp-remote <url> --transport http-only`). Both the 2026-07-28 protocol and the earlier `initialize`-based versions are served.

The tools only read: library overview, model search and details (optionally with the cover), scan status, output-image search and generation settings (optionally with a thumbnail), combos, workflow recipes, saved prompts, generated audio and the activity log. Only this computer may connect; requests through a proxy, from other hosts or from web pages are refused. When your AI app uses a cloud model, what the tools return (and any attached picture) is sent to that provider.
