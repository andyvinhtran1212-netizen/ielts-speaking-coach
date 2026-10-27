---
id: AIBUDGET-0033
title: Paid AI stops at a hard shared budget and learner work waits safely for grading
status: draft
risk: critical
owner: product
---

# Paid AI stops at a hard shared budget and learner work waits safely for grading

Status: **draft, awaiting Vinh's approval.** The brief calls this
"proposed"; the repository lifecycle calls it `draft`
(`specs/README.md`). Sources:

- Product brief `AI-BUDGET` (Feature Developer, 2026-10-27 23:10; spec
  writing approved by Vinh 23:01 through the Leader). Its owner decisions
  are binding here.
- Disaster-recovery tabletop 2026-10-27 §6 "DDoS và lạm dụng chi phí AI",
  priority action 5.
- Handoff ticket H-1027-FD1.

The code survey with file:line citations is in [`research.md`](research.md).
Provisional migration number: **333**, to be confirmed by the Leader
(Q5).

## Tóm tắt (tiếng Việt)

Hiện nay chi phí AI không có trần cứng chung. Một số bộ đếm còn "mở cửa" khi
database lỗi: đếm ra 0, hoặc đặt giới hạn 0 là bỏ giới hạn. Khi Anthropic báo
lỗi, hệ thống tự chuyển sang Gemini/OpenAI, nên chạm trần $200 của Anthropic
vẫn có thể tiêu tiếp ở nhà cung cấp khác. Spec này đề xuất:

- **Trần cứng trong backend.** Có trần tháng cho tổng mọi nhà cung cấp và cho
  từng nhà cung cấp. Anthropic $200/tháng. Trần ngày = trần tháng / 30 × 2.
  Mỗi lệnh gọi AI trả phí phải "giữ chỗ" ngân sách trong database trước khi
  gọi và chốt theo chi phí thật sau khi gọi. Không giữ được chỗ thì không gọi.
  Database lỗi cũng không gọi.
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
- **Cảnh báo:** email gửi anh Vinh ở 50%, 80%, 100% trần tháng và khi chạm
  trần ngày, mỗi ngưỡng đúng 1 lần mỗi kỳ.

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
  - settlement to the real usage.
- Fail-closed semantics for the budget service and for every existing quota
  or flag that gates a paid AI call.
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
- A budget-raise button for admins (Q3 default: no). Caps change only
  through Railway variables.
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
- **Owner (Vinh):** gets each threshold email once. Stops all AI with one
  Railway variable. Raises a cap only by changing a Railway variable.
- **Operator/Leader:** follows `rollout.md` and repairs with the documented
  queries.

## Requirements

- **FR-001:** Every backend code path that sends a request to a paid AI or speech provider (Anthropic, Google Gemini, OpenAI including Whisper and TTS, ElevenLabs, Azure Speech) obtains a granted budget reservation for that provider from `services/ai_budget.py` immediately before the request is sent, and every retry or fallback attempt obtains its own reservation for its own provider; every provider SDK client is constructed with its hidden retries disabled (`max_retries=0`; today only `ai_router.py:223` and `grading_providers/claude.py:71` do), so each billable request is an explicit, reserved attempt; a repository test fails CI when a provider SDK call or provider HTTP endpoint appears in `backend/` outside the budget-guarded wrapper modules, and the inventory in `research.md` §1 is the initial allow-list.
- **FR-002:** A reservation is granted only when, for each scope it touches — `total` and the call's provider — and for both the current UTC calendar month and the current UTC day, the committed amount (settled spend plus open reservations) plus the new estimate does not exceed that scope's cap; the check and the increment happen in one database transaction that locks the affected counter rows in a fixed order, so concurrent requests can never commit more than the cap in total, and a multi-call pipeline can reserve several provider lines all-or-nothing in one call; reservations are keyed by a request key per logical attempt, and replaying a request key that already has rows grants nothing and never authorises another provider request, whatever the existing reservation's status.
- **FR-003:** Caps come from Railway variables: `AI_BUDGET_MONTHLY_USD_TOTAL` (required), `AI_BUDGET_MONTHLY_USD_ANTHROPIC` (default 200), and optional `AI_BUDGET_MONTHLY_USD_<PROVIDER>` for `GOOGLE`, `OPENAI`, `ELEVENLABS` and `AZURE`; a provider without its own cap is bounded only by the total; each daily cap is its monthly cap ÷ 30 × 2; a missing, unparseable, zero or negative total cap, or an unparseable, zero or negative provider cap, puts that scope in `config_invalid`, which refuses all reservations for it and is shown on the admin panel — it never means "unlimited".
- **FR-004:** The estimate for a reservation is an upper bound computed from the `ai_pricing` catalog: input size, plus the request's `max_tokens` at the output rate, for token models; maximum audio duration for STT and pronunciation; and character count for TTS. A provider or model with no catalog price cannot be reserved and is refused. Settlement records the actual cost from the provider-reported usage. When an attempt ends without usage, the reservation is released if the request provably was not sent (connection refused before send), and settled at the estimate in every other case, including timeout and cancellation.
- **FR-005:** The budget service fails closed. If the reservation RPC errors, times out (2 s default), returns an unexpected shape, or the counter or reservation tables are missing, the call is refused and no provider request is made. A settlement failure leaves the reservation open at its estimate until the sweeper settles it. Neither path depends on `ai_usage_logs`, which stays best-effort under AI-0004 FR-002.
- **FR-006:** The existing per-user and per-IP paid-AI quotas fail closed, while their configured values are kept. These are `MAX_GRADINGS_PER_USER_PER_DAY`, `TTS_DAILY_LIMIT_PER_USER`, `TTS_IP_MAX_PER_MINUTE`, `LISTENING_GIST_DAILY_LIMIT_PER_USER` and `LISTENING_GIST_MAX_PER_MINUTE`. A count lookup error refuses the paid call with reason `budget_unavailable` instead of counting 0. A value of zero or less means `config_invalid` (refuse) instead of "no cap". Any `runtime_flags` read that gates a paid AI call treats a lookup error as disabled. `runtime_flags` behaviour for non-AI flags is unchanged.
- **FR-007:** When the Railway variable `AI_KILL_SWITCH` is `on`, `true` or `1`, or holds any value other than `off`, `false`, `0` or empty, the budget service refuses every reservation with reason `kill_switch`. It does not read the database. The variable is read from the process environment at call time, so the first request served by a process that has the value makes no provider call.
- **FR-008:** A refusal carries a reason: `monthly_cap`, `daily_cap`, `kill_switch`, `config_invalid`, `budget_unavailable` or `provider_spend_limit`. The refusal stops the whole attempt chain. `ai_router.with_fallback`, the Speaking grading orchestrator and every custom retry loop re-raise a budget refusal at once, without trying another provider, model or retry.
- **FR-009:** A provider response that reports the account's own spend or credit limit is classified as `provider_spend_limit`. This includes Anthropic HTTP 402 `billing_error`, OpenAI `insufficient_quota`, and the Gemini and ElevenLabs equivalents captured as fixtures. It is a budget refusal under FR-008, and it closes that provider's scope for the rest of the UTC day. Rate limiting (429 `rate_limit_error`), overload (529), 5xx, timeouts, network errors and invalid output stay transient and keep today's fallback behaviour within the caps.
- **FR-010:** Every synchronous paid-AI endpoint answers a budget refusal with HTTP 503 and the detail `{error_code: "ai_budget_exhausted", reason, work_saved, resource ids, message}`. This covers Speaking `POST /sessions/{id}/responses`, `POST /tts`, Listening gist attempts, question generation and the course and vocabulary AI routes in `research.md` §1. Writing submit keeps its current success response because grading runs in the background (`writing_student.py:1555`, `essay_service.py:375-430`); its refusal is reported through the essay's `grading_status` (FR-011). `message` is the Vietnamese learner text from `ui-states.md`. The detail passes the 5xx sanitizer (`services/errors.py:61-78`), so it is distinct from the 429 `rate_limit_exceeded` user quota and from provider error codes. Learners and instructors never see the internal reason; it is visible only to admins and in logs.
- **FR-011:** Learner work is saved before any AI call when Speaking or Writing grading is refused for a budget reason. For Speaking, the recording is stored and a `responses` row is persisted with `grading_status = 'awaiting_budget'` and no transcript or scores. Then exactly one deferred job is enqueued in `ai_deferred_grading_jobs` per response and submission revision, and the 503 reports `work_saved: true`. For Writing, the essay is already saved as `pending` and its `writing_jobs` row already exists, so a budget refusal in the background grader leaves the job `queued` and stamps `budget_deferred_at`. It does not increment `attempts`, does not switch to the fallback model and is not failed by the stuck-job reaper (`essay_service.py:1245-1340`). The Writing read APIs report `grading_status = 'awaiting_budget'` for that essay. This applies to every Writing grading trigger: learner submit, admin and instructor regrade, and mock-exam Writing. If a deferred Speaking recording cannot be stored, the endpoint returns 503 `{error_code: "recording_storage_unavailable", work_saved: false}`. It uses the `error_code` key so the detail survives the 5xx sanitizer; today's `code` key is replaced by `internal_error` (`research.md` §3). No row and no job are created. Writing keeps its existing submit errors.
- **FR-012:** A submission that is saved and deferred does not count against the learner's daily grading quota, nor do its later automatic grading attempts. Writing has no per-user cap today, and none is added. No `grading_attempts` row is written for it. Retrying with the same `submission_id` returns the same deferred state and creates no second job, reservation or quota row.
- **FR-013:** A sweeper runs every 5 minutes (the Railway cron minimum) and drains only when the scopes a job needs are open. It drains deferred Speaking jobs and budget-deferred Writing jobs in `enqueued_at, id` order with a lease (`FOR UPDATE SKIP LOCKED`) and at most 2 concurrent jobs. Each job reserves budget before any provider call and stops draining at the first refusal. A job is idempotent on its `(kind, resource_id, submission_revision)` key, and a superseded revision is marked `superseded` and never graded. The job persists the result through the same canonical writer as the live route, including grammar recommendations. It recomputes the session aggregate when the session was already completed, so each item is graded and charged at most once. The only exception is a crash after the provider response but before the result is persisted. That attempt is recorded and settled, and the item is retried once.
- **FR-014:** The sweeper also does the following each run. It settles reservations past `expires_at` (default 10 minutes) at their estimate. It dispatches pending alert emails with backoff. It writes a heartbeat. When the budget database is unreachable, it does nothing and exits non-zero.
- **FR-015:** For the `total` scope and every provider scope with its own cap, an alert row is created exactly once per scope, period and threshold. The alert fires the first time committed spend reaches 50%, 80% or 100% of the monthly cap, or 100% of the daily cap. Uniqueness is enforced in the database. Each new row is emailed to `OWNER_ALERT_EMAILS` (Q2). The email contains the scope, period, threshold, committed amount, cap and time, and never learner data or credentials. A failed send is retried and its state is shown on the admin panel. The Leader is notified only if Q4 chooses a channel.
- **FR-016:** The paused state is shown as follows.
  - `GET /ai/status` (any signed-in user) returns `{paid_ai_available, pending_grading_count_for_caller}`. It is false when any scope a learner AI feature needs is refused, and false on any lookup failure.
  - `GET /admin/ai/budget` (admin) returns, per scope and period: cap, settled, reserved, committed, state and reason. It also returns the kill-switch state, `config_invalid` scopes, queue depth and the oldest queued age, open and expired reservations, the last alert per threshold, the sweeper heartbeat and `lookup_failed`.
  - Admins are refused paid AI like any other caller. Non-AI admin operations are unaffected.
- **FR-017:** The learner, instructor and admin surfaces follow `ui-states.md`.
  - Speaking practice, the Speaking result and Full Test result, the Writing result and the Writing dashboard show "Đang chờ chấm" with the exact message in the brief, both immediately and after a reload.
  - The TTS, Listening gist and other learner AI controls are disabled with a short caption while `paid_ai_available` is false. The existing browser read-aloud fallback in practice remains.
  - The instructor dashboard shows the "Chấm AI tạm dừng" banner.
  - The `/admin` overview shows the budget panel, and a lookup failure renders as `⚠ lookup failed`, never as zero.
  - Each surface has loading, error/retry, keyboard, responsive and both-theme states.
- **FR-018:** Migration 333 is additive and staged first. It creates the counter, reservation, deferred-job and alert tables and the reserve, settle, release, expire and recompute functions. It enables RLS, grants nothing to `anon` or `authenticated`, and grants `EXECUTE` and table privileges to `service_role` only. It is idempotent and has read-only postconditions. The code deployed before it keeps working (N-1). Code that needs it refuses paid AI with `budget_unavailable` instead of failing open when the objects are absent.
- **FR-019:** Outside the app, before production enforcement, Vinh records the following. The Anthropic Console monthly spend limit is $200 on the workspace that holds the production key. Each other provider has a provider-side cap or billing alert set, or an explicit waiver. The evidence is a screenshot or console readback that shows no key value.
- **FR-020:** Learner AI features that do not queue are refused before any learner allowance is used, and the learner's input stays in the page. These are Speaking question generation (`POST /sessions/{id}/questions/generate`, `/sessions/cuecard/generate`), course Writing (`POST /api/quiz/course/writing`), course pronunciation, Advanced Vocabulary controlled rewrite, Listening gist and TTS. They use no attempt, quota row or session-cap slot, and return the FR-010 503. Background generation started by a learner action (D1 question generation after a vocabulary confirm) is skipped and logged when refused. It is not retried until a later confirm.

## Acceptance scenarios

All scenarios run against fake or offline providers (a recording stub that
counts calls). No real traffic is needed.

### AC1 — Cap reached: no provider is called, fallback included

- **Given** committed spend on the Anthropic monthly scope equals its cap,
  and Google and the total scope have room
- **When** a learner submits Speaking
- **Then** zero calls reach any stub (Anthropic, Gemini, Whisper, Azure).
  The response is 503 `ai_budget_exhausted` with `work_saved: true`. One
  deferred job exists.

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
  the sweeper drain the queue.
- **Queued work, then the learner records again.** The new submission
  revision supersedes the queued job (FR-013), and only the newest take is
  graded. This matches the existing revision rule in `routers/grading.py`.
- **Queued work and session completion.** `PATCH /sessions/{id}/complete`
  still completes the session. The aggregate covers graded responses, the
  result page lists pending ones, and the deferred job recomputes the
  aggregate (`routers/sessions.py:2094-2105` already recomputes when
  `overall_band` is null). Full Test finalization treats a pending part as
  pending, not as zero.
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

- In offline tests AC1–AC9 all pass. Provider stubs record zero calls in
  every refusal scenario.
- On staging, with a low cap, the brief's message is shown for Speaking and
  Writing and survives a reload. The queue drains with zero double grades
  (`plan.md` V5), and each alert arrives exactly once.
- Over the 7-day production observation, app-committed spend is within 10%
  of each provider console per day. No day exceeds the daily cap by more
  than one in-flight estimate.
- No 5xx from a non-AI route is attributable to the budget service.

## Open questions

Each question has a recommended default. Approval records the answers in
`approval-decision.md`.

- **Q1: Caps for providers other than Anthropic.**
  - *Default:* total cap for all providers **$250/month** (daily $16.67).
    Anthropic is **$200** (decided; daily $13.33).
  - Google, OpenAI, ElevenLabs and Azure each get a cap of last full
    month's ledger spend + 20%, rounded up to the next $5. An operator
    computes this read-only from `ai_usage_logs` (`plan.md` V1) and Vinh
    enters it.
  - Until each value is filled in, that provider is bounded by the total
    only.
  - Vinh also confirms the Azure Speech price tier, so a catalog row can be
    added. Without it, pronunciation scoring is refused under FR-004.
- **Q2: Alert recipient.** *Default:* the owner email only, through
  `OWNER_ALERT_EMAILS` (the same variable as ADMINAAL2-0032). It contains
  only the owner's address and is set as a Railway variable, not in the
  repository.
- **Q3: Temporary budget-raise button for admins.** *Default:* **no**. A cap
  changes only through a Railway variable and a restart. This keeps a
  compromised admin account from raising spend, consistent with
  ADMINAAL2-0032.
- **Q4: Leader notification and sweeper-down alert.** *Default:* none
  beyond email. A sweeper heartbeat older than 15 minutes is shown on the
  admin panel but not emailed. Add a channel only if one is named.
- **Q5: Migration number.** *Default:* **333**, since 327–330 are reserved,
  331 is GIVEARCHIVE-0031 and 332 is ADMINAAL2-0032 (provisional). The
  Leader confirms before T002.
- **Q6: Production shadow window.** *Default:* none. Shadow mode
  (`AI_BUDGET_MODE=shadow`, reserve and log without refusing) is used only
  on staging to calibrate estimates. Production starts in `enforce`.
- **Q7: Operator scripts.** *Default:* every `backend/scripts/*` entry
  point that uses the production provider keys goes through the budget
  service and counts against the same caps. A script that needs a separate
  budget uses a separate key and is out of scope.
- **Q8: Sweeper deployment.** *Default:* if ADMINAAL2-0032's Railway cron
  service has landed, add this sweeper as a step of it. Otherwise, add a
  5-minute Railway cron service `python -m scripts.ai_budget_sweep` from
  the backend image. Approving this spec approves that service.
- **Q9: Queue more than Speaking and Writing?** *Default:* no. Course
  Writing, course pronunciation, Advanced Vocabulary rewrite and Listening
  gist are refused before they are accepted (FR-020). The learner's input
  stays in the page and no attempt is used. Queuing them would need a
  deferred contract for each flow. That can be a later spec if pauses turn
  out to be frequent.
