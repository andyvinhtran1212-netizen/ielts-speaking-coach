# UI state matrix

Baseline FD đọc từ code (04/11), đã tích hợp audit UI Auditor
`UIA-SW-UX-20261104` (Must M1–M11 → FR-017, FR-023..FR-032; mã UIA ghi ở cột
Surface). Màn UIA chưa kiểm (mục f) được kiểm ở T012.
Mọi giờ hiển thị theo giờ Việt Nam. Không hiển thị số USD cho người dùng.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Landing CTA dùng thử (FR-023, UIA M1) | — | cờ TẮT: CTA như hiện tại | "Thử chấm Speaking/Writing miễn phí" → `/trial/*` 1 lần bấm | `/api/trial/config` lỗi: CTA cũ | — | 3 khung 1280/375/360; vùng chạm ≥ 44 px (M11) |
| `/login` không mã (FR-024, FR-025, UIA M2, M3) | nút Google "Đang chuyển…" | — | "Miễn phí · N lượt chấm/ngày"; mã là mục tuỳ chọn "Có mã lớp/trung tâm?"; xong → về `next` | `next` sai → `/home`; lỗi OAuth giữ `next` | tài khoản chưa kích hoạt: vào được `/trial/*`, menu lớp ẩn | link "← Về trang chủ" trên mobile; ≥ 44 px |
| Màn bắt đầu dùng thử (FR-027, FR-028, UIA M5, M7) | skeleton | thư viện rỗng: chip dựng sẵn, không bao giờ "— Không có chủ đề —" | khối "Bạn sẽ nhận được" (preview, thời gian chấm, micro, lượt) trong màn đầu 375×812; 1 nút chính ở y < 600 px tại 360×780 | — | chưa đăng nhập: xem được, bấm bắt đầu → `/login?next=` | Việt hoá nhãn (M9) |
| Quyền micro (FR-029, UIA M8) | "Đang kiểm tra micro…" | chưa hỏi: "Cho phép micro để ghi âm" + "Kiểm tra micro" | đã cho phép: mức âm thanh | bị từ chối: hướng dẫn Chrome/Safari iOS + "Thử lại"; không hỗ trợ/in-app: "Mở bằng Safari/Chrome"; không trừ lượt | — | thông báo `role=alert` |
| Chỉ báo lượt (FR-017, UIA M6) | — | — | còn lượt / **lượt cuối** ("Đây là lượt miễn phí cuối hôm nay") / hết lượt (màn riêng, giờ đặt lại, CTA tham gia lớp) | — | — | ở màn bắt đầu + trang kết quả + trang chủ |
| Writing tự luyện (FR-026, UIA M4) | tải Kho đề | "Bài đã nộp" trống → "Viết bài đầu tiên" | Task → đề/"Đề ngẫu nhiên" → màn soạn; popup Kho đề có "Viết bài này" | — | người dùng thử: ẩn "Bài giao", "Mã học viên", "Bị đánh dấu", "Liên hệ giảng viên" | ≤ 3 lần bấm tới ô soạn ở 360 px |
| Kết quả dùng thử (FR-031, UIA M10) | band hiện trước, phần phụ tải sau | — | band + 3 điểm cần sửa + CTA "Tham gia lớp…", kết quả tự vào lịch sử | lỗi tải phần phụ: band vẫn hiện | link người khác: lỗi chung | LCP < 2,5 s/1280, < 4 s/375; "← Quay lại" 1 dòng ở 360 |
| Thẻ dùng thử (trang chủ, đầu trang Speaking/Writing) | skeleton 1 dòng | cờ TẮT hoặc học viên lớp: không render | "Còn X câu Speaking, Y bài Writing hôm nay · làm mới lúc 00:00" | lỗi status: ẩn thẻ, không chặn trang | `email_unverified`: "Xác minh email để dùng thử" + nút gửi lại; `not_eligible`: không render | 360/768/1280, sáng/tối, `aria-live=polite` cho số lượt |
| Kích hoạt dùng thử | nút "Đang kích hoạt…" disabled | — | chuyển sang thẻ còn lượt | `trial_limit`: "Thiết bị/mạng này đã dùng thử. Liên hệ Aver nếu cần hỗ trợ."; CAPTCHA lỗi: thử lại | — | Turnstile có nhãn, dùng được bằng phím |
| Speaking dùng thử: chọn câu → ghi âm → kết quả | "Đang chấm… (khoảng 15–30 giây)" + tiến trình | hết đề: ẩn | band tổng + 3 điểm cần sửa + chi tiết thu gọn | lỗi hệ thống: "Chưa chấm được, lượt đã được hoàn lại — Thử lại"; audio quá dài/ngắn: thông báo cụ thể | `trial_quota`: Q-8(a); `trial_closed`: Q-8(b)/(c) | đồng hồ ghi âm đọc bằng screen reader mỗi 10 s; nút ghi âm phím Space |
| Writing dùng thử: soạn | tải đề | — | đếm chữ sống "180/250 chữ" đổi màu khi đạt | thử dán: toast Q-8(d) 4 s, nội dung không đổi | như trên | ô soạn cao tối thiểu 60 vh, font ≥ 16 px (không zoom iOS) |
| Writing dùng thử: nộp | "Đang kiểm tra bài…" rồi "Đang chấm…" | — | kết quả 4 tiêu chí + bài sửa | `too_short`/`too_long`/`low_quality`/`off_topic`/`paste_suspected`: lý do + gợi ý, "Lượt chấm chưa bị trừ. Còn N lần nộp lại hôm nay"; `trial_filter_limit` | — | focus chuyển tới thông báo lỗi |
| Trạng thái đóng | — | — | — | `daily_cap`: Q-8(b) + "mở lại lúc 00:00"; `total_cap`/`paused`: Q-8(c) + liên kết đăng ký lớp | — | không phải modal chặn; trang vẫn đọc được bài cũ |
| Speaking revamp (`speaking_ui_v2`) | giữ skeleton hiện có | như hiện tại | 3 bước rõ, band trước chi tiết | giữ hành vi lỗi/retry hiện tại | không đổi | WCAG 2.2 AA, 360 px |
| Writing revamp (`writing_ui_v2`) | như hiện tại | như hiện tại | ô soạn rộng, đếm chữ có mốc, kết quả theo tiêu chí | không đổi | không đổi | WCAG 2.2 AA, 360 px |

Dữ liệu chuẩn: số lượt luôn lấy từ `GET /api/trial/status` (máy chủ); sau nộp
gọi lại status. Reload giữa chấm: hiện "Đang chấm" và hỏi lại kết quả theo
`request_key`; không nộp lại lần hai. (FD 10/11, Codex #2252
PRRT_kwDOR6Uds86z4_sh) Client lưu `request_key` vào `sessionStorage` **trước**
khi POST; sau reload gọi `GET /api/trial/history?request_key=<uuid>` mỗi 3 s,
tối đa 120 s: `pending` → giữ "Đang chấm"; `completed` → mở kết quả qua route
`{id}` và xoá khoá khỏi `sessionStorage`; `failed` → hiện lỗi tương ứng như
cột lỗi ở trên; 404 → xoá khoá, quay về màn soạn (bài nháp còn trong tự lưu);
hết 120 s vẫn `pending` → "Bài vẫn đang được chấm, kết quả sẽ có trong Bài
dùng thử của bạn". (FD 05/11) Lịch sử "Bài dùng thử của bạn" đọc từ `GET /api/trial/history`, mở kết quả qua `GET /api/trial/{writing/submissions|speaking/results}/{id}` (FR-038) — vẫn hiện khi chương trình đóng hoặc đã vào lớp.
