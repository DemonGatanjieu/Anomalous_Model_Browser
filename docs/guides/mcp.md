# 让 AI 读你的模型库（MCP）

支持 MCP 的 AI 软件（Claude、Cursor、Cherry Studio、VS Code 等）连上以后，就能直接查你的 ComfyUI 资料：有哪些模型和触发词、某张图当时用的什么参数、存过哪些搭配和提示词，然后据此回答你的问题或者帮你写提示词。

它还能动手：改当前工作流的提示词、换模型、加 LoRA、摆上你的搭配、找回缺失的模型、运行工作流、扫描模型，以及让 Anomalous TTS 的角色读台词。

- **每一步都能撤销**：画布上的改动都是一步，按 Ctrl+Z 就回去；
- **都有记录**：改动会写进“操作记录”，标着“AI”，页面右上角也会提示一句；
- **不删文件**：不会删除或改名任何文件。

AI 软件在调用会改东西的工具前，一般会先问你同不同意。

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
- “我上周存的那个搭配用的是哪个底模？”
- “给当前工作流加上那个赛博朋克 LoRA，强度 0.7，再把触发词写进正向提示词。”
- “把我的搭配『夜景』摆到画布上。”
- “这个工作流缺哪些模型？能找回的都找回来。”
- “用阿罗娜读一下：老师，欢迎回来！”

改画布需要 ComfyUI 在这台电脑的浏览器里开着（就是你平时用的那个页面）。开了好几个标签页的话，由当前正在看的那个来执行。

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

能动手的：

| 工具 | 做什么 |
|---|---|
| describe_canvas | 读当前工作流：每个节点的编号、类型、设置，哪个是正向/反向提示词框 |
| set_prompt | 改写或追加正向/反向提示词 |
| set_model | 换某个加载器节点里的模型 |
| add_lora | 在模型链里插入一个 LoRA（默认接在主模型加载器和已有 LoRA 后面），UNet / Flux 类模型会用仅模型的 LoRA 节点 |
| place_combo | 把一个搭配作为一组新节点摆到画布上，原有节点不动 |
| check_workflow_models / fix_workflow_models | 检查缺失的模型；把能确定找回的（同一个文件）放回去，“可能是”的留给你在模型检查里确认 |
| run_workflow | 像按“运行”一样把工作流加入队列 |
| open_in_anomalous | 在插件里打开某个模型的详情页给你看 |
| scan_models | 扫描新模型、重新查找没匹配上的，或扫描指定的模型（会联网访问 Civitai） |
| list_voices / speak | 列出 Anomalous TTS 的角色；让某个角色读一段台词并保存（最多等两分钟） |

## 5. 注意

- **隐私**：如果 AI 软件用的是云端模型，查询结果（模型名、提示词、图片的生成参数）会发给那家 AI 服务商。附上封面或缩略图时，图片也会一起发过去。介意的话可以用本地模型，或者不让 AI 附图。
- 附图时会用到插件自己的缩略图缓存，和浏览图库时一样，不动你的原图。
- 改模型的名字和备注、删除东西、物理改文件名，这些 AI 做不了，得在插件里自己点。

---

## English

While ComfyUI runs, Anomalous serves an MCP endpoint at `http://127.0.0.1:8188/anomalous/mcp` (use your ComfyUI port). Add it as a Streamable HTTP server in your AI app (Claude Code: `claude mcp add --transport http anomalous <url>`; Cursor and VS Code: a `url` / `"type": "http"` entry; Claude Desktop: through `npx mcp-remote <url> --transport http-only`). Both the 2026-07-28 protocol and the earlier `initialize`-based versions are served.

Reading tools: library overview, model search and details (optionally with the cover), scan status, output-image search and generation settings (optionally with a thumbnail), combos, workflow recipes, saved prompts, generated audio and the activity log. Acting tools: read the open workflow, write prompts, swap a node's model, add a LoRA, place a combo, check and fix missing models, run the workflow, open a model in Anomalous, start scans, list Anomalous TTS voices and have one speak. Canvas actions need ComfyUI open in a browser on this computer; each is one Ctrl+Z step and is logged as the AI's. Nothing deletes or renames files. Only this computer may connect; requests through a proxy, from other hosts or from web pages are refused. When your AI app uses a cloud model, what the tools return (and any attached picture) is sent to that provider.
