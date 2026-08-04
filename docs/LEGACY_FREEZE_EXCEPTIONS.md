# Ngoại lệ đóng băng legacy

Chốt `legacy-freeze.yml` chặn việc **thêm trang HTML legacy mới**. Bề mặt di trú
đo ngày 2026-08-04 là ~129 trang và **vẫn đang lớn lên** — chỉ trong ngày trước
đó đã thêm 2 trang. Mỗi trang HTML mới là một trang phải port lại sau.

Chốt **không** cấm sửa hay xoá trang đang có. Chỉ cấm thêm mới.

## Cách khai ngoại lệ

Mỗi dòng một đường dẫn, **bắt buộc có lý do** sau dấu `—`:

```
- `frontend/public/pages/vi-du.html` — lý do cụ thể, gắn với ràng buộc thật
```

Ngoại lệ không lý do sẽ không được chốt chấp nhận. Đây là cùng nguyên tắc với
allowlist của cổng parity: một ngoại lệ không giải thích được là tự cấp phép.

## Danh sách hiện tại

*(trống — chưa có ngoại lệ nào)*
