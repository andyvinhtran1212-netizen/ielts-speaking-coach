# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved this
work on 2026-10-30 at 17:20 (UTC+7), in the Leader chat (card `t931s2961`).
The Leader relayed his reply verbatim:

1. "Duyệt spec 0043"
2. "Giáo viên có dùng, làm cả trang giảng viên"
3. "Buổi yếu là dưới 60%"
4. "Đề bị sửa sau khi giao thì không hiện số"

What these decide:

1. LESSONREPORT-0043 is approved as written, with the open questions Q1–Q5
   resolved in `spec.md` § Owner decisions.
2. Q1: the instructor page (FR-013) and the instructor API (FR-010) are both in
   scope.
3. Q2: a lesson is weak when it is strictly below 60% (FR-007).
4. Q5: when the bank has drifted from the assigned revision, the report
   refuses with 409 and shows no numbers (FR-008).

Leader decisions recorded on the same day:

- Spec number 0043 is confirmed.
- The FR-002 importer `meta.lesson_map` change ships with the 0043
  implementation job, not with PR #2062.
- Q3: no production query is made, because no production access is granted.

The production final (bank id starting `590ce416`, imported on 2026-10-30 at
17:12 UTC+7) is resolved through FR-001's `skill`/`item_key` sources. It is
neither re-imported nor modified.

Scope: there is no migration. Code goes to staging first. Promotion to
production needs the owner's explicit authorization at the `staging` →
`main` promotion, as for every release.

## Owner decision on 2026-10-31 (Q6)

Vinh (repository owner) decided on 2026-10-31 (UTC+7), in his chat with
Claude, to take option (a) for review thread r4422843556: mastery-mode lesson
numbers are a first-attempt baseline and are not reconciled against the
official score. Claude only proposed the options; the decision is the owner's.

- FR-003: mastery mode keeps the first answer per qid; rows carry
  `baseline: "first_attempt"`.
- FR-004: reconciliation applies to quiz-only `single_attempt` assignments.
  Mastery rows carry `reconciled: false`, never `score_mismatch`, and never set
  `stale` for a score difference.
- Rejected option (b): report the verdict's session set. It always reconciles
  but shows post-retry results and loses the first-attempt diagnosis.
