# Workflow Recipe Detail Panel — Product and Architecture Design

Status: design handoff. This document changes no runtime behavior. The repository already contains an initial detail-panel/schema-v3 implementation; the decisions below define the next coherent iteration and the boundaries future agents must preserve.

## 1. Product direction

Workflow Recipes are no longer a small add-on to “Notebooks.” The shared surface now contains two different creative tools:

- prompt drafting and model/LoRA assembly;
- durable, reproducible workflow recipes with history.

The top-level entry should therefore be renamed from **Notebook / 笔记本** to **Workspace / 创作工作台**.

Recommended user-facing labels:

| Surface | Chinese | English |
| --- | --- | --- |
| Top navigation button | 创作工作台 | Workspace |
| Modal title | 创作工作台 | Creative Workspace |
| Existing notebook tab | 提示词笔记 | Prompt Notes |
| Recipe tab | 工作流配方 | Workflow Recipes |

This is a presentation rename only in the first pass. Existing route names, storage folders, JavaScript property names, and API contracts containing `notebook` remain unchanged until a dedicated migration is justified. Do not mix a UI-label change with a persistence rename.

## 2. Core questions answered by the detail panel

Compact cards continue to answer “what did I save?” The detail panel answers:

- Can this workflow run on the current machine?
- Which checkpoint, UNET, LoRA, VAE, text encoder, ControlNet, and supported third-party loaders does it use?
- What did those models look like when I saved the recipe, and what preview is available now?
- Is the model reference only a filename/path, or does it contain cryptographic identity evidence?
- Which parameters matter, which version produced the result, and what changed later?

The panel remains a full-width replacement inside the Workspace modal. It has one primary vertical scroll owner; tabs must not introduce competing vertical scroll regions.

## 3. Three different image concepts

Do not collapse these concepts into one field:

| Image | Purpose | Ownership |
| --- | --- | --- |
| Recipe cover | Recognize the recipe in the card grid and Overview tab. | Recipe presentation data. |
| Current model preview | Show the preview currently associated with a local model/LoRA. | Model library; resolved on demand. |
| Frozen model preview snapshot | Preserve a small visual reminder of what a referenced model looked like at a recipe version. | Optional recipe-owned asset. |

A model preview is presentation evidence, never model identity evidence. A matching image, filename, or visual similarity must not influence Model Doctor.

## 4. Model previews in saved recipes

Yes, model previews can be included, but they must not be inserted into the authoritative serialized `workflow` graph and must not be embedded as unrestricted base64 blobs in the recipe JSON.

### 4.1 Recommended two-layer behavior

1. **Current local preview — always available when resolvable**
   - The Models & reproducibility tab resolves previews only after the recipe is opened.
   - Resolution uses the exact saved model reference and its required category in one bounded batch.
   - It may reuse the existing preview resolver only if an `exact_only` boundary is available. Recipe browsing must not trigger a recursive basename walk.
   - No preview URL is persisted as truth: URLs contain local cache versions and may become stale after rename, cover replacement, or migration.

2. **Frozen preview snapshot — optional and explicit**
   - The save/update dialog may offer **“Keep small model preview snapshots with this version.”**
   - Default: off. Live local previews still appear without making copies.
   - When enabled, save at most one small static thumbnail per supported model reference.
   - Store assets outside the JSON in the recipe user-data directory. JSON stores only a contained `asset_id` and safe metadata.
   - Snapshot precedence in the UI is: frozen snapshot → current local preview → category placeholder.

This gives everyday visual browsing without storage duplication while allowing deliberate historical preservation.

### 4.2 Snapshot limits

- Static WebP preferred; JPEG/PNG fallback when conversion is not safe.
- Longest edge: 320 px.
- Target maximum: 96 KiB per image.
- Maximum 12 snapshots per recipe version and 1.25 MiB total newly written assets per update.
- Never copy an original full-resolution cover into recipe assets.
- Never copy video files. A live video preview may render using existing muted/paused rules; snapshot mode uses an existing static poster when available, otherwise a category placeholder.
- Never read an arbitrary browser-supplied filesystem path. The backend must resolve the model and preview inside configured model roots.
- Snapshot creation happens only during explicit save/update and runs off the aiohttp event loop.

### 4.3 Asset layout and lifecycle

Suggested local layout:

```text
ComfyUI/user/default/workflows/anomalous_recipes/
  recipe_<id>.json
  .assets/
    <recipe-stem>/
      <content-id>.webp
  .history/
    <recipe-stem>/
      version_<timestamp>_<id>.json
```

- Asset IDs are opaque contained filenames, preferably content-addressed from the generated thumbnail bytes.
- Snapshot assets are immutable. A new visual produces a new asset ID so old history does not silently change.
- Current and historical records may share the same asset ID.
- Deleting a recipe removes its contained asset directory after the recipe JSON is successfully removed.
- Pruning one historical JSON must not immediately delete shared assets. Garbage collection, if added, scans only that recipe’s bounded history and asset directory.
- Export remains a separate future format. The user explicitly chooses whether covers, model preview snapshots, and identity hashes are included.

## 5. Identity and availability remain separate

### 5.1 Evidence types

| Item | Meaning | Display |
| --- | --- | --- |
| Workflow fingerprint | Whether the complete serialized graph changed. | Short prefix; full value copyable. |
| Model SHA-256 | Cryptographic identity of the physical model file. | Verified badge only with genuine provenance. |
| Saved value/path | Human-readable loader selection. | Always visible, never identity proof. |
| Preview/snapshot | Visual recognition only. | Never used for matching or repair. |
| Current availability | Whether the exact reference resolves on this machine now. | Separate live status, never overwrites saved provenance. |

### 5.2 Status vocabulary

- **Verified identity** — a plugin-carried or cached SHA-256 exists, optionally with exact byte size and model category.
- **Known locally, identity unverified** — the exact local model is available but no valid hash provenance exists.
- **Unavailable** — the exact model cannot be resolved, the loader is unsupported, or saved metadata is absent.
- **Not applicable** — ordinary prompts, sampler controls, primitive values, and non-model widgets.

Names, paths, fuzzy matches, previews, and preview hashes must never become model identity evidence.

## 6. Revised detail-panel information architecture

```text
Workspace
  ├─ Prompt Notes
  └─ Workflow Recipes
       ├─ compact recipe cards
       └─ View details
            ├─ header: Back / recipe name / status / Edit / Load
            ├─ Overview
            ├─ Models & reproducibility
            ├─ Parameters
            └─ Versions
```

### 6.1 Overview

- Recipe cover, name, tags, notes, created/updated time.
- Primary checkpoint/UNET and LoRA summary.
- First positive prompt excerpt, primary sampling values, latent resolution, pinned parameters.
- Reproducibility summary: verified, unverified, unavailable, and missing-node counts.
- Actions: edit metadata, load to canvas, copy prompt, copy workflow fingerprint.
- Do not place every model preview here; keep Overview calm and use the Models tab for visual inventory.

### 6.2 Models & reproducibility

Each supported model reference is a visual row/card:

```text
[72–96px preview]  node title · node type              [identity badge]
                   category · base model
                   saved value/path
                   SHA-256 prefix · byte size          [copy]
                   saved provenance | current availability
```

- Preview area uses frozen snapshot first, then current local preview.
- A small label distinguishes **Saved snapshot** from **Current local preview**.
- Live preview resolution is manual or begins only when this tab is opened; it never runs while merely listing recipe cards.
- “Check current local availability” performs one bounded exact-reference request and updates transient UI state only.
- Known adapters begin with checkpoint, UNET/diffusion model, LoRA, VAE, CLIP/text encoder, CLIP vision, and ControlNet.
- Arbitrary third-party string widgets remain Parameters until an explicit adapter defines category, widget positions, and safe folder-type boundaries.

### 6.3 Parameters

- Pinned parameters first.
- Nodes grouped by title/type with safe primitive widgets.
- Search by node title, node type, widget name, or displayed primitive value.
- Complex values and sensitive-looking widgets remain opaque but stay in the authoritative workflow.
- Editing reuses the existing safe edit flow; the detail renderer does not mutate LiteGraph or instantiate a saved graph.
- Later diff mode compares changed widget values, prompts, model references, and workflow fingerprints.

### 6.4 Versions

- Timeline contains save time, optional note, fingerprint prefix, concise change summary, and restore.
- Restore first archives the current recipe as a new historical snapshot.
- A version records the asset IDs it used. Historical preview snapshots remain immutable.
- Preview-only changes do not alter the workflow fingerprint; they may appear in the version change summary as presentation changes.

## 7. Data model

Schema v3 remains the baseline for workflow fingerprint and model identity. Frozen model preview assets are an additive schema-v4 proposal.

```text
recipe
  schema_version: 4
  workflow: { ... authoritative ComfyUI graph ... }
  workflow_fingerprint:
    algorithm: "sha256"
    value: "..."
  presentation:
    cover: { ... existing cover/source data ... }
    save_model_preview_snapshots: false
  params:
    ... semantic and generic summaries ...
    model_references: [
      {
        reference_key,
        node_id, node_type, node_title,
        widget_index, widget_name, saved_value,
        category, base_model,
        identity: {
          status: "verified" | "unverified" | "unavailable",
          sha256, size, provenance
        },
        preview: {
          snapshot_asset_id,
          media_type,
          width, height,
          source_signature,
          captured_at
        }
      }
    ]
```

Rules:

- `workflow_fingerprint` hashes canonical `workflow` JSON only. Names, notes, tags, covers, previews, thumbnails, and local availability do not affect it.
- `reference_key` is a stable recipe-local key derived from node ID, widget index, category, and saved value; it is bookkeeping, not identity.
- `source_signature` is cache invalidation metadata for the preview source and must never be displayed as a model hash.
- Missing `preview` means “use current local preview if available,” not an error.
- Old recipes remain readable. Opening them does not write or scan. The next explicit update may write the newest schema.

## 8. API boundaries

Existing lightweight/full split remains:

- `GET /anomalous/recipes` — card metadata only; no graph and no per-model preview resolution.
- `GET /anomalous/recipe_full?filename=...` — full recipe after “View details.”
- `POST /anomalous/refresh_recipe_identity` — bounded exact-reference availability/identity refresh; no recursive scan and no full-file hashing.

Preview direction:

- Prefer extending the existing batch preview resolver with an explicit `exact_only: true` mode and required `folder_types` per reference.
- If that would weaken the general endpoint contract, add `POST /anomalous/resolve_recipe_previews` with a hard request limit.
- Snapshot creation should be part of save/update orchestration, not recipe browsing. It receives normalized model references, resolves contained previews server-side, writes bounded recipe assets, and returns safe asset IDs.
- Recipe asset serving accepts only a validated recipe filename plus an allowlisted contained asset ID and media extension.

No endpoint may accept an arbitrary absolute preview path, recursively scan all model folders during detail opening, or compute a large model hash.

## 9. Module ownership

```text
api/
  recipes.py                  # recipe persistence, history, schema migration, fingerprint
  recipe_identity.py          # optional exact model metadata/identity adapters
  recipe_assets.py            # optional contained snapshot generation/serving/lifecycle

web/modules/
  recipe_parser.js            # read-only semantic and safe-widget extraction
  recipe_identity.js          # pure model-reference and status normalization
  ui_recipes.js               # list, save/edit flows, small action wiring
  ui_recipe_detail.js         # detail DOM, tabs, preview rendering, diff UI
  ui_notebooks.js             # Prompt Notes implementation; legacy internal name retained
  locales.js                  # Workspace/Prompt Notes/Recipe strings
```

Boundaries:

- `recipe_parser.js` never mutates the live graph.
- Saved graphs are inspected as data; they are never instantiated for display.
- Preview presentation never participates in Model Doctor identity matching.
- Recipe assets remain under the user recipe directory, never in the extension repository or beside model files.
- All recipe CSS classes use the `anomalous-` prefix and all user-facing text lives in `locales.js`.

## 10. Delivery order for the next implementation round

1. **Workspace rename** — change visible labels and accessibility text only; retain legacy internal/API names.
2. **Live model previews** — show exact-reference current previews in the Models tab, with static/video handling and placeholders.
3. **Preview source labels** — clearly distinguish current local preview from frozen snapshot.
4. **Optional snapshot assets** — schema v4, bounded asset storage, cleanup, and save-dialog option.
5. **Version-aware previews** — historical asset references and presentation change summaries.
6. **Diff completion** — compare safe parameters, prompts, model references, fingerprints, and presentation changes.

Each step should be independently reviewable and preserve useful compact recipe cards.

## 11. Acceptance criteria

- The top-level navigation says Workspace / 创作工作台; the two tabs remain clearly distinct.
- Opening the card grid performs no full recipe fetch and no model preview lookup.
- Opening Models & reproducibility shows a preview or deterministic placeholder for each supported reference.
- Exact preview lookup does not recurse through model libraries.
- Preview/snapshot state is visibly separate from identity and current availability.
- No preview, filename, or path can produce a Verified identity badge.
- Snapshot mode stays within count, dimension, byte, type, and containment limits.
- Deleting a recipe cleans its contained assets without touching model previews or model sidecars.
- Historical workflow fingerprints do not change because a cover or preview changed.
- Old schema-v1/v2/v3 recipes open without migration writes.
- Mobile/narrow layouts retain one vertical scroll owner.

## 12. Mandatory change protocol

For every future product-code change in this plugin:

1. Keep the change coherent and run the relevant checks.
2. Update `.agents/logs/ai_changelog.md` with the implementation summary, decision record, checks run, and handoff notes.
3. Update `ARCHITECTURE.md` in the same change so file ownership, data flow, API contracts, and non-negotiable rules remain accurate. If no boundary changes, record that the existing boundary remains unchanged rather than inventing a new abstraction.
4. Create a local Git commit as the code snapshot after verification. Do not accumulate unrelated code changes in one snapshot and do not push unless the user explicitly asks.
5. Leave the worktree clean for the next agent, or clearly document any intentional uncommitted files.

`CHANGELOG.md` is reserved for concise user-facing release notes. It must not contain agent handoff, internal design decisions, implementation detail, or test output. Documentation-only design work may use its own commit, but it must not claim that proposed runtime behavior already exists.
