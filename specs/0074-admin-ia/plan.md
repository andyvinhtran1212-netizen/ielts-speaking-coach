# Implementation plan

## Architecture impact

Backend: router admin mới và sửa (5.4), `services/staff_scope.py`, migration 440–442 và 451. Frontend: khung admin mới trên `StaffShell` của G03, sổ đăng ký điều hướng (5.2), component ở `frontend/components/admin/` (5.7). Bảng ánh xạ đủ 75 trang admin ở 5.1. Thứ tự và lý do phụ thuộc ở mục 6.0 (`tasks.md`).

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

### 5.1 Bảng ánh xạ đủ 75 trang admin

Loại: **nav** = mục sidebar · **tab** = thành thẻ của một trang khác (URL cũ 307 tới trang đó kèm tham số) · **context** = trang bản ghi/công cụ mở từ trang khác, giữ URL, không có mục sidebar · **hidden** = trang nhập thủ công bị ẩn khỏi sidebar, route vẫn sống, có dải cảnh báo (FR-013) · **bỏ** = xoá trang, 307. "Gộp" = nội dung dời vào trang đích trong gói này.

| # | Route hiện có | Nhóm mới › mục | Loại | Ghi chú (nhiệm vụ) |
|---|---|---|---|---|
| 1 | `/admin` | Tổng quan › Việc cần làm | nav | Bỏ `AdminAiPanel` (T18). |
| 2 | `/admin/dashboard/reading-attempts` | Báo cáo › Hoạt động học viên | context | Link "Xem chi tiết" từ thẻ Hoạt động (T41). |
| 3 | `/admin/users` | Học viên và quyền truy cập › Học viên | bỏ → `/admin/learners` | Đổi vai trò dời vào hồ sơ (T10). |
| 4 | `/admin/students` | › Học viên | bỏ → `/admin/learners` | Import CSV, Thêm học viên dời sang danh bạ (T10). |
| 5 | `/admin/classes` | › Lớp | nav | |
| 6 | `/admin/classes/[cohortId]` | › Lớp | context | Thẻ trên URL (T29). Kết quả bài giao là route con mới. |
| 7 | `/admin/classes/[cohortId]/exercise-book` | › Lớp | context | Tính năng đang tắt trên staging; không đổi. |
| 8 | `/admin/classes/[cohortId]/exercise-book/grants` | › Lớp | context | Như trên. |
| 9 | `/admin/instructors` | › Giáo viên | nav | Lưới thẻ → bảng; hồ sơ là route con mới (T40). |
| 10 | `/admin/usage` | Báo cáo › Chi phí AI | context | Link từ thẻ Chi phí AI; mỗi người link tới hồ sơ. |
| 11 | `/admin/writing/cohorts` | › Lớp | bỏ → `/admin/classes` | Gộp: tiến độ Writing xem ở trang lớp. Có `cohort_id` thì 307 tới `/admin/classes/{id}?tab=bai-nop`. |
| 12 | `/admin/grammar-lessons` | › Lớp | context | Mở từ bài nộp của lớp. |
| 13 | `/admin/grammar-diagnostic` | › Lớp | context | Như trên. |
| 14 | `/admin/writing/queue` | Chấm bài › Writing | nav | Một hàng chờ "Bài chờ duyệt" (T17). |
| 15 | `/admin/writing/grade` | Chấm bài › Writing | context | Màn chấm. |
| 16 | `/admin/writing/status` | Chấm bài › Writing | bỏ → `grade?…&panel=status` | FR-061. |
| 17 | `/admin/writing/instructor-queue` | Chấm bài › Writing | bỏ → `/admin/writing/queue` | **Gộp**: không còn mục "Giáo viên duyệt" (T17). |
| 18 | `/admin/writing/regrade-requests` | Chấm bài › Yêu cầu chấm lại | nav | T39. |
| 19 | `/admin/writing/new` | Chấm bài › Writing (nút "Gửi bài chấm thay học viên") | context | **Giữ** (OCR). Không còn mục sidebar. |
| 20 | `/admin/speaking/sessions` | Báo cáo › Hoạt động học viên | context | Phiên Speaking luyện tập; **không** còn là mục Chấm bài › Speaking. Mục đó trỏ route mới `/admin/speaking/grading` (T38). |
| 21 | `/admin/mock-reviews` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests/{id}?tab=cham` | Thiếu `mock_exam_id` → `/admin/mock-tests` (T02 làm tạm, T34 làm hẳn). |
| 22 | `/admin/mock-reviews/report` | Thi thử › Kỳ thi | context | Phiếu điểm một thí sinh; mở từ thẻ Chấm. |
| 23 | `/admin/speaking` | Nội dung › Speaking | nav | Hub → trang 4 thẻ (T37). |
| 24 | `/admin/speaking/topics` | Nội dung › Speaking | tab → `/admin/speaking?tab=items` | |
| 25 | `/admin/writing` | Nội dung › Writing | nav | Hub → trang 4 thẻ. |
| 26 | `/admin/writing/prompts` | Nội dung › Writing | tab → `/admin/writing?tab=items` | Giữ tạo/sửa lẻ. |
| 27 | `/admin/writing/tips` | Nội dung › Writing | tab → `/admin/writing?tab=items&type=tips` | Ẩn nút nhập nhiều mẹo từ file. |
| 28 | `/admin/writing/assignments` | › Lớp | bỏ → `/admin/classes` | **Sổ giao bài Writing bị bỏ** (FR-123). |
| 29 | `/admin/listening` | Nội dung › Listening | nav | Trang 4 thẻ. |
| 30 | `/admin/listening/tests` | Nội dung › Listening | tab → `/admin/listening?tab=items&type=tests` | |
| 31 | `/admin/listening/tests/[testId]` | › Listening | context | Ẩn điều khiển tải audio; giữ sửa ảnh lẻ. |
| 32 | `/admin/listening/content/[contentId]` | › Listening | context | |
| 33 | `/admin/listening/content/[contentId]/edit` | › Listening | context | |
| 34 | `/admin/listening/segments` | › Listening | context | Thiếu `content_id` → về `/admin/listening` (đã có). |
| 35 | `/admin/listening/gist` | › Listening | context | Như trên. |
| 36 | `/admin/listening/tf` | › Listening | context | Như trên. |
| 37 | `/admin/listening/mcq` | › Listening | context | Như trên. |
| 38 | `/admin/listening/import-drills` | — | **hidden** | Script: `import_skill_drills.py`, `import_listening_content_package.py`. |
| 39 | `/admin/listening/import-fulltest` | — | **hidden** | Script: `import_listening_lessons.py`, `import_listening_content_package.py`, `import_cambridge_canonical_qa.py`, `upload_listening_source_audio.py`. |
| 40 | `/admin/listening/audit` | Báo cáo › Chất lượng nội dung | context | Link từ thẻ Chất lượng. |
| 41 | `/admin/listening/audit-detail` | Báo cáo › Chất lượng nội dung | context | |
| 42 | `/admin/listening/attempts` | Báo cáo › Hoạt động học viên | context | |
| 43 | `/admin/listening/dictation` | Báo cáo › Hoạt động học viên | context | |
| 44 | `/admin/reading` | Nội dung › Reading | nav | Hub → trang 4 thẻ. |
| 45 | `/admin/reading/content` | Nội dung › Reading | tab → `/admin/reading?tab=items` | Ẩn nhập; giữ khoá/chia sẻ/đăng. |
| 46 | `/admin/reading/preview` | › Reading | context | Giữ sửa ảnh lẻ. |
| 47 | `/admin/vocab` | Nội dung › Từ vựng | nav | Hub → trang 4 thẻ. |
| 48 | `/admin/vocab/sets` | Nội dung › Từ vựng | tab → `/admin/vocab?tab=programs` | |
| 49 | `/admin/vocab/sets/[setId]` | › Từ vựng | context | |
| 50 | `/admin/vocab/topics` | Nội dung › Từ vựng | context | Mở từ thẻ Chương trình và bộ; `?skill_area=grammar` mở từ Ngữ pháp. |
| 51 | `/admin/vocab/content` | — | **hidden** (phần nhập) | Script: `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `migrate_vocab_to_cards.py`. Sửa lẻ mục từ dời vào `/admin/vocab?tab=items`. |
| 52 | `/admin/vocab/quiz` | — | **hidden** (phần nhập) | Script: `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py`. Danh sách bank và xem trước dời vào thẻ Chương trình và bộ. |
| 53 | `/admin/vocab/curated` | Nội dung › Từ vựng | tab → `/admin/vocab?tab=items&status=pending` | |
| 54 | `/admin/vocab/d1-curation` | Nội dung › Từ vựng | tab → như trên | |
| 55 | `/admin/vocab/exercises` | Nội dung › Từ vựng | tab → như trên | |
| 56 | `/admin/vocab/lemmas` | Nội dung › Từ vựng | context | Thành thao tác "sửa dạng từ" trong mục từ; URL giữ tới khi dời xong. |
| 57 | `/admin/vocab/stats` | Báo cáo › Hoạt động học viên | context | |
| 58 | `/admin/vocab/quiz-analytics` | Báo cáo › Hoạt động học viên | context | |
| 59 | `/admin/vocab/pilot-metrics` | Báo cáo › Hoạt động học viên | context | |
| 60 | `/admin/grammar` | Nội dung › Ngữ pháp | nav | Hub → trang 4 thẻ. |
| 61 | `/admin/grammar/articles` | Nội dung › Ngữ pháp | tab → `/admin/grammar?tab=items` | |
| 62 | `/admin/grammar/analytics` | Báo cáo › Hoạt động học viên | context | |
| 63 | `/admin/grammar/recommend-test` | Hệ thống › Công cụ QA | context | Link từ `/admin/qa-tools`. |
| 64 | `/admin/mock-tests` | Thi thử › Kỳ thi | nav | Trung tâm iframe → danh sách kỳ thi (T32). |
| 65 | `/admin/mock-exams` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests` | Hết nhúng `?embed=1`. |
| 66 | `/admin/mock-exams/corrections` | Hệ thống › Công cụ QA | context | |
| 67 | `/admin/mock-live` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests/{id}?tab=theo-doi` | Không có id → `/admin/mock-tests`. |
| 68 | `/admin/mock-pacing` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests/{id}?tab=phan-tich` | Cần ánh xạ `sitting` → kỳ thi; không ra thì về danh sách. |
| 69 | `/admin/error-logs` | Hệ thống › Hộp thư sự cố | tab → `/admin/incidents?source=errors` | |
| 70 | `/admin/system/alerts` | Hệ thống › Hộp thư sự cố | tab → `/admin/incidents?source=grading` | |
| 71 | `/admin/feedback` | Hệ thống › Hộp thư sự cố | tab → `/admin/incidents?source=feedback` | |
| 72 | `/admin/system` | — | bỏ → `/admin/incidents` | Hub 2 thẻ. |
| 73 | `/admin/system/ai-usage` | Báo cáo › Chi phí AI | context | Link từ thẻ Chi phí AI. |
| 74 | `/admin/foot-traffic` | Báo cáo › Lưu lượng | context | Link từ thẻ Lưu lượng. |
| 75 | `/admin/mfa` | Hệ thống › Bảo mật | nav | Giữ URL. |

Trang ẩn khỏi sidebar so với hiện tại: #38, #39, #51, #52 (nhập nội dung) và mục "Import" của exam module cũ (không có `page.tsx` Next; đã kiểm ở `c3bc71574`: `grep -rln "exams/import" frontend/js frontend/public/js frontend/app frontend/lib frontend/components` rỗng — không còn nơi nào ở frontend gọi API này, nên không có gì phải ẩn; API `POST /admin/exams/import` giữ nguyên). Trang gộp: #11, #17, #28, #65, #67, #68, #69–72 và sáu hub/nội dung (#23–27, #29–30, #44–45, #47–48, #53–55, #60–61).

**Route mới của gói** (đều trong `(authed-admin)` của G10): `/admin/learners`, `/admin/learners/[ref]`, `/admin/classes/[cohortId]/assignments/[assignmentId]` (Kết quả một bài giao), `/admin/classes/[cohortId]/assignments/[assignmentId]/release` (bảng công bố điểm), `/admin/activation-codes`, `/admin/courses`, `/admin/courses/[id]`, `/admin/enrollments`, `/admin/enrollments/[orderCode]`, `/admin/credits`, `/admin/speaking/grading`, `/admin/mock-tests/new`, `/admin/mock-tests/[examId]`, `/admin/mock-tests/[examId]/setup`, `/admin/reports`, `/admin/incidents`, `/admin/ai-models`, `/admin/qa-tools`, `/admin/notifications` (trang "Gửi thông báo"; nội dung do GOI-11 T13 dựng), `/admin/instructors/[id]`. Route do gói khác tạo nhưng có mục sidebar ở đây: `/admin/settings` (GOI-11 T16 tạo trang; T23 thêm thẻ), `/admin/library` (G06). `/admin/courses` phía frontend không đụng API backend `/admin/courses` (khác host); chạy `node frontend/tooling/route-ownership-check.mjs`. Thao tác "Cấp lượt cho lớp cũ" (T43) là một hộp trên trang Lớp, không có route riêng.

**Sidebar chuẩn** (nguyên văn `CHUAN-ADMIN.md` mục A kèm sửa đổi 18/11; người thực thi không thêm bớt):

| Nhóm | Mục → route |
|---|---|
| Tổng quan | Việc cần làm → `/admin` |
| Học viên và quyền truy cập | Học viên → `/admin/learners` · Lớp → `/admin/classes` · Giáo viên → `/admin/instructors` · Mã kích hoạt → `/admin/activation-codes` · Gửi thông báo → `/admin/notifications` · Khảo sát và nhận xét (số) → `/admin/surveys` (GOI-13 phần A dựng; trước khi trang có thì `available: false`) (sửa 18/11 theo GOI-13) |
| Khoá học và đăng ký | Khoá học → `/admin/courses` · Đơn đăng ký (số) → `/admin/enrollments` · Lượt AI → `/admin/credits` |
| Chấm bài | Writing (số) → `/admin/writing/queue` · Speaking (số) → `/admin/speaking/grading` · Yêu cầu chấm lại (số) → `/admin/writing/regrade-requests` |
| Nội dung | Listening → `/admin/listening` · Reading → `/admin/reading` · Writing → `/admin/writing` · Speaking → `/admin/speaking` · Từ vựng → `/admin/vocab` · Ngữ pháp → `/admin/grammar` · Thư viện công khai → `/admin/library` |
| Thi thử | Kỳ thi → `/admin/mock-tests` |
| Báo cáo | Hoạt động học viên → `/admin/reports?tab=hoat-dong` · Lưu lượng → `?tab=luu-luong` · Chi phí AI → `?tab=chi-phi-ai` · Chất lượng nội dung → `?tab=chat-luong` |
| Hệ thống | Hộp thư sự cố (số) → `/admin/incidents` · AI và mô hình → `/admin/ai-models` · Bảo mật → `/admin/mfa` · Công cụ QA → `/admin/qa-tools` · Cài đặt → `/admin/settings` |

Mục trỏ tới trang chưa có (`/admin/library` trước G06, `/admin/notifications` trước GOI-11 T13, `/admin/settings` trước GOI-11 T16): sổ đăng ký có trường `available: false` → mục hiện mờ, không bấm được, tooltip "Chưa mở"; không tạo trang giữ chỗ. Mục "Khảo sát và nhận xét" có `href: '/admin/surveys'` trong sổ đăng ký; `available: false` cho tới khi trang của GOI-13 phần A (G13-A09…) lên, rồi bật (G09 không tự dựng trang) (sửa 18/11 theo GOI-13).

Khung giáo viên (sidebar phẳng, `CHUAN-ADMIN.md` mục B): Việc của tôi → `/instructor?tab=today` · Lớp của tôi → `?tab=classes` · Học viên → `?tab=students` · Giao bài → `?tab=assign` · Chấm và duyệt bài (số) → `?tab=grading`.

### 5.2 Sổ đăng ký điều hướng

- File `frontend/lib/admin-nav-registry.mjs` (ES module thuần, không import React). Xuất `ADMIN_NAV_GROUPS` (8 nhóm: `id`, `label`, `items[]` với `id`, `label`, `href` (`null` khi `available` là `false` và trang chưa có route), `countKey?`, `available`), `ADMIN_ROUTES` (mỗi route của 5.1 và route mới: `pattern`, `kind`, `group`, `item`, `redirectTo?`), `adminNavMatch(pathname, search)` → `{ groupId, itemId }`, `INSTRUCTOR_NAV_ITEMS` (5 mục), `HIDDEN_IMPORT_ROUTES` (4 route `hidden`).
- `countKey` trỏ vào trường của `GET /admin/attention` (5.4): `enrollments_reported`, `writing_review`, `speaking_mock_pending`, `regrade_new`, `incident_groups_open`.
- Test hành vi `frontend/tests/admin-nav-registry.test.mjs`: (1) mọi `page.tsx` dưới `app/**/admin/**` có pattern trong `ADMIN_ROUTES`; (2) mọi `href` khác `null` của sidebar khớp một route `nav`; (3) `adminNavMatch` đúng cho 12 đường dẫn mẫu; (4) đúng 8 nhóm và đúng danh sách mục theo bảng "Sidebar chuẩn"; (5) không mục nào có nhãn chứa "Import", "Nhập", "Tải lên", "Giáo viên duyệt"; (6) nhóm Chấm bài không có mục "Thi thử".

### 5.3 Migration mới (dải G09: 440–459)

Số migration lấy theo dải ở `01-KE-HOACH-TONG.md` mục 6 (G09: 440–459); người cấp và duyệt là anh Andy. Người thực thi kiểm `backend/migrations/README.md` (và sổ đăng ký migration nếu G10 đã lập) trước khi dùng số; không nhảy số, không lấy số ngoài dải. Mọi bảng mới: bật RLS, **không** có policy cho `authenticated`/`anon` (chỉ backend `supabase_admin` đọc/ghi, theo spec 0039), kèm file `rollback/`.

| Số | File | Nội dung | Nhiệm vụ |
|---|---|---|---|
| 440 | `440_admin_settings.sql` | Bảng `admin_settings(key text PK, value jsonb NOT NULL, updated_by uuid, updated_at timestamptz)`; bảng `admin_settings_log(id, key, old_value jsonb, new_value jsonb, reason text, actor_id uuid, created_at)` chỉ ghi thêm (trigger chặn UPDATE/DELETE như `class_action_log` mig 356). Nạp sẵn khoá `ops_thresholds` với giá trị mặc định ở 5.6. | T22 |
| 441 | `441_cohort_teacher_schedule.sql` | `cohorts.instructor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL` + index; `cohorts.weekly_schedule jsonb NULL` (ví dụ `[{"dow":2,"start":"19:30"},{"dow":4,"start":"19:30"}]`), `cohorts.start_date date NULL`; `class_lessons.starts_at time NULL`. **Một cột trên lớp, không có bảng nhiều giáo viên** (mỗi lớp một giáo viên — điểm 23). Điền cho lớp đang có (trong cùng migration): với mỗi lớp chưa lưu trữ, lấy `students.instructor_id` của các thành viên active (`student_cohort_memberships.is_active`); mọi giá trị khác NULL trùng nhau → ghi giá trị đó vào `cohorts.instructor_id`; lẫn nhiều giáo viên hoặc không ai có giáo viên → để NULL và in tên lớp ra NOTICE. Lớp NULL: chỉ admin thấy; admin chọn giáo viên ở trang Lớp (FR-108). Không tự gán anh Andy cho lớp NULL (Q35). | T24 |
| 442 | `442_learner_care_notes.sql` | Bảng `learner_care_notes(id, student_id uuid NULL REFERENCES students, user_id uuid NULL REFERENCES users, author_id uuid NOT NULL, body text NOT NULL CHECK (length 1..4000), next_action text NULL, due_on date NULL, done_at timestamptz NULL, done_by uuid NULL, is_initial boolean DEFAULT false, created_at, updated_at, deleted_at NULL)`; CHECK có ít nhất một trong `student_id`, `user_id`; index `(due_on) WHERE done_at IS NULL AND deleted_at IS NULL`. G13-A12 (GOI-13) cần phân biệt ghi chú tự sinh: đề nghị thêm cột `source text not null default 'manual'` ngay trong 442 nếu 442 chưa merge (sửa 18/11 theo GOI-13). Không chép `persona_notes` trong migration (API dựng ghi chú đầu lúc đọc — 5.4). | T35 |
| 443 | `443_saved_learner_groups.sql` | `saved_learner_groups(id, name text NOT NULL, owner_id uuid NOT NULL, cohort_id uuid NULL, created_at, archived_at NULL)`; `saved_learner_group_members(group_id, student_id, PRIMARY KEY (group_id, student_id))`. Nhóm là danh sách tên cố định. | T25 |
| 444 | `444_class_lesson_review_items.sql` | `class_lessons.review_items jsonb NOT NULL DEFAULT '[]'` (mỗi phần tử `{bank_id, qid, source_assignment_id, added_by, added_at}`); `class_assignment_reminders(assignment_id, student_id, sent_on date, sent_at timestamptz, sent_by uuid, PRIMARY KEY (assignment_id, student_id, sent_on))` để chặn nhắc quá một lần một ngày và hiện "Đã nhắc HH:MM". | T27 |
| 445 | `445_mock_exam_audiences.sql` | Bảng `mock_exam_audiences` và các cột mới của `mock_exams` (5.5). Nới CHECK `mock_exams_exam_mode_chk` thành `IN ('sequential','retake','live','self_paced')`. Chưa đổi dữ liệu. | T31 |
| 446 | `446_mock_exam_mode_backfill.sql` | Điền `mock_exam_audiences` từ roster lớp của `mock_exams.cohort_id` và từ `mock_exam_assignments`; đổi `exam_mode` cũ sang tên mới; sửa `fn_set_exam_mode` (bản mới nhất: `grep -ln "fn_set_exam_mode" backend/migrations/*.sql \| sort \| tail -1`) nhận cả bốn giá trị. Chỉ chạy sau khi backend đọc được cả hai tên đã lên staging. | T31 |
| 447 | `447_mock_exam_events.sql` | `mock_exam_events(id, exam_id, sitting_id NULL, kind text, payload jsonb, actor_id NULL, created_at)` chỉ ghi thêm; `mock_exam_sittings.extra_seconds jsonb NOT NULL DEFAULT '{}'` (theo phần); `mock_exam_room_messages(id, exam_id, body, sent_by, sent_at)`. | T33 |
| 448 | `448_mock_exam_release_parts.sql` | `mock_exam_sittings.released_skills text[] NOT NULL DEFAULT '{}'`, `released_at timestamptz NULL`; `mock_exam_score_edits(id, sitting_id, skill, old_band, new_band, reason text NOT NULL, actor_id, created_at)` chỉ ghi thêm. Cột hiện có đánh dấu "đã trả" của sitting: CHƯA KIỂM (`grep -n "release" backend/services/mock_review_workflow.py \| head -20`); nếu đã có cột tương đương thì dùng lại, không thêm `released_at`. | T33 |
| 449 | `449_content_import_batches.sql` | `content_import_batches(id, code text UNIQUE, script text, skill text, environment text, mode text CHECK IN ('dry_run','import'), actor text, started_at, finished_at, created_count int, updated_count int, error_count int, status text, error_report_path text NULL)`; `content_import_batch_items(batch_id, item_kind text, item_id text, action text CHECK IN ('created','updated','error'), PRIMARY KEY (batch_id, item_kind, item_id))`. Dùng bảng nối thay vì thêm `batch_id` vào từng bảng nội dung. | T36 |
| 450 | `450_content_review_items.sql` | `content_review_items(id, item_kind text, item_id text, question_ref text, status text CHECK IN ('open','checked','fixed'), checked_by, checked_at, fixed_version text NULL, note text NULL, UNIQUE (item_kind, item_id, question_ref))`. Lý do (báo lỗi N người, tỉ lệ sai) tính lúc đọc. | T36 |
| 451 | `451_incident_groups.sql` | `incident_groups(fingerprint text, source text CHECK IN ('errors','grading','feedback'), status text CHECK IN ('new','in_review','resolved','ignored'), claimed_by, claimed_at, resolved_by, resolved_at, last_seen_at, note text NULL, PRIMARY KEY (source, fingerprint))`; `incident_group_notes(id, source, fingerprint, body, auto boolean, actor_id, created_at)`. | T07 |
| 452–459 | — | Dự phòng (8 số). | |

**Vừa dải:** dùng 12/20 số. Không cần số ngoài dải với phạm vi ghi ở mục 3. Nếu anh Andy duyệt các việc đang "gói sau" (tính lại điểm, thẻ Pháp lý, `lesson_primary`, tỉ lệ sai toàn kho) thì cần thêm khoảng 4–6 số, vẫn trong 452–459.

Cột và bảng **không** thuộc G09 nhưng màn G09 cần (gói kia phải có): số lượt chấm kèm mã kích hoạt và lệnh cấp thêm lượt cho lớp/học viên, trạng thái lưu trữ của khoá, hạn bổ sung của đơn, mốc hết hạn riêng của phần lượt chuyển và dòng sổ hết hạn phần lượt chuyển, lệnh chuyển lớp mã cũ sang đo lượt (G04); `result_release_mode`, mức công bố, hẹn giờ (GOI-11 mig 473–474); bảng thông báo và lần gửi (GOI-11 mig 470).

### 5.4 API mới và API sửa

Tiền tố theo router admin hiện có: `/admin/...` (không `/api`, trừ feedback). Model Pydantic với `_StrictOut` như `models/admin_overview.py`. Lỗi trả `{"detail": {"error_code", "message"}}`. Thời gian ISO 8601 UTC có `Z`. Mọi API tổng hợp trả 200 kèm `sources_failed: [str]` khi một nguồn lỗi (không làm hỏng cả trang).

**API G04 mà G09 gọi (đối chiếu GOI-04 bản 18/11, mục 5.9; G09 không viết các route này):**

| Việc ở G09 | Route G04 | Điểm phải khớp |
|---|---|---|
| Danh sách, tạo, sửa khoá (T13) | `GET · POST /admin/course-products`, `PATCH /admin/course-products/{id}` | Trả kèm `open_orders`, `active_learners`; lỗi 409 `slug_taken`, 422 thông điệp tiếng Việt |
| Lưu trữ khoá (T13) | `POST /admin/course-products/{id}/archive` body `{confirm_title}` | 409 `has_active_learners`, `has_open_orders`; 422 `title_mismatch`. Phân xử 14 đã xong: G04 có `archived_at` |
| Làn đơn và số đếm (T13, T06) | `GET /admin/enrollment-orders?status=&q=&late=1`, `GET /admin/enrollment-orders/counts` | `counts` có `expired_late_reported` (đơn hết hạn mà học viên báo đã chuyển) — hiện thành dòng cần xem ở làn Hết hạn |
| Trang một đơn (T13) | `GET /admin/enrollment-orders/{id}` | `Order` + `events[]` + `other_open_order_code`; đọc `info_kind`, `received_vnd`, `overpaid_vnd`, `supplement_by`, `admin_message`, `cancel_reason` (`learner`/`admin`), `cancel_note`, `late_transfer_reported_at`, `reopened_at` |
| Xác nhận và mở khoá (T13) | `POST …/{id}/confirm` body `{note, allow_expired, received_vnd}` | Trả `status` (`confirmed`/`already_confirmed`), `entitlement`, `credits_granted`, `reopened`; 409 `invalid_transition`, `has_open_order`, `account_suspended` |
| Yêu cầu bổ sung (T13) | `POST …/{id}/request-info` body `{info_kind: 'underpaid'\|'not_found'\|'other', received_vnd, message 3..1000, supplement_by}` | `supplement_by` null → máy chủ lấy `now() + ENROLL_SUPPLEMENT_HOURS`; `info_kind='underpaid'` hiện nhãn "Cần bổ sung · sai lệch"; G04 gửi thư `order_needs_info` |
| Huỷ đơn (T13) | `POST …/{id}/cancel` body `{message 3..500, confirm_order_code}` | 422 `order_code_mismatch`; lý do đọc lại ở `cancel_note` |
| Thẻ Khoá và quyền của hồ sơ (T04, T11) | `GET /admin/users/{user_id}/access`, `GET /admin/users/{user_id}/credits` | Số dư **một kho chung** theo quyền (`credits.balance`), tổng theo nguồn `by_kind.online` / `by_kind.class`; không có số dư theo kỹ năng. Điểm 23: mỗi quyền cần đọc được **số lượt chuyển còn lại** và **mốc hết hạn của phần lượt chuyển** — đã đối chiếu GOI-04 mục 5.9 bản 18/11 chiều: mỗi phần tử của `GET /admin/users/{user_id}/access` có `credits.carry_balance` (số lượt chuyển còn dùng được, 0 khi không có hoặc đã quá hạn bảo lưu) và `credits.carry_expires_at`; cùng response có `content_visible_until`, `content_days_after_expiry`. Dòng sổ ở `GET /admin/users/{user_id}/credits` có `reason` ∈ `carry_over`, `carry_expire` và `label_vi` do G04 trả ("Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại", "Lượt chuyển hết hạn bảo lưu", "Cộng khi lớp chuyển sang tính lượt") — G09 in đúng `label_vi`. `carry_balance = 0` hoặc thiếu trường → G09 ẩn dòng lượt chuyển |
| Lượt chuyển khi đăng ký lại ở trang đơn (T13) | `GET /admin/enrollment-orders/{id}`; `POST …/{id}/confirm` (hàm `fn_enrollment_order_confirm` của G04 trả `renews_entitlement_id`, `credits_granted`) | Đơn đăng ký lại cần đọc được: đây là đơn đăng ký lại, số lượt sẽ chuyển (xem trước) và đã chuyển (sau xác nhận), hạn của phần lượt chuyển. Cấu hình hiển thị: `credit_carry_percent` (100), `credit_carry_valid_days` (60). Đã đối chiếu GOI-04 mục 5.9: G04 **không** có trường "xem trước số lượt sẽ chuyển" trên đơn. Trước khi xác nhận, G09 hiện "Ước tính chuyển: N lượt" với N = `credits.balance` của quyền cũ cùng sản phẩm đọc từ `GET /admin/users/{user_id}/access` (ghi rõ chữ "ước tính"; quyền cũ đã đóng sổ hoặc không đọc được → không hiện số); sau xác nhận đọc `credits.carry_balance`, `carry_expires_at` của quyền mới. `credits_granted` của đơn chưa gồm lượt chuyển |
| Cấp lượt cho lớp cũ (T43) | `GET /admin/credits/convert-class/preview?cohort_id=…`, `POST /admin/credits/convert-class` body `{cohort_id, credits_per_member, request_key}` | Xem trước trả danh sách thành viên dùng mã cũ chưa có nơi nhận lượt và số gợi ý từ cấu hình `legacy_class_initial_credits`; lệnh ghi idempotent theo `request_key`. Hình dạng response (đã đối chiếu GOI-04 mục 5.9 bản 18/11 chiều): `preview` → `{cohort, product, products[], suggested_credits, members[{user_id, display_name, state, expires_at}], counts{to_convert, already_metered, no_account}}`, `state` ∈ `to_convert`, `already_metered`, `no_account`; `POST` nhận thêm `product_id` (bắt buộc khi `products` có hơn một) → `{status: converted|replay, converted[], skipped[{user_id, reason}]}`; lỗi 409 `cohort_archived`, `cohort_has_no_course`, `no_class_product`, `product_ambiguous`. Danh sách lớp chưa chuyển cho T06 và bộ lọc `/admin/classes?metering=legacy`: `GET /admin/credits/convert-class/pending` → `{items[{cohort_id, cohort_name, course_code, members, pending_members}]}`. Chỉ admin |
| Đếm "lớp chưa chuyển sang đo lượt" (T06, T43) | hàm đọc của G04 dùng chung với `preview` | G09 cần đếm theo lớp số thành viên active dùng mã cũ chưa có nơi nhận lượt. G04 chưa có hàm đếm nhiều lớp một lần → T06 gọi phần lõi của `preview` cho từng lớp chưa lưu trữ (số lớp nhỏ), nhớ tạm 60 giây |
| Cấp, gia hạn, thu hồi quyền (T14) | `POST /admin/entitlements` (`request_key`), `POST /admin/entitlements/{id}/extend`, `…/revoke` | Mỗi người một lời gọi; không có route lô |
| Điều chỉnh lượt (T15) | `POST /admin/credits/adjust` body `{entitlement_id, delta, reason 10..500, request_key}` | 409 `would_go_negative`, `not_usable` |
| Cấp thêm lượt (T15, T29) | `POST /admin/credits/grant-extra` body `{cohort_id \| null, user_ids \| null, credits, reason 3..500, request_key}` | Trả `{granted:[{user_id, entitlement_id, balance}], skipped:[{user_id, reason}]}`; hiện cả hai danh sách (FR-054). Giáo viên có được gọi hay không: GOI-04 Q5 — hiện chỉ admin |
| Tạo mã cho lớp kèm lượt (T29) | route tạo mã hiện có `/admin/access-codes/generate`, G04-T06 thêm `product_id`, `grant_days`, `grant_credits` | Cột "Số lượt chấm cấp kèm mã" đọc `grant_credits` |
| Một phiên mỗi tài khoản | — | Chỉ áp học viên; admin, giáo viên không bao giờ nhận 409 `session_not_current` (GOI-04 mục 5.13) |

Không có ở G04 và **không dựng ở G09**: khối "đồng ý dùng bản ghi âm" trong hồ sơ học viên (tính năng hoãn theo quyết định 18/11/2026; GOI-04 mục 5.17 ĐÃ BỎ).

**Hàm phạm vi dùng chung** — `backend/services/staff_scope.py` (T24):
`async def resolve_staff_scope(authorization) -> StaffScope` (gọi `require_instructor`; trả `role`, `user_id`, `cohort_ids: set | None` — `None` nghĩa admin thấy tất cả) và `scope.assert_cohort(cohort_id)` ném 404 khi lớp không thuộc giáo viên. Lớp của giáo viên = `cohorts.instructor_id = user_id` — **đã chốt 18/11 chiều: mỗi lớp một giáo viên, một cột, không có bảng `cohort_instructors`** (Q18 đóng). Đây là nơi duy nhất trong backend đọc `cohorts.instructor_id` để quyết định quyền; GOI-11 (gửi thông báo, công bố điểm) và mọi route G09 gọi hàm này, không tự truy vấn. Học viên thuộc phạm vi của giáo viên = thành viên active (`student_cohort_memberships`) của các lớp trong `cohort_ids`. Lớp có `instructor_id` NULL không thuộc giáo viên nào.
Kiểm kê guard (đã kiểm ở `c3bc71574`, `backend/tests/test_staff_guard_inventory.py` dòng 57–63 và 260–275): lệnh `await` đầu tiên của handler phải gọi một tên trong `GUARD_NAMES` (`require_admin`, `require_instructor`, `_me`, `_require_curated_admin`, `_require_private_admin`), hoặc một hàm bọc **cùng module với router** có lệnh đầu là guard và nhận thẳng `authorization`. `resolve_staff_scope` nằm ở `services/` nên **không** được nhận. Cách làm: T24 thêm tên `resolve_staff_scope` vào `GUARD_NAMES` trong cùng PR (đổi test có chủ ý, ghi rõ trong PR) kèm một test khẳng định lệnh đầu của `resolve_staff_scope` là `await require_instructor(authorization)` (mẫu `test_guard_wrappers_await_the_shared_guard_first`, dòng 277). Nếu anh Andy không muốn đổi kiểm kê: mỗi route gọi `await require_instructor(authorization)` trước rồi mới gọi hàm phạm vi.
Gắn giáo viên vào lớp: `PATCH /admin/cohorts/{cohort_id}` hiện có (`routers/cohorts.py` dòng 143, chỉ admin) nhận thêm `instructor_id: uuid | null`, `weekly_schedule`, `start_date`. `instructor_id` khác null phải là người dùng có `role ∈ ('instructor','admin')` và đang hoạt động → sai thì 422 `invalid_instructor` (thông điệp tiếng Việt). Mỗi lần đổi ghi `class_action_log`. `GET /admin/cohorts` (danh sách, `routers/cohorts.py` dòng 66) và `GET /admin/cohorts/{cohort_id}/members` (dòng 302 — route trang lớp đang dùng để lấy thông tin lớp; repo ở `c3bc71574` không có route đọc một lớp riêng) trả thêm `instructor: {id, name} | null` cho lớp.

**Danh bạ, hồ sơ, ghi chú** (`routers/admin_learners.py`, `routers/admin_care_notes.py`)

| Method · path | Quyền | Request | Response (rút gọn) | Lỗi |
|---|---|---|---|---|
| `GET /admin/learners` | admin | `q`, `cohort_id`, `kind` (`offline`/`online`/`both`/`none`), `status` (`active`/`expiring`/`expired`/`archived`), `attention` (`any`/`late_streak`/`inactive`/`expiring`/`low_credits`), `credits_max`, `role` (mặc định `user,student`), `page` (≥1), `page_size` = 25 | `{ items: [{ ref, name, email?, student_code?, account_state, profile_state, kind, cohorts: [{id,name}], courses: [{title, state, expires_at?, days_left?}]\|null, credits_left: int\|null, attention: [{code, text}], last_active_at? }], total, page }` | 422 |
| `GET /admin/learners/{ref}` | admin; giáo viên qua `GET /instructor/learners/{ref}` cùng service, 404 nếu không thuộc lớp mình | — | `{ ref, canonical_ref, summary: Summary, sources_failed }` | 404 |
| `GET /admin/learners/{ref}/summary` | admin, giáo viên (lớp mình) | — | `Summary` = `{ name, cohorts, courses, status: {level: 'ok'\|'attention', reasons: [{code,text}] (≤2)}, goal: {target_band?, exam_date?, source: 'admin'\|'learner'\|'both_equal'\|'conflict'\|'none'}, overdue: {count, latest_title?}, recent_bands: {writing: [..≤4]\|null, speaking: [..≤4]\|null}, last_active_at?, latest_note: {author, at, text}\|null }` — `latest_note` chỉ điền cho admin; với giáo viên máy chủ luôn trả `null` (lọc ở service, không ở giao diện) tới khi anh Andy trả lời Q16(b), áp cho cả `GET /instructor/learners/{ref}`. Test hợp đồng: admin tạo ghi chú, gọi cả hai response bằng tài khoản giáo viên, không response nào chứa nội dung ghi chú | 404 |
| `GET /admin/learners/{ref}/overview` | admin | — | `{ alerts: {open: [{code, text, action}], checked_off: [code]}, goal: {admin: {target_band?, target_date?}, learner: {target_band?, exam_date?}, conflict: bool, estimated_band?: num\|null}, continuity: {weeks: [[bool\|null ×7] ×8], streak_days, minutes_this_week, minutes_last_week}, assigned: {on_time, late, missing, open: [...], overdue: [{assignment_id, title, days_overdue, last_reminded_at?}]}, scores: {grammar: [{at, pct, lesson_no?}], writing: [{at, band}], speaking: [...], mock: [...], milestones: [{at, label}]}, side: {due_notes: [...], courses: [...], credits_left: int\|null, credits_carried: {amount: int, expires_at}\|null}, sources_failed }` — `credits_carried` chép từ trường G04 trả (FR-056), `null` khi không có lượt chuyển hoặc G04 chưa trả | |
| `POST /admin/learners/{ref}/goal/resolve` | admin | `{ use: 'admin'\|'learner' }` | `{ goal }` — ghi cả hai bảng, ghi nhật ký | 409 `no_conflict` |
| `GET /admin/learners/{ref}/attempts` | admin | `skill?`, `state?`, `cursor` | `{ items: [{ skill, kind, id, title, state, result_text?, submitted_at, open_href }], next_cursor?, writing_repeated_errors: [...]\|null, weak_grammar_groups: [...]\|null }` | |
| `GET /admin/learners/{ref}/ai-cost` | admin | `window` 7\|30\|90 | `{ total_usd, unpriced_calls, by_feature: [...] }` | |
| `GET /admin/learners/{ref}/log` | admin | `kind?`, `cursor` | `{ items: [{ at, actor_name?, source: 'access_code'\|'security'\|'class'\|'role'\|'entitlement'\|'credit'\|'order'\|'goal', text }] }` | |
| `GET /admin/learners/{ref}/care-notes` | admin | — | `{ items: [{ id, author_name, created_at, body, next_action?, due_on?, done_at?, is_initial, editable: bool }] }` — khi chưa có dòng `is_initial` mà `students.persona_notes` khác rỗng, chèn một phần tử ảo `is_initial: true` (không ghi DB) | |
| `POST /admin/learners/{ref}/care-notes` | admin | `{ body, next_action?, due_on? }` | 201 `{ note }` | 422 |
| `PATCH /admin/care-notes/{id}` | admin | `{ body?, next_action?, due_on?, done?: bool }` | `{ note }` | 409 `note_locked` (quá `CARE_NOTE_EDIT_HOURS`, chỉ còn đổi `done`) |
| `DELETE /admin/care-notes/{id}` | admin | — | 204 (xoá mềm) | 409 `note_locked` |

`attention.code`/`status.reasons.code` ∈ `late_streak`, `inactive`, `course_expiring`, `low_credits`. Một hàm duy nhất `services/learner_attention.py::compute(student_ids, thresholds)` dùng cho mọi nơi (FR-029). Nguồn bắt buộc dùng lại: `services/student_service.get_student_with_history`, `essay_service.get_student_summary`, `_aggregate_usage_for_users` (`routers/admin.py`), `student_home_aggregator._build_streak`, hàm bài làm trong lớp của `admin_class_assignments.py` (`student_work`), API đọc của G04 (chưa có → trường liên quan `null`). Cột khoá người dùng của `listening_test_attempts`, `reading_test_attempts`, `mock_exam_sittings`: CHƯA KIỂM — `grep -n "CREATE TABLE.*<bảng>" -A25 backend/migrations/*.sql`.

**Việc cần làm, ngưỡng, tìm nhanh** (`routers/admin_attention.py`, `routers/admin_settings.py`, `routers/admin_search.py`)

| Method · path | Quyền | Response (rút gọn) |
|---|---|---|
| `GET /admin/attention` | admin; giáo viên gọi `GET /instructor/attention` (cùng service, lọc `cohort_ids`, bỏ trường admin) | `{ queues: { exams_today: Q, writing_review: Q & {ai_failed: int}, speaking_mock_pending: Q, course_tests_awaiting_release: Q, assignments_overdue: Q, regrade_new: Q, enrollments_reported: Q, care_due_today: Q, incident_groups_open: Q, feedback_open: Q, entitlements_expiring: Q, classes_unmetered: Q }, classes_week: [{ cohort_id, name, next_lesson: {lesson_id, lesson_no, date, starts_at?}, following_lesson?, has_assignment: bool, pending_review: int, last_assignment_id? }], attention_learners: [{ ref, name, cohort, reasons: [...] }] (≤8), ops_week: { on_time_rate: {value, lowest_cohort_id}\|null, … }, generated_at }` với `Q = { count: int\|null, oldest_at: str\|null, overdue: bool, error: bool, unavailable: bool }`. `count = null` khi nguồn lỗi (`error: true`) hoặc gói phụ thuộc chưa có (`unavailable: true`). `classes_unmetered.count` = số lớp chưa lưu trữ còn thành viên active dùng mã cũ chưa có nơi nhận lượt (FR-058); chỉ có ở bản admin. |
| `GET /admin/settings/thresholds` | admin, giáo viên (chỉ đọc) | `{ items: [{ key, group, label, anchor, value, unit, min, max, fixed: bool }] }` |
| `PATCH /admin/settings/thresholds` | admin (AAL2) | `{ changes: [{key, value}], reason }` → `{ items }`; 422 `out_of_range` kèm thông điệp tiếng Việt; ghi `admin_settings_log` |
| `GET /admin/settings/{section}` · `PATCH` (`section` ∈ `email`, `notices`, `payment`) | admin | đọc/ghi một khoá của `admin_settings`; `payment` chỉ có PATCH khi Q20 được duyệt |
| `GET /admin/settings/log` | admin | `?section&cursor` → `{ items: [{at, actor_name, section, changes, reason}] }`. Khai báo route này (và `/thresholds`, `/trial` của GOI-11) **trước** route `/{section}`; `section` là enum nên `log` không bao giờ khớp nhầm. |
| `POST /admin/search` | admin | body JSON `{ q }` (≥2; không đặt `q` trên URL vì log HTTP của nền tảng giữ URL — #2453; `GET` → 405) → `{ learners[≤3], classes[≤3], submissions[≤3], content[≤3], orders[≤3], sources_failed, unavailable }` mỗi dòng `{title, meta, href}`; 422 q ngắn |
| `POST /instructor/search` | giáo viên | như trên (body `{ q }`), không có `content`, `orders`; lọc theo `cohort_ids` |

**Kết quả một bài giao** — **một** API tổng hợp thay ba API của ba tab (thêm vào `routers/admin_class_assignments.py`, logic ở `services/assignment_result.py`):

`GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/result?group_by=truc_nhom|subtype` — quyền: admin, hoặc giáo viên của lớp (`staff_scope`). Response:

```json
{
  "assignment": {"id": "…", "title": "…", "skill": "course", "variant": "objective",
                 "lesson": {"id": "…", "lesson_no": 13, "date": "2026-11-19"},
                 "due_at": "…Z", "pass_pct": 70, "question_count": 90,
                 "release_mode": null, "recipient_scope": "class"},
  "states": {"on_time": 9, "late": 2, "in_progress": 1, "not_opened": 1, "no_account": 1},
  "who": [{"student_id": "…", "name": "…", "state": "late", "submitted_at": "…Z",
           "late_minutes": 190, "opened_at": "…Z", "stalled": false,
           "overdue": false, "last_reminded_at": null}],
  "performance": {"submitted": 11,
                  "first_run": {"scores": [{"student_id": "…", "pct": 64}],
                                "median_pct": 64, "pass_rate": 0.45, "retake_students": 4},
                  "median_duration_sec": 1380,
                  "previous": {"assignment_id": "…", "title": "…", "median_pct": 71}},
  "weak_spots": {"group_by": "truc_nhom", "excluded_essay_questions": 3,
                 "groups": [{"key": "HIEN-TAI-DON-TIEP-DIEN", "label": "…",
                             "label_source": "table", "question_count": 12,
                             "wrong_rate": 0.41, "students_wrong_2plus": 7, "median_sec": 22,
                             "top_questions": [{"qid": "…", "prompt": "…", "answer_text": "…",
                                                "attempted": 11, "wrong": 8,
                                                "top_wrong": {"option": "B", "text": "…",
                                                              "count": 6, "why_wrong": "…"}}]}]},
  "attention": [{"student_id": "…", "name": "…", "first_pct": 42, "delta_prev": -18,
                 "reasons": ["below_pass", "dropped_twice", "too_fast", "many_retakes", "stalled"]}],
  "teach_next": {"suggested": [{"qid": "…", "group_key": "…"}],
                 "saved": {"lesson_id": "…", "items": ["…"], "saved_at": "…Z"}},
  "sources_failed": []
}
```

Quy tắc:
- `variant` ∈ `objective` (bài `skill='course'` chấm máy, quiz), `rubric` (Writing/Speaking), `course_test` (đề giữa/cuối kỳ: `content_config.completion_mode='single_attempt'`). Với `rubric`: `weak_spots.group_by = "criterion"`, `groups[]` là từng tiêu chí với `median_band`, thêm `top_annotation_kinds: [{kind, essays}] | null`; `performance.first_run` thành `bands`. Với `course_test`: `group_by = "lesson"`, `groups[].key` = `B01`…`B20`, thêm `matrix: [{student_id, cells: [{lesson, correct, total}]}]` với `total` = số câu của buổi trong đề.
- Năm trạng thái suy từ dữ liệu hiện có: `no_account` = `students.user_id IS NULL`; `on_time` = `submitted_at <= due_at`; `late` = `submitted_at > due_at`; `in_progress` = chưa nộp và `opened_at` có; `not_opened` = chưa nộp và `opened_at` NULL. Người chưa nộp đã qua hạn mang thêm `overdue: true` (không phải trạng thái thứ sáu). `stalled` lấy cờ `course_stalled` sẵn có của `course_attempt_report`.
- `weak_spots` chỉ tính lượt đầu (`quiz_sessions.kind='run'`, `attempt_no` nhỏ nhất của mỗi câu); gom theo `quiz_attempts.skill` (hoặc `subtype`); **không cắt** số nhóm; `top_questions` tối đa 3 câu mỗi nhóm; loại câu tự luận (subtype E1–E3 — tên subtype CHƯA KIỂM: `grep -n "E1\|E2\|E3" backend/scripts/import_course_exercise_bank.py`).
- `label`: tra bảng tên hiển thị `backend/content/course-labels/truc_nhom_vi.json` và `subtype_vi.json` (file mới, không phải migration); không có tên → trả chính mã và `label_source: "code"` (giao diện vẫn hiện, không báo lỗi). Tên trên tờ thiết kế là tên đề xuất (Q27).
- `performance`, `weak_spots` = `null` khi chưa ai nộp. `performance.previous` = `null` khi lớp không có bài trước cùng loại (xếp theo `class_lessons.lesson_no`, rồi `due_at`).
- `attention.reasons` dùng ngưỡng ở Cài đặt (`too_fast_sec_per_question`, `many_retakes_count`, `stalled_hours`); `below_pass` dùng `pass_pct` của bài.
- `teach_next.suggested`: tối đa 3 câu theo FR-130.
- GOI-11 phần E: với bài chế độ công bố, API này (phía nhân sự) luôn có điểm (FR-11-075).

API đi kèm:

| Method · path | Quyền | Request → Response |
|---|---|---|
| `PATCH /admin/cohorts/{c}/lessons/{lesson_id}/review-items` | admin, giáo viên của lớp | `{ items: [{bank_id, qid, source_assignment_id}] }` → `{ lesson }` |
| `POST /admin/cohorts/{c}/assignments/{a}/remind` | admin, giáo viên của lớp | `{ student_ids: [uuid] \| null }` (null = mọi người chưa nộp đã qua hạn) → `{ sent: int, skipped_already_today: int, skipped_no_account: int }`; ghi `class_assignment_reminders`; tạo thông báo `reminder` qua service của GOI-11 phần A (khoá chống trùng `remind:{assignment}:{student}:{ngày VN}`) |
| `GET /admin/cohorts/{c}/assignment-matrix` | admin, giáo viên của lớp | `{ assignments: [{id,title,due_at}], rows: [{student_id, name, cells: [{state_text}], done: int, due: int}] }` — bảng học viên × bài |

Ba API cũ (`tally`, `attempt-report`, `students/{u}/report`): **không xoá** trong gói này. `tally` còn được GOI-11 phần E mở rộng và bảng công bố dùng; `students/{u}/report` còn dùng cho "bài làm từng câu" của một học viên; `attempt-report` chỉ gỡ lời gọi ở frontend. Xoá endpoint là việc gói sau, sau khi không còn nơi gọi.

**Nhóm đã lưu và giao bài** (`routers/admin_learner_groups.py`; giao bài dùng `POST /admin/cohorts/{c}/assignments` hiện có)

| Method · path | Quyền | Ghi chú |
|---|---|---|
| `GET /admin/learner-groups?cohort_id=` · `POST` · `PATCH /{id}` · `DELETE /{id}` (lưu trữ) | admin, giáo viên (chỉ nhóm mình tạo, thành viên thuộc lớp mình) | `POST` body `{ name, cohort_id?, student_ids: [uuid] }` |
| `POST /admin/cohorts/{c}/assignments` (hiện có) | như hiện tại + giáo viên của lớp (T26) | Thành phần giao bài gửi `student_ids` khi "Chọn tay" hoặc "Nhóm đã lưu" (đã có `recipient_scope='subset'`, mig 193); thêm trường của GOI-11 5.5.8 (`result_release_mode`…) khi bài là bài kiểm tra |

**Kỳ thi** (sửa `routers/admin_mock_exams.py`)

| Method · path | Ghi chú |
|---|---|
| `POST /admin/mock-exams` (sửa) | Nhận `exam_mode: "live"\|"self_paced"` (vẫn nhận tên cũ, ánh xạ sang tên mới); cho phép thiếu đề của kỹ năng không dự thi; `skills: [..]` (≥1); tạo ở trạng thái `draft` không cần người thi. |
| `GET /admin/mock-exams` (sửa) | Mỗi kỳ thêm `display_state` ∈ `draft`, `scheduled`, `open`, `running`, `grading`, `released`; `audience_count`; `exam_mode` tên mới. |
| `GET /admin/mock-exams/{id}/audience` | `{ items: [{ user_id, student_id, name, cohort?, source: {kind: 'cohort'\|'learner'\|'group', label}, skills: [...], selected: bool, excluded_reason?, open_from?, open_until? }], practice_overlap: [{ skill, count }] }` |
| `PATCH /admin/mock-exams/{id}/audience` | `{ add_cohort_ids?: [], add_student_ids?: [], add_group_ids?: [], set: [{user_id, selected?, skills?}], window?: {open_from, open_until} }` → như GET. 409 `exam_locked` khi đề đã khoá (thêm người sau khi phòng mở vẫn được, ghi `mock_exam_events`). |
| `POST /admin/mock-exams/{id}/schedule` | Kiểm điều kiện FR-144; 422 `not_ready` kèm `missing: [...]`; chuyển `status='published'`; gửi thông báo cho người được chọn (GOI-11). |
| `POST /admin/mock-exams/{id}/extra-time` | `{ sitting_id, section, seconds, reason }`. Kỳ `self_paced`: `section` phải là phần **đang chạy** của sitting đó, không thì 409 `section_not_running`; các phần sau lùi theo (5.5). |
| `GET /admin/mock-exams/{id}/live` (sửa) | Kỳ `self_paced`: mỗi người thêm `self_paced_state` ∈ `not_started` \| `in_progress` \| `submitted` \| `missed`, `current_section`, `section_time_left_seconds`, `started_at`, `expected_end_at`. `submitted` = mọi phần của người đó đã nộp, hoặc giờ cả bài đã hết (phần bỏ dở được tự nộp); `missed` = khoảng mở đã đóng mà chưa bắt đầu. Không có giá trị nào cho "nghỉ giữa phần" (FR-151). Thêm `idle_threshold_minutes` (T33). |
| `POST /admin/mock-exams/{id}/room-message` | `{ body }` |
| `GET /admin/mock-exams/{id}/analysis` | `{ band_distribution: {listening: [...]\|null, …}, top_wrong: {listening: [..≤10], reading: [..≤10]}, by_question_type: {...}, pacing: [{sitting_id, name, points: [...], long_pauses: [...]}], vs_previous: {...}\|null, writing_criteria_median: {...}\|null }` |
| `POST /admin/mock-exams/{id}/release` | `{ mode: 'complete_only'\|'include_partial', confirm_title, request_key }` → `{ released: int, partial: int, skipped: int }`; 422 `confirm_mismatch`. Gọi logic của `bulk-release` hiện có cho người đủ điều kiện; `include_partial` ghi `released_skills`. |
| `POST /admin/mock-exams/sittings/{id}/score-edit` | `{ skill, new_band, reason }` — chỉ sau khi đã trả; ghi `mock_exam_score_edits`, gửi thông báo. |
| `GET /admin/mock-exams/{id}/events` | Dòng thời gian cho thẻ Nhật ký; lọc `kind`. |
| `GET /admin/speaking/mock-queue` | Hàng chờ Speaking thi thử: `{ items: [{ sitting_id, exam: {id,title}, name, cohort, submitted_at, waited_hours, overdue, flags: [..], claimed_by? }] }`; lọc `exam_id`. Quyền: admin, giáo viên (lớp mình). |

Giữ nguyên: `/open`, `/advance`, `/collect`, `/live`, `/roster`, `/retest-summary`, `/assignments` (dùng cho thi bù), `/sittings/{id}/retest-flags`, `/sittings/{id}/pacing`, `/sittings/{id}/record-speaking`, `/bulk-final-bands`.

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

### 5.5 Mô hình người dự thi và tên chế độ (migration 445–446)

`mock_exam_audiences`:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| exam_id | uuid NOT NULL REFERENCES mock_exams ON DELETE CASCADE | |
| user_id | uuid NULL REFERENCES users | NULL khi học viên chưa có tài khoản (dòng chỉ để hiện, `selected=false`) |
| student_id | uuid NOT NULL REFERENCES students | |
| source_kind | text CHECK IN ('cohort','learner','group') | Nguồn đầu tiên đưa người này vào |
| source_cohort_id / source_group_id | uuid NULL | |
| skills | text[] NOT NULL | ⊆ kỹ năng của kỳ thi, ≥1 |
| selected | boolean NOT NULL DEFAULT true | Bỏ chọn = không dự thi |
| excluded_reason | text NULL | Ví dụ `no_account` |
| open_from, open_until | timestamptz NULL | Khoảng mở riêng (tự làm, thi bù) |
| purpose | text CHECK IN ('main','makeup') DEFAULT 'main' | Thi bù là mục đích, không phải chế độ |
| added_by, added_at | | |
| UNIQUE (exam_id, student_id, purpose) | | Khử trùng theo học viên |

Cột mới của `mock_exams`: `skills text[] NULL` (NULL = đủ bốn như cũ), `allow_early_advance boolean NOT NULL DEFAULT false`, `starts_at timestamptz NULL` (giờ bắt đầu phòng live), `draft_state jsonb NULL` (bước đang soạn).

Lớp tương thích (bắt buộc, vì phía học viên và các test hiện đọc tên cũ):
1. `services/mock_exam_modes.py`: `normalize(mode)` ánh xạ `sequential→live`, `retake→self_paced`; `is_live(mode)`, `is_self_paced(mode)`. Mọi chỗ so sánh chuỗi `'sequential'`/`'retake'` trong backend đổi sang gọi hai hàm này (liệt kê bằng `grep -rn "sequential\|retake" backend/routers backend/services --include="*.py" | grep -v "/tests/"`; có khoảng 20 file frontend chứa hai chuỗi này — phần admin sửa ở T32/T34, phần học viên thuộc G08).
2. API admin trả tên mới; nhận cả hai. API học viên (`routers/mock_exams.py`) **giữ trả tên cũ** cho tới khi G08 đổi (trường `exam_mode` cũ + trường mới `exam_mode_v2`).
3. Ghi kép: thêm/bớt người dự thi cập nhật cả `mock_exam_audiences` và, khi kỳ thi tự làm, `mock_exam_assignments` (để đường học viên hiện tại vẫn chạy). Với kỳ live có nhiều lớp hoặc người lẻ: `admin_live_monitor` và cổng vào phòng của học viên phải đọc roster từ `mock_exam_audiences` thay cho `cohort_id` — sửa `admin_live_monitor` ở T31; cổng học viên là điểm G08 phải khớp (mục 7). `mock_exams.cohort_id` giữ nguyên, đặt bằng lớp đầu tiên của danh sách.
4. Không xoá cột, bảng cũ trong gói này.

**Kỳ `self_paced`: một mốc bắt đầu, các phần chạy liền, làm một lần (chốt 18/11; điểm 23: KHÔNG nghỉ giữa các phần).**

Hiện trạng (đã kiểm ở `c3bc71574`, `backend/services/mock_exam_service.py` dòng 656–700): chế độ `retake` hiện **cho nghỉ giữa phần** — mỗi phần có mốc `<phần>_started_at` riêng trên sitting, chỉ ghi khi học viên bấm bắt đầu phần đó; giữa hai phần `retake_active_section` trả `not_started` (học viên đứng ở màn chọn phần, không đồng hồ nào chạy). Hành vi này phải đổi cho kỳ `self_paced`.

Hợp đồng mới (máy chủ là chủ đồng hồ; G09-T31 ghi hợp đồng và phần admin, G08-T22 làm phía học viên):
1. **Một mốc bắt đầu cho cả bài** = `<phần đầu>_started_at` của sitting (phần đầu theo thứ tự cố định Listening → Reading → Writing trong các kỹ năng của người đó). Không thêm cột mốc mới.
2. **Phần kế bắt đầu ngay khi phần trước kết thúc.** Mốc `<phần kế>_started_at` do **máy chủ** ghi, bằng thời điểm nhỏ hơn giữa lúc nộp phần trước và lúc phần trước hết giờ (`started_at` + thời lượng + giờ cộng của phần đó), cộng `MOCK_SELF_PACED_GAP_SECONDS` (mặc định 0 — Q31). Người học không có nút nào quyết định lúc bắt đầu phần kế.
3. Phần hết giờ mà chưa nộp → máy chủ tự nộp với phần đã làm và ghi mốc phần kế như điểm 2, kể cả khi người thi đã đóng trình duyệt hay mất mạng (đồng hồ không dừng — theo quy tắc full test ở 00 mục 2 điểm 22; mặc định tạm, Q31). Job quét sitting hết giờ hiện có (`reap_expired_retake_sittings`, dòng 3565) phải đi hết chuỗi phần còn lại, không dừng sau một phần.
4. Không có trạng thái "giữa hai phần": sau khi bắt đầu, hàm tính phần đang chạy chỉ trả một phần đang chạy hoặc `done`. Không có màn chọn phần, không "làm phần sau vào lúc khác", không mở lại phần đã nộp.
5. Giờ dự kiến xong cả bài `expected_end_at` = mốc bắt đầu + tổng thời lượng các phần + tổng giờ cộng (+ khoảng chuyển nếu có); nộp sớm một phần thì các phần sau bắt đầu sớm hơn.
6. Bắt đầu chỉ trong khoảng mở (`open_from`…`open_until` của người đó). Đã bắt đầu thì làm hết chuỗi phần dù vượt `open_until` (mặc định tạm, Q31). Chưa bắt đầu khi khoảng mở đóng → `missed` ("Không dự thi").
7. Một lần: một lượt `main` mỗi người mỗi kỳ (UNIQUE ở bảng trên); làm lại = thi bù do admin cấp.
8. Cộng giờ (`extra-time`): chỉ cho phần đang chạy; ghi vào `mock_exam_sittings.extra_seconds` theo phần (migration 447); mốc của các phần sau tính theo điểm 2 nên tự lùi.

Dữ liệu `retake` cũ (thi bù đang mở lúc đổi): sitting đã có phần nộp xong mà phần kế chưa bắt đầu giữ cách cũ tới khi xong (không tự bấm giờ thay người thi); quy tắc mới áp cho sitting tạo sau khi cờ `mock_exam_audiences_learner` bật.

Giả định của người thiết kế (Q12, Q13): thêm lớp chụp danh sách lúc thêm (học viên vào lớp sau không tự vào kỳ thi); thi bù hiện tạo kỳ `retake` riêng có `source_exam_id` — gói này **giữ cơ chế đó**, chỉ hiện liên kết ở thẻ Thí sinh; gộp kết quả thi bù vào kỳ gốc chờ duyệt.

### 5.6 Bảng ngưỡng vận hành (khoá `ops_thresholds` của `admin_settings`)

Giá trị dưới đây là **mặc định đề xuất** từ tờ AdminCaiDat mục 7, nạp ở migration 440; chủ dự án sửa trên trang (Q15). Mã giao diện và backend không ghi các số này ở chỗ khác; đọc qua `services/ops_thresholds.py::get()` (cache 60 giây) và `GET /admin/settings/thresholds`.

| Khoá | Nhãn · mốc tính | Mặc định | Khoảng |
|---|---|---|---|
| `order_confirm_hours` | Đơn đăng ký chờ xác nhận · từ lúc học viên báo đã chuyển | 24 giờ | 1–168 |
| `writing_review_hours` | Bài Writing chờ giáo viên duyệt (lớp offline) · từ lúc AI chấm xong (bài AI lỗi: từ lúc nộp) | 48 giờ | 1–336 |
| `regrade_hours` | Yêu cầu chấm lại · từ lúc học viên gửi | 48 giờ | 1–336 |
| `speaking_mock_hours` | Bài Speaking thi thử chờ chấm · từ lúc thí sinh nộp bài | 72 giờ | 1–336 |
| `incident_unclaimed_hours` | Sự cố chưa có người nhận | 24 giờ | 1–168 |
| `feedback_unanswered_hours` | Phản hồi học viên chưa trả lời | 72 giờ | 1–336 |
| `late_streak_count` | Trễ bài liên tiếp | 2 bài | 1–20 |
| `inactive_days` | Không hoạt động | 7 ngày | 1–90 |
| `course_expiring_days` | Quyền khoá sắp hết | 7 ngày | 1–90 |
| `low_credits` | Sắp hết lượt chấm AI | 3 lượt | 0–100 |
| `code_expiring_days` | Mã kích hoạt chưa dùng sắp hết hạn | 14 ngày | 1–90 |
| `exam_idle_minutes` | Thí sinh đứng yên (phòng live) | 5 phút | 1–60 |
| `audio_retention_days` | Giữ bản ghi âm Speaking · từ lúc ghi (đã chốt tối đa 60) — dòng **chỉ đọc** (`fixed: true`): API đọc từ cấu hình G04 `RETENTION_AUDIO_DAYS`, **không** lưu trong `ops_thresholds`, `PATCH` gửi khoá này → 422 | theo cấu hình G04 (tối đa 60) | cố định |
| `content_retention_after_expiry_days` | Giữ bài làm sau khi khoá hết hạn (chốt ở điểm 23) — dòng **chỉ đọc** (`fixed: true`): API đọc từ cấu hình G04 `RETENTION_CONTENT_DAYS_AFTER_EXPIRY`, **không** lưu trong `ops_thresholds`, `PATCH` gửi khoá này → 422 | 45 ngày | cố định |
| `import_error_report_days` | Giữ báo cáo lỗi nhập liệu | 30 ngày | 7–365 |
| `too_fast_sec_per_question` | Làm quá nhanh (kết quả bài giao) — **chưa có trên tờ** | `null` (tắt lý do) | 1–60 |
| `many_retakes_count` | Làm lại nhiều lần — **chưa có trên tờ** | `null` (tắt lý do) | 2–20 |
| `stalled_hours` | Bỏ dở (đang dùng cờ `course_stalled` 24 giờ sẵn có) | 24 giờ | 1–168 |
| `lesson_review_pct` | "Cần ôn" theo buổi (tờ ghi dưới 60%) | 60 % | 1–100 |
| `survey_min_respondents` | Số người trả lời tối thiểu để hiện phần trăm và trung bình khảo sát (sửa 18/11 theo GOI-13) | 5 người | 1–100 |
| `survey_remaining_sessions` | Lớp sắp kết thúc khoá mà chưa có khảo sát · số buổi còn lại — repo chưa có dữ liệu buổi học (sửa 18/11 theo GOI-13) | `null` (ẩn dòng) | 1–50 |
| `band_dist_min_papers` | Số bài tối thiểu để hiện phân bố band — **chưa có trên tờ** | `null` (không hiện phân bố) | 1–50 |
| `score_gap_review_band` | Độ lệch AI–giáo viên cần xem lại (GOI-12, chỉ nạp khi phần đó được mở) | 1.0 band | 0.5–3.0 |
| `score_gap_publish_min_papers` | Số bài tối thiểu để công bố độ lệch (GOI-12, chỉ nạp khi phần đó được mở) | 50 bài | 10–1000 |
| `score_gap_publish_max_mean` | Độ lệch trung bình tối đa để công bố (GOI-12, chỉ nạp khi phần đó được mở) | 0.5 band | 0.1–2.0 |
| `score_gap_row_min_papers` | Số bài tối thiểu cho một dòng bảng độ lệch (GOI-12, chỉ nạp khi phần đó được mở) | 30 bài | 5–500 |
| `report_min_group_size` | Cỡ nhóm tối thiểu để hiện số liệu báo cáo (GOI-12, chỉ nạp khi phần đó được mở) | 10 người | khoảng do anh Andy chọn |
| `review_pack_due_soon_hours` | Bài gói giáo viên chấm sắp tới hạn (GOI-12, chỉ nạp khi phần đó được mở) | 12 giờ | — |
| `review_pack_on_time_min_pct` | Tỉ lệ trả đúng hạn tối thiểu của gói giáo viên chấm (GOI-12, chỉ nạp khi phần đó được mở) | 90 % | — |

Ngưỡng `null` = lý do/khối tương ứng không bật cho tới khi chủ dự án điền; không tự chọn số. `audio_retention_days` chỉ hiển thị giá trị `RETENTION_AUDIO_DAYS` của G04 (GOI-04 mục 5.10, 5.14); job dọn bản ghi âm thuộc G04-T10 — G09 không viết job xoá. Hiện trạng ở `c3bc71574`: `backend/services/retention.py` dòng 28–29 ghi cứng `RETENTION_AUDIO_DAYS = 15`, `RETENTION_CONTENT_DAYS = 60`; việc đổi sang 60 ngày cho bản ghi âm và 45 ngày sau khi khoá hết hạn cho bài làm là của G04.

### 5.7 Component frontend (đặt trong `frontend/components/admin/`; thành phần chung G03 ở `components/ui/`)

| Component | Props chính | Trạng thái phải có |
|---|---|---|
| `AdminFrame` | `role: 'admin'\|'instructor'`, `environment`, `children` | đang tải quyền, bị từ chối, sẵn sàng; sidebar mở/thu/biểu tượng/ngăn kéo; sáng/tối |
| `AdminSidebar` | `groups`, `match`, `counts` | nhóm thu có badge; mục hiện tại; mục `available:false` |
| `AdminCommandPalette` | `scope` | rỗng, đang tìm, không thấy, lỗi mạng |
| `RecordPage` | `breadcrumb`, `title`, `meta`, `actions`, `tabs` | thẻ qua `?tab=` |
| `DangerZone` | `items: [{label, description, impactText, confirmPhrase?, reasonRequired?, onConfirm}]` | hộp xác nhận, gõ chuỗi, đang gửi, lỗi, cần step-up |
| `LearnerSummary` | `summary`, `actions` | đủ 7 trường; "chưa có bài", "chưa đặt" |
| `AssignDrawer` | `cohortId?`, `lessonId?`, `preselect?: {studentIds?, contentId?}`, `onDone` | chọn lớp; trùng (lớp, bài); bài kiểm tra hiện chế độ trả điểm; đã giao |
| `LegacyClassCreditsDialog` (T43; chưa có tờ thiết kế riêng, dựng từ hộp xác nhận của "Cấp thêm lượt") | `cohortId`, `onDone` | đang tải xem trước; không còn ai cần cấp ("Lớp này đã đo lượt"); nhập số lượt (trống, không hợp lệ); xác nhận; đang gửi; kết quả có danh sách bỏ qua; lỗi; cần step-up |
| `ThresholdsProvider` + `useThreshold(key)` | — | đang tải (không tô "quá hạn" khi chưa có ngưỡng), lỗi |
| `QueueRow` | `label`, `q: Q`, `href` | có việc, "Không có", lỗi nguồn + tải lại riêng, quá hạn |
| `AssignmentResultPage` (5 khối) | `cohortId`, `assignmentId` | chưa ai nộp (chỉ khối 1), mỗi khối một khung chờ, lỗi một khối |
| `ReleaseBoard` | `cohortId`, `assignmentId` | có/không dòng chọn; hộp hỏi lại; hẹn giờ |
| `ExamWizard`, `ExamRecord` (7 thẻ), `ProctorBar`, `ExamAnalysis`, `ExamRelease` | `examId` | theo ghi chú tờ AdminKyThi, AdminKyThiChiTiet |
| `ContentSkillPage` (4 thẻ), `BatchList`, `ReviewQueue`, `HiddenImportBanner` | `skill` | rỗng, đang tải, lỗi từng thẻ |
| `LearnerDirectory`, `LearnerRecord`, `CareNotes`, `EnrollmentQueue`, `EnrollmentDetail`, `CreditLedger`, `CodeLookup`, `IncidentInbox`, `SettingsPage`, `ReportsPage` | — | rỗng, đang tải, lỗi, một phần nguồn lỗi |

### 5.8 Cờ cấu hình và nhật ký

- `ADMIN_FRAME_V2` (biến môi trường build frontend): `1` → khung mới. Bật ở preview/staging, tắt ở production tới khi anh Andy duyệt (Q6). Đường lui của T08.
- Runtime flag (qua `services/runtime_flags.py`, mặc định tắt): `mock_exam_audiences` (T31: tắt → `admin_live_monitor` đọc roster theo `cohort_id` như cũ), `assignment_result_v2` (T27/T28: tắt → trang lớp dùng ba tab cũ), `content_import_batches` (T36), `mock_partial_release` (T33: tắt → `release` từ chối `include_partial`).
- Cờ của gói khác mà G09 đọc: `mock_exam_audiences_learner` (G08-T22: cổng học viên đọc bảng người dự thi và áp quy tắc chạy liền các phần; tắt → `schedule` từ chối kỳ live nhiều nguồn, T31), `credit_metering` (G04: bật đo lượt ở đường chấm; nhãn "Chưa chuyển sang đo lượt" và thao tác T43 **không** phụ thuộc cờ này — chuyển lớp cũ làm được trước khi bật đo).
- Env: `CARE_NOTE_EDIT_HOURS` (mặc định 24, Q16), `REVIEW_SOFT_LOCK_MINUTES` (mặc định 30, Q19), `MOCK_SELF_PACED_GAP_SECONDS` (mặc định 0 = phần kế bắt đầu ngay; Q31).
- Sự kiện log backend (logger, không bảng mới): `admin_search` (độ dài q, số kết quả, không ghi q), `hidden_import_opened` (route, actor id), `incident_group_action`, `assignment_remind` (số người).

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`. Mọi giao diện mới sau cờ `ADMIN_FRAME_V2` (tắt ở production); migration staging trước dưới khoá advisory.

## Verification strategy

Lệnh bắt buộc mỗi PR theo tầng và cách báo cáo ở gói mục 9:

Môi trường: preview Vercel của nhánh + backend staging. Tài khoản: QA admin có TOTP; hai tài khoản giáo viên kiểm thử (A dạy lớp kiểm thử 1, B dạy lớp kiểm thử 2); ba học viên kiểm thử `@staging-e2e.averlearning.com` (một có tài khoản + hồ sơ ở lớp 1, một chỉ có hồ sơ, một ở lớp 2). Dữ liệu: một bài giao Course 1 chấm máy có bài nộp, một đề giữa kỳ chế độ "giáo viên công bố", một kỳ thi kiểm thử live và một kỳ tự làm hai phần, một đơn kiểm thử và một đơn đăng ký lại (sau G04), một lớp kiểm thử có thành viên dùng mã cũ không kèm lượt. Không dùng production cho bất kỳ bước nào; không chép dữ liệu học viên thật.
Lệnh bắt buộc mỗi PR (theo tầng): `cd backend && python -m pytest tests/ -q`; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`; `npm --prefix frontend run test:react`; `cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build`; `node frontend/tooling/route-ownership-check.mjs`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Gói chỉ được báo "xong" khi 14 kịch bản ở mục Acceptance scenarios của spec này (số gốc 1–9, 18–21, 23; các số còn lại của gói thuộc 0085–0087) có bằng chứng trên staging (đã merge vào `staging`), không phải chỉ trên preview nhánh. Kịch bản phụ thuộc gói khác chưa xong ghi "chưa chạy được" kèm tên gói, không tính là đạt. Lên production và bật `ADMIN_FRAME_V2` ở production là bước riêng, chờ anh Andy.
