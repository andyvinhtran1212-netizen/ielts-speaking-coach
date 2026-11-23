# Owner approval

On 2026-11-20 at 16:49 Asia/Saigon (09:49:38 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0061 0075 0076 0077.

The spec approved is `spec.md` at head `0fa737e7` of PR #2397 (`spec.md` sha256
`ebcc6a0447d8c7821fbef2ba9a508be0fe3e3e372b642d5a5e9b6670b2644b2e` before this
status change), which already includes the two review fixes on that PR (private
`library-media` bucket with backend-served, `no-store` media, FR-064; Grammar
mark `item_key` in the request body). This record covers 0061 only; 0075–0077
are recorded in their own folders.

Scope of this approval:

- LIBRARY-0061 as written (status draft → approved). Requirements are unchanged
  by this commit.
- The design choices written into `plan.md` are part of what is approved:
  migration number 400 in the G06 block (N3), `library_topics.shelves text[]`
  shared by both shelves (N2), private `library-media` bucket served only by the
  backend media route (FR-064), `E_NOT_APPROVED` publish gate.
- Open questions in the spec's question table keep their temporary defaults
  ("Mặc định tạm") until anh Andy answers them. In particular N1 is not answered
  by this decision: the 530 sets with `review.status='needs_review'` are imported
  with `publish:false` and are not published until a reviewer signs
  `review.by/at`; only the 19 sets already `approved` may be published.
- Implementation tasks in `tasks.md` may start in dependency order, each as its
  own `high-risk` PR into `staging` citing `Spec: LIBRARY-0061`.

Not approved by this decision:

- Merging any PR (each needs anh Andy's own "merge #N").
- Applying migration 400 (or any 400–419) to any database; each needs anh
  Andy's own typed approval for that window.
- Running the import scripts with `--execute` on any database, and any
  production read, write or deploy.

Later edit: `4a1385fd` (after this record) changed only the wording of open
question N3 to match `plan.md` §5.2 (row 400 `present` in the T02 PR) and added
an allow-list case to the planned `tests/test_library_media.py`; no requirement
changed. A second later edit made T018's first publish batch "at most 50
eligible sets (currently 19)" in `tasks.md` and `rollout.md`, consistent with N1
staying open; the 10-page QA step is kept.

During T006 review (PR #2415) `plan.md` §5.7 and `rollout.md` were aligned with
FR-015 and FR-019, which did not change: public JSON routes use
`Cache-Control: no-cache` (revalidate every use, so a withdrawn set is 404 on
the next request) instead of the 60 s public cache, and the API returns public
type codes (`problem-solution`, …) and `task2|task1`, never stored codes.

## Amendment 1 — the marks route uses `PATCH` instead of `PUT` (2026-11-21)

On 2026-11-21 at 08:28 Asia/Saigon (01:28:29 UTC), anh Andy wrote in the project
chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0078; duyệt PATCH 0074 0061; đồng ý Q-b1 theo đợt

This approves "PATCH 0061": the Library marks route `PUT /me/marks/{shelf}/{kind}`
becomes `PATCH /me/marks/{shelf}/{kind}`. The path, the JSON body `{item_key}`,
the `204` response, idempotency ("twice → one row") and the 404 rule are unchanged,
and so is every requirement. Changed (sha256 before this amendment):

- `plan.md` line 138, §5.4 route table (`165e526d228028603066c6979dca8597349ddbae33ccd14d5cd307801009e340`);
- `spec.md` line 239, "`PATCH` dấu hai lần → một hàng" (`3af26be976f7e1cf2bf3c604695ef24e6f90c02e35d4643fa2171bbc318a352a`);
- `tasks.md` T016, `GET/PATCH/DELETE /api/library/me/marks…` (`5ac33ff302de74499d531169e99cde10d68d881c217c5eff8684a3e7924129a6`);
- `verification.md` FR-061 row, "PATCH hai lần một hàng" (`71d9aee0f492de68102a0d3e3150b820f571d631e06d5fad5385d05ac5ffb918`).

Reason: the backend CORS allow-list (`backend/main.py` `_CORS_METHODS` =
GET, POST, PATCH, DELETE, OPTIONS) has no `PUT`, so a browser preflight for a `PUT`
route fails. #2393 already shipped `PATCH /admin/settings/thresholds`. The GOI docs
were changed the same way in #2423 (GOI-09/11) and #2424 (GOI-06/07/12/13).

No learner data is included here.

## Amendment 2 — store the Writing sample sign-off in the DB (proposed 2026-11-23, NOT YET APPROVED)

Proposed in the G06-T02b PR. Nothing in this amendment is approved until anh
Andy writes his approval; it is then recorded here verbatim with its time, and
this heading drops "NOT YET APPROVED".

What changes: `plan.md` §5.2 (three columns in the `writing_samples` table) and
new §5.2b (migration `401_writing_sample_review_signoff.sql`, its three CHECKs
and its rollback), `tasks.md` (new T002b), `rollout.md` (apply 401 after 400 on
staging), `verification.md` (FR-019 evidence row names the 401 test). No
requirement, scenario or risk changes in `spec.md`: FR-019's publish condition
(`review.status='approved'` with `review.by/at`, `E_NOT_APPROVED`) becomes a DB
CHECK instead of living only in the import script. Open question N1 (who signs
the 530 `needs_review` sets) stays open.

Pre-amendment sha256: `plan.md` 62743aa6af0b56897613fd8df16eb7869a73d42ebbe2aa1b63b5544df417a0d8,
`tasks.md` 7b3a33cfaa58a5cdbf451863917f347b671e76163892bc194d0a0af501a1327d,
`rollout.md` 22df02f33708c085c60637be4be7db918cb1cfc26a69b41e069e4066d80f1e33,
`verification.md` 6522040785d195788adfbdccf312e259b8a3d29404d2306e75094f404ffff4ce.

Not approved by this amendment, even once approved: applying 401 to any
database (needs anh Andy's own typed approval for that window), and merging
this PR or the #2497 / #2498 follow-ups (each needs his own "merge #N").
