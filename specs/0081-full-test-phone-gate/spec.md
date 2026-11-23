---
id: PHONEGATE-0081
title: Full tests open only on screens at least the configured width, while mini tests, practice and course tests stay available on phones
status: draft
risk: medium
owner: product
---

# Full tests open only on screens at least the configured width, while mini tests, practice and course tests stay available on phones

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G11-T03` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-11-bo-sung-quyet-dinh-20261117.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; phần này không có migration.

## Tóm tắt (tiếng Việt)

GOI-11 phần D. Tóm tắt cả gói (mục 1):

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

13. **Full test trên điện thoại (chốt 17/11/2026):** hiện cảnh báo và không cho vào bài. iPad hoặc tablet đủ chỗ hiển thị thì vẫn cho vào (ngưỡng đề xuất, chưa chốt: vùng nhìn rộng từ 768px). Mini test không tính là full test, vẫn làm được trên điện thoại, cũng như luyện từng phần.
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

Hiện trạng repo mà gói đã đọc (staging @ 93c7085), chỉ giữ các dòng của phần D; bảng đầy đủ của gói ở GOI-11. Rà lại ngày 23/11 trên `staging`: xem mục "Lối vào full test (rà 23/11)" ngay dưới bảng.

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Phòng thi, điểm tạo lượt | Reading: `POST /api/reading/test/{test_id}/attempts` (`backend/routers/reading_student.py` dòng 1284), gọi từ `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx` dòng 965–981; Mock: `POST /api/mock-exams/{code}/sittings` (`backend/routers/mock_exams.py` dòng 153); trang `(authed-full-test)`, `(authed-mock-exam)`, `(authed-exam)`, `(authed-listening-player)` | Chưa có kiểm độ rộng vùng nhìn nào. |
| Cấu hình chạy cho trình duyệt | `frontend/public/js/runtime-config.js`; `frontend/tooling/content-security-policy.mjs` dòng 5 dẫn xuất từ cùng nguồn | CHƯA KIỂM cách sinh file này: `grep -rn "runtime-config" frontend/tooling frontend/scripts frontend/package.json`. |
| Giáo viên | `backend/routers/admin.py::require_instructor` (dòng 112, `staff_guard.resolve_staff(need="instructor")`); `students.instructor_id` (mig 106) | Đã kiểm ở `c3bc71574` (18/11): repo chỉ có `students.instructor_id`; bảng `cohorts` chưa có cột giáo viên. Đã chốt (00 mục 2 điểm 23): mỗi lớp MỘT giáo viên, cột `cohorts.instructor_id` do G09-T24 thêm (migration 441); không có bảng nhiều giáo viên. |
| Tên khoá online, nhãn "Đăng ký lại" | Không có chuỗi tên khoá online hay "Đăng ký lại"/"Gia hạn" nào trong `frontend/app`, `frontend/lib`, `frontend/components` (đã grep) | Tên chỉ tồn tại sau khi G04 có `course_products`. |

### Lối vào full test (rà 23/11)

| Lối vào | Tạo lượt ở đâu | Tạo khi nào |
|---|---|---|
| Reading test | `startFresh` → `POST /api/reading/test/{test_id}/attempts` (`reading-exam-session.tsx` ~L960–995) | khi bấm |
| Listening test | `startFresh` → `POST /api/listening/tests/{test_id}/attempts` (`listening-test-session.tsx` ~L673–690) | khi bấm |
| Speaking full test | thẻ "fulltest" của trang Speaking → `POST /sessions` `mode: 'test_full'` (`speaking-behavior.tsx` ~L1094), rồi `/practice/session`; lệnh này tiêu một lượt session trong ngày (`MAX_SESSIONS_PER_USER_PER_DAY`) | khi bấm |
| Thi thử (mock) | `POST /api/mock-exams/{code}/sittings` trong effect khởi động của `mock-exam-runner.tsx` (~L813–817) | **khi mở trang**: cổng phải bọc runner trước effect này |
| Danh sách thi thử | `(authed-full-test)/full-test` nay là danh sách (`GET /api/mock-exams`), không tạo lượt | — |

`mock-exam-runner.tsx` đã có `matchMedia('(max-width: 860px)')` để đổi bố cục (L404); ngưỡng
bố cục này độc lập với ngưỡng chặn của FR-050. Kỳ thi thử do admin mở từng phần cho mọi người
(`mock_exams.py`: không có "start" riêng từng học viên), nên đồng hồ của kỳ thi xếp lịch chạy
dù học viên bị chặn (câu hỏi mở 29).

`isFullTest` của mỗi trình lấy từ dữ liệu máy chủ, không từ URL: Reading theo
`reading_tests.test_type = 'full'` (EXAMREAD-0067 FR-004); mỗi spec trình G08 ghi nguồn của mình.

## Scope

4. (D) Thư viện kiểm vùng nhìn, màn chặn tiếng Anh, nối vào mọi lối vào full test/thi thử (trang cũ và khung mới).

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

- **FR-050:** Khi mở bất kỳ lối vào nào của full test — full test từng kỹ năng (đề tự chọn), mock test được giao, kỳ thi xếp lịch; gồm phòng chờ, Before you begin, chuyển phần, tiếp tục bài dở (tiếp tục bài dở: xem câu hỏi mở 28) — mà chiều rộng vùng nhìn < `fullTestMinViewportPx` (mặc định 768): hiện màn chặn tiếng Anh theo tờ ThanhPhanKhungTrang mục 6, kèm **một dòng phụ tiếng Việt** (FR-056), không gọi API tạo lượt/sitting, không chạy đồng hồ, không trừ lượt.
- **FR-051:** Từ ngưỡng trở lên (tablet dọc 768px) vào được mọi phần của full test.
- **FR-052:** Đang trong lượt thi đã bắt đầu mà vùng nhìn hẹp lại (xoay, thu cửa sổ): không kết thúc bài, không đẩy ra, không dừng đồng hồ; hiện dải nhắc tiếng Anh không che bài (mặc định tạm, mục 10 câu 12).
- **FR-053:** **Mini test**, luyện từng phần (chế độ luyện, bài giao dạng luyện) và bài kiểm tra của khoá **không** bị chặn (00 mục 2 điểm 13; trả lời câu 11).
- **FR-054:** Trên trang `/tests` (ThiThu) dưới ngưỡng không có nút vào full test; nút thay bằng dòng Cảnh báo; nút vào mini test vẫn có; mở thẳng đường dẫn phòng thi full test cũng về màn chặn.
- **FR-055:** Máy chủ không dựa vào độ rộng do trình duyệt báo để cho/không cho; máy chủ bảo đảm mở trang không tạo lượt, tạo lượt chỉ qua lệnh bắt đầu tường minh, lệnh đó idempotent, và không giữ chỗ lượt AI lúc bắt đầu.
- **FR-056:** Màn ngoài bài thi của full test — màn chặn điện thoại và màn lỗi thiết bị (micro, loa, trình duyệt không hỗ trợ) — có thêm một dòng phụ tiếng Việt dưới nội dung tiếng Anh, đánh dấu `lang="vi"` (00 mục 2 điểm 22). Đây là ngoại lệ có chủ đích của quy tắc "không trộn nhãn Việt–Anh" và chỉ áp cho màn **ngoài** bài thi; trong bài thi vẫn toàn tiếng Anh. Câu chữ dòng phụ: mục 10 câu 27.

## Acceptance scenarios

Kịch bản của gói (mục 9), giữ mã gốc; mỗi dòng là Given / When / Then theo cột.

Dữ liệu thử (staging): lớp thử QA có 3 học viên thử (tài khoản từ `setup_phase_d_test_env.sh` và tài khoản QA hiện có, không học viên thật); một bank Course trắc nghiệm thuần thử (ví dụ bản sao nhỏ 20 câu của đề giữa kỳ, gắn buổi); sản phẩm khoá thử `test-grammar-online` của G04; tài khoản chấm thử mới chưa kích hoạt.

| # | Given | When | Then | Môi trường |
|---|---|---|---|---|
| D1 | Chrome giả 390×844 | Mở `/tests` và mở thẳng đường dẫn phòng thi Reading full test | Không nút vào full test; màn chặn tiếng Anh có một dòng phụ tiếng Việt; network không có POST tạo lượt | staging (preview) |
| D2 | 820×1180 | Vào thi Reading test | Vào được; xoay về 390 giữa bài → bài tiếp tục, đồng hồ chạy, dải nhắc hiện | staging |
| D3 | 390×844 | Mở luyện từng phần Reading, rồi một mini test | Cả hai làm được, không màn chặn | staging |

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
| Máy tính phóng to (zoom) | `innerWidth` < ngưỡng trên máy tính (ví dụ 1280px zoom 200%) | Đúng là bị chặn (thước là CSS px); màn chặn gợi ý thu zoom về 100% | — |
| Test gọi mạng | `tests/test_suite_makes_no_live_calls.py` đỏ | Resend, Supabase qua giả | — |

## Success criteria

- Mọi kịch bản ở trên có bằng chứng ở môi trường ghi trong cột cuối; production chỉ xem (gói mục 9).
- Mọi cờ mới mặc định tắt; production không bật cờ nào trong gói này.

## Related specifications

- EXAMROOM-0066 và các trình G08 (0067–0073): khung `ExamRoom` mới; G08-T03 merge thì cổng nối vào khung mới (giai đoạn 2), trước đó nối vào trang cũ (giai đoạn 1).
- MOCKORG-0086: mock test được giao cũng bị chặn dưới ngưỡng.
- UIBASE-0056: điểm gãy 768px.

## Open questions

Câu hỏi của gói (mục 10) thuộc phần này; mỗi câu có mặc định tạm người thực thi dùng tới khi anh Andy trả lời.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 10 | Ngưỡng chặn full test (00 mục 2 điểm 13 ghi 768px là "ngưỡng đề xuất, chưa chốt") | 768px (trùng UIBASE-0056). iPad mini dọc rộng 744 CSS px nên bị chặn: màn chặn thêm câu "On a tablet, turn it sideways." | 768px, mặc định trong code (không thêm env) |
| 11 | **ĐÃ TRẢ LỜI 17/11** — mini test không tính là full test, không bị chặn trên điện thoại | — | FR-053 |
| 12 | Đang thi mà màn hẹp lại: dải nhắc không che bài (yêu cầu 17/11) hay che bài kèm "Rotate your tablet back to continue." (tờ ThanhPhanKhungTrang)? | Dải nhắc không che bài; bài và đồng hồ chạy tiếp | Dải nhắc không che bài |
| 27 | Câu chữ dòng phụ tiếng Việt ở màn ngoài bài thi của full test (chặn điện thoại, lỗi thiết bị) | Câu ở 5.4, thêm "Máy tính bảng thì xoay ngang." | Như đề nghị |
| 28 | Lượt đã bắt đầu, mở lại trên màn hẹp (tải lại, đổi máy): FR-050 chặn "tiếp tục bài dở" với câu "Nothing has started…", trong khi giờ máy chủ vẫn chạy và FR-052 cho làm tiếp khi màn hẹp lại giữa bài | Chỉ chặn trước khi tạo lượt/sitting mới; lượt đã bắt đầu luôn mở tiếp, kèm dải nhắc FR-052 | Như đề nghị, chờ anh Andy |
| 29 | Kỳ thi thử xếp lịch: admin mở phần cho mọi người, đồng hồ chạy dù học viên bị chặn | Vẫn chặn dưới ngưỡng, với câu riêng "This exam is already running. Open it on a computer or tablet now." (không có "Nothing has started") | Như đề nghị, chờ anh Andy |
