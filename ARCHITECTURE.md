# Anomalous Model Browser Architecture

This is the short entry point for maintainers and AI agents. It describes the
system map, ownership boundaries, and rules that apply across subsystems. Read
only the linked topic document relevant to the task; do not load every document
by default.

## Reading map

| When changing... | Read... |
| --- | --- |
| Python routes, storage, paths, metadata, covers, or scan state | [`docs/architecture/backend.md`](docs/architecture/backend.md) |
| Browser lifecycle, UI state, localization, media, or graph edits | [`docs/architecture/frontend.md`](docs/architecture/frontend.md) |
| Workflow Recipes, packages, galleries, Parameter Notebooks, or prompt roles | [`docs/architecture/recipes.md`](docs/architecture/recipes.md) |
| Model Doctor, provenance hashes, missing-model recovery, or deep scanning | [`docs/architecture/model-resolution.md`](docs/architecture/model-resolution.md) |
| Why a current product boundary exists | [`docs/decisions/README.md`](docs/decisions/README.md) |
| Recurring implementation mistakes and post-mortems | [`.agents/logs/ai_lessons.md`](.agents/logs/ai_lessons.md) |

`README.md` is user-facing documentation and `CHANGELOG.md` is user-facing
release history. Neither is the source of truth for internal architecture.

## System shape

Anomalous Model Browser is a UI-only ComfyUI extension. It registers no custom
nodes (`NODE_CLASS_MAPPINGS` is empty). ComfyUI loads the Vanilla JavaScript/CSS
frontend from `web/`; the Python package registers `/anomalous/` `aiohttp`
routes and performs local filesystem, metadata, recipe, and scan operations.

```text
ComfyUI frontend
  web/main.js
    -> web/modules/*                 UI, graph integration, localization
    -> /anomalous/*                 JSON and bounded media requests

ComfyUI Python server
  __init__.py
    -> api/__init__.py               route registration
    -> api/*.py                      storage and domain operations
    -> scraper.py                    explicit metadata/hash enrichment

User-owned data
  ComfyUI model folders              models and sidecars
  user/.../anomalous_recipes         workflow recipes and recipe assets
  user/.../anomalous_parameters      immutable parameter snapshots
```

The frontend and backend communicate through narrow JSON contracts. The
frontend must not infer filesystem authority, and the backend must not depend on
DOM or live LiteGraph state.

## Ownership map

### Backend

- `api/config.py` owns configured paths and active model-folder types.
- `api/utils.py` owns containment and filename validation helpers.
- `api/metadata.py` owns sidecar and safetensors metadata extraction.
- `api/models.py` owns model listing, media serving, and model-facing routes.
- `api/scanner.py` and `scraper.py` own scan orchestration and enrichment.
- `api/recipes.py` owns recipe validation, CRUD, history, and integrity receipts.
- `api/recipe_packages.py` owns bounded inspect-stage-commit package handling.
- `api/parameters.py` owns Parameter Notebook persistence and lookup.
- `model_policies.py` owns shared backend rename and protected-category policy.

### Frontend

- `web/main.js` is the extension entry and shared browser-instance owner.
- `web/modules/entry_controls.js` and `shortcut_controls.js` own entry modes and
  native command/keybinding integration.
- `ui_sidebar.js`, `ui_grid.js`, `ui_detail.js`, and `ui_gallery.js` own the
  primary model-browser surfaces.
- `ui_notebooks.js`, `ui_recipes.js`, and `ui_recipe_detail.js` own Workspace
  presentation.
- `recipe_parser.js`, `recipe_identity.js`, `recipe_diff.js`, and
  `recipe_actions.js` own pure or transactional recipe behavior.
- `ui_doctor.js`, `model_picker.js`, and `graph_splice.js` own assistant and
  explicit graph-edit behavior.
- `locales.js` is the canonical runtime string catalog; `safe_dom.js` is the
  trusted rich-text boundary.
- `hash_resolver.js` is optional workflow provenance integration. Failure there
  must not prevent the main browser from loading.

## Cross-system invariants

These rules are intentionally summarized here and specified in the linked topic
documents.

1. **Identity is provenance, not naming.** Model Doctor may use a cryptographic
   hash, exact byte size under the allowed category policy, and target category.
   Paths, filenames, display names, previews, and fuzzy similarity are never
   identity evidence.
2. **Filesystem input is untrusted.** Backend request paths must pass the shared
   containment and filename helpers. Checking only for `..` is insufficient on
   Windows and in the presence of alternate separators, UNC paths, or symlinks.
3. **User files are changed transactionally and conservatively.** Recipe writes,
   imports, graph mutations, and sidecar operations validate before mutation and
   either complete coherently or restore the prior state.
4. **The event loop stays responsive.** Recursive walks, hashing, metadata
   parsing, and other potentially large disk operations run off the aiohttp
   event loop. UI rendering and media loading are bounded and cancellable.
5. **Host state is preserved.** Browser panels are mutually exclusive,
   Workspace/model-detail transitions are recoverable, and graph edits use
   ComfyUI's change/callback contracts.
6. **Runtime strings are localized safely.** User-visible copy comes from
   `locales.js`; dynamic values stay outside dictionaries and enter the DOM as
   text. Only allowlisted rich content goes through `safe_dom.js`.
7. **Optional integrations fail locally.** Missing graph APIs, metadata, network
   availability, or an optional resolver may disable that capability but must
   not make the main extension disappear.
8. **Presentation data is not authority.** Covers, thumbnails, summaries,
   cached names, and workflow fingerprints never replace the authoritative
   serialized workflow or model provenance record.

## Data and compatibility boundaries

- Runtime settings and newly saved API keys live in `api/config.json`.
  `scraper.py` may read the legacy root `config.json` only as a compatibility
  fallback. API keys are not stored in browser `localStorage`.
- Recipes and Parameter Notebooks are user data outside the extension directory.
  They are never bundled with or silently migrated into the plugin source.
- The extension may integrate with Civitai and optional translation services
  only through explicit product behavior. External content and dependencies keep
  their own terms.
- Project code and documentation use the MIT license. `TRADEMARKS.md` separately
  defines the project-name and official-branding boundary.
- Internal property names and established routes may remain stable when a
  user-facing surface is renamed. Do not churn compatibility contracts merely
  to match presentation wording.

## Change and snapshot protocol

Every product-code change should end as one coherent local Git snapshot:

1. Run checks proportional to the changed behavior.
2. Update architecture documentation **only** when the change modifies a module
   owner, data flow, public/internal interface contract, persistence format,
   security boundary, or critical invariant.
3. When architecture changes, update the narrowest relevant topic document.
   Update this entry point only if the system map, cross-system invariants, or
   reading map changed.
4. Do not add an architecture entry merely to say that existing boundaries were
   unchanged. Ordinary fixes belong in code, tests, Git history, and—when useful
   to users—`CHANGELOG.md`.
5. Record a durable lesson in `.agents/logs/ai_lessons.md` only for a recurring
   trap or a critical failure mode, not as a turn-by-turn work log.
6. Create a local commit after verification. Keep unrelated work out of the
   snapshot and do not push without explicit user authorization.
7. Leave a clean worktree, or identify every intentional uncommitted file in the
   handoff.

Decision records explain enduring choices; they are not a chronological diary.
Git history is the authoritative record of implementation changes. Planning-only
documents must be clearly labeled as proposals and must not describe unshipped
behavior as current architecture.
