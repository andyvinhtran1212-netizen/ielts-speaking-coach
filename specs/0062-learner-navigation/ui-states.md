# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Trang học viên đã dời URL (mỗi đợt) | như trang hiện có, không đổi | như trang hiện có, không đổi | trang mở ở URL mới, đúng một mục sáng, breadcrumb hoặc "‹ trang cha" đúng danh mục | thiếu query bắt buộc → `RedirectNotice` về `parentOnMissing` của registry, không trang trắng | chưa đăng nhập → luồng đăng nhập hiện có rồi quay lại URL mới; trang lai công khai thẻ từ mở không cần đăng nhập | 390/820/1280px; thanh dưới, nút Menu, 5 mục một hàng theo G03; phòng thi giữ nhãn tiếng Anh |
| Đường dẫn cũ | không có màn: 307 trước khi trang vẽ | không có màn | một bước tới URL mới, đủ query | đích không tồn tại bị test chặn từ CI (không thể lên) | chuyển hướng chạy trước proxy, áp cho mọi người | không áp dụng: không có giao diện |

Spec này không thêm màn mới. Nội dung, trạng thái tải, rỗng, lỗi của từng trang giữ nguyên như hiện có; chỉ URL, mục sáng và trang cha đổi. Tải lại trang ở URL mới phải cho đúng trang đó (không quay về URL cũ).
