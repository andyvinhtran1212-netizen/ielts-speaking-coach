# Audit Grammar Wiki — nội dung, learning hooks và UI/UX

> Ngày audit: 2026-08-25
> Nhánh: `codex/audit-grammar-wiki-ux`
> Phạm vi: 137 bài Markdown, 137 grammar quiz banks, trang `/grammar`, trang bài viết, search, roadmap, exercises, desktop/mobile, light/dark.
> Trạng thái: discovery hoàn tất; Phase 0 đã triển khai trên nhánh audit; Phase 1–3 chưa triển khai.

## 1. Kết luận ngắn

Grammar Wiki có nền nội dung và hạ tầng tốt, nhưng đang được trình bày như một thư viện tham khảo dài hơn là một trải nghiệm học. Vấn đề không phải “thiếu card đẹp”; vấn đề là các hành động học bị dồn xuống cuối bài, nội dung giữa bài gần như chỉ có chữ/bảng, và hệ thống chưa phân biệt rõ hai nhu cầu của người dùng: **tra cứu nhanh** và **học để làm đúng**.

Hướng đề xuất là giữ Markdown, API, quiz banks và metadata hiện có; dựng thêm một **lesson presentation system** gồm các khối có ngữ nghĩa (visual explainer, example pair, error repair, micro-check, IELTS transfer) và đưa bài viết vào vòng lặp:

`Nhận ra lỗi → hiểu mô hình → thử ngay → nhận feedback → áp dụng IELTS → học tiếp`

Không nên làm một cuộc “reskin” thuần thẩm mỹ hoặc thêm illustration trang trí đại trà.

## 2. Phương pháp và bằng chứng

- Đọc contract backend/frontend: `grammar_content.py`, `grammar.py`, các route Next Grammar, `grammar.js`, `grammar-wiki.css`, `aver-chrome.js` và test liên quan.
- Đo corpus theo 11 category mà loader đang phục vụ.
- Đối chiếu source với bản production tại `https://www.averlearning.com/grammar` ở desktop 1810×933 và mobile 390×844, cả light/dark.
- Kiểm tra trực tiếp trang chủ, bài `foundations/articles`, search, roadmap Tenses và directory bài tập.
- Đối chiếu giải pháp với British Council LearnEnglish, Cambridge Grammar Today, nghiên cứu multimedia learning và WCAG 2.2.

Giới hạn: discovery này không đọc lại toàn văn từng câu của cả 137 bài. Audit nội dung 2026-07-02 đã kết luận corpus lúc đó có chất lượng cao; vòng này tập trung vào cấu trúc học, hook và cách trình bày, đồng thời spot-check bản hiện tại.

## 3. Inventory hiện tại

| Chỉ số | Hiện trạng |
|---|---:|
| Bài đang được loader phục vụ | 137 |
| Category filesystem | 11 |
| Nhóm khái niệm trên trang chủ | 10 |
| Quiz bank liên kết theo bài | 137 |
| Bài có `anchors` | 137/137 |
| Bài có `next_articles` không rỗng | 134/137 |
| Bài có `related_pages` không rỗng | 134/137 |
| Bài có `compare_with` không rỗng | 97/137 |
| Bài có heading bài tập/thực hành | 106/137 |
| Bài có mục đáp án | 98/137 |
| Bài có ảnh/diagram/figure | 0/137 |
| Median độ dài source | khoảng 1.925 từ |
| Trạng thái nội dung | 137 `complete` |

Điểm mạnh cần giữ:

- Nội dung Việt–Anh, ví dụ IELTS, lỗi người Việt và metadata liên kết đều giàu.
- Anchor phủ 100%, giúp deep-link từ feedback tới đúng section.
- Quiz bank đã phủ 1:1 với corpus; không cần tạo một engine bài tập mới.
- Light/dark tokens, reading progress, save, TOC active, compare/related/next đã tồn tại.
- CI có guard cho dangling slug và renderer anchor.

## 4. Findings theo mức ưu tiên

### Critical — Navigation mobile làm mất các skill tab phía sau Listening

- **Root cause:** trong Shadow DOM, `.nav-links` đặt `width: 100%` và `overflow-x: auto`, nhưng chính container chỉ rộng bằng viewport trong khi các link con tràn ra ngoài mà không làm `scrollWidth` tăng. Ở 390px, Grammar bắt đầu tại x≈410px; Grammar, Vocabulary và Reading không hiển thị và không cuộn tới được.
- **Impact:** người dùng mobile không thấy active Grammar tab và không thể chuyển tới ba khu vực cuối bằng global nav.
- **Impacted files:** `frontend/public/js/components/aver-chrome.js`, block `@media (max-width: 720px)` quanh dòng 304–309.
- **Suggested minimal fix:** chuyển mobile nav thành menu/disclosure chuẩn hoặc một scroller có inner track đo đúng intrinsic width; giữ mọi tab keyboard-accessible và báo current state.
- **Verification:** 320/375/390px; tất cả tab phải nhìn thấy hoặc mở được; không có page-level horizontal overflow; keyboard focus không đi vào phần tử ngoài viewport.

### High — Bài viết là một dòng đọc dài; interaction bị dồn xuống cuối

- **Root cause:** `ArticleShell` inject toàn bộ `article.html` vào một `.article-body`; CSS chỉ style heading, paragraph, table, code và blockquote. `ArticleBehavior` chỉ bổ sung progress/TOC/save/CTA ở cấp trang. Không có primitive học nằm giữa các section.
- **Current state:** bài `articles` dài khoảng 9.900px trên desktop, có 12 H2, 17 H3 và 5 bảng; quick check chỉ xuất hiện sau toàn bộ nội dung. Phần giữa không có input, feedback hay visual explainer.
- **Impact:** tải nhận thức và chi phí cuộn cao; người học có thể đọc nhưng ít phải truy hồi/ra quyết định, nên trải nghiệm giống tài liệu hơn lesson.
- **Impacted files:** `frontend/app/(public-content)/grammar/[category]/[slug]/page-shell.tsx` (`ArticleShell`), `article-behavior.tsx`, `frontend/public/css/grammar-wiki.css`, `backend/services/grammar_content.py` (`_parse_file`).
- **Suggested minimal fix:** thêm một layer render cho các block có ngữ nghĩa; pilot 5 bài trước, không rewrite hàng loạt.
- **Verification:** mỗi pilot có ít nhất một hành động trước 25% scroll depth, một micro-check giữa bài, feedback ngay tại chỗ và CTA cuối bài; không làm hỏng anchor/SEO/plain Markdown fallback.

### High — “Bài tập luyện” trong bài vẫn là đáp án tĩnh

- **Root cause:** bài tập và đáp án là Markdown thường, nên renderer hiển thị cả câu hỏi lẫn đáp án trong cùng flow. Quick Check tương tác là một CTA độc lập ở cuối bài.
- **Impact:** người học nhìn thấy đáp án trước khi chủ động recall; hai hệ thống practice (static trong bài và quiz bank) trùng mục đích nhưng không nối với nhau.
- **Impacted files:** `backend/content/**/*.md`, `page-shell.tsx`, quiz lookup trong `article-behavior.tsx::_initExerciseCTA()`.
- **Suggested minimal fix:** ở pilot, chuyển practice tĩnh thành “Thử trước → Mở gợi ý → Xem đáp án”, hoặc thay bằng 1–2 câu lấy từ bank hiện có; không copy câu hỏi DB vào Markdown.
- **Verification:** câu trả lời bị che mặc định, thao tác được bằng keyboard, trạng thái đúng/sai có text chứ không chỉ màu; link “luyện đầy đủ” vẫn mở đúng bank.

### High — Không có visual explanation trong 137 bài

- **Root cause:** content schema không có `visual_model`/figure convention; CSS/renderer không có primitive diagram. Toàn corpus có 0 Markdown image, Mermaid, SVG hay figure.
- **Impact:** các khái niệm vốn có quan hệ không gian/thời gian vẫn bị ép thành đoạn văn và bảng; đặc biệt yếu ở tenses, sentence structures, articles, hedging và reading decode.
- **Impacted files:** `backend/content/**/*.md`, `grammar_content.py`, `grammar-wiki.css`, article shell.
- **Suggested minimal fix:** dùng SVG/CSS data-driven, theme-aware; chỉ minh hoạ khi hình giúp giải thích quan hệ. Không dùng ảnh stock/mascot như vật trang trí.
- **Verification:** illustration có accessible name/alt hoặc bị ẩn khỏi accessibility tree nếu thuần trang trí; light/dark; 320px reflow; reduced motion.

### Medium — Trang chủ trộn hai taxonomy và copy đã drift

- **Root cause:** UI hiển thị cả 10 conceptual groups lẫn 11 filesystem categories; hero/metadata vẫn hardcode “9 nhóm chủ đề”. `_groups.yaml` hiện có 10 nhóm.
- **Impact:** first-time user phải hiểu hai cách phân loại gần giống nhau; số “9” làm giảm độ tin cậy; trang dài và lặp card.
- **Impacted files:** `frontend/app/(public-content)/grammar/page.tsx` (metadata và CTA), `backend/content/_groups.yaml`, `grammar-cards.tsx`.
- **Suggested minimal fix:** chọn một IA chính trên home: “Theo mục tiêu học”; chuyển filesystem categories vào browse/filter phụ. Tính count từ API, không hardcode.
- **Verification:** count UI = số group backend; user test phải trả lời được “bắt đầu ở đâu” và “tìm một bài cụ thể thế nào” mà không phải hiểu cả hai taxonomy.

### Medium — Thanh 18/18, 23/23 là tiến độ biên tập, không phải tiến độ học

- **Root cause:** `GroupCards` tính phần trăm bằng `complete_count/article_count`; toàn bộ 137 bài đều complete nên mọi thanh đều 100%.
- **Impact:** visual progress chiếm diện tích nhưng không giúp người học quyết định; dễ bị hiểu là đã hoàn thành lộ trình.
- **Impacted files:** `grammar-cards.tsx::GroupCards`, home API group payload.
- **Suggested minimal fix:** đổi thành nhãn “18 bài” nếu chưa có learner state; chỉ dùng progress bar cho completion/mastery thật.
- **Verification:** guest không thấy progress giả; logged-in user thấy completed/in-progress dựa trên canonical tracking.

### Medium — TOC desktop không sticky sau khi cuộn sâu; mobile không có thay thế

- **Root cause:** `.toc-sidebar` sticky nằm trong một `<aside>` có chiều cao đúng bằng sidebar (khoảng 843px), không cao theo article; sticky bị giới hạn bởi parent và trôi khỏi viewport. Mobile ẩn toàn bộ aside.
- **Impact:** ở bài dài, mục lục chỉ hữu ích ở đoạn đầu; người dùng mất vị trí và phải cuộn nhiều.
- **Impacted files:** `page-shell.tsx` vùng `<aside>`, `grammar-wiki.css` `.toc-sidebar`.
- **Suggested minimal fix:** đặt sticky trên aside trong một grid có track kéo theo article; mobile dùng nút “Mục lục / đang ở…” dạng disclosure hoặc bottom sheet.
- **Verification:** cuộn 25/50/75%; active heading và TOC luôn truy cập được; anchor không bị sticky header che.

### Medium — Search trả thời lượng sai và thiếu facet

- **Root cause:** `GrammarContentService.search()` tạo response chỉ gồm slug/category/title/summary; renderer fallback `(reading_time || 1)`, nên mọi kết quả production hiển thị “1 phút” dù bài thật 6–16 phút. Search chỉ substring-match, không có filter level/band/skill/pathway.
- **Impact:** metadata hiển thị không đúng canonical article; khó lọc 137 bài theo mục tiêu.
- **Impacted files:** `backend/services/grammar_content.py::search()` dòng 360–385, `frontend/public/js/grammar.js::renderSearchCards()`.
- **Suggested minimal fix:** trả `_summary()` hoặc bổ sung `reading_time`, `level`, relevance fields; sau đó thêm facet dần, bắt đầu bằng skill + level.
- **Verification:** search `conditionals`; duration phải trùng article endpoint/card; contract test pin fields; filter URL shareable và back/forward-safe.

### Medium — Roadmap là danh sách order, chưa phải lộ trình học

- **Root cause:** `get_roadmap()` trả thẳng `get_category()` và sort theo `(order, title)`, không dùng prerequisites hay learner state. Tenses có duplicate `order: 4`; thứ tự hiện đưa Present Perfect Continuous trước Past Continuous và Future trước các thì quá khứ còn lại.
- **Impact:** tên gọi “roadmap” hứa nhiều hơn hành vi; không giải thích vì sao học bài kế tiếp, không có continue/completed/locked state.
- **Impacted files:** `grammar_content.py::get_roadmap()`, frontmatter `order`/`prerequisites`, roadmap UI.
- **Suggested minimal fix:** trước mắt dọn duplicate order và hiển thị “đề xuất vì…” từ prerequisites; giai đoạn sau thêm learner state.
- **Verification:** topo/prerequisite drift test; không có duplicate order trong một category; full reload và immediate progress state khớp nhau.

## 5. Hướng sản phẩm đề xuất

### Hai mode rõ ràng

1. **Tra cứu nhanh** — search-first, answer card ngắn, bảng so sánh, jump tới section, không buộc hoàn thành lesson.
2. **Học & luyện** — có mục tiêu, pre-check, visual model, micro-check, IELTS transfer và progress thật.

Một bài có thể phục vụ cả hai mode; khác nhau ở entry point và mức disclosure, không cần duplicate content.

### Information architecture trang chủ

- Khối đầu: “Tiếp tục học” hoặc “Sửa lỗi bạn vừa gặp” cho user; guest thấy “Bạn muốn làm gì?” với 3 entry: Sửa một lỗi / Học theo kỹ năng / Tra cứu chủ đề.
- Search có filter chips: Speaking, Writing, Reading, Beginner/Intermediate/Advanced, Error Clinic.
- Một taxonomy chính: nhóm theo mục tiêu học. Category filesystem chỉ còn trong filter/directory.
- “Bài nổi bật” đổi thành “Phù hợp với bạn” khi có recommendation; nếu guest thì dùng các task phổ biến.
- Exercise directory không còn là danh sách 137 link trần; thêm search/filter, progress và resume.

### Anatomy mới cho một bài

1. **Lesson hero:** lỗi/nhu cầu thật, outcome, thời lượng, difficulty, skill relevance.
2. **Pre-check 1 câu:** cho người học dự đoán trước khi đọc.
3. **Visual explainer:** sơ đồ chính của bài.
4. **Rule + example pair:** rule ngắn; English example; Vietnamese explanation; wrong→right khi phù hợp.
5. **Micro-check:** 1 hành động sau mỗi concept lớn, feedback tại chỗ.
6. **IELTS transfer:** “Dùng trong Speaking/Writing/Reading như thế nào?” với before/after band-oriented.
7. **Summary card:** decision rule hoặc cheat sheet, không lặp nguyên văn toàn bài.
8. **Full Quick Check + next step:** điểm, review lỗi sai, học tiếp dựa trên prerequisites/mistakes.

### Illustration system theo loại bài

| Loại bài | Visual ưu tiên | Ví dụ pilot |
|---|---|---|
| Tenses | timeline, duration bar, event overlap | `present-perfect` |
| Sentence structures | sentence x-ray, clause blocks, dependency connectors | `relative-clauses`, `complex-sentence` |
| Articles/determiners | decision tree + specificity lens | `articles` |
| Error Clinic | wrong→diagnose→repair strip | `run-on-sentences` |
| Confusable forms | contrast matrix + meaning scale | `few-a-few-little-a-little` |
| Hedging/intensifiers | certainty/intensity continuum | `hedging-language` |
| Writing Task 1 | annotated chart → language mapping | `grammar-in-task1` |
| Reading decode | layered sentence highlighting | `complex-noun-phrases` |
| Speaking | answer-builder blocks + optional audio/record | `making-answers-longer-naturally` |

Illustration nên là code-native SVG/CSS để dùng chung light/dark, responsive, localization và analytics; animation chỉ kích hoạt khi người học thao tác.

## 6. Design System Packet

### Scope

- Surfaces: Grammar home, category/search/roadmap/exercises, article shell và các learning blocks trong bài.
- Primary mode: cross-surface alignment + foundations.
- Goal: giữ vẻ học thuật tin cậy nhưng biến mỗi bài thành một “grammar lab” có hành động.

### Foundations

- **Color:** teal là action/current; amber là attention/pitfall; red chỉ error; green success; blue/violet cho structural/function visuals. Không dùng màu group làm meaning ngẫu nhiên.
- **Typography:** giữ serif cho title/concept, sans cho giải thích/UI, mono chỉ cho formula/pattern. Body desktop 16–17px, mobile tối thiểu 16px.
- **Spacing/density:** lesson chunk 24–32px; card nội dung 16–20px; giảm khoảng trống trước article trên mobile.
- **Radius/elevation:** 12px learning block, 16px major explainer; tránh pill cho mọi thứ.
- **Motion:** 150–240ms; motion giải thích state/relationship, không fade-up hàng loạt; tôn trọng `prefers-reduced-motion`.
- **Breakpoints:** desktop article + learning rail; tablet single column + sticky compact rail; mobile single column + TOC disclosure.

### Primitive policy

- Shared: `gw-lesson-hero`, `gw-outcomes`, `gw-rule-card`, `gw-example-pair`, `gw-error-repair`, `gw-visual-explainer`, `gw-micro-check`, `gw-ielts-transfer`, `gw-summary-card`, `gw-next-step`, `gw-mobile-toc`.
- Tên primitive nói theo vai trò học, không theo màu/hình thức.
- Visual data và text nằm trong Markdown/frontmatter; quiz answer vẫn ở quiz bank canonical.
- Một block chỉ được promote khi dùng được cho ít nhất hai article families.

### Accessibility baseline

- WCAG AA contrast; focus ring rõ ≥2px; state đúng/sai có text + icon, không chỉ màu.
- SVG có title/description khi mang nghĩa; decorative art `aria-hidden`.
- Table ở mobile có container riêng; cung cấp stacked alternative khi bảng chỉ là so sánh hai cột.
- TOC, accordion, reveal answer và micro-check dùng semantic controls, keyboard đầy đủ.
- Không autoplay audio/animation; reduced-motion tắt transform/pulse không cần thiết.

### Governance

- Không cho tác giả nhúng style/script tuỳ ý vào Markdown.
- Thêm validator cho block type, anchor, visual data và quiz reference.
- Tất cả pilot phải pass anchor drift, link drift, light/dark, 320/375/768/1280 và keyboard.

## 7. Kế hoạch triển khai đề xuất

### Phase 0 — correctness trước redesign (PR nhỏ)

- [x] Fix mobile global nav: child không shrink, nav cuộn ngang và tự đưa tab active vào viewport; thêm `aria-current`.
- [x] Fix “9 nhóm” → count lấy từ `/api/grammar/groups`, với fallback không hardcode.
- [x] Fix search card contract: trả canonical `level`, `status`, `reading_time`.
- [x] Fix desktop sticky TOC bằng rail kéo cao theo article; thêm mobile TOC bằng semantic `<details>`.
- [x] Dọn duplicate Tenses order thành dãy duy nhất 1–8, giữ nguyên thứ tự biên tập hiện có.

Verification Phase 0:

- Frontend contract tests: 199/199 pass ở batch tập trung, gồm regression suite mới `grammar-phase0-foundations.test.mjs`.
- Toàn bộ frontend source test suite pass khi chạy ngoài sandbox.
- Backend Grammar suites: 286/286 pass; mọi slug reference và quiz bank vẫn hợp lệ.
- TypeScript: `tsc --noEmit --incremental false` pass.
- Visual QA local: 390×844 không còn page overflow, nav có `scrollWidth 718 > clientWidth 353`, tab Grammar được đưa vào viewport khi tải trực tiếp; mobile TOC có 29 link, native focus và vùng cuộn 50vh; desktop TOC giữ `top: 72px` sau khi cuộn 3.359px.
- Next production build chưa dùng làm bằng chứng trong worktree: Turbopack từ chối symlink `node_modules` nằm ngoài filesystem root; đây là giới hạn setup worktree, không phải compile error (TypeScript checker độc lập đã pass).

### Phase 1 — article shell pilot (5 bài)

Pilot đại diện cho 5 visual archetype:

1. `articles` — decision tree.
2. `present-perfect` — timeline.
3. `run-on-sentences` — error repair.
4. `complex-noun-phrases` — sentence x-ray.
5. `grammar-in-task1` — annotated chart.

Ship primitives, một pre-check, một inline micro-check, answer reveal và CTA full bank. Không đổi nội dung factual ngoài những chỗ cần chia chunk.

### Phase 2 — content hook system

- Định nghĩa schema block/metadata và validator.
- Backfill theo article family, không theo 137 file cùng lúc.
- Ưu tiên 20 bài có traffic/recommendation cao; lấy baseline analytics trước khi chọn.
- Giữ quiz bank là canonical source; thêm anchor/item mapping khi cần micro-check chính xác theo section.

### Phase 3 — home/search/roadmap personalization

- Tách “tra cứu” và “học & luyện”.
- Filters/facets, resume, saved, weak areas và progress thật.
- Roadmap dùng prerequisites + learner state; next step giải thích lý do.

## 8. Đo lường

Thu baseline trước khi đặt target. Theo dõi:

- search → article click-through;
- time-to-first-useful-section từ deep link;
- pre-check và inline micro-check start/completion;
- scroll depth 25/50/75/100;
- full Quick Check start/completion;
- wrong answer → return-to-anchor;
- next article click và roadmap continuation;
- save/return trong 7 ngày.

Không dùng “time on page tăng” làm success metric đơn lẻ; bài dễ tra cứu tốt có thể làm thời gian giảm.

## 9. Không nên làm

- Không rewrite toàn bộ 137 bài trong một batch.
- Không thêm ảnh AI/mascot giống nhau vào mọi bài.
- Không tạo component riêng cho từng article.
- Không duplicate quiz question/answer vào Markdown.
- Không dùng editorial completeness làm learner progress.
- Không thêm gamification point/streak trước khi learning loop và feedback đúng.

## 10. Nguồn tham khảo

- British Council LearnEnglish dùng flow Test → Teach → Test: https://learnenglish.britishcouncil.org/english-levels/improve-your-english-level/how-use-learnenglish-grammar-section
- British Council lesson mẫu đặt exercise trước và sau explanation: https://learnenglish.britishcouncil.org/free-resources/grammar/a1-a2/present-simple
- Cambridge Grammar Today nhấn mạnh authentic spoken/written examples: https://dictionary.cambridge.org/us/grammar/british-grammar/
- Mayer, multimedia principle: https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/multimedia-principle/D09A773C7C5C214FA19D4C9841FBC83B
- WCAG 2.2 Reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- WCAG 2.2 Focus Appearance: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

## 11. Quyết định cần product owner chốt trước implementation

1. Grammar Wiki ưu tiên **tra cứu** hay **mastery loop** trong 1–2 sprint tới? Đề xuất: giữ cả hai mode, pilot mastery loop trên 5 bài.
2. Có dùng learner history để cá nhân hoá home/roadmap ngay Phase 1 không? Đề xuất: chưa; Phase 1 không thêm migration.
3. Illustration direction: code-native semantic diagrams hay commissioned art? Đề xuất: semantic diagrams; commissioned art chỉ cho campaign/landing, không cho rule explanation.
4. Pilot KPI chính: Quick Check completion, next-step continuation hay return rate? Đề xuất: Quick Check completion + wrong-answer return-to-anchor.
