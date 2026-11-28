# Công việc dự án

Mục tiêu đang được giao là xử lý hàng đợi PR mở và chuẩn bị đợt promote tiếp theo. Bảng ghi các chuỗi trực tiếp quyết định thứ tự tích hợp. Danh sách trên GitHub bao gồm cả các PR ngoài bảng. [Toàn bộ PR mở](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pulls?q=is%3Apr+is%3Aopen)

| Trạng thái ngày 28/11/2026 | Việc và kết quả | Bước tiếp theo |
|---|---|---|
| Đã merge staging | #2726, danh sách đơn của tài khoản hiện tại, vào `36256d4f`. Smoke chung đạt 42/42 ở lần chạy lại. [Smoke](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/46132706367) | Trang chi tiết đơn được theo ở #2728. |
| Đã merge staging | #2561, hộp thư sự cố, vào `af3ffd1f` từ head được duyệt `9c5ec02e`. [PR](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2561) | Smoke đúng SHA đạt 41 ca, bỏ qua 1 ca. Theo ba PR con bên dưới. [Kết quả](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/46135625891) |
| Đang làm | #2728 đã về staging, head `8a5bf99b` được duyệt merge có điều kiện. [PR](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2728) | Kiểm CI và review, merge đúng SHA. Sau đó xét đóng #2641 rồi #2627 theo quy tắc tại DECISIONS.md. |
| Đang làm | #2576, #2653 và #2663 đã chuyển về staging. #2576 sửa ba thông báo thành công thiếu biên nhận. #2653 hủy yêu cầu đọc báo cáo cũ. #2663 sửa yêu cầu đã hủy vẫn tác động phiên. [Mảng quản trị](https://github.com/andyvinhtran1212-netizen/aver-tien-do/blob/main/mang/quan-tri.md) | Theo CI và review từng PR. #2587 đã nhận bản sửa từ #2576. |
| Đang làm | #2727 đã Ready. #2729 giữ bản Writing trong tab qua hai lần mất phiên và còn HOLD. [Mảng học viên](https://github.com/andyvinhtran1212-netizen/aver-tien-do/blob/main/mang/hoc-vien.md) | Theo CI Ready của #2727. Với #2729, đã kiểm bản local còn trong tab sau auto-submit. Khả năng mở lại bài đã đóng chưa được chứng minh. |
| Chờ quyết định hoặc phụ thuộc | #2721 Ready còn HOLD QA. #2581 giữ HOLD, #2717 có bản sửa rollback local. Chín PR lockfile #2683–#2691 chờ sau promote. [Phòng thi](https://github.com/andyvinhtran1212-netizen/aver-tien-do/blob/main/mang/phong-thi.md) | Chỉ đóng từng PR lockfile khi đã kiểm trên main rằng thư mục cũ đã bị xóa và PR chỉ thay lockfile đó. |
| Chưa thực hiện | Chốt SHA, cửa sổ promote, kiểm HOLD và QA tại SHA cắt. [Phát hành](https://github.com/andyvinhtran1212-netizen/aver-tien-do/blob/main/mang/phat-hanh.md) | Đối chiếu staging với main, kiểm sổ migration, smoke và quyền phát hành trước khi promote. |

Khi cập nhật một hàng, ghi SHA và môi trường của kết quả. Một PR đã merge chứng minh mã đã vào nhánh. Ghi riêng lần triển khai và hành vi đã nghiệm thu.
