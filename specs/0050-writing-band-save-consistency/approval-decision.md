# Owner approval

On 2026-11-08, the owner approved this exact bounded proposal in the dot chat:

Assistant: Em đã tìm ra nguyên nhân: khi sửa điểm tiêu chí, web vẫn giữ điểm tổng cũ và hệ thống không tự tính lại. Vì vậy chỉ bấm lưu lại hoặc sửa phần hiển thị sẽ chưa xử lý được lỗi.

Em đề xuất sửa phần tính điểm ở hệ thống và cập nhật giao diện sau khi lưu, kiểm thử rồi triển khai. Sau đó em sẽ kiểm tra và trả lần lượt 6 bài khi điểm đã khớp. **Anh đồng ý cho em sửa và triển khai web theo cách này không ạ?** Hiện cả 6 bài vẫn được giữ lại, chưa trả.

User: ok

This authorizes the bounded score-consistency repair and normal staging-first
release, not unrelated changes or AI regrading. No student data is included here.
