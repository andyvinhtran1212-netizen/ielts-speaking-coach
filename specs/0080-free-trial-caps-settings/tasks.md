# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk`, `Spec: TRIALCAP-0080`, sau khi spec `approved`.
G11-T02 là chính PR spec này. Số task = số nhiệm vụ trong gói.

- [ ] T14 (G11-T14) Migration 471 và sửa hàm giữ chỗ chấm thử. `depends: spec approved; xem bảng gói mục 6`
- [ ] T14a (G11-T14a) (mới 18/11 tối) Thực thi spec FREETRIAL-0047 (high-risk). `depends: spec approved; xem bảng gói mục 6`
- [ ] T15 (G11-T15) Trạng thái, cấu hình công khai và chặn khi nộp. `depends: spec approved; xem bảng gói mục 6`
- [ ] T16 (G11-T16) `/admin/settings` thẻ Chấm thử. `depends: spec approved; xem bảng gói mục 6`
- [ ] T17 (G11-T17) Sáu trạng thái trong các màn chấm thử (thu hẹp). `depends: spec approved; xem bảng gói mục 6`

Bảng phụ thuộc của cả gói và chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T14 | Migration 471 + sửa hàm giữ chỗ (trần theo task, IP, ngân sách ngày) | B | T02, 0047 migration 371, G09-T22 (migration 440: `admin_settings_log`) | 2 | 5 |
| G11-T14a | (mới 18/11 tối) Thực thi FREETRIAL-0047 (migration 371, `/api/trial/*`, màn `/trial/writing`, `/trial/speaking`); việc đầu: kiểm nhánh/PR đã có | B | T02 duyệt | 4 | 5 |
| G11-T15 | Trạng thái, điều kiện được chấm thử, cấu hình công khai, chặn khi nộp | B | T14, route `/api/trial/*` của 0047, G04-T03 (`has_ever_had_online_course`) | 1 | 4 |
| G11-T16 | `/admin/settings` thẻ Chấm thử | B | T15, G09-T08 | 1 | 3 |
| G11-T17 | Sáu trạng thái trong các màn chấm thử (thu hẹp: lối vào trang chủ/menu thuộc G05-T21) | B | T15, UI 0047 | 1 | 3 |

### G11-T14 — Migration 471 và sửa hàm giữ chỗ chấm thử
- Mục đích: 5.2.1.
- Đầu vào: `specs/0047-…/plan.md` 110–135, 319–345; migration 371 (nếu đã có); spec 0080 đã duyệt; mẫu test đua đồng thời của G04 (`tests/test_migration_382_*`, nếu đã có) hoặc `tests/test_migration_334_*`.
- Việc làm:
  1. Xác định đường (a)/(b) (T02 bước 1).
  2. (a): sửa `backend/migrations/371_*.sql` trong PR của 0047 hoặc phối hợp phiên làm 0047 — gói này chỉ viết 471 gồm hai bảng cấu hình, cột thêm của `trial_usage`, index, seed, `fn_trial_caps_update` (ghi nhật ký vào `admin_settings_log` của migration 440, G09-T22). (b): 471 gồm thêm `CREATE OR REPLACE FUNCTION public.fn_trial_reserve` chép nguyên thân 371, chỉ thay phần kiểm lượt.
  3. Rollback giữ bảng; khôi phục thân hàm 371 (đường b).
  4. Test PG17 ở 5.2.1.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test PG17 pass, gồm ca 20 lời gọi song song cho đúng số giữ chỗ mà ngân sách ngày còn đủ, và ca khoá IP: hai kết nối, hai tài khoản cùng `ip_hash` với `vn_day` khác nhau, hạn mức IP chỉ còn 1 lượt → đúng một giữ chỗ thành công (khoá `aver.trial.ip:` không gắn ngày, thứ tự site → ip → user); bất biến client pass.
- Không làm: không đổi bước chống lạm dụng, trần USD, `request_key` của 0047.
- Vướng mắc → cách gỡ: hai khoá tư vấn trong một giao dịch gây chờ dài khi đông → đo bằng test 200 lời gọi; quá 2 s ở p95 trên PG cục bộ thì báo, không tự đổi thiết kế; `vn_day` tính sai múi giờ → dùng đúng biểu thức của 371 (`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`), test ca 23:59 và 00:01.
- Ước lượng: 2 phiên · 5.

### G11-T14a — (mới 18/11 tối) Thực thi spec FREETRIAL-0047 (high-risk)
- Mục đích: chấm thử miễn phí (00 mục 2 điểm 11) chạy được: 0047 đã duyệt nhưng chưa có mã và trước đây không gói nào nhận viết mã (rà soát độ phủ 18/11, P-01).
- Đầu vào: `specs/0047-*/` (`spec.md`, `plan.md`, `tasks.md`; `CHƯA KIỂM` tên thư mục: `ls specs | grep 0047`); spec TRIALCAP-0080 đã duyệt (T02); 5.2 của gói này; tờ `ChamThuMienPhi`.
- Việc làm:
  1. **Việc đầu tiên:** kiểm trong repo đã có nhánh hoặc PR nào thực thi 0047 chưa (`git fetch && git branch -r | grep -i trial`, `gh pr list --state all --search "0047"`, `ls backend/migrations | grep '^371'`). Có phiên khác đang làm → dừng, báo anh Andy, không làm song song (câu chờ anh ở `04`).
  2. Không có: làm theo `tasks.md` của 0047 — migration 371, route `/api/trial/*`, màn `/trial/writing`, `/trial/speaking`; 371 chưa viết thì gộp thay đổi của 471 vào 371 theo 5.2.1 (a), và T14 chỉ còn phần chưa gộp.
- Đầu ra: 2 PR (backend + migration · màn `/trial/*`).
- Nghiệm thu: test của `tasks.md` 0047 và các ca trần ở 5.2 pass; không gọi AI trả phí trong test (grader giả); trên staging một tài khoản thử chưa từng có khoá online chấm thử được một bài Writing Task 2, lần thứ hai trong ngày bị chặn đúng câu.
- Không làm: không bật `free_trial_enabled` trên production; không gộp chấm thử vào sổ lượt (GOI-04 5.8).
- Vướng mắc → cách gỡ: `tasks.md` của 0047 khác 5.2 của gói (sau TRIALCAP-0080) → 0080 thắng phần trần; phần còn lại theo 0047, ghi chỗ khác trong PR.
- Ước lượng: 4 phiên · độ khó 5.

### G11-T15 — Trạng thái, cấu hình công khai và chặn khi nộp
- Mục đích: 5.2.2, 5.2.3 (ba route học viên và công khai).
- Đầu vào: router `/api/trial/*` của 0047 (CHƯA KIỂM tên file khi 0047 merge: `grep -rln "/api/trial" backend/routers`); `services/runtime_flags.py`.
- Việc làm: `backend/services/trial_caps.py` (`trial_state`, `trial_eligible` — provider `google` hoặc `email`, loại người từng có khoá online bằng `entitlements.has_ever_had_online_course` của G04, FR-030, 031); route Speaking chấm thử chỉ nhận Part 2; `GET /api/trial/public-config` (miễn cổng kích hoạt); mở rộng `status`; ánh xạ lý do RPC → 409 `trial_quota`/503; test: thứ tự ưu tiên (bảng chân trị 5 trạng thái × chồng nhau), cờ tắt → `paused`, đọc bảng lỗi → 503 và không gọi provider giả, đường chấm học viên có khoá không đọc `free_trial_caps` (đếm truy vấn như 0047 FR-002).
- Đầu ra: 1 PR.
- Nghiệm thu: `cd backend && python -m pytest tests/test_trial_caps.py tests/test_activation_gate_inventory.py -q` pass; bộ đầy đủ pass.
- Không làm: không đổi FR-001 của 0047 ngoài hai điểm ở FR-030, 031 (đã ghi trong amendment TRIALCAP-0080); không ghi, không đọc `credit_ledger`.
- Vướng mắc → cách gỡ: cache public-config làm admin đổi trần mà trang công khai trễ → chấp nhận ≤ 30 s, ghi trong spec; route 0047 chưa có → PR chờ, làm `trial_caps.py` + test trước; G04-T03 chưa merge → dùng `users.first_activated_at IS NULL` của 0047, đổi sang hàm G04 trong PR nhỏ sau (test có ca "từng có khoá online đã hết hạn → 403").
- Ước lượng: 1 phiên · 4.

### G11-T16 — `/admin/settings` thẻ Chấm thử
- Mục đích: 5.2.3 (route admin), 5.2.4 (trang).
- Đầu vào: tờ `AdminCaiDat` mục 5, 8, 9; khung admin G09 (`ADMIN_FRAME_V2`, sổ điều hướng `frontend/lib/admin-nav-registry.mjs` của G09); `backend/routers/admin_flags.py`.
- Việc làm: route `GET/PUT /admin/settings/trial`, `POST /admin/settings/trial/pause`; trang `frontend/app/(authed-admin-settings)/admin/settings/page.tsx` với thẻ `?tab=`; thêm "Cài đặt" vào nhóm Hệ thống trong sổ điều hướng G09; hộp xác nhận liệt kê cũ → mới; nhật ký.
- Đầu ra: 1 PR.
- Nghiệm thu: test backend: ràng buộc FR-020 trả 422 tiếng Việt; lưu ghi một dòng log; người không phải admin → 403; test React: nhập `per_user_daily > per_user_total` → lỗi dưới ô, nút Lưu không gửi; bước bấm trên staging: đổi trần ngày của Writing Task 2 → lần nộp kế tiếp của tài khoản thử theo trần mới.
- Không làm: không dựng nội dung sáu thẻ khác (G09-T23); không tạo router `/admin/settings` thứ hai nếu G09-T22 đã có — thêm route `trial` vào router đó.
- Vướng mắc → cách gỡ: G09 chưa có khung mới → đặt trang trong khung admin cũ hiện có và ghi rõ, không dựng khung riêng; `test_staff_guard_inventory.py` đỏ → guard là lệnh await đầu.
- Ước lượng: 1 phiên · 3.

### G11-T17 — Sáu trạng thái trong các màn chấm thử (thu hẹp)
- Mục đích: tờ ChamThuMienPhi màn 2, 7 theo dữ liệu thật. **Lối vào ở trang chủ (màn 1) và mục "Chấm thử" trong menu công khai thuộc G05-T21** (GOI-05 FR-05-021); nhiệm vụ này không sửa trang chủ, `PublicTopNav` hay trang Thư viện.
- Đầu vào: tờ `ChamThuMienPhi`; trang chấm thử của 0047 (CHƯA KIỂM route khi 0047 merge: `ls frontend/app | grep -i trial`); `public-config`, `status`.
- Việc làm: trong các màn `/trial/*`: màn 7 hiện đúng một trong sáu trạng thái theo `status.state` (thêm `ip_total_exhausted` với lý do và lối liên hệ/xác minh); bộ đếm ở thanh trên theo ba hạng mục (Task 1, Task 2, Part 2); "Đây là lượt miễn phí cuối hôm nay" khi còn 1; chọn Speaking chỉ có Part 2.
- Đầu ra: 1 PR.
- Nghiệm thu: test React sáu trạng thái + thứ tự ưu tiên; không hiện số tiền, không đếm ngược, không hộp bật lên.
- Không làm: không đổi màn viết, ghi âm, kết quả của 0047; không dựng lối vào ở trang công khai (G05-T21).
- Vướng mắc → cách gỡ: câu chữ tờ ghi XXX → lấy số từ API, không ghi cứng; cách xác minh cho người bị chặn vì dùng chung IP chưa chốt (mục 10 câu 26) → màn chỉ nêu lý do và kênh liên hệ lấy từ `site-info` của G05-T23.
- Ước lượng: 1 phiên · 3.
