---
id: AIBUDGET-0033
title: Paid AI stops at hard budgets, Claude alerts on a soft budget, and learner work waits safely for grading
status: approved
risk: critical
owner: product
---

# Paid AI stops at hard budgets, Claude alerts on a soft budget, and learner work waits safely for grading

Status: **approved by Vinh** on 2026-10-28 (09:11, decisions updated 09:13,
UTC+7), relayed by the Leader. Vinh approved further decisions (a)–(f) in
chat at **09:35** the same day (UTC+7), and answered Q10, Q11 and the Azure
price tier under Q1 at **16:26** (UTC+7). The decisions are in
[`approval-decision.md`](approval-decision.md) and
[Owner decisions](#owner-decisions). Together they change the draft as
follows:

- Anthropic has a **soft** $100 budget that only alerts (FR-021).
- Gemini, Azure, OpenAI and ElevenLabs have **hard** $20 monthly caps.
- The `total` is a **$200 threshold that alerts only** (FR-002, FR-003).
- Missing budget variables fall back to the spec defaults and never block
  all AI (FR-003).
- When the Azure cap is reached, Speaking is graded **without the
  pronunciation score** instead of being deferred. The overall band is then
  the mean of FC, LR and GRA, and pronunciation is not re-graded
  automatically (FR-023, Q10 and Q11 of 16:26).
- Azure Speech is priced at the **S0** (standard, paid) tier (Q1, 16:26).
- A temporary budget-raise button that requires AAL2 is in phase 1
  (FR-022).
- Alert email is sent through Resend from `alerts@averlearning.com`
  (FR-015).

Sources:

- Product brief `AI-BUDGET` (Feature Developer, 2026-10-27 23:10; spec
  writing approved by Vinh 23:01 through the Leader). Its owner decisions
  are binding here.
- Disaster-recovery tabletop 2026-10-27 §6 "DDoS và lạm dụng chi phí AI",
  priority action 5.
- Handoff ticket H-1027-FD1.

The code survey with file:line citations is in [`research.md`](research.md).
Migration number **333** is confirmed for AI-BUDGET lot 02. The source is
the instruction that relayed the 09:35 decisions.

## Tóm tắt (tiếng Việt)

Hiện nay chi phí AI không có trần cứng chung. Một số bộ đếm còn "mở cửa" khi
database lỗi: đếm ra 0, hoặc đặt giới hạn 0 là bỏ giới hạn. Khi Anthropic báo
lỗi, hệ thống tự chuyển sang Gemini/OpenAI, nên chạm trần $200 của Anthropic
vẫn có thể tiêu tiếp ở nhà cung cấp khác. Spec này (anh Vinh đã duyệt
28/10/2026 lúc 09:11/09:13, bổ sung quyết định (a)–(f) lúc 09:35, chốt Q10,
Q11 và gói giá Azure lúc 16:26) quy định:

- **Claude/Anthropic: ngân sách mềm $100/tháng.** Chỉ gửi email cảnh báo ở
  80% ($80) và 100%; **không bao giờ chặn** Claude vì ngân sách, kể cả khi
  database ngân sách lỗi. Claude chỉ dừng khi bật nút dừng khẩn cấp hoặc khi
  chính Anthropic từ chối vì hết hạn mức $200 trên Console (chốt chặn cuối).
- **Gemini, Azure, OpenAI, ElevenLabs: mỗi bên trần cứng $20/tháng.** Hết
  trần thì không gọi. Trần ngày = trần tháng / 30 × 2 (khoảng $1,33/ngày),
  giữ để chống vòng lặp chạy mất kiểm soát.
- **Tổng $200/tháng (mọi nhà cung cấp, kể cả Anthropic): chỉ cảnh báo,
  không bao giờ chặn.**
- **Thiếu biến cấu hình không bao giờ chặn toàn bộ AI:** biến chưa đặt thì
  dùng giá trị mặc định của spec.
- Mỗi lệnh gọi AI trả phí phải "giữ chỗ" ngân sách trong database trước khi
  gọi và chốt theo chi phí thật sau khi gọi. Với trần cứng: không giữ được
  chỗ thì không gọi, database lỗi cũng không gọi.
- **Hết trần Azure:** bài Speaking vẫn được chấm ngay, chỉ thiếu điểm Phát
  âm, kèm một ghi chú ngắn bằng tiếng Việt. Không hoãn chấm. Điểm tổng là
  trung bình của FC, LR và GRA, ghi "Điểm tổng tính trên 3 tiêu chí" (Q10).
  Giai đoạn 1 không tự động chấm bù Phát âm; riêng Full Test, lần gọi chấm
  phát âm sẵn có của trang kết quả vẫn có thể bổ sung P sau (Q11).
- **Azure Speech dùng gói S0** (trả phí, tiêu chuẩn). Ước tính chi phí và
  mức giữ chỗ cho Azure tính theo giá S0.
- **Nút tăng ngân sách tạm thời** trên trang admin: chỉ admin, **bắt buộc
  xác thực 2 bước (AAL2)**, mỗi lần tăng tối đa 100% trần gốc, kéo dài tối
  đa 24 giờ, tối đa 3 lần mỗi tháng cho mỗi trần. Mỗi lần dùng được ghi
  nhật ký và gửi email cho anh Vinh. Hết giờ tự trở về trần gốc.
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
- **Cảnh báo:** email gửi từ `alerts@averlearning.com` qua Resend (sau khi
  DNS của tên miền được xác minh; không dùng Gmail SMTP) tới anh Vinh
  (`andyvinhtran1212@gmail.com`, một biến cấu hình duy nhất
  `OWNER_ALERT_EMAILS`) ở 50%, 80%, 100% trần tháng (Anthropic: 80% và
  100%) và khi chạm trần ngày, mỗi ngưỡng đúng 1 lần mỗi kỳ, và mỗi lần tăng
  ngân sách tạm thời được cấp, kết thúc sớm hoặc hết hạn.

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
  - an atomic DB reservation against the per-provider caps, monthly and
    daily, recorded on the `total` as well;
  - settlement to the real usage;
  - per-scope enforcement mode: `anthropic` (FR-021) and `total` (FR-002)
    are soft scopes that only alert; every other provider scope is hard.
- Fail-closed semantics for the budget service's hard scopes and for every
  existing quota or flag that gates a paid AI call. The soft scopes only
  alert.
- Speaking graded without the pronunciation score when only the Azure line
  is refused (FR-023).
- A generation fence on every writer of a Speaking session's bands (FR-024).
- No cross-provider fallback when the refusal reason is budget, kill switch
  or a provider-reported spend limit. Transient provider errors keep
  today's fallback inside the caps.
- Speaking and Writing submissions made while paused: the work is saved,
  shown as pending, not charged to learner quota, and graded exactly once
  in order after reopening.
- Learner, instructor and admin UI states for the paused condition, and an
  admin budget panel that is read-only except for the temporary raise
  (FR-022).
- Owner email alerts at the FR-015 thresholds of each monthly cap and when
  a daily cap is reached, once per threshold per period.
- A temporary, bounded, audited and emailed budget raise for hard scopes,
  used by an AAL2 admin from the admin panel, that expires back to the base
  cap on its own (FR-022).
- One additive migration (333), a sweeper job, and a rollout and rollback
  plan.

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
  (FR-022). Raising a soft scope (`anthropic`, `total`) is not offered,
  because a soft scope never refuses.
- Model choice and provider order. AIOPS-0024 (draft, #1716) owns them; this
  spec adds no routing control.
- Moving the TTS and gist per-IP and per-minute windows out of process
  memory. The shared money budget bounds their cost; distributed burst
  limiting is origin protection (above).
- Emailing learners or instructors about the pause (brief decision).

## Users and journeys

- **Learner (Speaking/Writing):** submits work during a pause and sees it
  saved as "Đang chờ chấm". Later sees the grade without resubmitting.
  Never loses a recording or essay and never loses daily quota. When only
  the Azure cap is reached, the learner gets the grade at once, without the
  pronunciation score and with a short note (FR-023).
- **Learner (Listening/TTS/other AI helpers):** sees the AI control
  disabled with a short caption. Non-AI exercises still work.
- **Instructor:** sees "Chấm AI tạm dừng" on the dashboard, so ungraded
  work is not mistaken for missing work. Sees a "Chưa có Phát âm" label on
  a Speaking band computed without the pronunciation score (FR-023).
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
- **FR-002:** Every line is recorded on its provider's scope and on `total`. A reservation is granted only when, for each hard scope it touches (the call's provider when that provider's scope is hard) and for both the current UTC calendar month and the current UTC day, the committed amount (settled spend plus open reservations) plus the new estimate does not exceed that scope's effective cap (its base cap plus any active raise, FR-022); the soft scopes — `anthropic` (FR-021) and `total` (owner decision (b), 2026-10-28 09:35: a threshold that alerts only and never blocks) — are recorded in the same transaction without a cap check, so `total` counts every provider's spend, Anthropic included; the check and the increment happen in one database transaction that locks the affected counter rows in a fixed order, so concurrent requests can never commit more than the cap in total, and a multi-call pipeline can reserve several provider lines all-or-nothing in one call; reservations are keyed by a request key per logical attempt, and replaying a request key that already has rows grants nothing and never authorises another provider request, whatever the existing reservation's status.
- **FR-003:** Base caps come from Railway variables, and every one has a default fixed by this spec (owner decision (b), 2026-10-28 09:35):
  - `AI_BUDGET_MONTHLY_USD_TOTAL`: default 200, soft (alerts only).
  - `AI_BUDGET_MONTHLY_USD_ANTHROPIC`: default 100, soft (FR-021).
  - `AI_BUDGET_MONTHLY_USD_GOOGLE`: default 20, hard.
  - `AI_BUDGET_MONTHLY_USD_AZURE`: default 20, hard.
  - `AI_BUDGET_MONTHLY_USD_OPENAI`: default 20, hard.
  - `AI_BUDGET_MONTHLY_USD_ELEVENLABS`: default 20, hard.

  Each daily cap is its monthly cap ÷ 30 × 2. For the $20 caps this is the $1.33 a day that decision (d) keeps as protection against runaway loops. The enforcement mode of each scope is fixed by this spec (`anthropic` and `total` soft, every other scope hard). It is not a variable. **A missing configuration never blocks AI:** an unset or empty variable uses its default above. It never leads to `config_invalid`. A variable that is set but unparseable, zero or negative is a configuration error:
  - for a hard scope, that scope alone is `config_invalid`. Its reservations are refused, the admin panel names the variable, and it never means "unlimited". Other providers are unaffected;
  - for a soft scope, the panel shows `config_invalid` and that scope's threshold alerts are suspended. Nothing is refused (FR-021).
- **FR-004:** The estimate for a reservation is an upper bound computed from the `ai_pricing` catalog: input size, plus the request's `max_tokens` at the output rate, for token models; the duration of the audio actually sent, for STT and pronunciation; and character count for TTS. A provider or model with no catalog price cannot be reserved and is refused. Settlement records the actual cost from the provider-reported usage. When an attempt ends without usage, the reservation is released if the request provably was not sent (connection refused before send), and settled at the estimate in every other case, including timeout and cancellation.
  - **Audio duration (Codex round 9 on #1773).** The duration is known before the reservation and before any provider receives the audio. It is either measured locally by decoding the bytes that will be sent, from packet timestamps rather than the container header (a browser MediaRecorder WebM carries no header duration), or read from a stored duration that a provider already measured for those same bytes (the `/pronunciation/full` samples). The estimate is that duration rounded up to the whole second, plus 1 s. A fixed maximum is no longer the estimate, so the estimate/actual ratio of a short recording stays close to 1 (`rollout.md` S2).
  - **Maximum before send.** A route with a maximum duration enforces it on this measurement before it reserves. Speaking rejects a recording above `MAX_AUDIO_DURATION_SECONDS` with today's 422 "Audio quá dài" message before Whisper. No provider is called, nothing is reserved, no attempt is recorded, and the recording is not stored. Today Whisper receives the whole file first, so a recording longer than 300 s but under the 50 MB limit is billed before it is rejected. The existing check after Whisper stays as a second guard.
  - **Duration not measurable.** When the duration cannot be measured (the decoder is missing or fails), the audio line has no upper bound, so the request is refused before any provider call, as for an unpriced model. Speaking returns 422 "Không đọc được bản ghi âm nên bài chưa được chấm và không bị trừ lượt. Vui lòng ghi âm lại." (copy approved by Vinh at 22:34 on 2026-10-28, UTC+7) with nothing reserved and nothing stored. No `grading_attempts` row is recorded, so no daily grading quota is used. In `shadow` mode this is logged as `would_refuse` and the call proceeds, estimated at the route maximum. The decoder (`ffprobe`) is a rollout precondition on staging and production (`rollout.md`), so this case is limited to undecodable files.
  - **Settlement** of an audio line uses the provider-reported duration, or the duration sent when the provider reports none.
  - **Image input (Codex round 10 on #1773).** A token-model request that sends images (the Task 1 chart in Writing grading, on every attempt including repair retries; `ai_router` calls with `images=`; the admin prompt-image analysis) adds an image-token bound for each image to its input size. The bound comes from the image's decoded pixel dimensions and the provider's documented image-token rule (Anthropic counts pixels after its own downscale; Gemini counts fixed-size tiles), recorded with its source date next to the model's price row in `ai_pricing` (T001). When the dimensions cannot be read, the image has no bound and the request is refused before any provider call, as for an unpriced model.
- **FR-005:** The budget service fails closed for hard scopes; soft-scope lines follow FR-021. If the reservation RPC errors, times out (2 s default), returns an unexpected shape, or the counter or reservation tables are missing, the call is refused and no provider request is made. A settlement failure leaves the reservation open at its estimate until the sweeper settles it. Neither path depends on `ai_usage_logs`, which stays best-effort under AI-0004 FR-002.
- **FR-006:** The existing per-user and per-IP paid-AI quotas fail closed, while their configured values are kept. These are `MAX_GRADINGS_PER_USER_PER_DAY`, `TTS_DAILY_LIMIT_PER_USER`, `TTS_IP_MAX_PER_MINUTE`, `LISTENING_GIST_DAILY_LIMIT_PER_USER` and `LISTENING_GIST_MAX_PER_MINUTE`. A count lookup error refuses the paid call with reason `budget_unavailable` instead of counting 0. A value of zero or less means `config_invalid` (refuse) instead of "no cap". Any `runtime_flags` read that gates a paid AI call treats a lookup error as disabled. `runtime_flags` behaviour for non-AI flags is unchanged.
- **FR-007:** When the Railway variable `AI_KILL_SWITCH` is `on`, `true` or `1`, or holds any value other than `off`, `false`, `0` or empty, the budget service refuses every reservation with reason `kill_switch`, soft-scope (Anthropic) lines included. It does not read the database. The variable is read from the process environment at call time, so the first request served by a process that has the value makes no provider call.
- **FR-008:** A refusal carries a reason: `monthly_cap`, `daily_cap`, `kill_switch`, `config_invalid`, `budget_unavailable` or `provider_spend_limit`. The refusal stops the whole attempt chain. `ai_router.with_fallback`, the Speaking grading orchestrator and every custom retry loop re-raise a budget refusal at once, without trying another provider, model or retry.
- **FR-009:** A provider response that reports the account's own spend or credit limit is classified as `provider_spend_limit`. This includes Anthropic HTTP 402 `billing_error`, OpenAI `insufficient_quota`, and the Gemini and ElevenLabs equivalents captured as fixtures. It is a budget refusal under FR-008, and it closes that provider's scope for the rest of the UTC day. Rate limiting (429 `rate_limit_error`), overload (529), 5xx, timeouts, network errors and invalid output stay transient and keep today's fallback behaviour within the caps.
- **FR-010:** Every synchronous paid-AI endpoint answers a budget refusal with HTTP 503 and the detail `{error_code: "ai_budget_exhausted", reason, work_saved, resource ids, message}`. This covers Speaking `POST /sessions/{id}/responses`, `POST /tts`, Listening gist attempts, question generation and the course and vocabulary AI routes in `research.md` §1. Writing submit keeps its current success response because grading runs in the background (`writing_student.py:1555`, `essay_service.py:375-430`); its refusal is reported through the essay's `grading_status` (FR-011). `message` is the Vietnamese learner text from `ui-states.md`. The detail passes the 5xx sanitizer (`services/errors.py:61-78`), so it is distinct from the 429 `rate_limit_exceeded` user quota and from provider error codes. Learners and instructors never see the internal reason; it is visible only to admins and in logs.
- **FR-011:** Learner work is saved before any AI call when Speaking or Writing grading is refused for a budget reason. For Speaking, the recording is stored and a `responses` row is persisted with `grading_status = 'awaiting_budget'` and no transcript or scores. Exactly one deferred job is enqueued in `ai_deferred_grading_jobs` per response and submission revision, in the same transaction as the row, so no `awaiting_budget` row exists without its job. The 503 reports `work_saved: true`. For Writing, the essay is already saved as `pending` and its `writing_jobs` row already exists, so a budget refusal in the background grader leaves the job `queued` and stamps `budget_deferred_at`. It does not increment `attempts`, does not switch to the fallback model and is not failed by the stuck-job reaper (`essay_service.py:1245-1340`). The Writing read APIs report `grading_status = 'awaiting_budget'` for that essay. This applies to every Writing grading trigger: learner submit, admin and instructor regrade, and mock-exam Writing. If a deferred Speaking recording cannot be stored, the endpoint returns 503 `{error_code: "recording_storage_unavailable", work_saved: false}`. It uses the `error_code` key so the detail survives the 5xx sanitizer; today's `code` key is replaced by `internal_error` (`research.md` §3). No row and no job are created. Writing keeps its existing submit errors.
- **FR-012:** A submission that is saved and deferred does not count against the learner's daily grading quota, nor do its later automatic grading attempts. Writing has no per-user cap today, and none is added. No `grading_attempts` row is written for it. This holds when the refusal comes after the first bundle was granted (for example, the fallback rung's reservation is refused, or a provider spend-limit response arrives mid-pipeline): such a refusal takes the same save-and-enqueue path as FR-011, and it deletes the `grading_attempts` row that request recorded. The row id is kept on the deferred job, so the sweeper retries the delete if it fails. Any transcript already paid for is stored on the response, so the drain does not pay for Whisper again. Retrying with the same `submission_id` returns the same deferred state and creates no second job, reservation or quota row.
- **FR-013:** A sweeper runs every 5 minutes (the Railway cron minimum) and drains only when the scopes a job needs are open. It drains deferred Speaking jobs and budget-deferred Writing jobs in `enqueued_at, id` order with a lease (`FOR UPDATE SKIP LOCKED`) and at most 2 concurrent jobs. Each job reserves budget before any provider call and stops draining at the first refusal. A job is idempotent on its `(kind, resource_id, submission_revision)` key, and a superseded revision is marked `superseded` and never graded. The job commits its result through the same canonical mapping as the live route, including grammar recommendations, in one database transaction. That transaction also sets the job's persistence marker and completion, and it refuses a second commit for the same revision. A crash before the commit leaves the job reclaimable when its lease expires, so it is never left marked but ungraded. Every commit, whatever the session's status, advances a durable, session-scoped refresh generation in the same transaction. Every writer of a session's band (FR-024), including the sweeper refresh and `PATCH /sessions/{id}/complete`, saves through the same generation check: the band is written and the obligation acknowledged only if no response of that session has changed since the writer read its responses (a drain commit, an admin regrade or any other response write), and otherwise the writer recomputes. So neither a crash after the commit, two overlapping refreshes, a completion racing a commit, nor an admin regrade racing a refresh can leave an outdated band shown. A session linked to a class assignment item also keeps a durable class-score sync obligation until `class_assignment_items.score` reflects the written band, so a crash between the band write and that sync is repaired by the next sweep. Budget-deferred Writing jobs use their own drain lease and persistence marker on `writing_jobs`. They never use the Writing retry allowance (`attempt_count`), and a stale drain cannot commit after its job has been reclaimed. Each item is graded and charged at most once. The only exception is a crash after the provider response but before the result is persisted. That attempt is recorded and settled, and the item is retried once.
- **FR-014:** The sweeper also does the following each run. It settles reservations past `expires_at` (default 10 minutes) at their estimate. It dispatches pending alert emails with backoff. It writes a heartbeat. When the budget database is unreachable, it does nothing and exits non-zero.
- **FR-015:** For the `total` scope and every provider scope with its own cap, an alert row is created exactly once per scope, period and threshold. The alert fires the first time committed spend reaches a monthly threshold of the scope, or 100% of the daily cap. The monthly thresholds are 50%, 80% and 100%, except for `anthropic`, which alerts at 80% ($80 by default) and 100% only (owner decision (f), 2026-10-28 09:35). The 100% alert for a scope and period also fires on the first reservation refused for `monthly_cap` or `daily_cap` in that scope, even when committed spend is below the cap because the next estimate does not fit. It also fires when FR-009 closes a provider's daily scope. Repeated refusals add nothing. Uniqueness is enforced in the database. This applies to the soft scopes (`anthropic`, `total`) too, except that they have no refusal trigger. Each new row is emailed through Resend from `alerts@averlearning.com` to `OWNER_ALERT_EMAILS` (owner decision (a), 2026-10-28 09:35; the recipient is the single configured value `andyvinhtran1212@gmail.com`, the same variable as ADMINAAL2-0032). Sending works only once the `averlearning.com` domain's DNS is verified in Resend. Until then, sends fail and are retried with backoff. The rows are never marked `sent`, and the admin panel shows their send state. Gmail SMTP is never used, and no other sender is substituted. The email contains the scope, period, threshold, committed amount, cap and time, and never learner data or credentials. A failed send is retried and its state is shown on the admin panel. The Leader is notified only if Q4 chooses a channel.
- **FR-016:** The paused state is shown as follows.
  - `GET /ai/status` (any signed-in user) returns `{paid_ai_available, pending_grading_count_for_caller}`. It is false when any scope a learner AI feature needs is refused, and false on any lookup failure. A refused `azure` scope alone does not make it false, because Speaking still grades without the pronunciation score (FR-023). The Azure-only features (course pronunciation and the Full Test pronunciation summary) show P2 when their own request is refused.
  - `GET /admin/ai/budget` (admin) returns, per scope and period: mode (`hard` or `soft`), base cap, active raise, effective cap, settled, reserved, committed, state and reason, and the raises used this month per scope. It also returns the kill-switch state, `config_invalid` scopes, queue depth and the oldest queued age, open and expired reservations, the last alert per threshold, the sweeper heartbeat and `lookup_failed`.
  - Admins are refused paid AI like any other caller. Non-AI admin operations are unaffected.
- **FR-017:** The learner, instructor and admin surfaces follow `ui-states.md`.
  - Speaking practice, the Speaking result and Full Test result, the Writing result and the Writing dashboard show "Đang chờ chấm" with the exact message in the brief, both immediately and after a reload.
  - The TTS, Listening gist and other learner AI controls are disabled with a short caption while `paid_ai_available` is false. The existing browser read-aloud fallback in practice remains.
  - The instructor dashboard shows the "Chấm AI tạm dừng" banner.
  - The `/admin` overview shows the budget panel, and a lookup failure renders as `⚠ lookup failed`, never as zero.
  - Each surface has loading, error/retry, keyboard, responsive and both-theme states.
- **FR-018:** Migration 333 is additive and staged first. It creates the counter, reservation, deferred-job, session-refresh, alert and budget-raise tables, the reserve, settle, release, expire, recompute, deferred save, session-band write, class-score sync and raise grant/end/expiry functions, and the `responses` generation trigger (FR-024). It enables RLS, grants nothing to `anon` or `authenticated`, and grants `EXECUTE` and table privileges to `service_role` only. It is idempotent and has read-only postconditions. The code deployed before it keeps working (N-1). Code that needs it refuses paid AI with `budget_unavailable` instead of failing open when the objects are absent.
- **FR-019:** Outside the app, before production enforcement, Vinh records the following. The Anthropic Console monthly spend limit is $200 on the workspace that holds the production key; it is Anthropic's only hard stop and stays as the last backstop (owner decision (f), 2026-10-28 09:35), because the app budget for Anthropic is soft (FR-021). Each other provider has a provider-side cap or billing alert set, or an explicit waiver. The evidence is a screenshot or console readback that shows no key value.
- **FR-020:** Learner AI features that do not queue are refused before any learner allowance is used, and the learner's input stays in the page. These are Speaking question generation (`POST /sessions/{id}/questions/generate`, `/sessions/cuecard/generate`), course Writing (`POST /api/quiz/course/writing`), course pronunciation, Advanced Vocabulary controlled rewrite, Listening gist and TTS. They use no attempt, quota row or session-cap slot, and return the FR-010 503. Background generation started by a learner action (D1 question generation after a vocabulary confirm) is skipped and logged when refused. It is not retried until a later confirm.
- **FR-021:** The `anthropic` scope is a soft budget (owner decision 09:11/09:13, confirmed by decision (f) at 09:35 on 2026-10-28): $100 a month by default, daily $100 ÷ 30 × 2. Every Anthropic line is still reserved and settled through FR-001/FR-002, so its committed spend, the admin panel and the FR-015 alerts stay canonical. Those alerts fire at 80% ($80) and 100% of the monthly budget and at 100% of the daily budget. A budget reason never refuses it: not `monthly_cap`, not `daily_cap`, not `config_invalid`, and not `budget_unavailable`. The soft `total` scope behaves the same way for every provider's line. When the reservation RPC fails for a request whose only provider line is Anthropic (its `total` line is soft too), the call proceeds unreserved, and one `[ai_budget] decision=allow_unrecorded scope=anthropic` warning is logged per call, so the gap is visible. The soft scope does **not** exempt: the kill switch (FR-007); a provider spend-limit response from Anthropic itself (FR-009, the Console hard stop); the per-user quotas (FR-006); or the hard lines of a multi-provider bundle. A Speaking bundle whose Whisper (OpenAI) line is refused, or a Gemini fallback rung whose line is refused, is still refused as a whole, with no provider call (FR-002).
- **FR-022:** An admin can add a temporary raise to one hard scope from the admin budget panel at `/admin` (owner decision 09:11/09:13, phase 1; bounds and AAL2 set by decision (e) at 09:35 on 2026-10-28). The routes are `POST /admin/ai/budget/raises` and `POST /admin/ai/budget/raises/{id}/end`.
  - **Who:** an active admin (`require_admin`) whose token is **`aal2`**, as the Security Auditor asked. This is required unconditionally. It does not wait for `ADMIN_AAL2_ENFORCE` and is not report-only. Any other `aal` gets 403 `mfa_required` and nothing is written. Until ADMINAAL2-0032's AAL2 reader exists, the routes refuse every caller with 403 `mfa_required` and never fall back to AAL1. Instructors, learners and service tokens are refused. The read-only panel (`GET /admin/ai/budget`) keeps the admin guard, plus AAL2 when ADMINAAL2-0032 enforces it.
  - **Amount and duration:** whole US dollars, from 1 to 100% of the scope's base monthly cap. A raise can at most double the base cap, for example up to $20 for a $20 scope. While active, the amount is added to both the monthly and the daily effective cap of that scope. Duration is 1–24 whole hours (24 by default). A required reason of 1–500 characters is recorded.
  - **Limits:** only hard scopes with a valid base cap can be raised: `google`, `azure`, `openai` and `elevenlabs`. The soft scopes (`anthropic`, `total`) and any `config_invalid` scope are refused. At most one active raise per scope (409 `raise_active`; end it first) and at most 3 raises per scope per UTC calendar month (409 `raise_limit_reached`). A raise never changes the Railway base cap.
  - **Audit:** each grant, early end and expiry writes one append-only event with the raise id, scope, amount, base cap, effective cap, `expires_at`, actor user id, actor `aal`, request id and reason. Events are never updated or deleted; `service_role` cannot `UPDATE` or `DELETE` them.
  - **Email:** the grant, early end and expiry each create exactly one owner alert row in the same transaction as the event. The row is emailed to `OWNER_ALERT_EMAILS` with the scope, amount, base and effective cap, expiry, actor email and reason. A grant whose alert row cannot be written is not granted.
  - **Auto-expiry:** the reserve function counts a raise only while `now() < expires_at` and it has not been ended, so the cap returns to the base value at `expires_at` without any sweeper run. Spend committed during the raise stays committed; if it is above the base cap, the scope refuses again at once. The sweeper records the expiry event and email within one run after `expires_at`.
  - **Failure:** a raise or end RPC error, timeout or unexpected shape returns 503 and changes nothing; it never reports a raise as granted. After any mutation the panel refetches `GET /admin/ai/budget` instead of updating local state.
- **FR-023:** When only the Azure line is refused, Speaking grading continues without the pronunciation score. It is not deferred (owner decision (c), 2026-10-28 09:35; the band, label and re-grade rules come from the Feature Developer addendum approved through (c), and Vinh chose them as Q10 = A and Q11 = A at 16:26).
  - **Pricing:** the Azure line is priced at the Azure Speech **S0** tier (standard, paid; Q1, 16:26). T001 adds an effective-dated `ai_pricing` row with the S0 per-audio-hour rate for real-time speech to text plus the Pronunciation Assessment add-on, billed per second of audio sent. The estimate is taken at the duration of the audio sent to Azure (FR-004): the Part 2 segment when it is extracted, otherwise the whole recording, whose Whisper-reported duration is known by then. Settlement uses the same duration (`research.md` §7). Once that row exists, a missing price row is only a defensive refusal case, not the expected state.
  - **Reservation:** Azure pronunciation is not part of the all-or-nothing Speaking bundle. It is reserved as its own request (the `azure` line plus its `total` line) after the bundle is granted, and on the deferred drain in the same way. A refusal of that request skips the Azure call. The refusal can be for any FR-008 reason. That includes `monthly_cap`, `daily_cap`, `config_invalid`, `budget_unavailable`, a missing price row (FR-004), a kill switch turned on after the bundle was granted, and `provider_spend_limit` (also a spend-limit response from Azure after the reservation). The rest of the grade goes ahead with no 503, no deferral and no extra quota use. A kill switch that is on at submission refuses the whole bundle first, so the submission is deferred under FR-011 as before.
  - **Persisted marker:** the response stores `pronunciation_status = 'skipped_budget'`, the feedback stores `pronunciation_source = 'budget_skipped'`, and `band_p` is null. No Azure scores are stored. The marker is the canonical source for every label below. No surface infers it from a null `band_p`, because older rows and the existing `unavailable` and `error` sources also have a null `band_p`.
  - **Band (decided, Q10 = A, 16:26):** the overall band is the mean of FC, LR and GRA, labelled "Điểm tổng tính trên 3 tiêu chí". The grade uses the rule today's code already applies when Azure is unavailable (`_merge_pronunciation_into_grading`, `routers/grading.py`). This spec does not add a new formula.
    - In test mode and Full Test, the response's `overall_band` is the mean of the criteria that have a value (FC, LR and GRA), rounded with `ielts_round`. The three remaining criteria keep equal weight, and pronunciation's quarter weight is not reassigned to any single criterion.
    - The session aggregate (`_compute_session_bands`) averages each criterion over the responses that have it. So `sessions.band_p` is the mean of the P values present, or null when no response has one. `sessions.overall_band` is the mean of the session criteria that are not null.
    - In practice mode there is no P criterion in the band today, so the band is unchanged. Only the pronunciation card is missing.
    - The off-topic and reliability caps apply afterwards, as today.
  - **Not chosen (Q10 alternative B):** withholding the overall band ("chưa đủ 4 tiêu chí") is out of scope. The band is always computed as above.
  - **Labels:** the learner sees note P5 (test mode and Full Test) or P5b (practice) from `ui-states.md`. That note is placed in the P criterion card (`p_feedback`) and next to the overall band, and it says the band was computed on three criteria. In test mode and Full Test, the overall band also carries the label "Điểm tổng tính trên 3 tiêu chí" (Q10 = A). The result and Full Test result read models carry an additive `pronunciation_skipped: true` on the response and `pronunciation_incomplete: true` on the session when any test-mode response is skipped. Teacher views (the instructor dashboard matrix cell for that assignment, and the admin Speaking session view) show the band with the label "Chưa có Phát âm" and the tooltip "Điểm tổng tính trên 3 tiêu chí". The admin view also shows the reason, "Bỏ qua phát âm: hết ngân sách Azure". Learners and instructors never see the budget reason (FR-010).
  - **Re-grading later (decided, Q11 = A, 16:26):** phase 1 has no automatic pronunciation re-grade. The pronunciation score is not filled in automatically when Azure reopens, and P5 promises nothing. Only the two existing paths below can touch P later. For a Full Test, the result page's existing `POST /sessions/{id}/pronunciation/full` call can add P on a later view, once its own Azure reservation is granted. Today that route writes `final_band_p` only when the response's feedback already has a `band_p`, and it adjusts that model band (`_compute_adjusted_band_p`). A skipped response has a null `band_p`, so the route needs a missing-P branch (Codex round 9 on #1773):
    - For each sampled response whose `pronunciation_status` is `skipped_budget`, the route derives P from that sample's Azure result with the live route's mapping (`_pron_band_from_scores` in `routers/grading.py`), the band the response would have had if its own Azure line had been granted. In one update it writes the Azure scores, `feedback.band_p`, `final_band_p`, `p_feedback` from the Azure summary, `pronunciation_source = 'azure'`, the response's `overall_band` recomputed as the mean of FC, LR, GRA and P, and `pronunciation_status = 'completed'`. The `responses` trigger advances the generation, and the session bands are re-aggregated through `update_session_bands` and FR-024.
    - When Azure returns no usable score, the response keeps `skipped_budget` and stores no Azure scores. The existing `_upsert_pronunciation` sets `pronunciation_status = 'completed'` unconditionally, so it must not run on a `skipped_budget` response without the P band; otherwise the marker would be lost while `band_p` is still null.
    - The "Điểm tổng tính trên 3 tiêu chí" label, P5 and the teacher label read the marker, so they disappear for a response once it is `completed`. `pronunciation_incomplete` stays true while any test-mode response in the session is still `skipped_budget`, for example a response the route did not sample (it samples one response per part).
    - A refused Azure line on this route changes nothing: the response keeps `skipped_budget` and the route shows P2 (FR-016). A response with a non-null `band_p` keeps today's adjusted-band path. Admin regrade re-scores FC, LR and GRA and only re-attaches stored Azure scores, so it does not add a missing P. The Q11 alternative (a P-only deferred job per skipped test-mode response) is not in phase 1.
- **FR-024:** Every write that can change a Speaking session's bands is fenced by the session's refresh generation (FR-013), not only the deferred drain and `PATCH /complete` (Codex round 8 on #1773).
  - **Generation:** a trigger on `responses` advances the session's `generation` in the same transaction as any insert, delete or update of a band-bearing column (`overall_band`, `final_band_p`, `final_overall_band`, `feedback`, `grading_status`). This covers the live route, the drain, admin regrade, the pronunciation routes and any future writer.
  - **Session writers:** every writer of `sessions` band columns saves through the one generation-checked function `fn_ai_session_bands_write` (`plan.md` item 7). The writers are `PATCH /sessions/{id}/complete`, `_complete_session_internal` (Full Test finalisation), `update_session_bands` (after pronunciation), admin regrade-response, admin regrade-session, admin rebuild-summary, and the sweeper refresh. Each one reads `generation` before it reads the responses, computes, and writes only if no response has changed since. On `stale` it recomputes, at most 3 times, and then writes unacknowledged, so the row stays owed and the sweeper refreshes a `completed` session.
  - **Deferred responses:** admin regrade of a response whose `grading_status` is `awaiting_budget` is refused with 409 `grading_deferred`, because the queue grades it. Admin regrade-session leaves such a response to the queue and reports it as pending, not as failed.

## Acceptance scenarios

All scenarios run against fake or offline providers (a recording stub that
counts calls). No real traffic is needed.

### AC1 — Hard cap reached: no provider is called, fallback included

- **Given** committed spend on the `openai` monthly scope equals its $20
  cap (Whisper's line), and the soft Anthropic and `total` scopes have room
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
  threshold, scope and period. A new month produces new alerts. For
  `anthropic` there is no 50% row. Each send uses the sender
  `alerts@averlearning.com` through the Resend transport. While the domain
  is unverified, the rows are not `sent` and no other transport is tried.

### AC8 — Transient errors still fall back within the cap

- **Given** budget room on both providers
- **When** the Anthropic stub returns 429 `rate_limit_error`, 529 or a
  timeout
- **Then** the existing fallback to the next provider happens, and each
  attempt holds its own reservation.
- **When** the stub returns 402 `billing_error`
- **Then** no fallback happens, the reason is `provider_spend_limit`, and
  the Anthropic scope is closed for the UTC day.

### AC9 — Missing configuration uses the defaults; bad values fail closed per scope

- **Given** every `AI_BUDGET_MONTHLY_USD_*` variable is unset or empty
- **Then** the scopes use the spec defaults: total $200 soft, Anthropic
  $100 soft, and Google, Azure, OpenAI and ElevenLabs $20 hard ($1.3333 a
  day). No scope is `config_invalid`, and a paid call within the caps is
  made.
- **Given** `AI_BUDGET_MONTHLY_USD_GOOGLE` is `0` or `abc`, or
  `MAX_GRADINGS_PER_USER_PER_DAY=0`
- **Then** paid calls in the affected scope are refused with reason
  `config_invalid`, and the admin panel names the variable. None of these
  values means "unlimited". Calls to other providers are unaffected.
- **Given** `AI_BUDGET_MONTHLY_USD_ANTHROPIC=abc` or
  `AI_BUDGET_MONTHLY_USD_TOTAL=abc`
- **Then** the panel shows `config_invalid` for that soft scope, no
  threshold alert is created for it, and no call is refused because of it.

### AC10 — The Anthropic budget and the total are soft

- **Given** Anthropic committed spend at or above $100 for the month and
  above its daily budget, with every hard scope open
- **When** a Claude-only paid call is made
- **Then** the Anthropic stub is called once and its reservation is
  recorded and settled. Exactly one 80% and one 100% monthly alert row and
  one 100% daily alert row exist for `anthropic`, with no 50% row, and each
  is emailed once. Nothing is refused.
- **Given** `total` committed spend at or above $200 for the month (the
  sum of every provider, Anthropic included), with every hard provider
  scope open
- **When** a Gemini call and a Claude call are made
- **Then** both stubs are called, the `total` 50/80/100% monthly alerts
  exist once each, and nothing is refused for `total`.
- **Given** the reserve RPC raises
- **Then** a Claude-only call is still made with one `allow_unrecorded`
  log line, while a Gemini-only call and a Speaking bundle are refused with
  `budget_unavailable` and zero stub calls.
- **Given** `AI_KILL_SWITCH=on`, or an Anthropic 402 `billing_error` earlier
  that UTC day
- **Then** the Claude call is refused (`kill_switch`,
  `provider_spend_limit`) with no fallback.

### AC11 — Gemini, Azure, OpenAI and ElevenLabs hard caps

- **Given** the `AI_BUDGET_MONTHLY_USD_GOOGLE`, `_AZURE`, `_OPENAI` and
  `_ELEVENLABS` variables are unset
- **Then** each scope uses $20 a month and $1.3333 a day.
- **Given** Google committed spend at $20 for the month (or at the daily
  cap)
- **When** a Gemini call is attempted, directly or as a fallback rung
- **Then** zero Gemini stub calls are made, the reason is `monthly_cap`
  (or `daily_cap`), and a Writing grade is deferred under FR-011. The same
  refusal holds for OpenAI (Whisper, TTS) and ElevenLabs at their caps.
  Azure follows AC13.

### AC12 — Temporary budget raise

- **Given** an AAL2 admin and the Google scope at its $20 cap
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
- **Then refused, with no raise, event or email:** a learner; an
  instructor; an AAL1 admin (403 `mfa_required`), and any admin while the
  ADMINAAL2-0032 AAL2 reader is absent; an amount of 0, $21 on a $20 scope
  (above 100% of the base monthly cap), or not a whole dollar; a duration
  of 0 or 25 hours; an empty reason; the `anthropic` or `total` scope; a
  `config_invalid` scope; a second active raise (`raise_active`); a fourth
  raise in the month (`raise_limit_reached`); an RPC failure (503).

### AC13 — Azure cap: Speaking graded without pronunciation

- **Given** the `azure` scope at its monthly or daily cap (or, as a
  defensive case, with its S0 price row removed), and every other scope
  open
- **When** a learner submits a test-mode Speaking answer, and separately a
  practice-mode answer
- **Then** Whisper, the grader and the judge are each called once, and the
  Azure stub is not called. The response is graded at once: no 503, no
  deferred job, and one `grading_attempts` row as for any live grade. It
  stores `pronunciation_status = 'skipped_budget'`, `pronunciation_source =
  'budget_skipped'` and a null `band_p`.
- **And** in test mode, `overall_band` equals `ielts_round` of the mean of
  FC, LR and GRA (Q10 = A), and the session aggregate follows FR-023.
  In practice mode the band is the same as with a null pronunciation
  result today.
- **And** the learner result shows P5 (test) or P5b (practice) exactly,
  before and after a reload. The instructor matrix and the admin Speaking
  session view show "Chưa có Phát âm"; only the admin view shows the
  budget reason.
- **Given** `AI_KILL_SWITCH=on`
- **Then** the submission is deferred under FR-011 instead (AC1 behaviour).

### AC14 — Admin regrade cannot be overwritten by a stale band (FR-024)

- **Given** a completed session that owes a refresh, and a sweeper refresh
  that has read `generation` and the responses
- **When** an admin regrades one response of that session, and its
  regrade-response route writes the corrected session bands, before the
  refresh writes
- **Then** the refresh's write returns `stale` and writes nothing. It
  recomputes from the regraded responses, and the persisted
  `overall_band` is the corrected one with nothing owed.
- **When** the order is reversed (a drain commit lands between the admin
  route's response read and its session write)
- **Then** the admin write returns `stale` and recomputes, and the band
  includes the drained result. The same holds for
  `update_session_bands` after pronunciation, admin regrade-session,
  rebuild-summary and `_complete_session_internal`.

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
  FR-009 turns into `provider_spend_limit` with no fallback. The `total`
  can exceed $200. With the default hard caps, the non-Anthropic providers
  can reach at most $80 a month plus active raises, so in practice `total`
  passes $200 only when Anthropic is above $120.
- **Unrecorded soft spend.** Anthropic calls made during a budget DB outage
  are not in the counters, so the panel and the alerts can under-count
  them. The `allow_unrecorded` log lines and the best-effort ledger are the
  record. The 7-day reconciliation (P4) compares against the Console.
- **Hard lines in the Speaking bundle.** The bundle (`plan.md`) holds
  Whisper (OpenAI, hard at $20 a month and $1.33 a day) and the Claude
  grader and judge (soft). When the Whisper line is refused, the whole
  Speaking grade is deferred, Claude included. The soft Anthropic budget
  does not change this, but a raise of the OpenAI scope (FR-022) or a higher
  base cap does. Whisper is reserved at the recording's measured duration
  plus 1 s (FR-004; at most about $0.03 for 300 s) and settled at the
  duration Whisper reports. So $1.33 a day covers roughly 220 one-minute
  answers, less whatever TTS spends from the same OpenAI scope. Azure
  pronunciation is outside the bundle (FR-023) and is priced at the S0
  tier (Q1, 16:26). When its line is refused, Speaking is graded
  without pronunciation, not deferred. The Gemini fallback is
  reserved only when that rung runs, so the Gemini cap defers a grade only
  when the Claude primary has already failed.
- **Pronunciation skipped in part of a session.** The Azure cap can be
  reached in the middle of a test session. The session then mixes
  responses with and without P. Under Q10 = A, `sessions.band_p`
  averages the P values present, and the session is labelled
  `pronunciation_incomplete` (FR-023).
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
  Every other band writer, admin regrade included, is fenced the same way
  (FR-024). Full Test finalization treats a pending part as pending, not as zero.
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

- In offline tests AC1–AC14 all pass. Provider stubs record zero calls in
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
relayed by the Leader. Vinh then approved decisions (a)–(f) in chat at
**09:35** the same day (UTC+7). They were relayed with the instruction to
update this PR, and they are recorded below as written. Where a 09:35
decision changes an earlier answer, the 09:35 decision wins, and the
superseded text is noted. Q4 and Q6–Q9 were not overridden, so their
recommended defaults stand as written. Vinh answered Q10, Q11 and the
Azure price tier under Q1 at **16:26** the same day (UTC+7), relayed with
the instruction to update this PR. At **22:34** the same day (UTC+7) Vinh
approved the learner copy of the unmeasurable-recording 422.

### Decision of 22:34 (2026-10-28, UTC+7)

- **Unmeasurable recording, learner copy.** The fail-closed 422 for a
  Speaking recording whose duration cannot be measured reads exactly:
  "Không đọc được bản ghi âm nên bài chưa được chấm và không bị trừ lượt. Vui lòng ghi âm lại."
  The behaviour is unchanged: nothing is reserved, stored or graded, and
  no daily grading quota is used. → FR-004, `plan.md` `routers/grading.py`.

### Decisions of 16:26 (2026-10-28, UTC+7)

- **Q10 = A.** When Azure is skipped for budget reasons, the overall band
  is the mean of FC, LR and GRA, labelled "Điểm tổng tính trên 3 tiêu
  chí". This was already the default. → FR-023, AC13, `ui-states.md` P5
  and T1.
- **Q11 = A.** No automatic re-grade of pronunciation in phase 1. A Full
  Test's result-page pronunciation call can still add P later. → FR-023.
- **Q1, Azure tier.** The Azure Speech pricing tier is **S0** (standard,
  paid). Azure cost estimation and reservation sizing use S0 pricing. This
  removes the earlier caveat that Speaking is graded without P until the
  tier is confirmed. → FR-004, FR-023, T001, `research.md` §7.

### Decisions of 09:35 (2026-10-28, UTC+7)

- **(a) Alert email.** Alert emails are sent FROM `alerts@averlearning.com`
  through Resend, once the domain's DNS is verified. They go TO
  `andyvinhtran1212@gmail.com`, which stays a single config value. Gmail
  SMTP is not used. → FR-015, Q2, `rollout.md` Preconditions, T008.
- **(b) OpenAI, ElevenLabs and the total.** OpenAI gets a $20/month hard
  cap, and so does ElevenLabs. On top of that there is a TOTAL monthly
  threshold of $200, which ALERTS ONLY and never blocks. A missing config
  must never block all AI: the default values must come from the spec, not
  lead to `config_invalid`. → FR-002, FR-003, FR-021, AC9, AC10, AC11, Q1.
  The spec reads "TOTAL" as the spend of every provider, Anthropic
  included, because the total no longer needs to exclude the one soft
  provider once it is soft itself (FR-002).
- **(c) Azure cap.** When Azure's cap is used up, Speaking grading
  CONTINUES without the pronunciation score. The learner sees a short note
  in Vietnamese. Grading is not deferred. → FR-023, AC13, `ui-states.md`
  P5/P5b. The Feature Developer addendum approved through (c) asks for the
  band rule, the labels and the re-grade rule. Vinh decided them as Q10
  and Q11 at 16:26, and FR-023 records the result.
- **(d) Daily caps.** Keep the $1.33/day cap for Gemini and Azure, as
  protection against runaway loops. → FR-003 (monthly ÷ 30 × 2, which also
  gives OpenAI and ElevenLabs $1.33 a day).
- **(e) Temporary budget raise.** Each raise can add at most 100% of the
  base cap, lasts at most 24 hours, and can be used at most 3 times per
  month. It also needs everything already specified (admin-only, an audit
  log, an alert email when used, automatic expiry), and it must REQUIRE
  AAL2 on `/admin/ai/budget`, as the Security Auditor asked. → FR-022,
  AC12, Q3, `plan.md` item 10. This replaces the 09:13 bounds ($50, 72
  hours, AAL2 only once ADMINAAL2-0032 provides it). The spec reads
  "require AAL2" as applying to the raise and end routes, and to the raise
  form on the panel, whether or not ADMINAAL2-0032 enforcement is on.
  Without the 0032 AAL2 reader, they refuse.
- **(f) Claude/Anthropic.** Claude/Anthropic keeps the $100/month SOFT
  limit. It sends an alert at 80% ($80) and another at 100%, and never
  blocks. The $200 cap on the Anthropic Console stays as the last backstop.
  → FR-015, FR-019, FR-021, AC10. This replaces the 50% Anthropic alert of
  09:13.
- **Migration number.** Migration number for AI-BUDGET lot 02: **333**
  (same instruction). → Q5, FR-018, T002.

### Questions

- **Q1: Caps.** *Decided (09:13, updated by (b), (d) and (f) at 09:35):*
  - **Anthropic (Claude): $100 a month, soft** (FR-021). It alerts at 80%
    and 100% only and never blocks or fails closed for Claude. This
    replaces the brief's in-app $200 hard cap. The Console limit stays
    $200 as the last backstop (FR-019).
  - **Google (Gemini), Azure Speech, OpenAI and ElevenLabs: $20 a month
    each, hard.** Daily $1.33 each.
  - **Total: $200 a month, soft, alerts only** (daily $13.33 alert). It
    replaces the 09:13 default of a $250 hard total, and the V1-derived
    OpenAI and ElevenLabs caps are no longer needed. `plan.md` V1 stays as
    a read-only check of last month's spend against the $20 caps before
    enforcement.
  - Vinh revisits these values. They change through the Railway variables
    or, for at most 24 hours, the raise in FR-022.
  - **Azure Speech tier: S0** (standard, paid), decided at 16:26. T001
    adds the S0 catalog row, and Azure estimates and reservations are
    sized from it (FR-023, `research.md` §7).
- **Q2: Alert email.** *Decided (09:13, sender set by (a) at 09:35):* the
  recipient is `andyvinhtran1212@gmail.com` (confirmed by Vinh), kept in the
  one config value `OWNER_ALERT_EMAILS`, the same variable and address as
  ADMINAAL2-0032. It is set as a Railway variable, not in code. The sender
  is `alerts@averlearning.com` through Resend, once the domain's DNS is
  verified. Gmail SMTP is not used. ADMINAAL2-0032 (#1784) records the
  same: the sender is `alerts@averlearning.com` via Resend after DNS
  verification, and the recipient is `andyvinhtran1212@gmail.com`. This
  spec's alerts always use `alerts@averlearning.com`.
- **Q3: Temporary budget-raise button for admins.** *Decided (09:13,
  bounds set by (e) at 09:35):* **yes, in phase 1**, bounded as FR-022
  specifies:
  - an admin with AAL2, always required;
  - at most 100% of the base cap per raise, for 1–24 hours;
  - one active raise, and three per scope per month;
  - an append-only audit event and an owner email for each grant, early
    end and expiry;
  - automatic expiry back to the base cap.

  These bounds limit what a compromised admin account can add.
- **Q4: Leader notification and sweeper-down alert.** *Default stands:*
  none beyond email. A sweeper heartbeat older than 15 minutes is shown on
  the admin panel but not emailed. Add a channel only if one is named.
- **Q5: Migration number.** *Decided (09:35):* **333** for AI-BUDGET lot
  02. 327–330 are reserved, 331 is GIVEARCHIVE-0031 and 332 is
  ADMINAAL2-0032.
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
- **Q10: Speaking band when pronunciation is skipped for budget.**
  *Decided (16:26): A, the default.* Keep today's rule for a
  missing Azure score. In test mode and Full Test, the overall band is the
  mean of the criteria present (FC, LR, GRA), rounded with `ielts_round`,
  and labelled as computed on three criteria. The session aggregate
  averages the criteria present. Practice mode is unchanged (FR-023).
  The label is "Điểm tổng tính trên 3 tiêu chí". *Not chosen:* alternative
  B, withholding the overall band (null, "chưa đủ 4 tiêu chí").
- **Q11: Re-grade the pronunciation later?** *Decided (16:26): A, the
  default.* No automatic P re-grade in phase 1. A Full Test can get P from
  its existing result-page pronunciation call once Azure is open again.
  Admin regrade does not add P (FR-023). *Not chosen:* a P-only deferred
  job per skipped test-mode response, which would fill `final_band_p`
  after the learner has seen the band.
