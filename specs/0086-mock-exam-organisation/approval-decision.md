# Owner approval

On 2026-11-23 at 17:57 Asia/Saigon (10:57:43 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim (the line about
this spec, from a longer message):

> duyệt spec 0073; duyệt sửa FR-007 0071; duyệt spec 0086 với mặc định Q12, Q13 (giữ kỳ thi bù riêng), Q14 (b sau cờ), Q31

The spec approved is `spec.md` as merged into `staging` by PRs #2341 and #2434
(staging `cc6dd4c8`, `spec.md` sha256
`9923b50d60526edd6a900092a207cebed94772ba2b6f59e73678866751150ea3` before this
status change).

Answers recorded with this approval (also written under the spec's Open questions
table):

- **Q12:** adding a class snapshots its roster at that moment; learners who join
  the class later are not added automatically ("Cập nhật theo lớp" adds them).
- **Q13:** keep make-up sittings as their own exam (`source_exam_id`), linked from
  the Thí sinh tab. Results are not merged into the original exam in this round.
- **Q14:** release rules (a)–(e) approved; (b) partial release ships behind the
  `mock_partial_release` flag, off by default.
- **Q31:** self-paced sittings: (a) the clock does not stop when the learner is
  offline or closes the browser, and an expired section is auto-submitted; (b) no
  gap between sections (`MOCK_SELF_PACED_GAP_SECONDS=0`); (c) a sitting started
  before the window closes runs to the end; (d) submitting a section early starts
  the next one at once.

Scope of this approval:

- MOCKORG-0086 as written (status draft → approved). Requirements are unchanged by
  this commit.
- Implementation tasks T031–T034 may start, each as its own PR into `staging`.

Not approved by this decision:

- Merging any PR (each needs anh Andy's own "merge #N").
- Applying any migration (445–448) to any database; each needs anh Andy's own
  typed approval for that window. 446 also waits until the backend that reads
  both mode names is on staging (`rollout.md`).
- Any production read, write or deploy.
