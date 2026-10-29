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
- `require_filename()` for single-file identifiers (never `.` or `..`);
- `model_file_within()` / `model_reference_within()` for a model file in a resolved folder.

A model file can be a link: on a cloud server (AutoDL) every model in the models folder links
into the platform's shared, read-only model disk, under a name like `6b4679…` without an
extension. Resolving the file would leave the models folder and lose its covers and info, which
are written beside the link. So the folder part is resolved and must stay inside its root
(through links too), and the file is taken as named: `model_file_within` is the folder joined
with a bare `require_filename` name, `get_metadata` reads the sidecars beside the path it is
given (`abspath`, not `realpath`), and edits, renames and deletes act on the link, never on the
disk behind it. Only when a link has no info beside it are the info files beside the file it
links to read (`_info_base`): another tool (A1111's Civitai Helper) may have left them there. Nothing in the plugin writes into a model file. Tidy's moves and the
import's `move_into` tell a rename from a copy by where the link is (`lstat`), so moving a
linked model renames the link instead of copying the model disk's file onto the server.

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

## Requests from other devices

ComfyUI started with `--listen` lets other devices on the network open the page. They may
look; every change under `/anomalous/` answers only the computer ComfyUI runs on. One
middleware (`api/local_guard.py`, registered first in `setup_routes`) decides it for all routes:
a request other than GET must be local unless its path is in `OPEN_POSTS` (reads sent as POST:
`resolve_paths_to_previews`, `resolve_hash_batch`, `inspect_image_material`); a GET is open
unless its path is in `LOCAL_GETS` (`backup/file`, `version/releases`, `import/folders`,
`civitai_check`: the first-run setup's one request to Civitai, `api/network_check.py`).
`GET /anomalous/quick_index` (`api/quick_index.py`) is an open read like `/anomalous/models`:
every model file in a few words for the canvas's quick search.
`/anomalous/mcp` answers other devices itself. Local means: a loopback peer, no proxy headers
(`Forwarded`, `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`) and a loopback `Host`, so a
page that reached the server under another name (DNS rebinding) is refused too. A refusal is
HTTP 403 with `code: local_only` and a bilingual message. `GET /anomalous/access` tells the page
whether it is local; `remote_view.js` then shows a "view only" chip in the header.

ComfyUI on a rented cloud server is only ever opened from another device. An empty
`allow_remote_changes` file in the plugin folder, made on the server and read once at start
(`REMOTE_CHANGES`), makes `local_guard.may_change` true for every request: the middleware and
the routes that check for themselves (import, placement, scan choice, recipe focus) use
`may_change`; `is_local` stays for what needs the browser on this computer (import's search of
this computer's Downloads) and for MCP. `GET /anomalous/access` answers `{local, changes}`, and
for another device also `command`: the line that makes the file (or, when it is there, removes
it), with this server's real path, which the chip's dialog offers to copy; it only runs where
someone pastes it, in the server's terminal. The chip reads "remote changes on" while the file
is there. Usage and the risk: `docs/guides/cloud-server.md`.

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
thumbnails and model/output media lookups (a picture past Pillow's pixel limit is shrunk once
by a child process, `huge_picture.py`; a card is never a large original, a picture with none
or a video with no readable first frame gets an SVG placeholder with its size), `gallery_routes.py` owns the bounded
output snapshot (with each file's size, and the pixel size of big ones), the viewers'
`output_preview` (the picture, or a cached 4096 px copy of a very large one) and deletion (searched through `image_search.py`, which reads
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
(`civitai_down` with `reason`, net_proxy.py's name for the failure, and `done` with the
unchanged count; the result carries the first reason as `civitai_error`). The scan process
gets Settings' proxy as HTTP(S)_PROXY (`net_proxy.child_env`). Civitai answers its API on
civitai.com and civitai.red, and some networks (a cloud server in mainland China) reach only the
second: `civitai_client.api_hosts` gives both, the one that answered last first, and every API
request (the scan, import's and Model Check's lookups, `civitai_check`, which names the `host`)
asks the other when the first does not answer at all; an HTTP error is Civitai's own answer and
is not asked again. The pictures stay on image.civitai.com, so after `COVERS_DOWN_AFTER` (2)
covers in a row that would not download the scan fetches no more covers (`covers_down`). One model's error is reported and
the scan goes on. `ScanJob` in `api/scan_report.py` reads each folder's report when its
worker exits and, before the scan's marker is released, writes the scan's result to
`user/anomalous/last_scan.json` and the activity log, so whoever sees the scan end can
read its result. The scan page's picked or listed models go to `/anomalous/scan_all` as
`targets` (`--targets-file` per folder), so one scan has one result.

An unmatched model's `.info` (`id` -1) keeps why: `anomalous_unmatched_reason` is
`not_found` (Civitai answered 404), `network` (no answer after the retries),
`offline`, or `damaged`: Civitai had no record and the safetensors header does not read
whole (`model_identity.safetensors_damage`: too short, a header longer than the file, not
JSON, or a tensor ending past the file's end; only the header is read). A damaged header
changes the file's hash, so the file is to be downloaded again; the scan summary counts these
(`damaged`). Online scans look up `network` and `offline` models again; `not_found` and
`damaged` ones wait for "look up again". After `CIVITAI_DOWN_AFTER` models in a row without an answer
a scan stops asking (`--civitai-down` carries this to the next folders) and infers the
rest from the files, instead of waiting for every timeout.

A model can be left out of scans: `"scan": "skip"` in its `<model>.anomalous.json` (the
user's own layer, which scans never write; `model_identity.scan_choice`). A scan of a whole
folder skips it and the scan summary counts it apart (`excluded`), not in the other counts;
picked by hand (`targets`) it is scanned all the same. `"scan": "scan"` records that the user
was asked and kept it. Nothing decides this alone: the summary only marks new models whose
safetensors header reads but names no drawing model kind (`model_kind.inspect_file`, kind "",
a voice model say) as `not_drawing`, and the scan page asks. Those headers are read
`HEAD_READERS` (16) at a time, since on a network drive each read waits on the network (1041
new models on a cloud server's model disk took 79 s one after another), through
`get_metadata`, which reads headers through `api/model_heads.py`: each file's answer is kept
by real path with its size and time in user/anomalous/model_heads.json (at most 50,000 files,
the longest unused dropped first, written a few seconds after the last change, and only once
`setup_routes` called `keep_on_disk`, so tests stay in memory), so a header is read once per
file version, also after a restart. The last summary is kept too (`_last`, and
user/anomalous/scan_summary.json when it changed): `?quick=1` hands it out at once for the page
to show while a fresh one is worked out, and requests meanwhile await that same count
(`_fresh`). The models found on Civitai are kept with it, components apart, and
`GET /anomalous/scan_matched` lists them (file, Civitai's name, base model; at most 5000), so
the summary the page reads each time stays small. `POST /anomalous/scan_choice`
(`api/scan_choice.py`, this computer only) takes the picked models as scan `targets`, at most
2000, and writes only `.safetensors` files' layers that are readable.

The summary also counts the models in component folders (`COMPONENT_TYPES`: VAE, text
encoders, CLIP, CLIP Vision, upscalers) as `components` and lists them, found ones too, in
`component_models` with their `state`; they stay in the other counts, and their list items carry
`component`, so the page can show them apart. Folder type decides, not the file's header.
`covers` holds up to 48 covers of scanned models, components left out, newest model file first
(`{name, preview_url}`), for the pictures on top of the scan card.

The model editor writes through `POST /anomalous/update_metadata` (only the fields it sends:
`custom_name`, `custom_notes`, `custom_source_url`, which must be empty or an http(s) address,
else 400 and nothing changes) into the user layer, and covers through `set_custom_cover` /
`upload_custom_cover` first. `GET /anomalous/model_covers?type&path_idx&subfolder&filename`
(`api/model_media.py`, read-only) tells it Civitai's kept image (`<model>.civitai_bak.*`, as an
image URL) and whether the cover shown is the user's, so it can offer Civitai's back.

Current node's saved values: `GET /anomalous/parameters/by_node_type` gives each recipe set's
file and values' `signature`; `GET /anomalous/parameter_pictures?signatures=a,b`
(`api/parameters.py`, at most 64 signatures, 64 hex characters each) counts, in one pass over
the newest output pictures (`recipe_images._recent_output_pngs`), how many were made with each
set's values and names the newest. A picture's signature is read once per file version
(`lru_cache` of 4096 entries keyed by path and modification time), which the workflow page's
`parameter_gallery` shares.

The scan page's picker reads `GET /anomalous/scan_pickable` (`api/scan_summary.py`): the
same files the summary counts (the scan folders' `.safetensors`, each once), the "don't scan"
ones included, up to 5000 with the exact `total`. Each carries its locator (`type`,
`path_idx`, `rel`), size, cover URL and only the metadata fields its badge needs, not the
descriptions. Its picks go to `/anomalous/scan_all` as `targets`, like a list page's.

## MCP endpoint

Skills (`api/ai_skills.py`, one data file each in `api/skills/`) are advice an agent fetches
for a kind of job, beside the blocks that build nodes. begin_task lists the skills on (name and
a line), `get_toolbox(skill=…)` returns one, and a skill the user turned off in the Ways panel
(`user/anomalous/ai_skills.json`) is neither listed nor given. A skill's `by_model` advice comes in the
form for the canvas's main model (the page's `block_model`): `model_advice.main_params` counts its
drawing model's parameters from the file's header (`model_kind.diffusion_params`; a checkpoint's
text encoders and VAE left out), "large" from `large_from` (10 billion), else "small", "unknown"
when there is no page, no single sampler or no countable header. Tool descriptions only point at
a skill (the `prompt` of `set_prompt` and `run_workflow` at `prompt_pose`: a pose the model
draws well, nonessential hands optionally hidden, the user's own text and poses kept), so the
tool list stays within its budget; AMB passes prompt text through unchanged.

`track_run(prompt_ids, task, wait_seconds)` attaches existing submissions from this server to
an open task without running anything. IDs must exist in its queue/history; each is owned by
one recorded run. Retrying an identical batch returns that run, not the task's newest run.
External callers must supply their own returned IDs; no queue-difference attribution is used.
`run_workflow` waits up to `wait_seconds` (default 15, max 55) after starting its watcher,
outside the submission semaphore. Text and structured responses include actual state,
results/error and next action. Long runs still require `run_status(wait_seconds=55)`;
the stateless MCP transport cannot wake an idle AI on its own. Task `live` reflects an
in-flight recorded step, not recency of contact.

AI gate decisions are single-use: `ai_gates.check` consumes an immediate approval before
dispatch; only an unused timed-out approval may authorize an identical retry. Missing
step records fail closed for `ask`. `finish_step` preserves decisions received after a
gate timeout; loading an unanswered gate after restart makes it eligible for late-answer
delivery. Gate decisions wake both gate waiters and `get_answers` readers. Explicit task
selection in `ai_panels._collect` is exclusive, including when that task no longer exists;
session-scoped `get_answers` resolves its own active task before collecting input.

`api/ai_task_handoff.py` selects automatic resumption candidates without mutating ownership:
it ranks unread user messages, marks, materials and panel answers
by the input's own timestamp, not the task's last background update. Only inputs less than
two hours old qualify; future timestamps and automatic timeout choices do not. A task with
an in-flight step is excluded from automatic takeover; explicit task selection is unchanged.
For five minutes after `report(done=True)`, reads stay in the finished task and panels/notes
reopen it. `ai_tasks.current_task` applies this to both implicit and explicit task ids, including
step recording without a start receipt. Automatic follow-ups yield to waiting tasks and unread
replies; an explicit id keeps precedence and does not consume another task waiting for an AI.
Task error counts only treat completed successful steps as recovery, never running, asking,
allowed or cancelled steps. New receipts keep a compact `recovery_target` (explicit node,
connection, workflow or resource, and setting names for `set_values`), so another target's
success does not hide the failure. Legacy receipts lacking this identity retain tool-level
matching with each other; no targets are guessed or migrated into historical records.
`ai_answer_wait.collect` is shared by `get_answers` and question tools: after the bounded wait,
typing/deadline checks, automatic choices and a final nonblocking collection share the task
lock. A user answer that won the race is returned in that call, without a stale stop note.
Without a panel id, deadlines are checked once per waiting panel, including expired ones.
Typing counts from real keys only (the page posts at most every 5 s) and holds the deadline for
`AFTER_TYPING` after the last one; a question the user typed on since it was asked is never
answered on timeout, the AI is told they began an answer and ends its turn.
Question receipts preserve messages and attach their pictures even when no option was chosen.

Run monitoring failures end the receipt as `stopped` with a reason without cancelling the
host workflow. No detected queue entry is not success. Batch progress keeps the complete
prompt list, and partial errors are saved even before all prompts finish. Marked-image
validation and persistence run in a worker thread; invalid cross-drive paths are validation
errors rather than uncaught route failures.

Run ownership is explicit: the page claims `run_workflow` with the `prompt_ids` capability,
then returns `{prompt_ids, queued, requested, submission_error?}` from native submissions.
An old page's claim fails with a refresh message before dispatch. The server validates the
bounded, unique ID list and retains its order; `ai_task_runs.watch` queries only those IDs,
never a global queue difference. A partial batch continues tracking accepted IDs but finishes
as an error with its pictures retained. `run_status` includes these IDs. Missing receipts
cannot trigger guessing or an automatic retry.

While a run goes, its watcher adds `api/ai_run_watch.py`'s readings to the progress: the
console lines written since the step began (ComfyUI's `app.logger` buffer, `\r` redraws kept
at their latest, colours stripped), the tqdm bar's note, seconds left and per step (else a pace
from the steps seen), and the card's free / total memory. From the queued prompt it estimates,
once, the size each sampler's `latent_image` works at (following LoadImage's file, empty
latents, scale and upscale-model nodes) and keeps `estimate` on the step: warnings for an
upscale model's output sampled again, a sampler past the card's comfort (4.2 MP on 12 GB,
scaled by its memory) and a huge `VAEDecode`. `run_status` and `your_run` carry them in words.
From the same prompt (or the history of a run quicker than the first look) the watcher keeps
`map` (`api/ai_run_map.py`: boxes by role with their facts, links typed from
`NODE_CLASS_MAPPINGS[...].RETURN_TYPES`, reroutes and primitives wired through, seeds left out
of `params`) and `changes` against the task's previous run with a map.

Canvas actions carry the task's own tab: `mcp_server._call` marks the call with its task
(`ai_task_canvas.begin_call`, a context variable that `asyncio.to_thread` copies), `ask_page`
adds `_task_canvas: {mode, tab, title}` to the page actions in `TAB_ACTIONS` and keeps the tab
an outcome reports (`remember`); `tell` adds `canvas_tab` to the answer once when a tab was made.
`download_missing` carries this context too. A recorded tab that is missing or cannot be
activated fails on the page before executing the action, rather than using another workflow.
Message `@` references resolve combo/workflow names with the internal `exact_name` filter
in `mcp_tools` before limiting results; public list-tool searches remain fuzzy.
The default mode is in `anomalous/ai_canvas.json` (GET/POST `/anomalous/ai_gates` `canvas_tab`),
a task's own in its `canvas` record (POST `/anomalous/ai_tasks/{id}` `{canvas}`).

`POST /anomalous/ai_tasks/{id}/pictures` (`api/ai_pictures.py`) hands output pictures to an open
task; pictures handed before the AI looked join one step.

`api/ai_run_control.py` stops a run by its own prompt IDs only (dequeue, then
`interrupt_if_running`); with `stop` set, an interrupted prompt's "error" history and a
dequeued prompt's missing one both count as ended and the step becomes `cancelled`.

`POST /anomalous/mcp` (`api/mcp_server.py`) answers one JSON-RPC message per POST with
one JSON object; GET and DELETE get 405, and nothing is sent unasked. A request whose
`params._meta` carries `io.modelcontextprotocol/protocolVersion` is served as 2026-07-28:
the `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`) `Mcp-Name` headers must
match the body, or 400 with -32020; an unknown version gets 400 with -32022 and the
supported list. `initialize` selects the legacy shape (2025-03-26 to 2025-11-25); no
session id is minted, so both eras are stateless. Unknown methods are -32601 (404 for
modern requests).

`api/mcp_arguments.py` owns unambiguous required-argument renaming: one needed argument missing,
one unknown argument whose name is a known other name for it (ALIASES, from the tool exams) and
whose value has its type. A same-typed value under any other name is not taken. The MCP server normalizes
before recording a step or checking a gate, so the approval signature, displayed arguments,
execution and result references all use the same names. Direct `mcp_tools.call_tool` callers
use the same normalization; the successful receipt tells the AI which name was corrected.

The peer must be loopback with no proxy header (`Forwarded`, `X-Forwarded-*`,
`X-Real-IP`), and the Host and any Origin must name a loopback host; anything else is
403. ComfyUI's own origin middleware also applies.

Tools (`api/mcp_tools.py`) only read and run in worker threads, four at a time. Model ids
are `type:path_idx:relative/path` and images are paths under the output folder; both are
resolved with `resolve_folder_subdir` / `resolve_within`, so an id cannot leave its root.
A tool's own failure (bad id, missing file, unexpected error) is a result with
`isError: true`, not a protocol error. Pictures attached on request are the gallery's
512 px thumbnails (at most 1.5 MB).

Acting tools (`api/mcp_actions.py`, and `api/mcp_canvas_edit.py` for building a workflow)
never delete or rename files; `remove_nodes` removes canvas nodes only, one Ctrl+Z step, and
`new_workflow` opens a new unsaved tab named after the AI's words and the time, so it never
opens or replaces a saved workflow. Canvas actions go
through `mcp_bridge.ask_page`: it sends `{id, action, args}` as the `anomalous.mcp`
websocket event to every open page and waits (30 s, 90 s for model checks; at most 20
waiting). The first page to POST `{id, claim: true}` to `/anomalous/mcp/bridge` gets it
(hidden tabs wait 1.5 s so a visible one wins) and posts `{id, outcome}` back. No page,
no answer in time, or the page's refusal becomes a tool error. Scans and speech call this
server's own `/anomalous/scan_all`, `/anomalous/download/status`, `/anomalous_tts/characters`, `/prompt` and
`/history` over loopback, so they run exactly as from the UI (speech waits up to two
minutes for the file). Downloads go through the page (`model_download.js` downloadMissing /
downloadFrom), so the placement rules and the put-in after a download are the UI's own. Canvas changes are posted to the activity log with `via: "mcp"`.

`find_nodes(query=...)` returns up to five
brief candidates within a small text budget; `types=[...]` explicitly requests full settings.
`add_node` accepts `insert_after`, optional `insert_type`, and `wire_from`/`wire_to` (one ID or up
to eight IDs). `connect_nodes` accepts just two node IDs. Both return actual connections,
remaining required inputs and whether the branch reaches an output; reachability is not run
validation. Same-type sockets of the same name pair up (a ControlNet's positive/negative into a
sampler's). An occupied input that `wire_to` feeds is spliced when the new node takes that type: the
old source feeds the new node's matching input. Otherwise automatic wiring never replaces occupied
inputs without `replace:true`, except the selected downstream edge of an insertion; `insert_after`
splices every type the node passes through (a LoRA's MODEL and CLIP). The legacy explicit `input` form still defaults
to output slot zero and permits replacement. Ambiguity is an error with bounded candidates.
`add_nodes` takes a group in API form for the open canvas: a link names a node of the group or a
canvas node as `"#12"` and an output by slot or name; a node's `wire_to` feeds canvas nodes as
`add_node` does, splicing only into inputs the group itself leaves free. The page lays the group out
as one block in a free spot and applies it in one transaction with the same rollback.
`get_situation` includes at most six path chains and eight node lines; its overall 3600-character
budget trims these and reports omitted counts. Full canvas details remain explicitly available.

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
file name fitting the node's folder type; an entry of no stated type fits only a node of unknown
type; `list_site` says where its file is). The lookup also says whether the list is here
(`manager_list`). With the workflow's hash only a list entry
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
asked from this computer (`local_guard.is_local`), looks for the same file (name, size, time
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
original is removed (or kept with `keep`). `PUT /anomalous/import/upload` (local only) streams the request
body (not limited by ComfyUI's upload size) into `<dest>.part` and renames it when the size
matches. Both check the destination like downloads (`resolve_within`, model extension, free
space) and never replace a file: a taken name becomes `name (2).ext`. A failed copy or
upload removes only its own `.part`. Each import clears the file-list caches and adds a
`model_import` activity entry; the page then scans the new files. The destination the page
proposes follows the download settings' folder (`{base}` = the base model's folder).

## Tidy check

`api/model_placement.py` serves the models page's Tidy view. `GET /anomalous/placement/check`
walks every import type's folders once (a folder listed under two types counts for the first;
real paths deduplicated) and reads each header through `model_kind.inspect_file`, kept in
memory per path, size and time. A file whose header names another type than its folder, only
when `sure`, is misplaced; it goes to the same relative path in a folder of that type, on the
same drive when one exists. `works` marks a whole checkpoint in the diffusion models folder,
which still loads there. Identical files are grouped by SHA-256: the scan's (metadata) hash, or
one computed earlier this run; files of one size whose hash is unknown are only counted
(`unchecked`) unless `deep=1` reads them. `POST /anomalous/placement/move` (local only) moves the model with
`model_import.destination` and `move_into` (never over a file: " (2)") and then its sidecars
(`SIDECAR_SUFFIXES`; none when another model in the folder shares the stem), reports those that
could not follow (`left`), clears the file-list caches and logs `model_move`. Removing a copy is
`/anomalous/delete_model` (Recycle Bin, sidecars along).

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

- Where the side files are is `model_sidecars.py`'s to say: every path to `.info`,
  `.anomalous.json` and `.civitai_bak.*` goes through it (`find` to read, `target` to write,
  `existing` / `follow` to move or delete), since they may be beside the model or in the
  folder's `.amb` (Settings → Models, `SIDECAR_LAYOUT`). A file is written where it is
  already, so a folder moved half way never has two copies. Covers and other tools' files
  (`.civitai.info`, `.yaml`, `.txt`) are always beside the model. The folder tree leaves `.amb` out.
- A cover is Civitai's when its SHA-256 is the one the scan noted in the `.info`
  (`anomalous_cover_sha256`) or it is a copy of a `.civitai_bak.*`. A scan saves Civitai's
  picture straight as the cover (fetched under a working name first) and notes it; it keeps a
  `.civitai_bak.*` only while the user's own cover shows. Setting a custom cover first moves
  Civitai's picture aside as `.civitai_bak.*` (the restore source), then changes `.preview.*`.
- Cover reset first restores `.civitai_bak.*` to `.preview.*` (then notes it and drops the
  copy aside); a cover that is Civitai's already stays. Otherwise it may
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
  number of exact-path checks (both places for the plugin's own files). Do not walk,
  glob, index or call the network for these operations; only covers (small) are hashed,
  to tell Civitai's picture from the user's.

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
