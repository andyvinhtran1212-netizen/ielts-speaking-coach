# Bộ bàn giao thương mại hoá Aver Learning (18/11/2026)

Đây là **đề xuất và kế hoạch**, chưa phải spec đã duyệt. Theo `docs/README.md`, tài liệu ở `docs/` không thay cho spec trong `specs/NNNN-*/`: mỗi nhiệm vụ loại feature hoặc high-risk vẫn phải có spec được duyệt trước khi viết mã.

Bắt đầu đọc từ [BAN-GIAO.md](BAN-GIAO.md).

| Thứ | Ở đâu |
|---|---|
| Quyết định sản phẩm, quy tắc câu chữ, ràng buộc cứng | [00-QUY-UOC-CHUNG.md](00-QUY-UOC-CHUNG.md) |
| Năm đợt A–E, phụ thuộc, sổ cấp số spec và migration, câu còn mở | [01-KE-HOACH-TONG.md](01-KE-HOACH-TONG.md) |
| Trang nào ứng với tờ thiết kế nào | [02-BANG-PHU-THIET-KE.md](02-BANG-PHU-THIET-KE.md) |
| Việc để lại và câu chờ anh Andy xác nhận | [04-VIEC-DE-LAI.md](04-VIEC-DE-LAI.md) |
| 13 gói việc | `GOI-01-*.md` … `GOI-13-*.md` |
| 138 tờ thiết kế và chuẩn admin | `thiet-ke/` (`*.dc.html`, `canvas.json`, `CHUAN-ADMIN.md`) |
| Khảo sát hiện trạng và kiểm duyệt trải nghiệm | `khao-sat/` |

Ghi chú:

- Các tờ `.dc.html` cần bộ dựng của canvas thiết kế mới hiển thị được; ở đây đọc như HTML. Khối "Ghi chú cho lập trình" cuối mỗi tờ là quy tắc hành vi.
- Tên người, email, số điện thoại trong tờ thiết kế và trong gói là dữ liệu mẫu bịa ra.
- Một số đường dẫn (`~/Documents/…`, `/Volumes/…`) trỏ tới máy của anh Andy, không có trong repo; nội dung cần dùng từ đó phải do anh Andy cấp.
- Hiện trạng mã mô tả trong các gói được đọc ở `staging` giữa tháng 11/2026; mã thật thắng mọi mô tả.
