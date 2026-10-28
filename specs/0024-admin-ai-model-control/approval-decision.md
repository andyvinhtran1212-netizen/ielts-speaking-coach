# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
AIOPS-0024 together with its implementation PR (#1716 spec, #1720
implementation, migration 322) on 2026-10-27 at 07:14, for merge into
`staging` after CI and review.

The approval covers the requirements in `spec.md` as written, including the
owner decisions listed under §Open questions:

1. The Claude-model allowlist is `claude-sonnet-5-5` and `claude-haiku-5-5`;
   adding a model is a code change.
2. `speaking_grading` is controllable like the other features. Selecting Claude
   for Speaking in production overrides the
   `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` pin and remains an owner decision
   bound by the AI-0004 constitution §6 gold-set gate; this spec only provides
   the switch.

Migration number **322** is locked to this work in
`backend/migrations/README.md`.

This approves the intent in `spec.md` and the rollout in `rollout.md`. It does
not authorize applying 322 to any database: staging apply follows the
staging-first runbook, and production apply needs the owner's explicit
authorization at the `staging` → `main` promotion.
