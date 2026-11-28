# UI state matrix

Giao diện do G07-T17 dựng trên trang Tài khoản theo tờ `TaiKhoan`. Bảng dưới là hợp đồng trạng thái mà API của spec này phục vụ; nguồn sự thật là `GET /api/account/deletion-request` và `GET /api/account/data-export`, đọc lại sau mọi thao tác.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Khối "Dữ liệu của tôi" | Nút khoá, chữ "Đang tải trạng thái" | `status:"none"`: nút "Yêu cầu tải dữ liệu" | `queued`/`building`: "Đang chuẩn bị, gửi email trong N giờ"; `ready`: nút "Tải xuống" và hạn; `expired`: mời yêu cầu lại | Lỗi đọc: thông báo và "Thử lại"; 429: hiện thời điểm yêu cầu lại được; `failed`: "Tạo gói lỗi" và nút yêu cầu lại | 401 → về đăng nhập; 404/410 khi tải → thông báo và mời yêu cầu lại; 409 `account_erasing` → ẩn nút, ghi tài khoản đang được xoá | Bàn phím tới mọi nút; trạng thái đọc bằng `aria-live="polite"`; hai theme; 390 px không cuộn ngang |
| Vùng nguy hiểm "Yêu cầu xoá tài khoản và dữ liệu" | Nút khoá khi đang gửi | `none`: ô gõ email, nút chỉ bật khi khớp (so sánh không phân biệt hoa thường) | Gửi xong: trang báo đã gửi, bị đăng xuất | 422: báo email không khớp, focus về ô; lỗi mạng: "Thử lại", không đăng xuất | Tài khoản nhân viên: ẩn vùng, ghi liên hệ admin; 403 từ API cũng hiện câu đó | Nhãn ô gõ rõ ràng; màu cảnh báo kèm chữ, không chỉ màu; hai theme; 390 px |
| Thông báo khi đăng nhập trong hạn huỷ | Khung giữ chỗ | Không hiện khi `none` | `pending`: "Tài khoản sẽ bị xoá ngày …" và nút "Huỷ yêu cầu xoá"; huỷ xong: báo đã huỷ và mở lại học | 409 `deletion_in_progress`: báo đang xoá, không huỷ được | Route học viên trả 403 `account_deletion_pending` → mở lại thông báo này | Focus vào thông báo khi mở; nút bấm được bằng bàn phím |
