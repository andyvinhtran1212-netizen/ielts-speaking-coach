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

---

# Cặp `exercises` đã bật lại (2026-08-09)

G1 từng đỏ ở cặp `/pages/exercises.html` ↔ `/exercises`:

```
✗ [baseline-suspect] legacy chỉ render 4 dòng — vế tham chiếu nhiều khả năng hỏng
```

Lúc đó chưa chứng minh được 4 dòng là baseline hỏng hay trạng thái hợp lệ, nên
cặp bị loại có chủ ý thay vì cho cổng tự xanh.

Khác cặp `writing` ở một điểm đáng chú ý: cặp `flashcards` — cùng khuôn
`mount()`, cùng route-group kiểu, cùng tài khoản probe — thì **ĐẠT**. Nên đây
không phải giới hạn của khuôn, mà là chuyện riêng của `exercises.html` với tài
khoản đó.

Batch lifecycle 2026-08-09 đã đối chiếu contract module: khi `/auth/me` trả cả
`d1_enabled` và `flashcard_enabled` khác `true`, chính module chuẩn phải render
header + trạng thái `Exercises are not enabled` — đủ 4 dòng. Đây là trạng thái
feature-disabled hợp lệ, không phải shell legacy hỏng.

Bởi vậy cặp được bật lại với baseline tường minh:

```json
{ "name": "exercises", "legacy": "/pages/exercises.html",
  "next": "/exercises", "allow": [], "minBaselineLines": 4 }
```

Glob và regex authed trong `parity-gate.yml` đã sẵn sàng nên không cần đổi.

Giới hạn còn lại phải nói rõ: nếu probe vẫn feature-disabled, cặp chỉ chứng minh
hai shell khớp ở nhánh đó trên desktop/mobile. Muốn phủ hai drill card phải bật
ít nhất một feature flag cho probe rồi bỏ hoặc nâng baseline tương ứng.

---

# Vì sao `/pricing` không có cặp visual parity (2026-08-15)

`/pricing` đang được khóa có chủ ý trước launch. Bản legacy
`/pricing.html` dùng `window.location.replace('/')`; route Next sở hữu cùng
quyết định ở server bằng HTTP 307 về `/`.

Đây không phải một cặp ảnh hợp lệ: sau redirect cả hai URL cùng thành `/`, và
G1 cố ý chặn `same-final-url` vì nếu cho phép thì nó chỉ chụp homepage hai lần,
không chứng minh gì về route Pricing.

Thay cho ảnh parity, `verify-pricing-redirect-flow.mjs` chạy trên production
build trong chính G1 và kiểm bốn invariant:

1. `/pricing` trả đúng 307, không phải redirect vĩnh viễn;
2. `Location` trỏ chính xác về `/`;
3. response redirect không gửi nội dung giá chưa phát hành;
4. navigation bình thường theo redirect và kết thúc ở homepage.

`frontend/public/pricing.html` vẫn giữ nguyên redirect sentinel và toàn bộ UI
giá làm rollback/source artifact cho ngày marketing quyết định mở launch.
