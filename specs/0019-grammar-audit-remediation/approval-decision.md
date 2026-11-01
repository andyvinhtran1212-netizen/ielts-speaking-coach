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

## Revision 3 — follow-up text publications for two more managed banks (PC-J203)

**State: AWAITING owner approval of the FR-007 text.** Content Management
signed the `punc_semi_b2` and `cmp_mult_b2` "After" texts verbatim on head
`147399574` and wrote the `punc_strat_b2` text below
(`reviews/PR-1977.md`, CM section, 2026-10-30). Raised by the Code Reviewer
(`reviews/PR-1948.md`, non-blocking notes) and Content Management in the PR #1948
sign-off (`/workspace/qa/pcj140/SIGNOFF-CM-PR1948.md`, point 10: "ngoài phạm vi
→ PC mở phiếu"). This revision is approved only when Vinh approves the new
FR-007 text in the pull request that adds this section, Content Management
signs every "After" text below, and that pull request is merged into `staging`
with a merge commit. It authorizes no implementation, migration apply or
publication by itself.

### Why FR-007 has to change again

Both banks are managed (`grammar_quiz_reviewed_sources.json` binds each to one
reviewed source) and both are already cut over on staging. Read-only check
(`SET TRANSACTION READ ONLY`, Management API, 2026-10-30, job PC-J203):

| Environment | Code | Banks (version: code suffix) | Current | Sessions per bank |
|---|---|---|---|---|
| staging | punctuation | v1 original, v2 `~6e1bd1a2c81a848b` | v2 | 0 / 0 |
| staging | comparison | v1 original, v2 `~5a6f43ad27098d1c` | v2 | 0 / 0 |

Migration 314 is applied on staging; 339 (Revision 2, PR #1940) is not yet
merged or applied. Production was not read by this job (its scope is staging
only). Production is either the same (second cutover) or still pending its first
cutover under T008; FR-007 covers both cases, because an unrevised predecessor
may be published straight to the final reviewed source. T014 reads production
read-only before any production step.

Publishing the new text on staging is therefore a **second cutover** for each
code, which FR-007 as revised on 28 October allows only for its three named
codes.

### Approved content change, and nothing else

`docs/grammar-quiz-banks/G-grammar-for-reading-punctuation-as-meaning-signals.md`
(CM point 10 for `punc_semi_b2`, CM Rev 3 decision for `punc_strat_b2`; wording
written by Content Management, verbatim; level Vừa — the old text teaches a
wrong rule; `punc_strat_b2` keeps `answer: 0`, its prompt and its three
distractor options):

| Line | qid | Field | Before | After |
|---|---|---|---|---|
| 116 | `punc_semi_b2` | `explain` | `Dấu chấm phẩy nối hai kết quả ngược nhau (Europe↓ / Asia↑) — thường hàm ý **tương phản** (tương đương từ *however/whereas*).` | `Dấu chấm phẩy nối hai mệnh đề độc lập; quan hệ giữa hai vế phải đọc từ nội dung (ở câu này là đối chiếu).` |
| 255 | `punc_strat_b2` | `options[0]` | `Độc lập nhưng gắn bó chặt, thường tương phản` | `Độc lập nhưng gắn bó chặt; quan hệ cụ thể phải đọc từ nội dung` |
| 258 | `punc_strat_b2` | `explain` | `Dấu chấm phẩy = hai ý độc lập có quan hệ ý — thường là tương phản (như *however*).` | `Dấu chấm phẩy nối hai mệnh đề độc lập có liên quan chặt. Bản thân dấu không cho biết quan hệ: có thể là đối chiếu, giải thích, bổ sung hay hệ quả; phải đọc nội dung hai vế (và từ nối như *however*, *therefore* nếu có).` |

`docs/grammar-quiz-banks/G-grammar-for-reading-comparison-structures-in-reading.md`
(Code Reviewer note on #1948; wording proposed by job PC-J203 to match the
article line 79 "*three times higher than* cũng hay gặp, thường hiểu là ×3";
signed verbatim by Content Management, not rewritten):

| Line | qid | Field | Before | After |
|---|---|---|---|---|
| 187 | `cmp_mult_b2` | `explain` | `'three times as high as' = gấp đúng 3 lần. Cấu trúc 'X times as + adj + as' luôn chỉ bội số chính xác — rõ ràng hơn 'three times higher' (dễ bị hiểu 2 cách).` | `'three times as high as' = gấp đúng 3 lần. Cấu trúc 'X times as + adj + as' luôn chỉ bội số chính xác; 'three times higher' cũng hay gặp và thường hiểu là ×3.` |

No other byte of either file changes. Except the `punc_strat_b2` options[0]
text, prompt, options, answer, accept, hint, qid, item_key, type, input, skill,
order, points, bank metadata, `meta` and `words_count` are unchanged; the keyed
option stays index 0, so no learner answer changes credit. The parsed
bank metadata of both v3 sources equals the retained binding metadata.

| Code | Retained source (v2, current today) | Retained manifest | New source (v3) | New manifest |
|---|---|---|---|---|
| punctuation | `6e1bd1a2c81a848b54cfe69cb103f1d0068dba137b3bda01ba81dcd49b226398` | `aec5a81944df5e3c69d582a1f854dd54ad7709de515558f131f6db328a1286a4` | `cf1f073df8e77a14710da78e3cb896d02fd1a352936fd8678df4e264b8a37921` | `8d9f1d62464ce384be698a995f5f0afea2bfc708b2383753060fd5bdf6b1d5b0` |
| comparison | `5a6f43ad27098d1c7da3d625d0790d113d16a08387ccfcad39dfff5fd45c4bae` | `35b69854c1f3e116c3746fb3a18ffba419389ed65d89c881a5e239095e810896` | `2f25f9a616650a5fe6923809f60ae21241a88f26c4f198b196c767f08cc75bba` | `07a370649df87f3e71e252140da325569cf95dd2e3c7d411ceb8e7d8b78bc17e` |

Manifest hashes were computed with the same parse and `_hash` as
`parse_reviewed_source` (`backend/services/grammar_quiz_revision_source.py`);
the same script reproduces both retained manifests exactly.

The new bindings keep the retained binding's metadata exactly. Their
`allowed_fields` are the retained audit fields plus the new follow-up fields;
`followup_fields` are exactly `punc_semi_b2` → `explain`, `punc_strat_b2` →
`options`, `explain` and `cmp_mult_b2` → `explain`. Both retained bindings
stay valid identities.

`punc_strat_b2` (lines 254–258) taught the semicolon as "thường tương phản
(như *however*)" in its keyed option 0 and its explain, contradicting the fixed
`punc_semi_b2` and article line 69. Content Management decided to fix it in this
revision, because FR-007 forbids a third cutover of this code. The punctuation
v3 hashes above include it; the earlier v3 without it (`7c562cf7…`/`da311f11…`)
is withdrawn.

### Implementation plan (separate high-risk PR, after this revision merges and after PR #1940)

Revision 3 extends the Revision 2 design and does not replace it. The
implementation PR must branch from a `staging` that contains both this
revision's merge commit and PR #1940 (migration 339).

**Migration** — the next free number, assigned by the Leader at implementation
time (on 2026-10-30, 339–344 are reserved, 345/346 are on `staging`, and 347 is
PR #1965). Additive and function-only, in the advisory-locked runner:

1. `CREATE OR REPLACE public.grammar_quiz_audit_binding` with the embedded JSON
   equal to the new `grammar_quiz_reviewed_sources.json`: every existing binding
   byte-identical, the two new bindings added.
2. `CREATE OR REPLACE public.grammar_quiz_followup_pair` (the 339 lookup) with exactly five rows: the
   three from 339, plus punctuation `6e1bd1a2…` → `cf1f073d…` and comparison
   `5a6f43ad…` → `2f25f9a6…`. Unknown code → NULL. Same signature,
   `IMMUTABLE`, `search_path` and REVOKE/GRANT as 339.
3. No table, column, row, bank, question or learner write. Postcondition: bank,
   question, session, attempt and stat counts unchanged; the LSU, Task 1 and
   few/little chains still validate.
4. Rollback file (in `backend/migrations/rollback/`) re-creates the 339
   bodies. It is valid only while no Revision 3 v3 bank exists in that
   environment; after a publication, rollback means disabling new starts on the
   v3 bank, never function restore or deletion.

**Code:** two more `FOLLOWUP_CODES` entries in
`backend/services/grammar_quiz_revision_source.py` matching the lookup, two
more `GRAMMAR_FOLLOWUP_CODES` entries in
`frontend/lib/admin-grammar-revision-model.ts` (both names as in PR #1940
head `138e995d9`), the two bank files above,
`backend/services/grammar_quiz_reviewed_sources.json` (new bindings plus
`active_source_sha256`) and `frontend/tests/fixtures/grammar-audit-banks.json`.
Tests: the Revision 2 actual-PostgreSQL follow-up suite parametrised over the
two new codes (first cutover straight to v3, second cutover from v2,
continuation, reset/readonly ineligibility, receipt retry and conflict, fourth
bank and second follow-up refused), every other code still limited to one
cutover, and the Node audit-engine/admin-model suites. No existing pin or test
is removed, skipped or loosened; every pin moves by recomputing it from the
approved bytes.

**Re-publish:** exactly as in Revision 2 (`/admin/vocab/quiz` → Grammar
revision: read, back up, preview showing only the named follow-up fields, commit
with a fresh operation UUID, readback of v3 `~cf1f073df8e77a14` /
`~2f25f9a616650a5f` current and v1/v2 retired with unchanged history). Staging
first after the migration and exact deployed SHA; production after promotion,
under FR-009.
