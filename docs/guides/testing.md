# 测试怎么跑

`tests/` 里是插件自己的测试：Python 测试检查后端（扫描、文件读写、回收站、模型下载、MCP 等），`.mjs` 测试检查前端里不依赖浏览器的规则（提示词词块、搭配的空位、往画布插 LoRA、撤销等）。改代码或提 PR 之前跑一遍，就知道有没有弄坏别的地方。

English summary at the end.

---

## 1. 准备

- 插件要装在一个 ComfyUI 的 `custom_nodes` 里。Python 测试会用到 ComfyUI 自己的模块（`folder_paths`、`server` 等）和它带的包（aiohttp、Pillow、av）。
- 装好 [Node.js](https://nodejs.org/)（18 或更新）。
- 不需要联网，不需要显卡，也不会碰你真实的模型库：测试只在临时文件夹里建假文件，跑完就删。

## 2. 一条命令全跑

在插件文件夹（`custom_nodes/Anomalous_Model_Browser`）里打开终端：

```bash
node tools/run_tests.mjs
```

它依次跑结构检查、每个 `tests/*.mjs`、全部 Python 测试，最后写 `All passed.` 或者列出失败的项目。

Python 用哪个：

- 设置了环境变量 `PYTHON` 就用它；
- 否则用便携版 ComfyUI 的 `python_embeded`（就在 ComfyUI 文件夹旁边）；
- 都没有就用系统的 `python`。用 venv 或 conda 装的 ComfyUI，先激活那个环境再跑。

## 3. 只跑一部分

```bash
# 结构检查：每个源码文件都登记在架构文档里、前端模块都能被引用到、文件长度不超线
node tools/check_structure.mjs

# 一个前端测试
node tests/combo_slots.mjs

# 全部 Python 测试（便携版 ComfyUI 的写法；其他安装方式换成自己的 python）
../../../python_embeded/python.exe -B -m unittest discover -s tests -p "test_*.py"

# 一个 Python 测试文件
../../../python_embeded/python.exe -B -m unittest tests.test_model_download
```

## 4. 写新测试

- 前端规则测试放 `tests/<名字>.mjs`，用 `node:assert`，直接导入 `web/modules/` 里的真实模块，只替换浏览器和 ComfyUI 这些外部部分。
- 后端测试放 `tests/test_<名字>.py`，用 `unittest`。文件一律建在 `tempfile` 的临时文件夹里，网络请求用 `unittest.mock` 换掉。
- 测试里不要写自己电脑上的真实路径、真实模型名或个人信息。
- 修 bug 时，先写一个能重现这个 bug 的测试。

---

## English summary

`tests/` holds the plugin's own tests: Python tests for the backend and `.mjs` tests for the browser-free frontend rules. They need the plugin inside a ComfyUI `custom_nodes` folder (the Python tests import ComfyUI's modules) and Node.js 18 or newer; no network, no GPU, and they only touch temporary folders.

Run everything from the plugin folder with `node tools/run_tests.mjs`: the structure check, every `tests/*.mjs`, then all Python tests with `$PYTHON`, the portable build's `python_embeded`, or `python`. Single parts: `node tools/check_structure.mjs`, `node tests/<name>.mjs`, `python -B -m unittest discover -s tests -p "test_*.py"`. New tests import the real modules and replace only outside systems; keep real paths and personal data out of them.
