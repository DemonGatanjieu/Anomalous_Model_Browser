# Current Architecture Decisions

This index records concise reasons for enduring product and architecture
boundaries. It is not a changelog. When a decision becomes obsolete, update or
replace the record and rely on Git history for the former implementation.

## AD-001 — One command, exclusive browser entries

The floating trigger, action-bar button, and Extensions command share one
`openBrowser()` command and one browser instance. Presentations are mutually
exclusive, while the Extensions command always remains as a recovery route.
Native ComfyUI command/keybinding infrastructure owns shortcut recording and
modal guards.

## AD-002 — Recipes are templates; notebooks are immutable instances

A Workflow Recipe is the authoritative workflow template. Parameter Notebooks
are immutable generation-value snapshots attached to a recipe and browsed inside
its Parameters tab. The Node Assistant may reuse those snapshots for a selected
same-type node, but this does not replace full-skeleton recipe application.

## AD-003 — Recipe canvas actions follow graph scope

Recipe cards and detail views append partial recipes because their open required
connections make them composition fragments. Complete, independently runnable
recipes load through ComfyUI's workflow path and therefore open as a new canvas
in the current frontend. Structural editing remains a separate, explicitly
confirmed workflow.

## AD-004 — Recipe save hides implementation policy

Save collects identity, notes, tags, and cover/source image. Presentation pins
and snapshot policy are implementation choices, not per-save questions. Legacy
pin data is preserved without exposing a control; new recipes default to none.

## AD-005 — Model identity excludes names and previews

Model Doctor automatically proves identity through provenance hash and required
category; byte size may disambiguate that hash. A unique size-only match is a
manual candidate, never proof or an automatic redirect. Hash/size conflicts are
rejected. Local paths, filenames, display names, previews, and similarity are
presentation or post-resolution routing data. This boundary prevents silent
substitution after local rename or across categories.

## AD-006 — Foundation components are hash-only recovery categories

VAE, VAE Approx, CLIP/Text Encoder, and CLIP Vision files can commonly share
sizes or ambiguous names. Automated redirection therefore requires one exact
in-category hash match. A size-only candidate may still be shown for explicit,
one-time confirmation on the current node. Existing native combo values remain
usable with a visible identity-change warning when provenance differs. This does
not restrict scan coverage: scanning may calculate hashes for any active
registered folder, including categories whose Civitai metadata coverage is weak.

## AD-007 — Recipe origins and local availability are separate

Official origin metadata can be refreshed or edited independently of saved
identity. Exact-path availability checks and previews describe the current
machine; they do not rewrite imported provenance or activate a local match.

## AD-008 — Prompt roles prefer unknown over a guess

Automatic prompt role tracing follows only allowlisted native prompt,
conditioning, and consumer nodes. Unknown third-party nodes are opaque. Legacy
full-value recovery must be exact and unambiguous, and users may store explicit
recipe-scoped overrides.

## AD-009 — Recipe-to-model navigation is recoverable and exclusive

Model detail temporarily replaces all main content surfaces while retaining a
small recipe return token. Back reconstructs recipe detail; unrelated navigation
abandons the token and cleans stale state. The transition never closes the outer
browser or exposes model detail beside Node Assistant.

## AD-010 — Parameter selection must identify both panes

The active Parameter Notebook is visible in the list and in a right-pane banner
with name and timestamp. Requests are selection-tokened so stale gallery results
cannot overwrite the new notebook. Sidebar input/button rows must remain usable
in the narrow docked layout.

## AD-011 — Output discovery remains bounded and user-refreshed

Recipe matching inspects at most the newest bounded set of PNG metadata and has
no persistent index. The main Gallery scans on open and refreshes manually. This
avoids background polling and hidden indexing cost while retaining predictable
freshness.

## AD-012 — Licensing and branding are separate

The standard MIT `LICENSE` applies to project-owned code and documentation.
`TRADEMARKS.md` separately governs the Anomalous Model Browser name and official
branding. Project-specific restrictions are not appended to the MIT license.

## AD-013 — Beta guidance is scoped to experimental workflow features

Workflow Recipes and recipe-powered Assistant presets carry localized backup and
data-safety guidance until an explicit stability decision removes it. Stable
Node Assistant model replacement and LoRA insertion are outside that warning.
Notices distinguish single-node preset application from full-skeleton Parameter
Notebook application.

## AD-014 — Architecture documentation is state, not history

Architecture documents change only when an owner, data flow, interface contract,
persistence format, security boundary, or critical invariant changes. Ordinary
fixes do not append “unchanged” entries. Git is the implementation history;
`CHANGELOG.md` is user-facing release history; `.agents/logs/ai_lessons.md` holds
only durable recurring traps.

## AD-015 — Recipe model mutations update all identity representations

The authoritative workflow widget, structured model reference, and node-scoped
Model Doctor Hash index form one mutation boundary. Local matching updates all
three through the archived full-recipe path. Partial append remaps Hash records
with node IDs and rolls them back with the inserted graph. Personal model notes
are recipe-scoped presentation data and may be excluded from package export.
