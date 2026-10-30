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

## Amendment 1 — APPROVED 14:44 29/10

**State: APPROVED by the human owner.** On 2026-10-29 14:44 (UTC+7) Vinh
answered the Feature Developer's five questions (H-1029-FD3,
`handoff/leader/20261029-1442-fd-questions-vinh.md`), verbatim:

> "Duyệt cả 5 theo đề xuất"

The Leader verified the answer directly in the Leader chat. Item (a), "Q5 –
duyệt lại step-up (Gap B, AAL2)", approves Amendment 1 as drafted in
`/workspace/specs-drafts/0032-amendment-q5-step-up.md` (H-1029-FD4, source
finding SEC-20261028-03 F-03 Gap B):

1. **Q5 revised to "step-up 15 minutes".** FR-012 is amended (AAL2 counts for
   admin rights only while the `amr` TOTP timestamp is at most
   `ADMIN_AAL2_MAX_AGE_HOURS`, default 12, old) and FR-020 is new
   (`require_recent_mfa()`, `ADMIN_STEP_UP_MINUTES`, default 15), with
   acceptance AC11 and AC12 (AC10 and AC11 in the draft; renumbered because
   AC10 is FR-019's).
2. **`ADMIN_STEP_UP_ENFORCE` default `false`**, confirmed by the Leader on
   2026-10-29 14:53 (UTC+7). This is the "report-only first" Vinh approved.
3. **Residual risk accepted by the Leader on 2026-10-29 14:53 (UTC+7):**
   factor deletion goes from the browser straight to Supabase Auth, so the
   server cannot apply step-up to it. It is controlled by the fresh verify in
   the `/admin/mfa` UI, the T007 factor-deleted owner alert (≤ 5 minutes) and
   the 12-hour expiry. See `spec.md` → "Rủi ro còn lại".

This approves the intent only. No migration is involved. It does not authorize
enabling `ADMIN_STEP_UP_ENFORCE` anywhere: on staging that is the Leader's call
in lot 11 or later, and production needs Vinh's separate approval at a
promotion he authorises, as for T013.
