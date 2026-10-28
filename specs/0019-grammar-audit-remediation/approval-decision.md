# Approval decisions

The original GRAMMARAUDIT-0019 approval (10 October) is recorded in `spec.md`
§Open questions and `tasks.md` T004. This file records later revisions.

## Revision 1 — CQA-F09 "QUÁKHỨ" in past-perfect.md

**State: APPROVED by the human owner.** Vinh (repository owner) chose option (a)
for CQA-F09 on 2026-10-28 at 20:56 (UTC+7), relayed by the Leader (t252u):
revise spec 0019 so the typo can be fixed, and update the locked hash.

Background: Content QA 27/10 finding F09 (`/workspace/qa/content-qa-1027.md`)
reported `Một thời điểm trong QUÁKHỨ` in the Past Perfect vs Present Perfect
table. PR #1767 and job PC-J17 (q-110) both left it unfixed, because
`frontend/tests/grammar-exact-form-engine.test.mjs` requires the file's bytes to
match `after_sha256` in `source-scope.json`.

Approved change, and nothing else:

| File | Line | Before | After |
|------|------|--------|-------|
| `backend/content/tenses/past-perfect.md` | 186 | `\| **Mốc tham chiếu** \| Một thời điểm trong QUÁKHỨ \| Hiện tại \|` | `\| **Mốc tham chiếu** \| Một thời điểm trong QUÁ KHỨ \| Hiện tại \|` |

| `source-scope.json` field for that path | Before | After |
|------|--------|-------|
| `after_sha256` | `79d09711024ac4ce63620b91186cbae860ec63c005085f1533cd88adcfdccdc5` | `037f6ca29d689533c5caedbfc27063f63299f0b8ce7a202db97032dbbfb73d1f` |

Unchanged: `before_sha256` (`80d10da3…`, the 0015 source the exact-form bank
fixture was built from), `frontend/tests/fixtures/grammar-exact-form-banks.json`,
every quiz bank and its reviewed source hash, every qid, the FR text and the
production/staging publication state. The file is read from disk by
`backend/services/grammar_content.py`, so no database write is needed.

The implementation PR changes the article byte and the `after_sha256` pin in one
commit, so the exact-form test never sees a pin that disagrees with the file.
This revision does not authorize any other edit to the 18 pinned sources.
