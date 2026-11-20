# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk`, `Spec: NOTIFY-0079`, sau khi spec `approved`.
G11-T01 là chính PR spec này. Số task = số nhiệm vụ trong gói.

- [ ] T08 (G11-T08) Migration 470 thông báo. `depends: spec approved; xem bảng gói mục 6`
- [ ] T09 (G11-T09) API thông báo, bộ đếm quá hạn và service nhắc dùng chung. `depends: spec approved; xem bảng gói mục 6`
- [ ] T10 (G11-T10) Job sinh thông báo và cron. `depends: spec approved; xem bảng gói mục 6`
- [ ] T11 (G11-T11) Chuông, thẻ quá hạn, ngăn, trang Thông báo. `depends: spec approved; xem bảng gói mục 6`
- [ ] T12 (G11-T12) Cài đặt thư và thư tuỳ chọn. `depends: spec approved; xem bảng gói mục 6`
- [ ] T13 (G11-T13) Gửi thông báo của nhân sự. `depends: spec approved; xem bảng gói mục 6`

Bảng phụ thuộc của cả gói và chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T08 | Migration 470 thông báo | A | T01 | 1 | 4 |
| G11-T09 | API thông báo + bộ đếm quá hạn + service nhắc dùng chung | A | T08 | 1 | 3 |
| G11-T10 | Job sinh thông báo + cron | A | T09 | 2 | 4 |
| G11-T11 | Chuông, thẻ quá hạn, ngăn, trang | A | T09, G03 LearnerShell, G07-T05 | 2 | 3 |
| G11-T12 | Cài đặt thư + thư tuỳ chọn | A | T09, G04-T01 (CHECK outbox), G04-T04 (dispatcher) | 1 | 3 |
| G11-T13 | Gửi thông báo của nhân sự | A | T10, G09-T08, G09-T24 (`staff_scope`) | 2 | 4 |

### G11-T08 — Migration 470 thông báo
- Mục đích: lược đồ 5.1.1 có test PG17 và rollback.
- Đầu vào: `backend/migrations/README.md` (mục "Finding the next number"), `forward-policy.tsv`, mẫu chỉ ghi thêm `356_class_action_log_no_truncate.sql`, mẫu RPC + postcondition `334_*.sql`; `tests/test_migration_334_activate_attempt_rate_limit.py`; `tests/test_client_write_invariant_postgres.py`.
- Việc làm:
  1. Xin số (đề xuất 470). Không dùng 370–375.
  2. Viết `backend/migrations/470_learner_notifications.sql` (một giao dịch, `SET LOCAL lock_timeout='5s'`, idempotent, khối DO cuối kiểm RLS bật, không quyền client, ACL hàm, `search_path`).
  3. `backend/migrations/rollback/470_learner_notifications.sql`; dòng `forward-policy.tsv`; sửa hai câu "highest"/"next" trong README nếu test yêu cầu.
  4. `backend/tests/test_migration_470_learner_notifications.py`: (a) `fn_notify` cùng `dedupe_key` hai lần → `created` rồi `duplicate`; (b) hai sự kiện cùng group chưa đọc → một dòng `event_count=2`; (c) đọc rồi sự kiện mới → dòng mới; (d) `warning` không gộp; (e) 20 lời gọi song song cùng group → một dòng, `event_count=20`; (f) `authenticated` SELECT bảng → lỗi quyền; (g) `fn_notifications_purge`.
- Đầu ra: 1 PR migration + test.
- Nghiệm thu: `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest backend/tests/test_migration_470_*.py backend/tests/test_client_write_invariant_postgres.py backend/tests/test_migration_forward_policy.py -q` pass; `cd backend && python -m pytest tests/ -q` pass.
- Không làm: không FK tới bảng của G04/E (bảng có thể chưa có).
- Vướng mắc → cách gỡ: bất biến client đỏ vì `PUBLIC` có EXECUTE mặc định → `REVOKE EXECUTE … FROM PUBLIC`; partial unique không làm đích `ON CONFLICT` được → dùng UPDATE-rồi-INSERT như 5.1.1 bước 2–3, bắt `unique_violation`.
- Ước lượng: 1 phiên · 4.

### G11-T09 — API thông báo, bộ đếm quá hạn và service nhắc dùng chung
- Mục đích: 5.1.2, 5.1.5.
- Đầu vào: `backend/routers/class_student.py` (dòng 268–330, 439–620), `backend/services/activation_gate.py`, `tests/test_activation_gate_inventory.py`, `backend/main.py` (cách include router học viên), `backend/routers/auth.py` dòng 1083–1160 (profile).
- Việc làm:
  1. `backend/services/learner_overdue.py` (5.1.5).
  2. `backend/services/notification_copy.py`: hàm `render(kind, params, event_count) -> (title, body, action_label)`; câu chữ tiếng Việt, xưng "bạn", không mã nội bộ; bảng câu chữ trong PR để người duyệt đọc.
  3. `backend/services/notifications.py` (đọc danh sách theo cursor `(last_event_at, id)`, summary, read, read-all, prefs).
  4. `backend/routers/notifications.py` + model trong `backend/models/notifications.py`, `response_model` khai đủ; include trong `main.py`; thêm route vào `ACTIVATION_EXEMPT_ROUTES` kèm lý do.
  5. Sinh lại `frontend/types/api.d.ts` theo lệnh G07 mục 7.
  6. Test `backend/tests/test_notifications_api.py`: người A không đọc/đánh dấu được của B (404); `read-all` idempotent; `summary.overdue` = số `is_missing` (dựng lớp giả có 2 bài quá hạn, 1 đã nộp, 1 bài một lượt đã đóng → 2); cờ `notifications_enabled` tắt → `unread: 0, overdue` vẫn tính (bộ đếm không phụ thuộc cờ thông báo — mục 10 câu 1 nếu anh muốn khác); người chưa kích hoạt gọi được.
- Đầu ra: 1 PR.
- Nghiệm thu: `cd backend && python -m pytest tests/test_notifications_api.py tests/test_activation_gate_inventory.py -q` pass; bộ đầy đủ pass.
- Không làm: không sửa `_visible_assignments`, `_decorate`.
- Vướng mắc → cách gỡ: import `routers.class_student` từ service gây vòng import → bọc trong hàm và import muộn bên trong hàm, như G07 mục 5.3; `_visible_assignments` cần `student` dict đầy đủ → đọc đúng cột như `GET /api/class/me` đang đọc.
- Ước lượng: 1 phiên · 3.

### G11-T10 — Job sinh thông báo và cron
- Mục đích: 5.1.3.
- Đầu vào: 5.1.3; `backend/scripts/staff_security_sweep.py`, `backend/railway.staff-security-sweep.json` (mẫu); bảng nguồn ở mục 2.
- Việc làm:
  1. `backend/scripts/notification_sweep.py` với các bước ở bảng 5.1.3 (trừ `course_release_schedule`); mỗi bước một hàm `step_<tên>(db, now, dry_run) -> dict`; bảng nguồn chưa tồn tại (G04, E) → bắt lỗi "relation does not exist", trả `{"skipped": "missing_table"}`.
  2. `backend/railway.notification-sweep.json` (`*/5 * * * *`, `restartPolicyType: NEVER`).
  3. Test `backend/tests/test_notification_sweep.py` dùng DB giả: mỗi bước sinh đúng `dedupe_key`; chạy hai lần không trùng; dời `due_at` → `due_soon` mới; học viên lớp không có `course_expiring`; một bước ném lỗi không chặn bước sau.
  4. Ghi trong PR: cần anh Andy tạo service cron trên Railway (không tự tạo).
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test pass; `python -m scripts.notification_sweep --dry-run` trên staging (khi được phép) in số đếm từng bước, không ghi dòng nào.
- Không làm: không gửi thư trong PR này (bước `broadcasts` chỉ ghi thông báo; thư ở T12/T13).
- Vướng mắc → cách gỡ: quét `class_assignment_items` toàn bảng chậm → lọc bằng `class_assignments` trước (index `idx_class_assignments_due_open` mig 177 có `due_at` cho bài published), rồi `in_` item theo lô 100 như `_sealed_course_session_ids`; `students.user_id` NULL (chưa kích hoạt) → bỏ, không lỗi.
- Ước lượng: 2 phiên · 4.

### G11-T11 — Chuông, thẻ quá hạn, ngăn, trang Thông báo
- Mục đích: 5.1.6.
- Đầu vào: tờ `ThongBao`, `ThanhPhanKhungTrang` mục 1–3; component G03 (`LearnerShell`, `Dialog variant="drawer"`, `Notice`, `PageState`); `frontend/lib/my-class-model.mjs`; danh mục trang G03/G07.
- Việc làm:
  1. Component 5.1.6 trong `frontend/components/notifications/`; hook `frontend/lib/notifications-client.ts`; `frontend/lib/notification-target-model.mjs`.
  2. Gắn vào `LearnerShell` qua slot (phối hợp phiên làm G03; nếu `LearnerShell` chưa có slot, PR nhỏ thêm prop `notificationsSlot?: ReactNode` vào G03 trước, theo quy tắc phiên trước làm trước).
  3. Trang `frontend/app/(authed-notifications)/notifications/page.tsx` + layout (`AuthedShell design="v2"`, không `activationGate`), lọc `?kind=`, "Đánh dấu đã đọc tất cả" chỉ bật khi còn chưa đọc.
  4. Test React: chuông không số khi 0; "9+" khi 12; thẻ quá hạn ẩn khi 0, có chữ "quá hạn"; bấm dòng gọi `/read` rồi điều hướng đúng href của `my-class-model`; Esc đóng ngăn và trả tiêu điểm về chuông; dưới 768px bấm chuông mở trang; polling dừng khi `visibilitychange` sang ẩn.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: `npm --prefix frontend run test:react` pass; `cd frontend && npx tsc --noEmit && npm run build` pass; ảnh 1280/768/390 đối chiếu tờ ThongBao đính vào PR (`[preview]`).
- Không làm: không thêm chuông vào `aver-chrome.js` (mục 10 câu 2); không hộp bật lên.
- Vướng mắc → cách gỡ: `route-auth-guard-inventory.test.mjs` đỏ vì route mới → thêm route đúng nhóm theo cách test đó mô tả; CSP chặn polling tới backend → `connect-src` dẫn từ runtime config đã gồm backend (`content-security-policy.mjs` dòng 5), kiểm bằng `npm run build` rồi mở trang.
- Ước lượng: 2 phiên · 3.

### G11-T12 — Cài đặt thư và thư tuỳ chọn
- Mục đích: FR-012, 5.1.4.
- Đầu vào: G04 `services/learner_email.py` (sau G04-T04); tờ `EmailMau` thư 9–13, `TaiKhoan`/`HoSoHocVien` (khối công tắc thư ở Hồ sơ — CHƯA KIỂM tờ nào vẽ khối này: `grep -l "Bài đã chấm xong" thiet-ke/*.dc.html`); migration 381 của G04 (CHECK của outbox đã có bốn mẫu `result_ready_digest`, `course_expired` (thêm 18/11), `course_expiring`, `staff_notice`).
- Việc làm: API prefs (đã có ở T09) nối vào màn Hồ sơ (G07-T17 — nếu chưa có màn mới thì thêm khối vào trang hồ sơ hiện tại, ghi rõ); bước `digests` trong `notification_sweep.py` gom `result_ready`/`course_test_released` theo cửa sổ và ghi outbox `result_ready_digest`; bước `course_expiring` (và cùng bước sweep đó: `course_expired`, thư 8 "Khoá đã hết hạn" của tờ EmailMau — thêm 18/11 theo rà soát, mặc định tạm 18/11, chờ anh Andy xác nhận) ghi outbox; ba mẫu thư văn bản + HTML; test: công tắc tắt → không ghi outbox; `users.notification_email=false` → không ghi; cờ tắt → không ghi; gộp 3 kết quả trong 30 phút → 1 thư.
- Đầu ra: 1 PR.
- Nghiệm thu: test pass; render mẫu không có "mua/bán/giá/đơn hàng", không band, không nội dung bài.
- Không làm: không gửi thư thật trên production.
- Vướng mắc → cách gỡ: G04-T01/T04 chưa merge → chưa có bảng outbox và dispatcher; PR này đợi, làm phần prefs trước trong PR riêng nếu cần. 381 đã merge theo bản cũ (CHECK thiếu ba mẫu của A) → báo người điều phối; phần chênh đi bằng migration mới trong dải của G04 (GOI-04 cuối mục 8), không dùng 472.
- Ước lượng: 1 phiên · 3.

### G11-T13 — Gửi thông báo của nhân sự
- Mục đích: FR-013, FR-014, 5.1.7.
- Đầu vào: tờ `AdminGiaoVienThongBao` (phần Gửi thông báo); `backend/routers/admin.py::require_instructor` (112); `backend/services/staff_scope.py` của G09-T24 (GOI-09 mục 5.4); khung admin G09; G09-T40 (nguồn "Danh sách đã chọn" đẩy sang trang này).
- Việc làm: router `admin_notifications.py`; giải người nhận (`cohorts` → `student_cohort_memberships` đang active → `students.user_id`; `learners` → kiểm từng id là học viên); bước `broadcasts` trong job gửi thông báo + thư (khi `channels` có `email`, cờ `notification_emails` bật, người nhận bật `staff_notice`); trang trong khung admin: soạn, xem trước số người nhận, hẹn giờ, lịch sử, huỷ; hộp xác nhận "gửi tất cả".
- Đầu ra: 1 PR (2 phiên: backend + giao diện).
- Nghiệm thu: test backend: giáo viên chọn lớp không của mình → 404 (quy ước `staff_scope`), giáo viên chọn `all` → 403; `all` thiếu `confirm_text` → 422; cùng `request_key` hai lần → một dòng; hẹn giờ huỷ trước giờ → không thông báo nào; `test_staff_guard_inventory.py` pass. Giao diện: bước bấm soạn → xem trước thấy đúng số → gửi → học viên thử thấy dòng trong chuông sau một chu kỳ job.
- Không làm: không cho đính kèm file, không HTML trong thân.
- Vướng mắc → cách gỡ: G09-T24 (`staff_scope`) chưa merge → bản đầu chỉ cho admin, giáo viên ẩn nút, nối `staff_scope` trong PR nhỏ sau; G09-T40 và nhiệm vụ này cùng sửa trang `/admin/notifications` → bên vào sau rebase, mỗi bên chỉ thêm khối của mình; số người nhận lớn (tất cả) → `fn_notify_batch` theo lô 500.
- Ước lượng: 2 phiên · 4.
