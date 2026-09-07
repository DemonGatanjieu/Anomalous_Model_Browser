# Material Library

The Material Library is a user-curated reuse layer. It does not replace
Workflow Recipes, Prompt Notes, Node Assistant, or Model Doctor. The initial
material kind is an image workflow snapshot captured from a generated PNG that
contains a complete ComfyUI UI workflow.

## Persistence and API ownership

`api/materials.py` owns material validation, persistence, asset serving, and
node-type lookup. Records live under
`user/<profile>/workflows/anomalous_materials`; source PNG copies and bounded
WebP previews live in a private `.assets/<material-stem>/` directory.

The backend accepts output-image descriptors only after applying the shared
filename and containment checks. It reads bounded embedded metadata, requires a
valid UI workflow, copies at most 64 MiB of source image data, validates the
graph with the Recipe workflow validator, and writes JSON atomically. List
responses omit the full workflow. The explicit image-inspection route returns
the validated workflow plus summary node blocks only after the user opens one
image detail. This lets the workbench display exact `widgets_values`, bounded
node `properties`, mode, and volatile widget indexes without allocating a
second full-PNG buffer in the browser. Direct PNG parsing remains a temporary
compatibility fallback for an older running backend. Exact metadata is kept in
a small 16-entry in-memory LRU, and duplicate workflow/widget fields are
discarded before caching. Local-model preview resolution is deferred until the
Models tab is opened and then cached with that image's metadata. Asset reads
require both a valid material record and a contained private asset path.

Saving stages the image, preview, and JSON together below a private temporary
directory. Assets are promoted before the record becomes visible. A failed final
record commit removes only the newly promoted assets; staging is cleaned on exit.
Existing records and their images are never overwritten by this path.

Material discovery caches up to 4,096 summaries, keyed by the contained record's
real path, size, mtime, and ctime. It never caches full workflows. A directory
inventory detects additions/deletions and re-parses only changed records. Node-type
lookup filters summaries before opening matching workflows; asset authorization
uses the same validated summary cache. Callers receive independent summary copies.

The library requests 48 summaries per page. `materials` accepts `q` (name, tags,
or node type), `tag`, `kind`, `page`, and `limit` (at most 100), and returns
`total`, `page`, `pages`, and the library's available `tags`. Older callers without
page/limit retain their complete summary response. Name/tag edits use
`update_material`, preserve the source workflow, and atomically replace the record.
Tags are trimmed, deduplicated without case sensitivity, and limited to 20 tags
of 60 characters each; older records without tags remain valid.

Save, edit, and delete serialize their writes within the server process. Before
publishing a new record, save compares the source PNG SHA-256, material kind, and
selected node IDs against existing summaries. A duplicate returns HTTP 409 with
`status: duplicate` and the existing name/filename, without leaving new assets.
An explicit retry with `allow_duplicate: true` creates a separate copy. This is
exact-source duplicate detection, not visual similarity or model identity.

The route family is:

- `POST /anomalous/inspect_image_material`
- `POST /anomalous/save_image_material`
- `GET /anomalous/materials`
- `GET /anomalous/material_full`
- `GET /anomalous/material_asset`
- `GET /anomalous/materials/by_node_type`
- `POST /anomalous/update_material`
- `POST /anomalous/delete_material`

## Frontend ownership

`ui_materials.js` owns the Workspace library, filters, pagination, editable
names/tags, full-workflow handoff, and library CRUD presentation.
`ui_gallery_detail.js` owns image inspection and image/node saving.
Both use `material_inspector.js` for shared metadata helpers and exact node
parameter rendering; the workbench does not import the library UI.
`ui_gallery.js` and
`ui_recipe_detail.js` only supply non-invasive gallery entry points. Main
Gallery retains click-to-view, drag, delete, and cover-selection behavior; the
material action appears only on hover and is hidden during cover selection.
`ui_doctor.js` owns application to the currently selected node because that
mutation already belongs to Node Assistant.

Material cards remain compact, summary-only discovery items. “View Details”
switches the library itself to a master-detail inspector: a contained reference
image stays on the left, while scope, model references, and reusable node blocks
are grouped on the right; exact widget values remain nested under each node.
Only the opened material fetches `material_full?include_workflow=0`: metadata and
scoped node blocks, with no complete source workflow. Only prompt cards initially
expand; other node cards build their parameter DOM on first expansion and reuse
it on later toggles. Expand/collapse-all follows the actual card state. Selectable
cards in the image workbench remain closed initially.
Returning to the list aborts
an unfinished request and releases the detail payload/DOM so browsing never
accumulates full workflows in browser memory.

Opening a complete snapshot explicitly requests `include_workflow=1`, which
returns the original workflow and an empty `node_blocks` array to avoid duplicate
widget payloads. The original seed and hash evidence remain intact. The server
reads, shapes, and serializes these responses in a worker thread. Selected-node
records filter before copying widget values; they never return a full workflow
and reject explicit workflow requests with HTTP 403. For legacy callers, omitting
the flag retains both workflow and node blocks for complete, openable snapshots.
Only `0`, `1`, or an omitted flag are accepted.

Search is debounced and each list request cancels its predecessor. Changing a
filter resets the page; returning from detail preserves the current filters.
Card activation supports Enter/Space as well as mouse clicks. A name/tag edit
refreshes summary cards and filter choices. Shared confirmation dialogs sit above
the image workbench, whose keyboard shortcuts yield while a dialog is open.

A full material workflow is exact and retains its seed. Node-sized reuse is a
preset operation and therefore uses the existing transactional parameter
application path, which skips known volatile seed widgets. The lookup endpoint
filters blocks by exact `node.type`; when more than one source node matches, the
user chooses the block explicitly.

Every node card in the image workbench can be saved directly as an
`image_node_selection`; checking several cards exposes one colocated save action
above the node list. The sticky footer remains dedicated to the full image and
workflow snapshot rather than mixing both concepts in a scope selector. The
original workflow remains in a selected-node record as source provenance, but
list/count/lookup APIs expose only the selected blocks. Such a material
deliberately lacks `open_workflow`; it is consumed from Node Assistant instead
of unexpectedly replacing the canvas with the hidden source workflow.

## Model identity handoff

Material storage preserves the workflow's existing `extra.anomalous_hashes`.
When one node block is applied, records scoped to the source node ID are copied
to the target node ID. This is evidence transport, not identity resolution.
Model Doctor remains the authority that decides whether a missing model may be
repaired. A material name, preview, saved path, or size is never promoted to
cryptographic identity.

## Compatibility and future material kinds

Records declare `schema_version`, `kind`, and `capabilities`. New sources such
as Recipe selections and Prompt Note blocks should add explicit kinds or
source metadata without weakening the image snapshot contract. Existing direct
Recipe and Prompt Note use paths remain available; the library is optional
curation rather than a mandatory intermediary.

The currently saved kinds are `image_workflow_snapshot` and
`image_node_selection`. A prompt badge on a CLIPTextEncode selection describes
an image's prompt node, not a Prompt Note import. Direct Recipe parameter and
Prompt Note capture remain unimplemented. The `reference_image` capability
currently means a preserved image that can be viewed; copying it into ComfyUI
input or configuring LoadImage is also future work.
