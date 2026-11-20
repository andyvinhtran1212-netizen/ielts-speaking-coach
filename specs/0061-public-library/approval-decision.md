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

No learner data is included here.
