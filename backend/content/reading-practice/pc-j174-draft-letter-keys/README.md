# PC-J174 — four draft Reading groups with missing letter options

Prepared for **staging only**, project `zjphffoujxkpltixsbzj`. **Not applied.**
CM confirmation of this package and a subsequent staging retest remain pending.
No production data was accessed or copied; every content value comes from the
existing staging original or its staging REV counterpart.

## Root cause and scope

J110-012/036/062/077 are **Reading group identifiers**, not paper numbers.
The original importer stored letter-answer tasks as text completion with empty
`payload.options`. Instructions and option lists remained embedded in a combined
prompt/template. The Next player therefore showed a passage-word rubric and
text inputs instead of selectable letter options. Severity: **Low (P3)** because
all four original papers are private drafts.

| J110 group | Original paper | Questions | Presentation source on staging | Result |
| --- | --- | --- | --- | --- |
| 012 | ILR-RDG-CAM-B13-T2 | 38–40 | MOCK0016-20261003-C13R2-REV01 | matching_sentence_endings; A–D; keys B/C/D |
| 036 | ILR-RDG-CAM-B15-T3 | 27–31 | MOCK0016-20261003-C15R3-REV01 | matching_sentence_endings; A–F; keys C/B/F/A/E |
| 062 | ILR-RDG-CAM-B18-T3 | 31–35 | MOCK0016-20261003-C18R3-REV01 | summary_completion; word bank A–I; keys H/D/F/E/B |
| 077 | ILR-RDG-CAM-B20-T2 | 33–37 | MOCK0016-20261005-C20R2-REV03 | summary_completion; word bank A–H; keys F/D/H/B/G |

C20R2 REV02 and REV03 have identical presentation and keys for Q33–37.
The package changes exactly 18 `reading_questions` rows: `question_type`,
`prompt`, and presentation keys `options`, `instruction`, `template` in `payload`.
Sentence groups use the REV's individual stems; summary groups use its clean
summary template and placeholder prompts. This removes obsolete passage-word
instructions and duplicated inline option lists. Original marking, explanations,
other payload keys, passages, publication and admission policies are preserved.
No application code or schema changes are needed.

The Leader addendum about **ILR-LIS-012 / J107 a2** concerns a different Listening
paper. Its REV01 map already has CM approval recorded in
`/workspace/qa/pcj107/SIGNOFF-CM.md` (29 October, 15:55 UTC+7). This Reading package
does not edit that map, its questions, answers or audio. The shared number 012
does not identify the same content. The J107 fallback is outside this package.

Source evidence: CM's 29 October 16:50 response in
`/workspace/cc-jobs/handoff/content-manager/20261029-PC-J110-gioi-han-tu-mac-dinh.md`,
§3 and §CM trả lời. That response identifies the repair and REV sources; it is
**not approval to apply this exact package**.

## Files and execution

- `staging-precheck-readonly.sql`: read-only dry-run and post-apply readback.
- `staging-apply.sql`: atomic update with original-content and REV-source md5 guards.
- `staging-rollback.sql`: atomic restoration with reverse md5 guards.

Before applying, record CM OK with this apply SHA-256 in the content-manager
handoff. Run the read-only file: all 18 rows must have
`transaction_read_only=on`, `identity_policy_ok=true`, `ready_before_apply=true`,
`matches_after_apply=false`, and `source_unchanged=true`. Any drift requires a new
read, review, rehearsal and approval; never refresh hashes to bypass the failure.

Submit the **entire** apply file as one staging Management API query request
(`read_only: false`) or use `psql -X -v ON_ERROR_STOP=1 -f staging-apply.sql` with
explicit staging credentials. Follow the job's request-file, SENDING/RESULT log
and redirected-output rules. Do not split statements or retry an unclear result
before a read-only reconciliation. Apply is allowed only after CM OK; rollback
is for reversing this exact package and must follow the same logging rules.

Read back with the read-only file: all 18 rows must have
`identity_policy_ok=true`, `matches_after_apply=true`, `ready_before_apply=false`,
and `source_unchanged=true`. CM then checks admin preview for each group: one
bank, correct stems/summary, all letter choices, and unchanged reference keys.
These originals stay draft and unavailable to learners.

Both mutations lock paper parents in canonical order, hold passage membership
and question/source rows stable, validate every row before updating, and verify
full content md5 afterward. Hashes include answer/explanation/skill metadata and
exclude only `created_at`/`updated_at`. A repeated apply or rollback fails safely.
The normal source triggers advance `mock_content_revision` by 3/5/5/5 on apply
and again on rollback; revision counters and timestamps are not restored.

| File | SHA-256 |
| --- | --- |
| staging-apply.sql | `7b307ffe559aa0e74468cc59600110bd3e088bbd73031195edae77661529b912` |
| staging-rollback.sql | `1b55a58baf76c58a02c1452d11088b29d51709d98d457e2697db0876b1fe056e` |
| staging-precheck-readonly.sql | `83994016d602fbcbfea73a7826d9ef9d8c0e33d03b5619189aea9e09090a7f9c` |

## Verification (29 October 2026)

- Isolated PostgreSQL 17 rehearsal: **10 checks passed**. Apply changes exactly
  18 rows; all 342 other questions, 27 passages and paper policies stay unchanged.
  Rollback restores original content. Replay, last-row drift, REV-source drift,
  non-draft policy, wrong passage membership and later edits before rollback
  are rejected atomically. Correct letters pass and distractors fail using the
  existing backend `_grade_one` function (18 each).
- Local fixture uses the deployed source/policy/lock/timestamp trigger functions.
  Dependency discovery alone is stubbed to `[]`; this does not verify live
  admission/dependency discovery or a deployed UI journey.
- Staging read-only dry-run: **18/18** original md5, source md5, draft and policy
  identity checks passed; no staging mutations were sent.
- Next React rendering: **63 tests across 7 files passed**, including four
  temporary tests rendering these exact post-patch rows. Each bank appears once,
  each of the 18 controls offers the whole bank and accepts its correct letter,
  and the old passage-word instruction is absent.
- Reading Node contracts: **415 passed**. Backend Reading suite: **554 passed,
  51 skipped** (unconfigured local grammar-focus PostgreSQL fixture; no live coverage claimed).
  No tests/assertions/checks were weakened.

Task-owned snapshots, the temporary rehearsal/React checks and full outputs are
outside the committed package at
`/workspace/cc-jobs/job-q-19s-pc-j174-cambridge-draft-letter-keys.log.d/`.
Operational approval and retest handoff:
`/workspace/cc-jobs/handoff/content-manager/20261029-PC-J174-draft-letter-options-approval.md`.
