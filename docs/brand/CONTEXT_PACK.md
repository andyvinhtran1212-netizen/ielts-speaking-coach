# Gói bối cảnh để nạp vào Claude Design (Prompt 0)

> Đây là **material đã đóng gói sẵn** — không phải lý thuyết. Làm theo phần A, dán phần B–F vào Claude Design, đính kèm 2 ảnh + file tokens.css.

---

## A. Cách nạp bối cảnh (làm đúng thứ tự này)

Mục tiêu của bước nạp bối cảnh: bắt Claude Design **hiểu đúng hệ hiện có + hiểu đúng ràng buộc** trước khi nó vẽ bất cứ gì. Nạp sai/thiếu → nó sáng tạo tự do → lệch code. Thứ tự:

1. **Tạo project** design system trước (loại `PROJECT_TYPE_DESIGN_SYSTEM`).
2. **Tin nhắn 1 — nạp bối cảnh:** dán **Phần B + C + D + E + F** dưới đây thành MỘT tin nhắn, kèm đính kèm:
   - File `frontend/css/aver-design/tokens.css` (kéo-thả nguyên file)
   - Ảnh `01-landing-hero.jpg` (landing, hero navy→teal)
   - Ảnh `02-grammar-app-light.jpg` (trang app, light theme)
3. **Kết thúc tin nhắn 1 bằng câu chốt** (Phần G) — yêu cầu Claude **tóm tắt lại bằng lời của nó** trước khi đề xuất gì.
4. **Đọc phần tóm tắt của Claude.** Chỉ khi nó nhắc đúng: giữ `--av-*`, giữ teal/amber, hiểu 3 hệ font đang lẫn, hiểu tone "thầy cô ấm áp" → mới sang tin nhắn 2 (bắt đầu thiết kế, dùng các prompt ở tài liệu chính mục 4.3). Nếu nó bỏ sót ràng buộc nào → nhắc lại, đừng cho nó vẽ.

---

## B. Brand summary card (dán nguyên khối)

```
BỐI CẢNH THƯƠNG HIỆU — AVER LEARNING

Sản phẩm: nền tảng luyện IELTS toàn diện (Speaking, Writing, Reading,
Listening, Grammar, Từ vựng) cho học viên Việt Nam. Có AI chấm điểm +
phản hồi theo tiêu chí IELTS. Web app + (sắp có) fan page song song.

Việc mình đang làm: CHÍNH THỨC HOÁ design system đã có thành một Claude
Design project + NÂNG CẤP bộ nhận diện (logo/social). KHÔNG làm lại từ đầu,
KHÔNG đổi hệ màu, KHÔNG đổi tên token.

Nền tảng nhận diện hiện tại (GIỮ):
- Màu chính: teal #0F766E (light) / #14B8A6 (dark). Nhấn: amber #F59E0B.
- Nền: off-white ấm #FAFAF9 (light) / navy sâu #0A1628 (dark). Có 2 theme.
- Chữ: Plus Jakarta Sans. Số: JetBrains Mono.
- Bảng màu theo kỹ năng: reading=sky #0EA5E9, listening=violet #8B5CF6,
  grammar=indigo #4F46E5, vocab=jade #0B6E59, speaking=amber, writing=teal.

Ràng buộc BẮT BUỘC (vi phạm = hỏng code đang chạy):
1. Mọi token phải giữ namespace `--av-*` (code + test đang phụ thuộc).
2. Chỉ TINH CHỈNH hệ màu teal/amber, KHÔNG thay hệ.
3. Hỗ trợ cả light lẫn dark, đạt WCAG AA cả hai.
4. An toàn dấu tiếng Việt: line-height body ≥ 1.55; tránh uppercase cho
   chuỗi tiếng Việt dài; mọi glyph phải đủ dấu.
5. Giọng: "thầy cô ấm áp, không hô khẩu hiệu". Xưng "bạn" với học viên,
   AI không xưng "tôi/mình". Sentence case (không Title Case). Không dấu "!".
```

---

## C. Bản rút gọn token (để Claude dùng đúng thang, không tự chế)

```
TYPE SCALE (rem, base 16px, tỉ lệ 1.125):
  --av-fs-xs .75 / sm .875 / base 1 / lg 1.125 / xl 1.25 / 2xl 1.5 /
  3xl 1.875 / 4xl 2.25 / 5xl 3

LINE-HEIGHT: tight 1.2 (chỉ display) / snug 1.4 / normal 1.55 (body,
  VN-safe) / relaxed 1.7 (đọc dài)

FONT-WEIGHT: 400 / 500 / 600 / 700  (giữ hẹp, đừng thêm weight)

SPACING (grid 4px, CÓ KỶ LUẬT bỏ bậc lẻ):
  1=4 2=8 3=12 4=16 6=24 8=32 12=48 16=64 20=80 24=96
  Hay dùng: space-4 (padding component), space-6 (padding card)

RADIUS: sm 4 / md 8 (nút) / lg 12 (card) / xl 16 (modal) / 2xl 24 / pill 999

MOTION: easing cubic-bezier(0.4,0,0.2,1); duration 150/250/400ms.
  KHÔNG nảy, KHÔNG spring.

WIDTH: --av-width-page 1180px (dashboard/list/grid) /
       --av-width-read 760px (đọc dài 1 cột)
```

---

## D. Voice & nguyên tắc (lấy nguyên từ brief nội bộ — dùng verbatim)

```
3 NGUYÊN TẮC — mọi quyết định hình ảnh phải qua cả 3:
  • HỌC THUẬT — đáng tin, không khô khan
  • THÂN THIỆN — khích lệ, không trẻ con
  • HIỆN ĐẠI  — sạch sẽ, có chỗ thở
(Nếu một chi tiết thấy "sai sai", gọi tên nguyên tắc đang bị vi phạm → thường lộ ra cách sửa.)

QUY TẮC HÌNH ẢNH ĐANG SHIP (đừng đề xuất khác nếu không có lý do):
  • Icon: Lucide, nét 1.5–2px, currentColor. KHÔNG PNG, KHÔNG icon-font,
    KHÔNG SVG vẽ tay.
  • Emoji: không (trừ glyph trạng thái ✓ / △ trong chip từ vựng). Ưu tiên badge.
  • Gradient: 1 gradient chéo navy→teal cho hero marketing/auth là OK.
    Trang app (dashboard) sạch, KHÔNG gradient trang trí.
  • Focus: luôn box-shadow var(--av-shadow-focus), không dùng outline mặc định.
  • Disabled: opacity .5 + pointer-events none. Không xám hoá, không bỏ viền.
  • Card được chọn: border-color var(--av-primary) + shadow-focus (quầng 3px).

GIỌNG & CHỮ:
  • Xưng "bạn" với học viên; AI không xưng "tôi/mình".
  • Sentence case mọi nơi; UPPERCASE chỉ cho eyebrow (≤3 từ) + mã tiêu chí
    IELTS (FC, LR, GRA, P) + access code. Tránh Title Case hoàn toàn.
  • Em-dash — cho câu chèn; dấu … thay cho ...; không dùng "!".
  • Cụ thể hơn chung chung: "Phản hồi sau ~30 giây" > "Nhanh". Số giữ dạng số.
  • Nhãn IELTS song ngữ, tiếng Việt trước: "Từ vựng (LR)", "Ngữ pháp (GRA)".
  • Động viên kiểu thầy cô: "Phát âm /θ/ trong 'think' chưa rõ — thử đặt lưỡi
    giữa hai răng", KHÔNG kiểu "You got this!".
```

---

## E. Thư viện component đang có (đưa từng cái vào, giữ nguyên tên)

```
Foundations: color, type, spacing, radius, shadow, motion
Buttons  (.av-button): primary, secondary, tertiary, destructive, icon, sm, lg
Cards    (.av-card): default, elevated, flat, interactive, locked
Badges   (.av-badge): primary, success, warning, error, neutral, locked,
                      needs-review, used-well
Forms:   .av-input .av-select .av-textarea .av-label .av-help-text .av-error-text
Overlay: .av-modal (+ backdrop/header/body/footer/title)
Nav:     .av-tabs / .av-tab
Feedback:.av-toast ; .av-feedback-card/-band/-criterion (kết quả Speaking+Writing)
Media:   .av-recorder (ghi âm) ; .av-player (phát lại)
Data:    .av-stat-block/-value/-label/-unit (band score, streak)
Đọc/sửa: .av-correction (-original/-corrected/-explanation), .av-sample-answer

CHƯA CÓ — nên thiết kế mới: empty state, loading skeleton, biểu đồ tiến bộ
(band trend), onboarding/kích hoạt access code, trạng thái khoá quyền.
```

---

## F. Vấn đề PHÁT HIỆN KHI INSPECT (nói thẳng cho Claude để nó giúp thống nhất)

```
Hai điểm KHÔNG nhất quán tìm thấy trên web thật — cần thống nhất TRONG đợt này:

1. WORDMARK LỆCH: landing viết "averlearning" (thường, liền); trang app viết
   "Aver.Learning" (hoa A/L, có chấm). → phải chốt MỘT cách viết.

2. FONT HIỂN THỊ LOẠN — có 3 hệ đang chạy song song:
   • --av-* (mới): Plus Jakarta Sans  → landing dùng cái này (headline sans).
   • grammar-wiki.css: DM Sans body + Lora (serif) → nên headline trang Grammar
     ra SERIF, khác hẳn landing.
   • ds.css (legacy): Manrope body + Fraunces (serif display).
   → Đây là hệ quả của migration --ds-* → --av-* còn dở + 1 sub-system grammar
     riêng. PHẢI chốt: font hiển thị (display) chính thức cho toàn hệ là gì?
     (giữ Jakarta cho tất cả? hay cho phép 1 serif display có kiểm soát?)

Nhờ Claude: khi đề xuất type system, phải GIẢI QUYẾT sự loạn này thành 1 quy
tắc display font duy nhất, ánh xạ về --av-font-display, KHÔNG đẻ thêm hệ thứ 4.
```

---

## G. Câu chốt tin nhắn 1 (dán ở cuối, bắt Claude verify hiểu đúng)

```
Trước khi đề xuất BẤT CỨ thay đổi nào: hãy đọc tokens.css + 2 ảnh mình gửi, rồi
TÓM TẮT LẠI bằng lời của bạn:
  (a) hệ màu + font + theme hiện tại,
  (b) 5 ràng buộc bắt buộc ở trên,
  (c) 2 vấn đề không nhất quán mình vừa nêu.
Nếu có chỗ nào trong tokens.css mâu thuẫn với mô tả của mình, chỉ ra. ĐỪNG vẽ
gì cho tới khi mình xác nhận bạn hiểu đúng.
```

---

## H. Đính kèm cần có trong tin nhắn 1
- [ ] `frontend/css/aver-design/tokens.css` — nguyên file
- [ ] `01-landing-hero.jpg` — landing, hero navy→teal + 6 skill card + logo hiện tại
- [ ] `02-grammar-app-light.jpg` — trang app light theme, thấy wordmark "Aver.Learning" + headline serif (bằng chứng cho vấn đề F)
- [ ] (tuỳ chọn) trích §10 "component decision tree" trong `UNIFIED_DESIGN_BRIEF.md` nếu muốn Claude bám sát quy tắc chọn component
