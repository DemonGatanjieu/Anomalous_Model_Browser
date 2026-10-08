# Anomalous Model Browser Architecture

This is the short entry point for maintainers and AI agents. It describes the
system map, ownership boundaries, and rules that apply across subsystems. Read
only the linked topic document relevant to the task; do not load every document
by default.

## Reading map

Before implementation, follow [AGENTS.md](AGENTS.md), the canonical development
and maintenance rules; its section 0 is required for every commit.
[GEMINI.md](GEMINI.md) and [CLAUDE.md](CLAUDE.md) are reading entry points only.

Saved prompts and saved node values are material files (`anomalous_materials`); there is no
Material Library page any more. Prompt Studio lists the saved prompts (reading each body
through `web/modules/material_prompt_data.js`; list summaries do not contain prompt bodies)
and Current node lists the saved values. See the material contract below.

| When changing... | Read... |
| --- | --- |
| Python routes, storage, paths, metadata, covers, or scan state | [`docs/architecture/backend.md`](docs/architecture/backend.md) |
| Browser lifecycle, UI state, localization, media, or graph edits | [`docs/architecture/frontend.md`](docs/architecture/frontend.md) |
| Update-guide content/versioning or sidebar hover labels | [`docs/architecture/update-guide.md`](docs/architecture/update-guide.md) |
| Workflow Recipes, packages, galleries, Parameter Notebooks, or prompt roles | [`docs/architecture/recipes.md`](docs/architecture/recipes.md) |
| Saved prompts and node values (material files), image parameter details, keeping an output image | [`docs/architecture/material-library.md`](docs/architecture/material-library.md) |
| Model Check, provenance hashes, missing-model recovery, or model scanning | [`docs/architecture/model-resolution.md`](docs/architecture/model-resolution.md) |
| Browser audits, E2E functional bug reports, or verification sign-offs | [`docs/audits/README.md`](docs/audits/README.md) |
| Why a current product boundary exists | [`docs/decisions/README.md`](docs/decisions/README.md) |
| Recurring implementation mistakes and post-mortems | [`docs/architecture/lessons.md`](docs/architecture/lessons.md) |

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
  user/.../anomalous_materials       curated image/workflow material bundles
  user/.../anomalous_notebooks       prompt notes, with legacy originals preserved
```

The frontend and backend communicate through narrow JSON contracts. The
frontend must not infer filesystem authority, and the backend must not depend on
DOM or live LiteGraph state.

## Ownership map

This map, with the topic documents, is also the file directory: every source
module under `api/`, `web/` and `web/modules/` and each root Python file is
named with its owner. `node tools/check_structure.mjs` checks this. Styles are
covered by the `styles.css` manifest.

### Backend

- `api/config.py` owns configured paths and active model-folder types.
- `api/path_utils.py` owns containment, filename validation, atomic JSON writes, and resolving
  a saved model value inside the model folders;
  `api/utils.py` is a compatibility export surface.
- `api/metadata.py` owns sidecar and safetensors metadata extraction. A model's information
  has three layers, the user's first: `<model>.anomalous.json` (what the model editor set; only
  the editor writes it), the scan result (`<model>.info`, or another tool's `.civitai.info`
  with Civitai ids; `id: -1` means inferred from the file) and the file itself. Metadata
  reports `info_source` (`civitai` / `local` / empty) and `user_fields`. A cover is Civitai's
  only while it is byte-identical to `<model>.civitai_bak.*`; any other cover is the user's,
  and no scan replaces or deletes it.
- `api/model_catalog.py`, `api/model_resolution.py`, `api/model_metadata.py`, and
  `api/model_media.py` own model listing, identity recovery, mutation, and covers;
  `api/models.py` is a compatibility facade; `api/model_constants.py` holds the
  model, media and sidecar extensions they share. `api/model_type_listing.py` lists a
  whole models folder with its subfolders for the models page's type chips.
- `api/scanner.py` and `scraper.py` own scan orchestration and enrichment; both scan
  routes map request fields to scraper switches in one place (`_scraper_flags`).
  `civitai_client.py` is the scraper's network side (version by hash, model page, media),
  telling "Civitai does not know the file" from "Civitai could not be asked".
  `api/scan_report.py` turns the scraper's per-model report lines into one result per
  scan: kept as the last scan (`/anomalous/last_scan`), recorded in the activity log, each
  model located so the browser can open it (`/anomalous/scan_model`).
  `api/kept_images.py` says what each output image was kept as, for the gallery's star: the
  Workflow Recipe, combo or saved prompt that names it as its source image.
  `api/scan_summary.py` counts models matched on Civitai, unmatched and not yet scanned
  for the scan page and lists the last two, by the same sidecar rules the scraper uses
  (`sidecar_info`, `is_unmatched`, `unmatched_reason` in `model_identity.py`); it also
  lists the model files in other formats, which scans never read, so the page can say so.
- `api/mcp_server.py` serves `/anomalous/mcp`, the Model Context Protocol endpoint AI apps
  connect to (Streamable HTTP; the 2026-07-28 stateless protocol and the earlier
  `initialize`-based ones; this computer only, Host and Origin checked against DNS
  rebinding). `api/mcp_tools.py` holds the reading tools (summarised views over the same
  stores the pages use: models, scans, output images, combos, recipes, saved prompts,
  generated audio, activity log) and `call_tool`; `api/mcp_actions.py` the acting ones:
  canvas actions done by the open page, scans and Anomalous TTS speech through this
  server's own routes. `api/mcp_bridge.py` hands a canvas action to the page over
  ComfyUI's websocket and waits for its answer; `web/modules/mcp_bridge.js` is the page
  side, doing it with Anomalous's canvas code (one Ctrl+Z step each, logged as the AI's).
  User guide: `docs/guides/mcp.md`.
- `api/backup.py` is Settings → Backup (`/anomalous/backup/*`): one .zip of the user's stores
  (recipes, combos, materials, parameters, optionally ComfyUI's saved workflows), the plugin
  settings without the Civitai key, and each model's user layer and own cover; putting it
  back adds what is missing, replaces differing files only on request (Recycle Bin first)
  and finds models again by SHA-256, else by folder, path and size. Its model list (every
  model's folder, path, size, SHA-256, link) names the models a new computer lacks.
  `ui_backup.js` is its export and import dialogs; `ui_backup_downloads.js` downloads the
  lacking models again through Model Check's downloads, into the path they had.
- `api/lora_info.py` reads a LoRA's safetensors header to tell whether it trains the text
  encoder (`/anomalous/lora_info`), so inserting it wires the CLIP line only then.
- `api/model_download.py` downloads the models a workflow misses (Model Check's
  "Download", `/anomalous/download/*`): one at a time into `<file>.part`, continued after
  an interruption, checked against the SHA-256 before it gets its name, never over an
  existing file; also where downloads go by default (`download_settings.json`).
  `api/download_sources.py` finds the one exact file: Civitai by hash, a Civitai version
  link, or a Hugging Face / GitHub file link the workflow carries, else a file of the same
  name in ComfyUI-Manager's model list (`api/manager_catalog.py`), checked by the hash.
  `api/hf_card.py` gives a model downloaded from Hugging Face its model card's example image
  as cover and its trigger words and example prompts as notes (never over the user's).
- `api/model_import.py` puts model files the user drops on the models page into the right
  models folder (`/anomalous/import/*`): finds the dropped file in this computer's Downloads
  or Desktop and moves it (or uploads a copy), tells what it is, checks it against Civitai
  and the scanned models, never replaces a file (" (2)").
- `api/model_placement.py` is the models page's Tidy check (`/anomalous/placement/*`): models
  whose header names another type than their folder, identical files (by SHA-256), and moving
  a model with its sidecars to where it belongs.
- `api/workflow_schema.py`, `api/recipe_schema.py`, `api/recipe_images.py`, and
  `api/recipe_store.py` own recipe validation/shaping, images, CRUD, history, and
  integrity receipts; `api/recipes.py` is the HTTP facade. `api/recipe_constants.py`
  holds the size and count limits shared by recipes, parameters and materials.
- `api/recipe_packages.py` owns bounded inspect-stage-commit package handling.
- `api/parameters.py` owns Parameter Notebook persistence and lookup.
- `api/notebooks.py` owns combo (搭配, formerly Prompt Note) persistence and recoverable legacy copying.
- `api/material_schema.py`, `api/material_assets.py`, and `api/material_store.py`
  own curated material shaping, private assets, persistence/cache, search and
  lifecycle; `api/materials.py` owns HTTP mapping and compatibility entry points.
  `api/node_material.py` saves one canvas node's current values as a
  `node_parameter_selection` material (the current-node panel's "save").
- `api/media_routes.py`, `api/gallery_routes.py`, `api/translation_routes.py`, and
  `api/folder_types.py` own the formerly mixed utility route families.
- `model_policies.py` owns shared backend rename and protected-category policy.
- `model_identity.py` owns file SHA-256 evidence and the base model a safetensors header
  tells, shared with the standalone scanner (which runs as its own process, so the API
  never imports `scraper.py`). `model_kind.py` reads a .safetensors / .gguf header (never
  formats that can carry code) and says which models folder the file belongs in and its base
  model; model import and the scanner's offline base model use it.
- `recycle_bin.py` is the only way the plugin deletes the user's files (models, covers,
  outputs, recipes, materials, notes, audio): to the system Recycle Bin, together, or not
  at all (`TrashUnavailable` on drives without one). `api/trash.py` is the API's import of it
  plus the message shown when nothing was deleted. The plugin's own temporary files, caches
  and bounded recipe history are still removed directly.
- `api/audio_catalog.py` owns the generated-audio side: the output-audio history,
  temp Preview Audio results (listed, and copied into `output/audio/` on save),
  deletion, and streaming files from the output and temp folders. Characters and
  their reference clips belong to the Anomalous_TTS node and come from its routes.
- `api/audio_metadata.py` reads the ComfyUI `prompt` comment from FLAC and
  Ogg/Opus files (read-only) and extracts the TTS node's speech, sample and seed
  for the audio gallery.
- `api/image_search.py` powers the output gallery search (`gallery_images?q=`):
  it reads only the PNG text chunks before the pixel data (ComfyUI prompt and
  workflow, A1111 `parameters`), caches one record per image by mtime, and
  matches all query terms; hex terms of 8+ characters also match recorded model
  SHA256 values and, via `collect_model_hash_index` in `model_resolution.py`,
  local model files with that hash. Terms arrive as repeated `term` params, one
  phrase each. `ui_search_chips.js` is the reusable search-block input (Enter or a
  comma commits a block); `ui_gallery.js` places it above the gallery.
- `api/version_manager.py` owns the plugin's own version: the installed tag/branch
  (`/anomalous/version`, local only), published releases fetched only on request
  (GitHub releases API, falling back to `git ls-remote` tags; drafts skipped,
  pre-releases never counted as latest), switching to a published tag (detached
  checkout), returning to the default branch (fast-forward only), and undoing the
  last switch (recorded in the ignored `.anomalous_version.local.json`). Every
  switch refuses to run over modified tracked files. `ui_version_manager.js` is
  the version line (shown in the update guide opened by the header "!" button) and panel; nothing goes online until "check for updates"
  is clicked, and restarts go through ComfyUI Manager's reboot route when present.

- `web/main.js` coordinates extension registration (with `?v=...` versioned module imports busting aggressive browser ES Module caching and unconditional legacy storage key purging). `browser.js` owns the shared
  browser class and extracted-method wiring; `browser_entry.js` owns the single
  browser instance plus floating/topbar/menu entry behavior (pointer-capture drag,
  pre-mount positioning to avoid a flash, `anomalous_trigger_pos_v3` persistence);
  the unsaved default position is defined in CSS; `entry_controls.js`
  owns entry mode, trigger size/style normalization, viewport clamping that keeps
  the button out of the sidebar dock, and saved-position storage
  (`isValidSavedTriggerPosition`); `api/__init__.py` sends `Cache-Control: no-cache`
  for this plugin's static files so a normal refresh revalidates them (modules are
  imported without `?v=` query strings, which would create second module
  instances); and `interface_settings.js` owns language and theme preferences.
- `ui_domain_switcher.js` stores which side is active (image or audio: which list the
  list column shows, which guide "!" opens); the rail's pages switch it through
  `ui_shell_nav.js`. `browser.switchAudioTab` is the single entry for the audio panels
  (rail pages, the audio list's own entries) and `hideAllPanels` stops audio playback.
- `audio_engines.js` owns the audio page's one speech engine, GPT-SoVITS through
  the separate Anomalous_TTS node pack (docs/decisions AD-016), detected at runtime
  through `/object_info/<node class>`. Characters are normalised into one
  voice-group shape (`node_value` = what the node's `character` widget takes), so
  cards, sidebar and the Voice-over view share one implementation. While the pack is
  missing the studio shows install steps instead of cards; nothing else depends on it.
  Its data comes only from the node's HTTP contract, version 11
  (`/anomalous_tts/characters`, `/audio`, `/settings`, `/status`, the storage,
  library, pretrained, browse, import and import preview routes; the node repo's `docs/INTERFACE.md`,
  mirrored as the project doc `anomalous-tts-interface.md`); Anomalous never
  reads or writes its model folders. `loadGptSovitsStatus` caches the setup status
  with the engine data (null for a node without `/status`, which hides setup and import). The character list is a
  summary without file lists; `fetchGptSovitsCharacter` gets one character's files.
  Engine presence and loaded voice groups are cached (`MAX_AGE_MS`) so re-renders
  from sidebar clicks, domain switches and the studio + sidebar pair cost no
  requests; `invalidateEngineCache()` drops them after a save or an added voice,
  and `invalidateEngineCache({ rescan: true })` (Refresh button) also makes the node
  re-read its folders (`?refresh=1`).
  `ui_audio_tts_editor.js` edits a character's emotion references through that API:
  it opens at once, loads the character's audio list in the background (save waits
  for it), and keeps settings fields it does not know.
  `tts_setup_api.js` holds the other calls (storage place and moving, forgetting
  an earlier place, pretrained sources and downloads, folder browse, chunked
  upload, inspect, commit, discard) and the pure import-form rules (`importKind`,
  `pickWeights`, `nameConflict`, `textFromFile`, `buildImportBody`, `importProblem`,
  `rowState` / `sectionState` for the form's colours,
  `setupSummary`, `pretrainedReminder`, `missingForLanguage`); no DOM.
  `ui_tts_setup.js` is the GPT-SoVITS settings dialog, opened from the sidebar
  footer (`setupAttention` gives that entry its dot). Missing pretrained files only get a dismissable dot
  when the studio's characters need them (dismissed ids in `localStorage`; a newly
  needed file brings it back); missing packages get a red one. Inside: one storage place (changing it asks whether the characters
  move along), other places still read, pretrained files, packages. It polls the
  status only while a download or move runs and it is open, and redraws the
  studio when a move ends. `ui_tts_import.js` is the import window. It first asks
  what the user has (`mode`: `single` = one card led by its checklist, `batch` = a
  drop area then one card per draft, one unfolded at a time, `add` = files for an
  existing character, also opened straight from a card's "Add files"), and runs a
  spotlight tour once per screen ("?" replays it). It owns the drafts (characters being built; `target` = files added to an
  existing one), the unassigned tray, the characters waiting for the next batch
  (a large add opens one batch; the next opens on request or once the batch is
  imported), every file row (in exactly one draft's `rows`; a row keeps its own
  name in `original` and gets a clash-free `name` in a draft, sent to the node as
  the file's `name`), a debounced inspect per draft, and imports the ready drafts
  one after another (each commit on its own, without the rows `leftOut` names;
  closing discards uncommitted uploads). `draw()` rebuilds the cards on structural
  changes, `refresh()` only repaints status, so typing never loses focus.
  `ui_tts_import_uploads.js` sends browser files in chunks, three at a time, once
  they are in a draft (tray files wait); `ui_tts_import_player.js` plays one clip
  at a time for comparing (browser files from memory, local paths through the
  node's preview route).
  `tts_import_groups.js` holds the pure rules: which folders are never taken
  (`skipFolder` / `isPackage`, the same rules as the node's scan: Python
  environments and base models anywhere, a package's program and training folders
  only inside a package, never the chosen folder), which draft a file goes to
  (`groupFiles`: a folder with one character's weights and clips is that character;
  other weights by stem; other files follow the character folder, the weights in
  their nearest folder, then folder names or file-name prefixes; unclaimed `.list`
  files go to every character), how an add splits into groups and batches
  (`planGroups`, `splitBatch`), new names for files that would clash inside a
  character (`clashFreeNames`), which files are left out (`leftOut`: clips outside
  3–10 s and their line files), where a draft stands, and its checklist (the next
  step first). `ui_tts_import_sources.js` brings files in: the browser's dialogs and
  drops (uploaded), the node's picker (paths); every source gives folders starting
  with the chosen one, says which folders were left out or too deep, and offers the
  picker before a very large upload. `ui_tts_import_draft.js` draws a draft's card
  (name in the header, steps left, the checklist with the next step's button and
  the chosen weights, one line per clip with its owner picker, the first clips with
  "show all", left-out files folded, line files, language) and the unassigned card
  (one folded line per folder when large), and builds each row's elements once, so
  they survive redraws and moves; `ui_tts_import_screens.js` holds the fixed
  screens (the first question, the batch drop area, the "add more" menu) and the
  tour steps. `ui_tts_file_drop.js` reads OS drops (walking dropped folders, only
  files an import can use, up to 5000) for the studio, the sidebar and the
  workbench. `ui_tts_path_picker.js` picks server-side folders or files
  through the node's browse route, since the browser cannot see local paths.
- `audio_node_targets.js` is the single table of canvas nodes the audio studio
  writes into (the character widget and the script widget of
  `AnomalousTTS_CharacterSpeech`).
  `planVoiceDrop` decides every character drop and names the reason for each refusal;
  unlisted nodes are refused, never matched by widget name. Supporting a node
  means adding one entry plus a test.
- The rail's Voices entry has two views, switched by `ui_voice_tabs.js` at the top of
  each and sharing the character list: Characters (shell page `voices`) and Voice-over
  (shell page `script`; `ui_shell_nav.js` keeps the rail on Voices and reopens the view
  used last).
  `ui_audio_studio.js` owns the Characters view: the character cards, preview playback,
  tag copying, dragging a card header onto a node through the shared `bindMaterialDrag`
  with `targetHint`/`rejectHint` telling the user what releasing does, and each card's
  "Voice-over" button (`owner.openScript(group)`).
  `ui_script_page.js` owns the Voice-over view: it loads the characters and mounts the
  script director, or shows the install steps or the way to import one when there is
  nothing to voice yet. A character picked in the list speaks there; the audio
  gallery's "voice it again" opens a file's lines with its character
  (`owner.openScript(null, { speech, subfolder })`).
  `audio_script.js` holds the pure script rules: splitting, bundling
  (`buildScriptPackage`, with `[take:N]` for retakes), combo value
  matching, and `buildTtsPrompt` (a GPT-SoVITS script as a ComfyUI API prompt
  saving to `output/audio/<character>/`).
  `ui_script_director.js` owns the script director, the Voice-over view's body: one
  character, an emotion chip row per line card (with the chosen emotion's reference clip;
  none when the character has only its main voice), editing buttons shown on hover, and a
  bundle that is generated in the view, or, under "Into your own workflow", pushed to the selected/only target node,
  dragged onto one (writing the character and script widgets together, one Ctrl+Z
  step) or copied. The page feeds it the voice groups after each fetch.
  It puts the cards on one side and generating on the other: beside
  them once the page is wide, below them when it is narrow (docked browser).
  `ui_script_run.js` is the director's "Generate" section (the bar with the result and
  a way to the audio gallery; language and speed in view, the sampling numbers folded
  under "fine-tuning" with plain names): it runs
  the script without the canvas, plays the result, retakes the whole script
  (new seed) or one line (`[take:N]`, the node caches the rest), and saves a
  character's language, speed and folded sampling parameters to its `defaults`
  (only values that differ from the node's own defaults, which it reads from
  `/object_info`; needs Anomalous_TTS interface 11).
  `ui_tts_pronunciation.js` edits a GPT-SoVITS character's pronunciation table
  (the node's `replace` setting) from its card; each row can be heard as it reads
  now and as replaced, through a Preview Audio run, and saving keeps every other
  settings field.
  `audio_tts_run.js` queues one API prompt with this page's client id and
  follows it (websocket status, `/history` result, cancel = queue delete or
  targeted `/interrupt`); it never touches the canvas.
- In the audio domain the header **!** opens `AUDIO_USAGE_GUIDE` (a how-to, see
  `docs/guides/audio-studio.md`) instead of the visual update guide.
- `ui_audio_sidebar.js` owns the audio navigation and the active audio filter:
  characters grouped by language, groups folded
  in `localStorage`, a character unfolds into its clips (a click plays the clip
  through its studio row, switching the studio to that character when needed), a
  search box from six characters on, a red dot for characters that need a look,
  the GPT-SoVITS settings entry at the bottom and file drops on a character. Canvas drags go through `audio_voice_drag.js`, shared with the
  studio cards.
- `ui_audio_gallery.js` owns the generated-audio history (output folder): playback,
  seeking, search, paging, download and deletion, showing the speech/voice/seed
  recorded in each file, plus a section for unsaved temp previews that can be
  copied into `output/audio/`.
- `ui_sidebar.js` assembles the browser window (rail, list column, header, page panels)
  and renders the model folder list. `ui_shell_rail.js` owns the left icon rail: one
  entry per page, the tool slots and the settings slot. `ui_shell_nav.js` owns page
  navigation (`goTo`): the domain each page needs, which pages have a list and whether
  it is open (remembered per page; closed and overlaying below 760 px), the header's
  page title, and the page reopened next time. `ui_home.js` owns the home page (task
  cards, first steps). `ui_shell_frame.js` owns dragging, resizing and keeping the
  floating window on screen; `ui_scan_watch.js` polls scan status for the rail's scan
  button, the progress panel and the model reload afterwards.
  The activity log (docs/decisions AD-018): `api/activity_log.py` keeps the entries
  (newest first, bounded, in the ComfyUI user folder), records this plugin's and
  Anomalous_TTS's successful write requests in a middleware, and serves
  `/anomalous/activity` (a handler may attach what it changed, `request[ACTIVITY_DETAIL]`;
  scans record themselves when they end); `activity_canvas.js` records canvas changes by comparing a
  snapshot taken when the user presses inside Anomalous with the canvas when they
  next press or type outside it (`activity_diff.js` holds the pure snapshot and
  difference); `activity_log.js` is the client and the words for each entry;
  `ui_activity.js` renders the activity page and the home page's recent list;
  `canvas_undo.js` keeps what each canvas entry did, in full, while the page stays open,
  and undoes an entry from the log while nothing has changed it since (entries that
  removed nodes or rewired existing ones are never offered).
  `ui_settings_hub.js` owns the display preferences (view mode, scale, atmosphere, window
  layout) and their application, the gear and language redraws; `ui_settings_page.js`
  is the settings page the gear opens (a tool page with Back), in tabs: Look (look and
  language, model cards and memory with the card image cache, opening mode and window),
  Models (folders, where downloads and imports go), Workflows (fingerprints), Prompts
  (translation), Backup (`ui_backup.js`), Help; `ui_feedback_dialog.js` is the feedback window (Home and the
  settings page open it): one text box, then `feedback.js` opens a GitHub issue with it in
  the browser's language, the environment folded at the end when attached (versions and
  hardware only, never a path or ComfyUI's command line), or copies the environment;
  `ui_rail_tools.js` owns the rail's tool buttons (scan, doctor, current node);
  `ui_browser_navigation.js` owns shared panel hiding/cleanup and workspace return,
  including Esc on the workspace panel (`nbPanel`, below the header and right of the
  rail; the list column steps aside while it is open).
  `ui_scan_page.js` is the scan page (a tool page like the doctor): counts, the scan
  button, a card for how the next scan goes (opening the scan settings page), the last
  scan's summary; each count and the summary open a
  list page from `ui_scan_lists.js` (not scanned, unmatched, other formats, the last scan's
  models) with Back, a button for the whole list (scan these / look them up again) and rows
  that open a model, whose Back returns to the list, or scan it;
  `scan_results.js` holds the words for scan results, shared with the activity page.
  `scan_runner.js` starts and follows scans (every folder, picked or listed models, or one
  model from its card), shows the result and refreshes node drop-downs, hashes and the
  grid afterwards; folder visibility/order lives in
  `ui_folder_manager.js`.
  `scan_progress.js` owns the scan progress panel
  (`updateScanProgress` / `finishScanProgress` / `failScanProgress`): inside the scan
  page while it is shown (`setScanProgressHost`), floating at the bottom right otherwise.
  `shortcut_controls.js` owns the open-browser and Prompt Studio keyboard
  shortcuts (the second keeps its old "materials" ids), their fallback when ComfyUI's keybinding does not fire, and the
  settings control that opens ComfyUI's keybinding editor.
- `ui_model_sources.js` renders the Models page's Sources view (the last type chip): where each model is downloaded, for the open workflow or every model, with each link editable and saved in place; `model_source_links.js` owns its data and actions (collecting the workflow's models, resolving them here, saving a link to the model's information and the workflow, the canvas note and the clipboard list).
- `ui_gallery_card.js` builds one output image's gallery card (viewer, workbench, cover pick, drag, star, delete);
  `ui_keep_menu.js` is the star's keep menu (also the workbench's Keep): the whole workflow, the combo or the prompts,
  each saying where it goes, opening what was kept already or removing it (to the Recycle Bin through the recipe,
  notebook or material delete route); `image_keep.js` does the keeping (an image as a combo,
  its prompts as a saved prompt, reading what was kept) without DOM.
- `ui_combos.js` renders the Combos page's list (搭配: a main model, LoRAs and a prompt, formerly Prompt Notes): search,
  New, and a card per combo with its model's cover and Put on canvas; a card opens the combo's editor, and dragged onto the
  canvas (`material_drag.js`) becomes a new group of nodes where it is dropped. Combos keep the notes' files.
  A combo can instead hold a node structure (`data.kind === 'nodes'`): `combo_structure.js`
  captures the canvas's picked nodes (subgraphs aside) with the links between them and puts
  them back (other boxes stored by name and restored untouched, slots = model drop-downs and
  text boxes, the folder a drop-down lists read from ComfyUI's own `/models` lists, inputs fed
  from unpicked nodes noted to wire);
  `combo_slots.js` holds its rules that need no canvas; `ui_combo_structure.js` is the save
  dialog, the slot editor, the slot model picker and "New"; `ui_translation_peek.js` is the
  read-only translation panel beside its prompts.
- `recipe_save.js` saves Workflow Recipes for the canvas save and for an output image's workflow (the gallery's keep menu,
  moving whole workflows kept as materials), laying an image's workflow on a canvas of its own to summarise it.
- `ui_apply_receipt.js` is the receipt of values written to a node from a panel (Current node's parameters) with its Undo. `node_material_actions.js` owns prompt envelope extraction (`extractMaterialPromptEnvelope`) and the node writes shared by those panels and prompt drops.
- `ui_update_guide.js` and `update_guide_data.js` own the non-intrusive update guide modal (accessible via header button `#anomalous-update-notice-btn`, the Help modal and Home's "What's new"; the current guide's ID and steps live in `update_guide_data.js`) with full bilingual localization. `ui_spotlight_tour.js` provides the interactive spotlight mask tour (`startSpotlightTour`), gliding smooth focal box highlights across the rail's pages and tools with directional tooltip cards and keyboard navigation; steps whose target is not on screen are skipped. The browser tour goes in the order the pages are used (rail, Gallery and what its ☆ keeps, Workflows, Combos, Prompts, then the tools), with its text in `locales.js`. Other views pass their own `steps` (text from locale keys) and an optional `onClose`; the GPT-SoVITS import window does.
- `tool_registry.js` holds the tool icons shared by the rail and Home.
- The rail's tool slots (`ui_rail_tools.js`, fixed) hold scan, doctor and current node; settings sits at the rail's bottom. The rail's Prompts entry is Prompt Studio's page (`ui_prompt_composer.js`); its "Beside the canvas" moves the studio into a drawer by the canvas with the browser folded away, and "Back to the window" returns it. There is no toolbox: the other tools open from their pages (share and import on Workflows, Model Sources as a view of Models, opened from the doctor too, translation in Current node).
- `ui_share.js` is share and import (the Workflows page's ⇅): the canvas workflow as a share
  code in Chinese characters or letters, and one place to paste a code or workflow JSON or drop
  a workflow file, an image, a recipe package or a backup .zip. `ui_recipe_package.js` exports
  a recipe package from a card or the detail's More menu and takes one in as a new card. `share_code.js` is the AMB2 code (lean workflow
  checked by rebuilding it, else the whole workflow; AMB0/AMB1 still open); details in
  `docs/architecture/frontend.md`.
- `ui_model_types.js` owns the models page's type chips (one per models folder, with its count) and
  `owner.modelScope`, what the grid lists: a whole type, or one list folder shown as a crumb. The
  grid's cards set `currentType/PathIdx/Subfolder` to their own model's folder (`focusModel`),
  which the editor, the scanner and "add to canvas" read. Its Import chip and files dropped on
  the grid open `ui_model_import.js`, the import window (one card per file: type, base model,
  where it goes, warnings, progress); `model_import.js` reads each file's header and asks,
  moves or uploads it, then scans the new files. The page's tabs (All models, Tidy with how
  many things it found, Sources) head the grid; under All models the type chips and the base
  model chips (`owner.modelBase`; `model_bases.js` names each model's family from its scanned
  base model or its header's guess). The Tidy tab is `ui_model_tidy.js` (`owner.modelView ===
  'tidy'`): cards with covers in two steps — models in a folder whose loader cannot read them
  (from → to, Move there), identical copies (pick the one to keep, recycle the rest);
  `model_placement.js` does its requests and keeps the tab's count. `ui_model_search.js` is the models
  search in the header (shown on the models page through the shell's `data-page`): the grid
  lists the models of its type matching every word (`owner.modelQuery`).
- `model_source.js` shows where a model's information came from: the card badge (marked only
  when inferred from the file, ≈, or not scanned yet) and the detail header's source line with
  the fields the user set.
- `ui_grid.js` and model-detail modules own model presentation: `ui_grid.js` manages chunked card rendering,
  card placeholder ergonomics (eliminating misleading unclickable text in favor of pure centered icon and status),
  card action buttons (one-click canvas addition with plus icon, model metadata editor, direct precision scanner without wizard modal popups)
  with absolute positioning cascades immune to tooltip target conflicts, vibrant hover affordance,
  safe docked sidebar preservation upon node addition, and multi-type node dispatch; `ui_detail.js`
  coordinates detail display, `ui_model_editor.js` owns metadata editing, and
  `ui_model_selector.js` owns advanced selection. `ui_gallery.js` (cards in
  `ui_gallery_card.js`) and `ui_gallery_detail.js` own generated-image browsing and workbench lifecycle,
  with stage interaction in `ui_image_stage.js` and metadata tabs in
  `ui_image_inspector.js`.
- `ui_recipes.js` / `ui_recipe_detail.js` and `ui_notebooks.js`
  own their respective workspace surfaces and persistence flows. `ui_recipes.js` owns
  the Workflow Recipe studio catalog workspace with search/filter tags, grid/list layout toggle,
  dedicated top-right modal close anchor (permanently decoupled from the tool button row to prevent wrapping displacement),
  streamlined action header (preserving active workflow saving while pruning unfinished package
  import entrypoints), and card browsing. `ui_notebooks.js` owns the Combos workspace (its list or one combo's editor,
  with Back to the list) and combo persistence; `ui_notebook_editor.js` owns unfolded card editing (modularized into single-responsibility
  sub-functions adhering to the 50-line rule: sticky top action toolbar with floating More popover dropdown and timed two-step delete safety guard,
  unfolded companion models card with unconstrained multi-column tile flow eliminating nested gallery scrollbars,
  prompt composer with dynamic field-sizing and compact inline find & replace toolbar, and unified dark slim scrollbar ergonomics with complete bilingual dictionary coverage in `locales.js`), and
  `notebook_canvas.js` puts a combo on the canvas as a new wired group of nodes (following the pointer, or at a dropped
  card's position; Esc takes a following group off again); it never changes nodes already there. Combos are a rail page. `ui_recipe_detail.js`
  coordinates the Workflow Recipe detail session and model composition. `ui_recipe_overview.js`
  owns the Overview prompt showcase (with `entry.text` fallback, guarded non-shrinking primary action CTA, and floating Popover More dropdown menu), and `ui_recipe_parameters.js`
  owns the responsive Parameter Presets workspace (featuring default-expanded raw node parameter inspection,
  a `clamp(230px, 24vw, 290px)` sidebar with guarded card actions, uncluttered console action bars with deferred status feedback,
  `minmax(130px, 1fr)` Bento Grid with universal click-to-copy, LoRA cards with flexbox truncation guards,
  and sticky editor headers).
  `prompt_boxes.js` is the one place that finds prompt boxes on the live canvas: a
  multiline STRING input by the node's ComfyUI definition, whatever it is called; its
  role is the box's own name (positive / negative) or else the wiring (outputs followed
  to an input named positive / negative). It also plans which box takes which text and
  finds a box's opposite-role partner on the same sampler. `prompt_drop.js` is the
  prompt drag on the canvas: boxes outlined by role, the box under the pointer as the
  target, the text a release writes previewed over it (and its partner), and a hint
  saying what release writes where. `node_material_actions.js`
  extracts prompt envelopes without model file paths and writes them (`fillPrompt`);
  text never crosses roles unless the user picked the box; writes are one undo step.
  Within recipe detail, `ui_recipe_versions.js` owns history comparison/restore,
  `ui_recipe_gallery.js` owns result cards and direct Image Detail Workbench handoff,
  `ui_recipe_models.js` owns the overview's model list (preview, presence under the saved name,
  note, download page; finding missing models is Model Check's) and the recipe cover,
  `ui_recipe_metadata.js` owns inline persistence, and `ui_recipe_detail_dom.js` owns
  the DOM/copy helpers shared by detail subviews. `recipe_identity.js` derives model
  references from native loaders plus a table of verified all-in-one loader layouts
  (`ALL_IN_ONE_LOADER_SPECS`, mirrored in `api/recipe_schema.py`); other third-party
  widgets stay parameters. References are keyed by
  `(node_id, widget_index, category, saved_value)`. `recipe_parser.js` summarizes
  models, LoRAs, samplers and prompts (linked prompt nodes before embedded loader
  prompts) and keeps the summary in step with widget edits using the same node rules.
  `ui_recipe_catalog.js` owns recipe
  filters, navigation, dismissible topbar drag guidance strip with localStorage persistence, the 3-step empty-state onboarding blueprint (`renderRecipeEmptyGuide`), and background catalog-wide model readiness resolution (`resolveCatalogRecipeReadiness`), `ui_recipe_cards.js` owns cards and card actions
  (including `grab` drag affordance, cover `可拖拽` badge, harmonized multi-state model readiness pill with `getRecipeReadiness` synchronizing available, missing, and pending matches with detail overview, and direct canvas drag-and-drop), `ui_recipe_dialogs.js` owns save/edit dialogs, and `ui_recipe_media.js` owns shared cover helpers. Detail sessions synchronize detected model availability back to `owner.recipeRecords` via `syncRecipeReferencesToCatalog`.
- `ui_prompt_composer.js` owns the standalone Prompt Studio drawer (dock side, width, Esc);
  `ui_prompt_workbench.js` fills it: the top bar (tags or text view, the meanings' language) and
  saving a box as a card. `ui_prompt_target.js` decides what is edited, the prompt boxes of
  the prompt node last selected on the canvas or a positive / negative draft, follows the
  selection and the boxes' text, and owns the studio's Undo; `ui_prompt_box_editor.js` is one
  box as tags (select, weight, edit, remove, reorder, drop, type, translate to English) or text.
  `prompt_tags.js` splits and joins a prompt's tags keeping their separators, and
  `prompt_gloss.js` looks up and keeps the tags' meanings in the picked language. `ui_prompt_source_deck.js`
  owns the card list (three built-in cards and the saved prompts), search, new-card form,
  library sync and renaming / deleting a saved prompt; `prompt_material_source.js` reads
  saved prompts as cards and saves one; `ui_prompt_card_popover.js` owns the card preview (hover
  corridor, pin, Copy / Add / Rename / Delete); `prompt_card_drag.js` lets a card or a box be
  dragged out of the drawer onto a canvas prompt box or empty canvas (through `material_drag.js`
  and `prompt_drop.js`), passing through inside the drawer so the boxes still take it.
  `prompt_composition.js` holds the starter cards, composes a saved plan's text and names and sorts prompts.
- `ui_node_prompts.js` is the current-node panel's prompt boxes: role and text, with
  Edit in Prompt Studio. The studio uses `ui_lifecycle.js` for global listeners, request
  cancellation and resize cleanup. Translation requests go through `translation_service.js`.
- `ui_dialog.js` owns the plugin's own alert / confirm / prompt dialogs
  (`anomalousAlert`, `anomalousConfirm`, `anomalousPrompt`), used instead of the
  browser's native ones. `ui_prompt_toast.js` is the short toast (optionally with an
  action, such as Undo after a drop) shared across the plugin.
- `canvas_history.js` asks ComfyUI's Ctrl+Z history for a step after each canvas write
  Anomalous makes (applied values, drops, created or inserted nodes, recipes): ComfyUI
  takes steps on mouse-up and key-up, and a drag-and-drop ends in neither.
- `model_policies.js` mirrors `model_policies.py` for the frontend: which folder
  types a loader widget holds, which are never physically renamed, and which
  need a workflow-carried hash before Model Check recovers them.
- `ui_dom.js` provides small DOM/JSON helpers; `material_inspector.js` owns the image
  workbench's metadata and node-parameter rendering.
- `model_check.js` checks the open workflow's models against this computer (Model
  Check's verdicts, no DOM; the feature was called Model Doctor, and code and CSS still
  say "doctor") and puts a found file into its node; `ui_doctor.js` is the
  Model Check page and `ui_doctor_banner.js` the bar over the canvas when an opened workflow
  misses models (it also owns the check-on-open preference that Settings → Workflows and the
  bar's "Don't show again" set). `model_download.js` finds a missing model's source,
  decides where its file goes (the download settings, `{base}` = its base model's folder),
  follows the downloads and puts each finished file into its nodes (the placement rules
  are `download_places.js`, without imports so they are tested alone); `ui_model_download.js`
  is the page's Download buttons, progress and the dialog that shows and changes where
  each file goes. `ui_node_assistant.js` owns the current-node panel (model actions, LoRA
  insertion, model cards and history), `ui_node_model_picker.js` owns native combo
  replacement, `ui_node_parameters.js` renders the panel's parameters section, and
  `node_parameter_sets.js` merges the node type's saved values (material files and recipe
  parameter sets) and works out what each would change on the node, keeping seeds,
  model files and missing choices; saved values (not a recipe's) are deleted there. `model_picker.js`, `node_material_actions.js`, and `graph_splice.js`
  own the remaining explicit graph changes.
- A model's download link lives in its user layer (`source_url` in `<model>.anomalous.json`, via
  `/anomalous/update_metadata`), the same field the model editor edits; for the open workflow's
  models it is also kept in `workflow.extra.anomalous_model_sources`, so shared workflows carry it.
  Workflow models are located here through `/anomalous/resolve_paths_to_previews`.
- `locales.js` is the shared runtime string catalog. Existing inline bilingual
  UI strings remain migration debt; new strings belong in the catalog.
- `styles.css` is the ordered import manifest for `web/styles/*.css`, which own
  presentation and theme overrides. Color values, dimensions
  and visual design descriptions are not duplicated as architectural contracts.

## Cross-system invariants

These rules are intentionally summarized here and specified in the linked topic
documents.

1. **Identity is provenance, not naming.** Model Check may use a cryptographic
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
- Recipes, Parameter Notebooks, and Material Library records/assets are user data outside the extension directory.
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

The per-commit requirements (which document to update, the structure check,
verification, snapshots and pushing) live in section 0 of [AGENTS.md](AGENTS.md)
and are not repeated here. Update this entry point only when the system map,
cross-system invariants, or reading map change; everything else goes in the
narrowest topic document.

Decision records explain enduring choices; they are not a chronological diary.
Git history is the authoritative record of implementation changes. Planning-only
documents must be clearly labeled as proposals and must not describe unshipped
behavior as current architecture.
