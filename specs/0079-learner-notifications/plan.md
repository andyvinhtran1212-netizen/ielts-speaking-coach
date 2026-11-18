# Implementation plan

## Architecture impact

Phần A của GOI-11. Các file và module ở mục Data and contracts. Ràng buộc riêng của gói (mục 8):

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

Gói mục 5.1, chép nguyên:

### 5.1 Phần A — Thông báo

#### 5.1.1 Migration 470 `backend/migrations/470_learner_notifications.sql`

**`notification_broadcasts`** (tạo trước vì bảng sau trỏ tới)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| created_by | uuid | NOT NULL FK `users(id)` ON DELETE RESTRICT |
| created_role | text | NOT NULL CHECK IN (`admin`,`instructor`) |
| kind | text | NOT NULL CHECK IN (`reminder`,`center_notice`) |
| title | text | NOT NULL, `char_length` 1..120 |
| body | text | NOT NULL, 1..1000, văn bản thuần |
| audience | jsonb | NOT NULL; `{"type":"cohorts","ids":[uuid…]}` · `{"type":"learners","ids":[user_id…]}` · `{"type":"all"}`; CHECK `jsonb_typeof = 'object'` |
| channels | text[] | NOT NULL, CHECK `channels <@ ARRAY['in_app','email'] AND cardinality(channels) >= 1 AND 'in_app' = ANY(channels)` |
| scheduled_at | timestamptz | NULL = gửi ngay ở lượt sweep kế tiếp |
| status | text | NOT NULL DEFAULT `scheduled` CHECK IN (`scheduled`,`sending`,`sent`,`cancelled`,`failed`) |
| claimed_at | timestamptz | NULL; lúc một lượt sweep nhận gửi (hạn thuê, xem bước `broadcasts`) |
| attempts | integer | NOT NULL DEFAULT 0 CHECK ≥ 0; số lần đã nhận gửi |
| recipient_count, email_count | integer | NULL, ≥ 0 (ghi khi gửi xong) |
| request_key | text | NOT NULL 8..80; `UNIQUE (created_by, request_key)` |
| sent_at, cancelled_at | timestamptz | NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |

**`learner_notifications`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE CASCADE (thông báo là dữ liệu bỏ được) |
| kind | text | NOT NULL CHECK IN (`assignment_new`,`reminder`,`center_notice`,`due_soon`,`overdue`,`result_ready`,`course_test_released`,`enrollment_order`,`credits_granted`,`course_expiring`,`course_expired`,`credits_low`,`credits_out`,`mock_assigned`,`mock_closing`,`mock_result`,`feedback_reply`,`maintenance`,`survey_open`,`survey_reminder`) |
| severity | text | NOT NULL DEFAULT `normal` CHECK IN (`normal`,`warning`) |
| target | jsonb | NOT NULL; `{"type": "class_item"|"writing_give"|"essay"|"order"|"course"|"course_test"|"credits"|"broadcast"|"survey"|"mock_exam"|"mock_sitting", "id": "<uuid hoặc mã đơn>"}`; `mock_exam` mang `exam_id` (cho `mock_assigned`, `mock_closing`), `mock_sitting` mang `sitting_id` (cho `mock_result`) |
| params | jsonb | NOT NULL DEFAULT `'{}'`; CHECK object và `octet_length(params::text) <= 2000`; chỉ khoá trong danh sách cho phép ở 5.1.3 |
| group_key | text | NULL, ≤ 200 |
| event_count | integer | NOT NULL DEFAULT 1 CHECK ≥ 1 |
| last_event_at | timestamptz | NOT NULL DEFAULT now() |
| read_at | timestamptz | NULL |
| broadcast_id | uuid | NULL FK `notification_broadcasts(id)` ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Index: `(user_id, last_event_at DESC)`; `(user_id) WHERE read_at IS NULL`; `UNIQUE (user_id, kind, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL AND severity = 'normal'` (chỗ dựa của gộp); `(last_event_at)` cho dọn.

**`notification_event_keys`** — chống trùng sự kiện, tách khỏi dòng thông báo vì một dòng gộp nhiều sự kiện: `dedupe_key text PK (≤ 200)`, `notification_id uuid NULL FK learner_notifications ON DELETE SET NULL`, `created_at timestamptz NOT NULL DEFAULT now()`.

**`notification_email_prefs`**: `user_id uuid PK FK users ON DELETE CASCADE`, `result_ready boolean NOT NULL DEFAULT true`, `course_expiring boolean NOT NULL DEFAULT true`, `staff_notice boolean NOT NULL DEFAULT true`, `updated_at timestamptz NOT NULL DEFAULT now()`. Không có dòng = mặc định.

**Hàm `fn_notify(p_user_id uuid, p_kind text, p_severity text, p_target jsonb, p_params jsonb, p_group_key text, p_dedupe_key text, p_broadcast_id uuid)` → jsonb** `{status: "created"|"grouped"|"duplicate", notification_id}`:
1. `INSERT INTO notification_event_keys(dedupe_key) VALUES (p_dedupe_key) ON CONFLICT DO NOTHING`; không chèn được → `duplicate`, dừng.
2. Nếu `p_group_key` không NULL và `p_severity='normal'`: `UPDATE learner_notifications SET event_count = event_count + 1, last_event_at = now(), params = p_params WHERE user_id=… AND kind=… AND group_key=… AND read_at IS NULL AND severity='normal' RETURNING id`; có dòng → `grouped`.
3. Không thì INSERT dòng mới → `created`. Ghi `notification_id` vào dòng khoá. Chèn trùng do đua ở bước 3 (unique partial) → bắt `unique_violation` rồi chạy lại bước 2 một lần.

**Hàm `fn_notify_batch(p_items jsonb)`** gọi `fn_notify` cho tối đa 500 phần tử (job dùng), trả `{created, grouped, duplicate}`.

**Hàm `fn_notifications_purge(p_days int)`**: xoá `learner_notifications` có `last_event_at < now() - p_days`; xoá `notification_event_keys` có `created_at < now() - (p_days + 30)`; trả số dòng.

Có file `backend/migrations/rollback/470_learner_notifications.sql` (DROP hàm, bảng; từ chối nếu `notification_broadcasts` có dòng `sent` trừ khi `SET aver.allow_notify_rollback='on'`), dòng `forward-policy.tsv` theo README, test PG17 `backend/tests/test_migration_470_learner_notifications.py`.

**Ghi chú (sửa 18/11 theo GOI-13):** hai `kind` `survey_open`, `survey_reminder` và `target.type = survey` (bảng 5.1.1), cùng bước `surveys` (5.1.3), do G13-A08 làm. Nếu G11-T08 (migration 470) đang mở PR thì thêm thẳng vào CHECK của 470; nếu migration 470 đã merge trước thì G13-A03 dùng migration 491 (`491_notification_kinds_survey.sql`) để thêm.

#### 5.1.2 API học viên — `backend/routers/notifications.py` (prefix `/api/notifications`)

Đăng ký trong `backend/main.py`; **thêm cả 5 route vào `ACTIVATION_EXEMPT_ROUTES`** (`backend/services/activation_gate.py`) với lý do "chỉ đọc/đánh dấu thông báo của chính người gọi" (FR-010), và cập nhật `tests/test_activation_gate_inventory.py`.

| Method · Path | Request | Response 200 | Lỗi |
|---|---|---|---|
| GET `/api/notifications` | `?kind=<kind>&cursor=<opaque>&limit=20` (limit 1..50) | `{"items":[Notification],"next_cursor":str|null}` | 401; 422 `invalid_kind` |
| GET `/api/notifications/summary` | — | `{"unread": int, "overdue": int, "latest": [Notification ×≤6]}` | 401; 503 `notifications_unavailable` (giao diện ẩn số, không báo lỗi) |
| POST `/api/notifications/{id}/read` | `{}` | `{"id","read_at"}` (idempotent; của người khác → 404) | 401; 404 `notification_not_found` |
| POST `/api/notifications/read-all` | `{}` | `{"updated": int}` | 401 |
| GET · PATCH `/api/me/notification-settings` | PATCH `{"result_ready"?:bool,"course_expiring"?:bool,"staff_notice"?:bool}` | `{"email_enabled": bool (users.notification_email), "result_ready", "course_expiring", "staff_notice"}` | 401 |

`Notification` = `{"id","kind","severity","title","body"|null,"action_label"|null,"target":{"type","id"},"event_count","last_event_at","read_at"|null}`. `title`, `body`, `action_label` dựng trong `backend/services/notification_copy.py` từ `kind` + `params` (tiếng Việt, xưng "bạn"; `course_expired` có `action_label = RENEW_LABEL` — 5.6). Không trả `params` thô.

Frontend dựng đường dẫn đích từ `target` bằng `frontend/lib/notification-target-model.mjs`, **dùng lại** bộ dựng href của `frontend/lib/my-class-model.mjs` cho `class_item`/`writing_give` (G07 mục 2 ghi `my-class-model.mjs` so đường dẫn bằng chuỗi tuyệt đối; không viết bộ dựng thứ hai). Đích khác: `essay` → trang kết quả Writing hiện có, `order` → `/enroll/<order_code>` (G05), `course` → `/courses/<slug>` (G05), `credits` → trang Tài khoản mục lịch sử lượt (G07), `course_test` → trang bài kiểm tra (E-T27), `broadcast` → `/notifications?open=<id>`, `mock_exam` → trang vào kỳ thi `/mock-exam` mở đúng kỳ `exam_id` (tham số mở kỳ: CHƯA KIỂM, đọc `frontend/app/(authed-mock-exam)/mock-exam/page.tsx`; dùng lại bộ dựng href hiện có nếu có), `mock_sitting` → `/mock/result?sitting=<sitting_id>` (cùng dạng `frontend/lib/reading-review-model.mjs`). Test điều hướng có đủ ba kind `mock_assigned`, `mock_closing`, `mock_result`.

#### 5.1.3 Nguồn sinh thông báo (job) — `backend/scripts/notification_sweep.py`

Chạy `python -m scripts.notification_sweep` mỗi 5 phút qua `backend/railway.notification-sweep.json` (chép khuôn `backend/railway.staff-security-sweep.json`; tạo service cron trên Railway là việc của anh Andy). Mỗi bước độc lập, lỗi một bước không chặn bước khác, ghi log `[notify] step=<s> created=<n> grouped=<n> duplicate=<n>` (không email, tên). Cờ `--dry-run`, `--step <tên>`. Mọi bước quét cửa sổ `NOTIFY_SWEEP_LOOKBACK_HOURS` (mặc định 48) và dựa vào `dedupe_key` để không trùng; không có bảng con trỏ.

| Bước | Nguồn (đọc bằng service role) | Người nhận | `kind` · `severity` | `dedupe_key` | `group_key` | `params` cho phép |
|---|---|---|---|---|---|---|
| `assignment_new` | `class_assignment_items` ⋈ `class_assignments` có `status='published'`, `coalesce(publish_at, created_at)` trong cửa sổ và ≤ now, lớp chưa lưu trữ; bài Writing từ bảng của `_visible_writing_gives` (CHƯA KIỂM tên bảng/cột: đọc `class_student.py` dòng 439–492) | `students.user_id` không NULL | `assignment_new` · normal | `asg:<assignment_id>:<user_id>:new` | `cohort:<cohort_id>:day:<YYYY-MM-DD giờ VN của publish>` | `assignment_title`, `cohort_name`, `due_at`, `count` |
| `due_soon` | item chưa nộp, `due_at ∈ (now, now + NOTIFY_DUE_SOON_HOURS]`, bài còn mở | như trên | `due_soon` · normal | `item:<item_id>:due_soon:<epoch(due_at)>` (dời hạn thì báo lại) | `due:<YYYY-MM-DD>` | `assignment_title`, `due_at`, `count` |
| `overdue` | item chưa nộp, `due_at ∈ [now − lookback, now)`, bài còn mở, không phải bài một lượt đã đóng | như trên | `overdue` · warning | `item:<item_id>:overdue:<epoch(due_at)>` | NULL | `assignment_title`, `due_at` |
| `result_ready` | `writing_essays` có `delivered_at` trong cửa sổ (G04 `ai_instant` và luồng duyệt đều ra `delivered`) | chủ bài | `result_ready` · normal | `essay:<id>:delivered` | `results:<YYYY-MM-DD>` | `task_label`, `count` |
| `course_test_released` | `course_result_releases` (E) `created_at` trong cửa sổ; bỏ qua nếu bảng chưa có | học viên của item | `course_test_released` · normal | `ctr:<release_id>` | NULL | `test_title`, `level` |
| `enrollment_order` | `enrollment_order_events` (G04, GOI-04 mục 5.12) trong cửa sổ, `to_status ∈ {transfer_reported, needs_info, confirmed, expired, cancelled}` (không sinh cho sự kiện `pay_reminder`, tạo đơn, bổ sung); bỏ qua nếu bảng chưa có | chủ đơn | `enrollment_order` · normal (`needs_info` là warning) | `orderev:<event_id>` | NULL | `order_code`, `product_title`, `to_status`, `reopened` |
| `credits_granted` | `credit_ledger` (G04, GOI-04 mục 5.3, 5.15) có `reason = 'grant_extra'` và thời điểm ghi trong cửa sổ; bỏ qua nếu bảng chưa có. Không sinh cho `grant`, `carry_over`, `carry_expire`, `reserve`, `release`, `admin_adjust`, `expire` (lượt chuyển khi đăng ký lại và lượt chuyển hết hạn bảo lưu hiện ở lịch sử lượt của Tài khoản, không có thông báo riêng ở đợt này — mục 10 câu 29) | chủ quyền (`entitlements.user_id`) | `credits_granted` · normal | `ledger:<ledger_id>` | NULL | `credits` (số lượt được cấp), `course_title` |
| `course_expiring` | `entitlements` (G04) `status='active'`, nguồn `enrollment_order`/`admin_grant`, sản phẩm `kind='online'`, `expires_at ∈ (now, now + NOTIFY_EXPIRING_DAYS]`, không có quyền khác cùng khoá hết hạn muộn hơn | người có quyền | `course_expiring` · warning | `ent:<id>:expiring:<epoch(expires_at)>` | NULL | `product_title`, `product_slug`, `expires_at` |
| `course_expired` | như trên, `expires_at ∈ [now − lookback, now]` | như trên | `course_expired` · warning | `ent:<id>:expired:<epoch(expires_at)>` | NULL | `product_title`, `product_slug` |
| `mock_exams` (thêm 18/11) | `mock_exam_audiences` và `mock_exam_events` (G09-T31, T33) trong cửa sổ: thêm người dự thi hoặc sửa khoảng mở → `mock_assigned`; kỳ còn mở, người chưa bắt đầu, giờ đóng trong 24 giờ tới → `mock_closing`; sự kiện trả kết quả → `mock_result`; bỏ qua nếu bảng chưa có | người dự thi | `mock_assigned` · normal; `mock_closing` · warning; `mock_result` · normal | `mock:<exam_id>:<user_id>:<loại>:<epoch(mốc)>` | NULL | `exam_title`, `closes_at`; `target` = `mock_exam` (hai loại đầu) hoặc `mock_sitting` (`mock_result`) |
| `credits_out` (thêm 18/11) | `credit_ledger` (G04): số dư dùng được của một quyền về 0 sau dòng ghi trong cửa sổ; bỏ qua nếu bảng chưa có | người có quyền | `credits_out` · warning | `ent:<id>:credits_out:<id dòng sổ>` | NULL | `product_title`, `source` |
| `broadcasts` | `notification_broadcasts` có (`status='scheduled'` và `coalesce(scheduled_at, created_at) ≤ now`) **hoặc** (`status='sending'` và `claimed_at < now − NOTIFY_BROADCAST_LEASE_MINUTES`, mặc định 15: lượt trước chết giữa chừng) → nhận bằng một UPDATE có điều kiện đó, đặt `status='sending'`, `claimed_at=now`, `attempts=attempts+1` (một job nhận) → giải người nhận → `fn_notify_batch` theo lô; lặp lại thì `dedupe_key` theo người nhận chặn trùng → thư (5.1.4) chỉ gửi cho người mà lô vừa báo `created` (người đã `duplicate` không gửi lại) → `sent` + số đếm. `attempts` ≥ 3 mà vẫn hỏng → `failed`, log `[notify] step=broadcasts failed=<id>`, admin thấy trạng thái "Gửi lỗi". Test: chặn sau lô đầu, chạy lại sweep sau hạn thuê, mỗi người nhận đúng một thông báo | theo `audience` | `reminder`/`center_notice` · normal | `bc:<broadcast_id>:<user_id>` | NULL | `broadcast_id` (tiêu đề đọc từ bảng gửi lúc hiển thị) |
| `surveys` | (G13-A08 thêm: mở/đóng khảo sát theo ngày, sinh `survey_open`, `survey_reminder`; log `[notify] step=surveys opened=<n> reminded=<n> closed=<n>`) | — | `survey_open`/`survey_reminder` | — | — | — |
| `course_release_schedule` | (E-T24 thêm) | — | — | — | — | — |
| `purge` | `fn_notifications_purge(NOTIFY_RETENTION_DAYS)` | — | — | — | — | — |

Không viết thông báo ở trong giao dịch chấm/giao bài/xác nhận đơn: các đường đó đang chạy thật và nhiều đường là RPC; job đọc dữ liệu nguồn nên không phải sửa chúng, trễ tối đa một chu kỳ 5 phút.

**Service nhắc dùng chung (FR-015)** — `backend/services/notification_service.py::send_assignment_reminder(assignment_id, student_user_ids, *, actor_id, vn_day) -> {"created": int, "duplicate": int}`: gọi `fn_notify_batch` với `kind='reminder'`, `target={"type":"class_item",…}`, `dedupe_key = 'remind:<assignment_id>:<user_id>:<YYYY-MM-DD giờ VN>'` (đúng khoá GOI-09 mục 5.4 ghi). Route `POST /admin/cohorts/{c}/assignments/{a}/remind` của G09-T27 gọi hàm này sau khi tự ghi `class_assignment_reminders`; hàm không kiểm quyền (bên gọi đã kiểm bằng `staff_scope`), không gửi thư, chạy ngay trong request (không chờ job). Cờ `notifications_enabled` tắt → trả `{"created": 0, "duplicate": 0}` và G09 hiện nút tắt kèm lý do. Thuộc G11-T09.

#### 5.1.4 Thư tuỳ chọn của A (bật bằng cờ `notification_emails`, mặc định tắt)
- `result_ready_digest`: gộp các `result_ready`/`course_test_released` của một người trong `NOTIFY_DIGEST_MINUTES` (mặc định 30) thành một thư; dedupe `digest:<user_id>:<window_start>`; chỉ khi `users.notification_email` và `notification_email_prefs.result_ready` đều đúng lúc gửi.
- `course_expiring`: câu về lượt trong thư và trong thông báo theo 00 mục 2 điểm 23 — "Đăng ký lại thì toàn bộ lượt chưa dùng được chuyển sang kỳ mới và dùng thêm được N ngày; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn." (N = `CREDIT_CARRY_VALID_DAYS` của G04, không gõ cứng; tờ EmailMau thư 7, 8 còn ghi "50% số lượt": không dùng câu đó). Một thư cho mỗi thông báo `course_expiring`; dedupe `ent:<id>:expiring_mail:<epoch>`; không gửi khi người đó đang có đơn mở cùng khoá (tờ EmailMau ghi chú 3).
- `staff_notice`: thư của lần gửi nhân sự khi `channels` có `email` và người nhận bật `staff_notice`.
- Ghi vào `learner_email_outbox` của G04 (ba mẫu này đã có sẵn trong CHECK của migration 381; không cần migration 472), gửi bằng dispatcher của G04 (`services/learner_email.py`). Không có cờ thì không ghi outbox.

#### 5.1.5 Bộ đếm quá hạn — `backend/services/learner_overdue.py`
`count_overdue(user_id, *, now=None) -> int`: lấy mọi `students` có `user_id` (một người có thể có nhiều hồ sơ — CHƯA KIỂM: `grep -n "students" backend/routers/class_student.py | head -40`, xem hàm lấy hồ sơ hiện tại), lấy `cohort_ids` như `class_student` đang làm, gọi `_visible_assignments(student, now, cohort_ids)` và `_decorate(item, assignment, now)`; đếm `is_missing` đúng, loại bài `skill='course'` có `completion_mode='single_attempt'` đã qua mốc đóng (vắng). Dùng lại hàm qua import, **không** dời hay sửa hàm gốc (cùng cách G07 mục 5.3). G07 dùng hàm này cho nhãn "Đã quá hạn".

#### 5.1.6 Giao diện (khung mới)
- Component trong `frontend/components/notifications/`: `NotificationBell` (props `unread: number|null`, `onOpen`; `null` → không số; hiện "9+" khi > 9; `aria-label` "Thông báo, N chưa đọc"), `OverdueBadge` (`count`; "N quá hạn", viền và nền nhạt màu đánh dấu, có chữ "quá hạn"; bấm tới trang bài được giao — đường dẫn từ danh mục trang G07), `NotificationDrawer` (rộng 420px, neo dưới chuông, canh phải, tối đa 6 dòng mới nhất, Tab qua từng dòng, Esc đóng, "Xem tất cả" → `/notifications`; chỉ một trong ngăn và menu tài khoản mở một lúc), `NotificationList` (dùng cho trang).
- Hook `frontend/lib/notifications-client.ts`: gọi `/summary` khi tải trang và mỗi `NOTIFY_POLL_SECONDS` (runtime config, mặc định 60) khi `document.visibilityState === 'visible'`; dừng khi ẩn; không hộp bật lên.
- Điện thoại (< 768px): bấm chuông mở trang `/notifications`; có bài quá hạn thì thẻ "N quá hạn" thế chỗ ô "Lượt AI" (tờ ThanhPhanKhungTrang mục 3).
- Trang `/notifications`: nhóm route mới `frontend/app/(authed-notifications)/notifications/page.tsx` trong `AuthedShell design="v2"`, **không** dùng `activationGate` (FR-010); lọc bằng `?kind=`; dải cảnh báo tổng số quá hạn ở đầu khi > 0; trạng thái rỗng "Bạn chưa có thông báo nào." Đăng ký trang vào danh mục trang G03/G07 với trang cha `/home`. Thêm route vào `frontend/tests/route-auth-guard-inventory.test.mjs` theo cách test đó yêu cầu.

#### 5.1.7 Phía gửi của nhân sự — `backend/routers/admin_notifications.py` (prefix `/admin/notifications`)

| Method · Path | Auth | Request | Response | Lỗi |
|---|---|---|---|---|
| POST `/admin/notifications/broadcasts/preview` | `resolve_staff_scope` của G09-T24 (admin ⊃ giáo viên; lệnh `await` đầu tiên) | `{"audience":{…},"channels":[…]}` | `{"in_app": int, "email": int}` (trừ người không có tài khoản, đã tắt thư) | 403 `audience_forbidden` (giáo viên chọn `all`); 404 khi giáo viên chọn lớp/người không thuộc lớp mình (`scope.assert_cohort`, cùng quy ước FR-09-113: không lộ lớp tồn tại) |
| POST `/admin/notifications/broadcasts` | như trên | `{"kind","title","body","audience","channels","scheduled_at"|null,"request_key","confirm_text"|null}` | 201 `{"broadcast": Broadcast}`; replay → 200 | 403; 422 `confirm_required` (audience `all` mà `confirm_text != "gửi tất cả"`), `scheduled_in_past` |
| GET `/admin/notifications/broadcasts` | như trên (giáo viên chỉ thấy của mình) | `?cursor&limit` | `{"items":[Broadcast]}` | — |
| POST `/admin/notifications/broadcasts/{id}/cancel` | người tạo hoặc admin | `{}` | `{"broadcast"}` | 409 `already_sending` |

Phạm vi giáo viên: `services/staff_scope.py::resolve_staff_scope` (G09-T24, GOI-09 mục 5.4) — `cohort_ids = None` là admin; giáo viên chỉ chọn được lớp có `cohorts.instructor_id` là mình và học viên đang là thành viên active của các lớp đó; kênh thư và audience `all` chỉ admin. G09-T24 chưa merge → bản đầu chỉ admin gọi được, giáo viên ẩn nút. Audience `learners` nhận danh sách do G09-T40 đẩy sang (Danh bạ, bảng lớp, Kết quả bài giao, Việc cần làm). Trang ở route `/admin/notifications` (mục sidebar "Gửi thông báo" của G09).

Mỗi lần tạo/huỷ ghi nhật ký thao tác nhạy cảm theo cơ chế G09 dùng cho vùng nguy hiểm (CHƯA KIỂM tên bảng: `grep -rn "staff_security_audit\|class_action_log" backend/routers/admin*.py | head`). Giao diện: trang "Gửi thông báo" theo tờ AdminGiaoVienThongBao, trong khung admin G09 (`ADMIN_FRAME_V2`); hộp xác nhận nêu đúng số người nhận từ `/preview`.

#### 5.1.8 Cấu hình A

| Tên | Loại | Mặc định | Ý nghĩa |
|---|---|---|---|
| `notifications_enabled` | runtime flag (`default=False, on_error=False`) | tắt | Tắt: API trả `summary` rỗng, job chỉ chạy `purge` |
| `notification_emails` | runtime flag | tắt | Thư tuỳ chọn 5.1.4 |
| `NOTIFY_SWEEP_LOOKBACK_HOURS` | env int | 48 | Cửa sổ quét |
| `NOTIFY_DUE_SOON_HOURS` | env int | 24 (tạm, mục 10 câu 3) | "Sắp đến hạn" |
| `NOTIFY_EXPIRING_DAYS` | env int | 7 (tạm) | "Khoá sắp hết hạn" |
| `NOTIFY_RETENTION_DAYS` | env int | 90 (tạm, tờ ghi XXX) | Giữ thông báo |
| `NOTIFY_DIGEST_MINUTES` | env int | 30 (tạm) | Gộp thư kết quả |
| `notifyPollSeconds` | runtime config trình duyệt | 60 (tạm) | Chu kỳ hỏi `/summary` |

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.
