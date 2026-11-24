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

Status (2026-10-09): ended with v1.60.0, the first release not marked beta. The
in-app beta notices had already been removed.

## AD-014 — Architecture documentation is state, not history

Architecture documents change only when an owner, data flow, interface contract,
persistence format, security boundary, or critical invariant changes. Ordinary
fixes do not append “unchanged” entries. Git is the implementation history;
`CHANGELOG.md` is user-facing release history; `docs/architecture/lessons.md` holds
only durable recurring traps.

## AD-015 — Recipe model mutations update all identity representations

The authoritative workflow widget, structured model reference, and node-scoped
Model Doctor Hash index form one mutation boundary. Local matching updates all
three through the archived full-recipe path. Partial append remaps Hash records
with node IDs and rolls them back with the inserted graph. Personal model notes
are recipe-scoped presentation data and may be excluded from package export.

## AD-016 — The audio page manages one speech engine

The audio page is built around GPT-SoVITS through the separate Anomalous_TTS
node pack: its characters, emotions, pronunciation and sampling defaults live in
the node's own settings, and the Script Director can run a script without the
canvas. The F5-TTS voice library (files under `input/F5-TTS`, upload, romanization,
Load Audio drags) was removed rather than kept as a parallel engine, so the page
teaches one set of rules. A zero-shot voice (one clip, no trained model) belongs
in Anomalous_TTS as a character kind, not as a second engine here.

## AD-017 — The browser is a rail of pages with a home page

Navigation is one narrow icon rail: a home page, the image pages (models, gallery,
workflows, materials), the audio pages (voices, audio gallery), the canvas tools and
settings. The rail replaces the header tabs, the image/audio toggle and the tool bar
under the folder list, so the list column holds only a list and can close without
hiding any command. Each page decides whether it has a list; the open state is
remembered per page and narrow windows start with it closed. The home page offers
tasks rather than a manual: each card opens its page, and a first visit lands there.
AMB stays the chore layer around ComfyUI (AD-016 keeps one engine per page); a new
page earns a rail entry only when it is a place users return to, not a one-off tool.

Later (1.65): the rail keeps a core (Home, Models, Gallery, Workflows, Model Check) and More
holds the other pages and tools, each with a pin to keep it on the rail. One layout for everyone,
no old/new switch: a new install starts with the core, an upgrade keeps what that browser and the
user's files show was used, Voices comes with Anomalous_TTS, and the user's own pins win from then on.

## AD-018 — The activity log records what Anomalous changed, without undo for now

Users need to see what the plugin did to their canvas and files. File changes are
recorded on the server, after a write request succeeds, from one table of routes,
so a new write route is logged by adding a line there. Canvas changes are recorded
without each action reporting itself: a press inside Anomalous takes a snapshot, and
the difference is logged when the user next presses or types outside it, so the
user's own edits are never attributed to the plugin. Opening another workflow is
logged as that, not as removed nodes. The log is bounded and never fails the action
it records. Undo comes later and only for changes that can be reversed safely
(canvas values, renames); deletions go through their own confirmations instead.

## AD-019 — No Civitai browser inside Anomalous; imported files are put in place

New users' trouble is not finding models but knowing which folder a downloaded file goes
in. A Civitai browser inside the plugin would not reach many users (Civitai is often
unreachable from mainland China, where most models come from LiblibAI, cloud drives and
chat groups), would mirror a large site's search, filters and content rating, and would
show its picture feed inside the plugin. Instead the plugin takes a file from wherever it
came from: dropped on the models page, it is told apart by its header (never by running
it), checked against Civitai when that answers, and moved into the folder its type and
base model call for, with every guess shown and changeable before anything moves.

## AD-020 — Downloads extend Model Check's evidence rules; ComfyUI-Manager is a catalog

A missing model is downloaded only from a source that names one file, asked in turn:
Civitai by the workflow's hash, a link the workflow carries, then ComfyUI-Manager's model
list by file name. The list carries no hashes: it answers where a file of that name can be
fetched, never whether a local file is that model, so it is never evidence for local
recovery (AD-005). With the workflow's hash every source must show the same SHA-256 (read
from the host, Hugging Face's headers) before the file counts; a different one is refused.
Without a hash nothing can be checked before or after the download, so a name is at most
"maybe": one list entry of that name and of the node's type is offered as "Download by
name", marked as such, never in Download all nor the MCP's downloads. Foundation components
(AD-006) follow one rule: a name alone only ever proposes, and their same-name candidate
needs a second, independent piece of evidence: the same size for a local file, the
curated list's entry of the right type for a download; the user still presses. Where no
source answers, the plugin opens a search (Hugging Face) for the user rather than pick a
file of a common name itself. The full rules in plain words are in
`docs/guides/model-check-rules.md`.

## AD-021 — A combo remembers; it never changes a value

A combo puts back exactly what was saved: models, LoRA strengths, CLIP skip, prompts and
every other value of its nodes, never node defaults in their place and never values the
plugin chose. A different value is a different combo, made by setting it on the canvas
and saving again. A picture kept as a combo therefore keeps the nodes that made its
sampler's model and prompts as a node structure, values untouched (a workflow without a
sampler falls back to the older main model, LoRAs and positive prompt). Placing a combo
only adds a new group; nodes already on the canvas are never changed (their values are
changed in Current node). Current node lists a combo's values beside the other saved ones: only
the user's press there puts them in, one node at a time, and the combo stays as it is. This is
one of the feature principles in AGENTS.md.

## AD-022 — What an AI does outside Anomalous is seen, not prevented

An AI app may run commands and scripts of its own next to Anomalous's tools; MCP shows a
server only the calls made to it, and Anomalous does not read another app's logs or
history. So it makes its own tools the easy way (the AI is told what each one covers),
asks the AI to say what it did elsewhere (`log_outside`, and rules the user pastes into
the AI app), and sees for itself what matters most: when the AI calls, it looks at the
top of ComfyUI's output and input folders for pictures no run saved and pictures
rewritten in place since its previous call, shows them in the task and tells the AI.
It never looks in the background, never blocks or undoes anything, and words it as
something the user may have done. Anomalous itself never overwrites a file.

## AD-023 — A save belongs to a canvas, and outlives it

A save is a whole workflow, kept as it was, so it needs nothing from the canvas it came from.
A group of saves goes with one canvas through a key of Anomalous's own in the workflow's
extra, because ComfyUI's workflow id is shared by copies and all zeros in some files; a file
that does not carry the key yet is found by its path. Writing the key is not a change, so a
saved workflow does not start asking to be saved. Closing the tab or deleting the file leaves
the saves in place and only the user removes them, to the Recycle Bin; a group past its most
stops taking more and drops nothing. With the canvas open a save goes back in place, as one of
ComfyUI's undo steps; with the canvas gone it opens on a new tab and the group goes on there.
Opening a save on a new tab while its canvas is open is a branch: a new canvas with saves of
its own. Saves are a working history, not finished work: a workflow card made from a save is a
copy, and the two never affect each other. That is the only way out of the saves and there is
none in: presets and combos joined to saves were tried and took more to keep sensible than they
gave, so nothing but the canvas makes a save, and a save only becomes a new card. The Saves page
shows them by canvas and runs one canvas at a time, in the order of the saves; what is clicked
after goes behind it on ComfyUI's queue, so there is no queue of our own to keep.

## AD-024 — Anomalous has no nodes of its own

Everything Anomalous puts on a canvas is ComfyUI's own or from a node pack the user already has,
so a workflow made with it opens on a ComfyUI without it. A LoRA stack, asked for by users, is
therefore a chain of ComfyUI's loaders by default, and rgthree's or Easy-Use's node where that is
installed; a stack node of ours would be simpler to build, and would tie every workflow to us.

## AD-025 — Cards, examples, ways and skills are layers, not pairs

An AI looks from the top down and stops as soon as it can: the user's cards (whole routes they
ran), the official examples (whole routes for an install with no cards), the ways (one job each,
built by Anomalous, where the values live), the skills (how to think about a job, no values). A
light model should stop at the first two. They are not kept one to one: every way with its own
example and skill would be a lot to maintain for little. The one rule is that a lower layer says a
thing once and a higher one points at it instead of copying it; where an example must carry a
way's values to run alone, a test keeps the two in step. Examples stay few on purpose: a plan
gets a version per model family only when the loaders differ, and each version is its own
workflow, so one route per card still holds.

## AD-026 — What the cloud AI may not read, a model on this computer reads

Privacy mode leaves the AI app blind to prompts and pictures; the user is its eyes, which costs
them clicks. The darkroom helper gives that reading to a model on the user's own computer, and
two rules keep it from becoming a way out. It talks to a loopback address only (checked when kept
and when read, no proxy, no redirect), so nothing it is sent can leave. And what it says about a
picture reaches the AI app only as a fixed list of checks with a few allowed words each; free
words are dropped, because a description is the picture again. A prompt it writes leaves as a
token, like any prompt. It is an extension: off until the user picks a model, and Anomalous
installs and downloads nothing for it.

## AD-027 — Users pick from Anomalous's tools; they do not add their own

The tool list sits in the AI's context every round, so a user may offer an AI app fewer tools:
Anomalous's short set or their own pick, named in the address. A tool is never added by the user:
it would run someone else's code inside ComfyUI, and privacy mode could not seal what such a tool
sends. An AI app can connect other MCP servers beside Anomalous for that. A set only shortens the
list; the full list stays the default, because a task handed over in Anomalous needs the workbench.

## AD-028 — What an AI sees of a model is the model's, chosen once

Privacy mode used to decide for all models of a task at once: every name a token, or none. Whether
a name says too much belongs to the model, not to the task, so the user chooses it once on the
model (kept in its own `.anomalous.json`, moving with it) and it holds in every task, private or
not. A model nobody chose for follows the task, so nothing changes for a user who never chooses.
A hidden model keeps what an AI picks by (type, base model, the user's note) and loses what names
it: cover, description, notes, plain trigger words. Of a description only the paragraphs the user
ticks go where the rest stays home: an author's text is long, often off topic, and may name what
the model draws. Privacy mode itself becomes the recommended settings, one press away; covers
never go in a private task, whatever the model's choice, because a picture says more than a name.

## AD-029 — While the AI works, the canvas keeps the room; a card on it follows the task

Users want to watch the AI change nodes and links while it builds or runs, which AMB's window hides.
Making the whole window smaller was the obvious way and the wrong one: every page (models, gallery,
workflows, combos, prompts, voices, settings, the rail, the docked mode) would have to work in a strip
and get a second layout to keep. Instead the window steps aside and a small card on the canvas, beside
the saves bar and the job sheet's card, follows the task: what goes on now, and what waits on the
user (an OK, a short answer, a pause, a line to the AI). Anything bigger (comparing pictures, marking
areas, a plan, many options) goes back to the full workbench in one press. The card shows only while
an AI is at work or waiting on the user, never for a task that ended before the page loaded, and the
user's × holds until something new is asked of them; it never stops the AI. With the window shut the
card is the one place that says so: the toast for a panel or a gate is for a window open on another page.

## AD-030 — The card goes where the user looks; a chat in the AI app keeps it for gates; dropped workflows keep every node

Three follow-ups to AD-029, from use. People driving an AI from a terminal (Claude Code, OpenCode) look at
that terminal, not the canvas, so where the browser can (Chrome / Edge's Document Picture-in-Picture), the
card itself moves into a small window over every app and comes back when it closes; it is the same card,
not a second view to keep in step, and a browser without it just shows no button. An AI connected through
a set without the workbench (?tools=core) talks to the user in its own chat: its task is marked chat_only
and the card keeps away, but for a gate, since a download or file move waiting for Allow would otherwise
stall in silence; the user can still put such a task on the canvas from the workbench. Workflow files
dropped on the Workflows page are kept at once, without the save window: saving should not take four
steps. The recipe keeps the workflow exactly as the file has it; the detached graph is only read for its
settings, because LiteGraph's copy drops what nodes of packs not installed here carry, and a community
workflow must survive until those packs are.

## AD-031 — A hidden review console rehearses what needs an AI, in memory only

The canvas card, pure chat, the desktop window and a new user's rail can only be seen when an AI really works
or on a computer that never ran Anomalous, so checking them cost an AI session, tokens and a mess in the task
list. The author gets a console instead, hidden from users: no button, no setting, its code loaded only by a
key, five clicks on the version number or an address, so it costs others nothing. It rehearses the card on
made-up tasks through the card's own rules and drawing, not a copy of them, so what it shows is what users
get; a press on the card goes to the console and moves the task on as the server would, and nothing reaches
the server or the browser's storage. Another user's rail is shown without being kept. Theme and language are
the real switches (showing them otherwise would be a second theme system to keep), so the console puts them
back as they were when it opened, on Reset and on close.

## AD-032 — A first visit meets one button; the rest waits where it is looked for

Four places made a first visit heavy. The first-run card listed four numbered steps (the network, a Civitai
key, the scan, the tour) before anything was pressed; it is one line and one button now, "Scan my models",
which checks Civitai on the way. The offline scan, retry and proxy show only when Civitai does not answer,
and a key Civitai refuses only adds a note, because most users need neither; the key is still set on the scan
page and in Settings, and the tour waits for a press. Settings had eight tabs, five holding one card; there
are four now (Look & Interaction, Models & Network, Workflows & Tools, Backup & Help), and a link naming an
old tab opens the tab its card moved to, scrolled to that card, so no way in breaks. The right-click menus
start with the everyday entries (five on a node, four on the empty canvas, AMB's pages in one submenu), the
rest a switch or "Enable all" away; a menu the user already saved is left exactly as saved, since changing
someone's own menu on an update is worse than a long one. Home's four large cards are the rail's four
working pages, so the two tell one story, and canvas saves lead the small cards. Workflows, canvas saves and
combos each say in half a sentence what they are and are not, where users meet them, since the three were
taken for one another.

## AD-033 — A calm three-tier Home, a floating welcome card that docks, and a folded Key option

Putting the first-run banner, five secondary tool cards, the AI starter bar, a four-button help row and a
boxed feedback banner on Home stacked four competing visual weights below the four main cards and pushed
them down on startup. Moving the first-run flow into a centered welcome overlay inside the AMB window lets
the four main cards (with a matching 200 px square workflow illustration in the same palette) sit cleanly
at the top; as soon as scanning starts, the card tucks into a small bottom-right dock pill so the user can
keep browsing while models scan. Users who need gated or `civitai.red` covers still want a Civitai API Key
without hunting through scan settings, so an optional collapsed disclosure sits directly under the main
scan CTA for inline paste-and-save, and the finished dock shows a subtle "Add key & rescan" nudge only when
an online scan without a key actually missed covers or left models unmatched. Below Home's main cards and
"Let the AI do it", the five secondary tools fold into a persistent "More tools" bar and onboarding/feedback
links share one quiet footer line.

## AD-034 — First-visit guidance lives inside Models and Gallery, not Home click popups

New users clicking Home's four main cards still need to discover non-obvious interactions once inside
(dragging model cards onto the canvas/nodes; dragging output pictures back to restore workflows or
searching by prompt/model). Blocking every card click with an intermediate explanation dialog stacks too
many modal interruptions on top of the welcome overlay and frustrates exploration. Instead, first-visit
guidance sits as a single dismissible inline tip strip (`ui_page_tip.js`, `page_tips_state.js`) at the top
of **Models** and **Gallery** — while **Model Check** and **Workflows** stay untouched since both pages
already carry inline explanations and empty-state walkthroughs. Upgraded browsers are left undisturbed
based on existing rail/legacy storage, dismissals persist per page in `localStorage`, Gallery's empty
state softens from a cold "Gallery is empty" notice into a clear next-step hint, and the hidden review
console previews both page tips in memory without touching storage.

## AD-035 — A blank sandbox stands in for the server, not for the pages

Walking through AMB as a new user, or opening someone's workflow whose models are missing, used to need an
emptied model library or a second ComfyUI. The review console's blank sandbox makes both a click away, and it
does so by standing in for the server rather than for the pages: while it is on, the page's requests to
`/anomalous/` are answered by a pretend server in memory (`review_sandbox_data.js`), so Home, the first-run card,
Models, the scan, Model Check with its download dialog and the Workflows page all run their real code, and what
the author sees is what a user would get, its gaps included (the Workflows page checks models by exact name, so
the renamed one shows as missing there while Model Check finds it by fingerprint). Nothing it does not stand in for
can reach the server: a change is refused and said so, uploads too, and AMB's keys in this browser's storage live in
memory. The user's canvas is never in front: the sandbox opens a temporary tab of its own, lists its own files in
that tab's model boxes, and closes it on leaving. A few modules gained a small "forget" entry
(`resetDownloadMemory`, `resetFirstRun`, `setPageTipSandbox`, `clearDoctorBanner`, `forgetCivitaiAnswer`,
`forgetSources`) because they keep what they read for the page's life; that is cheaper and safer than teaching each
page about a sandbox. None of it loads unless the console opens.
