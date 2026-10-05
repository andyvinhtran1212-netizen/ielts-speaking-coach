# Rollout and rollback

## Preconditions

The owner reviews the concrete [approval decision](approval-decision.md); the
approved spec-only change must be present on staging before implementation.
Confirm final source/migration contracts, full endpoint/writer inventory, typed
marking gold cohort and immutable attempt context/flag compatibility. Use isolated
synthetic users/rooms, coordinate shared staging with other active chats and keep
`aver-ux-*`/Grammar backup work outside this scope.

Read-only production inventory already locates all 80 paper IDs and backend main
SHA. Expand scoped dependency/revision/policy reads only as required; exclude
unrelated learner data/secrets. A pre-change backup and trusted original snapshot
are necessary for any production policy restoration, and missing historical
values must remain unknown. No environment migration/backfill can rewrite old
grades or mark unverified content revised.

## Staging

1. Apply additive migration(s) via the repository advisory-locked runner before
   deploying dependent backend. Verify RPC privileges, default legacy markers,
   backward compatibility and full snapshots without making current data public.
2. Deploy the consolidated implementation SHA; test old/new clients and already
   active legacy work. Verify the complete role/lifecycle/purpose and actual
   PostgreSQL race/rollback matrix plus native flag/review/error journeys.
3. Stage only source/editorially approved paper revisions under existing
   import/version contracts as unpublished first. Validate hashes, counts,
   option/control/group relationships, typed alternatives and snapshot behavior.
   Audio/transcript/timing certification requires direct listening evidence.
4. Obtain independent requirement and per-finding acceptance, run integrated
   exact-SHA/live staging gates, and confirm staging head has not moved before
   promotion. Publish no unreviewed revision or incomplete approval claim.

## Production

Production migrations, content/policy changes and promotion follow retained user
and repository authorization; explicit production DB authorization is required
where the workflow requires it. Apply only approved additive schema through the
locked runner, then promote staging→main using the exact-SHA gate. Verify both
frontend/backend runtime SHAs and affected safe journeys.

Content revisions release only after their reviewed source/rights/editorial/audio
and staging gates. C17R3 or other policy restoration must identify exact targets,
trusted complete before-state, expected current revision, backup/dry-run and actor
approval; never infer `exam_only` or release metadata from hidden UI state. Public
overlap grants are explicit scoped operational decisions, not migration defaults.
No historical regrade belongs to this release.

## Rollback and repair

Keep additive fields/events/snapshots and valid work readable. Stop new revised
starts or revert the reviewed content release binding when required without
rewriting/deleting attempts or grading. Keep safe server authorization in place;
do not redeploy a leaking backend as a compatibility shortcut. Current clients
must handle withheld/missing support and pending flags safely.

Policy restore is a new audited transaction with expected current revision and
fresh dependencies. Existing partial events cannot serve as complete baselines.
Ambiguous orphans remain recoverable for scoped investigation; no guessed relink,
room archive, timing shift, assignment removal or grade overwrite is a repair.
Record any true historical repair as a separate bounded approved operation with
original evidence, idempotency, concurrency and rollback proof.

## Observability

Record operation/request correlation, purpose decision, paper/version, safe
blocker code, policy revision and retry/concurrency outcome without answer keys,
transcripts, credentials or unrelated learner content in public logs. Count denied
purpose bypasses, dependency verification failures, orphan ambiguity, stale
restores, flag conflicts and snapshot/fallback coverage. New unauthorized content
or answer exposure is a release-stopping defect; existing unknown evidence stays
explicit in the ledger. The coordinator owns release/repair decisions; the
independent acceptance agent owns final confirmation and originating-chat report.
