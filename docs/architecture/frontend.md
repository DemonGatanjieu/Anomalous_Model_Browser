# Frontend Architecture

Read this document for changes under `web/`, browser entry modes, panel state,
localization, media, or explicit canvas mutations.

## Bootstrap and module ownership

ComfyUI loads JavaScript in the extension `WEB_DIRECTORY` as ES modules.
`web/main.js` registers `Anomalous.ModelBrowser`, creates the shared browser
instance, and binds extracted modules to it. A syntax error or duplicate
top-level declaration in any imported module can prevent registration and make
the entire entry disappear. For affected modules, run `node --check` and verify
the real ComfyUI runtime creates the configured entry.

Major UI panels live in `web/modules/ui_*.js`. Shared browser state remains on
the `AnomalousBrowser` instance. Pure parsing, normalization, comparison, and
transaction helpers remain in focused modules rather than acquiring DOM state.

The main surfaces are:

- Sidebar and folder manager: navigation, folder visibility, scan controls.
- Grid and model detail: model browsing and metadata/media presentation.
- Gallery: the user's generated outputs.
- Workspace: Prompt Notes and Workflow Recipes.
- Node Assistant/Model Doctor: selected-node actions, diagnostics, parameter
  presets, and missing-model recovery.

## Entry modes and host integration

One shared `openBrowser()` command backs the floating trigger, ComfyUI action-bar
button, and `Extensions -> Anomalous Model Browser` command. Entry presentations
are mutually exclusive and reuse the same browser instance. The Extensions
command remains available as a recovery path in every mode.

The native command owns the default `Ctrl + Shift + M` binding. Shortcut
customization delegates to ComfyUI's command/keybinding panel and recorder; the
plugin does not install a parallel global keyboard listener or maintain a second
shortcut preference.

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

Recipe Append clones serialized nodes, remaps IDs and links, supports groups,
and rolls back everything it created on failure. It never calls `loadGraphData`
on the live graph and rejects unsupported subgraph definitions until they have a
complete remapping path.

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

`web/hash_resolver.js` may hook a compatible graph serializer to carry model
provenance. If the host API is unavailable, it disables only that integration
with a useful warning. It must not prevent `main.js` from registering or remove
the visible browser entry.

Network-backed enrichment is explicit and recoverable. An unavailable Civitai
or translation service may produce a local error state; it must not block local
browsing, editing, or already stored data.
