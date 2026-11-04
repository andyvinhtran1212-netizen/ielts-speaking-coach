# Tasks

Tasks are dependency ordered. Không task nào được xếp hàng trước khi spec
được anh Vinh duyệt trên `staging`. Mỗi task là một PR nhỏ, có test đỏ trước.
Cỡ: S ≈ ≤ 0,5 ngày job, M ≈ 1 ngày, L ≈ 2 ngày. Gợi ý: Claude cho phần cần
thiết kế/UX/viết tiếng Việt, Codex cho phần cơ học có test rõ.

`backend/routers/trial.py` là file dùng chung: tích hợp tuần tự **T002 → T003 →
T007 → T006 → T013**, không cho hai ticket ghi file cùng lúc. Phần `(status)`/
`(activate)`/`(speaking)`/`(writing)`/`(config)` trong `owns` chỉ phạm vi handler,
không phải quyền sửa file song song; các file khác theo phụ thuộc bên dưới.

- [ ] T001 Bảng + RPC dùng thử, migration `371` (Leader cấp 04/11):
  `trial_accounts`, `trial_usage`, `trial_rate_events`,
  `trial_writing_submissions`, `trial_captcha_tokens`, `users.first_activated_at`
  + trigger theo `TG_OP` chỉ NULL → giá trị (bảng chân trị plan.md, SA N17)
  + view dấu vết dùng chung `trial_private.v_user_activation_evidence` (danh sách
  cho phép + loại trừ tường minh, `earliest` không NULL, schema không expose —
  SA N21–N23) + `lock_timeout`/
  `statement_timeout` (SA N19) (tên `trg_users_zz_first_activated_at`, SECURITY
  INVOKER, search_path, REVOKE) + trong một giao dịch: LOCK SHARE ROW EXCLUSIVE →
  trigger → backfill bảo thủ (theo danh sách cho phép ở plan.md) → hậu điều kiện RAISE (SA N1, N9, N10, N13),
  `trial_email_tombstones` (SA N16), `UNIQUE(user_id, request_key)`
  (SA N5a), `fn_trial_reserve`, `fn_trial_settle`, RLS, REVOKE; mở rộng scope ngân sách dùng thử;
  tạo bucket audio dùng thử riêng **private** (FR-033). Ghi rõ rollback theo
  `plan.md`: giữ cột/mốc `users.first_activated_at` và trigger/hàm đơn điệu;
  nếu sửa `fn_ai_budget_reserve` thì lưu và khôi phục đúng định nghĩa/quyền cũ.
  Test PG: 10 reserve đồng thời / 1
  lượt → 1 granted; trigger false→true đặt mốc, true→false giữ, đặt NULL bị bỏ
  qua; INSERT is_active=true → có mốc; service_role UPDATE đặt NULL → giữ;
  authenticated UPDATE → 42501; backfill: admin kích hoạt `code=null` rồi tắt →
  có mốc; **backfill chạy sau khi trigger đã tồn tại** đặt mốc cho học viên cũ
  đã tắt và mốc còn sau commit (đỏ với nhánh UPDATE cũ — SA N17); UPDATE sau đó
  đặt NULL/giá trị khác → giữ mốc; INSERT có sẵn mốc với is_active=false → giữ;
  hậu điều kiện huỷ migration khi hàng không active có dấu vết mà NULL;
  tài khoản chưa kích hoạt chỉ có analytics/error_logs/
  user_feedback/activation_attempts/share-link/`trial_*`/`ai_usage_logs` trial_*
  → **không** đóng dấu, bất biến = 0 (SA N21); Reading attempt có chủ hoặc
  `sessions` → đóng dấu; chỉ `ai_usage_logs`/`grading_attempts` → không (SA N25); `created_at` NULL → mốc = now(),
  hậu điều kiện không lỗi (SA N22); `has_table_privilege` anon/authenticated trên
  view và `USAGE` schema `trial_private` = false (SA N23); service_role USAGE/
  SELECT = true (SA N26); `trial_evidence.py` + 3 test snapshot (SA N27); snapshot danh sách cho
  phép ↔ `ACTIVATION_EXEMPT_ROUTES` (SA N21); `role='user'` không dấu vết → NULL (không bị đóng dấu); instructor/admin
  → có mốc; hậu điều kiện làm migration huỷ khi còn active chưa có mốc; key của user khác
  không trả hàng; anon/authenticated không đọc/gọi được; rollback giữ mốc/trigger
  và khôi phục RPC ngân sách nếu có sửa; bucket private, client không truy cập
  trực tiếp audio. **M, Codex.**
  `owns: backend/migrations/371_free_trial.sql, backend/migrations/rollback/371_*.sql, backend/tests/test_migration_371_free_trial.py`
- [ ] T002 `trial_service`: eligibility (FR-001: `role IN ('user','student')`, NULL
  → từ chối, `first_activated_at IS NULL` + `suspended_at IS NULL`, kiểm chặt
  thiếu hàng/NULL/thiếu khoá — SA N9, N12; provider/email từ `app_metadata`/
  `identities` — SA N15; tombstone — SA N16; contextvar `trial_request` +
  `ai_usage_logger` không bao giờ ghi feature lớp trong request dùng thử →
  `trial_unlabeled` + test — SA N25), handler `Request` thô + thứ tự kiểm
  trước parse + giới hạn kích thước theo (method, path), không phụ thuộc
  Content-Type, trong `RequestSafetyMiddleware` + 415 sai Content-Type (SA N11,
  N18), khoá API dùng thử riêng bắt buộc (SA N12), `trial_open()` (FR-035), kill switch
  ≠ off là bật (FR-021), giữ chỗ/chốt lượt (FR-003 + SA F7: một RPC, request_key UUIDv4 theo user,
  1 lượt đang chạy/tài khoản, cửa sổ 4 giờ),
  scope trần dùng thử hard theo ngày/tổng (FR-004), chuỗi provider chỉ
  Anthropic/OpenAI (FR-005), cờ + kill switch (FR-020, FR-021),
  `/api/trial/status`. Test: bảng eligibility, học viên lớp không bị ảnh hưởng
  (FR-002). **M, Claude.** `depends: T001`
  `owns: backend/services/trial_service.py, backend/services/ai_budget_config.py (trial scopes), backend/routers/trial.py (status), backend/tests/test_trial_service.py, backend/tests/test_trial_open.py, backend/services/request_safety.py (giới hạn route dùng thử), backend/tests/test_trial_body_limits.py, backend/tests/test_trial_eligibility.py`
- [ ] T003 Chống lạm dụng kích hoạt (FR-007..FR-010, SA F1/F5): chuẩn hoá email
  (dấu chấm chỉ Gmail), danh sách email dùng một lần, giới hạn IP (dùng chung DB,
  không in-memory), device_id chỉ tín hiệu mềm, trần toàn site 100 kích hoạt/ngày,
  cảnh báo /24-ASN-tốc độ, **Turnstile bắt buộc** (siteverify, hostname, action,
  dùng một lần, fail-closed; thiếu cấu hình → `paused`), `activate` gọi `trial_open()` rồi
  `is_trial_eligible` (FR-001 theo `first_activated_at`: bị khoá/đã từng kích
  hoạt kể cả qua admin `code=null` → 403), token chống dùng lại ở
  `trial_captcha_tokens` (DB), cảnh báo ASN dùng MaxMind GeoLite2 ASN **offline**
  (file trong image, không gọi dịch vụ ngoài; thiếu file → chỉ tắt cảnh báo ASN),
  giám sát ngắt kết nối FR-037 (chỉ client disconnect, SA N14), route admin chặn. **M, Codex** (SA review). `depends: T002`
  `owns: backend/services/trial_abuse.py, backend/data/disposable_email_domains.txt, backend/routers/trial.py (activate), backend/routers/admin_trial.py, backend/tests/test_trial_abuse.py`
- [ ] T004 [P] Writing chặn dán phía client + nhật ký nhập liệu (FR-011, FR-012
  phần client): component `TrialEssayEditor` (paste/drop/beforeinput/autofill,
  IME), sinh `input_log`. **S, Codex.** `depends: T001`
  `owns: frontend/components/trial/TrialEssayEditor.tsx, frontend/lib/trial/input-log.mjs, frontend/tests/trial-essay-editor.test.mjs`
- [ ] T005 Phát hiện dán phía máy chủ (FR-012): `trial_input_forensics`, fixture
  gõ thật/dán/tốc độ/lệch/thiếu log, ngưỡng cấu hình. **S, Codex.**
  `depends: T001` `owns: backend/services/trial_input_forensics.py, backend/tests/fixtures/trial_input_logs/, backend/tests/test_trial_input_forensics.py`
- [ ] T006 Cổng lọc trước chấm + route nộp Writing (FR-013, FR-014, FR-015,
  FR-033 IDOR/UUID; schema `input_log` trước phân tích):
  số chữ, kiểm cục bộ, Haiku phân loại, hạn mức lọc, gọi grader Writing với
  scope dùng thử, lưu `trial_writing_submissions`. SA N25: `gemini_writing_grader`
  nhận `anthropic_feature` từ tham số (`trial_writing_grading`), lọc ghi
  `trial_writing_filter`; không ghi `writing_*`/`students`/`grading_attempts`;
  test E2E Writing (provider giả) → evidence view không có hàng, bất biến = 0.
  **M, Claude.**
  `depends: T002, T005, T007`
  `owns: backend/services/trial_prefilter.py, backend/routers/trial.py (writing), backend/services/gemini_writing_grader.py (feature param), backend/tests/test_trial_writing_submit.py, backend/tests/test_trial_data.py (IDOR/UUID)`
- [ ] T007 Route Speaking dùng thử (FR-016, FR-033: ≤ 3 MB, ffprobe, bucket
  private + signed URL): bộ đề cố định, kiểm thời lượng,
  Whisper + grader với scope dùng thử, không Azure/Gemini. SA N25: kwarg
  `feature` ở `claude_grader` (1058/1514), STT (`grading.py:641`), judge riêng
  `trial_off_topic_judge`; không gọi `record_grading_attempt`/
  `enforce_grading_rate_limit`, không ghi `sessions`/`responses`; test E2E 1
  Speaking + 1 Writing (provider giả) → `trial_private.v_user_activation_evidence`
  không có hàng, bất biến = 0, mọi `ai_usage_logs` `trial_*`. **M, Codex.**
  `depends: T002, T003` `owns: backend/routers/trial.py (speaking), backend/services/claude_grader.py (feature kwarg), backend/services/off_topic_judge.py (factory), backend/routers/grading.py (tách STT, không đổi hành vi lớp), backend/tests/test_trial_evidence_e2e.py, backend/data/trial_speaking_questions.json, backend/tests/test_trial_speaking.py, backend/tests/test_trial_data.py (bucket private/signed URL)`
- [ ] T008 UI dùng thử + trạng thái đóng (FR-017, FR-027, FR-030, FR-031,
  FR-032 cho màn dùng thử; UIA M5, M6, M9, M10, M11): `TrialStatusCard`, trang
  `/trial/speaking`, `/trial/writing`, lời nhắn Q-8, mọi state ở
  `ui-states.md`. **M, Claude.** `depends: T002, T004` (dùng API giả tới khi
  T006/T007 xong)
  `owns: frontend/app/(authed-trial)/**, frontend/components/trial/TrialStatusCard.tsx, frontend/tests/trial-ui.test.mjs`
- [ ] T009 [P] Speaking: bước đầu 1 CTA + chip chủ đề (FR-028, UIA M7), mồi
  micro 4 trạng thái (FR-029, UIA M8), revamp sau cờ `speaking_ui_v2` (FR-018);
  Should S1/S2/S4/S7 chỉ khi còn trong cỡ. **M, Claude.** Không phụ thuộc
  backend (dùng API giả nếu T007 chưa xong).
  `owns: frontend/app/(authed-speaking)/**, frontend/app/(authed-speaking-result)/**`
- [ ] T010 [P] Writing tự luyện cho người dùng thử: chọn Task → đề/"Đề ngẫu
  nhiên" → màn soạn, nút "Viết bài này" trong Kho đề, ẩn mục lớp (FR-026, UIA
  M4); revamp sau cờ `writing_ui_v2` (FR-019), giữ hợp đồng anti-paste lớp
  thật. **M, Claude.** `depends: T004`
  `owns: frontend/app/(authed-writing)/**, frontend/app/(authed-writing-result)/**`
- [ ] T011 Quan sát + admin usage dùng thử (FR-022), cảnh báo 50/80/100 %
  (FR-006), cảnh báo kích hoạt bất thường (FR-008), job dọn dữ liệu 30/90 ngày
  (FR-033), bất biến hằng ngày `is_active AND first_activated_at IS NULL` = 0
  → đặt `trial_invariant_ok` (SA N10), dùng cùng view dấu vết, kiểm cả hàng
  không active có dấu vết (SA N17); chỉ job service_role đặt cờ (SA N20). **S, Codex.** `depends: T002`
  `owns: backend/routers/admin_trial.py (usage), frontend/app/(authed-admin-usage)/** (trial panel), backend/tests/test_trial_usage_report.py, backend/jobs/trial_retention.py, backend/tests/test_trial_retention.py, backend/tests/test_trial_readiness.py, backend/routers/admin_trial.py (readiness), backend/jobs/trial_invariant.py, backend/tests/test_trial_invariant.py`
- [ ] T012 Kiểm thử staging đầu-cuối + SA retest + chạy 48 h shadow, đối chiếu
  chi phí thật với ước tính. Bắt buộc kiểm thêm các màn UIA chưa kiểm (mục f
  của UIA-SW-UX-20261104): màn câu hỏi/ghi âm/hộp quyền micro thật/"Đang
  chấm…" Speaking; màn soạn và kết quả Writing có dữ liệu; đăng nhập Google +
  kích hoạt mã + tạo tài khoản mới (tài khoản test Google); thiết bị thật iOS
  Safari/Android và trình duyệt in-app Zalo/Facebook; giao diện tối; tải
  PDF/nghe lại audio. Đo lại `measure()` (FR-032) và LCP (FR-031).
  **S, Claude (QA).** `depends: T003, T006, T007, T008, T009, T010, T011, T013`


- [ ] T013 Đường vào không mã + giữ `next` (FR-023, FR-024, FR-025; UIA M1, M2,
  M3): CTA landing → `/trial/*` sau cờ, `/login` không bắt buộc mã (mã tuỳ chọn),
  `safeNext()` theo FR-024 (giải mã một lần, allowlist tiền tố, kiểm lại khi đọc
  sessionStorage), bỏ onboarding cho người từ `/trial/*`, thêm **đúng 8 cặp**
  (method, template) vào `ACTIVATION_EXEMPT_ROUTES`, miễn trừ chỉ khi route đã
  khớp (bỏ dự phòng `request.url.path`), snapshot test + test mọi route
  `/api/trial` (trừ config) có JWT + `is_trial_eligible` + test đường dẫn lạ
  (FR-025, SA F2); tài khoản bị khoá/đã từng kích hoạt (theo
  `first_activated_at`, đọc phía máy chủ) thấy trạng thái `not_eligible`, không thấy CTA bắt đầu (FR-001); route công khai
  `/api/trial/config` schema cố định + cache + rate limit chung (FR-034);
  `safeNext` so tiền tố theo ranh giới đoạn (SA N6). **S, Codex** (SA review). `depends: T002, T006`
  `owns: frontend/lib/login-model.mjs, frontend/app/(public-auth)/login/**, frontend/app/(marketing)/page.tsx (CTA), backend/services/activation_gate.py, backend/routers/trial.py (config), frontend/tests/login-next.test.mjs, backend/tests/test_activation_gate_trial_exempt.py, backend/tests/test_trial_config.py`

Lịch gợi ý theo quota tuần (reset 08/11): T001 → T002 → T003 → T007 → T006 →
T013 → T008 → T011 → T012; T004/T005 song song sau T001, nhưng phải xong trước
task phụ thuộc chúng. T009/T010 xếp bất cứ lúc nào còn quota (T010 sau T004).
