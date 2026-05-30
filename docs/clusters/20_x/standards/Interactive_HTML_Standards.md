# Interactive HTML Standards — IELTS Reading (computer-delivered simulation)

Tài liệu chuẩn **BẮT BUỘC** cho mọi file `IELTS_Reading_Test_NN_Interactive.html`. Mục tiêu: (1) bám sát giao diện CD-IELTS thật của British Council/IDP, (2) thống nhất thiết kế giữa 50+ đề, (3) sẵn sàng scale — đổi đề chỉ bằng việc thay khối dữ liệu nhúng.

Bộ tài liệu phụ thuộc: `Production_Standards.md` (chuẩn nội dung đề) + JSON nguồn trong `01_Tests/`. File tham chiếu mẫu (gold reference): **`IELTS_Reading_Test_01_Interactive.html`** — đã đạt cả 5 trục đánh giá ≥9/10.

**Version:** v1.1 · Last updated: 2026-05-29 (thêm §2A hiển thị chi tiết 14 dạng câu + §3A palette/chuyển passage/báo giờ/phản ứng trang)

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

> **Ghi chú phiên bản:** client BC THẬT dùng **radio click-select** cho TFNG/YNG (3 dòng), và **drag-and-drop** cho Matching Headings / Sentence Endings / Summary-with-box. Bản mô phỏng của ta được phép quy ước **`<select>` dropdown** cho các dạng matching/TFNG để đơn giản và ổn định — đây là biến thể hợp lệ (nhiều nền tảng bên thứ ba cũng vậy). Dù chọn cách nào, **luôn là CHỌN, không gõ chữ**, và phải nhất quán toàn bộ 50 đề. Câu lệnh hướng dẫn cho biết cơ chế gốc: *"move it into the gap"* = kéo-thả; *"Write … in each gap"* = ô text; *"Choose the correct answer / Choose TWO"* = click; *"Write the correct letter"* = chọn chữ cái.

---

## 2A. Tiêu chuẩn HIỂN THỊ chi tiết theo từng dạng câu

Nguồn: markup client chính thức của British Council (file mẫu CD-IELTS) + walkthrough IDP. Quy ước chung áp cho MỌI dạng:

- **Tiêu đề nhóm:** dòng **`Questions X–Y`** in đậm, đứng riêng một dòng.
- **Câu lệnh (instruction):** ngay dưới tiêu đề, in nghiêng/đậm; **giới hạn từ nằm TRONG câu lệnh** (vd "Write **NO MORE THAN TWO WORDS** from the passage for each answer") — **KHÔNG** tách ra banner/box riêng. Render `white-space: pre-wrap` để giữ xuống dòng gốc.
- **Số câu:** mỗi item mở đầu bằng **số thứ tự in đậm** (badge tròn navy trong bản mô phỏng), căn trên cùng, phần thân thụt lề treo (hanging indent) để dòng wrap thẳng hàng.
- **Khoảng cách:** mỗi item cách nhau ≥8px; nhóm câu (q-group) cách nhau ≥22px; có đường phân tách mảnh dưới câu lệnh.
- **Đóng khung (box):** chỉ các thành phần "danh sách lựa chọn dùng chung" mới đóng khung (xem từng dạng); câu hỏi thường KHÔNG có border.

### 2A.1 Multiple Choice (một đáp án)
- **Câu lệnh:** "Choose the correct letter, A, B, C or D." (không có giới hạn từ).
- **Bố cục:** stem một dòng → **4 lựa chọn, MỖI LỰA CHỌN MỘT DÒNG**, có nhãn **A/B/C/D in đậm** đứng trước, thụt lề treo.
- **Control:** **radio** (1 nhóm/câu). Click cả dòng `<label>` để chọn (vùng bấm rộng).
- **Khung:** KHÔNG. Danh sách phẳng. Hover dòng → nền xanh nhạt.

### 2A.2 Multiple Choice (chọn HAI+)
- **Câu lệnh:** "Choose **TWO** letters, A–E." ("TWO" in hoa đậm).
- **Bố cục:** danh sách lựa chọn dọc, mỗi mục một dòng, nhãn chữ cái đứng trước.
- **Control:** **checkbox** (tối đa N ô). Khi đã đủ N ô tick → có thể khoá thêm hoặc cảnh báo nhẹ; mỗi ô tick lấp một số câu ghép.

### 2A.3 True/False/Not Given · 2A.4 Yes/No/Not Given
- **Câu lệnh:** giữ nguyên block 3 dòng "TRUE if… / FALSE if… / NOT GIVEN if…" (hoặc YES/NO/NOT GIVEN), `pre-wrap`.
- **Bố cục:** mỗi câu = **statement một dòng** → control chọn ngay dưới.
- **Control (bản mô phỏng):** **`<select>` dropdown** với đúng 3 option (TRUE/FALSE/NOT GIVEN hoặc YES/NO/NOT GIVEN) + option rỗng "— select —". (Client thật: 3 radio dòng — biến thể hợp lệ.)
- **Khung:** KHÔNG. **Tuyệt đối không cho gõ chữ** "true/false".

### 2A.5 Matching Headings
- **Câu lệnh:** "Choose the correct heading for paragraphs B–G from the list of headings below. Write the correct number, i–ix…"
- **Đóng khung (BẮT BUỘC):** **"List of Headings" trong một BOX có viền** (`.headings-box`), đặt **NGAY TRÊN** danh sách câu; mỗi heading một dòng, **số La Mã (i, ii, iii…) in đậm** đứng trước. Box được phép `position: sticky` để cuộn theo.
- **Bố cục câu:** mỗi item = "Paragraph **B**" → control chọn.
- **Control:** **`<select>`** liệt kê i–ix (hiển thị "iii — <tóm tắt heading>"), hoặc kéo-thả chip (client thật). Headings phải **nhiều hơn số đoạn ≥2** (đã đảm bảo ở §6.6 nội dung).

### 2A.6 Matching Information
- **Câu lệnh:** "Which paragraph contains the following information? … Write the correct letter, A–H. **NB** You may use any letter more than once." (chỉ in "NB…more than once" KHI thực sự được tái dùng).
- **Bố cục:** danh sách statement đánh số, mỗi statement một dòng + control chọn **chữ cái đoạn** (A, B, C…).
- **Control:** **`<select>`** các nhãn đoạn của passage hiện tại. **Đáp án LUÔN là một chữ cái** — không gõ chữ.
- **Khung:** KHÔNG có box lựa chọn (các "lựa chọn" chính là các đoạn có nhãn trong passage).

### 2A.7 Matching Features
- **Câu lệnh:** "Match each statement with the correct researcher/option, A–E. NB You may use any letter more than once" (NB chỉ khi tái dùng).
- **Đóng khung (BẮT BUỘC):** **danh sách A–E (tên/đặc điểm) trong BOX có viền** (`.features-box`), đặt TRÊN danh sách câu; mỗi mục một dòng, **chữ cái in đậm** đứng trước.
- **Control:** **`<select>`** A–E cho mỗi statement.

### 2A.8 Matching Sentence Endings
- **Câu lệnh:** "Complete each sentence with the correct ending, A–G, below."
- **Đóng khung (BẮT BUỘC):** **danh sách "Endings" A–G trong BOX có viền**, đặt TRÊN/dưới phần đầu câu; **endings nhiều hơn beginnings ≥2**.
- **Bố cục câu:** **vế đầu câu + dấu " …"** (ba chấm) → control chọn chữ cái ending.
- **Control:** **`<select>`** A–G (mỗi ending dùng đúng 1 lần).

### 2A.9 Sentence Completion
- **Câu lệnh:** "Complete the sentences below. Choose NO MORE THAN TWO WORDS / ONE WORD ONLY…"
- **Bố cục:** mỗi câu chạy inline, **ô text NẰM ĐÚNG VỊ TRÍ CHỖ TRỐNG** (`____`) trong câu. Nếu stem không có `____` thì ô text đặt cuối câu.
- **Control:** **`<input type=text>`** inline (rộng ~120–220px), `autocomplete="off"`. Cho copy-paste.
- **Khung:** KHÔNG.

### 2A.10 Summary Completion (không có box từ)
- **Câu lệnh:** "Complete the summary below. Choose NO MORE THAN TWO WORDS…"
- **Đóng khung (BẮT BUỘC):** **toàn bộ đoạn summary trong MỘT BOX nền nhạt** (`.gap-box`), giữ văn bản chảy liền; **số câu in đậm (màu accent) + ô text inline** ngay tại mỗi chỗ trống.
- **Control:** ô text inline trong đoạn. Render bằng regex thay `N ____` → `<span số đậm> <input>`.

### 2A.11 Summary Completion (có box từ A–J)
- **Câu lệnh:** "Complete the summary using the list of words, A–J, below."
- **Đóng khung (BẮT BUỘC):** đoạn summary trong box; **word bank A–J trong BOX riêng** (mỗi từ một dòng, chữ cái đậm). Số từ trong bank **nhiều hơn số chỗ trống ≥2**.
- **Control:** **`<select>` A–J** tại mỗi chỗ trống (đáp án là **chữ cái**), hoặc kéo-thả chip (client thật).

### 2A.12 Note / Table / Flow-chart Completion
- **Câu lệnh:** "Complete the notes/table/flow-chart… Write ONE WORD / NO MORE THAN TWO WORDS…"
- **Note Completion:** trình bày **dạng bullet/ghi chú** (có tiêu đề đậm), mỗi bullet chứa số câu + ô text inline. Giữ thụt lề phân cấp gốc.
- **Table Completion:** **render bảng có viền ô thật** (header in đậm, đường kẻ rõ); ô text đặt **trong đúng cell** mang chỗ trống. Trong bản mô phỏng dùng khối `.gap-box.mono-block` giữ căn cột (`white-space: pre-wrap`, font mono) nếu không dựng `<table>` đầy đủ.
- **Flow-chart Completion:** **chuỗi hộp nối bằng mũi tên xuống `↓`**, mỗi hộp có số câu + ô text. Giữ ký tự mũi tên và xuống dòng gốc trong `.gap-box.mono-block`.
- **Control:** ô text inline trong từng dòng/cell/hộp.

### 2A.13 Diagram Label Completion
- **Câu lệnh:** "Label the diagram below. Write ONE WORD / NO MORE THAN TWO WORDS…"
- **Bố cục:** sơ đồ/hình (ASCII art hoặc ảnh) với **các nhãn đánh số** trỏ tới bộ phận; mỗi callout có số câu + ô text. **KHÔNG để gợi ý đáp án trong nhãn** (theo §nội dung).
- **Control:** ô text inline cạnh mỗi nhãn (thường 1 từ). Dùng `.gap-box.mono-block` để giữ bố cục sơ đồ.

### 2A.14 Short-Answer Questions
- **Câu lệnh:** "Answer the questions below. Choose NO MORE THAN THREE WORDS AND/OR A NUMBER…"
- **Bố cục:** **danh sách câu hỏi Wh- đánh số**, mỗi câu một dòng + ô text ở cuối.
- **Control:** **`<input type=text>`** mỗi câu. Khung: KHÔNG.

### 2A.15 Quy ước render khối (tổng hợp)
- Khối có chỗ trống inline (summary/note/table/flow-chart/diagram) → một `.gap-box`; bảng/flow-chart/sơ đồ thêm `.mono-block` (font mono + `pre-wrap`) để **giữ nguyên cột, mũi tên, xuống dòng**.
- Mọi chỗ trống `\d{1,3}\s+_{2,}` → `<span class="gnum">N</span> <input data-q="N">`.
- Danh sách dùng chung (headings/features/endings/word-bank) → box có viền, **đặt trước** câu, chữ cái/số định danh in đậm.
- Mọi text động phải qua `esc()`.

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

## 3A. Tiêu chuẩn hiển thị bảng số câu 1–40, chuyển passage, báo giờ & phản ứng trang

### 3A.1 Bảng số câu (palette 1–40) ở thanh dưới
- **Vị trí:** thanh điều hướng đáy, nền navy, chạy suốt chiều ngang; cuộn ngang khi tràn.
- **Nhóm theo Part:** chia rõ **Part 1 / Part 2 / Part 3**; mỗi cụm có **nhãn "PART N" in hoa nhỏ** đứng trước, giữa các cụm có **vạch phân tách dọc** (`.nav-sep`).
- **Ô số (mỗi câu):** **hình VUÔNG** ~30px (mobile ≥34px), viền mảnh, số căn giữa, bo góc nhẹ 3px.
- **4 trạng thái (BẮT BUỘC phân biệt rõ):**
  - *Chưa làm:* nền xám-navy (`#3b4060`), chữ xám nhạt, viền `#54608a` — hình **vuông**.
  - *Đã làm:* **nền trắng, chữ navy** (đảo màu) — phản hồi NGAY khi nhập đáp án. (Client thật: gạch chân dưới số; bản mô phỏng dùng đảo nền cho rõ hơn — chấp nhận, miễn khác biệt rõ.)
  - *Đánh dấu xem lại (review):* **đổi từ VUÔNG → TRÒN** (`border-radius:50%`, viền cam `#ffb74d`). Đây là chỉ dấu đặc trưng, KHÔNG thay bằng icon cờ.
  - *Đang ở (current):* **viền vàng nổi** (`box-shadow 0 0 0 2px #ffd54f`) — không thay màu nền, chỉ thêm ring.
- **Kết hợp:** đã làm + review = tròn + nền trắng; current chồng thêm ring vàng.
- **Chú thích (legend):** dưới palette có dải legend (vuông=chưa làm · trắng=đã làm · tròn=đánh dấu) — `aria-hidden`, chỉ hỗ trợ thị giác; giải thích đầy đủ trong Help.
- **Tương tác:** click số → **nhảy thẳng** tới câu (đổi Part nếu cần) + cuộn pane câu hỏi tới câu đó + flash nhẹ. Nút **Prev/Next** bước từng câu, vượt biên Part tự nhiên.
- **a11y:** mỗi ô là `<button>` trong `role="group"`; `aria-label` cập nhật động "Question N, answered, flagged for review, current".

### 3A.2 Chuyển qua lại Passage 1 / 2 / 3
- **Trigger:** **không có nút "nộp Part" riêng**; chuyển tự do bằng (a) click số câu thuộc Part khác, hoặc (b) bấm Next/Prev vượt biên Part. Làm câu theo thứ tự bất kỳ, sửa/để trống tuỳ ý.
- **Phản ứng màn hình:** **pane passage bên trái đổi sang text của Part đó**, pane phải đổi sang câu hỏi của Part đó; **dải Part Strip** trên cùng cập nhật "Part N · questions a–b".
- **Cuộn:** Part mới load **cuộn về đầu** cả hai pane (mặc định). Không bắt buộc khôi phục vị trí cuộn cũ.
- **Xác nhận:** **KHÔNG có dialog xác nhận** — chuyển tức thì. (Tránh anti-pattern thêm bước xác nhận.)
- **Highlight đã tạo** ở mỗi Part được khôi phục khi quay lại (cache theo Part, gắn version).

### 3A.3 Báo hiệu sắp hết giờ (time signaling)
- **Đồng hồ:** đếm ngược MM:SS, nền trắng/chữ đen, đặt giữa-trên (cạnh nhãn "Time remaining").
- **Mốc 10 phút còn lại (≤600s):** đồng hồ chuyển **nền vàng** (`--warn`), + **toast đỏ "10 minutes remaining"** hiện ~4s ở giữa-trên, + **thông báo live-region** (screen reader).
- **Mốc 5 phút còn lại (≤300s):** đồng hồ chuyển **nền đỏ + NHÁY** (`flashRed`), + **toast "5 minutes remaining"** + thông báo SR. (Tôn trọng `prefers-reduced-motion`: tắt nháy, giữ đổi màu + toast + SR.)
- **Hết giờ (0:00):** **tự động nộp bài** (`submitTest(auto=true)`) — không hỏi, mở thẳng màn kết quả; thông báo SR "Test submitted…". KHÔNG yêu cầu thí sinh bấm nộp.
- **Không** dùng pop-up modal chặn màn ở mốc 10/5 phút (client thật chỉ đổi màu/nháy) — toast không chặn là đủ.

### 3A.4 Phản ứng của trang khi thí sinh đang làm bài (live feedback)
- **Nhập đáp án:** ô câu hỏi thêm class `answered` (viền trái xanh + nền nhạt) **ngay lập tức**, và **ô palette tương ứng đổi sang "đã làm" tức thì** + cập nhật `aria-label`.
- **Chọn radio/select:** highlight lựa chọn ngay; xoá nội dung ô text → tự gỡ trạng thái "đã làm".
- **Tick Review:** ô palette **lật vuông→tròn ngay**; bỏ tick → trở lại vuông. Checkbox Review phản ánh đúng câu hiện tại.
- **Hover:** dòng lựa chọn MCQ/option có nền xanh nhạt khi hover; nút palette/arrow có hover affordance.
- **Nhảy câu:** click số → cuộn mượt tới câu + **flash nền vàng nhẹ ~0.5s** (tắt nếu reduced-motion).
- **Right-click trên passage:** mở **menu ngữ cảnh Highlight / Notes / Clear** + chọn màu; bôi đen rồi `Alt+H`/`Alt+N` là đường bàn phím tương đương. Note tạo **dấu neo gạch chân + ✎** cạnh chữ.
- **Autosave:** lưu state liên tục (mỗi ~5s và sau mỗi thao tác) vào localStorage — **âm thầm, không spinner/toast**. Reload giữa chừng → khôi phục nguyên trạng (bỏ qua intro).
- **Settings áp tức thì:** đổi cỡ chữ/theme phản ánh ngay toàn trang, lưu vào state.
- **Không có chỉ báo "đã lưu"** cho Reading (đúng client thật).

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
- [ ] §2A: mỗi dạng câu hiển thị đúng (đóng khung danh sách dùng chung, dropdown/radio/ô text đúng dạng, số câu + xuống dòng + thụt lề)
- [ ] §3A: palette 4 trạng thái (vuông/trắng/tròn/ring), chuyển passage không xác nhận, báo giờ 10/5 phút + tự nộp, live feedback khi nhập
- [ ] §3: chỉ dùng design tokens; 4 theme; font sans-serif
- [ ] §4: focus trap+return, inert, skip-link, live region, Escape an toàn, keyboard highlight, reduced-motion, contrast AA
- [ ] §5: chấm điểm khớp hand-count; diacritic/accept/case; wall-clock timer; suy số liệu từ data; version-gate cache
- [ ] §6: responsive ≤860/≤560; print
- [ ] jsdom smoke test PASS (0 lỗi JS)
- [ ] 5-agent eval: **cả 5 ≥9/10**
- [ ] Lưu vào `05_Interactive_HTML/`; bump version + ghi CHANGELOG nếu sửa chuẩn

---

*File gold reference: `IELTS_Reading_Test_01_Interactive.html`. Bump version tài liệu này khi sửa bất kỳ rule nào.*
