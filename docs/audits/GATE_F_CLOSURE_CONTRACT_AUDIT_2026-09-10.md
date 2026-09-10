# Gate F closure contract audit — 2026-09-10

Source: `91f3b2c997542c3107d5ee29b436be1a89fc72f1` (main after PR #1359).
Decision: elimination is still unproven. This audit defines remaining work;
it changes no eligibility definition, threshold, production data or permission.

## 1. Outcome evidence is not an eligible-attempt denominator

**Severity: Medium — false completion/operational reporting risk, not evidence
of a current player outage.**

Root cause: the master plan §12.3/§16 Gate F requires eligible attempts split
into success/fail/abandon and attributed by implementation/release. The existing
`backend/routers/error_logs.py:error_log_rollback_metrics` counts page-view exposure and
error logs. These units cannot be substituted for unique attempts. Separate
canonical database rows are useful but also do not by themselves implement the
required contract:

| Source and function/schema | What it proves | What it does not prove |
| --- | --- | --- |
| `backend/routers/sessions.py:create_session`, capped creation RPC call | Successfully persisted Speaking sessions; full tests have session parts linked by a full-test attempt identity | Creation failures before the insert; one row equals one full-test attempt; release attribution |
| Migrations `068_listening_test_attempts.sql`, `087_reading_test_attempts.sql` | Current state is in-progress, submitted or abandoned; persisted score/time can be checked | A distinct failed-attempt outcome, failed submit followed by successful retry, or the reason for abandonment |
| Migration `220_dictation_attempt_affinity.sql` | Durable section attempt and answer state; current completed/abandoned status | Pre-insert failure or an immutable history of every failed operation |
| `backend/routers/writing_student.py:start_assignment`, migration `036_writing_assignments.sql` | Assignment creation is administrative; learner start and final essay handoff are different lifecycle events | An assigned-but-unopened row is an eligible learner attempt; an assignment row is a full outcome history |
| Migration `224_active_player_resume_ttl.sql:fn_claim_writing_assignment_renderer_affinity` | Current renderer lease/claim protects resume ownership | Immutable first exposure: a repeat claim by the same renderer refreshes claim time and expiry |
| `backend/routers/analytics.py:record_event` | Best-effort client event ingestion, with optional user attribution | Reliable/deduplicated all-attempt ledger: ingestion catches insert failures and still returns `{ok: true}` |

Minimal next step is **contract reconciliation before a new metric**. Freeze a
versioned definition for each of the five core surfaces: eligibility boundary,
attempt identity/deduplication (including full-test parts and retries), organic
versus synthetic exclusions, attribution, observation window, terminal versus
recoverable failure, abandon/expiry, and unknown/incomplete states. Identify the
existing source for each field; explicitly retain missing fields as unknown.
Do not relabel these diagnostic row counts as a passing sample floor.

The master-plan floor and July traffic calibration are not a newly verified
post-flip report. ADR-013 A1/A2 later changed route rollout requirements; the
hard-flip decision also waived a release hold, not every global elimination
requirement. This audit does not invent a new 30-attempt target or reimpose a
blind per-route waiting window. If the owner accepts a different Gate F evidence
profile, record the exact superseded requirement and accepted residual risk;
do not backfill missing historical events or label a waiver as PASS.

Verification for a future implementation: fail-before-create, duplicate retry,
failed-submit-then-success, open/expired, explicit abandon, unknown renderer,
Writing lease reclaim, and multi-part Speaking must produce the defined
denominator/outcome partitions. Compare canonical readback to the report. A
missing source or failed count must be unknown/error, not zero. Neither a
successful HTTP response nor a passing synthetic suite proves organic volume.

## 2. CSS build artifacts are not deletion candidates just because Next never loads them

**Severity: Medium — build regression risk, not an existing build failure.**

`frontend/package.json:scripts.build:css:plusjakarta` and `build:css:inter`
both use `./css/tailwind.src.css` as input; the Inter command writes
`./css/tailwind.inter.css`. The verified `frontend/css` alias resolves to
`public/css`. These two files appear in the wave-3 hold inventory, not the
Next browser dependency closure. Source tracing resolves their build role;
it does not authorize deleting or relocating either file.

Minimal disposition: **retain as build input/output until a separate build
change removes or relocates the dependency**. The dated wave-3 JSON is not
rewritten as though the source audit had just run. The other held files still
need per-consumer review; not all hold entries are disposable legacy runtime.
Verification before a later relocation: both CSS build commands, their actual
output consumers, generated-output checks and production build must pass from
a clean checkout without relying on the former public paths.

## 3. Completion sequence and authority boundaries

| Workstream | Required next action / evidence | Closure authority |
| --- | --- | --- |
| Historical Gate E | Preserve v20 20/20 provenance; keep v21 fixture-preflight distinct | Existing evidence, not another unsolicited streak |
| Gate F outcomes | Reconcile the contract above, then implement/verify only the missing sources, or record an explicit accepted alternative | Engineering proposes; owner approves material evidence-policy changes |
| Data health | Validate lifecycle/aggregate anomalies and historical errors individually; distinguish predating records from demonstrated migration regressions | Read-only audit now; exact production repair scope requires approval |
| Artifact retirement | Resolve per-file consumers and test obligations, preserve fixture/build capability, prepare bounded removal diff | Separate reviewed deletion scope; none granted here |
| Fallback observation | Verify continuity, full revisit cycle and TTL, or document an explicit elimination exception | Earliest 14-day boundary alone is not approval; existing hard flip only waived a release hold |
| Final deployment | Exact authorized deletion diff, CI, redirect/owner probes before and after, fresh health and rollback/restore capability | Verify the deployed release, not only a local manifest |

The Pricing rehearsal in PR #1359 confirms that its physical freeze and stale
CSS budget still block removal. Six generated historical UI cases require an
explicit disposition; their omission is not proof of replacement. Permanent
compatibility URLs must survive any eventual file removal.

Normal Next development remains open. No schedule is created, no Gate E clock
is reset, no production grade is reconstructed, and no legacy asset is deleted
by this audit. Closing documentation/test coupling is progress toward Gate F,
not a substitute for the remaining contract, health and retirement decisions.

## Verification and review boundary

Named source functions, schema definitions, CSS commands and alias evidence
were locally inspected. Full frontend contract regression passed 9,090/9,090
with zero fail/cancel/skip/TODO; frozen Gate E v21 preflight and static cutover
checks passed unchanged. These checks do not prove the missing outcome ledger.

Independent Claude document review has not run. The attempted diff-only
document review was rejected before invocation because the prior egress
authorization covered code diffs, not internal operational documents. No
workaround or expanded source payload was sent. Additional owner permission is
needed for that separate review; local source validation is not a Claude verdict.
