# Rollout and rollback

## Preconditions

- Obtain product approval for this draft before implementation and review the separate migration 510 draft in [#2717](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2717).
- Obtain current authorization for the target environment before applying migration 510. Verify its nullable columns before deploying readers with explicit column selects. A null marker preserves each sitting's original requirements.

## Staging

- On the deployed implementation SHA, run the automated contract checks in [verification](verification.md) and verify the schema in staging.
- Run the admin roster and learner result journeys on the Mac mini in Browser 1 with synthetic sittings. Include retry, explicit release and an unmarked sibling.

## Production

- Production migration, hotfix promotion and marking the affected sitting each require their respective authorization. Andy performs the manual release.
- Verify the schema before deploying dependent readers. After promotion, check the marked sitting's review, sibling sitting requirements and the learner results at the authorized release step.

## Rollback and repair

- Withdraw the action and revert dependent readers before considering schema reversal. Preserve existing decisions, reason, actor, timestamp and released results.
- If any sitting has been marked, agree on a data-preserving recovery after reviewing affected records and before removing columns or restoring Writing requirements. An interrupted reconciliation can be retried using the preserved mark.

## Observability

- Correlate marking and reconciliation failures with the sitting and administrator IDs. Exclude names, scores and reason text from logs.
- During rollout, investigate any confirmed mark that still lacks its review after retry, or a duplicate review or release.
