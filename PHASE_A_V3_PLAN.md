# PHASE_A_V3_PLAN.md

## 1. Scope Confirmation
**Mục tiêu:** Xây dựng Phase A của Vocabulary Module (Vocabulary Wiki MVP) cho phép người dùng học từ vựng chia theo chủ đề, hoạt động hoàn toàn độc lập với Grammar Wiki để đảm bảo 0% regression.

**In-scope (Làm):**
- Xây dựng Vocabulary Wiki public (không cần auth để xem nội dung).
- Ra mắt 20 articles (từ vựng) ban đầu chia vào 6 categories.
- Cung cấp tính năng tìm kiếm simple prefix match.
- Ghi nhận analytics cơ bản (`vocab_wiki_viewed`).
- Tách biệt hoàn toàn code/content với Grammar Wiki.
- Viết test regression cơ bản cho Grammar Wiki trước khi code Vocab.

**Out-of-scope (Không làm / Non-goals):**
- Không làm Personal Vocab Bank (Phase B).
- Không làm tính năng Quiz/Drill.
- Không làm Admin Editor UI (dùng Git/Markdown để quản lý).
- Không refactor `grammar_content.py` thành một class dùng chung (Abstract base loader).
- Không làm Full-text search (chỉ prefix match).

---

## 2. Dependency / Preflight Check
- **Grammar Wiki regression coverage:** Hiện tại `backend/tests/` đang trống, chưa có coverage. **Yêu cầu:** Phải viết một test script đơn giản (smoke test API) cho Grammar Wiki trước khi làm bất cứ thứ gì khác.
- **File structure:** Content Grammar đang nằm chung ở `backend/content/`. Để tránh rủi ro `grammar_content.py` (vốn đang quét toàn bộ file `*.md` trong thư mục) quét nhầm file từ vựng, Vocab Wiki sẽ sử dụng thư mục hoàn toàn mới là `backend/content_vocab/` ngang hàng với `content/`.
- **Routing:** Grammar dùng router `/api/grammar`. Vocab sẽ dùng router mới `/api/vocabulary`.
- **Analytics:** Hệ thống sẽ sử dụng cách tiếp cận `analytics_events` thay vì bảng `article_views` cũ để đo lường gate MVP chuẩn xác và nhất quán với plan v3. Mọi view logic cũ sẽ được tách bạch.
- **Tech Debt:** Đã có file `TECH_DEBT_BACKLOG.md`. Sẽ ghi nhận việc "Chưa refactor content loader dùng chung cho Grammar và Vocab" vào file này.

---

## 3. Proposed File Changes
**Backend:**
- `[NEW]` `backend/tests/test_grammar_smoke.py` (Smoke test chống regression cho Grammar)
- `[NEW]` `backend/services/vocab_content.py` (Bản copy an toàn từ `grammar_content.py`, thay đổi đường dẫn trỏ về `content_vocab/`)
- `[NEW]` `backend/routers/vocabulary.py` (Router độc lập cho Vocab)
- `[MODIFY]` `backend/main.py` (Mount router `/api/vocabulary`)
- `[MODIFY]` `TECH_DEBT_BACKLOG.md` (Ghi log tech debt)
- `[NEW]` `backend/content_vocab/_categories.yaml` (Định nghĩa 6 categories)
- `[NEW]` `backend/content_vocab/{category}/{slug}.md` (Chứa 20 articles)

**Frontend:**
- `[NEW]` `frontend/vocabulary.html` (Landing page của Vocab Wiki)
- `[NEW]` `frontend/pages/vocab-article.html` (Trang chi tiết từ vựng)
- `[NEW]` `frontend/js/vocabulary.js` (Logic gọi API, search, render UI)

---

## 4. API Contract
Router Prefix: `/api/vocabulary`

1. **`GET /categories`**
   - **Response:** `[ { "slug": "environment", "title": "Environment", "article_count": 5, "articles": [ { summary object } ] } ]`
2. **`GET /articles`**
   - **Response:** `[ { summary object } ]` (Trả về list summary cho client side simple prefix-search hoặc listing)
3. **`GET /articles/{category}/{slug}`** (Dùng số nhiều `articles` cho đồng nhất)
   - **Response:** `{ "slug": "mitigate", "headword": "Mitigate", "category": "environment", "html": "...", "related_words": [...] }`
4. **`GET /search?q={prefix}`**
   - **Response:** `[ { "slug": "mitigate", "headword": "Mitigate" } ]` (Chỉ filter simple prefix match của headword trên in-memory index)

Router Prefix: `/api/analytics` (Tách biệt logic tracking khỏi content API)
5. **`POST /events`**
   - **Payload:** `{ "event_name": "vocab_wiki_viewed", "event_data": { "slug": "mitigate", "category": "environment" }, "session_id": "..." }`
   - **Response:** `{ "ok": true }`

---

## 5. Content Schema
Cấu trúc YAML Frontmatter cho mỗi file `{slug}.md`:

**Bắt buộc (Required):**
```yaml
---
headword: "Mitigate"
slug: "mitigate"
category: "environment"
level: "C1"
part_of_speech: "verb"
pronunciation: "/ˈmɪt.ɪ.ɡeɪt/"
---
```
**Tùy chọn (Optional):**
```yaml
synonyms: ["alleviate", "reduce", "lessen"]
antonyms: ["aggravate", "worsen"]
collocations: ["mitigate the impact", "mitigate the risk"]
related_words: ["sustainable", "emission"]
```

**Validate & Conventions:**
- Naming: File name bắt buộc phải trùng với `slug.md`.
- Slug: Chỉ chứa lowercase letters và hyphens (e.g. `greenhouse-gas`).
- Category: Phải khớp 1 trong 6 list định nghĩa tại `_categories.yaml`.
- Internal Links: Dùng field `related_words` (tương đương `next_articles` bên Grammar).

---

## 6. Frontend Rendering Plan
- **Route / Flow:**
  - `vocabulary.html`: Landing page hiển thị grid 6 categories (dạng thẻ cards). Có thanh Search bar nổi bật.
  - Gõ vào Search bar -> Gọi API `GET /search?q=` (hoặc filter client-side nếu payload nhỏ). Bấm kết quả -> Chuyển sang chi tiết từ.
  - `pages/vocab-article.html?cat=...&slug=...`: Hiển thị Headword to, phiên âm, nút loa (Text-to-Speech native của trình duyệt cho MVP), từ loại, định nghĩa (tiếng Việt), các ví dụ IELTS, từ đồng nghĩa và collocations.
- **Tái sử dụng (Reuse):** Header, footer, typography, màu sắc từ `grammar.html`. File `api.js` dùng chung để fetch Supabase/Backend.
- **Tách biệt (Isolate):** File logic `vocabulary.js` mới 100%, không chạm vào `grammar.js`. CSS tái dùng Tailwind classes chuẩn hiện tại.
- **Responsive:** Dùng Tailwind grid, trên Mobile 1 cột cho danh sách categories, Desktop 2-3 cột.

---

## 7. Analytics Plan
- **Cơ chế:** Chuyển sang mô hình `analytics_events` độc lập (tránh gắn vào view log legacy của Grammar).
- **Event Name:** `vocab_wiki_viewed`.
- **Kích hoạt (Fire):** Khi trang `vocab-article.html` load và render thành công bài viết.
- **Payload tối giản:** `{ "event_name": "vocab_wiki_viewed", "event_data": { "slug": "...", "category": "..." }, "session_id": "<sinh_random_frontend>" }`.
- **Backend Integration:** Bắn vào `/api/analytics/events`. Ghi vào log/bảng đơn giản, không làm thêm admin dashboard phức tạp nào cho tính năng này ở Phase A. Đo lường gate một cách khách quan nhất.

---

## 8. Content Production Plan
- **Categories MVP (6 nhóm):** Environment, Technology, Education, Work & Career, Health, People & Society.
- **Ship Gate (Batch 1 - 20 Headwords ưu tiên cao):**
  - *Environment:* mitigate, emission, sustainable, deplete.
  - *Technology:* cutting-edge, obsolete, breakthrough, automate.
  - *Education:* curriculum, literacy, pedagogy.
  - *Work:* lucrative, prerequisite, commute.
  - *Health:* sedentary, epidemic, holistic.
  - *People:* demographic, marginalize, cosmopolitan.
- **Stretch Goal (Batch 2 - 10 Headwords):** Thực hiện sau nếu Batch 1 hoàn thành sớm định mức.
- **Prompt cho Cowork/AI để sinh content:** 
  > "Viết một bài từ vựng IELTS cho từ '{headword}'. Bắt buộc dùng đúng YAML frontmatter: headword, slug, category, level, part_of_speech, pronunciation. Nội dung Markdown gồm: 1 dòng định nghĩa tiếng Việt dễ hiểu, và 2 câu ví dụ ngữ cảnh IELTS Speaking Part 3 (in đậm từ vựng)."

---

## 9. Step-by-step Execution Breakdown

### Task 1: Regression Safety
- **Mục tiêu:** Đảm bảo Grammar Wiki không bị ảnh hưởng và file Vocab tuyệt đối không bị rò rỉ (leak) sang API của Grammar.
- **File chạm vào:** `backend/tests/test_grammar_smoke.py`.
- **Cách verify (Test suite phải cover đủ):**
  1. Check route `/api/grammar/home` (home/list).
  2. Check route `/api/grammar/category/{slug}` (listing/category).
  3. Check 1 route bài viết cụ thể `/api/grammar/article/parts-of-speech/nouns` (detail route).
  4. Check rò rỉ: Lặp qua danh sách payload trả về từ Grammar endpoints, assert không có bất kỳ category hay bài viết nào thuộc nhóm Vocab. (Run `pytest backend/tests/test_grammar_smoke.py` pass 100%).

### Task 2: Backend Content Loader & Routing
- **Mục tiêu:** Tạo bộ đọc file `backend/content_vocab/` an toàn (tech debt logged).
- **File chạm vào:** `backend/services/vocab_content.py`, `backend/routers/vocabulary.py`, `backend/main.py`.
- **Rủi ro chính:** Copy sót biến, nhầm đường dẫn khiến nó đọc lại folder grammar.
- **Cách verify:** Server boot thành công, `/api/vocabulary/categories` trả mảng rỗng (vì chưa có file).

### Task 3: Schema & Content Batch 1
- **Mục tiêu:** Tạo 20 markdown files đầu tiên theo chuẩn YAML frontmatter mới.
- **File chạm vào:** `backend/content_vocab/_categories.yaml` và 20 file `.md`.
- **Rủi ro chính:** Thiếu schema fields gây crash backend parse.
- **Cách verify:** Reload backend, `/api/vocabulary/articles` trả đúng 20 kết quả.

### Task 4: Frontend Pages & Search
- **Mục tiêu:** Làm UI render và UX cơ bản.
- **File chạm vào:** `frontend/vocabulary.html`, `frontend/pages/vocab-article.html`, `frontend/js/vocabulary.js`.
- **Rủi ro chính:** Render lệch CSS, lỗi Fetch API do CORS.
- **Cách verify:** Click từ trang chủ -> trang chi tiết chạy mượt mà, render Headword và markdown chính xác. Gõ search bar hoạt động tốt.

### Task 5: Analytics & TTS
- **Mục tiêu:** Hoàn thiện Tracking và Text-to-Speech (native `SpeechSynthesis`).
- **Cách verify:** F12 check Network thấy bắn `POST` analytics 200 OK. Click nút loa đọc đúng headword tiếng Anh.

### Task 6: QA & Audit
- **Mục tiêu:** Codex/Audit bot duyệt lại code trước khi đóng scope Phase A.

---

## 10. Acceptance Criteria
- [ ] **Grammar Wiki 0 regression:** Test smoke chạy qua, không xuất hiện từ vựng trong trang Grammar.
- [ ] **20 articles live:** Đủ 20 headwords, chia 6 chủ đề, hiển thị không rác markdown.
- [ ] **5 endpoints đúng schema:** Có `GET categories`, `GET articles`, `GET articles/{cat}/{slug}`, `GET search`, và `POST /api/analytics/events`.
- [ ] **Desktop/Mobile OK:** Giao diện co giãn lưới tốt, responsive sạch sẽ.
- [ ] **Analytics event tracked:** Sự kiện `vocab_wiki_viewed` được ghi vào log table hợp lệ.
- [ ] **Codex audit pass:** 0 critical/high findings trong pull request review.

---

## 11. Risks and Mitigations
- **Regression Grammar Wiki:** Xử lý triệt để bằng thư mục content mới độc lập (`content_vocab/`) và bắt buộc pass test smoke.
- **Content schema drift:** Parser trên backend sử dụng `dict.get("key", default)` cẩn thận để không crash khi file markdown thiếu optional array.
- **Stale links (related_words):** Tạm ẩn UI phần "Từ liên quan" nếu mảng rỗng hoặc backend trả về slug bị 404 trong in-memory index.
- **Analytics not firing:** Try-catch khối call Analytics trên frontend; không để lỗi tracking chặn luồng hiển thị content.
