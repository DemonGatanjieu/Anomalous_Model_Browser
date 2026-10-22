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

**最省事的办法**：打开 AMB 的 AI 工作台，点任务列表上方的 **连接 AI**，复制里面那句话发给你的 AI（Claude Code、Gemini、Cursor 这类会改自己配置的都行），它会自己把 AMB 加进去。

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
| add_lora | 插入一个 LoRA，默认接在主模型加载器和已有的 LoRA 后面。LoRA 文件里练过文本编码器的（SD1.5、SDXL、Illustrious 的大多是），CLIP 线也接上：从 checkpoint 接，或者从 UNet 工作流里单独的 CLIP 加载器接，正反向提示词一起改接到它后面；没练过的（多数 Flux、Anima 的 LoRA）只接模型线 |
| place_combo | 把一个搭配作为一组新节点摆到画布上，原有节点不动 |
| check_workflow_models / fix_workflow_models | 检查缺失的模型；把能确定找回的（同一个文件）放回去，“可能是”的留给你在模型检查里确认 |
| run_workflow | 像按“运行”一样把工作流加入队列 |
| open_in_anomalous | 在插件里打开某个模型的详情页给你看 |
| scan_models | 扫描新模型、重新查找没匹配上的，或扫描指定的模型（会联网访问 Civitai） |
| download_missing_models | 下载当前工作流缺的模型：只下能确定来源的（C 站按指纹找到、或工作流带着文件链接），放在设置里“模型下载”说的位置，核对指纹后自动换上 |
| download_model | 按链接（C 站模型版本、Hugging Face / GitHub 文件）或 C 站指纹下载一个模型到指定类型的文件夹，不覆盖已有文件 |
| download_status | 看下载进度和结果 |
| list_voices / speak | 列出 Anomalous TTS 的角色；让某个角色读一段台词并保存（最多等两分钟） |
| begin_task / report | 在 AI 工作台里起一个任务的标题；给你留言、交上它用别的方式做出来的图、结束任务（见第 5 节） |
| show_panel / update_panel / get_answers | 在 AI 工作台里画一个面板（对比图片、模型卡片、表格、按钮和输入框）；改它或关掉它的问题；读你的回答（见第 5 节） |

## 5. AI 工作台：AI 做了什么，一目了然（1.62 起）

出图后不必回图库寻找功能：鼠标移到结果图片上，右上角的 **ⓘ** 打开完整的图片与参数，**⇄** 和当前画布对比，**☆** 用同一个菜单保存成工作流、搭配或提示词。图片左上角可以 **勾选**：勾两张（不同步骤、不同任务都行），页面底部出现 **查看参数差异**；它读取图片实际保存的工作流，不依赖 AI 口述参数。没有可用工作流的图片会显示原因，视频没有这些参数操作。AI 展台的图片、挑选卡片也一样；滑动对比下面有 **查看参数差异**。

**AI 软件里的 AMB 卡片**（Claude、ChatGPT、VS Code 等支持 MCP Apps 的软件）：AI 开始任务、出图、画面板或留言时，对话里会出现一张 AMB 的卡片：它做了哪几步、最新几张图、它问你的问题。直接在卡片里点选项就是回答，AI 会马上收到并继续。卡片是 AMB 自己的页面，AI 只能给它数据。要你点头的“关卡”只能在 AMB 里允许，卡片只提示你去 AMB；这样 AI 没有办法替你点。Gemini 命令行、Claude Code 终端版这类只显示文字的软件看不到卡片，照常在 AMB 的 AI 工作台里看和回答。

**交给 AI**：模型页的按钮行、图片详情右上角的 **✦**、搭配卡片上都有 **交给 AI**。写一句想让 AI 做什么（已经预先填好），AMB 会建一个带着这个模型、图片或搭配的任务，并给你一句话复制给 AI；AI 调用 `begin_task` 接手时就拿到了它们的编号，不用再自己搜。

**斜杠命令**：支持 MCP prompts 的软件（比如 Claude）里可以直接选 AMB 提供的四个现成请求：在工作台开一个任务、出几张让我挑、补齐缺的模型、讲讲现在的画布。

**流程图和关卡**：任务标题下面的一排流程按 AI 做事的先后列出它经过的阶段（模型、搭配、提示词、运行、挑图……），点一下跳到那一步。任务列表上方的 **关卡** 里，改画布、用显卡出图配音、下载模型、联网扫描四类事各自可以选 **直接做 / 先问我 / 不许做**（默认只有下载先问）。选了“先问我”，AI 的那一步会停在时间线上列出它要做什么，你点 **允许** 才做；点 **不要** 时可以写原因或想怎么改，AI 会收到。AI 最多等 50 秒，等不及的话会先去问你的回答（`get_answers`），你允许后它再做一次，不会问第二遍。

**AI 干活时你自己改的东西**：AI 在做一个任务时（10 分钟内调用过），你在 AMB 里做的改动，比如画布上的改动、改模型信息、存搭配或提示词，会以“你在 AMB 里改了”出现在这个任务的时间线上，画布改动带修改前后。AI 下一次调用任何工具时会收到它（并被告知保留你的改动，不要改回去），时间线上写着它是否已经知道。操作记录页里，AI 做的和 AI 干活时你做的记录旁边有 **AI 任务 →**。

画布操作下面直接显示操作记录中的 **修改前 / 修改后**，可以定位对应节点，并在允许时撤销。长提示词可能只保留变化附近的片段；早期操作记录被清理后会提示不可用，不会用现在的画布替代历史值。操作记录页使用相同的改动展示。

左边栏的 **AI 工作台** 记下 AI 通过这个接口做的每一步，按**任务**分好：

- AI 开始干活时会调用 `begin_task` 起个标题；没起的话，同一个 AI 软件连续做的事自动算一个任务，停了 20 分钟以上就算新的。
- 每个任务是一条时间线：查了什么（自动折叠成一行，点开看每一次）、画布上改了什么、运行、下载、扫描、配音，还有 AI 自己的留言（`report` 工具，也可以把它用别的方式做出来的图交上来）。
- **做出来的东西都留着，点一下就到**：运行出的图会一直等到跑完再收进任务里，最上面的“这次做出来的”可以直接点开看大图；用到的模型点一下打开模型页，搭配打开搭配，配音可以直接听；画布上的改动可以“在画布上找到”，也可以**撤销**（一步，或者整个任务的画布改动一起，从最后一步往前，遇到你自己后来又改过的地方就停下）。
- AI 还在干活时，时间线会自己往下长；你在别的页面时，左边栏的 AI 工作台会亮一个小点。首页也有“AI 最近做了什么”。
- **给 AI 留言**：任务时间线下面有个留言框，比如“背景再亮一点”“先别跑了”。留言会成为任务里的一步，AI 下一次调用任何工具（或 `get_answers`）时都会自动收到，下面写着它有没有看到。AMB 没法叫醒已经停下的 AI：它如果已经结束回合，请回到 AI 软件里让它继续。
- 左边的任务按日期分组（今天、昨天、某天），前面的小图标表示状态：● 进行中、? 等你回答、! 有一步出错、✓ 完成。
- **新任务**：点任务列表上方的 **＋ 新任务**，写上要 AI 做什么（也可以空着）。这个任务会显示“等 AI 接手”，下一个来调用的 AI 就会接手它，之后的步骤都记在这里，不会接在它上一个任务后面。AI 即使先查资料再调用 `begin_task`，也会继续这个任务，保留你定的标题；只有另一件事才用 `new_task=true` 明确另开，或先用 `report(done=true)` 结束当前任务。
- 任务可以改名、从列表移除（只删记录，图和画布不受影响）。记录存在 ComfyUI 的 user 文件夹里，保留最近 300 个。
- 只看得到经过这个接口的事。AI 绕开它做的，可以让它用 `report` 报告。

**AI 画的面板**（`show_panel`）显示在工作台右边的**展台**上，后面再多步骤也不会被顶走；时间线上只留一行“在展台打开 ▸”。展台默认跟着最新的面板，你翻回旧面板就停在你看的那张；窗口窄的时候，时间线和展台变成两个标签页切换。左边的任务列表可以点 ‹ 收起，腾出地方。AI 可以用插件提供的“积木”拼面板：标题和文字（也可以是提示、警告）、图片（一排、网格，或者两张并排对比）、你的模型（带封面的卡片，点了打开）、表格、列表、参数、进度条。它还能**问你**：几个按钮（单选或多选）、一行输入框。你的回答会交出去，等 AI 用 `get_answers` 来取（它可以等你最多一分钟）；每个问题下面都写着 AI 有没有看到。AMB 没法主动叫醒 AI，所以回答之后要等它下一次来问。

**展台积木**（1.62）：AI 还可以在图上**画圈标注**（圈上是编号，标签列在图下面，点标签放大那一块）、摆**拉帘对比**（两张图叠在一起，拖中间的线）、摆**选片盘**（每张图带 AI 的理由和“就选这张”；“放回画布”会在新标签页里打开这张图里存的工作流，也可以直接拖到画布上）、画**示意图**（框和箭头由插件排版；带 ◎ 的框点一下定位到画布上的节点）。AI 只给位置和文字，圈、线、框都是插件画的，所以接哪家 AI 都一样好看，也不会收 AI 写的 SVG 代码。

面板里的东西都由插件检查过才画出来：只认这几种积木，只是纯文字，图片只能来自 ComfyUI 的 output 文件夹，模型只能是你自己的，AI 写的代码不会运行。AMB 没开着的时候 AI 画了面板，右下角会弹一个小卡片“AI 在问你”，点“去看看”就到。

展台右上角的 **× 关闭展台**只收起这一栏，不删除面板、不结束任务；当前任务继续更新时也不会强行重开。任务标题旁的“打开展台”，或时间线里的“在展台打开”可以恢复，未提交的输入会保留。“来自第 N 步”指创建这个面板的那一步；后续修改同一个面板不会改变它的来源编号。

**按过程往下看**：建议 AI 把“搭配方案 → 节点说明 → 成图结果”作为不同阶段依次展示。更新同一个面板时，新内容也只接在底部，已有内容不会因为 AI 重排或省略而消失。`show_panel` / `update_panel` 会返回积木 ID；明确带上已有 ID 才是在原位置修正那块内容，进度条也可以按唯一的标签更新。单面板最多 30 块，满了就用 `show_panel` 展示下一阶段。旧记录只保留了最终排版，没有每次更新前的顺序，因此不会自动重排旧记录。

## 6. 注意

- **隐私**：如果 AI 软件用的是云端模型，查询结果（模型名、提示词、图片的生成参数）会发给那家 AI 服务商。附上封面或缩略图时，图片也会一起发过去。介意的话可以用本地模型，或者不让 AI 附图。
- 附图时会用到插件自己的缩略图缓存，和浏览图库时一样，不动你的原图。
- 改模型的名字和备注、删除东西、物理改文件名，这些 AI 做不了，得在插件里自己点。

---

## English

Output pictures in a task and on AI panels carry the existing image inspector, image/canvas parameter comparison and Keep menu as tools shown on hover; tick any two (any step or task) and the bar at the foot of the page compares their actual embedded workflows. Changes you make in Anomalous while an AI works on a task (it called within 10 minutes) join its timeline and reach the AI once with its next call, marked as yours to keep; activity entries link to their task. Canvas steps show recorded before/after values with node navigation and undo where available, shared with the activity page. Missing historical receipts and images without reusable workflows are reported explicitly.

Apps that support MCP Apps show Anomalous's own card (`ui://anomalous/task-card.html`) under begin_task, show_panel, report and run_workflow results: the task's steps, latest thumbnails and the AI's open questions, answered from the card (gates are never answerable there, only in Anomalous). Four prompts (workbench_task, pick_best, fix_missing_models, explain_canvas) appear as slash commands.

The stage reads chronologically: use `show_panel` for successive phases. `update_panel` appends
new blocks below existing content, keeps omitted blocks and deduplicates unchanged resubmissions.
Tools return stable block ids for deliberate in-place corrections (including progress/questions);
an id keeps its type and position. A uniquely labelled progress bar also updates without an id.
The total remains bounded to 30 blocks; use a new panel for the next phase. Old records retain
their saved layout because earlier revisions were not recorded.

While ComfyUI runs, Anomalous serves an MCP endpoint at `http://127.0.0.1:8188/anomalous/mcp` (use your ComfyUI port). Add it as a Streamable HTTP server in your AI app (Claude Code: `claude mcp add --transport http anomalous <url>`; Cursor and VS Code: a `url` / `"type": "http"` entry; Claude Desktop: through `npx mcp-remote <url> --transport http-only`). Both the 2026-07-28 protocol and the earlier `initialize`-based versions are served.

Since 1.62 the **AI workbench** page keeps every step an AI app takes through this endpoint, grouped into tasks (named with `begin_task`, else one app's calls without a 20-minute pause): what it is currently running (`running` in real time) and what it looked up, changed, ran, downloaded, scanned or spoke, its notes (`report`, which also hands in pictures made another way), and what each step made, with links to the picture, the model, the combo, the canvas change (find or undo) and the audio. It updates live; the rail gets a dot while you are elsewhere. With `show_panel` the AI draws a panel there from fixed blocks (text, pictures to compare, your models as cards, tables, settings, progress, buttons and a text line); the user's answers and task messages are returned on `get_answers` (which can wait up to 55 s) and are also automatically attached once to the AI's next successful tool call. Blocks are checked on the server and drawn as text; nothing the AI sends runs.

Reading tools: library overview, model search and details (optionally with the cover), scan status, output-image search and generation settings (optionally with a thumbnail), combos, workflow recipes, saved prompts, generated audio and the activity log. Acting tools: read the open workflow, write prompts, swap a node's model, add a LoRA, place a combo, check and fix missing models, run the workflow, open a model in Anomalous, start scans, list Anomalous TTS voices and have one speak. Canvas actions need ComfyUI open in a browser on this computer; each is one Ctrl+Z step and is logged as the AI's. Nothing deletes or renames files. Only this computer may connect; requests through a proxy, from other hosts or from web pages are refused. When your AI app uses a cloud model, what the tools return (and any attached picture) is sent to that provider.
