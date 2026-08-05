# Cutover `/home` — trang chủ học viên

**Ngày:** 2026-08-05 · **Route canonical:** `/home` (Next)
**Đây là cutover ĐẦU TIÊN của một trang CẦN ĐĂNG NHẬP có bằng chứng parity.**

---

## Vì sao cutover này khác các lần trước

Ba cutover trước (`/`, bài viết Grammar, `/grammar`) đều là trang công khai — cổng
parity G1 mở được bằng trình duyệt ẩn danh. `/home` thì không: `pages/home.html`
có auth gate ở cuối trang (`window.location.href = '../login.html'`), nên trình
duyệt ẩn danh **không bao giờ dừng lại ở đó**.

Trước PR #930, G1 cho `/home` **con số không** — không phải "chỉ so được vỏ".
Cutover này đứng được là nhờ **authed-G1**: `parity-diff.mjs --auth` tiêm một
phiên Supabase thật (tài khoản probe) vào context trình duyệt trước khi điều
hướng, nên so được cả hai vế ở trạng thái đã đăng nhập.

---

## Cutover ở dự án này nghĩa là gì

**Đổi canonical + đổi mọi điều hướng nội bộ. KHÔNG gỡ bản legacy.**

`/pages/home.html` vẫn trả **200** và đó là cố ý:

> Chừng nào **cả hai bản còn sống** thì cổng parity G1 còn so được. Redirect
> `/pages/home.html` sẽ khiến hai vế cùng dừng ở `/home`, chốt `same-final-url`
> từ chối, và trang chủ **mất luôn lớp parity vừa dựng xong**. Việc gỡ bản
> legacy thuộc Phase 7 — làm sau, và làm có chủ đích.

`tests/home-cutover.test.mjs` chặn đúng "cải tiến" đó, và chặn cả chiều ngược
lại (rewrite `/home` còn sót ⇒ route Next bị che, cutover chỉ là hình thức).

---

## Tính nguyên tử

Đổi route (`home-preview/` → `home/`) và gỡ rewrite
`{ source: '/home', destination: '/pages/home.html' }` phải nằm **cùng một
commit**. Cổng route-ownership chặn trạng thái nửa vời — và nó **đã báo đúng**
khi tôi đổi route trước, gỡ rewrite sau:

```
COLLISION: app route /home is SHADOWED by config source /home
  — remove the legacy rule in the same change (atomic cutover, plan §8.2)
```

Sau khi gỡ: `route-ownership: 8 app routes · 318 public files · 27 config
sources · clean`.

---

## Thay đổi

**30 chỗ điều hướng** chuyển sang `/home`, trên 26 tệp (27 tệp trong `public/` + `app/`, một trong đó là route Next):

| Nhóm | Tệp |
|---|---|
| Chrome dùng chung | `js/components/aver-chrome.js` (logo · tab Trang chủ · luật prefetch) · `js/components/aver-admin-chrome.js` |
| **Sau đăng nhập** | `login.html` (`DASHBOARD_URL`) |
| Onboarding | `onboarding.html` (2 chỗ) |
| Trang gốc | `index.html` · `admin.html` |
| Luồng giảng viên | `js/instructor-{app,grade,compose}.js` · `js/admin-instructors.js` · `pages/instructor/index.html` (2) |
| Trang học viên | `pages/{exam,mock-exam,mock-result,reading-test,reading-mini-test,reading-vocab,reading-skill}.html` · `js/flashcard-study.js` |
| Admin Writing | `pages/admin/writing/{index,new,status,grade,instructor-queue}.html` · `pages/admin/classes/index.html` |
| Route Next | `app/(marketing)/page.tsx` |

**Cố ý KHÔNG đổi:**

| Chỗ | Lý do |
|---|---|
| `onboarding.html` tham số `?first_topic=` | Đổi ĐƯỜNG, giữ THAM SỐ. Grep cho thấy **0 nơi tiêu thụ** `first_topic` — bỏ nó là đổi hành vi ngoài phạm vi cutover. |
| `public/pages/home.html` | Chính bản legacy. (Đếm được: nó không hề tự trỏ vào chính mình.) |
| Fixture `backend/tests/test_error_logs.py` | `"url": "/pages/home.html"` là **dữ liệu** của một bản ghi log, không phải điều hướng. |

### Một chỗ suýt lọt

Sweep bằng regex `href=` / `location.href =` / `href_matches:` **bỏ sót**
`login.html:658`:

```js
var DASHBOARD_URL  = 'pages/home.html';   // dùng ở dòng 727
```

Đây là **điều hướng sau đăng nhập** — chỗ quan trọng nhất site — và nó lọt vì
đường dẫn được gán vào một biến. `tests/home-cutover.test.mjs` bắt được (chốt
quét theo *link có dấu nháy*, không theo *khuôn gọi hàm*). Bài học: sweep theo
khuôn cú pháp luôn có góc mù; chốt chặn phải quét theo giá trị.

---

## Bằng chứng — theo ADR-013-A1, không theo đồng hồ

### G1 trước cutover (PR #930, đã merge)

```
lượt full   · 1280x900 → 149 cặp · 0 cặp lệch nghiêm trọng · 0 phát hiện mức cao
lượt full   · 375x812  → 149 cặp · 0 cặp lệch nghiêm trọng · 0 phát hiện mức cao
lượt authed · 1280x900 →   1 cặp · 0 cặp lệch nghiêm trọng · 0 phát hiện mức cao
lượt authed · 375x812  →   1 cặp · 0 cặp lệch nghiêm trọng · 0 phát hiện mức cao
```

Lượt authed chạy với phiên đăng nhập thật, so `pages/home.html` ↔ `/home-preview`
(nay là `/home`) — chữ, tiêu đề, link, khối, lời gọi API, ở cả hai bề rộng.

### Đo cục bộ sau khi đổi route

```
/home            HTTP 200 · có dấu hiệu Next (__next_f)
/pages/home.html HTTP 200 · bản legacy vẫn phục vụ
route-ownership  clean
hydration        3/3 sạch dưới `repro-418.mjs --slow-react`
frontend         6295/0 · backend 5288/0
```

### Rollback

Instant Rollback ≤12s (ADR-007). Cutover này **không đụng dữ liệu** — chỉ đổi
route và link.

---

## Điều KHÔNG được suy ra từ trang này

- ❌ "Bản legacy đã bị gỡ." Sai — `/pages/home.html` **vẫn phục vụ**, cố ý.
- ❌ "G1 sạch nghĩa là trang không còn lỗi nào." Sai. G1 so **chữ, link, khối**;
  nó không thấy hình ảnh, bố cục, hành vi sau tương tác, hay shadow root đóng.
  Giới hạn đầy đủ ở `frontend/tooling/parity-core.mjs`.
- ❌ "Đã phủ được dữ liệu học viên thật." Sai. Tài khoản probe **không có dữ
  liệu học tập**, nên lượt authed chỉ so được **trạng thái RỖNG**: lời chào,
  các ô `—`/`0`, thẻ khoá, "Chưa có hoạt động". Đường render có dữ liệu
  (band, streak, chuỗi hoạt động, dải lớp) **chưa** được parity phủ — nó được
  che bởi `tests/home-metrics.test.mjs`, bộ test chạy cùng bộ ca qua CẢ HAI bản.

---

## Hệ quả: đồng hồ đếm ngược của G1 cho trang chủ

Từ hôm nay `/home` là canonical còn `/pages/home.html` chỉ còn sống để **so
sánh**. Khi Phase 7 gỡ bản legacy, trang chủ **mất lớp parity vĩnh viễn** và
chuyển sang được che bởi test + G3 + rollback. Trước khi gỡ, nên chạy lượt
authed một lần cuối và **lưu báo cáo làm hồ sơ**.
