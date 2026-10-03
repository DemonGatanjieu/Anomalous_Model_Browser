# Saved prompts and node values (material files)

Material files hold what the user keeps for reuse that is not a whole workflow or a
combo: saved prompts and saved node values. There is no Material Library page any
more; each kind shows where it is used:

- Prompt kinds (`prompt_plan`, older `prompt_text` / `prompt_note_bundle`, and
  selections made only of prompt nodes) are Prompt Studio's library cards
  (`prompt_material_source.js`), renamed, deleted and dragged onto the canvas there.
- Value kinds (`node_parameter_selection`, `image_node_selection`,
  `recipe_parameter_selection`) are listed per node type in Current node
  (`node_parameter_sets.js`, with the recipes' own parameter sets), applied and deleted there.
- `image_workflow_snapshot` records are whole workflows kept before recipes took over;
  the Workflows page offers to move them to recipes. Their node blocks still count as
  saved values for Current node.

Whole workflows are Workflow Recipes; a main model, LoRAs and a prompt kept together
are combos (`anomalous_notebooks`). Neither is copied into material files.

## Persistence and API ownership

`api/material_schema.py` owns record shaping, prompt-role rules and bounded
normalization; `api/material_assets.py` owns source inspection and private image
copies; `api/material_store.py` is the sole owner of persistence locking, the
summary cache, query/update/delete, and recipe-source resolution. `api/materials.py`
owns HTTP request/response mapping and narrow compatibility entry points;
`api/node_material.py` saves one canvas node's current values. Records live under
`user/<profile>/workflows/anomalous_materials`; source PNG copies and bounded
WebP previews live in a private `.assets/<material-stem>/` directory.

The backend accepts output-image descriptors only after applying the shared
filename and containment checks. It reads bounded embedded metadata, requires a
valid UI workflow, copies at most 64 MiB of source image data, validates the
graph with the Recipe workflow validator, and writes JSON atomically. List
responses omit the full workflow. The image-inspection route returns the validated
workflow plus summary node blocks for the image workbench, which keeps exact metadata
in a small 16-entry in-memory LRU. Asset reads require both a valid material record
and a contained private asset path.

Saving stages the image, preview, and JSON together below a private temporary
directory. Assets are promoted before the record becomes visible. A failed final
record commit removes only the newly promoted assets; staging is cleaned on exit.
Existing records and their images are never overwritten by this path.

Material discovery caches up to 4,096 summaries, keyed by the contained record's
real path, size, mtime, and ctime. It never caches full workflows. A directory
inventory detects additions/deletions and re-parses only changed records. Node-type
lookup filters summaries before opening matching workflows. Callers receive
independent summary copies.

`materials` accepts `q` (name, tags, or node type), `tag`, `kind`, `category`, exact
`node_type`, `page`, and `limit` (at most 100), and returns `total`, `page`, `pages`,
and the available `tags`; callers without page/limit get every summary. `category`
groups sources before pagination: `workflow` contains full snapshots; `prompts`
contains note/text/plan kinds and selections consisting only of prompt nodes;
`params` contains other node/recipe selections; `all` (the default) is every category
but `workflow`. A snapshot moved to a recipe (`mark_material_moved` records
`moved_to_recipe`; the file stays) is listed in no category. Name/tag edits use
`update_material` and atomically replace the record. Tags are trimmed, deduplicated
without case sensitivity, and limited to 20 tags of 60 characters each.

Save, edit, and delete serialize their writes within the server process. An image
save compares the source PNG SHA-256, material kind, and selected node IDs, and a
prompt plan or node values compare their content signature, against existing
summaries. A duplicate returns HTTP 409 with `status: duplicate` and the existing
name/filename, without leaving new assets; `allow_duplicate: true` creates a copy.
Deleting moves the record and its assets to the Recycle Bin.

The route family is:

- `POST /anomalous/inspect_image_material`
- `POST /anomalous/save_image_material`
- `POST /anomalous/save_prompt_plan`
- `POST /anomalous/save_node_material`
- `POST /anomalous/mark_material_moved`
- `GET /anomalous/materials`
- `GET /anomalous/material_full`
- `GET /anomalous/material_asset`
- `GET /anomalous/materials/by_node_type`
- `POST /anomalous/update_material`
- `POST /anomalous/delete_material`

`material_full?include_workflow=0` returns metadata and scoped node blocks (with
`workflow_hashes` restricted to them) and no complete workflow; `include_workflow=1`
returns the original workflow of a complete snapshot. Selected-node records never
return a full workflow and reject explicit workflow requests with HTTP 403.

## Kinds

Records declare `schema_version`, `kind`, and `capabilities`.

- `image_workflow_snapshot`: a generated PNG's complete UI workflow (no longer
  created; kept images are recipes).
- `image_node_selection`: some nodes of an image's workflow, saved from the image
  workbench (a node card, checked cards, or the generation settings). The workflow
  stays as provenance; list, count and lookup expose only the selected blocks.
- `recipe_parameter_selection`: nodes of a recipe or one of its parameter sets, saved
  before Current node listed recipe sets itself (no longer created). No image asset;
  only `apply_node_parameters`.
- `node_parameter_selection`: one canvas node's values, saved from Current node.
- `prompt_plan`: an image-free prompt with `compose_prompt` (below).
- `prompt_text` / `prompt_note_bundle`: prompts copied from Prompt Notes before combos;
  read as prompt cards (`note.promptEn`).

Prompt roles in image selections are inferred from workflow topology first, with
node-title hints as a fallback. The image workbench shows the inferred role beside
every prompt node and allows a positive, negative, shared, unknown, or ignored
override, which travels into the saved record but never writes back to a Recipe.

## Keeping an output image

The gallery's star and the image workbench's Keep (`ui_keep_menu.js`) keep an output PNG
as one of three things, each recording the image as its source: the whole workflow as a
Workflow Recipe (`recipe_save.js`, `source_image`), its main model, LoRAs and positive
prompt as a combo (`image_keep.js`; models are looked up among this computer's files with
`/anomalous/resolve_paths_to_previews`, missing ones are left out; the notebook file keeps
`source_image`), or its positive and negative prompts as a `prompt_plan` material
(`/anomalous/save_prompt_plan` stores `source.image`; the same plan saved again answers 409
with the existing one). The image's workflow is laid on a detached graph and read with
`extractRecipeMetadata`, so prompts follow the wiring as in a recipe. `GET
/anomalous/kept_images` (`api/kept_images.py`) lists each image's recipe, combo and prompt;
the star is filled when any exists, and a kept row opens it.

## Prompt plans

`prompt_plan` has no synthetic workflow. `POST save_prompt_plan` accepts a name, tags,
an optional `source_image`, and `plan`: `parts` is an ordered list of up to 100
records with `name` (up to 120 characters), `category`, `role`, `enabled`, `positive`,
and `negative`; top-level `positive` and `negative` hold the composed text. The plan
is bounded to 2 MiB; unknown fields are discarded. `material_prompt_data.js` reads
the text Prompt Studio shows: plans compose their parts, notes use `note.promptEn`,
and workflow selections use `prompt_groups`.

## Applying saved values

`node_material_actions.js` is the shared, UI-independent mutation owner. It checks
live graph/node identity, indexes, value types and native combo choices before
editing. It skips seed widgets, preserves node identity/links/position, calls the
live widget callback and four-argument node hook, and marks the graph dirty.
Values, serialized widget values and target-scoped hash evidence change in one
before/after transaction; hook failures restore their snapshots. Model paths must
already be available in the native combo. Current node writes only the values that
differ (never seeds, model files or choices this computer lacks) and shows the
receipt with Undo (`ui_apply_receipt.js`); Undo restores values only while the same
live node still holds the applied state. Material storage preserves a workflow's
`extra.anomalous_hashes`, but applying saved values leaves model files and their hash
evidence as they are; Model Check remains the authority on whether a missing model
may be repaired, and a saved name, preview, path or size is never treated as identity.

## Dragging prompts onto the canvas

Prompt Studio's cards drag onto the canvas (`prompt_card_drag.js` through
`material_drag.js`). Only an active, same-page drag is trusted; transfer data is a
marker, not an external mutation command. Over the studio drawer the drag passes
through to the assembly board. Live node lookup uses ComfyUI canvas coordinate
conversion, canvas bounds and graph hit-testing; DOM-widget surfaces are accepted,
and the graph/canvas identities captured at drag start are checked again at drop.

While a prompt is dragged (`prompt_drop.js`), every prompt box on the canvas is
outlined in its role's colour (`prompt_boxes.js`: a multiline STRING input by the
node's definition; its role is its own name or the wiring to a sampler). The box
under the pointer is the target (a node with one box needs no aim), the hint names
the node and box, and the text a release would write is laid over the box
(`.anomalous-prompt-preview`, never in the widget's value). A card fills the box with
its text as one undo step; negative text never goes into a positive box. Released on
empty canvas, a card becomes a `CLIPTextEncode` node of its role with its text. Empty
or refusing targets and cancelled drags do not change the graph; nothing queues
generation.
