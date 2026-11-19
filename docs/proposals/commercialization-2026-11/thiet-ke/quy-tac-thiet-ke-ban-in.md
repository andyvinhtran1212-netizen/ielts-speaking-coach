# Quy tắc thiết kế "Bản in" (bổ sung dần theo nhận xét của anh Andy)

Đi kèm `ke-hoach-thiet-ke-tay-toan-web.md`. Mỗi quy tắc ghi ngày anh chốt.

## 1. Ngôn ngữ nhãn — không trộn Việt và Anh (16/11/2026)
Mỗi màn chỉ dùng **một ngôn ngữ cho toàn bộ nhãn giao diện** (nút, tiêu đề, đồng hồ, thông báo, hộp hỏi lại, chữ cho trình đọc màn hình).

| Chế độ | Ngôn ngữ nhãn | Ví dụ màn |
|---|---|---|
| **Thi** (full test, mini test có giờ, thi thử, phòng thi Speaking/Writing khi làm đề thi) | **Toàn bộ tiếng Anh**, như thi máy thật | Save and exit · Time remaining · Flag for review · Submit test |
| **Học và luyện** (bài giảng, bài luyện sau bài giảng, Quick Check, flashcard, bài được giao không tính giờ) | **Toàn bộ tiếng Việt** | Nộp bài · Đánh dấu xem lại · Vì sao |
| **Còn lại** (trang chủ, lộ trình, thư viện, tài khoản, admin) | Tiếng Việt | |

- Nội dung học bằng tiếng Anh (đề bài, bài đọc, câu hỏi, đáp án TRUE/FALSE/NOT GIVEN) không tính là trộn: đó là nội dung, không phải nhãn.
- Tên riêng của IELTS giữ nguyên ở mọi chế độ: Speaking, Writing, Listening, Reading, Task 1, Task 2, Part 1–3, band, tên bốn tiêu chí chấm.
- Màn chuyển tiếp giữa hai chế độ (hướng dẫn trước giờ thi, kết quả sau khi thi) thuộc chế độ Học: tiếng Việt. Ranh giới là lúc bấm bắt đầu tính giờ và lúc nộp bài.
- Cần anh xác nhận: bài luyện từng phần của Listening/Reading (không phải full test) xếp vào chế độ Học (tiếng Việt) như bảng trên, hay cũng toàn tiếng Anh.

## 2. Sản phẩm bàn giao (16/11/2026)
- Thiết kế tay đầy đủ từng trang, từng dạng bài tập, từng nút, từng placeholder.
- **Sau khi các trang đã duyệt, hoàn thiện design system** (token màu, chữ, khoảng cách; thành phần kèm trạng thái; quy tắc ngôn ngữ và cách viết nhãn) để phát triển tiếp về sau. Design system được rút ra từ các màn đã duyệt, không viết trước rồi suy ra màn.

## 3. Thứ tự so với các việc sau nghiệm thu (đề xuất 16/11/2026, chờ anh quyết)
- Thiết kế trên canvas không đụng mã nguồn, làm song song được. Việc **lập trình theo thiết kế** thì xếp sau các việc đã chốt sau nghiệm thu.
- Ưu tiên thiết kế trước những phần mà việc sau nghiệm thu không làm thay đổi hành vi: thành phần cơ bản, dạng bài tập, trang công khai và bán hàng (chưa tồn tại).
- Hoãn thiết kế chi tiết những màn mà việc sau nghiệm thu còn đổi luồng hoặc dữ liệu; thiết kế sau khi luồng đã ổn.

## 4. Đã áp dụng
- Phòng thi chung (Reading): đã chuyển toàn bộ nhãn sang tiếng Anh (Version 14).
- Tờ "Câu hỏi khách quan": đang minh hoạ chế độ Học (nhãn tiếng Việt, nội dung câu hỏi tiếng Anh).
