# Material Library

The Material Library is a user-curated reuse layer. It does not replace
Workflow Recipes, Prompt Notes, Node Assistant, or Model Doctor. The initial
material kind is an image workflow snapshot captured from a generated PNG that
contains a complete ComfyUI UI workflow.

## Persistence and API ownership

`api/material_schema.py` owns record shaping, prompt-role rules and bounded
normalization; `api/material_assets.py` owns source inspection and private image
copies; `api/material_store.py` is the sole owner of persistence locking, the
summary cache, query/update/delete, and recipe-source resolution. `api/materials.py`
owns HTTP request/response mapping and narrow compatibility entry points. Records live under
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
or node type), `tag`, `kind`, `category`, exact `node_type`, `page`, and `limit` (at most 100), and returns
`total`, `page`, `pages`, and the library's available `tags`. Older callers without
page/limit retain their complete summary response. Name/tag edits use
`update_material`, preserve the source workflow, and atomically replace the record.
Tags are trimmed, deduplicated without case sensitivity, and limited to 20 tags
of 60 characters each; older records without tags remain valid.

`category` groups sources before pagination: `workflow` contains full snapshots;
`prompts` contains note/text/plan kinds and selections consisting only of prompt
nodes; `params` contains other node/recipe selections. `all` is the default.
Exact `kind` remains compatible. `material_prompt_data.js` reads authoritative
detail fields for the studio: notes use `note.promptEn`, plans compose saved
parts, and workflow selections use top-level `prompt_groups`. The import drawer
pages summaries and fetches prompt text only on inspection; search covers names,
tags and node types. Side/full editors have separate view references and share
the active draft; closing or resetting their importer cancels pending requests.

Save, edit, and delete serialize their writes within the server process. Before
publishing a new record, save compares the source PNG SHA-256, material kind, and
selected node IDs against existing summaries. A duplicate returns HTTP 409 with
`status: duplicate` and the existing name/filename, without leaving new assets.
An explicit retry with `allow_duplicate: true` creates a separate copy. This is
exact-source duplicate detection, not visual similarity or model identity.

The route family is:

- `POST /anomalous/inspect_image_material`
- `POST /anomalous/save_image_material`
- `POST /anomalous/save_parameter_material`
- `POST /anomalous/save_prompt_note_material`
- `POST /anomalous/save_prompt_plan`
- `GET /anomalous/materials`
- `GET /anomalous/material_full`
- `GET /anomalous/material_asset`
- `GET /anomalous/materials/by_node_type`
- `POST /anomalous/update_material`
- `POST /anomalous/delete_material`

## Frontend ownership

`ui_materials.js` owns Workspace discovery, filters, pagination and CRUD
coordination; `ui_material_cards.js` owns summary cards; `ui_material_detail.js`
owns names/tags and full-workflow detail/handoff; `ui_material_application.js`
owns selected-node tracking and explicit application. `ui_gallery_detail.js`
owns the single image-workbench lifecycle/cache, while `ui_image_stage.js` owns
media/zoom/filmstrip interaction and `ui_image_inspector.js` owns image/node
inspection and saving. These views use `material_inspector.js` for shared metadata helpers and exact node
parameter rendering; the workbench does not import the library UI.
`ui_gallery.js` and
`ui_recipe_detail.js` only supply non-invasive gallery entry points. Main
Gallery image clicks open the focused pan/zoom viewer, while the dedicated
parameter action opens the Image Detail Studio. Drag, delete, and cover-selection
behavior remains independent of those two entry points.
`ui_node_presets.js` presents Node Assistant presets; it shares node application
with the library through `ui_material_application.js` and `node_material_actions.js`.

`ui_recipe_detail.js` can publish the active Recipe parameters or the selected
Parameter Notebook as `recipe_parameter_selection`. The primary panel saves all
reusable widget-bearing nodes; the raw-node inspector supports direct single-node
save and explicit multi-selection. Prompt cards expose the same direct save.
The backend reloads the named Recipe/Parameter Notebook from its contained user
directory instead of trusting a browser-supplied workflow.

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
above the node list. The initially hidden footer remains dedicated to the full image and
workflow snapshot rather than mixing both concepts in a scope selector. The
original workflow remains in a selected-node record as source provenance, but
list/count/lookup APIs expose only the selected blocks. Such a material
deliberately lacks `open_workflow`; the library and Node Assistant apply its
parameters to one node without opening the hidden source workflow.

The image workbench also exposes saving on its primary surfaces. The top action
reveals the full-snapshot name/tag form. One generation-settings action captures
the sampler and size nodes together; each prompt node can be saved without visiting
the all-nodes tab. A metric action is intentionally node-sized: it does not claim
to persist one isolated widget value. The former plain-text “share text” action
is not part of this workbench.

Prompt roles are inferred from workflow topology first, with node-title hints as
a fallback. Image details display the inferred role beside every prompt node and
allow an explicit positive, negative, shared, unknown, or ignored override.
Overrides travel into the saved material but never write back to a source Recipe.
Material details expose the same selector; `update_material` atomically persists
or clears these overrides, and choosing Automatic restores the topology result.

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

The currently saved kinds are `image_workflow_snapshot`, `image_node_selection`,
and `recipe_parameter_selection`. Recipe parameter materials intentionally have
no image asset and only advertise `apply_node_parameters`; they cannot replace
the canvas with the source Recipe. A prompt badge on a CLIPTextEncode selection
still describes a workflow prompt node, not a Prompt Note import. Prompt Notes use the explicit kinds described below. The `reference_image` capability currently
means a preserved image that can be viewed; copying it into ComfyUI input or
configuring LoadImage is also future work.

## Prompt Note capture and return

`POST save_prompt_note_material` accepts `notebook_filename` as a provenance
label, `name`, optional `tags`, `scope` (`note` or `prompt`), and an immutable
client snapshot in `note`. It does not use that filename to read a file. The
snapshot includes the latest text before the editor's autosave timer fires.
The server bounds it to the notebook's 2 MiB limit and retains only the supported
prompt, translation, language, base-model, main-model and LoRA fields. Model
objects remain saved selections, never identity evidence. Prompt-only capture
excludes all model fields. `promptZh` is a translation, not a negative prompt.

- `prompt_note_bundle`: entire note, translations and companion model selections.
- `prompt_text`: prompt text and translations without companion models.

Both kinds advertise `copy_prompt` and `restore_prompt_note`, contain no image
assets or synthetic workflow, and never appear in node-type lookup. Explicit
full-workflow requests return 403. Atomic creation and duplicate confirmation
reuse the image-free material writer; deduplication compares content signature
and kind. Editing a note later cannot alter its captured material.

The library copies prompt text or loads the snapshot as a newly named, uniquely
identified Prompt Note. It flushes any pending note before switching, writes the
new record successfully before navigation, and preserves both original note and
material. Canvas use remains the existing explicit Prompt Note action.

`material_feedback.js` supplies a shared save receipt with View Material.
`web/main.js` binds `openSavedMaterial` from `ui_materials.js`; it owns navigation
and workspace return state, keeping workbench imports acyclic. Image details,
recipes and Prompt Notes use that same handoff. Node-sized receipts lead to a
detail that explains reuse through the library or Node Assistant.

Primary surfaces use progressive disclosure: image save form, prompt role
selectors, technical node metadata, companion models, recipe export/source
editing, and recipe multi-selection are revealed on request. Parameter-page
metrics appear once with exact-value copy controls. Display wording is Parameter
Sets (参数方案); existing notebook routes and storage identifiers stay stable.


## Entry points and shared application

The lower-left control opens a standalone Material Library container, with no
workspace tabs and no initial Prompt Note fetch. The upper-right control opens
Workflow Recipes; that workspace retains its Recipes and Prompt Notes tabs.
Both containers share the browser's panel area but have separate headers and
lifecycle state; switching restores the appropriate container. Material Library
file import and its transfer-center entry are closed. It has no independent
image-material bundle exporter. The verified workflow share-code Import / Export
Center lives in Toolbox. Recipe package import/export remains paused, while prompt-plan
JSON export has been removed. Local capture/save actions remain available.

Opening the library with exactly one live selected node enables apply mode.
Summary requests filter by exact `node_type`; activating a card fetches only that
material's scoped detail. No selection means normal detail browsing. An explicit
toggle returns to browsing all materials; prompt-only kinds also use browse mode.
Multiple source blocks of the same type require choosing one block. The full
workflow quick-open button is omitted from apply-mode cards.

`node_material_actions.js` is the shared, UI-independent mutation owner. It checks
live graph/node identity, indexes, value types and native combo choices before
editing. It skips seed widgets, preserves node identity/links/position, calls the
live widget callback and four-argument node hook, and marks the graph dirty.
Values, serialized widget values and target-scoped hash evidence change in one
before/after transaction; hook failures restore their snapshots. Model paths must
already be available in the native combo. This path does not invoke global model
repair after application. Hash transport remains evidence, never verification.

`material_full?include_workflow=0` includes `workflow_hashes` restricted to returned
blocks, without exposing the hidden workflow. Both library and assistant show the
same application receipt. Undo restores values and scoped hashes only while the
same live node, values, serialized values and target hashes still match the applied
state. Later edits are protected. Unsupported third-party widget side effects
still require real-host compatibility testing.

Selection hooks chain the host's callbacks and batch updates in a microtask;
there is no polling. List browsing retains 48-item pagination and cancellation.
Language changes rebuild visible library/composer text while keeping the current
draft. Node labels reuse ComfyUI's registered localized titles with raw type fallback.

## Prompt combinations

`prompt_plan` is an image-free material with `compose_prompt` capability and no
synthetic workflow. `POST save_prompt_plan` accepts a name, tags, and `plan`:
`parts` is an ordered list of up to 100 records with `name` (up to 120 characters),
`category` (`general` or `specific`), `enabled`, `positive`, and `negative`.
Top-level `positive` and `negative` hold prompt text. The plan is bounded to
2 MiB; unknown fields are discarded. Atomic writes and explicit duplicate-copy
confirmation reuse the material persistence lock and canonical content signature.

The current panel has simple positive/negative text fields and a beginning/end
drop-position selector. Fragment categories, ordering and enable controls are
deferred. Opening an older plan joins its enabled fragments and final content
into those two fields; a new save has empty `parts`, leaving the original record
intact. Text insertion preserves weights, commas, duplicates and original nonblank
string whitespace. A Prompt Note's `promptZh` translation is never inferred as
negative text. Captured notes and classified workflow prompt groups can populate
the fields; unknown workflow roles are not silently assigned a role.

Saving creates an independent new snapshot. Studio source cards automatically
follow library changes; assembled draft blocks remain independent copies without
model binding. A page-session draft survives library navigation and is replaced
by an existing saved plan only after confirmation; it must be saved before page
reload. Stale detail requests cannot replace the current draft. Standalone JSON
export has been removed, and the file-import entry is closed. The shared save
endpoint still supports local combination saves. The panel also exposes role and target-widget selection,
beginning/end buttons for a selected node, copy controls and guarded undo.

## Canvas drag and drop

`material_drag.js` binds native drag handles to all material cards and to each
prompt field's drag button (`bindPolymorphicMaterialCardDrag`). Only an active,
same-page drag is trusted; transfer data is a marker, not an external mutation
command. During drag, the browser window becomes transparent and stops intercepting
pointer events. End, drop, Escape and loss of focus restore it and remove temporary
event listeners. There is no persistent drag polling or detail request during hover.

Hit testing evaluates live node target acceptance before canvas blank surface drop.
Because nodes sit on the canvas element, testing canvas surface first would hijack
node drops; evaluating `accepts(node, data)` first guarantees node targeting takes
precedence. Live node lookup uses ComfyUI canvas coordinate conversion (including pan/zoom),
canvas bounds, and graph node hit-testing. DOM-widget surfaces are accepted. The
graph/canvas identities are captured at drag start and checked again at drop. The actual
drop node is the target, regardless of the previously selected node. Receipts name
that target and provide the shared guarded undo.

When dropped onto a compatible node:
- Parameter-bearing materials fetch scoped node blocks only after drop and replace
  compatible widget values through the transactional parameter path, preserving seed,
  node position, and links.
- Prompt materials inject prompt text into target nodes via semantic prompt widget
  sniffing (`customtext`, `multiline`, `text_g`, `text_l`, `prompt`, `positive`,
  `negative`, and localized labels), relaxing strict node-type matching for third-party
  text nodes. Text is cleanly inserted without synthetic prefixes ("负向:" / "正向:").

When dropped onto blank canvas:
- Workflow materials (`image_workflow_snapshot`) trigger full workflow loading
  via `openMaterialWorkflow`.
- Prompt materials (prompt notes, prompt plans, prompt node selections) auto-instantiate
  native `CLIPTextEncode` nodes at canvas drop coordinates, populating the pure prompt
  text, setting bilingual titles (`CLIP Text Encode (Negative/Positive)` /
  `CLIP 文本编码器 (负向/正向)`), and applying standard LiteGraph dark theme colors
  (`#532323` dark red for negative, `#235327` dark green for positive).

Empty/unsupported targets and canceled drags do not mutate the graph. Neither drop path
queues generation.
