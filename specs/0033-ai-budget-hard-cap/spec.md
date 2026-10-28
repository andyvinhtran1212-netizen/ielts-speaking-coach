---
id: AIBUDGET-0033
title: Paid AI stops at hard budgets, Claude alerts on a soft budget, and learner work waits safely for grading
status: approved
risk: critical
owner: product
---

# Paid AI stops at hard budgets, Claude alerts on a soft budget, and learner work waits safely for grading

Status: **approved by Vinh** on 2026-10-28 (09:11, decisions updated 09:13,
UTC+7), relayed by the Leader. The decisions are in
[`approval-decision.md`](approval-decision.md) and
[Owner decisions](#owner-decisions). They change the draft in three ways:
Anthropic has a **soft** $100 budget that only alerts (FR-021); Gemini and
Azure have temporary **hard** $20 caps; and a temporary budget-raise button
is in phase 1 (FR-022). Sources:

- Product brief `AI-BUDGET` (Feature Developer, 2026-10-27 23:10; spec
  writing approved by Vinh 23:01 through the Leader). Its owner decisions
  are binding here.
- Disaster-recovery tabletop 2026-10-27 §6 "DDoS và lạm dụng chi phí AI",
  priority action 5.
- Handoff ticket H-1027-FD1.

The code survey with file:line citations is in [`research.md`](research.md).
Migration number **333** is the accepted Q5 default; the Leader still
confirms it before T002.

## Tóm tắt (tiếng Việt)

Hiện nay chi phí AI không có trần cứng chung. Một số bộ đếm còn "mở cửa" khi
database lỗi: đếm ra 0, hoặc đặt giới hạn 0 là bỏ giới hạn. Khi Anthropic báo
lỗi, hệ thống tự chuyển sang Gemini/OpenAI, nên chạm trần $200 của Anthropic
vẫn có thể tiêu tiếp ở nhà cung cấp khác. Spec này (anh Vinh đã duyệt
28/10/2026) quy định:

- **Claude/Anthropic: ngân sách mềm $100/tháng.** Chỉ gửi email cảnh báo ở
  50%, 80%, 100%; **không bao giờ chặn** Claude vì ngân sách, kể cả khi
  database ngân sách lỗi. Claude chỉ dừng khi bật nút dừng khẩn cấp hoặc khi
  chính Anthropic từ chối vì hết hạn mức trên Console.
- **Gemini $20/tháng và Azure $20/tháng: trần cứng tạm thời.** Hết trần thì
  không gọi. Trần ngày = trần tháng / 30 × 2 (khoảng $1,33/ngày). Tổng các
  nhà cung cấp có trần cứng (không tính Anthropic) mặc định $250/tháng.
  Mỗi lệnh gọi AI trả phí phải "giữ chỗ" ngân sách trong database trước khi
  gọi và chốt theo chi phí thật sau khi gọi. Với trần cứng: không giữ được
  chỗ thì không gọi, database lỗi cũng không gọi.
- **Nút tăng ngân sách tạm thời** trên trang admin: chỉ admin (bắt buộc xác
  thực 2 bước khi ADMINAAL2-0032 có), tăng tối đa bằng trần gốc và không quá
  $50 mỗi lần, từ 1 đến 72 giờ, tối đa 3 lần mỗi tháng cho mỗi trần. Mỗi lần
  dùng được ghi nhật ký và gửi email cho anh Vinh. Hết giờ tự trở về trần
  gốc.
- **Hết ngân sách thì không chuyển sang nhà cung cấp khác.** Lỗi tạm thời
  (quá tải, timeout) vẫn được chuyển như cũ, nhưng vẫn nằm trong trần.
- **Nút dừng khẩn cấp không cần database:** biến Railway `AI_KILL_SWITCH=on`.
- **Học viên:**
  - Bài Speaking/Writing nộp lúc hệ thống tạm dừng vẫn được lưu, hiện "Đang
    chờ chấm" với thông báo: "Hệ thống chấm tự động tạm dừng. Bài của bạn đã
    được lưu và sẽ được chấm khi hệ thống mở lại."
  - Không bị trừ lượt. Khi mở lại, bài được chấm theo thứ tự, đúng 1 lần.
  - Nút đọc/TTS, chấm gist Listening và tính năng AI phụ bị tắt kèm chú thích
    ngắn. Phần không dùng AI vẫn chạy bình thường.
- **Giáo viên** thấy banner "Chấm AI tạm dừng".
- **Admin** thấy bảng trạng thái ngân sách và cũng bị chặn gọi AI như mọi
  người.
- **Cảnh báo:** email gửi anh Vinh (`andyvinhtran1212@gmail.com`, một biến
  cấu hình duy nhất `OWNER_ALERT_EMAILS`) ở 50%, 80%, 100% trần tháng và khi
  chạm trần ngày, mỗi ngưỡng đúng 1 lần mỗi kỳ, và mỗi lần tăng ngân sách
  tạm thời được cấp, kết thúc sớm hoặc hết hạn.

## Problem

An abuser, a bug or a retry storm can spend paid AI money without a hard
stop. A shared database or provider outage can also remove the limits that
exist today.

- **No shared budget.** Each provider is billed separately: Anthropic,
  Google Gemini, OpenAI (Whisper STT and `tts-1`), ElevenLabs and Azure
  Speech. Only the Anthropic Console has a monthly cap ($200, owner's
  statement; the workspace scope is not yet verified). Nothing in the
  application caps total spend per day or per month.
- **Fallback spends past a cap.** `ai_router.with_fallback` moves to the
  next provider on any exception (`services/ai_router.py:412-448`). That
  includes Anthropic's 402 `billing_error`, which the router maps to the
  generic `APIStatusError` branch (`ai_router.py:361-364`), and its 429.
  The Speaking orchestrator chain does the same (research §2). Reaching the
  Anthropic cap therefore moves spend to Gemini.
- **Quotas fail open.**
  - `count_gradings_today` returns 0 on a DB error
    (`services/rate_limit.py:237-250`).
  - `MAX_GRADINGS_PER_USER_PER_DAY <= 0` disables the cap
    (`rate_limit.py:253-258`).
  - `record_grading_attempt` is best-effort (`rate_limit.py:279-284`).
  - The TTS and Listening gist daily counts fail open on lookup errors.
    They count ledger rows that are written in the background, so
    concurrent requests overshoot (`routers/tts.py:100-110`).
  - Their minute windows are kept per worker in process memory.
- **The ledger is best-effort.** `ai_usage_logs` writes are best-effort and
  scheduled off the request path (`services/ai_usage_logger.py:22-37,
  421-447`). That is correct for observability (AI-0004 FR-002), but the
  ledger cannot serve as a budget.
- **No stop switch that works without the DB.** `runtime_flags` returns the
  caller's default on any read error (`services/runtime_flags.py:52-66`).
  No paid-AI path consults it.
- **A cap alone would lose work.** Speaking runs Whisper before the
  recording is uploaded (`routers/grading.py:592-645`). If the pipeline were
  simply refused, today's code would lose or blur what the learner
  submitted.

## Scope

- One backend budget service that every paid provider call goes through.
  It applies:
  - the kill switch;
  - an atomic DB reservation against total and per-provider caps, monthly
    and daily;
  - settlement to the real usage;
  - per-scope enforcement mode: Anthropic is a soft scope that only alerts
    (FR-021); every other scope is hard.
- Fail-closed semantics for the budget service's hard scopes and for every
  existing quota or flag that gates a paid AI call. The soft Anthropic scope
  only alerts (FR-021).
- No cross-provider fallback when the refusal reason is budget, kill switch
  or a provider-reported spend limit. Transient provider errors keep
  today's fallback inside the caps.
- Speaking and Writing submissions made while paused: the work is saved,
  shown as pending, not charged to learner quota, and graded exactly once
  in order after reopening.
- Learner, instructor and admin UI states for the paused condition, and a
  read-only admin budget panel.
- Owner email alerts at 50/80/100% of each monthly cap and when a daily cap
  is reached, once per threshold per period.
- A temporary, bounded, audited and emailed budget raise for hard scopes,
  used by an admin from the admin panel, that expires back to the base cap
  on its own (FR-022).
- One additive migration (provisional 333), a sweeper job, and a rollout and
  rollback plan.

## Non-goals

- Edge, origin or WAF protection, CAPTCHA, and protecting direct Railway
  access. These are tabletop action 5, a separate job.
- Fixing the X-Forwarded-For first-hop trust (`routers/tts.py:61-68`). That
  belongs to job `q/cx-16-f10-xff-check`. This spec does not depend on the
  client IP.
- Changing per-user cap values. They stay as configured (`config.py:201-221`,
  brief decision). Only their failure semantics change.
- Billing reconciliation against provider invoices, which stays under
  AI-0004 FR-006. Spend through leaked keys used outside the app is also
  out of scope; no app control can see it.
- Changing a **base** cap from the app. Base caps change only through
  Railway variables; the app can only add a temporary, bounded raise
  (FR-022). Raising the soft Anthropic scope is not offered, because it
  never refuses.
- Model choice and provider order. AIOPS-0024 (draft, #1716) owns them; this
  spec adds no routing control.
- Moving the TTS and gist per-IP and per-minute windows out of process
  memory. The shared money budget bounds their cost; distributed burst
  limiting is origin protection (above).
- Emailing learners or instructors about the pause (brief decision).

## Users and journeys

- **Learner (Speaking/Writing):** submits work during a pause and sees it
  saved as "Đang chờ chấm". Later sees the grade without resubmitting.
  Never loses a recording or essay and never loses daily quota.
- **Learner (Listening/TTS/other AI helpers):** sees the AI control
  disabled with a short caption. Non-AI exercises still work.
- **Instructor:** sees "Chấm AI tạm dừng" on the dashboard, so ungraded
  work is not mistaken for missing work.
- **Admin:**
  - sees canonical budget state (committed vs cap, reason, queue depth,
    sweeper health, lookup failure);
  - is refused for AI actions exactly like everyone else;
  - can still use non-AI admin tools.
- **Owner (Vinh):** gets each threshold email once, including the soft
  Anthropic thresholds. Stops all AI with one Railway variable. Changes a
  base cap by changing a Railway variable, or unblocks a hard scope for a
  few hours with the temporary raise (FR-022), and gets an email for every
  raise event.
- **Operator/Leader:** follows `rollout.md` and repairs with the documented
  queries.

## Requirements

- **FR-001:** Every backend code path that sends a request to a paid AI or speech provider (Anthropic, Google Gemini, OpenAI including Whisper and TTS, ElevenLabs, Azure Speech) obtains a granted budget reservation for that provider from `services/ai_budget.py` immediately before the request is sent, and every retry or fallback attempt obtains its own reservation for its own provider; every provider SDK client is constructed with its hidden retries disabled (`max_retries=0`; today only `ai_router.py:223` and `grading_providers/claude.py:71` do), so each billable request is an explicit, reserved attempt; a repository test fails CI when a provider SDK call or provider HTTP endpoint appears in `backend/` outside the budget-guarded wrapper modules, and the inventory in `research.md` §1 is the initial allow-list.
- **FR-002:** A reservation is granted only when, for each hard scope it touches — `total` and the call's provider when that provider's scope is hard — and for both the current UTC calendar month and the current UTC day, the committed amount (settled spend plus open reservations) plus the new estimate does not exceed that scope's effective cap (its base cap plus any active raise, FR-022); a line for a soft scope (FR-021) is recorded in the same transaction without a cap check, and its spend does not count toward `total`; the check and the increment happen in one database transaction that locks the affected counter rows in a fixed order, so concurrent requests can never commit more than the cap in total, and a multi-call pipeline can reserve several provider lines all-or-nothing in one call; reservations are keyed by a request key per logical attempt, and replaying a request key that already has rows grants nothing and never authorises another provider request, whatever the existing reservation's status.
- **FR-003:** Base caps come from Railway variables: `AI_BUDGET_MONTHLY_USD_TOTAL` (required; it caps the hard-scope providers only), `AI_BUDGET_MONTHLY_USD_ANTHROPIC` (default 100, a soft budget under FR-021), `AI_BUDGET_MONTHLY_USD_GOOGLE` (default 20, hard), `AI_BUDGET_MONTHLY_USD_AZURE` (default 20, hard), and optional `AI_BUDGET_MONTHLY_USD_OPENAI` and `AI_BUDGET_MONTHLY_USD_ELEVENLABS`; a hard provider without its own cap is bounded only by the total; each daily cap is its monthly cap ÷ 30 × 2; the enforcement mode of each scope is fixed by this spec (`anthropic` soft, every other scope hard) and is not a variable; a missing, unparseable, zero or negative total cap, or an unparseable, zero or negative hard provider cap, puts that scope in `config_invalid`, which refuses all reservations for it and is shown on the admin panel — it never means "unlimited"; an unparseable, zero or negative Anthropic value shows `config_invalid` on the panel and suspends its threshold alerts, but refuses nothing (FR-021).
- **FR-004:** The estimate for a reservation is an upper bound computed from the `ai_pricing` catalog: input size, plus the request's `max_tokens` at the output rate, for token models; maximum audio duration for STT and pronunciation; and character count for TTS. A provider or model with no catalog price cannot be reserved and is refused. Settlement records the actual cost from the provider-reported usage. When an attempt ends without usage, the reservation is released if the request provably was not sent (connection refused before send), and settled at the estimate in every other case, including timeout and cancellation.
- **FR-005:** The budget service fails closed for hard scopes; soft-scope lines follow FR-021. If the reservation RPC errors, times out (2 s default), returns an unexpected shape, or the counter or reservation tables are missing, the call is refused and no provider request is made. A settlement failure leaves the reservation open at its estimate until the sweeper settles it. Neither path depends on `ai_usage_logs`, which stays best-effort under AI-0004 FR-002.
- **FR-006:** The existing per-user and per-IP paid-AI quotas fail closed, while their configured values are kept. These are `MAX_GRADINGS_PER_USER_PER_DAY`, `TTS_DAILY_LIMIT_PER_USER`, `TTS_IP_MAX_PER_MINUTE`, `LISTENING_GIST_DAILY_LIMIT_PER_USER` and `LISTENING_GIST_MAX_PER_MINUTE`. A count lookup error refuses the paid call with reason `budget_unavailable` instead of counting 0. A value of zero or less means `config_invalid` (refuse) instead of "no cap". Any `runtime_flags` read that gates a paid AI call treats a lookup error as disabled. `runtime_flags` behaviour for non-AI flags is unchanged.
- **FR-007:** When the Railway variable `AI_KILL_SWITCH` is `on`, `true` or `1`, or holds any value other than `off`, `false`, `0` or empty, the budget service refuses every reservation with reason `kill_switch`, soft-scope (Anthropic) lines included. It does not read the database. The variable is read from the process environment at call time, so the first request served by a process that has the value makes no provider call.
- **FR-008:** A refusal carries a reason: `monthly_cap`, `daily_cap`, `kill_switch`, `config_invalid`, `budget_unavailable` or `provider_spend_limit`. The refusal stops the whole attempt chain. `ai_router.with_fallback`, the Speaking grading orchestrator and every custom retry loop re-raise a budget refusal at once, without trying another provider, model or retry.
- **FR-009:** A provider response that reports the account's own spend or credit limit is classified as `provider_spend_limit`. This includes Anthropic HTTP 402 `billing_error`, OpenAI `insufficient_quota`, and the Gemini and ElevenLabs equivalents captured as fixtures. It is a budget refusal under FR-008, and it closes that provider's scope for the rest of the UTC day. Rate limiting (429 `rate_limit_error`), overload (529), 5xx, timeouts, network errors and invalid output stay transient and keep today's fallback behaviour within the caps.
- **FR-010:** Every synchronous paid-AI endpoint answers a budget refusal with HTTP 503 and the detail `{error_code: "ai_budget_exhausted", reason, work_saved, resource ids, message}`. This covers Speaking `POST /sessions/{id}/responses`, `POST /tts`, Listening gist attempts, question generation and the course and vocabulary AI routes in `research.md` §1. Writing submit keeps its current success response because grading runs in the background (`writing_student.py:1555`, `essay_service.py:375-430`); its refusal is reported through the essay's `grading_status` (FR-011). `message` is the Vietnamese learner text from `ui-states.md`. The detail passes the 5xx sanitizer (`services/errors.py:61-78`), so it is distinct from the 429 `rate_limit_exceeded` user quota and from provider error codes. Learners and instructors never see the internal reason; it is visible only to admins and in logs.
- **FR-011:** Learner work is saved before any AI call when Speaking or Writing grading is refused for a budget reason. For Speaking, the recording is stored and a `responses` row is persisted with `grading_status = 'awaiting_budget'` and no transcript or scores. Then exactly one deferred job is enqueued in `ai_deferred_grading_jobs` per response and submission revision, and the 503 reports `work_saved: true`. For Writing, the essay is already saved as `pending` and its `writing_jobs` row already exists, so a budget refusal in the background grader leaves the job `queued` and stamps `budget_deferred_at`. It does not increment `attempts`, does not switch to the fallback model and is not failed by the stuck-job reaper (`essay_service.py:1245-1340`). The Writing read APIs report `grading_status = 'awaiting_budget'` for that essay. This applies to every Writing grading trigger: learner submit, admin and instructor regrade, and mock-exam Writing. If a deferred Speaking recording cannot be stored, the endpoint returns 503 `{error_code: "recording_storage_unavailable", work_saved: false}`. It uses the `error_code` key so the detail survives the 5xx sanitizer; today's `code` key is replaced by `internal_error` (`research.md` §3). No row and no job are created. Writing keeps its existing submit errors.
- **FR-012:** A submission that is saved and deferred does not count against the learner's daily grading quota, nor do its later automatic grading attempts. Writing has no per-user cap today, and none is added. No `grading_attempts` row is written for it. This holds when the refusal comes after the first bundle was granted (for example, the fallback rung's reservation is refused, or a provider spend-limit response arrives mid-pipeline): such a refusal takes the same save-and-enqueue path as FR-011, and it deletes the `grading_attempts` row that request recorded. The row id is kept on the deferred job, so the sweeper retries the delete if it fails. Any transcript already paid for is stored on the response, so the drain does not pay for Whisper again. Retrying with the same `submission_id` returns the same deferred state and creates no second job, reservation or quota row.
- **FR-013:** A sweeper runs every 5 minutes (the Railway cron minimum) and drains only when the scopes a job needs are open. It drains deferred Speaking jobs and budget-deferred Writing jobs in `enqueued_at, id` order with a lease (`FOR UPDATE SKIP LOCKED`) and at most 2 concurrent jobs. Each job reserves budget before any provider call and stops draining at the first refusal. A job is idempotent on its `(kind, resource_id, submission_revision)` key, and a superseded revision is marked `superseded` and never graded. The job commits its result through the same canonical mapping as the live route, including grammar recommendations, in one database transaction. That transaction also sets the job's persistence marker and completion, and it refuses a second commit for the same revision. A crash before the commit leaves the job reclaimable when its lease expires, so it is never left marked but ungraded. Every commit, whatever the session's status, advances a durable, session-scoped refresh generation in the same transaction. Both writers of a session's band, the sweeper refresh and `PATCH /sessions/{id}/complete`, save through the same generation check: the band is written and the obligation acknowledged only if no drain commit has landed for that session since the writer read its responses, and otherwise the writer recomputes. So neither a crash after the commit, two overlapping refreshes, nor a completion racing a commit can leave an outdated band shown. Budget-deferred Writing jobs use their own drain lease and persistence marker on `writing_jobs`. They never use the Writing retry allowance (`attempt_count`), and a stale drain cannot commit after its job has been reclaimed. Each item is graded and charged at most once. The only exception is a crash after the provider response but before the result is persisted. That attempt is recorded and settled, and the item is retried once.
- **FR-014:** The sweeper also does the following each run. It settles reservations past `expires_at` (default 10 minutes) at their estimate. It dispatches pending alert emails with backoff. It writes a heartbeat. When the budget database is unreachable, it does nothing and exits non-zero.
- **FR-015:** For the `total` scope and every provider scope with its own cap, an alert row is created exactly once per scope, period and threshold. The alert fires the first time committed spend reaches 50%, 80% or 100% of the monthly cap, or 100% of the daily cap. The 100% alert for a scope and period also fires on the first reservation refused for `monthly_cap` or `daily_cap` in that scope, even when committed spend is below the cap because the next estimate does not fit. It also fires when FR-009 closes a provider's daily scope. Repeated refusals add nothing. Uniqueness is enforced in the database. This applies to the soft Anthropic scope too, except that it has no refusal trigger. Each new row is emailed to `OWNER_ALERT_EMAILS` (Q2: the single configured value `andyvinhtran1212@gmail.com`, shared with ADMINAAL2-0032). The email contains the scope, period, threshold, committed amount, cap and time, and never learner data or credentials. A failed send is retried and its state is shown on the admin panel. The Leader is notified only if Q4 chooses a channel.
- **FR-016:** The paused state is shown as follows.
  - `GET /ai/status` (any signed-in user) returns `{paid_ai_available, pending_grading_count_for_caller}`. It is false when any scope a learner AI feature needs is refused, and false on any lookup failure.
  - `GET /admin/ai/budget` (admin) returns, per scope and period: mode (`hard` or `soft`), base cap, active raise, effective cap, settled, reserved, committed, state and reason, and the raises used this month per scope. It also returns the kill-switch state, `config_invalid` scopes, queue depth and the oldest queued age, open and expired reservations, the last alert per threshold, the sweeper heartbeat and `lookup_failed`.
  - Admins are refused paid AI like any other caller. Non-AI admin operations are unaffected.
- **FR-017:** The learner, instructor and admin surfaces follow `ui-states.md`.
  - Speaking practice, the Speaking result and Full Test result, the Writing result and the Writing dashboard show "Đang chờ chấm" with the exact message in the brief, both immediately and after a reload.
  - The TTS, Listening gist and other learner AI controls are disabled with a short caption while `paid_ai_available` is false. The existing browser read-aloud fallback in practice remains.
  - The instructor dashboard shows the "Chấm AI tạm dừng" banner.
  - The `/admin` overview shows the budget panel, and a lookup failure renders as `⚠ lookup failed`, never as zero.
  - Each surface has loading, error/retry, keyboard, responsive and both-theme states.
- **FR-018:** Migration 333 is additive and staged first. It creates the counter, reservation, deferred-job, session-refresh, alert and budget-raise tables and the reserve, settle, release, expire, recompute and raise grant/end/expiry functions. It enables RLS, grants nothing to `anon` or `authenticated`, and grants `EXECUTE` and table privileges to `service_role` only. It is idempotent and has read-only postconditions. The code deployed before it keeps working (N-1). Code that needs it refuses paid AI with `budget_unavailable` instead of failing open when the objects are absent.
- **FR-019:** Outside the app, before production enforcement, Vinh records the following. The Anthropic Console monthly spend limit is $200 on the workspace that holds the production key; it is Anthropic's only hard stop, because the app budget for Anthropic is soft (FR-021). Each other provider has a provider-side cap or billing alert set, or an explicit waiver. The evidence is a screenshot or console readback that shows no key value.
- **FR-020:** Learner AI features that do not queue are refused before any learner allowance is used, and the learner's input stays in the page. These are Speaking question generation (`POST /sessions/{id}/questions/generate`, `/sessions/cuecard/generate`), course Writing (`POST /api/quiz/course/writing`), course pronunciation, Advanced Vocabulary controlled rewrite, Listening gist and TTS. They use no attempt, quota row or session-cap slot, and return the FR-010 503. Background generation started by a learner action (D1 question generation after a vocabulary confirm) is skipped and logged when refused. It is not retried until a later confirm.
- **FR-021:** The `anthropic` scope is a soft budget (owner decision 2026-10-28): $100 a month by default, daily $100 ÷ 30 × 2. Every Anthropic line is still reserved and settled through FR-001/FR-002, so its committed spend, the admin panel and the FR-015 alerts at 50/80/100% of the monthly budget and 100% of the daily budget stay canonical. A budget reason never refuses it: not `monthly_cap`, not `daily_cap`, not `config_invalid`, and not `budget_unavailable`. When the reservation RPC fails for a request whose only line is Anthropic, the call proceeds unreserved, and one `[ai_budget] decision=allow_unrecorded scope=anthropic` warning is logged per call, so the gap is visible. The soft scope does **not** exempt: the kill switch (FR-007); a provider spend-limit response from Anthropic itself (FR-009, the Console hard stop); the per-user quotas (FR-006); or the hard lines of a multi-provider bundle. A Speaking bundle whose Whisper or Gemini line is refused is still refused as a whole, with no provider call (FR-002).
- **FR-022:** An admin can add a temporary raise to one hard scope from the admin budget panel (owner decision 2026-10-28, phase 1). The routes are `POST /admin/ai/budget/raises` and `POST /admin/ai/budget/raises/{id}/end`.
  - **Who:** an active admin (`require_admin`). As soon as ADMINAAL2-0032's AAL2 check is implemented, both routes require `aal2`, even while `ADMIN_AAL2_ENFORCE` is in report-only mode; an AAL1 admin gets 403 `mfa_required` and nothing is written. Instructors, learners and service tokens are refused.
  - **Amount and duration:** whole US dollars, from 1 to the lower of the scope's base monthly cap and $50. While active, the amount is added to both the monthly and the daily effective cap of that scope. Duration is 1–72 whole hours (24 by default). A required reason of 1–500 characters is recorded.
  - **Limits:** only hard scopes with a valid base cap can be raised (`total`, `google`, `azure`, and `openai` or `elevenlabs` once they have their own cap). The soft `anthropic` scope and any `config_invalid` scope are refused. At most one active raise per scope (409 `raise_active`; end it first) and at most 3 raises per scope per UTC calendar month (409 `raise_limit_reached`). A raise never changes the Railway base cap.
  - **Audit:** each grant, early end and expiry writes one append-only event with the raise id, scope, amount, base cap, effective cap, `expires_at`, actor user id, actor `aal`, request id and reason. Events are never updated or deleted; `service_role` cannot `UPDATE` or `DELETE` them.
  - **Email:** the grant, early end and expiry each create exactly one owner alert row in the same transaction as the event. The row is emailed to `OWNER_ALERT_EMAILS` with the scope, amount, base and effective cap, expiry, actor email and reason. A grant whose alert row cannot be written is not granted.
  - **Auto-expiry:** the reserve function counts a raise only while `now() < expires_at` and it has not been ended, so the cap returns to the base value at `expires_at` without any sweeper run. Spend committed during the raise stays committed; if it is above the base cap, the scope refuses again at once. The sweeper records the expiry event and email within one run after `expires_at`.
  - **Failure:** a raise or end RPC error, timeout or unexpected shape returns 503 and changes nothing; it never reports a raise as granted. After any mutation the panel refetches `GET /admin/ai/budget` instead of updating local state.

## Acceptance scenarios

All scenarios run against fake or offline providers (a recording stub that
counts calls). No real traffic is needed.

### AC1 — Hard cap reached: no provider is called, fallback included

- **Given** committed spend on the `total` monthly scope equals its cap
  (Whisper's OpenAI line is bounded by it), and the soft Anthropic scope has
  room
- **When** a learner submits Speaking
- **Then** zero calls reach any stub (Anthropic, Gemini, Whisper, Azure),
  because the bundle is all-or-nothing. The response is 503
  `ai_budget_exhausted` with `work_saved: true`. One deferred job exists.

### AC2 — Budget DB failure: fail closed

- **Given** the reserve RPC raises, times out or is missing
- **When** any paid AI feature is called
- **Then** no stub is called, the response is 503 with reason
  `budget_unavailable`, and non-AI routes still return 200.

### AC3 — Retry never double-counts

- **Given** a granted Speaking reservation, and a client retry with the same
  `submission_id` after a lost acknowledgement
- **When** the retry arrives before settlement, after settlement, or concurrently with the original
- **Then** the provider stub is called once and committed spend increases once. One `grading_attempts` row exists
  at most, and none for a deferred submission. The ledger has no duplicate
  `usage_event_id`.

### AC4 — Concurrency never exceeds the cap

- **Given** a scope with room for exactly N estimates
- **When** 4N reservations race from two connections or processes
- **Then** exactly N are granted and committed is at most the cap. The
  tests run on PostgreSQL 16 and 17.

### AC5 — Kill switch

- **Given** `AI_KILL_SWITCH=on` in the process environment and an
  unreachable budget DB
- **When** the first request is made to each AI feature
- **Then** no stub is called and the reason is `kill_switch`. Values `off`,
  `false`, `0` and empty allow the call; `banana` refuses it.

### AC6 — Saved, shown, graded once after reopening

- **Given** the budget is exhausted
- **When** a learner submits Speaking and Writing, reloads, and the cap is
  then raised
- **Then** both items show "Đang chờ chấm" with the brief's message before
  and after the reload. After reopening, the sweeper grades them in
  enqueue order. Each has exactly one successful grading attempt and one
  result. A completed session's band is recomputed. The learner's daily
  grading count is unchanged.

### AC7 — Alerts once per threshold per period

- **Given** spend that crosses 50%, 80% and 100% of a monthly cap and the
  daily cap, including concurrent crossings and sweeper re-runs
- **Then** exactly one alert row and one successful send exist per
  threshold, scope and period. A new month produces new alerts.

### AC8 — Transient errors still fall back within the cap

- **Given** budget room on both providers
- **When** the Anthropic stub returns 429 `rate_limit_error`, 529 or a
  timeout
- **Then** the existing fallback to the next provider happens, and each
  attempt holds its own reservation.
- **When** the stub returns 402 `billing_error`
- **Then** no fallback happens, the reason is `provider_spend_limit`, and
  the Anthropic scope is closed for the UTC day.

### AC9 — Configuration fails closed

- **Given** `AI_BUDGET_MONTHLY_USD_TOTAL` is unset, `0` or `abc`, or
  `MAX_GRADINGS_PER_USER_PER_DAY=0`
- **Then** paid calls in the affected scope are refused with reason
  `config_invalid`, and the admin panel names the variable. None of these
  values means "unlimited".
- **Given** `AI_BUDGET_MONTHLY_USD_ANTHROPIC=abc`
- **Then** the panel shows `config_invalid` for `anthropic`, no Anthropic
  threshold alert is created, and an Anthropic call is still made.

### AC10 — The Anthropic budget is soft

- **Given** Anthropic committed spend at or above $100 for the month and
  above its daily budget, with every hard scope open
- **When** a Claude-only paid call is made
- **Then** the Anthropic stub is called once and its reservation is
  recorded and settled. Exactly one 100% monthly and one 100% daily alert
  row exist, and each is emailed once. Nothing is refused.
- **Given** the reserve RPC raises
- **Then** a Claude-only call is still made with one `allow_unrecorded`
  log line, while a Gemini-only call and a Speaking bundle are refused with
  `budget_unavailable` and zero stub calls.
- **Given** `AI_KILL_SWITCH=on`, or an Anthropic 402 `billing_error` earlier
  that UTC day
- **Then** the Claude call is refused (`kill_switch`,
  `provider_spend_limit`) with no fallback.

### AC11 — Gemini and Azure temporary hard caps

- **Given** `AI_BUDGET_MONTHLY_USD_GOOGLE` and `AI_BUDGET_MONTHLY_USD_AZURE`
  are unset
- **Then** both scopes use $20 a month and $1.3333 a day.
- **Given** Google committed spend at $20 for the month (or at the daily
  cap)
- **When** a Gemini call is attempted, directly or as a fallback rung
- **Then** zero Gemini stub calls are made, the reason is `monthly_cap`
  (or `daily_cap`), and a Writing grade is deferred under FR-011. The same
  holds for Azure pronunciation.

### AC12 — Temporary budget raise

- **Given** an AAL2 admin (or, before ADMINAAL2-0032's AAL2 check ships, an
  active admin) and the Google scope at its $20 cap
- **When** the admin raises `google` by $10 for 2 hours with a reason
- **Then** one raise, one `granted` event and one alert row exist, the
  email is sent once, Gemini reservations are granted up to $30 that
  month, and the panel shows the base cap, the raise, the effective cap
  and the expiry after a refetch.
- **When** the clock passes `expires_at` with no sweeper run
- **Then** the next Gemini reservation is checked against $20 again and
  refused. The next sweep writes one `expired` event and one email.
- **When** an admin ends a raise early
- **Then** the cap returns to the base value at once, with one `ended`
  event and one email.
- **Then refused, with no raise, event or email:** a learner, an
  instructor, an AAL1 admin once the AAL2 check ships; an amount of 0, $51,
  above the base monthly cap, or not a whole dollar; a duration of 0 or
  73 hours; an empty reason; the `anthropic` scope; a `config_invalid`
  scope; a second active raise (`raise_active`); a fourth raise in the
  month (`raise_limit_reached`); an RPC failure (503).

## Edge cases

- **Counting at the cap.** Estimates are upper bounds. Actual cost can only
  lower committed spend at settlement, except when a provider bills more
  than `max_tokens` allows. That case is logged, and any overshoot is
  bounded by one in-flight call per open reservation.
- **The provider cap is reached before the app cap.** Estimator error or
  key use outside the app can cause this. FR-009 classifies the provider's
  402 or `insufficient_quota` as a budget refusal and closes the scope for
  the day, so no fallback spends elsewhere.
- **Month boundary.** A reservation belongs to the period in which it was
  granted. Settlement after midnight UTC on the 1st updates the old
  period's counter.
- **Cap change mid-period.** A new Railway value applies after restart to
  the period's existing committed spend. Lowering the cap below committed
  spend refuses new calls at once. Raising it reopens the scope and lets
  the sweeper drain the queue. A temporary raise (FR-022) does the same
  without a restart and ends on its own.
- **A raise across a period boundary.** A raise that is still active at
  midnight UTC also adds to the new day's, and on the 1st the new month's,
  effective cap until `expires_at`. It counts toward the month in which it
  was granted.
- **Soft scope above its budget.** Anthropic spend can exceed $100 in the
  app. The only hard stop is the Anthropic Console limit (FR-019), which
  FR-009 turns into `provider_spend_limit` with no fallback.
- **Unrecorded soft spend.** Anthropic calls made during a budget DB outage
  are not in the counters, so the panel and the alerts can under-count
  them. The `allow_unrecorded` log lines and the best-effort ledger are the
  record. The 7-day reconciliation (P4) compares against the Console.
- **Hard lines in the Speaking bundle.** The bundle (`plan.md`) includes
  Whisper, which is bounded by `total`, and Azure pronunciation, which is
  hard at $20 a month and $1.33 a day. When either line is refused, the
  whole Speaking grade is deferred, Claude included. The soft Anthropic
  budget does not change this. A raise of the Azure scope (FR-022) or a
  higher base cap does. Until the Azure price tier is confirmed (Q1),
  FR-004 refuses the Azure line too. The Gemini fallback is reserved only
  when that rung runs, so the Gemini cap defers a grade only when the
  Claude primary has already failed.
- **Learner status during a budget DB outage.** `GET /ai/status` reports
  `paid_ai_available: false` on any lookup failure (FR-016), so learner AI
  controls are disabled in the UI, even though the backend would still
  allow a Claude-only call (FR-021). This is deliberate. The status cannot
  know which providers a feature's fallback chain will reach, and the
  budget tables live in the application database, so such an outage
  affects the app as a whole.
- **Queued work, then the learner records again.** The new submission
  revision supersedes the queued job (FR-013), and only the newest take is
  graded. This matches the existing revision rule in `routers/grading.py`.
- **Queued work and session completion.** `PATCH /sessions/{id}/complete`
  still completes the session. The aggregate covers graded responses, the
  result page lists pending ones, and the deferred job's commit makes the
  sweeper recompute the aggregate. A commit that lands while completion
  is computing makes completion's band write stale, so completion
  recomputes (FR-013); the saved band never misses a committed result.
  Full Test finalization treats a pending part as pending, not as zero.
- **Queue drain competes with live traffic.** Both use the same budget. Two
  concurrent jobs keep the drain from starving live learners. A queue
  larger than one day's budget drains over several days, oldest first.
- **Deleted or archived learner, or deleted session.** The job is marked
  `superseded` with a reason and is not graded.
- **Admin offline scripts** (`backend/scripts/*` using production keys)
  call the same service and count against the same budget (Q7).
- **The kill switch is on while the budget DB is down.** The kill switch
  takes priority and no DB call is attempted.
- **The sweeper is down.** Open reservations expire only when it runs. The
  admin panel shows the heartbeat age. Committed spend stays conservatively
  high and never opens more budget.

## Success criteria

- In offline tests AC1–AC12 all pass. Provider stubs record zero calls in
  every refusal scenario.
- On staging, with a low cap, the brief's message is shown for Speaking and
  Writing and survives a reload. The queue drains with zero double grades
  (`plan.md` V5), and each alert arrives exactly once.
- Over the 7-day production observation, app-committed spend is within 10%
  of each provider console per day. No day exceeds the daily cap by more
  than one in-flight estimate.
- No 5xx from a non-AI route is attributable to the budget service.

## Owner decisions

Decided by Vinh on 2026-10-28 09:11, with Q1–Q3 updated at 09:13 (UTC+7),
relayed by the Leader. Q1–Q3 record the owner's answers. Q4–Q9 were not
overridden, so their recommended defaults stand as written.

- **Q1: Caps for providers other than Anthropic.** *Decided:*
  - **Anthropic (Claude): $100 a month, soft** (FR-021). It alerts only and
    never blocks or fails closed for Claude. This replaces the brief's
    in-app $200 hard cap. The Console limit stays $200 (FR-019).
  - **Google (Gemini): $20 a month, hard, temporary.** Daily $1.33.
  - **Azure Speech: $20 a month, hard, temporary.** Daily $1.33.
  - "Temporary" means Vinh revisits them. They change through the Railway
    variables or, for a few hours, the raise in FR-022.
  - *Default, not overridden:* the total is **$250/month** (daily $16.67).
    Because the Anthropic scope is soft, the total caps the hard-scope
    providers only. OpenAI and ElevenLabs each get last full month's ledger
    spend + 20%, rounded up to the next $5. An operator computes this
    read-only from `ai_usage_logs` (`plan.md` V1) and Vinh enters it. Until
    then they are bounded by the total only.
  - *Still outstanding:* Vinh confirms the Azure Speech price tier, so a
    catalog row can be added. Without it, pronunciation scoring is refused
    under FR-004.
- **Q2: Alert recipient.** *Decided:* `andyvinhtran1212@gmail.com` (confirmed
  by Vinh), kept in the one config value `OWNER_ALERT_EMAILS`, the same
  variable and address as ADMINAAL2-0032. It is set as a Railway variable,
  not in code.
- **Q3: Temporary budget-raise button for admins.** *Decided:* **yes, in
  phase 1**, bounded as FR-022 specifies: an admin with AAL2 once
  ADMINAAL2-0032 provides it, at most the base cap and $50 per raise, 1–72
  hours, one active raise and three per scope per month, an append-only
  audit event and an owner email for each grant, early end and expiry, and
  automatic expiry back to the base cap. These bounds limit what a
  compromised admin account can add.
- **Q4: Leader notification and sweeper-down alert.** *Default stands:*
  none beyond email. A sweeper heartbeat older than 15 minutes is shown on
  the admin panel but not emailed. Add a channel only if one is named.
- **Q5: Migration number.** *Default stands:* **333**, since 327–330 are
  reserved, 331 is GIVEARCHIVE-0031 and 332 is ADMINAAL2-0032. The Leader
  confirms before T002.
- **Q6: Production shadow window.** *Default stands:* none. Shadow mode
  (`AI_BUDGET_MODE=shadow`, reserve and log without refusing) is used only
  on staging to calibrate estimates. Production starts in `enforce`.
- **Q7: Operator scripts.** *Default stands:* every `backend/scripts/*`
  entry point that uses the production provider keys goes through the
  budget service and counts against the same caps. A script that needs a
  separate budget uses a separate key and is out of scope.
- **Q8: Sweeper deployment.** *Default stands:* if ADMINAAL2-0032's Railway
  cron service has landed, add this sweeper as a step of it. Otherwise,
  add a 5-minute Railway cron service `python -m scripts.ai_budget_sweep`
  from the backend image. Approving this spec approves that service.
- **Q9: Queue more than Speaking and Writing?** *Default stands:* no.
  Course Writing, course pronunciation, Advanced Vocabulary rewrite and
  Listening gist are refused before they are accepted (FR-020). The
  learner's input stays in the page and no attempt is used. Queuing them
  would need a deferred contract for each flow. That can be a later spec
  if pauses turn out to be frequent.
