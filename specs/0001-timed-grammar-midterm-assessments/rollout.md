# Rollout and rollback

## Preconditions

- Reviewed 120-question and 200-question source packages pass strict dry-run
  validation with five distinct choices and expected answer keys.
- Forward migrations are additive/idempotent and staging credentials are loaded
  from the existing deployment environment.
- The implementation SHA passes backend, frontend, browser, TypeScript, OpenAPI,
  route-manifest, and spec-governance checks.

## Staging

- Apply migrations in numeric order and confirm ledger entries.
- Deploy the exact PR SHA through the normal staging branch workflow.
- Verify one untimed assignment and one timed assignment through start, progress,
  reload, manual submit, natural expiry, worker reconciliation, and retry.
- Verify one legacy/mastery assignment and one single-attempt assignment through
  active answer sealing, terminal result release, reload, and rejected second start.
- Preview both assessment banks and verify question count, ordering, choices,
  keys, explanations, audio state, and zero assignment/session mutations.
- Record the assignment-dialog viewport, theme, keyboard, and focus evidence.
- Run transactional probes for unused-bank replacement and assigned-bank refusal.

## Production

- Require explicit user authorization, green staging checks, resolved review
  comments, and a reviewed staging-to-main promotion PR.
- Dry-run then apply only pending migrations immediately before merge.
- Verify backend health and production frontend deployment at the promoted SHA.
- Import the two banks only after deployment; query their exact counts, five
  choices, valid answers, private visibility, quiz-only sections, and distinct
  stable codes.

## Rollback and repair

- Revert application code through the normal staging-first promotion; leave
  additive migrations in place to avoid destructive data loss.
- Disable the periodic reaper if it is implicated while retaining browser/server
  finalization paths.
- Re-run the idempotent reconciliation worker to repair missing submission
  receipts from existing timeout ledgers; never rewrite a canonical pass.
- A single-attempt terminal ledger is immutable. Repair may restore a missing
  submission receipt from that ledger but must never reopen retry entitlement.
- Do not delete or replace a bank after assignments/sessions exist. Correct bad
  production content through a new versioned bank and reassignment plan.

## Observability

- Backend logs identify reaper batches, per-attempt failures, cutoff decisions,
  and import refusal without exposing learner answers.
- Log rejected second-start attempts and preview-read failures without logging
  answer content. Monitor single-attempt items whose terminal ledger exists but
  submission receipt or score is absent.
- Assignment/session/submission rows and migration ledger are the operational
  source of truth for verification.
- Any contradictory terminal state, repeated worker failure, or unexpected bank
  count blocks promotion/import and is owned by the learning-platform operator.
