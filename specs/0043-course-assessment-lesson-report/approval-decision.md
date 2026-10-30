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
