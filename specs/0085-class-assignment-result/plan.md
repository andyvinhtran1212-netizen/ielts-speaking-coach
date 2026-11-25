# Implementation plan

## Architecture impact

Phần của GOI-09; khung, sidebar và quyền giáo viên theo ADMINIA-0074. Ràng buộc chung của gói (mục 8) áp nguyên.

Ràng buộc riêng của gói (mục 8):

- **Tờ thiết kế là chuẩn** cho mọi màn của gói; mọi màn nay đã có tờ, trừ hộp "Cấp lượt cho lớp cũ" (T43) và các chỗ điểm 23 đổi mà tờ chưa vẽ lại (bốn trạng thái theo dõi kỳ tự làm; dòng lượt chuyển và hạn) — các chỗ này dựng từ thành phần có sẵn theo FR, ghi trong PR "chưa có tờ". Tờ nào còn chữ "chuyển 50%", "nghỉ giữa các phần", "nhiều giáo viên" thì FR của file này thắng. Khung, sidebar, khung giáo viên, bảng ngưỡng, thành phần giao bài, khối tóm tắt học viên, dữ liệu mẫu: theo `thiet-ke/CHUAN-ADMIN.md`; phần "Sửa đổi 17/11 chiều" thắng phần trên của chính file đó và thắng tờ nào còn sót chữ cũ. Bảng tờ → nhiệm vụ:

| Tờ | Nhiệm vụ |
|---|---|
| ThanhPhanKhungTrang2 (mục 7, 8, 10), CheDoToiCongKhaiAdmin | T08, T19, T20 |
| ThanhPhanDuLieu (bảng, modal, ngăn kéo, "Giao bài theo buổi", khối tóm tắt học viên) | T10, T26, T03 |
| AdminViecCanLam | T06, T18 |
| AdminDanhBa | T03, T10 |
| HoSoHocVien | T04, T11, T35 |
| AdminLop | T29, T14, T43 (hộp "Cấp lượt cho lớp cũ" chưa có tờ thiết kế riêng: dựng từ hộp xác nhận của "Cấp thêm lượt") |
| AdminKhaoSat, HocVienNoiGi | GOI-13 phần A dựng (Q34 đã đóng) (sửa 18/11 theo GOI-13); G09 chỉ có mục sidebar "Chưa mở" tới khi trang lên |
| Admin1024 | T17, T18, T29 (bản 1024px của ba trang) |
| AdminKetQuaBaiGiao | T27, T28 |
| KiemTraKhoaGiaoVien | T30 |
| AdminKhoaHoc, AdminDonDangKy | T13 |
| AdminLuotVaMa | T12, T15 |
| AdminChamWriting · AdminChamLai · AdminChamSpeakingThiThu | T17 · T39 · T38 |
| AdminKyThi · AdminKyThiChiTiet | T31, T32 · T33, T34 |
| AdminNoiDung, AdminNoiDungVietNoi, AdminNoiDungTuVungNguPhap | T36, T37 |
| AdminThuVienCongKhai | G06 (G09 chỉ có mục sidebar) |
| AdminBaoCao | T41 |
| AdminSuCo | T07, T16 |
| AdminHeThong | T18 (AI và mô hình, Công cụ QA); Bảo mật giữ `/admin/mfa` |
| AdminCaiDat | T22, T23 (thẻ Chấm thử: GOI-11 T16) |
| AdminGiaoVienThongBao | T40 (Gửi thông báo: GOI-11 T13) |
| GiaoVien | T20 |

- Quy tắc trong "Ghi chú cho lập trình" của các tờ Đợt 5 là **đề xuất của người thiết kế** trừ khi `00-QUY-UOC-CHUNG.md` mục 2 đã chốt. Chỗ đề xuất chưa chốt nằm ở mục 10 kèm mặc định tạm; người thực thi dùng mặc định tạm và làm thành cấu hình, không tự đổi.
- Bản 1024px: chỉ ba trang có tờ riêng (`Admin1024.dc.html`: Việc cần làm → T18, Chấm Writing → T17, Lớp → T29). Công cụ nội bộ của admin (Công cụ QA, các trang `context` cũ) dùng khuôn bảng có sẵn của G03, không có tờ riêng và không chờ tờ.
- Nhãn `[NGAY]`/`[THÊM]`, tên cột, tên API, mã kỳ thi dạng máy, mã ngộ nhận, UUID, slug, đường dẫn file, tên model **không** hiện trên giao diện.
- Câu chữ: "giáo viên" (không "giảng viên", "thầy"); "Đơn đăng ký", "Học phí"; ngày dd/mm/yyyy, giờ 24 giờ, múi giờ Việt Nam; USD 2 chữ số thập phân; không band khi thiếu dữ liệu; không "0/0"; ô không có việc ghi "Không có"/"chưa có".
- Sáng/tối: mọi màn mới chỉ dùng token `--av2-*` (GOI-03 mục 5.9), không màu hex trong component; kiểm cả hai chế độ ở 1280px.
- Quyền: mọi kiểm ở máy chủ; giáo viên qua `staff_scope` (mỗi lớp một giáo viên; không nơi nào khác tự so `cohorts.instructor_id`); không gọi Supabase trực tiếp cho dữ liệu admin.
- Lượt chấm: G09 không tính số lượt chuyển, hạn của phần lượt chuyển, hay ai đủ điều kiện nhận lượt; mọi số lấy từ G04. Giao diện không ghi cứng "50%", "100%", "60 ngày", "45 ngày" — đọc từ cấu hình hoặc response.
- Kỳ tự làm: không màn admin nào có điều khiển hay nhãn cho "nghỉ giữa các phần", "làm tiếp sau", "mở lại phần". Admin và giáo viên không bị giới hạn một phiên; admin vẫn AAL2.
- Trả kết quả thi thử: không nút nào ngoài thẻ "Trả kết quả" của trang kỳ thi gọi API trả.
- Ngưỡng: không hằng số ngưỡng trong mã giao diện hay backend ngoài `services/ops_thresholds.py` (giá trị mặc định) và migration 440.
- Trang nhập thủ công: chỉ ẩn khỏi sidebar và thêm dải cảnh báo; không xoá route, không chặn API (đường lui).
- Mọi chuyển hướng admin trong gói là 307. Không đổi URL công khai. Không đổi cascade CSS trong `components/authed-shell.tsx`.
- Không đụng script và dữ liệu của dây chuyền Hermes ngoài việc gọi helper ghi lô (T36); nếu một script thuộc Hermes, bỏ qua và ghi trong PR.

## Data and contracts

### Migration (gói 5.3, chỉ các số của spec này)

| Số | File | Nội dung | Nhiệm vụ |
|---|---|---|---|
| 443 | `443_saved_learner_groups.sql` | `saved_learner_groups(id, name text NOT NULL, owner_id uuid NOT NULL, cohort_id uuid NULL, created_at, archived_at NULL)`; `saved_learner_group_members(group_id, student_id, PRIMARY KEY (group_id, student_id))`. Nhóm là danh sách tên cố định. | T25 |
| 444 | `444_class_lesson_review_items.sql` | `class_lessons.review_items jsonb NOT NULL DEFAULT '[]'` (mỗi phần tử `{bank_id, qid, source_assignment_id, added_by, added_at}`); `class_assignment_reminders(assignment_id, student_id, sent_on date, sent_at timestamptz, sent_by uuid, PRIMARY KEY (assignment_id, student_id, sent_on))` để chặn nhắc quá một lần một ngày và hiện "Đã nhắc HH:MM". | T27 |

### API (gói 5.4, các khối của spec này)

**Kết quả một bài giao** — **một** API tổng hợp thay ba API của ba tab (thêm vào `routers/admin_class_assignments.py`, logic ở `services/assignment_result.py`):

`GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/result?group_by=truc_nhom|subtype` — quyền: admin, hoặc giáo viên của lớp (`staff_scope`). Response:

```json
{
  "assignment": {"id": "…", "title": "…", "skill": "course", "variant": "objective",
                 "lesson": {"id": "…", "lesson_no": 13, "date": "2026-11-19"},
                 "due_at": "…Z", "pass_pct": 70, "question_count": 90,
                 "release_mode": null, "recipient_scope": "class"},
  "states": {"on_time": 9, "late": 2, "in_progress": 1, "not_opened": 1, "no_account": 1},
  "who": [{"student_id": "…", "name": "…", "state": "late", "submitted_at": "…Z",
           "late_minutes": 190, "opened_at": "…Z", "stalled": false,
           "overdue": false, "last_reminded_at": null}],
  "performance": {"submitted": 11,
                  "first_run": {"scores": [{"student_id": "…", "pct": 64}],
                                "median_pct": 64, "pass_rate": 0.45, "retake_students": 4},
                  "median_duration_sec": 1380,
                  "previous": {"assignment_id": "…", "title": "…", "median_pct": 71}},
  "weak_spots": {"group_by": "truc_nhom", "excluded_essay_questions": 3,
                 "groups": [{"key": "HIEN-TAI-DON-TIEP-DIEN", "label": "…",
                             "label_source": "table", "question_count": 12,
                             "wrong_rate": 0.41, "students_wrong_2plus": 7, "median_sec": 22,
                             "top_questions": [{"qid": "…", "prompt": "…", "answer_text": "…",
                                                "attempted": 11, "wrong": 8,
                                                "top_wrong": {"option": "B", "text": "…",
                                                              "count": 6, "why_wrong": "…"}}]}]},
  "attention": [{"student_id": "…", "name": "…", "first_pct": 42, "delta_prev": -18,
                 "reasons": ["below_pass", "dropped_twice", "too_fast", "many_retakes", "stalled"]}],
  "teach_next": {"suggested": [{"qid": "…", "group_key": "…"}],
                 "saved": {"lesson_id": "…", "items": ["…"], "saved_at": "…Z"}},
  "sources_failed": []
}
```

Quy tắc:
- `variant` ∈ `objective` (bài `skill='course'` chấm máy, quiz), `rubric` (Writing/Speaking), `course_test` (đề giữa/cuối kỳ: `content_config.completion_mode='single_attempt'`). Với `rubric`: `weak_spots.group_by = "criterion"`, `groups[]` là từng tiêu chí với `median_band`, thêm `top_annotation_kinds: [{kind, essays}] | null`; `performance.first_run` thành `bands`. Với `course_test`: `group_by = "lesson"`, `groups[].key` = `B01`…`B20`, thêm `matrix: [{student_id, cells: [{lesson, correct, total}]}]` với `total` = số câu của buổi trong đề.
- Năm trạng thái suy từ dữ liệu hiện có: `no_account` = `students.user_id IS NULL`; `on_time` = `submitted_at <= due_at`; `late` = `submitted_at > due_at`; `in_progress` = chưa nộp và `opened_at` có; `not_opened` = chưa nộp và `opened_at` NULL. Người chưa nộp đã qua hạn mang thêm `overdue: true` (không phải trạng thái thứ sáu). `stalled` lấy cờ `course_stalled` sẵn có của `course_attempt_report`.
- `weak_spots` chỉ tính lượt đầu (`quiz_sessions.kind='run'`, `attempt_no` nhỏ nhất của mỗi câu); gom theo `quiz_attempts.skill` (hoặc `subtype`); **không cắt** số nhóm; `top_questions` tối đa 3 câu mỗi nhóm; loại câu tự luận (subtype E1–E3 — tên subtype CHƯA KIỂM: `grep -n "E1\|E2\|E3" backend/scripts/import_course_exercise_bank.py`).
- `label`: tra bảng tên hiển thị `backend/content/course-labels/truc_nhom_vi.json` và `subtype_vi.json` (file mới, không phải migration); không có tên → trả chính mã và `label_source: "code"` (giao diện vẫn hiện, không báo lỗi). Tên trên tờ thiết kế là tên đề xuất (Q27).
- `performance`, `weak_spots` = `null` khi chưa ai nộp. `performance.previous` = `null` khi lớp không có bài trước cùng loại (xếp theo `class_lessons.lesson_no`, rồi `due_at`).
- `attention.reasons` dùng ngưỡng ở Cài đặt (`too_fast_sec_per_question`, `many_retakes_count`, `stalled_hours`); `below_pass` dùng `pass_pct` của bài.
- `teach_next.suggested`: tối đa 3 câu theo FR-130.
- GOI-11 phần E: với bài chế độ công bố, API này (phía nhân sự) luôn có điểm (FR-11-075).

API đi kèm:

| Method · path | Quyền | Request → Response |
|---|---|---|
| `PATCH /admin/cohorts/{c}/lessons/{lesson_id}/review-items` | admin, giáo viên của lớp | `{ items: [{bank_id, qid, source_assignment_id}] }` → `{ lesson }` |
| `POST /admin/cohorts/{c}/assignments/{a}/remind` | admin, giáo viên của lớp | `{ student_ids: [uuid] \| null }` (null = mọi người chưa nộp đã qua hạn) → `{ sent: int, skipped_already_today: int, skipped_no_account: int }`; ghi `class_assignment_reminders`; tạo thông báo `reminder` qua service của GOI-11 phần A (khoá chống trùng `remind:{assignment}:{student}:{ngày VN}`) |
| `GET /admin/cohorts/{c}/assignment-matrix` | admin, giáo viên của lớp | `{ assignments: [{id,title,due_at}], rows: [{student_id, name, cells: [{state_text}], done: int, due: int}] }` — bảng học viên × bài |

Ba API cũ (`tally`, `attempt-report`, `students/{u}/report`): **không xoá** trong gói này. `tally` còn được GOI-11 phần E mở rộng và bảng công bố dùng; `students/{u}/report` còn dùng cho "bài làm từng câu" của một học viên; `attempt-report` chỉ gỡ lời gọi ở frontend. Xoá endpoint là việc gói sau, sau khi không còn nơi gọi.

**Nhóm đã lưu và giao bài** (`routers/admin_learner_groups.py`; giao bài dùng `POST /admin/cohorts/{c}/assignments` hiện có)

| Method · path | Quyền | Ghi chú |
|---|---|---|
| `GET /admin/learner-groups?cohort_id=` · `POST` · `PATCH /{id}` · `DELETE /{id}` (lưu trữ) | admin, giáo viên (chỉ nhóm mình tạo, thành viên thuộc lớp mình) | `POST` body `{ name, cohort_id?, student_ids: [uuid] }` |
| `POST /admin/cohorts/{c}/assignments` (hiện có) | như hiện tại + giáo viên của lớp (T26) | Thành phần giao bài gửi `student_ids` khi "Chọn tay" hoặc "Nhóm đã lưu" (đã có `recipient_scope='subset'`, mig 193); thêm trường của GOI-11 5.5.8 (`result_release_mode`…) khi bài là bài kiểm tra |

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`. Mọi giao diện mới sau cờ `ADMIN_FRAME_V2` (tắt ở production); migration staging trước dưới khoá advisory.

## Verification strategy

Lệnh bắt buộc mỗi PR theo tầng và cách báo cáo ở gói mục 9:

Môi trường: preview Vercel của nhánh + backend staging. Tài khoản: QA admin có TOTP; hai tài khoản giáo viên kiểm thử (A dạy lớp kiểm thử 1, B dạy lớp kiểm thử 2); ba học viên kiểm thử `@staging-e2e.averlearning.com` (một có tài khoản + hồ sơ ở lớp 1, một chỉ có hồ sơ, một ở lớp 2). Dữ liệu: một bài giao Course 1 chấm máy có bài nộp, một đề giữa kỳ chế độ "giáo viên công bố", một kỳ thi kiểm thử live và một kỳ tự làm hai phần, một đơn kiểm thử và một đơn đăng ký lại (sau G04), một lớp kiểm thử có thành viên dùng mã cũ không kèm lượt. Không dùng production cho bất kỳ bước nào; không chép dữ liệu học viên thật.
Lệnh bắt buộc mỗi PR (theo tầng): `cd backend && python -m pytest tests/ -q`; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`; `npm --prefix frontend run test:react`; `cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build`; `node frontend/tooling/route-ownership-check.mjs`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Gói chỉ được báo "xong" khi 23 kịch bản có bằng chứng trên staging (đã merge vào `staging`), không phải chỉ trên preview nhánh. Kịch bản phụ thuộc gói khác chưa xong ghi "chưa chạy được" kèm tên gói, không tính là đạt. Lên production và bật `ADMIN_FRAME_V2` ở production là bước riêng, chờ anh Andy.
