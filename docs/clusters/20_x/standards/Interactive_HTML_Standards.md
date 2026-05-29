# Interactive HTML Standards — IELTS Reading (computer-delivered simulation)

Tài liệu chuẩn **BẮT BUỘC** cho mọi file `IELTS_Reading_Test_NN_Interactive.html`. Mục tiêu: (1) bám sát giao diện CD-IELTS thật của British Council/IDP, (2) thống nhất thiết kế giữa 50+ đề, (3) sẵn sàng scale — đổi đề chỉ bằng việc thay khối dữ liệu nhúng.

Bộ tài liệu phụ thuộc: `Production_Standards.md` (chuẩn nội dung đề) + JSON nguồn trong `01_Tests/`. File tham chiếu mẫu (gold reference): **`IELTS_Reading_Test_01_Interactive.html`** — đã đạt cả 5 trục đánh giá ≥9/10.

**Version:** v1.0 · Last updated: 2026-05-29

---

## 0. Nguyên tắc nền tảng

1. **Single-file, zero-dependency.** Toàn bộ HTML + CSS + JS + dữ liệu trong MỘT file `.html`. Không CDN, không external asset, không network call. Mở được offline bằng double-click.
2. **Data-driven.** Mọi nội dung đề đến từ một khối JSON nhúng duy nhất; code render thuần tuý từ dữ liệu. Đổi đề = thay JSON, không sửa logic.
3. **Source of truth = JSON trong `01_Tests/`.** Dữ liệu nhúng phải **khớp byte-level** với JSON đề đã qua `verify.py` PASS. Không bao giờ sửa nội dung trực tiếp trong HTML.
4. **Fidelity trước, tính năng học sau.** Giao diện trong-bài phải giống CD-IELTS thật; lớp tự-chấm/giải-thích tiếng Việt chỉ xuất hiện SAU khi nộp bài (không phá tính chân thực).
5. **Đạt cửa chất lượng.** Mỗi file mới phải qua vòng 5-agent eval (§9) và đạt **≥9/10 ở cả 5 trục** trước khi phát hành.

---

## 1. Kiến trúc file (thứ tự bắt buộc)

```
<!DOCTYPE html><html lang="en">
<head>
  <meta charset/viewport/color-scheme/title>
  <style> … toàn bộ CSS … </style>
</head>
<body data-theme="default">
  skip-link + live-region (a11y)
  INTRO modal (overlay, mở sẵn)
  TOP BAR (candidate · timer · Settings/Hide/Help)
  PART STRIP (Part N + dải hướng dẫn)
  MAIN (passage-pane | divider | questions-pane)
  BOTTOM NAV (Review checkbox · Prev/Next · End · palette 1–40 · legend)
  CONTEXT MENU (Highlight/Notes/Clear)
  SETTINGS / HELP / NOTE / CONFIRM / HIDE / RESULTS modals
  <script id="test-data" type="application/json"> … JSON đề … </script>
  <script> … app JS … </script>
</body>
```

**Quy tắc nhúng dữ liệu:** JSON đặt trong `<script type="application/json">` rồi `JSON.parse(...textContent)` — KHÔNG nhúng dưới dạng object literal trong JS (tránh lỗi escaping). Kiểm tra chuỗi JSON không chứa `</script>`.

---

## 2. Bám chuẩn giao diện CD-IELTS (BẮT BUỘC)

Đây là các điểm fidelity mà bản clone hay làm sai; tất cả phải đúng:

| # | Yêu cầu | Bắt buộc |
| --- | --- | --- |
| 2.1 | **Split-screen**: passage TRÁI, câu hỏi PHẢI, hai pane cuộn độc lập, có divider | ✓ |
| 2.2 | **Một passage/màn hình**; chuyển Part qua palette hoặc Prev/Next | ✓ |
| 2.3 | **Dải hướng dẫn** ("Part N · questions a–b") phía trên | ✓ |
| 2.4 | **Top bar**: tên + số báo danh thí sinh; **đồng hồ đếm ngược 60:00** | ✓ |
| 2.5 | Timer **cảnh báo ở mốc 10 phút và 5 phút** (đổi màu + toast + thông báo SR); **tự nộp** khi về 0 | ✓ |
| 2.6 | **Palette 1–40 nhóm theo Part 1/2/3**; nút current có viền nổi | ✓ |
| 2.7 | **Dấu Review = vuông → tròn** (KHÔNG dùng icon cờ/đổi màu thay thế) | ✓ |
| 2.8 | Câu **đã làm** khác rõ câu **chưa làm** trên palette | ✓ |
| 2.9 | **Review checkbox** ở góc dưới-trái; **Prev/Next**; **End Test** | ✓ |
| 2.10 | **Settings** = ≥3 cỡ chữ + ≥3 theme màu; **Hide → Resume test**; **Help** | ✓ |
| 2.11 | **Highlight + Notes qua menu CHUỘT PHẢI** trên text bôi đen (mục: Highlight / Notes / Clear), nhiều màu | ✓ |
| 2.12 | KHÔNG có màn "review 2 phút cuối" (đó là của Listening) | ✓ |

### 2.3a Cơ chế nhập đáp án theo dạng câu (KHÔNG được sai)

| Dạng câu | Control nhập |
| --- | --- |
| Multiple Choice | radio (click chọn) |
| True/False/Not Given · Yes/No/Not Given | **dropdown `<select>`** (KHÔNG gõ chữ) |
| Matching Headings / Features / Information / Sentence Endings | **`<select>` chọn chữ cái/số** |
| Sentence/Summary/Note/Table/Flow-chart/Diagram Completion | **ô text inline** trong câu/bảng/sơ đồ |
| Short-Answer | ô text |

Cho phép copy-paste từ passage vào ô completion.

---

## 3. Thiết kế trực quan (design tokens — thống nhất mọi đề)

Khai báo qua CSS variables trong `:root`. **Cấm hard-code màu rời rạc**; mọi màu tham chiếu biến.

```css
:root{
  --ielts-navy:#1d1d3b;   /* header bar */
  --ielts-blue:#2b6cb0;   /* accent tương tác */ --ielts-blue-d:#1f5290;
  --bg-app:#d7d7d7;       /* desktop sau pane */
  --bg-pane:#ffffff; --bg-q:#ffffff; --border:#b9b9b9; --text:#1a1a1a;
  --hl-yellow:#fff176; --hl-green:#a5d6a7; --hl-pink:#f48fb1;   /* màu highlight */
  --correct:#2e7d32; --incorrect:#c62828; --grey:#757575;
  --font-scale:1;        /* điều khiển bởi Settings */
}
```

- **Font:** sans-serif (`Arial, 'Segoe UI', Helvetica`). KHÔNG dùng serif.
- **Cỡ chữ gốc:** `15px` nhân `--font-scale`. Settings: Standard 0.9 / Large 1.1 / Largest 1.3 (hoặc tương đương, một mức = mặc định).
- **4 theme** qua `body[data-theme]`: `default` (đen/trắng), `black-on-cream`, `white-on-black`, `yellow-on-blue`. Mọi theme phải giữ contrast AA (≥4.5:1 cho text).
- **Header navy, pane trắng, accent xanh, palette tile vuông.** Review tile bo tròn 50%.
- Highlight luôn ép `color:#1a1a1a` để đọc được trên theme tối.

---

## 4. Chuẩn khả dụng (Accessibility — WCAG AA)

Mỗi điểm phải có; đây là các blocker từng khiến đề rớt eval:

1. **Skip link** đầu trang, hiện khi focus (`.vh:focus` reveal).
2. **Live region** `aria-live="polite"` cho cảnh báo giờ (10/5 phút) và thông báo nộp/điểm.
3. **Modal**: `role="dialog" aria-modal="true" aria-labelledby`; khi mở → **đưa focus vào trong, trap Tab, set nền `inert`+`aria-hidden`**; khi đóng (kể cả qua phím Escape) → **gỡ trap, gỡ inert, trả focus về nút đã mở**. Áp dụng cho CẢ intro và hide overlay.
4. **Escape** đóng modal có thể đóng (Settings/Help/Note/Confirm) bằng cách gọi đúng hàm `closeOverlay` (không chỉ ẩn class).
5. Mọi `input`/`select` có **accessible name** (`aria-label`); MCQ nhóm trong `role="radiogroup"`.
6. **Palette** là `<button>` trong `role="group"` (KHÔNG dùng `role="tablist"`); `aria-label` cập nhật theo trạng thái "answered / flagged for review / current".
7. **Timer** `role="timer" aria-live="off"` (tránh đọc mỗi giây); cảnh báo đi qua live region riêng.
8. **Bàn phím**: làm được mọi thao tác không cần chuột — kể cả highlight/note (phím tắt `Alt+H` / `Alt+N` trên text đã bôi đen) và đóng modal.
9. **`prefers-reduced-motion`**: tắt mọi animation (CSS flash + JS `element.animate`/flash).
10. **Touch target** ≥24px (mục tiêu 44px ở mobile); contrast mọi chỉ dấu UI ≥3:1, text ≥4.5:1 trên MỌI theme.
11. **`:focus-visible`** outline rõ ràng.

---

## 5. Hành vi & logic (JS) — chuẩn bắt buộc

### 5.1 State & lưu trữ
- State tối thiểu: `answers`, `review (Set)`, `notes`, `currentPart`, `currentQ`, `timeLeft`, `deadline`, `submitted`, `cfg`.
- **localStorage** bọc trong `try/catch` (chế độ riêng tư không vỡ). Key suy ra từ `TEST_DATA.test_id`.
- **Version-gate cache**: lưu `ver = test_id|version`; khi load nếu `ver` lệch → bỏ cache, bắt đầu mới (tránh nội dung cũ "dính" khi đổi đề/sửa nội dung). Áp dụng cho cả cache highlight.
- **Resume**: nếu có phiên đang dở (chưa submit, đúng ver) → bỏ qua intro, khôi phục đáp án + review + theme + đồng hồ.

### 5.2 Đồng hồ
- Neo theo **wall-clock**: lưu `deadline = Date.now()+timeLeft*1000`; mỗi tick tính `timeLeft = (deadline-now)/1000`. Đóng tab KHÔNG dừng giờ.
- Về 0 → `submitTest(auto=true)` (tự nộp, không hỏi).

### 5.3 Chấm điểm (chính xác tuyệt đối)
- `norm()` chuẩn hoá: **strip dấu** (`normalize('NFD')` + bỏ U+0300–U+036F) + lowercase + bỏ dấu câu + gộp khoảng trắng. → "El Nino" khớp "El Niño".
- So khớp với `answer` **và toàn bộ `answer_accept`** (case/trim/diacritic-insensitive).
- Phân loại từng câu: `correct` / `incorrect` / `blank`.
- **Band table** chuẩn Cambridge Academic Reading (dùng đúng bảng tham chiếu, suy ra từ số câu đúng).
- **Suy ra mọi con số từ dữ liệu** (`TOTAL_Q = Q_ORDER.length`) — KHÔNG hard-code "40" trong logic lẫn label.

### 5.4 Render & sự kiện
- **Escape 100% nội dung động** qua hàm `esc()` (chống XSS) ở mọi điểm in ra (passage, stem, options, kết quả, ô input).
- Re-render bằng `innerHTML` rồi re-bind listener; listener cấp document bind MỘT lần.
- Parse danh sách (headings i–x, features A–J) từ instruction bằng regex đã kiểm chứng trên dữ liệu thật.

### 5.5 Giải thích sau nộp (lớp học tập, tiếng Việt)
- Hiện `mechanism` (TFNG/YNG) và `distractor_analysis` (MCQ) từ JSON.
- **viGloss()**: dịch nhãn bẫy (D1–D4) + cụm cơ chế sang tiếng Việt; gộp "Dx + mô tả tiếng Anh" thành MỘT nhãn để tránh dịch lặp.
- Bộ lọc kết quả: Tất cả / Sai / Đúng / Bỏ trống. Nút In/PDF, Làm lại (clear state), Đóng.

---

## 6. Responsive & in ấn
- ≤860px: hai pane xếp dọc, ẩn divider, mỗi pane `max-height` ~46vh.
- ≤560px: palette cuộn ngang, target nút ≥34px, ẩn số báo danh phụ.
- `@media print`: ẩn chrome (top bar, nav, modal); passage + câu hỏi in liền mạch.

---

## 7. Quy trình tạo file cho đề mới (scale)

> Mục tiêu: tạo `IELTS_Reading_Test_NN_Interactive.html` mới chỉ trong vài bước, KHÔNG sửa logic.

1. **Lấy JSON nguồn** `01_Tests/.../IELTS_Reading_Pilot_Test_NN.json` (đã `verify.py` PASS). Nén compact: `json.dumps(d, ensure_ascii=False, separators=(',',':'))`.
2. **Copy file gold reference** Test_01 làm khung.
3. **Thay 3 chỗ phụ thuộc đề** (tất cả còn lại tự suy từ JSON):
   - Khối `<script id="test-data">` → JSON đề mới.
   - `<title>` + tiêu đề intro/kết quả ("Test NN").
   - (Khuyến nghị) số báo danh hiển thị.
4. **Tự động hoá**: dùng script build (xem §8) để inject — không sửa tay khối dữ liệu.
5. **Kiểm thử headless** (jsdom): 0 lỗi JS, render 3 passage, mọi dạng nhập ghi nhận, chấm đúng so với hand-count, resume/auto-submit/retry chạy.
6. **Chạy 5-agent eval** (§9). Loop sửa tới khi cả 5 trục ≥9.
7. Phát hành vào `05_Interactive_HTML/`.

**Bất biến khi đổi đề:** mọi `STORAGE_KEY`, `TOTAL_Q`, số Part, nhãn câu suy ra từ dữ liệu; chỉ JSON thay đổi.

---

## 8. Công cụ build khuyến nghị

Tách `app.js` (logic) và template HTML, rồi inject:
```python
html = open('template.html').read()
data = json.dumps(test_json, ensure_ascii=False, separators=(',',':'))
html = html.replace('__TEST_DATA__', data).replace('__APP_JS__', open('app.js').read())
```
Lợi ích: sửa logic MỘT chỗ (`app.js`) → rebuild toàn bộ N file. Kiểm tra sau build: `new Function(js)` (syntax) + `JSON.parse` (data) + jsdom smoke test.

---

## 9. Cửa chất lượng — 5-agent eval (ngưỡng ≥9/10 mỗi agent)

Mỗi file mới phải qua 5 agent đánh giá độc lập; loop sửa tới khi **tất cả ≥9**:

| Agent | Trục | Trọng tâm |
| --- | --- | --- |
| A1 | **CD-IELTS UI fidelity** | đối chiếu §2 + §2.3a (square→circle, dropdown TFNG, right-click highlight, 2 mốc cảnh báo, auto-submit) |
| A2 | **Functionality & correctness** | jsdom drive: mọi dạng nhập ghi nhận; **chấm điểm khớp hand-count**; accept variant/diacritic; band; resume; auto-submit; retry |
| A3 | **Accessibility & responsive** | §4 đầy đủ: focus trap+return, inert, skip-link, live region, keyboard, reduced-motion, contrast, mobile |
| A4 | **Code quality** | escaping/XSS, JSON nhúng an toàn, version-gate cache, wall-clock timer, suy ra số liệu từ data, không leak listener |
| A5 | **Content accuracy** | dữ liệu nhúng **khớp JSON nguồn**; 40 đáp án đúng; chấm chấp nhận mọi biến thể hợp lệ; giải thích tiếng Việt đúng & hữu ích |

Mỗi agent trả: SCORE /10 · strengths · DEFECTS (vị trí + [blocker]/[minor] + cách sửa) · verdict. Mọi blocker phải fix trước khi tái đánh giá.

---

## 10. Anti-patterns — TUYỆT ĐỐI tránh

### 10.1 Fidelity
- TFNG/YNG bắt **gõ chữ** "TRUE/FALSE" (phải là dropdown).
- Review dùng **icon cờ/đổi màu** thay vì đổi hình vuông→tròn.
- Highlight chỉ bằng **toolbar toggle**, không có menu chuột phải.
- Gộp cả 3 passage cuộn trong một cột; khoá cuộn hai pane.
- Thêm **màn review 2 phút** cho Reading.

### 10.2 Kỹ thuật
- Hard-code "40", tên đề, `STORAGE_KEY` (phải suy từ data) → vỡ khi scale.
- Nhúng dữ liệu dưới dạng JS object literal (rủi ro escaping) thay vì `<script type="application/json">`.
- Lưu cache không gắn `ver` → nội dung cũ "dính" khi đổi đề.
- Timer chạy bằng biến đếm thuần → đóng tab là dừng giờ (phải neo wall-clock).
- In nội dung động không qua `esc()` → lỗ hổng XSS.

### 10.3 A11y
- Modal không trap focus / không trả focus / không `inert` nền.
- Escape chỉ ẩn class mà không gỡ trap+inert → **kẹt bàn phím** (lỗi nghiêm trọng).
- Skip link ẩn vĩnh viễn (không reveal khi focus).
- `role="tablist"` cho palette (sai — phải `group`).
- Animation không tôn trọng `prefers-reduced-motion`.
- Dịch lặp nhãn (vd "D4 [cực đoan/đảo ngược] cực đoan/đảo ngược").

### 10.4 Nội dung
- Dữ liệu nhúng lệch JSON nguồn (dùng bản cũ) → đáp án/giải thích sai.
- `norm()` thiếu strip dấu → "El Nino" bị chấm sai cho "El Niño".
- Bỏ qua `answer_accept` → đáp án hợp lệ bị tính sai.

---

## 11. Checklist phát hành (mỗi file)

- [ ] Single-file, mở offline, 0 dependency, 0 lỗi console
- [ ] Dữ liệu nhúng khớp byte JSON nguồn (đã verify.py PASS)
- [ ] §2 + §2.3a: mọi điểm fidelity đạt
- [ ] §3: chỉ dùng design tokens; 4 theme; font sans-serif
- [ ] §4: focus trap+return, inert, skip-link, live region, Escape an toàn, keyboard highlight, reduced-motion, contrast AA
- [ ] §5: chấm điểm khớp hand-count; diacritic/accept/case; wall-clock timer; suy số liệu từ data; version-gate cache
- [ ] §6: responsive ≤860/≤560; print
- [ ] jsdom smoke test PASS (0 lỗi JS)
- [ ] 5-agent eval: **cả 5 ≥9/10**
- [ ] Lưu vào `05_Interactive_HTML/`; bump version + ghi CHANGELOG nếu sửa chuẩn

---

*File gold reference: `IELTS_Reading_Test_01_Interactive.html`. Bump version tài liệu này khi sửa bất kỳ rule nào.*
