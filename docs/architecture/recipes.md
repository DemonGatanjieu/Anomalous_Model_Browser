# Workflow Recipes and Parameter Notebooks

Read this document for recipe schemas, cards/detail behavior, package handling,
result galleries, Parameter Notebooks, prompt roles, and the recipe-powered Node
Assistant.

## Product and data model

Workspace contains two sections: Prompt Notes and Workflow Recipes. Internal
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

The current persisted recipe schema is v5. Earlier schema steps introduced the
structural fingerprint, explicit model-reference identity records, and optional
recipe-owned preview descriptors; v5 separates model identity from editable
official-origin fields. Normal save/update paths preserve compatible imported
records rather than rebuilding identity from the current machine.

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

The detail view contains Overview, Parameters, Gallery, and Versions as
applicable. Compact cards may ellipsize bounded values while preserving their
full copy value. Detail rows provide visible expand/collapse and copy controls
for long values and prompts; they do not silently truncate authoritative data.

Model names in compact recipe presentation use a basename or official model
name, never a full filesystem path. Saved paths and hashes belong behind advanced
information. A preview or exact path can locate current-machine presentation
only after the reference is already understood; it cannot establish identity.

Import matching is a separate explicit recovery action. Unresolved references
are sent to the hash/size/category resolver. A discovered candidate remains
presentation-only until the user chooses Apply match; that action updates the
authoritative workflow widget through the full-recipe update path and archives
the previous recipe. The author's saved filename or path is never match evidence.

Recipe-owned model preview snapshots are bounded, content-addressed WebP files
below `.assets/<recipe-stem>/`. They are at most 320 px or 96 KiB each, limited
to 12 images and 1.25 MiB per save/update. Static local preview files are
accepted; original videos are never packaged, though a bound local video may
contribute a bounded first-frame thumbnail. Deleting a recipe removes only its
contained assets after the recipe file is deleted. History may share an asset
ID.

## Canvas actions

Recipe cards and details expose **Append to Canvas** as the safe composition
action. Append clones saved nodes into the current graph, assigns collision-free
IDs, remaps links, places/selects the inserted content, treats groups as
first-class items, and rolls back the complete insertion on failure. It does not
replace the current graph or mutate the saved recipe.

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
