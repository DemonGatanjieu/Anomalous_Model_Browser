# 让 AI 读你的模型库（MCP）

支持 MCP 的 AI 软件（Claude、Cursor、Cherry Studio、VS Code 等）连上以后，就能直接查你的 ComfyUI 资料：有哪些模型和触发词、某张图当时用的什么参数、存过哪些搭配和提示词，然后据此回答你的问题或者帮你写提示词。

它还能动手：改当前工作流的提示词、换模型、加 LoRA、摆上你的搭配、找回缺失的模型、运行工作流、扫描模型，以及让 Anomalous TTS 的角色读台词。

- **每一步都能撤销**：画布上的改动都是一步，按 Ctrl+Z 就回去；
- **都有记录**：改动会写进“操作记录”，标着“AI”，页面右上角也会提示一句；
- **不删文件**：不会删除或改名任何文件。

AI 软件在调用会改东西的工具前，一般会先问你同不同意。

任务使用专用画布时，读取、运行和下载缺失模型都会跟随它的标签页。标签页关闭或切换失败后，
工具会明确报错；请重新打开原工作流，或让 AI 明确调用 `open_workflow` / `new_workflow` 为任务指定新画布，
再继续操作。不会自动用当前另一张画布替代。

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
| search_models / get_model | 按名字、触发词、底模、来源找模型；看某个模型的 C 站信息、版本、描述、你写的备注，以及作者示例图用的采样器、步数、CFG、尺寸（LoRA 还有作者用的权重），可以附上封面。每个模型都写明哪些节点能加载它；放错文件夹的（比如名字叫 ControlNet、其实是模型补丁的 Anima LLLite）会说明该放哪、放在这里加载不了 |
| zoom_image | 把一张图的某一块放大给 AI 看（手、脸、接缝、标注的区域），也可以把两张图的同一块并排比较（改之前和改之后）。输出、输入、预览图都能看，只看不改。AI 不必再自己写代码裁图、比图 |
| scan_report | 哪些模型匹配上了 C 站，哪些没有、原因是什么，哪些还没扫，上次扫描做了什么 |
| search_images / get_image_info | 按提示词、模型、参数找出图；看某张图的全部生成参数，可以附上缩略图。`folder=input` 时看 ComfyUI 输入文件夹里的图（比如你标注时 AMB 存的重绘遮罩图）：尺寸、要重画的区域在哪、占多大，也能附上图，不用 AI 自己跑命令去看 |
| list_combos | 你的搭配（主模型 + LoRA + 提示词） |
| list_workflows | 你存下的工作流，带标签、备注和主要设置 |
| list_saved_prompts | 提示词工坊里存的提示词 |
| search_audio | 用 Anomalous TTS 生成过的语音，带台词和角色 |
| recent_activity | 插件最近改过什么（操作记录） |

能动手的：

| 工具 | 做什么 |
|---|---|
| describe_canvas | 读当前工作流：每个节点的编号、类型、设置，哪个是正向/反向提示词框 |
| find_nodes | 搜索最多五个节点摘要；需要具体参数和选项时，用 `types=[节点类型]` 读取 |
| add_node / connect_nodes | 添加节点并按唯一类型自动连线，或把节点插进已有路径；见下方例子 |
| add_nodes | 一次加一组节点：按 ComfyUI 的 API 格式写，组里的节点互相连，也能连画布上已有的节点（写 `"#12"`，输出写编号或名字），排成一块放在空位上，整组算一步撤销 |
| set_prompt | 改写或追加正向/反向提示词。AI 自己写提示词前会先取 skill“写提示词·动作适合模型”（见下面的 skill）；你给的文本照原样写进去。`run_workflow` 的提示词也一样 |
| set_model | 换某个加载器节点里的模型 |
| add_lora | 插入一个 LoRA，默认接在主模型加载器和已有的 LoRA 后面。LoRA 文件里练过文本编码器的（SD1.5、SDXL、Illustrious 的大多是），CLIP 线也接上：从 checkpoint 接，或者从 UNet 工作流里单独的 CLIP 加载器接，正反向提示词一起改接到它后面；没练过的（多数 Flux、Anima 的 LoRA）只接模型线。LoRA 和主模型的底模对不上时（SD 1.5 的 LoRA 用在 SDXL 上），回复里会提醒 AI 并告诉它按底模去找；换模型（set_model）也一样 |
| place_combo | 把一个搭配作为一组新节点摆到画布上，原有节点不动 |
| check_workflow_models / fix_workflow_models | 检查缺失的模型；把能确定找回的（同一个文件）放回去，“可能是”的留给你在模型检查里确认 |
| run_workflow | 像按“运行”一样把工作流加入队列。ComfyUI 不收（缺线、模型不在、数值超范围、没有输出节点）时，AI 收到的是“哪个节点、缺什么、该用哪个工具修”，不是原样的报错 |
| open_in_anomalous | 在插件里打开某个模型的详情页给你看 |
| scan_models | 扫描新模型、重新查找没匹配上的，或扫描指定的模型（会联网访问 Civitai） |
| download_missing_models | 下载当前工作流缺的模型：只下能确定来源的（C 站按指纹找到、或工作流带着文件链接），放在设置里“模型下载”说的位置，核对指纹后自动换上 |
| download_model | 按链接（C 站模型版本、Hugging Face / GitHub 文件）或 C 站指纹下载一个模型到指定类型的文件夹，不覆盖已有文件 |
| download_status | 看下载进度和结果 |
| move_model | 把放错文件夹的模型挪到它该在的文件夹（封面、备注跟着走），和模型页“整理”里的“挪过去”一样；不会盖掉同名文件。默认先问你 |
| list_voices / speak | 列出 Anomalous TTS 的角色；让某个角色读一段台词并保存（最多等两分钟） |
| begin_task / report | 在 AI 工作台里起一个任务的标题；给你留言、交上它用别的方式做出来的图、结束任务（见第 5 节） |
| run_workflow 的填空 | 日常出图一步完成：带上 `workflow`（存好的工作流名），第一次在任务的副本标签页里打开它，之后接着用这个标签页；`prompt` / `negative` 填正、反向提示词，`seed` 填所有采样器的种子，`width` / `height` 填空白潜空间的尺寸，`image` 填“加载图片”读的图（输出或输入文件夹里的，比如标注后的重绘图；有几个“加载图片”时用 `image_node` 指定）；其他任何参数用 `values` 按名字改，比如 `{"steps": 30}`，第三方节点的参数也一样：只有一个节点有这个参数就直接改，几个节点都有（比如高清修复的两个采样器都有 `denoise`）就要写节点号 `{"12": {"denoise": 0.5}}`，否则什么都不改并列出是哪几个。几个正向提示词框接进同一个采样器（分区提示词）时，`prompt` 也会停下来，让 AI 用 `values` 分别写。其余照存好的样子不动。不带 `workflow` 时填到当前画布上。要一次跑好几条提示词，用 `prompts`（最多 8 条，代替 `prompt`）：AMB 按顺序一条条填进去排队，别的填空（比如同一个种子）每条都一样，全部算同一次跑图，图都在时间线的同一步里；跑完画布上留的是最后一条。哪一条排不上就停在那里，前面排上的照常跑完，AI 会知道停在第几条。填空和出图一起算一步，改画布那部分也能 Ctrl+Z；画布关卡比显卡关卡严时，按画布关卡问你 |
| 工具目录 | 不是一个工具：AI 开始任务时（还没有任务时调现状一览也一样），回复里附带一张按“想做的事”排好的工具目录（出图、画布、模型、提示词、图片……每个工具一行标题），AI 看一眼就直接去用对的工具，不用到处试。目录从 AMB 的工具登记表自动生成，只列当前给 AI 的工具，加了新工具会自己出现 |
| get_situation | 一次拿到任务、流程链、少量节点摘要、缺失输入和可匹配输出、错误及最近运行。每个回复的 `next` 提示下一步。新开对话或拿不准时先调它；简报预算约 3600 字，减少 Antigravity 将大回复转存为文件的情况 |
| log_outside | AI 用了 AMB 以外的工具（命令、脚本、读写文件）后，说清做了什么、为什么、动了哪些文件；显示在时间线上（见第 5 节） |
| ask_user | 在 AI 工作台里问你一个问题：几个选项（AI 推荐的那个标着“推荐”），加一行“都不是？写下你的想法”；AI 在同一步里等你回答，至少等 30 秒（就算它自己说不等），你在 AMB 里点了，它直接接着做 |
| show_panel / update_panel / get_answers | 在 AI 工作台里画一个面板（对比图片、模型卡片、表格、按钮和输入框）；改它或关掉它的问题；读你的回答（见第 5 节） |

## 5. AI 工作台：AI 做了什么，一目了然（1.62 起）

任务工具栏里的“运行状态”按钮点开后显示真实排队、当前节点进度、用时、结果或错误（运行中按钮上直接显示百分比，不占时间线版面）；可见时每 5 秒补查一次。任务没有接入运行时显示“尚未收到运行信息”，不会假称 AI 正在出图，也不会因为一段时间没消息就标成完成。

让 AI 优先使用 `run_workflow`：默认等待 55 秒并返回实际状态和已生成的图片。仍在运行时使用 `run_status(wait_seconds=55)` 继续等待，不必找输出文件夹。若 AI 通过脚本、`/prompt` 或其他工具提交，须立即调用 `track_run(prompt_ids=[提交响应中的ID], task=begin_task返回的任务ID)`，只接入它自己提交的 ID；这个工具不会重复出图。升级后重启 ComfyUI、刷新页面，并在 AI 软件中重新连接 MCP 以发现新工具。AMB 不能主动唤醒已经停止调用工具的 AI。

“允许”只放行这一次操作；AI 等待超时后再调用，同一份允许也只消费一次。要持续放行请使用“以后直接做”。ComfyUI 重启前尚未回答的确认仍可回答，AI 需重新调用原工具。指定任务或会话读取的消息不会被另一个任务提前取走。

如果运行显示跟踪超时或记录不可用，表示 AMB 无法确认结果，并不表示它取消了出图；请查看 ComfyUI 的队列。没有发现排队记录也不会算作出图成功。

运行结果只关联这次提交返回的运行 ID。批次部分提交成功时，已经排队的部分继续跟踪并保留图片，AI 会收到未全部提交的说明，不应重跑整批。升级后需要重启 ComfyUI 并刷新页面；旧页面不能接手出图。页面正在提交另一批时会提示稍后重试，这只限制提交过程，不需要等显卡把整批跑完。

出图后不必回图库寻找功能：鼠标移到结果图片上，右上角的 **ⓘ** 打开完整的图片与参数，**⇄** 和当前画布对比，**☆** 用同一个菜单保存成工作流、搭配或提示词。图片左上角可以 **勾选**：勾两张（不同步骤、不同任务都行），页面底部出现 **查看参数差异**；它读取图片实际保存的工作流，不依赖 AI 口述参数。没有可用工作流的图片会显示原因，视频没有这些参数操作。AI 展台的图片、挑选卡片也一样；滑动对比下面有 **查看参数差异**。

**AI 软件里的 AMB 卡片**（Claude、ChatGPT、VS Code 等支持 MCP Apps 的软件）：AI 开始任务、出图、画面板或留言时，对话里会出现一张 AMB 的卡片：它做了哪几步、最新几张图、它问你的问题。直接在卡片里点选项就是回答，AI 会马上收到并继续。卡片是 AMB 自己的页面，AI 只能给它数据。要你点头的“关卡”只能在 AMB 里允许，卡片只提示你去 AMB；这样 AI 没有办法替你点。Gemini 命令行、Claude Code 终端版这类只显示文字的软件看不到卡片，照常在 AMB 的 AI 工作台里看和回答。

**交给 AI**：模型页的按钮行、图片详情右上角的 **✦**、搭配卡片上都有 **交给 AI**。写一句想让 AI 做什么（已经预先填好），AMB 会建一个带着这个模型、图片或搭配的任务，并给你一句话复制给 AI；AI 调用 `begin_task` 接手时就拿到了它们的编号，不用再自己搜。

**斜杠命令**：支持 MCP prompts 的软件（比如 Claude）里可以直接选 AMB 提供的四个现成请求：在工作台开一个任务、出几张让我挑、补齐缺的模型、讲讲现在的画布。

**在图上标给 AI 看**：工作台里图片右上角的 **✎** 打开标注：框、圈、箭头、画笔，三种颜色，每个标记写一句要怎么改，再写整体的想法，点 **发给 AI**。AI 下一次调用工具（或 `get_answers`）时收到这些说明和标好的图；能看图的 AI 直接看得到标在哪里。标好的图存在 AMB 自己的记录里，不进图库，任务删掉时一起删。

**让 AI 局部重绘**：标注里选 **▧ 涂重绘区**，用笔刷把要重画的地方涂上（笔刷粗细可调；框、圈、画笔圈出的地方也算），右边 **怎么改** 选 **只改标出的地方**（用笔刷时会自动选上）再发给 AI。另外两种是 **交给 AI 判断**（AI 看说明自己定）和 **整张重新出图**（不做局部重绘）；你选的会作为你的要求写在 AI 收到的第一句，时间线里那条标注也写着“改法：…”。AMB 会在 ComfyUI 的 input 文件夹里放一张 `anomalous_inpaint_….png`：原图加上你涂的区域做遮罩。AI 收到时会被告诉怎么用它（LoadImage 读进来就带遮罩，用原图的模型和提示词，重绘强度 0.5～0.8 保留原样子，1.0 完全重画），不确定时用选择题问你强度，画完用前后对比给你看。这张文件删任务时不会删，因为你的工作流可能还在用它。

**参考做法**：有几件常见的活，AMB 带着现成的做法，是从擅长这些活的工作流里提炼出来的：**局部重绘·裁切缝合**（圈出的地方裁出来放大到 1024 重画再缝回去，需要节点包 ComfyUI-Inpaint-CropAndStitch）、**局部重绘（官方节点）**（没装那个包时用）、**局部重绘·LanPaint**（融合最好、任何模型都行，但慢好几倍，需要节点包 LanPaint）、**放大**（1.25 倍再轻轻重画一遍，只用自带节点，另存一张，文件名以 upscaled 开头）、**分块放大**（2 倍，需要节点包 ComfyUI_UltimateSDUpscale）、**照着姿势画**和**照着构图画**（你递给 AI 一张图，AMB 读出姿势或深度，挑一个和底模对得上的控制网，需要节点包 comfyui_controlnet_aux）、**迭代放大**（分 3 小步放大到 1.3 倍，用 Impact Pack）、**双模型放大**（重画换一个更稳的模型）、**背景移除**（需要节点包 comfyui-inspyrenet-rembg）、**读图出标签**（需要节点包 ComfyUI-WD14-Tagger，AI 跑完会收到读出的标签）、**部位细化（脸和手）**（需要 Impact Pack、Impact Subpack 和 models/ultralytics/bbox 里的检测模型，细化后的图另存一张，文件名以 detailed 开头）、**修手·先放大再修**（你递给 AI 一张图：整张放大到约 400 万像素轻轻重画，原图越小放得越大，最多 2 倍，让手变大，再逐只修手，另存一张，文件名以 hands_fixed 开头；Anima 模型上有 Anima Turbo LoRA 时只跑 10 步，1280×832 的图在 6GB 显卡上约 100 秒。AI 一次出 4 张，自己先放大看手，把手指数不对、粘连、大小不对的去掉，都不行就再出 4 张，最多两轮，再把好的放进只放大手那块的面板让你挑）。AI 工作台右边的**做法**面板列着全部做法：缺节点包或模型的变灰并写明缺什么，每块有个开关，关掉的 AI 就看不到。AI 开工时只收到开着又能用的那些；它说用哪块，AMB 就把那几个节点搭好、接进画布上那个出图的工作流里（采样器、VAE 解码、保存图片都由 AMB 按插口认出来），一次就好，也是一步 Ctrl+Z。画布上有好几个采样器时，AI 得指明用哪一个；缺节点包时，它会知道缺哪个、该用哪块代替。

**skill**：和做法并列，但不搭节点，是 AI 遇到某类活时自己去取的建议。AI 开工时只看到每个 skill 的名字和一句话，真要做那类活时才用 `get_toolbox(skill=名字)` 取全文，这样给 AI 的工具清单不变长，小模型也吃得消。现在有一个：**写提示词·动作适合模型**（按画布主模型的大小给建议：AMB 从模型文件头数出参数量，100 亿以上的大模型手画得好，照画面需要写，不藏手；小模型没指定姿势就选画得清楚的动作，手不是重点时可以自然遮挡或构图不露手，只是可选。你指定的姿势和你给的提示词照原样）。做法面板最下面列着 skill，每个有开关，关掉的 AI 就拿不到。AI 每取一个 skill，时间线上多一行 **Skill**，写着是哪个、按哪一档给的建议（比如“按 Kirazuri（2.1B，小模型）那一档”）；之后那次跑图下面也写着“这次跑图前参照了：……”。同一个建议在两次跑图之间只记一次。

**先对一下重画的范围**：圈得不准也没关系。AI 准备只重画标出的地方时，会先在展台把 **你圈的** 和 **AI 调整后** 的范围并排给你看（红色是要重画的地方；AI 可以挪位置、改成方框或椭圆、往外扩、把边缘做软，图下写着外扩和羽化了多少像素）。点 **用 AI 调整的**、**用我圈的** 或 **我重新圈**，也可以在下面写一句（比如“再往手腕多圈一点”），AI 会照着再调一次；点 **让 AI 定** 就用 AI 调整的。选好以后 AMB 才把带这个范围的 `anomalous_inpaint_….png` 放进 input 文件夹，节点怎么搭由 AI 自己来。

**AI 改副本**（默认）：AI 第一次改画布前，AMB 先把你正开着的工作流复制到一个以任务命名的新标签页（副本），之后 AI 的修改、读画布和运行都只在那一页；你切去别的标签页也没关系，它下次动手前 AMB 会先切回去。你原来的工作流一笔不动。AI 用 `new_workflow` / `open_workflow` 打开的标签页就直接算这个任务的。任务标题栏有 **AI 改副本 ▾**（点开可以换成 **改当前画布**，每种都写着是什么意思）和 **切到副本**（点一下切过去）；**关卡** 窗口里的“AI 改画布时”设定新任务的默认做法。

**隐私模式**：有些图不方便给 AI 看时，点任务标题栏的 **🔒**，这个任务就成了隐私任务：AMB 一张图都不发给 AI（放大看图、图片信息里的图、跑完附带的预览、你递给它的图、AI 软件里任务卡片上的图都一样），它只知道出了几张、成没成功，图由你在 AMB 里看。AI 照样能搭工作流、换模型、跑图。打开和关掉都会记在时间线上并告诉 AI。**关卡** 窗口里的“隐私模式”设新任务默认开不开；默认改成关时，原来按默认开着的任务仍然保持隐私。AI 的某次调用认不出属于哪个任务时，只要默认开着或者还有没做完的隐私任务，就按隐私处理。注意两点：任务做到一半才打开时，之前已经给过 AI 的收不回来；你自己在 AI 聊天框里贴的图和文字，AMB 管不到。提示词目前还会给 AI 看到，遮住提示词是下一步。

**这次跑的节点结构**：每次运行那一步下面写着一行“底模 · 几个 LoRA · 尺寸 · 步数 · 几个节点”，点开有 **简单** 和 **完整** 两种看法（AMB 记得你上次选的）。简单：按每一段采样列出“用哪个模型加哪些 LoRA、提示词是什么、从空白画布还是从上一段的结果（放大多少）开始”，最后保存在哪；后一段和前一段一样的就写“和第 1 段一样”。完整：方块图，哪个底模、LoRA 和权重、正负提示词开头、尺寸、采样器设置、保存，方块之间的线标着类型。两种看法里点任意一项都能定位到画布上的节点。这张图是 AMB 按 ComfyUI 实际收到的工作流画的，不靠 AI 描述。上面的黄色小块是 **比上次改了什么**（比如“K采样器·步数：20 → 30”“新增「加载LoRA」”）。AI 讲解时可以用 `show_run_map` 一次把同一张图放上展台，不用自己拼。

**把图片直接发给 AI**：图库里右键一张图选 **发给 AI**，或者看图窗口的 **✦**：AI 正在做任务时会问你“发给当前任务”还是“开新任务”。发给当前任务时可以写一句想让它看什么；AI 收到的是图片本身，加上 AMB 从图里读出的模型、LoRA、提示词、尺寸和采样设置，不用你再描述。还没被 AI 读到之前连着发的几张会并成一步。AI 自己搜图库时也可以让结果直接带上前 6 张图（`search_images` 的 `with_pictures`）。

**让 AI 在画布上搭工作流**：AI 可以先用 `find_nodes` 查这台 ComfyUI 有哪些节点、每个节点要接什么，然后用 `new_workflow` 新开一个标签页（空白，或者一次把整套工作流搭好并排好位置；你正开着的工作流不受影响），再用 `add_node`、`connect_nodes`、`set_values`、`remove_nodes` 加节点、连线、改参数、删节点。每一步你都能在画布上看到，按 Ctrl+Z 能撤回；AI 工作台那一步下面写着改了什么（包括哪根线从哪里连到哪里）。类型接不上、选项不存在时，画布不会动，AI 会收到能用的写法。

**给 AI 的素材**：窗口右上角的 **✦ 素材** 默认在工作台右边那一栏打开（在别的页面打开时停靠在屏幕右边）：不挡时间线和画布，上面搜索，种类是一排标签，卡片两列，点卡片在小窗里看详细说明（“返回列表”回去），下面挑好点交给 AI。右上角 **⤢** 展开成大窗口，大窗口标题栏的侧栏按钮再收回去；AMB 记得你上次用的是哪种。大窗口里：上面搜索所有素材，左边选种类，节点可以按来源筛（ComfyUI 自带、你装的每个第三方节点包、付费 API 节点），卡片上看得到节点的输入输出、搭配和工作流的封面、提示词原文；鼠标移到卡片上右边显示完整说明。提示词里也能挑搭配和工作流里的提示词。不知道该选哪个节点时，在来源里点某个自定义节点包（小窗里点“来源：全部 ▾”打开列表，可以搜索），点上面出现的 **整包交给 AI**：AI 会从这个包里挑合适的节点用，“只能用”时这个包的节点都允许。勾选后点 **交给 AI**，选“优先用这些”或“只能用这些节点”（自带节点照常可用，别的第三方和付费节点会被拦下）。☆ 设为常用：没挑素材的任务自动带上常用的。AI 用 `get_toolbox` 看到你挑的东西的详细说明，用 `open_workflow` 在新标签页打开你存的工作流。工作流详情页的 **✦ 交给 AI** 会新开一个带着这个工作流的任务。

**运行进度**：AI 运行工作流后，时间线上那一步下面有进度条（排队时前面还有几个；运行时哪个节点、第几步、节点做完几个）。进度条右边是百分比，旁边是红色的 **■ 停止**：一点就停这一次运行（还在排队的移出队列，正在跑的立刻中断，只动这次运行），AI 也会收到“你停止了运行”，不会自己再跑一遍。任务工具栏的运行状态按钮旁边也有一个小 ■。进度条下面写着当前节点 **约剩多久**、每步几秒、**显存剩多少**，再下面一行是 ComfyUI **控制台**最新的那一行（比如 `Model Initializing ...`、`Requested to load …`），点开能看最近几行；这些 AI 也同样看得到。出图刚排上队，AMB 会读这次的工作流算出每个采样器要在多大的图上采样：如果是放大模型放大后又整张重新采样、尺寸超过这张显卡的舒适范围、要解码特别大的图，或者最后要存出特别大的图（超过约 6400 万像素，比如把大图再放大 4 倍，PNG 好几百 MB），会出现黄色提醒，告诉你可能很慢、爆显存或者看图很卡，以及怎么改（只想放大就用纯模型超分，或者先缩小、减步数、分块解码、放大倍数小一点）；AI 收到同样的提醒，会被要求先问你要不要停（它也能用 `stop_run` 停自己的运行）。AI 用 `run_status` 问同样的进度，或者等到跑完再继续，不会凭时间猜；运行期间 AI 调用别的工具时，回复里的 `your_run` 也带着一句当前进度，跑完后告诉它一次结果，所以它不用自己去翻输出文件夹或者看屏幕。跑完后，第一个告诉 AI "跑完了" 的回复里直接带着这次出的图（最多 4 张缩略图），AI 不用再一张张去取，看完就能直接给你留言。

**流程图和关卡**：任务标题下面的一排流程按 AI 做事的先后列出它经过的阶段（模型、搭配、提示词、运行、挑图……），点一下跳到那一步。任务列表上方的 **关卡** 里，改画布、用显卡出图配音、下载模型、联网扫描、挪动模型文件五类事各自可以选 **直接做 / 先问我 / 不许做**（默认下载和挪文件先问）。选了“先问我”，AI 的那一步会停在时间线上列出它要做什么，你点 **允许** 才做；点 **不要** 时可以写原因或想怎么改，AI 会收到。AI 最多等 50 秒，等不及的话会先去问你的回答（`get_answers`），你允许后它再做一次，不会问第二遍。AMB 把所有工具都给 AI 软件，软件自己按需读工具说明（Antigravity 在第一次用某个工具前读它的说明文件）。**等我回答** 是 AI 问你问题以后最多等多久（1 分钟 / 3 分钟 / 10 分钟）：你在回答框或留言框里打字时，停手一分钟内都不算超时（只算真按键，光标停在框里不算）；时间到了 AI 收工，你答完以后点一下消息框上方那句话复制给它。AI 每轮做完会先问你下一步，跑图、下载、扫描时除外；问题上的 **让 AI 定** 表示交给 AI 自己决定。AI 软件会记住它拿到的工具列表，AMB 更新以后要让它重新连接（Antigravity：重启，或在 MCP 设置里把 anomalous 关掉再打开），再开个新对话；它还拿着旧列表时，任务标题下面会有一行黄字提醒你。**等不到回答时** 默认是 **停下等我**；选 **按推荐的继续**，到了时间你还没答，AI 标了推荐项的选择题就按推荐的选，展台和“决策”里会写明“到时间，按推荐选了”；没有推荐项的问题、你已经动手写了回答的问题、关卡问你的事永远不会替你答。**等跑图** 默认是 **跑完叫我**：AI 提交后最多等 1 分钟，跑得快的当场就拿到结果，还没跑完就告诉你在跑，然后收工，不再每 55 秒查一次进度；跑完后，AI 工作台消息框上方有几句话（“跑完了，看看结果”“再来一次，换个种子”，出错时是“出错了，看看是哪里的问题”），点一下复制，粘到 AI 的对话框里，AI 的下一次调用就拿到结果和图。AI 一知道结果，这几句话就换回平常的。平常 AI 停下来的时候（没在调用工具、没在跑图、没在等你回答），那里也总有一行话可以复制：你在 AMB 里回复了而 AI 还没收到，是“我在 Anomalous 里回复了，看看再接着做”，别的时候是“继续”；最后一句“用 Anomalous 接着做任务：…”给新开的 AI 对话用。想让 AI 自己等到跑完，选 **AI 自己等**。这一项马上生效，不用开新对话。

**少调用几次就接好线**：以下编号只是例子，以当前画布为准。

```text
add_node(type="ImageScale", insert_after=8)
```

原来 `#8 → #9 保存` 会变成 `#8 → 新放大节点 → #9 保存`。如果 #8 同时连到保存和预览，工具会要求用 `wire_to=9` 指定要插入的分支。新节点让几种类型穿过时（LoRA 的模型线和 CLIP 线）每一种都接进去；只想插一种时用 `insert_type="MODEL"` 等指定。没有下游时用 `wire_from=8` 延长末端。

```text
add_node(type="VAEEncodeForInpaint", wire_from=[12, 4], wire_to=3, replace=true)
connect_nodes(from_node_id=12, to_node_id=15)
```

前一个调用按唯一类型连接图片、遮罩、VAE 和采样器的 LATENT；`replace=true` 明确允许替换采样器原有的输入。后一个只报两个节点号，把它们之间唯一匹配的类型一次接好。同类型的几个插口名字对得上时自动配对（ControlNet 的 positive/negative 对采样器的 positive/negative）；对不上的（一个提示词该接正向还是反向）和通配类型不会猜，工具会要求指定插口；多来源争抢同一输入、循环和未获替换许可的已有连线都会在改动前报错。显式指定插口的旧调用仍保留原有替换行为。

```text
add_node(type="ControlNetApplyAdvanced", wire_from=[20, 21], wire_to=5)
add_node(type="LoraLoader", wire_to=[5, 2, 3])
```

```text
add_nodes(nodes={
  "enc":  {"class_type": "VAEEncode", "inputs": {"pixels": ["#12", "IMAGE"], "vae": ["#4", "VAE"]}},
  "mask": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["enc", 0], "mask": ["#12", "MASK"]}, "wire_to": 3}
}, replace=true)
```

一组节点一次加好：`#12`（加载图片）和 `#4`（模型加载器）是画布上已有的节点，`enc`、`mask` 是这组里新加的。`wire_to=3` 把这组的结果接进采样器 #3；它原来的空白潜空间被替换，所以要 `replace=true`。原来要十几次调用的局部重绘分支，现在一次。

`wire_to` 指向的输入原来已经接着线时，会把新节点插在前面：采样器 #5 的正向、反向原来接着提示词 #2、#3，现在改接 ControlNet，#2、#3 接进它同名的正向、反向输入；#20（ControlNet 加载器）和 #21（加载图片）按类型接上。第二个调用把采样器的模型线和两个提示词的 CLIP 线都改从 LoRA 走，LoRA 自己接上原来的模型和 CLIP。新节点没有这种类型的输入（比如用加载图片顶替原来的图）才算替换，要 `replace=true`。

成功后直接返回实际接线、还缺的输入和是否通向输出，通常不用再读整张画布。输出可达只说明存在路径，运行前仍由 ComfyUI 校验。一次成功操作可用原生 Ctrl+Z 撤销；执行中连接失败会恢复原接线，第三方节点回调若妨碍恢复会明确报出，需要检查画布。升级后重启 ComfyUI、刷新页面，并重新连接 MCP；若 AI 软件缓存工具定义，再开一个对话。

**AI 干活时你自己改的东西**：AI 在做一个任务时（10 分钟内调用过），你在 AMB 里做的改动，比如画布上的改动、改模型信息、存搭配或提示词，会以“你在 AMB 里改了”出现在这个任务的时间线上，画布改动带修改前后。AI 下一次调用任何工具时会收到它（并被告知保留你的改动，不要改回去），时间线上写着它是否已经知道。操作记录页里，AI 做的和 AI 干活时你做的记录旁边有 **AI 任务 →**。

画布操作下面直接显示操作记录中的 **修改前 / 修改后**，可以定位对应节点，并在允许时撤销。长提示词可能只保留变化附近的片段；早期操作记录被清理后会提示不可用，不会用现在的画布替代历史值。操作记录页使用相同的改动展示。

左边栏的 **AI 工作台** 记下 AI 通过这个接口做的每一步，按**任务**分好：

- AI 开始干活时会调用 `begin_task` 起个标题；没起的话，同一个 AI 软件连续做的事自动算一个任务，停了 20 分钟以上就算新的。
- 每个任务是一条时间线：查了什么（自动折叠成一行，点开看每一次）、画布上改了什么（AI 连着查资料、改画布、记决策，三步以上、其中至少两步不是查资料时，叠成一行“做了 N 步”，下面一排小标签写做了什么，点开看每一步；“撤销这一串”一下撤掉这一串在画布上的改动）、运行、下载、扫描、配音，还有 AI 自己的留言（`report` 工具，也可以把它用别的方式做出来的图交上来）。
- **做出来的东西都留着，点一下就到**：运行出的图会一直等到跑完再收进任务里，最上面的“这次做出来的”可以直接点开看大图；用到的模型点一下打开模型页，搭配打开搭配，配音可以直接听；画布上的改动可以“在画布上找到”，也可以**撤销**（一步，或者整个任务的画布改动一起，从最后一步往前，遇到你自己后来又改过的地方就停下）。
- AI 还在干活时，时间线会自己往下长；你在别的页面时，左边栏的 AI 工作台会亮一个小点。首页也有“AI 最近做了什么”。
- **给 AI 留言**：任务时间线下面有个留言框，比如“背景再亮一点”“先别跑了”。留言会成为任务里的一步，AI 下一次调用任何工具（或 `get_answers`）时都会自动收到，下面写着它有没有看到。AMB 没法叫醒已经停下的 AI：它如果已经结束回合，请回到 AI 软件里让它继续。
- 左边的任务按日期分组（今天、昨天、某天），前面的小图标表示状态：● 进行中、? 等你回答、! 有一步出错、✓ 完成。
- **新任务**：点任务列表上方的 **＋ 新任务**，写上要 AI 做什么（也可以空着）。这个任务会显示“等 AI 接手”，下一个来调用的 AI 就会接手它。页面最上面是要发给 AI 的那句话和 **复制这句话**，往下滚也一直在顶上。等的时候可以展开 **从图库挑图给 AI**，在大图库里点图片，它们会放到最下面的留言框上；在留言框里写上要交代的（@ 提到模型和搭配），用留言框左边的 **素材** 按钮挑模型和节点，点发送。这些都是可选的，备好的都列在那页，AI 接手时一起收到。之后的步骤都记在这里，不会接在它上一个任务后面。AI 即使先查资料再调用 `begin_task`，也会继续这个任务，保留你定的标题；只有另一件事才用 `new_task=true` 明确另开，或先用 `report(done=true)` 结束当前任务。
- 任务可以改名、从列表移除（只删记录，图和画布不受影响）。记录存在 ComfyUI 的 user 文件夹里，保留最近 300 个。
- 只看得到经过这个接口的事。AI 绕开它做的，可以让它用 `report` 报告。

**删掉任务里的图**：在图库里删掉的图（进回收站）在 AI 工作台里显示成“图片已删除”的占位，点不开也不能再 @；AI 会被告知你删了它，不会再拿它来用。从回收站还原后，它会自己重新显示出来。

**关联任务**：AI 开新任务时，或者你看着某个任务点“新任务”时，新任务会记住它“接着”哪个任务。任务标题下面显示“接着：某任务”和“后续：某任务”，点一下就跳过去，任务列表里后续任务前面有 ↳。关联错了点 × 解开；没关联上的点“接着哪个任务…”自己选。AI 接手一个后续任务时，会先收到上一个任务里定下的决策。

**AMB 之外**：AMB 只看得到 AI 发给它的调用，AI 软件自己跑的命令和脚本它看不到。所以 AI 每调用一次 AMB，AMB 就看一眼输出和输入文件夹最上面一层：上次调用以来，有没有不是出图产生的新图片，有没有图片被原地改写（做出来一分钟以后又被改了）。有的话，时间线上多一行橙色的 **AMB 之外**，写明是哪些文件（输出文件夹里的图直接显示出来），AI 也会在这次的回复里收到提醒：可能是你自己做的，如果是它做的，改图只能跑工作流，并用 `log_outside` 说明。只在 AI 调用时看，不在后台扫描；只看文件名和时间，最多看两万个文件；ComfyUI 正在出图时，新图要等这次出图结束再判断（那时 ComfyUI 的记录里有它保存的图）。输入文件夹只看被改写的图（你上传的图和新建的看起来一样）；Linux 上系统不记文件的创建时间，只看输出文件夹，写作“新建或改写”。AI 自己用 `log_outside` 说的也是一行 **AMB 之外**，写着做了什么、为什么、动到的文件。

**给 AI 的规则**：连接说明里的第 ④ 步是一段现成的规则（先用 AMB 的工具、只通过跑工作流改图、在 AMB 里问和说明、用了别的工具就 `log_outside`）。放进 AI 软件的“规则”里，它每次对话都会读到，比只靠 MCP 自带的说明更管用（Antigravity：Customizations → Rules → + Global）。AI 不一定每次都照做，所以上面那一层由 AMB 自己看。

**决策记录**：讨论在哪里都行，在 AI 自己的对话框里聊也可以，但商量出的结论会留在 AMB。AI 用 `log_decision` 把“定了什么、为什么、没选哪些、谁定的、跟哪几步有关”记成时间线上一张带 📌 的卡片；你在 AMB 里自己做的选择（面板上的回答、允许或不允许、交出去的素材、AI 改画布的地方、停止运行）会自动算进去。窗口右上角的 **决策** 按时间列出这个任务的所有决策，每条都能跳回时间线上的那一步；AI 跑了图或改了画布却很久没记录决策时，这里会轻轻提一句。AI 下次接手这个任务时，也会先收到这些决策。

**成果**：时间线最上面一行写着这个任务做出了什么（“本次成果：8 张图 · 1 个工作流 · 1 个搭配”），点 **在右侧看**，或者窗口右上角的 **成果**，右栏就按新的在上列出来：图片按每次跑图分组（标着第几步、几点，点一下跳回时间线上那一步；每张图照样能 ☆ 保存、勾两张对比参数），AI 搭的工作流（任务自己的标签页或你开着的画布，**在画布打开** 切过去），用过的搭配，最新那张图的正向和负向提示词（各有 **复制**），用到的模型和发起过下载的模型（不代表下载完成），配音（▶ 直接播放）。工作流、搭配、提示词三处都能一键存下：存的是出最新那张图的那一套（**存成配方**、**把最新那张图存成搭配**、**存进提示词库**），和那张图的 ☆ 保存菜单是同一个做法；想存别的图，就点那张图的 ☆。有新成果时，**成果** 按钮上会亮一个数字，它不会自己弹开。

**留言框**一直停在任务这一栏的最下面，上方的“现在”栏显示 AI 出图的进度（可以停止）、要你允许的事（直接点 **允许 / 不要**）和 AI 问你的问题（点选项就回答）。图片可以拖到留言框上，或者 Ctrl+V 粘贴截图：存进输出文件夹的 `ai_inbox` 后加到消息上。它上面显示这条消息要带的图（每张可以 **✎ 标注** 或 **×** 拿掉）和 @ 提到的东西；Enter 发送，Shift+Enter 换行，只发图片也行。往上翻着看时 AI 有了新步骤，会出现 **下面有新的步骤**。**留言框里的 @ 和 /**：在留言框里打 **@**，会弹出一张能搜索的列表：这个任务出过的图、图库里最新的图（打字时也按提示词、模型、seed 在图库里搜）、搭配、模型、工作流、提示词、节点包、节点。留言框左边的 **图库** 按钮打开图库：点选几张（一次最多 8 张），点 **加进留言**，它们显示在输入框上方。用 @ 选中的会写成“@名字”，并在输入框上方显示成小标签；发出去时 AI 收到的是你指的那个东西本身（模型的准确 ID、搭配的参数、图片和它的生成参数），不用它去猜。在开头打 **/** 是快捷指令：/停止、/撤销、/展台、/节点结构、/素材、/副本、/当前画布、/新任务 马上生效，不用等 AI；/重跑、/解释、/继续 帮你写好一句话，改一改再发。↑↓ 选，回车或 Tab 确认，Esc 关掉。

**AI 画的面板**（`show_panel`）显示在工作台右边的**展台**上，后面再多步骤也不会被顶走。AI 放了新面板，右栏自己打开并跳到它，你关掉了或者在看别的也一样（AI 只是改了已有的面板时不会）；不想被打扰，把展台顶上的 **有新东西就打开** 关掉。窗口窄时它不抢时间线，只在“展台”标签上亮个点。右边这一栏一次只显示一样东西，用窗口右上角的按钮切换：**展台**（有问题等你回答时带个小黄点）、**节点结构**（AI 跑过的节点结构图，大图；上面可以选看哪一次运行，时间线里运行那一步的“在右侧看大图”也会打开它）、**决策**、**素材**、**成果**。再点一下正亮着的那个就收起这一栏；切走再切回来，展台的位置和挑了一半的素材都还在。任务标题和那一排按钮在时间线往下翻时一直停在顶上。时间线上每个面板留一张小卡片：小图标、标题、里面有什么（“1 张图”“问你 · 2 个选项”），和紫色的 **在右侧打开** 按钮；右栏正在显示的那一张写着绿色的“正在右侧显示”。展台默认跟着最新的面板，你翻回旧面板就停在你看的那张；窗口窄的时候，时间线和展台变成两个标签页切换。右边这一栏是一张单独的卡片，它左边的整条空隙都能拖着调宽窄（鼠标靠近时整条边会亮起；点一下后也能按 ← → 调；AMB 记得你调的宽度，双击恢复默认），时间线总会留够地方。窗口左上角的按钮收起 / 展开左边的任务列表；收起以后，鼠标移到这个按钮上，任务列表会临时浮出来，点一个任务或者鼠标移开就自动收回。素材在右边这一栏里时，鼠标移过卡片不会再跳进详细说明，点右边的 ⓘ 才看。小窗里素材是一行一个的列表（图标、名字、来源、勾选），搜索框旁边三个小图标是“全部 / 已选 / 常用”；展开成大窗口就是带预览的卡片。这些地方的滚动条平时是隐藏的，鼠标移到能滚动的那一块上才显出来。AI 可以用插件提供的“积木”拼面板：标题和文字（也可以是提示、警告）、图片（一排、网格，或者两张并排对比）、你的模型（带封面的卡片，点了打开）、表格、列表、参数、进度条。它还能**问你**：几个按钮（单选或多选）、一行输入框。你的回答会交出去，等 AI 用 `get_answers` 来取（它可以等你最多一分钟）；每个问题下面有一个状态标签：琥珀色的 **已发送 · 等 AI 来取**，AI 拿到后变成绿色的 **AI 已收到 · 时间**。你的留言、批注、发给它的图片也是一样。想让 AI 自己决定的题点 **让 AI 定**，AI 会自己拿主意，不再问一遍。AMB 没法主动叫醒 AI，所以回答之后要等它下一次来问。

**展台积木**（1.62）：AI 还可以在图上**画圈标注**（圈上是编号，标签列在图下面，点标签放大那一块）、摆**拉帘对比**（两张图叠在一起，拖中间的线）、摆**选片盘**（每张图带 AI 的理由和“就选这张”；“放回画布”会在新标签页里打开这张图里存的工作流，也可以直接拖到画布上）、画**示意图**（框和箭头由插件排版；带 ◎ 的框点一下定位到画布上的节点）。AI 只给位置和文字，圈、线、框都是插件画的，所以接哪家 AI 都一样好看，也不会收 AI 写的 SVG 代码。

面板里的东西都由插件检查过才画出来：只认这几种积木，只是纯文字，图片只能来自 ComfyUI 的 output 文件夹，模型只能是你自己的，AI 写的代码不会运行。AMB 没开着的时候 AI 画了面板，右下角会弹一个小卡片“AI 在问你”，点“去看看”就到。

展台右上角的 **× 关闭展台**只收起这一栏，不删除面板、不结束任务；AI 改已有的面板时不会重开，放新面板时会重开（把 **有新东西就打开** 关掉就不会）。窗口右上角的“展台”，或时间线里的“在右侧打开”可以恢复，未提交的输入会保留。“来自第 N 步”指创建这个面板的那一步；后续修改同一个面板不会改变它的来源编号。

**按过程往下看**：建议 AI 把“搭配方案 → 节点说明 → 成图结果”作为不同阶段依次展示。更新同一个面板时，新内容也只接在底部，已有内容不会因为 AI 重排或省略而消失。`show_panel` / `update_panel` 会返回积木 ID；明确带上已有 ID 才是在原位置修正那块内容，进度条也可以按唯一的标签更新。单面板最多 30 块，满了就用 `show_panel` 展示下一阶段。面板里的进度条是 AI 自己写的数，不会自己动：任务往前走了（那次出图结束、AI 又画了面板或留了言、任务结束）而它没有更新，展台就把它画成灰色，并写明是几点写下的；出图的真实进度在时间线那一步和标题栏的运行状态里。旧记录只保留了最终排版，没有每次更新前的顺序，因此不会自动重排旧记录。

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
A progress bar holds the AI's own numbers: once the task goes past it without an update (a run
ends, a later panel or note, the task ends), the stage greys it and says when it was written.
The total remains bounded to 30 blocks; use a new panel for the next phase. Old records retain
their saved layout because earlier revisions were not recorded.

While ComfyUI runs, Anomalous serves an MCP endpoint at `http://127.0.0.1:8188/anomalous/mcp` (use your ComfyUI port). Add it as a Streamable HTTP server in your AI app (Claude Code: `claude mcp add --transport http anomalous <url>`; Cursor and VS Code: a `url` / `"type": "http"` entry; Claude Desktop: through `npx mcp-remote <url> --transport http-only`). Both the 2026-07-28 protocol and the earlier `initialize`-based versions are served.

Since 1.62 the **AI workbench** page keeps every step an AI app takes through this endpoint, grouped into tasks (named with `begin_task`, else one app's calls without a 20-minute pause): what it is currently running (`running` in real time) and what it looked up, changed, ran, downloaded, scanned or spoke, its notes (`report`, which also hands in pictures made another way), and what each step made, with links to the picture, the model, the combo, the canvas change (find or undo) and the audio. It updates live; the rail gets a dot while you are elsewhere. With `show_panel` the AI draws a panel there from fixed blocks (text, pictures to compare, your models as cards, tables, settings, progress, buttons and a text line); the user's answers and task messages are returned on `get_answers` (which can wait up to 55 s) and are also automatically attached once to the AI's next successful tool call. Blocks are checked on the server and drawn as text; nothing the AI sends runs.

Reading tools: library overview, model search and details (optionally with the cover; each model says which node types load it, and a model in the wrong folder for what it is says where it belongs), scan status, output-image search and generation settings (optionally with a thumbnail), combos, workflow recipes, saved prompts, generated audio and the activity log. Acting tools: read the open workflow, write prompts, swap a node's model, add a LoRA, place a combo, check and fix missing models, run the workflow, open a model in Anomalous, start scans, list Anomalous TTS voices and have one speak. Canvas actions need ComfyUI open in a browser on this computer; each is one Ctrl+Z step and is logged as the AI's. Nothing deletes or renames files; `move_model` moves a misfiled model (with its covers and notes) to its folder, after the user says yes unless the "files" gate lets it go ahead. Only this computer may connect; requests through a proxy, from other hosts or from web pages are refused. When your AI app uses a cloud model, what the tools return (and any attached picture) is sent to that provider.
