# Báo cáo tổng hợp: Cân nhắc migration Frontend — Astro vs Next.js

**Dự án:** IELTS Speaking Coach (averlearning.com) · **Ngày:** 2026-07-11 · **Trạng thái:** Đề xuất, chưa quyết định

---

## 1. Hiện trạng (số liệu đã khảo sát trực tiếp trên repo)

| Hạng mục | Số liệu |
|---|---|
| Trang HTML | 123 trang (~38k dòng) |
| File JS | 114 file (~37k dòng), chủ yếu IIFE + `window.*` globals |
| Inline script trong HTML | ~12.700 dòng (riêng speaking.html ~1.700 dòng) |
| Test | 211 file string-matching (~44k dòng, `node --test`) + 6 spec Playwright e2e |
| Kiến trúc | Zero-dependency có chủ đích; JSDoc `@ts-check` pilot; design tokens `--av-*` |
| Hạ tầng | Vercel (static) + FastAPI/Railway (JSON API, pipeline AI bằng Python — không di chuyển) |
| Giai đoạn | Production, 50–100 users, đang pivot sang nền tảng 4 kỹ năng |

**Pain points đã xác nhận:** (1) 44k dòng test string-matching — brittle, pin markup theo text, không có tầng component test; (2) 12.7k dòng inline script — không typecheck, không test được, XSS phụ thuộc kỷ luật thủ công (đã từng dính bug `?q=` ở grammar.js); (3) boilerplate chrome/auth copy-paste trên 123 trang.

---

## 2. Thời điểm: migrate ngay hay chờ "ổn định"?

**Kết luận: migrate ngay, theo kiểu incremental — chờ đợi chỉ làm mọi thứ đắt hơn.**

- Chi phí migration tỷ lệ thuận với số trang, và số trang đang tăng nhanh do pivot (hàng chục trang listening/reading/writing chỉ trong tháng qua). Mỗi trang mới viết theo stack cũ = nợ migration mới.
- 50–100 users là blast radius **nhỏ nhất mà sản phẩm này sẽ từng có**. Sản phẩm đang lớn không bao giờ "ổn định hơn" — chỉ to hơn.
- 44k dòng test là **sunk cost, không phải tài sản cần bảo vệ**: chúng tồn tại để bù cho việc không có component và build system. Không port — retire dần theo từng trang.

**Cách làm (best practice ngành — strangler fig pattern,** nguồn: Microsoft Azure Architecture Center, AWS Prescriptive Guidance**):** transform → coexist → eliminate. Hai kỷ luật quan trọng nhất: *mọi feature mới đi vào stack mới* ("stop digging"), và đơn vị migration là lát cắt dọc ship được từng PR. **Không dùng long-lived side branch** — repo này merge PR hằng ngày (đã từng có 2 PR làm hỏng CSS chung khi merge); coexistence diễn ra ngay trên main, trong production.

---

## 3. Astro vs Next.js — trọng tâm cân nhắc

### 3.1 Bối cảnh hệ sinh thái 2026

- **State of JS 2025:** Next.js dẫn đầu usage (~59%) nhưng satisfaction giảm; **Astro dẫn đầu satisfaction meta-framework với biên độ ~39 điểm** so với Next.js.
- **Cloudflare mua lại team Astro (01/2026):** Astro cam kết open source + deploy-anywhere; output static chạy trên mọi host kể cả Vercel. Rủi ro thấp nhưng cần biết: trọng tâm Astro dịch về Cloudflare, còn framework "con ruột" của Vercel là Next.js.

### 3.2 So sánh trực tiếp trên đặc điểm repo này

| Tiêu chí | Astro | Next.js |
|---|---|---|
| Con đường migration | **Move-shaped**: vanilla JS giữ nguyên, chuyển dần; legacy HTML nằm trong `public/` chạy song song, 1 repo 1 deploy | **Rewrite-shaped**: trang chưa rewrite sang React thì chưa ship được; coexistence cần multi-zones/2 project |
| 37k dòng logic vanilla (practice.js 3.167 dòng…) | Giữ nguyên, componentize dần khi cần | Bắt buộc viết lại thành React trước |
| Trang nội dung / SEO (Grammar Wiki 107 bài, pricing, landing) | Zero JS mặc định — nhanh như hiện tại | Gánh thêm ~70–90KB hydration runtime |
| CSS / Tailwind / tokens `--av-*` | Carry over nguyên vẹn; tích hợp Tailwind xóa luôn pain "rebuild tailwind.build.css" | Carry over được nhưng vẫn phải rewrite markup thành JSX |
| Backend FastAPI/Railway | Giữ nguyên tách bạch (output vẫn là static trên Vercel) | Liên tục bị kéo về server layer của Next (API routes, RSC) — trùng vai với FastAPI |
| Mô hình trang | MPA — trùng khớp mô hình 123 trang hiện tại, URL giữ nguyên | App-shaped, client router |

### 3.3 Astro + React: "works" vs "works well"

**Bên trong một island là React thật 100%** — hooks, state, mọi thư viện npm, React DevTools, đầy đủ Vitest + React Testing Library. Giới hạn nằm ở **ranh giới giữa các island** (đã xác minh trên docs chính thức):

- React Context **không span qua nhiều island** (mỗi island là một React root riêng) → chia sẻ state giữa island dùng nanostores — idiom của Astro, không phải React.
- Props từ trang vào island phải **serializable** — không truyền được function/callback.
- `.astro` không dùng được bên trong React (chỉ một chiều React-trong-Astro) → codebase 2 ngôn ngữ.
- Không có RSC, không client-side router — chuyển trang là full page load.

**Escape hatch quan trọng:** pattern *one-island-per-page* — toàn bộ vùng tương tác của một trang là một cây React duy nhất → context/hooks hoạt động bình thường bên trong. Các trang của repo này (practice, exam player, quiz) đúng hình dạng đó, và MPA-navigation cũng chính là thứ app đang có hôm nay — không mất gì so với hiện tại.

### 3.4 "10% còn lại" — case chính đáng cho Next.js

Bốn thứ Astro **thật sự không làm được**, đáng tiền khi sản phẩm cần đúng chúng:

1. **Một hệ hình duy nhất** — mọi thứ là TSX, không phải quyết định "`.astro` hay React?" cho từng mảnh; chi phí nhận thức thấp hơn về dài hạn.
2. **Context bao trùm cả trang** — `<AuthProvider>`/`<QueryClientProvider>` ở layout, mọi component dùng chung.
3. **State sống qua navigation** — chuyển trang không reload; ví dụ: audio player phát tiếp khi đổi trang (kiểu Spotify), full-test giữ state trong memory thay vì chain qua backend session như hiện tại.
4. **RSC** — component chạy server, fetch trực tiếp. *Lý do yếu nhất với repo này*: backend là FastAPI Python, RSC chỉ thành lớp proxy.

**Quy tắc quyết định:** Astro coi React là *thư viện component cho widget*; Next.js coi React là *kiến trúc ứng dụng*. Chọn theo tầm nhìn sản phẩm, không theo trend.

---

## 4. Tác động lên code và test

**Code:** ~75k dòng HTML+JS → ước tính **~30–40k dòng TSX** (với Next) hoặc tương đương với Astro. Cơ chế: layout/chrome dùng chung thay cho 123 bản copy; DOM plumbing thủ công (querySelector, innerHTML string-building, showState sync) biến mất nhờ declarative rendering; escaping tự động thay `window.WC.escapeHtml`.

**Test:** 44k dòng string-matching → ước tính **~8–12k dòng** behavior-based (Vitest + Testing Library + e2e Playwright), bảo vệ tốt hơn trên mỗi dòng. Bốn cơ chế giảm: test theo component thay vì theo trang; assert hành vi thay vì regex markup; TypeScript xóa cả nhóm test kiểm tra shape; a11y bằng vitest-axe thay regex thủ công.

**Điểm cần trung thực:** lợi ích test đến từ *components + build system*, không phải từ React-the-framework — **React islands trong Astro được y hệt story Vitest + RTL** cho toàn bộ code tương tác. Phần test kém hơn ở Astro là chính file `.astro` (Container API còn experimental), nhưng đó là markup tĩnh vốn không cần unit test — types + e2e phủ đủ.

---

## 5. Roadmap (áp dụng cho cả hai lựa chọn, tối ưu cho Astro)

| Phase | Nội dung | Thời lượng | Gate |
|---|---|---|---|
| **0 — Safety net** | Mở rộng Playwright e2e từ 6 → ~10 flow sống còn (login/activation, practice→grade→result, full test, writing, reading, listening, vocab quiz, admin access-codes, admin grading). Framework-agnostic, sống qua toàn bộ migration. Baseline Lighthouse + error-log | 1–2 tuần | Có giá trị kể cả không migrate |
| **1 — Scaffold + passthrough** | Astro in-repo; toàn bộ trang cũ vào `public/` (build output byte-identical); port vercel.json; `Layout.astro` + Tailwind integration. **Từ đây: mọi trang mới viết bằng Astro** | ~1 tuần | e2e xanh, deploy preview parity |
| **2 — Content pages** | Grammar wiki, reading content, home/pricing/profile (~40–50 trang). Inline script → typed modules. **Retire string test của trang nào ngay trong PR migrate trang đó** | 2–4 tuần | 1 trang/PR, e2e xanh |
| **3 — App pages** | practice, exams, players, admin — move vanilla JS trước, componentize thành island khi có pain thật (flashcard/quiz). Flow đã audit kỹ (practice/grading) đi cuối | 2–3 tháng, opportunistic | e2e + theo dõi error-log sau deploy |
| **4 — Eliminate** | Xóa legacy trong `public/`, string tests còn lại, `tooling/css`, CI workaround Tailwind | — | Một pipeline, một test story |

**Điều kiện dừng đã cam kết trước:** nếu Phase 0 cho thấy không phủ e2e được các flow chính với chi phí hợp lý → sửa cái đó trước. Nếu Phase 2 vượt ~2× ước tính → dừng sau Phase 2 (vẫn lãi: layout system, đường đi cho trang mới, fix Tailwind CI).

---

## 6. Khuyến nghị cuối cùng

**Chọn Astro với React islands**, bắt đầu bằng Phase 0 ngay, trừ khi tầm nhìn sản phẩm là frontend *trở thành một React application* (navigation không reload, state xuyên màn hình, player persistent, realtime) — khi đó chọn Next.js và chấp nhận rewrite lớn một cách chủ động.

Căn cứ chính: (1) migration move-shaped thay vì rewrite-shaped — không đóng băng velocity giữa lúc pivot; (2) sản phẩm hiện tại và sau pivot vẫn là "nền tảng nội dung + mỗi trang một widget lớn" — đúng hình dạng islands; (3) ~90% lợi ích testability/code-reduction của React đạt được qua React islands; (4) backend Python giữ nguyên tách bạch; 10% còn lại là thứ sản phẩm hiện chưa cần.

**Bước tiếp theo đề xuất:** inventory 6 spec e2e hiện có so với danh sách 10 flow sống còn, và draft các spec còn thiếu (Phase 0).

---

## Nguồn tham khảo

- [Strangler Fig — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [Strangler fig — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)
- [State of JS 2025 — Meta-frameworks](https://2025.stateofjs.com/en-US/libraries/meta-frameworks/)
- [Astro joins Cloudflare](https://astro.build/blog/joining-cloudflare/)
- [Astro — Framework components](https://docs.astro.build/en/guides/framework-components/)
- [Astro — Sharing state between islands](https://docs.astro.build/en/recipes/sharing-state-islands/)
- [Astro — Testing](https://docs.astro.build/en/guides/testing/)
- [Astro — Migrate an existing project](https://docs.astro.build/en/guides/migrate-to-astro/)
- [Contentful — Astro vs Next.js](https://www.contentful.com/blog/astro-next-js-compared/)
