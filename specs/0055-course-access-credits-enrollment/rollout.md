# Rollout and rollback

## Preconditions

- Spec này `approved` trên `staging`; bảy số migration của gói (nhãn 381–385, 387, 388) đã được sổ cấp và chưa bị file hay PR khác dùng (kiểm lại ngay trước T001); ghi số vào sổ số migration của repo (`backend/migrations/register.tsv` của G01-T06, PR #2364; khi PR đó chưa merge thì xin số qua sổ của Leader `/workspace/cc-jobs/migrations-register.md`). Theo quyết định C3 của Leader, 381/382 đang giữ cho FU-2281: các số 381–388 trong spec này là **nhãn làm việc** M1…M7, số thật do sổ cấp trước G04-T01 và mọi tên file, test, forward-policy đổi theo số được cấp.
- Mọi cờ mới mặc định **tắt**: `credit_metering`, `enrollment_orders`, `single_session_learners`, `retention_by_entitlement`, `pron_sample_window`.
- Trước khi bật `enrollment_orders` anh Andy phải điền (Q11, không ghi cứng ở đâu):

| Q11 | Dữ liệu anh điền trước khi mở đăng ký: học phí, thời hạn, số lượt, hạn dùng lượt, ngày mở của sáu khoá online; tài khoản nhận tiền; hạn giữ đơn | Anh gửi bảng; admin nhập sản phẩm qua `/admin/course-products`, anh đặt env trên Railway | Không seed; thiếu thì `orders_paused`, giao diện để `XXX` |

- Gửi thư học viên cần địa chỉ gửi trên tên miền đã xác minh ở Resend (Q9); chưa có thì outbox giữ thư, không gửi.

## Staging

- Thứ tự áp: 381 → 382 → 383 → 388 (nhóm `course_commerce`, 381 và 382 luôn cùng một lượt), 384 → 387 (`single_session`), 385 (`pron_sample`); 386 không có file; **staging trước** dưới khoá tư vấn (`apply_migrations.sh` + `MIGRATION_FEATURES`), sau khi anh Andy duyệt chạy; production chỉ ở lần promote staging→main được anh cho phép, sau khi T11 có bằng chứng; backend chứa T03+ deploy **sau** migration (backend mới gọi RPC mới; backend cũ không biết bảng mới nên migration áp trước là an toàn).

- Mỗi migration chạy test PG17 + postcondition trước khi áp; sau khi áp chạy E11 (RLS live) và E1–E21 theo `spec.md`. Nghiệm thu dùng tài khoản QA theo `docs/AGENT_WORKFLOW.md`; thiếu tài khoản QA thì PR ghi "chờ anh Andy kiểm tay trên staging".

- **Cron `retention_sweep` trước khi bật `learner_v2`** (anh Andy duyệt 23/11 11:39Z): tạo service cron trên Railway từ `backend/railway.retention-sweep.json` (`python -m jobs.retention_sweep`, hằng ngày 20:00 UTC = 03:00 giờ Việt Nam). File không đặt env: `RETENTION_SWEEP_DRY_RUN` giữ mặc định `true`, nên lượt chạy đầu chỉ ghi log dry-run. Việc tạo service và mọi env trên Railway do anh Andy làm hoặc duyệt riêng. Kiểm tra: log `[sweep] start dry_run=True` có mặt sau lượt chạy đầu, rồi mới bật `learner_v2`. Bật `retention_by_entitlement` vẫn chờ RPC xoá có khoá (#2550 hướng 1).

## Production

- Chỉ qua PR `staging → main` sau khi CI tích hợp và Staging E2E xanh; migration production cần anh Andy duyệt bằng lời, chạy dưới khoá advisory trước khi mã phụ thuộc lên. Gói này không bật cờ nào trên production và không đổi `RETENTION_AUDIO_DAYS`.

## Rollback and repair

- Quay lui: (1) tắt cờ `credit_metering`, `enrollment_orders`, `single_session_learners`, `retention_by_entitlement`, `pron_sample_window` (hiệu lực ≤15 s); (2) deploy lại backend trước đó; (3) chỉ khi cần mới chạy rollback theo thứ tự ngược với thứ tự áp: 385 → 387 → 384 → 388 → 383 → 382 → 381 — script 381–383 và 388 giữ bảng và dữ liệu, gỡ hàm/trigger, từ chối khi có dữ liệu đơn/lượt trừ khi GUC mở rõ ràng. Không bao giờ xoá dòng `credit_ledger`/`enrollment_orders`.

- Sổ lượt chỉ ghi thêm: sửa sai bằng dòng `admin_adjust` có lý do, không UPDATE/DELETE. Đơn xác nhận nhầm: thu hồi quyền (`revoke`) + dòng điều chỉnh, ghi sự kiện.

## Observability

Mục 5.12 của gói (sự kiện ghi email và log), chép nguyên:

| Chuyển | Email (outbox) | Sự kiện `enrollment_order_events` | Log (không có email/tên/số tiền/mã đơn) |
|---|---|---|---|
| tạo đơn | `order_created` | có | `[enroll] order_created product=<slug>` |
| nhắc trước hạn | `order_pay_reminder` (một lần) | có (`pay_reminder`) | `[enroll] pay_reminder queued=<n>` |
| báo đã chuyển (kể cả báo muộn) | — | có | `[enroll] transfer_reported late=<bool>` |
| `needs_info` | `order_needs_info` (mỗi lần đánh dấu) | có | `[enroll] needs_info kind=<k>` |
| bổ sung | — | có | `[enroll] supplemented` |
| `confirmed` (kể cả mở lại đơn hết hạn) | `order_confirmed` | có | `[enroll] confirmed credits=<n> reopened=<bool>` |
| `expired` | — | có | `[enroll] expired count=<n>` |
| `cancelled` | — | có | `[enroll] cancelled by=<learner hoặc admin>` |
| giữ chỗ/chốt/hoàn | — | — | `[credits] decision=reserved|committed|released|insufficient|unavailable feature=<f> reason=<r> source=<online|class>` |
| đóng sổ, chuyển lượt, hết hạn lượt chuyển, cấp thêm, chuyển lớp sang đo lượt | — | — | `[credits] lifecycle=expired|carried|carry_expired|grant_extra|class_converted count=<n>` |
| xếp thư "khoá đã mở đăng ký" | `course_open_alert` (do hàm của G05 ghi) | — | `[enroll] open_alerts queued=<n>` hoặc `skipped=no_function` |
| ghi lần đăng nhập | — | — (bảng `learner_login_events`) | `[session] login_event outcome=<o>`; lỗi ghi: `[session] login_event_failed` (không có nhãn thiết bị, không có địa chỉ mạng) |

Thông báo trong ứng dụng cho huỷ, hết hạn, báo đã chuyển, cần bổ sung, đã mở khoá, được cấp thêm lượt: GOI-11 phần A sinh từ `enrollment_order_events` và `credit_ledger`; gói này không ghi bảng thông báo.
