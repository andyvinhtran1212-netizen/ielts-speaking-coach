# Verification

## Requirement coverage

| Requirement | Evidence required | Result |
| --- | --- | --- |
| FR-001 | exact6 allowlist/strict request/parser/mastery/link/source-hash tests; independent academic labels | PENDING |
| FR-002 | old bank/question UUID and raw prompt/key/review hash preservation; deterministic current mapping; uniqueness/invalid duplicate states | PENDING |
| FR-003 | OpenAPI models/generated types, auth/error shape tests; bounded preview/footprint and canonical readback | PENDING |
| FR-004 | actual PG concurrent start/progress/reset/finalize/cutover/generic import/child insert-delete-update; serialized order/CAS/audit rollback | PENDING |
| FR-005 | open zero-attempt, paused, completed-with-carryover, true mastered/stale empty open, reset-versus-review unknown blocks before writes; missing/orphan/malformed/capped evidence; N-1 proven reload; first-progress completion watermark despite lost endACK; parallel attempt history retained without mastery regression; row/byte bounds, owned proof/retention and no public IDs | PENDING |
| FR-006 | compatible new start frozen revision, old/default client continuation, unsupported/stale starts rejected before insert; unmanaged controls | PENDING |
| FR-007 | lostACK/retry scoped action+actor+code+UUID tuple, changed same-tuple payload409, other actor/code auth/CAS independently; bounded lookup/nonJSON unrelated logs; duplicate/corrupt/missing proof failclosed; no TTL/purge while any legacy dependency exists inclrollback | PENDING |
| FR-008 | actual write-boundary mutation/delete/import refusal for managed current/legacy; unchanged unmanaged imports | PENDING |
| FR-009 | browser full states, history old rawsource/key/result, keyboard/focus/themes/motion/width matrix | PENDING |
| FR-010 | staging-first additive migration/N-1 compatibility, exact deploy SHAs, explicit six-operation logs/backups/new-start-disable rollback | PENDING |

Academic gold covers contextual love/want correctness and preserved genuine
know/is-want errors. Baseline source evidence: grammar-linked-bank-audit.json,
production-grammar-bank-footprint.json and grammar-linked-bank-remediation.md.
These read-only/offline artifacts are not feature or canonical-cutover proof.

Actual-PG erasure acceptance for FR004/005/007 additionally proves the existing
auth.users cascade, absence-only FK deletion/link-clearing exception, rejection
of live-owner child deletion or link clearing, unchanged other owners/content/
private receipt and serialized erasure/cutover. A retained pseudonymous receipt
does not restore an erased owner or deleted history. These are pending gates.

Before/after DB verification reconciles old bank/question IDs/source hashes,
historical session/attempt references and stored scores. Ordinary concurrent
learner progress may change legitimately; verify that the cutover itself writes
none of those rows. New synthetic work has separate corrected-bank identity.

Actual PostgreSQL tests are mandatory; mocked RPC/source assertions do not prove
locks, FK phantom protection, rollback, receipt uniqueness or N-1 insert guards.
Missing credentials/skips remain an open gate. No real learner regrade or paid
provider calls. Record final PR/staging/main/backend/frontend SHAs separately.

The actual unchanged engine was exercised offline in eight mastery/state cases
plus an ambiguity control, with 14 assertions passing. Independent admin probe
also passed eight assertions for completed-with-carryover and status-label
counterexamples. This supports the classification semantics only, not DB cohort
classification, session provenance, cutover locks or deployment acceptance.
The unchanged existing-column counts SQL proposal was independently executed
against canonical synthetic PostgreSQL shapes: 23/23 classifications passed.
Persisted PG readback matched the unchanged engine in 22/22 cases; one malformed
shape was gated before the engine. External admin-grammar-cutover-review.md
records scripts/results and scope. This is classifier feasibility evidence,
not actual feature transaction/lock/provenance/retention or live cohort proof.
Authoritative live counts and every feature/release gate above remain pending.

Status: approved contract; no feature tests or deployed acceptance yet.
