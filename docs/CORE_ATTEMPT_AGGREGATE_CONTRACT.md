# Core attempt aggregate contract

Version: `core-attempt-observations-v1` — local diagnostic component, not an
approved alternative Gate F evidence policy. No rollout or deletion authority.

## Full closure requirement remains unchanged

The master plan §16 requires the frozen all-eligible-attempt denominator,
success/fail/abandon accounting, no Sev1/2 regression, verified fallback coverage
and a reviewed deletion checklist. ADR-013 A1/A2 supersede blind route waiting
and deterministic sample counts; they do not turn receipt volume into learner
volume or authorize deletion. This contract adds no floor, waiting window or
waiver. The outcome/eligibility aggregate is incomplete until the independent
admission, traffic, release and coverage sources below are implemented/verified.

| Surface / unit | Existing canonical identity | Admission/outcome constraints |
| --- | --- | --- |
| Speaking session | `speaking/speaking_session/sessions.id` | Successful authorized creation; grade calls/retries are not new attempts |
| Speaking full test | `speaking/speaking_full_test/full_test_attempt_id` | One group, not three parts; require owned canonical group/result checks |
| Reading | `reading_exam/default/reading_test_attempts.id` | Authenticated/share creation; anonymous classification stays separate from proof of organic use |
| Listening test | `listening_test/default/listening_test_attempts.id` | New attempt, not each answer/check/reveal; practice/full/mini type is source metadata, not inferred from a button |
| Dictation | `listening_dictation/default/dictation_attempts.id` | Section parent creation, not resume or each sentence; replacement is a different parent |
| Writing assignment | `writing_assignment/default/writing_assignments.id` | Explicit learner start, not unopened assignment creation or lease renewal; native mock essays are a different namespace |

Pre-creation admitted failures without a canonical ID must remain visible. A
server observation UUID identifies an operation, not a proven logical attempt
across retries. Without durable admission identity/coverage, combining those
failures with canonical rows into a single exact denominator is unsupported.
Success means valid persisted grading/result, not an IELTS pass score. A failed
operation can recover; later repair can supersede a failed outcome. Expired
leases, unresumable rows, explicit abandonment and failed grading are distinct.

## Implemented report scope

The RPC reads the append-only evidence tables in one SQL statement snapshot.
The interval is `[window_start, window_end)` by **receipt ingestion timestamp**,
not attempt start, renderer exposure, business commit time or a durable export
watermark. A transaction can commit later with a timestamp inside a previously
read interval. Repeated reads may therefore gain receipts. Restrict each query
to at most 31 days and 100,000 receipts. Oversized selections are rejected, not
truncated; these are query limits, not soak rules. The RPC checks the row ceiling
and aggregates against the same STABLE snapshot. This limits aggregation volume,
not elapsed server execution time; deployed timeout/index/load verification
remains required. No global database role settings are changed.

An omitted `window_end` is sent as NULL and resolved once by PostgreSQL's
statement clock. Future-window rejection uses that same clock; the app validates
timezone, representability and explicit duration but never compares DB time with
its own clock. The response echoes the requested window (including an omitted
cutoff) separately from the resolved snapshot window.

Return exactly six surface/kind rows, including empty rows, without UUIDs,
learner identifiers, content, scores, tokens or individual release tags:

- `canonical_attempts`: distinct bound registry identities with receipts in the
  interval. Replays/retries/admin repair do not create extra canonical attempts.
- `start_known_at_registration` / `start_unknown_at_registration`: the original
  registry flag, not proof that a start occurred in this interval.
- `receipts`: distinct persisted events (event UUID is the storage key).
- `bound_attempt_operations`: distinct `(attempt, server operation, operation
  type)` within this surface/kind. A start-over can affect old and new attempts.
- `unbound_start_failure_operations`: distinct server operations with no
  canonical ID; never silently added to the canonical attempt count.
- `server_observation_operations`: distinct `(server operation, operation type)`
  for this surface/kind. These may include background observations, not just HTTP.
- `attempts_with_{pending,success,failed,abandoned,unknown}`: counts of distinct
  canonical attempts with each historical outcome observed in the interval.
  **These overlap** when an attempt changed state; do not sum into a denominator
  or choose the latest receipt as current truth. `mixed_outcome_attempts` and
  `without_outcome_attempts` expose that ambiguity explicitly.
- Renderer/traffic/release counts are **receipt attributes**, not immutable
  first-exposure attribution for a learner cohort. Unknown stays unknown.

The report always retains `eligible_attempt_denominator=null`,
`coverage=unknown`, `eligibility=not_assessed`, `gate_f=not_assessed` and explicit
computed, non-overridable missing-evidence reasons, including the lack of a commit
watermark and capture OFF on the serving instance. It supplies no pass percentage or current-outcome
partition. Per-attempt canonical inspection remains a separate diagnostic,
not a transactionally synchronized current-state aggregate.

Unavailable/malformed RPC responses return a visible unavailable report with
no summary, never a zero-filled success. A fixed allowlist distinguishes timeout,
transport, permission, missing schema, contract mismatch, cancelled query and
rejected/oversized window from an unclassified failure. Exception messages,
hints, unknown database codes and auth details are never forwarded. Rejected or
oversized windows return 422; other unavailable reads return 503.
Dedicated SQLSTATEs identify application window/stream failures; generic database
limit/data errors are not mislabeled as an invalid user window. OpenAPI describes
both the structured report and fixed-detail HTTP errors for non-200 responses.
Authenticated admin role is checked
before the RPC; browser DB roles have no RPC permission. Reads are `no-store`.
Framework validation errors on the private diagnostic router are also sanitized
and `no-store`, without echoing the supplied parameter values before auth.
Capture being off does not forbid reading previously collected history. The
reported flag applies only to the serving instance, not all deployed instances.
Migration 256 (formerly the uncommitted 245 draft) validates its table/column read dependencies at application time;
unexpected receipt namespaces fail the read instead of disappearing from the
six-stream result. Installed PostgREST client tests use mock HTTP transport to
verify scalar JSON and error parsing; they are not live server integration proof.

## Required next sources and verification

Before any eligibility certificate, reconcile source admissions against receipts
(including crashes/disabled instances/outages), establish trusted organic/test
classification and immutable frontend-release attribution, and read coherent
canonical outcomes for the same eligible cohort. Preserve unknown, active,
unresumable and mixed/superseded partitions. Never backfill missing historical
events from current state or infer organic use from absence of a test label.

Verify receipt replay, failed-submit-then-success, old/new multi-attempt
operations, Speaking namespace collisions, unbound failures, mixed outcomes,
unknown tags, empty versus unavailable, half-open window bounds, >1,000 events,
private permissions and no learner writes. Live schema/role/latency/coverage
verification requires separate rollout authority. Green local tests prove only
the defined diagnostic component, not the remaining Gate F requirements.
