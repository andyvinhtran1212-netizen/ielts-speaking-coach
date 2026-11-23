# Verification

## Requirement coverage

Mọi dòng `PENDING`: spec đang `draft`. Cột bằng chứng là bằng chứng **dự kiến** theo task; khi mã merge, đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=planned in G05-T03; scenarios in this file | PENDING |
| FR-002 | kind=test; ref=planned in G05-T03; scenarios in this file | PENDING |
| FR-003 | kind=test; ref=planned in G05-T03; scenarios in this file | PENDING |
| FR-004 | kind=test; ref=planned in G05-T02, T03, T04, T05; scenarios in this file | PENDING |
| FR-005 | kind=test; ref=planned in G05-T04; scenarios in this file | PENDING |
| FR-006 | kind=test; ref=planned in G05-T04; scenarios in this file | PENDING |
| FR-007 | kind=test; ref=planned in G05-T05; scenarios in this file | PENDING |
| FR-008 | kind=test; ref=planned in G05-T05; scenarios in this file | PENDING |
| FR-009 | kind=test; ref=planned in G05-T05; scenarios in this file | PENDING |
| FR-010 | kind=test; ref=planned in G05-T06; scenarios in this file | PENDING |
| FR-011 | kind=test; ref=planned in G05-T06; scenarios in this file | PENDING |
| FR-012 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-013 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-014 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-015 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-016 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-017 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-018 | kind=test; ref=planned in G05-T15; scenarios in this file | PENDING |
| FR-019 | kind=test; ref=planned in G05-T16; scenarios in this file | PENDING |
| FR-020 | kind=test; ref=planned in G05-T16; scenarios in this file | PENDING |
| FR-021 | kind=test; ref=planned in G05-T21; scenarios in this file | PENDING |
| FR-022 | kind=test; ref=planned in G05-T04, T05 (button); ENROLL-0060 G05-T22 (API); scenarios in this file | PENDING |
| FR-023 | kind=test; ref=planned in G05-T04; scenarios in this file | PENDING |
| FR-024 | kind=test; ref=planned in G05-T05; scenarios in this file | PENDING |
| FR-025 | kind=test; ref=planned in G05-T05; scenarios in this file | PENDING |
| FR-026 | kind=test; ref=planned in G05-T23; scenarios in this file | PENDING |
| FR-027 | kind=test; ref=planned in G05-T03..T06 screenshots light/dark; scenarios in this file | PENDING |
| FR-028 | kind=test; ref=planned in G05-T02; scenarios in this file | PENDING |
| FR-029 | kind=test; ref=planned frontend/tests/public-commerce-flag.test.mjs: flag off → PUBLIC_HREF.courses '/', home has no /courses link, sitemap has no /courses*, today-v2 no-course state has no /courses link; flag on → all point to /courses (G05-T03, T04, T15) | PENDING |

## Kịch bản (gói mục 9, phần của spec này)

Môi trường: local cho test tự động; staging cho kịch bản đầu-cuối (tài khoản thử, không dùng tài khoản học viên thật). Production: chỉ xem trang công khai sau khi anh Andy bật cờ.

1. Given khách chưa đăng nhập ở `/`, chấm thử đang mở, When nhìn phần mở đầu, Then có nút chính "Xem các khoá học" và nút phụ "Chấm thử một bài miễn phí"; When admin tạm dừng chấm thử (staging) và tải lại, Then nút phụ là "Đọc thử Thư viện miễn phí" và menu điện thoại không có "Chấm thử".
2. Given khách ở `/courses` khi mới một khoá mở đăng ký, Then thấy đủ sáu dòng, "1 khoá đang mở đăng ký · 5 khoá sắp mở", năm dòng không có học phí; When bấm "Báo cho tôi khi mở" ở một dòng và nhập email, Then dòng đổi thành "Đã đăng ký nhận báo"; nhập lại cùng email từ trình duyệt khác cho cùng kết quả.
16. Given URL lạ khi đã đăng nhập, Then HTTP 404 và thanh học viên; chưa đăng nhập → khung công khai.
18. Mọi màn mới ở 1280px và 390px, sáng và tối: chụp ảnh đặt cạnh tờ thiết kế trong PR; dùng được bằng bàn phím (Tab qua thanh trên, FAQ, chương, sáu ô mã, nút sao chép).
21. (mới) Given trang một khoá online đang mở, cấu hình G04 là chuyển 100% và bảo lưu 60 ngày, Then khối "Đăng ký khoá này bạn có gì" ghi: đăng ký lại thì toàn bộ lượt chưa dùng được chuyển sang và dùng thêm được 60 ngày; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn; không còn chữ "50%" ở trang khoá, màn đăng ký lại, màn 4, thư. When đổi cấu hình G04 trên staging sang giá trị khác, Then câu đổi theo mà không sửa mã. Given tài khoản thử có khoá đã hết hạn, Then trang khoá có câu "Bài đã nộp và nhận xét vẫn xem được trong Tiến độ đến <ngày>" với ngày đúng bằng `content_visible_until`.

## Contract evidence

- OpenAPI/type drift: `site-info` thêm `response_model` → sinh lại `frontend/types/api.d.ts` trong PR T23.
- Backward compatibility: `OAUTH_RECOVERY` giữ nguyên; `/pricing` 307 rồi mới 308 (câu 1).

## Data evidence

- Migration/schema query: N/A — spec không có migration.
- Immediate state versus full reload: trang khoá và danh mục tải lại cho cùng trạng thái (đọc API, không trạng thái cục bộ ngoài nút "Báo cho tôi khi mở" của khách).

## UI evidence

- Viewports/themes/input methods: 1280px và 390px, sáng và tối, bàn phím, cạnh tờ thiết kế.

## Release evidence

- Staging SHA and checks: ghi SHA staging từng PR, CI tích hợp và Staging E2E đúng SHA.
- Production verification: sau khi anh Andy bật `AVER_PUBLIC_COMMERCE`, xem `/`, `/courses`, một trang khoá, 404 bằng `curl -sI`; không tạo đơn.
