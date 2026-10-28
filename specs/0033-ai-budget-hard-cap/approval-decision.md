# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
AIBUDGET-0033 on 2026-10-28 at 09:11, with decisions updated at 09:13
(UTC+7), relayed by the Leader, against draft PR #1773. Further decisions
followed at 09:35 ([below](#further-decisions-0935-2026-10-28-utc7)). The
09:13 decisions were:

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

Q4–Q9 were not overridden at 09:13, so their recommended defaults stood
as written in [`spec.md` → Owner decisions](spec.md#owner-decisions).

## Further decisions, 09:35 (2026-10-28, UTC+7)

Vinh approved these decisions in chat at 09:35. They were relayed with the
instruction to update PR #1773, and they are recorded as written. Where
they differ from items 1–4 above, they replace them.

- **(a)** Alert emails are sent FROM `alerts@averlearning.com` through
  Resend, once the domain's DNS is verified. They go TO
  `andyvinhtran1212@gmail.com`, which stays a single config value. Gmail
  SMTP is not used. *(Updates item 3: adds the sender.)*
- **(b)** OpenAI gets a $20/month hard cap, and so does ElevenLabs. On top
  of that there is a TOTAL monthly threshold of $200, which ALERTS ONLY and
  never blocks. A missing config must never block all AI: the default
  values must come from the spec, not lead to `config_invalid`.
  *(Replaces the $250 hard total default and the V1-derived OpenAI and
  ElevenLabs caps.)*
- **(c)** When Azure's cap is used up, Speaking grading CONTINUES without
  the pronunciation score. The learner sees a short note in Vietnamese.
  Grading is not deferred. *(Replaces the known consequence that an
  exhausted Azure cap deferred all Speaking.)* The Feature Developer
  addendum approved through (c) is FR-023. Its band formula and re-grade
  rule are defaults pending owner questions Q10 and Q11.
- **(d)** Keep the $1.33/day cap for Gemini and Azure, as protection
  against runaway loops.
- **(e)** The temporary budget-raise button: each raise can add at most
  100% of the base cap, lasts at most 24 hours, and can be used at most 3
  times per month. It also needs everything already specified (admin-only,
  an audit log, an alert email when used, automatic expiry), and it must
  REQUIRE AAL2 on `/admin/ai/budget`, as the Security Auditor asked.
  *(Replaces item 4's $50 limit, 72 hours and "AAL2 once ADMINAAL2-0032
  provides it".)*
- **(f)** Claude/Anthropic keeps the $100/month SOFT limit. It sends an
  alert at 80% ($80) and another at 100%, and never blocks. The $200 cap
  on the Anthropic Console stays as the last backstop. *(Replaces the 50%
  Anthropic alert in item 1.)*
- **Migration number for AI-BUDGET lot 02: 333.** *(Closes Q5.)*

Where each decision lands is listed in
[`spec.md` → Owner decisions](spec.md#owner-decisions).

## Still outstanding

- Vinh confirms the Azure Speech price tier (Q1, before T001 adds the
  catalog row). Until then, the Azure line is refused under FR-004, and
  Speaking is graded without pronunciation (FR-023).
- Vinh answers Q10 (the band when pronunciation is skipped) and Q11 (a
  later pronunciation re-grade). The defaults in FR-023 apply until then.
- The `averlearning.com` domain is verified in Resend before alert emails
  can be sent (decision (a)).
- ADMINAAL2-0032's AAL2 reader exists before the raise routes accept any
  caller (decision (e), T013).

This approves the intent in `spec.md` (FR-001…FR-024) and the rollout in
`rollout.md`. It does not authorize applying 333 to any database, setting
any Railway variable or secret, or any production step. Staging follows
the staging-first runbook, and production needs Vinh's explicit
authorization at the `staging` → `main` promotion.
