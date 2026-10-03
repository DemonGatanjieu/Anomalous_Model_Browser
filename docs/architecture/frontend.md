# Frontend Architecture

Read this document for changes under `web/`, browser entry modes, panel state,
localization, media, or explicit canvas mutations.

## Bootstrap and module ownership

The verified AMB0/AMB1 workflow share-code Import / Export Center is available
from the Workflows page's top bar (⇅) through `window.AMB_WorkflowShare.showUnifiedModal()`. Both directions
are enabled by explicit product decision. It is independent of the paused Recipe
package import/export and closed Material Library file import. Image/workflow hash
injection, host saving, and ordinary image downloads remain unchanged.

ComfyUI loads JavaScript in the extension `WEB_DIRECTORY` as ES modules.
`web/main.js` registers `Anomalous.ModelBrowser` and coordinates host hooks.
`browser.js` defines the browser class and binds extracted feature methods;
`browser_entry.js` owns the single browser instance and all entry presentation,
including `window.anomalous_open_voice(character)`, which the Anomalous_TTS node's
character menu calls to open one character's voice card (`browser.openVoice`; the
node pack documents it in its `docs/INTERFACE.md` §6);
`interface_settings.js` owns locale and theme preferences. A syntax error or duplicate
top-level declaration in any imported module can prevent registration and make
the entire entry disappear. For affected modules, validate syntax and module linking
via Node's experimental VM modules (`vm.SourceTextModule`) and verify
the real ComfyUI runtime creates the configured entry. Floating trigger styling in
the ordered stylesheet bundle rooted at `web/styles.css` uses dynamic `1em` SVG
scaling and flex centering to guarantee
consistent visual presentation across all configured trigger sizes. The unsaved
default position is defined in CSS outside the sidebar dock; `browser_entry.js`
drags with pointer capture and only persists real drags, and `entry_controls.js`
validates and clamps saved coordinates (`clampFloatingTriggerPosition`). Resetting
the position clears the saved coordinates so the CSS default applies again.

Web modules are imported by plain relative paths. Do not add `?v=` query strings to
module imports: a different URL is a second module instance with its own state.
Freshness comes from the `Cache-Control: no-cache` header on this plugin's files.

Major UI panels live in `web/modules/ui_*.js`. Shared browser state remains on
the `AnomalousBrowser` instance. Pure parsing, normalization, comparison, and
transaction helpers remain in focused modules rather than acquiring DOM state.

`ui_sidebar.js` assembles the browser window and the model folder list; the left
icon rail (`ui_shell_rail.js`), page navigation and the list column's open state
(`ui_shell_nav.js`), the home page (`ui_home.js`) and the window frame
(`ui_shell_frame.js`) are their own modules. Every page change goes through
`owner.goTo(page)`. `ui_settings_hub.js` owns the display preferences behind
`owner.displayPrefs`, which the settings page (`ui_settings_page.js`) changes,
while `ui_rail_tools.js` owns the rail's tool buttons.
The Material Library shortcut remains a native ComfyUI command/keybinding; a
deferred window-key fallback invokes the same command path only when the host
did not bring the library forward, so handled shortcuts are not executed twice.
`ui_browser_navigation.js` owns shared panel hiding, recoverable detail cleanup,
and workspace return. `ui_scan_page.js` owns the scan page and `scan_runner.js` scan launch and polling,
`ui_folder_manager.js` is the settings page's Model folders view (grouping mode,
visibility and order, saved on each change). Public entry functions remain
browser-instance methods so existing actions share current browser state.

Update-guide content and UI lifecycle are separate modules. The header and Help
open it only on explicit user action; browser close disposes it. Read
[update-guide.md](update-guide.md) before changing guide IDs, steps, persistence,
or sidebar icon/label transitions. Do not embed guide logic in the main/sidebar
bootstrap or reuse its content version as a feature flag.

The main surfaces are:

- Sidebar shell: navigation and persistent scan controls; focused child modules
  own the scan page, folder manager, and help dialog.
- Grid and model detail: model browsing plus coordinated detail display in
  `ui_detail.js`, metadata editing in `ui_model_editor.js`, and advanced selection
  in `ui_model_selector.js`.
- Gallery: generated outputs and the full-screen Image Detail Studio Workbench.
  `ui_gallery_card.js` builds each output's card; its star and the workbench's Keep open
  `ui_keep_menu.js`, which keeps the image as a Workflow Recipe, a combo or its prompts
  (`image_keep.js`; `GET /anomalous/kept_images` says what each image was kept as).
  `ui_gallery_detail.js` owns its singleton lifecycle and cache, `ui_image_stage.js`
  owns header/zoom/filmstrip interaction, and `ui_image_inspector.js` owns metadata tabs.
- Workspace: Combos (搭配, formerly Prompt Notes), Workflow Recipes, and the Material
  Library. The combo list, workspace/persistence, editing, and canvas use are separated
  across `ui_combos.js`, `ui_notebooks.js`, `ui_notebook_editor.js`, and
  `notebook_canvas.js`; Use puts a combo into the open workflow when the canvas has a
  main model loader (`notebook_apply.js` plans and makes the change: reads the canvas
  first, writes one Ctrl+Z step) and builds a new group of nodes when it has none. Material
  discovery/pagination, cards, detail, and node application are separated across
  `ui_materials.js`, `ui_material_cards.js`, `ui_material_detail.js`, and
  `ui_material_application.js`.
- Current node (Node Assistant)/Model Check: selected-node actions, saved parameters, and
  missing-model recovery. `model_check.js` decides each workflow model's state and
  applies fixes; `ui_doctor.js` (the page) and `ui_doctor_banner.js` (the bar shown
  after a workflow opens) only render it and call it on a press.
  `ui_node_assistant.js` owns the current-node panel and model history, `ui_node_model_picker.js`
  owns the native-widget model replacer, and `ui_node_parameters.js` with
  `node_parameter_sets.js` own the panel's one list of saved values for the node type.

`ui_dom.js` owns generic `text` and `jsonResponse` helpers.
`material_inspector.js` shares image metadata helpers and node-parameter rendering
between the material and image-inspector modules. The workbench does not import
the library UI, keeping this dependency chain acyclic. Library discovery uses
server-side filters and pages with cancellable requests. Detail entry fetches
metadata and scoped node blocks; the complete workflow loads only on the explicit
open action. See `material-library.md` for the API and persistence contract.

## Entry modes and host integration

One shared `openBrowser()` command backs the floating trigger, ComfyUI action-bar
button, and `Extensions -> Anomalous Model Browser` command. Entry presentations
are mutually exclusive and reuse the same browser instance. The Extensions
command remains available as a recovery path in every mode.

Native commands own the default `Ctrl + Shift + M` browser binding and the
`Ctrl + Shift + L` Material Library binding. Shortcut customization delegates
to ComfyUI's command/keybinding panel and recorder; the plugin does not install
a parallel global keyboard listener or maintain a second shortcut preference.

Language changes replace the registered Interface setting descriptors with
freshly translated copies. ComfyUI's reactive settings tree therefore updates
the open category heading, labels, tooltips, custom controls, and combo options
immediately without requiring a page refresh.

Hidden reusable dialogs must not advertise an active modal state. In particular,
`aria-modal` is `true` only while the dialog is visible, so ComfyUI's global
modal guard does not suppress unrelated host shortcuts.

## Panel and lifecycle state

Main content surfaces are exclusive. Opening one must hide or clean the surface
it replaces, while preserving only the state required for an explicit return
path. Search from the sidebar exits model detail and shows the grid. Workspace
records the previously visible main-browser panel and restores it on close,
falling back to the grid when the prior state is unavailable.

Recipe-to-model navigation is a special recoverable transition described in
`recipes.md`. It keeps the outer browser open and must not call the browser-wide
`close()` lifecycle.

Grid folder navigation removes old content rather than accumulating hidden
grids. Before removing DOM that contains video or audio, pause the media and
release sources where applicable. Closing the browser aborts active listing,
disconnects observers, pauses media, and releases grid video/audio sources.
Lightweight cards may remain warm for 90 seconds, after which card DOM and model
payloads are released. A new listing cancels the previous request and render
generation.

The full ordered model result remains available, but cards are created in
bounded animation-frame chunks. Images use lazy loading and async decoding.
Grid video sources are attached only near the viewport and then follow the
configured `always` or `hover` behavior with muted, loop, and plays-inline
attributes.

When identifying video media from a served URL, inspect the full URL with a
query-aware extension test such as `/\.(mp4|webm)(?:$|\?|&|#)/i`. Do not use
`new URL(url).pathname`, because the backend may put the actual filename in a
query parameter.

## Model source component links

The Sources view (`ui_model_sources.js`, data in `model_source_links.js`) uses
`inferModelFolderTypes` for workflow component labels and
category-scoped, exact-path local metadata reads. Context requests are batched
to respect the endpoint's 16-item limit. Missing source links and unavailable
native model choices are independent states; dynamic choices are not treated
as evidence of absence. Native extensionless component choices and PTH/GGUF
references remain visible even when the backend cannot locate an individual file.

`model_source_data.js` owns library-result shaping and the Sources view's pure
main/component grouping and filtering. CLIP, text encoder, CLIP Vision, VAE, and
preview-VAE entries live in a session-local, default-collapsed disclosure; the
source-status pills and search affect both main models and components. Collapsed
component rows are not constructed. Main-model completion statistics exclude
optional component links, while the disclosure's missing-local count describes
only the currently filtered component matches.
Legacy Civitai placeholder links with non-positive model IDs are normalized to
an unfilled source before grouping, so offline inference records remain visible
under the source-needed filter.

Workflow save and Note generation always receive the complete workflow model
set; summary copy receives only the visible rows. Such links may be saved to the
workflow, but component sidecar writes require a resolved local target. Opening,
filtering, and expanding the hub do not initiate cloud scans, hash calculation,
or sidecar writes, and do not change graph/model identity recovery rules.

## Localization and DOM safety

`web/modules/locales.js` is the canonical catalog for user-visible runtime
strings. Resolve strings at render time through the shared translator. Chinese
and English dictionaries keep identical key sets, have no duplicate keys, and
cover all statically referenced translation keys.

Dynamic filenames, paths, model names, node types, counts, and user-authored
content remain parameters rather than dictionary entries. Insert untrusted text
with `textContent` or escaping. Only fields intentionally supporting trusted
formatting may pass through `setSafeRichHtml()` in `safe_dom.js`; never assign
metadata directly to `innerHTML`.

Persistent localized nodes that survive a language change carry an i18n key and
are refreshed in place or rebuilt from current state. Missing translation data
must not prevent a panel or action from rendering.

Scope plugin DOM IDs and CSS classes with `anomalous-`. Before introducing a
dynamic ID, search `styles.css` for collisions. Follow the established z-index
tiers and ensure a child modal sits above the parent that would otherwise consume
its clicks.

## Graph and widget mutation rules

Explicit graph mutations are transactional. Validate the entire intended change
before mutation, wrap it in `graph.beforeChange()` / `graph.afterChange()`, and
restore prior nodes, links, and widget values if any operation or callback fails.
A successful change marks graph and canvas dirty and emits the host change event
expected by dependent surfaces.

Partial Recipe Append clones serialized nodes, remaps IDs and links, supports
groups, and rolls back everything it created on failure. It never calls
`loadGraphData` on the live graph and rejects unsupported subgraph definitions
until they have a complete remapping path. Complete recipes use
`loadGraphData` intentionally so ComfyUI owns new-workflow canvas creation.

`graph_splice.js` handles deliberate MODEL/CLIP insertion. It analyzes declared
port types rather than slot indexes or display names. Ambiguous downstream
fan-out is rejected until a user can choose a branch. Picker candidates come
from the target widget's native combo values; metadata may filter or decorate
that set but may not introduce foreign category values.

Parameter application resolves a serialized match back to a live ComfyUI node
before accessing widgets or callbacks. It validates all target slots first,
skips volatile values, and calls the host's widget hooks with the current
four-argument contract. Serialized workflow records are never treated as live
widget objects.

## Optional capabilities

`web/hash_resolver.js` keeps the local hash cache and may hook a compatible graph
serializer to carry model provenance. If the host API is unavailable, it disables
only that integration with a useful warning. It must not prevent `main.js` from registering or remove
the visible browser entry.

Network-backed enrichment is explicit and recoverable. An unavailable Civitai
or translation service may produce a local error state; it must not block local
browsing, editing, or already stored data.

## Prompt Studio ownership

The studio supports copying prompt text and saving combinations to the local
Material Library. Standalone prompt-plan JSON export has been removed and the
Material Library file-import entry is closed.

Source cards automatically refresh on studio open, browser focus/visibility, and
every 30 seconds while the page is visible (scheduled after the previous request).
Saving a studio combination also refreshes immediately. `sourceKind: 'material'`
cards are reconciled by filename and role from a complete paginated snapshot;
renames/content edits replace them and deleted sources disappear. Failed or
cancelled reads retain existing cards. Equal text from different sources retains
each source identity. Built-in and unsaved local cards remain independent.
Library cards are saved prompts: their preview renames one (`update_material`, tags kept)
or deletes it (`delete_material`, to the Recycle Bin; both of its role cards go), then the
deck syncs. Any card with text can be dragged out of the drawer onto a canvas prompt box
or empty canvas (`prompt_card_drag.js`, one undo step); the same drag over the drawer is
left to the assembly board. Mixer blocks are editable copies; refreshing sources must not
modify existing drafts.
The deck owns its refresh timer, listeners and AbortController and releases all
of them when its view closes. New-card role is supplied by the workbench callback.

The studio has one standalone drawer; the former embedded side/full composer
and material import drawer are removed. Existing browser integration continues
to call `openPromptStudio(owner)`, and external prompt dispatch uses
`appendPromptToStudio(owner, text, isPositive, title)`.

| Module | Owned state and responsibilities |
| --- | --- |
| `ui_prompt_composer.js` | Active drawer, docking width/side, trigger visibility and plan-loading request |
| `ui_prompt_workbench.js` | Owner-backed draft, active role, block editing, ordering, write/copy/save |
| `ui_prompt_source_deck.js` | Source cards, filters, new-card form, rename/delete of saved prompts and current sync request |
| `ui_prompt_card_popover.js` | Card preview: hover corridor, pin, copy/add/rename/delete actions |
| `prompt_card_drag.js` | A card dragged onto the canvas: box fill or new prompt node, passing through the drawer |
| `ui_prompt_inspector.js` | Full-text inspection window, role tab and its translation lifetime |
| `prompt_studio_data.js` | Starter cards, display categories, draft/block initialization and synthesis |
| `prompt_composition.js` | Pure plan conversion, sorting and composition; no DOM ownership |
| `prompt_material_source.js` | All-page prompt discovery, detail loading and reconciliation by source identity |
| `ui_lifecycle.js` | View-scoped listeners, AbortSignal, cleanup callbacks and resizing |

Child views receive their container and narrow callbacks. The workbench keeps
`owner.promptPlanDraft` for reopening and exposes only `updateAll` / `addBlock`
through `owner.sidePromptComposerControl`. The source deck keeps its state local
and returns extraction/refresh/sync actions instead of assigning new owner fields.

Draft `plan.parts` is the authoritative editable representation. Full-text
inspector edits merge the enabled blocks in the edited role into one block,
preserving disabled blocks and the opposite role. The inspector explains this
behavior before editing. Copy, save and reopen derive text from the same parts.

Every close route (button, Escape, backdrop, replacement and parent close) must
dispose the same view scope. Parent close also closes its inspector. An Escape
handled by an inspector must not close its parent in the same event dispatch.
Closing during resize releases move/up listeners and restores body cursor and
selection styles. UI reads are cancelled on close; a save already sent to the
server may still complete, but must not reopen or repaint a disposed view.

Initial and automatic source synchronization share a paginated loader. List
summaries are identifiers, not prompt bodies: each unique filename is resolved
through `material_prompt_data.js`. Reconciliation uses source filename and role,
so equal text from different materials retains each origin. A newer sync cancels the old
one and only the current result updates the deck.

Translation in the current-node panel (`ui_node_prompts.js`) captures the node,
the prompt box's widget and its text before the request, and writes only when the
same widget still holds the same text; a closed panel or an edited box drops the result.
Explicit English translation applies to all input languages, including kana
and Korean. Transport errors and rejected bridge responses remain local errors;
provider-specific validation belongs to the backend translation route.

## Visual styling and theme architecture

`styles.css` is the single external entry and ordered import manifest for current
visual values. Its `web/styles/00-*.css` through `10-*.css` children preserve the
original cascade order; every child import carries the same cache version so an
entry-cache hit cannot leave stale child rules. `tests/css_bundle_order.mjs`
guards the unique ordered list and byte-for-byte reconstructed bundle. Shared `--amb-*`
tokens express surfaces, text, borders and control shapes; theme overrides must
be scoped to `.theme-abyssal-scarlet` rather than changing unrelated surfaces.

Colours come from the tokens in `00-foundation-models.css`, which both themes define:
surfaces (`--amb-bg-page`, `-panel`, `-card`, `-card-hover`, `-input`), text
(`--amb-text-main`, `-soft`, `-muted`, `-dim`), borders (`--amb-border`, `-strong`,
`-hover`), the primary button (`--amb-btn-primary-*`) and one accent, `--amb-link`, for
links, selection and focus; its tints are `color-mix(in srgb, var(--amb-link) N%,
transparent)`. CSS injected from JS and inline styles use the same tokens. Literal
colours stay only where the colour is the meaning: status (red, green, amber), prompt
roles, voice emotions, canvas node colours and translucent shadows or overlays.

Studio drawer rules keep the source deck at the screen edge and the assembly
track next to the canvas. Common geometry is shared between dock directions;
direction-specific rules set column order and separators. The removed embedded
composer's `#anomalous-container.anomalous-docked` overrides must not return.
Before adding an override or `!important`, locate and edit the owning rule.
Older theme overrides in `08-theme-gallery-overrides.css` predate the tokens; many are
now redundant and can go as the rules they override are touched.

## Verification

Use `node --experimental-vm-modules tests/prompt_ui_lifecycle.mjs` for actual
module open/close, nested Escape, resize cleanup, block insertion and delayed
node writes. `tests/prompt_material_source.mjs` covers pagination, deduplication
and cancellation; `tests/translation_service_contracts.mjs` covers the HTTP
bridge. The UI fixture simulates DOM and ComfyUI APIs and does not replace
checking the real host, layout, focus, drag gestures and theme rendering.
