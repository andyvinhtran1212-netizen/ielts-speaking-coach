# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
AIBUDGET-0033 on 2026-10-28 at 09:11, with decisions updated at 09:13
(UTC+7), relayed by the Leader, against draft PR #1773. Further decisions
followed at 09:35 ([below](#further-decisions-0935-2026-10-28-utc7)), and
Vinh answered Q10, Q11 and the Azure tier at 16:26
([below](#decisions-1626-2026-10-28-utc7)). The 09:13 decisions were:

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
  rule were decided at 16:26 (Q10 = A, Q11 = A, below).
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

## Decisions, 16:26 (2026-10-28, UTC+7)

Vinh answered the last open questions at 16:26. They were relayed with the
instruction to update PR #1773, and they are recorded as written.

- **Q10 = A.** When Azure is skipped for budget reasons, the overall band
  is the mean of FC, LR and GRA, labelled "Điểm tổng tính trên 3 tiêu
  chí". This is the current default. *(Closes Q10. The alternative of
  withholding the overall band is not chosen.)*
- **Q11 = A.** No automatic re-grade of pronunciation in phase 1. A Full
  Test's result-page pronunciation call can still add P later. *(Closes
  Q11. The P-only deferred job is not chosen.)*
- **Q1, Azure tier.** The Azure Speech pricing tier is **S0** (standard,
  paid). Use S0 pricing for Azure cost estimation and reservation sizing.
  *(Closes the Azure-tier item of Q1 and removes the caveat that Speaking
  is graded without P until the tier is confirmed. T001 adds the S0 row;
  sizing is in `research.md` §7.)*

## Decision, 22:34 (2026-10-28, UTC+7)

Vinh approved new learner copy at 22:34, relayed with the instruction to
update PR #1773. It is recorded as written.

- **Unmeasurable-recording 422 copy.** The fail-closed 422 shown when a
  Speaking recording's duration cannot be measured reads exactly:
  "Không đọc được bản ghi âm nên bài chưa được chấm và không bị trừ lượt. Vui lòng ghi âm lại."
  *(Replaces "Không đọc được bản ghi âm. Vui lòng ghi âm lại." The
  behaviour stays as specified: no provider call, no reservation, no
  storage and no daily grading quota used.)*

## Amendment 1, 14:44 (2026-10-29, UTC+7)

**State: APPROVED by the human owner.** Vinh approved Amendment 1
(FR-025, AC15, idempotent manual regrade) on 2026-10-29 at 14:44 (UTC+7).
The answer, verbatim: "Duyệt cả 5 theo đề xuất". The Leader verified it
directly in the Leader chat (`handoff/leader/20261029-1442-fd-questions-vinh.md`
(d)). The amendment was drafted by the Feature Developer at 14:40 against
`origin/staging` @ `f69055f65`, from brief H-1028-FD7 part (b). The four
decisions are recorded as written:

1. **FR-025 + migration 342 approved.** *(Adds FR-025 and AC15. Migration
   342 is reserved by the Leader. The table is `public.regrade_requests`,
   not migration 084's `essay_regrade_requests`.)*
2. **Instructor route included.** `POST /instructor/essays/{essay_id}/regrade`
   is covered with the three admin routes; it uses the same Writing
   pipeline as FR-011.
3. **Terminal records TTL 24 h. In-flight lease 15 min** (part of the
   approved proposal).
4. **The UI text for 409 `regrade_in_flight` ("Đang chấm lại, vui lòng
   đợi…") goes to Content Manager for wording only. It does not block
   implementation.** *(`ui-states.md` R1.)*

Sequencing, from the same approval: implement after PC-J64 (T006) and
PC-J54 (T007) merge (T014). Production only at a promotion Vinh
authorises.

Where each decision lands is listed in
[`spec.md` → Owner decisions](spec.md#owner-decisions).

## Rollout preconditions still open

No owner question is open. These preconditions remain:

- The `averlearning.com` domain is verified in Resend before alert emails
  can be sent (decision (a)).
- ADMINAAL2-0032's AAL2 reader exists before the raise routes accept any
  caller (decision (e), T013).

This approves the intent in `spec.md` (FR-001…FR-025) and the rollout in
`rollout.md`. It does not authorize applying 333 or 342 to any database, setting
any Railway variable or secret, or any production step. Staging follows
the staging-first runbook, and production needs Vinh's explicit
authorization at the `staging` → `main` promotion.
