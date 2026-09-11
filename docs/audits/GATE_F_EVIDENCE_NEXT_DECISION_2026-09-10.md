# Gate F evidence — next decision, not another passing metric

Status: **owner authorized durable admission/reconciliation design; no Gate F waiver or activation**.

Inspected on 2026-09-10 in `codex/core-attempt-outcome-evidence`, base HEAD
`5c548eeda79b1b5444cdeb7215fac8405200755b`, including the uncommitted evidence
implementation. This is a local source audit, not a fresh deployment/database
inspection. The preceding Listening retry batch is locally verified. The owner
subsequently requested self-review in this session instead of waiting for an
external reviewer. Historical incomplete review attempts are not approvals.
No new runtime code is added by this audit.

## Root cause and severity

**Medium — acceptance-contract/measurement gap, not proof of a learner outage.**
Master-plan §16 still requires an all-eligible-attempt denominator and current
success/fail/abandon accounting. The implemented recorder deliberately runs
after learner writes, in an independent bounded transaction, and fails open.
It can therefore miss a committed attempt when the process exits or observation
storage is unavailable. Adding more route decorators cannot by itself repair
that completeness gap. Making those receipts mandatory inside learner writes
would change the current failure-isolation contract and needs a separate design
decision; it is not a harmless extension of the observer.

## Source-validated gaps and minimal next work

| Requirement | Current authoritative source | Remaining work / verification |
| --- | --- | --- |
| All eligible starts, including failures before canonical creation | `backend/services/core_attempt_observation.py:admit_start` is request-local; `_emit` persists optional observations afterward. Migration 240 is explicitly standalone and creates no admission outbox/trigger. | Freeze admission identity, eligibility/retry boundaries and failure semantics; design durable admission plus independent reconciliation. Test crash before/after business commit and disabled/unavailable recorder, not only successful receipt calls. |
| One attempt, not each request/part/regrade | Migration 240 canonical composite key; migration 244 server-operation correlations; optional browser IDs | Preserve canonical six-namespace identity. An unbound failed operation is not an exact learner-attempt count; reused/copied browser hints do not supply a durable admission certificate. Verify deliberate restart versus retry and multi-part Speaking. |
| Current outcomes of the same eligible cohort | `backend/services/core_attempt_aggregate.py:ObservationReport` sets `eligible_attempt_denominator=None`, `coverage=unknown`, `gate_f=not_assessed`; migration 256 (formerly local draft 245) counts historical receipt outcomes | Writing's separate local 254/255 cohort/report implementation now reads canonical outcomes; complete the remaining domains and rollout validation. Keep active/unknown/unresumable and superseded results explicit; do not sum overlapping historical outcomes or infer abandonment from elapsed time alone. |
| Implementation/release and traffic attribution | `_emit` uses current bound renderer but no trusted traffic/release source; event defaults are unknown/NULL | Define which server-owned deployment/traffic facts are admissible. Do not treat backend SHA as frontend SHA, a client header as proof of exposure, or absence of a test label as organic use. Verify unknown and mixed-release cases. |
| Coverage and observation interval | Migration 256 uses receipt-ingestion timestamps, not a commit watermark; recorder flag is per instance | Reconcile independently against source admissions and instance/release coverage. Late commits, process loss, disabled workers and failed reads must not yield a clean interval. A sequence or timestamp alone is insufficient. |
| Capture privacy and rollout | Migration 240 and `core_attempt_evidence.py` explicitly require retention/erasure approval; config and browser flags remain OFF | Approve a retention/erasure design and exact staged rollout before activation. No duration, purge job or remote application is inferred here. Verify private roles, load, timeouts and failure isolation on staging. |
| Gate F deletion | Master-plan §16; closure audit; held asset inventory | Existing hard flip waived the release hold, not all physical-retirement requirements. Preserve fallback/TTL/revisit evidence or obtain an explicit elimination exception; retain per-file owners and test/build capabilities. |

The old per-route timing/sample rules and ADR-013 A1/A2 must not be collapsed
into a newly invented floor. In particular, neither the local browser fixture's
20 assertions nor historical Gate E's 20 runs establishes organic learner volume.

## Decision boundary

Two paths are materially different and must not be selected implicitly:

1. **Retain the full Gate F evidence requirement.** Freeze the admission/outcome
   profile and privacy design, then implement the missing durable sources and
   reconciliation. The current observer remains a diagnostic component; it is
   not promoted into a certificate. Review and staged rollout are still needed.
2. **Explicitly accept an alternative elimination profile.** The owner must name
   the superseded requirement, accepted loss of assurance, compensating evidence,
   review/rollback owner and validity/expiry. The decision is recorded as an
   exception, not PASS of the original requirement. This does not itself grant
   physical deletion or deployment permission.

Engineering recommendation: retain path 1 unless the owner explicitly chooses
an exception. Before adding a new admission write path, agree its failure policy
and exact eligibility boundary; do not keep expanding best-effort hooks and
describe that as closing the denominator requirement.

## Verification status and next action

The source functions, SQL contract, report fields and gate/ADR provisions above
were inspected directly. No tests were rerun for this documentation-only audit.
The previous checkpoint remains 9,175 frontend tests + TypeScript, fixture
browser checks 15/15 OFF and 20/20 ON, and the earlier 1,469 backend-test run.
Those results do not certify this unimplemented admission design.

The owner authorized the durable admission/reconciliation design and subsequently
approved local implementation/testing with default OFF;
the [design v1](../CORE_ADMISSION_LEDGER_DESIGN.md) retains the full evidence
requirement and records its own self-review. No external reviewer is awaited
in this session. Local implementation authorization is not approval to activate strict starts,
change retention policy, deploy, or waive elimination requirements. This
document has not been sent to Claude.
No new migration, capture flag, commit/push/PR, remote deployment, data repair,
automation or artifact deletion was performed.
