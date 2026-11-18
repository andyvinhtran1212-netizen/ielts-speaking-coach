# Implementation plan

## Architecture impact

Phần B của GOI-11. Các file và module ở mục Data and contracts. Ràng buộc riêng của gói (mục 8):

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

Gói mục 5.2, chép nguyên:

### 5.2 Phần B — Chấm thử miễn phí

#### 5.2.1 Migration 471 `backend/migrations/471_free_trial_caps.sql` (phụ thuộc 371 của 0047)

**Sửa theo trả lời ngày 17/11 (00 mục 2 điểm 11) — bảng dưới đây thay bản "một con số cho mỗi kỹ năng" của bản 17/11:**

**`free_trial_caps`**: `cap_key text PK CHECK IN ('writing_task1','writing_task2','speaking_part2')`, `per_user_total integer NOT NULL CHECK (per_user_total BETWEEN 0 AND 10000)`, `per_user_daily integer NOT NULL CHECK (per_user_daily BETWEEN 0 AND 1000)`, `CHECK (per_user_daily <= per_user_total)`, `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by uuid NULL FK users ON DELETE SET NULL`. Seed `INSERT … ON CONFLICT DO NOTHING` theo số đã chốt: `writing_task1 (5, 1)`, `writing_task2 (5, 1)`, `speaking_part2 (10, 2)`.

**`free_trial_site_config`** (một dòng, `id boolean PK DEFAULT true CHECK (id)`): `daily_budget_usd numeric(8,2) NOT NULL CHECK (daily_budget_usd BETWEEN 0 AND 10000)` — seed `5.00` (tên trong trả lời: `TRIAL_DAILY_BUDGET_USD`); `ip_quota_multiplier integer NOT NULL CHECK (ip_quota_multiplier BETWEEN 1 AND 1000)` — seed `1` (`TRIAL_IP_QUOTA_MULTIPLIER`); `max_cost_usd jsonb NOT NULL` — chi phí ước tính tối đa của một lượt theo `cap_key`, dùng để giữ chỗ ngân sách (giá trị seed lấy từ bảng đơn giá đang dùng cho `ai_usage_logger` — CHƯA KIỂM: `grep -rn "price\|cost" backend/services/ai_usage_logger.py | head`; không tìm được thì để cấu hình và ghi `CẦN ANH ANDY QUYẾT`); `updated_at`, `updated_by`.

**Cột thêm vào `trial_usage`** (bảng của 0047): `cap_key text NULL CHECK IN (ba giá trị trên)` (dòng cũ NULL), `est_cost_usd numeric(8,4) NULL` (giữ lúc `reserved` = chi phí tối đa; chốt lúc `consumed` = chi phí ước tính thật từ số token/giây âm thanh; `released`/`filtered` → 0), `ip_hash text NULL` (cùng bản băm HMAC có muối `TRIAL_HASH_SALT` mà 0047 dùng cho `trial_accounts.ip_hash`; **không lưu IP thô**; IP lấy từ header do hạ tầng tin cậy đặt, không tin header client gửi; xoá theo lịch 90 ngày của 0047; ghi vào chính sách quyền riêng tư — G05-T06).

**`admin_settings_log` — KHÔNG tạo ở 471.** Bảng nhật ký cài đặt đã do **migration 440 của G09-T22** tạo (`admin_settings_log(id, key, old_value jsonb, new_value jsonb, reason text, actor_id uuid, created_at)`, chỉ ghi thêm). Bản 17/11 của file này định tạo một bảng cùng tên với lược đồ khác (`tab`, `change`): bỏ, để không có hai định nghĩa. Thẻ Chấm thử ghi vào bảng của 440 với `key` dạng `trial.caps.<cap_key>`, `trial.site.daily_budget_usd`, `trial.site.ip_quota_multiplier`, `trial.paused`; mỗi khoá đổi một dòng; `reason` 10..500 ký tự kiểm ở backend; không bao giờ ghi giá trị bí mật. 471 phụ thuộc 440: G09-T22 phải merge trước G11-T14 (440 chưa có → dừng, không tự tạo bảng).

**Index đếm**: `trial_usage_site_day ON trial_usage (vn_day) WHERE status IN ('reserved','consumed')`; `trial_usage_user_cap ON trial_usage (user_id, cap_key) WHERE status IN ('reserved','consumed')`; `trial_usage_ip_cap ON trial_usage (ip_hash, cap_key) WHERE status IN ('reserved','consumed') AND ip_hash IS NOT NULL`.

**Sửa `fn_trial_reserve`** (định nghĩa gốc ở 371 theo `specs/0047-free-trial-grading/plan.md` dòng 319–330). Hai đường:
- (a) 371 **chưa** viết: đưa thay đổi dưới đây thẳng vào 371 qua amendment 0047 (G11-T02), 471 chỉ còn bảng, index và seed.
- (b) 371 đã merge: 471 `CREATE OR REPLACE FUNCTION public.fn_trial_reserve(...)` giữ nguyên chữ ký và mọi bước chống lạm dụng; chỉ thay phần kiểm lượt.

Phần kiểm lượt mới, trong cùng giao dịch với bước giữ chỗ (hàm nhận thêm `p_cap_key`, `p_ip_hash`):
1. `PERFORM pg_advisory_xact_lock(hashtextextended('aver.trial.site:' || v_vn_day::text, 0));` rồi, khi `p_ip_hash IS NOT NULL`, `PERFORM pg_advisory_xact_lock(hashtextextended('aver.trial.ip:' || p_ip_hash, 0));` (không gắn ngày, vì hạn mức IP tính trọn đời: hai tài khoản chung IP gửi sát nửa đêm giờ VN rơi vào hai `vn_day` khác nhau nên khoá site không chặn được nhau), rồi `PERFORM pg_advisory_xact_lock(hashtextextended('aver.trial.user:' || p_user_id::text, 0));` — luôn đúng thứ tự site → ip → user để không khoá chéo. Test PG17 hai kết nối: hai `vn_day` khác nhau, cùng IP, còn đúng một lượt IP → chỉ một bên được giữ chỗ.
2. Đọc `free_trial_caps WHERE cap_key = p_cap_key` và dòng `free_trial_site_config` (thiếu một trong hai → `{"granted": false, "reason": "config_missing"}`, backend đổi thành 503).
3. Tính `site_spent` = tổng `est_cost_usd` của **mọi** dòng trong `vn_day` (cả Writing và Speaking, mọi trạng thái kể cả `released`/`filtered`: chi phí đã phát sinh vẫn tính vào ngân sách ngày dù lượt của người dùng được trả lại); `user_today`, `user_total` theo (`user_id`, `cap_key`); `ip_total` theo (`ip_hash`, `cap_key`) qua mọi tài khoản.
4. Thứ tự: `daily_budget_usd = 0 OR site_spent + max_cost_usd[cap_key] > daily_budget_usd` → `site_daily_exhausted`; `per_user_total = 0 OR user_total >= per_user_total` → `user_total_exhausted`; `p_ip_hash IS NOT NULL AND ip_total >= per_user_total * ip_quota_multiplier` → `ip_total_exhausted`; `per_user_daily = 0 OR user_today >= per_user_daily` → `user_daily_exhausted`. (`paused` do backend kiểm cờ trước khi gọi RPC; điều kiện "từng có khoá online" do backend kiểm bằng hàm của G04 trước khi gọi RPC — FR-030.)
5. Còn lượt → giữ chỗ như 0047 (chèn `reserved` kèm `cap_key`, `ip_hash`, `est_cost_usd = max_cost_usd[cap_key]`; `request_key` idempotent theo `(user_id, request_key)`; trả `reservation_id`). Lúc chốt (`consumed`) backend ghi lại `est_cost_usd` thật. Lúc `released`/`filtered`: trả lượt cho người dùng (dòng không còn tính vào `user_today`, `user_total`, `ip_total`) nhưng **không** xoá chi phí đã phát sinh: chưa gửi tới provider → `est_cost_usd = 0` (hoàn phần giữ chỗ chưa dùng); đã gửi (timeout sau khi gửi, bộ lọc trả phí từ chối) → ghi chi phí ước theo phần đã chạy, giống cách 0047 FR-003 tách "trả lượt" khỏi "chốt chi phí". Test provider giả: timeout sau khi gửi và bộ lọc trả phí từ chối đều trả lượt cho người dùng mà ngân sách ngày không được cộng lại.
Hàm đọc trần từ bảng, **không** từ env; các env `TRIAL_*_PER_DAY`, `TRIAL_*_TOTAL` của 0047 thôi dùng (ghi trong amendment). Trần USD theo provider của 0047 FR-004 giữ làm lớp chặn cuối; ngân sách ngày ở đây là trần chung thấp hơn (5 USD so với 7 USD/ngày của 0047 `trial_total`) nên sẽ chạm trước.

Speaking: route chấm thử Speaking chỉ nhận Part 2 (`cap_key = 'speaking_part2'`); yêu cầu Part 1/Part 3 → 422 `trial_part_not_allowed`. Đây là thu hẹp so với 0047 (0047 cho Part 1/3 ≤ 60 s), ghi trong amendment TRIALCAP-0080.

Test PG17 `backend/tests/test_migration_471_free_trial_caps.py`: 20 lời gọi song song (luồng thật trên PG) khi ngân sách còn đủ đúng 3 lượt → đúng 3 `granted`; hai người khác nhau cùng đua ngân sách ngày; `released` không đếm lượt và trả lại chi phí; hai tài khoản cùng `ip_hash` chung hạn mức tổng (hệ số 1) và tách khi hệ số 2; Task 1 và Task 2 đếm riêng; ràng buộc CHECK từ chối `per_user_daily > per_user_total`.

#### 5.2.2 Thứ tự trạng thái (backend `services/trial_caps.py`)
`trial_state(user_id | None, cap_key, *, ip_hash=None, now) -> TrialState(state, remaining_today|None, remaining_total|None, resets_at)`: `free_trial_enabled` tắt (`runtime_flags.is_enabled("free_trial_enabled", default=False, on_error=False)`) → `paused`; rồi các bước 4 ở trên bằng truy vấn đọc (không khoá) — chỉ để hiển thị; quyết định thật luôn ở RPC lúc nộp. `resets_at` = 00:00 giờ Việt Nam hôm sau.

`trial_eligible(auth_user, user_row) -> Eligibility`: gộp điều kiện của 0047 FR-001 với hai điểm khớp: (1) provider ∈ {`google`, `email`} và `email_confirmed_at` khác null (FR-031); (2) `entitlements.has_ever_had_online_course(user_id)` của G04 trả false (FR-030) — trước khi G04-T03 merge dùng điều kiện "chưa từng kích hoạt" (`users.first_activated_at IS NULL`) của 0047; hai điều kiện khớp nhau với người đăng ký online vì xác nhận đơn bật `users.is_active`. Tài khoản đã kích hoạt bằng mã lớp vẫn bị loại theo 0047 FR-001 (không đổi).

#### 5.2.3 API

| Method · Path | Auth | Response | Ghi chú |
|---|---|---|---|
| GET `/api/trial/public-config` | không; thêm vào `ACTIVATION_EXEMPT_ROUTES` | `{"writing":{"open":bool,"reason":null|"paused"|"site_daily_exhausted","per_user_daily":{"task1":int,"task2":int},"per_user_total":{"task1":int,"task2":int},"resets_at"},"speaking":{"open","reason","per_user_daily":{"part2":int},"per_user_total":{"part2":int},"resets_at"}}` | Cache trong tiến trình 30 s; lỗi đọc → `{"writing":{"open":false,"reason":"unavailable"},…}` (trang công khai giữ lối cũ). Không trả số đã dùng, không trả số tiền ngân sách. G05-T21 đọc route này cho lối vào (FR-05-021). |
| GET `/api/trial/status` (0047) | bắt buộc | thêm cho mỗi hạng mục (`writing_task1`, `writing_task2`, `speaking_part2`) `{"state","remaining_today","remaining_total","resets_at"}` | Tài khoản không eligible giữ 403 `trial_not_eligible` của 0047 (gồm người từng có khoá online — FR-030). |
| nộp bài (route 0047 `/api/trial/*`) | bắt buộc | lỗi mới 409 `trial_quota` `{"state": "site_daily_exhausted"|"user_total_exhausted"|"ip_total_exhausted"|"user_daily_exhausted"}`; 422 `trial_part_not_allowed`; 503 `trial_unavailable` | Mã lỗi khác của 0047 giữ nguyên. |
| GET `/admin/settings/trial` | `require_admin` | `{"paused":bool,"paused_note":str|null,"caps":{"writing_task1":{per_user_total,per_user_daily},"writing_task2":{…},"speaking_part2":{…}},"site":{"daily_budget_usd","ip_quota_multiplier"},"today":{"spent_usd","by_cap":{<cap_key>:{"used","users_hit_daily","users_hit_total"}},"refused_by_ip":int},"log":[{at, actor_name, change, reason}×20]}` | Đủ các mục G09 cần ở thẻ Chấm thử (GOI-09 mục 7): ngân sách ngày, hệ số IP dùng chung, số lượt bị từ chối vì IP, công tắc tạm dừng. Cùng tiền tố router `/admin/settings/*` với G09-T22. |
| PUT `/admin/settings/trial` | `require_admin` | body `{"caps":{…},"site":{…},"reason":str 10..500}` → `{"caps","site","log_id"}` | 422 `invalid_caps` (thông điệp tiếng Việt theo ràng buộc FR-020); ghi `admin_settings_log` cùng giao dịch (hàm `fn_trial_caps_update`). |
| POST `/admin/settings/trial/pause` | `require_admin` | body `{"paused":bool,"reason":str 10..500}` → `{"paused"}` | Gọi `runtime_flags.set_flag("free_trial_enabled", not paused, note=reason, updated_by=…)` rồi ghi `admin_settings_log`; nếu ghi log lỗi sau khi đổi cờ: trả 200 kèm `log_failed: true` và log lỗi (không đảo cờ). |

#### 5.2.4 Giao diện
- `/admin/settings`: trang trong khung admin G09 (nhóm route `(authed-admin)` của G10; G10 chưa gộp thì nhóm tạm `frontend/app/(authed-admin-settings)/admin/settings/page.tsx`). Gói này dựng thẻ `?tab=trial`; các thẻ khác do G09-T23 dựng trên cùng trang (bên vào sau rebase; thẻ chưa có hiện "Chưa có ở đợt này", không bịa nội dung). Thẻ theo tờ AdminCaiDat mục 5: bảng hạn mức tổng và trần ngày × ba hạng mục, ô ngân sách ngày (USD) và hệ số IP dùng chung, cột "Hôm nay" (đã chi, số lượt, số lượt bị từ chối vì IP), "Lưu…" mở hộp liệt kê cũ → mới, kiểm ràng buộc ngay ở trình duyệt và lại ở máy chủ; công tắc "Tạm dừng chấm thử" có hộp xác nhận và ô lý do ≥ 10 ký tự; nhật ký cuối thẻ.
- Trang chấm thử (route của 0047, tờ ChamThuMienPhi màn 2–9): màn 7 hiện đúng một trong sáu trạng thái theo `status.state`; `ip_total_exhausted` hiện màn riêng nêu lý do và lối liên hệ/xác minh (FR-022). **Lối vào ở trang chủ (màn 1) và menu công khai thuộc G05-T21** (GOI-05 FR-05-021); gói này không sửa trang chủ.

#### 5.2.5 Chống lạm dụng
Giữ nguyên 0047 FR-007–FR-010 (email đã xác minh, băm email chuẩn hoá và bia mộ, giới hạn theo IP/thiết bị, Turnstile, admin chặn), **trừ** điều kiện provider: nới thành `google` hoặc `email` (mã đăng nhập 6 số) theo FR-031. Ngân sách ngày toàn web là lớp chặn đốt lượt bằng nhiều tài khoản trong một ngày; trần USD theo provider của 0047 FR-004 vẫn là lớp chặn chi phí cuối.

#### 5.2.6 Quan hệ với sổ lượt của G04
Không gộp vào `credit_ledger`. Lý do: (1) `credit_ledger` gắn với một `entitlements` và chỉ chạy khi có quyền khoá, còn người dùng thử theo định nghĩa không có quyền nào; (2) trần toàn web và trần theo ngày đếm qua mọi người, sổ G04 không có khái niệm này; (3) 0047 đã duyệt với `trial_usage`. Hai hệ không chạm nhau: xác nhận đơn bật `users.is_active` và 0047 FR-001 đặt `first_activated_at`, nên người đã có khoá không bao giờ dùng thử nữa. G04 đã bỏ giá trị `trial` khỏi `entitlements.source` và cấp hai điểm móc cho gói này (GOI-04 mục 5.8): `entitlements.has_ever_had_online_course(user_id)` (FR-030) và tham số `trial=True` của `credits.charge_plan`.

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.
