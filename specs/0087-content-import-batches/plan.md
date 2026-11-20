# Implementation plan

## Architecture impact

Phần của GOI-09; khung, sidebar và quyền giáo viên theo ADMINIA-0074. Ràng buộc chung của gói (mục 8) áp nguyên.

Ràng buộc riêng của gói (mục 8):

- **Tờ thiết kế là chuẩn** cho mọi màn của gói; mọi màn nay đã có tờ, trừ hộp "Cấp lượt cho lớp cũ" (T43) và các chỗ điểm 23 đổi mà tờ chưa vẽ lại (bốn trạng thái theo dõi kỳ tự làm; dòng lượt chuyển và hạn) — các chỗ này dựng từ thành phần có sẵn theo FR, ghi trong PR "chưa có tờ". Tờ nào còn chữ "chuyển 50%", "nghỉ giữa các phần", "nhiều giáo viên" thì FR của file này thắng. Khung, sidebar, khung giáo viên, bảng ngưỡng, thành phần giao bài, khối tóm tắt học viên, dữ liệu mẫu: theo `thiet-ke/CHUAN-ADMIN.md`; phần "Sửa đổi 17/11 chiều" thắng phần trên của chính file đó và thắng tờ nào còn sót chữ cũ. Bảng tờ → nhiệm vụ:

| Tờ | Nhiệm vụ |
|---|---|
| ThanhPhanKhungTrang2 (mục 7, 8, 10), CheDoToiCongKhaiAdmin | T08, T19, T20 |
| ThanhPhanDuLieu (bảng, modal, ngăn kéo, "Giao bài theo buổi", khối tóm tắt học viên) | T10, T26, T03 |
| AdminViecCanLam | T06, T18 |
| AdminDanhBa | T03, T10 |
| HoSoHocVien | T04, T11, T35 |
| AdminLop | T29, T14, T43 (hộp "Cấp lượt cho lớp cũ" chưa có tờ thiết kế riêng: dựng từ hộp xác nhận của "Cấp thêm lượt") |
| AdminKhaoSat, HocVienNoiGi | GOI-13 phần A dựng (Q34 đã đóng) (sửa 18/11 theo GOI-13); G09 chỉ có mục sidebar "Chưa mở" tới khi trang lên |
| Admin1024 | T17, T18, T29 (bản 1024px của ba trang) |
| AdminKetQuaBaiGiao | T27, T28 |
| KiemTraKhoaGiaoVien | T30 |
| AdminKhoaHoc, AdminDonDangKy | T13 |
| AdminLuotVaMa | T12, T15 |
| AdminChamWriting · AdminChamLai · AdminChamSpeakingThiThu | T17 · T39 · T38 |
| AdminKyThi · AdminKyThiChiTiet | T31, T32 · T33, T34 |
| AdminNoiDung, AdminNoiDungVietNoi, AdminNoiDungTuVungNguPhap | T36, T37 |
| AdminThuVienCongKhai | G06 (G09 chỉ có mục sidebar) |
| AdminBaoCao | T41 |
| AdminSuCo | T07, T16 |
| AdminHeThong | T18 (AI và mô hình, Công cụ QA); Bảo mật giữ `/admin/mfa` |
| AdminCaiDat | T22, T23 (thẻ Chấm thử: GOI-11 T16) |
| AdminGiaoVienThongBao | T40 (Gửi thông báo: GOI-11 T13) |
| GiaoVien | T20 |

- Quy tắc trong "Ghi chú cho lập trình" của các tờ Đợt 5 là **đề xuất của người thiết kế** trừ khi `00-QUY-UOC-CHUNG.md` mục 2 đã chốt. Chỗ đề xuất chưa chốt nằm ở mục 10 kèm mặc định tạm; người thực thi dùng mặc định tạm và làm thành cấu hình, không tự đổi.
- Bản 1024px: chỉ ba trang có tờ riêng (`Admin1024.dc.html`: Việc cần làm → T18, Chấm Writing → T17, Lớp → T29). Công cụ nội bộ của admin (Công cụ QA, các trang `context` cũ) dùng khuôn bảng có sẵn của G03, không có tờ riêng và không chờ tờ.
- Nhãn `[NGAY]`/`[THÊM]`, tên cột, tên API, mã kỳ thi dạng máy, mã ngộ nhận, UUID, slug, đường dẫn file, tên model **không** hiện trên giao diện.
- Câu chữ: "giáo viên" (không "giảng viên", "thầy"); "Đơn đăng ký", "Học phí"; ngày dd/mm/yyyy, giờ 24 giờ, múi giờ Việt Nam; USD 2 chữ số thập phân; không band khi thiếu dữ liệu; không "0/0"; ô không có việc ghi "Không có"/"chưa có".
- Sáng/tối: mọi màn mới chỉ dùng token `--av2-*` (GOI-03 mục 5.9), không màu hex trong component; kiểm cả hai chế độ ở 1280px.
- Quyền: mọi kiểm ở máy chủ; giáo viên qua `staff_scope` (mỗi lớp một giáo viên; không nơi nào khác tự so `cohorts.instructor_id`); không gọi Supabase trực tiếp cho dữ liệu admin.
- Lượt chấm: G09 không tính số lượt chuyển, hạn của phần lượt chuyển, hay ai đủ điều kiện nhận lượt; mọi số lấy từ G04. Giao diện không ghi cứng "50%", "100%", "60 ngày", "45 ngày" — đọc từ cấu hình hoặc response.
- Kỳ tự làm: không màn admin nào có điều khiển hay nhãn cho "nghỉ giữa các phần", "làm tiếp sau", "mở lại phần". Admin và giáo viên không bị giới hạn một phiên; admin vẫn AAL2.
- Trả kết quả thi thử: không nút nào ngoài thẻ "Trả kết quả" của trang kỳ thi gọi API trả.
- Ngưỡng: không hằng số ngưỡng trong mã giao diện hay backend ngoài `services/ops_thresholds.py` (giá trị mặc định) và migration 440.
- Trang nhập thủ công: chỉ ẩn khỏi sidebar và thêm dải cảnh báo; không xoá route, không chặn API (đường lui).
- Mọi chuyển hướng admin trong gói là 307. Không đổi URL công khai. Không đổi cascade CSS trong `components/authed-shell.tsx`.
- Không đụng script và dữ liệu của dây chuyền Hermes ngoài việc gọi helper ghi lô (T36); nếu một script thuộc Hermes, bỏ qua và ghi trong PR.

## Data and contracts

### Migration (gói 5.3, chỉ các số của spec này)

| Số | File | Nội dung | Nhiệm vụ |
|---|---|---|---|
| 449 | `449_content_import_batches.sql` | `content_import_batches(id, code text UNIQUE, script text, skill text, environment text, mode text CHECK IN ('dry_run','import'), actor text, started_at, finished_at, created_count int, updated_count int, error_count int, status text, error_report_path text NULL)`; `content_import_batch_items(batch_id, item_kind text, item_id text, action text CHECK IN ('created','updated','error'), PRIMARY KEY (batch_id, item_kind, item_id))`. Dùng bảng nối thay vì thêm `batch_id` vào từng bảng nội dung. | T36 |
| 450 | `450_content_review_items.sql` | `content_review_items(id, item_kind text, item_id text, question_ref text, status text CHECK IN ('open','checked','fixed'), checked_by, checked_at, fixed_version text NULL, note text NULL, UNIQUE (item_kind, item_id, question_ref))`. Lý do (báo lỗi N người, tỉ lệ sai) tính lúc đọc. | T36 |

### API (gói 5.4, các khối của spec này)

Khối này của gói gộp cả Nội dung và Sự cố: chỉ các dòng `/admin/content/*` thuộc spec này; các dòng `/admin/incidents/*` và đoạn `fingerprint` thuộc ADMINIA-0074 (G09-T07, T16), chép lại để giữ nguyên văn.

**Nội dung, sự cố** (`routers/admin_content_batches.py`; sửa `routers/error_logs.py`; `routers/admin_incidents.py`)

| Method · path | Response (rút gọn) |
|---|---|
| `GET /admin/content/batches?skill=&cursor=` | `{ items: [{ id, code, script_label, environment, mode, actor, started_at, created_count, updated_count, error_count, status, pending_review: int, has_error_report: bool }] }` |
| `GET /admin/content/batches/{id}/items` | `{ items: [{ item_kind, item_id, title, action, open_href }] }` |
| `GET /admin/content/batches/{id}/error-report` | file `.csv` |
| `GET /admin/content/review?skill=&status=open` | `{ items: [{ id?, item_kind, item_id, question_ref, question_text, item_title, reasons: [{code: 'reported'\|'high_error'\|'common_wrong', text}], attempts: int\|null, status }] }` — nguồn: `user_feedback` (Reading/Listening), `quiz_item_error_rates` (quiz Từ vựng/Ngữ pháp) |
| `POST /admin/content/review/mark` | `{ item_kind, item_id, question_ref, status: 'checked'\|'fixed', fixed_version?, note? }` |
| `GET /admin/incidents/groups?source=&status=open&page=` | `{ items: [{ source, fingerprint, title, level?, count, learners: int, first_at, last_at, status, claimed_by_name?, overdue: bool }], total, counts: {errors, grading, feedback}, review_items_open: int }` (25 nhóm/trang) |
| `GET /admin/incidents/groups/{source}/{fingerprint}` | chi tiết: mô tả bằng lời, ảnh hưởng, học viên (link hồ sơ), `technical` (gập sẵn), `notes[]` |
| `POST /admin/incidents/groups/bulk` | `{ groups: [{source, fingerprint, expected_count}], action: 'resolve'\|'claim'\|'ignore'\|'reopen', note? }` → `{ changed: int, conflicts: [...] }`; 409 từng nhóm khi `expected_count` lệch |

`fingerprint` = sha1 của `source|level|path đã thay uuid/số bằng :id|message đã thay uuid/số/chuỗi trong nháy bằng ?`, tính ở Python (`services/error_log_grouping.py`); quét 5.000 dòng mới nhất, vượt thì `truncated: true`. Trạng thái nhóm lưu ở `incident_groups`; nhóm chưa có dòng = `new`; khi có dòng lỗi mới sau `resolved_at` thì đọc ra là `new` (tự mở lại) và giữ ghi chú.

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`. Mọi giao diện mới sau cờ `ADMIN_FRAME_V2` (tắt ở production); migration staging trước dưới khoá advisory.

## Verification strategy

Lệnh bắt buộc mỗi PR theo tầng và cách báo cáo ở gói mục 9:

Môi trường: preview Vercel của nhánh + backend staging. Tài khoản: QA admin có TOTP; hai tài khoản giáo viên kiểm thử (A dạy lớp kiểm thử 1, B dạy lớp kiểm thử 2); ba học viên kiểm thử `@staging-e2e.averlearning.com` (một có tài khoản + hồ sơ ở lớp 1, một chỉ có hồ sơ, một ở lớp 2). Dữ liệu: một bài giao Course 1 chấm máy có bài nộp, một đề giữa kỳ chế độ "giáo viên công bố", một kỳ thi kiểm thử live và một kỳ tự làm hai phần, một đơn kiểm thử và một đơn đăng ký lại (sau G04), một lớp kiểm thử có thành viên dùng mã cũ không kèm lượt. Không dùng production cho bất kỳ bước nào; không chép dữ liệu học viên thật.
Lệnh bắt buộc mỗi PR (theo tầng): `cd backend && python -m pytest tests/ -q`; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`; `npm --prefix frontend run test:react`; `cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build`; `node frontend/tooling/route-ownership-check.mjs`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Gói chỉ được báo "xong" khi 23 kịch bản có bằng chứng trên staging (đã merge vào `staging`), không phải chỉ trên preview nhánh. Kịch bản phụ thuộc gói khác chưa xong ghi "chưa chạy được" kèm tên gói, không tính là đạt. Lên production và bật `ADMIN_FRAME_V2` ở production là bước riêng, chờ anh Andy.
