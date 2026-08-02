# Workflow Recipe Detail Panel — Product and Architecture Design

Status: planning handoff, updated from `recipe_improvements_proposal.md`. The current pre-release working snapshot contains the first recipe-detail foundation, Workspace rename, exact model previews, and opt-in schema-v4 snapshot support. These features are implementation-complete for this snapshot but are not a released version; later phases remain planned. This document describes the intended product and architecture, not release status.

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

The longer product loop is:

```text
find → inspect → reuse or run → compare → share
```

- **Find:** search and tag filters make a growing recipe library navigable.
- **Inspect:** the detail panel explains content, dependencies, previews, provenance, and versions.
- **Reuse:** a recipe can replace the canvas or append a reusable graph fragment.
- **Run:** an explicitly enabled, validated recipe can queue from pinned parameters without mutating the canvas.
- **Compare:** lightweight semantic diffs explain meaningful changes between versions.
- **Share:** a contained recipe package can move between machines without becoming an executable plugin bundle.

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
   - The save/update dialog should offer **“Keep small model preview snapshots with this version.”**
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
             ├─ header: Back / recipe name / status / Edit / Open in Canvas
             ├─ Overview
             ├─ Models & reproducibility
             ├─ Parameters
             └─ Versions
```

### 6.1 Overview

- Recipe cover, name, tags, notes, created/updated time.
- Primary checkpoint/UNET and LoRA summary.
- Separate positive and negative prompt panels, primary sampling values, latent resolution, and pinned parameters. Prompt/parameter text uses a compact collapsed view with explicit expand and copy controls; the detail view never silently truncates an available safe value.
- Reproducibility summary: verified, unverified, unavailable, and missing-node counts.
- Actions: edit metadata, open in canvas, append to canvas, copy prompt, copy workflow fingerprint.
- If Quick Queue is explicitly enabled and validation succeeds, Overview also exposes the pinned-parameter form and queue action. It must not be the default action for every imported or incomplete recipe.
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
- Selecting a version opens a lightweight comparison against the current version by default; a later enhancement may allow any two versions.
- Diff categories are pinned parameters, prompts, model references, workflow fingerprint, graph summary, and presentation metadata. The first release does not render a visual node/link diff.
- Version actions use **Restore This Version**. Canvas actions use **Open in Canvas**; the word “Restore” is reserved for history to avoid destructive ambiguity.

### 6.5 Recipe library controls

The recipe action bar owns discovery and transfer actions:

```text
[Search recipes…] [All tags ▾] [Clear]                 [Import] [Export]
```

- Search uses list metadata only: recipe name, notes, and tags. It must not fetch full workflows or resolve previews.
- Matching is case-insensitive and Unicode-normalized. Text terms use AND semantics; selected tags also use AND semantics in the first release.
- Tag badges on cards are interactive and apply/remove the same top-level filter state.
- Keep filter state in memory while the Workspace modal remains open. URL routing and persistent saved searches are out of scope.
- Export acts on the current recipe from the detail panel; bulk export can be considered later.

### 6.6 Canvas and execution actions

The three actions have deliberately different contracts:

| Action | Canvas effect | Queue effect | Primary safeguard |
| --- | --- | --- | --- |
| Open in Canvas | Replaces the current graph. | None. | Confirm when the current canvas is dirty. |
| Append to Canvas | Adds cloned nodes/links and preserves the current graph. | None. | Atomic ID remap and rollback on failure. |
| Quick Queue | Does not mutate the current canvas. | Queues one validated prompt. | Explicit enablement, fresh validation, and disabled reasons. |

#### Open in Canvas

- Use this label instead of the ambiguous **Load** or **Restore**.
- Replacing a dirty canvas requires a clear confirmation. A clean canvas does not need an extra prompt.
- Opening a recipe does not automatically queue it.

#### Append to Canvas

- Append operates on a deep clone of the saved workflow. It must never mutate the recipe JSON or reuse node IDs already present on the live canvas.
- Use a supported ComfyUI graph import/paste path where available. Do not emulate insertion by calling `loadGraphData` on the full canvas.
- Remap node IDs and links as one transaction, offset the inserted group into visible free space, select the inserted nodes, mark the canvas dirty, and create one undo step when the host API supports it.
- Validate links before committing. If any insertion stage fails, remove everything inserted by that transaction and leave the original canvas unchanged.
- A complete workflow may still be appended, but `recipe_kind: snippet` communicates intent and allows a more prominent Append action. Snippets may contain unresolved external inputs and therefore are not automatically Quick Queue eligible.

#### Quick Queue

- Pinned parameters become the small applet form. Only safe primitive controls already represented by stable node/widget references may be overridden.
- Apply edits to an ephemeral cloned workflow. Never write Quick Queue values back to the recipe or current canvas unless the user separately chooses Save/Update.
- Do not send the frontend-format `recipe.workflow` directly to `/prompt`. First use ComfyUI's supported workflow-to-prompt conversion/queue path, then validate the resulting API prompt.
- Validation must report missing nodes, missing models, invalid links, unsupported complex widgets, and output-node absence as user-readable disabled reasons.
- Revalidate immediately before queueing because local models and custom nodes may have changed since save time.
- The backend/host returns a normal prompt ID; the UI shows queue success or the exact bounded validation error. It must not silently fall back to opening or replacing the canvas.
- Imported recipes begin with Quick Queue disabled until the user reviews them and explicitly enables it. Import never installs custom nodes, downloads models, or executes embedded code.

## 7. Data model

Schema v3 is the committed baseline. The current working-tree draft targets schema v4 by retaining schema-v3 workflow fingerprints/model identity and adding optional preview-snapshot descriptors. Treat v4 as implemented only after Phase 0 verification and a coherent snapshot.

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

The five proposed experience upgrades do not justify an immediate schema bump by themselves. Search and diff derive from existing metadata; append can initially work for any saved graph; package format has its own version. Introduce schema v5 only when recipe intent or Quick Queue policy is persisted:

```text
recipe
  schema_version: 5
  recipe_kind: "workflow" | "snippet"
  launch:
    quick_queue_enabled: false
    exposed_parameter_keys: ["<stable pinned parameter key>"]
```

Rules for a future v5:

- Missing `recipe_kind` reads as `workflow`.
- `exposed_parameter_keys` references existing safe pinned-parameter records; it does not duplicate node values.
- `quick_queue_enabled` is user intent, not proof of executability. Runtime validation remains mandatory.
- Trust state for imported files is local state and must not be accepted from the package as authoritative.
- Do not write v5 until at least one v5 field is intentionally changed by the user.

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

Additional endpoint boundaries for the next phases:

- **Version diff:** fetch one bounded historical recipe by validated recipe/version identifiers, then compute the semantic diff either server-side or in a pure client module. Never expose arbitrary history paths.
- **Quick Queue:** prefer the host application's supported queue pipeline. If a plugin endpoint is required, it accepts a recipe identifier, safe pinned overrides, and an expected workflow fingerprint—not an arbitrary filesystem path or browser-supplied executable prompt. The server reloads the recipe, checks the fingerprint, validates overrides, and queues through the normal ComfyUI prompt contract.
- **Export:** stream one generated package from a validated recipe identifier and explicit inclusion options. Do not first materialize an unbounded archive under a public static directory.
- **Import inspect:** upload to a bounded temporary area, validate the archive and return a dry-run report without writing a recipe.
- **Import commit:** consume an inspection token plus the user's collision choice, revalidate, then atomically write the recipe and contained assets. Inspection tokens are short-lived and single-use.

### 8.1 Recipe package contract

Use a normal ZIP container with a recognizable filename such as `name.anomalous-recipe.zip`; do not rely on a custom extension as the only interoperability mechanism.

```text
manifest.json
recipe.json
assets/
  <allowlisted contained files>
history/                 # optional, off by default
  <bounded recipe JSON files>
```

`manifest.json` contains a package-format version, exporter/plugin version, recipe schema version, entry checksums, and declared optional sections. Package versioning is independent from recipe schema versioning.

Export defaults:

- Include current recipe JSON and its recipe cover.
- Include frozen model preview snapshots only when the user opts in.
- Exclude history by default because it increases size and may contain old prompts or notes.
- Present an explicit privacy summary for notes, prompts, paths, hashes, cover, previews, and history before download.
- Never include model files, model sidecars, arbitrary absolute paths, cache files, or plugin code.

Import safeguards:

- Reject absolute paths, `..`, drive prefixes, symlinks, duplicate normalized names, undeclared entries, encrypted archives, and unsupported compression methods.
- Enforce limits for upload bytes, entry count, per-entry bytes, total expanded bytes, compression ratio, image dimensions, history count, and JSON depth.
- Verify checksums, recipe schema, asset references, and MIME signatures before commit.
- Sanitize display filenames and generate a new local recipe identity on collision; offer rename, replace-with-backup, or cancel. Never silently overwrite.
- Re-encode imported presentation images before storing them. Do not trust file extensions or embedded metadata.
- Imported model paths and hashes remain provenance only. Import does not resolve, download, or install dependencies.
- Commit through staging plus atomic rename; on failure, remove staging data and preserve the existing library.

Initial hard limits should be named constants and covered by boundary tests: 32 MiB uploaded archive, 256 entries, 16 MiB per entry, 64 MiB total expanded data, 100:1 maximum compression ratio, 40 megapixels per image, 100 history records, and JSON nesting depth 64. Reject over-limit packages rather than partially importing them; adjust these defaults only from measured real packages.

## 9. Module ownership

```text
api/
  recipes.py                  # recipe persistence, history, schema migration, fingerprint
  recipe_identity.py          # optional exact model metadata/identity adapters
  # The current draft keeps snapshot generation, serving, and lifecycle in recipes.py
  # because they are recipe-owned persistence behavior rather than a shared asset system.
  recipe_packages.py          # add only when import/export lands; archive validation and staging

web/modules/
  recipe_parser.js            # read-only semantic and safe-widget extraction
  recipe_identity.js          # pure model-reference and status normalization
  recipe_diff.js              # pure bounded semantic comparison; no DOM or graph mutation
  recipe_actions.js           # add when append/quick-run logic would otherwise bloat UI modules
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
- Search/filtering consumes lightweight list records only and stays independent of graph parsing.
- `recipe_diff.js` receives normalized immutable data and returns display-neutral change records.
- Canvas insertion and Quick Queue orchestration do not live in render functions. UI modules request actions and render their result/disabled reason.
- Archive parsing, path containment, limits, staging, and atomic commit stay server-side.

## 10. Delivery plan for implementation handoff

Do not implement all five proposals in one change. Each phase must remain usable if later phases are postponed.

### Phase 0 — reconcile and stabilize the existing draft (P0)

- Inspect every current working-tree modification; preserve intentional work and separate unrelated changes.
- Verify rather than assume the Workspace labels, exact-only live preview lookup, schema-v4 snapshots, asset serving, deletion cleanup, and old-schema reads.
- Confirm that internal implementation notes live in `.agents/logs/ai_changelog.md`, while `CHANGELOG.md` contains only concise user-facing release notes for functionality that is actually ready to ship.
- Fix discovered regressions, update architecture/logs, run targeted checks, and create one coherent local Git snapshot before beginning a new feature phase.

Exit condition: the baseline is reviewable, accurately documented, and either committed cleanly or accompanied by an explicit list of intentionally uncommitted files.

### Phase 1 — find recipes (P1, low risk / high value)

- Add in-memory text search, clickable tag filtering, active-filter chips, clear action, empty state, and result count.
- Keep card-list payloads lightweight; add missing name/notes/tags metadata to the list endpoint only if required.
- Add keyboard focus behavior and localized accessible labels.

Exit condition: a large library can be narrowed without full recipe fetches, graph parsing, or preview resolution.

### Phase 2 — compare versions (P1, bounded scope)

- Introduce pure semantic normalization and diff records.
- Compare current vs selected history for pinned values, prompts, model references, graph counts/fingerprint, and presentation changes.
- Render Added / Removed / Changed / Unchanged sections with side-by-side, collapsible full-value viewers and copy affordances.
- Keep restore behavior separate and preserve the current recipe before restoring history.

Exit condition: users can explain the meaningful difference between the current recipe and one historical version without a visual graph diff.

### Phase 3 — append as a reusable snippet (P2, host-integration risk)

- Prototype against the installed ComfyUI graph APIs and document the supported insertion path before designing UI around it.
- Implement atomic clone, ID/link remap, placement, selection, dirty state, and undo integration.
- Add `recipe_kind` only if product testing shows that explicit snippet identity improves save and detail flows; do not bump schema just for the button.
- Start in the detail panel. Add a compact-card shortcut only after accidental-action and layout testing.

Exit condition: appending preserves the pre-existing graph, creates no ID/link corruption, and can be undone as one user action where host support exists.

### Phase 4 — recipe applet / Quick Queue (P2, execution risk)

- Build the pinned-parameter form from existing safe parameter descriptors.
- Determine and test the supported frontend-workflow → API-prompt conversion path in the installed ComfyUI version.
- Add explicit Quick Queue enablement, validation reasons, ephemeral overrides, stale-fingerprint protection, queue result feedback, and imported-recipe trust handling.
- Keep the action in Overview for the first release; do not place a one-click execution button on every card.

Exit condition: a validated complete recipe can queue with temporary pinned overrides while the current canvas and stored recipe remain byte-for-byte unchanged.

### Phase 5 — import/export recipe packages (P2, data-boundary risk)

- Implement export with privacy/include options and a versioned manifest.
- Implement inspect-then-commit import with archive limits, checksum/MIME validation, collision handling, staging, and atomic commit.
- Run compatibility tests across schema versions and packages with/without covers, snapshots, and history.
- Only after the format is stable, document it for community/tool interoperability.

Exit condition: a package can round-trip safely between clean installations without escaping recipe storage, overwriting silently, executing code, or bundling model files.

### Deferred ideas

- Arbitrary two-version selection after current-vs-history comparison proves useful.
- Visual graph/node/link diff.
- Bulk export, cloud/community gallery, package signing, and remote dependency download.
- Persistent saved searches and advanced OR/NOT query syntax.
- Automatic custom-node or model installation from an imported recipe.

## 11. Acceptance criteria

### Baseline detail and preview behavior

- The top-level navigation says Workspace / 创作工作台; Prompt Notes and Workflow Recipes remain clearly distinct.
- Opening the card grid performs no full recipe fetch and no model preview lookup.
- Opening Models & reproducibility shows a preview or deterministic placeholder for each supported reference.
- Exact preview lookup does not recurse through model libraries.
- Preview/snapshot state is visibly separate from identity and current availability; no preview, filename, or path can produce a Verified identity badge.
- Snapshot mode stays within count, dimension, byte, type, and containment limits.
- Deleting a recipe cleans its contained assets without touching model previews or model sidecars.
- Historical workflow fingerprints do not change because a cover or preview changed.
- Old schema-v1/v2/v3 recipes open without migration writes.
- Mobile/narrow layouts retain one vertical scroll owner.

### Search and tags

- Name, notes, and tags match case-insensitively with predictable AND semantics.
- Clicking a tag and clearing filters are keyboard accessible and update the same filter state.
- Search does not fetch workflow graphs, history, model identity, or previews.
- Empty and no-results states are different and explain the next action.

### Version diff

- Current-vs-selected comparison produces deterministic Added, Removed, and Changed records.
- Prompt, primitive parameter, model-reference, graph-summary, fingerprint, and presentation changes remain visibly distinct.
- Sensitive/complex values are not newly exposed by diff.
- Comparison does not mutate or instantiate either graph, and restoring still archives the current state first.

### Canvas actions

- Open in Canvas warns before replacing a dirty graph and never queues automatically.
- Append changes neither the stored recipe nor pre-existing nodes/links.
- Inserted IDs are collision-free, internal links target remapped IDs, placement is visible, and partial failures roll back.
- Unsupported host versions receive a disabled reason instead of a best-effort destructive fallback.

### Quick Queue

- Only allowlisted pinned primitive controls can be overridden.
- Validation blocks missing nodes/models, malformed links, unsupported values, absent outputs, stale fingerprints, and unreviewed imported recipes.
- Queueing uses a normal API-format prompt and returns a prompt ID or a bounded actionable error.
- The live canvas and recipe JSON remain unchanged on success and failure.

### Import/export

- Export contents match the selected privacy options and never contain models, plugin code, caches, or arbitrary external files.
- Malicious paths, links, archive bombs, malformed JSON/images, checksum failures, and unsupported versions are rejected before commit.
- Import preview reports metadata, optional content, compatibility warnings, and collisions without changing the library.
- Import commit is atomic, never silently overwrites, and cleans staging on failure.
- Export → import → export preserves authoritative workflow content and declared assets within documented canonicalization rules.

## 12. Mandatory change protocol

For every future product-code change in this plugin:

1. Keep the change coherent and run the relevant checks.
2. Update `.agents/logs/ai_changelog.md` with the implementation summary, decision record, checks run, and handoff notes.
3. Update `.agents/logs/ai_lessons.md` only when the work reveals a reusable failure mode, compatibility rule, or design lesson; routine progress does not need a forced lesson entry.
4. Update `ARCHITECTURE.md` in the same change so file ownership, data flow, API contracts, and non-negotiable rules remain accurate. If no boundary changes, record that the existing boundary remains unchanged rather than inventing a new abstraction.
5. Create a local Git commit as the code snapshot after verification. Do not accumulate unrelated code changes in one snapshot and do not push unless the user explicitly asks.
6. Leave the worktree clean for the next agent, or clearly document any intentional uncommitted files.

`CHANGELOG.md` is reserved for concise user-facing release notes. It must not contain agent handoff, internal design decisions, implementation detail, or test output. Documentation-only design work may use its own commit, but it must not claim that proposed runtime behavior already exists.
