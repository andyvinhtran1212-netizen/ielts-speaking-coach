# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Trang chủ `/` | HTML server có sẵn nội dung; khối chấm thử chờ `public-config` không nhấp nháy | dữ liệu khoá rỗng: ẩn trường, không "0"/"XXX" | phần mở đầu + mục lục sáu khoá + FAQ | `public-config` lỗi → lối "Đọc thử Thư viện miễn phí" | đã đăng nhập: nút "Vào học"; người từng có khoá online: không có lối chấm thử | 1280/390, sáng/tối, FAQ `aria-expanded` |
| `/courses` | danh sách giữ chỗ | không khoá nào mở: sáu dòng "Sắp mở" | bốn trạng thái theo người xem | API khoá lỗi → thông báo + "Thử lại" | khách / học viên (tiến độ, "Vào học", "Đăng ký lại") | 390 bảng thành thẻ, `short_title` |
| `/courses/[slug]` | khối đăng ký giữ chỗ | trường rỗng ẩn; "Người soạn và giảng" ẩn khi rỗng | chương, bài thử, khối "bạn có gì" | slug lạ → 404 thật | khách mở chương 1–2; học viên mở chương có bài tiếp | sticky từ 1024px, thanh dính đáy dưới 1024px |
| "Báo cho tôi khi mở" | nút "Đang gửi…" | — | "Đã đăng ký nhận báo" + "Bỏ nhận" | lỗi: giữ email đã nhập, câu lỗi dưới ô | khách nhập email; đã đăng nhập chỉ nút | ô mở ngay dưới dòng, không cửa sổ bật lên |
| Pháp lý `/terms`, `/privacy`, `/about` | tĩnh | khối rỗng ẩn | mục lục từ `h2`, neo `#dieu-N` | — | công khai | mục lục dính từ 1024px, gập ở 390 |
| Trang lỗi 404/403/500, bảo trì, mất mạng, phiên hết hạn | — | — | màn theo ca, có lối đi tiếp | 500: mã tham chiếu + "Thử lại" + "Sao chép mã" (`role="status"`) | 403 ba ca chọn bằng dữ liệu | khung công khai hoặc học viên theo phiên; nhãn tiếng Anh ở trang thi |

Dữ liệu canonical là API G04 và `site-info`; trang không giữ trạng thái lạc quan. Tải lại trang cho cùng trạng thái. Mã QR (ở ENROLL-0060) và thư luôn sáng.
