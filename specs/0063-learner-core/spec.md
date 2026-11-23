---
id: LEARNERCORE-0063
title: Signed-in learners open Today to see what to do now in one of five states, from one read API, behind a per-learner switch that an admin can turn off in seconds
status: draft
risk: high
owner: product
---

# Signed-in learners open Today to see what to do now in one of five states, from one read API, behind a per-learner switch that an admin can turn off in seconds

Status: **draft** — soạn ngày 23/11/2026 cho nhiệm vụ `G07-T02` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-07-loi-hoc-vien.md` mục 4.3, 5.3, 5.6, 5.8, 6 (T05, T13, T14), 9 và mục 10. Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục và `status` đổi sang `approved`. Số spec 0063 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6.

## Tóm tắt (tiếng Việt)

**Người dùng thấy gì.** Học viên đăng nhập, mở Hôm nay (`/home`) trong khung 5 mục và thấy ngay việc cần làm:
- "Chào <tên>. Hôm nay bạn có N việc." — N đếm bài được giao đến hạn hôm nay, ngày mai và bài đã quá hạn, cộng 1 nếu còn bài tiếp theo trong lộ trình. Không bao giờ hiện "0 việc".
- Thẻ "Bài tiếp theo trong lộ trình", khối "Bài được giao" (quá hạn lên đầu, mở đúng bài), "Làm tiếp khi rảnh", khối lượt chấm AI (một con số chung cho Writing và Speaking), "Vừa có kết quả", "Lỗi đang lặp lại", dòng mục tiêu band và số tuần tới ngày thi.
- Năm trạng thái theo tờ HomNayTrangThai: (1) có khoá, đang học; (2) chưa có khoá; (3) đơn chờ xác nhận hoặc cần bổ sung; (4) ngày đầu có khoá; (5) dải sắp hết hạn, đã hết hạn hoặc hết lượt chồng lên trạng thái có khoá.
- Khối nào lỗi thì chỉ khối đó ẩn hoặc báo lỗi, các khối khác vẫn hiện. Khi chưa có dữ liệu (API lượt chưa có, sổ lỗi chưa có) khối ẩn, không hiện số 0 tự bịa.
- Giao diện mới chỉ hiện cho người được bật cờ `learner_v2`; tắt cờ (công tắc khẩn) thì trong 15 giây mọi người về giao diện cũ y nguyên.

**Phạm vi spec này (theo brief Q68).** Ba nhiệm vụ: cờ `learner_v2` (G07-T05), API `GET /api/student/today` (G07-T13), Hôm nay mới năm trạng thái (G07-T14). Các phần còn lại mà gói xếp vào LEARNERCORE (Lộ trình FR-07-030…036, hub Luyện tập/Thi thử, Tài khoản, Tiến độ, Trợ giúp, Hồ sơ, "Lần đầu vào" FR-07-060…066, mở `/home` cho tài khoản `is_active=false` G07-T26) sẽ được thêm bằng **một bản sửa đổi spec này** trước khi G07-T15/T16/T17/T26 bắt đầu, để lần duyệt đầu nhỏ và xem được.

**Vì sao `risk: high`.** Gói ghi `medium`, nhưng khi đối chiếu staging `e940c936`: cột "lần vào Hôm nay trước" (`users.today_seen_at`) mà FR-025 cần **chưa có** → cần một migration nhỏ (dải 420–439 của G07), và mọi PR có file migration bị cổng spec buộc lớp `high-risk`, nên spec phải `high`. Câu hỏi mở 1 hỏi anh có muốn bỏ migration (dùng cửa sổ thời gian) để hạ về `medium` không.

**Đã có ở staging `e940c936`.** Khung `LearnerShell` của G03 (#2445); mục tiêu band và ngày thi đã lưu ở `users.target_band`, `users.exam_date` (mig 005; mig 452 đồng bộ mục tiêu admin ↔ học viên); bài làm dở có `resume_expires_at` (mig 224); bài được giao qua `routers/class_student.py`. **Chưa có:** API khoá/lượt/đơn của G04 (`/api/me/courses`, `/api/me/credits`, `/api/enrollment-orders/me`), `services/learner_overdue.py` và `services/trial_caps.py` của GOI-11, sổ lỗi của GOI-12, bảng `course_lessons` của G07-T18, cờ `learner_v2` (grep `learner_v2|shell_v2` không ra gì ở `backend/services`, `frontend/lib`).

**Ngôn ngữ và đánh số.** Thân viết tiếng Việt theo gói; tiêu đề mục giữ tiếng Anh cho `validate_specs.py`. `FR-07-019…029` → `FR-019…FR-029` giữ số; `FR-07-029a`, `029b` và các yêu cầu rút từ hợp đồng 5.3, 5.6, 5.8 nhận số mới từ `FR-070` (chừa `FR-030…036`, `FR-060…066` cho bản sửa đổi theo đúng số của gói).

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
- API đọc `GET /api/student/today` (một lần gọi cho cả trang, phần lỗi vào `degraded`) và cột `users.today_seen_at`.
- Cây Hôm nay mới ở `/home` (sau cờ), năm trạng thái, các khối FR-019…FR-029, FR-070, FR-071; bản máy tính và điện thoại theo tờ Main, HomNayTrangThai, Mobile, GiaHanThemLuot.

## Non-goals

- Không sửa `GET /api/student/home-summary` và cây Home cũ; xoá cây cũ là G07-T24 khi `learner_v2_all` bật ≥ 14 ngày không lỗi.
- Không sửa `_visible_assignments` hay `_decorate` của `routers/class_student.py`.
- Không mở `/home` hoặc `/api/student/today` cho tài khoản `is_active=false` (G07-T26, bản sửa đổi, high-risk auth). Ở spec này route mới vẫn chịu cổng kích hoạt như mọi route học viên.
- Không dựng bảng khoá/lượt/đơn, API số dư (G04), chuông và bộ đếm quá hạn (NOTIFY-0079), trần chấm thử (TRIALCAP-0080), sổ lỗi (GOI-12), bảng bài học (COURSELESSON-0064), khảo sát (GOI-13), danh sách kỳ thi được giao (G08/G09). Spec chỉ chừa trường và đọc khi có.
- Không dựng khối "Học trước trong lúc chờ" và không hiện band theo kỹ năng ở Hôm nay.
- Không bật `learner_v2_all` ở bất kỳ môi trường nào trong spec này.

## Users and journeys

- Học viên lớp: thấy bài giao đến hạn, quá hạn; bấm mở đúng bài; thấy lượt lớp cấp.
- Học viên khoá online: thấy bài tiếp theo, tiếp video từ phút đã xem, hạn khoá và lượt.
- Người chưa có khoá hoặc có đơn đang chờ: thấy lối "Xem các khoá", "Nhập mã kích hoạt", trạng thái đơn (sau G07-T26 mới tới được trên thật).
- Admin: bật giao diện mới cho từng tài khoản QA trên staging; tắt khẩn cho mọi người.

## Requirements

- **FR-019:** Hôm nay chọn trạng thái theo thứ tự: có khoá đang học (`learning`; có quyền khoá online còn hạn mà chưa có dòng tiến độ bài học nào → `first_day`) → có đơn đang chờ xác nhận hoặc cần bổ sung (`order_pending`) → chưa có khoá (`no_course`). Dải `expiring`/`expired`/`out_of_credits` chồng lên trạng thái có khoá. Trạng thái do API trả (`state`, `banner`), frontend không tự suy lại.
- **FR-020:** Tiêu đề "Chào <tên>. Hôm nay bạn có <N> việc." với N = số bài được giao chưa nộp có hạn hôm nay hoặc ngày mai, cộng bài đã quá hạn, cộng 1 nếu còn bài tiếp theo của lộ trình; "Làm tiếp khi rảnh" không đếm. N = 0 → "Hôm nay không có bài đến hạn."; không bao giờ hiện "0 việc". Bài quá hạn xác định bằng `services/learner_overdue.py` của NOTIFY-0079 khi đã có, để chuông, Hôm nay, Lộ trình cho cùng một số; chưa có thì dùng `is_missing` của `_decorate`. Ngày "hôm nay"/"ngày mai" tính theo giờ Việt Nam.
- **FR-021:** Thẻ "Bài tiếp theo trong lộ trình" hiện khoá, chặng, số bài, tên bài, thời lượng video, số câu luyện, vị trí xem dở; nút "Học tiếp từ phút M" hoặc "Bắt đầu bài". Ẩn hẳn khi `next_lesson` là null (không khoá online, hoặc bảng bài học chưa có).
- **FR-022:** Khối "Bài được giao, hạn hôm nay và ngày mai": tối đa 5 dòng, quá hạn lên đầu có nhãn chữ "Đã quá hạn", rồi hạn gần nhất; dòng dưới "Còn n bài hạn sau ngày mai, không tính vào việc hôm nay." kèm "Xem bài được giao"; nút mở **đúng bài** (href dựng bằng hàm của `frontend/lib/my-class-model.mjs`, không viết bộ dựng URL thứ hai). Dòng kỳ thi được giao (`mock_exams`) nằm trong khối suốt khoảng mở, không cộng vào N; kỳ có phần đang dở thì khối cảnh báo "bài thi đang dở" thắng dòng này. Bài kiểm tra của khoá ở chế độ "giáo viên công bố" không hiện `score` thô.
- **FR-023:** Khối "Làm tiếp khi rảnh" liệt kê bài có `resume_expires_at > now()` của chính người đó, tối đa 4, mới nhất trước, nút "Làm tiếp".
- **FR-024:** Khối lượt chấm AI hiện một con số còn lại, một kho chung cho Writing và Speaking. Học viên lớp: nhãn "Lượt chấm AI lớp cấp cho bạn · cấp kèm mã lớp" và câu "Hết lượt thì liên hệ giáo viên để được cấp thêm"; học viên online: nhãn theo khoá, kèm hạn dùng lượt khi có. Có cả hai nguồn → hai dòng theo `credits.by_kind`. Dòng "Luyện Listening, Reading, từ vựng và ngữ pháp không tính lượt." Học viên lớp mã cũ không kèm lượt: ẩn khối. API lượt chưa có hoặc lỗi: ẩn khối, không hiện 0.
- **FR-025:** Khối "Vừa có kết quả": tối đa hai bài được trả kể từ lần vào Hôm nay trước (`users.today_seen_at`), mới nhất trước, nút "Mở phiếu" mở thẳng phiếu; không có bài mới thì ẩn cả khối. Writing chỉ tính bài `delivered`; bài kiểm tra khoá ở chế độ công bố không vào đây. Band theo kỹ năng không nằm ở Hôm nay.
- **FR-026:** Một phần dữ liệu lỗi chỉ làm hỏng khối của nó (API liệt kê phần đó trong `degraded`); các khối khác vẫn hiện. Phần chưa có (dịch vụ của gói khác chưa merge) không vào `degraded` và khối ẩn.
- **FR-027:** Trạng thái "Chưa có khoá" thay các khối học bằng lối "Xem các khoá" (`/courses`), "Nhập mã kích hoạt của lớp" (`/activate`), lối Thư viện và khối chấm thử; thanh trên thay "Lượt chấm AI còn" bằng "Chấm thử hôm nay còn N bài" khi `trial_today_left` có giá trị, không thì dùng câu biến thể của tờ. Lối tới trang chưa có (`/courses`, `/activate` của G05) theo quy tắc liên kết sống của G03 (không trỏ tới 404).
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
- **FR-078:** `users.today_seen_at` được cập nhật thành thời điểm trả lời sau khi `/api/student/today` tính xong `new_results` cho người đó; lỗi khi ghi cột không làm hỏng phản hồi (ghi log, phản hồi vẫn 200) và lần sau tính lại từ giá trị cũ.

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
- Ghi `today_seen_at` thất bại: phản hồi vẫn đúng, lần sau có thể thấy lại cùng bài mới (chấp nhận, không mất bài).
- Hai tab mở cùng lúc: tab sau có thể không còn "Vừa có kết quả" (đúng theo FR-025).
- Không thực hiện trên production: bật cờ, chạy migration, nộp bài.

## Success criteria

- Trên staging, ba tài khoản QA (chỉ lớp, chỉ online khi G04 có dữ liệu thử, cả hai) thấy đúng số việc và mở đúng bài từ Hôm nay ở 1280px và 390px.
- Tắt khẩn đưa mọi người bật lẻ về giao diện cũ trong ≤ 15 giây, không lỗi trang.
- Không khối nào hiện số 0, band hay hạn tự bịa khi API nguồn chưa có (kiểm bằng test React với từng nguồn null).
- `GET /api/student/today` p95 ≤ 800 ms (ngưỡng đề xuất, chưa có số đo) trên staging với một học viên có lớp (đo trong log, ghi vào PR T13).

## Related specifications

- LEARNERNAV-0062: khung 5 mục, danh mục trang, đường dẫn `/course/...`, `/tests/...`.
- UIBASE-0056: `LearnerShell`, `Notice`, token `--av2-`.
- COURSEACCESS-0055 (G04): quyền khoá, kho lượt chung, đơn đăng ký, cổng một phiên.
- NOTIFY-0079 (GOI-11 A): `services/learner_overdue.py`; TRIALCAP-0080 (GOI-11 B): `services/trial_caps.py`; COURSETESTRELEASE-0082 (GOI-11 E): khối `course_test`.
- ENROLL-0060, PUBLICSITE-0059 (G05): `/courses`, `/activate`, `/enroll/[orderCode]`.
- CLASSARCHIVE-0030: lớp lưu trữ không hiện với học viên.
- ADMINIA-0074 / mig 452: mục tiêu band đồng bộ admin ↔ học viên.

## Open questions

| # | Câu hỏi | Đề xuất | Mặc định tạm |
|---|---|---|---|
| 1 | (mới, khi soạn) "Vừa có kết quả" cần nhớ lần vào Hôm nay trước. Thêm cột `users.today_seen_at` (một migration nhỏ trong dải 420–439, spec giữ `risk: high`) hay bỏ cột, hiện bài trả trong 72 giờ gần nhất (không migration, spec hạ về `medium`, nhưng bài đã xem vẫn hiện lại tới hết 72 giờ)? | Thêm cột: đúng ý tờ thiết kế (đã mở thì không hiện lại), chỉ một cột nullable, rollback đơn giản | Thêm cột |
| 2 | (gói câu 13) Bật giao diện mới theo người là đủ, hay cần theo lớp? | Theo người, cộng script chạy vòng thành viên một lớp khi cần | Theo người |
| 3 | (gói câu 14, phần còn mở) Khối "Lỗi đang lặp lại" bật ngay khi GOI-12 merge, hay chờ anh xem dữ liệu thật trên staging trước? | Bật theo dữ liệu: có dữ liệu sổ lỗi thì hiện | `repeat_error = null`, ẩn tới khi API sổ lỗi có dữ liệu |
| 4 | (mới, khi soạn) Phần còn lại của LEARNERCORE (Lộ trình, hub, Tài khoản, Tiến độ, Trợ giúp, "Lần đầu vào", mở `/home` cho tài khoản chưa kích hoạt) viết thành bản sửa đổi spec này hay một spec số mới? | Bản sửa đổi của 0063 trước G07-T15: giữ đúng số FR của gói và một chỗ cho Hôm nay | Bản sửa đổi |

Câu 9, 11, 12 của gói đã được trả lời (mục "Quyết định đã có").
