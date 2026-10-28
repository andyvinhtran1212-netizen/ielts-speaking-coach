# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
AIBUDGET-0033 on 2026-10-28 at 09:11, with decisions updated at 09:13
(UTC+7), relayed by the Leader, against draft PR #1773:

1. **Q1, Anthropic (Claude): $100 a month as a soft limit.** It alerts only.
   It never blocks or fails closed for Claude (FR-021). The kill switch and
   Anthropic's own Console spend-limit response still stop Claude
   (FR-007, FR-009, FR-019).
2. **Q1, Gemini $20 and Azure $20 a month as temporary hard caps.** They fail
   closed as the spec describes (FR-002 to FR-005). The daily cap of each is
   $20 ÷ 30 × 2.
3. **Q2, alert email:** `andyvinhtran1212@gmail.com`, confirmed by Vinh, kept
   in the single config value `OWNER_ALERT_EMAILS` and shared with
   ADMINAAL2-0032.
4. **Q3, temporary budget-raise button: in scope for phase 1** (FR-022):
   - an admin, with AAL2 required once ADMINAAL2-0032 provides it;
   - hard scopes only, whole dollars up to the lower of the base monthly cap
     and $50, for 1–72 hours;
   - one active raise and three per scope per UTC month;
   - an append-only audit event and an owner email for each grant, early end
     and expiry;
   - automatic expiry back to the base cap.

Q4–Q9 were not overridden, so their recommended defaults stand as written
in [`spec.md` → Owner decisions](spec.md#owner-decisions). Under them, the
total cap for the hard-scope providers is $250 a month. OpenAI and
ElevenLabs use the V1-derived caps once Vinh enters them. Migration 333
stands, subject to the Leader's confirmation before T002.

Still outstanding before the dependent tasks: the Leader confirms
migration 333 (Q5, before T002), and Vinh confirms the Azure Speech price
tier (Q1, before T001 adds the catalog row; until then Azure is refused
under FR-004).

This approves the intent in `spec.md` (FR-001…FR-022) and the rollout in
`rollout.md`. It does not authorize applying 333 to any database, setting
any Railway variable or secret, or any production step. Staging follows
the staging-first runbook, and production needs Vinh's explicit
authorization at the `staging` → `main` promotion.
