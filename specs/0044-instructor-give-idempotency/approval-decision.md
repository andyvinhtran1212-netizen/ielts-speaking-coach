# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
INSTRUCTORGIVE-0044 on 2026-10-31 (UTC+7), in his chat with Claude. Claude
proposed the options and their risks; the decision is the owner's.

What he decided:

1. INSTRUCTORGIVE-0044 is approved with decisions D1–D6 as recommended in
   `spec.md` § Decisions for Vinh, and spec number 0044 is confirmed.
2. D7, option (a): the idempotent-retry commitment covers a retry in the same
   /instructor tab. A retry from another tab is a new intent and creates a
   visible, removable duplicate with `duplicates_warning`. Option (b),
   persisting the pending `request_id` in `localStorage`, was rejected.
3. This spec-only PR merges before the implementation PR #2116, so the spec is
   approved in the base revision the implementation is checked against.

Scope: migration 360 goes to staging first, then production under the advisory
lock before dependent code is promoted. Promotion to production needs the
owner's explicit authorization at the `staging` → `main` promotion.
