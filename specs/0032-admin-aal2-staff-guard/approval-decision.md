# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
ADMINAAL2-0032 on 2026-10-28 09:11 (UTC+7), relayed by the Leader, against the
draft merged to `staging` in PR #1772:

1. **Q1–Q10: every default answer is accepted** as written in
   [`spec.md` → Owner decisions](spec.md#owner-decisions). The defaults'
   wording is kept unchanged.
2. **Q2 address:** `andyvinhtran1212@gmail.com` is the alert recipient. It
   is the single value of `OWNER_ALERT_EMAILS`, which AI-BUDGET
   (AIBUDGET-0033) reuses. The sender is set by Vinh's decision (a) of
   2026-10-28 09:35 (UTC+7), recorded in AIBUDGET-0033 (#1773): alerts are
   sent FROM `alerts@averlearning.com` through Resend, once the
   `averlearning.com` domain's DNS is verified. Gmail SMTP is not used, and
   the implementer does not choose another sender.
3. **Q8:** migration number 332 is the accepted default. The Leader still
   confirms the reservation before T001.

This approves the intent in `spec.md` (FR-001…FR-018) and the rollout in
`rollout.md`. It does not authorize applying 332 to any database, setting any
Railway secret, or enabling `ADMIN_AAL2_ENFORCE` anywhere: staging follows the
staging-first runbook, and production enforcement needs Vinh's explicit go
(Q6) at the `staging` → `main` promotion.

## Amendment: FR-019, role frozen while suspended

**State: APPROVED by the human owner.** On 2026-10-28 17:53 (UTC+7) Vinh chose
option 1A (relayed by the Leader, t246u), after #1806 reached `staging`:
`fn_set_staff_privilege` must refuse any role change on an account that is
currently suspended, and an admin must reactivate the account first. This
prevents a suspended instructor from being demoted to student and then being
impossible to restore in the app. Recorded as FR-019, AC10, Q11 and T015, and
enforced by migration 336, which the Leader assigned from the 333–337 range.

This approves the intent only. It does not authorize applying 336 to any
database. 336 follows 332 through the staging-first runbook (`rollout.md` S1b).
