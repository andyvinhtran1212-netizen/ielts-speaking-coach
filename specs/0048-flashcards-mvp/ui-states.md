# UI state matrix

Câu chữ tiếng Việt là đề xuất; CM duyệt trước khi build.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin: panel "Dán danh sách từ" (FR-005/FR-006) | Nút "Đang kiểm tra…" / "Đang thêm…", textarea khoá, `aria-busy` | "Dán các dòng từ Excel/Google Sheets: Từ ⇥ Nghĩa ⇥ Ví dụ ⇥ CEFR. Mỗi dòng một thẻ." | Xem trước: "48 thẻ mới · 6 dùng thẻ có sẵn · 0 lỗi"; sau commit: "Đã thêm 54 thẻ vào bản nháp. Xuất bản lại để học viên thấy." | Dòng lỗi tô đỏ + chữ "Dòng 7: thiếu nghĩa tiếng Việt"; 409: "Bộ vừa được sửa ở tab khác. Tải lại bản đã lưu (nội dung dán được giữ)."; 413: "Đoạn dán quá 100 KB, hãy chia nhỏ."; 422 too_many_cards: "Bộ chỉ còn chỗ cho N thẻ." | 403: trang admin gate sẵn có | Bảng cuộn ngang trong khung ở 375 px; trạng thái không chỉ bằng màu (có chữ); live region polite báo tổng |
| Học viên: Thẻ ghi nhớ đơn giản (FR-011) | Khung thẻ skeleton | Bộ 0 thẻ: "Bộ từ chưa có thẻ." | Thẻ lật; 2 nút "Chưa nhớ" / "Đã nhớ" bật sau khi lật | Lưu thất bại: "Chưa lưu được. Thử lại" (gửi lại cùng client_id) | Bộ ngoài phạm vi: thông báo sẵn có của 0020 | Nút ≥ 44 px; Space/Enter lật, ←/→; giảm chuyển động khi prefers-reduced-motion |
| Học viên: kết thúc vòng (FR-012) | "Đang tạo phiên…" | Y = 0: "Bạn đã nhớ hết thẻ trong vòng này 🎉" | "Đã nhớ X · Chưa nhớ Y" + "Học lại Y thẻ chưa nhớ" | 422: "Bộ từ vừa cập nhật. Mở lại bộ để học bản mới." | như trên | Focus vào tiêu đề tổng kết |
| Admin menu Vocab (FR-013) | — | — | Mục "Bộ từ theo lớp" đầu danh sách, tô sáng đúng | — | Chỉ admin | Như menu hiện tại |
