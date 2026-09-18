# Implementation plan

## Architecture impact

- Extend the existing Course assignment API and admin UI with an optional
  duration; keep the Course bank and quiz-session services canonical.
- Extend the assignment snapshot with a backward-compatible completion mode;
  keep verdict, report release, retry admission, and terminal state server-owned.
- Add an admin-only, read-only Course bank preview contract and reuse the
  canonical bank/question stores rather than serializing content into the form.
- Add atomic PostgreSQL functions for timed start, boundary-aware session and
  progress writes, retry creation, and safe bank replacement.
- Run a small periodic backend reconciliation worker for expired attempts.
- Extend the existing learner runner and admin submissions views rather than
  introducing a new assessment surface.

## Data and contracts

- Persist the assignment duration and snapshot it onto each timed attempt so a
  later admin edit cannot rewrite history.
- Return server time, cutoff, remaining time, and timed-out state through the
  existing Course quiz contracts; generated frontend types must stay in sync.
- Treat the earliest of duration cutoff and assignment due date as canonical.
- Treat missing/unknown completion mode as mastery. A single-attempt terminal
  result uses the existing immutable mastery attempt ledger, stores `completed`
  as its next action, and rejects all later session generations.
- Keep answer-bearing report endpoints sealed for active single-attempt items;
  terminal hand-in or timeout opens the existing report from persisted evidence.
- Use compare-and-set/row-lock semantics so pass, fail, timeout, retry, and
  background finalization converge on one terminal result.
- Replace an unused assessment bank's question rows and bank metadata in one
  transaction; reject replacement when assignments or sessions reference it.

## UI and interaction

- Admin homework creation exposes a 1–720 minute optional numeric field only
  for eligible quiz-only Course banks and surfaces backend validation errors.
- Admin homework creation exposes two completion-policy cards, conditionally
  shows mastery-only inputs, and opens a canonical read-only bank preview.
- The shared dialog becomes a fixed shell with an independently scrolling body;
  the assignment variant is wider on desktop and full-width on small screens.
- Learners see A–E choices and an accessible countdown derived from server
  timestamps; expiry disables answer mutation and resolves through the server.
- Admin submissions display timeout status from canonical persisted state.

## Work decomposition

- Database migrations establish atomic timed single-attempt admission before
  services depend on it.
- Backend service/router changes validate assignment and assessment state, run
  the expiry reconciliation loop, and expose the new response fields.
- Frontend changes consume the generated contract and implement admin/learner
  states.
- Focused import, service, migration, frontend model, and browser tests cover
  each boundary before staging verification.
- Accessibility verification covers visible actions, focus containment, Escape,
  themes, reduced motion, and narrow viewports for form and preview states.

## Rollout and rollback

- Apply forward-only migrations on staging, deploy the exact implementation
  SHA, and verify both timed and untimed journeys.
- Promote the staging SHA to production only after required checks and review.
- Apply production migrations immediately before promotion, then import the two
  banks after application health is confirmed.
- If application rollback is necessary, retain the additive schema and disable
  the worker; reconcile any expired attempts with the idempotent worker after
  restoring service.

## Verification strategy

- Validate each source package against JSONL, DOCX/PDF rendering, answer key,
  expected count, uniqueness, and five-choice constraints.
- Run focused pytest for importer, assignments, quiz service, migrations,
  retries, resume, and timeout races.
- Run frontend unit/browser tests plus TypeScript, OpenAPI drift, and route build.
- Query staging and production for migration ledger and imported bank invariants.
- Exercise live admin assignment and learner timeout/resume behavior on staging.
