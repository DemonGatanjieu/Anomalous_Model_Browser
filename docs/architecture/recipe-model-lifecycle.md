# Workflow Recipe Model Lifecycle

Read this document before changing Workflow Recipe model cards, local matching,
partial-canvas append, package export, or Model Doctor integration. UI code may
change freely, but the data ownership and transition rules below are contracts.

## Three representations with different jobs

A saved recipe keeps model information in three related representations:

1. `workflow.nodes[].widgets_values[]` is authoritative for the value ComfyUI
   will load into a model widget.
2. `params.model_references[]` is the structured recipe record used by the UI,
   package system, history, and matching actions.
3. `workflow.extra.anomalous_hashes` is Model Doctor provenance keyed to the
   serialized node ID and widget value.

Changing only one representation creates a broken recipe. A path change must
update the workflow widget, its model reference, and its node-scoped Hash key in
the same recipe update. A partial append must remap the Hash key alongside the
node ID. Presentation fields must never become identity evidence.

## Schema v7 model reference

`params.model_references[]` contains these persisted fields:

- `node_id`, `node_type`, `node_title`: serialized graph location and display
  context;
- `widget_index`, `widget_name`: authoritative widget slot;
- `saved_value`: exact dropdown/path value stored in the workflow;
- `category`, `base_model`: bounded matching and presentation context;
- `identity`: `status`, optional SHA-256, optional byte size, and provenance;
- `origin`: editable official-source metadata, independent of identity;
- `preview`: optional recipe-owned bounded snapshot descriptor;
- `user_note`: optional recipe-scoped personal note, at most 1000 characters.

`user_note` is not global model metadata, is not used for matching, and does not
change Model Doctor confidence. Enrichment preserves it by the complete model
reference key. Package export explicitly asks whether to include it; excluding
it removes the field only from the exported current/history records.

Runtime-only fields such as `localModel`, `localMatch`,
`currentAvailability`, and `currentPreviewUrl` must not be persisted as schema.

## Hash record shape and keys

The canonical record is compatible with:

```json
{
  "hash": "lowercase SHA-256 or an empty string",
  "size": 123456
}
```

Node-scoped keys use `<node_id>_<saved_widget_value>`. Slash-normalized aliases
may coexist for Windows compatibility. Readers check node-scoped keys first;
global path aliases are legacy fallback only and must not be relied on when
mutating a recipe.

Graph serialization prefers current verified local-cache data. When a widget
value is still missing—or no current cache record exists—it must preserve the
node-scoped provenance already carried by the graph. Clearing it would make a
successfully appended partial recipe lose its Model Doctor identity on the next
save.

An empty Hash with a known size represents unverified provenance. It may produce
a manual same-size candidate, but never an automatic repair. A Hash copied from
the original recipe must not be attached to a size-only candidate.

## Lifecycle transitions

### Save and update

The frontend captures the graph once. The backend validates it, derives model
references, preserves compatible identity/origin/preview/user-note fields, and
writes schema v7 atomically. Optional save-time verification may calculate a
full SHA-256. Normal enrichment does not silently replace imported identity.

### Availability and local matching

Availability and previews describe the current computer only. Matching sends
saved Hash/size/category evidence to Model Doctor:

- exact Hash match: may be offered for explicit recipe application;
- unique size-only match: confirmation-required candidate;
- Hash/size conflict: rejected;
- ambiguity: unresolved.

Finding a candidate is presentation-only. The recipe is not changed until the
user activates its Apply/Confirm action.

### Apply local match

One full-recipe update performs all of these changes together:

1. replace the target `widgets_values[widget_index]` with the local dropdown
   value;
2. replace `model_references[].saved_value` and its identity;
3. update `params.baseModel` when it held the same old value;
4. remove old node-scoped Hash aliases and write aliases for the new value;
5. archive the previous recipe through the normal update endpoint.

For a Hash match, the stored local identity retains the proven SHA-256. For a
manually confirmed size candidate, use a valid Hash from the local candidate's
metadata when available; otherwise store size-only unverified provenance. The
author's editable `origin` and the recipe-scoped `user_note` remain intact.

### Apply to canvas

Complete recipes pass their cloned workflow to ComfyUI, so the contained
`extra.anomalous_hashes` opens with the new workflow canvas.

Partial recipes are a merge transaction. New collision-free node IDs are
allocated, links and groups are restored, and node-scoped Hash records are
copied under the new IDs without deleting current-canvas records. If any part
fails, inserted nodes/groups and the previous Hash map are restored together.

### Export and import

Export choices independently control preview snapshots, history, model
identity, and personal model notes. Removing identity or notes sanitizes only
the package clone. Import validates the contained recipe and assets, then uses
the same normalization and enrichment boundaries as local recipes.

## Implementation map for UI refactors

- `api/recipes.py`: schema validation, enrichment, field preservation, history;
- `api/recipe_packages.py`: export privacy and package boundaries;
- `api/models.py`: Model Doctor evidence and candidate policy;
- `web/modules/recipe_identity.js`: model-reference adapters for presentation;
- `web/modules/recipe_provenance.js`: pure Hash lookup/remap/replace helpers;
- `web/modules/recipe_actions.js`: canvas transactions and append rollback;
- `web/modules/ui_recipe_detail.js`: user actions that invoke the contracts;
- `web/modules/ui_recipes.js`: save/import/export orchestration;
- `web/modules/recipe_diff.js`: history-visible semantic changes.

When restructuring UI, call these data functions rather than recreating Hash
keys, matching confidence, or append behavior inside components. Filenames,
notes, previews, and official names must never be promoted to identity proof.
