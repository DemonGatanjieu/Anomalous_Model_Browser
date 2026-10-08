# Backend Architecture

Read this document for changes to `api/`, `scraper.py`, model files and sidecars,
recipe persistence, or filesystem-facing routes.

## Runtime and route boundary

`__init__.py` exposes the frontend directory and imports the modular route
package. `api/__init__.py` registers `aiohttp` routes, all prefixed with
`/anomalous/`. Changes to Python modules require a full ComfyUI restart; a
frontend reload alone does not replace registered handlers or module state.
Route registration uses explicit module references, so moving a handler between
modules cannot silently drop, duplicate, or rename an endpoint.

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
server's own `/anomalous/scan_all`, `/anomalous/download/status`, `/anomalous_tts/characters`, `/prompt` and
`/history` over loopback, so they run exactly as from the UI (speech waits up to two
minutes for the file). Downloads go through the page (`model_download.js` downloadMissing /
downloadFrom), so the placement rules and the put-in after a download are the UI's own. Canvas changes are posted to the activity log with `via: "mcp"`.

## Backups

`api/backup.py` packs the user's data into one .zip (`POST /anomalous/backup/export`, then
`GET /anomalous/backup/file`) in the temp folder (the newest three are kept): the stores
under `stores/<part>/` (recipes, combos, materials, parameters, and `comfy_workflows` =
`user/default/workflows` when chosen; the notebooks' legacy-migration marker stays out),
`settings/config.json` without `CIVITAI_API_KEY` plus `download_settings.json`, and for each
model with a user layer or a user cover `models/<id>/user.json` and `cover<suffix>` (and,
unless left out, its scan file `scan<.info|.civitai.info>`; Civitai's cover only when asked,
stored once as `civitai<.civitai_bak suffix>`), listed
in `manifest.json` with type, relative path, size and SHA-256 (from its sidecars; none is
computed). The manifest's `library` lists every model the same way plus its download page;
inspecting a backup returns the ones this computer lacks, which the frontend looks up and
downloads with the model download routes (into the same folder and path). A cover is the user's when it is not byte-identical to `<model>.civitai_bak.*`,
as in the scanner.

`POST /anomalous/backup/inspect` receives the .zip into the temp folder, refuses anything
that is not this plugin's backup, too large, or has an unsafe member path, and reports per
store how many files are new, the same or different, and how many models it finds here.
`POST /anomalous/backup/apply` then writes only the chosen parts: new files are added, the
same skipped, different ones replaced only with `replace` (the file here goes to the
Recycle Bin first). Models are found by SHA-256, else by models folder, path and equal
size. A scan file is written where the model has none (replaced only with `replace`);
Civitai's cover where it has no cover at all, with its `civitai_bak` copy so it stays
Civitai's. Their user layer is merged field by field (empty fields filled; `replace` takes the
backup's, the old file to the Recycle Bin); the backup's cover replaces a Civitai cover
(whose `civitai_bak` copy stays) but not another user cover unless `replace`. Settings
are written only when chosen, keeping this computer's Civitai key. Export and import are
activity entries (`backup_export`, `backup_import`).

## Model downloads

`api/model_download.py` serves Model Check's downloads. `POST /anomalous/download/lookup`
asks `api/download_sources.py` where each missing model comes from: Civitai by the
workflow's hash (the version's file with that SHA-256 or AutoV2), else a link the
workflow carries — a Civitai link naming a model version (the file of that name, else
its primary file), a Hugging Face or hf-mirror file link (size and SHA-256 from the
site's headers), a GitHub release asset or raw file — else ComfyUI-Manager's model list
(`api/manager_catalog.py`, the installed Manager's `model-list.json`, entries of the same
file name fitting the node's folder type). With the workflow's hash only a list entry
whose file has that SHA-256 counts (several of one name are each asked); without one,
a single entry of that name is offered marked `by_name`, never in "Download all" or
the MCP's download_missing_models. A link whose file has another SHA-256 than the
workflow's hash is refused (`different_file`). A site that stops answering is skipped
for the rest of the lookup (`down`), the others are still asked, so Civitai failing in
mainland China does not stop Hugging Face through its mirror. It also returns each type's model folders with free
space and subfolders (two levels).

`POST /anomalous/download/start` takes the source, type, root index and a relative path
and refuses: a non-https link or one off Civitai, Hugging Face, hf-mirror or GitHub; a
path leaving the root (`resolve_within`) or not ending in a model extension; a file that
exists; not enough space. Jobs run one at a time in a worker thread into
`<file>.part`; a new start for the same file continues it with a Range request. The
Civitai key is sent to Civitai only, as an unredirected header, so it never reaches the
file storage the download redirects to. An HTML answer (a login page) fails as
`not_a_file`, 401/403 as `needs_key` or `forbidden`. The finished file must match the
source's SHA-256 (else the workflow's hash) or it is removed as `hash_mismatch`; then it
is renamed into place, ComfyUI's file-list caches are cleared and the activity log gets
a `model_download` entry. A file from Hugging Face first gets its repository's model card
(`api/hf_card.py`, `/api/models/<repo>` on the same host): the first example image (else
the repository's first picture) as `<model>.preview.<ext>` when the model has no cover, and
its base model, trigger words (`instance_prompt`) and example prompts as notes plus the
repository as link in the user layer, only where those are empty. `GET /anomalous/download/status` lists the jobs of this run,
`POST /anomalous/download/cancel` stops one (its `.part` goes). The default place is
`user/anomalous/download_settings.json` (`{place: workflow | folder, folder, hf_mirror}`).
With `hf_mirror` (the lookup's flag; the page sends the setting, or for a Chinese interface
true while it is unset) Hugging Face files are looked up and fetched on hf-mirror.com, and
without it on huggingface.co, whichever host the link names. The mirror sends networks
outside China back to huggingface.co; the lookup follows such a redirect once for the size
and SHA-256.

## Model import

`api/model_import.py` takes model files the user drops on the models page. A browser gives a
dropped file's name, size, time and bytes but never its path, so `POST
/anomalous/import/inspect` gets the name, size and time with the file's header bytes, and,
asked from this computer (`mcp_server._is_local`), looks for the same file (name, size, time
within 2 s) in the Downloads and Desktop known folders and two subfolder levels below. A
found file gets an in-memory token; the client never sends a path. What the file is comes
from `model_kind.py`: the safetensors header's tensor names, shapes and kohya/modelspec
metadata, or a GGUF's `general.architecture` and tensor names; `.ckpt/.pt/.pth/.bin` are never
opened (the user picks the type). Types without a folder in this ComfyUI are not offered.
Files of the same name already in that type's folders are listed. `POST
/anomalous/import/identify` hashes a found file in a thread and asks Civitai by SHA-256 (base
model, model and version name) and the scanned-model hash index for an identical copy.

`POST /anomalous/import/place` (local only) moves the found file into `{type, root, rel}`:
a rename on the same drive, else a copy through `<dest>.part` checked by size, then the
original is removed (or kept with `keep`). `PUT /anomalous/import/upload` streams the request
body (not limited by ComfyUI's upload size) into `<dest>.part` and renames it when the size
matches. Both check the destination like downloads (`resolve_within`, model extension, free
space) and never replace a file: a taken name becomes `name (2).ext`. A failed copy or
upload removes only its own `.part`. Each import clears the file-list caches and adds a
`model_import` activity entry; the page then scans the new files. The destination the page
proposes follows the download settings' folder (`{base}` = the base model's folder).

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
- `tests/` holds the plugin's tests (how to run them: `docs/guides/testing.md`,
  `tools/run_tests.mjs`). Runtime code never imports it.
