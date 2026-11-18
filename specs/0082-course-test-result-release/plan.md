# Implementation plan

## Architecture impact

Phần E của GOI-11. Các file và module ở mục Data and contracts. Ràng buộc riêng của gói (mục 8):

- Không sửa migration cũ; mọi thay đổi CSDL là migration mới trong dải 470–479 (472 không dùng). Gói này không sửa 381–388 của G04 và 440–451 của G09.
- Không viết mã gửi thư đơn, không dựng bảng công bố phía giáo viên, không dựng lối vào chấm thử trên trang công khai: ba việc đó thuộc G04, G09-T30, G05-T21.
- Không đổi cách chấm, điểm lưu, hay đường admin của bài kiểm tra; phần E chỉ đổi ai đọc được gì.
- Ở chế độ công bố, che ở giao diện không bao giờ là đủ: mọi trường ở 5.5.4 phải vắng khỏi phản hồi máy chủ; test 5.5.5 là cổng merge của T22.
- Mọi cờ mới mặc định tắt (`notifications_enabled`, `notification_emails`); production không bật cờ nào trong gói; `free_trial_enabled` theo rollout 0047.
- Không ghi email, tên, số tiền, mã đơn, nội dung bài vào log hay vào `params` của thông báo (trừ `order_code` trong `params` thông báo đơn của chính chủ đơn — cần để mở đúng đơn; không ghi vào log).
- Câu chữ: "giáo viên", "Đơn đăng ký", "Học phí", "Thanh toán", "Đăng ký khoá", "Đăng ký lại"; không "mua", "bán", "giá", "đơn hàng"; xưng "bạn"; full test tiếng Anh, bài kiểm tra của khoá tiếng Việt; không emoji; không "0/0", không band ở bài kiểm tra.
- Không gọi AI trả phí trong test; không gửi thư thật; không thao tác dữ liệu production.
- Không viết test kiểu đọc mã nguồn so chuỗi; riêng `brand-favicon.test.mjs` đã tồn tại được sửa có chủ ý, và `build-brand-assets.mjs --check` là kiểm tài sản sinh, không phải test mã nguồn.

## Data and contracts

Gói mục 5.5, chép nguyên:

### 5.5 Phần E — Luồng trả điểm bài kiểm tra của khoá

#### 5.5.1 Mô hình
- Một "bài kiểm tra" = một `class_assignments` `skill='course'`, `content_config.completion_mode='single_attempt'`, bộ đề trắc nghiệm thuần (ràng buộc hiện có dòng 975–988 của `admin_class_assignments.py`). Một lượt của một học viên = một `class_assignment_items` (UNIQUE theo bài giao + học viên). Làm bù/làm lại = **bài giao mới** cùng bank cho đúng người được chọn (đã có `student_ids`), nối bằng `retake_of`; không nhét lượt thứ hai vào cùng item, vì các RPC bài có giờ (mig 270, 276, 279, 280, 284, 285) đều giả định một item một lượt.
- Điểm chính thức của một lượt: `correct/total` do `course_verdict` ghi khi nộp (đã có). Gói này **không** đổi cách chấm, chỉ đổi **ai được đọc gì, lúc nào**.

#### 5.5.2 Migration 473 `backend/migrations/473_course_test_release_schema.sql`

**`class_assignments` (sửa, mọi cột NULL để bài cũ không đổi):**

| Cột | Kiểu | Ràng buộc · nghĩa |
|---|---|---|
| result_release_mode | text | NULL CHECK IN (`immediate`,`teacher_release`); NULL = như `immediate` |
| release_default_level | text | NULL CHECK IN (`score`,`score_correctness`,`full`); mức gợi ý sẵn ở bảng công bố |
| release_scheduled_at | timestamptz | NULL; hẹn công bố cả lớp |
| release_schedule_level | text | NULL, cùng CHECK; `(release_scheduled_at IS NULL) = (release_schedule_level IS NULL)` |
| release_expected_at | timestamptz | NULL; giờ dự kiến chỉ để hiển thị khi không hẹn |
| release_mode_locked_at | timestamptz | NULL; đặt ở lần nộp đầu tiên |
| opens_at | timestamptz | NULL = mở ngay khi bài hiện (`publish_at`); bắt đầu được từ mốc này |
| late_until | timestamptz | NULL; CHECK `late_until IS NULL OR (due_at IS NOT NULL AND late_until > due_at)` |
| retake_of | uuid | NULL FK `class_assignments(id)` ON DELETE RESTRICT; CHECK `retake_of <> id` |
| retake_kind | text | NULL CHECK IN (`makeup`,`retake`); `(retake_of IS NULL) = (retake_kind IS NULL)` |

CHECK thêm: `result_release_mode IS NULL OR (skill = 'course' AND content_config->>'completion_mode' = 'single_attempt')`.

**`course_result_releases`** (chỉ ghi thêm):

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| assignment_id | uuid | NOT NULL FK `class_assignments(id)` ON DELETE RESTRICT |
| item_id | uuid | NOT NULL FK `class_assignment_items(id)` ON DELETE RESTRICT |
| student_id | uuid | NOT NULL FK `students(id)` ON DELETE RESTRICT |
| level | text | NOT NULL CHECK IN (`score`,`score_correctness`,`full`) |
| level_rank | smallint | NOT NULL CHECK IN (1,2,3); khớp `level` (CHECK) |
| source | text | NOT NULL CHECK IN (`manual_class`,`manual_learner`,`schedule`) |
| note | text | NULL ≤ 2000 (nhận xét giáo viên, học viên đọc được) |
| released_by | uuid | NULL FK `users(id)` ON DELETE SET NULL (NULL khi `schedule`) |
| request_key | text | NOT NULL; `UNIQUE (item_id, level_rank)` (một dòng mỗi mức), `UNIQUE (request_key, item_id)` |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Trigger: BEFORE INSERT từ chối khi đã có dòng của item với `level_rank >= NEW.level_rank` (`release_level_not_higher`), khi item chưa `submitted_at` (`not_submitted`), khi bài giao không phải `teacher_release` (`not_release_mode`); BEFORE UPDATE/DELETE/TRUNCATE → `course_result_releases_append_only`.

**Khoá chế độ:** trigger `trg_course_release_mode_lock` BEFORE UPDATE OF `result_release_mode` ON `class_assignments`: `OLD.result_release_mode IS DISTINCT FROM NEW.result_release_mode` và (`OLD.release_mode_locked_at IS NOT NULL` hoặc tồn tại item của bài có `submitted_at`) → `RAISE EXCEPTION 'release_mode_locked'`. Trigger AFTER UPDATE OF `submitted_at` ON `class_assignment_items` WHEN `OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL`: `UPDATE class_assignments SET release_mode_locked_at = coalesce(release_mode_locked_at, now()) WHERE id = NEW.assignment_id AND result_release_mode IS NOT NULL`. Thứ tự khoá: trigger này chạy trong giao dịch đã khoá item rồi mới tới assignment — đúng thứ tự item → assignment mà 0046 FR-018 quy định; người thực thi đối chiếu lại với mig 270 trước khi viết.

**Thu quyền đọc thẳng** (chỉ khi 0046 chưa làm; kiểm bằng `select policyname from pg_policies where tablename in ('quiz_attempts','quiz_sessions')` trên PG test sau khi áp mọi migration): `DROP POLICY IF EXISTS quiz_attempts_select ON public.quiz_attempts; DROP POLICY IF EXISTS quiz_sessions_select ON public.quiz_sessions; REVOKE SELECT ON public.quiz_attempts, public.quiz_sessions FROM anon, authenticated;`. Trước khi viết, người thực thi chạy `grep -rn "from('quiz_attempts')\|from(\"quiz_attempts\")\|from('quiz_sessions')\|from(\"quiz_sessions\")" frontend/ backend/` và kiểm view/RPC gọi được bởi `authenticated` đọc hai bảng này (`select … from pg_views` / `pg_proc` có `prosecdef=false` nhắc tên bảng) — có kết quả là **dừng** (0046 FR-017 ghi cùng điều kiện). Kiểm thêm `course_section_submissions` không có quyền client đọc (`select grantee, privilege_type from information_schema.role_table_grants where table_name='course_section_submissions'`).

Rollback `backend/migrations/rollback/473_course_test_release_schema.sql`: gỡ trigger, giữ cột và bảng; **không** khôi phục policy đọc thẳng.

#### 5.5.3 Máy trạng thái (một học viên · một bài kiểm tra)

Tính ở `backend/services/course_result_release.py::course_test_state(item, assignment, releases, *, now)`, không lưu cột trạng thái. Ký hiệu: `close_at = coalesce(late_until, due_at)`; `start_at = coalesce(opens_at, publish_at, created_at)`.

| Trạng thái | Điều kiện | Học viên thấy (màn tờ KiemTraKhoa) | Chuyển tiếp |
|---|---|---|---|
| `not_open` | `now < start_at` | Màn 6 "Chưa mở": giờ mở, đếm ngược; nút Bắt đầu khoá kèm lý do | → `open` khi tới giờ (không cần tải lại) |
| `open` | `start_at ≤ now < close_at` (hoặc `close_at` NULL), `opened_at` NULL | Màn 2 trước khi làm, hộp xác nhận | Bắt đầu → `in_progress` |
| `in_progress` | `opened_at` có, `submitted_at` NULL, chưa quá mốc cắt | Màn 3 đang làm | Nộp, hết giờ, hoặc tới `close_at` (job `reap_expired_course_assessments` thu bài) → `submitted` |
| `submitted` (chỉ tức thời) | `submitted_at` có | — | `immediate`/NULL → `released` mức `full` ngay; `teacher_release` → `awaiting_release` |
| `awaiting_release` | `teacher_release`, `submitted_at` có, chưa có dòng công bố | Màn 4 "Đã nộp, chờ giáo viên công bố": giờ nộp, số câu đã làm/bỏ trống, thời lượng, giờ dự kiến = `coalesce(release_scheduled_at, release_expected_at)`; nếu `late_minutes` có: "Đã nộp trễ N phút" | Công bố/hẹn giờ → `released` |
| `released` | có dòng công bố (mức = `max(level_rank)`), hoặc chế độ `immediate` đã nộp | Màn 5/6 theo mức | Nâng mức (giữ `released`); làm lại → bài giao mới `retake` |
| `absent` | `opened_at` NULL và `close_at` có và `now ≥ close_at` | Màn 6 "Bạn chưa làm bài này": không điểm, không 0 | Làm bù → bài giao mới `makeup` |

`late_minutes = ceil((submitted_at − due_at) / 60 s)` khi `due_at` có và `submitted_at > due_at`, ngược lại NULL. Một lượt nối `retake_of`: học viên xem "lượt mới nhất" theo chuỗi `retake_of` (gốc → con mới nhất theo `created_at`), lượt cũ vẫn mở được bằng đường dẫn của chính nó.

#### 5.5.4 Mức hiển thị → trường được trả cho học viên

| Trường | chưa công bố | `score` | `score_correctness` | `full` |
|---|---|---|---|---|
| trạng thái, `submitted_at`, `answered_count`, `blank_count`, `duration_sec`, `late_minutes`, giờ dự kiến | có | có | có | có |
| `correct`, `total`, `pct` (cả bài) | **không** | có | có | có |
| nhận xét giáo viên (`note` của dòng công bố mới nhất) | không | có | có | có |
| bảng theo buổi (0043: đúng/tổng, tỉ lệ, "Cần ôn" < 60%) | không | không | có | có |
| `is_correct` từng câu, đáp án học viên chọn | không | không | có | có |
| đáp án đúng, `accept`, `explain`, `why_wrong` | không | không | không | có, **và** luật mở đáp án 0046 FR-011 (sau `due_at`/`close_at` hoặc khi mọi học viên còn trong lớp đã nộp) đã thoả; chưa thoả → `answers_release_at` cho giao diện ghi "Đáp án mở sau …" |

`immediate`/NULL = cột `full` ngay khi nộp (đúng hành vi hiện tại, cộng các luật của 0046 nếu 0046 đã merge).

#### 5.5.5 Cổng máy chủ — một hàm, áp mọi đường đọc
- `course_result_release.result_gate(item_id | None, *, user_id, now) -> ResultGate(applies: bool, state, level_rank: 0..3, answers_open: bool)`; `applies=False` cho mọi phiên/item không phải bài `teacher_release` (đường cũ chạy y nguyên, không thêm truy vấn khi item không có `result_release_mode` — đọc cột cùng lượt đọc `class_assignments` sẵn có). Đọc lỗi → coi như chưa công bố (fail-closed), giống `_sealed_course_session_ids`.
- Áp ở (mỗi điểm một dòng trong `verification.md`):

| Đường | Hàm | Việc phải làm khi `applies` và `level_rank` < yêu cầu |
|---|---|---|
| `POST /api/quiz/sessions/{id}/progress` | `log_progress` → `_course_attempt_feedback` | không trả phần tử phản hồi nào (mảng rỗng, chỉ `client_id` đã lưu) |
| `PATCH /api/quiz/sessions/{id}` | `end_session` | `total_correct`, `total_wrong`, `accuracy` = `null` |
| `POST /api/quiz/course/verdict` | `course_verdict` | vẫn ghi điểm vào item như hôm nay; phản hồi bỏ `correct`, `total`, `pct`, `passed`, chỉ trả `{"state":"awaiting_release", "submitted_at", "answered_count", "blank_count"}` |
| `GET /api/quiz/course/report` | `course_answer_report` | `< 2`: `{"sealed": true, "state", …}` không có câu; `= 2`: có `is_correct`, không đáp án/lời giải; `3`: như hôm nay (kèm luật 0046) |
| `GET /api/quiz/banks/{bank_id}` | `get_bank_for_play` | lịch sử lượt (`mastery.attempts`) bỏ `pct`, `correct`, `right`; `answers_sealed: true` |
| `GET /api/quiz/banks/{bank_id}/course-resume` | `get_course_resume` | `last_stage`, `retake.*` = `null`; `answered[].is_correct` = `null` |
| `GET /api/quiz/progress` | `student_progress` | phiên của bài bị gate không vào `recent_sessions` có điểm, không vào `avg_accuracy` |
| `GET /api/quiz/mistakes` | `student_mistakes` | không có dòng của bài bị gate (đang dùng `_sealed_course_session_ids`, mở rộng hàm đó gọi `result_gate`) |
| `GET /api/class/my-assignments`, `GET /api/class/me` | `_decorate` | `score`, `passed_at` = `null`; thêm khối `course_test` (5.5.6) |
| `GET /api/student/today` (G07) | `services/student_today.py` | dùng khối `course_test`, không đọc `score` thô |
| `GET /api/me/kp-mastery`, `/api/me/roadmap` | `backend/routers/kp.py` | không ghi bằng chứng KP từ hàng của bài một lượt (0046 FR-019); CHƯA KIỂM nơi ghi: `grep -n "_record_quiz_kp_evidence" backend/services/quiz_service.py` (dòng 2961) |
| Mọi đường admin/giáo viên (`assignment_id`, `/admin/...`) | — | không đổi (FR-075) |

- Test hành vi bắt buộc `backend/tests/test_course_result_release_no_leak.py`: dựng một item `teacher_release` đã nộp (supabase giả theo mẫu test quiz hiện có — `grep -ln "single_attempt" backend/tests | head`), gọi **mọi** route ở bảng trên bằng TestClient, duyệt đệ quy JSON trả về và khẳng định không có khoá `score, correct, pct, accuracy, total_correct, total_wrong, is_correct, answer, accept, explain, why_wrong, right` mang giá trị khác `null`; rồi công bố mức `score` → chỉ `correct/total/pct` xuất hiện; mức 2 → thêm `is_correct`; mức 3 → thêm đáp án. Đây là test hành vi theo phản hồi, không đọc mã nguồn.

#### 5.5.6 Khối `course_test` trả cho học viên (thêm vào `_decorate` và API G07)
```json
"course_test": {
  "release_mode": "immediate" | "teacher_release",
  "state": "not_open" | "open" | "in_progress" | "awaiting_release" | "released" | "absent",
  "attempt_kind": "initial" | "makeup" | "retake",
  "root_assignment_id": "uuid",
  "opens_at": "…Z" | null, "due_at": "…Z" | null, "late_until": "…Z" | null,
  "time_limit_minutes": 60 | null,
  "submitted_at": "…Z" | null, "late_minutes": 12 | null,
  "answered_count": 117 | null, "blank_count": 3 | null,
  "expected_release_at": "…Z" | null,
  "release": null | {"level": "score" | "score_correctness" | "full", "released_at": "…Z", "released_by_name": "…", "note": "…" | null},
  "result": null | {"correct": 96, "total": 120, "pct": 80},
  "answers_release_at": "…Z" | null
}
```
`pct` = `round(correct * 100 / total)`; không bao giờ trả band; không trả "0/0" (total = 0 → `result: null`).

#### 5.5.7 Migration 474 — hàm công bố `backend/migrations/474_course_test_release_rpcs.sql`

| Hàm | Tham số | Kết quả |
|---|---|---|
| `fn_course_result_release` | `p_actor_id uuid, p_assignment_id uuid, p_student_ids uuid[] NULL (NULL = mọi bài đã nộp), p_level text, p_note text, p_request_key text, p_source text` | `{released: n, upgraded: n, skipped_not_submitted: n, skipped_same_or_higher: n}`; `not_release_mode`, `not_found` |
| `fn_course_result_schedule` | `p_actor_id, p_assignment_id, p_at timestamptz NULL (NULL = huỷ hẹn), p_level text` | `scheduled`, `cancelled`, `in_past`, `not_release_mode` |
| `fn_course_result_run_schedules` | `p_limit int` | `{assignments: n, released: n}` — bài có `release_scheduled_at <= now()`: gọi `fn_course_result_release(..., NULL, release_schedule_level, NULL, 'schedule:'||id||':'||epoch, 'schedule')` chỉ cho item có `submitted_at <= release_scheduled_at`, rồi đặt `release_scheduled_at = NULL`, `release_schedule_level = NULL` |
| `fn_course_release_mode_set` | `p_actor_id, p_assignment_id, p_mode text, p_default_level text, p_expected_at timestamptz` | `updated`, `locked`, `not_eligible` |

`fn_course_result_release`: `SELECT … FROM class_assignments WHERE id = … FOR UPDATE` (khoá bài trước), rồi chèn dòng cho từng item thoả (`submitted_at IS NOT NULL`, mức mới > mức hiện có) theo thứ tự `item_id` tăng; `request_key` lặp → trả kết quả cũ (không chèn thêm). Không ghi thông báo trong hàm (job A đọc bảng công bố).

#### 5.5.8 API giáo viên/admin (thêm vào `backend/routers/admin_class_assignments.py`, prefix `/admin/cohorts`)

| Method · Path | Auth | Request | Response | Lỗi |
|---|---|---|---|---|
| POST `/{cohort_id}/assignments` (sửa model `AssignmentCreate`) | admin (như hiện tại) | thêm `result_release_mode: "immediate"|"teacher_release"|null`, `release_default_level`, `release_expected_at`, `opens_at`, `late_until` | như hiện tại | 400 khi đặt các trường này cho bài không phải `single_attempt` |
| PATCH `/{cohort_id}/assignments/{id}/release-mode` | admin hoặc giáo viên của lớp | `{"mode","default_level","expected_at"}` | `{"assignment"}` | 409 `release_mode_locked` |
| POST `/{cohort_id}/assignments/{id}/release` | admin hoặc giáo viên của lớp | `{"student_ids": [uuid]|null, "level", "note": str≤2000|null, "request_key"}` | `{"released","upgraded","skipped_not_submitted","skipped_same_or_higher"}` | 409 `not_release_mode`; 422 `invalid_level` |
| PUT `/{cohort_id}/assignments/{id}/release-schedule` | như trên | `{"at": "…Z"|null, "level"}` | `{"release_scheduled_at","release_schedule_level"}` | 422 `scheduled_in_past` |
| PATCH `/{cohort_id}/assignments/{id}/late-until` | như trên | `{"late_until": "…Z"|null}` | `{"assignment"}` | 409 khi bài đã đóng và có người vắng mà `late_until` mới đã qua (không mở lại bằng cách lùi) |
| POST `/{cohort_id}/assignments/{id}/retakes` | như trên | `{"student_ids":[uuid], "kind":"makeup"|"retake", "due_at", "time_limit_minutes"|null, "request_key"}` | 201 `{"assignment"}` (bài giao mới, `retake_of`, cùng `content_id`, cùng `content_config` trừ hạn) | 409 `makeup_not_absent` (makeup cho người không vắng), `retake_not_released` (retake trước khi người đó có kết quả) |
| GET `/{cohort_id}/assignments/{id}/tally` (sửa) | như hiện tại | — | thêm mỗi dòng `course_test_state`, `late_minutes`, `release_level`, `released_at`; thêm `counts.awaiting_release`, `counts.released`, `counts.absent` | — |

Trùng bank trong lớp (`backend/routers/admin_class_assignments.py`, khối trả 409 quanh dòng 986–998 ở `c3bc71574`; bản trước ghi 1000–1007) được bỏ qua khi `retake_of` có giá trị. Quyền "giáo viên của lớp": `services/staff_scope.py::resolve_staff_scope` + `scope.assert_cohort` của G09-T24 (lớp không thuộc giáo viên → 404); G09-T24 chưa merge thì chỉ admin. Hai dòng `late-until` và `retakes` hoãn cùng G11-T25, T26 (trả lời câu 16). **Giao diện gọi các route này là của G09**: bảng công bố ở G09-T30 (route `/admin/classes/[cohortId]/assignments/[assignmentId]/release`, tờ KiemTraKhoaGiaoVien); ô "Chế độ trả điểm" lúc giao bài ở `AssignDrawer` của G09-T26. G09-T27 thêm API đọc `result` riêng cho trang Kết quả một bài giao; `tally` mở rộng ở bảng trên vẫn giữ cho bảng công bố.

#### 5.5.9 Migration 475 — nộp trễ và vắng (`475_course_test_late_window.sql`)
Mốc cắt bài có giờ hiện tính `min(opened_at + time_limit, due_at)` (mig 280 "snapshot timed course cutoff", mig 272 khoá `due_at` sau khi bắt đầu). Thay mốc `due_at` bằng `coalesce(late_until, due_at)` trong các hàm: `quiz_finalize_timed_course_session`, `quiz_insert_timed_course_attempts`, hàm bắt đầu bài có giờ (mig 270), `mark_timed_course_assignment_started` (mig 272) và `_assert_course_session_accepting` (Python, `quiz_service.py` dòng 3299), `reap_expired_course_assessments` (5596). Người thực thi **phải** đọc định nghĩa mới nhất của từng hàm (`grep -ln "FUNCTION public.quiz_finalize_timed_course_session" backend/migrations/*.sql | sort | tail -1`, tương tự các hàm khác) và chép nguyên thân, chỉ đổi biểu thức mốc. `late_until` cũng bị khoá như `due_at` sau khi bài có giờ bắt đầu, **trừ** lệnh kéo dài `late_until` (chỉ tăng). Điều kiện dừng: nếu một hàm đọc `due_at` ở hơn hai chỗ với nghĩa khác nhau, dừng và báo danh sách chỗ.

#### 5.5.10 Migration 476 — làm bù/làm lại (`476_course_test_retake_links.sql`)
Chỉ cần nếu 473 chưa có `retake_of` (473 đã có) → 476 thay `class_assignments` unique/dup guard nếu có ràng buộc CSDL chặn cùng bank trong lớp (CHƯA KIỂM: `grep -n "content_id" backend/migrations/*class_assign*.sql | grep -i "unique"`; không có ràng buộc CSDL thì không viết 476, chỉ sửa kiểm Python).

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.
