# Model Identity and Scanning

Read this document for Model Doctor, workflow provenance, missing-model recovery,
hash caches, Civitai metadata resolution, or deep scanning.

## Identity boundary

Model Doctor recovers the same physical model referenced by provenance embedded
in a workflow or image. Local renames and path differences are the problem it
solves, so names cannot also be its proof.

Allowed automatic evidence is:

1. plugin-carried cryptographic hash;
2. exact physical byte size only as a disambiguator for that hash;
3. the model category required by the target widget.

Without a hash, one unique in-category size match is only a candidate. Model
Doctor may show it during an explicit manual check, but it cannot redirect the
node until the user confirms that candidate. Confirmation applies to the current
node only; it does not create a persistent binding. If both hash and size are
present and point to conflicting physical files (both match distinct local files),
resolution reports an identity conflict and is rejected. When a requested model hash
simply does not exist in any local file, it returns `{"found": False}` cleanly without
falsely flagging a conflict.

Paths, filenames, source filenames, display/custom names, previews, workflow
fingerprints, and fuzzy/visual similarity are never candidate evidence. They may
be used only after identity is established to return a local dropdown value,
locate presentation media, and verify the value against ComfyUI's native choices.

Foundation components—`vae`, `vae_approx`, `clip`, `text_encoders`, and
`clip_vision`—are hash-only automatic-recovery categories. Byte size alone
cannot automatically repair them. When size provenance is available it may be
shown as the same explicit manual candidate, but a supplied hash mismatch never
falls back to a filename or size-only guess.
This is a Model Doctor confidence boundary, not a scanner-support boundary. The
scan wizard may traverse any active registered model folder and can still
calculate a local hash when Civitai has no matching record. Sparse or ambiguous
remote metadata is a reason to require cryptographic identity, not to exclude
the category from scanning.

An existing native combo value remains loadable even if a foundation component's
current local hash differs from stored provenance. Model Doctor shows a
non-blocking identity-change warning instead of declaring the node missing or
replacing it. If the value is absent, redirection requires one exact in-category
hash match. Missing or ambiguous evidence remains unresolved for manual action.

Slash normalization of a value that already has an exact native-option
equivalent is representation normalization, not discovery. The resolver must
never append a foreign or cross-category value to `widget.options.values` merely
to claim success.

## Frontend provenance cache and injection

`window.anomalous_hash_cache` maps model widget values to exact SHA-256 and size
records. It is fetched by the optional resolver from `/anomalous/all_hashes`.
Relative-path and basename aliases exist only when unambiguous; if two files
share an alias but differ in identity, omit that alias. Lookups prefer the full
widget value before basename fallback.

After a scan writes new metadata, `window.anomalous_reload_hashes()` refreshes
the frontend cache.

When provenance injection is enabled, the compatible active graph constructor's
`serialize` path writes
`extraObj.anomalous_hashes[node_id_filename] = {hash, size}` for known model
widgets. The cache covers ordinary models and foundation categories. A
foundation component without a recorded hash receives no size-only provenance.
A missing compatible graph API disables only injection and recovery integration,
not the main browser.

Exact-path checks are limited to preflight confirmation that an already resolved
local value exists. Backend discovery constrains candidates to the inferred
category and intersects saved hash/size evidence. One unique in-category
size-only match is returned as a confirmation-required candidate; it is never
an automatic result. Multiple equal-sized candidates remain unresolved. A real
hash/size conflict is rejected.

## Metadata association

A Civitai `.info` record can describe multiple physical files, such as a model,
text encoder, and VAE. `get_metadata()` selects the matching `files[]` entry by
exact physical byte size. An unmatched entry may be used only when it is the sole
hash candidate. Never take the first SHA-256 or select among entries by filename.

Metadata refresh is enrichment, not identity mutation. Offline generated
metadata includes the discovered hash, but consumers still associate the record
with the current physical file through the established size/name rules; array
position is not identity.

## Deep scanning

Deep Hash Scan runs outside the aiohttp event loop and identifies a model through
the established fallback sequence:

1. use existing valid file SHA-256 metadata when the scan does not request refresh;
2. otherwise calculate the complete file SHA-256, never a ModelSpec header digest;
3. if the remote service has no record, infer a bounded local base-model family
   from tensor/header fingerprints and write offline metadata.

`model_identity.py` owns digest validation and the `anomalous_file_identity`
sidecar record: algorithm, file scope, digest, physical size/mtime, and computed
source. ModelSpec hashes may describe tensor content and are never full-file
identity ([specification](https://github.com/Stability-AI/ModelSpec)). Old locally
inferred sidecars without this record keep their display data but need an explicit
scan or successful on-demand SHA-256 check before supplying identity again.
Successful on-demand verification preserves existing notes and remote metadata.
Imported workflow provenance stays intact; it must match valid local file evidence.

Remote metadata requests are part of an explicit user-initiated scan. Local
browsing and offline inference remain usable when the service is unavailable.

Physical rename conflicts are non-destructive. If the generated target filename
already exists, hash both complete files. Deletion is allowed only when their
full SHA-256 values match. Distinct files with the same generated display name
are both preserved.

## Resolution execution

The frontend finds unresolved workflow nodes and sends provenance hash, byte
size, and inferred model category to the batch endpoint, falling back to the
single-item endpoint if batching fails. Requests are grouped by the exact model
category tuple so the backend scans each group once, but every result retains
the same hash, size, category, conflict, and ambiguity rules.

If a size-selected candidate lacks cached hash metadata, the backend may hash it
on demand. Only an exact hash match establishes identity; successful discovery
may write offline metadata for later reuse.

After a hash match—or explicit confirmation of a size-only candidate—the
frontend refreshes ComfyUI's native combo definitions and accepts the returned
path only if it is present in the target widget's choices. Then it updates the
dropdown and clears the missing-model presentation. Background checks may
surface size candidates but never prompt for or apply them.

Provenance-rich workflows skip the redundant full filename-to-hash cache refresh.
Legacy workflows without injected provenance may refresh it for compatibility.
This is an I/O optimization only and does not change identity evidence.

Civitai lookup by hash may resolve a model/version page and route mature content
to the configured domain. Hash-detail UI may compare and copy workflow and local
hash/size values. Neither presentation feature changes recovery rules.
