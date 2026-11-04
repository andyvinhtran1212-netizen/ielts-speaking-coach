# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_trial_service.py (SA F1 bảng: mới chưa mã → eligible; suspended_at khác null → 403; lớp lưu trữ → 403; đã kích hoạt rồi tắt → 403; access_codes.used_by có hàng → 403; access_code_audit có hàng → 403; active → 403; giáo viên/admin → 403; email chưa xác minh/provider khác google → 403; lỗi DB → 503) + SA N1: admin kích hoạt code=null rồi tắt → 403; backend/tests/test_migration_371_free_trial.py trigger đơn điệu + backfill bảo thủ + backend/tests/test_trial_eligibility.py (SA N9/N12/N15/N16: tài khoản mới /auth/me role='user' is_active=false không dấu vết → eligible; role student → eligible; role NULL → 403 + log; thiếu hàng users → 403; is_active NULL → 403; thiếu khoá first_activated_at → 503; provider chỉ trong user_metadata → 403; email trong trial_email_tombstones ever_activated → 403) + test_migration_371_free_trial.py (SA N10/N13: trigger INSERT/UPDATE theo TG_OP, service_role đặt NULL giữ, authenticated 42501; backfill role user không dấu vết → NULL, instructor/admin → mốc; hậu điều kiện RAISE; LOCK trước trigger) + SA N17: mọi dòng bảng chân trị trigger trong plan.md (13 dòng) là một ca test PG; backfill chạy sau khi trigger tồn tại đặt mốc cho học viên cũ is_active=false và mốc còn sau commit, UPDATE sau đó không xoá được (đỏ với nhánh UPDATE cũ); hậu điều kiện RAISE khi hàng không active có dấu vết mà NULL + SA N21: tài khoản chưa kích hoạt có hàng analytics_events/error_logs/user_feedback/activation_attempts/share-link reading/trial_*/ai_usage_logs trial_* → không đóng dấu, bất biến = 0; Reading có chủ hoặc sessions → đóng dấu; chỉ ai_usage_logs/grading_attempts → không đóng dấu (SA N25); snapshot danh sách cho phép ↔ ACTIVATION_EXEMPT_ROUTES; SA N22: created_at NULL → earliest = now(), không NULL + SA N27: set(ACTIVATION_EXEMPT_ROUTES)==REVIEWED_EXEMPT_ROUTES; EXEMPT_ROUTE_WRITES ⊆ EVIDENCE_EXCLUDED_TABLES và ∉ allowlist; bảng trong view migration 371 == EVIDENCE_ALLOWLIST_TABLES; SA N26: service_role USAGE/SELECT = true | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_trial_service.py (trần dùng thử chạm + TRIAL_KILL_SWITCH bật → POST /sessions/{id}/responses và /my-assignments/{id}/submit vẫn chấm; không truy vấn bảng trial_*) + journey staging song song + SA N25: đường lớp vẫn ghi speaking_grading/writing_grading/grading_attempts như cũ (không hồi quy) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_371_free_trial.py (PG: 10 reserve đồng thời, 1 lượt → 1 granted; lỗi hệ thống → released) + test_trial_service.py (DB lỗi → 503, provider giả không gọi) + SA F7: request_key trùng → 1 lần gọi provider; 2 request song song một tài khoản → 1 chạy, 1 nhận 409; retry dùng cùng reservation + SA N5a: request_key của user khác → không trả kết quả, tạo lượt mới hoặc 409 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_trial_service.py (daily_cap, total_cap, RPC timeout → từ chối; chi dùng thử không cộng scope nền tảng; đồng thời không vượt trần quá 1 ước tính) + cửa sổ 4 giờ chặn đúng 1/6 + phần dư | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_trial_writing_submit.py (Anthropic lỗi 2 lần → released, Gemini không được gọi) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_trial_service.py (status theo reason, reopens_at 00:00 giờ VN; cảnh báo 80 % gửi 1 lần) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_trial_abuse.py (chuẩn hoá Gmail dấu chấm/+alias, domain dùng một lần → 403) + chỉ Gmail bỏ dấu chấm | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_trial_abuse.py (lần kích hoạt thứ 4/IP → 429; 2 tài khoản/thiết bị → 429; chỉ lưu băm HMAC) + lần kích hoạt 101/ngày → 429; bộ đếm DB dùng chung giữa 2 worker | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_trial_abuse.py (cờ captcha bật, token thiếu/sai → 403, không tạo trial_accounts) + SA F5d: hostname/action sai, token dùng lại, siteverify timeout → 403; thiếu cấu hình Turnstile → status paused + token dùng lại giữa 2 worker bị chặn bởi trial_captcha_tokens; captcha_token thiếu → 403 | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_trial_abuse.py (route admin cần admin + AAL2; log không có email/IP thô) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/trial-essay-editor.test.mjs (paste/drop/beforeinput insertFromPaste/insertReplacementText → nội dung không đổi; IME composition được đếm là gõ) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_trial_input_forensics.py (bảng quy tắc duy nhất SA N2: gõ thật → chấm, không cờ; thiếu log / một lần chèn > 200 / lệch > 30 % → paste_suspected trước provider; > 600 cpm → chấm + fast_typing; IME/autocorrect/Gboard/đọc chính tả ≤ 200 → chấm + assisted_input; thời gian ngắn → chấm + short_duration; input_log trường lạ/> 720 cửa sổ/> 64 KB → 422 trước phân tích) | PENDING |
| FR-013 | kind=test; ref=backend/tests/test_trial_writing_submit.py (fixture thiếu chữ T1<150/T2<250, quá dài, vô nghĩa, lặp, lạc đề, chèn lệnh → bị lọc, grader giả không gọi) + bài > 7 000 ký tự → 422 trước model; Haiku có reservation | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_trial_writing_submit.py (3 bài lọc → lần 4 trong ngày 429 trial_filter_limit; lượt chấm nguyên) | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_trial_writing_submit.py (bài chèn lệnh không tăng band; output sai schema/band ngoài 0–9 → lỗi, released) + không có prompt hệ thống trong response; HTML trong output hiển thị như text | PENDING |
| FR-016 | kind=test; ref=backend/tests/test_trial_speaking.py (audio 180 s → 413 trước Whisper; 2 s → 422, lượt nguyên; không gọi Azure/Gemini) + body > 3 MB → 413; metadata thời lượng giả không qua ffprobe | PENDING |
| FR-017 | kind=test; ref=frontend/tests/trial-ui.test.mjs (mỗi trạng thái ui-states.md: còn lượt, hết lượt, daily_cap, total_cap, paused, email_unverified, không render cho học viên lớp) | PENDING |
| FR-018 | kind=test; ref=screenshot 360/768/1280 sáng/tối + axe + frontend tests speaking-behavior hiện có pass với speaking_ui_v2 bật/tắt | PENDING |
| FR-019 | kind=test; ref=screenshot 360/768/1280 + axe + test hợp đồng anti-paste writing-behavior hiện có pass với writing_ui_v2 bật/tắt | PENDING |
| FR-020 | kind=test; ref=backend/tests/test_trial_service.py (cờ thiếu/đọc lỗi → đóng; UI không render) | PENDING |
| FR-021 | kind=test; ref=backend/tests/test_trial_open.py (TRIAL_KILL_SWITCH on/1/yes/garbage → paused, không gọi provider; không đặt/off/' OFF ' → không chặn; AI_KILL_SWITCH bật → paused) | PENDING |
| FR-022 | kind=test; ref=backend/tests/test_trial_usage_report.py (feature trial_* được log; tổng hợp theo provider/ngày/tổng) + SA N25: backend/tests/test_trial_evidence_e2e.py — provider giả, 1 Speaking + 1 Writing dùng thử → evidence view 0 hàng, bất biến = 0, first_activated_at NULL, mọi ai_usage_logs trial_*, không hàng grading_attempts/sessions/writing_essays; contextvar trial_request + feature lớp → trial_unlabeled | PENDING |
| FR-023 | kind=test; ref=Playwright 1280/375/360 (từ / 1 lần bấm tới màn chọn câu/đề; không redirect /login trước bắt đầu ghi âm/viết; cờ TẮT → CTA cũ) | PENDING |
| FR-024 | kind=test; ref=frontend/tests/login-next.test.mjs (https://evil.com, //evil.com, /\\evil.com, javascript:, %2F%2Fevil.com → /home; /speaking → /speaking; giữ qua OAuth; bỏ onboarding từ /trial/*) + SA F3: /%5Cevil.com, /%2F%2Fevil.com, %252F%252F, /\t/evil.com, /login?next=…, ngoài allowlist → /home; kiểm lại khi đọc sessionStorage + SA N6: /speakingX, /homeevil, /trialx → /home | PENDING |
| FR-025 | kind=test; ref=backend/tests/test_activation_gate_trial_exempt.py (ACTIVATION_EXEMPT_ROUTES = danh sách cũ + đúng route dùng thử; is_active=false gọi /sessions, /api/writing/my-assignments → 403 như cũ; /api/trial/status → 200) + journey đăng nhập không mã + SA F2: snapshot đúng 8 cặp; mọi route /api/trial trừ config có JWT+eligibility; /api/trial/../sessions, /api/TRIAL/status, /api/trial/status/x, /api/trial%2Fstatus → 404/403 | PENDING |
| FR-026 | kind=test; ref=Playwright 360 (≤ 3 lần bấm từ /writing hoặc landing tới ô soạn; popup Kho đề có 'Viết bài này'; mục lớp ẩn với người dùng thử) | PENDING |
| FR-027 | kind=test; ref=screenshot 375×812 (đủ 4 thông tin trong màn đầu) + frontend/tests/trial-ui.test.mjs | PENDING |
| FR-028 | kind=test; ref=Playwright 360×780 (nút chính y < 600 px; thư viện rỗng không hiện '— Không có chủ đề —') | PENDING |
| FR-029 | kind=test; ref=frontend/tests/trial-mic.test.mjs (chưa hỏi, cho phép, từ chối, không hỗ trợ/in-app; lỗi micro không trừ lượt) | PENDING |
| FR-030 | kind=test; ref=frontend/tests/trial-ui.test.mjs (không còn nhãn chỉ tiếng Anh trong danh sách UIA M9) | PENDING |
| FR-031 | kind=test; ref=Lighthouse/Playwright staging (LCP < 2,5 s 1280, < 4 s 375; nút quay lại 1 dòng ở 360; band render trước phần phụ) | PENDING |
| FR-032 | kind=test; ref=command node /workspace/qa/ui-auditor/sw-ux-1104/lib.mjs measure() trên landing, /login, màn bắt đầu, màn soạn, kết quả → 0 phần tử < 44 px | PENDING |
| FR-033 | kind=test; ref=backend/tests/test_trial_data.py (id người khác → 404; id không UUID → 422; audio bucket private + signed URL TTL ≤ 10 phút; job dọn xoá hàng > 30/90 ngày; thiếu TRIAL_HASH_SALT → paused, muối không xuất hiện trong log) + backend/tests/test_trial_retention.py (job dọn 30/90 ngày) + SA N16: tombstone ghi trước khi xoá tài khoản (nếu có đường xoá) | PENDING |
| FR-034 | kind=test; ref=backend/tests/test_trial_config.py (schema cố định, trường thừa → test đỏ; không reason/USD; Cache-Control public max-age=60; rate limit dùng chung; không cookie auth) | PENDING |
| FR-035 | kind=test; ref=backend/tests/test_trial_open.py (tham số hoá: cờ tắt/đọc lỗi, kill switch, Turnstile secret/site key thiếu/rỗng/khoảng trắng, salt thiếu/< 32 byte, AI_BUDGET_TRIAL_* thiếu/sai/≤ 0/NaN, trial_captcha_required tắt × activate/speaking answers/writing submissions → 503 paused, provider giả và storage giả không được gọi; test kiến trúc mọi POST /api/trial gọi trial_open() trước xử lý body) + backend/tests/test_trial_body_limits.py (SA N11: paused + body 3 MB → 503, receive giả không được gọi; Content-Length > 3 MB/64 KB/4 KB → 413 ở middleware trước handler; luồng không Content-Length vượt giới hạn → 413 qua bounded_receive; route không khai báo tham số body) + SA N12 khoá dùng thử thiếu/trùng khoá nền tảng → paused; trial_invariant_ok=false → paused + SA N18: JSON 65 KB writing/submissions → 413; activate 5 KB → 413; speaking/answers 4 MB Content-Type text/plain hoặc urlencoded → 413/415 không đọc luồng; chunked không Content-Length vượt giới hạn × 3 route → 413; sai Content-Type dưới giới hạn → 415 trước đọc body; SA N20: trial_invariant_ok thiếu/đọc lỗi → paused + SA N24: `Multipart/Form-Data; boundary=x` chấp nhận; `application/json; charset=utf-8` chấp nhận; multipart thiếu boundary → 400 trước đọc body | PENDING |
| FR-036 | kind=test; ref=backend/tests/test_trial_readiness.py (có invariant_ok, trial_keys_separate; không admin/AAL1 → 403; response chỉ boolean, schema cố định, không chứa giá trị cấu hình) | PENDING |
| FR-037 | kind=test; ref=backend/tests/test_trial_service.py (7 lần ngắt kết nối giả trong ngày → cờ ở lần 4, chặn ở lần 7) + SA N14: 7 lần provider timeout/5xx → không cờ, không chặn | PENDING |

## Contract evidence

- OpenAPI/type drift: regenerate `frontend/types/api.d.ts` cho `/api/trial/*`.
- Backward compatibility: route chấm lớp không đổi request/response (FR-002).

## Data evidence

- Query staging sau migration `371`: RLS bật, không policy cho `anon`/
  `authenticated` trên đủ 6 bảng `trial_*` liệt kê trong `plan.md`; `has_table_privilege(anon|authenticated, 'trial_private.v_user_activation_evidence', 'SELECT')` = false và `has_schema_privilege(anon|authenticated, 'trial_private', 'USAGE')` = false (SA N23, kể cả sau khi tạo lại view); `has_function_privilege` false cho
  `fn_trial_reserve`/`fn_trial_settle` với `anon`/`authenticated`.
- T001/T007: bucket audio dùng thử riêng tồn tại, `public=false`; client không
  đọc trực tiếp, chủ sở hữu nhận signed URL TTL ≤ 10 phút, user khác không
  nhận URL (FR-033).
- T001 (PG test rollback, PENDING): sau up → backfill/kích hoạt → down, giữ
  nguyên `users.first_activated_at` và hàm/trigger đơn điệu; thử xoá/đổi mốc vẫn
  giữ giá trị. Nếu up sửa `fn_ai_budget_reserve`, so định nghĩa/chữ ký/quyền sau
  down với bản trước up và chạy ca reserve nền tảng; reservation/chi tiêu nền
  tảng không đổi. Dừng route/job dùng thử và chốt reservation trước down theo
  `rollout.md`.
- So chi phí thật 48 h staging với ước tính `plan.md` (lệch ≤ 30 %).

## UI evidence

- Ảnh chụp các trạng thái `ui-states.md`; đối chiếu audit UIA-SW-UX-20261104
  (M1–M11).
- Màn UIA chưa kiểm (mục f): ghi âm/quyền micro thật/"Đang chấm…", soạn và kết
  quả Writing có dữ liệu, đăng nhập Google + mã + tài khoản mới, iOS/Android
  thật và in-app, giao diện tối, PDF/audio — T012.

## SA retest

- SA thử: tài khoản chưa kích hoạt gọi mọi route lớp (phải 403 như cũ), `next`
  open redirect, `/api/trial/config` không lộ chi tiêu.
- SA thử: tạo nhiều tài khoản (email alias, domain dùng một lần, cùng thiết bị,
  cùng IP), gọi API thẳng không nhật ký gõ, nhật ký gõ giả, chèn lệnh, audio dài,
  đồng thời 20 request, đọc/ghi bảng `trial_*` qua REST Supabase.

## Release evidence

- Journey production sau khi anh Vinh bật cờ; cảnh báo ngưỡng hoạt động.
- Bất biến dữ liệu (SA N10, N17, T011): `SELECT count(*) FROM public.users u WHERE u.first_activated_at IS NULL AND (u.is_active OR EXISTS (SELECT 1 FROM trial_private.v_user_activation_evidence e WHERE e.user_id = u.id))` = 0 sau migration 371 và hằng ngày; thời gian chạy migration trên staging ghi trong PR (SA N19) (`backend/tests/test_trial_invariant.py`).
