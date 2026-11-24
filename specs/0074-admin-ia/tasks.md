# Tasks

Mỗi task là một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk`, `Spec: ADMINIA-0074`, chỉ sau khi spec này
`approved`. Số task = số nhiệm vụ trong gói (T008 = G09-T08). G09-T01 là chính PR spec này; G09-T21 là PR spec của 0085–0087; T25–T28, T30–T34, T36–T37 thuộc các spec đó.

- [ ] T002 (G09-T02) "Duyệt bài thi" không còn mở lỗi thiếu mock_exam_id — GIỮ. `depends: spec approved; xem mục 6.0`
- [ ] T003 (G09-T03) API danh bạ hợp nhất và khối tóm tắt học viên — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T004 (G09-T04) API các thẻ hồ sơ — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T005 (G09-T05) API tìm nhanh — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T006 (G09-T06) API Việc cần làm — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T007 (G09-T07) Nhóm sự cố: migration 451, API gom nhóm và trạng thái — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T008 (G09-T08) Khung admin mới + sổ đăng ký điều hướng (sau G10) — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T009 (G09-T09) Liên kết vai trò trong khung học viên — GIỮ. `depends: spec approved; xem mục 6.0`
- [ ] T010 (G09-T10) Danh bạ học viên `/admin/learners` — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T011 (G09-T11) Hồ sơ học viên 5 thẻ + vùng nguy hiểm — SỬA (tách 2 PR). `depends: spec approved; xem mục 6.0`
- [ ] T012 (G09-T12) Mã kích hoạt: sổ tra cứu `/admin/activation-codes` — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T013 (G09-T13) Khoá học và đơn đăng ký (cần G04) — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T014 (G09-T14) Quyền luyện lại và thu hồi quyền (cần G04) — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T015 (G09-T15) Sổ lượt AI `/admin/credits` (cần G04) — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T016 (G09-T16) Hộp thư sự cố `/admin/incidents` — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T017 (G09-T17) Chấm Writing: một hàng chờ duyệt, phím tắt, dải tóm tắt — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T018 (G09-T18) Trang Việc cần làm, AI và mô hình, Công cụ QA — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T019 (G09-T19) Tìm nhanh Ctrl/⌘ K — GIỮ. `depends: spec approved; xem mục 6.0`
- [ ] T020 (G09-T20) Khu giáo viên trong khung chung, 5 mục — SỬA. `depends: spec approved; xem mục 6.0`
- [ ] T022 (G09-T22) Migration 440 và API Cài đặt / ngưỡng — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T023 (G09-T23) Trang Cài đặt (các thẻ ngoài Chấm thử) — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T024 (G09-T24) Migration 441 và phạm vi giáo viên theo lớp — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T029 (G09-T29) Trang Lớp: thẻ, bảng học viên × bài, mã kèm lượt, cấp thêm lượt — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T035 (G09-T35) Ghi chú chăm sóc (migration 442) — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T038 (G09-T38) Chấm Speaking thi thử — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T039 (G09-T39) Yêu cầu chấm lại — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T040 (G09-T40) Giáo viên (bảng, hồ sơ) và nối "Gửi thông báo" — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T041 (G09-T41) Báo cáo một trang bốn thẻ — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T042 (G09-T42) Áp staging và nghiệm thu đầu-cuối — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T043 (G09-T43) Cấp lượt cho lớp cũ: chuyển lớp chạy bằng mã cũ sang đo lượt (cần G04) — MỚI (18/11 chiều). `depends: spec approved; xem mục 6.0`

Chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

### 6.0 Thứ tự và lý do phụ thuộc

- **Backend trước, song song G10:** T03–T07, T22, T24, T25, T27, T31, T33, T35, T36 chỉ thêm router/migration, không đụng route group frontend.
- **Frontend sau khi G10 gộp `(authed-admin)`** (T08 trở đi). Lý do: (1) trang mới làm trước G10 phải tạo thêm route group thứ 40+ rồi G10 lại gộp; (2) khung mới chỉ gắn được một lần khi có một layout chung; (3) G10 sửa 109 test ghim route group — hai gói cùng sửa một file test là vi phạm quy ước chung mục 7.
- **Làm được ngay:** T01, T21 (spec), T02.
- **Thứ tự chuyển sau khi có khung (T08):** Cài đặt/ngưỡng (T22, T23 — mọi màn sau đọc ngưỡng) → phạm vi giáo viên (T24) → Học viên (T10, T11, T35) → Lớp và giao bài (T25, T26, T27, T28, T29, T30) → Việc cần làm (T06, T18) → Chấm bài (T17, T38, T39) → Kỳ thi (T31–T34) → Khoá, đơn, lượt, mã (T12–T15, T43, cần G04; T43 sau T29) → Nội dung (T36, T37) → Sự cố, báo cáo (T07, T16, T41) → Giáo viên (T20, T40) → Tìm nhanh (T05, T19) → T42.
- Mỗi PR mã ghi `Spec:` đúng spec của nó (0074 hoặc một trong ba spec bổ sung).

### 6.1 Khối nào làm ngay từ dữ liệu đang lưu, khối nào cần bảng/cột mới

[NGAY] = tính được từ bảng đang có (đã kiểm ở mục 2). [THÊM] = cần migration ở 5.3, hoặc gói khác, hoặc quy tắc chưa chốt. Lấy từ "Ghi chú cho lập trình" của từng tờ rồi đối chiếu repo.

| Màn (tờ) | [NGAY] | [THÊM] |
|---|---|---|
| Việc cần làm (AdminViecCanLam) | Writing chờ duyệt, AI lỗi, chấm lại, sự cố/phản hồi (theo dòng), kỳ thi hôm nay (`mock_exams.open_from`), bài giao quá hạn (`class_assignment_items` + `due_at`), lớp tuần này (`class_lessons.lesson_date`), cần chú ý: trễ liên tiếp và không hoạt động | Ngưỡng (440); đơn, quyền sắp hết, còn ít lượt, lớp chưa chuyển sang đo lượt (G04); bài kiểm tra chờ công bố (GOI-11 mig 473); cần liên hệ hôm nay (442); Speaking thi thử chờ chấm (cần cách xác định "chờ chấm" — T38); giờ buổi học (441) |
| Danh bạ (AdminDanhBa) | Hợp nhất `users`+`students`, lớp, hoạt động gần nhất, tìm, xuất CSV, gán lớp | Dạng và khoá/hạn theo quyền, lọc lượt (G04); cần chú ý dùng ngưỡng (440); tìm không dấu (đã kiểm ở `c3bc71574`: `grep -rn "unaccent" backend/migrations/*.sql` rỗng — không có extension `unaccent`, chuẩn hoá bỏ dấu ở Python) |
| Hồ sơ học viên (HoSoHocVien) | Cảnh báo (dữ liệu), mục tiêu hai nguồn (hiện), lưới 8 tuần, bài được giao, điểm theo thời gian, thẻ Học tập, nhật ký lớp (spec 0041), chi phí AI | Quy tắc trạng thái + ngưỡng (440); ghi chú chăm sóc và việc đã hẹn (442); khoá/hạn/lượt, phần lượt chuyển và hạn của nó (G04); gom nhật ký quyền/lượt/đơn (G04); "Lỗi lặp lại ở Writing" nếu chú thích chưa có loại; gộp mục tiêu về một nguồn (Q17) |
| Lớp (AdminLop) | Thẻ, bảng học viên × bài, buổi học, bài nộp, nhật ký, lưu trữ | Giáo viên của lớp — một người (441); lịch tuần, ngày khai giảng, giờ buổi, tạo lớp ba bước, dời buổi (441, Q25); mã kèm lượt, cấp thêm lượt, cấp lượt cho lớp cũ (T43), quyền luyện lại (G04); gửi nhắc và "Đã nhắc" (444 + GOI-11 A); thẻ Kiểm tra theo buổi (spec 0043 chưa có mã) |
| Kết quả bài giao (AdminKetQuaBaiGiao) | Khối 1 (trừ giờ nhắc), khối 2, khối 3 gom theo `skill`/`subtype`, khối 4 (dữ liệu), khối 5 (đề xuất); biến thể Writing: trung vị tiêu chí | Giờ nhắc gần nhất (444); tên hiển thị `truc_nhom`/dạng (file nhãn, Q27); ngưỡng "quá nhanh", "làm lại nhiều" (Q15); lưu câu vào buổi (444); loại nhận xét Speaking; `lesson_primary` cho biến thể giữa kỳ (spec 0043 — tạm dùng `skill`/`item_key` theo buổi) |
| Bảng công bố (KiemTraKhoaGiaoVien) | — | Toàn bộ backend ở GOI-11 phần E (mig 473–474); khối "Theo buổi" cần spec 0043 hoặc `result` biến thể `course_test` (T27) |
| Khoá học (AdminKhoaHoc) | — | Toàn bộ trên API G04; "Lưu trữ" (phân xử 14) |
| Đơn đăng ký (AdminDonDangKy) | Đối chiếu tính ở trình duyệt | Toàn bộ trên API G04; hạn bổ sung, tự mở lại đơn hết hạn, kích hoạt tài khoản khi xác nhận (G04) |
| Lượt AI và mã (AdminLuotVaMa) | Sổ mã hiện có (`/admin/access-codes`) | Sổ lượt, điều chỉnh, lượt kèm mã, chuyển toàn bộ lượt khi đăng ký lại (`carry_over`) và hạn của phần lượt chuyển (G04); ngưỡng sắp hết lượt, mã sắp hết hạn (440) |
| Chấm Writing (AdminChamWriting) | Hàng chờ, màn chấm, trả, thu hồi, chấm lại bằng AI; band 4 bài gần nhất; mục tiêu | Lọc "chỉ lớp offline" cần `review_mode` của G04 (trước G04: mọi bài ở tầng duyệt hiện có); khoá mềm tự nhả 30 phút (CHƯA KIỂM, 2.4); lưu riêng điểm AI và điểm giáo viên từng tiêu chí (đã kiểm 18/11: repo chưa lưu; làm ở G12-C01…C03, migration 480, đợt D); sắp theo buổi học (`class_lessons`, [NGAY] theo ngày; giờ cần 441) |
| Chấm lại (AdminChamLai) | Danh sách, lý do, chấp nhận/từ chối | Trạng thái "Đang xem" + khoá mềm; năm lý do chọn sẵn (đã kiểm ở `c3bc71574`: `migrations/084_essay_regrade_requests.sql` dòng 21 `reason TEXT NOT NULL`, văn bản tự do 50–500 ký tự do API kiểm — chưa có cột lý do chọn sẵn); chấm lại hàng loạt |
| Chấm Speaking thi thử (AdminChamSpeakingThiThu) | Bản ghi (`record-speaking`), nhập band (`bulk-final-bands`), roster | Hàng chờ riêng (API mới, T38); đề xuất của AI cho Speaking thi thử; cờ "Quá ngắn"/"Không nghe được"; đoạn mẫu chấm phát âm (G08/gói chấm) |
| Kỳ thi (AdminKyThi) | Danh sách kỳ một lớp, chọn kỹ năng theo lượt thi, chọn đề, cảnh báo đã làm ở Luyện tập, cơ chế live, cơ chế tự làm kiểu cũ (mỗi phần tự bấm bắt đầu), `review_sla_days` | Người thi nhiều nguồn, nhóm lưu (443, 445); nháp nhiều bước; tên `live`/`self_paced` (445–446); `allow_early_advance`; kỳ tự làm chạy liền các phần, không nghỉ giữa (5.5 — phía học viên ở G08-T22) |
| Trang một kỳ thi (AdminKyThiChiTiet) | Thẻ Đề; kỹ năng từng người; đánh dấu cần thi bù; theo dõi live (số câu, hoạt động, đứng yên, dấu hiệu, điều khiển mở/bắt đầu/thu); theo dõi tự làm; thẻ Chấm (roster); phân bố band, câu sai nhiều, nhịp làm bài, so kỳ trước, trung vị tiêu chí Writing; trả kết quả (cả kỳ) | Danh sách nhiều nguồn (445); cộng giờ theo người, nhắn phòng, dòng thời gian sự kiện (447); bốn trạng thái của người dự thi tự làm (`self_paced_state`, FR-151); ngưỡng đứng yên đọc từ bảng chung (440); trả từng phần, lịch sử sửa điểm (448); số bài tối thiểu cho phân bố (Q15); gộp thi bù vào kỳ gốc (Q13) |
| Nội dung (3 tờ) | Thẻ Đề và bài (danh sách, trạng thái, nơi dùng, đăng/gỡ hàng loạt, sửa lẻ); Chương trình và bộ; Câu cần kiểm từ `user_feedback` và `quiz_item_error_rates`; ẩn route nhập | Lô nhập (449) và cột Lô nhập; trạng thái Đã kiểm/Đã sửa (450); tìm theo câu đầu đề; tính lại điểm khi đổi đáp án (gói sau); tỉ lệ sai toàn kho L/R (gói sau) |
| Báo cáo (AdminBaoCao) | Lưu lượng (`/admin/analytics/foot-traffic`), chi phí AI (`/admin/ai-usage`), hoạt động (các trang hiện có), ba số chất lượng | Bảng theo lớp và khoá có "cần chú ý" (440 + G04); xuất CSV gộp; khoảng ngày tuỳ chọn |
| Hộp thư sự cố (AdminSuCo) | Ba nguồn, gom nhóm lỗi (tính lúc đọc) | Bốn trạng thái nhóm, ghi chú, tự mở lại (451); hoàn lượt (G04); gom nhóm sự cố chấm và phản hồi |
| AI và mô hình, Bảo mật, QA (AdminHeThong) | Bảng mô hình (spec 0024), `/admin/mfa`, công cụ QA hiện có | Lý do + nhật ký đổi mô hình; ngân sách tháng; tự kiểm nhà cung cấp; bảng phiên; nhật ký nhạy cảm (gói sau) |
| Cài đặt (AdminCaiDat) | Thẻ Tính năng (`/admin/runtime-flags`) | Ngưỡng, thư, thông báo hệ thống (440); Chấm thử (GOI-11 mig 471); Thanh toán (G04, Q20); Pháp lý (gói sau, Q21) |
| Giáo viên, Gửi thông báo (AdminGiaoVienThongBao) | Danh sách giáo viên | Lớp phụ trách (441); mời có hạn (CHƯA KIỂM cơ chế mời hiện có qua `access_codes.grants_role` + `intended_email`: `grep -n "grants_role\|intended_email" backend/routers/admin.py \| head`); gửi thông báo (GOI-11 A); nhóm theo điều kiện |
| Khu giáo viên (GiaoVien) | Chấm/duyệt Writing (`/instructor/reviews/*`), học viên, giao bài Writing | Phạm vi theo lớp (441); Việc của tôi (T06); bảng tiến độ học viên × bài cho giáo viên; gửi nhắc |

### G09-T02 — "Duyệt bài thi" không còn mở lỗi thiếu mock_exam_id — GIỮ
- Mục đích: FR-063, làm ngay trên trang hiện có (lớp `small`). T34 thay hẳn trang này sau.
- Đầu vào: `app/(authed-admin-mock-reviews)/admin/mock-reviews/page.tsx`, `admin-mock-reviews.tsx` dòng 119/140, `lib/admin-mock-tests-model.mjs`, test `tests/admin-mock-reviews-next-behavior.test.mjs`; GOI-02.
- Việc làm: 1) Kiểm G02 đã sửa chưa (`git log origin/staging --oneline -- 'frontend/app/(authed-admin-mock-reviews)'`); đã sửa → đóng bằng bằng chứng. 2) Trong `page.tsx`: `mock_exam_id` rỗng và không `embed=1` → `redirect('/admin/mock-tests?tab=review&notice=choose-exam')`; `embed=1` mà rỗng → đổi câu thành "Chọn một kỳ thi để duyệt bài." 3) Trung tâm Mock Test đọc `notice=choose-exam` hiện một dòng. 4) Test React.
- Đầu ra: 1 PR.
- Nghiệm thu: mở `/admin/mock-reviews` → về trung tâm với dòng "Chọn một kỳ thi để duyệt bài."; `grep -rn "Thiếu mock_exam_id" frontend/app` rỗng; test frontend qua.
- Không làm: không đổi API, không đổi iframe.
- Vướng mắc → cách gỡ: test cũ ghim chuỗi → sửa cùng PR, ghi tên test. `searchParams` là Promise → `await` trước (mẫu `admin/users/page.tsx`).
- Ước lượng: 1 phiên · 2.

### G09-T03 — API danh bạ hợp nhất và khối tóm tắt học viên — SỬA
- Mục đích: `GET /admin/learners`, `GET /admin/learners/{ref}`, `…/summary`, `GET /instructor/learners/{ref}` (5.4); hàm `learner_attention.compute`.
- Đầu vào: `routers/admin.py` (dòng 975), `routers/admin_students.py`, `services/student_service.py`, `services/test_data_visibility.py`, `services/ops_thresholds.py` (T22), `services/staff_scope.py` (T24), `tests/test_staff_guard_inventory.py`.
- Việc làm: 1) Tạo `routers/admin_learners.py`, `models/admin_learners.py`, `services/admin_learner_directory.py`, `services/learner_attention.py`. 2) Hợp nhất `students` + `users` theo `students.user_id`; `ref` theo FR-022; áp `test_data_visibility` như `list_students`. 3) Phân trang `page`/`page_size=25`, sắp theo tên gọi (từ cuối của họ tên) rồi id. 4) `kind`, `courses`, `credits_left`: đọc qua hàm G04 nếu có; chưa có → `null` (không đoán). 5) `attention`: `late_streak` từ chuỗi bài giao đã tới hạn gần nhất của học viên (`class_assignment_items` + `due_at`), `inactive` từ lần hoạt động gần nhất; `course_expiring`, `low_credits` chỉ khi có G04. 6) `summary` đúng 7 trường mục H. 7) Test: ba ca hợp nhất, ẩn staff, `s-` của người có tài khoản → `canonical_ref = u-…`, một nguồn lỗi vẫn 200, ngưỡng đổi thì kết quả đổi, giáo viên xem học viên lớp khác → 404, token học viên → 403.
- Đầu ra: 1 PR backend.
- Nghiệm thu: `cd backend && python -m pytest tests/test_admin_learners.py tests/test_staff_guard_inventory.py -q` qua; bộ đầy đủ qua.
- Không làm: không ghi dữ liệu; không migration; không đổi `/admin/users`, `/admin/students`.
- Vướng mắc → cách gỡ: T22/T24 chưa merge → dùng mặc định ở 5.6 qua một hàm giả có cùng chữ ký và chỉ mở route admin; nối thật khi hai nhiệm vụ kia vào. Fixture không dùng email học viên thật.
- Ước lượng: 2 phiên · 3.

### G09-T04 — API các thẻ hồ sơ — SỬA
- Mục đích: `…/overview`, `…/goal/resolve`, `…/attempts`, `…/ai-cost`, `…/log` (5.4).
- Đầu vào: 5.4; `admin_class_assignments.py` `student_work`; `services/student_home_aggregator.py`; `routers/admin.py` `_aggregate_usage_for_users`; `services/ai_pricing.py`; bảng audit ở 2.2.
- Việc làm: 1) Kiểm cột khoá người của `listening_test_attempts`, `reading_test_attempts`, `mock_exam_sittings` (lệnh ở 5.4), ghi vào PR. 2) `overview`: mỗi khối một hàm, chạy `asyncio.gather`, lỗi → tên khối vào `sources_failed`. Lưới 8 tuần: ngày theo giờ Việt Nam; tuần hiện tại cuối; ngày tương lai `null`. `estimated_band` chỉ khi có lượt thi thử gần nhất đủ bốn band. `side.credits_carried` chép từ trường G04 trả (số lượt chuyển còn lại và hạn của phần đó — FR-056); không tự tính từ sổ. 3) `goal/resolve`: ghi cả `students` và `users` trong một giao dịch (RPC hoặc hai lệnh có bù trừ), ghi `class_action_log`-kiểu sự kiện `goal` vào nguồn nhật ký (nếu không có bảng phù hợp: `staff_security_audit` với action `learner_goal_resolved` — CHƯA KIỂM ràng buộc action: `grep -n "action" backend/services/staff_security.py | head`). 4) `log`: hợp nhất nguồn, `text` tiếng Việt thường (`services/admin_learner_log_text.py`; action lạ → "Thao tác khác"). 5) Test từng endpoint: rỗng, có dữ liệu, một nguồn lỗi; không band khi thiếu dữ liệu.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest file mới + bộ đầy đủ qua; response mẫu không có `0/0`, không có band khi chưa có bài đã trả; test: G04 (giả) trả quyền có 6 lượt chuyển hạn 20/01 → `side.credits_carried = {amount: 6, expires_at: …}`; G04 không trả trường → `null`.
- Không làm: không gọi AI; không tính lại band; không chép `persona_notes`.
- Vướng mắc → cách gỡ: `sessions` có phiên E2E staging → lọc như `/admin/sessions` (`_STAGING_E2E_*`). Hai nguồn mục tiêu khác kiểu (`NUMERIC(2,1)` và `DECIMAL(2,1)`, `target_date` và `exam_date`) → so sánh sau khi chuẩn hoá về số một chữ số thập phân và ngày.
- Ước lượng: 3 phiên · 4.

### G09-T05 — API tìm nhanh — SỬA
- Mục đích: `POST /admin/search`, `POST /instructor/search` (body JSON `{ q }`, không đặt `q` trên URL — #2453).
- Việc làm: học viên qua service T03 (≤3); lớp từ `cohorts`; bài nộp `writing_essays`; đề (chỉ admin); **đơn đăng ký** theo mã `AVER-…` hoặc email qua API G04 (chưa có → bỏ nhóm). Escape `%`/`_`. Giáo viên: lọc `scope.cohort_ids`. Log `admin_search` không ghi `q`.
- Đầu ra: 1 PR backend. Nghiệm thu: pytest: giáo viên A không thấy học viên lớp B; q 1 ký tự → 422; `%` không thành wildcard; inventory qua.
- Không làm: không full-text index, không migration.
- Vướng mắc → cách gỡ: chậm > 800ms trên staging → ghi số đo vào PR, không tự thêm index. G04 chưa có → nhóm `orders` trả mảng rỗng và ghi trong PR.
- Ước lượng: 1 phiên · 3.

### G09-T06 — API Việc cần làm — SỬA
- Mục đích: `GET /admin/attention`, `GET /instructor/attention` (5.4), FR-090…093, 104.
- Đầu vào: `routers/admin_overview.py`, `models/admin_overview.py`; T03 (`learner_attention`), T22, T24, T07; API G04; GOI-11 phần E (đếm `awaiting_release`).
- Việc làm: mỗi hàng chờ một hàm trả `Q`; lỗi hoặc gói phụ thuộc chưa có → `count=null, error=true|false` (phân biệt "lỗi" và "chưa có nguồn" bằng trường `unavailable: true`). `exams_today`: kỳ thi có `starts_at`/`open_from` trong ngày giờ Việt Nam. `classes_week`: `class_lessons` có `lesson_date` trong 7 ngày tới, `has_assignment` = có `class_assignments.lesson_id` trỏ buổi đó. `attention_learners`: ≤ 8, xếp theo số lý do rồi tên. `ops_week.on_time_rate`: bài giao có hạn trong 7 ngày qua. `classes_unmetered`: số lớp chưa lưu trữ còn thành viên active dùng mã cũ chưa có nơi nhận lượt — gọi hàm đọc của G04 (cùng lõi với `convert-class/preview`, bảng "API G04 mà G09 gọi"); G04 chưa có → `unavailable: true`. Bản giáo viên: cùng service với `cohort_ids`, bỏ `enrollments_reported`, `incident_groups_open`, `feedback_open`, `exams_today`, `classes_unmetered`, `ops_week`.
- Đầu ra: 1 PR backend. Nghiệm thu: pytest: một nguồn lỗi → chỉ trường đó `error`, các trường khác có số; không bao giờ trả 0 thay cho lỗi; bản giáo viên không có trường admin; lớp thử có 2 thành viên mã cũ chưa có nơi nhận lượt → `classes_unmetered.count = 1`, sau khi chuyển (giả) → 0; lớp đã lưu trữ không tính.
- Không làm: không đổi `/admin/overview` hiện có.
- Vướng mắc → cách gỡ: `speaking_mock_pending` phụ thuộc T38 → trước T38 trả `unavailable`. Lớp không có `lesson_date` → không có trong `classes_week`, không suy từ lịch tuần ở nhiệm vụ này.
- Ước lượng: 2 phiên · 3.

### G09-T07 — Nhóm sự cố: migration 451, API gom nhóm và trạng thái — SỬA
- Mục đích: FR-070, 071; API `incidents/groups*` (5.4).
- Đầu vào: `routers/error_logs.py`, `routers/admin.py` (`/admin/alerts` dòng 4225), `routers/feedback.py`, tờ AdminSuCo.
- Việc làm: migration 451 + rollback; `services/error_log_grouping.py` (`fingerprint`); `routers/admin_incidents.py`; gom `errors` theo fingerprint, `grading` theo (kỹ năng, bước, loại bài), `feedback` theo (đề hoặc màn, lý do); trạng thái đọc từ `incident_groups`, tự mở lại khi có ghi nhận sau `resolved_at`; `bulk` so `expected_count`; mọi đổi trạng thái thêm một dòng `incident_group_notes` với `auto=true`. Giữ nguyên endpoint dismiss từng dòng của `error_logs.py`; khi nhóm `resolved` thì dismiss các dòng chưa xử lý của nhóm theo lô 200.
- Đầu ra: 1 PR backend (có migration → `high-risk`).
- Nghiệm thu: pytest: hai lỗi khác uuid cùng nhóm; nhóm đã xử lý có dòng mới → `new`, ghi chú còn; 409 khi `expected_count` lệch; inventory qua.
- Không làm: không xoá dòng; không hoàn lượt (nút hoàn lượt chỉ hiện khi G04 có API).
- Vướng mắc → cách gỡ: báo lỗi đáp án (`user_feedback` kiểu report) **không** vào đây — đi vào Câu cần kiểm (T36); `review_items_open` chỉ là số đếm. Bảng nhiều dòng → giới hạn quét 5.000, trả `truncated`.
- Ước lượng: 2 phiên · 3.

### G09-T08 — Khung admin mới + sổ đăng ký điều hướng (sau G10) — SỬA
- Mục đích: FR-001…014; 5.1, 5.2.
- Đầu vào: layout `(authed-admin)` của G10 (GOI-10 mục 5.3); component khung của G03; GOI-03 mục 5.9; `aver-admin-chrome.js`; `components/authed-shell.tsx`; `admin-access-gate.tsx`; tờ ThanhPhanKhungTrang2 mục 7, 10; `CHUAN-ADMIN.md` mục A.
- Việc làm: 1) `frontend/lib/admin-nav-registry.mjs` theo 5.2 và 5.1. 2) `frontend/components/admin/admin-frame.tsx` dùng khung G03. 3) Layout admin: `process.env.ADMIN_FRAME_V2 === '1'` → bọc `AdminFrame`, thêm `av-admin-frame-v2` vào `bodyClass`. 4) `aver-admin-chrome.js`: trong `connectedCallback`, body có class đó thì chỉ render `<slot></slot>` → 75 `page.tsx` chưa phải sửa. 5) Số đếm sidebar từ `GET /admin/attention` (`countKey`). 6) Menu tài khoản theo FR-003, điều khiển sáng/tối theo GOI-03 5.9. 7) `HiddenImportBanner` cho 4 route `hidden` (gắn trong `AdminFrame` theo pathname; "Vẫn mở" ghi `sessionStorage` và gọi log). 8) Mục `available:false`. 9) Test: registry (5.2), React `AdminFrame` (nhóm mở, badge, Esc đóng ngăn kéo, nhãn môi trường không ẩn, dải ẩn-nhập hiện đúng 4 route, element ở chế độ v2 chỉ có slot).
- Đầu ra: 1 PR `feature`.
- Nghiệm thu: preview 1280px và 390px: mọi route `nav` có đúng một mục tô; không có mục "Import…", "Giáo viên duyệt", "Thi thử" trong Chấm bài; mở `/admin/listening/import-drills` thấy dải cảnh báo và nút "Vẫn mở"; đổi Sáng/Tối/Theo thiết bị có hiệu lực và nhớ sau tải lại; đăng xuất về `/login`; cờ tắt → khung cũ y nguyên; bộ test frontend + `tsc` + build qua.
- Không làm: không xoá `aver-admin-chrome.js`; không đổi `NAV_GROUPS` của element (khung cũ là đường lui); không sửa 75 `page.tsx`; không đổi cascade CSS trong `authed-shell.tsx`; không chặn API nhập.
- Vướng mắc → cách gỡ: hai thanh trên chồng nhau → class phải đặt bằng `bodyClass` phía server. CSS `admin-surface.css` cũ chừa lề trái → thêm quy tắc `.av-admin-frame-v2 …` trong CSS mới. `?embed=1` → `AdminFrame` không render khung. Trang cũ dùng token v1 trong khung v2 ở nền tối bị lệch màu → trang chưa chuyển giữ nền sáng trong vùng nội dung (bọc `data-theme="light"`), ghi danh sách trang trong PR.
- Ước lượng: 3 phiên · 4.

### G09-T09 — Liên kết vai trò trong khung học viên — GIỮ
- Mục đích: FR-004.
- Việc làm: trong `aver-chrome.js` `_applyRole` (hoặc khung React của G07 nếu đã thay) thêm `#admin-link` ("Sang khu quản trị") chỉ khi role `admin`; đổi "Trang giảng viên" → "Sang khu giáo viên". Test React: admin có hai link, giáo viên một, học viên không.
- Đầu ra: 1 PR. Nghiệm thu: test qua; preview đúng theo vai trò.
- Không làm: không đổi cách lấy role.
- Vướng mắc → cách gỡ: G07 sửa cùng file → bên vào sau rebase; file đã bị xoá → làm trong component G07. Test cũ ghim "Trang giảng viên" → sửa cùng PR.
- Ước lượng: 1 phiên · 2.

### G09-T10 — Danh bạ học viên `/admin/learners` — SỬA
- Mục đích: FR-020, 021, 028, 034, 035.
- Đầu vào: T03; tờ `AdminDanhBa`; `ThanhPhanDuLieu` (bảng; khối tóm tắt học viên); `admin-students-directory.tsx` (Import CSV, Thêm học viên, gán lớp hàng loạt).
- Việc làm: trang theo tờ: bảng 25 dòng, tìm, lọc ghi vào URL, cột Dạng · Khoá và hạn · Cần chú ý · Lượt chấm còn · Hoạt động gần nhất; ngăn "Xem nhanh" 400px chỉ chứa `LearnerSummary` + Mở hồ sơ / Gửi nhắc / Giao bài; thanh hàng loạt FR-035 (Gửi nhắc đăng ký lại → `/admin/notifications?from=learners&ids=…` qua state điều hướng, không đặt email vào URL); giữ Import CSV và Thêm học viên; 307 `/admin/users`, `/admin/students` → `/admin/learners` (giữ `?q=`).
- Đầu ra: 1 PR.
- Nghiệm thu: preview: tìm email ra đúng 1 dòng; lọc "Cần chú ý" khớp số ở Việc cần làm; "Xem nhanh" đóng bằng Esc và trả focus; route-ownership-check qua; test React (rỗng, đang tải, lỗi, phân trang, cột `null` hiện "chưa có").
- Không làm: không có thao tác nguy hiểm trong dòng hay hàng loạt; không đổi vai trò trong dòng.
- Vướng mắc → cách gỡ: `/admin/users` vừa là route vừa thành redirect → xoá `page.tsx` cũ và thêm redirect cùng commit. Test cũ đọc file trang đã bỏ (`tests/merge-codes-users-tabs.test.mjs`, `tests/admin-students-redesign.test.mjs`, `tests/sprint-18-3-2-students-chrome.test.mjs`) → thay bằng test hành vi, liệt kê trong PR; vỡ > 30 test ngoài dự kiến → dừng, báo.
- Ước lượng: 2 phiên · 3.

### G09-T11 — Hồ sơ học viên 5 thẻ + vùng nguy hiểm — SỬA (tách 2 PR)
- **T11a — Hồ sơ đọc:** `/admin/learners/[ref]` theo tờ `HoSoHocVien`: đầu trang `LearnerSummary`; thẻ Tổng quan (5 khối + cột phải), Học tập, Khoá và quyền (đọc; mỗi khoá hiện hạn, lượt còn, và nếu có: "N lượt chuyển từ khoá trước, dùng tới dd/mm/yyyy"; khoá đã hết hạn chưa đăng ký lại: "N lượt đã hết hiệu lực ngày …" — FR-056), Nhật ký hệ thống; thẻ Ghi chú chăm sóc gắn ở T35. Mỗi khối tải riêng; khối mục tiêu có "Dùng giá trị này" (FR-030). "Giao bài" mở `AssignDrawer` chọn sẵn người; "Gửi nhắc" mở hộp gửi một người (GOI-11). 3 phiên · 3.
- **T11b — Vùng nguy hiểm + đổi vai trò:** `DangerZone` cuối thẻ Khoá và quyền: Gỡ khỏi lớp (`DELETE /admin/cohorts/{id}/students/{student_id}`), Khoá tài khoản (`PATCH /admin/users/{id}/active`, step-up, lý do), Thu hồi quyền học (API G04, T14). **CHƯA KIỂM:** `admin_set_staff_active` (`routers/admin_staff_security.py`) có nhận tài khoản học viên không — kiểm `services/staff_security.py` và `grep -rn "suspended_at" backend/migrations/*.sql | head`; chỉ cho staff → bỏ "Khoá tài khoản" khỏi hồ sơ học viên, đưa vào Q9, không tự mở rộng route. Đổi vai trò (`PATCH /admin/users/{id}/role`) trong thẻ Khoá và quyền với hộp xác nhận. 2 phiên · 4.
- Đầu vào: tờ `HoSoHocVien`; T03, T04; `admin-access-gate.tsx` (`ADMIN_STEP_UP_EVENT`, `AdminStepUpDialog`).
- Nghiệm thu: staging với học viên kiểm thử: 5 thẻ mở được bằng link dán sang tab mới; band không hiện khi chưa có bài đã trả; hai nguồn mục tiêu lệch → bấm "Dùng giá trị này" → cả hai nguồn bằng nhau, Nhật ký có dòng; thẻ Tổng quan **không** có vùng nguy hiểm; học viên kiểm thử vừa đăng ký lại (sau G04) → cột phải và thẻ Khoá và quyền hiện đúng số lượt chuyển và hạn G04 trả, không có chữ "50%"; gỡ học viên kiểm thử khỏi lớp kiểm thử → hộp hỏi lại → Nhật ký có dòng; admin AAL1 gọi thẳng API → 403.
- Không làm: không thêm API ghi mới ở T11b; không xoá cứng; không dựng vai trò "Chăm sóc".
- Vướng mắc → cách gỡ: step-up 403 `step_up_required` → bắt `ADMIN_STEP_UP_EVENT`, mở dialog, gửi lại một lần. Biểu đồ "Điểm theo thời gian": đường chỉ vẽ khi có từ 2 điểm; dùng thành phần biểu đồ của G03, không thêm thư viện mới.

### G09-T12 — Mã kích hoạt: sổ tra cứu `/admin/activation-codes` — SỬA
- Mục đích: FR-048, 055.
- Việc làm: trang mới dùng lại `AdminAccessCodesPanel` cho phần danh sách; **bỏ** biểu mẫu tạo mã khỏi trang này; nút "Tạo mã cho một lớp" → chọn lớp → mở hộp của trang Lớp (T29); cột "Số lượt chấm cấp kèm mã" (đọc từ G04; chưa có → "chưa có"); thu hồi mã chưa dùng ở menu "⋯", mã đã dùng ở Vùng nguy hiểm trang mã; nhãn "sắp hết hạn" theo `code_expiring_days`. `/admin/users?tab=codes` → 307; redirect 308 `/admin/access-codes` đổi đích thành `/admin/activation-codes`.
- Đầu ra: 1 PR. Nghiệm thu: preview: hai đường cũ tới trang mới; không có `/admin/activation-codes/new`; test hợp đồng redirect ("Canonical clean alias") cập nhật cùng PR.
- Không làm: không đổi API mã; không đụng `is_used/used_by/used_at`.
- Vướng mắc → cách gỡ: trình duyệt nhớ 308 cũ → vẫn tới đích mới qua 307 của `/admin/users`. T29 chưa xong → nút "Tạo mã cho một lớp" tạm dẫn tới `/admin/classes/{id}` và ghi trong PR.
- Ước lượng: 1 phiên · 2.

### G09-T13 — Khoá học và đơn đăng ký (cần G04) — SỬA
- Mục đích: FR-040…044, 049…052, 056 (phần trang đơn), 079.
- Đầu vào: GOI-04 bản mới (route, mã lỗi, trạng thái); tờ `AdminKhoaHoc`, `AdminDonDangKy`; tờ `EmailMau` (e4, e5, e14, e6).
- Việc làm: 1) `/admin/courses` + `/admin/courses/[id]` 4 thẻ; thẻ Chương trình đọc `course_lessons` của G07 (sau G07-T18; nội dung nạp bằng script G07-T28, thẻ chỉ đọc danh sách bài và bật/tắt `is_preview`, `is_published`); chưa có thì hiện trạng thái 6a "Khoá chưa có nội dung" (sửa 18/11 theo rà soát); mọi số chưa chốt đọc từ dữ liệu; tạm dừng một hộp hỏi lại; lưu trữ qua `POST /admin/course-products/{id}/archive` của G04 (gõ đúng tên khoá; 409 khi còn người học hoặc đơn mở). 2) `/admin/enrollments` sáu làn, nhãn FR-041; `/admin/enrollments/[orderCode]`: lời nhắn học viên, ba ô đối chiếu, nút điền nhanh, kết quả đối chiếu, hộp "Xác nhận và mở khoá" đúng năm việc (FR-049), "Yêu cầu bổ sung" có lời nhắn + hạn, huỷ trong `DangerZone`, lịch sử thư, "Đơn kế tiếp", phím J/K. Đơn **đăng ký lại**: đầu trang đơn có dòng "Đơn đăng ký lại · sẽ chuyển N lượt chưa dùng, dùng tới dd/mm/yyyy" và hộp xác nhận nêu cùng số đó trong việc (2); sau xác nhận hiện số đã chuyển thật (FR-056); mọi số lấy từ G04. 3) Step-up khi máy chủ trả `step_up_required`.
- Đầu ra: 1 PR (hoặc 2: khoá · đơn).
- Nghiệm thu: staging với đơn kiểm thử: Đã báo chuyển → điền nhanh → Khớp → xác nhận → hồ sơ học viên có khoá hạn đúng, sổ lượt có dòng cộng, tài khoản kiểm thử vào được Reading/Listening; nhập thiếu → nút xác nhận khoá; yêu cầu bổ sung thiếu hạn → không gửi được; huỷ đòi gõ mã đơn; bấm xác nhận hai lần → một quyền; đơn đăng ký lại của học viên kiểm thử còn 3 lượt chưa dùng → trang đơn ghi "sẽ chuyển 3 lượt", sau xác nhận sổ lượt có dòng chuyển 3 lượt kèm hạn (không phải 1 hay 2 lượt); `grep -rnE "chuyển 50|50% lượt" frontend/components/admin frontend/app` rỗng.
- Không làm: không tính học phí ở frontend ngoài so sánh; không tự hoàn tiền; không gửi thư từ frontend; không tự viết logic mở lại đơn hết hạn.
- Vướng mắc → cách gỡ: G04 chưa merge → dừng, làm nhiệm vụ khác. Hợp đồng theo bảng "API G04 mà G09 gọi" (5.4): `request-info` có `info_kind` và `supplement_by`, huỷ có `confirm_order_code`, xác nhận trả `reopened`; bản G04 đã merge thiếu trường nào → không giả lập ở frontend, ẩn phần tương ứng và báo G04.
- Ước lượng: 3 phiên · 4.

### G09-T14 — Quyền luyện lại và thu hồi quyền (cần G04) — SỬA
- Mục đích: FR-045, 046.
- Việc làm: component `PracticeGrantForm` dùng chung (trang lớp: cả lớp hoặc người đã chọn; hồ sơ: một người; danh bạ: gia hạn hàng loạt); hỏi lại nêu số người; gọi API G04 (lô nếu có, không thì từng người kèm "Thử lại phần còn lại"); thu hồi trong `DangerZone` của hồ sơ.
- Đầu ra: 1 PR. Nghiệm thu: staging: cấp Course 2 luyện lại cho học viên kiểm thử lớp Course 1 → vào được Course 2; thu hồi (gõ họ tên) → mất quyền; Nhật ký có hai dòng; danh sách khoá không có khoá của chính lớp.
- Không làm: không tạo mã kích hoạt giả để cấp quyền.
- Vướng mắc → cách gỡ: lỗi giữa chừng khi gọi N lần → hiện danh sách đã cấp/chưa cấp, không rollback ở frontend. Tên nguồn quyền → theo G04 (phân xử 12).
- Ước lượng: 2 phiên · 4.

### G09-T15 — Sổ lượt AI `/admin/credits` (cần G04) — SỬA
- Mục đích: FR-047, 054, 056 (phần sổ lượt).
- Việc làm: tìm người → số dư **theo khoá** + lịch sử; dòng chuyển lượt (`carry_over`) hiện số lượt và "dùng tới dd/mm/yyyy"; dòng hết hạn phần lượt chuyển hiện theo `label_vi`; cạnh số dư có dòng "trong đó N lượt chuyển, dùng tới …" khi G04 trả; "Điều chỉnh lượt" (chọn quyền còn hiệu lực, cộng/trừ, số nguyên dương, lý do ≥ 10 ký tự, hộp hỏi lại, `request_key`); khối "Sắp hết lượt chấm" theo `low_credits` link sang danh bạ đã lọc; "Cấp thêm lượt cho học viên/lớp…" mở hộp của trang Lớp. Không có ô chọn kỹ năng.
- Đầu ra: 1 PR. Nghiệm thu: staging: cộng 5 lượt cho học viên kiểm thử → số dư tăng 5, dòng mới có lý do và người làm; trừ quá số dư → hiện nguyên thông báo máy chủ; không có nút sửa/xoá dòng; học viên kiểm thử đã đăng ký lại → sổ có dòng chuyển lượt với đúng số lượt chưa dùng của khoá trước và hạn; trang không có chữ "50%".
- Không làm: không cộng dồn số dư ở trình duyệt; không tự tính số lượt chuyển hay hạn của phần lượt chuyển.
- Vướng mắc → cách gỡ: gặp `reason` ngoài các giá trị đã biết của G04 (bảy giá trị ở mục 5.9 và dòng hết hạn phần lượt chuyển) → hiện `label_vi` máy chủ trả, không có thì "Điều chỉnh khác", báo G04. `grant-extra` trả `skipped` khác rỗng → hộp kết quả liệt kê từng người và lý do, không coi là lỗi.
- Ước lượng: 1 phiên · 3.

### G09-T16 — Hộp thư sự cố `/admin/incidents` — SỬA
- Mục đích: FR-070…073.
- Đầu vào: T07; tờ `AdminSuCo`; `admin-error-logs.tsx`, trang alerts, `admin-feedback.tsx`.
- Việc làm: một trang, thẻ nguồn `?source=`; danh sách nhóm 25/trang, mặc định Chưa xử lý; hành động hàng loạt có Hoàn tác; trang chi tiết nhóm ("Chi tiết kỹ thuật" gập sẵn); dòng "N câu đang chờ ở Câu cần kiểm" (ẩn khi 0); 307 ba route cũ + `/admin/system`. Bỏ "Tạo lỗi test" khỏi đây (dời sang `/admin/qa-tools`, T18).
- Đầu ra: 1 PR. Nghiệm thu: staging: số nhóm < số dòng; xử lý một nhóm → số giảm đúng; tạo lỗi mới cùng loại → nhóm tự về "Mới" và còn ghi chú.
- Không làm: không kiểm trên production.
- Vướng mắc → cách gỡ: feedback dùng `/api/admin/feedback` → giữ đường gọi cho thao tác trả lời. Test `tests/admin-error-logs.test.mjs` ghim "ADR-012", "FREEZE §4" → sửa cùng PR.
- Ước lượng: 2 phiên · 3.

### G09-T17 — Chấm Writing: một hàng chờ duyệt, phím tắt, dải tóm tắt — SỬA
- Làm cùng đợt (00 điểm 24, thêm 18/11): G12-C01…C03 lưu cặp điểm AI–giáo viên ở bảng riêng `writing_score_pairs` (migration 480), ghi lúc trả bài trong `instructor_workflow.deliver` (sau bước 2) và `admin_writing._deliver_essay` (sau khi RPC trả `ok`; C03 thêm tham số `actor_id` cho `_deliver_essay`, đây không phải đổi luồng `mark-delivered`). T17 không thêm cột điểm và không đổi chữ ký hai hàm này; hai bên cùng chạm luồng trả bài nên xếp PR nối nhau, T17 trước, C03 rebase.
- Mục đích: FR-060, 061, 064…069.
- Đầu vào: tờ `AdminChamWriting`; `routers/admin_writing.py` (`essay-queue`), `routers/admin_instructor_queue.py`, `services/instructor_workflow.py`; trang `/admin/writing/queue`, `/grade`, `/instructor-queue`, `/status`.
- Việc làm: 1) Backend: `essay-queue` thêm tham số `sort=next_lesson` (theo `class_lessons.lesson_date` kế tiếp của lớp rồi `waited`), `mock_exam_id`, `ai_failed=1`; mỗi dòng thêm `cohort`, `waited_from`, `next_lesson_date`; đầu ra thêm `remaining`, `remaining_today_classes`. Bài AI lỗi là bộ lọc, không cộng thêm. 2) Frontend: một bảng "Bài chờ duyệt"; `/admin/writing/instructor-queue` → 307 về `/admin/writing/queue`; khối trạng thái vào màn chấm (`panel=status`); Ctrl Enter / J / K; dòng "còn N bài · M bài của lớp học hôm nay"; dải tóm tắt (`LearnerSummary` rút gọn: 4 band gần nhất, mục tiêu, loại chú thích lặp, link hồ sơ); bài thi thử không có nút trả; nhãn lời thường. 3) "Quá hạn" theo `writing_review_hours`.
- Đầu ra: 1 PR (backend + frontend nếu nhỏ; tách hai nếu quá 600 dòng).
- Nghiệm thu: preview: sidebar không còn "Giáo viên duyệt"; bài Speaking luyện tập không xuất hiện trong hàng chờ; Ctrl Enter trả bài kiểm thử rồi mở bài kế; J/K không trả; bài thi thử không có nút trả; `grep -rn "Claim atomic\|Hàng đợi Instructor" frontend/app` rỗng.
- Không làm: không đổi thuật toán chấm; không đổi luồng `mark-delivered`; không thêm cột điểm AI/giáo viên vào `writing_essays`, `instructor_reviews`, `writing_feedback`: cặp điểm do G12-C02/C03 lưu ở `writing_ai_score_snapshots` và `writing_score_pairs` (migration 480). Nếu T17 thêm đường sửa điểm mới thì đường đó phải đi qua `essay_service.upsert_composed_version` (GOI-12 K5).
- Vướng mắc → cách gỡ: trước G04 chưa có `review_mode` để tách "lớp offline" → hàng chờ = bài đang ở tầng duyệt hiện có; ghi trong PR. Khoá mềm tự nhả 30 phút chưa có → chỉ hiện ai đang giữ + nút "Nhận chấm thay" dùng `release`/`claim` sẵn có; tự nhả theo thời gian là việc backend riêng sau khi Q19 chốt. Test `admin-writing-status-redesign.test.mjs`, `admin-instructor-queue-redesign.test.mjs` ghim chuỗi → sửa cùng PR, liệt kê.
- Ước lượng: 3 phiên · 4.

### G09-T18 — Trang Việc cần làm, AI và mô hình, Công cụ QA — SỬA
- Mục đích: FR-073, 074, 090…093.
- Đầu vào: T06, T22; tờ `AdminViecCanLam`, `AdminHeThong`.
- Việc làm: `/admin`: khối hàng chờ (`QueueRow`, thứ tự cố định, dòng lỗi có tải lại riêng), "Lớp hôm nay và tuần này" ("Giao bài…" mở `AssignDrawer` với lớp và buổi chọn sẵn; "Xem kết quả bài giao"), "Cần chú ý tuần này", "Vận hành tuần này"; dòng hàng chờ "Lớp chưa chuyển sang đo lượt" (`classes_unmetered`) mở `/admin/classes?metering=legacy`. Dời `AdminAiPanel` sang `/admin/ai-models` + khối xác nhận có lý do ≥ 10 ký tự (lý do ghi log phía client gửi kèm nếu API nhận; API 0024 không nhận → chỉ xác nhận, Q7). `/admin/qa-tools`: link `recommend-test`, `mock-exams/corrections`, nút "Tạo lỗi thử" (`POST /admin/error-logs/test`) chỉ khi `environment !== 'production'`.
- Đầu ra: 1 PR. Nghiệm thu: preview: `/admin` không còn bảng model; dòng nguồn lỗi (giả lập 500) ghi "chưa có" và các dòng khác vẫn có số; "Kỳ thi hôm nay" chỉ hiện ngày có kỳ thi; không có nút trả kết quả thi thử; `tests/react/admin-ai-panel.test.tsx` qua.
- Không làm: không đổi API 0024; không thêm step-up cho đổi model.
- Vướng mắc → cách gỡ: panel poll 30 giây → dừng poll khi rời trang. `admin-overview-partial-failures.test.tsx` ghim panel → cập nhật.
- Ước lượng: 2 phiên · 3.

### G09-T19 — Tìm nhanh Ctrl/⌘ K — GIỮ
- Mục đích: FR-075, 102.
- Việc làm: `AdminCommandPalette` trong `AdminFrame`; bỏ qua phím tắt khi con trỏ ở ô nhập; gọi T05; `role="dialog"`, `aria-modal`, danh sách `role="listbox"`.
- Đầu ra: 1 PR. Nghiệm thu: React test: Ctrl+K và Meta+K mở, Esc đóng và trả focus, ↑↓ Enter mở đúng href; preview: tìm học viên kiểm thử → hồ sơ trong 2 thao tác.
- Không làm: không lưu lịch sử tìm; không làm "bảng lệnh".
- Vướng mắc → cách gỡ: ⌘K trùng phím trình duyệt → chỉ `preventDefault` khi palette xử lý. Nhóm rỗng → ẩn nhóm, không hiện tiêu đề trống.
- Ước lượng: 1 phiên · 3.

### G09-T20 — Khu giáo viên trong khung chung, 5 mục — SỬA
- Mục đích: FR-100…104.
- Đầu vào: `instructor-dashboard.tsx`, `instructor-grade.tsx`, `instructor-compare.tsx`; tờ `GiaoVien`; T06, T24, T26, T27.
- Việc làm: layout giáo viên dùng `AdminFrame role="instructor"`; `?tab=today|classes|students|assign|grading`; **Việc của tôi** (trang đầu) từ `GET /instructor/attention`; Lớp của tôi (bảng tiến độ học viên × bài từ `assignment-matrix`, bài quá hạn "Xem ai chưa nộp" + gửi nhắc); Học viên (ngăn `LearnerSummary`); Giao bài = `AssignDrawer`; Chấm và duyệt bài (Writing chờ duyệt + Speaking thi thử chờ chấm của lớp mình). Bỏ "Đăng xuất" cạnh "Làm mới".
- Đầu ra: 1–2 PR. Nghiệm thu: staging với hai tài khoản giáo viên kiểm thử: 5 mục, tải lại giữ mục; giáo viên A mở URL lớp của B → về trang cha kèm một dòng, không lộ tên; không có nút trả kết quả thi thử, không có thao tác mã/quyền; admin "xem như giáo viên" vẫn có dải và nút thoát.
- Không làm: không đổi `/instructor` sang đường dẫn khác; không cho giáo viên xem Nhật ký lớp.
- Vướng mắc → cách gỡ: G10 không gộp ba group giáo viên → gắn `AdminFrame` trong từng layout (3 file). API lớp hiện chỉ `require_admin` (ví dụ `tally`, `assignments`) → chỉ mở cho giáo viên những route liệt kê ở 5.4 qua `staff_scope`, không mở rộng hàng loạt.
- Ước lượng: 3 phiên · 3.

### G09-T22 — Migration 440 và API Cài đặt / ngưỡng — MỚI
- Mục đích: FR-080, 081, 084; 5.6.
- Đầu vào: `routers/admin_flags.py`, `services/runtime_flags.py` (mẫu cache), mig 356 (mẫu chỉ ghi thêm), tờ `AdminCaiDat` mục 7, 8.
- Việc làm: `440_admin_settings.sql` + rollback; `services/ops_thresholds.py` (`get()`, `set_many(changes, reason, actor)`; kiểm khoảng; `fixed` không sửa được); `routers/admin_settings.py` theo 5.4 (thêm route vào file GOI-11 T16 đã tạo nếu đã có — một router cho `/admin/settings/*`); test: ngoài khoảng → 422 tiếng Việt; lưu ghi log cũ → mới; giáo viên đọc được, không ghi được; ngưỡng `null` giữ `null`.
- Đầu ra: 1 PR backend (`high-risk`: migration).
- Nghiệm thu: pytest qua; áp migration trên DB thử: `SELECT value FROM admin_settings WHERE key='ops_thresholds'` có đủ khoá 5.6; UPDATE vào `admin_settings_log` bị từ chối.
- Không làm: không viết job xoá bản ghi âm; không lưu bí mật trong `admin_settings`.
- Vướng mắc → cách gỡ: GOI-11 T16 đã tạo `routers/admin_settings.py` → thêm vào file đó, không tạo router thứ hai cùng prefix. Số 440 đã bị dùng → theo sổ đăng ký của G10, lấy số kế trong dải và cập nhật bảng 5.3 trong PR.
- Ước lượng: 1 phiên · 3.

### G09-T23 — Trang Cài đặt (các thẻ ngoài Chấm thử) — MỚI
- Mục đích: FR-080…084.
- Đầu vào: tờ `AdminCaiDat`; T22; trang `/admin/settings` của GOI-11 T16 (nếu đã có).
- Việc làm: thẻ `thresholds` (bảng nhóm · ngưỡng · giá trị · dùng ở; "Lưu…" liệt kê thay đổi cũ → mới; giảm thời gian lưu hiện cảnh báo không lấy lại được); thẻ `email` (bảng loại thư: năm thư bắt buộc không có công tắc; loại khác tắt có xác nhận; "Gửi thử" chỉ khi GOI-11/G04 có API gửi thử, không thì ẩn); thẻ `features` (dùng `GET/PATCH /admin/runtime-flags`, lý do ≥ 10 ký tự); thẻ `notices` (thông báo bảo trì: lưu vào `admin_settings` khoá `system_notices`; không được trùng kỳ thi đã lên lịch — máy chủ kiểm); thẻ `payment` chỉ đọc từ cấu hình G04 cho tới khi Q20 chốt; thẻ `legal` hiện "chưa mở" (Q21); khối "Nhật ký thay đổi cài đặt" cuối mọi thẻ. `ThresholdsProvider` trong `AdminFrame`.
- Đầu ra: 1 PR. Nghiệm thu: staging: đổi `writing_review_hours` từ 48 xuống 1 → một bài chờ duyệt kiểm thử hiện "quá hạn" ở hàng chờ và Việc cần làm mà không cần deploy; nhập 0 hoặc chữ → lỗi dưới ô; thẻ Chấm thử của GOI-11 vẫn chạy; `grep -rnE "48 ?giờ|72 ?giờ" frontend/components/admin frontend/app` không ra hằng số ngưỡng trong mã (chỉ được có trong test/fixture).
- Không làm: không dựng nội dung thẻ Chấm thử; không cho sửa số tài khoản nhận tiền khi chưa có Q20.
- Vướng mắc → cách gỡ: GOI-11 T16 chưa merge → tạo trang với các thẻ của G09, thẻ `trial` `available:false`; khi T16 vào thì T16 thêm thẻ. Hai gói cùng sửa một `page.tsx` → gói đứng sau rebase.
- Ước lượng: 2 phiên · 3.

### G09-T24 — Migration 441 và phạm vi giáo viên theo lớp — MỚI
- Mục đích: FR-102, 108, 113; "lớp của giáo viên" có ở máy chủ, **mỗi lớp một giáo viên** (00 mục 2 điểm 23 — Q18 đã đóng). Đây cũng là "cách G09 chốt phạm vi giáo viên" mà GOI-11 (5.1.7, 5.5.8) dùng.
- Đầu vào: mig 060, 106, 227 (`student_cohort_memberships`); `routers/instructor.py` (`_me`, `instructor_db`); `routers/cohorts.py` (`PATCH /{cohort_id}` dòng 143); `services/staff_guard.py`; `tests/test_staff_guard_inventory.py` (`GUARD_NAMES` dòng 57).
- Việc làm: 1) `441_cohort_teacher_schedule.sql` + rollback: **một cột** `cohorts.instructor_id` (không tạo bảng nối giáo viên–lớp), cột lịch, và phần điền cho lớp đang có theo đúng quy tắc ở 5.3 (suy từ `students.instructor_id` của thành viên active khi cả lớp cùng một giáo viên; còn lại để NULL, in NOTICE). 2) `services/staff_scope.py` (5.4) — nơi duy nhất đọc `cohorts.instructor_id` để quyết định quyền. 3) `PATCH /admin/cohorts/{cohort_id}` nhận `instructor_id`, `weekly_schedule`, `start_date`; kiểm vai trò người được gán (5.4); ghi `class_action_log`; `GET` lớp trả `instructor`. 4) Khi đặt `cohorts.instructor_id` thì **không** tự đổi `students.instructor_id` (giữ đường Writing hiện tại của giáo viên). 5) Thêm `resolve_staff_scope` vào `GUARD_NAMES` kèm test hàm bọc (5.4). 6) Test: giáo viên chỉ thấy lớp mình; admin thấy tất cả; lớp `instructor_id` NULL chỉ admin thấy; đổi giáo viên lớp từ A sang B → A nhận 404 ở lần gọi kế, B thấy lớp; gán người có vai trò `user` → 422 `invalid_instructor`; học viên ở hai lớp của hai giáo viên → mỗi giáo viên chỉ thấy bài của lớp mình.
- Đầu ra: 1 PR backend (`high-risk`: quyền + migration).
- Nghiệm thu: pytest qua; áp migration trên DB thử: `\d cohorts` có đúng một cột `instructor_id`, không có bảng `cohort_instructors`; lớp thử có mọi thành viên cùng giáo viên → cột được điền, lớp lẫn hai giáo viên → NULL và có tên trong NOTICE; PR liệt kê kết quả `grep -rnE "cohorts.*instructor_id|instructor_id.*cohorts" backend/routers backend/services --include="*.py"`: ngoài `services/staff_scope.py` và phần đọc/ghi của `routers/cohorts.py`, không file nào tự truy vấn cột này để quyết định quyền; inventory qua.
- Không làm: không đổi RLS của `students`; không gộp hai khái niệm "giáo viên của học viên" (`students.instructor_id`, đường Writing cũ) và "giáo viên của lớp"; không tạo bảng hay cột cho giáo viên thứ hai, trợ giảng; không tự gán anh Andy vào lớp đang NULL (Q35).
- Vướng mắc → cách gỡ: lớp sau khi điền còn NULL → chỉ admin thấy, mọi việc của lớp về hàng chờ admin; admin chọn giáo viên ở trang Lớp (T29). Production hiện 0 tài khoản vai trò giáo viên (16/11) → phần điền gần như để NULL toàn bộ, đây là kết quả đúng (anh Andy là admin, thấy mọi lớp). Sau này cần nhiều giáo viên một lớp → quyết định mới của anh Andy; hàm `staff_scope` giữ nguyên chữ ký nên nơi gọi không đổi. Inventory không nhận guard bọc → xem 5.4.
- Ước lượng: 2 phiên · 4.

### G09-T29 — Trang Lớp: thẻ, bảng học viên × bài, mã kèm lượt, cấp thêm lượt — MỚI
- Mục đích: FR-053, 054, 108, 120, 124. (Thao tác "Cấp lượt cho lớp cũ" tách thành T43 vì T29 đã lớn và T43 phụ thuộc API mới của G04.)
- Đầu vào: tờ `AdminLop`, `Admin1024` (bản 1024px của trang Lớp); `admin-class-detail.tsx`, `admin-class-homework.tsx`; T24, T26, T27; G04 (mã có sản phẩm và số lượt).
- Việc làm: thẻ trên URL; thẻ Học viên = bảng học viên × bài (`assignment-matrix`); thẻ Buổi học (danh sách buổi, giao bài theo buổi, câu nên chữa đã lưu); thẻ Bài nộp (tên bài → T28; "Gửi nhắc" → hộp liệt kê người thiếu bài đã qua hạn); thẻ Kiểm tra (danh sách bài kiểm tra → T30); thẻ Nhật ký (`action-log`); hộp "Cấp mã kích hoạt cho lớp" có ô số lượt (gọi API tạo mã của G04); nút "Gửi thư mời" khi tạo mã cho học viên có email: xếp thư `class_invite` (to_email, mã, tên lớp, liên kết `/activate#code=`) qua `learner_email.send_direct` của G04; "Gửi lại" ghi nhật ký (thư 3 tờ EmailMau; mẫu chữ do G05-T14 viết — sửa 18/11 theo rà soát); hộp "Cấp thêm lượt…" (API G04); biểu mẫu quyền luyện lại (T14); lưu trữ lớp trong Vùng nguy hiểm (gõ đúng tên lớp, bỏ khoảng trắng hai đầu). Giáo viên của lớp (FR-108): đầu trang lớp và cột ở danh sách lớp hiện tên giáo viên hoặc "chưa có giáo viên"; admin đổi bằng **một ô chọn một người** (gọi `PATCH /admin/cohorts/{id}` của T24), hỏi lại khi lớp đang có bài chờ duyệt (nêu số bài sẽ đổi người nhận); không có điều khiển thêm giáo viên thứ hai.
- Đầu ra: 1–2 PR. Nghiệm thu: staging: tải lại giữ thẻ; đổi giáo viên lớp kiểm thử 1 từ A sang B → trang lớp ghi B, Nhật ký lớp có dòng, tài khoản A mở lớp đó nhận trang cha kèm một dòng giải thích; trang lớp không có nút "Thêm giáo viên"; tạo 3 mã kèm 5 lượt cho lớp kiểm thử → sổ mã hiện cột lượt = 5; cấp thêm 2 lượt cho một người → sổ lượt người đó có dòng mới có lý do; gửi nhắc lần hai trong ngày không gửi thêm.
- Không làm: **không** dựng "Tạo lớp ba bước sinh buổi từ lịch tuần" và "Dời buổi" khi Q25 chưa chốt (cột đã có ở 441 nhưng luồng là đề xuất của người thiết kế); không dựng thẻ Kiểm tra "Theo buổi" khi chưa có spec 0043/T27 biến thể `course_test`.
- Vướng mắc → cách gỡ: G04 chưa có số lượt kèm mã → hộp tạo mã vẫn dùng API hiện tại (`/admin/access-codes/generate`), ô số lượt ẩn kèm ghi chú trong PR. Tính năng exercise-book đang tắt → không đụng.
- Ước lượng: 3 phiên · 3.

### G09-T35 — Ghi chú chăm sóc (migration 442) — MỚI
- Mục đích: FR-032; dòng "Cần liên hệ hôm nay".
- Việc làm: migration + rollback; `routers/admin_care_notes.py` (5.4); phần tử ảo từ `persona_notes`; `editable` = tác giả và trong `CARE_NOTE_EDIT_HOURS`; thẻ "Ghi chú chăm sóc" của hồ sơ (danh sách mới trước, biểu mẫu thêm, đánh dấu xong); `care_due_today` trong T06; cột phải thẻ Tổng quan "việc đã hẹn"; `latest_note` trong `LearnerSummary`.
- Đầu ra: 1 PR. Nghiệm thu: pytest (sửa sau hạn → 409, đánh dấu xong vẫn được; xoá mềm); staging: thêm ghi chú hẹn hôm nay cho học viên kiểm thử → Việc cần làm có 1 ở "Cần liên hệ hôm nay"; đánh dấu xong → về "Không có"; ghi chú không xuất hiện ở Nhật ký hệ thống.
- Không làm: không có kênh liên hệ, người liên hệ, phân công, vai trò "Chăm sóc"; không cho giáo viên đọc/ghi ghi chú ở gói này (Q16 phần b).
- Vướng mắc → cách gỡ: hồ sơ chỉ có `users` (chưa có `students`) → ghi theo `user_id`. Quy tắc sửa/xoá chưa chốt → giá trị cấu hình (Q16).
- Ước lượng: 2 phiên · 3.

### G09-T38 — Chấm Speaking thi thử — MỚI
- Mục đích: FR-060, 065, 067, 069; số "Speaking" trên sidebar.
- Đầu vào: tờ `AdminChamSpeakingThiThu`; `admin_mock_exams.py` (`record-speaking` 840, `bulk-final-bands` 738, `roster` 539); `services/mock_review_workflow.py`.
- Việc làm: `GET /admin/speaking/mock-queue` (5.4): bài "chờ chấm" = sitting có kỹ năng Speaking, đã có bản ghi (`speaking.count > 0` / `completed_at`) và chưa có band Speaking cuối — người thực thi xác nhận tên trường trong roster (`grep -n "speaking" backend/services/mock_review_workflow.py | head -30`) và ghi vào PR; trang `/admin/speaking/grading` (hàng chờ, lọc Kỳ thi) + màn chấm (trình phát A–B, tốc độ 0.75/1/1.25, bốn tiêu chí, đề xuất của AI nếu dữ liệu có, lưu điểm vào kỳ thi qua API band hiện có); Ctrl Enter lưu và mở bài kế; không có nút trả; giáo viên chỉ thấy lớp mình.
- Đầu ra: 1 PR. Nghiệm thu: staging: bài Speaking luyện tập không có trong hàng chờ; chấm xong một bài → số trên sidebar và Việc cần làm giảm 1, thẻ Chấm của kỳ thi cập nhật; không có nút trả.
- Không làm: không gọi AI chấm mới; không dựng cờ "Quá ngắn"/"Không nghe được" nếu dữ liệu chưa có (ẩn cột); không dựng "đoạn mẫu chấm phát âm" (thuộc gói chấm).
- Vướng mắc → cách gỡ: bản ghi lưu ở Storage riêng tư → dùng URL ký của API hiện có, không mở bucket. Không có dữ liệu đề xuất AI → khối đề xuất ghi "chưa có đề xuất".
- Ước lượng: 2 phiên · 3.

### G09-T39 — Yêu cầu chấm lại — MỚI
- Mục đích: FR-062.
- Đầu vào: tờ `AdminChamLai`; `routers/admin_writing_regrade.py`; mig 084.
- Việc làm: danh sách (nguyên văn lý do, lớp/khoá, band hiện tại, "Đã chờ" theo `regrade_hours`); màn xử lý ba quyết định; "Giữ nguyên điểm" ≥ 40 ký tự; dòng "Không trừ lượt chấm AI của học viên" luôn hiện; đã trả lời là chỉ xem; ghi vào nhật ký hồ sơ (nguồn `log` của T04 đọc `essay_regrade_requests`).
- Đầu ra: 1 PR. Nghiệm thu: preview: từ chối thiếu giải thích không gửi được; yêu cầu đã trả lời không còn nút.
- Không làm: không dựng trạng thái "Đang xem", lọc năm lý do, chấm lại hàng loạt khi bảng chưa có cột tương ứng (kiểm theo lệnh ở 6.1; thiếu → ghi vào PR, ẩn phần đó). Sau khi G07-T21 merge (có `reason_code`): bật lọc Lý do và "Chấm lại bằng AI" hàng loạt cho `wrong_submission` trong PR nhỏ cùng nhiệm vụ; "Đang xem" cần cột khoá mềm — để sau, ghi vào mục 10.
- Vướng mắc → cách gỡ: người nhận theo "giáo viên lớp đó" cần T24; trước T24 mọi yêu cầu về admin. Thư trả lời học viên do backend hiện có gửi hay không: CHƯA KIỂM (`grep -n "email\|notify" backend/routers/admin_writing_regrade.py`); không có → chỉ thông báo trong ứng dụng qua GOI-11.
- Ước lượng: 2 phiên · 3.

### G09-T40 — Giáo viên (bảng, hồ sơ) và nối "Gửi thông báo" — MỚI
- Mục đích: FR-105…107.
- Đầu vào: tờ `AdminGiaoVienThongBao`; `routers/admin_instructors.py`; `admin-instructors.tsx`; T24; GOI-11 T13 (trang và API gửi).
- Việc làm: `/admin/instructors` thành bảng sắp xếp được (lớp phụ trách, số bài chờ, thời gian duyệt trung bình 30 ngày — dưới ngưỡng số bài thì để trống); `/admin/instructors/[id]` (cột và khối "Lớp phụ trách" = các lớp có `cohorts.instructor_id` là người này — mỗi lớp chỉ thuộc một giáo viên nên một lớp không bao giờ hiện ở hai hồ sơ); "Gỡ khỏi lớp" (gọi `PATCH /admin/cohorts/{id}` với `instructor_id: null`, hỏi lại nêu số bài chuyển về admin); "Đổi giáo viên của lớp…" (chọn một người thay thế, cùng route); không có "Thêm giáo viên vào lớp" khi lớp đã có giáo viên; lời mời theo cơ chế hiện có (kiểm theo lệnh ở 6.1). Trang `/admin/notifications`: G09 thêm nguồn "Danh sách đã chọn" (nhận danh sách từ Danh bạ, bảng lớp, Kết quả bài giao, Việc cần làm qua state điều hướng; hiện dòng nguồn; chỉ bớt người) vào trang của GOI-11 T13; gửi dùng `audience: {learners: [...]}` của GOI-11.
- Đầu ra: 1 PR. Nghiệm thu: staging: chọn 3 người ở Danh bạ → "Gửi nhắc đăng ký lại" → trang Gửi thông báo có đúng 3 người và dòng nguồn; bớt 1 người → hộp xác nhận nêu 2; danh sách trống → nút Gửi tắt; gỡ giáo viên kiểm thử A khỏi lớp 1 → lớp ghi "chưa có giáo viên", hồ sơ A không còn lớp đó; đổi giáo viên lớp 2 từ B sang A → lớp 2 chỉ hiện ở hồ sơ A.
- Không làm: không viết API gửi (GOI-11); không dựng "Nhóm theo điều kiện" nếu GOI-11 chưa có kiểu audience đó (ghi vào mục 7); không thu hồi quyền nhân sự ở đây (thuộc Bảo mật, gói sau).
- Vướng mắc → cách gỡ: GOI-11 T13 chưa merge → chỉ làm phần Giáo viên, mục sidebar "Gửi thông báo" `available:false`. Danh sách người nhận không đặt trong URL (dữ liệu cá nhân) → dùng state điều hướng/`sessionStorage`, mất khi tải lại thì hiện "Danh sách đã hết hạn, chọn lại từ Danh bạ".
- Ước lượng: 2 phiên · 3.

### G09-T41 — Báo cáo một trang bốn thẻ — MỚI
- Mục đích: FR-164.
- Đầu vào: tờ `AdminBaoCao`; API hiện có `GET /admin/analytics/foot-traffic`, `GET /admin/ai-usage?days=`, `GET /admin/usage/users`, `GET /admin/overview`; T06, T36.
- Việc làm: `/admin/reports` với `?tab=` và `?range=`; mỗi thẻ dựng các số và bảng tính được từ API hiện có, kèm link "Xem chi tiết" tới trang báo cáo cũ (loại `context` ở 5.1); thẻ Hoạt động: bảng theo lớp (số cần chú ý mở Danh bạ đã lọc); thẻ Chất lượng: ba số + link Câu cần kiểm; thiếu dữ liệu ghi "chưa có" kèm lý do; "Xuất CSV" cho thẻ đang mở từ dữ liệu đã tải.
- Đầu ra: 1 PR. Nghiệm thu: preview: bốn mục sidebar mở đúng thẻ; tải lại giữ thẻ và khoảng; không có "0/0"; lỗi một nguồn chỉ hỏng khối đó.
- Không làm: không viết API báo cáo mới; không vẽ lại các hình của trang cũ; không dựng khoảng ngày tuỳ chọn nếu API chưa nhận `from/to` (ẩn).
- Vướng mắc → cách gỡ: API cũ chỉ nhận `days` → `range` ánh xạ sang `days`. Bảng theo khoá cần G04 → ẩn cho tới khi có.
- Ước lượng: 2 phiên · 3.

### G09-T42 — Áp staging và nghiệm thu đầu-cuối — MỚI
- Mục đích: chứng minh 23 kịch bản mục 9 trên staging đã merge.
- Việc làm: áp migration 440–451 lên staging theo thứ tự (bước do người có quyền chạy; người thực thi chuẩn bị lệnh và kiểm sau); bật cờ từng phần; chạy từng kịch bản bằng tài khoản QA; ghi bằng chứng (bước bấm, ảnh chỉ có tài khoản `@staging-e2e.averlearning.com`); liệt kê kịch bản chưa chạy được và lý do (gói phụ thuộc chưa xong).
- Đầu ra: báo cáo theo mẫu mục 8 của quy ước chung. Nghiệm thu: mỗi kịch bản có trạng thái đạt / chưa đạt / chưa chạy được kèm bằng chứng.
- Không làm: không đụng production; không bật `ADMIN_FRAME_V2` ở production.
- Vướng mắc → cách gỡ: một migration lỗi trên staging → dừng ở đó, không chạy số sau; báo kèm đầu ra. Thiếu tài khoản giáo viên kiểm thử → xin anh Andy tạo, không tự tạo trên production.
- Ước lượng: 2 phiên · 3.

### G09-T43 — Cấp lượt cho lớp cũ: chuyển lớp chạy bằng mã cũ sang đo lượt (cần G04) — MỚI (18/11 chiều)
- Mục đích: FR-057, 058 (00 mục 2 điểm 23: lớp đang chạy bằng mã cũ CÓ chuyển sang đo lượt). Tách khỏi T29 vì T29 đã lớn và nhiệm vụ này chờ API mới của G04.
- Đầu vào: tờ `AdminLop` (trang Lớp; **chưa có tờ thiết kế riêng** cho hộp thao tác này — dựng từ hộp xác nhận của "Cấp thêm lượt" và thành phần modal/bảng của G03); T29 (trang Lớp, hộp "Cấp thêm lượt"); T06 (`classes_unmetered`); API G04 `GET /admin/credits/convert-class/preview`, `POST /admin/credits/convert-class`, cấu hình `legacy_class_initial_credits` (GOI-04 mục 5.9, 5.10 bản 18/11 chiều); `admin-access-gate.tsx` (step-up).
- Việc làm: 1) `LegacyClassCreditsDialog` (5.7) mở từ: dải thông báo đầu trang lớp, menu thao tác của trang lớp, hộp kết quả "Cấp thêm lượt" khi có người bị bỏ qua vì `no_class_entitlement`. Bốn bước trong một hộp: xem trước (bảng thành viên dùng mã cũ chưa có nơi nhận lượt; số người sẽ cấp; người bỏ qua kèm lý do) → nhập "Số lượt mỗi người" (điền sẵn số gợi ý G04 trả; trống thì bắt nhập; số nguyên dương; ghi đơn vị lượt như FR-053) → xác nhận (tên lớp, số người, số lượt mỗi người, câu "Sau khi cấp, bài của các bạn này bắt đầu được tính lượt") → kết quả. 2) Gửi `POST` kèm `request_key` sinh một lần cho mỗi lần mở hộp; lỗi mạng thì "Thử lại" dùng lại đúng khoá đó. 3) Danh sách lớp `/admin/classes`: nhãn "Chưa chuyển sang đo lượt · N người" và bộ lọc `?metering=legacy` (đích của dòng Việc cần làm, T18); trang lớp: dải thông báo có nút "Cấp lượt cho lớp cũ…", tự ẩn khi xem trước trả 0 người. 4) Sau khi cấp: làm mới bảng học viên của lớp và số đếm `classes_unmetered`. 5) Chỉ vai trò Quản trị thấy nút; khu giáo viên không có. 6) Test React: xem trước rỗng → "Lớp này đã đo lượt", không có nút cấp; ô số lượt trống hoặc 0 → nút xác nhận tắt; bấm xác nhận hai lần → một lời gọi; kết quả có người bị bỏ qua → liệt kê tên và lý do; step-up → mở dialog rồi gửi lại cùng `request_key`.
- Đầu ra: 1 PR.
- Nghiệm thu: staging (sau G04): lớp kiểm thử có 2 thành viên dùng mã cũ → danh sách lớp có nhãn "Chưa chuyển sang đo lượt · 2 người", Việc cần làm có 1 ở dòng "Lớp chưa chuyển sang đo lượt"; mở hộp → xem trước đúng 2 người → nhập 10 → xác nhận → kết quả "Đã cấp cho 2 người"; sổ lượt của mỗi người có dòng cộng 10; nhãn và dòng ở Việc cần làm biến mất; mở lại hộp → "Lớp này đã đo lượt"; Nhật ký lớp có một dòng; tài khoản giáo viên không thấy nút và gọi thẳng API nhận 403.
- Không làm: không viết API hay logic cấp lượt (G04); không tự quyết ai đủ điều kiện ở trình duyệt; không chuyển nhiều lớp một lần (mỗi lần một lớp, để người làm đọc được danh sách); không tự chạy khi lớp được tạo; không thu hồi lượt đã cấp ở hộp này (dùng "Điều chỉnh lượt").
- Vướng mắc → cách gỡ: G04 chưa merge API `convert-class` → dừng, làm nhiệm vụ khác; nhãn ở danh sách lớp và dòng Việc cần làm hiện "chưa có". Response của G04 khác tên trường với bảng "API G04 mà G09 gọi" (5.4) → theo GOI-04, sửa bảng 5.4 trong PR. `legacy_class_initial_credits` chưa đặt → ô để trống, không tự chọn số (Q32). Lớp có thành viên chưa có tài khoản → G04 trả trong danh sách bỏ qua; hộp ghi "chưa có tài khoản — cấp sau khi bạn ấy kích hoạt".
- Ước lượng: 2 phiên · 3.

### Bảng nhiệm vụ và ước lượng

| Mã | Tên | Trạng thái so với bản 16/11 | PR | Phiên | Độ khó |
|---|---|---|---|---|---|
| T01 | Spec ADMINIA-0074 | sửa | 1 | 1 | 2 |
| T02 | "Duyệt bài thi" hết lỗi thiếu tham số | giữ | 1 | 1 | 2 |
| T03 | API danh bạ + khối tóm tắt | sửa | 1 | 2 | 3 |
| T04 | API các thẻ hồ sơ | sửa | 1 | 3 | 4 |
| T05 | API tìm nhanh | sửa | 1 | 1 | 3 |
| T06 | API Việc cần làm | sửa | 1 | 2 | 3 |
| T07 | Nhóm sự cố (mig 451) | sửa | 1 | 2 | 3 |
| T08 | Khung + sổ đăng ký | sửa | 1 | 3 | 4 |
| T09 | Link vai trò | giữ | 1 | 1 | 2 |
| T10 | Danh bạ | sửa | 1 | 2 | 3 |
| T11a | Hồ sơ 5 thẻ | sửa | 1 | 3 | 3 |
| T11b | Vùng nguy hiểm | sửa | 1 | 2 | 4 |
| T12 | Mã kích hoạt (sổ tra cứu) | sửa | 1 | 1 | 2 |
| T13 | Khoá học + đơn đăng ký | sửa | 1 | 3 | 4 |
| T14 | Quyền luyện lại, thu hồi | sửa | 1 | 2 | 4 |
| T15 | Sổ lượt AI | sửa | 1 | 1 | 3 |
| T16 | Hộp thư sự cố | sửa | 1 | 2 | 3 |
| T17 | Chấm Writing | sửa | 1 | 3 | 4 |
| T18 | Việc cần làm, AI và mô hình, QA | sửa | 1 | 2 | 3 |
| T19 | Tìm nhanh | giữ | 1 | 1 | 3 |
| T20 | Khu giáo viên 5 mục | sửa | 1 | 3 | 3 |
| T21 | Ba spec bổ sung | mới | 3 | 3 | 2 |
| T22 | Mig 440 + API cài đặt/ngưỡng | mới | 1 | 1 | 3 |
| T23 | Trang Cài đặt | mới | 1 | 2 | 3 |
| T24 | Mig 441 + phạm vi giáo viên | mới | 1 | 2 | 4 |
| T25 | Nhóm đã lưu (mig 443) | mới | 1 | 1 | 2 |
| T26 | Thành phần giao bài dùng chung | mới | 1 | 2 | 3 |
| T27 | API Kết quả bài giao (mig 444) | mới | 1 | 3 | 4 |
| T28 | Trang Kết quả bài giao | mới | 1 | 3 | 3 |
| T29 | Trang Lớp | mới | 1 | 3 | 3 |
| T30 | Bảng công bố điểm | mới | 1 | 2 | 3 |
| T31 | Kỳ thi backend 1 (mig 445, 446) | mới | 2 | 3 | 5 |
| T32 | Danh sách + Tổ chức kỳ thi | mới | 1 | 3 | 3 |
| T33 | Kỳ thi backend 2 (mig 447, 448) | mới | 1 | 3 | 4 |
| T34 | Trang một kỳ thi 7 thẻ | mới | 2 | 4 | 4 |
| T35 | Ghi chú chăm sóc (mig 442) | mới | 1 | 2 | 3 |
| T36 | Lô nhập + Câu cần kiểm (mig 449, 450) | mới | 1 | 3 | 3 |
| T37 | Ba trang Nội dung | mới | 2 | 4 | 3 |
| T38 | Chấm Speaking thi thử | mới | 1 | 2 | 3 |
| T39 | Yêu cầu chấm lại | mới | 1 | 2 | 3 |
| T40 | Giáo viên + Gửi thông báo | mới | 1 | 2 | 3 |
| T41 | Báo cáo | mới | 1 | 2 | 3 |
| T42 | Áp staging, nghiệm thu | mới | 0 | 2 | 3 |
| T43 | Cấp lượt cho lớp cũ (18/11 chiều, cần G04) | mới | 1 | 2 | 3 |
| **Tổng** | | | **48** | **97** | |

Nhiệm vụ **ĐÃ BỎ** (không có mã riêng, là phần việc trong nhiệm vụ cũ):
- Trong T17 cũ: "đổi nhãn trang Giáo viên duyệt (`/admin/writing/instructor-queue`) và giữ làm mục sidebar" — ĐÃ BỎ: mục "Giáo viên duyệt" gộp vào Writing (AD-02).
- Trong T08 cũ: mục sidebar "Chấm bài › Thi thử" — ĐÃ BỎ: trùng "Thi thử › Kỳ thi" (AD-22).
- Trong T15 cũ: "số dư theo kỹ năng", modal chọn kỹ năng — ĐÃ BỎ: một kho chung (phân xử 11).
- Trong T12 cũ: dời nguyên biểu mẫu tạo mã sang trang Mã kích hoạt — ĐÃ BỎ: tạo mã ở trang Lớp.
- Trong T16 cũ: nút "Tạo lỗi test" ở Hộp thư sự cố — ĐÃ BỎ: dời sang Công cụ QA.
- Trong T11a cũ: tab "Chi phí AI", "Điểm và tiến độ" riêng — ĐÃ BỎ: gộp vào thẻ Khoá và quyền / Tổng quan theo tờ mới.

Giả định: G03, G04, G10, GOI-11 phần A và E xong phần liên quan khi tới nhiệm vụ cần chúng; mỗi PR qua review ≤ 2 vòng; không tính thời gian chờ duyệt. Tăng so với bản 16/11 (21 PR / 34 phiên) vì thêm 23 nhiệm vụ (T21–T43) và 12 migration. Bản 18/11 chiều: 43 mã nhiệm vụ, 44 dòng bảng (T11 tách a/b), không nhiệm vụ nào bị bỏ; T24, T31–T34 đổi nội dung theo điểm 23 nhưng giữ ước lượng (T24 bớt nhánh "bảng nhiều giáo viên", T31 thêm hàm `self_paced_timeline`).

Nhiệm vụ **ĐÃ BỎ ở bản 18/11 chiều** (phần việc trong nhiệm vụ, không có mã riêng):
- Trong T24: phương án "bảng `cohort_instructors` nhiều giáo viên một lớp" — ĐÃ BỎ: mỗi lớp một giáo viên (điểm 23).
- Trong T15, T13, T11a: hiển thị "chuyển 50% lượt" — ĐÃ BỎ: chuyển toàn bộ, có hạn riêng (điểm 23).
- Trong T31–T34: kỳ tự làm "mỗi phần tự bấm bắt đầu, nghỉ giữa các phần" — ĐÃ BỎ: các phần chạy liền (điểm 23).
