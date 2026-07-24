# Thiết kế lại thương hiệu Aver Learning + làm việc với Claude Design

> Tài liệu tư vấn — soạn 2026-07-24. Bối cảnh: chạy **sau** khi soak Pilot 1 xong + migrate Next.js hoàn tất, chạy **song song** giữa web và fan page.

---

## 0. Claude Design là gì — có, mình biết

Claude Design (trên **claude.ai/design**) là một loại **project "design system"** — khác hẳn Artifact dùng-một-lần. Cụ thể, theo đúng cơ chế công cụ mình thấy được trong môi trường này (`DesignSync` + skill `/design-sync` + `/design-login`):

- Mỗi project có `type = PROJECT_TYPE_DESIGN_SYSTEM`, **cố định lúc tạo** (project thường không biến thành design system được — phải tạo đúng loại từ đầu).
- Nội dung là các **file HTML preview**, mỗi file mở đầu bằng marker `<!-- @dsCard group="…" -->`. Mỗi preview thành một **card** trong "Design System pane" — đó là thư viện component sống, xem được, có phiên bản.
- **Đồng bộ 2 chiều với repo** qua skill `/design-sync`: đọc project (`list_files`/`get_file`), chốt kế hoạch ghi (`finalize_plan`), rồi ghi/xoá **từng component một** — *không bao giờ* thay thế hàng loạt. Đây là ràng buộc do chính công cụ đặt ra, và nó rất hợp với dự án mình (xem mục 3).
- Đưa design vào code: qua `/design-sync`, hoặc trên Vercel qua `import-claude-design-from-url`.

**Điểm mình phải nói thẳng:** đây là tính năng đang phát triển nhanh, mình mô tả theo cơ chế công cụ đang có trong phiên này. Tên nút/luồng UI chính xác trên claude.ai anh nên tự xác nhận lại khi bắt đầu — đừng coi mô tả này là tài liệu chính thức của sản phẩm.

**Hệ quả quan trọng cho cách dùng:** Claude Design mạnh nhất khi coi nó là **nguồn chân lý cho component + brand foundation**, rồi *sync xuống* code — chứ không phải chỗ vẽ vời một lần rồi bỏ. Nó hợp với việc mình cần: một bộ nhận diện + component library dùng chung cho cả web lẫn fan page.

---

## 1. Hiện trạng (inspect averlearning.com)

### Bộ nhận diện đang chạy
| Hạng mục | Hiện tại | Đánh giá |
|---|---|---|
| **Logo** | Nút play (▶) trong hình tròn teal + wordmark thường `averlearning` | **Generic** — play-button-in-circle là mô-típ đụng hàng nhất; không nói lên "học tiếng Anh / IELTS" |
| **Màu chính** | Teal `#0F766E` (teal-700) | Tốt, có bản sắc, ít đụng hàng IELTS (thị trường VN đa số xanh dương/đỏ) |
| **Màu nhấn** | Amber `#F59E0B` | Ấm, hợp "động viên" — giữ |
| **Font** | Plus Jakarta Sans (chữ) + JetBrains Mono (số) | Đã chọn có chủ đích, render tiếng Việt tốt, không phải Inter/Roboto — giữ |
| **Nền** | Off-white ấm `#FAFAF9` (light) / navy sâu `#0A1628` (dark) | Có gu "tạp chí", không lâm sàng — giữ |

### Design system đã có (đây là tài sản, KHÔNG phải bắt đầu từ số 0)
Dự án đã có một design system trưởng thành, đừng vứt đi:
- **Token namespace `--av-*`**: type scale (9 bậc), spacing (4px base, có kỷ luật bỏ bậc lẻ), radius, motion, z-index, shadow — light + dark song song. File: `frontend/css/aver-design/tokens.css`.
- **Component library ~40 class** trong `components.css`: `av-button` (6 biến thể), `av-card` (5), `av-badge` (9), `av-input/select/textarea`, `av-modal`, `av-tabs`, `av-toast`, `av-feedback-*`, `av-recorder`, `av-player`, `av-stat-*`.
- **Bảng màu theo từng kỹ năng**: speaking=amber, writing=teal, reading=sky `#0EA5E9`, listening=violet `#8B5CF6`, grammar=indigo `#4F46E5`, vocab=jade `#0B6E59`.
- **An toàn dấu tiếng Việt**: line-height mặc định 1.55 (cao hơn Latin ~10% để dấu không đụng nét thòng).
- **Tài liệu**: `DESIGN_SYSTEM.md` (128KB) + `UNIFIED_DESIGN_BRIEF.md` (57KB) — đã có voice/copy rules, decision trees, anti-patterns.

### Kết luận inspect
Đây **không phải** "thiết kế lại từ đầu" mà là **hai việc khác nhau**, phải tách bạch:
1. **Nâng cấp bộ nhận diện** (logo, wordmark, ngôn ngữ hình ảnh, minh hoạ, kit social) — phần này đang yếu/thiếu.
2. **Chính thức hoá design system đã có thành một Claude Design project** — phần này đã mạnh, chỉ cần đưa vào công cụ để quản lý + đồng bộ.

⚠️ **Rủi ro lớn nhất phải phòng từ đầu:** nếu để Claude Design tự đẻ ra một token namespace/màu/scale **mới hoàn toàn**, nó sẽ đá nhau với 40+ component + bộ contract test đang pin giá trị + bản migrate Next.js vừa xong. Thành hai mặt trận. → Xem quyết định #1 và #3.

---

## 2. Những gì cần được thiết kế

### Nhóm A — Brand identity (phần thiếu nhất)
- [ ] **Logo**: bản chính (mark + wordmark), bản chỉ-mark (favicon/app icon/avatar social), bản 1 màu (mono, để in/khắc), bản đảo màu (trên nền tối).
- [ ] **Wordmark**: chốt cách viết tên (xem quyết định #2).
- [ ] **Ngôn ngữ biểu tượng (iconography)**: hiện đang dùng lucide + emoji lẫn lộn cho 6 kỹ năng → cần bộ icon nhất quán cho 6 kỹ năng.
- [ ] **Ngôn ngữ minh hoạ / hình khối**: hero, empty state, minh hoạ bài học — hiện chưa có phong cách thống nhất.
- [ ] **Bảng màu chính thức**: quyết định giữ hay tiến hoá teal/amber (quyết định #1).
- [ ] **Ngôn ngữ chuyển động (motion)**: đã có token duration/easing, cần chốt "cá tính" motion (nảy nhẹ ở đâu, mượt ở đâu).

### Nhóm B — Component library (chính thức hoá cái đã có)
Đưa từng cái vào Claude Design dưới dạng preview card, giữ nguyên contract `--av-*`:
- [ ] Foundations: color, type, spacing, radius, shadow, motion (mỗi cái 1 card)
- [ ] Buttons (6), Cards (5), Badges (9)
- [ ] Forms: input, select, textarea, label, help/error text
- [ ] Modal, Tabs, Toast
- [ ] Feedback panel (kết quả Speaking + Writing) — đây là "chữ ký" của sản phẩm, ưu tiên
- [ ] Recorder + Audio player
- [ ] Stat blocks (band score, streak)
- [ ] Nav/chrome (top-nav, secondary nav, skill cards trên landing)
- **Còn thiếu, nên thiết kế mới:** empty states, loading skeleton, biểu đồ tiến bộ (band trend — hiện dự án chưa có), onboarding/kích hoạt access code, trạng thái khoá quyền.

### Nhóm C — Fan page / social kit (song song với web)
Phải **dùng lại đúng** token brand ở Nhóm A để web ↔ social đồng bộ:
- [ ] Avatar + ảnh bìa (Facebook, Instagram, TikTok, YouTube — mỗi nền tảng 1 tỉ lệ)
- [ ] Template bài đăng: mẹo ngữ pháp, "band score thật của học viên", trích dẫn/lời chứng thực, từ vựng theo chủ đề
- [ ] Template story/reel (dọc 9:16)
- [ ] Thumbnail YouTube
- [ ] Khung nhất quán: vị trí logo, vùng an toàn, font hiển thị trên ảnh (Plus Jakarta Sans phải đọc được ở cỡ nhỏ trên mobile)

---

## 3. Những vấn đề PHẢI thống nhất trước (để mọi thứ theo chuẩn)

Đây là phần quan trọng nhất — quyết sai ở đây thì càng làm càng lệch.

| # | Quyết định | Khuyến nghị của mình | Vì sao |
|---|---|---|---|
| **1** | **Tiến hoá hay đập đi xây lại?** Giữ teal/amber/Jakarta hay thay mới? | **Tiến hoá (evolve)**, không rebrand toàn diện | Đã có brand equity (68+ học viên, fan page sẽ xây tiếp), teal ít đụng hàng trong thị trường IELTS VN, và quan trọng nhất: giữ màu/scale = không phá 40+ component + migrate Next vừa xong. Đổi *logo* thì được; đổi *cả hệ màu* thì thành 2 mặt trận. |
| **2** | **Tên & cách viết**: `averlearning` / `Aver Learning` / `Aver`? | Chốt 1 dạng, dùng nhất quán mọi nơi | Logo thường viết `averlearning` liền, nhưng domain, title, social có thể lệch. Quyết luôn: wordmark viết sao, có tách chữ không, có tách "Aver" làm brand ngắn không. |
| **3** | **Namespace của design system**: Claude Design sinh token tên gì? | **Bắt buộc giữ `--av-*`** | Code, test, và cả 3 layout Next đang đọc `--av-*`. Nếu Claude Design đẻ ra `--color-primary` kiểu mới → phải map thủ công, dễ lệch. Ép Claude Design *xuất ra đúng `--av-*`* ngay từ prompt. |
| **4** | **Nguồn chân lý (single source of truth)** là Claude Design hay `tokens.css`? | Sau khi chính thức hoá: **Claude Design là nguồn, `tokens.css` là bản sync xuống** | Tránh cảnh sửa 2 nơi. Nhưng luồng phải một chiều rõ ràng (design→code), và sync **từng phần** đúng như `/design-sync` ép. |
| **5** | **Web-first hay social-first?** | **Web-first**: chốt brand foundation trên web trước, social kế thừa | Web là nơi có nhiều ràng buộc kỹ thuật nhất (token, a11y, VN type). Social linh hoạt hơn, kế thừa xuống dễ; làm ngược lại thì social đẹp nhưng không khớp code. |
| **6** | **Đối tượng & tone** | Học viên VN luyện IELTS; giọng "**thầy cô ấm áp, không phải cổ động viên**" | Đã ghi trong `UNIFIED_DESIGN_BRIEF.md` §6.9 — giữ nguyên, đừng để bộ nhận diện mới lệch sang tông "hô khẩu hiệu". |
| **7** | **Thời điểm** | Chỉ bắt đầu **sau** khi Next migrate xong (như anh đã định) | Đang migrate mà đổi brand = component vừa build đã lỗi thời. Đúng thứ tự anh đặt ra rồi. |
| **8** | **Định dạng bàn giao** | Token dạng CSS custom properties + component HTML tĩnh, self-contained | Phải khớp cách Next consume (layout nạp `tokens.css` + `components.css` bằng URL). Nếu bàn giao dạng Figma-only hoặc token JSON lạ thì phải viết bước chuyển đổi. |
| **9** | **Accessibility** | WCAG AA cho cả 2 theme + an toàn dấu tiếng Việt + parity light/dark | Đã là chuẩn của dự án; brand mới phải vượt qua, nhất là contrast của màu teal mới trên nền tối. |
| **10** | **Bản quyền font** | Nếu đổi font hiển thị (display) cho logo/social, kiểm license | Plus Jakarta Sans là OFL (miễn phí, thương mại OK). Font mới cho tiêu đề phải check quyền dùng thương mại + có glyph tiếng Việt đầy đủ (dấu). |

**Chốt tối thiểu trước khi mở Claude Design:** #1 (evolve), #2 (tên), #3 (giữ `--av-*`). Ba cái này mà chưa rõ thì đừng bắt đầu.

---

## 4. Hướng dẫn làm việc với Claude Design

### 4.1 Setup ban đầu
1. Đăng nhập **claude.ai**. Nếu phiên Claude Code báo cần quyền design, chạy `/design-login` (cấp scope design-system cho login).
2. Tạo project design system: hoặc trên UI claude.ai/design, hoặc để mình gọi `DesignSync create_project` với tên (ví dụ `aver-design-system`). **Nhớ: phải là loại design system ngay từ đầu.**
3. **Nạp bối cảnh brand hiện tại** làm đầu vào — đây là bước quyết định chất lượng. Chuẩn bị sẵn:
   - `frontend/css/aver-design/tokens.css` (toàn bộ token)
   - 3–4 screenshot: landing (light + dark), một trang kết quả Speaking, một bài Grammar
   - Trích `UNIFIED_DESIGN_BRIEF.md` §6 (voice) + §7 (3 nguyên tắc) + §10 (decision tree)
4. Cấu trúc thư mục project đề xuất:
   ```
   foundations/   → color.html, type.html, spacing.html, motion.html   (mỗi file 1 @dsCard)
   brand/         → logo.html, wordmark.html, iconography.html
   components/    → button.html, card.html, badge.html, feedback-panel.html, …
   social/        → post-tip.html, post-band.html, story.html, cover-fb.html, …
   ```
   Mỗi file preview mở đầu bằng `<!-- @dsCard group="Foundations" -->` (đổi group tương ứng).

### 4.2 Luồng làm việc theo giai đoạn (đừng làm tất cả một lúc)
- **Giai đoạn 1 — Brand foundation**: logo → wordmark → chốt/tiến hoá màu → type. Xong mới đi tiếp.
- **Giai đoạn 2 — Component library**: đưa từng component `--av-*` vào, bắt đầu từ foundations rồi tới feedback-panel (chữ ký sản phẩm).
- **Giai đoạn 3 — Sync về repo**: dùng `/design-sync`, ghi **từng component một**, chạy contract test sau mỗi lần.
- **Giai đoạn 4 — Social kit**: kế thừa foundation ở Giai đoạn 1.

### 4.3 Bộ prompt mẫu (copy-paste, chỉnh theo ý)

**Prompt 0 — Nạp bối cảnh (chạy đầu tiên, dán kèm tokens.css + screenshot):**
```
Đây là design system hiện có của Aver Learning — một nền tảng luyện IELTS cho
học viên Việt Nam. Mình đang CHÍNH THỨC HOÁ nó thành design system + NÂNG CẤP
bộ nhận diện, KHÔNG làm lại từ đầu.

Ràng buộc bắt buộc, không được vi phạm:
- Giữ nguyên namespace token `--av-*` (code + test đang phụ thuộc).
- Giữ hệ màu teal (#0F766E) + amber (#F59E0B) làm nền tảng; chỉ được TINH CHỈNH,
  không thay hệ màu.
- Font chữ Plus Jakarta Sans, số JetBrains Mono.
- Phải hỗ trợ cả light theme (nền off-white #FAFAF9) lẫn dark (#0A1628).
- An toàn dấu tiếng Việt: line-height ≥ 1.55 cho body; mọi glyph tiếng Việt
  phải render đủ dấu.
- Giọng thương hiệu: thầy cô ấm áp, không hô khẩu hiệu.

Hãy đọc tokens.css và screenshot mình gửi, rồi TÓM TẮT LẠI hệ thống hiện tại
bằng lời của bạn để mình xác nhận bạn hiểu đúng, TRƯỚC KHI đề xuất bất cứ thay đổi nào.
```

**Prompt 1 — Logo:**
```
Thiết kế logo mới cho Aver Learning. Bỏ mô-típ play-button-in-circle hiện tại
(quá generic). Yêu cầu:
- Gợi được "học tiếng Anh / tiến bộ / IELTS" nhưng KHÔNG dùng cliché (sách mở,
  bút, mũ tốt nghiệp, quả địa cầu).
- Dùng teal #0F766E là màu chính, amber làm điểm nhấn tối giản.
- Cần 4 bản: (1) mark + wordmark ngang, (2) chỉ mark (vuông, cho favicon/avatar),
  (3) 1 màu đen, (4) đảo màu cho nền tối.
- Wordmark: [ĐIỀN quyết định #2 — ví dụ "averlearning" viết liền, thường].
- Xuất SVG inline, self-contained.
Đưa mình 3 hướng KHÁC NHAU về ý tưởng, mỗi hướng kèm 1 dòng giải thích lý do.
```

**Prompt 2 — Tinh chỉnh hệ màu (evolve, không thay):**
```
Từ hệ màu teal/amber hiện tại, hãy đề xuất bản TINH CHỈNH (không thay hệ):
- Giữ #0F766E làm brand teal canonical.
- Rà lại contrast WCAG AA cho CẢ light lẫn dark, chỉ đích danh cặp nào đang
  chưa đạt.
- Giữ nguyên bảng màu theo kỹ năng (reading=sky, listening=violet,
  grammar=indigo, vocab=jade, speaking=amber, writing=teal) — chỉ chỉnh nếu
  có cặp nào đá nhau về sắc độ.
- Xuất ra dưới dạng CSS custom properties ĐÚNG tên `--av-*` như file gốc, để
  mình diff trực tiếp với tokens.css.
```

**Prompt 3 — Component theo token (ví dụ button):**
```
Dựng preview cho hệ nút, dùng ĐÚNG các biến `--av-*` (không hardcode màu/px).
- 6 biến thể: primary, secondary, tertiary, destructive, icon, + size sm/lg.
- Preview cả light lẫn dark trong cùng file.
- Trạng thái: default / hover / active / focus (focus ring dùng --av-shadow-focus)
  / disabled.
- File tự chứa (inline CSS), dòng đầu có: <!-- @dsCard group="Components" -->
- Nhãn nút bằng tiếng Việt để kiểm tra dấu.
```

**Prompt 4 — Template social (kế thừa brand):**
```
Thiết kế template bài đăng "mẹo ngữ pháp hằng ngày" cho fan page, dùng ĐÚNG
brand vừa chốt (logo, teal/amber, Plus Jakarta Sans).
- Kích thước: vuông 1080×1080 (feed) + dọc 1080×1920 (story).
- Vùng: logo góc, tiêu đề mẹo, 1 ví dụ đúng/sai, CTA nhẹ.
- Chữ phải đọc được trên màn mobile nhỏ; tương phản đạt AA.
- Để chừa "vùng an toàn" cho UI của từng nền tảng (nút, caption).
Xuất HTML/CSS tự chứa để mình render ra ảnh.
```

**Prompt 5 — Guardrail khi sync về code (dùng với /design-sync):**
```
Chuẩn bị sync các component này về repo qua /design-sync.
QUY TẮC:
- Sync TỪNG component một, không thay thế hàng loạt.
- Tuyệt đối không đổi tên token; giữ nguyên `--av-*`.
- Sau MỖI component, dừng lại để mình chạy contract test
  (node --test frontend/tests/) trước khi đi tiếp.
- Nếu một component bắt buộc phải đổi giá trị token đang bị test pin, DỪNG và
  báo mình — không tự sửa test cho xanh.
```

### 4.4 Rào chắn khi đưa vào code (quan trọng, để không phá thứ đang chạy)
- **Không** để design mới tạo namespace token khác — mọi thứ vẫn là `--av-*`.
- **Sync từng phần**, không "replace toàn bộ" — đây vừa là quy tắc của `/design-sync`, vừa là cách duy nhất giữ 40+ component không vỡ cùng lúc.
- Sau mỗi lần sync, chạy `node --test` (frontend) — bộ contract test pin nhiều giá trị token/snapshot; đỏ thì **sửa code/design, không sửa test** (đúng luật DoD của dự án).
- Nếu Tailwind build bị ảnh hưởng: nhớ rebuild `css/tailwind.build.css` sau khi đổi token, kẻo CI đỏ.
- Giữ đúng luật VN typography (line-height, glyph dấu) — dễ bị bỏ quên khi component đến từ nguồn ngoài.

---

## 5. Việc mình có thể làm ngay khi anh bật đèn xanh
1. Gọi `DesignSync list_projects` xem anh đã có project design nào chưa, hoặc `create_project` tạo `aver-design-system`.
2. Đóng gói "brand context pack" (tokens + screenshot + trích brief) thành 1 bундle để dán vào Prompt 0.
3. Dựng khung thư mục project + vài preview card foundation đầu tiên (color/type/spacing) từ `tokens.css` hiện có, để anh có điểm khởi đầu thay vì trang trắng.

> Nhắc lại thứ tự: chốt quyết định #1/#2/#3 ở mục 3 trước → rồi mới Prompt 0. Và tất cả việc này chỉ khởi động sau khi soak + migrate Next xong.
