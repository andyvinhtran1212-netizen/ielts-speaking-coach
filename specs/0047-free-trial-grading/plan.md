# Implementation plan

## Architecture impact

- **Route mới** `backend/routers/trial.py` (`/api/trial/*`), service mới
  `backend/services/trial_service.py` (eligibility, giữ chỗ lượt, trần),
  `backend/services/trial_prefilter.py` (lọc Writing),
  `backend/services/trial_input_forensics.py` (phân tích nhật ký gõ).
- Tái dùng pipeline chấm hiện có (Speaking: Whisper → grader trong
  `routers/grading.py`/`claude_grader`; Writing: grader Writing hiện có) qua một
  hàm thuần nhận `feature`, `budget_scopes`, `provider_order` — **không** thay
  đổi hành vi route lớp (FR-002). Nếu grader không tách được sạch, T002 thêm
  tham số tuỳ chọn mặc định giữ hành vi cũ.
- `services/ai_budget.py` / `ai_budget_config.py`: thêm scope dùng thử
  `trial_total`, `trial_anthropic`, `trial_openai` (hard, có trần ngày và
  trần tổng không theo tháng). Dòng reservation dùng thử chỉ mang scope dùng
  thử, không mang `total`/`anthropic`/`openai` nền tảng.
- Eligibility: hàm `is_trial_eligible(user_id)` thực hiện đầy đủ FR-001, gồm
  vai trò `user`/`student`, chưa từng kích hoạt, không bị khoá và không có dấu
  vết mã/lớp. FR-001 là nguồn định nghĩa; route lớp không gọi hàm này.
- Frontend: `frontend/app/(authed-trial)/trial/...` (Speaking + Writing dùng
  thử), component `TrialStatusCard` trên trang chủ; revamp Speaking/Writing ở
  các file `page-shell.tsx`/`*-behavior.tsx` hiện có sau cờ UI.

## Data and contracts

### Ước tính chi phí mỗi lượt (dữ liệu **staging**, ước tính)

Nguồn: `SELECT` chỉ đọc trên staging `zjphffoujxkpltixsbzj`, bảng
`ai_usage_logs`, 60 ngày tới 04/11 (FD, 04/11 ~14:50 giờ VN), bỏ dòng
`model='fixture'`. Giá: `services/ai_pricing.py` (Sonnet 5.5: 2 USD/1M input,
10 USD/1M output; Haiku 5.5: 0,10/0,50; Haiku 4.5: 1/5; Whisper 0,006 USD/phút).
**Mẫu nhỏ** — cần Q-10 (đọc tổng hợp prod) để chỉnh.

| Thành phần | Mẫu staging | Token TB (in/out) | Chi phí TB | Max |
| --- | --- | --- | --- | --- |
| Speaking chấm, Sonnet 5.5 (`speaking_grading`) | 5 | 311 / 1 413 | 0,0191 USD | 0,0241 |
| Speaking STT, Whisper (`speaking_stt`) | 2 | 28,1 s audio | 0,0028 USD | 0,012 (120 s) |
| Off-topic judge, Haiku 4.5 | 2 | 454 / 129 | 0,0011 USD | 0,0012 |
| Writing chấm, Sonnet 5.5 success | 14 | 1 725 / 6 532 | 0,0883 USD | 0,1276 |
| Writing chấm, Sonnet 5.5 `invalid_response` | 9 | 1 387 / 6 419 | 0,0868 USD | 0,1326 |
| Bộ lọc Haiku 5.5 (ước tính, chưa có) | — | ~2 000 / 150 | ~0,0003 USD | 0,0005 |

Kiểm tay theo bảng giá: Writing 1 725 × 2/1M + 6 532 × 10/1M = 0,0035 +
0,0653 = **0,069 USD** (log 0,088 vì có lần gọi dài hơn/token suy luận).
Speaking 311 × 2/1M + 1 413 × 10/1M = **0,015 USD** (log 0,019).

Tính mỗi lượt dùng thử (dùng số log, an toàn hơn):

- **Speaking 1 câu:** Anthropic 0,0191 + 0,0011 = **0,020 USD** TB, xấu nhất
  0,0241 + 0,0012 = 0,025; OpenAI Whisper TB 0,003, xấu nhất (120 s) **0,012**.
  → Ước tính giữ chỗ: Anthropic 0,03, OpenAI 0,012.
- **Writing 1 bài:** tỉ lệ `invalid_response` staging 9/23 = 39 %. Với tối đa 1
  lần thử lại Sonnet (FR-005): TB ≈ 0,088 × (1 + 0,39) + 0,0003 = **0,123 USD**;
  xấu nhất theo mẫu 2 × 0,133 + 0,0005 = 0,27 USD — **không dùng làm giữ chỗ**.
- **Giữ chỗ (FD 05/11, Codex #2252 r4471860800):** reservation = tổng
  `ai_budget.estimate(provider, model, input_tokens=<đếm thật>, max_tokens=<giới
  hạn của lần gọi>)` cho **mọi** lần gọi được phép của một lượt (lần đầu + 1 lần
  thử lại + bộ lọc). Writing dùng thử chỉ gọi đường Anthropic một lượt của
  `gemini_writing_grader` (các pass phụ tắt ở dùng thử, test), giữ
  `CLAUDE_MAX_TOKENS = 16000` (gemini_writing_grader.py:121; hạ xuống sẽ tăng
  `invalid_response`). Input ≤ 4 000 token (đề + bài ≤ giới hạn ký tự FR-013):
  2 × (4 000 × 2/1M + 16 000 × 10/1M) = 2 × 0,168 = 0,336, + Haiku lọc 0,0005 →
  **giữ chỗ ≈ 0,34 USD**. Speaking: grader `max_tokens=2048`
  (claude_grader.py:1025) + câu mẫu 300 (claude_grader.py:1503), input ≤ 1 500:
  (1 500 × 2/1M + 2 348 × 10/1M) ≈ 0,026 × 2 lần = **≈ 0,05 USD**; Whisper giữ
  0,012. Số chính xác do `estimate` tính lúc chạy; nếu `estimate` trả lỗi →
  `config_invalid`, không gọi provider. Hệ quả xấu nhất mỗi tài khoản/ngày:
  Anthropic 5 × 0,05 + 0,34 = 0,59 USD; tổng chương trình 20 × 0,05 + 5 × 0,34 =
  2,70 USD (TB không đổi ≈ 1,02). Trần ngày 5 USD ⇒ tối đa ~14 reservation
  Writing đồng thời — chạm trần thì từ chối trước khi gọi (fail-closed).
- **Bài bị lọc:** 0 (lọc cục bộ) hoặc 0,0003 (lọc Haiku).

### Hạn mức và trần đề xuất (Q-1, Q-2)

- Mỗi tài khoản/ngày: Speaking 5 câu, Writing 1 bài → xấu nhất
  Anthropic 5 × 0,05 + 0,34 = 0,59 USD (giữ chỗ theo giới hạn token), OpenAI 5 × 0,012 = 0,06 USD.
- Mỗi tài khoản tổng: 20 câu Speaking + 5 bài Writing → xấu nhất Anthropic
  20 × 0,05 + 5 × 0,34 = 2,70 USD; TB 20 × 0,020 + 5 × 0,123 ≈ 1,02 USD.
- `trial_anthropic`: **5 USD/ngày**, **150 USD tổng** (chừa 50 USD = 25 % cho
  sai số ước tính, `invalid_response`, reservation treo, giá đổi). 5 USD/ngày ≈
  40 bài Writing TB **hoặc** ≈ 250 câu Speaking TB; ≈ 12–13 người dùng hết lượt
  ngày ở mức xấu nhất. 150 USD tổng ≈ 30 ngày, ≈ 150 người dùng hết lượt
  tổng (TB), ≥ 80 người ở mức xấu nhất.
- `trial_openai`: **2 USD/ngày**, **60 USD tổng** (chừa 40 USD). Whisper 2
  USD/ngày ≈ 670 câu TB / 166 câu 120 s — không phải nút thắt.
- `trial_total`: 7 USD/ngày, 210 USD tổng (= tổng 2 provider, để báo cáo).
- Cảnh báo email ở 50 %/80 %/100 % trần tổng và khi chạm trần ngày lần đầu.

### Persistence và migration `371` (Leader cấp 04/11)

- `trial_accounts(user_id pk → users, activated_at, email_norm_hash unique,
  device_hash, ip_hash, blocked boolean default false, blocked_reason)`.
- `trial_usage(id, user_id, kind in ('speaking','writing'), vn_day date,
  status in ('reserved','consumed','released','filtered'), request_key uuid,
  reason, created_at, settled_at)`; **`UNIQUE(user_id, request_key)`** (SA N5a,
  không unique toàn cục); tra cứu idempotent **luôn** lọc `user_id = người gọi`
  — key của người khác không bao giờ trả kết quả; index `(user_id, kind, vn_day)`.
- `trial_rate_events(key_hash, kind in ('activation_ip','grading_ip',
  'activation_global','config_ip','read_user'), vn_day, count)` cho giới hạn IP/thiết bị/toàn
  site (bộ đếm DB dùng chung). (SA N36) Thêm cột `window_start timestamptz`
  (mặc định = đầu ngày VN cho các kind theo ngày); `read_user` dùng cửa sổ
  **1 phút** (`date_trunc('minute', now())`), khoá `key_hash = HMAC(TRIAL_HASH_SALT,
  user_id)`, `UNIQUE(key_hash, kind, window_start)`, tăng bằng `INSERT ... ON
  CONFLICT DO UPDATE SET count = count + 1 RETURNING count` (nguyên tử); job dọn
  xoá hàng `read_user` có `window_start < now() - interval '1 day'`.
- `trial_captcha_tokens(token_hash pk, used_at, expires_at)` chống dùng lại token
  Turnstile (SA N5c), dọn bản ghi hết hạn.
- (SA N1, N10, N13, N17) `users.first_activated_at timestamptz null` + hàm trigger
  `public.trg_users_first_activated_at()` (`SECURITY INVOKER`, `SET search_path =
  pg_catalog, public`, `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon,
  authenticated`), trigger `BEFORE INSERT OR UPDATE OF is_active,
  first_activated_at ON public.users FOR EACH ROW`, tên
  `trg_users_zz_first_activated_at` để chạy **sau** `trg_users_guard_privileged_columns`
  (migration 320) và `trg_users_suspension_guard` (Postgres chạy BEFORE trigger
  cùng loại theo thứ tự tên). Quy tắc: chỉ cho đi **NULL → có giá trị**, không bao
  giờ có giá trị → NULL/giá trị khác. Nhánh theo `TG_OP`:
  - INSERT: `NEW.first_activated_at := coalesce(NEW.first_activated_at, CASE WHEN
    NEW.is_active THEN now() END);`
  - UPDATE: `NEW.first_activated_at := coalesce(OLD.first_activated_at,
    NEW.first_activated_at, CASE WHEN NEW.is_active THEN now() END);`
  Đặt giá trị từ NULL chỉ làm tài khoản **mất** quyền dùng thử (hướng an toàn);
  client không đặt được vì guard 320 từ chối cột không phải hồ sơ từ
  `anon`/`authenticated` (42501) và trigger đó chạy trước. `REVOKE UPDATE
  (first_activated_at)` khỏi `anon`/`authenticated` (thừa, giữ cho rõ).

  **Bảng chân trị trigger** (OLD/NEW = `first_activated_at`; `t` = mốc có giá trị;
  `now` = thời điểm câu lệnh):

  | # | Thao tác | OLD | NEW (câu lệnh gửi) | NEW.is_active | Kết quả | Ghi chú |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | INSERT | — | NULL | false | NULL | tài khoản mới (`/auth/me`, 359) → còn eligible |
  | 2 | INSERT | — | NULL | true | now | tạo sẵn active |
  | 3 | INSERT | — | t | false | t | khôi phục/import giữ mốc (bản trước làm mất — N17) |
  | 4 | INSERT | — | t | true | t | |
  | 5 | UPDATE | NULL | NULL | false | NULL | sửa hồ sơ/tắt khi chưa từng kích hoạt |
  | 6 | UPDATE | NULL | NULL | true | now | lần kích hoạt đầu (mọi đường, kể cả admin `code=null`) |
  | 7 | UPDATE | NULL | t | false | t | **backfill học viên cũ đã tắt** (bản trước ra NULL — lỗi P1 N17) |
  | 8 | UPDATE | NULL | t | true | t | backfill tài khoản active (giữ mốc sớm nhất) |
  | 9 | UPDATE | t | NULL | false/true | t | cố xoá mốc (service_role) → giữ |
  | 10 | UPDATE | t | t2 ≠ t | false/true | t | cố đổi mốc → giữ mốc cũ |
  | 11 | UPDATE | t | t | bất kỳ | t | không đổi (tắt/bật lại sau này) |
  | 12 | UPDATE bởi `anon`/`authenticated` | bất kỳ | bất kỳ | bất kỳ | lỗi 42501 | guard 320 chạy trước, trigger này không tới |
  | 13 | UPDATE không đụng `is_active`/`first_activated_at` | x | x | — | x | trigger không chạy (`UPDATE OF`), giá trị giữ nguyên |

  **Backfill chạy qua trigger** (trigger tạo trước, backfill `UPDATE users SET
  first_activated_at = e.earliest WHERE id = e.user_id AND first_activated_at IS
  NULL`, `e` = tập dấu vết): tài khoản active có dấu vết → dòng 8 (giữ mốc sớm
  nhất); học viên cũ đã tắt / admin `code=null` rồi thu hồi / lớp lưu trữ → dòng
  7 (**giữ mốc**, không còn eligible); tài khoản `user` mới không dấu vết → không
  bị UPDATE, giữ NULL (dòng 1). Active nhưng không có dấu vết nào khác ngoài
  `is_active` → có trong tập dấu vết (`is_active = true` là một dấu vết, mốc =
  `created_at`) → dòng 8. Không có đường nào cho ra NULL ở hàng có dấu vết.

  **Tập dấu vết dùng chung (SA N21, N22, N23):** một view
  `trial_private.v_user_activation_evidence(user_id, earliest)` trong schema
  riêng `trial_private` (tạo trong migration 371, **không** nằm trong danh sách
  schema PostgREST expose; `REVOKE ALL ON SCHEMA trial_private FROM PUBLIC, anon,
  authenticated`; view `security_invoker = true`, `REVOKE ALL ... FROM PUBLIC,
  anon, authenticated`, chỉ `service_role`/owner đọc). Migration sau này mà
  `DROP`+`CREATE` lại view phải REVOKE lại (default privileges áp lại) — có test
  hồi quy. `earliest = coalesce(min(mốc), users.created_at, now())`, không bao giờ
  NULL. View là **danh sách cho phép tường minh** (viết tay trong migration, không
  dò bằng `information_schema`); dùng cho **cả** backfill, hậu điều kiện và bất biến
  hằng ngày. Đối chiếu code origin/staging 5a08978b0 (`services/activation_gate.py`
  `ACTIVATION_EXEMPT_ROUTES` L65-118; mọi route khác của học viên đi qua cổng kích
  hoạt; route `/admin`, `/api/admin`, `/instructor` là staff):

  | Nguồn dấu vết (cho phép) | Điều kiện | Vì sao chỉ tài khoản đã kích hoạt tạo được |
  | --- | --- | --- |
  | `users` | `is_active` hoặc `access_code_used IS NOT NULL` hoặc `permissions` không rỗng hoặc `suspended_at IS NOT NULL` hoặc `role IN ('instructor','admin')` | cột do kích hoạt/admin đặt; guard 320 chặn client |
  | `user_code_assignments.user_id`, `access_codes.used_by`, `access_code_audit.target_user_id` | mọi hàng | ghi bởi `/auth/activate` thành công hoặc admin |
  | `staff_security_audit` | `event='active_changed'` và `after.is_active = true` | admin |
  | `students.user_id` | mọi hàng | gắn hồ sơ khi kích hoạt bằng mã (`routers/auth.py` ~L880) hoặc admin |
  | `student_cohort_memberships` qua `students.id` | mọi hàng | admin/kích hoạt mã lớp |
  | `class_assignment_items.student_id` | mọi hàng | admin/giảng viên giao bài |
  | `writing_essays`, `writing_drafts`, `writing_assignments`, `essay_regrade_requests` qua `students.id` | mọi hàng | `/api/writing/my-assignments/*` sau cổng + `require_writing_permission`; admin |
  | `sessions` | mọi hàng | `POST /sessions` sau cổng + entitlement |
  | `quiz_sessions`, `quiz_attempts` | mọi hàng | `/api/quiz/*` sau cổng |
  | `vocabulary_exercise_attempts`, `vocabulary_set_sessions`, `vocab_unit_attempts`, `advanced_vocab_question_attempts`, `flashcard_reviews` | mọi hàng | route vocab/flashcard ghi đều sau cổng (chỉ GET thư viện là miễn trừ) |
  | `reading_test_attempts` | `user_id` = user **và** `share_token IS NULL` | start có chủ sau cổng; share-link ghi `user_id = NULL` (`routers/reading_student.py` ~L1209) |
  | `listening_test_attempts`, `listening_attempts`, `listening_sessions` | mọi hàng | sau cổng |
  | `exam_attempts`, `mock_exam_sittings`, `mock_exam_assignments` | mọi hàng | sau cổng / admin |
  | `dictation_sessions`, `grammar_diagnostic_sessions`, `grammar_lesson_attempts` | mọi hàng | sau cổng |
  | `course_writing_submissions`, `course_section_submissions`, `course_pronunciation_submissions` | mọi hàng | sau cổng |

  **Loại trừ tường minh** (tài khoản chưa kích hoạt ghi được, qua route miễn trừ):
  `analytics_events` (`POST /api/analytics/events`, analytics.py ~L133-141 gắn
  `user_id` từ token), `error_logs` (`POST /api/error-logs`), `user_feedback`
  (`POST /api/feedback`), `activation_attempts` (`POST /auth/activate` cả khi thất
  bại), hàng `users` tạo bởi `GET /auth/me`, `reading_test_attempts` có
  `share_token`, mọi bảng `trial_*`, `ai_usage_logs`/`ai_budget_reservations` có
  `feature LIKE 'trial\_%'`. Bảng không có trong danh sách cho phép → không phải
  dấu vết (bỏ sót chỉ làm mất "dấu vết phụ"; người cũ vẫn bị bắt bởi các nguồn
  mã/admin phía trên). **Quy tắc tương lai** (test snapshot T001): mỗi bảng trong
  danh sách cho phép phải gắn với route ghi **không** nằm trong
  `ACTIVATION_EXEMPT_ROUTES`; thêm route miễn trừ mới ghi bảng có `user_id` thì
  phải thêm bảng đó vào danh sách loại trừ.

  **Bỏ `grading_attempts` và `ai_usage_logs` khỏi danh sách cho phép (SA N25,
  quyết định FD).** Lý do: pipeline chấm dùng lại cho dùng thử ghi hai bảng này
  (`record_grading_attempt` grading.py:544-545/593-594 → rate_limit.py:351; feature
  cứng ở claude_grader.py:1058/1514, off_topic_judge.py:312,
  gemini_writing_grader.py:410, grading.py:641). Đây là dấu vết phụ: mọi người học
  thật dùng chấm đều có `sessions` (Speaking) hoặc `writing_*` qua `students`, và
  luôn có nguồn mã/admin (`access_code_used`, `user_code_assignments`, `students`).
  Bỏ đi chỉ giảm độ phủ ở ca "chỉ có log AI mà không có bất kỳ dữ liệu học/mã nào"
  — ca này không tồn tại theo luồng hiện tại; nếu có, người đó cũng là `is_active`
  (dòng `users`). Kết hợp FR-022(a)(b) thành hai lớp: đường dùng thử không ghi,
  và view không đọc.

  **Truyền feature (SA N25b) — file và ticket:**

  | Điểm gọi (5a08978b0) | Thay đổi | Ticket |
  | --- | --- | --- |
  | `services/ai_usage_logger.py` | đọc contextvar `trial_request`; feature không `trial_` khi cờ bật → `trial_unlabeled` + log lỗi | T002 |
  | `services/trial_service.py` | context manager `trial_request_context()` đặt contextvar cho cả request | T002 |
  | `services/claude_grader.py:1058, 1514` | thêm kwarg `feature: str = "speaking_grading"`; route dùng thử truyền `trial_speaking_grading` (bắt buộc ở wrapper dùng thử) | T007 |
  | `routers/grading.py:641` (STT) | tách hàm transcribe nhận `feature`; route dùng thử gọi với `trial_speaking_stt`; **không** gọi `record_grading_attempt`/`enforce_grading_rate_limit` | T007 |
  | `services/off_topic_judge.py:312` | factory `get_judge(feature=...)`; dùng thử dùng instance riêng `trial_off_topic_judge` (không dùng singleton lớp) | T007 |
  | `services/gemini_writing_grader.py:410` | `anthropic_feature` lấy từ config/tham số; dùng thử truyền `trial_writing_grading`; `usage_context` mang feature dùng thử | T006 |
  | `services/trial_prefilter.py` (mới) | Haiku lọc ghi `trial_writing_filter` | T006 |

  **Snapshot tường minh (SA N27)** trong `backend/services/trial_evidence.py` (T001):
  - `EVIDENCE_ALLOWLIST_TABLES` (đúng bảng trên) và `EVIDENCE_EXCLUDED_TABLES =
    {analytics_events, error_logs, user_feedback, activation_attempts,
    reading_test_attempts(share), trial_accounts, trial_usage, trial_rate_events,
    trial_writing_submissions, trial_speaking_results (SA N28), trial_captcha_tokens, trial_email_tombstones,
    ai_usage_logs, ai_budget_reservations, grading_attempts, users(auth/me)}`.
  - `REVIEWED_EXEMPT_ROUTES` = bản sao các khoá `ACTIVATION_EXEMPT_ROUTES` tại
    5a08978b0 + 10 cặp dùng thử (T013; FD 05/11 thêm 2 cặp đọc FR-038), kèm `EXEMPT_ROUTE_WRITES` đã rà:

  | Route miễn trừ | Bảng ghi (đã rà) |
  | --- | --- |
  | GET /auth/me | `users` (upsert `is_active=false`, role `user`) |
  | GET /auth/check-active, GET /auth/profile | — |
  | POST /auth/activate | `activation_attempts` khi thất bại; thành công → kích hoạt (đúng ý: trở thành dấu vết) |
  | GET /api/public-stats, GET /health, /health/ready, /health/runtime, /health/async-db, /health/grammar-check, /health/quiz-write, GET /sitemap-grammar.xml | — (probe quiz-write chỉ ghi hàng probe hệ thống, không `user_id` người dùng — T001 xác nhận khi viết test) |
  | POST /api/error-logs | `error_logs` |
  | POST /api/analytics/events | `analytics_events` |
  | 10 GET `/api/grammar/*`, 11 GET `/api/vocabulary/*`, GET /api/writing/prompt-bank | — (chỉ đọc) |
  | POST /api/feedback | `user_feedback` |
  | GET share boot | — |
  | POST share attempts | `reading_test_attempts` (`user_id=NULL`, `share_token`) |
  | POST renderer-affinity, PATCH answers, POST submit, PATCH review-flags (attempt) | `reading_test_attempts`/`reading_attempt_answers`/`mock_attempt_review_flags` của attempt share-link (`user_id` NULL) hoặc attempt có chủ đã tạo khi còn kích hoạt |
  | GET review, GET review-flags | — |
  | 8 cặp `/api/trial/*` ghi/đọc đề (T013) | chỉ bảng `trial_*`, `ai_usage_logs`/`ai_budget_reservations` feature `trial_*` |
  | GET /api/trial/speaking/results/{id}, GET /api/trial/history (FR-038, SA N31) | — (chỉ đọc; bộ đếm rate limit đọc N29 ghi `trial_rate_events`, đã loại trừ) |

  Test: (1) `set(ACTIVATION_EXEMPT_ROUTES) == REVIEWED_EXEMPT_ROUTES` — đỏ khi
  thêm/bớt route chưa rà (T013 sẽ chạm đúng chỗ này khi thêm 10 cặp); (2) mọi bảng
  trong `EXEMPT_ROUTE_WRITES` ∈ `EVIDENCE_EXCLUDED_TABLES` và ∉ allowlist; (3)
  parse migration 371 lấy danh sách bảng trong view == `EVIDENCE_ALLOWLIST_TABLES`.

  **Quyền schema (SA N26):** migration 371 thêm `GRANT USAGE ON SCHEMA
  trial_private TO service_role`, `GRANT SELECT ON
  trial_private.v_user_activation_evidence TO service_role`, và `ALTER DEFAULT
  PRIVILEGES FOR ROLE <owner migration> IN SCHEMA trial_private REVOKE ALL ON
  TABLES FROM PUBLIC, anon, authenticated` (lớp hai; REVOKE USAGE là rào chính).
  Test: `has_schema_privilege('service_role','trial_private','USAGE')` = true,
  `has_table_privilege('service_role', view, 'SELECT')` = true; job bất biến chạy
  được trên staging.

  **Thứ tự migration (SA N10, N19), một giao dịch:** `SET LOCAL lock_timeout =
  '5s'` → `SET LOCAL statement_timeout = '120s'` → `ALTER TABLE ADD COLUMN` (đã
  giữ ACCESS EXCLUSIVE tới commit, chặn cả SELECT `users` → chạy giờ thấp điểm) →
  `LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE` (thừa, vô hại) → tạo view
  dấu vết → `CREATE FUNCTION`/`CREATE TRIGGER` → backfill → **hậu điều kiện**:
  `RAISE EXCEPTION` nếu tồn tại hàng `first_activated_at IS NULL AND (is_active OR
  user_id ∈ v_user_activation_evidence)` (migration huỷ toàn bộ) → báo trong PR
  thời gian chạy trên staging, số user còn NULL, số `role IS NULL`. Không đạt
  `lock_timeout`/`statement_timeout` → migration huỷ, không sửa dở; chạy lại lúc
  thấp điểm.
  **Bất biến hằng ngày (T011):** cùng câu kiểm như hậu điều kiện; khác 0 → cảnh
  báo anh Vinh, job (chạy bằng service_role duy nhất) đặt runtime flag
  `trial_invariant_ok=false` → `trial_open()` trả `paused`; readiness
  `invariant_ok=false`. Cờ thiếu/không đọc được cũng là `paused` (SA N20).
- (SA N16) `trial_email_tombstones(email_norm_hash pk, ever_activated boolean,
  ever_trial boolean, created_at)`; RLS không policy.
- `trial_speaking_results(id uuid, user_id, request_key, question_id, transcript,
  grading jsonb, audio_path, created_at)`, `UNIQUE(user_id, request_key)`, RLS bật,
  không policy; lưu giữ như FR-033 (FD 05/11, FR-038). (SA N32) `user_id
  REFERENCES public.users ON DELETE CASCADE`; `audio_path` chỉ là object key
  trong bucket dùng thử private (không URL, không bucket public; CHECK không
  chứa `://`); job lưu giữ xoá hàng **và** object cùng lượt (xoá object trước,
  lỗi → giữ hàng để thử lại); `transcript`/`grading` không bao giờ ghi vào log,
  `error_logs` hay Sentry (lọc ở handler). Test: CHECK chặn URL; job xoá cả hai;
  xoá user cascade; log/handler lỗi không chứa transcript (fixture chuỗi đánh dấu).
- `trial_writing_submissions(id, user_id, prompt_id, task in (1,2), essay_text,
  word_count, input_log jsonb, forensic_score, filter_result, grading jsonb,
  created_at)` (bài dùng thử tách khỏi `writing_essays` để không lẫn số liệu lớp).
- RPC `fn_trial_reserve(user_id, kind, request_key, limits jsonb)` (khoá hàng
  `trial_accounts`, đếm, chèn `reserved`; trả `granted`/`reason`),
  `fn_trial_settle(user_id, reservation_id, outcome)` (FD 05/11, Codex #2252
  r4471860790): `fn_trial_reserve` trả `reservation_id` (= `trial_usage.id`);
  settle khoá đúng hàng `WHERE id = reservation_id AND user_id = $1 AND status =
  'reserved'`, 0 hàng → lỗi `reservation_not_found` (không đụng hàng khác), không
  bao giờ settle theo `request_key` đơn thuần. `SECURITY DEFINER`, `REVOKE ALL
  FROM PUBLIC, anon, authenticated`, chỉ `service_role` (theo FNEXEC-0045).
  (SA N30) (a) `SET search_path = pg_catalog, pg_temp`; mọi bảng/hàm viết đủ
  schema (`public.trial_usage`, `public.ai_budget_reservations`, ...) — áp cho cả
  `fn_trial_reserve`. (b) `outcome` thuộc enum đóng `settled | released |
  timeout_settled` (kiểu enum hoặc `CHECK`); giá trị khác → `RAISE`, không cập
  nhật. (c) Một câu `UPDATE public.trial_usage SET status = ..., settled_at =
  now() WHERE id = $2 AND user_id = $1 AND status = 'reserved' RETURNING ...`
  cùng giao dịch với settle `ai_budget`; 0 hàng → `reservation_not_found`, không
  trừ tiền/không hoàn lần hai. Backend coi `reservation_not_found` khi thử lại là
  idempotent: đọc trạng thái hiện có và trả kết quả đó. (d) Chi phí ghi vào ngân
  sách = `least(actual, reserved)`; phần vượt (`actual > reserved`) ghi
  `ai_usage_logs` đủ số thật để đối soát và bắn cảnh báo `trial_settle_overrun`
  (email admin + log), không bao giờ âm thầm vượt trần ngày qua reservation.
- RLS bật trên cả 7 bảng (thêm `trial_speaking_results`) `trial_accounts`, `trial_usage`, `trial_rate_events`,
  `trial_captcha_tokens`, `trial_email_tombstones`, `trial_writing_submissions`,
  không policy cho `anon`/`authenticated` (backend đọc bằng service role).
  Không lưu IP/email thô: HMAC-SHA256 với muối env
  `TRIAL_HASH_SALT`.
- T001 tạo bucket audio dùng thử riêng, **private** (FR-033); T007 dùng bucket
  này và chỉ ký URL sau khi xác thực chủ sở hữu, TTL ≤ 10 phút.
- Mở rộng scope trong cấu hình ngân sách (`ai_budget_reservations` đã có từ
  migration 333): thêm giá trị scope dùng thử và kiểu kỳ `total` (không theo
  tháng) nếu RPC hiện tại chưa hỗ trợ — T001 khảo sát, có thể cần sửa
  `fn_ai_budget_reserve` trong cùng migration `371`.
- Rollback code không cần migration down. Nếu cần down migration `371`, dừng
  route/job dùng thử và chốt reservation trước; chỉ gỡ bảng/RPC/view/schema và
  bucket riêng của dùng thử sau khi xử lý dữ liệu theo FR-033. Giữ
  `users.first_activated_at`, hàm `trg_users_first_activated_at()` và trigger
  `trg_users_zz_first_activated_at`: không xoá mốc đã backfill hoặc mất lịch sử
  kích hoạt đơn điệu của FR-001. Nếu `371` sửa `fn_ai_budget_reserve`, script
  down khôi phục đúng định nghĩa, chữ ký và quyền trước `371` (T001 lưu bản
  trước khi sửa); không xoá reservation/chi tiêu hay đổi scope nền tảng. Xem
  kiểm chứng rollback ở `verification.md`.

### API

| Method/Path | Mô tả | Lỗi |
| --- | --- | --- |
| `GET /api/trial/config` | công khai, không JWT: `{enabled, open, speaking_per_day, writing_per_day}` (không số USD); cache 60 s | — |
| `GET /api/trial/status` | `{eligible, open, reason?, reopens_at?, speaking:{left_today,left_total}, writing:{left_today,left_total,filter_left_today}}` | 401 |
| `POST /api/trial/activate` | body `{device_id, captcha_token}` (**bắt buộc**, FR-009; thiếu → 403 `captcha_failed`); tạo `trial_accounts` | 403 `trial_not_eligible`/`email_unverified`/`captcha_failed`, 429 `trial_limit` |
| `GET /api/trial/speaking/questions` | bộ đề dùng thử cố định | 403, 503 `trial_closed` |
| `POST /api/trial/speaking/answers` | multipart audio + `question_id` + `request_key` → kết quả chấm | 403, 413 `audio_too_long`, 422 `audio_too_short`, 429 `trial_quota`, 503 `trial_closed`/`trial_unavailable` |
| `GET /api/trial/writing/prompts` | đề Task 1/2 từ prompt bank (cờ dùng thử) | 403 |
| `POST /api/trial/writing/submissions` | `{prompt_id, essay_text, input_log, request_key}` | 422 `too_short`/`too_long`/`paste_suspected`/`low_quality`/`off_topic`, 429 `trial_quota`/`trial_filter_limit`, 503 |
| `GET /api/trial/writing/submissions/{id}` | kết quả của chính mình (FR-038: không cần eligibility/mở) | 401, 403 khoá, 404, 422, 503 kill switch |
| `GET /api/trial/speaking/results/{id}` | kết quả Speaking của chính mình (FR-038) | 401, 403 khoá, 404, 422, 503 kill switch |
| `GET /api/trial/history` | danh sách 30 ngày `{id, kind, created_at, band}` ≤ 50 (FR-038) | 401, 403 khoá, 503 kill switch |
| `GET /api/admin/trial/readiness` | chỉ boolean (FR-036) | 403 (admin + AAL2) |
| `GET/POST /api/admin/trial/*` | tổng hợp, chặn tài khoản/thiết bị | 403 (admin + AAL2) |

`503 trial_closed` có `reason ∈ {daily_cap,total_cap,paused}` và `reopens_at`
cho `daily_cap`. Mã lỗi khác `ai_budget_exhausted` của nền tảng.

`input_log` (FR-012): `{v:1, opened_ms, active_ms, windows:[{t, ins, del,
ins_events, bulk_ins, blocked_paste}], composition_events, final_len}`, tối đa
720 cửa sổ (1 giờ); lớn hơn → 422.

## UI and interaction

Xem `ui-states.md`. Baseline FD từ code: Speaking `speaking/page-shell.tsx`
(772 dòng) + `speaking-behavior.tsx` (1 149), kết quả
`speaking-result-behavior.tsx`; Writing `writing/dashboard/page-shell.tsx` +
`writing-behavior.tsx` (2 112 dòng, vá DOM trực tiếp, hợp đồng anti-paste CI).
Trang dùng thử là route mới, không vá vào `writing-behavior.tsx`, để hợp đồng
lớp thật không đổi. Sẽ chỉnh theo audit UIA.

## Work decomposition

Xem `tasks.md` (T001..T013, xếp theo phụ thuộc; các task cùng sửa `trial.py`
được tích hợp tuần tự).

### Điểm review chờ FD quyết định (PC-J658, PR #2252) — FD đã quyết 05/11

Quyết định: FR-011 (thread r4469775155), FR-020 + FR-038 (r4469775139, 404/503),
plan "Giữ chỗ" (r4471860800), `fn_trial_settle` (r4471860790), FR-038 +
`trial_speaking_results` (CR P3-1), FR-036 (CR P3-4 readiness). Chi tiết:
`/workspace/cc-jobs/handoff/project-coordinator/2026-11-04-J658-result.md` mục
"FD quyết định (05/11)". SA cần kiểm lại FR-020/FR-025/FR-038 và settle.

Các điểm dưới cần thay đổi hoặc chọn lại contract FR đã duyệt, nên PC-J658
giữ nguyên FR và các kiểm chứng tương ứng. FD cần PR spec-only riêng; không
coi đây là các điểm đã sửa hay receipt CODEX-CLEAN.

| Nhận xét | Mâu thuẫn/thiếu sót còn mở | Quyết định cần FD |
| --- | --- | --- |
| Codex [thread 4469775139](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2252#discussion_r4469775139) | FR-025 yêu cầu eligibility cho cả đọc kết quả; FR-020 đóng mọi route; Edge cases/UI vẫn cho xem bài cũ sau vào lớp/đóng chương trình | Tách quyền đọc lịch sử (JWT + ownership) khỏi eligibility và trạng thái mở; sửa FR-020/FR-025 và kiểm chứng cùng nhau |
| Codex [thread 4469775155](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2252#discussion_r4469775155) | FR-011 chặn `insertReplacementText`, FR-012 cho autocorrect/đọc chính tả ≤ 200 ký tự; kiểm chứng FR-011/FR-012 cũng mâu thuẫn | Chốt một chính sách client/server và sửa FR-011/FR-012 cùng fixture mobile |
| CR P3-1 | FR-022 nói lưu ở `trial_usage` nhưng schema chưa có payload kết quả Speaking; FR-031/UI yêu cầu lịch sử/reload mà API chỉ có GET kết quả Writing | Chốt nơi lưu và đường đọc Speaking, quyền sở hữu/retention; đối chiếu allowlist đúng 8 route của FR-025 trước khi thêm route |
| CR P3-4: readiness | FR-036 có cả `separate_keys_configured` và `trial_keys_separate` nhưng chưa phân biệt ý nghĩa | Chốt schema boolean; bỏ/đổi tên trường sẽ đổi contract FR-036 |
| CR P3-4: khi tắt cờ | FR-020 ghi 404, FR-035 yêu cầu 503 `trial_closed` cho route ghi | Chốt mã lỗi/phạm vi từng route (cùng ngoại lệ đọc lịch sử), sửa FR-020/FR-035 và kiểm chứng |

## Rollout and rollback

Xem `rollout.md`. Cờ `free_trial_enabled`, `speaking_ui_v2`, `writing_ui_v2`
mặc định TẮT; kill switch `TRIAL_KILL_SWITCH`.

## Verification strategy

- pytest (provider giả, PG thật cho RPC đồng thời), node test component,
  Playwright staging cho luồng dùng thử và luồng lớp thật song song, query chi
  tiêu sau 48 h staging. Xem `verification.md`.

## Rủi ro bảo mật (SA review)

| Rủi ro | Biện pháp | FR |
| --- | --- | --- |
| Tạo nhiều tài khoản để lấy thêm lượt | email xác minh, chuẩn hoá + chặn email dùng một lần, 1 tài khoản dùng thử/thiết bị, 3 kích hoạt/IP/ngày, 15 lượt chấm/IP/ngày, Turnstile, admin chặn; trần tổng là chốt chặn cuối | FR-007..FR-010, FR-004 |
| Vượt dán phía client (DevTools, gọi API thẳng, extension) | máy chủ không tin client: nhật ký nhập liệu bắt buộc, kiểm nhất quán ký tự/tốc độ/thời gian; thiếu log = nghi dán | FR-011, FR-012 |
| Giả mạo nhật ký nhập liệu bằng script | chấp nhận rủi ro dư: vẫn bị hạn mức lượt + trần; chỉ ảnh hưởng chất lượng dữ liệu, không vượt chi phí | FR-003, FR-004 |
| Chèn lệnh vào bài/transcript | khối dữ liệu có ranh giới, bộ lọc `prompt_injection`, kiểm schema + kẹp band | FR-013, FR-015 |
| Đốt chi phí (bài dài, audio dài, retry vô hạn, đồng thời) | tối đa chữ/thời lượng, 1 lần retry, giữ chỗ nguyên tử, trần hard fail-closed, kill switch | FR-003..FR-006, FR-016, FR-021 |
| Dùng thử chặn/chậm học viên lớp thật | route riêng, scope ngân sách riêng không chạm scope nền tảng, khuyến nghị API key riêng (Q-3), test FR-002 | FR-002, FR-004 |
| Rò rỉ dữ liệu cá nhân | chỉ lưu băm HMAC của email/IP/thiết bị, RLS không policy, RPC chỉ service_role, log không có nội dung | FR-008, FR-010 |
| Tự cấp quyền dùng thử qua REST Supabase | bảng không có policy cho `authenticated`, RPC bị REVOKE | T001 |

### Bổ sung bảo mật cho đường vào không mã (FR-023..FR-025) — SA review

- **Ranh giới kích hoạt:** tài khoản không mã giữ `is_active=false`. Không đổi
  `activation_gate` theo kiểu "cho qua nếu trial"; chỉ thêm từng cặp
  `(method, path)` chính xác của `/api/trial/*` vào `ACTIVATION_EXEMPT_ROUTES`,
  và mỗi route tự gọi `is_trial_eligible` + cờ. Test chụp danh sách exempt (đỏ nếu
  có route thêm ngoài danh sách). Rủi ro: thêm nhầm route lớp vào danh sách →
  mở tính năng trả phí cho tài khoản chưa kích hoạt.
- **Open redirect qua `next`:** chỉ đường dẫn nội bộ (FR-024), kiểm cả ở client
  sau OAuth; không đưa `next` vào `redirectTo` của Supabase.
- **Lộ thông tin qua route công khai:** `/api/trial/config` chỉ trả cờ + số lượt,
  không chi tiêu/USD/lý do đóng chi tiết; có rate limit IP.
- **Tài khoản chưa kích hoạt đọc dữ liệu qua REST Supabase:** không đổi RLS hiện
  có; bảng `trial_*` không có policy cho `authenticated`.
- **Nhiều tài khoản Google:** đăng nhập không mã làm việc tạo tài khoản dễ hơn →
  giới hạn FR-007..FR-009 và trần tổng là chốt chặn; SA review 04/11: Turnstile **bắt buộc** từ ngày mở
  (FR-009, Q-5).

## Đề xuất UIA để sau / tuỳ chọn (không thuộc FR của spec này)

- **Should (đợt sau, ticket riêng khi có quota):** S1 hub Speaking cho tài khoản
  có lịch sử; S2 lịch sử Speaking dạng thẻ < 640 px; S3 tab Writing mobile; S4
  cảnh báo nháp/focus/skip-link/tự cuộn; S5 thống nhất số buổi và nhãn quá hạn;
  S6 CLS < 0,1 ở /home và /onboarding; S7 nút "Làm bài" có trạng thái tải/lỗi;
  S8 Kho đề tìm kiếm/"Xem thêm"/nhãn tiếng Việt; S9 component lỗi chung.
  T009/T010 có thể làm S1–S4/S7/S8 nếu không làm to ticket; nếu không, PC tách
  ticket sau.
- **Could (tuỳ chọn):** C1 "Ví dụ kết quả" động trên landing; C2 Việt hoá panel
  /login, landing, tag Mẹo viết; C3 thống nhất tên/xưng "bạn"; C4 ẩn "Bị đánh
  dấu" khi 0; C5 trang /pricing thật.

## Xử lý review SA 04/11 15:08

| SA | Mức | Xử lý |
| --- | --- | --- |
| F1 tài khoản bị khoá/học viên cũ thành eligible | P1 | FR-001 viết lại: chưa từng kích hoạt (`is_active=false`, `access_code_used` null, `permissions` rỗng, không `access_codes.used_by`, không `access_code_audit`) + `suspended_at IS NULL`; Q-15 |
| F2 cơ chế miễn trừ | P2 | FR-025: 8 cặp chính xác, chỉ khi route khớp, route tự kiểm JWT+eligibility, test đường dẫn lạ; T013 |
| F3 `next` | P2 | FR-024: `safeNext()` chi tiết, allowlist tiền tố, kiểm lại khi đọc; T013 |
| F4 `/config` công khai | P3 | FR-034 |
| F5 sybil | P1→P2 | FR-009 Turnstile bắt buộc + kill condition; FR-007 chuẩn hoá; FR-008 device mềm, X-Real-IP, trần 100 kích hoạt/ngày, cảnh báo /24/ASN; Q-5, Q-16 |
| F6 chặn dán là UX | P3 | FR-012: tín hiệu mềm, chỉ từ chối khi tín hiệu mạnh, schema trước khi phân tích |
| F7 chi phí | P2 | FR-003 thứ tự một RPC, request_key, 1 lượt/tài khoản; FR-004 cửa sổ 4 giờ + key riêng; FR-013 giới hạn ký tự, Haiku giữ chỗ; FR-016 ≤ 3 MB + ffprobe; Q-2, Q-3 |
| F8 IDOR/PII | P2 | FR-033; Q-17 |
| F9 CSRF | P3 | FR-034: chỉ Bearer, không cookie |
| F10 prompt injection | P3 | FR-015: không trả prompt hệ thống, hiển thị text thuần |

## Xử lý retest SA 04/11 15:16 (N1–N8)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N1 "chưa từng kích hoạt" sót đường admin (`routers/admin.py:2649`, `code` có thể NULL) | P2 | `users.first_activated_at` đơn điệu + trigger + backfill bảo thủ (migration 371); FR-001(b); T001, T002, T003, T013 |
| N2 FR-012 tự mâu thuẫn | P2 | FR-012 viết lại thành một bảng quy tắc mạnh/mềm, sửa edge case đọc chính tả, verification FR-012 |
| N3 paused phải chặn mọi route ghi | P2 | FR-035 `trial_open()`; FR-021 kill switch mọi giá trị ≠ off là BẬT |
| N4 điều kiện mở prod không kiểm được | P3 | FR-036 readiness chỉ boolean; rollout Production |
| N5 plan lệch spec | P2 | `UNIQUE(user_id, request_key)` + tra cứu lọc user; `captcha_token` bắt buộc; bảng `trial_captcha_tokens` trong DB |
| N6 allowlist `next` theo ranh giới đoạn | P3 | FR-024 |
| N7 test chưa có chủ | P3 | `test_trial_data.py` → T006 (IDOR) + T007 (bucket), `test_trial_retention.py` → T011, `test_trial_config.py` → T013, `test_trial_readiness.py` → T011 |
| N8 timeout trả lượt | P3 | FR-037 giám sát + tự chặn; nguồn ASN = MaxMind GeoLite2 ASN offline trong T003 |

## Xử lý retest SA lần 2, 04/11 15:23 (N9–N16)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N9 role thực tế là `user` | P1 | FR-001(a) `role IN ('user','student')`, NULL → từ chối (Q-19); backfill chỉ `role IN ('instructor','admin')`; test tài khoản mới qua `/auth/me` eligible |
| N10 race backfill/trigger | P2 | một giao dịch: thêm cột → LOCK SHARE ROW EXCLUSIVE → trigger → backfill → hậu điều kiện RAISE; bất biến hằng ngày T011; mở rộng dấu vết (cohort memberships, mọi bảng học tập, `ai_usage_logs`) |
| N11 body đọc trước dependency | P2 | FR-035: handler nhận `Request` thô, thứ tự kiểm rồi mới parse; giới hạn 3 MB/64 KB/4 KB ở `RequestSafetyMiddleware`; test `receive` không bị đọc |
| N12 NULL/thiếu hàng + khoá riêng | P2 | FR-001(f) kiểm chặt; FR-035 khoá dùng thử thiếu/trùng khoá nền tảng → paused |
| N13 trigger rõ ràng | P3 | nhánh `TG_OP`, tên/thứ tự, SECURITY INVOKER, search_path, REVOKE, test |
| N14 không phạt timeout provider | P3 | FR-037 chỉ đếm client ngắt kết nối; Q-18 cập nhật |
| N15 nguồn provider/email | P3 | FR-001(d) chỉ `app_metadata`/`identities`, không `user_metadata` |
| N16 xoá cứng + đăng ký lại | P3 | `trial_email_tombstones` (migration 371), FR-001(e), FR-033 |

## Xử lý retest SA lần 3, 04/11 15:29 (N17–N20)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N17 trigger xoá mốc backfill của học viên cũ | P1 | nhánh INSERT/UPDATE theo `coalesce` (chỉ NULL → giá trị), bảng chân trị + bảng backfill qua trigger; hậu điều kiện và bất biến kiểm cả hàng không active có dấu vết qua view dấu vết dùng chung; test backfill sau khi trigger đã có |
| N18 middleware chỉ giới hạn multipart | P2 | FR-035: giới hạn theo (method, path) không phụ thuộc Content-Type; 415 sai Content-Type trước khi đọc body; test JSON 65 KB, Content-Type giả, chunked không CL × 3 route |
| N19 thời gian khoá | P3 | `SET LOCAL lock_timeout '5s'`, `statement_timeout '120s'`, EXISTS + index, chạy thấp điểm, ghi thời gian staging trong PR |
| N20 cờ bất biến thiếu | P3 | FR-035: `trial_invariant_ok` thiếu/đọc lỗi → paused; job chỉ service_role |

## Xử lý retest SA lần 4, 04/11 15:34 (N21–N24)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N21 tập dấu vết bắt cả tài khoản chưa kích hoạt | P2 | danh sách cho phép tường minh (bảng "Tập dấu vết" ở plan.md, đối chiếu `ACTIVATION_EXEMPT_ROUTES` 5a08978b0) + danh sách loại trừ (analytics, error, feedback, activation_attempts, share-link, `trial_*`, `ai_usage_logs` trial_*); FR-001(b); test không đóng dấu + bất biến = 0; snapshot test quy tắc tương lai |
| N22 mốc dự phòng có thể NULL | P3 | `earliest = coalesce(min, created_at, now())` |
| N23 thiếu test quyền view | P3 | view trong schema `trial_private` không expose, REVOKE schema + view, test `has_table_privilege` false + hồi quy khi tạo lại view |
| N24 chi tiết FR-035 | P3 | so media type (bỏ tham số, không phân biệt hoa thường), multipart thiếu boundary → 400; câu "nguồn của `open`" đặt lại đúng chỗ |

## Xử lý retest SA lần 5, 04/11 15:41 (N25–N27)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N25 pipeline dùng lại ghi bảng dấu vết | P2 | FR-022(a)(b)(c) + FR-002; bỏ `grading_attempts`/`ai_usage_logs` khỏi allowlist; bảng "Truyền feature" (file → ticket); contextvar `trial_request` + `trial_unlabeled`; E2E evidence = 0; T002/T006/T007 |
| N26 quyền schema `trial_private` | P3 | GRANT USAGE/SELECT cho service_role, ALTER DEFAULT PRIVILEGES; bước rollout xác nhận schema không expose + `Accept-Profile` bị từ chối |
| N27 snapshot mơ hồ | P3 | `REVIEWED_EXEMPT_ROUTES` + `EXEMPT_ROUTE_WRITES` + `EVIDENCE_EXCLUDED_TABLES` trong `trial_evidence.py`, 3 test |

## Xử lý SA retest 7, 05/11 (N28–N34)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N28 | P2 | `trial_speaking_results` vào `EVIDENCE_EXCLUDED_TABLES`; verification 7 bảng + privilege anon/authenticated = false |
| N29 | P2 | FR-038: `no-store, private` + `Vary: Authorization`; 60 đọc/phút/user, bộ đếm lỗi → 429 |
| N30 | P2 | settle: search_path pg_catalog, pg_temp + schema đủ; enum đóng; một UPDATE…RETURNING; least(actual, reserved) + `trial_settle_overrun` |
| N31 | P3 | test FR-025 trừ 3 route đọc; `EXEMPT_ROUTE_WRITES` thêm 2 cặp đọc |
| N32 | P3 | cascade, object key private + CHECK, job xoá hàng + object, không log transcript |
| N33 | P3 | thứ tự kiểm: kill switch → JWT → khoá → cờ → trial_open → eligibility → rate limit → body |
| N34 | P3 | tín hiệu mạnh mới (>30 % ký tự không gõ phím, ≥ 3 lần chèn > 100); cờ chỉ máy chủ tính |

## Xử lý SA retest 8, 05/11 (N35–N37)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N35 | P2 | ngưỡng 30 % chỉ tính lần chèn > 30 ký tự hoặc > 1 từ; commit từng từ → assisted_input; fixture Gboard/Telex/6×180 |
| N36 | P3 | `read_user` cửa sổ 1 phút, khoá HMAC(user_id), upsert nguyên tử, dọn sau 1 ngày |
| N37 | P3 | verification FR-025: 10 cặp, trừ config và 3 route đọc FR-038 |

## Xử lý SA retest 9, 05/11 (N37–N38)

| SA | Mức | Xử lý |
| --- | --- | --- |
| N37 | P3 | verification FR-025: thêm ngoại lệ 3 route đọc FR-038 vào câu JWT+eligibility (T013) |
| N38 | P3 | tín hiệu mạnh: word_commits > 80 % số từ + (fast_typing hoặc short_duration) → paste_suspected; fixture script 50 ms/từ và Gboard 40 wpm (T006) |
