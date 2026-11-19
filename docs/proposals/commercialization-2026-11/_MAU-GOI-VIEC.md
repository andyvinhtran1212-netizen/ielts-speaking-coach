# Mẫu gói việc (người viết spec dùng; bot thực hiện không cần đọc)

Mỗi file `GOI-NN-ten.md` viết bằng tiếng Việt, tên file/hàm/bảng/lệnh giữ nguyên tiếng Anh, theo đúng khung dưới đây. Người đọc là một agent model trung bình: không biết lịch sử dự án, làm đúng từng chữ được ghi, dễ đoán bừa khi thiếu thông tin. Vì vậy:

- Mỗi khẳng định về mã hiện tại phải kèm đường dẫn file thật (đã mở ra kiểm trong bản sao repo), và tên hàm/bảng/route thật. Không viết "có lẽ", "thường là". Chưa kiểm được thì ghi `CHƯA KIỂM` và nói bot phải kiểm bằng lệnh nào.
- Nói rõ "làm gì" và "không làm gì". Giải thích lý do của ràng buộc trong một câu, để bot xử lý đúng ca chưa lường.
- Nhiệm vụ nhỏ: mỗi nhiệm vụ = một PR, làm được trong một phiên, có tiêu chí nghiệm thu kiểm được bằng lệnh hoặc bước bấm cụ thể.
- Không bịa quyết định sản phẩm. Chỗ chưa chốt: thiết kế thành giá trị cấu hình + ghi vào mục "Cần anh Andy quyết".
- Không giải thích kiến thức phổ thông (React là gì). Dồn chữ vào chỗ dễ sai của riêng repo này.

## Khung bắt buộc

```
# GÓI NN — <tên>

## 1. Tóm tắt
- Mục tiêu (2–4 câu, nói theo kết quả người dùng thấy).
- Lớp thay đổi theo specs/README.md: small | content | feature | high-risk. Mã spec đề xuất (ví dụ COURSE-0055) nếu cần spec.
- Phụ thuộc: gói/nhiệm vụ nào phải xong trước; gói nào chạy song song được.
- Ước lượng: số PR, số phiên làm việc của agent (1 phiên ≈ một nhiệm vụ trọn vẹn kèm test), độ khó kỹ thuật 1–5 kèm một câu lý do. Ghi rõ đây là ước lượng và giả định đi kèm.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)
Bảng: thứ cần biết · file/đường dẫn thật · ghi chú. Chỉ những gì bot cần để làm gói này.

## 3. Phạm vi
- Trong phạm vi.
- Ngoài phạm vi (kèm gói nào lo).

## 4. Yêu cầu (FR đánh số)
FR-NN-001 … mỗi yêu cầu là một hành vi kiểm chứng được.

## 5. Hợp đồng kỹ thuật
Tuỳ gói: lược đồ bảng (cột, kiểu, ràng buộc, RLS), API (method, path, request, response, mã lỗi), route frontend (đường dẫn, nhóm route, layout), component (tên, props, trạng thái), cờ cấu hình, sự kiện ghi log. Viết đủ để hai bot làm backend và frontend độc lập vẫn khớp nhau.

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)
Mỗi nhiệm vụ:
### GNN-Txx — <tên>
- Mục đích:
- Đầu vào: file phải đọc trước (đường dẫn), tờ thiết kế (tên file trong thiet-ke/), dữ liệu.
- Việc làm: các bước đánh số, cụ thể tới tên file tạo/sửa.
- Đầu ra: file/PR/migration tạo ra.
- Nghiệm thu: danh sách kiểm, mỗi dòng kiểm được (lệnh + kết quả mong đợi, hoặc bước bấm + điều nhìn thấy).
- Không làm: …
- Vướng mắc có thể gặp → cách gỡ: (ít nhất 2 dòng cho nhiệm vụ không tầm thường)
- Ước lượng: phiên · độ khó.

## 7. Vướng mắc chung của gói và cách tháo gỡ
Bảng: tình huống · dấu hiệu nhận biết · cách gỡ · khi nào dừng và hỏi.

## 8. Ràng buộc riêng của gói
Ngoài 00-QUY-UOC-CHUNG.md.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói
Kịch bản đầu-cuối (Given/When/Then), dữ liệu thử, môi trường (local/staging), thứ không được kiểm trên production.

## 10. Cần anh Andy quyết
Danh sách câu hỏi, mỗi câu kèm phương án đề nghị và mặc định tạm bot dùng nếu chưa có trả lời.
```
