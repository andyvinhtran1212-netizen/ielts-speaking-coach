# Quản lý Lớp & Học viên — Khảo sát hiện trạng + Kế hoạch phát triển

Ngày: 2026-08-02 · Trạng thái: **BẢN KẾ HOẠCH — chưa code dòng nào**

Mục tiêu đợt này (theo yêu cầu):
1. Gộp quản lý **lớp** + **học viên** về **một trang admin**, có tiến độ đủ **4 kỹ năng S-W-R-L**.
2. Tạo **trang lớp riêng phía học viên** — vào lớp nào thấy nội dung lớp đó, nội dung do admin nhập.
3. Mô hình hoá **5 khoá học** đang dạy.
4. **Giao bài Speaking hằng ngày**, hạn nộp **19:00**, đẩy thẳng sang trang học viên, học viên nộp tại chỗ.
5. Phía học viên: thanh **tiến độ**, **báo bài tập**, **ghi nhận nộp**, **cảnh báo trễ** (chuẩn bị cho email nhắc).

---

# PHẦN 1 — HIỆN TRẠNG

## 1.1 Kiến trúc chung

| Lớp | Thực tế |
|---|---|
| Frontend | HTML tĩnh + vanilla JS trong `frontend/public/**` (`frontend/pages`, `frontend/js` là **symlink** → `public/`). Design system `--av-*` (`css/aver-design/`). Admin dùng web component `js/components/aver-admin-chrome.js` (sidebar + nav). Có nhánh Next.js song song ở `frontend/app` (chương trình migration, chưa phủ admin). |
| Backend | FastAPI, `backend/routers/*.py` + `backend/services/*.py`, mount trong `backend/main.py`. |
| DB | Supabase Postgres, RLS. Migration **chạy tay** trong SQL editor, file ở `backend/migrations/` — số mới nhất là **174**. |

## 1.2 ĐÃ CÓ — Lớp & Học viên

**Bảng `cohorts`** (mig 060): `id, name, code_prefix, description, is_active, created_by`.
**`students.cohort_id`** → một học viên thuộc **tối đa một** lớp. `NULL` = luồng "code đại trà".

**Bảng `students`** (mig 033) — **tách khỏi `users`**: `student_code, full_name, target_band, target_date, current_band_estimate, persona_notes, user_id`.
> `user_id` **NULL cho tới khi học viên kích hoạt tài khoản**. Đây là cái bẫy lớn nhất của cả đợt này (xem §2.5).

**Router `backend/routers/cohorts.py`** (340 dòng) — CRUD lớp, và **hai mô hình thành viên chạy song song**:
- **Roster chuẩn** = `students.cohort_id` — `POST /admin/cohorts/{id}/students`, `/students/bulk`, `DELETE /students/{sid}`. Đây là cột mà writing fan-out + ma trận điểm đọc.
- **Entitlement** = `user_code_assignments` qua access code — `POST/DELETE /admin/cohorts/{id}/members` (cấp/thu mã).

**Router `admin_students.py`** (127 dòng) — CRUD học viên + import CSV.

**Frontend admin — đã có 3 trang rời rạc:**
| Trang | Dòng | Nội dung |
|---|---|---|
| `/pages/admin/cohorts/index.html` | 163 | Danh sách lớp + sĩ số. Chỉ hiện `Tổng phiên / Hoạt động gần nhất / Chi phí AI` (**Speaking-only**) |
| `/pages/admin/students/index.html` | 823 | Danh sách học viên toàn hệ thống |
| `/pages/admin/writing/cohorts.html` | — | **Trang lớp thứ ba** — ma trận điểm Writing theo lớp |

Hai trang đầu **đã có thanh sub-tab "Quản lý lớp | Học viên"** nối nhau → việc "gộp về một trang" **đã đi được nửa đường**; phần còn thiếu là gộp nốt trang thứ ba và thêm mặt tiến độ 4 kỹ năng.

## 1.3 ĐÃ CÓ — Giao bài (chỉ Writing)

**`writing_assignments`** (mig 036) là **module giao bài duy nhất có đủ vòng đời**:
- `prompt_id + student_id`, status `pending → in_progress → submitted → graded → delivered`
- `deadline`, `instructions`, `assignment_group_id` + `name` (gom "Buổi 5"), `is_timed/time_limit_minutes`, `analysis_level`
- **Fan-out theo lớp**: `POST /admin/writing/assignments/fan-out` + `services/cohort_assignment_service.py` → nở ra (N prompt × mọi học viên trong lớp), một `assignment_group_id` chung, chính sách **allow + warn** khi trùng.
- Phía học viên: `GET /api/writing/my-assignments`, draft, submit, timer, paste-log.
- **Cầu entitlement**: có assignment Writing → thẻ Writing tự mở khoá (`student_home.py:72`).

**Speaking / Reading / Listening: KHÔNG có khái niệm giao bài.**
- Speaking: học viên **tự chọn** mode + topic rồi `POST /sessions` (`mode, part, topic, sitting_id`). Không có bảng assignment nào.
- Reading/Listening: chỉ có `exam_content_cohorts` (mig 171) = *"đề này dành cho lớp nào"* — **nhãn dán thôi**, không deadline, không nộp bài, không trạng thái.
- Mock exam: `mock_exams.cohort_id` + `open_from/open_until` — mô hình cửa sổ thời gian, gần deadline nhất nhưng đóng khung trong mock.

## 1.4 ĐÃ CÓ — Tiến độ 4 kỹ năng

`services/student_home_aggregator.py` **đã tổng hợp 6 kỹ năng cho MỘT học viên** (trang `home.html`), đọc: `sessions`, `writing_essays`, `article_views`, `user_vocabulary`, `flashcard_reviews`, `reading_test_attempts`, `listening_attempts`, `listening_test_attempts`. Mỗi kỹ năng bọc try/except riêng → hỏng một cái thì `degraded: true`, phần còn lại vẫn hiện.

→ **Đây là bộ khung tái dùng được**, nhưng nó chạy cho 1 user. Phía admin **chưa có** "tiến độ 4 kỹ năng của 1 học viên" hay "của cả lớp". Các mặt đọc theo kỹ năng nằm rải rác: `listening/attempts.html`, `dashboard/reading-attempts.html`, `writing/cohorts.html`, `vocab/quiz-analytics.html`.

## 1.5 CHƯA CÓ GÌ CẢ

| Thứ | Hiện trạng |
|---|---|
| **Khoá học (course)** | Không tồn tại. 5 khoá chỉ nằm trong đầu + `course_level` free-text trên đề (mig 171) + tiền tố mã lớp |
| **Trang lớp phía học viên** | Không có. `home.html` chỉ có 6 thẻ kỹ năng, không có "Lớp của tôi" |
| **Nội dung/buổi học của lớp** | Không có bảng nào |
| **Giao bài Speaking** | Không có |
| **Email / thông báo** | **Zero**. Không smtp/resend/sendgrid trong `requirements.txt`, không bảng notification, không scheduler (không apscheduler/celery) |
| **Ghi nhận trễ hạn** | Không có (deadline có trên writing_assignments nhưng không ai so sánh) |

---

# PHẦN 2 — NHỮNG QUYẾT ĐỊNH PHẢI CHỐT TRƯỚC KHI CODE

### D1 — Khoá học ≠ Lớp

**Khuyến nghị:** thêm bảng `courses` (5 khoá), `cohorts.course_id` FK.
Lớp = **một lần mở** của một khoá ("C2 — K12 — sáng T3/T5"). Cho phép `course_id` NULL để 100% lớp cũ không vỡ.

Lợi ích kéo theo: `course_level` free-text ở mig 171 có nơi để chuẩn hoá dần; giáo trình mẫu gắn được vào khoá (§4, ý #7).

### D2 — Một bảng giao bài chung, hay mỗi kỹ năng một bảng?

Đây là **quyết định quan trọng nhất**.

`writing_assignments` đã ăn rất sâu (~530 dòng router admin + ~1800 dòng router học viên: draft/submit/timer/paste-log/regrade/instructor-queue). **Sửa nó = rủi ro cao, lợi ích thấp.**

**Khuyến nghị — mô hình "sổ cái nộp bài" đứng trên, không đụng pipeline chấm:**

```
courses ──< cohorts ──< class_lessons (buổi học)
                  │
                  └──< class_assignments        (một lần giao, cấp LỚP)
                          skill: speaking|writing|reading|listening|vocab|grammar
                          content_kind + content_id  (đa hình)
                          due_at TIMESTAMPTZ        ← 19:00 giờ VN
                          publish_at, status
                          │
                          └──< class_assignment_items   (mỗi học viên một dòng)
                                  student_id
                                  state: assigned|opened|submitted|late|graded|missed
                                  submitted_at, artifact_kind, artifact_id
```

`artifact_id` trỏ tới **hiện vật gốc của kỹ năng đó**:
- Writing → `writing_assignments.id` (class_assignment kiểu writing **sinh ra** writing_assignments rows qua `cohort_assignment_service` sẵn có → **pipeline chấm Writing không đổi một dòng**)
- Speaking → `sessions.id`
- Reading → `reading_test_attempts.id`
- Listening → `listening_test_attempts.id`

Được gì: một mặt đọc duy nhất cho trang lớp (admin lẫn học viên), một chỗ tính trễ hạn, một chỗ để email nhắc bám vào — mà **không refactor** module nào đang chạy.

### D3 — Deadline 19:00: **bắt buộc** dùng timezone tường minh

Có tiền lệ lỗi trong repo (`date.today()` vs `datetime.now(timezone.utc).date()` — lệch ngày với người dùng UTC+7, **CI ở UTC không bắt được**).

Chốt: `due_at TIMESTAMPTZ`. Admin chọn **ngày**; backend ghép `ngày 19:00:00+07:00` bằng `zoneinfo.ZoneInfo("Asia/Ho_Chi_Minh")`. Thêm config `CLASS_TZ` + `CLASS_DEFAULT_DUE_TIME=19:00`.
Trễ = `submitted_at > due_at`. **Không** so sánh bằng `date`.

### D4 — Roster: chốt MỘT nguồn sự thật

Hiện `cohorts.py` có hai đường vào lớp (`students.cohort_id` vs cấp mã). **Khuyến nghị: `students.cohort_id` là canonical** (writing fan-out + ma trận điểm đã đọc nó; docstring WF-1 cũng tuyên bố vậy).
Đường cấp mã giữ nguyên nhưng **đổi nhãn UI** thành "Cấp quyền truy cập" chứ không phải "Thêm thành viên" — hiện hai nút này trông giống nhau và đó là mầm split-brain.

### D5 — Học viên chưa kích hoạt thì không thấy bài

`students.user_id` NULL = chưa có tài khoản. Giao bài cho họ → **hàng nằm im, không ai thấy, không ai báo lỗi**.

Chốt: mọi màn giao bài phải hiện cảnh báo `"N/M học viên chưa kích hoạt tài khoản — sẽ không nhận được bài"`, và roster có cột trạng thái kích hoạt. Đây là kiểu lỗi thầm lặng mà CLAUDE.md cấm.

---

# PHẦN 3 — KẾ HOẠCH TRIỂN KHAI

Chia 6 giai đoạn, **mỗi giai đoạn tự đứng được** (ship rồi mới làm tiếp).

## GĐ 0 — Nền dữ liệu (migration 175–177)

| File | Nội dung |
|---|---|
| `175_courses.sql` | `courses(id, code, name, description, sort_order, is_active)` + `cohorts.course_id` FK ON DELETE SET NULL + seed 5 khoá |
| `176_class_lessons.sql` | `class_lessons(id, cohort_id, lesson_no, lesson_date, title, body_md, attachments jsonb, is_published)` |
| `177_class_assignments.sql` | `class_assignments` + `class_assignment_items` (§D2) + index + RLS (admin all, student SELECT dòng của mình) + `sessions.class_assignment_item_id` nullable (mô phỏng `sitting_id` sẵn có) |

Seed 5 khoá:
`C1 Khóa nền tảng tiếng Anh` · `C2 Khóa kỹ năng nền tảng IELTS` · `C3 Khóa kỹ năng nâng cao IELTS` · `C4 Khóa nâng cao từ vựng` · `C5 Khóa luyện đề`

**Không** viết code đọc gì ở GĐ này. Chạy tay trên Supabase, xác nhận rồi mới sang GĐ 1.

## GĐ 1 — Admin: gộp về một trang "Lớp & Học viên"

Trang mới `/pages/admin/classes/index.html`, thay thế 3 trang cũ (2 trang cũ redirect, `writing/cohorts.html` gộp vào tab Tiến độ).

```
Lớp & Học viên
├── Tab "Lớp"          danh sách lớp, lọc theo KHOÁ, sĩ số, số bài đang mở, % nộp đúng hạn
├── Tab "Học viên"     toàn bộ học viên (giữ nguyên logic 823 dòng hiện có), thêm cột Lớp + Khoá + đã kích hoạt
└── Chi tiết lớp  ?cohort_id=…
    ├── Sĩ số          roster + trạng thái kích hoạt + nút gán/gỡ
    ├── Buổi học       CRUD class_lessons (chính là chỗ "input nội dung lớp")
    ├── Bài tập        giao bài + theo dõi nộp (GĐ 2)
    └── Tiến độ        ma trận 4 kỹ năng (GĐ 4)
```

Backend:
- `backend/routers/admin_courses.py` — CRUD khoá
- mở rộng `cohorts.py`: `GET /admin/cohorts` trả kèm `course`, `member_count`, `pending_assignments`
- `backend/routers/admin_class_lessons.py` — CRUD buổi học

**Bẫy phải né:** `GET /admin/cohorts/{id}/members` hiện chỉ trả chỉ số Speaking. Đừng "sửa hiển thị" — sửa đúng nguồn (GĐ 4).

## GĐ 2 — Giao bài Speaking hằng ngày (đường đi hẹp, đầu tiên)

Đây là đường đi **mỏng nhất mà đủ nghiệp vụ**: admin giao → học viên thấy → nộp → admin thấy đã nộp/trễ.

Backend:
- `POST /admin/classes/{cohort_id}/assignments` — body: `skill=speaking`, `topic`, `mode` (`practice_single`/`practice_part`), `part`, `due_date`, `instructions`. Fan-out ra `class_assignment_items` cho toàn roster (mượn nguyên cách làm của `cohort_assignment_service.fan_out_assignment`).
- `GET /admin/classes/{cohort_id}/assignments` — kèm `{submitted, late, missing}` mỗi bài.
- Học viên: `GET /api/class/my-assignments`, `POST /api/class/assignments/{item_id}/start` → tạo `sessions` với topic đã gán + gắn `class_assignment_item_id`.
- Khi `PATCH /sessions/{id}/complete` chạy, nếu session có `class_assignment_item_id` → cập nhật item sang `submitted`/`late`.

**Không** làm cơ chế chấm mới — dùng nguyên pipeline `grading.py`.

## GĐ 3 — Trang lớp phía học viên

Trang mới `/pages/my-class.html` + thẻ "Lớp của tôi" trên `home.html`.

Người dùng thấy gì:
- Tên lớp + khoá + giảng viên
- **Thanh tiến độ**: `x/y bài tuần này`, streak nộp đúng hạn
- **Bài tập**: `Cần nộp hôm nay` (đếm ngược tới 19:00) · `Sắp tới` · `Đã nộp` · `Trễ hạn` (đỏ)
- **Buổi học**: nội dung admin nhập, tài liệu
- Bấm bài → vào thẳng flow kỹ năng tương ứng, nộp xong quay lại có tick

Backend: `backend/routers/class_student.py` — `GET /api/class/me` (một round-trip, dựng theo khuôn `student_home_aggregator`, mỗi khối bọc try/except riêng).

Gate: học viên không thuộc lớp nào → thẻ ẩn, `/pages/my-class.html` báo hiền lành, **không** 500.

## GĐ 4 — Tiến độ 4 kỹ năng (admin)

- `backend/services/cohort_progress_aggregator.py` — tổng hợp **theo lô cả lớp** (không N+1)
- `GET /admin/cohorts/{id}/progress` → ma trận `học viên × {speaking, writing, reading, listening}` với: số lượt, band gần nhất, hoạt động gần nhất, % nộp đúng hạn
- `GET /admin/students/{id}/progress` → hồ sơ 4 kỹ năng của một học viên
- Gộp `writing/cohorts.html` (ma trận điểm Writing) vào đây thành cột Writing

**Bẫy đã cắn nhiều lần trong repo này:** PostgREST **giới hạn 1000 dòng** khi không có `.range()`. Lớp 30 người × nhiều tháng attempts là vượt ngưỡng dễ dàng, và **triệu chứng là con số hợp lý + chạy xanh**. Mọi query trong aggregator phải phân trang tường minh hoặc dùng `count='exact'`.

## GĐ 5 — Mở rộng giao bài ra Writing / Reading / Listening

- Writing: `class_assignments(skill=writing)` **gọi lại** `cohort_assignment_service.fan_out_assignment` rồi lưu `writing_assignments.id` vào `artifact_id`. Pipeline chấm không đổi.
- Reading/Listening: giao `reading_tests` / `listening_tests` đã publish; hoàn thành = có `*_test_attempts` với `submitted_at`. Tận dụng `exam_content_cohorts` (mig 171) để lọc đề gợi ý theo lớp.

## GĐ 6 — Nhắc nộp & cảnh báo trễ (email)

**Đây là greenfield hoàn toàn — không có hạ tầng nào.** Đề xuất:

| Mảnh | Đề xuất |
|---|---|
| Gửi | **Resend** (HTTP API, không cần SMTP, hợp Railway) |
| Lịch chạy | Cron **ngoài** gọi `POST /internal/notifications/run` (header secret). Vercel Cron hoặc Railway cron. **Đừng** thêm apscheduler in-process — Railway restart là mất lịch |
| Chống gửi trùng | Bảng `notification_log(item_id, kind, sent_at)` UNIQUE(item_id, kind). **Bắt buộc** — cron chạy lại là chuyện thường |
| Nhịp | 17:00 nhắc trước 2h · 19:05 báo trễ · 08:00 tổng kết cho admin |

Chuẩn bị từ GĐ 2: `class_assignment_items` phải đủ `due_at`, `submitted_at`, `state` để job chỉ cần đọc, không phải suy diễn.

---

# PHẦN 4 — ĐỀ XUẤT THÊM (ngoài yêu cầu, xếp theo giá trị/công sức)

**Nên làm sớm, rẻ:**
1. **Điểm chuyên cần** — `% nộp đúng hạn` hiện ngay trên roster + hồ sơ học viên. Gần như free khi đã có `class_assignment_items`, mà là con số phụ huynh/học viên quan tâm nhất.
2. **Cờ rủi ro** — tự gắn nhãn: *trễ 3 bài liên tiếp*, *không hoạt động 7 ngày*, *band tụt 2 lần liên tiếp*. Cho admin một danh sách "cần gọi điện" thay vì phải tự soi bảng.
3. **Bài giao lặp lại** — mẫu "T2–T6, mỗi ngày 1 Speaking, hạn 19:00". Đúng nhu cầu đã nêu, tránh admin phải bấm tay mỗi ngày. Chỉ là một bảng `assignment_recurrence` + cùng cron của GĐ 6.
4. **Điểm danh theo buổi** — `class_lessons` đã có, thêm `class_attendance(lesson_id, student_id, status)`.

**Đáng cân nhắc nghiêm túc:**

5. **Zalo OA thay vì / bên cạnh email.** Học viên Việt Nam mở email rất thấp; nhắc deadline 19:00 qua email nhiều khả năng vô hiệu. Kiến trúc GĐ 6 nên tách `notification_log` khỏi kênh gửi ngay từ đầu để cắm Zalo vào sau mà không phải làm lại.
6. **Giáo trình mẫu theo khoá** — mỗi khoá có sẵn N buổi + bài tập mẫu; tạo lớp mới = copy cả bộ. Đây là chỗ 5 khoá học thật sự sinh lời, thay vì gõ lại mỗi lớp.
7. **Báo cáo tiến độ PDF** — `services/pdf_generator.py` (ReportLab) đã chạy tốt cho result. Xuất "báo cáo tháng của lớp / của học viên" là tái dùng, không phải xây mới.
8. **Mở quyền cho giảng viên** — `routers/instructor.py` đã có mô hình quyền theo `created_by` (fan-out có gate ownership fail-closed). Cho giảng viên quản lý lớp mình mà không cần quyền admin là mở rộng tự nhiên, không phải thiết kế lại.

**Để sau:**
9. Bảng xếp hạng / streak trong lớp (gamification) — vui nhưng dễ phản tác dụng với lớp yếu.
10. Nội dung theo lớp cho Reading/Listening — mở rộng `exam_content_cohorts` để trang lớp học viên **chỉ** thấy đề của lớp mình.

---

# PHẦN 5 — RỦI RO ĐÃ BIẾT

| Rủi ro | Vì sao | Cách né |
|---|---|---|
| **Học viên chưa kích hoạt** | `students.user_id` NULL → giao bài xong không ai thấy, không lỗi | Cảnh báo trên UI giao bài + cột trạng thái trên roster (§D5) |
| **Roster hai nguồn** | `students.cohort_id` vs `user_code_assignments` | Chốt canonical + đổi nhãn nút cấp mã (§D4) |
| **Trần 1000 dòng PostgREST** | Đã cắn ≥3 lần trong repo; triệu chứng là **số hợp lý + chạy xanh** | Mọi query aggregator phải `.range()` hoặc `count='exact'` |
| **Lệch ngày UTC vs VN** | Deadline 19:00 là bài toán timezone thuần; CI chạy UTC không bắt được | `TIMESTAMPTZ` + `ZoneInfo("Asia/Ho_Chi_Minh")`, cấm `date.today()` (§D3) |
| **Cron gửi mail trùng** | Cron chạy lại / deploy trùng giờ | `notification_log` UNIQUE(item_id, kind) |
| **Test backend không hermetic** | Nhiều đường gọi Supabase thật; mạng đứt là **treo** chứ không đỏ; full suite hàng giờ | Chạy targeted theo module vừa sửa; worktree mới phải symlink `backend/.env` |
| **Tailwind stale sau merge** | Rebuild `css/tailwind.build.css` sau khi merge main, không thì CI đỏ | Nhớ rebuild khi thêm trang mới |
| **Đụng độ giữa các phiên** | Nhiều phiên dùng chung clone, `git checkout` phiên khác dời HEAD | Làm trong worktree riêng, push bằng refspec tường minh |

---

# PHẦN 6 — ĐỀ NGHỊ THỨ TỰ LÀM

**Lát cắt dọc đầu tiên (GĐ 0 → 1 → 2 → 3)** cho ra một vòng nghiệp vụ chạy được đầu-cuối:
*admin tạo lớp gắn khoá → nhập buổi học → giao Speaking hạn 19:00 → học viên thấy trên trang lớp → nộp → admin thấy đã nộp/trễ.*

Xong lát cắt đó rồi mới **mở rộng chiều ngang** (GĐ 4 tiến độ, GĐ 5 các kỹ năng còn lại), cuối cùng là GĐ 6 email.

Lý do: giao bài Speaking là nhu cầu chạy **hằng ngày**; tiến độ 4 kỹ năng là nhu cầu xem **hằng tuần**. Làm cái chạy hằng ngày trước.
