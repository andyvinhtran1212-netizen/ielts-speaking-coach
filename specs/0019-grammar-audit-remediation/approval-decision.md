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

## Revision 2 — follow-up explain publications for two managed banks (option C)

**State: AWAITING owner approval of the FR-007 text.** Vinh chose option C on
2026-10-28 (t266u, relayed by the Leader): handle the two bank edits as a
separate spec-0019 amendment, apart from Revision 1. This revision is approved
only when Vinh approves the new FR-007 text in the pull request that adds this
section and that pull request is merged into `staging` with a merge commit.
It authorizes no implementation, migration apply or publication by itself.

### Why FR-007 has to change

Both banks are managed and were already cut over on **both** environments on
2026-10-10. Read-only check (`SET TRANSACTION READ ONLY`, Management API,
2026-10-28, job q-13t):

| Environment | Code | Banks (version: code suffix) | Current | Sessions per bank |
|---|---|---|---|---|
| staging | Task 1 | v1 original, v2 `~b494b874fc49d79b` | v2 | 0 / 0 |
| staging | few/little | v1 original, v2 `~f758a20763833a2a` | v2 | 0 / 0 |
| production | Task 1 | v1 original, v2 `~b494b874fc49d79b` | v2 | 1 / 0 |
| production | few/little | v1 original, v2 `~f758a20763833a2a` | v2 | 1 / 0 |

Migration 314 is applied on both (one ledger row each). Publishing the new text
is therefore a **second cutover** for each code in each environment. FR-007 as
approved on 10 October forbids that for every code except Long Sentence
Untangling, and the database enforces it: migration 314 embeds the reviewed
bindings and hard-codes the three-bank chain to that one code. A repo-only pin
change (job q-13e, local commit `faac675e8`) passes the Node and non-PostgreSQL
suites but fails `test_grammar_quiz_revisions.py::test_actual_twelve_sources_policy_copy_readback_and_synthetic_original_history`
for both codes on PostgreSQL.

### Approved content change, and nothing else

`docs/grammar-quiz-banks/G-grammar-for-writing-grammar-in-task1.md` (CM item 3a, job q-12h):

| Line | qid | Field | Before | After |
|---|---|---|---|---|
| 129 | `t1_pass_b1` | `explain` | `Process diagram mô tả việc được làm, không nêu ai làm → bị động: is/are + V-ed. 'are transported' đúng vì chủ ngữ số nhiều.` | `Bước do người/máy thực hiện và không cần nêu ai làm → thường dùng bị động: is/are + V-ed. 'are transported' đúng vì chủ ngữ số nhiều.` |
| 143 | `t1_pass_b2` | `explain` | `Bước trong quy trình luôn nêu KHÁCH QUAN, không nêu người thực hiện → bị động present simple: 'is heated'.` | `Đun nóng là bước có tác nhân tác động lên hỗn hợp → thường dùng bị động present simple: 'is heated'. Bước tự diễn ra (water evaporates) vẫn dùng chủ động.` |
| 171 | `t1_pass_i2` | `explain` | `Task 1 process cần khách quan, tập trung vào bước xảy ra chứ không phải người làm → 'The beans are collected by hand' (bị động) phù hợp hơn câu chủ động.` | `Quy trình nhân tạo thường dùng bị động để tập trung vào bước làm, không phải người làm → 'The beans are collected by hand' phù hợp hơn. Chủ động vẫn tự nhiên với bước tự diễn ra (the beans dry in the sun).` |

`docs/grammar-quiz-banks/G-foundations-few-a-few-little-a-little.md` (PR #1850 follow-up):

| Line | qid | Field | Before | After |
|---|---|---|---|---|
| 90 | — (source comment, not parsed into any bank or question field) | — | `# ===== item_key 2 · A FEW / A LITTLE — sắc thái tích cực (đủ dùng) =====` | `# ===== item_key 2 · A FEW / A LITTLE — sắc thái tích cực (một ít, vẫn có) =====` |
| 103 | `fal_pos_b1` | `explain` | `Ngữ cảnh 'plenty of time' cho thấy sắc thái tích cực (đủ dùng) → dùng 'a few', không phải 'few'.` | `Ngữ cảnh 'plenty of time' mang sắc thái tích cực: vẫn còn một ít thời gian → dùng 'a few'. 'Few' nghĩa là rất ít, gần như không có, trái với ý câu.` |
| 132 | `fal_pos_i2` | `explain` | `Ngữ cảnh 'helped him during the trip' cho thấy đủ dùng (tích cực) → dùng 'a little', không phải 'little'.` | `Ngữ cảnh 'helped him during the trip' cho thấy anh ấy biết một ít tiếng Pháp và vốn đó có ích (tích cực) → dùng 'a little'. 'Little' nghĩa là gần như không biết.` |

No other byte of either file changes. Prompt, options, answer, accept, hint,
qid, item_key, type, input, skill, order, points, bank metadata, `meta` and
`words_count` are unchanged, so no learner answer changes credit.

| Code | Retained source (v2, current today) | Retained manifest | New source (v3) | New manifest |
|---|---|---|---|---|
| Task 1 | `b494b874fc49d79bbf9a86a5ae1b78ec5ba59ea18a94193cb4dcf60d0e91ac5a` | `33dc3cdde9ad5e518694b0beec26aabc3bb9db4e98fb33cd7cc219996ff13d3f` | `d95ee61534f3bf2c2343ab0ab76f4f2724f565cba1b37c13444460aa4f872b38` | `b8041a19a25feda6410ca217633a3e0008d6ceb196aa9fb260237aebb450d914` |
| few/little | `f758a20763833a2a0f283c27563bdcab08487443fb73dc6b57844972a51447d9` | `c89abcc9cd111e3e374449f7f439e5a648026250a71e2c9d8a07030f972141df` | `1b865d8c11f69d26cb60df4536c5a6af309b0fe44f3c948ea085b4725934d650` | `fa08f119defca13a4ee5c15e9c85b7922711731994a5899a25b79ce6eb10dd83` |

The new bindings keep the retained binding's metadata exactly. Their
`allowed_fields` are the retained audit fields plus the new explain fields;
`followup_fields` (the fields a follow-up from v2 may change) are exactly
`t1_pass_b1`, `t1_pass_b2`, `t1_pass_i2` → `explain` and `fal_pos_b1`,
`fal_pos_i2` → `explain`. Both retained bindings stay valid identities.

### Implementation plan (separate high-risk PR, after this revision merges)

**Migration `339`** (next free number on 2026-10-28: 336 is #1853, 337 is
CLASSARCHIVE-0030 #1873, 338 is claimed by the unpushed PAPERUPDATEDAT-0037
branch; no open PR, remote branch or worktree has a `339_*` file). Additive and
function-only, in the advisory-locked runner:

1. `CREATE OR REPLACE public.grammar_quiz_audit_binding`: the embedded JSON
   becomes the new `grammar_quiz_reviewed_sources.json`; every existing binding
   stays byte-identical, the two new bindings are added.
2. One private, `IMMUTABLE` lookup (for example
   `grammar_quiz_followup_pair(code) → (middle_source, final_source)`) with
   exactly three rows: LSU `f272f1d1…` → `436d207e…`, Task 1 `b494b874…` →
   `d95ee615…`, few/little `f758a207…` → `1b865d8c…`. Unknown code → NULL.
3. Replace each LSU literal with that lookup, keeping the logic otherwise
   identical: `grammar_quiz_audit_chain` (three-bank allowance and middle/final
   suffixes; the two-bank list also accepts the new final suffix for an
   unrevised predecessor), `grammar_quiz_guard_bank` (follow-up INSERT and the
   retire-middle UPDATE), `grammar_quiz_validate_receipt_envelope` (`followup`,
   `archived_child`, the `code`/`version` exemptions) and
   `grammar_quiz_receipt_data`.
4. Same signatures, `SECURITY DEFINER`, `search_path`, and the same REVOKE/GRANT
   block as 314. No table, column, row, bank, question or learner write.
   Postcondition: bank, question, session, attempt and stat counts unchanged;
   LSU three-bank chain still validates.
5. Rollback file re-creates the 314 function bodies. It is valid only while no
   Revision 2 v3 bank exists in that environment; after a publication, rollback
   means disabling new starts on the v3 bank (rollout.md), never function
   restore or deletion.

**Code** (replaces the single `FOLLOWUP_CODE`; no new endpoint):

- `backend/services/grammar_quiz_revision_source.py`: `FOLLOWUP_CODE` → a
  three-entry `FOLLOWUP_CODES` mapping that matches the migration lookup.
- `backend/services/grammar_quiz_revisions.py` (`_scope` bank limit and
  `followup` detection) and `backend/services/grammar_quiz_resolution.py`
  (three-bank allowance). `FOLLOWUP_OWNERS_SQL` in the classifier is keyed on
  the predecessor, not the code, and needs no change.
- `frontend/lib/admin-grammar-revision-model.ts` (three LSU string checks in the
  read and ACK validators) and its tests.
- Repo content from job q-13e commit `faac675e8`: the two bank files,
  `backend/services/grammar_quiz_reviewed_sources.json` (new bindings plus
  `active_source_sha256`) and `frontend/tests/fixtures/grammar-audit-banks.json`.
- Tests: actual PostgreSQL first cutover with the new final source, second
  cutover from v2, continuation of owned unfinished v1/v2 work, reset/readonly
  ineligibility, idempotent receipt retry and conflicting-payload refusal, a
  fourth bank refused, a second follow-up refused, and every other code still
  limited to one cutover; Node audit-engine/admin-model suites.

**Re-publish** (after the code is deployed and 339 is applied in that
environment; staging first, then production after promotion):

1. `/admin/vocab/quiz` → Grammar revision, or `GET
   /admin/quiz/grammar-revisions/{code}`: read shows v2 current and the
   follow-up available.
2. Back up both banks/questions and history fingerprints, then `POST …/preview`:
   the diff is exactly the explain fields above.
3. `POST …/commit` with a fresh operation UUID; on a lost ACK retry with the
   same UUID only.
4. Readback: v3 `~d95ee61534f3bf2c` / `~1b865d8c11f69d26` current; v1 and v2
   retired with unchanged rows and history; learner exercise endpoint serves
   the new explains.

Staging order: merge implementation → apply 339 on staging → verify deployed
SHA → publish both codes → integrated CI + Live Staging E2E. Production: apply
339 under the advisory lock → promote staging → main → verify production SHA →
publish both codes → readback. FR-009 applies unchanged.
