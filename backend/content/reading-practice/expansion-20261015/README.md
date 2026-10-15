# Reading practice content expansion

This is the 15 October continuation of the user's approved Reading work: manually
author in-place translations, bidirectional phrase links and useful native SVG
illustrations for the remaining 196 published L1/L2 articles. The four already
aligned articles and all Full Test/Mini timed content are excluded. Existing
question identities, prompts, keys, order, glossary and unrelated metadata stay
outside this content mutation. Existing after-check evidence is preserved.

Authoring happens in this independent local checkout on
`codex/reading-content-expansion-20261014`, originally based on staging `af0af8b6`; refreshed against the completed Vocabulary
release on staging `f3a2b6e8`.
The user's new read-only permission covers current chat/Git/release state and
published practice content on staging/production, with no learner-history read.
The user approved commit `9695c831` for PR/staging operations, and
[PR #1671](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1671)
was opened at that exact head. It has not been merged or imported. Review found
six omitted opening sentences in two articles because a heading shared their
Markdown block. The local revision retains that prose and adds four regression
cases. Its new SHA and regenerated SQL require replacement-package approval;
production and provider calls remain unapproved.

The fresh bounded exports are outside Git at
`/Volumes/Kingston SSD/Code/reading-practice-expansion-20261014/`:
production has 200 articles/1151 questions, four aligned; staging has 26 L1/L2
articles/135 questions, four aligned. The Vocabulary chat is active in its own
scope. No messages were sent to it and its files were not changed.

Local content is complete: 196 articles, 3052 sentence translations, 6418 manually
chosen phrase pairs and 123 original SVG scenes. Related articles share a suitable
context scene where useful. All 196 remain local, with no expansion deployed.
The English source, existing questions/keys, glossary and unrelated metadata are
unchanged. No paid translation or image API was called.

`compile_local.py` only assembles this finite batch and calls the existing
practice-support validator. It makes no network requests. Author files pin the
reviewed English and pre-existing translation hashes. An independent comparison with all rendered Markdown paragraph/list text confirms
that all reading prose is covered; Markdown headings/separators are excluded, and practice tips are
translated where present. Runtime support remains schema version 1.

Compile from the repo root using the existing backend environment:

```sh
PYTHONPATH=backend python backend/content/reading-practice/expansion-20261015/compile_local.py \
  --snapshot /absolute/path/to/production-passages.json \
  --out /absolute/path/to/draft-content.json
```

Prepare the finite SQL packages without network access:

```sh
PYTHONPATH=backend python backend/content/reading-practice/expansion-20261015/prepare_release.py \
  --snapshots /absolute/path/to/approved-published-exports
```

`release/manifest.json` pins the prepared SQL checksums. The production transaction
updates 196 existing practice articles, with no question mutations. The staging
transaction updates 19 existing articles and inserts 177 isolated copies plus
1018 unchanged question copies with deterministic staging IDs. It leaves the
four previously aligned articles and the three unrelated staging/QA articles
alone. Copy collisions abort; there is no upsert. Both transactions use the
repository advisory-lock key and refuse source, metadata or image drift. Metadata
is compared as JSONB, not by a serialization-dependent database text hash.

Local verification performed on the actual generated SQL in a temporary
PostgreSQL 16 instance (Unix socket, no Supabase connection):

- Production: all 196 intended updates match; all other passage fields, all 1151
  questions, the four core articles and an additional Full Test sentinel stay
  unchanged. Reapplying is refused. A deliberately changed last article aborts
  the entire transaction and preserves the concurrent metadata edit.
- Staging: exactly 19 updates, 177 copies and 1018 question copies; existing
  questions and non-target articles stay unchanged. Reapplying is refused.
- All 123 native SVG scenes were rendered locally and visually checked. No image
  contains an answer label or an external asset request. All 196 alignments pass
  the existing backend revision/span validator. Hidden HTML word-count comments
  are excluded, sentence boundaries handle quoted punctuation, and headings are
  removed line by line while preserving prose in the same block.

The current frontend Markdown annotation code also resolves every one of the
3052 sentence actions and 6418 source phrase spans across all 196 compiled
articles, with no nested buttons. Existing React interactions pass (50 files /
577 tests), and the full frontend contract suite passes (12976 passes, three
skips). The focused backend practice-support suite passes (16 tests); four authoring
regression cases also pass. The full backend
pre-push gate passes (10197 passes, 808 configured smoke/credential-dependent
skips; no external provider calls enabled). Spec validation and diff hygiene
also pass. These are
local results; hosted expansion acceptance has not happened yet.

Release remains permissioned. After approval, push one content PR to `staging`,
resolve its applicable checks/review, deploy its SVG assets and verify their
availability before applying `staging-apply.sql`. Use only task-owned synthetic
QA accounts, then verify both directions of phrase highlighting, sentence
navigation and illustration zoom on hosted desktop/mobile in both themes.
Confirm the exact staging frontend/backend SHA and integrated/live gates.
Production requires separate approval after those results. Its package must be
rechecked against fresh published inputs; do not overwrite a drift guard.
Deploy production assets before writing content that references them, then verify
the actual production journey. No new runtime code or schema is required.

For rollback, use the reviewed packet's `expected_metadata` and
`expected_image_url` to restore only touched support/translation/image fields,
guarded by the exact post-release values. Refuse concurrent edits. Revert asset
code only after content no longer references it. Keep staging copies if needed
for acceptance; do not delete their dependent attempts or unrelated QA content.
Never infer expansion release authorization from the earlier four-article release.
