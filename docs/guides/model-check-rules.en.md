# How Model Check decides

中文版：[model-check-rules.md](model-check-rules.md)

Model Check (once called Model Doctor) is one of the most involved parts of this plugin. This page is the **one overview** of its rules: what counts as "the same model", what is only "maybe", and where a missing model is downloaded from and how it is checked. Read it before changing Model Check; change the rules, and change this page and the Chinese one with them.

In one sentence: **Model Check goes only by "the same file", and the one reliable proof is the file's fingerprint (its SHA-256 hash).** A name, a path or a cover proves nothing.

## 1. Where fingerprints come from

When someone who has this plugin makes a picture or saves a workflow, the plugin writes the fingerprint (SHA-256) and the file size of each model it uses into the workflow (Settings can turn this off). When another person opens that workflow, Model Check finds the same file on their computer by its fingerprint, whatever it was renamed to and whichever folder it is in.

A workflow saved by someone without this plugin has no fingerprints, only the models' file names, so much less can be done (see the tables below).

## 2. Two kinds of models

| Kind | Includes | Rule |
|---|---|---|
| Ordinary models | Checkpoints, UNET / diffusion models, LoRAs, ControlNets, upscale models and the like | The fingerprint is surest; without one, the size or the name can offer a "candidate" for you to confirm |
| Foundation components | VAE, TAESD (vae_approx), CLIP / text encoders, CLIP Vision | **Fingerprint only.** Never guessed by name; a size match is shown only as a candidate to pick by hand |

Why foundation components go by fingerprint only: their names repeat everywhere (`ae.safetensors`, `clip_l.safetensors`, `t5xxl_fp16.safetensors`…), and files of the same name are often different files, so a guess by name is too likely to be wrong.

## 3. Finding it on this computer: three levels of trust

When a workflow opens, Model Check looks at each model dropdown (including every row switched on in rgthree's Power Lora Loader):

| What it sees | Verdict | What happens | Ordinary | Foundation |
|---|---|---|---|---|
| The dropdown has this value | Fine | Nothing changes | ✓ | ✓ |
| Only the slashes in the path differ | The same (certain) | One press puts it in | ✓ | ✓ |
| A file here has the same fingerprint, under another name or in another folder | The same (certain) | One press puts it in; **Put in N** on the banner above the canvas puts them all in | ✓ | ✓ |
| The workflow kept no fingerprint but kept the size; a file here has **the same name and the same size** | Very likely | Put in one row at a time, by your press; not part of "Put in N" | ✓ | ✓ (by hand only) |
| A file here has **exactly the same size**, nothing more | Maybe | Put in one row at a time, by your press | ✓ | ✓ (by hand only) |
| The workflow kept nothing (it was not saved by this plugin); the dropdown has **exactly one file of that name** | Maybe | Put in one row at a time, by your press | ✓ | ✗ not offered |
| Several files could be it | Unclear | Nothing changes; you pick | ✓ | ✓ |
| The fingerprint and the size point to two different files | Conflict | Refused | ✓ | ✓ |
| The file is there, but its fingerprint differs from the one the workflow kept | The file changed | A note only: not counted as missing, not replaced, ComfyUI uses it as it is | — | ✓ |

So ordinary models really have **three levels**: the same fingerprint = sure; the same name and size = very likely; only the same size or only the same name = maybe. Only the first level goes in with one press or all at once; the other two need you to confirm each row. Foundation components go in only on the first level; a size match (with the same name or not) is only a candidate to pick by hand; a name alone never counts.

Never taken as proof: the file name (except the two cases above that you confirm), the display name, the path, the cover, "it looks like it". Once a file is known to be the same, its name and path only serve to find the matching entry in the dropdown.

What goes in is always one of the options the node's dropdown already has; the plugin never puts in some other value to pretend it found the model. Confirming a candidate holds for that one node only and is not remembered as a rule.

## 4. Not on this computer: where to download from

When a model really is not here, the Model Check page can download it. The sources are asked in this order, stopping at the first that has it:

1. **Civitai, by fingerprint**: when the workflow kept a fingerprint, Civitai is asked for a file with it.
2. **Links the workflow carries**: the download links this plugin kept when the workflow was saved, or the model links ComfyUI itself writes into a workflow (its official templates have them, in `models`): a Civitai version, a file on Hugging Face / hf-mirror, a file on GitHub.
3. **ComfyUI-Manager's model list**: the `model-list.json` of the Manager installed here, a few hundred common models (checkpoints, VAEs, text encoders, upscale models, ControlNets…, mostly on Hugging Face), matched by **file name** and the kind of folder the node needs.

How a download is checked:

| Case | Result |
|---|---|
| The workflow has a fingerprint; the source file's SHA-256 matches it | Certain: it can be downloaded right away and counts in "Download all" |
| The workflow has a fingerprint; the source file's SHA-256 differs | Refused (not the same file) |
| The workflow has a fingerprint; the Manager list has several files of that name | Each is checked; only the one that matches is used |
| The workflow has no fingerprint; the Manager list has **exactly one** file of that name | Marked "Download by name", saying it only has the same name and cannot be checked; you decide. **Not part of "Download all"**, and AI apps (MCP) never download it on their own |
| The workflow has no fingerprint; the list has several files of that name | Not offered (no telling which one) |

Without a fingerprint there is nothing to check a download against: a name alone never goes past "maybe", and you decide. The downloaded file has a fingerprint of its own from then on, but with no original fingerprint to compare, it cannot prove to be the file the workflow used.

## 5. Where ComfyUI-Manager fits

ComfyUI-Manager's list is a "catalogue of where common official models are downloaded": it answers "where do I get a file of this name", not "is the file on your computer that file" (the list has no fingerprints, only file names, types, base models and download addresses). So:

- **It is used only for downloading**, after Civitai (by fingerprint) and the workflow's own links; it is never taken as proof when finding a file on this computer.
- **With a fingerprint**: each file of that name in the list has its SHA-256 read from the download site and compared; only a match counts, as with any other source.
- **Without a fingerprint**: only when the list has exactly one file of that name, and its type fits, is "Download by name" offered, with the list's name for it and the site or repository the file is on, for you to judge. An entry of the list without a type is considered only when the node's type is unclear too.
- **Foundation components get "Download by name" too.** The rule throughout is: a name can only put a candidate forward, and for a foundation component a candidate of the same name needs one more, independent piece of evidence. On this computer that evidence is "the same size" (so a name alone is not offered); for a download it is "the official list has it, and its type fits". And the download only happens when you press it, having seen that it is "only the same name"; never on its own.
- **A foundation component found nowhere**: its row has a **Search Hugging Face** button (hf-mirror with the mirror switched on) that opens a search page for its file name, for you to find and download it yourself. The plugin does not pick for you. A generic name (`model.safetensors`, `ae.safetensors`) can turn up many results, which is exactly why it does not do this by itself.
- **No Manager installed**: that one source is missing; when a model has no download address, the Model Check page says that installing ComfyUI-Manager adds one more source.
- The list is read from the Manager installed here (`model-list.json`), without going online.

The download itself: only over https from Civitai, Hugging Face, hf-mirror and GitHub; written to a `.part` file first and, when there is a fingerprint, renamed to its real name only after the SHA-256 matches; an existing file is never overwritten; the free disk space is checked first. With the mirror switched on, a file found on Civitai that also exists on Hugging Face (the same SHA-256) is downloaded from hf-mirror instead. A site that cannot be reached is skipped and the others are asked.

## 6. Promises that do not change

(The same as rule 1 of "功能原则" (feature principles) in AGENTS.md)

- Checking only reads; it never changes a workflow by itself. Nodes change only when you press "Put in" or "Download".
- It only ever puts in the same file. "Maybe" and "very likely" both need your OK, row by row.
- Each item says on the page why (found the same file / only the same size / only the same name…) and where a download address came from.

## 7. Where the code is (for the AI that maintains it)

- Page-side decisions: `web/modules/model_check.js` (the states and `via`), `web/modules/model_policies.js` (which types go by fingerprint only), `web/modules/ui_doctor.js` (the text of each item).
- Finding files by fingerprint or size on the server: `api/model_resolution.py` (`/anomalous/resolve_hash_batch`).
- Download sources: `api/download_sources.py` (the order of `find_source` and the checks), `api/manager_catalog.py` (the Manager list), `api/model_download.py`.
- Implementation details in English: `docs/architecture/model-resolution.md`, "Model downloads" in `docs/architecture/backend.md`.
- Why it is decided this way: AD-005 (models are not recognized by name), AD-006 (foundation components by fingerprint only) and AD-020 (downloads and ComfyUI-Manager) in `docs/decisions/README.md`.
