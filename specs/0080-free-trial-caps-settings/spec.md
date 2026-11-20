---
id: TRIALCAP-0080
title: Free trial grading stops at configurable per-person, per-day and site-wide daily cost caps that admins change and pause from Settings with an audit log
status: draft
risk: high
owner: product
---

# Free trial grading stops at configurable per-person, per-day and site-wide daily cost caps that admins change and pause from Settings with an audit log

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G11-T02` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-11-bo-sung-quyet-dinh-20261117.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; migration 471 (phụ thuộc 371 của 0047 và 440 của G09) trong dải GOI-11 (470–479).

## Tóm tắt (tiếng Việt)

GOI-11 phần B. Tóm tắt cả gói (mục 1):

**Mục tiêu (người dùng thấy gì).**
- (A) Học viên thấy chuông thông báo trên thanh điều hướng (máy tính, máy tính bảng, điện thoại): bài mới được giao, nhắc nhở của giáo viên, bài sắp đến hạn, bài đã có kết quả, kết quả bài kiểm tra của khoá đã công bố, khoá sắp hết hạn hoặc đã hết hạn (nút "Đăng ký lại"), đơn đăng ký đổi trạng thái. Cạnh chuông có thẻ cảnh báo "N quá hạn" đếm **tổng số bài đã quá hạn chưa nộp**, không phụ thuộc đã đọc. Giáo viên và admin gửi được thông báo cho lớp hoặc nhóm học viên.
- (B) Người có tài khoản miễn phí (đăng nhập bằng Google hoặc mã email 6 số), chưa từng có khoá online, được AI chấm thử Writing Task 1, Task 2 và Speaking Part 2 với các trần do admin đặt ở trang Cài đặt: hạn mức tổng mỗi người (theo email và IP), trần mỗi ngày mỗi người, trần chi phí mỗi ngày toàn web; có công tắc tạm dừng. Lối vào ở trang chủ và menu công khai do G05-T21 dựng.
- (C) Về đơn đăng ký, học viên nhận đúng bốn thư: đã tạo đơn, một thư nhắc trước hạn giữ đơn, đơn cần bổ sung hoặc chưa tìm thấy khoản chuyển, khoá đã mở. Huỷ, hết hạn, báo đã chuyển chỉ là thông báo trong ứng dụng. **Việc gửi bốn thư thuộc G04** (GOI-04 mục 5.11, 5.12; migration 381/382); gói này chỉ sinh thông báo trong ứng dụng từ sự kiện đơn (phần A).
- (D) Mở full test (full test từng kỹ năng, mock test được giao, kỳ thi xếp lịch) trên điện thoại (vùng nhìn hẹp hơn ngưỡng, mặc định 768px) thấy màn cảnh báo tiếng Anh kèm một dòng phụ tiếng Việt và không có lượt thi nào được tạo; tablet vẫn vào; **mini test và luyện từng phần vẫn làm được trên điện thoại**.
- (E) Bài kiểm tra giữa kỳ, cuối kỳ của khoá có hai chế độ trả điểm: "trả ngay" hoặc "giáo viên công bố"; ở chế độ công bố, máy chủ không trả điểm hay đáp án cho học viên trước khi giáo viên công bố; giáo viên công bố cho cả lớp, từng người, theo mức hiển thị, hoặc hẹn giờ; học viên nhận thông báo. Kết quả là số câu đúng, không phải band.
- (F) Sáu khoá online mang đúng tên đã chốt; nhãn khoá hết hạn là "Đăng ký lại" ở mọi nơi, lấy từ một nguồn.
- (G) Logo "Ấn ký", favicon, icon ứng dụng, manifest, ảnh chia sẻ liên kết mới; bộ 94 icon nét đơn thay emoji; bài Grammar Wiki hiển thị sơ đồ câu dựng từ khối Markdown có ngữ nghĩa. Minh hoạ của web là **sơ đồ câu chữ**, không dùng tranh khắc hay ảnh minh hoạ (00 mục 2 điểm 22).

**Lớp thay đổi và mã spec đề xuất.** Số spec trong `specs/` hiện lớn nhất là `0054`; `01-KE-HOACH-TONG.md` mục 6 đã cấp 0055–0078. Gói này đề xuất 0079–0084 (người thực thi kiểm lại ở G11-T01 bước 1 trước khi dùng):

| Phần | Mã spec | Thư mục | Lớp |
|---|---|---|---|
| A | `NOTIFY-0079` | `specs/0079-learner-notifications/` | high-risk (migration, RLS, gửi thư) |
| B | `TRIALCAP-0080` | `specs/0080-free-trial-caps-settings/` (sửa đổi FREETRIAL-0047) | high-risk (hành vi AI trả phí, migration) |
| C | không có spec riêng và **không còn nhiệm vụ ở gói này**: bốn thư đã nằm trong `COURSEACCESS-0055` (G04); câu chữ và bản HTML ở `ENROLL-0060` (G05-T14) | — | — |
| D | `PHONEGATE-0081` | `specs/0081-full-test-phone-gate/` | feature |
| E | `COURSETESTRELEASE-0082` | `specs/0082-course-test-result-release/` | high-risk (lưu kết quả, kết thúc bài, migration, RLS) |
| F | không spec | — | content |
| G1 | `BRANDMARK-0083` | `specs/0083-brand-mark-ank-ky/` | feature |
| G2 | không spec mới: sửa đổi `UIBASE-0056` (G03) phần bộ icon | trong thư mục G03 | feature |
| G3 | `GRAMMARFIG-0084` | `specs/0084-grammar-wiki-figures/` | feature |

**Dải số migration.** `backend/migrations/README.md` dòng 23 ghi "As of 2026-11-12 the highest is `380`". `01-KE-HOACH-TONG.md` mục 6 cấp 381–469 cho G04…G09 và để "dự phòng: 470 trở đi". Gói này lấy **470–479**: 470 (A), 471 (B), 472 **không dùng** (CHECK mẫu thư, RPC nhắc và bốn thư đơn đã nằm trong 381/382 của G04; số 472 để trống, không cấp lại cho việc khác trong gói), 473 (E lược đồ), 474 (E hàm công bố), 475 (E nộp trễ), 476 (E làm bù/làm lại; 475 và 476 hoãn cùng G11-T25, T26), 477–479 để dành cho gói. Anh Andy là người duy nhất vận hành repo; số lấy theo bảng ở `01-KE-HOACH-TONG.md` mục 6, người thực thi ghi số đã dùng vào sổ đăng ký trong repo, không tự nhảy số.

**Phụ thuộc và song song.**

| Phần | Phải xong trước | Chạy song song được với |
|---|---|---|
| A backend (T08–T10) | spec T01 duyệt | mọi gói; producer đơn và khoá hết hạn tự bỏ qua khi bảng G04 chưa có |
| A giao diện (T11) | G03 `LearnerShell` (G03-T1x), cờ `learner_v2` G07-T05 | G05, G06, G08 |
| A thư (T12), gửi của nhân sự (T13) | G04-T01 (`learner_email_outbox`, CHECK đã có ba mẫu của A), G04-T04 (dispatcher); G09-T08 (khung admin) và G09-T24 (`services/staff_scope.py`) cho T13 | — |
| B | FREETRIAL-0047 các task T001… (route `/api/trial/*`, migration 371); G04-T03 (`entitlements.has_ever_had_online_course`) cho điều kiện loại người từng có khoá online; G05-T18 (đăng nhập bằng mã email) để kiểm ca tài khoản mã email | A, D, E, F, G; lối vào trên trang công khai là G05-T21 |
| C | không còn nhiệm vụ (G04-T01, T02, T04 làm; G05-T14 hoàn thiện câu chữ) | — |
| D | không; phần nối phòng thi mới cần G08-T03 (khung `ExamRoom`) | mọi phần |
| E backend | spec T04 duyệt; nên sau SERVERCHECK-0046 (draft) nếu 0046 được làm trước | A, B, C, D, F, G |
| E giao diện (chỉ còn màn học viên, T27) | G03, G07-T15 (Lộ trình). Bảng công bố phía giáo viên: G09-T30, chạy sau T23 của gói này | — |
| F | G04-T05 (API admin sản phẩm khoá) cho phần dữ liệu | mọi phần |
| G1 logo, G3 sơ đồ | không | mọi phần; G3 xếp hàng sau các PR Grammar của G06-T1x đụng cùng file |
| G2 icon | thay G03-T03 (cùng phạm vi) | — |

**Ước lượng (giả định).** 36 mã nhiệm vụ (thêm T14a tối 18/11 theo rà soát chéo), trong đó 3 ĐÃ BỎ (T07, T18, T28) và 2 hoãn theo trả lời câu 16 (T25, T26). Còn hiệu lực đợt đầu: **31 nhiệm vụ = 32 PR, khoảng 42 phiên agent** (cộng lại từ bảng mục 6; bản 17/11 ghi tổng 46 phiên cho 35 nhiệm vụ nhưng cột Phiên cộng ra 45); nếu anh Andy mở lại T25, T26 thì thêm 2 PR và 3 phiên. Độ khó tổng 4/5: phần E là 5 vì động vào đường chấm, kết thúc bài có giờ và quyền đọc trực tiếp bảng đáp án; phần B là 5 ở migration vì sửa hàm giữ chỗ của 0047 có khoá đồng thời. Số phiên của T14, T15 lập trước khi có trả lời về trần theo task, theo IP và theo chi phí (mục 5.2.1) và **chưa được ước lượng lại**. Giả định: một phiên ≈ một nhiệm vụ kèm test; G03, G04 đã có các nhiệm vụ nêu ở bảng trên khi tới phần giao diện; không tính thời gian chờ duyệt và chờ merge. Đây là ước lượng sau khi đọc mã, chưa có số đo; ước lượng, không phải cam kết.

## Quyết định đã có

Chép nguyên văn `00-QUY-UOC-CHUNG.md` mục 2 và câu trả lời của anh Andy ngày 17/11/2026 (gói mục 10):

11. **Chấm thử miễn phí (chốt 17/11/2026):** người dùng mới có tài khoản miễn phí, chưa đăng ký khoá, được chủ động làm thử hoặc gửi bài để AI chấm ở Writing và Speaking, số lượng hạn chế. Ba trần đều là cấu hình: hạn mức mỗi người, trần mỗi ngày cho mỗi người, trần mỗi ngày cho toàn web. Số đã chốt: mỗi người mỗi ngày 1 bài Writing Task 1 + 1 bài Task 2 và 2 bài Speaking Part 2; toàn web 5 USD chi phí chấm mỗi ngày; hạn mức tổng mỗi người suốt chương trình: 10 bài Writing (5 Task 1 + 5 Task 2) và 10 bài Speaking Part 2, tính theo email và địa chỉ IP. Người từng có khoá online (kể cả đã hết hạn) không được chấm thử. Có công tắc tạm dừng. Mục đích: lấy lượt truy cập và thử web với nhiều kiểu người dùng.
22. **Quyết định ngày 18/11/2026 của anh Andy:**
    - Thực hiện: người thực thi (nay là project Claude Code của repo — điểm 23) làm trước; khi anh Andy báo sẵn sàng thì chuẩn bị bàn giao; sau đó có giám sát tiến độ và tiếp quản nếu cần.
    - Vận hành repo: chỉ có anh Andy. "Leader" trong tài liệu migration của repo chính là anh Andy; số spec và số migration lấy theo bảng ở 01-KE-HOACH-TONG mục 6.
    - Đơn vị lượt chấm Speaking: 1 lượt = 1 bài Part 2, hoặc 1 cụm Part 1 gồm 2–3 câu. (Part 3 tính như Part 1 — đã chốt qua ví dụ full test Speaking mô phỏng, xem gạch cuối điểm này.) Writing: 1 bài = 1 lượt.
    - Phòng thi: chế độ thi không có nút tạm dừng bài nghe (luyện từng phần thì có); full test không có "Save and exit", thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test".
    - Mã kích hoạt: lỗi gộp một câu chung, thêm hai câu riêng an toàn ("Bạn đã có khoá này", "Bạn đã dùng mã này rồi"); giới hạn 5 lần thử trong 15 phút.
    - Đề công khai học viên tự chọn: chỉ có full test TỪNG KỸ NĂNG và mini test, làm lúc nào cũng được, làm lại được; không có full test 4 kỹ năng một mạch. Mock test nhiều kỹ năng CHỈ có khi admin/giáo viên giao (live cùng giờ, hoặc tự bắt đầu trong khoảng thời gian được mở, các phần chạy liền nhau, không nghỉ giữa các phần (điểm 23), làm một lần). Overall band chỉ có ở mock test được giao.
    - Bản ghi âm dùng để cải thiện chấm bài: ĐÃ BỎ khỏi đợt này (anh Andy, 18/11/2026: không nhất thiết phải làm, bỏ ra để tránh vấn đề pháp lý). Không có ô hỏi, không có công tắc, không có API. Bản ghi âm chỉ giữ tối đa 60 ngày rồi xoá. Nếu sau này làm lại thì là lựa chọn tự bật và có rà pháp lý trước.
    - Chấm thử bị chặn vì dùng chung IP: có lối đi cho người dùng (màn bị chặn nêu lý do và cách liên hệ/xác minh). Màn ngoài bài thi của full test (chặn điện thoại, lỗi thiết bị): thêm dòng phụ tiếng Việt.
    - Bốn khoản: gỡ hai trang chẩn đoán (`/next-probe`, `/recorder-spike`) khỏi bản chạy thật, `/exam` chuyển hướng về Thi thử; công cụ nội bộ admin dùng khuôn bảng; vẽ ba trang admin ở 1024px; minh hoạ của web là sơ đồ câu chữ, không dùng tranh khắc.
    - Câu trả lời mẫu Speaking: do repo VIDEO MAKING sản xuất (viết kịch bản, giọng đọc Kokoro, dựng video). Web chỉ hiển thị.
    - Nhận xét học viên: đã có sự đồng ý chia sẻ từ lúc thu. Được đăng.
    - Luyện thi THPT: hoãn; thiết kế trước một khuôn để tái dùng.
    - Full test Speaking mô phỏng (chốt 18/11/2026): 3 câu Part 1, 1 bài Part 2, 2 câu Part 3 = 3 lượt chấm (mỗi Part một lượt). Vậy Part 3 tính như Part 1: một cụm 2–3 câu là một lượt.
    - Đề Reading và Listening tự chọn hết giờ thì TỰ NỘP, không hỏi "chấm hay bỏ" (hai kỹ năng này không tốn lượt). Hỏi "chấm phần đã làm hay bỏ" chỉ áp cho Writing và Speaking tự chọn.
    - Full test Writing tốn 2 lượt (mỗi task một lượt): anh Andy đã xác nhận ngày 18/11/2026.

> **Anh Andy đã trả lời ngày 17/11/2026** (giữ nguyên văn để đối chiếu; từ lần khớp chéo 18/11 các điểm này **đã được đưa vào thân gói**: câu 7, 8 → FR-020…023, 030, mục 5.2; câu 11 → FR-053, 5.4; câu 13 → 5.5; phần C → mục 3.1, 5.3, G11-T07/T18 ĐÃ BỎ; câu 16 → T25, T26 hoãn):
> - **Câu 7 — trần chấm thử.** Mỗi người mỗi ngày: 1 bài Writing Task 1 + 1 bài Writing Task 2; 2 bài Speaking Part 2. Trần toàn web mỗi ngày tính bằng **chi phí chấm: 5 USD mỗi ngày** cho cả Writing và Speaking (không phải số bài). Hệ quả kỹ thuật: (a) trần mỗi ngày của Writing tách theo task (`task1`, `task2`), không phải một con số chung; (b) Speaking thử chỉ nhận Part 2; (c) cần ghi chi phí ước tính của từng lượt chấm thử (USD, từ số token/giây âm thanh và bảng đơn giá cấu hình) và cộng dồn theo ngày giờ Việt Nam; khi tổng chạm `TRIAL_DAILY_BUDGET_USD=5` thì dừng nhận bài thử tới 00:00; (d) kiểm ngân sách trước khi nhận bài bằng chi phí ước tính tối đa của một lượt, để không vượt trần khi nhiều yêu cầu đồng thời. **Hạn mức tổng mỗi người, suốt chương trình chấm thử (chốt 17/11/2026):** 10 bài Writing (5 Task 1 + 5 Task 2) và 10 bài Speaking Part 2, tính theo CẢ email tài khoản VÀ địa chỉ IP của máy: một lượt bị từ chối khi email đã chạm hạn mức hoặc IP đã chạm hạn mức. Lưu ý khi làm: (1) không lưu IP thô — lưu bản băm có muối xoay theo cấu hình, ghi vào chính sách quyền riêng tư; (2) nhiều người dùng chung một IP (công ty, trường, mạng di động) sẽ chung hạn mức — làm hệ số cấu hình `TRIAL_IP_QUOTA_MULTIPLIER` (mặc định 1 theo quyết định) để nới được mà không sửa mã, và ghi số lượt bị từ chối vì IP vào báo cáo admin; (3) lấy IP từ header do hạ tầng tin cậy đặt, không tin header do client gửi.
> - **Câu 8.** Người từng có khoá online, kể cả đã hết hạn: KHÔNG được chấm thử.
> - **Câu 11.** Mini test KHÔNG tính là full test: không bị chặn trên điện thoại. Chỉ chặn full test 4 kỹ năng, full test từng kỹ năng và kỳ thi xếp lịch. (Ngược với đề nghị trong bảng.)
> - **Câu 13.** Chế độ trả điểm mặc định khi giao bài kiểm tra cho lớp offline: "giáo viên công bố" (`teacher_release`). Khoá online tự học: trả ngay.
> - **Phần C — sửa:** thư về đơn là BỐN thư, thêm mẫu `order_needs_info` (gửi khi admin đánh dấu đơn cần bổ sung hoặc sai lệch số tiền; có hạn bổ sung và lời nhắn của admin chép nguyên văn; tờ EmailMau thư 14). Mọi chỗ trong gói ghi "ba thư" đọc thành bốn. Khoản chuyển khớp mã của một đơn đã hết hạn thì đơn tự mở lại, mở khoá và gửi thư "khoá đã mở".
> - **Câu 16.** Nộp trễ và làm lại/làm bù ĐỂ ĐỢT SAU. Đợt đầu chỉ làm chế độ trả điểm (G11-T21–T24, T27–T28). KHÔNG làm G11-T25 (nộp trễ, vắng; migration 475) và G11-T26 (làm bù/làm lại; migration 476) cho tới khi anh Andy mở lại. Trong đợt đầu, học viên vắng được giáo viên giao lại như một bài mới; màn hình không hiện nút "cho nộp trễ" hay "cho làm lại".

## Problem

Hiện trạng repo mà gói đã đọc (staging @ 93c7085):

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Thông báo trong ứng dụng | không có bảng, route hay component nào (`grep -rn "notification" backend/migrations` chỉ ra cột `users.notification_email`) | Làm mới hoàn toàn. |
| Cột bật/tắt thư | `backend/migrations/013_extend_user_profile.sql` dòng 6 `users.notification_email BOOLEAN DEFAULT TRUE`; đọc/ghi ở `backend/routers/auth.py` dòng 80, 463, 1121, 1155; `PATCH /auth/profile` (dòng 1083) sau cờ `profile_update` | Là công tắc chung, không theo loại thư. Giữ làm công tắc tổng. |
| Bài được giao của học viên | `backend/routers/class_student.py`: `_visible_assignments` (dòng 493), `_visible_writing_gives` (dòng 439), `_decorate` (dòng 268) tính `is_late`, `is_missing = not submitted_at and due and due < now`; `is_assignment_open` (import dòng 44, dùng dòng 588); `GET /api/class/my-assignments` (658), `GET /api/class/me` (1066) | Bộ đếm quá hạn phải dùng đúng các hàm này, không viết truy vấn thứ hai. |
| Bảng bài giao | `backend/migrations/177_class_assignments.sql`: `class_assignments(cohort_id, lesson_id, skill, content_id, content_config jsonb, title, due_at, publish_at, status draft/published/archived)`; `class_assignment_items(assignment_id, student_id, state assigned/opened/submitted/graded, opened_at, submitted_at, score NUMERIC(3,1), UNIQUE(assignment_id, student_id))`; RLS chỉ policy admin (dòng 233–245), học viên đọc qua backend | "Trễ" và "bỏ bài" không lưu, suy từ mốc thời gian (comment dòng 262–270). `class_assignments.timed_started_at` (mig 272) khoá hạn khi bài có giờ đã bắt đầu. |
| Giao bài | `backend/routers/admin_class_assignments.py` (prefix `/admin/cohorts`, dòng 99): model tạo bài dòng 195–290 (`completion_mode: mastery|single_attempt`, `time_limit_minutes`, `student_ids` giao cho một nhóm, `pass_pct`…); kiểm Course dòng 930–1033 (đề `meta.assessment_kind == "final"` bắt buộc `single_attempt`; `single_attempt` chỉ cho bộ trắc nghiệm thuần; trùng bank trong lớp → 409); `POST /{cohort_id}/assignments` (2742), `PATCH …/{assignment_id}` chỉ đổi `status` (2995), `PATCH …/due` (3110), `GET …/tally` (1648) | `MAX_COURSE_TIME_LIMIT_MINUTES = 12 * 60` ở `backend/services/class_assignment_service.py` dòng 81 (khớp "1–720 phút" của tờ KiemTraKhoa). |
| Chấm bài kiểm tra của khoá | `backend/services/quiz_service.py` (7.373 dòng): `course_completion_mode` (363), `single_attempt_answers_sealed` (376), `_ensure_timed_course_session` (2058), `start_session` (2175), `log_progress` (3086) trả phản hồi từng câu qua `_course_attempt_feedback` (3233: `is_correct`, `answer`, `explain`, `why_wrong`), `end_session` (3349), `course_verdict` (5025), `reap_expired_course_assessments` (5596), `_course_review_gate` (5999), `course_answer_report` (6041), `_sealed_course_session_ids` (7209), `student_progress` (7263) | Chấm và trả **ngay** trong backend. Chỉ có "niêm phong đáp án tới khi nộp" của `single_attempt`; không có trạng thái "chờ công bố", không có bảng công bố. |
| Route học viên lộ kết quả | `backend/routers/quiz.py` (prefix `/api/quiz`): `GET /banks/{bank_id}` (136), `/banks/{bank_id}/course-timer` (154), `/banks/{bank_id}/course-resume` (168), `/progress` (93), `/mistakes` (107), `POST /sessions/{id}/progress` (349), `PATCH /sessions/{id}` (361), `GET /course/report` (321), `POST /course/verdict` (338); `backend/routers/class_student.py` trả `score`, `passed_at`, `course_action` trong `_decorate`; `backend/routers/kp.py` `/api/me/kp-mastery` (67), `/api/me/roadmap` (83) | Mọi đường này phải qua cổng công bố ở phần E. |
| Đọc thẳng bảng đáp án | `backend/migrations/119_quiz_progress.sql` dòng 40, 86: policy `quiz_sessions_select`, `quiz_attempts_select` (`auth.uid() = user_id`); `quiz_attempts.is_correct BOOLEAN NOT NULL` (dòng 60) | Học viên đọc được `is_correct` của mình qua Supabase REST, vượt mọi cổng backend. `specs/0046-quiz-server-check-key-release/spec.md` (status **draft**) FR-017 định thu quyền này. |
| Spec liên quan đã có | `specs/0043-course-assessment-lesson-report/` (approved: báo cáo theo buổi cho giáo viên, "Buổi yếu là dưới 60%"); `specs/0046-…` (draft: chấm ở máy chủ, đáp án bài một lượt mở sau hạn hoặc khi cả lớp nộp, FR-011, FR-017–FR-019); `specs/0047-free-trial-grading/` (approved 10/11, migration 371 đã cấp, chưa có mã) | E xây trên 0043 và 0046; B sửa đổi 0047. |
| Chấm thử 0047 | `specs/0047-free-trial-grading/spec.md` FR-001 (chỉ tài khoản chưa từng kích hoạt, cột mới `users.first_activated_at`), FR-003 (hạn mức theo env `TRIAL_SPEAKING_PER_DAY=5`, `TRIAL_WRITING_PER_DAY=1`, `TRIAL_SPEAKING_TOTAL=20`, `TRIAL_WRITING_TOTAL=5`; giữ chỗ nguyên tử, hoàn khi lỗi, `request_key`), FR-004 (trần USD riêng), FR-007–FR-010 (chống nhiều tài khoản); `plan.md` dòng 117–128 bảng `trial_accounts`, `trial_usage(status reserved/consumed/released/filtered, vn_day)`; `rollout.md` cờ `free_trial_enabled`, env `TRIAL_KILL_SWITCH` | Không có "trần mỗi ngày toàn web" tính theo số bài; các trần đang là env, không sửa được từ trang admin. |
| Cờ chạy thật | `backend/services/runtime_flags.py` (`is_enabled`, `set_flag`, `require_flag`), bảng `runtime_flags` (mig 155), `backend/routers/admin_flags.py` `GET /admin/runtime-flags` (34), `PATCH /admin/runtime-flags/{key}` (46) | Không có bảng cài đặt có giá trị số. |
| Thư cho học viên | chưa có; G04 định `learner_email_outbox` (G04 mục 5.2) và `services/learner_email.py`, cron `scripts/enrollment_sweep.py`; mẫu gửi hiện có `backend/services/owner_alerts.py`, cron `backend/railway.staff-security-sweep.json` (`*/5 * * * *`) | — |
| Phòng thi, điểm tạo lượt | Reading: `POST /api/reading/test/{test_id}/attempts` (`backend/routers/reading_student.py` dòng 1284), gọi từ `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx` dòng 965–981; Mock: `POST /api/mock-exams/{code}/sittings` (`backend/routers/mock_exams.py` dòng 153); trang `(authed-full-test)`, `(authed-mock-exam)`, `(authed-exam)`, `(authed-listening-player)` | Chưa có kiểm độ rộng vùng nhìn nào. |
| Cấu hình chạy cho trình duyệt | `frontend/public/js/runtime-config.js`; `frontend/tooling/content-security-policy.mjs` dòng 5 dẫn xuất từ cùng nguồn | CHƯA KIỂM cách sinh file này: `grep -rn "runtime-config" frontend/tooling frontend/scripts frontend/package.json`. |
| Nhận diện | `frontend/public/favicon.svg` (trùng `frontend/favicon.svg`, `docs/brand/assets/favicon.svg`); `frontend/app/manifest.ts` (một icon SVG, `theme_color '#0f766e'`, `background_color '#f7f8f7'`); `frontend/app/layout.tsx` dòng 41–55 (`metadataBase`, `icons: { icon: '/favicon.svg' }`, `openGraph` không có ảnh); không có `opengraph-image.*` trong `frontend/app`; `docs/brand/social-assets/` 17 SVG | `frontend/tests/brand-favicon.test.mjs` ghim hình "Mũi lên" (`d="M25 72 L50 32 L75 72"`, chấm `#F59E0B`, màu `#0F766E`), ghim bản trùng byte với `docs/brand/assets/favicon.svg`, và ghim chuỗi `icons: { icon: '/favicon.svg' }` trong `layout.tsx`. |
| Icon | G03-T03 định dựng ~30 icon từ gói `lucide` nét 1,5; tờ `ThanhPhanNenTang` định bộ **94 icon tự vẽ** (lưới 24, nét 2, đầu nét tròn, dữ liệu path trong `iconGroups` của tờ) thay emoji và ký tự (›, ‹, ×, →…) | Hai nguồn khác nhau, xem 3.3. |
| Grammar Wiki | Nội dung `backend/content/<category>/<slug>.md`, nhóm `backend/content/_groups.yaml`; dựng HTML ở `backend/services/grammar_content.py` (`markdown.Markdown(extensions=["tables","fenced_code","toc","attr_list", strikethrough])` dòng 323) rồi `inject_learning_blocks` (dòng 334) từ `backend/services/grammar_learning_blocks.py`: khối khai trong frontmatter `learning_blocks`, đặt bằng `<!-- learning-block: id -->`, kiểu `check|visual|repair|transfer|takeaways`, `visual.variant ∈ decision-tree|timeline|sentence-xray|chart-map|flow`, mọi chuỗi được `escape`; 20 bài đang dùng; test `backend/tests/test_grammar_learning_blocks.py`; trang `frontend/app/(public-content)/grammar/[category]/[slug]/page-shell.tsx` chèn HTML bằng `dangerouslySetInnerHTML` | Renderer sơ đồ mới phải là kiểu khối mới trong cơ chế này, không thêm đường dựng HTML thứ hai. |
| Giáo viên | `backend/routers/admin.py::require_instructor` (dòng 112, `staff_guard.resolve_staff(need="instructor")`); `students.instructor_id` (mig 106) | Đã kiểm ở `c3bc71574` (18/11): repo chỉ có `students.instructor_id`; bảng `cohorts` chưa có cột giáo viên. Đã chốt (00 mục 2 điểm 23): mỗi lớp MỘT giáo viên, cột `cohorts.instructor_id` do G09-T24 thêm (migration 441); không có bảng nhiều giáo viên. |
| Tên khoá online, nhãn "Đăng ký lại" | Không có chuỗi tên khoá online hay "Đăng ký lại"/"Gia hạn" nào trong `frontend/app`, `frontend/lib`, `frontend/components` (đã grep) | Tên chỉ tồn tại sau khi G04 có `course_products`. |

## Scope

2. (B) Bảng cấu hình trần chấm thử, nhật ký cài đặt, sửa hàm giữ chỗ của 0047 để thêm trần theo task, theo IP và trần chi phí toàn web, API trạng thái/cấu hình công khai, thẻ "Chấm thử miễn phí" của trang `/admin/settings`, các trạng thái phía người dùng trong các màn `/trial/*`. **Lối vào chấm thử ở trang chủ và menu công khai thuộc G05-T21.**

## Non-goals

- Thông báo đẩy của hệ điều hành, ứng dụng điện thoại gốc, SMS, Zalo.
- Các loại thông báo "lượt chấm AI", "thi thử", "phản hồi", "bảo trì" ở tờ ThongBao: giữ chỗ trong CHECK, không viết nguồn sinh (gói sau, khi G04 lượt, G08 thi thử, G09 phản hồi và AdminCaiDat thẻ Thông báo hệ thống có dữ liệu).
- Các thẻ khác của `/admin/settings` (Thanh toán, Thư, Pháp lý, Tính năng, Thông báo hệ thống, Ngưỡng vận hành): thuộc G09-T22, T23. Gói này dựng thẻ Chấm thử trên cùng trang (G11-T16); bên vào sau rebase.
- Phần chống lạm dụng, trần USD, Turnstile, bộ lọc trước chấm của 0047: giữ nguyên, không làm lại.
- Phiếu kết quả Writing/Speaking (G07), phòng thi (G08), danh bạ và hồ sơ (G09).
- Bài kiểm tra của khoá online không có lớp (chưa có đường giao bài cho người đăng ký online; chờ G07 COURSELESSON).
- Thay emoji trong các trang cũ chưa được dựng lại (mục 10 câu 21).

## Users and journeys

- Người học (học viên lớp offline, người đăng ký khoá online, người dùng chấm thử) — thấy kết quả của phần này ở màn học viên.
- Giáo viên của lớp (mỗi lớp một giáo viên) và admin — thao tác phía nhân sự khi phần này có.

## Requirements

Đánh số theo gói (FR-11-NNN → FR-NNN, giữ nguyên số).

- **FR-020:** Trần chấm thử là cấu hình, sửa ở trang Cài đặt, gồm ba lớp (00 mục 2 điểm 11): (1) **hạn mức tổng mỗi người** suốt chương trình, theo hạng mục `writing_task1`, `writing_task2`, `speaking_part2` — số đã chốt 5 / 5 / 10; tính theo **cả** email tài khoản **và** địa chỉ IP (bản băm), một lượt bị từ chối khi một trong hai đã chạm hạn mức; hạn mức theo IP = hạn mức mỗi người × `ip_quota_multiplier` (mặc định 1); (2) **trần mỗi ngày mỗi người** theo cùng ba hạng mục — số đã chốt 1 / 1 / 2, làm mới 00:00 giờ Việt Nam; (3) **trần mỗi ngày toàn web tính bằng chi phí chấm** — số đã chốt 5 USD mỗi ngày cho cả Writing và Speaking. Ràng buộc: số nguyên ≥ 0; trần ngày ≤ hạn mức tổng của cùng hạng mục; ngân sách ≥ 0. Đặt 0 ở trần của một hạng mục = đóng hạng mục đó; ngân sách 0 = đóng chấm thử.
- **FR-021:** Một lượt Writing = một bài được nhận chấm (Task 1 và Task 2 đếm riêng). Một lượt Speaking = **một bài Part 2**; chấm thử Speaking chỉ nhận Part 2 (Part 1, Part 3 không có trong chấm thử). Chỉ dòng `trial_usage` ở trạng thái `reserved` hoặc `consumed` được đếm; `released` (lỗi hệ thống) và `filtered` (bài chưa đạt bước kiểm tra) không đếm lượt và trả lại phần chi phí ước tính đã giữ.
- **FR-022:** Trạng thái của một người cho một hạng mục, theo thứ tự ưu tiên khi trùng: `paused` › `site_daily_exhausted` (ngân sách ngày đã chạm) › `user_total_exhausted` › `ip_total_exhausted` › `user_daily_exhausted` › `available`. Còn lại hôm nay = min(trần ngày − đã dùng hôm nay, hạn mức tổng − đã dùng tổng), không âm. Trạng thái `ip_total_exhausted` có màn riêng nêu lý do (nhiều người dùng chung một mạng) và lối liên hệ/xác minh (00 mục 2 điểm 22; cách xác minh ở mục 10 câu 26).
- **FR-023:** Giữ chỗ là nguyên tử với mọi trần: N yêu cầu đồng thời khi ngân sách ngày chỉ còn đủ cho K lượt (K < N, tính theo chi phí ước tính tối đa của một lượt) cho đúng K giữ chỗ; không bao giờ vượt ngân sách ngày, trần người hay trần IP.
- **FR-024:** Cấu hình đọc ở máy chủ **mỗi lần nộp** (không cache quá 15 s); đọc lỗi → từ chối `503 trial_unavailable`, không gọi provider (fail-closed).
- **FR-025:** Công tắc "Tạm dừng chấm thử" là cờ `free_trial_enabled` của 0047; tạm dừng không trừ, không xoá, không hoàn lượt của ai; bài đã giữ chỗ trước khi tạm dừng được chấm xong.
- **FR-026:** Đổi trần áp từ lần nộp kế tiếp; giảm hạn mức không thu hồi bài đã chấm.
- **FR-027:** Trang công khai biết chấm thử đang mở hay không và số lượt mỗi ngày qua một API không cần đăng nhập, không lộ số người dùng hay số đã dùng của ai.
- **FR-028:** Mọi lần lưu cấu hình hoặc bật/tắt tạm dừng ghi một dòng nhật ký chỉ ghi thêm: ai, lúc, thẻ, giá trị cũ → mới, lý do (≥ 10 ký tự). Chỉ admin có AAL2.
- **FR-029:** Đường chấm của học viên có khoá hoặc lớp không đọc bảng cấu hình chấm thử và không bị trần chấm thử chặn (giữ 0047 FR-002).
- **FR-030:** (khớp G04) Người từng có khoá online, kể cả đã hết hạn hoặc bị thu hồi, không được chấm thử: đường chấm thử gọi `entitlements.has_ever_had_online_course(user_id)` của G04 (GOI-04 mục 5.8, FR-04-042); hàm ném lỗi → từ chối 503 `trial_unavailable` (fail-closed). Chấm thử **không** ghi và không đọc `credit_ledger`; nếu đi chung hàm chấm với học viên thì truyền `trial=True` vào `credits.charge_plan`.
- **FR-031:** (khớp G05, 00 mục 2 điểm 21) Tài khoản đăng nhập bằng mã 6 số gửi qua email được chấm thử như tài khoản Google: điều kiện provider của 0047 FR-001(d)/FR-007 nới từ "provider = `google`" thành "provider ∈ {`google`, `email`} và `email_confirmed_at` khác null" (mã đăng nhập đúng chính là bước xác minh email). Các lớp chống lạm dụng khác của 0047 (băm email chuẩn hoá, IP/thiết bị, Turnstile, admin chặn) giữ nguyên.
- **FR-032:** Lối vào chấm thử ở trang chủ và menu công khai do G05-T21 dựng, đọc `GET /api/trial/public-config`; gói này dựng các màn `/trial/*` và trạng thái trong đó.

## Acceptance scenarios

Kịch bản của gói (mục 9), giữ mã gốc; mỗi dòng là Given / When / Then theo cột.

Dữ liệu thử (staging): lớp thử QA có 3 học viên thử (tài khoản từ `setup_phase_d_test_env.sh` và tài khoản QA hiện có, không học viên thật); một bank Course trắc nghiệm thuần thử (ví dụ bản sao nhỏ 20 câu của đề giữa kỳ, gắn buổi); sản phẩm khoá thử `test-grammar-online` của G04; tài khoản chấm thử mới chưa kích hoạt.

| # | Given | When | Then | Môi trường |
|---|---|---|---|---|
| B1 | Ngân sách ngày chỉ còn đủ 2 lượt Writing Task 2 (đặt `daily_budget_usd` thấp trong PG thử), ba tài khoản dùng thử | Ba bài nộp gần như cùng lúc | Hai được nhận chấm, một thấy "Hôm nay toàn web đã hết lượt chấm thử" | PG17 (đua) + staging |
| B2 | Bài thứ hai bị lỗi hệ thống (grader giả lỗi) | Tài khoản thứ ba nộp lại | Được nhận (lượt và chi phí trả lại cộng lại ngân sách ngày) | local |
| B5 | Tài khoản tạo bằng mã email 6 số, chưa có khoá | Mở chấm thử, nộp 1 Task 1, 1 Task 2, 2 bài Speaking Part 2 rồi bài Part 2 thứ ba | Bốn bài đầu được nhận; bài thứ năm `user_daily_exhausted`; yêu cầu Speaking Part 1 → 422 | local + staging |
| B6 | Tài khoản từng có khoá online đã hết hạn (sản phẩm thử của G04) | Gọi `GET /api/trial/status` | 403 `trial_not_eligible`; không dòng `trial_usage`, không dòng `credit_ledger` nào được ghi | local + staging |
| B7 | Hai tài khoản thử cùng `ip_hash`, hệ số IP = 1, hạn mức tổng Part 2 đặt 2 (PG thử) | Mỗi tài khoản nộp Part 2 qua nhiều ngày giả | Lượt thứ ba tính chung theo IP bị từ chối `ip_total_exhausted`, màn nêu lý do và lối liên hệ; thẻ Chấm thử của admin tăng "bị từ chối vì IP" | PG17 + local |
| B3 | Admin bật "Tạm dừng" kèm lý do | Trang công khai | Lối vào biến mất trong ≤ 30 s; nhật ký có dòng; lượt của ai không đổi | staging |
| B4 | Admin đặt trần ngày > hạn mức tổng của một hạng mục | Lưu | 422 tiếng Việt, không đổi | local |

## Edge cases

Bảng vướng mắc của gói (mục 7):

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Số spec/migration đã bị giữ | `ls specs`, PR mở có `backend/migrations/47*` | Số theo bảng `01-KE-HOACH-TONG.md` mục 6 (anh Andy là người duy nhất vận hành repo); trùng thì lấy số trống kế tiếp trong dải 470–479 (không dùng 472 cho việc khác), đổi tên file + forward-policy + README + sổ đăng ký cùng lúc | Hết số trong dải → báo anh Andy |
| 0047 chưa có mã khi tới B | không có `/api/trial/*`, không có 371 | Làm T14 đường (a), T15 phần service; giao diện chờ | Người thực thi 0047 đang sửa `fn_trial_reserve` cùng lúc → hỏi người điều phối thứ tự |
| 0046 chưa duyệt khi tới E | `status: draft` | E tự thu quyền đọc thẳng (5.5.2), luật mở đáp án ở mức `full` dùng `due_at`/cả lớp như 0046 FR-011 viết, ghi trong spec 0082 | 0046 được duyệt với luật khác → theo 0046 |
| Lộ điểm qua đường chưa liệt kê | test không lộ đỏ ở route mới, hoặc người thực thi thấy route trả `score` không có trong 5.5.5 | Thêm vào bảng 5.5.5 và test trong cùng PR | Route đó là của admin nhưng học viên gọi được → dừng báo (lỗi quyền) |
| Đổi `_decorate` vỡ test ghim | test frontend/backend ghim `score` | Giữ khoá, trả `null`; thêm `course_test` | Quá 30 test đỏ ngoài dự kiến → dừng, báo danh sách |
| Trigger mới đụng RPC bài có giờ | test 270/276/279/280 đỏ | Đọc thứ tự khoá trong RPC; trigger chỉ UPDATE `class_assignments` khi `result_release_mode IS NOT NULL` | Có khoá chéo (deadlock) trong test đua → dừng |
| Bảng nguồn của job chưa có | lỗi "relation does not exist" | Bước trả `skipped: missing_table` | — |
| G04 đổi tên trường/sự kiện | bước `enrollment_order`, `credits_granted` không sinh dòng | Theo GOI-04 bản mới nhất (mục 5.3, 5.12, 5.15); sửa truy vấn nguồn và test trong cùng PR | — |
| Hai gói cùng sửa một trang admin | xung đột ở `/admin/settings` (G09-T23), `/admin/notifications` (G09-T40) | Bên vào sau rebase; mỗi bên chỉ thêm thẻ/khối của mình | — |
| G09-T30 cần API phần E trước khi có | G09 báo dừng ở T30 | Ưu tiên T21 → T23; `tally` mở rộng nằm trong T23 | — |
| Học viên có nhiều hồ sơ `students` | bộ đếm quá hạn thiếu/thừa | Gộp mọi hồ sơ theo `user_id` | Không rõ hồ sơ nào là "đang học" → hỏi |
| Cổng kích hoạt chặn route thông báo | 403 cho người chưa kích hoạt | Thêm vào `ACTIVATION_EXEMPT_ROUTES` kèm lý do | Muốn miễn trừ route có ghi dữ liệu ngoài `read`/`read-all`/prefs → hỏi |
| Cron chưa có trên Railway | thông báo không sinh, thư không đi | Chạy tay `python -m scripts.notification_sweep`; báo "đã có ở nhánh, chưa chạy định kỳ" | — |
| hai phiên thực thi sửa `aver-chrome.js`, `next.config.ts`, `grammar_learning_blocks.py` | xung đột merge | Theo thứ tự 01 mục 3; phiên sau rebase | — |
| Tờ thiết kế và yêu cầu 17/11 khác nhau | ví dụ dải nhắc giữa bài thi | Theo yêu cầu 17/11, ghi chỗ khác trong PR | Mục 10 có câu tương ứng chưa trả lời và hành vi khó đổi về sau → hỏi |
| Test gọi mạng | `tests/test_suite_makes_no_live_calls.py` đỏ | Resend, Supabase qua giả | — |

## Success criteria

- Mọi kịch bản ở trên có bằng chứng ở môi trường ghi trong cột cuối; production chỉ xem (gói mục 9).
- Mọi cờ mới mặc định tắt; production không bật cờ nào trong gói này.

## Related specifications

- **FREETRIAL-0047 (approved 10/11/2026): spec này sửa đổi 0047** — thay FR-003 phần hạn mức bằng ba lớp trần cấu hình (FR-020) và bổ sung FR-006 phần trạng thái (FR-022). Không đổi FR-001 (đối tượng dùng thử) và không đổi trần USD theo provider của 0047. Biến môi trường `TRIAL_*_PER_DAY`, `TRIAL_*_TOTAL` của 0047 **thôi dùng** khi migration 471 có hiệu lực; giá trị đọc từ bảng cấu hình (FR-024).
- Spec 0047 đã approved nên PR spec này không sửa file của 0047; dòng "Sửa đổi bởi TRIALCAP-0080" ở 0047 thêm cùng PR mã đầu tiên của G11-T14 (hoặc khi anh Andy duyệt 0080).
- Trạng thái 0047 kiểm ngày 18/11/2026: `backend/migrations/` chưa có file `371_*` → theo **đường (a)** của plan 5.2.1 (471 viết sau khi 371 của G11-T14a merge).
- COURSEACCESS-0055 (G04): `has_ever_had_online_course` (FR-030); chấm thử không gộp vào sổ lượt (FR-042 của 0055).
- AIBUDGET-0033: trần ngân sách AI chung; trần chấm thử là lớp riêng.
- ADMINIA-0074 (G09): `/admin/settings` và bảng `admin_settings_log` (migration 440).
- PUBLICSITE-0059 (G05-T21): lối vào chấm thử ở trang chủ và menu công khai.

## Open questions

Câu hỏi của gói (mục 10) thuộc phần này; mỗi câu có mặc định tạm người thực thi dùng tới khi anh Andy trả lời.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 7 | **ĐÃ TRẢ LỜI 17/11** — trần chấm thử: mỗi ngày mỗi người 1 Task 1 + 1 Task 2 + 2 Speaking Part 2; tổng mỗi người 5 + 5 + 10 theo email và IP; toàn web 5 USD chi phí chấm mỗi ngày | — | Seed đúng các số này (5.2.1); cờ `free_trial_enabled` vẫn tắt |
| 8 | **ĐÃ TRẢ LỜI 17/11** — người từng có khoá online, kể cả đã hết hạn, không được chấm thử | — | FR-030 |
| 9 | **ĐÃ TRẢ LỜI** — không gộp chấm thử vào sổ lượt của G04 (GOI-04 bản 18/11 mục 5.8) | — | Không gộp |
| 26 | Người bị chặn chấm thử vì dùng chung IP: "lối đi" cụ thể là gì (00 mục 2 điểm 22 chỉ ghi màn nêu lý do và cách liên hệ/xác minh)? Ai nới, bằng cách nào? | Màn nêu lý do + kênh liên hệ; admin nới bằng hệ số IP chung ở Cài đặt (chưa có nới riêng một người) | Như đề nghị; không có nới riêng một người |
| 28 | Chi phí ước tính tối đa một lượt chấm thử (Task 1, Task 2, Speaking Part 2) để giữ chỗ ngân sách 5 USD/ngày: lấy từ đâu? | Từ bảng đơn giá đang dùng để ghi chi phí AI trong repo; anh xem lại số | Cấu hình `max_cost_usd`; không tìm được đơn giá thì dừng hỏi |
