# Cutover `/speaking` — trang luyện nói

**Ngày:** 2026-08-05 · **Route canonical:** `/speaking` (Next)
**Cutover ĐẦU TIÊN có bằng chứng LUỒNG NGHIỆP VỤ, không chỉ bằng chứng tĩnh.**

---

## Vì sao lần này cần nhiều hơn cổng parity

`/home` chỉ **đọc**. `/speaking` **tạo dữ liệu thật** — bấm một nút là sinh ra
một phiên luyện tập trong DB.

Cổng parity G1 so **chữ, link, khối ở trạng thái tĩnh**. Nó không bấm gì, nên nó
không phân biệt được *"nút có nhãn đúng"* với *"nút **làm đúng việc**"*. Đợt port
này để lọt đúng **bốn** lỗi thuộc loại đó — build xanh, test xanh, trang mở
được, nút không làm gì:

| Lỗi | Ai bắt |
|---|---|
| listener gắn vào 6 id không tồn tại | chốt móc DOM (viết riêng) |
| thiếu `cue-card-detector.js` ⇒ "câu hỏi tự nhập" ném TypeError | Codex |
| biểu đồ không chờ Chart.js ⇒ mất hẳn khi CDN chậm | Codex |
| listener chỉ gắn **sau** `await /auth/me` ⇒ bấm sớm rơi vào hư không | **e2e staging** |

**Không cái nào bị cổng parity bắt.**

---

## Ba lớp bằng chứng

### 1. Parity tĩnh — cổng G1

```
lượt full   · 149 cặp × 2 bề rộng → 0 phát hiện
lượt authed ·   2 cặp × 2 bề rộng → 0 phát hiện   (/home + /speaking)
```

### 2. Kiểm luồng trong CI — `tooling/verify-speaking-flow.mjs`

Chạy mỗi lần cổng chạy, không cần secret. Chặn mạng, trả dữ liệu sẵn, bấm như
người dùng. **13/13 đạt.**

Khẳng định **thân** `POST /sessions` mang đúng `{mode, part, topic}` của trang, và
điều hướng kèm `session_id`. Cộng nửa còn lại của hợp đồng: bấm khi **chưa** có
chủ đề phải báo lỗi tại chỗ và **không gửi gì**.

> Bản đầu của bộ kiểm này **bỏ lọt** lỗi #4 vì nó trả API tức thì rồi chờ 2.5s
> mới bấm — mô phỏng đúng kịch bản mà lỗi *không* xảy ra. Đã siết: `/auth/me`
> chậm 2.5s, cú bấm đầu sau 400ms. Một bộ kiểm luồng không mô phỏng **độ trễ**
> chỉ chứng minh "mã đúng khi mọi thứ nhanh".

### 3. Luồng THẬT trên staging — `tests/staging-e2e/speaking-start-flow.spec.js`

Backend thật, Supabase thật, danh tính seed. Phiên được **tạo trong DB** với
đúng `mode`/`part`/`topic`. Kết quả lượt cuối: **24 xanh · 1 bỏ qua · 1 đỏ**.

- Bỏ qua: test modal — điểm mở modal là **duy nhất** và nằm trong
  `#grammar-empty`, khối chỉ hiện khi dashboard ngữ pháp không có dữ liệu. Học
  viên đã xem bài ngữ pháp nào thì modal **không còn đường vào từ giao diện**.
  Đó là hành vi của bản legacy, không phải lỗi port.
- Đỏ: `gate-a flow 2` — **lỗi sẵn có, không liên quan**. Lượt chạy theo lịch
  trên `main` (04/08) đỏ đúng một mục, chính là mục này
  (`POST /sessions/{id}/questions/generate` → 500).

---

## Tính nguyên tử

Đổi route (`speaking-preview/` → `speaking/`) và gỡ rewrite
`{ source: '/speaking', destination: '/pages/speaking.html' }` nằm **cùng một
commit**. Cổng route-ownership chặn trạng thái nửa vời.

Sau khi gỡ: `route-ownership: 9 app routes · 319 public files · 26 config
sources · clean`.

---

## KHÔNG gỡ bản legacy

`/pages/speaking.html` vẫn trả **200**, cố ý:

> Chừng nào **cả hai bản còn sống** thì cổng parity G1 còn so được. Redirect nó
> sang `/speaking` sẽ khiến hai vế cùng dừng một URL, chốt `same-final-url` từ
> chối, và trang Speaking **mất luôn lớp parity**. Gỡ bản legacy thuộc Phase 7.

`tests/speaking-cutover.test.mjs` chặn cả hai chiều.

---

## Thay đổi

**13 chỗ điều hướng**: `aver-chrome.js` (tab + luật prefetch), `kp-roadmap.js`,
`pages/practice.html` (4, gồm một link có neo `#history`),
`pages/result.html` (3), `pages/full-test-result.html` (3) — cộng **1 chỗ ở
backend**.

### Backend cũng sinh điều hướng

`student_home_aggregator.py` trả `primary_cta_url`, và trang chủ đưa người dùng
đi bằng **đúng giá trị đó** khi họ bấm thẻ Speaking. Sweep frontend **không với
tới nó** — chốt chặn cutover bắt được (đúng bài học review #916 ở cutover
`/grammar`).

### Hai chỗ sweep suýt bỏ lọt

| Chỗ | Vì sao lọt |
|---|---|
| `practice.html` → `speaking.html#history` | mẫu thay thế của tôi không xử lý đuôi `?query`/`#hash` — mẫu **dò** thì có, mẫu **thay** thì không |
| `student_home_aggregator.py` | sweep chỉ quét `app/` + `public/` |

---

## Ánh xạ URL trong bộ so — bắt buộc

Thêm `/pages/speaking.html` → `/speaking` vào `canonicalHref`.

Không phải để so link nội bộ (sweep đã đổi cả hai vế) mà để so **neo trong
trang**: `practice.html` có `href="/speaking#history"`, và neo được phân giải
theo URL trang. Thiếu ánh xạ thì `/pages/speaking.html#history` ≠
`/speaking#history` ⇒ báo lệch giả. Đây đúng là lý do khu Grammar khớp được, và
là bẫy đã gặp ở cutover `/home`.

---

## Điều KHÔNG được suy ra từ trang này

- ❌ "Bản legacy đã bị gỡ." Sai — `/pages/speaking.html` **vẫn phục vụ**.
- ❌ "Cổng xanh nghĩa là biểu đồ đúng." Sai. G1 **không thấy** nội dung trong
  `<canvas>`; hai biểu đồ Chart.js nằm ngoài tầm parity **vĩnh viễn**. Lớp che
  của chúng là `tests/speaking-charts.test.mjs`.
- ❌ "Đã phủ dữ liệu học viên thật." Sai. Tài khoản probe không có dữ liệu học
  tập, nên lượt authed chỉ so **trạng thái RỖNG**. Bảng lịch sử có dữ liệu và
  hai biểu đồ **chưa bao giờ** được cổng nhìn thấy.

---

## Rollback

Instant Rollback ≤12s (ADR-007). Cutover **không đụng dữ liệu** — chỉ đổi route,
link, và một chuỗi trong backend aggregator.
