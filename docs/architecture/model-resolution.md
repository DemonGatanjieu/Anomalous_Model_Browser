# Model Identity and Scanning

Read this document for Model Doctor, workflow provenance, missing-model recovery,
hash caches, Civitai metadata resolution, or deep scanning.

## Identity boundary

Model Doctor recovers the same physical model referenced by provenance embedded
in a workflow or image. Local renames and path differences are the problem it
solves, so names cannot also be its proof.

Allowed automatic evidence is:

1. plugin-carried cryptographic hash;
2. exact physical byte size as the controlled fallback/disambiguator allowed by
   category policy;
3. the model category required by the target widget.

Paths, filenames, source filenames, display/custom names, previews, workflow
fingerprints, and fuzzy/visual similarity are never candidate evidence. They may
be used only after identity is established to return a local dropdown value,
locate presentation media, and verify the value against ComfyUI's native choices.

Foundation components—`vae`, `vae_approx`, `clip`, `text_encoders`, and
`clip_vision`—are hash-only recovery categories. Byte size alone cannot repair
them. A supplied hash mismatch never falls back to a filename or size-only guess.

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
category and intersects saved hash/size evidence. Ordinary categories may use
one unique in-category size match only when no hash exists; equal-sized
candidates remain unresolved. A real hash/size conflict is rejected.

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

1. read a bounded safetensors header and use an embedded SHA-256 or supported
   model hash when present;
2. otherwise calculate the complete file SHA-256;
3. if the remote service has no record, infer a bounded local base-model family
   from tensor/header fingerprints and write offline metadata.

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

After a match, the frontend refreshes ComfyUI's native combo definitions and
accepts the returned path only if it is present in the target widget's choices.
Then it updates the dropdown, clears the missing-model presentation, and marks
the node as automatically resolved.

Provenance-rich workflows skip the redundant full filename-to-hash cache refresh.
Legacy workflows without injected provenance may refresh it for compatibility.
This is an I/O optimization only and does not change identity evidence.

Civitai lookup by hash may resolve a model/version page and route mature content
to the configured domain. Hash-detail UI may compare and copy workflow and local
hash/size values. Neither presentation feature changes recovery rules.
