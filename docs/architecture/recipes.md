# Workflow Recipes and Parameter Notebooks

Read this document for recipe schemas, cards/detail behavior, package handling,
result galleries, Parameter Notebooks, prompt roles, and the recipe-powered Node
Assistant.

## Package import/export availability

Recipe package import and export are temporarily closed pending validation.
Topbar/card/detail buttons are disabled with a localized explanation. The registered
`POST /anomalous/export_recipe_package` route returns HTTP 503 with code
`recipe_export_disabled` before reading request JSON or recipe files.
`RECIPE_PACKAGE_EXPORT_ENABLED` in `api/recipe_packages.py` is a release gate,
not a user setting. `RECIPE_PACKAGE_IMPORT_ENABLED` likewise gates both
`POST /anomalous/import_recipe_package_inspect` and
`POST /anomalous/import_recipe_package_commit`: each returns HTTP 503 with code
`recipe_import_disabled` before reading uploaded bytes, request JSON, inspection
tokens or writing files. Package format helpers remain for compatibility tests;
local saves are unaffected.

Reopening requires an explicit release decision, package round-trip and failure
validation, then restoring the frontend export action and enabling the backend
gates together. Do not reopen package transfers as a side effect of UX work. Workflow
share-code import/export is a separate, verified feature available from Toolbox.

## Product and data model

Workspace contains Prompt Notes, Workflow Recipes, and the Material Library.
Recipe Parameter Notebooks are presented as Parameter Sets (参数方案). Internal
notebook route and property names may remain stable for compatibility even when
the user-facing presentation changes.

A Workflow Recipe stores the authoritative serialized graph plus bounded
metadata for browsing and comparison. Summary adapters expose common model,
LoRA, prompt, and sampling semantics; generic bounded widget summaries cover
other nodes, including third-party nodes. Summaries are presentation only. Edit,
apply, structural validation, and detailed values resolve from the contained
serialized workflow by node ID and widget index.

The card API stays lightweight. Full workflow and history payloads are loaded on
demand. Every update archives the previous full recipe locally, bounded to 20
versions. The structural fingerprint (`sha256-structural-v1`) is an integrity
and version-comparison value, not model identity evidence.

Backend ownership is split by responsibility: `workflow_schema.py` owns graph
validation, fingerprints, signatures and integrity receipts; `recipe_schema.py`
owns recipe/model-reference normalization; `recipe_images.py` owns source images,
covers and output-gallery inspection; `recipe_store.py` owns directory, record and
history I/O. `recipes.py` maps HTTP requests and errors and retains narrow
compatibility exports only. `recipe_packages.py`, `parameters.py`, and materials
import those owners directly rather than reaching through the route facade.

The current persisted recipe schema is v7. Earlier schema steps introduced the
structural fingerprint, explicit model-reference identity records, and optional
recipe-owned preview descriptors; v5 separates model identity from editable
official-origin fields. V6 records whether the saved graph is a partial or
complete recipe. V7 adds bounded recipe-scoped model notes and makes Hash
synchronization across local matching and partial append an explicit invariant.
Normal save/update paths preserve compatible imported
records rather than rebuilding identity from the current machine. An explicit
save-time verification choice may replace missing identity with a freshly
computed SHA-256 for supported model categories.

Recipe model references separate saved identity from current-machine
availability and official origin metadata. Origin refresh is an explicit
enrichment mode. A refresh-only request clones the stored recipe before
enrichment so it cannot be rejected by complete-recipe validation or discard the
workflow. Normal updates preserve imported identity/origin records when the
current machine cannot resolve them.

## Save, edit, and presentation

Save captures the live graph exactly once before opening the dialog; that fixed
snapshot is the graph sent to the backend. The dialog records recipe identity,
notes, tags, and cover/source image. It does not ask users to select presentation
pins or a per-recipe snapshot policy. Existing `params.pinned` values survive an
edit, while new recipes use an empty list.

Before the dialog opens, an advisory check reads only the captured workflow hash
records and cached local metadata. Recognized model references without verified
identity appear as an optional action. The checkbox is off by default; enabling
it computes the exact full-file SHA-256 in a worker thread during persistence.
Foundation components such as VAE and text encoders are included because Model
Doctor requires their hash for automatic recovery and treats size-only evidence
as a manual candidate at most.
Inspection failure never blocks the workflow snapshot from being saved.

The detail view contains Overview, Parameters, Gallery, and Versions as
applicable. Compact cards may ellipsize bounded values while preserving their
full copy value. Detail rows provide visible expand/collapse and copy controls
for long values and prompts; they do not silently truncate authoritative data.

`ui_recipe_detail.js` coordinates the detail session, active tab, and model composition.
`ui_recipe_overview.js` owns the overview; `ui_recipe_parameters.js` owns prompt roles,
parameter editing, raw nodes, and preset saving; and `ui_recipe_model_matching.js`
owns preview resolution plus explicit local matching. Inline persistence is centralized
in `ui_recipe_metadata.js`, with pure ordering/value helpers in
`ui_recipe_parameter_utils.js`. The catalog shell lives in `ui_recipe_catalog.js`,
cards and card actions in `ui_recipe_cards.js`, save/edit dialogs in
`ui_recipe_dialogs.js`, and shared cover helpers in `ui_recipe_media.js`.
`ui_recipe_versions.js` owns version comparison and restore, while
`ui_recipe_gallery.js` owns result rendering and opens `ui_gallery_detail.js`
directly for image inspection. Shared detail DOM/copy primitives live in
`ui_recipe_detail_dom.js`; the subviews return refresh/finish decisions through
callbacks instead of redrawing one another.

Model names in compact recipe presentation use a basename or official model
name, never a full filesystem path. Saved paths and hashes belong behind advanced
information. A preview or exact path can locate current-machine presentation
only after the reference is already understood; it cannot establish identity.

Import matching is a separate explicit recovery action. Unresolved references
are sent to the hash/size/category resolver. A discovered candidate remains
presentation-only until the user chooses Apply match; that action updates the
authoritative workflow widget, model reference, and node-scoped Hash index
through the full-recipe update path and archives the previous recipe. The
author's saved filename or path is never match evidence. Model-reference
`user_note` is recipe-scoped presentation metadata and never match evidence.

Recipe-owned model preview snapshots are bounded, content-addressed WebP files
below `.assets/<recipe-stem>/`. They are at most 320 px or 96 KiB each, limited
to 12 images and 1.25 MiB per save/update. Static local preview files are
accepted; original videos are never packaged, though a bound local video may
contribute a bounded first-frame thumbnail. Deleting a recipe removes only its
contained assets after the recipe file is deleted. History may share an asset
ID.

## Canvas actions

Recipe cards and details expose a scope-aware canvas action. A live graph with
an active output node and no unconnected required inputs is saved as a complete
recipe and opens as a new workflow canvas. A graph without an output node or
with required connection boundaries is saved as a partial recipe and appends to
the current canvas. Append clones saved nodes, assigns collision-free IDs,
remaps links, places/selects the inserted content, treats groups as first-class
items, remaps node-scoped model Hash records, and rolls back nodes/groups/Hash
records together on failure. Legacy recipes without
scope metadata are complete recipes because earlier releases only documented
and captured complete workflows.

Structural editing is separate from composition. It may load a recipe into a new
canvas after explicit confirmation and saves back through the full-recipe update
path. It is not presented as an ambiguous “Open to canvas” recipe action.

All list/detail actions await the shared transaction before reporting success or
restoring controls. A failure must leave the button usable and the host graph in
its prior state.

## Result galleries

Recipe result discovery uses `sha256-node-types-v1`: the sorted node class
composition and count. It intentionally ignores seeds, prompts, model values,
and other parameters, so ordinary generation variations can match. This is
separate from the structural integrity fingerprint.

Opening detail scans at most the newest 200 PNG files below the ComfyUI output
directory and reads only bounded embedded `workflow` or API `prompt` metadata.
There is no persistent output index or background polling. A chosen result may
become the recipe-owned compressed cover; its original output path remains a
local convenience reference rather than package content or identity evidence.

The main output Gallery performs its page-one scan when opened and exposes a
manual Refresh action. It does not poll in the background and preserves scroll
position across manual refresh.

## Parameter Notebooks

Parameter Notebooks are immutable generation-value snapshots owned by a recipe.
Saving or updating a recipe creates a new snapshot. The Parameters tab uses a
two-pane history browser: the left pane selects a notebook and the right pane
prominently identifies the active name and timestamp. Selection requests carry a
token so an older gallery response cannot overwrite a newer selection. Parameter
result matching uses the separate `sha256-params-v1` signature.

“New parameter note” clones the selected recipe/snapshot into an editable draft
and saves a new immutable snapshot. Rename uses the dedicated parameter endpoint
and atomic persistence. Delete accepts only the validated notebook filename,
invalidates in-flight requests, reloads the list, and selects the newest remaining
note when necessary. The recipe's current baseline is not a deletable stored row.

Runtime-volatile values such as sampler seeds remain visible by field name but
their values are excluded from summaries, copying, editing, matching, and apply.
The serialized workflow retains the slots for compatibility.

“Read current and create” and “Apply to current workflow” share a skeleton
preflight. Every saved node must match a local node by type and shape, preferring
stable ID/title evidence; extra local nodes are allowed. Read-current refuses to
create a draft if the skeleton is incomplete. Apply validates all widget slots
before mutation, resolves serialized records to live nodes, invokes ComfyUI
callbacks, and rolls values back if a callback fails.

The Node Assistant queries bounded notebook presets by selected node type. Its
cache is invalidated by save/delete and bypassed by an explicit refresh. Applying
a preset is a single-node transaction; it does not apply the full workflow.

## Prompt roles

Automatic prompt roles are conservative. `recipe_parser.js` traces backward
from allowlisted official sampler/Guider conditioning inputs through allowlisted
conditioning pass-through nodes to native `CLIPTextEncode` nodes. Unknown
third-party nodes are opaque; titles, type-name guesses, prompt content, and a
default-positive rule are not semantic evidence.

Saved role metadata joins to assistant records by string-safe node ID. Legacy
recipes may recover a role only from an exact, unambiguous full prompt value in
the saved positive/negative arrays. The same value in both arrays remains
unknown.

Manual overrides live in `params.promptRoleOverrides`, keyed by string-safe node
ID and guarded by saved node type. Values are `positive`, `negative`, `both`,
`ignored`, or `unknown`. An override wins over automatic/legacy metadata; removing
it restores the saved automatic result. Updates retain it only while ID and type
still match.

## Recipe-to-model navigation

Opening a resolved local model from Recipe Overview keeps the outer browser open
and temporarily replaces all main content surfaces with model detail. A compact
return token retains the recipe payload, active tab, scroll position, and prior
Workspace return state.

Model-detail Back, or reopening Workspace and selecting Workflow Recipes,
consumes that token and reconstructs the exact recipe detail. Navigating directly
to another main panel or closing Workspace abandons the transition and clears
stale media/DOM/return state. Opening Workspace during the transition must not
overwrite the earlier outer-panel return state.

Workflow Recipes and recipe-powered Assistant parameter presets remain beta
surfaces until an explicit stability decision changes that status. Localized
notices identify their data directories and distinguish single-node preset apply
from full-skeleton Parameter Notebook apply.
