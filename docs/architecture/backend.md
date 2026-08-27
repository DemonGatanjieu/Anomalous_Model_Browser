# Backend Architecture

Read this document for changes to `api/`, `scraper.py`, model files and sidecars,
recipe persistence, or filesystem-facing routes.

## Runtime and route boundary

`__init__.py` exposes the frontend directory and imports the modular route
package. `api/__init__.py` registers `aiohttp` routes, all prefixed with
`/anomalous/`. Changes to Python modules require a full ComfyUI restart; a
frontend reload alone does not replace registered handlers or module state.

The backend owns filesystem authority. A browser-supplied path, filename,
category, output reference, recipe asset, or archive member is untrusted until
validated. Use the shared helpers in `api/utils.py`:

- `resolve_folder_subdir()` for configured model-folder boundaries;
- `resolve_within()` for containment below an owned root;
- `require_filename()` for single-file identifiers.

Never rely only on `..` rejection. Absolute Windows paths, UNC paths, alternate
separators, device paths, and symlinks can bypass naïve string checks. Media
routes also enforce an explicit extension allowlist.

Active model categories come from `api.utils.get_active_folder_types()`. Do not
hardcode a scan across `checkpoints`, `loras`, or another category. A folder
disabled in `config.json` must cause no walk or metadata I/O.

## Storage ownership

Runtime UI settings and newly stored API keys live in `api/config.json`.
`scraper.py` reads it first and may fall back to the legacy root `config.json`.
Secrets are never persisted to browser `localStorage`.

Workflow Recipes live below the active ComfyUI user directory in
`workflows/anomalous_recipes`; Parameter Notebooks live in
`workflows/anomalous_parameters`. They are user data, not repository assets.
Writes validate their bounded schema and use atomic replacement.

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
`.scan_in_progress`; global quick scans use `.global_scan_in_progress`; deep
missing-model scans use `GLOBAL_SCAN_STATE` and the corresponding status route.
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

## Metadata and cache behavior

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
for a model value already supplied by ComfyUI; it is not Model Doctor discovery.

Balanced grid thumbnails are derived, longest-edge 512 px WebP files in
ComfyUI's temporary area. Their cache is keyed by source real path and physical
signature and capped at 256 MiB with oldest-accessed eviction. The original mode
serves source covers, and detail views always use originals. Derived media never
modifies or sits beside a user's cover; unsupported, animated, or failed inputs
fall back to the original.

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
- Main model extensions (`.safetensors`, `.ckpt`, `.pt`, `.bin`) are never
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
