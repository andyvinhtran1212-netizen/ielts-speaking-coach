# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| `/login` (màn 1, 2, 3a–3h, 9, 10) | nút "Đang gửi…"; sáu ô khoá khi đang kiểm | cờ `email_code_login` tắt: chỉ "Tiếp tục với Google" | đăng nhập xong → kiểm phiên → đích theo FR-031 | tám trạng thái lỗi dưới ô, đúng câu chữ tờ; lỗi mạng giữ mã | tài khoản bị tạm ngưng: màn 9 sau khi mã đúng | 390px; `autocomplete="one-time-code"`, `inputmode="numeric"` |
| `/activate` (màn 6, 6b) | "Đang kiểm tra…" | ô trống; mã điền sẵn từ thư mời | xem trước khoá/lớp, thời hạn, lượt → "Xác nhận" | một câu chung + hai câu riêng; 6 số → "Đây có vẻ là mã đăng nhập 6 số"; giới hạn → `activate_rate_limited` | chưa đăng nhập → `/login?next=/activate` | 390px; mã giữ trong ô sau lỗi |
| `/courses/[slug]/enroll` (màn 1) | — | — | tạo đơn → `/enroll/[orderCode]` | lỗi tạo đơn: giữ dữ liệu; `orders_paused` → thông báo | chưa đăng nhập → `/login?next=…`; đã có đơn mở → chuyển tới đơn đó | ô đồng ý bật/tắt nút |
| `/enroll/[orderCode]` (màn 2–6) | khung giữ chỗ | — | màn theo `status`; tự sang màn 4 khi xác nhận | đơn không thuộc người xem → `/account/orders` + dải "Không tìm thấy đơn đăng ký này."; cấu hình ngân hàng thiếu → thay QR bằng thông báo | chỉ chủ đơn | QR nền trắng ở chế độ tối; "Lưu ảnh mã QR" ở 390px; hỏi lại 20 giây khi tab hiện |
| `/account/orders` (màn 7) | danh sách giữ chỗ | "Bạn chưa đăng ký khoá nào." + hai lối | mỗi dòng một việc tiếp theo | lỗi API: thông báo + "Thử lại" | chỉ đơn của mình | 390px thẻ |
| Màn 8a–8c, hộp 5a–5c | — | cờ G04 tắt: không màn nào | "Tiếp tục ở đây" / đăng xuất mọi thiết bị xong → 5c | 8b không có nút chiếm phiên | chỉ vai trò học viên | lưu nháp trước 8c |
| `ChangeEmail` | "Đang gửi…" | cờ tắt hoặc tài khoản Google: không hiện hoặc câu giải thích | "Đã đổi email đăng nhập" | 3a–3f; đang có bài có giờ → câu chặn | chỉ học viên đang đăng nhập | như màn mã |
| `/contact` | "Đang gửi…" vô hiệu | — | xác nhận đã gửi | lỗi dưới ô + tóm tắt nhận tiêu điểm; 429 giữ dữ liệu | công khai | 390px |

Dữ liệu canonical là API G04/G05; sau mỗi thao tác ghi, màn đọc lại trạng thái từ máy chủ, không giữ trạng thái lạc quan. Câu chữ ba thư mới (`course_open_alert`, `email_changed_notice`, mã đổi email) do người thực thi soạn theo giọng thư 1 và 6 của tờ EmailMau, đưa vào PR T14 để anh duyệt (câu hỏi mở 21).
