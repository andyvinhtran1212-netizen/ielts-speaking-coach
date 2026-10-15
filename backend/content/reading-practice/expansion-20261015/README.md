# Reading practice content expansion

This is the 15 October continuation of the user's approved Reading work: manually
author in-place translations, bidirectional phrase links and useful native SVG
illustrations for the remaining 196 published L1/L2 articles. The four already
aligned articles and all Full Test/Mini timed content are excluded. Existing
question identities, prompts, keys, order, glossary and unrelated metadata stay
outside this content mutation. Existing after-check evidence is preserved.

Authoring happens in this independent local checkout on
`codex/reading-content-expansion-20261014`, based on staging `af0af8b6`.
The user's new read-only permission covers current chat/Git/release state and
published practice content on staging/production, with no learner-history read.
No new push, database write, paid translation/image call or publication is
authorized yet. Obtain permission for the concrete completed release package.

The fresh bounded exports are outside Git at
`/Volumes/Kingston SSD/Code/reading-practice-expansion-20261014/`:
production has 200 articles/1151 questions, four aligned; staging has 26 L1/L2
articles/135 questions, four aligned. The Vocabulary chat is active in its own
scope. No messages were sent to it and its files were not changed.

Local checkpoint: 65 authored articles, 998 sentence translations, 1995 manually
chosen phrase pairs and 54 SVG scenes. Related articles share a suitable
context scene where useful. There are 131 articles still to author in this requested
expansion. All 65 are local drafts, not a deployed extension.

`compile_local.py` only assembles this finite batch and calls the existing
practice-support validator. It makes no network requests. Author files pin the
reviewed English and pre-existing translation hashes. All reading prose is
covered; Markdown headings/separators are excluded, and practice tips are
translated where present. Runtime support remains schema version 1.

Compile from the repo root using the existing backend environment:

```sh
PYTHONPATH=backend python backend/content/reading-practice/expansion-20261015/compile_local.py \
  --snapshot /absolute/path/to/production-passages.json \
  --out /absolute/path/to/draft-content.json
```

The full 196-article package, guarded database transaction, staging copy/update
plan, release permission and live acceptance are still pending. Do not apply a
partial draft or infer release authorization from the earlier four-article release.
