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

The route family is:

- `POST /anomalous/inspect_image_material`
- `POST /anomalous/save_image_material`
- `GET /anomalous/materials`
- `GET /anomalous/material_full`
- `GET /anomalous/material_asset`
- `GET /anomalous/materials/by_node_type`
- `POST /anomalous/delete_material`

## Frontend ownership

`ui_materials.js` owns the Workspace library, image-inspection/save dialog,
full-workflow handoff, and library CRUD presentation. `ui_gallery.js` and
`ui_recipe_detail.js` only supply non-invasive gallery entry points. Main
Gallery retains click-to-view, drag, delete, and cover-selection behavior; the
material action appears only on hover and is hidden during cover selection.
`ui_doctor.js` owns application to the currently selected node because that
mutation already belongs to Node Assistant.

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
