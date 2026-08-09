# Fan page Facebook + Instagram cho Aver Learning — Nghiên cứu & Kế hoạch

**Ngày:** 2026-08-09
**Phạm vi:** dựng fan page Facebook trước (Instagram giai đoạn 2), chia sẻ tài liệu học miễn phí, rồi tự động hoá đăng bài qua Claude.

---

## 0. Kết luận ngắn (đọc cái này trước)

| Câu hỏi | Trả lời |
|---|---|
| Có avatar / ảnh bìa chưa? | **Có rồi**, dùng ngay được — `docs/brand/social-assets/` |
| Có MCP chính chủ của Meta để đăng bài Page không? | **KHÔNG.** MCP chính chủ của Meta chỉ làm **Quảng cáo**, không đăng bài |
| Đăng bài tự động được không? | Được — nhưng **đường Graph API trực tiếp đã bị loại** (xem Quyết định bên dưới) |
| Instagram hẹn giờ được không? | **API Instagram KHÔNG có hẹn giờ.** Phải tự chạy cron đúng giờ |
| Nên làm gì trong tuần này? | Dựng page + đăng tay; tự động hoá đi đường `postiz` |

### Quyết định 2026-08-09 — bỏ đường App Review

Aver Learning **chưa có giấy tờ doanh nghiệp** (giấy phép kinh doanh / mã số thuế). Business Verification của Meta đòi giấy tờ **cấp cho doanh nghiệp** — CCCD, hộ chiếu, hoá đơn cá nhân đều không tính. Không có nó thì **không lấy được Advanced Access `pages_manage_posts`**, nên:

- ❌ **Loại** đường tự viết MCP gọi Graph API trực tiếp (Phương án B cũ). Không phải vì kỹ thuật, mà vì cửa quyền không mở.
- ✅ **Chốt** đường `postiz` — dùng app đã được Meta duyệt sẵn, **không cần App Review lẫn Business Verification**.
- Trong lúc chưa dựng xong: **hẹn giờ bằng Meta Business Suite** (giao diện, không cần API).
- Nếu sau này có ĐKKD → mở lại đường Graph API. Vì vậy §GĐ3 thiết kế **tách lớp publish** để đổi mà không viết lại phần còn lại.

**Điểm nghẽn thật không phải API — mà là nội dung.** Bạn đã có ~157 bài ngữ pháp, 3015 câu quiz, ~1000 thẻ từ vựng, 30 bài Listening, 36 đề Cambridge Reading. Đó là mỏ nội dung 6 tháng đăng bài. Phần đáng đầu tư là **đường ống biến nội dung repo → bài đăng**, còn lớp "đẩy lên Facebook" chỉ là cái đuôi, thay được.

---

## 1. Nghiên cứu: đăng bài tự động lên Facebook/Instagram (tình hình 08/2026)

### 1.1 MCP chính chủ của Meta — không dùng được cho việc này
Meta mở **Meta Ads AI Connectors** (open beta 29/04/2026) tại `mcp.facebook.com/ads`, 29 tool, đăng nhập bằng Meta Business OAuth, miễn phí trong beta. Nhưng phạm vi là **quảng cáo**: báo cáo, quản lý campaign, catalog, chẩn đoán signal. **Không có tool đăng bài Page.**

→ Muốn đăng bài, buộc phải đi qua **Graph API** (tự làm hoặc qua bên thứ ba).

### 1.2 Ba đường đi, so sánh thẳng

| | **A. Bên thứ ba (Postiz / Buffer)** | **B. Tự viết MCP trên Graph API** | **C. Đăng tay** |
|---|---|---|---|
| Thời gian tới bài đầu tiên | 1–2 ngày | **2–6 tuần** (chờ App Review) | Ngay |
| App Review Meta | **Không cần** (dùng app đã duyệt của họ) | **Cần** `pages_manage_posts` Advanced Access + xác minh pháp nhân | Không |
| Instagram | Có, họ tự lo phần hẹn giờ | Phải **tự chạy cron** | Có |
| Ghép với nội dung repo | Rời rạc — phải xuất ra rồi upload | **Khớp hẳn** — đọc thẳng `backend/content/` | Thủ công |
| Rủi ro | Phụ thuộc bên thứ ba, giới hạn theo gói | Tự chịu rate limit, token hết hạn | Tốn giờ người |
| Chi phí | Free tier có (Buffer), Postiz self-host free | $0 nhưng tốn công | $0 |

> **Đã chốt:** đi **A**, loại **B** — xem Quyết định 2026-08-09 ở §0. Bảng này giữ nguyên làm hồ sơ nghiên cứu, và để mở lại đường B nếu sau này có ĐKKD.

**Đáng chú ý:** marketplace plugin chính thức của Claude **đã có sẵn plugin `postiz`** (v2.0.12, self-host được, 28+ nền tảng gồm Instagram). Đây là đường A gần như bấm-là-chạy, không phải tự tích hợp gì.

### 1.3 Ràng buộc kỹ thuật phải biết trước (đừng thiết kế xong mới phát hiện)

**Facebook Page:**
- Hẹn giờ **có sẵn trong API**: `published=false` + `scheduled_publish_time` (UNIX timestamp).
- Cửa sổ hẹn giờ: **tối thiểu ~10 phút, tối đa ~29–30 ngày**. Không hẹn được 3 tháng.
- Quyền cần: `pages_manage_posts` (tạo/hẹn bài) + `pages_read_engagement`.
- Advanced Access ⇒ **App Review 2–6 tuần, nên tính trước ít nhất 1 lần bị từ chối**, cộng **Business Verification** (giấy tờ pháp nhân + xác minh domain, có khi Meta gọi điện).

**Instagram:**
- **Không có hẹn giờ.** API chỉ đăng-ngay ⇒ lịch đăng phải do **scheduler của mình** giữ, gọi API đúng giờ.
- Điều kiện tài khoản: IG **Professional** + **liên kết một Facebook Page** + app developer + quyền `instagram_content_publish` (+ `instagram_basic`, `pages_read_engagement`).
- Giới hạn: **100 bài/24h trượt** mỗi tài khoản.
- Carousel: **tối đa 10** ảnh/video; **mọi ảnh bị crop theo tấm đầu** (mặc định 1:1) → tấm bìa phải đúng tỉ lệ ngay từ đầu.
- **Ảnh phải nằm ở URL public** lúc gọi API (Meta tự cURL về). Không upload bytes trực tiếp.
  → *Việc này bạn đã có hạ tầng:* Supabase Storage bucket public (`audio-responses` đang public sẵn), thêm một bucket `social-media` là xong.

---

## 2. Bio — bản viết sẵn để dán vào

> **Lưu ý về yêu cầu "nạp skill natural language":** không có skill nào tên như vậy trong máy bạn lẫn trong marketplace chính thức (đã quét cả `~/.claude/skills` và catalog plugin). Thứ gần nhất là `frontend-design` (chỉ về thị giác) và `postiz` (đăng bài). Nên mình viết bio trực tiếp theo giọng brand đã chốt trong `docs/brand/` — nếu bạn nhớ tên skill cụ thể (hoặc là plugin nào đó), nói tên chính xác mình cài thêm.

Giọng brand đã chốt: **teal + amber, "Mũi lên" = tiến bộ / lên band**, wordmark **"Aver Learning"** (sentence-case). Không dùng `averlearning` liền hay `Aver.Learning`.

### 2.1 Facebook Page

**Tên page:** `Aver Learning`
*(Đừng nhồi keyword kiểu "Aver Learning - Luyện IELTS Online Uy Tín #1". Tên gọn dễ nhớ, keyword để dành cho phần Bio và Category — Facebook vẫn index được.)*

**Username:** `@averlearning` → `facebook.com/averlearning`
**Category:** `Educational Website` (chính) + `Education` (phụ)
**Website:** `https://averlearning.com`
**Nút CTA:** `Learn more` → `https://averlearning.com`

**Bio ngắn (≤255 ký tự) — 3 phương án:**

**A. Trực tiếp, ưu tiên "miễn phí" (khuyến nghị)**
```
Tài liệu luyện IELTS miễn phí: ngữ pháp, từ vựng, đề Reading & Listening có đáp án.
Đăng đều mỗi tuần, tải về dùng ngay — không cần đăng ký.
Luyện trực tiếp có AI chấm: averlearning.com
```

**B. Nhấn vào cái đau của người học**
```
Học IELTS mà không biết mình sai ở đâu là học phí thời gian.
Ở đây mình mổ từng lỗi ngữ pháp, từng câu Speaking — kèm tài liệu tải free.
Chấm bài bằng AI tại averlearning.com
```

**C. Ngắn gọn, cho người đọc nhanh**
```
Ngữ pháp · Từ vựng · Reading · Listening — tài liệu IELTS miễn phí, đăng hằng tuần.
Luyện và được AI chấm: averlearning.com
```

→ **Chọn A.** Nó nói rõ *cho gì* (4 kỹ năng), *bao lâu một lần* (mỗi tuần), *rào cản* (không cần đăng ký) — ba thứ quyết định người ta bấm Follow.

**Phần "Giới thiệu" đầy đủ (About / Additional info):**
```
Aver Learning là nền tảng luyện thi IELTS toàn diện — Speaking, Writing, Reading,
Listening — với AI chấm bài và chỉ ra lỗi cụ thể, không chấm chung chung.

Trên trang này mình đăng miễn phí:
· Bài ngữ pháp mổ theo lỗi người Việt hay sai (hơn 150 bài trong thư viện)
· Từ vựng theo chủ đề IELTS, kèm phát âm
· Đề Reading & Listening có đáp án và lời giải từng câu
· Mẹo Speaking Part 1–2–3, kèm câu mẫu

Muốn được chấm bài và theo dõi tiến độ: averlearning.com
```

### 2.2 Instagram (giai đoạn 2)

**Trường "Name" (30 ký tự, Instagram có index để tìm kiếm — đừng để trống keyword):**
```
Aver Learning · IELTS
```

**Bio (≤150 ký tự) — 2 phương án:**

**A. (khuyến nghị)**
```
Tài liệu IELTS miễn phí mỗi tuần 📚
Ngữ pháp · Từ vựng · Reading · Listening
Luyện có AI chấm 👇
```

**B.**
```
Mỗi ngày 1 lỗi ngữ pháp người Việt hay sai ✍️
Tài liệu IELTS free · AI chấm bài
Link dưới 👇
```

**Link:** `averlearning.com` (nếu sau này cần nhiều link thì mới dựng trang `/links` trên chính domain mình — đừng dùng Linktree, mất traffic và mất SEO).

---

## 3. Avatar & ảnh bìa — đã có, dùng luôn

Folder: `docs/brand/social-assets/` (**đã mở trong Finder**)
Bảng thiết kế xem trước: `docs/brand/social-kit.html` + `docs/brand/brand-sheet.html` (**đã mở trong browser**)

| Việc | File dùng |
|---|---|
| Avatar Facebook Page | `avatar-teal-1080.png` |
| Ảnh bìa Facebook Page | `cover-facebook-1640x624.png` |
| Avatar Instagram | `avatar-teal-1080.png` (dùng lại — nhất quán nhận diện) |
| Ảnh OG khi share link | `hero-1920x1080.png` |

**Template có sẵn cho nội dung đăng đều:**
- Feed 1:1 — `post-tip-1080` (mẹo ngữ pháp), `post-band-1080` (kết quả band), `post-testimonial-1080`
- Story/Reel 9:16 — `story-tip`, `story-vocab`, `story-testimonial`
- Carousel 4 tấm — `carousel-1-cover` → `carousel-4-cta`

**Hai cảnh báo từ README của bộ asset:**
1. PNG hiện render bằng **font hệ thống** vì máy chưa cài Plus Jakarta Sans. Sạch nhưng chưa đúng nét brand. → Cài Plus Jakarta Sans rồi xuất lại từ `.svg`, hoặc mở `.svg` trong Figma/Canva.
2. Bộ asset này nằm ở nhánh `design/brand-redesign-2026-07-24`, **chưa áp vào web production** (nợ `DEBT-2026-07-24-I`). Dùng cho social thì không sao — nhưng **sẽ lệch nhận diện giữa fan page (logo mới) và web (logo cũ)**. Cân nhắc đẩy logo mới lên web trước khi chạy page mạnh, không thì người từ page click vào web sẽ thấy hai bộ mặt khác nhau.

---

## 4. Kế hoạch triển khai

### Giai đoạn 1 — Dựng page (tuần này, làm tay)
1. Tạo **Meta Business Portfolio TRƯỚC**, rồi tạo Page bên trong nó. Làm ngược (tạo page cá nhân rồi chuyển) phát sinh thêm bước xác nhận quyền sở hữu.
2. Page `Aver Learning`, category `Educational Website`, username `@averlearning`.
3. Upload `avatar-teal-1080.png` + `cover-facebook-1640x624.png`, dán Bio phương án A + phần Giới thiệu.
4. Website + nút CTA `Learn more` → `https://averlearning.com`.
5. Đăng 5–7 bài "vốn mồi" trước khi mời ai follow (page trống thì người ta không follow).
6. **Không** làm Business Verification — đã loại theo Quyết định 2026-08-09.

### Giai đoạn 2 — Tự động hoá không cần App Review
7. **Hẹn giờ bằng Meta Business Suite** ngay từ tuần đầu — lịch đăng chạy đều mà không chờ gì cả.
8. Cài plugin `postiz` (marketplace chính thức của Claude, self-host được) làm lớp đăng tự động cho cả Facebook lẫn Instagram.
9. Không tạo Meta app, không nộp App Review.

### Giai đoạn 3 — Đường ống nội dung (phần đáng đầu tư nhất)
Đây là chỗ khác biệt so với mọi fan page khác: **nội dung sinh từ repo, không viết tay lại.**

```
backend/content/*.md  ─┐
grammar_quiz banks     ├─→  sinh bài đăng (Claude)  ─→  đổ vào SVG template
vocab_cards            │         + caption            ─→  xuất PNG
listening/reading      ─┘                             ─→  upload Supabase Storage (public)
                                                       ─→  hàng đợi bài đăng (bảng mới)
                                                       ─→  đăng / hẹn giờ
```

Cấu phần cần dựng:
- **Migration** `social_posts` — nội dung, ảnh, nền tảng, `scheduled_at`, `status`, `platform_post_id`, `error`. Có bảng này thì lỗi đăng **không im lặng** (đúng chuẩn chất lượng của dự án).
- **Service** `backend/services/social_publisher.py` — **tách lớp publish sau một interface**: `postiz` là bản dựng hôm nay, `graph_api` là bản để ngỏ cho ngày có ĐKKD. Phần sinh nội dung + hàng đợi + duyệt bài **không được biết** mình đang đăng qua đường nào.
- **Trang admin** — xem hàng đợi, sửa caption, duyệt trước khi đăng. **Không đăng thẳng không qua mắt người**, vì nội dung sai lên fan page là mất uy tín, khó thu hồi.
- **Cron** — trigger scheduler (Vercel Cron hoặc Railway).
- **MCP server** (`build-mcp-server` skill có sẵn trong marketplace) — để bạn nói với Claude "tuần này đăng 3 bài về thì hiện tại hoàn thành" là nó tự soạn + xếp lịch.

### Giai đoạn 4 — Instagram
9. Chuyển IG sang Professional, liên kết Facebook Page.
10. Xin `instagram_content_publish`. Tái dùng scheduler ở GĐ 3 — chỉ khác lớp gọi API.

---

## 5. Lịch nội dung đề xuất (đủ 6 tháng từ nội dung sẵn có)

| Thứ | Dạng | Nguồn trong repo | Template |
|---|---|---|---|
| Thứ 2 | Mẹo ngữ pháp | `backend/content/error-clinic/` (19 bài) | `post-tip-1080` |
| Thứ 3 | Từ vựng chủ đề | `vocab_cards` (curated) | `story-vocab` |
| Thứ 4 | Câu hỏi quiz (cho tương tác) | `grammar_quiz` banks (3015 câu) | `post-tip-1080` |
| Thứ 5 | Mẹo Speaking | `speaking_lessons` | `carousel` 4 tấm |
| Thứ 6 | Tài liệu tải free | đề Reading/Listening có đáp án | `post-band-1080` |

**Bài "cho không" mạnh nhất để kéo follow:** đề Cambridge Reading/Listening **kèm lời giải từng câu** — hiếm page nào cho lời giải, đa số chỉ cho đáp án. Bạn đã có 1440/1440 câu Reading có Locate + lời giải. Đó là thứ đáng đem ra làm mặt tiền.

**Cẩn thận bản quyền:** đề Cambridge là tài liệu có bản quyền. Đăng công khai nguyên văn đề lên Facebook rủi ro hơn nhiều so với để sau đăng nhập trên web. → Trên fan page nên đăng **lời giải + phương pháp làm dạng câu**, còn đề thì dẫn về web. Vừa an toàn, vừa kéo được traffic.

---

## 6. Việc cần bạn tự làm (mình không làm thay được)

| Việc | Vì sao cần bạn |
|---|---|
| Tạo Business Portfolio + Page, upload ảnh, dán bio | Cần đăng nhập tài khoản cá nhân của bạn |
| Nối tài khoản Facebook/Instagram vào `postiz` | Bước OAuth, cần bạn bấm cho phép |
| Quyết định tên page / username cuối cùng | Quyết định thương hiệu |

~~Business Verification~~ và ~~App Review~~ đã loại theo Quyết định 2026-08-09.

Mình làm được: sinh nội dung bài đăng từ repo, xuất PNG từ template, viết migration + service + trang admin + MCP server, dựng cron.

---

## Nguồn

- [Publish Content using the Instagram Platform — Meta Developer Documentation](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Meta Official MCP — What It Does and How to Install](https://www.get-ryze.ai/blog/meta-official-mcp-what-it-does-and-how-to-install)
- [Meta Ads MCP: Meta's Official Server, 29 Tools](https://www.usecarly.com/blog/meta-ads-mcp/)
- [Facebook Page API Permissions App Review (2026 Guide)](https://singhamandeep.com/facebook-page-api-permissions-app-review/)
- [Facebook API Pricing: Full Breakdown for 2026 — Blotato](https://www.blotato.com/blog/facebook-api-pricing)
- [Schedule Facebook Posts via API: Graph API v24 Guide 2026 — Zernio](https://zernio.com/blog/schedule-facebook-posts-via-api)
- [How to Schedule Facebook Posts with an API (2026 Guide)](https://posteverywhere.ai/blog/post-to-facebook-api)
- [Best Social Media MCP Servers in 2026 — Socialync](https://www.socialync.io/blog/best-social-media-mcp-servers-2026)
- [Postiz agent](https://postiz.com/agent) · [HagaiHen/facebook-mcp-server](https://github.com/HagaiHen/facebook-mcp-server)
