# Reading practice content expansion

The 196-article expansion was released to production through
[PR #1676](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1676),
at main `69b4299b1c600f7914c3f9c83d83b98ce71e6999`, after acceptance on staging
`0c70093c4414a9e5c4a5e861348818d4a415b8e9`. The original release contained
3052 sentence translations, 6418 phrase links and 123 SVG scenes. Production
content, deployed assets and the learner journey were verified; task-owned QA
accounts and their data were removed.

The subsequent quality review and its separate, currently local correction are
documented in [quality-20261015/README.md](quality-20261015/README.md).
The `authored/` files now include that correction. Do not treat the original
release SQL as the current authored content.

## Scope and authoring

The batch covers published L1 Vocab Reading and L2 Skill Practice only. The four
previously aligned core articles and all Full Test/Mini timed content are excluded.
English prose, passage/question identities, prompts, keys, order, glossary,
after-check evidence, unrelated metadata and learner records are preserved.
Translations, phrase links and native SVGs were authored without provider APIs.

`compile_local.py` assembles this finite batch and runs the existing support
validator offline. Author files pin the original English and pre-expansion
translation hashes. Compile using the original pre-expansion snapshot, **not** a
current export that already contains aligned units:

```sh
PYTHONPATH=backend python backend/content/reading-practice/expansion-20261015/compile_local.py \
  --snapshot /absolute/path/to/original-production-passages.json \
  --out /absolute/path/to/candidate.json
```

The source comparison includes rendered paragraph/list prose and practice tips;
headings, separators and hidden word-count comments are excluded. Support remains
schema version 1. Backend validation and frontend annotation both check exact
spans and content revision hashes.

## Original release packages — already applied

`prepare_release.py` and `release/` describe the original import. Its production
transaction updated 196 existing articles. Its staging transaction updated 19
articles and inserted 177 isolated copies with 1018 unchanged question copies.
Both were already applied. **Do not rerun this preparation/import path for a
quality correction or insert those copies into production.**

Use only the separate guarded correction packages after their own explicit
release approval. Deploy any new SVG assets before content references them.
Follow the repository staging-first workflow, verify the exact deployment SHA
and live practice journey, and keep Full Test outside the mutation.
