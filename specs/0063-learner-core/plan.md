# Implementation plan

Nguồn: `GOI-07-loi-hoc-vien.md` mục 2, 5.3, 5.6, 5.8, 6 (T05, T13, T14), 7. Đối chiếu ở staging `e940c936` (23/11/2026); người thực thi đo lại số dòng trước khi sửa.

## Architecture impact

- **Cờ** — `backend/services/feature_flags.py`: thêm `is_learner_v2_enabled(user_id)` và `ais_learner_v2_enabled(...)` theo mẫu `is_vocab_curated_enabled` (L95). `backend/routers/auth.py` `/auth/me` (L254; nhánh `USE_ASYNC_DB` L331–340 và nhánh đồng bộ L246–251) thêm trường ở **cả hai** đường. `backend/models/auth.py` `AuthMeResponse` thêm `learner_v2_enabled: bool = False`. `backend/routers/admin.py`: `POST /admin/users/{user_id}/learner-v2-flag` chép mẫu `vocab-flag` (L5065). Frontend `frontend/lib/auth-wire-model.mjs`: hàm `learnerV2Enabled(me)` đọc mềm; `normalizeAuthMe` (danh sách 5 cờ bắt buộc) **không đổi**.
- **API** — route trong `backend/routers/student_home.py` (prefix `/api/student` sẵn có); logic `backend/services/student_today.py` (mới); model `backend/models/student_today.py` (mới), khai `response_model`. Chạy các phần song song theo mẫu `get_home_summary_concurrent` (`backend/services/student_home_aggregator.py` L68: mỗi phần một client `database.thread_supabase_admin`, lọc tường minh theo người gọi), phần lỗi vào `degraded`. Bài giao gọi `_visible_assignments` của `routers/class_student.py` qua một hàm bọc trong service, import trong thân hàm (tránh vòng import, như `student_home.py` làm với `account_display_name`).
- **Điểm ghép với gói khác** (mỗi điểm một hàm trong `student_today.py`, trả rỗng khi nguồn chưa có): `_access_for` / `_credits_for` / `_orders_open_for` (G04 `/api/me/courses`, `/api/me/credits`, `/api/enrollment-orders/me` — chưa có ở staging), `_overdue_ids_for` (`services/learner_overdue.py`, NOTIFY-0079 — chưa có; dùng `is_missing`), `_trial_today_left_for` (`services/trial_caps.py`, TRIALCAP-0080 — chưa có), `_repeat_error_for` (GOI-12 — chưa có; trả `None`), `_next_lesson_for` (COURSELESSON-0064 `course_lessons` — chưa có; trả `None`), `_open_surveys_for` (GOI-13 — `[]`), `_mock_exams_for` (G08-T22 — `[]`). Gói nguồn merge thì nối đúng hàm đó trong PR của gói nguồn hoặc một PR nhỏ của G07 ngay sau.
- **Giao diện** — `frontend/app/(authed-home)/home/today-v2.tsx` (+ file con) vẽ khi `learnerV2Enabled(me)`; cây cũ giữ nguyên khi tắt. Component G03 (`frontend/components/ui/`), lớp/tiền tố `--av2-`.
- **Cổng kích hoạt** — `backend/services/activation_gate.py` **không** đổi ở spec này: route mới tự bị chặn với `is_active=false` như mọi route học viên; `test_activation_gate_inventory.py` vẫn qua. Miễn trừ là G07-T26 (bản sửa đổi).

## Data and contracts

### Migration (chỉ một cột)

Một file trong dải 420–439 của G07, lấy số trống đầu tiên lúc viết PR và thêm dòng `reserved`/`present` vào `backend/migrations/register.tsv` cùng PR:
```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS today_seen_at timestamptz;
```
Nullable, không default, không index (đọc theo khoá chính). Ghi chỉ từ backend (service role); không thêm vào danh sách cột học viên tự sửa ở mig 320 (`display_name, target_band, exam_date, self_level, …`). Rollback: `backend/migrations/rollback/<số>_users_today_seen_at.sql` `DROP COLUMN IF EXISTS today_seen_at`. Chạy qua runner có khoá advisory, staging trước; áp lên staging/production cần anh Andy gõ duyệt cho từng lần.

### `GET /api/student/today` (gói 5.3, bản 18/11)

```json
{
  "student": {"name": "Minh Anh"},
  "next_lesson": null,
  "assigned": [ { "...": "đúng dạng một phần tử assignments của /api/class/my-assignments" } ],
  "assigned_total_open": 3,
  "resume": [ {"kind": "listening|reading|speaking|dictation", "title": "…", "progress": {"done": 1, "total": 4}, "href": "/listening/…", "expires_at": "2026-11-17T09:00:00Z"} ],
  "state": "learning|first_day|order_pending|no_course",
  "banner": null,
  "access": [],
  "credits": null,
  "orders_open": [],
  "goal": {"target_band": 6.5, "exam_date": "2027-03-14", "weeks_left": 17},
  "new_results": [ {"kind": "writing|speaking", "title": "…", "returned_at": "…", "href": "/writing/result?essay_id=…"} ],
  "repeat_error": null,
  "trial_today_left": null,
  "open_surveys": [],
  "mock_exams": [],
  "degraded": []
}
```
Khi có dữ liệu: `next_lesson` = `{course_code, course_name, stage_no, lesson_code, lesson_no, lesson_count, title, video_seconds, practice_items, resume_seconds, href}`; `banner` ∈ `expiring|expired|out_of_credits`; `access[]` = nguyên dạng phần tử `items` của `GET /api/me/courses` (G04 mục 5.9: `kind, source, state, expires_at, days_left, can_renew, credits…`); `credits` = `{total, by_kind: {online, class}}`; `orders_open[]` = `{order_code, status: awaiting_transfer|transfer_reported|needs_info, product_title, supplement_by}`; `repeat_error` = `{label, count, of, review_href|null, total_errors}`; `mock_exams[]` = `{exam_id, title, mode: live|self_paced, state, closes_at, total_minutes, href}`; `open_surveys[]` = `{survey_id, course_name, closes_at}`.

Quy tắc từng phần:
- `assigned`: `_visible_assignments(student, now, cohort_ids)` qua hàm bọc; lọc chưa nộp; quá hạn trước rồi hạn gần nhất; cắt 5; `assigned_total_open` là tổng trước khi cắt. Không lớp → `[]`, `0`.
- `resume`: đọc 4 bảng có `resume_expires_at` (mig 224: `sessions`, `reading_test_attempts`, `listening_test_attempts`, `dictation_attempts`; `writing_assignments` ở mig 224 chỉ có cột `renderer_affinity_*`, không có hạn làm tiếp nên Writing không vào `resume`) với `resume_expires_at > now()` và trạng thái đang làm của người đó; cắt 4, mới nhất trước. Tên cột trạng thái và tiêu đề từng bảng: người thực thi đọc migration tạo bảng trước khi viết (gói ghi `CHƯA KIỂM`).
- `state`: theo FR-019; `first_day` = có quyền online còn hạn và chưa có dòng `course_lesson_progress` nào (trước COURSELESSON-0064: không bao giờ `first_day`). Không có dữ liệu G04 → học viên có lớp đang hoạt động là `learning`, không lớp và không quyền là `no_course`.
- `banner`: `expiring` khi có quyền online `can_renew` và chưa hết hạn, không có đơn đăng ký lại đang mở; `expired` khi mọi quyền online đã hết hạn; `out_of_credits` khi `credits.total = 0` và người đó có nguồn lượt.
- `goal`: `users.target_band`, `users.exam_date` (mig 005; đồng bộ với mục tiêu admin qua mig 452). `target_band` null → `goal: null`. `weeks_left = ceil((exam_date − hôm nay VN)/7)`, null khi không có ngày thi hoặc ngày đã qua.
- `new_results`: bài Writing `delivered` và phiên Speaking có kết quả, thời điểm trả > `users.today_seen_at` (mốc trống → 7 ngày gần nhất, câu hỏi mở 5); lấy hai bài **cũ nhất** trong số đó, trả về sắp mới nhất trước, kèm `returned_at` từng bài. Route GET không ghi gì (FR-078).
- `POST /api/student/today/seen` body `{seen_until: timestamptz}` → `204`. Máy chủ: `seen_until > now() + 1 phút` → 422; còn lại `UPDATE users SET today_seen_at = greatest(coalesce(today_seen_at, '-infinity'), seen_until) WHERE id = <người gọi>` (chỉ tiến lên, idempotent). Route ghi đúng một cột của chính người gọi; frontend gọi sau khi khối "Vừa có kết quả" đã vẽ.
- `trial_today_left`: chỉ khi `state = 'no_course'`; nguồn chưa có, tạm dừng hoặc không đủ điều kiện → `null`.
- `degraded`: tên phần (`assigned`, `resume`, `credits`, `access`, `orders_open`, `new_results`, `goal`, `mock_exams`) ném lỗi khi đọc. Nguồn chưa có không vào đây. `repeat_error` không bao giờ vào đây (FR-071).
- Sau khi thêm model: sinh lại `frontend/types/api.d.ts` trong cùng PR (lệnh ở gói mục 7, dòng "Kiểu API lệch").

### Cờ

- `learner_v2_enabled` theo FR-072. Hai khoá `runtime_flags`: `learner_v2` (công tắc khẩn, mặc định tắt — phải bật trên staging thì cờ lẻ mới có tác dụng) và `learner_v2_all` (mặc định tắt, không bật trong spec này). Thêm hai dòng vào bảng `runtime_flags` bằng đường đã có (`PATCH /admin/runtime-flags/{key}`, `backend/routers/admin_flags.py`) nếu khoá cần tồn tại trước; người thực thi kiểm `runtime_flags.is_enabled(..., default=False)` với khoá chưa có trả false để khỏi cần migration dữ liệu.
- Endpoint admin: body `{enabled: bool}`, ghi `users.feature_flags.learner_v2`, trả `{user_id, learner_v2: bool}` đọc lại sau ghi.

## UI and interaction

- Cây mới gọi `/api/student/today` đúng một lần khi vào trang; chọn bố cục theo `state` + `banner`; mỗi khối nhận đúng phần của nó và cờ `degraded` của phần đó.
- Bản máy tính theo tờ `thiet-ke/Main.dc.html` mục 1 (có khoá, đang học) và `HomNayTrangThai.dc.html` mục 2–5; bản điện thoại theo `Mobile.dc.html` và Main mục 6; dải hết lượt theo `GiaHanThemLuot.dc.html`; khung theo `ThanhPhanKhungTrang.dc.html` mục 1, 3. Khác biệt với tờ ghi trong PR.
- `home.css` có luật toàn cục (`* {box-sizing}`, `a { color: inherit; text-decoration: none }`) áp lên cả cây mới: component G03 tự đặt màu và gạch chân liên kết; không sửa `home.css`, không đổi `pageStylesheets` theo cờ (layout là server component, không đọc được cờ người dùng).
- Trạng thái tải/rỗng/lỗi: `ui-states.md`.

## Work decomposition

| Task | Nhiệm vụ gói | Nội dung | Phụ thuộc |
|---|---|---|---|
| T05 | G07-T05 | cờ `learner_v2`, `/auth/me`, endpoint admin, `learnerV2Enabled` | spec duyệt |
| T13 | G07-T13 | migration `today_seen_at`, service, model, route GET + POST `seen`, pytest, `api.d.ts` | spec duyệt (song song T05) |
| T14 | G07-T14 | cây Hôm nay mới, năm trạng thái, test React, ảnh | T05, T13, G03 (đã có) |

T05 và T13 không chung file (trừ `api.d.ts` sinh lại — PR sau rebase và sinh lại). Mỗi task một PR vào `staging`, lớp `high-risk` (spec `risk: high`), `Spec: LEARNERCORE-0063`.

Vướng mắc và cách gỡ: (a) `test_auth_response_models.py` so khoá trả về với model → thêm trường cả hai nơi cùng commit. (b) Nhánh `USE_ASYNC_DB` có hai đường → test cho mỗi nhánh. (c) 13 test nhắc `(authed-home)`: cây cũ giữ nguyên nên không được vỡ; vỡ là dấu hiệu đã sửa nhầm file cũ. (d) Trạng thái `no_course` và `order_pending` chỉ tới được trên thật sau G07-T26 và G04; trước đó test bằng dữ liệu giả.

## Rollout and rollback

Chi tiết ở `rollout.md`. Tóm tắt: migration lên staging trước (anh Andy gõ duyệt), rồi backend (T05, T13), rồi giao diện (T14). Cờ mặc định tắt cho mọi người; bật lẻ cho tài khoản QA trên staging. Lùi giao diện = tắt `runtime_flags('learner_v2')`. Lùi API = revert PR (route mới, không ai khác gọi). Cột thêm nullable, mã cũ không đọc.

## Verification strategy

- T05: `cd backend && python -m pytest tests/test_auth_response_models.py tests/test_activation_gate_inventory.py -q`; pytest mới cho 4 tổ hợp cờ (`learner_v2_all` × lẻ × công tắc) ở cả hai nhánh DB; pytest endpoint admin (admin 200, học viên 403, đọc lại đúng); `node --test frontend/tests/auth-wire-model.test.mjs` có ca "thiếu trường → false, không null".
- T13: pytest với supabase giả theo mẫu `backend/tests/test_student_home_aggregator.py`: không lớp; lớp + 2 bài quá hạn + 1 bài đã nộp; một phần ném lỗi → `degraded`; bài dở hết hạn bị bỏ; bốn `state` theo thứ tự FR-019; `credits` một con số chung; đơn `needs_info` có `supplement_by`; `_repeat_error_for` trả `None` → null; trả một lỗi → đúng khung; ném lỗi → null và `degraded` không đổi; `new_results` trước/sau mốc, ba bài mới → hai bài cũ nhất rồi bài thứ ba ở lần sau; GET không ghi (đếm lời gọi update = 0); `POST seen` chỉ tiến lên, giá trị nhỏ hơn không kéo lùi, giá trị tương lai 422, chỉ ghi dòng của người gọi. `test_activation_gate_inventory.py` qua (route chưa miễn). `git diff --exit-code frontend/types/api.d.ts` sau sinh lại. Migration: chạy hai lần không lỗi, rollback chạy được (test PG theo mẫu `test_*_postgres.py`).
- T14: `frontend/tests/react/today-v2.test.tsx`: bốn `state`, ba `banner`, một khối hỏng, N = 0 → "Hôm nay không có bài đến hạn.", quá hạn lên đầu, học viên lớp mã cũ không có khối lượt, có mục tiêu không có ngày thi, mỗi nguồn null → khối ẩn; `npm --prefix frontend run test:react`. Staging: bật cờ cho QA → ảnh 1280px và 390px khớp tờ (ghi khác biệt); tắt cờ → giao diện cũ y nguyên (ảnh trước/sau).
