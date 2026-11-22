# Owner approval

On 2026-11-20 at 16:49 Asia/Saigon (09:49:38 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0061 0075 0076 0077.

The spec approved is `spec.md` on the spec PR #2400 (branch
`codex/g10-t05-spec-legacyjs`), `spec.md` sha256
`037b6b7d1467eeb7920aa8160e6d6791212128ee381dc5675c7d6f401a966a37` before this status change.

Scope of this approval:

- LEGACYJS-0075 as written (status draft → approved). Requirements are unchanged by this
  commit. Open questions in the spec keep their temporary defaults (the
  "Mặc định tạm" column of GOI-10 §10 and the spec's Open questions) until anh
  Andy answers them; the approval message did not answer them separately.
- Implementation of the evidence tasks (G10-T06: restore the Gate F collector and
  its test from `ef47b02de^`) may start as its own PR into `staging`. Under the
  Q-b1 temporary default, no file in `frontend/public/js` is deleted (waves W1–W6
  wait for Q-b1).

Not approved by this decision:

- Merging any PR (each needs anh Andy's own "merge #N").
- Any database read or write, environment change, production read, write or deploy.

## Answer to Q-b1 (2026-11-21)

On 2026-11-21 at 08:28 Asia/Saigon (01:28:29 UTC), anh Andy wrote in the project
chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0078; duyệt PATCH 0074 0061; đồng ý Q-b1 theo đợt

"đồng ý Q-b1 theo đợt" accepts the proposed answer to Q-b1 in `spec.md`
(sha256 `80ce7b4b1ed9a0bf32754043139b4a6ec23990138a6a8118ab1813df3b2e52ee` before this record): legacy JS in `frontend/public/js` may be
removed **in waves W1–W6, one PR per wave**. Each wave PR is `high-risk`, cites
`Spec: LEGACYJS-0075`, carries its per-file reference evidence (T001), and merges
only on anh Andy's own "merge #N". The URL `/js/<file>` of a removed file returns 404.

Still not approved: merging any wave PR without its own "merge #N"; Q-b2 (reading Vercel
access logs) stays at its temporary default, layers 1–2 only, with "chưa có log" noted in
each PR.

No learner data is included here.
