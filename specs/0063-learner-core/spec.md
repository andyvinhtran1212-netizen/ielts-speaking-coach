---
id: LEARNERCORE-0063
title: Signed-in learners open Today to see what to do now in one of five states, from one read API, behind a per-learner switch that an admin can turn off in seconds
status: draft
risk: high
owner: product
---

# Signed-in learners open Today to see what to do now in one of five states, from one read API, behind a per-learner switch that an admin can turn off in seconds

Status: **draft** — bản gốc đã được anh Andy duyệt 23/11/2026 16:16 giờ VN ở #2461; nhánh này mang bản sửa đổi chưa duyệt nên frontmatter để `draft` tới khi anh duyệt (xem `approval-decision.md`); soạn ngày 23/11/2026 cho nhiệm vụ `G07-T02` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-07-loi-hoc-vien.md` mục 4.3, 5.3, 5.6, 5.8, 6 (T05, T13, T14), 9 và mục 10. Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục và `status` đổi sang `approved`. Số spec 0063 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. **Bản sửa đổi 1** (23/11/2026, nhiệm vụ `G07-T15`, `G07-T16`, gói mục 4.4 và 6) thêm Lộ trình và hai hub Luyện tập, Thi thử; phần đó cũng chưa có dòng mã nào và chờ anh duyệt riêng (bản gốc đã duyệt, các bản sửa đổi chưa; xem `approval-decision.md`).

## Tóm tắt (tiếng Việt)

**Người dùng thấy gì.** Học viên đăng nhập, mở Hôm nay (`/home`) trong khung 5 mục và thấy ngay việc cần làm:
- "Chào <tên>. Hôm nay bạn có N việc." — N đếm bài được giao đến hạn hôm nay, ngày mai và bài đã quá hạn, cộng 1 nếu còn bài tiếp theo trong lộ trình. Không bao giờ hiện "0 việc".
- Thẻ "Bài tiếp theo trong lộ trình", khối "Bài được giao" (quá hạn lên đầu, mở đúng bài), "Làm tiếp khi rảnh", khối lượt chấm AI (một con số chung cho Writing và Speaking), "Vừa có kết quả", "Lỗi đang lặp lại", dòng mục tiêu band và số tuần tới ngày thi.
- Năm trạng thái theo tờ HomNayTrangThai: (1) có khoá, đang học; (2) chưa có khoá; (3) đơn chờ xác nhận hoặc cần bổ sung; (4) ngày đầu có khoá; (5) dải sắp hết hạn, đã hết hạn hoặc hết lượt chồng lên trạng thái có khoá.
- Khối nào lỗi thì chỉ khối đó ẩn hoặc báo lỗi, các khối khác vẫn hiện. Khi chưa có dữ liệu (API lượt chưa có, sổ lỗi chưa có) khối ẩn, không hiện số 0 tự bịa.
- Giao diện mới chỉ hiện cho người được bật cờ `learner_v2`; tắt cờ (công tắc khẩn) thì trong 15 giây mọi người về giao diện cũ y nguyên.

**Phạm vi spec này (theo brief Q68).** Ba nhiệm vụ: cờ `learner_v2` (G07-T05), API `GET /api/student/today` (G07-T13), Hôm nay mới năm trạng thái (G07-T14). Các phần còn lại mà gói xếp vào LEARNERCORE (Lộ trình FR-07-030…036, hub Luyện tập/Thi thử, Tài khoản, Tiến độ, Trợ giúp, Hồ sơ, "Lần đầu vào" FR-07-060…066, mở `/home` cho tài khoản `is_active=false` G07-T26) được thêm bằng **bản sửa đổi** spec này trước khi các nhiệm vụ đó bắt đầu, để mỗi lần duyệt nhỏ và xem được: bản sửa đổi 1 (dưới đây) cho G07-T15, T16; bản sửa đổi 2 cho G07-T17, T26.

**Bản sửa đổi 1: Lộ trình, Luyện tập, Thi thử (G07-T15, G07-T16).** Người dùng thấy:
- Lộ trình `/course`: ba thẻ "Các khoá và bài học", "Bài được giao (n)", "Buổi học và tài liệu lớp" (chỉ khi có lớp). Nhóm "Khoá online của bạn" (còn X ngày, tiến độ, lượt AI còn; khoá hết hạn có nhãn "Đã hết hạn" và nút "Đăng ký lại"), "Khoá online khác · dự kiến", nhóm "Khoá của lớp". Danh sách bài theo chặng, bài nào cũng mở được; trước khi có bảng bài học thì ghi "Bài học của khoá sẽ mở dần". Học viên chỉ học lớp mở `/course` thì vào thẳng trang bài được giao.
- Luyện tập `/practice`: khối "Làm tiếp" và 4 thẻ kỹ năng.
- Thi thử `/tests`: đề tự chọn chỉ có full test từng kỹ năng và mini test, không có đề bốn kỹ năng tự chọn; khối "Mock test được giao" chỉ hiện khi được giao; bảng kết quả, Overall chỉ có ở mock test được giao đủ bốn kỹ năng. Trên điện thoại (dưới 768px) nút full test thành dòng cảnh báo, mini test vẫn vào được. Không đủ lượt thì dòng vẫn hiện, ghi "Không đủ lượt" và nút "Xem cách thêm lượt".
- Ba trang này chỉ vẽ giao diện mới khi cờ `learner_v2` bật; tắt cờ thì như hôm nay (câu hỏi mở 6).
- Hai API đọc mới: `GET /api/student/course`, `GET /api/student/tests`. Không migration mới.

**Vì sao `risk: high`.** Gói ghi `medium`, nhưng khi đối chiếu staging `e940c936`: cột "lần vào Hôm nay trước" (`users.today_seen_at`) mà FR-025 cần **chưa có** → cần một migration nhỏ (dải 420–439 của G07), và mọi PR có file migration bị cổng spec buộc lớp `high-risk`, nên spec phải `high`. Câu hỏi mở 1 hỏi anh có muốn bỏ migration (dùng cửa sổ thời gian) để hạ về `medium` không.

**Đã có ở staging `e940c936`.** Khung `LearnerShell` của G03 (#2445); mục tiêu band và ngày thi đã lưu ở `users.target_band`, `users.exam_date` (mig 005; mig 452 đồng bộ mục tiêu admin ↔ học viên); bài làm dở có `resume_expires_at` (mig 224); bài được giao qua `routers/class_student.py`. **Chưa có:** API khoá/lượt/đơn của G04 (`/api/me/courses`, `/api/me/credits`, `/api/enrollment-orders/me`), `services/learner_overdue.py`, `services/trial_caps.py` và `frontend/lib/course-access-labels.mjs` của GOI-11, sổ lỗi của GOI-12, bảng `course_lessons` của G07-T18, cờ `learner_v2` (grep `learner_v2|shell_v2` không ra gì ở `backend/services`, `frontend/lib`).

**Ngôn ngữ và đánh số.** Thân viết tiếng Việt theo gói; tiêu đề mục giữ tiếng Anh cho `validate_specs.py`. `FR-07-019…029` → `FR-019…FR-029` giữ số; `FR-07-029a`, `029b` và các yêu cầu rút từ hợp đồng 5.3, 5.6, 5.8 nhận số mới từ `FR-070` (chừa `FR-030…037`, `FR-060…066` cho bản sửa đổi theo đúng số của gói). Bản sửa đổi 1: `FR-07-030…037` → `FR-030…FR-037` giữ số; hub Luyện tập, Thi thử (gói chỉ ghi ở nhiệm vụ G07-T16, không có số FR) nhận số mới từ `FR-079`. `FR-060…066` vẫn chừa cho bản sửa đổi 2.

## Quyết định đã có

- **Xác nhận đơn là kích hoạt tài khoản; tài khoản chưa có khoá vẫn về Hôm nay trạng thái "Chưa có khoá"** (00 mục 2 điểm 20; gói mục 10 câu 12). Phần mở cổng kích hoạt là G07-T26, thuộc bản sửa đổi; ở spec này trạng thái `no_course` và `order_pending` được dựng và kiểm bằng dữ liệu giả.
- **Speaking luôn AI chấm và trả ngay; Writing của lớp offline chờ giáo viên duyệt** (00 mục 2 điểm 3, 20; gói câu 9): "Vừa có kết quả" chỉ đếm bài đã thật sự trả (`delivered` với Writing).
- **Một kho lượt chung cho Writing và Speaking, tách theo nguồn online/lớp** (COURSEACCESS-0055, anh Andy duyệt 20/11).
- **"Lỗi đang lặp lại" lấy từ Sổ lỗi cá nhân của GOI-12** (00 mục 2 điểm 23; gói câu 14): G07 không tự tổng hợp lỗi, chỉ đọc qua một hàm ghép.
- **Các tờ Đợt 4 đã được duyệt 17/11** (gói câu 11). Tờ HomNayTrangThai: theo 00 mục 6 (sửa 18/11), khối nào tờ ghi là đề xuất ("Học trước trong lúc chờ", HV-12) thì không dựng (gói câu 17).
- **Không có ô hỏi đồng ý dùng bản ghi âm** (anh Andy 18/11/2026: bỏ khỏi đợt này).

## Problem

Trang chủ học viên hiện là bảng điểm (`GET /api/student/home-summary`, 7 phần song song) không cho biết bài tiếp theo trong khoá, bài giáo viên giao đến hạn, bài đang làm dở hay lượt AI còn lại. Học viên phải mở Lớp học, từng hub kỹ năng để tự gom việc. Sau khi bán khoá online (G04, G05), Hôm nay còn phải phân biệt người chưa có khoá, người có đơn đang chờ, người vừa có khoá, người sắp hết hạn hoặc hết lượt. Thay màn đang dùng cho mọi người cùng lúc là rủi ro: cần bật theo từng người và tắt khẩn được.

## Scope

- Cờ giao diện `learner_v2` theo tiền lệ hai khoá của `vocab_curated`, trường `learner_v2_enabled` trong `/auth/me`, endpoint admin bật/tắt theo người, hàm đọc mềm ở frontend.
- API đọc `GET /api/student/today` (một lần gọi cho cả trang, phần lỗi vào `degraded`, chỉ đọc), API ghi mốc `POST /api/student/today/seen` và hai cột con trỏ `users.today_seen_at`, `users.today_seen_key`.
- Cây Hôm nay mới ở `/home` (sau cờ), năm trạng thái, các khối FR-019…FR-029, FR-070, FR-071; bản máy tính và điện thoại theo tờ Main, HomNayTrangThai, Mobile, GiaHanThemLuot.
- (Bản sửa đổi 1, G07-T15) Lộ trình `/course` trong nhóm route mới `app/(authed-course)/`, API đọc `GET /api/student/course`; danh sách bài đọc `GET /api/course/{course_code}/lessons` của COURSELESSON-0064 khi API đó có. Theo tờ LoTrinh.
- (Bản sửa đổi 1, G07-T16) Hub `/practice` trong nhóm route mới `app/(authed-practice-hub)/`, hub `/tests` (trang LEARNERNAV-0062 T12a đã dời), API đọc `GET /api/student/tests`. Theo tờ LuyenTap, ThiThu, MockTestDuocGiao.

## Non-goals

- Không sửa `GET /api/student/home-summary` và cây Home cũ; xoá cây cũ là G07-T24 khi `learner_v2_all` bật ≥ 14 ngày không lỗi.
- Không sửa `_visible_assignments` hay `_decorate` của `routers/class_student.py`.
- Không mở `/home` hoặc `/api/student/today` cho tài khoản `is_active=false` (G07-T26, bản sửa đổi, high-risk auth). Ở spec này route mới vẫn chịu cổng kích hoạt như mọi route học viên.
- Không dựng bảng khoá/lượt/đơn, API số dư (G04), chuông và bộ đếm quá hạn (NOTIFY-0079), trần chấm thử (TRIALCAP-0080), sổ lỗi (GOI-12), bảng bài học (COURSELESSON-0064), khảo sát (GOI-13), danh sách kỳ thi được giao (G08/G09). Spec chỉ chừa trường và đọc khi có.
- Không dựng khối "Học trước trong lúc chờ" và không hiện band theo kỹ năng ở Hôm nay.
- Không bật `learner_v2_all` ở bất kỳ môi trường nào trong spec này.
- (Bản sửa đổi 1) Không dời `/my-class` → `/course/assigned` (Đợt 8 là LEARNERNAV-0062 T15u) và không dựng giao diện đầy đủ của "Bài được giao", "Buổi học và tài liệu lớp" (G07-T30). Lộ trình chỉ vẽ đầu thẻ và trỏ tới các trang đó khi chúng `live`.
- (Bản sửa đổi 1) Không dựng trang bài giảng, bảng `course_lessons`, API bài học (COURSELESSON-0064).
- (Bản sửa đổi 1) Không có đề bốn kỹ năng tự chọn, không nút "Thi thử 4 kỹ năng" (00 mục 2 điểm 22; tờ ThiThu còn vẽ: 00 thắng, PR ghi khác biệt). Không dựng bảng người dự thi `mock_exam_audiences` (G09-T31), không đổi cổng vào kỳ thi hay trình làm bài (G08), không đổi cổng điện thoại (PHONEGATE-0081) hay `CreditsEmptyNotice` (G07-T27, RESULTSHEET-0065): chỉ dùng.
- (Bản sửa đổi 1) Không sửa layout `(authed-practice)` (đang nạp `practice.js`) và các hub kỹ năng hiện có.

## Users and journeys

- Học viên lớp: thấy bài giao đến hạn, quá hạn; bấm mở đúng bài; thấy lượt lớp cấp.
- Học viên khoá online: thấy bài tiếp theo, tiếp video từ phút đã xem, hạn khoá và lượt.
- Người chưa có khoá hoặc có đơn đang chờ: thấy lối "Xem các khoá", "Nhập mã kích hoạt", trạng thái đơn (sau G07-T26 mới tới được trên thật).
- Admin: bật giao diện mới cho từng tài khoản QA trên staging; tắt khẩn cho mọi người.

## Requirements

- **FR-019:** Hôm nay chọn trạng thái theo thứ tự: có khoá đang học (`learning`; có quyền khoá online còn hạn mà chưa có dòng tiến độ bài học nào → `first_day`) → có đơn đang chờ xác nhận hoặc cần bổ sung (`order_pending`) → chưa có khoá (`no_course`). Dải `expiring`/`expired`/`out_of_credits` chồng lên trạng thái có khoá. Trạng thái do API trả (`state`, `banner`), frontend không tự suy lại.
- **FR-020:** Tiêu đề "Chào <tên>. Hôm nay bạn có <N> việc." với N = số bài được giao chưa nộp có hạn hôm nay hoặc ngày mai, cộng bài đã quá hạn, cộng 1 nếu còn bài tiếp theo của lộ trình; "Làm tiếp khi rảnh" không đếm. N = 0 → "Hôm nay không có bài đến hạn."; không bao giờ hiện "0 việc". Bài quá hạn xác định bằng `services/learner_overdue.py` của NOTIFY-0079 khi đã có, để chuông, Hôm nay, Lộ trình cho cùng một số; chưa có thì dùng `is_missing` của `_decorate`. Ngày "hôm nay"/"ngày mai" tính theo giờ Việt Nam. Phần bài được giao của N lấy từ `assigned_due_soon` (đếm trước khi cắt 5), không đếm số dòng hiện ra.
- **FR-021:** Thẻ "Bài tiếp theo trong lộ trình" hiện khoá, chặng, số bài, tên bài, thời lượng video, số câu luyện, vị trí xem dở; nút "Học tiếp từ phút M" hoặc "Bắt đầu bài". Ẩn hẳn khi `next_lesson` là null (không khoá online, hoặc bảng bài học chưa có).
- **FR-022:** Khối "Bài được giao, hạn hôm nay và ngày mai": tối đa 5 dòng, quá hạn lên đầu có nhãn chữ "Đã quá hạn", rồi hạn gần nhất; dòng dưới "Còn n bài hạn sau ngày mai, không tính vào việc hôm nay." với n = `assigned_due_later` (ẩn khi n = 0) kèm "Xem bài được giao"; nút mở **đúng bài** (href dựng bằng hàm của `frontend/lib/my-class-model.mjs`, không viết bộ dựng URL thứ hai). Dòng kỳ thi được giao (`mock_exams`) nằm trong khối suốt khoảng mở, không cộng vào N; kỳ có phần đang dở thì khối cảnh báo "bài thi đang dở" thắng dòng này. Bài kiểm tra của khoá ở chế độ "giáo viên công bố" không hiện `score` thô.
- **FR-023:** Khối "Làm tiếp khi rảnh" liệt kê bài có `resume_expires_at > now()` của chính người đó ở bốn loại có cột này (mig 224: Speaking `sessions`, Reading, Listening, chép chính tả), tối đa 4, mới nhất trước, nút "Làm tiếp". Bài Writing đang viết dở không có cột hạn làm tiếp nên không vào khối này; bài Writing được giao chưa nộp hiện ở khối bài được giao (FR-022).
- **FR-024:** Khối lượt chấm AI hiện một con số còn lại, một kho chung cho Writing và Speaking. Học viên lớp: nhãn "Lượt chấm AI lớp cấp cho bạn · cấp kèm mã lớp" và câu "Hết lượt thì liên hệ giáo viên để được cấp thêm"; học viên online: nhãn theo khoá, kèm hạn dùng lượt khi có. Có cả hai nguồn → hai dòng theo `credits.by_kind`. Dòng "Luyện Listening, Reading, từ vựng và ngữ pháp không tính lượt." Học viên lớp mã cũ không kèm lượt: ẩn khối. API lượt chưa có hoặc lỗi: ẩn khối, không hiện 0.
- **FR-025:** Khối "Vừa có kết quả": các bài được trả sau mốc đã xem (`users.today_seen_at`), mỗi lần tối đa hai bài **cũ nhất trong số chưa xem** (để không bài nào bị bỏ qua), vẽ mới nhất trước; nút "Mở phiếu" mở thẳng phiếu; không có bài mới thì ẩn cả khối. Writing chỉ tính bài `delivered`; bài kiểm tra khoá ở chế độ công bố không vào đây. Band theo kỹ năng không nằm ở Hôm nay.
- **FR-026:** Một phần dữ liệu lỗi chỉ làm hỏng khối của nó (API liệt kê phần đó trong `degraded`); các khối khác vẫn hiện. Phần chưa có (dịch vụ của gói khác chưa merge) không vào `degraded` và khối ẩn.
- **FR-027:** Trạng thái "Chưa có khoá" thay các khối học bằng lối "Xem các khoá" (href từ `coursesHref()`; cờ `AVER_PUBLIC_COMMERCE` tắt thì ẩn lối này, theo PUBLICSITE-0059 FR-029), "Nhập mã kích hoạt của lớp" (`/activate`), lối Thư viện và khối chấm thử; thanh trên thay "Lượt chấm AI còn" bằng "Chấm thử hôm nay còn N bài" khi `trial_today_left` có giá trị, không thì dùng câu biến thể của tờ. Lối tới trang chưa có (`/courses`, `/activate` của G05) theo quy tắc liên kết sống của G03 (không trỏ tới 404).
- **FR-028:** Trạng thái "Đơn chờ xác nhận / cần bổ sung" hiện mã đơn, khoá, trạng thái đơn theo nhãn học viên của G04, nút "Mở trang đơn" (`/enroll/[orderCode]`); đơn `needs_info` có nhãn Cảnh báo và hạn bổ sung (`supplement_by`). Thanh trên không có số lượt.
- **FR-029:** Dải trạng thái 5 hiện khi khoá online sắp hết hạn (`can_renew` của G04), đã hết hạn, hoặc vừa hết lượt; nhãn hành động "Đăng ký lại" lấy từ `frontend/lib/course-access-labels.mjs` (GOI-11 phần F); hết lượt dùng khối "Hết lượt chấm" chung (`CreditsEmptyNotice`, G07-T27; chưa có thì `Notice` của G03 cùng câu chữ). Ẩn dải sắp hết hạn khi đã có đơn đăng ký lại đang mở.
- **FR-070:** (FR-07-029a) Dòng "Mục tiêu <band> · còn N tuần tới ngày thi" chỉ hiện khi đã đặt mục tiêu (`users.target_band`); chưa có ngày thi thì chỉ "Mục tiêu <band>"; bấm mở `/progress` (liên kết sống: chưa có `/progress` thì dòng không phải liên kết). Ngày thi đã qua → không hiện số tuần.
- **FR-071:** (FR-07-029b) Khối "Lỗi đang lặp lại" là lỗi số 1 của Sổ lỗi cá nhân (GOI-12), đọc qua đúng một hàm ghép `_repeat_error_for(user_id) -> dict | None`; chỉ hiện khi hàm trả dữ liệu (từ 2 bài có nhận xét); nút "Ôn 10 phút" mở mục chữa lỗi của bài Grammar Wiki hoặc bài trong lộ trình; "Xem cả n lỗi" → `/progress`. Hàm trả `None`, ném lỗi, hoặc GOI-12 chưa merge → `repeat_error = null`, khối ẩn, `degraded` không đổi.
- **FR-072:** Cờ giao diện: `learner_v2_enabled = runtime_flags('learner_v2_all', default=False) OR (users.feature_flags.learner_v2 is True AND runtime_flags('learner_v2', default=False))`. `runtime_flags('learner_v2')` là công tắc tắt khẩn cho người bật lẻ; tắt nó thì trong thời gian bộ đệm cờ (15 giây) mọi người bật lẻ về giao diện cũ khi tải lại.
- **FR-073:** `/auth/me` có trường `learner_v2_enabled: bool` (mặc định `false`) ở cả hai nhánh đọc (đồng bộ và `USE_ASYNC_DB`). Frontend đọc mềm `me.learner_v2_enabled === true`; thiếu trường hoặc sai kiểu → `false`, không coi là mất phiên (không thêm vào danh sách bắt buộc của `normalizeAuthMe`).
- **FR-074:** Admin bật/tắt cờ theo từng người bằng `POST /admin/users/{user_id}/learner-v2-flag` theo mẫu `vocab-flag`, chỉ admin gọi được, ghi đúng khoá `learner_v2` trong `users.feature_flags`, đọc lại trả trạng thái thật sau khi ghi.
- **FR-075:** Cờ chỉ quyết định cây giao diện nào được vẽ ở `/home`; tắt cờ thì `/home` là giao diện cũ y nguyên (không đổi CSS, dữ liệu, lời gọi API của cây cũ). Chuyển hướng URL của LEARNERNAV-0062 không theo cờ.
- **FR-076:** `GET /api/student/today` chỉ đọc dữ liệu của chính người gọi (mọi truy vấn lọc tường minh theo `user_id`/`student_id`), chạy các phần song song, trả đúng khung ở plan.md với `response_model` khai báo; danh sách của gói khác chưa có trả `[]`/`null`. Cổng một phiên của G04 (khi có) vẫn áp: 409 `session_not_current` được frontend xử lý bằng màn của G05-T20, không phải lỗi trang.
- **FR-077:** Mọi khối G07 hiện band theo quy tắc gói 5.6: Writing ≥ 1 bài `delivered` có band; Speaking ≥ 1 buổi đã chấm có band; Listening/Reading ≥ 1 đề đủ 40 câu; Overall chỉ ở mock test được giao đủ bốn kỹ năng có band. Không bao giờ hiện "0/0", "—" đứng một mình, mã đề nội bộ, số lượt, band hay ngày hết hạn tự bịa khi API chưa có.
- **FR-078:** `GET /api/student/today` chỉ đọc, không ghi gì. Mốc đã xem chỉ tiến lên khi khối "Vừa có kết quả" đã thật sự vẽ: frontend gọi `POST /api/student/today/seen` với con trỏ `(seen_until, seen_key)` của bài mới nhất trong các bài vừa vẽ (`seen_key` = `<kind>:<id>`); máy chủ chỉ tiến con trỏ `(today_seen_at, today_seen_key)` lên theo thứ tự bộ và không nhận thời điểm trong tương lai. Nhiều bài trả cùng một thời điểm vẫn lần lượt hiện hết. Bài tải về mà không vẽ (lỗi vẽ, rời trang trước khi vẽ) và bài thứ ba trở đi vẫn hiện ở lần sau. Lỗi khi ghi mốc không hiện cho học viên (ghi log); lần sau khối hiện lại cùng bài.

### Bản sửa đổi 1 — Lộ trình (G07-T15) · PENDING, chưa duyệt

- **FR-030:** (FR-07-030) `/course` có ba thẻ (đầu thẻ là component G03): "Các khoá và bài học" (`/course`), "Bài được giao (n)", "Buổi học và tài liệu lớp" (chỉ hiện khi `has_class`). Đích của hai thẻ sau lấy từ route registry: "Bài được giao" là `/course/assigned` khi Đợt 8 đã chạy, trước đó `/my-class`; "Buổi học và tài liệu lớp" là `/course/class` khi trang đó `live`, chưa `live` thì thẻ không hiện. n = `assigned_open` (số bài được giao chưa nộp của các lớp đang hoạt động, đếm như `assigned_total_open` của FR-022); n = 0 thì thẻ chỉ ghi "Bài được giao", không ghi số.
- **FR-031:** (FR-07-031) Nhóm "Khoá online của bạn": mỗi quyền nguồn online (`GET /api/me/courses` của G04) một dòng: tên khoá, "còn X ngày" (`days_left`), tiến độ "a/b bài" khi COURSELESSON-0064 trả số bài (chưa có thì không có phần tiến độ), "Còn N lượt chấm AI" từ `credits.balance` của đúng dòng đó trong `items` (không dùng tổng `by_kind.online` của cả tài khoản; thiếu số thì không ghi). Quyền còn hạn lên trước, rồi quyền đã hết hạn (FR-037). Tiếp theo mục "Khoá online khác · dự kiến": sản phẩm đang mở hoặc sắp mở mà người đó chưa có quyền, từ danh mục khoá công khai của G04, nút "Xem khoá" → `/courses/[slug]`. Không có quyền online nào: câu trống của tờ LoTrinh và nút "Xem các khoá" (`coursesHref()`). Cờ `AVER_PUBLIC_COMMERCE` tắt thì ẩn nút "Xem khoá", "Xem các khoá" và mục "dự kiến" (như FR-027).
- **FR-032:** (FR-07-032) Nhóm "Khoá của lớp": tên lớp, tên giáo viên, khoá của lớp (cùng dữ liệu `GET /api/class/me` đang dùng), các khoá được cấp quyền luyện lại (quyền nguồn `class` của G04; G04 chưa có thì không có dòng này). Lớp đã lưu trữ không hiện (CLASSARCHIVE-0030). Không có lớp: câu trống và nút "Nhập mã kích hoạt" tới `/activate` (ENROLL-0060) khi trang đó `live`; chưa `live` thì không có nút.
- **FR-033:** (FR-07-033) Học viên chỉ có một dạng (chỉ online hoặc chỉ lớp): nhóm còn lại thu gọn thành một dòng (tiêu đề, câu trống, lối của nhóm), không biến mất. Dòng thu gọn mở ra được bằng chuột và bàn phím, có `aria-expanded`.
- **FR-034:** (FR-07-034) Danh sách bài của khoá đang chọn (mặc định: khoá online còn hạn có bài học gần nhất, không có thì khoá online đầu tiên, rồi khoá của lớp; trang nhớ lựa chọn bằng `?course=<course_code>`): chặng → bài, trạng thái bằng chữ Đã xong / Đang học / Tiếp theo / Chưa làm, đọc từ `GET /api/course/{course_code}/lessons`. Bài nào cũng mở được: không có trạng thái "Chưa mở" do thứ tự, "Tiếp theo" chỉ là gợi ý. Bài kiểm tra giữa chặng không có điều kiện ở đợt đầu (câu hỏi mở 7); nếu API trả `gate` thì dòng ghi đúng `gate.text_vi`. COURSELESSON-0064 chưa có, khoá chưa có bài `is_published`, hoặc API trả 404: ghi "Bài học của khoá sẽ mở dần", không để trống. API lỗi khác: chỉ khối danh sách báo "Chưa tải được bài học" và nút "Thử lại"; hai nhóm khoá vẫn hiện. Bấm bài → `/course/learn/{course_code}/{lesson_code}` khi trang đó `live`; chưa `live` thì dòng không phải liên kết.
- **FR-035:** (FR-07-035) Học viên có lớp mà không có quyền online nào (kể cả đã hết hạn) mở `/course` thì trang thay URL (`router.replace`) tới đích của thẻ "Bài được giao" (FR-030), không vẽ nhóm khoá trước. Không lớp, không khoá: không chuyển, hiện hai nhóm trống với lối của từng nhóm. Phần `class` hoặc `online` lỗi (`degraded`): không chuyển, vẽ trang với khối báo lỗi.
- **FR-036:** (FR-07-036) Dưới mỗi nhóm có ghi chú luồng chấm, câu chữ cố định: nhóm online "AI chấm và trả nhận xét ngay"; nhóm lớp "Speaking: AI chấm và trả ngay. Writing: AI chấm, giáo viên duyệt rồi mới trả" (00 mục 2 điểm 20; tờ ghi khác thì 00 thắng).
- **FR-037:** (FR-07-037) Khoá online đã hết hạn: dòng khoá có nhãn chữ "Đã hết hạn" và nút "Đăng ký lại" (nhãn và đích từ `frontend/lib/course-access-labels.mjs`; chỉ hiện khi `can_renew`; module chưa có thì không có nút, không gõ cứng nhãn). Danh sách bài của khoá vẫn xem được (giữ vị trí học); mở bài giảng bị máy chủ chặn theo COURSELESSON-0064, trang bài giảng hiện lối của spec đó.

### Bản sửa đổi 1 — Luyện tập và Thi thử (G07-T16) · PENDING, chưa duyệt

- **FR-079:** `/practice` ở nhóm route mới `(authed-practice-hub)` (không chạm layout `(authed-practice)` đang nạp `practice.js`). Trang có khối "Làm tiếp" lấy phần `resume` của `GET /api/student/today` (cùng quy tắc FR-023; không thêm API) và đúng 4 thẻ kỹ năng theo thứ tự Speaking · Writing · Listening · Reading, trỏ tới hub hiện có `/speaking`, `/writing/dashboard`, `/listening`, `/reading` qua `liveHref`. `resume` rỗng → khối ẩn; lỗi toàn phần hoặc `degraded` có `resume` → khối báo "Chưa tải được bài đang làm" và nút "Thử lại", 4 thẻ vẫn hiện. Thẻ không hiện band hay số lượt.
- **FR-080:** `/tests` khối 1 "Đề tự chọn": mỗi kỹ năng một dòng full test và một dòng mini test khi kỹ năng đó có loại đề ấy, trỏ tới trang chọn đề hiện có: Listening full `/listening/tests`, Listening mini `/listening/mini-test`, Reading full `/reading/test`, Reading mini `/reading/mini-test`, Speaking full test là lối full test trong `/speaking`, Writing full test là trang của G08. Đích lấy qua `liveHref`; đích chưa `live` → dòng không hiện (không bao giờ dẫn tới 404). Làm lúc nào cũng được, làm lại được; trang không ghi giới hạn số lần. Không có dòng, nút hay thẻ đề bốn kỹ năng tự chọn ở bất kỳ trạng thái nào.
- **FR-081:** Khối 2 "Mock test được giao" chỉ hiện khi `assigned_exams` có ít nhất một kỳ; không được giao kỳ nào thì không có khối này (không câu trống mời thi). Mỗi dòng: tên kỳ (không mã nội bộ); chế độ "Thi cùng giờ" (`live`) hoặc "Bắt đầu lúc nào cũng được trong thời gian mở" (`self_paced`), `mode` null thì không ghi; trạng thái bằng chữ, đúng một trong Sắp diễn ra · Đang mở · Đã thi, chờ kết quả · Đã có kết quả · Đã đóng, bạn chưa thi; giờ mở, giờ đóng theo giờ Việt Nam khi có; kỳ thiếu kỹ năng ghi "Gồm: <các kỹ năng có>". Kỳ `self_paced` thêm câu "Làm liền một mạch khoảng N phút. Đã bắt đầu thì không dừng giữa các phần." với N = `total_minutes` của API; thiếu N thì bỏ câu, không tự cộng ở frontend. Nút: Đang mở → "Vào thi" (có lượt dở thì "Làm tiếp") tới `href` của API; Đã có kết quả → "Xem kết quả"; trạng thái khác không có nút.
- **FR-082:** Khối 3 "Kết quả": các lượt đã nộp của chính người đó ở đề tự chọn và mock test được giao, mới nhất trước, 20 dòng mỗi lần và nút "Xem thêm" (con trỏ). Mỗi dòng: tên đề, loại ("Full test <kỹ năng>", "Mini test <kỹ năng>", "Mock test"), ngày nộp theo giờ Việt Nam, kết quả theo FR-077: full test Listening/Reading đủ 40 câu → band; mini test → "Đúng a trên b câu" (b > 0); Writing/Speaking đang chấm → "Đang chấm". Cột Overall chỉ có giá trị ở mock test được giao **có đủ bốn kỹ năng và cả bốn đã có band** (FR-077, gói 5.6); `overall_readiness` (G02-T05, `mock_exam_service.py`) là điều kiện thêm, không thay quy tắc này: nếu `MOCK_OVERALL_MIN_SKILLS` đặt dưới 4 thì quy tắc bốn kỹ năng vẫn thắng; đủ bốn kỹ năng mà còn phần chờ → "Chưa có Overall: còn chờ chấm <kỹ năng>"; mọi dòng khác ô Overall để trống (nhãn cho trình đọc màn hình "Không có Overall"), không "—" đứng một mình. Bấm dòng → trang kết quả của lượt đó qua `liveHref`. Chưa có lượt nào: "Bạn chưa nộp bài thi nào."
- **FR-083:** Vùng nhìn dưới `fullTestMinViewportPx` (768px): nút vào full test ở khối 1 và nút "Vào thi"/"Làm tiếp" ở khối 2 thay bằng dòng Cảnh báo của PHONEGATE-0081 (FR-050, câu chữ và component của spec đó); dòng mini test giữ nguyên nút (PHONEGATE-0081 FR-053). Trang hub không tự chặn gì khác; cổng thật vẫn ở trang vào thi.
- **FR-084:** Không đủ lượt: dòng full test Writing (2 lượt) hoặc Speaking (3 lượt, đơn vị của G04) khi `credits.total` nhỏ hơn số lượt cần vẫn hiện, ghi "Không đủ lượt", nút vào thay bằng "Xem cách thêm lượt" mở `CreditsEmptyNotice` (chưa có thì `Notice` của G03 cùng câu chữ, như T14). `credits` null (G04 chưa có, lỗi, học viên lớp mã cũ) → không đánh dấu dòng nào; máy chủ vẫn là nơi chặn (402 `insufficient_credits`). Listening, Reading và khối 2 không xét lượt ở trang này.
- **FR-085:** `GET /api/student/course` và `GET /api/student/tests` theo đúng FR-076: chỉ đọc, chỉ dữ liệu của người gọi (lọc tường minh theo `user_id`/`student_id`), `response_model` khai báo, phần lỗi vào `degraded`, nguồn của gói khác chưa có trả rỗng hoặc `null` (không vào `degraded`), cùng cổng kích hoạt và cổng một phiên như mọi route học viên. Mỗi điểm ghép với gói khác là một hàm trong service.
- **FR-086:** Cờ: `/course`, `/practice`, `/tests` vẽ cây mới chỉ khi `learnerV2Enabled(me)` (FR-073). Tắt cờ: `/tests` vẽ trang tạm Thi thử của LEARNERNAV-0062 T12a y nguyên; `/course` và `/practice` (chưa có trang cũ) thay URL tới trang tạm hiện nay của mục đó trong `NAV_PLAN` (`/my-class`, hoặc `/course/assigned` sau Đợt 8; `/speaking`) và không gọi API mới. PR T15, T16 đổi `/course`, `/practice` sang `live` trong `route-registry.mjs` cùng commit với trang (thanh 5 mục trỏ thẳng tới hai URL đó).

## Acceptance scenarios

### Scenario 1 — Học viên chỉ lớp

- **Given** tài khoản QA thuộc lớp thử có 2 bài quá hạn, 1 bài hạn ngày mai, cờ `learner_v2` bật cho người đó
- **When** mở `/home`
- **Then** thấy "Hôm nay bạn có 3 việc", hai bài quá hạn có nhãn "Đã quá hạn" lên đầu, không có thẻ "Bài tiếp theo"; bấm bài Writing mở đúng trình soạn của bài đó

### Scenario 2 — Tắt khẩn

- **Given** cờ `learner_v2` bật cho tài khoản QA và đang thấy Hôm nay mới
- **When** admin tắt `runtime_flags('learner_v2')` và học viên tải lại `/home` sau 15 giây
- **Then** thấy giao diện cũ y nguyên (so ảnh trước/sau)

### Scenario 3 — Một khối hỏng

- **Given** phần `resume` của API ném lỗi
- **When** mở `/home`
- **Then** `degraded` có `resume`, khối "Làm tiếp khi rảnh" báo không tải được, các khối khác hiện đủ

### Scenario 4 — Trạng thái không khoá và đơn chờ (dữ liệu giả)

- **Given** API trả `state: no_course` rồi `state: order_pending` với một đơn `needs_info`
- **When** cây Hôm nay vẽ
- **Then** lần lượt thấy "Xem các khoá", "Nhập mã kích hoạt của lớp", lối Thư viện; rồi mã đơn, nhãn Cảnh báo, hạn bổ sung, nút "Mở trang đơn"; không có số lượt trên thanh

### Scenario 5 — Vừa có kết quả

- **Given** bài Writing của QA chuyển sang `delivered` sau lần vào Hôm nay trước
- **When** mở `/home`, rồi tải lại
- **Then** lần đầu có khối "Vừa có kết quả" với nút "Mở phiếu" mở thẳng phiếu; lần tải lại sau đó không còn bài đó

### Scenario 6 — Bật cờ theo người

- **Given** admin trên staging
- **When** gọi `POST /admin/users/{QA}/learner-v2-flag` bật, rồi tắt
- **Then** `/auth/me` của QA trả `learner_v2_enabled` true rồi false; tài khoản khác không đổi

### Scenario 7 — Lộ trình, học viên chỉ lớp

- **Given** tài khoản QA chỉ có lớp, không quyền online, cờ bật
- **When** mở `/course`
- **Then** URL đổi sang trang bài được giao (`/my-class`, hoặc `/course/assigned` sau Đợt 8), không thấy nhóm khoá chớp lên trước

### Scenario 8 — Lộ trình, học viên chỉ online (dữ liệu giả tới khi G04 có)

- **Given** API trả một quyền online còn 12 ngày, `class: null`, COURSELESSON-0064 chưa có
- **When** cây Lộ trình vẽ
- **Then** dòng khoá ghi "còn 12 ngày"; nhóm "Khoá của lớp" thu gọn, mở ra thấy câu trống; danh sách bài ghi "Bài học của khoá sẽ mở dần"; không có thẻ "Buổi học và tài liệu lớp"

### Scenario 9 — Thi thử, không được giao kỳ nào

- **Given** `assigned_exams: []`
- **When** mở `/tests`
- **Then** không có khối "Mock test được giao"; khối đề tự chọn chỉ có full test từng kỹ năng và mini test; không có nút hay thẻ đề bốn kỹ năng

### Scenario 10 — Kỳ self_paced thiếu Speaking

- **Given** một kỳ `self_paced`, `skills` = Listening, Reading, Writing, `total_minutes` 160, đã có kết quả cả ba phần
- **When** mở `/tests`
- **Then** dòng ghi "Gồm: Listening, Reading, Writing" và "Làm liền một mạch khoảng 160 phút. Đã bắt đầu thì không dừng giữa các phần."; dòng kết quả của kỳ không có Overall

### Scenario 11 — Điện thoại và thiếu lượt

- **Given** vùng nhìn 390px, `credits.total` = 1
- **When** mở `/tests`
- **Then** nút full test thành dòng Cảnh báo của PHONEGATE-0081, nút mini test vẫn bấm được; ở 1280px dòng full test Writing ghi "Không đủ lượt" với nút "Xem cách thêm lượt", full test Listening vẫn có nút vào

### Scenario 12 — Tắt cờ ở ba trang mới

- **Given** cờ tắt cho QA
- **When** mở `/course`, `/practice`, `/tests`
- **Then** lần lượt về trang tạm của Lộ trình, `/speaking`, và trang tạm Thi thử y nguyên; không có lời gọi `/api/student/course` hay `/api/student/tests`

## Edge cases

- Học viên vừa lớp vừa online: hai dòng lượt theo nguồn, một tổng.
- Lớp đã lưu trữ (CLASSARCHIVE-0030): bài của lớp không hiện.
- Quyền khoá hết hạn hôm nay; học viên lớp mã cũ không kèm lượt (không có khối lượt).
- `assigned` rỗng nhưng `has_class: true`: khối bài được giao ẩn, N chỉ đếm bài tiếp theo.
- Bài dở hết `resume_expires_at` đúng phút mở trang: không hiện.
- API lượt trả lỗi → khối ẩn, các khối khác còn.
- Tên khoá/bài dài trên 390px: cắt "…", không tràn ngang.
- `/auth/me` từ backend cũ (chưa có trường) khi frontend lên trước: `learner_v2_enabled` coi là false, không ai bị đẩy ra `/login`.
- 409 `session_not_current` ở `/api/student/today` (sau khi G04 có cổng một phiên).
- Ghi mốc đã xem thất bại: lần sau thấy lại cùng bài (chấp nhận, không mất bài).
- Có ba bài mới trở lên: lần này hiện hai bài cũ nhất, lần sau hiện bài kế tiếp (FR-025).
- Hai tab mở cùng lúc: mốc chỉ tiến lên, tab gửi con trỏ nhỏ hơn không kéo lùi mốc.
- (Bản sửa đổi 1) Học viên có khoá online đã hết hạn và có lớp: không chuyển sang bài được giao (FR-035 chỉ chuyển khi không có quyền online nào); dòng khoá ghi "Đã hết hạn".
- (Bản sửa đổi 1) `?course=` trỏ khoá người đó không có: bỏ qua, chọn khoá mặc định.
- (Bản sửa đổi 1) Kỳ thi `live` đã qua giờ đóng mà học viên chưa thi: "Đã đóng, bạn chưa thi", không nút (trước G09-T31 trạng thái này chưa tính được, kỳ không hiện; câu hỏi mở 8).
- (Bản sửa đổi 1) Lượt full test Listening chưa đủ 40 câu (nộp sớm): ghi "Đúng a trên b câu", không band.
- (Bản sửa đổi 1) Mở `/practice/session` (trình luyện Speaking) không bị ảnh hưởng bởi trang `/practice` ở nhóm khác: kiểm `route-ownership-check --manifest` sau build.
- Không thực hiện trên production: bật cờ, chạy migration, nộp bài.

## Success criteria

- Trên staging, ba tài khoản QA (chỉ lớp, chỉ online khi G04 có dữ liệu thử, cả hai) thấy đúng số việc và mở đúng bài từ Hôm nay ở 1280px và 390px.
- Tắt khẩn đưa mọi người bật lẻ về giao diện cũ trong ≤ 15 giây, không lỗi trang.
- Không khối nào hiện số 0, band hay hạn tự bịa khi API nguồn chưa có (kiểm bằng test React với từng nguồn null).
- (Bản sửa đổi 1) Trên staging, tài khoản QA chỉ lớp, chỉ online (khi G04 có dữ liệu thử) và cả hai thấy đúng nhóm khoá ở `/course`; `/tests` của tài khoản không được giao kỳ nào không có khối 2, có kỳ thì đúng trạng thái; ảnh 1280px và 390px.
- (Bản sửa đổi 1) Test React chứng minh không có đề bốn kỹ năng tự chọn ở mọi tổ hợp dữ liệu và Overall chỉ ở dòng mock test được giao đủ bốn kỹ năng.
- `GET /api/student/today` p95 ≤ 800 ms (ngưỡng đề xuất, chưa có số đo) trên staging với một học viên có lớp (đo trong log, ghi vào PR T13).

## Related specifications

- LEARNERNAV-0062: khung 5 mục, danh mục trang, đường dẫn `/course/...`, `/tests/...`.
- UIBASE-0056: `LearnerShell`, `Notice`, token `--av2-`.
- COURSEACCESS-0055 (G04): quyền khoá, kho lượt chung, đơn đăng ký, cổng một phiên.
- NOTIFY-0079 (GOI-11 A): `services/learner_overdue.py`; TRIALCAP-0080 (GOI-11 B): `services/trial_caps.py`; COURSETESTRELEASE-0082 (GOI-11 E): khối `course_test`.
- ENROLL-0060, PUBLICSITE-0059 (G05): `/courses`, `/activate`, `/enroll/[orderCode]`.
- CLASSARCHIVE-0030: lớp lưu trữ không hiện với học viên.
- ADMINIA-0074 / mig 452: mục tiêu band đồng bộ admin ↔ học viên.
- (Bản sửa đổi 1) COURSELESSON-0064: `GET /api/course/{course_code}/lessons`, trang bài giảng, chặn bài khi hết quyền. RESULTSHEET-0065 / G07-T27: `CreditsEmptyNotice`. PHONEGATE-0081: cổng điện thoại FR-050…053. G09-T31 / G08: danh sách người dự thi, API kỳ thi phía học viên. LEARNERNAV-0062 T12a (trang tạm `/tests`), T15u (Đợt 8).

## Open questions

| # | Câu hỏi | Đề xuất | Mặc định tạm |
|---|---|---|---|
| 1 | (mới, khi soạn) "Vừa có kết quả" cần nhớ lần vào Hôm nay trước. Thêm cột `users.today_seen_at` (một migration nhỏ trong dải 420–439, spec giữ `risk: high`) hay bỏ cột, hiện bài trả trong 72 giờ gần nhất (không migration, spec hạ về `medium`, nhưng bài đã xem vẫn hiện lại tới hết 72 giờ)? | Thêm cột: đúng ý tờ thiết kế (đã mở thì không hiện lại), chỉ một cột nullable, rollback đơn giản | Thêm cột |
| 2 | (gói câu 13) Bật giao diện mới theo người là đủ, hay cần theo lớp? | Theo người, cộng script chạy vòng thành viên một lớp khi cần | Theo người |
| 3 | (gói câu 14, phần còn mở) Khối "Lỗi đang lặp lại" bật ngay khi GOI-12 merge, hay chờ anh xem dữ liệu thật trên staging trước? | Bật theo dữ liệu: có dữ liệu sổ lỗi thì hiện | `repeat_error = null`, ẩn tới khi API sổ lỗi có dữ liệu |
| 4 | (mới, khi soạn) Phần còn lại của LEARNERCORE (Lộ trình, hub, Tài khoản, Tiến độ, Trợ giúp, "Lần đầu vào", mở `/home` cho tài khoản chưa kích hoạt) viết thành bản sửa đổi spec này hay một spec số mới? | Bản sửa đổi của 0063, chia hai bản để mỗi lần duyệt nhỏ: bản 1 (T15, T16) có ở đây, bản 2 (T17, T26) sau | Bản sửa đổi |

| 5 | (mới, khi soạn) Lần đầu vào Hôm nay (mốc đã xem còn trống), "Vừa có kết quả" lấy bài trả trong bao lâu trước đó? | 7 ngày gần nhất: đủ để thấy bài vừa trả, không đổ cả lịch sử | 7 ngày |
| 6 | (bản sửa đổi 1) `/course`, `/practice`, `/tests` có theo cờ `learner_v2` không? | Theo cờ (FR-086): cùng một công tắc bật theo người và tắt khẩn như Hôm nay; người tắt cờ chỉ thêm một lần đổi URL về trang tạm như hôm nay | Theo cờ |
| 7 | (gói câu 15) Bài kiểm tra giữa chặng của khoá online có giữ điều kiện "học xong các bài của chặng" không? | Không giữ ở đợt đầu: khớp "bài nào cũng mở được" của tờ LoTrinh | Không giữ (API không trả `gate`) |
| 8 | (bản sửa đổi 1) Trước khi G09-T31 có danh sách người dự thi, khối "Mock test được giao" lấy dữ liệu nào? | Chỉ kỳ người đó thật sự được giao: kỳ có `cohort_id` mà người đó trong nhóm, kỳ thi lại có `mock_exam_assignments` của người đó, hoặc kỳ người đó đã có lượt thi; kỳ mở cho mọi người (`cohort_id` null, không phải thi lại) **không** vào khối này (không phải "được giao"; vẫn vào được từ trang tạm khi tắt cờ). `mode` null; chỉ hiện được Đang mở, Đã thi chờ kết quả, Đã có kết quả. G09-T31 merge thì thay một hàm `_assigned_exams_for` | Dữ liệu hiện có, ghi trong PR T16 |

Câu 9, 11, 12 của gói đã được trả lời (mục "Quyết định đã có"). Lộ trình và hai hub (G07-T15, T16) có ở bản sửa đổi 1; Tài khoản, Tiến độ, Trợ giúp, Hồ sơ, "Lần đầu vào" (G07-T17) và T26 đến ở bản sửa đổi 2 (câu 4); LEARNERNAV-0062 chỉ dời URL của các trang đó.
