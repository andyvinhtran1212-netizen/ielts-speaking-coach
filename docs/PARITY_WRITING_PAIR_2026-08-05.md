# Vì sao cặp parity `writing` KHÔNG có trong `parity-pairs-authed.json`

Ngày 2026-08-05 · liên quan PR #950 (`/writing/dashboard` lên Next)

## Chuyện gì xảy ra

Thêm cặp `/pages/writing-dashboard.html` ↔ `/writing/dashboard` vào bộ parity
authed thì G1 ĐỎ — nhưng không phải vì bản Next sai:

```
✗ /pages/writing-dashboard.html  ↔  /writing/dashboard
  ✗ [console-error]     Failed to load resource: 403
  ✗ [baseline-suspect]  legacy lỗi: Failed to load resource: 403
```

`baseline-suspect` nghĩa là **vế THAM CHIẾU hỏng**. Tài khoản probe dùng để
đăng nhập trong CI không có quyền Writing, nên `/api/writing/*` trả 403 cho CẢ
HAI vế. Khi vế legacy render lỗi thì nó có ít nội dung hơn, và bản Next chỉ
toàn "thừa" ở mức thấp — bảng kết quả sẽ XANH trong khi chẳng so được gì.

Chốt `baseline-suspect` sinh ra đúng để chặn chuyện đó
(`parity-core.mjs:338-341`). Dùng `allow` để dập nó là tự tay vô hiệu hoá cái
chốt duy nhất phân biệt "hai bên giống nhau" với "cả hai bên cùng hỏng".

## Nên làm gì

**Cách đúng:** cấp quyền Writing cho tài khoản probe. Khi đó thêm lại cặp này
là parity có nghĩa thật. Đây là thao tác trên dữ liệu production nên thuộc
quyết định của chủ dự án, không phải việc tự làm.

Khi cấp xong, thêm lại vào `frontend/tooling/parity-pairs-authed.json`:

```json
{ "name": "writing", "legacy": "/pages/writing-dashboard.html",
  "next": "/writing/dashboard", "allow": [] }
```

Glob và regex chọn-phạm-vi authed trong `parity-gate.yml` ĐÃ sẵn sàng cho cặp
này — không cần đụng thêm.

## Trong lúc chưa có, trang được che bằng gì

| Lớp | Che cái gì |
|---|---|
| Cổng đường-ghi, chạy **cả hai vế** (`write-flows/writing-submit.mjs`) | 4 đường ghi kèm THÂN request: `/start`, `/draft`, `/paste-log` (`blocked` + `char_count`), `/submit` (`essay_text` nguyên văn) |
| So id + văn bản SSR | 80/80 id trùng, 981/981 dòng trùng (đo tay khi port) |
| Bộ test hợp đồng chrome | thanh điều hướng, prefetch, một thẻ `<aver-chrome>` duy nhất |

Cần nói rõ giới hạn: **không lớp nào ở trên so được BỐ CỤC theo bề rộng** —
đó chính là thứ G1 làm và hiện đang thiếu cho riêng trang này.
