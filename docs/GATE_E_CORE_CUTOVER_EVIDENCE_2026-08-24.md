# Core-player early cutover record — 2026-08-24

**Decision:** operator-authorized early admission cutover for Speaking, Reading,
Listening test and Listening dictation on staging and production.

**Gate status:** Gate E is **not** declared PASS. The frozen v13 qualifying
streak remains **0/20** in `GATE_E_PREFLIGHT_2026-08-09.md`. This record is an
explicit release exception, not a replacement for the missing streak and not a
retroactive waiver for any other migration gate.

## Scope and boundary

- Remediation floor: `30742799f13badddf180e3e9f308984b185019da`.
- Cutover head: recorded by PR #1305; it must be a descendant of the floor.
- Only the four `admit_new` values change from `legacy` to `next`.
- Writing remains on its existing Next admission policy.
- Legacy implementation URLs stay deployable for renderer-affinity resume and
  immediate forward rollback.
- Existing attempts do not switch renderer: the canonical persisted affinity
  remains authoritative on reopen, reload and copied URLs.

The repository verifier must compare the exact floor and cutover SHAs and reject
any non-admission runtime change outside its narrow allowlist.

## Evidence available before the exception

- Speaking, Reading, Listening test and Listening dictation each completed the
  live floor → cutover → forward-rollback coexistence drill with matching
  staging frontend/backend provenance.
- Safari desktop and iOS Safari real-device rows are complete and pair-verified.
- Synthetic failure matrices cover reload/resume, partial persistence,
  ambiguous commit and Legacy/Next affinity handoff.
- The cutover branch passes the full frontend contract suite, strict TypeScript,
  the production Next build and the exact cutover-diff verifier.

These reduce release risk but do **not** satisfy the missing 20-run criterion.

## Residual risk and rollback

The accepted residual risk is that a low-frequency production interaction or
deployment-specific regression may exist despite the three-phase, device and
failure-matrix evidence. After staging deployment, run one live staging canary
against the exact deployed SHA before production promotion. If persistence,
resume, audio, timer, submit, grading or reconciliation fails, restore all four
fresh admissions to `legacy`; do not rewrite the persisted renderer affinity of
attempts already claimed by either implementation.

Gate F Legacy retirement remains separate and must not remove rollback targets
until its own redirect, active-session and verification contracts pass.
