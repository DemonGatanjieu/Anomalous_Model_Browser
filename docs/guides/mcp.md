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
| ask_user | 在 AI 工作台里问你一个问题：几个选项（AI 推荐的那个标着“推荐”），加一行“都不是？写下你的想法”；AI 在同一步里等你回答 |
| show_panel / update_panel / get_answers | 在 AI 工作台里画一个面板（对比图片、模型卡片、表格、按钮和输入框）；改它或关掉它的问题；读你的回答（见第 5 节） |

## 5. AI 工作台：AI 做了什么，一目了然（1.62 起）

任务工具栏里的“运行状态”按钮点开后显示真实排队、当前节点进度、用时、结果或错误（运行中按钮上直接显示百分比，不占时间线版面）；可见时每 5 秒补查一次。任务没有接入运行时显示“尚未收到运行信息”，不会假称 AI 正在出图，也不会因为一段时间没消息就标成完成。

让 AI 优先使用 `run_workflow`：默认等待 15 秒并返回实际状态和已生成的图片。仍在运行时使用 `run_status(wait_seconds=55)` 继续等待，不必找输出文件夹。若 AI 通过脚本、`/prompt` 或其他工具提交，须立即调用 `track_run(prompt_ids=[提交响应中的ID], task=begin_task返回的任务ID)`，只接入它自己提交的 ID；这个工具不会重复出图。升级后重启 ComfyUI、刷新页面，并在 AI 软件中重新连接 MCP 以发现新工具。AMB 不能主动唤醒已经停止调用工具的 AI。

“允许”只放行这一次操作；AI 等待超时后再调用，同一份允许也只消费一次。要持续放行请使用“以后直接做”。ComfyUI 重启前尚未回答的确认仍可回答，AI 需重新调用原工具。指定任务或会话读取的消息不会被另一个任务提前取走。

如果运行显示跟踪超时或记录不可用，表示 AMB 无法确认结果，并不表示它取消了出图；请查看 ComfyUI 的队列。没有发现排队记录也不会算作出图成功。

运行结果只关联这次提交返回的运行 ID。批次部分提交成功时，已经排队的部分继续跟踪并保留图片，AI 会收到未全部提交的说明，不应重跑整批。升级后需要重启 ComfyUI 并刷新页面；旧页面不能接手出图。页面正在提交另一批时会提示稍后重试，这只限制提交过程，不需要等显卡把整批跑完。

出图后不必回图库寻找功能：鼠标移到结果图片上，右上角的 **ⓘ** 打开完整的图片与参数，**⇄** 和当前画布对比，**☆** 用同一个菜单保存成工作流、搭配或提示词。图片左上角可以 **勾选**：勾两张（不同步骤、不同任务都行），页面底部出现 **查看参数差异**；它读取图片实际保存的工作流，不依赖 AI 口述参数。没有可用工作流的图片会显示原因，视频没有这些参数操作。AI 展台的图片、挑选卡片也一样；滑动对比下面有 **查看参数差异**。

**AI 软件里的 AMB 卡片**（Claude、ChatGPT、VS Code 等支持 MCP Apps 的软件）：AI 开始任务、出图、画面板或留言时，对话里会出现一张 AMB 的卡片：它做了哪几步、最新几张图、它问你的问题。直接在卡片里点选项就是回答，AI 会马上收到并继续。卡片是 AMB 自己的页面，AI 只能给它数据。要你点头的“关卡”只能在 AMB 里允许，卡片只提示你去 AMB；这样 AI 没有办法替你点。Gemini 命令行、Claude Code 终端版这类只显示文字的软件看不到卡片，照常在 AMB 的 AI 工作台里看和回答。

**交给 AI**：模型页的按钮行、图片详情右上角的 **✦**、搭配卡片上都有 **交给 AI**。写一句想让 AI 做什么（已经预先填好），AMB 会建一个带着这个模型、图片或搭配的任务，并给你一句话复制给 AI；AI 调用 `begin_task` 接手时就拿到了它们的编号，不用再自己搜。

**斜杠命令**：支持 MCP prompts 的软件（比如 Claude）里可以直接选 AMB 提供的四个现成请求：在工作台开一个任务、出几张让我挑、补齐缺的模型、讲讲现在的画布。

**在图上标给 AI 看**：工作台里图片右上角的 **✎** 打开标注：框、圈、箭头、画笔，三种颜色，每个标记写一句要怎么改，再写整体的想法，点 **发给 AI**。AI 下一次调用工具（或 `get_answers`）时收到这些说明和标好的图；能看图的 AI 直接看得到标在哪里。标好的图存在 AMB 自己的记录里，不进图库，任务删掉时一起删。

**让 AI 局部重绘**：标注里选 **▧ 涂重绘区**，用笔刷把要重画的地方涂上（笔刷粗细可调；框、圈、画笔圈出的地方也算），勾上“同时做成重绘遮罩”再发给 AI。AMB 会在 ComfyUI 的 input 文件夹里放一张 `anomalous_inpaint_….png`：原图加上你涂的区域做遮罩。AI 收到时会被告诉怎么用它（LoadImage 读进来就带遮罩，用原图的模型和提示词，重绘强度 0.5～0.8 保留原样子，1.0 完全重画），不确定时用选择题问你强度，画完用前后对比给你看。这张文件删任务时不会删，因为你的工作流可能还在用它。

**AI 的专用标签页**（默认）：AI 第一次改画布前，AMB 先把你正开着的工作流复制到一个以任务命名的新标签页，之后 AI 的修改、读画布和运行都只在那一页；你切去别的标签页也没关系，它下次动手前 AMB 会先切回去。你原来的工作流一笔不动。AI 用 `new_workflow` / `open_workflow` 打开的标签页就直接算这个任务的。任务标题栏有 **专用标签页 / 当前画布** 开关和这个标签页的名字（点一下切过去）；**关卡** 窗口里的“AI 改画布时”设定新任务的默认做法。

**这次跑的节点结构**：每次运行那一步下面写着一行“底模 · 几个 LoRA · 尺寸 · 步数 · 几个节点”，点开是方块图：哪个底模、LoRA 和权重、正负提示词开头、尺寸、采样器设置、保存，方块之间的线标着类型，点方块定位到画布上的节点。这张图是 AMB 按 ComfyUI 实际收到的工作流画的，不靠 AI 描述。上面的黄色小块是 **比上次改了什么**（比如“K采样器·步数：20 → 30”“新增「加载LoRA」”）。AI 讲解时可以用 `show_run_map` 一次把同一张图放上展台，不用自己拼。

**把图片直接发给 AI**：图库里右键一张图选 **发给 AI**，或者看图窗口的 **✦**：AI 正在做任务时会问你“发给当前任务”还是“开新任务”。发给当前任务时可以写一句想让它看什么；AI 收到的是图片本身，加上 AMB 从图里读出的模型、LoRA、提示词、尺寸和采样设置，不用你再描述。还没被 AI 读到之前连着发的几张会并成一步。AI 自己搜图库时也可以让结果直接带上前 6 张图（`search_images` 的 `with_pictures`）。

**让 AI 在画布上搭工作流**：AI 可以先用 `find_nodes` 查这台 ComfyUI 有哪些节点、每个节点要接什么，然后用 `new_workflow` 新开一个标签页（空白，或者一次把整套工作流搭好并排好位置；你正开着的工作流不受影响），再用 `add_node`、`connect_nodes`、`set_values`、`remove_nodes` 加节点、连线、改参数、删节点。每一步你都能在画布上看到，按 Ctrl+Z 能撤回；AI 工作台那一步下面写着改了什么（包括哪根线从哪里连到哪里）。类型接不上、选项不存在时，画布不会动，AI 会收到能用的写法。

**给 AI 的素材**：窗口右上角的 **✦ 素材** 默认在工作台右边那一栏打开（在别的页面打开时停靠在屏幕右边）：不挡时间线和画布，上面搜索，种类是一排标签，卡片两列，点卡片在小窗里看详细说明（“返回列表”回去），下面挑好点交给 AI。右上角 **⤢** 展开成大窗口，大窗口标题栏的侧栏按钮再收回去；AMB 记得你上次用的是哪种。大窗口里：上面搜索所有素材，左边选种类，节点可以按来源筛（ComfyUI 自带、你装的每个第三方节点包、付费 API 节点），卡片上看得到节点的输入输出、搭配和工作流的封面、提示词原文；鼠标移到卡片上右边显示完整说明。提示词里也能挑搭配和工作流里的提示词。不知道该选哪个节点时，在来源里点某个自定义节点包（小窗里点“来源：全部 ▾”打开列表，可以搜索），点上面出现的 **整包交给 AI**：AI 会从这个包里挑合适的节点用，“只能用”时这个包的节点都允许。勾选后点 **交给 AI**，选“优先用这些”或“只能用这些节点”（自带节点照常可用，别的第三方和付费节点会被拦下）。☆ 设为常用：没挑素材的任务自动带上常用的。AI 用 `get_toolbox` 看到你挑的东西的详细说明，用 `open_workflow` 在新标签页打开你存的工作流。工作流详情页的 **✦ 交给 AI** 会新开一个带着这个工作流的任务。

**运行进度**：AI 运行工作流后，时间线上那一步下面有进度条（排队时前面还有几个；运行时哪个节点、第几步、节点做完几个）。进度条右边是百分比，旁边是红色的 **■ 停止**：一点就停这一次运行（还在排队的移出队列，正在跑的立刻中断，只动这次运行），AI 也会收到“你停止了运行”，不会自己再跑一遍。任务工具栏的运行状态按钮旁边也有一个小 ■。进度条下面写着当前节点 **约剩多久**、每步几秒、**显存剩多少**，再下面一行是 ComfyUI **控制台**最新的那一行（比如 `Model Initializing ...`、`Requested to load …`），点开能看最近几行；这些 AI 也同样看得到。出图刚排上队，AMB 会读这次的工作流算出每个采样器要在多大的图上采样：如果是放大模型放大后又整张重新采样、尺寸超过这张显卡的舒适范围、或者要解码特别大的图，会出现黄色提醒，告诉你可能很慢或爆显存，以及怎么改（只想放大就用纯模型超分，或者先缩小、减步数、分块解码）；AI 收到同样的提醒，会被要求先问你要不要停（它也能用 `stop_run` 停自己的运行）。AI 用 `run_status` 问同样的进度，或者等到跑完再继续，不会凭时间猜；运行期间 AI 调用别的工具时，回复里的 `your_run` 也带着一句当前进度，跑完后告诉它一次结果，所以它不用自己去翻输出文件夹或者看屏幕。

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

**决策记录**：讨论在哪里都行，在 AI 自己的对话框里聊也可以，但商量出的结论会留在 AMB。AI 用 `log_decision` 把“定了什么、为什么、没选哪些、谁定的、跟哪几步有关”记成时间线上一张带 📌 的卡片；你在 AMB 里自己做的选择（面板上的回答、允许或不允许、交出去的素材、AI 改画布的地方、停止运行）会自动算进去。窗口右上角的 **决策** 按时间列出这个任务的所有决策，每条都能跳回时间线上的那一步；AI 跑了图或改了画布却很久没记录决策时，这里会轻轻提一句。AI 下次接手这个任务时，也会先收到这些决策。

**留言框里的 @ 和 /**：在任务下面的留言框里打 **@**，会弹出一张能搜索的列表：这个任务出过的图、搭配、模型、工作流、提示词、节点包、节点。选中的会写成“@名字”，留言框下面显示成小标签；发出去时 AI 收到的是你指的那个东西本身（模型的准确 ID、搭配的参数、图片和它的生成参数），不用它去猜。在开头打 **/** 是快捷指令：/停止、/撤销、/展台、/结构、/素材、/专用标签页、/当前画布、/新任务 马上生效，不用等 AI；/重跑、/解释、/继续 帮你写好一句话，改一改再发。↑↓ 选，回车或 Tab 确认，Esc 关掉。

**AI 画的面板**（`show_panel`）显示在工作台右边的**展台**上，后面再多步骤也不会被顶走。右边这一栏一次只显示一样东西，用窗口右上角的三个按钮切换：**展台**（有问题等你回答时带个小黄点）、**节点结构**（AI 跑过的节点结构图，大图；上面可以选看哪一次运行，时间线里运行那一步的“在右侧看大图”也会打开它）、**素材**。再点一下正亮着的那个就收起这一栏；切走再切回来，展台的位置和挑了一半的素材都还在。任务标题和那一排按钮在时间线往下翻时一直停在顶上。时间线上只留一行“在展台打开 ▸”。展台默认跟着最新的面板，你翻回旧面板就停在你看的那张；窗口窄的时候，时间线和展台变成两个标签页切换。右边这一栏是一张单独的卡片，鼠标移到它左边缘会出现一根小竖条，拖动就能调宽窄（AMB 记得你调的宽度，双击恢复默认），时间线总会留够地方。窗口左上角的按钮收起 / 展开左边的任务列表；收起以后，鼠标移到这个按钮上，任务列表会临时浮出来，点一个任务或者鼠标移开就自动收回。素材在右边这一栏里时，鼠标移过卡片不会再跳进详细说明，点右边的 ⓘ 才看。小窗里素材是一行一个的列表（图标、名字、来源、勾选），搜索框旁边三个小图标是“全部 / 已选 / 常用”；展开成大窗口就是带预览的卡片。这些地方的滚动条平时是隐藏的，鼠标移到能滚动的那一块上才显出来。AI 可以用插件提供的“积木”拼面板：标题和文字（也可以是提示、警告）、图片（一排、网格，或者两张并排对比）、你的模型（带封面的卡片，点了打开）、表格、列表、参数、进度条。它还能**问你**：几个按钮（单选或多选）、一行输入框。你的回答会交出去，等 AI 用 `get_answers` 来取（它可以等你最多一分钟）；每个问题下面有一个状态标签：琥珀色的 **已发送 · 等 AI 来取**，AI 拿到后变成绿色的 **AI 已收到 · 时间**。你的留言、批注、发给它的图片也是一样。不想答的题点 **这题跳过**，AI 会知道你跳过了，自己拿主意。AMB 没法主动叫醒 AI，所以回答之后要等它下一次来问。

**展台积木**（1.62）：AI 还可以在图上**画圈标注**（圈上是编号，标签列在图下面，点标签放大那一块）、摆**拉帘对比**（两张图叠在一起，拖中间的线）、摆**选片盘**（每张图带 AI 的理由和“就选这张”；“放回画布”会在新标签页里打开这张图里存的工作流，也可以直接拖到画布上）、画**示意图**（框和箭头由插件排版；带 ◎ 的框点一下定位到画布上的节点）。AI 只给位置和文字，圈、线、框都是插件画的，所以接哪家 AI 都一样好看，也不会收 AI 写的 SVG 代码。

面板里的东西都由插件检查过才画出来：只认这几种积木，只是纯文字，图片只能来自 ComfyUI 的 output 文件夹，模型只能是你自己的，AI 写的代码不会运行。AMB 没开着的时候 AI 画了面板，右下角会弹一个小卡片“AI 在问你”，点“去看看”就到。

展台右上角的 **× 关闭展台**只收起这一栏，不删除面板、不结束任务；当前任务继续更新时也不会强行重开。窗口右上角的“展台”，或时间线里的“在展台打开”可以恢复，未提交的输入会保留。“来自第 N 步”指创建这个面板的那一步；后续修改同一个面板不会改变它的来源编号。

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
