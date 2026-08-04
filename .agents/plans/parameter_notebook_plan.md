# Parameter Notebook & Recipe Integration Plan

**Target Audience**: GPT (Backend Developer) & Antigravity (Frontend Developer)

## Objective
The user has decided to integrate the "Parameter Notebook" (参数笔记本) directly into the "Parameters" tab of the Workflow Recipe details view, abandoning the standalone global sidebar modal. A parameter notebook represents an immutable snapshot of a recipe's exact generation values at a specific point in time. 

When a user saves the current recipe, the frontend will automatically create a new Parameter Notebook associated with that recipe.

## 1. Backend Implementation Guide (For GPT)

### 1.1 Goal
Modify `api/parameters.py` so that Parameter Notebooks can be queried and associated with a specific Recipe.

### 1.2 Required Changes in `api/parameters.py`
1.  **Associate Notebooks with Recipes**:
    *   In `api_save_parameter(request)`, the JSON payload will now include an optional string field: `recipe_filename` (e.g., `recipe_123456789.json`).
    *   Save this `recipe_filename` inside the Parameter Notebook's JSON data structure so it is persisted to disk.
    *   Optionally, include the recipe filename stem in the generated parameter notebook filename to make it easier to debug (e.g., `params_<recipe_stem>_<timestamp>_<uuid>.json`).
2.  **Filter Notebooks by Recipe**:
    *   In `api_get_parameters(request)`, read the query parameter `recipe_filename` (e.g., `request.query.get("recipe_filename")`).
    *   If provided, filter the returned list of notebooks so that it only includes notebooks whose `data.get("recipe_filename")` exactly matches the query parameter.
3.  **Preserve Existing Logic**:
    *   The generation of `parameter_signature` (`sha256-params-v1`) must remain intact.
    *   The `api_get_parameter_gallery` endpoint remains unchanged, as it relies on the notebook filename or fingerprint, which won't structurally change.

### 1.3 Recipe Save Behavior (Frontend Responsibility, noted here for context)
GPT does **not** need to modify `/anomalous/save_recipe` or `/anomalous/update_recipe`. The frontend will be responsible for orchestrating the save:
1. Frontend calls `/anomalous/save_recipe` (or update).
2. Upon success, frontend calls `/anomalous/save_parameter` and passes the resulting `recipe_filename`.

## 2. Frontend Implementation Guide (For Antigravity)

*To be executed after GPT completes the Backend changes.*

### 2.1 Refactoring `ui_recipe_detail.js`
1.  **Redesign `renderRecipeParameters`**:
    *   Replace the current static rendering of `recipe.params` with a two-pane layout (Sidebar + Main Editor).
    *   **Sidebar**: Fetch `/anomalous/parameters?recipe_filename=...` and display the list of notebooks belonging to this recipe.
    *   **Main Editor**: Display the parameters of the currently selected notebook (prompts, scalar fields, node widgets) and its parameter gallery.
    *   Make the UI read-only since parameter notebooks are immutable historical snapshots.
2.  **Delete Global Sidebar Entry**:
    *   Remove the `⚙️ Parameter Notebooks` button from `ui_sidebar.js`.
    *   The `web/modules/ui_parameters.js` file should be deleted or completely gutted since the logic is moving into `ui_recipe_detail.js`.

### 2.2 Updating `ui_recipes.js`
1.  **Automated Notebook Creation**:
    *   In `handleSaveRecipe`, immediately after successfully completing `fetch('/anomalous/save_recipe')` or `update_recipe`, extract the `filename` from the response (or the existing recipe being updated).
    *   Make a subsequent request to `/anomalous/save_parameter`, passing the `workflow` and `recipe_filename`.
    *   This ensures every manual recipe save also persists the exact parameters used at that moment into a notebook.

## Implementation record — 2026-08-04

- Implemented recipe binding and exact filtering in `api/parameters.py`.
- Implemented immutable snapshot creation after recipe save/update in `ui_recipes.js`.
- Implemented the two-pane snapshot selector and read-only parameter viewer in `ui_recipe_detail.js`.
- Removed the global Sidebar entry and the standalone `ui_parameters.js` module.
- Kept unbound legacy parameter JSON files and the storage/gallery API contract readable for compatibility.
