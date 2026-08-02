# Recipe 交互逻辑重构与清理方案

本方案旨在解决「创作工作台 / Recipe」界面的交互逻辑问题，主要包括：彻底移除容易引发 Bug 的 Quick Queue（快速排队运行）功能，以及在 Recipe 列表页为每张卡片补齐「追加到画布 (Append to Canvas)」和统一「打开到画布 (Open in Canvas)」的提示逻辑。

请将本任务交由 GPT 执行，严格按照以下步骤操作：

## 步骤 1：清理 Quick Queue 冗余代码

用户已明确表示放弃 Quick Queue 功能（认为脱离画布去跑接口容易逻辑混乱）。

### `web/modules/ui_recipe_detail.js`
1. 找到并**彻底删除**函数 `renderQuickQueue(parent, owner, recipe)`（大约在第 315-387 行左右）。
2. 在 `renderOverview` 函数内部结尾处，找到并**删除**调用代码 `renderQuickQueue(overview, owner, recipe);`。
3. 在文件顶部，**删除**从 `./recipe_actions.js` 导入的 `quickQueueRecipe`。

### `web/modules/recipe_actions.js`
1. 找到并**彻底删除**以下为 Quick Queue 服务的功能函数：
   - `primitive(value)`
   - `validateOverrides(recipe, changes)`
   - `buildRecipePrompt(recipe, changes)`
   - `quickQueueRecipe(recipe, changes)`
2. 如果顶部 `import { api } from '../../../scripts/api.js';` 没有被其他函数使用，请将其一并删除。

### `web/modules/locales.js`
1. 找到 `zh` 和 `en` 的多语言配置，**删除**以下冗余词条：
   - `recipeQuickQueueTitle`, `recipeQuickQueueHint`, `recipeQuickQueueEnable`
   - `recipeQuickQueue`, `recipeQuickQueueRunning`, `recipeQuickQueueInvalid`, `recipeQuickQueueSuccess`, `recipeQuickQueueError`

---

## 步骤 2：暴露共用的 Open 与 Append 工具方法

目前 `ui_recipe_detail.js` 里实现了很完善带提示和错误处理的 `openRecipeOnCanvas` 和 `appendRecipeOnCanvas`，但是它们是模块内部函数。我们需要让外层的卡片列表也能复用。

### `web/modules/ui_recipe_detail.js`
1. 将 `openRecipeOnCanvas` 改为导出：
   ```javascript
   export async function openRecipeOnCanvas(owner, recipe) { ... }
   ```
2. 将 `appendRecipeOnCanvas` 改为导出：
   ```javascript
   export function appendRecipeOnCanvas(owner, recipe) { ... }
   ```

---

## 步骤 3：在列表卡片补齐「追加」按钮，并统一「打开」逻辑

目前在 `web/modules/ui_recipes.js` 的 `renderRecipeList` 方法里（约 960 行后），卡片的 `actions` 只有“查看详情”、“编辑”、“导出”、“打开到画布”和“删除”。我们要为其加上“追加”，并复用步骤 2 中的方法。

### `web/modules/ui_recipes.js`
1. 在文件顶部导入刚才暴露出的方法：
   ```javascript
   import { showRecipeDetail, openRecipeOnCanvas, appendRecipeOnCanvas } from './ui_recipe_detail.js';
   ```
2. 找到 `restore.onclick` 的逻辑（通常挂在 `const restore = appendText(...)` 下），将其修改为复用 `openRecipeOnCanvas`：
   ```javascript
   const restore = appendText(actions, 'button', t('recipeOpenCanvas'), 'anomalous-btn-primary');
   restore.type = 'button';
   restore.onclick = async () => {
       try {
           const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(recipe.filename)}`);
           const payload = await response.json();
           if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
           // 复用统一逻辑
           openRecipeOnCanvas(this, payload.data);
       } catch (error) {
           console.error('Could not restore Workflow Recipe:', error);
           alert(t('recipeRestoreError'));
       }
   };
   ```
3. 紧接着 `restore` 按钮之后，**新增**追加按钮的逻辑：
   ```javascript
   const append = appendText(actions, 'button', t('recipeAppendCanvas'), 'anomalous-btn-primary');
   append.type = 'button';
   append.onclick = async () => {
       try {
           const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(recipe.filename)}`);
           const payload = await response.json();
           if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
           // 复用统一逻辑
           appendRecipeOnCanvas(this, payload.data);
       } catch (error) {
           console.error('Could not append Workflow Recipe:', error);
           alert(t('recipeAppendError'));
       }
   };
   ```
   *(注：请确保追加按钮的 DOM 插入顺序正确，通常排在 `restore` 旁边，最后再是 `remove` 按钮)*

## 验证列表 (供 GPT 和 用户 确认)
- [x] 详情页里 Quick Queue 面板完全消失。
- [x] 列表页的卡片下方现在出现了“追加到画布”按钮。
- [x] 点击列表页的“追加”和“打开”时，会首先 fetch 完整的图数据，然后执行对应的合并/替换画布动作。
- [x] 如果画布已经有未保存的连线，“打开”操作会弹出与详情页一致的二次确认弹窗。

## 执行记录

2026-08-03：已完成。Open/Append 处理器从 `ui_recipe_detail.js` 导出并由列表卡片复用；Quick Queue 前端、动作链、多语言和样式已移除；`ARCHITECTURE.md` 与工作流详情设计同步更新。
