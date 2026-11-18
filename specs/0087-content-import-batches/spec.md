---
id: CONTENTBATCH-0087
title: Admins see every content import script run as a read-only batch and work one review queue per question on the four-tab content pages
status: draft
risk: high
owner: product
---

# Admins see every content import script run as a read-only batch and work one review queue per question on the four-tab content pages

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G09-T21` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-09-admin-va-giao-vien.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; migration trong dải G09 (440–459).

## Tóm tắt (tiếng Việt)

Phần của GOI-09 tách thành spec riêng ở G09-T21 vì có migration và hành vi riêng cần duyệt riêng. Tóm tắt cả gói ở ADMINIA-0074; phạm vi của spec này là các FR dưới đây.

## Quyết định đã có

19. **Admin (17/11/2026):** các tờ admin dùng một sidebar, một bảng ngưỡng cảnh báo (Cài đặt), một thành phần giao bài, một bộ dữ liệu mẫu — bản chuẩn ở `thiet-ke/CHUAN-ADMIN.md`. Trang nhập nội dung thủ công bị ẩn khỏi sidebar; nội dung nhập qua script backend. Trả kết quả thi thử chỉ ở thẻ "Trả kết quả" của trang kỳ thi.
23. **Quyết định ngày 18/11/2026 (đợt chiều) của anh Andy — thắng các điểm trước nếu khác:**
    - Mỗi lớp chỉ có MỘT giáo viên (hiện tại là anh Andy).
    - Lượt chấm chưa dùng: THAY quy tắc "chuyển 50%". Nếu người học đăng ký lại (không huỷ) thì chuyển TOÀN BỘ lượt chưa dùng sang, bảo lưu tối đa 2 tháng. Nếu không đăng ký lại thì khi khoá hết hạn số lượt còn lại hết hiệu lực. (Cách hiểu của người viết: "huỷ gói" = không đăng ký lại; cần anh xác nhận nếu ý khác.)
    - Lớp đang chạy bằng mã cũ: CÓ chuyển sang đo lượt.
    - Mock test "làm trong khoảng thời gian": KHÔNG được nghỉ giữa các phần; đã bắt đầu thì làm liền các phần.
    - Bài làm giữ 45 ngày sau khi khoá hết hạn.
    - Gửi thư: dùng dịch vụ đã có trong repo (Resend, hiện mới dùng cho thư báo chủ dự án: `backend/services/owner_alerts.py`, biến `RESEND_API_KEY`). Còn cần: địa chỉ gửi cho thư học viên (tên miền đã xác minh).
    - Full test Writing tốn 2 lượt (mỗi task một lượt): đã xác nhận.
    - Kiến thức nền theo chủ đề: MỞ CÔNG KHAI (thuộc Thư viện); đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt.
    - Đọc kỹ: gắn theo 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau.
    - Nhận xét học viên: hiện cả ở trang sáu khoá online, KHÔNG ghi là của lớp offline; khi nào khoá online có nhận xét riêng thì mới tách.
    - Thực thi: giao cho project Claude Code của repo averlearning.com (không phải đội Grok). Tên thư mục AVER-GROK giữ nguyên.
    - Bốn chỗ đã vẽ mà chưa có dữ liệu ("Lỗi đang lặp lại", "Lần đăng nhập gần đây", "Đổi email đăng nhập", thư "khoá đã mở đăng ký"): THÊM vào gói.
    - Ba prototype (kiến thức nền, đọc kỹ, khuôn luyện đề) và sáu hướng phát triển (sổ lỗi cá nhân, viết lại sau khi chấm, độ lệch AI–giáo viên, kiểm tra đầu vào, nhắc việc và thư tổng kết tuần, gói giáo viên chấm): làm thiết kế và spec.
    - Rà 19 bộ bài mẫu và vẽ hình 3 bộ Task 1: để bên thực thi làm (G06).

## Problem

### 2.6 Nội dung: trang nhập thủ công và script tương ứng

Mọi script dưới đây có trong `backend/scripts/` (đã kiểm tên file).

| Trang (route) | API tải lên | Script backend làm cùng việc | Xử lý trong gói |
|---|---|---|---|
| `/admin/listening/import-drills` | `POST /admin/listening/drills/import` (+`/commit`) (`routers/listening.py` 3611, 3663) | `import_skill_drills.py`, `import_listening_content_package.py` | **Ẩn** khỏi sidebar |
| `/admin/listening/import-fulltest` | `POST /admin/listening/import-fulltest` (+`/commit`) (3101, 3150) | `import_listening_lessons.py`, `import_listening_content_package.py`, `import_cambridge_canonical_qa.py`, `upload_listening_source_audio.py` | **Ẩn** |
| `/admin/listening/tests/[testId]` (tải audio, ảnh map) | `/tests/{id}/audio/...`, `/exercises/{id}/upload-map-image` (`listening.py`) | `upload_listening_source_audio.py`, `upload_listening_source_figures.py`, `migrate_legacy_audio_urls.py` | Giữ trang xem; **ẩn điều khiển tải audio**; giữ sửa ảnh lẻ |
| `/admin/vocab/quiz` (nhập bank quiz, cả ngữ pháp và course) | `POST /admin/quiz/import` (`routers/admin_quiz.py` 147) | `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py` | **Ẩn phần nhập**; giữ danh sách bank và xem trước |
| `/admin/vocab/content` | `POST /admin/vocabulary/import` (`routers/admin_vocab.py` 133) | `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `migrate_vocab_to_cards.py` | **Ẩn nhập**; giữ sửa lẻ |
| `/admin/reading/content` | `POST /admin/reading/content/import`, `/import-bundle` (`routers/admin_reading.py` 378, 491) | `import_reading_drills.py`, `reimport_wp5_reading.py`, `import_ilr_rdg_001.py`, `import_cambridge_canonical_qa.py` | **Ẩn nhập**; giữ khoá/chia sẻ/đăng |
| Đề exam module cũ | `POST /admin/exams/import` (`routers/admin_exams.py` 45) | `seed_exams.py` | **Ẩn** |
| `/admin/writing/tips` (nhập nhiều mẹo từ file) | `POST …/content/import` (`routers/admin_writing_tips.py` 238) | chưa có script | **Ẩn nút nhập nhiều**; giữ soạn lẻ; giữ API |
| `/admin/writing/prompts` | `POST /admin/writing/prompts`, `/upload-image` | `import_writing_prompts.py`, `migrate_writing_images.py` | Giữ tạo/sửa lẻ và ảnh lẻ |
| `/admin/speaking/topics` | API JSON topics | `import_speaking_bank_admin.py`, `import_speaking_lesson_sets.py`, `pregen_speaking_question_audio.py` | Giữ bật/tắt, sửa lẻ |
| `/admin/reading/preview` | `POST /admin/reading/questions/{id}/upload-diagram-image` | — | Giữ (sửa ảnh lẻ) |
| `/admin/students` (CSV học viên) | `POST /admin/students/import` | — | **Giữ**, dời vào Danh bạ |
| `/admin/writing/new` (OCR) | `POST /admin/writing/extract-text` | — | **Giữ**, mở từ Chấm bài › Writing |

Chưa script nào ghi "bản ghi lô". Trạng thái, cấp lớp, hiển thị của đề quản lý qua `routers/admin_exam_content.py` (`/admin/exam-content/{kind}/{id}/visibility|status|level|cohorts`). Báo lỗi câu của học viên: `user_feedback` (mig 100, chỉ Reading/Listening). Tỉ lệ sai theo câu của quiz: RPC `quiz_item_error_rates` (mig 121).

## Scope

Các FR ở mục Requirements, migration và API ở `plan.md`, nhiệm vụ ở `tasks.md`.

## Non-goals

Mọi phần khác của GOI-09 (khung, danh bạ, hồ sơ, đơn, lượt, chấm bài, sự cố, báo cáo) thuộc ADMINIA-0074. Không viết mã trong PR spec. Không lấy số migration ngoài dải G09.

## Users and journeys

- Admin (anh Andy, hiện cũng là giáo viên duy nhất của mỗi lớp): làm việc hằng ngày từ `/admin`.
- Giáo viên của lớp (một lớp đúng một giáo viên, `cohorts.instructor_id`): chỉ thấy lớp mình qua `services/staff_scope.py`.
- Học viên: thấy kết quả do các thao tác admin sinh ra (giao bài, trả kết quả, công bố điểm) ở màn học viên của G07/G08.

## Requirements

Đánh số theo gói (FR-09-NNN → FR-NNN, giữ nguyên số; số không liên tục vì gói chia dải theo nhóm).

**Nội dung và báo cáo**
- **FR-160:** Mỗi kỹ năng một trang (`/admin/listening`, `/admin/reading`, `/admin/writing`, `/admin/speaking`, `/admin/vocab`, `/admin/grammar`) với 4 thẻ `?tab=items|programs|batches|review`: Đề và bài · Chương trình và bộ · Lô nhập · Câu cần kiểm.
- **FR-161:** Không có nút chính "Tạo đề" ở Listening, Reading, Từ vựng, Ngữ pháp; "Tạo đề lẻ" / "Tạo mẹo lẻ" (Writing), "Tạo chủ đề lẻ" (Speaking) là nút phụ. Không có điều khiển tải audio, video hay ô chọn file nhập hàng loạt.
- **FR-162:** Thẻ Lô nhập chỉ đọc: mỗi lần script chạy một dòng (thời điểm, người chạy, tên đọc được của script, môi trường, chạy thử hay nhập, số tạo / cập nhật / lỗi, trạng thái, "Xem các mục của lô", tải báo cáo lỗi). Trạng thái rỗng: "Chưa có lô nào. Nội dung nhập bằng script trên máy chủ."
- **FR-163:** Thẻ Câu cần kiểm: một hàng chờ theo câu (mỗi câu một dòng dù nhiều lý do); trạng thái: Câu cần kiểm → Đã kiểm (ghi người, lúc) hoặc Đã sửa ở bản N. Báo cáo › Chất lượng nội dung và Hộp thư sự cố chỉ hiện số và link về thẻ này.

## Acceptance scenarios

Kịch bản của gói (mục 9), giữ số gốc. Môi trường: preview Vercel của nhánh + backend staging, tài khoản QA admin có TOTP.

1. Given script nhập Listening chạy `--dry-run` rồi chạy thật trên staging qua helper của G09-T36, When admin mở `/admin/listening?tab=batches`, Then thấy hai dòng (chạy thử, nhập) với thời điểm, người chạy, tên đọc được của script, môi trường, số tạo/cập nhật/lỗi; không có nút sửa hay xoá lô.
2. Given lô có lỗi, When bấm "Tải báo cáo lỗi", Then nhận file `.csv` của đúng lô đó; lô không lỗi không có nút.
3. Given một câu Reading vừa bị học viên báo và có tỉ lệ sai cao, When mở thẻ Câu cần kiểm, Then câu đó chỉ có **một** dòng kèm hai lý do; When admin đánh dấu "Đã kiểm", Then dòng ghi người và thời điểm, rời hàng "Câu cần kiểm"; tải lại trang vẫn thấy trạng thái đó.
4. Given admin mở `/admin/vocab`, When xem đầu trang, Then không có nút chính "Tạo đề"; trang nhập thủ công chỉ mở bằng đường dẫn và có dải cảnh báo "Trang nhập thủ công đã ẩn…" (FR-013 của ADMINIA-0074).

(Gói không có kịch bản đánh số cho phần này; bốn kịch bản trên soạn từ FR-160…FR-163 và mục 5.3, 5.4.)

## Edge cases

Ca biên phải có test tự động: gán giáo viên cho lớp bằng người không phải nhân sự → 422; lớp `instructor_id` NULL → giáo viên nào gọi cũng 404; `self_paced_timeline` không bao giờ trả trạng thái giữa hai phần sau khi đã bắt đầu; cộng giờ cho phần không chạy của kỳ tự làm → 409; `classes_unmetered` khi G04 chưa có → `unavailable`, không phải 0; G04 không trả lượt chuyển → dòng lượt chuyển ẩn; `ref` sai định dạng → 404; q tìm kiếm 1 ký tự → 422; nguồn tổng hợp lỗi → 200 + `sources_failed`; ngưỡng ngoài khoảng → 422; ngưỡng `null` → lý do tương ứng không bật; nhắc lần hai trong ngày → bỏ qua; nhóm sự cố có dòng mới khi xử lý → 409; xác nhận gõ sai chuỗi → nút không bật; step-up hết hạn → dialog rồi gửi lại; kỳ thi không có kỹ năng nào → 422; tên chế độ cũ gửi vào API admin được ánh xạ; ghi lô lỗi không làm hỏng script nhập.

## Success criteria

- Mọi kịch bản ở trên có bằng chứng trên `staging` (đã merge), không chỉ preview nhánh (gói mục 9).
- Admin thấy dữ liệu gốc của backend, kể cả lỗi tra cứu và trạng thái dở dang; không trạng thái lạc quan (constitution mục 5).

## Related specifications

- ADMINIA-0074: trang nhập thủ công bị ẩn (FR-013), sidebar nhóm Nội dung.
- LIBRARY-0061 (G06): script nhập Thư viện ghi bản ghi lô qua helper của G09-T36 (phân xử 21).
- LISTENING-0007, REVEXPLAIN-0022, GRAMMARAUDIT-0019: luồng sửa nội dung có phiên bản; "Đã sửa" ở hàng Câu cần kiểm trỏ tới phiên bản đó, không sửa nội dung tại chỗ.
- COURSETESTRELEASE-0082: tỉ lệ sai theo câu dùng cùng nguồn dữ liệu bài làm nhưng không đọc đáp án học viên chưa được công bố.

## Open questions

Câu hỏi của gói (mục 10) liên quan; mỗi câu có mặc định tạm người thực thi dùng tới khi anh Andy trả lời.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| Q22 | (a) Tác vụ "tính lại điểm cho bài đã nộp khi đăng bản đổi đáp án"; tỉ lệ sai theo câu Listening/Reading toàn kho; lưu `lesson_primary`; tách mã ngộ nhận — làm ở gói nào? (b) Mục do script tạo/cập nhật mặc định vào "Chờ duyệt" (tờ đề xuất; hiện nhiều script đăng thẳng) | (a) gói sau, sau khi 0043 có mã; (b) có, áp cho lần nhập mới | (a) không làm; (b) không đổi hành vi script |
