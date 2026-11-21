# Owner approval

On 2026-11-20 at 16:49 Asia/Saigon (09:49:38 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0061 0075 0076 0077.

The spec approved is `spec.md` on the spec PR #2402 (branch
`codex/g10-t13-spec-admingroup`), `spec.md` sha256
`4706191d4b7fd51b9d9c656faf2a29224471cb204af04bcaefe1d45492a8f36b` before this status change.

Scope of this approval:

- ADMINGROUP-0077 as written (status draft → approved). Requirements are unchanged by this
  commit. Open questions in the spec keep their temporary defaults (the
  "Mặc định tạm" column of GOI-10 §10 and the spec's Open questions) until anh
  Andy answers them; the approval message did not answer them separately.
- Implementation may start with the G10-T14 pilot (three simple admin groups) as
  its own PR into `staging`; the remaining waves (G10-T15) follow the pilot result
  (Q-d1 temporary default: pilot, then stop and ask).

Not approved by this decision:

- Merging any PR (each needs anh Andy's own "merge #N").
- Any database read or write, environment change, production read, write or deploy.

## Amendment — FR-005 and Q-d1 (pilot result)

On 2026-11-20 at 17:59 Asia/Saigon (10:59:53 UTC), anh Andy answered a decision card
in the project thread "Rà 30 spec đang triển khai dở" by pressing the option
(verbatim):

> Chấp nhận thí điểm, sửa FR-005

The card asked "Thí điểm gộp group admin: chấp nhận và sửa FR-005, hay sửa lỗi sheet
trước?" and that option read, verbatim: "Mở PR thí điểm khi #2402 merge; FR-005 đổi
thành không kém hôm nay, không nhân đôi sheet nền; chọn 1 group cha (Q-d1); sửa sheet
còn sót là việc riêng."

Why: the G10-T14 pilot showed that, with `cacheComponents`, the previous route's
stylesheets stay in the DOM after client navigation. This already happens on
`staging` today, where the 4 base sheets are also duplicated. The pilot reduces it, and
the client-navigation screenshots before and after are identical.

Changes recorded by this amendment (`spec.md` sha256
`ad5c257036d3c98bd3de69184de6b126712e059afc08a959692b58c5288149f6` before it):

- FR-005: client navigation between two admin pages is no worse than today. The
  screenshot matches the same scene on the pre-PR SHA, and each of the 4 base sheets
  appears exactly once after any client navigation. Previous-route sheets kept by
  `cacheComponents` are out of scope here. Removing them is a separate task. The
  sidebar selection, activation gate and `<body>` class after navigation must still
  equal a direct load.
- Scenarios 2 and 3 are restated against that bar. `verification.md`, `plan.md` and
  `tasks.md` (T002 dependency) follow.
- Q-d1 is answered: one parent group `(authed-admin)`, with child groups using
  plain `<link>`.

The rest of the approval above is unchanged: merges, database, environment and
production still need anh Andy's own typed approval.

No learner data is included here.
