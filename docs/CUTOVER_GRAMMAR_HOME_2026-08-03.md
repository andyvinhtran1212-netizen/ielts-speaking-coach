# Cutover `/grammar` — trang chủ Grammar Wiki

**Ngày:** 2026-08-03 · **Route canonical:** `/grammar` (Next)
**Đây là cutover ĐẦU TIÊN chạy theo ADR-013-A1** — bằng chứng là cổng, không
phải cửa sổ thời gian.

---

## Cutover ở dự án này nghĩa là gì

**Đổi canonical + đổi mọi điều hướng nội bộ. KHÔNG gỡ bản legacy.**

Đây là tiền lệ pilot 2 đã đặt: `/pages/grammar-article.html` vẫn trả **200** tới
hôm nay, sau nhiều ngày cutover. Ta làm y hệt với `/grammar.html`.

Và lý do giữ legacy **không chỉ** là tương thích bookmark:

> Chừng nào **cả hai bản còn sống** thì cổng parity G1 còn so được. Redirect
> `/grammar.html` sẽ khiến hai vế cùng dừng ở `/grammar`, chốt `same-final-url`
> từ chối, và khu Grammar **mất luôn lớp parity**. Việc gỡ bản legacy thuộc
> Phase 7 — làm sau, và làm có chủ đích.

Đã có test chặn đúng "cải tiến" đó (`grammar-cutover.test.mjs`): thêm redirect
`/grammar.html` vào `vercel.json` ⇒ test đỏ.

---

## Thay đổi

**23 link nội bộ** chuyển từ `/grammar.html` sang `/grammar`, trên 14 tệp:

| Nhóm | Tệp |
|---|---|
| Chrome dùng chung (điều hướng chính) | `js/components/aver-chrome.js` (2) |
| Route Next | `(marketing)/page.tsx` (3) · `grammar/[category]/[slug]/page-shell.tsx` (1) |
| Trang legacy | `index.html` (3) · `pricing.html` (2) · `pages/speaking.html` (1) · `pages/quiz.html` (2) · `pages/quiz-progress.html` (1) · `js/kp-roadmap.js` (2) |
| Các trang Grammar legacy | `grammar-{compare,exercises,search}.html` (1 mỗi) · `grammar-roadmap.html` (2) · `grammar-article.html` (1) |

**Cố ý KHÔNG đổi:**

| Tệp | Lý do |
|---|---|
| `public/grammar.html` | link nội bộ của chính bản legacy, không phải điều hướng canonical |
| `public/js/grammar.js` | ruột bản legacy — dựng nội dung cho chính trang đó |
| `tests/staging-e2e/gate-b-coexistence.spec.js` | test khẳng định `/grammar.html` **vẫn** phục vụ; đó là chủ ý, không phải sót |

---

## Bằng chứng — theo A1, không theo đồng hồ

### G1 (cổng parity) — TRƯỚC cutover

CI của PR #915, phạm vi đầy đủ:

```
phạm vi: full
════════ bề rộng 1280x900 ════════
parity: 149 cặp · 0 cặp lệch nghiêm trọng · 0 phát hiện mức cao
════════ bề rộng 375x812 ════════
parity: 149 cặp · 0 cặp lệch nghiêm trọng · 0 phát hiện mức cao
```

149 cặp = trang chủ + 11 thư mục + **137 trang bài viết**, ở **cả hai bề rộng**.

### G1 — SAU khi đổi link (đo cục bộ, build production)

```
1280x900 → 12 cặp · 0 phát hiện mức cao
375x812  → 12 cặp · 0 phát hiện mức cao
```

Đổi link không làm lệch parity, đúng như thiết kế: `canonicalHref` quy cả
`/grammar.html` lẫn `/grammar` về cùng một dạng, nên hai vế vẫn khớp.

### G3 — sau cutover

Ngưỡng lỗi **tuyệt đối 0** trên `/grammar`: bất kỳ lỗi client nào cũng điều tra
ngay. Khả thi chính vì lưu lượng thấp — không có nhiễu để lọc.

### Rollback

Instant Rollback ≤12s (ADR-007). Cutover này **không đụng dữ liệu**, chỉ đổi
link — nên rollback là quay lại deployment trước, không có gì phải hoàn tác.

---

## Điều KHÔNG được suy ra từ trang này

- ❌ "Bản legacy đã bị gỡ." Sai — `/grammar.html` **vẫn phục vụ**, cố ý.
- ❌ "G1 sạch nghĩa là trang không còn lỗi nào." Sai. G1 so **chữ, link, khối**;
  nó không thấy hình ảnh, bố cục, hành vi sau tương tác, hay shadow root đóng.
  Danh sách giới hạn đầy đủ ở `frontend/tooling/parity-core.mjs`.
- ❌ "Cutover này đã qua cửa sổ quan sát." Sai, và **cố ý không có** cửa sổ nào —
  đó là toàn bộ điểm của A1: với lưu lượng 8,6 lượt xem/giờ, chờ 48h không sinh
  ra bằng chứng. Bằng chứng là 298 phép so tự động trước khi merge.

---

## Hệ quả: đồng hồ đếm ngược của G1 cho khu Grammar

Từ hôm nay, `/grammar` là canonical còn `/grammar.html` chỉ còn sống để **so
sánh**. Khi Phase 7 gỡ bản legacy, khu Grammar **mất lớp parity vĩnh viễn** và
chuyển sang được che bởi test + G3 + rollback.

Trước khi gỡ, nên chạy `--expand-grammar` một lần cuối và **lưu báo cáo làm hồ
sơ**, vì sau đó không lặp lại được.
