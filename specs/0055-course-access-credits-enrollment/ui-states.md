# UI state matrix

Spec này chỉ có backend. Bảng dưới ghi các **trạng thái mà API sinh ra** và màn hiện chúng; giao diện thuộc gói ghi
ở cột cuối, mỗi gói tự có `ui-states.md` riêng.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/courses`, `/api/courses/{slug}` (G05 danh mục, trang khoá) | G05 hiện khung chờ | `items=[]` → G05 hiện "Đang chuẩn bị mở đăng ký"; trường trình bày `null` → ẩn khối, không bao giờ `XXX` | danh sách theo `display_order`; `viewer.state`, `viewer.can_renew` khi có token | 404 `course_not_found`; 5xx → G05 nút thử lại | không cần đăng nhập | thuộc G05 (PUBLICSITE-0059) |
| Đơn đăng ký `/api/enrollment-orders*` (G05 ThanhToan) | G05 | `items=[]` ở "Đơn của tôi" | `awaiting_transfer`, `transfer_reported`, `needs_info`, `confirmed`, `expired` (`late`), `cancelled` | 409 `course_not_open`, `already_enrolled`, `has_open_order`, `invalid_transition`, `orders_paused`; 422; 503 | 401; 403 `account_suspended`, `sign_in_again` | thuộc G05 (ENROLL-0060) |
| `GET /api/me/courses`, `/api/me/credits` (G07 Khoá của tôi, Hồ sơ) | G07 | chưa có khoá → "Chưa có khoá" | `state` ∈ `active`, `expiring`, `expired`, `revoked`; `credits.balance`, `carry_balance`, `carry_expires_at`; `content_visible_until` | 503 → G07 thử lại, không hiện số 0 giả | 401 | thuộc G07 (LEARNERCORE-0063) |
| Lỗi lượt ở đường chấm (G07/G08 màn nộp bài) | — | — | chấm và trả ngay (Speaking; Writing `ai_instant`); Writing lớp offline chờ giáo viên | 402 `insufficient_credits` (`credit_source` online/class), 503 `credits_unavailable` (bài không bị trừ lượt) | 403 `no_entitlement` | thuộc G07/G08 |
| Một phiên `/api/account/session/*` (G05-T20 màn 8a–8c) | G05 | `enabled=false` → không hiện gì | `state` ∈ `current`, `other_device`, `other_device_timed` | 409 `session_not_current`, `timed_activity_in_progress`; 503 `session_status_unavailable`, `session_claim_unavailable` | 401 | thuộc G05 |
| Lần đăng nhập gần đây `/api/account/login-events` (G07-T17) | G07 | `items=[]` | 3 dòng gần nhất; `approx_location` luôn null | 503 | 401; chỉ phiên đang dùng | thuộc G07 |
| Admin khoá, đơn, quyền, lượt, chuyển lớp mã cũ (G09-T13, T14, T15, T43) | G09 | danh sách rỗng | `counts` theo sáu nhãn trạng thái đơn; `status` `confirmed`/`already_confirmed`/`replay`; `converted`/`skipped` | 409 `slug_taken`, `has_active_learners`, `has_open_orders`, `would_go_negative`, `no_class_product`; 422 thông điệp tiếng Việt không tên cột | 403 khi không phải admin (AAL2) | thuộc G09 (ADMINIA-0074) |

Mọi thông điệp lỗi trả cho học viên là tiếng Việt, xưng "bạn", không mã nội bộ, không mã HTTP, không "mua/bán/giá/đơn
hàng". Sau mỗi thao tác đổi trạng thái, giao diện đọc lại API (không trạng thái lạc quan).
