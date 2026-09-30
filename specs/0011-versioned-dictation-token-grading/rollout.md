# Rollout and rollback

## Preconditions

- Land an approved behavioral spec separately before grader/schema work.
- Inventory every standalone/test/attempt write/read consumer and compatible
  version negotiation; preserve unversioned legacy and N-1 client behavior.
- Independently review the deidentified gold cohort and all attached-word,
  punctuation-only, matched/nested/across-word shells, unpaired elision,
  dash-without-whitespace, alignment, filler and invalid-reference cases.
- Review additive migrations, private frozen evidence and source/version
  identity. Classification-only reads must reconcile historical counters and
  unchanged mean-of-means accuracy before any new grading is enabled.

## Staging

- Apply additive migrations before code that depends on their fields.
- Deploy exact frontend/backend SHA with classification-only reporting first;
  reconcile counts/accuracy for identical production-shaped filter fixtures.
- Run approved gold comparison and contract/ownership/idempotency tests. Test
  active legacy attempts, old/unversioned clients, compatible new starts,
  lost-ACK retry, source edits and renderer handoff through completion/reload.
- Verify no default historical mutations, no lost lexical errors, no
  punctuation-free control changes and rollback completion of already-started
  new-version work. Record version scope, exact SHAs and browser evidence.

## Production

- Promote only the validated staging SHAs using the repository release path.
- Enable classification-only reporting, then a bounded compatible new-start
  scope after approved gates. The enablement mechanism must be explicit and
  reversible; do not infer compatibility from client timestamps.
- Confirm health, authorization, reference/version preservation and historical
  immutability; compare version-specific counts and invalid-reference/conflict
  rates against the recorded staging baseline before expanding scope.
- Record frontend/backend deployed SHAs and enabled scope. Historical repair
  remains disabled unless separately authorized after a reviewed dry-run.

## Rollback and repair

- Disable new-version starts first; retain additive schema and readable saved
  evidence. Serve already-started new-version work through an implementation
  capable of its frozen policy until it can finish or reach normal expiry.
- A code rollback cannot silently downgrade or strand active new-version work.
  Validate this compatibility before initial enablement; retain classification
  labels for persisted versions even when new starts are disabled.
- Never delete attempts, restore scores from current edited content, or regrade
  history as a deploy/migration side effect. If an explicitly authorized repair
  is needed, enforce approved IDs/version/source hashes, idempotent receipts,
  concurrency guards and preserved originals; prove restore in staging first.

## Observability

- Product/release owner records the enabled scope and acts on failed gates.
- Track grading version, safe correlation/attempt identifiers, invalid reference
  count, unsupported-version requests, grade/complete conflicts and trend
  classification reconciliation. Do not log private reference/user text.
- Stop expansion for any gold/control deviation, historical mutation,
  lost lexical error or stranded active attempt. Other operational thresholds
  are reviewed against the staged baseline before production enablement.
- Evidence in verification.md records deployed SHAs, bounded scope, observation
  window, counters and rollback result; no release result is claimed yet.
