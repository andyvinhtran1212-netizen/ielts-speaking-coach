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
| 445 | `445_mock_exam_audiences.sql` | Bảng `mock_exam_audiences` và các cột mới của `mock_exams` (5.5). Nới CHECK `mock_exams_exam_mode_chk` thành `IN ('sequential','retake','live','self_paced')`. Chưa đổi dữ liệu. | T31 |
| 446 | `446_mock_exam_mode_backfill.sql` | Điền `mock_exam_audiences` từ roster lớp của `mock_exams.cohort_id` và từ `mock_exam_assignments`; đổi `exam_mode` cũ sang tên mới; sửa `fn_set_exam_mode` (bản mới nhất: `grep -ln "fn_set_exam_mode" backend/migrations/*.sql \| sort \| tail -1`) nhận cả bốn giá trị. Chỉ chạy sau khi backend đọc được cả hai tên đã lên staging. | T31 |
| 447 | `447_mock_exam_events.sql` | `mock_exam_events(id, exam_id, sitting_id NULL, kind text, payload jsonb, actor_id NULL, created_at)` chỉ ghi thêm; `mock_exam_sittings.extra_seconds jsonb NOT NULL DEFAULT '{}'` (theo phần); `mock_exam_room_messages(id, exam_id, body, sent_by, sent_at)`. | T33 |
| 448 | `448_mock_exam_release_parts.sql` | `mock_exam_sittings.released_skills text[] NOT NULL DEFAULT '{}'`, `released_at timestamptz NULL`; `mock_exam_score_edits(id, sitting_id, skill, old_band, new_band, reason text NOT NULL, actor_id, created_at)` chỉ ghi thêm. Cột hiện có đánh dấu "đã trả" của sitting: CHƯA KIỂM (`grep -n "release" backend/services/mock_review_workflow.py \| head -20`); nếu đã có cột tương đương thì dùng lại, không thêm `released_at`. | T33 |

### API (gói 5.4, các khối của spec này)

**Kỳ thi** (sửa `routers/admin_mock_exams.py`)

| Method · path | Ghi chú |
|---|---|
| `POST /admin/mock-exams` (sửa) | Nhận `exam_mode: "live"\|"self_paced"` (vẫn nhận tên cũ, ánh xạ sang tên mới); cho phép thiếu đề của kỹ năng không dự thi; `skills: [..]` (≥1); tạo ở trạng thái `draft` không cần người thi. |
| `GET /admin/mock-exams` (sửa) | Mỗi kỳ thêm `display_state` ∈ `draft`, `scheduled`, `open`, `running`, `grading`, `released`; `audience_count`; `exam_mode` tên mới. |
| `GET /admin/mock-exams/{id}/audience` | `{ items: [{ user_id, student_id, name, cohort?, source: {kind: 'cohort'\|'learner'\|'group', label}, skills: [...], selected: bool, excluded_reason?, open_from?, open_until? }], practice_overlap: [{ skill, count }] }` |
| `PUT /admin/mock-exams/{id}/audience` | `{ add_cohort_ids?: [], add_student_ids?: [], add_group_ids?: [], set: [{user_id, selected?, skills?}], window?: {open_from, open_until} }` → như GET. 409 `exam_locked` khi đề đã khoá (thêm người sau khi phòng mở vẫn được, ghi `mock_exam_events`). |
| `POST /admin/mock-exams/{id}/schedule` | Kiểm điều kiện FR-144; 422 `not_ready` kèm `missing: [...]`; chuyển `status='published'`; gửi thông báo cho người được chọn (GOI-11). |
| `POST /admin/mock-exams/{id}/extra-time` | `{ sitting_id, section, seconds, reason }`. Kỳ `self_paced`: `section` phải là phần **đang chạy** của sitting đó, không thì 409 `section_not_running`; các phần sau lùi theo (5.5). |
| `GET /admin/mock-exams/{id}/live` (sửa) | Kỳ `self_paced`: mỗi người thêm `self_paced_state` ∈ `not_started` \| `in_progress` \| `submitted` \| `missed`, `current_section`, `section_time_left_seconds`, `started_at`, `expected_end_at`. `submitted` = mọi phần của người đó đã nộp, hoặc giờ cả bài đã hết (phần bỏ dở được tự nộp); `missed` = khoảng mở đã đóng mà chưa bắt đầu. Không có giá trị nào cho "nghỉ giữa phần" (FR-151). Thêm `idle_threshold_minutes` (T33). |
| `POST /admin/mock-exams/{id}/room-message` | `{ body }` |
| `GET /admin/mock-exams/{id}/analysis` | `{ band_distribution: {listening: [...]\|null, …}, top_wrong: {listening: [..≤10], reading: [..≤10]}, by_question_type: {...}, pacing: [{sitting_id, name, points: [...], long_pauses: [...]}], vs_previous: {...}\|null, writing_criteria_median: {...}\|null }` |
| `POST /admin/mock-exams/{id}/release` | `{ mode: 'complete_only'\|'include_partial', confirm_title, request_key }` → `{ released: int, partial: int, skipped: int }`; 422 `confirm_mismatch`. Gọi logic của `bulk-release` hiện có cho người đủ điều kiện; `include_partial` ghi `released_skills`. |
| `POST /admin/mock-exams/sittings/{id}/score-edit` | `{ skill, new_band, reason }` — chỉ sau khi đã trả; ghi `mock_exam_score_edits`, gửi thông báo. |
| `GET /admin/mock-exams/{id}/events` | Dòng thời gian cho thẻ Nhật ký; lọc `kind`. |
| `GET /admin/speaking/mock-queue` | Hàng chờ Speaking thi thử: `{ items: [{ sitting_id, exam: {id,title}, name, cohort, submitted_at, waited_hours, overdue, flags: [..], claimed_by? }] }`; lọc `exam_id`. Quyền: admin, giáo viên (lớp mình). |

Giữ nguyên: `/open`, `/advance`, `/collect`, `/live`, `/roster`, `/retest-summary`, `/assignments` (dùng cho thi bù), `/sittings/{id}/retest-flags`, `/sittings/{id}/pacing`, `/sittings/{id}/record-speaking`, `/bulk-final-bands`.

### 5.5 Mô hình người dự thi và tên chế độ (chép nguyên)

`mock_exam_audiences`:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| exam_id | uuid NOT NULL REFERENCES mock_exams ON DELETE CASCADE | |
| user_id | uuid NULL REFERENCES users | NULL khi học viên chưa có tài khoản (dòng chỉ để hiện, `selected=false`) |
| student_id | uuid NOT NULL REFERENCES students | |
| source_kind | text CHECK IN ('cohort','learner','group') | Nguồn đầu tiên đưa người này vào |
| source_cohort_id / source_group_id | uuid NULL | |
| skills | text[] NOT NULL | ⊆ kỹ năng của kỳ thi, ≥1 |
| selected | boolean NOT NULL DEFAULT true | Bỏ chọn = không dự thi |
| excluded_reason | text NULL | Ví dụ `no_account` |
| open_from, open_until | timestamptz NULL | Khoảng mở riêng (tự làm, thi bù) |
| purpose | text CHECK IN ('main','makeup') DEFAULT 'main' | Thi bù là mục đích, không phải chế độ |
| added_by, added_at | | |
| UNIQUE (exam_id, student_id, purpose) | | Khử trùng theo học viên |

Cột mới của `mock_exams`: `skills text[] NULL` (NULL = đủ bốn như cũ), `allow_early_advance boolean NOT NULL DEFAULT false`, `starts_at timestamptz NULL` (giờ bắt đầu phòng live), `draft_state jsonb NULL` (bước đang soạn).

Lớp tương thích (bắt buộc, vì phía học viên và các test hiện đọc tên cũ):
1. `services/mock_exam_modes.py`: `normalize(mode)` ánh xạ `sequential→live`, `retake→self_paced`; `is_live(mode)`, `is_self_paced(mode)`. Mọi chỗ so sánh chuỗi `'sequential'`/`'retake'` trong backend đổi sang gọi hai hàm này (liệt kê bằng `grep -rn "sequential\|retake" backend/routers backend/services --include="*.py" | grep -v "/tests/"`; có khoảng 20 file frontend chứa hai chuỗi này — phần admin sửa ở T32/T34, phần học viên thuộc G08).
2. API admin trả tên mới; nhận cả hai. API học viên (`routers/mock_exams.py`) **giữ trả tên cũ** cho tới khi G08 đổi (trường `exam_mode` cũ + trường mới `exam_mode_v2`).
3. Ghi kép: thêm/bớt người dự thi cập nhật cả `mock_exam_audiences` và, khi kỳ thi tự làm, `mock_exam_assignments` (để đường học viên hiện tại vẫn chạy). Với kỳ live có nhiều lớp hoặc người lẻ: `admin_live_monitor` và cổng vào phòng của học viên phải đọc roster từ `mock_exam_audiences` thay cho `cohort_id` — sửa `admin_live_monitor` ở T31; cổng học viên là điểm G08 phải khớp (mục 7). `mock_exams.cohort_id` giữ nguyên, đặt bằng lớp đầu tiên của danh sách.
4. Không xoá cột, bảng cũ trong gói này.

**Kỳ `self_paced`: một mốc bắt đầu, các phần chạy liền, làm một lần (chốt 18/11; điểm 23: KHÔNG nghỉ giữa các phần).**

Hiện trạng (đã kiểm ở `c3bc71574`, `backend/services/mock_exam_service.py` dòng 656–700): chế độ `retake` hiện **cho nghỉ giữa phần** — mỗi phần có mốc `<phần>_started_at` riêng trên sitting, chỉ ghi khi học viên bấm bắt đầu phần đó; giữa hai phần `retake_active_section` trả `not_started` (học viên đứng ở màn chọn phần, không đồng hồ nào chạy). Hành vi này phải đổi cho kỳ `self_paced`.

Hợp đồng mới (máy chủ là chủ đồng hồ; G09-T31 ghi hợp đồng và phần admin, G08-T22 làm phía học viên):
1. **Một mốc bắt đầu cho cả bài** = `<phần đầu>_started_at` của sitting (phần đầu theo thứ tự cố định Listening → Reading → Writing trong các kỹ năng của người đó). Không thêm cột mốc mới.
2. **Phần kế bắt đầu ngay khi phần trước kết thúc.** Mốc `<phần kế>_started_at` do **máy chủ** ghi, bằng thời điểm nhỏ hơn giữa lúc nộp phần trước và lúc phần trước hết giờ (`started_at` + thời lượng + giờ cộng của phần đó), cộng `MOCK_SELF_PACED_GAP_SECONDS` (mặc định 0 — Q31). Người học không có nút nào quyết định lúc bắt đầu phần kế.
3. Phần hết giờ mà chưa nộp → máy chủ tự nộp với phần đã làm và ghi mốc phần kế như điểm 2, kể cả khi người thi đã đóng trình duyệt hay mất mạng (đồng hồ không dừng — theo quy tắc full test ở 00 mục 2 điểm 22; mặc định tạm, Q31). Job quét sitting hết giờ hiện có (`reap_expired_retake_sittings`, dòng 3565) phải đi hết chuỗi phần còn lại, không dừng sau một phần.
4. Không có trạng thái "giữa hai phần": sau khi bắt đầu, hàm tính phần đang chạy chỉ trả một phần đang chạy hoặc `done`. Không có màn chọn phần, không "làm phần sau vào lúc khác", không mở lại phần đã nộp.
5. Giờ dự kiến xong cả bài `expected_end_at` = mốc bắt đầu + tổng thời lượng các phần + tổng giờ cộng (+ khoảng chuyển nếu có); nộp sớm một phần thì các phần sau bắt đầu sớm hơn.
6. Bắt đầu chỉ trong khoảng mở (`open_from`…`open_until` của người đó). Đã bắt đầu thì làm hết chuỗi phần dù vượt `open_until` (mặc định tạm, Q31). Chưa bắt đầu khi khoảng mở đóng → `missed` ("Không dự thi").
7. Một lần: một lượt `main` mỗi người mỗi kỳ (UNIQUE ở bảng trên); làm lại = thi bù do admin cấp.
8. Cộng giờ (`extra-time`): chỉ cho phần đang chạy; ghi vào `mock_exam_sittings.extra_seconds` theo phần (migration 447); mốc của các phần sau tính theo điểm 2 nên tự lùi.

Dữ liệu `retake` cũ (thi bù đang mở lúc đổi): sitting đã có phần nộp xong mà phần kế chưa bắt đầu giữ cách cũ tới khi xong (không tự bấm giờ thay người thi); quy tắc mới áp cho sitting tạo sau khi cờ `mock_exam_audiences_learner` bật.

Giả định của người thiết kế (Q12, Q13): thêm lớp chụp danh sách lúc thêm (học viên vào lớp sau không tự vào kỳ thi); thi bù hiện tạo kỳ `retake` riêng có `source_exam_id` — gói này **giữ cơ chế đó**, chỉ hiện liên kết ở thẻ Thí sinh; gộp kết quả thi bù vào kỳ gốc chờ duyệt.

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`. Mọi giao diện mới sau cờ `ADMIN_FRAME_V2` (tắt ở production); migration staging trước dưới khoá advisory.

## Verification strategy

Lệnh bắt buộc mỗi PR theo tầng và cách báo cáo ở gói mục 9:

Môi trường: preview Vercel của nhánh + backend staging. Tài khoản: QA admin có TOTP; hai tài khoản giáo viên kiểm thử (A dạy lớp kiểm thử 1, B dạy lớp kiểm thử 2); ba học viên kiểm thử `@staging-e2e.averlearning.com` (một có tài khoản + hồ sơ ở lớp 1, một chỉ có hồ sơ, một ở lớp 2). Dữ liệu: một bài giao Course 1 chấm máy có bài nộp, một đề giữa kỳ chế độ "giáo viên công bố", một kỳ thi kiểm thử live và một kỳ tự làm hai phần, một đơn kiểm thử và một đơn đăng ký lại (sau G04), một lớp kiểm thử có thành viên dùng mã cũ không kèm lượt. Không dùng production cho bất kỳ bước nào; không chép dữ liệu học viên thật.
Lệnh bắt buộc mỗi PR (theo tầng): `cd backend && python -m pytest tests/ -q`; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`; `npm --prefix frontend run test:react`; `cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build`; `node frontend/tooling/route-ownership-check.mjs`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Gói chỉ được báo "xong" khi 23 kịch bản có bằng chứng trên staging (đã merge vào `staging`), không phải chỉ trên preview nhánh. Kịch bản phụ thuộc gói khác chưa xong ghi "chưa chạy được" kèm tên gói, không tính là đạt. Lên production và bật `ADMIN_FRAME_V2` ở production là bước riêng, chờ anh Andy.
