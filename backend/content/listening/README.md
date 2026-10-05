# 80-day explanation editorial revision

`80-days-explanations-v2.json` is reviewed Vietnamese editorial content for
the source collection. It removes repeated paraphrases, generic instructions
already shown in question blocks and editor-only tasks, and contains 55
substantive item overrides. All 43 unresolved positions retain concise,
source-specific learner next steps; only editor-only tasks are removed.
An independent council reviewed those overrides, next steps and removal
invariants. This is an editorial review, not fresh answer-key
certification; ambiguous and unresolved source warnings remain.

Each changed item binds the complete original `SourceExplanation` JSON
(including defaults and printed key) by SHA-256. The digest uses UTF-8 JSON,
sorted keys, compact separators and unescaped Unicode. All 1,649 bindings were
matched against the published staging package's 1,676 source positions before
deployment. The source manifest is recorded in the document header.

The API applies these edits only during owner-authorized reveal, submitted
review or explicitly opened source study. Marking continues to read the
original explanation; answers, evidence, source warnings, immutable package
rows and learner attempts are retained. A different item or source explanation
does not receive this revision. Reverting the content integration restores
the original text without a database migration or data rollback.

# 80-day native presentation

`80-days-native-v1.json` contains only display text, layouts, blank labels and
31 authored SVGs from the reviewed local native preview. It represents all 80
days, all 350 question blocks / 1,676 source positions, 10 vocabulary blocks and
93 supplementary study blocks; the diagram reused in study gives 32 SVG
attachments. The 41 existing layout overrides retain full passages and fixed
form/table rows. Original imported question options, multi-gap IDs, grading,
answer keys, explanations and learner attempts remain authoritative.

Each row binds the complete original imported block's structural metadata,
question membership and archival image paths to source manifest
`29819c11a65c71762d7912c919c459df306ed61209a36311a8e23c0d21f83841`
with canonical UTF-8 JSON / sorted keys / compact separators / SHA-256.
The active published package manifest must match that header. Practice blocks
also bind every display question (prompt, options, fields, limits and numbering),
with exact unique item membership; answers and other protected content are not
part of this display digest. Missing or changed manifests/questions omit native
content and instruction overrides. Only this private backend content is projected
into authenticated day, player and explicitly opened study responses. Caller-supplied native JSON is ignored.
Study blocks remain hidden before the existing study guard; mixed study blocks
show only excluded positions. SVG markup is restricted to passive shapes/text
and rendered in an image context. No PDF crop is signed or displayed by these
source routes. A missing or changed binding returns an explicit missing native
presentation state instead of guessing content or falling back to an image.

This changes presentation on the deployed code path without a migration or
source reimport. Source raster objects remain private archival evidence. Three
source-bound Vietnamese instruction overrides remove obsolete crop directions;
original English instructions, question content and limits remain unchanged. SVG
source-fidelity metadata in the preview remains historical review evidence;
local render tests do not claim fresh independent visual or live acceptance.

# 80-day audio choices

`80-days-audio-variants-v1.json` binds 80 machine-reviewed Kokoro MP3 hashes
and 69 unchanged source recordings to the same immutable source manifest.
The authenticated day audio endpoint signs only these private Storage paths.
Missing objects have no playable URL. The day player keeps the original as
default when available; Kokoro is a separate free-listening choice, never a
replacement for audio in an existing graded attempt. Day 61–70 are English
vocabulary pronunciation tracks. Day 76 retains its partial-original warning,
and Day 77 has no original recording. Synthetic timing and pronunciation
limitations remain visible; machine review is not human listening acceptance.

Validate before uploading with the operator's target-environment settings:

```sh
python backend/scripts/upload_listening_source_audio.py --audio-root /path/to/kokoro/audio
python backend/scripts/upload_listening_source_audio.py --audio-root /path/to/kokoro/audio --commit
```

The CLI checks all 80 final hashes before any write, requires an existing
private bucket, and reuses the canonical immutable upload/readback helper.
It neither overwrites original objects nor changes package/attempt rows.
