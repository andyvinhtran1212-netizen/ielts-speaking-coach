# Rollout and rollback

Phases follow `docs/STAGING_FIRST_RELEASE_FLOW.md`. Nothing in this file is
authorised by the spec PR itself. Production steps need Vinh's explicit
authorisation at the `staging` → `main` promotion. Commands never print a
key, token or `.env` value. Evidence records variable **names** and
"set/unset", never values.

## Preconditions

- AIBUDGET-0033 is approved on `staging`, with Q1–Q9 (`spec.md`) recorded in
  `approval-decision.md` (approved by Vinh 2026-10-28; the Azure tier under
  Q1 is still outstanding).
- The Leader has confirmed migration number 333 (provisional; 327–330 are
  reserved, 331 is GIVEARCHIVE-0031, 332 is ADMINAAL2-0032). If the number
  changes, rename the file and every reference in one commit before T002.
- Every provider/model that can be reserved has a price row in
  `backend/services/ai_pricing.py`. Azure pronunciation has no row today.
  Without one, Azure calls are refused once enforcement starts (FR-004).
  T001 adds the Azure row from the tier Vinh confirms under Q1.
- Railway variables are set on the target environment **before** the
  enforcing backend deploys, because a missing or invalid total cap refuses
  all paid AI (FR-003):
  `AI_BUDGET_MONTHLY_USD_TOTAL`, `AI_BUDGET_MONTHLY_USD_ANTHROPIC` (100,
  soft), `AI_BUDGET_MONTHLY_USD_GOOGLE` (20) and `AI_BUDGET_MONTHLY_USD_AZURE`
  (20), the optional OpenAI and ElevenLabs caps from Q1, `AI_KILL_SWITCH=off`,
  `AI_BUDGET_MODE`, `OWNER_ALERT_EMAILS` (the single owner address decided
  under Q2) and the email-provider key (shared with 0032 when it has
  landed). The code defaults match the decided values, so an unset Google
  or Azure variable still applies $20.
- The Anthropic Console monthly spend limit is confirmed at $200 for the
  production workspace by Vinh, with a screenshot naming the workspace and
  no key. The app budget for Anthropic is soft (FR-021), so the Console
  limit is Anthropic's only hard stop; it is required.
- Hard caps or alerts at the other providers (Google AI Studio/Cloud billing
  budget, OpenAI project limit, ElevenLabs plan, Azure budget) are recorded
  as set or explicitly waived by Vinh. This is out-of-app work (FR-019).
- The Speaking and Writing deferred paths are dark-launched behind
  `AI_BUDGET_MODE`. `shadow` reserves and logs `would_refuse` but never
  refuses. `enforce` refuses. Any other value, or no value, means `enforce`.

## Staging

1. **S1. Migration.** Apply `333_ai_budget_hard_cap.sql` with the
   advisory-locked runner. Run the read-only postcondition queries in
   `plan.md` §Data (catalog, grants, RLS, the function signatures). The
   currently deployed backend does not read the new objects, so the
   migration alone changes nothing (N-1 safe).
2. **S2. Shadow.** Deploy the merged SHA with `AI_BUDGET_MODE=shadow` and
   staging caps that match production. Run the E2E Speaking, Writing,
   Listening gist and TTS journeys. For each feature, compare the reservation
   estimate with the settled actual cost (`plan.md` V3). Record the
   estimate/actual ratio for each feature. The lower tail is the safety
   check, so the **minimum** ratio must be at least 1.0. Zero settled
   reservations may have `actual_usd > estimate_usd`, because FR-004 makes
   the estimate an upper bound. The median must be at most 3.0, so the cap
   is not reached early. Investigate any underestimate (V3
   `underestimated` count) and tune the estimator before S3.
3. **S3. Enforce with a low cap.** Set `AI_BUDGET_MODE=enforce` and
   `AI_BUDGET_MONTHLY_USD_TOTAL` to a test value just above the period's
   committed spend. Then run AC1–AC9 (`spec.md`) with E2E accounts.
   - Submit Speaking and Writing work after the cap is reached. Check the
     "Đang chờ chấm" state, no provider call and no learner quota use.
   - Raise the cap and restart. Check that the queue drains in order and
     each submission revision is committed exactly once (`plan.md` V5,
     which keys on the job and revision, not on ledger rows).
   - Set `AI_KILL_SWITCH=on`. Within one request after the new deployment
     serves traffic, no provider call is made (V6).
   - Stop the budget RPC path by revoking EXECUTE in a staging-only
     rehearsal, then restore the grant. Paid AI is refused and non-AI pages
     still load (AC2).
   - Check that the 50/80/100% and daily alerts reach the staging recipient
     once each (V7).
   - **Soft Anthropic budget (AC10).** Set a staging Anthropic budget just
     above committed spend. A Claude-primary feature keeps working past
     it, and the 100% alerts arrive once each.
   - **Raise rehearsal (AC12).** With the Google scope at its staging cap,
     an admin grants a 1-hour $1 raise from the panel. Check the email, the
     panel's effective cap and that Gemini calls resume. Let it expire.
     Check that the cap reverts and the expiry email arrives. Grant again
     and end it early. Run V8. Before ADMINAAL2-0032's AAL2 check ships,
     record that the route ran with AAL1. After it ships, also show that an
     AAL1 admin is refused.
4. **S4. Restore.** Set staging caps back to the production values. Keep
   `enforce`. Record the SHA, variable names (set/unset), outputs and
   timings in `verification.md`.

## Production

With Vinh's explicit authorisation at promotion:

1. **P1.** Set the production variables listed under Preconditions with
   `AI_BUDGET_MODE=enforce` (Q6 default: no production shadow window).
   Keep `AI_KILL_SWITCH=off`.
2. **P2.** Apply 333 under the advisory lock before the dependent backend
   is promoted. Run the read-only postconditions.
3. **P3.** Promote the staging SHA. Health checks:
   - `GET /admin/ai/budget` shows `state=open`, the expected caps and
     period, and `lookup_failed=false`.
   - One real E2E-account Speaking grading settles a reservation.
   - The reservation's `actual_usd` matches the ledger row for the same
     `usage_event_id`.
4. **P4.** Observe for 7 days.
   - Each day, compare app-committed spend to the provider consoles.
   - A gap above 10% for any provider blocks closing the spec and triggers
     estimator tuning.
   - Record the comparison in `verification.md`. No synthetic traffic
     beyond the single P3 check is sent to production.

## Rollback and repair

- **Fast stop (no DB):** set `AI_KILL_SWITCH=on` on Railway. Every provider
  call is refused once the new deployment serves. Learner work is still
  saved and queued (FR-010/FR-011).
- **Code rollback:** reverting the backend restores today's behaviour,
  including today's fail-open paths. The 333 tables stay and are ignored.
  Before reverting, export the queued rows. Queued Speaking and Writing items
  remain saved but are not graded by the old backend. Re-deploy forward to
  drain them, or re-grade through the existing admin regrade route per item.
- **Raise rollback:** end an active raise from the panel, or with
  `fn_ai_budget_raise_end` as an operator. The cap reverts at once.
- **Mode rollback:** `AI_BUDGET_MODE=shadow` keeps reservations and alerts
  but stops refusals. Use it only on Vinh's instruction, because it reopens
  the cost exposure.
- **Schema rollback:** the 333 header carries a guarded down script. It
  aborts unless `ai_deferred_grading_jobs` has no `queued` or `running` rows,
  so no saved work loses its path to grading. Counters and reservations are
  operational history. Dropping them loses budget history but no learner
  data.
- **Repair: stuck reservations.** The sweeper settles a `reserved` row past
  `expires_at` at its estimate (conservative). The repair query in `plan.md`
  V4 lists rows older than 1 hour that are still `reserved`. Any such row
  means the sweeper is down.
- **Repair: double grading.** `plan.md` V5 lists any deferred job marked
  `done` without its persistence marker (or the reverse), any submission
  revision committed more than once, and any deferred Writing job with
  more than one feedback row. Several successful ledger rows for one grade
  (JSON repair, grounded-answer regeneration) are not double grading. The
  expected result is zero rows. Investigate any row before the spec is
  closed.
- **Repair: counter drift.** `plan.md` V3 recomputes each counter from its
  reservations. A mismatch is corrected only by the guarded
  `fn_ai_budget_recompute(period)` run by an operator. It never lowers
  `spent_usd` below the settled total.

## Observability

- Structured logs, without prompt or learner content:
  - `[ai_budget] decision=allow|refuse|would_refuse reason=…
    scope=… feature=… reservation=…`
  - `[ai_budget] settle reservation=… estimate=… actual=…`
  - `[ai_budget] sweeper expired=… raises_expired=… alerts_sent=… jobs_drained=…`
  - `[ai_budget] decision=allow_unrecorded scope=anthropic feature=…` (FR-021)
  - `[ai_budget] raise granted|ended_early|expired raise=… scope=… amount=… actor=…`
- Correlation: the reservation id is the ledger `usage_event_id` prefix,
  plus the existing `X-Request-ID`.
- Metrics, read from tables by `GET /admin/ai/budget`: committed vs cap for
  each scope and period, queue depth and oldest queued age, open
  reservations, the last alert for each threshold, and the sweeper
  heartbeat.
- Alerts go to `OWNER_ALERT_EMAILS` (Q2) at 50/80/100% of each monthly cap
  (the soft Anthropic budget included), when a daily cap is reached, and for
  each raise grant, early end and expiry. A sweeper heartbeat older than 15 minutes
  is shown on the admin panel. Emailing about it is Q4.
- Owner: Vinh (product, budget). The implementing agent records T010/T011
  evidence on the PR.
