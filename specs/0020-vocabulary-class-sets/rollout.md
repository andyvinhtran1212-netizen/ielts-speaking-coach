# Rollout and rollback

## Preconditions

Approved spec on staging before implementation; additive migration registered
with the locked forward runner; generated API types and local contract tests.
Preserve existing Vocabulary tables, route ownership and all historical evidence.

## Staging

Apply and verify only the feature's additive migration through the standard
runner before dependent deployment. Verify the exact merged staging SHA and
admin publication -> eligible learner study -> canonical result/reload journey.
Use synthetic staging accounts/content; coordinate shared staging mutations.

## Production

Prepare the complete verified change and concrete release scope first.
Production database changes and staging-to-main promotion require explicit
authorization. After authorization, use the locked migration runner and exact-SHA
promotion gate, then verify the affected production journeys.

## Rollback and repair

Rollback application entry points if necessary; leave additive tables and
accepted learner evidence intact. Do not reset personal reviews, historical
quiz/D1 attempts or content to silence a failure. Repair only a proven defect
with bounded source identities and recheck canonical persistence.

## Observability

Record set/session/mutation identifiers with errors, never tokens or answer
payloads. Track failed scope checks, conflicting replay and storage failures
using existing logs. Admin results distinguish no work from failed lookup.
