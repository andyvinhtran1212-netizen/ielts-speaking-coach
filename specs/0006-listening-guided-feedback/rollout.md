# Rollout

## Preconditions

- Product owner has resolved assisted-completion policy; approved spec is on base.
- Separate player UI rollout is reviewed and reconciled without duplicate state.
- Migration and code pass local affected suites and protected-field review.

## Staging

1. Apply backward-compatible migration through the staging runner.
2. Deploy backend; exercise owner/non-owner, save/reveal/revise/reload, mixed
   forms, and replay-policy cases on the exact staging SHA.
3. Enable player affordance only after endpoint health and OpenAPI checks.
4. Run integrated CI and live Staging E2E on that SHA, including both themes.

## Production

Use only the `staging` → `main` promotion PR after the exact-SHA promotion gate.
Apply production migration with the advisory-locked runner before dependent
code. Verify a real published General and IELTS form, key boundary, assisted
history, and null score/band claims.

## Rollback and repair

Disable the reveal UI if backend or content checks fail. Backend rollback leaves
the additive ledger intact so historical assisted attempts stay truthful.
Reconcile ledger rows against attempt ownership, status, and saved answers;
repair only through an audited operator procedure, never by clearing assistance
to make an attempt appear independent.

## Observability

Track reveal success, denied/ineligible requests, duplicate retries, save/reveal
race failures, protected-content sentinel failures, and assisted completion by
programme. Alert on any unrevealed-key leak or status mismatch; do not log raw
answers or protected reference content.
