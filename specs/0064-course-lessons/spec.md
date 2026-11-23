---
id: COURSELESSON-0064
title: Learners with access to an online course open its lessons in any order, watch the video and resume where they left off, while visitors can open marked preview lessons and admins load lessons by script
status: draft
risk: high
owner: product
---

# Learners with access to an online course open its lessons in any order, watch the video and resume where they left off, while visitors can open marked preview lessons and admins load lessons by script

Status: **draft**. Spec soạn ngày 23/11/2026 cho nhiệm vụ `G07-T03` (thương mại hoá 2026-11). Nguồn là `docs/proposals/commercialization-2026-11/GOI-07-loi-hoc-vien.md` (bản 18/11), các mục: 4.5 (FR-07-040…044), 5.4, 5.5, nhiệm vụ G07-T18, T19, T28, T29, câu hỏi mở #5, #6, #10, #15. Chưa có dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt spec. Khi anh duyệt, câu trả lời được ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục, và `status` đổi sang `approved`. Số 0064 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; số này còn trống ở staging `31725a9b`.

## Problem

Khoá online (G04, `course_products.kind = 'online'`) bán được nhưng chưa có bài học để mở. Repo chưa có bảng bài học của khoá online, chưa có API đọc bài, chưa có trang bài giảng, chưa có trình phát video và chưa có đường nạp bài. Vì vậy có ba chỗ đang để trống:

- Trang khoá công khai của G05 không có `lesson_count` và `chapters`. Điểm ghép `routers/courses_public.py::_outline_for` của G04 hiện trả `null`.
- Thẻ "Bài tiếp theo trong lộ trình" của LEARNERCORE-0063 FR-021 chưa có nguồn dữ liệu.
- Lối "Học thử" trên trang khoá chưa dẫn tới bài thật nào.

**Đối chiếu staging `31725a9b`.**
- Có bảng `courses` (mig 175, có `code` duy nhất C1…C5).
- G04 đã có `course_products`, `entitlements` (mig 383), bảng `quiz_banks` (mig 118) và mẫu RLS chỉ admin của `class_lessons` (mig 176, 344).
- Chưa có `services/entitlements.py` (G04-T03): hàm `has_course_access(user_id, course_id)` mới chỉ nằm trong COURSEACCESS-0055 plan mục 5.x.
- Chưa có `routers/courses_public.py` (G04).
- Chưa có trình phát video dùng chung.
- CSP production chưa có `frame-src`, nên iframe YouTube đang bị `default-src 'self'` chặn.
- Markdown ở frontend dùng `marked` + DOMPurify (`window.renderMarkdown`).

**Ngôn ngữ và đánh số.** Thân viết tiếng Việt; tiêu đề mục giữ tiếng Anh cho `validate_specs.py`. Đánh số FR như sau:
- `FR-07-040…044` của gói thành `FR-040…FR-044`, giữ số.
- FR-043 của gói **đã bỏ** (khoá tuần tự), nên số này để trống.
- `FR-045…049` là yêu cầu mới, gom từ G07-T19, T28, T29 để các PR đó không phải sửa spec sau.

## Scope

- Hai bảng `course_lessons` và `course_lesson_progress`, kèm RLS (một migration trong dải 420–439 của G07).
- API học viên `/api/course/...`: danh sách bài theo chặng, một bài, ghi tiến độ.
- Trang bài giảng `/course/learn/[courseCode]/[lessonCode]`, trình phát hai nguồn và đổi CSP `frame-src`.
- `services/course_outline.py`, gồm hai phần:
  - `public_outline` (nối vào `_outline_for` của G04);
  - `next_lesson` (nguồn cho LEARNERCORE-0063 FR-021).
- Script `import_course_lessons.py`, kèm hai cờ `is_preview`/`is_published` cho admin.
- Trang bài học thử công khai.

## Non-goals

- Không soạn nội dung bài giảng, không nạp dữ liệu thật của sáu khoá, không đụng dây chuyền Hermes.
- Không khoá bài theo thứ tự (FR-07-043 đã bỏ).
- Không mở khối luyện tập trong bài: nút "Bắt đầu luyện" ẩn theo câu hỏi mở 2. Đường tự học có kiểm quyền là spec riêng, vì đụng chấm bài.
- Không làm máy chủ video riêng: chỉ YouTube chạy (câu hỏi mở 3).
- Không thêm `course_lesson_id` vào `class_lessons`; bài của lớp offline giữ luồng hiện có (gói câu 5).
- Không dựng trang Lộ trình `/course` (LEARNERCORE, G07-T15). Spec này chỉ cấp API và trạng thái "sắp có".
- Không sửa bảng hay hàm quyền của G04.

## Users and journeys

- **Học viên có quyền khoá online:** mở Lộ trình, chọn một bài bất kỳ, xem video, rời trang, quay lại, video tiếp từ vị trí cũ, bài được đánh dấu "Đã xong".
- **Học viên hết hạn hoặc chưa có quyền:** mở link bài, không thấy nội dung, thấy lối "Xem khoá" hoặc "Đăng ký lại".
- **Khách:** bấm "Học thử" trên trang khoá, xem đúng bài được đánh dấu thử, không cần tài khoản.
- **Admin hoặc người vận hành:** chạy script nạp bài từ thư mục nội dung (chạy thử trước), bật `is_published`/`is_preview` cho từng bài.

## Requirements

- **FR-040:** `/course/learn/[courseCode]/[lessonCode]` hiện, theo tờ `BaiGiang.dc.html`:
  - breadcrumb `Lộ trình › <tên khoá> › Chặng k`;
  - mục lục "Trong bài này" dựng từ tiêu đề của bài đọc;
  - video (nếu bài có);
  - bài đọc Markdown, render bằng chuỗi `marked` + DOMPurify hiện có, không cho HTML thô;
  - khối luyện tập (ẩn khi `practice` là `null`, câu hỏi mở 2);
  - nút "Bài trước" và "Bài sau" theo thứ tự chặng rồi số bài, trong số các bài `is_published`.

  `courseCode` là `courses.code`; `lessonCode` là `course_lessons.lesson_code`. Trang nằm trong `LearnerShell`, mục Lộ trình (LEARNERNAV-0062 registry `/course/learn/...`, kind `child`, parent `/course`).
- **FR-041:** Video có hai nguồn:
  - `youtube`: nhúng `https://www.youtube-nocookie.com/embed/<id>`.
  - `private_host`: **tắt ở backend trong bản này**, chỉ YouTube chạy. API không bao giờ trả `ref` hay URL dùng được cho nguồn này, kể cả qua bài thử (FR-049): chỉ trả `video: {source: "private_host", available: false, seconds}`. Trình phát hiện "Video chưa sẵn sàng" và không lỗi trang. Bật nguồn này cần một spec riêng khi đã chọn dịch vụ: kiểm quyền ngay tại máy chủ video, URL ngắn hạn do server cấp sau khi kiểm quyền, và chính sách riêng cho video của bài thử.

  Vị trí xem lưu mỗi 15 giây khi đang phát, khi tạm dừng và khi rời trang (`visibilitychange`/`pagehide`, gửi bằng `fetch` `keepalive`). Mở lại bài thì phát tiếp từ vị trí đã lưu, kể cả khi học viên đã tua lùi. CSP thêm `frame-src 'self' https://www.youtube-nocookie.com` ở mọi môi trường. Không đổi `script-src`.
- **FR-042:** Người không có quyền vào khoá thì không đọc được nội dung bài. Việc chặn nằm ở backend:
  - Điều kiện có quyền: `services/entitlements.py::has_course_access(user_id, course_id)` của G04 trả đúng.
  - Không có quyền: API trả 403 `course_access_required`. Quyền đã hết hạn: API trả 403 `course_access_expired`.
  - Cả hai trường hợp đều không kèm `body_md`, `video` hay tiêu đề bài.
  - Trang hiện câu tiếng Việt và lối "Xem khoá" (`coursesHref()` của PUBLICSITE-0059 FR-029; cờ tắt thì về `/course`). Khi hết hạn và `can_renew` thì có thêm "Đăng ký lại".
  - Lỗi đọc quyền: 503, trang báo "Chưa mở được bài, thử lại". Không bao giờ coi lỗi là có quyền.
- **FR-044:** Khi có bài `is_published`, `GET /api/courses` trả `lesson_count` và `GET /api/courses/{slug}` trả `chapters:[{title, lessons:[{title, kind, duration_min, is_preview, preview_href}]}]`.
  - Nguồn: `services/course_outline.py::public_outline(product)` (nhận dòng `course_products`, có `course_id` và `slug`), nối vào thân `routers/courses_public.py::_outline_for(product)` của G04. Đây là điểm ghép duy nhất.
  - Khoá chưa có bài `is_published` thì hai trường là `null`; G05 hiện "sắp có".
  - `kind` suy ra như sau: có `video_source` → `video`; có `practice_bank_id` mà không có video → `practice`; còn lại → `reading`.
  - `duration_min = ceil(video_seconds/60)`, hoặc `null`.
  - `preview_href` chỉ có ở bài `is_preview`.
  - Không bao giờ lộ `body_md` hay `video_ref`.
- **FR-045:** `GET /api/course/{course_code}/lessons` trả các chặng và bài `is_published` của khoá người gọi có quyền. Mỗi bài có `state`, tính chỉ từ `course_lesson_progress` của chính người gọi:
  - `done`: bài có `completed_at`;
  - `current`: bài chưa xong được mở gần nhất;
  - `next`: bài chưa xong đầu tiên theo thứ tự, không phải `current`;
  - `todo`: các bài còn lại.

  Không có `locked`. Bài kiểm tra giữa chặng không có điều kiện mở (câu hỏi mở 4). Khoá có quyền nhưng chưa có bài `is_published` thì trả `stages: []` và `coming_soon: true`; Lộ trình hiện "Bài học của khoá sắp có".

  `next_lesson(user_id)` là nguồn cho thẻ "Bài tiếp theo trong lộ trình" (LEARNERCORE-0063 FR-021). Kết quả trả về gồm khoá, chặng, số thứ tự và tổng số bài, tên bài, thời lượng video, số câu luyện và vị trí xem dở. Cách chọn:
  - Lấy khoá online còn quyền được mở bài gần nhất, rồi trả bài `current` của khoá đó, không có thì bài `next`.
  - Khoá được chọn đã xong hết mọi bài `is_published`: bỏ qua khoá đó, xét khoá kế tiếp theo cùng thứ tự.
  - Người vừa có khoá mà chưa mở bài nào: lấy khoá có quyền bắt đầu mới nhất, trả bài `is_published` đầu tiên với vị trí 0. Thẻ hiện "Bắt đầu bài".
  - Trả `null` khi không có khoá online còn hạn nào có bài `is_published` chưa xong (gồm cả khi đã học xong mọi khoá); thẻ bị ẩn.
- **FR-046:** Ghi tiến độ: `PATCH /api/course/lessons/{lesson_id}/progress` với body `{video_position_seconds:int ≥ 0, completed?: bool, opened?: bool}`.
  - Kiểm quyền như FR-042 và kiểm bài đang `is_published`.
  - `video_position_seconds` là vị trí xem gần nhất, ghi đè được (để tua lùi rồi xem tiếp đúng chỗ), kẹp trong `[0, video_seconds]`.
  - `max_position_seconds` chỉ tăng.
  - `completed_at` chỉ đặt một lần, không bao giờ xoá.
  - Bài có video phát được (`video_source = 'youtube'`): tự đánh dấu xong khi `max_position_seconds ≥ COURSE_LESSON_DONE_RATIO × video_seconds` (mặc định 0,9). `completed: true` gửi trước ngưỡng đó bị bỏ qua.
  - Bài không có video, hoặc video không phát được (`video_source = 'private_host'` ở bản này): `completed: true` từ nút "Đánh dấu đã đọc" được nhận. Server tự quyết từ `video_source` trong DB, không dựa vào cấu hình frontend; tải lại trang vẫn thấy bài đã xong.
  - Gọi lặp với cùng giá trị cho cùng kết quả. Ghi dòng của chính người gọi, không dòng nào khác. `opened: true` (frontend gửi sau khi trang bài đã vẽ) đặt mốc "mở gần nhất" dùng cho `current` (FR-045). Các API `GET` bài học chỉ đọc, không ghi gì.
- **FR-047:** Script `backend/scripts/import_course_lessons.py --course <code> --source <thư mục>` nạp `course_lessons` từ thư mục nội dung của khoá (định dạng ở plan mục 5.6).
  - Mặc định chạy thử: in số bài thêm, sửa, không đổi, kèm lỗi định dạng từng file, và không ghi gì.
  - `--execute` mới ghi, theo khoá `(course_id, lesson_code)`. Chạy hai lần cùng thư mục thì không tạo dòng trùng.
  - Bài mới luôn có `is_published = false`, `is_preview = false`. Script không bao giờ tự bật hai cờ này và không xoá bài không có trong thư mục (chỉ in cảnh báo).
  - Mỗi lần `--execute` ghi một lô vào `import_batch_log` của G09-T36 khi đã có. Chưa có thì ghi log và báo trong PR.
- **FR-048:** Admin bật hoặc tắt `is_published` và `is_preview` từng bài:
  - Route `PATCH /admin/course-lessons/{id}` với body `{is_published?, is_preview?}`, chỉ admin.
  - `is_preview = true` chỉ được khi bài `is_published`. Tắt `is_published` thì tự tắt `is_preview`.
  - Thẻ "Chương trình" của `/admin/courses/[id]` (G09-T13) chỉ đọc danh sách bài và dùng route này.
  - Mỗi lần đổi ghi một dòng `governance_audit` (mig 107, chỉ thêm) với `action = 'course_lesson_flags'`, `admin_id`, `detail` = id bài và giá trị cũ → mới.
- **FR-049:** Bài học thử công khai `/courses/[slug]/preview/[lessonCode]` (`preview_href`), theo tờ `BaiHocThu`, nằm trong khung công khai của G03:
  - Không cần tài khoản. Chỉ mở bài `is_preview = true` và `is_published = true` của sản phẩm công khai; mọi trường hợp khác trả HTTP 404.
  - API công khai `GET /api/courses/{slug}/preview/{lesson_code}` trả đúng một bài (cùng hình với FR-040, không có `prev`/`next`, không có `practice`).
  - Người đã có quyền khoá thì được chuyển tới `/course/learn/<code>/<lessonCode>`.
  - Không ghi tiến độ cho khách. Trang có `noindex` cho tới khi anh Andy quyết (câu hỏi mở 5).
  - Trang theo cờ `AVER_PUBLIC_COMMERCE` (PUBLICSITE-0059 FR-029): cờ tắt thì 404.

## Acceptance scenarios

### Mở bài theo thứ tự bất kỳ

- **Given** học viên QA có quyền khoá thử, khoá có 3 bài `is_published` và chưa học bài nào
- **When** mở thẳng bài thứ 3
- **Then** API trả 200, trang hiện video và bài đọc, `state` của bài 3 là `current`

### Tiếp tục xem

- **Given** học viên đã xem bài 1 tới 2 phút 30 giây rồi tua lùi về 1 phút 10 giây
- **When** rời trang rồi mở lại
- **Then** video phát tiếp từ khoảng 1 phút 10 giây (sai lệch tối đa 15 giây); `max_position_seconds` vẫn ≥ 150

### Không có quyền

- **Given** tài khoản QA không có quyền khoá thử
- **When** gọi `GET /api/course/<code>/lessons/<lesson>` hoặc mở trang bài
- **Then** 403 `course_access_required`, phản hồi không có `body_md`, `video` hay tiêu đề bài; trang hiện "Xem khoá"

### Khoá chưa có bài

- **Given** khoá thử có quyền nhưng 0 bài `is_published`
- **When** mở Lộ trình
- **Then** thấy "Bài học của khoá sắp có"; `GET /api/courses/<slug>` trả `lesson_count: null`, `chapters: null`

### Học thử

- **Given** một bài `is_preview` và `is_published` của sản phẩm công khai, cờ `AVER_PUBLIC_COMMERCE` bật
- **When** khách chưa đăng nhập mở `preview_href`
- **Then** thấy đúng bài đó; bài khác cùng khoá ở cùng dạng đường dẫn trả 404; người đã có quyền được chuyển sang `/course/learn/...`

### Nạp bài

- **Given** thư mục mẫu 3 bài trong `backend/tests/fixtures/course_lessons/`
- **When** chạy script không có `--execute`, rồi có `--execute` hai lần
- **Then** lần đầu in "3 thêm" và không ghi; lần hai ghi 3 dòng `is_published = false`; lần ba in "0 thêm, 3 không đổi"

## Edge cases

- Bài bị tắt `is_published` khi học viên đang xem: lần ghi tiến độ kế tiếp trả 404 `lesson_not_found`, trang hiện "Bài này tạm ẩn" và lối về Lộ trình. Dòng tiến độ cũ giữ nguyên.
- Quyền hết hạn giữa lúc xem: lần ghi tiến độ kế tiếp trả 403 `course_access_expired`. Video đang phát không bị cắt giữa chừng, nhưng vị trí sau đó không được lưu và trang hiện dải "Khoá đã hết hạn".
- Hai tab cùng ghi một bài: `max_position_seconds` lấy giá trị lớn nhất; `video_position_seconds` theo lần ghi sau cùng.
- `video_position_seconds` lớn hơn `video_seconds` (thông tin độ dài sai): kẹp về `video_seconds`.
- Bài có `video_source = 'private_host'` (tắt ở bản này): API trả `available: false`, không có `ref`; trang hiện "Video chưa sẵn sàng". Bài đọc vẫn hiện, ngưỡng xong theo video không áp (FR-046), và nút "Đánh dấu đã đọc" hiện.
- Học viên lớp offline có `course_id` trùng khoá online: quyền theo `has_course_access` (gồm quyền suy ra từ thành viên lớp, câu hỏi mở 1).
- `lesson_code` có ký tự lạ trong URL: so khớp chính xác và phân biệt hoa thường (CHECK `^[A-Z0-9][A-Z0-9-]{0,15}$`). Mã viết thường hoặc có ký tự ngoài mẫu trả 404, không tự đổi sang chữ hoa.

## Success criteria

- Học viên có quyền mở được mọi bài `is_published` theo thứ tự bất kỳ (100% ca test 200).
- Không ca test nào trả nội dung bài cho người không có quyền, cho khách (trừ bài thử) hay khi lỗi đọc quyền.
- Tải lại trang bài: vị trí phát lệch tối đa 15 giây so với lần lưu cuối.
- Trang khoá công khai có `lesson_count` đúng bằng số bài `is_published` sau khi nạp 3 bài thử trên staging.
- Không request nào bị CSP chặn với video YouTube trên staging. `script-src` không đổi.

## Dependencies

- COURSEACCESS-0055 (G04):
  - `services/entitlements.py::has_course_access`, `list_access` (lấy `status` và `expires_at`) (G04-T03), `entitlements.can_renew(product=…, state=…, expires_at=…, has_open_order=…)` (tính riêng, không có trong `AccessItem`);
  - `routers/courses_public.py::_outline_for` (G04-T03).

  Chưa merge thì không merge T19; T18 (bảng) làm trước được.
- LEARNERNAV-0062: dòng registry `/course/learn/...`, khung Lộ trình.
- LEARNERCORE-0063: cờ `learner_v2` (trang bài giảng vẽ khi cờ bật), FR-021 đọc `next_lesson`.
- PUBLICSITE-0059: `coursesHref()`, cờ `AVER_PUBLIC_COMMERCE`, khung công khai, ô "Học thử" (ẩn khi `preview_href` null).
- G09-T13 (thẻ Chương trình), G09-T36 (`import_batch_log`): không bắt buộc để merge; chưa có thì bỏ qua và báo.

## Decisions already made

- Gói câu 5 (đã phân xử ở `01` mục 6): `course_lessons` thuộc G07 và chỉ dùng cho khoá online.
- FR-07-043 đã bỏ: không khoá bài theo thứ tự.
- Gói câu 15, mặc định tạm: bài kiểm tra giữa chặng không giữ điều kiện "học xong các bài của chặng" ở đợt đầu.

**Khác với gói (ghi khi soạn):**
- (a) Gói 5.4 cho `video_position_seconds` "chỉ tăng"; như vậy học viên tua lùi rồi rời trang sẽ không tiếp được đúng chỗ (trái FR-041). Spec tách thành hai cột: vị trí gần nhất (ghi đè được) và `max_position_seconds` (chỉ tăng, dùng cho ngưỡng xong).
- (b) Ngưỡng "xem đủ" là cấu hình `COURSE_LESSON_DONE_RATIO`.
- (c) Lỗi quyền có hai mã: `course_access_required` và `course_access_expired`.
- (d) Route bài thử chốt là `/courses/[slug]/preview/[lessonCode]`.

## Open questions

| # | Câu hỏi | Đề xuất | Mặc định tạm |
|---|---|---|---|
| 1 | Học viên lớp offline có cùng `course_id` với một khoá online có xem được bài giảng online không? `has_course_access` của G04 gồm quyền suy ra từ thành viên lớp | Có: dùng đúng `has_course_access` như G04 định ("dùng để mở nội dung"), một quy tắc quyền cho cả nền tảng | Dùng `has_course_access` |
| 2 | (gói câu 6) Khối luyện tập trong bài: đi đường tự học mới có kiểm quyền G04 hay tạo "bài giao cá nhân"? | Đường tự học mới, spec riêng (đụng chấm bài) | Ẩn nút "Bắt đầu luyện" |
| 3 | (gói câu 10) Máy chủ video riêng là dịch vụ nào (origin, cách ký URL)? | Bản này tắt `private_host` ở backend, không trả `ref`; spec riêng khi chọn dịch vụ (quyền tại nguồn, URL ngắn hạn do server cấp, chính sách video bài thử) | Chỉ YouTube chạy |
| 4 | (gói câu 15) Bài kiểm tra giữa chặng có giữ điều kiện "học xong chặng" không? | Không giữ ở đợt đầu | Không giữ |
| 5 | Trang bài học thử có cho máy tìm kiếm lập chỉ mục không? | `noindex` tới khi nội dung thật ổn định | `noindex` |
| 6 | Ngưỡng "xem đủ" để bài có video là "Đã xong" | 90% độ dài video | `COURSE_LESSON_DONE_RATIO = 0.9` |
