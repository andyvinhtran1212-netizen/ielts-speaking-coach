# Ngoại lệ HTML legacy — đã đóng

Gate F đã retire toàn bộ 129 HTML renderer ngày 2026-09-11. Chốt
`legacy-freeze.yml` hiện yêu cầu `frontend/public/` có **0 file HTML**.

Danh sách ngoại lệ cũ không còn được workflow chấp nhận. Trang sản phẩm mới
phải được triển khai bằng Next App Router trong `frontend/app/**`.

HTML phục vụ riêng cho kiểm thử được phép nằm dưới `frontend/tests/fixtures/`;
nó không được liên kết trở lại cây `public/`. Snapshot của renderer đã retire
nằm ở `frontend/tests/fixtures/legacy-html-retired/`.

Nếu có yêu cầu đặc biệt phải phục vụ HTML trực tiếp trở lại, đó là quyết định
đảo Gate F và cần một thay đổi được owner phê duyệt rõ ràng; không thêm dòng
allowlist vào tài liệu này.

Xem quyết định: `docs/audits/GATE_F_OWNER_EXCEPTION_CLOSURE_2026-09-11.md`.
