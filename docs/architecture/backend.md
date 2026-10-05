# Backend Architecture

Read this document for changes to `api/`, `scraper.py`, model files and sidecars,
recipe persistence, or filesystem-facing routes.

## Runtime and route boundary

`__init__.py` exposes the frontend directory and imports the modular route
package. `api/__init__.py` registers `aiohttp` routes, all prefixed with
`/anomalous/`. Changes to Python modules require a full ComfyUI restart; a
frontend reload alone does not replace registered handlers or module state.
Route registration uses explicit module references. `tests/test_route_manifest.py`
locks the HTTP method/path pairs so internal ownership changes cannot silently
drop, duplicate, or rename an endpoint.

The backend owns filesystem authority. A browser-supplied path, filename,
category, output reference, recipe asset, or archive member is untrusted until
validated. Use the shared helpers in `api/path_utils.py` (also re-exported by the
small `api/utils.py` compatibility facade):

- `resolve_folder_subdir()` for configured model-folder boundaries;
- `resolve_within()` for containment below an owned root;
- `require_filename()` for single-file identifiers.

Never rely only on `..` rejection. Absolute Windows paths, UNC paths, alternate
separators, device paths, and symlinks can bypass naïve string checks. Media
routes also enforce an explicit extension allowlist.

Configured model scope belongs to `api.folder_types`. Category mode uses
`get_active_folder_types()`; folder-manager-facing library enumeration uses
`get_active_model_roots()` so physical mode can retain the exact registered
`type`, `path_idx`, and real root for every enabled directory. Real roots are
deduplicated without merging same-named files from different roots. Do not
hardcode a walk across `checkpoints`, `loras`, or another category. A directory
disabled in `config.json` must cause no walk or metadata I/O.

`/anomalous/all_scan_models` follows that current folder-manager mode and keeps
its paginated response plus `limit=0` full-list behavior. Its local source-link
inventory recognizes GGUF and PTH case-insensitively in addition to the existing
list formats. This route-level inventory does not expand global model-format,
scanner, metadata-parser, recovery, or cloud-identification support.

## Storage ownership

Runtime UI settings and newly stored API keys live in `api/config.json`.
`scraper.py` reads it first and may fall back to the legacy root `config.json`.
Secrets are never persisted to browser `localStorage`.

Workflow Recipes live below the active ComfyUI user directory in
`workflows/anomalous_recipes`; Parameter Notebooks live in
`workflows/anomalous_parameters`. They are user data, not repository assets.
Writes validate their bounded schema and use atomic replacement.

Backend modules follow route/domain/storage ownership. Model discovery,
identity recovery, metadata mutation, and cover media live in
`model_catalog.py`, `model_resolution.py`, `model_metadata.py`, and
`model_media.py`. Recipe graph rules, recipe shaping, image processing, and
persistence/history live in `workflow_schema.py`, `recipe_schema.py`,
`recipe_images.py`, and `recipe_store.py`; `recipes.py` is the HTTP facade.
Material shaping, private assets, and the single persistence lock/summary cache
live in `material_schema.py`, `material_assets.py`, and `material_store.py`;
`materials.py` owns request/response mapping and compatibility entry points;
`node_material.py` saves one canvas node's values as a `node_parameter_selection`
material (deduplicated by node type and values like other parameter materials).

The former mixed utility routes are separated: `media_routes.py` owns card
thumbnails and model/output media lookups, `gallery_routes.py` owns the bounded
output snapshot and deletion (searched through `image_search.py`, which reads
PNG text chunks only and caches per-image records by mtime), `translation_routes.py`
owns provider fallback, `folder_types.py` owns configured visibility and scan scope, and `audio_catalog.py`
owns generated audio: the output-audio history, temp Preview Audio results and
their copy into `output/audio/`, deletion, and streaming from the output and temp
folders only. Character voices are the Anomalous_TTS node's data and never pass
through this plugin's backend.

`version_manager.py` runs git against the plugin checkout only (no shell, no
prompts, `CREATE_NO_WINDOW` on Windows) and accepts only tags that appear in the
published release list. It refuses switches while tracked files are modified,
never rewrites a local branch that has diverged from the remote, and reports
stable error codes (`dirty`, `diverged`, `offline`, `unknown_tag`, ...) that the UI
localizes. Switching changes code only; a ComfyUI restart applies it.

Offline inference sidecars use non-positive Civitai IDs as sentinels. Metadata
normalization must not expose those values as release-page URLs or resolved
model/version identities; only positive IDs may form a Civitai source link.

Combos (搭配, formerly Prompt Notes) use `workflows/anomalous_notebooks`. First access copies legacy
`api/notebooks` records without deleting originals or overwriting current notes.
Conflicts receive a deterministic recovered filename. A completion marker makes
the copy retryable after write failure and prevents deleted notes reappearing.
Invalid legacy records remain untouched and are listed in the migration marker.
Notebook I/O runs in a worker under its persistence lock; the UI queues snapshots
and reports failed saves instead of showing success. `api.path_utils.atomic_write_json`
owns bounded, flushed temporary writes followed by atomic file replacement.

The recipe card endpoint returns lightweight metadata. Full graphs and history
are fetched only for detail, edit, compare, restore, export, or another operation
that needs them. Successful save, update, and restore responses include a compact
integrity receipt containing graph counts and the persisted workflow fingerprint.

Package import is inspect-then-commit. `recipe_packages.py` accepts only bounded
ZIP packages with a manifest, recipe JSON, declared contained WebP assets, and
optional bounded history. It rejects traversal, symlinks, undeclared members,
archive bombs, and checksum failures; stages all content before the final rename;
and restores the previous recipe set if replacement commit fails. Packages never
install code or dependencies.

## Event-loop and scan-state rules

Potentially large disk work does not run on the `aiohttp` event loop. Recursive
walks, bulk metadata parsing, full-file hashing, and similar operations use
`asyncio.to_thread()` or the established worker process/thread path. Reading a
small bounded safetensors header is acceptable; reading a whole multi-gigabyte
model to discover metadata is not.

Background work claims state before launching. Folder scans use
`.scan_in_progress`; global scans use `.global_scan_in_progress`.
Marker files are versioned JSON records containing backend session, owner PID,
worker PID, and job ID. Status checks validate ownership and process liveness;
file existence alone is not proof that a scan is active.

A marker owned by a dead process, or a legacy plain-text marker, represents an
interrupted job. Its marker, progress file, and pending selection may be removed
so a restart does not permanently lock scanning. A still-running orphan worker
remains locked until that recorded process exits.

`scraper.py --progress-file` atomically publishes enumeration state, selected
file count, current index, and filename. Status responses merge worker progress
with parent-owned folder progress. The frontend can reconstruct this state by
polling after its UI has been reopened.

`scraper.py --report-file` appends one JSON line per model it changed (`matched`,
`inferred` with its reason, `failed` with the error, renames and covers) and events
(`civitai_down`, `done` with the unchanged count). One model's error is reported and
the scan goes on. `ScanJob` in `api/scan_report.py` reads each folder's report when its
worker exits and, before the scan's marker is released, writes the scan's result to
`user/anomalous/last_scan.json` and the activity log, so whoever sees the scan end can
read its result. The scan page's picked or listed models go to `/anomalous/scan_all` as
`targets` (`--targets-file` per folder), so one scan has one result.

An unmatched model's `.info` (`id` -1) keeps why: `anomalous_unmatched_reason` is
`not_found` (Civitai answered 404), `network` (no answer after the retries) or
`offline`. Online scans look up `network` and `offline` models again; `not_found` ones
wait for "look up again". After `CIVITAI_DOWN_AFTER` models in a row without an answer
a scan stops asking (`--civitai-down` carries this to the next folders) and infers the
rest from the files, instead of waiting for every timeout.

## MCP endpoint

`POST /anomalous/mcp` (`api/mcp_server.py`) answers one JSON-RPC message per POST with
one JSON object; GET and DELETE get 405, and nothing is sent unasked. A request whose
`params._meta` carries `io.modelcontextprotocol/protocolVersion` is served as 2026-07-28:
the `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`) `Mcp-Name` headers must
match the body, or 400 with -32020; an unknown version gets 400 with -32022 and the
supported list. `initialize` selects the legacy shape (2025-03-26 to 2025-11-25); no
session id is minted, so both eras are stateless. Unknown methods are -32601 (404 for
modern requests).

The peer must be loopback with no proxy header (`Forwarded`, `X-Forwarded-*`,
`X-Real-IP`), and the Host and any Origin must name a loopback host; anything else is
403. ComfyUI's own origin middleware also applies.

Tools (`api/mcp_tools.py`) only read and run in worker threads, four at a time. Model ids
are `type:path_idx:relative/path` and images are paths under the output folder; both are
resolved with `resolve_folder_subdir` / `resolve_within`, so an id cannot leave its root.
A tool's own failure (bad id, missing file, unexpected error) is a result with
`isError: true`, not a protocol error. Pictures attached on request are the gallery's
512 px thumbnails (at most 1.5 MB).

Acting tools (`api/mcp_actions.py`) never delete or rename files. Canvas actions go
through `mcp_bridge.ask_page`: it sends `{id, action, args}` as the `anomalous.mcp`
websocket event to every open page and waits (30 s, 90 s for model checks; at most 20
waiting). The first page to POST `{id, claim: true}` to `/anomalous/mcp/bridge` gets it
(hidden tabs wait 1.5 s so a visible one wins) and posts `{id, outcome}` back. No page,
no answer in time, or the page's refusal becomes a tool error. Scans and speech call this
server's own `/anomalous/scan_all`, `/anomalous_tts/characters`, `/prompt` and
`/history` over loopback, so they run exactly as from the UI (speech waits up to two
minutes for the file). Canvas changes are posted to the activity log with `via: "mcp"`.

## Metadata and cache behavior

The output gallery keeps one ordered directory snapshot for at most ten seconds
and 50,000 images. Page requests reuse it; explicit refresh and image deletion
invalidate it immediately. Larger inventories are returned normally but not cached.

Metadata and embedded safetensors-header hashes may be cached only in a bounded
cache. The key includes the model's real path and the physical `size`, `mtime_ns`,
and `ctime_ns` signatures of the model and relevant sidecars. Return independent
copies; never expose cached mutable dictionaries or lists.

Folder listing inventories a directory once with `os.scandir()` and preserves
preview priority: `.preview.*` before bare same-stem media. Avoid an `exists()`
sequence for every candidate when the directory inventory already has the
answer.

Preview URLs use the selected preview file's stable nanosecond modification time
as the cache version. Do not append `Date.now()` or random request tokens during
ordinary listing. A changed file must change its URL; an unchanged file should
remain browser-cacheable.

Preview lookup tries a contained exact relative path first and recursively walks
the library only for unresolved basename fallbacks. This locates presentation
for a model value already supplied by ComfyUI; it is not Model Check discovery.

Balanced grid thumbnails are derived, longest-edge 512 px WebP files in
`<user folder>/anomalous/cache/card_thumbnails` (not ComfyUI's temp folder, which
ComfyUI empties on every start). The cache is keyed by source real path and
physical signature and capped at 256 MiB with oldest-accessed eviction; the
settings page reads its size (`GET /anomalous/card_cache`) and empties it
(`POST /anomalous/card_cache/clear`). A video cover's card image is its first frame
(`variant=poster`, decoded with PyAV, which ComfyUI ships); the card shows it until
the video plays. Listing a model type queues the covers without a card image for one
background thread, one decode at a time, at most 512 waiting. The original mode
serves source covers, and detail views always use originals. Derived media never
modifies or sits beside a user's cover; unsupported, animated, or failed inputs
fall back to the original (a video without a readable frame has no poster).

## Model sidecar and cover lifecycle

Sidecar handling is non-negotiable because it can destroy user metadata or
media.

- `.civitai_bak.*` is a persistent restore source created from a real Civitai
  download. Setting a custom cover changes only `.preview.*`.
- Cover reset first restores `.civitai_bak.*` to `.preview.*`. Otherwise it may
  remove `.preview.*` only when a bare original cover can take over. If the
  preview is the only image, preserve it and return a visible warning. Reset
  never silently downloads from the network.
- Physical rename moves every recognized sidecar to the new model stem. Model
  deletion may clean sidecars only after the main model is successfully deleted.
- Foundation components—`vae`, `vae_approx`, `clip`, `text_encoders`, and
  `clip_vision`—are never physical-rename targets. UI and all backend entry
  points enforce the same denial.
- Model files are `MODEL_EXTENSIONS` in `api/model_constants.py` (`.safetensors`,
  `.ckpt`, `.pt`, `.pth`, `.bin`, `.sft`, `.gguf`); listing, counting, search and
  lookups test names with `is_model_file()`, without case. They are never
  sidecar suffixes. Cleanup must not delete a same-stem model with another
  extension. If such a sibling remains, ambiguous stem-keyed sidecars remain.
- Rename/delete/reset uses centralized immutable suffix tuples and a constant
  number of exact-path checks. Do not walk, glob, index, hash, or call the
  network for these operations.

Keep product wording precise: deletion cleans sidecars; rename migrates them.

## Backend implementation rules

- Prefer standard-library and existing ComfyUI facilities; missing optional
  dependencies must fail as a localized capability, not break plugin import.
- Use `os.path`, `pathlib`, `os.sep`, or normalization helpers for paths. Avoid
  hand-written backslash replacement.
- Update an existing `.civitai.info` dictionary rather than overwriting it with
  a one-field object.
- Large input collections use a JSON `POST` body. Do not place them in a query
  string or pass them as command-line arguments on Windows.
- The private local `tests/` directory is ignored and is not imported by runtime
  code or shipped in the installable plugin.
