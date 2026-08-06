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

# Cặp `exercises` cũng phải để ngoài (2026-08-06)

G1 đỏ ở cặp `/pages/exercises.html` ↔ `/exercises`:

```
✗ [baseline-suspect] legacy chỉ render 4 dòng — vế tham chiếu nhiều khả năng hỏng
```

Cùng một cơ chế như cặp `writing`: **vế THAM CHIẾU** không render đủ nội dung
với tài khoản probe, nên bản Next chỉ toàn "thừa" ở mức thấp và bảng kết quả sẽ
XANH trong khi chẳng so được gì.

Khác cặp `writing` ở một điểm đáng chú ý: cặp `flashcards` — cùng khuôn
`mount()`, cùng route-group kiểu, cùng tài khoản probe — thì **ĐẠT**. Nên đây
không phải giới hạn của khuôn, mà là chuyện riêng của `exercises.html` với tài
khoản đó.

**Đáng điều tra riêng:** trang `exercises` legacy chỉ render 4 dòng cho một tài
khoản không có dữ liệu bài tập. Có thể là trạng thái rỗng hợp lệ, cũng có thể là
lỗi thật của trang legacy. Chưa kiểm được vì cần tài khoản probe.

Bật lại: cấp cho tài khoản probe dữ liệu bài tập (hoặc xác nhận trạng thái rỗng
là đúng rồi nới `minBaselineLines` cho riêng cặp này), sau đó thêm lại:

```json
{ "name": "exercises", "legacy": "/pages/exercises.html",
  "next": "/exercises", "allow": [] }
```

Glob và regex authed trong `parity-gate.yml` ĐÃ sẵn sàng — không cần đụng thêm.

Trong lúc chưa có, `/exercises` được che bằng: đo `getComputedStyle` theo đường
DOM hai vế (41 nút, lệch 0), chốt `mount-waits-for-supabase.test.mjs`, và chốt
`legacy-module-routes-need-hard-nav.test.mjs`. Không lớp nào so bố cục theo bề
rộng — đúng thứ G1 làm và đang thiếu cho riêng trang này.
