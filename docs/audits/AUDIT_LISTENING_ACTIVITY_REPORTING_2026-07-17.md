# Audit — báo cáo hoạt động Listening: chép chính tả + làm bài nghe (2026-07-17)

**Bối cảnh:** admin báo *"không xem được học viên nào đã làm bài nào, làm trong bao lâu, tỉ lệ đúng, và vấn đề đang gặp phải"* cho hai mảng: chép chính tả và làm nội dung bài nghe.

**Phạm vi khảo sát:** `backend/routers/listening.py` (4.764 dòng, toàn bộ endpoints), migrations 056/068/138/157, `admin_overview.py`, `admin_students.py`, `frontend/pages/admin/listening/*`, `admin-listening-dictation-reports.js`, đối chiếu **dữ liệu prod thật** (đếm + phân rã bảng).

---

## I. KẾT LUẬN CHÍNH

**Dữ liệu KHÔNG thiếu — mặt đọc cho admin thiếu.** Mọi lượt làm bài nghe của học viên đang được ghi đầy đủ (ai, bài nào, bao lâu, đúng bao nhiêu, sai ở đâu) vào `listening_test_attempts` và `dictation_sessions`; nhưng:

1. **418 lượt làm bài / 30 học viên trong `listening_test_attempts` hoàn toàn vô hình với admin** — không có endpoint admin, không có trang admin nào đọc bảng này.
2. **Dashboard admin đang báo SAI**: `admin_overview` đọc bảng chết `listening_attempts` (hệ Sprint 11.x cũ — 2 rows, dừng từ 18/05) → tile Listening hiển thị ~0 hoạt động trong khi thực tế có 418 lượt. Vi phạm trực tiếp quality bar "Admin must see accurate, canonical data".
3. **Trang admin "Báo cáo chép chính tả" có nhưng khuyết đúng cột người dùng cần nhất**: không có cột HỌC VIÊN (endpoint không join `users`, UI không render `user_id`), không lọc theo học viên, không bấm vào xem chi tiết phiên (endpoint detail `GET /dictation-reports/{id}` có sẵn nhưng UI không gọi).

---

## II. TẦNG GHI — dữ liệu đang có (đối chiếu prod 2026-07-17)

| Bảng | Prod | Ghi từ flow nào | Trường trả lời được 4 câu hỏi |
|---|---|---|---|
| `listening_test_attempts` (mig 068) | **418 rows / 30 học viên** — 343 submitted · 46 abandoned · 29 in_progress; theo test_type: **mini 177** (= bài nghe lesson L01–L30, import test_type "mini") · **drill 209** (Skills Practice) · **full 32** (Cambridge full test) | `POST /tests/{id}/attempts` → `PATCH …/answers` → `POST …/submit` (mọi trang mini/drill/full/lesson) | ✅ ai (`user_id`), bài nào (`test_id`), bao lâu (`submitted_at - started_at`, 343/343 submitted có đủ 2 mốc; + `audio_duration_listened_seconds`), tỉ lệ đúng (`score`/tổng, `grading_details` per-question), vấn đề (`grading_details.{trap_caught,trap_missed}`, `trap_analytics`, status `abandoned`) |
| `dictation_sessions` (mig 138 — mới ship 16/07) | 6 rows / 3 học viên | `POST /tests/dictation/session` khi hoàn tất chép chính tả (test-linked, gồm lesson L01–L30) | ✅ ai, bài nào (`test_id_external` + section), bao lâu (`total_time_seconds` + per-sentence `time_seconds`), tỉ lệ đúng (`accuracy`, `correct_words/total_words`), vấn đề (`error_trends` miss/wrong per-word, per-sentence ops) |
| `listening_attempts` (Sprint 11.x) | **2 rows, row cuối 18/05** — bảng CHẾT | hệ content/exercise cũ (`POST /attempts`) — flow lesson hiện không đi qua đây | (không còn dùng; KHÔNG có trường thời lượng) |
| `listening_sessions` | 0 rows | mini-test session cũ | chết |
| `user_feedback` (skill='listening') | hoạt động | flag của học viên: câu dictation (`POST /tests/dictation/flag`) + exercise lẻ (PR #802) | ✅ "vấn đề gặp phải" dạng chủ động báo — đã hiện trong /admin/feedback |

**Học viên tự xem được gì:** trang cá nhân có `GET /listening/analytics` (đọc bảng chết `listening_attempts` → cũng đang rỗng vô nghĩa!), student home aggregator đọc `listening_test_attempts` (đúng nguồn). Học viên xem lại attempt qua `GET /tests/attempts/{id}/review`.

## III. TẦNG ĐỌC ADMIN — hiện trạng vs 4 nhu cầu

| Nhu cầu | Chép chính tả | Bài nghe (lesson/mini/drill/full) |
|---|---|---|
| Học viên nào đã làm bài nào | ⚠️ Có list phiên nhưng **không có cột học viên** (không join users, không filter) | ❌ Không có gì |
| Làm trong bao lâu | ⚠️ Có cột thời lượng trong list (không xem per-câu vì thiếu drill-down) | ❌ Không có gì (dữ liệu sẵn trong DB) |
| Tỉ lệ đúng | ⚠️ Có accuracy per-phiên + aggregate per-test | ❌ Không có gì (score + grading_details sẵn trong DB) |
| Vấn đề gặp phải | ⚠️ Aggregate "từ hay bỏ sót / hay viết sai" per-test có; per-học-viên không | ⚠️ Chỉ có flag chủ động ở /admin/feedback; trap_missed / abandoned (46 lượt!) không hiển thị đâu |

Khoảng trống phụ trợ: `admin_students` (hồ sơ từng học viên) không có mục Listening; `admin_reading` cũng chưa từng có pattern xem attempts để mirror — màn này sẽ là mới (tham chiếu cấu trúc trang `dictation-reports.html` hiện có).

## IV. ĐỀ XUẤT — 3 đợt, KHÔNG cần migration (dữ liệu đã đủ)

**Đợt 1 — Trang admin "Lượt làm bài nghe" (giá trị lớn nhất):**
- Backend: `GET /admin/listening/attempts` — list `listening_test_attempts` newest-first, filter `user_id`/`test_id`/`test_type`/`status`, join 1 lần sang `users` (email/display_name) + `listening_tests` (test_id, title, test_type), tính `duration_seconds = submitted_at - started_at`. `GET /admin/listening/attempts/{id}` — chi tiết per-question (`grading_details`) + trap_analytics.
- Frontend: trang `admin/listening/attempts.html` — bảng: học viên · bài (title + loại) · trạng thái · điểm x/N (%) · thời lượng · nghe (giây audio) · ngày; drill-down chi tiết từng câu (đúng/sai, học viên gõ gì, đáp án, trap). Filter theo học viên + bài + loại + trạng thái. Link vào nav admin.

**Đợt 2 — Sửa dữ liệu sai lệch + vá dictation-reports:**
- `admin_overview`: tile Listening đổi nguồn từ bảng chết `listening_attempts` → `listening_test_attempts` (+ đếm `dictation_sessions`).
- `GET /admin/listening/dictation-reports`: join users → thêm cột **Học viên** + filter user vào UI; bấm row mở chi tiết phiên (endpoint detail đã có sẵn — chỉ thiếu UI); thêm cờ hiển thị khi phiên có câu bị flag.
- (Cùng lớp sai nguồn: `GET /listening/analytics` phía học viên cũng đọc bảng chết — đổi nguồn hoặc khai tử, quyết khi làm.)

**Đợt 3 — Ghép vào hồ sơ học viên + tín hiệu "đang gặp vấn đề":**
- `admin_students` detail: thêm mục Listening (tổng lượt, điểm TB, thời lượng TB, lượt abandoned, phiên chép chính tả gần nhất) — link sang trang attempts đã filter sẵn học viên đó.
- Tín hiệu vấn đề: đếm `abandoned` (hiện 46/418 ≈ 11%), tổng `trap_missed` theo bài (bài nào gài bẫy khó nhất), hàng flag listening chưa xử lý.

**Lưu ý khi triển khai:** PostgREST 1000-row cap (memory: recurring bug class) — mọi list join phải `.range()` phân trang; join users theo lô `in_()` như `quiz` admin đang làm; `abandoned` là status hợp lệ (cron Phase B), đừng lọc mất khi tính "đã làm".
