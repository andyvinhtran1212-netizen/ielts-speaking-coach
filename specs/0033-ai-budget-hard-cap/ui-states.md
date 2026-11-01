# UI state matrix

## Canonical data

The backend is the only source of truth:

- `grading_status` on the Speaking response and on the Writing submission;
- `GET /ai/status` (learner and instructor);
- `GET /admin/ai/budget` (admin).

No surface infers "paused" from a missing score, and none keeps an
optimistic "graded" or "available" state that a refetch would contradict.
After any submit, the surface refetches the canonical row. A full reload
must show the same state.

## Fixed texts

These are the exact Vietnamese strings, so they can be tested.

- **P1 (learner grading paused, from the brief, verbatim):** "Hệ thống chấm
  tự động tạm dừng. Bài của bạn đã được lưu và sẽ được chấm khi hệ thống mở
  lại."
- **P1 badge:** "Đang chờ chấm"
- **P2 (AI helper disabled caption):** "Tính năng AI đang tạm dừng."
- **P3 (instructor banner):** "Chấm AI tạm dừng — bài nộp lúc này được lưu và
  sẽ có điểm khi hệ thống mở lại."
- **P4 (not saved; work could not be stored):** the existing storage error
  for that flow. It is never P1, because P1 promises the work was saved.
- **P5 (Speaking graded without pronunciation, test mode and Full Test,
  FR-023, owner decision (c) of 09:35):** "Lần này hệ thống chưa chấm được
  phần Phát âm, nên điểm tổng của bạn được tính trên 3 tiêu chí còn lại.
  Các nhận xét khác vẫn đầy đủ nhé!"
- **P5b (the same, practice mode, in the pronunciation card):** "Lần này
  chưa có phần phân tích phát âm. Điểm và các nhận xét khác của bạn vẫn
  đầy đủ nhé!"
- **P5 label (next to the overall band, test mode and Full Test, Q10 = A
  of 16:26):** "Điểm tổng tính trên 3 tiêu chí".
- **T1 (teacher label, FR-023):** "Chưa có Phát âm", with the tooltip
  "Điểm tổng tính trên 3 tiêu chí". The admin view adds the reason "Bỏ qua
  phát âm: hết ngân sách Azure". Instructors never see the reason.
- **R1 (manual regrade already running, FR-025, Amendment 1):** "Đang
  chấm lại, vui lòng đợi…", shown for a 409 `regrade_in_flight`. Content
  Manager reviews the wording only; the review does not block
  implementation (Vinh, 2026-10-29 14:44). The text is final once CM
  approves it.

P5 and P5b address the learner as "bạn", like P1 and the existing
pronunciation copy (`_PRON_UNAVAILABLE_FEEDBACK` in `routers/grading.py`).
They promise no later pronunciation score, because Q11 = A (16:26) adds no
automatic re-grade in phase 1.
Neither one names the budget.

`GET /ai/status` is read on mount after sign-in (see the hydration gate in
`window-api` G-01) and cached for 60 s per tab. A 503
`ai_budget_exhausted` on any action also switches the surface to the paused
state at once, without waiting for the cache. A failed status read is
treated as paused for AI controls only. It never blocks non-AI content.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Speaking practice feedback (`frontend/app/(authed-practice)/practice/session/practice-page-shell.tsx`, `practice-submission-bridge.tsx`, `public/js/speaking-submission-controller.mjs`, `public/js/practice.js`) | Existing "processing" state while the submit is in flight | No pending item: unchanged | Graded: unchanged feedback. Graded with `pronunciation_skipped` (FR-023): the feedback renders normally, with P5 (test mode) or P5b (practice) in the pronunciation card, both immediately and after a reload. 503 `ai_budget_exhausted` with `work_saved:true`: the feedback panel shows the P1 badge and message instead of scores, and "Câu tiếp theo" stays enabled. The classifier maps this before the generic 5xx branch, so it is never `ambiguous_commit`. | `work_saved:false`: the existing storage error with re-record or retry. A network error: the existing readback, and if the readback finds `grading_status='awaiting_budget'` it shows P1. | Unchanged (401/403/404 mapping) | P1 is announced in the existing feedback live region (`aria-live="polite"`). Focus stays on the next-question control. Light and dark, mobile and desktop. |
| Speaking result and Full Test result (`speaking-result-behavior.tsx`, `full-test-result` route) | Existing skeleton | Unchanged | A pending response shows the P1 badge in place of its band and transcript. The session band says "Đang chờ chấm" while any response is pending. It never shows 0 or "—". Graded responses render as today. A response with `pronunciation_skipped` shows P5 in its P card in place of the generic "Chưa đánh giá phát âm" tooltip, and P5 sits next to the overall band while the session has `pronunciation_incomplete`. When the Full Test pronunciation call is refused (503), its block shows P2 and the bands stay as computed. When it succeeds for a sampled `skipped_budget` response (FR-023 missing-P branch), the page refetches the summary: that response shows its P band without P5, and P5 next to the session band stays only while `pronunciation_incomplete` is still true. | Status fetch failure: the existing error and retry | Owner only (unchanged) | The badge has text, not colour alone. Contrast passes in both themes. |
| Writing submit and result (`frontend/app/(authed-writing-result)/writing/result/writing-result-behavior.tsx`; Writing dashboard `writing-behavior.tsx`) | Existing "Đang chấm…" polling of the essay | Unchanged | Submit succeeds as today, because the essay is saved before grading. While the essay reports `grading_status='awaiting_budget'`, the result shows P1 with the submitted essay read-only, and polling slows to once every 60 s. The dashboard history row shows the "Đang chờ chấm" badge. Once graded, a reload shows the normal result. | A submit failure: the existing save error, with the draft kept (unchanged). A polling error: the existing retry. | Owner only | As above. The essay text stays selectable. |
| Learner AI helpers: question TTS in practice, Listening gist (`frontend/app/(authed-listening)/listening/(standalone-exercises)/gist/page.tsx`), other learner AI buttons in `research.md` §1 | The control is disabled until `GET /ai/status` resolves | Not applicable | Available: unchanged. Paused: the control is disabled, with the P2 caption next to it (`aria-describedby`). Practice question TTS keeps its existing browser speech fallback (`practice.js:2846-2868`), so the question can still be heard, and P2 notes the AI voice is paused. Gist answers can still be typed and saved where the exercise allows; only AI grading is paused. | A 503 on click switches to paused. Other errors: the existing message. | Unchanged | The disabled control stays focusable, or is replaced by the caption text, so screen readers announce why. |
| Speaking chooser and question generation (`frontend/app/(authed-speaking)/`), course Writing, course pronunciation and Advanced Vocabulary rewrite | Existing | Unchanged | Paused (`paid_ai_available:false`): starting a new session that needs generated questions is disabled with P2, and existing sessions and history stay open. The course and vocab submit buttons are disabled with P2, and the typed answer or recording stays in the page. | A 503 on submit: P2, the input is kept, and no attempt is used (FR-020). Retrying after reopening submits the same input. | Unchanged | P2 is linked by `aria-describedby`. Both themes. |
| Instructor dashboard (`frontend/app/(authed-instructor)/instructor/instructor-dashboard.tsx`) | No banner until the status resolves | No banner when available | Paused: a P3 banner at the top (`role="status"`). Ungraded items in the matrix show "Đang chờ chấm", not "chưa nộp". A Speaking cell whose session has `pronunciation_incomplete` shows its band with the T1 label and tooltip (FR-023). | Status read failure: P3 banner variant "Không kiểm tra được trạng thái chấm AI" | Instructor only | The banner reflows on mobile. Both themes. |
| Admin overview budget panel (`frontend/app/(authed-admin-overview)/admin/admin-overview.tsx`) | Panel skeleton | Not applicable (always has scopes) | For each scope and period: mode ("Cứng" / "Mềm — chỉ cảnh báo"; `anthropic` and `total` are soft), base cap, active raise, effective cap, settled, reserved, committed, %, state (`open`, `monthly_cap`, `daily_cap`, `kill_switch`, `config_invalid`, `provider_spend_limit`, and for a soft scope `over_soft_budget`, shown as a warning, never as blocked); kill-switch state; queue depth and oldest age; open and expired reservations; last alert per threshold with its send state; sweeper heartbeat age (warning above 15 min). The raise controls are in the next row. | `lookup_failed:true` or a request error renders `⚠ lookup failed` with "Thử lại", never 0 or "—". | Admin only (`require_admin`; AAL2 when ADMINAAL2-0032 enforces) | Table scrolls horizontally on mobile. Numbers use tabular figures. Both themes. Keyboard-operable retry. |
| Admin temporary budget raise (`admin-ai-budget-raise.tsx` in the budget panel, FR-022) | The form is disabled until the panel loads | No active raise: "Chưa có tăng ngân sách tạm thời" and the raises used this month per scope | The "Tăng ngân sách tạm thời" form takes a scope (hard scopes with a valid cap only; `anthropic` and `total` are not listed), whole dollars (the limit is shown: up to 100% of the base cap), 1–24 hours (24 by default) and a required reason. A confirm step restates the scope, amount, new effective cap and expiry time. After 201, the panel refetches and lists the active raise with its expiry countdown, actor and "Kết thúc sớm". Ending it also asks for a confirm and a reason. | 409 `raise_active`, `raise_limit_reached`, `amount_out_of_range`, `scope_not_raisable` or `scope_config_invalid`: a specific inline message, nothing changes. A 503 shows "Không tăng được ngân sách — chưa có thay đổi nào" with "Thử lại". After any error the panel refetches and never shows a raise that the server did not return. | Admin with AAL2 only (decision (e)). An AAL1 session sees the form disabled with "Cần xác thực 2 bước", with a link to `/admin/mfa` once ADMINAAL2-0032 ships. A 403 `mfa_required` shows the same text. While the 0032 AAL2 reader is absent, the form stays disabled with that text and the server refuses. | Labelled fields, errors linked by `aria-describedby`, and a focus-trapped confirm dialog that returns focus to its trigger. Keyboard-operable. Mobile stacks the fields. Both themes. |
| Admin and instructor manual regrade (FR-025: `frontend/lib/admin-speaking-sessions-api.ts`, `frontend/public/js/admin-speaking-sessions.js`, `frontend/app/(authed-admin-writing-grade)/admin/writing/grade/writing-grade-behavior.tsx`, `frontend/app/(authed-instructor-grade)/instructor/grade/instructor-grade.tsx`, `frontend/public/js/instructor-grade.js`) | The existing pending state of "Chấm lại" after the confirm. One `Idempotency-Key` (UUID v4) is generated at the confirm and reused for every automatic or manual retry of that same action (same dialog). | Unchanged | The result renders as today. A replay (`Idempotent-Replayed: true`) renders the same stored result and is not shown as a second regrade. A new click after a terminal result makes a new key and a new regrade. After the request the surface refetches the canonical row. | 409 `regrade_in_flight`: R1, with retry allowed after `Retry-After` using the same key. 422 `idempotency_key_invalid` / `idempotency_key_mismatch`, 428 `idempotency_key_required` and 503 `regrade_unavailable`: the existing error region, and nothing is regraded. The existing 409/404/422 refusals are unchanged. | Admin (`require_admin`) or instructor (`require_instructor`), 0032 AAL2 rules unchanged. A 403 comes before any claim. | R1 is announced in the existing status/error region (`aria-live="polite"`). Focus stays on the regrade control. Both themes, mobile and desktop. |
| Admin AI actions (question generation, listening audit, content generation, regrade) | Existing pending state | Unchanged | Unchanged when available | A 503 `ai_budget_exhausted` shows "Ngân sách AI đã hết hoặc AI đang tạm dừng (lý do: …)", with the reason code visible to admins, and creates nothing | Admin only | Existing error region |

Speaking and Writing use the same deferred contract for a refusal, so a
learner never sees a different message for `kill_switch`,
`budget_unavailable` or a cap. Only admins see the reason. A refusal of
the Azure line alone is not a deferral: the grade is shown with P5 or P5b
(FR-023).
