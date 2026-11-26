# UI state matrix

Dữ liệu chuẩn là máy chủ: bank và lượt Quick Check, lịch SRS của thẻ cá nhân. Bộ công khai chỉ đánh dấu trên thiết bị như hôm nay. Các trạng thái dưới chỉ áp cho nhánh cờ bật; nhánh cờ tắt giữ nguyên hôm nay.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Thanh trên | Tên bài hoặc tên bộ | — | "‹ Thoát", "Thẻ N trên M" hoặc "Câu N" kèm "Đã thuộc X/Y" | — | Không in email | 390px gọn |
| Thẻ | "Đang tải bộ thẻ…" | Bộ rỗng: chữ như hôm nay, "Chọn bộ khác" | Mặt trước, lật sang mặt sau; mặt sau dài cuộn trong thẻ | Tải lỗi: chữ cho người học, "Thử lại" | Bộ công khai không cần đăng nhập | Vùng cuộn `tabIndex=0` có nhãn; không xoay 3D khi giảm chuyển động |
| Hàng nút chấm | — | Chưa lật: nút `disabled`, "Lật thẻ để chấm mức nhớ." | Chấm xong sang thẻ kế, nút khoá lại | "Chưa lưu được đánh giá. Kiểm tra mạng rồi bấm Thử lưu lại." | 401: hộp đăng nhập lại, giữ đánh giá chờ | Nút cao ≥ 44px, có chữ; `aria-live="polite"` |
| Xong bộ | — | — | Số thẻ theo từng mức, "Học lại", "Chọn bộ khác" | — | — | — |
| Câu Quick Check | "Đang tải câu…" | — | Một câu, đáp án khoá sau khi chọn, "Đúng."/"Sai." kèm đáp án đúng, "Câu tiếp theo" | Gửi lỗi: outbox giữ, câu vẫn tiếp tục | 401: hộp đăng nhập lại, lượt giữ trên trang | `aria-live="polite"` cho phản hồi |
| Kết quả Quick Check | — | — | "Cần ôn lại" bằng từ hoặc tên điểm ngữ pháp ("Điểm ngữ pháp N" khi thiếu tên) | — | — | Không in khoá, `qid`, mã lỗi |
| Hộp làm lại | — | — | "Xoá và làm lại" gọi reset hiện có | Reset lỗi: chữ và "Thử lại" | — | Tiêu điểm đầu ở "Giữ tiến độ"; Esc đóng |
| Hộp thoát | — | Không còn câu chưa lưu: thoát ngay | "Vẫn thoát" điều hướng | — | — | Tiêu điểm đầu ở "Ở lại"; Esc đóng |
