# Owner approval

On 2026-11-20 at 11:04 Asia/Saigon (04:04:45 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0055, 0056 và 0074
> đồng ý cả 11

The spec approved is `spec.md` as merged into `staging` by PR #2339
(staging `c0a04fd6`, `spec.md` sha256
`810289ef8244f9b71d2a6371c9bc003a64e7c47479fb6c94af34b881cc0f07c8` before this
status change). "đồng ý cả 11" answers the eleven confirmation questions in
`docs/proposals/commercialization-2026-11/04-VIEC-DE-LAI.md` ("Rà soát trước
bàn giao 18/11") with the defaults already applied there; question 1 of that list
(only an admin grants extra credits or converts a legacy class to metered
credits) is Q32(c) of this spec.

Scope of this approval:

- ADMINIA-0074 as written (status draft → approved). Requirements are unchanged by
  this commit. Open questions in the spec's question table keep their temporary
  defaults ("Mặc định tạm người thực thi dùng") until anh Andy answers them.
- Implementation tasks T002–T043 may start in the order of `tasks.md` §6.0, each as
  its own PR into `staging`.

Not approved by this decision:

- Merging any PR (each needs anh Andy's own "merge #N").
- Applying any migration (440–459) to any database; each needs anh Andy's own
  typed approval for that window.
- Any production read, write or deploy.

## Amendment 1 — planned `PUT` routes become `PATCH` (2026-11-21)

On 2026-11-21 at 08:28 Asia/Saigon (01:28:29 UTC), anh Andy wrote in the project
chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0078; duyệt PATCH 0074 0061; đồng ý Q-b1 theo đợt

This approves "PATCH 0074": every planned `PUT` route in `plan.md` now reads `PATCH`.
Paths, request bodies, responses, errors and roles are unchanged, and so is every
requirement. Changed in `plan.md` (sha256 before this amendment
`bc49791aff12016eef69be25c15541949771ebc45958c9d9312cf606400f4e4d`):

- line 242: `PATCH /admin/settings/thresholds` (matches the route #2393 shipped);
- line 243: `GET /admin/settings/{section}` · `PATCH`, and "`payment` chỉ có PATCH khi Q20 được duyệt";
- line 297: `PATCH /admin/cohorts/{c}/lessons/{lesson_id}/review-items`;
- line 317: `PATCH /admin/mock-exams/{id}/audience`;
- lines 409–410: the two read-only rows say a `PATCH` sending that key returns 422.

Reason: the backend CORS allow-list (`backend/main.py` `_CORS_METHODS` =
GET, POST, PATCH, DELETE, OPTIONS) has no `PUT`, so a browser preflight for a `PUT`
route fails. #2393 already shipped `PATCH /admin/settings/thresholds`. The GOI docs
were changed the same way in #2423 (GOI-09/11) and #2424 (GOI-06/07/12/13).

No learner data is included here.
