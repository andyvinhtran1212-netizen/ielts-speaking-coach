# Quyết định điều phối và phát hành

Andy là người duyệt phạm vi phát hành. Các quyết định dưới đây đang chi phối hàng đợi ngày 28/11/2026. Khi có quyết định thay thế, cập nhật dòng liên quan và dẫn tới bằng chứng mới.

| Quyết định của Andy | Lý do và phạm vi thực hiện |
|---|---|
| Đội Codex tiếp quản hàng đợi. Agent chính điều phối và tham vấn, các agent thực thi dùng GPT-6.2 Sol. | Tránh nhiều team cùng sửa một nhánh. Grok và Claude đã được yêu cầu dừng công việc trên hàng đợi này. |
| Cho cập nhật PR hiện có bằng fast-forward và đổi base khi nhánh cha đã merge. | Giữ lịch sử review. Merge vào staging và gỡ HOLD theo từng quyết định đã cấp. Nếu SHA đã duyệt thay đổi do chỉ bổ sung tài liệu danh mục route, đội được tiếp tục khi mã chạy và test trùng bản đã review, CI mới đạt và không phát sinh HOLD. |
| Cho đóng PR gốc đã được thay thế sau khi bản mới vào staging, có liên kết đối chiếu và không còn PR mở dùng nhánh cũ làm base. | Giữ nhánh gốc và lịch sử review. Kiểm các PR con trước khi đóng cha. |
| Duyệt merge mã #2561 tại `9c5ec02e` và #2728 tại `8a5bf99b` khi CI đạt và review khép. | Hộp thư sự cố chỉ hoàn tác các nhóm thật sự thay đổi. Trang đơn phải giữ cả đường đăng ký theo khóa và đường xem đơn. [#2561](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2561) · [#2728](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2728) |
| Gỡ HOLD 7099892087 của #2590 và chuyển riêng #2727 tại `6a80c51e` sang Ready. #2729 giữ Draft và HOLD 7237605325. | Quyết định cho chạy CI đầy đủ của luồng đăng xuất. Luồng khôi phục bài Writing còn cần quyết định riêng. [Gỡ HOLD](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2590#issuecomment-7238282217) · [Ghi nhận trên #2727](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2727#issuecomment-7238284189) |
| Andy chưa chốt lịch promote. Merge mã, áp migration trên môi trường dùng chung, bật cờ và đưa lên production có phạm vi duyệt riêng. | Các migration như 394, 500, 504 và 505 cần đối chiếu sổ của đúng môi trường. Hotfix #2693 và migration 509 có quyết định riêng. [Bàn giao phát hành](https://github.com/andyvinhtran1212-netizen/aver-tien-do/blob/main/mang/phat-hanh.md) |
