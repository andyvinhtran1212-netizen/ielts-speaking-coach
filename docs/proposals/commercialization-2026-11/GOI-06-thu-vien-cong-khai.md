# GÓI 06 — Thư viện công khai

**Khớp chéo ngày 18/11/2026:** kho 549 bài mẫu và hình Task 1 mở công khai được (00 mục 2 điểm 20) — bỏ điều kiện chặn vì bản quyền, câu 1 mục 10 đóng; thêm G06-T19 (rà 19 bộ chưa có trạng thái duyệt, vẽ hình và bổ sung cặp so sánh cho 3 bộ Task 1 — đội thực hiện tự làm); script nhập ghi bản ghi lô qua `services/import_batch_log.py` của G09-T36; trang `/admin/library` thuộc **G06** (G06-T20 mới; G09 chỉ đặt mục sidebar); Grammar Wiki theo ba tờ GrammarWiki, GrammarWikiBai, GrammarWikiMinhHoa, renderer sơ đồ thuộc GOI-11 phần G; câu trả lời mẫu Speaking do repo VIDEO MAKING sản xuất (giọng tổng hợp Kokoro), web chỉ hiển thị video/audio và lời thoại có mốc thời gian, ghi nhãn "Giọng đọc tổng hợp" — câu 8 mục 10 đóng; số spec `LIBRARY-0061`, dải migration 400–419 theo `01-KE-HOACH-TONG.md` mục 6. Ước lượng: 20 nhiệm vụ, 20 PR, khoảng 34 phiên.

**Cập nhật 18/11/2026 chiều (00 mục 2 điểm 23):** (1) Trang **Kiến thức nền theo chủ đề** (tờ `KienThucNen`) MỞ CÔNG KHAI và thuộc Thư viện; đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt (`feature='short_writing_feedback'`, `CREDIT_COST_SHORT_WRITING` của G04) nên phần nộp cần tài khoản có lượt, phần đọc thì không. (2) **Đọc kỹ** (tờ `DocKy`) gắn theo 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau. Hai trang này và khuôn luyện đề (tờ `KhuonLuyenDe`) mới là prototype, spec và nhiệm vụ ở GOI-13 (phần C, D, E: 0097 Kiến thức nền, 0098 Đọc kỹ, 0099 khuôn luyện đề — hoãn): gói này KHÔNG dựng chúng, chỉ giữ chỗ cho kệ thứ sáu (FR-06-005b, mục 3, mục 10 câu 14). (3) Rà 19 bộ bài mẫu và vẽ hình 3 bộ Task 1 (G06-T19): người thực thi làm — đã xác nhận lại. (4) Người làm gói này là người thực thi (project Claude Code của repo); chữ "đội thực hiện" trong file đọc là người thực thi. Số nhiệm vụ, PR, phiên không đổi (20 / 20 / khoảng 34).

## 1. Tóm tắt

- **Mục tiêu.** Một Thư viện mở cho mọi người, không cần tài khoản, gồm năm kệ: Bài mẫu Writing (549 đề, mỗi đề ba bài 7.5 / 7.0 / 6.0 kèm nhật ký khác biệt), Kiến thức Writing, Đề Speaking kèm video trả lời mẫu, Ngữ pháp (Grammar Wiki hiện có, đổi giao diện, giữ URL), Từ vựng (Vocabulary Wiki hiện có, đổi giao diện, giữ URL). Người đã đăng nhập thấy thêm dấu đã đọc, đã lưu, sổ từ. Mỗi trang có đúng một lối kín đáo sang khoá học.
- **Lớp thay đổi.**
  - Mã: spec `LIBRARY-0061`, `high-risk` (risk `high`) vì có migration bảng mới, route công khai mới trong cổng kích hoạt, đổi CSP để nhúng YouTube, và ghi dữ liệu người dùng (đã đọc/đã lưu).
  - Nội dung: các nhiệm vụ `content` (rà dữ liệu 549 đề, đặt tiêu đề tiếng Anh, bảng chủ đề, nhập staging, nội dung Speaking) dùng `Spec: N/A` theo `specs/README.md` nhưng phải ghi nguồn gốc, kiểm hiển thị, kiểm hợp lệ trong thân PR.
  - Số spec 0061 và dải migration 400–419 đã cấp ở `01-KE-HOACH-TONG.md` mục 6 (anh Andy là người duy nhất vận hành repo; bảng đó là sổ cấp số); người thực thi kiểm số chưa bị dùng rồi ghi vào sổ đăng ký trong repo. Chỗ nào trong file còn ghi `NNNN` hoặc "xin ở sổ" thì đọc theo dòng này.
- **Phụ thuộc.** G03 (khung công khai/học viên, `frontend/components/ui/`, token `--av2-*`, font Source Serif 4 + Source Sans 3). G04 chỉ cho "lối sang khoá học" và nút "Viết đề này"/"Luyện nói đề này" (cần biết người xem có khoá + còn lượt); thiếu G04 thì dùng trạng thái "chưa có khoá". G08 cho trình soạn Writing/trình luyện Speaking nhận đề điền sẵn. G05 cho `safeNext` (quay lại sau đăng nhập) và trang lỗi. G09-T36 (`services/import_batch_log.py`, bảng lô nhập migration 449–450) cho việc ghi bản ghi lô của script nhập; G09-T08 (khung admin) cho T20. GOI-11 phần G (G11-T33: renderer khối `figure`) cho sơ đồ trong bài Grammar; phần B và G05-T21 cho liên kết "Chấm thử miễn phí đề này" ở trang đề. Repo VIDEO MAKING (ngoài phạm vi, không đụng) cấp video/audio và lời thoại có mốc của câu trả lời mẫu Speaking. Song song được với G05 và G07.
- **Ước lượng** (giả định: G03 có component nền và khuôn trang bài đọc chưa có — G06 làm khuôn này; người duyệt nội dung trả lời trong một lượt cho mỗi danh sách cần duyệt): 20 nhiệm vụ = 20 PR, khoảng **34 phiên agent** (cộng từ dòng "Ước lượng" của từng nhiệm vụ: 18 nhiệm vụ cũ 30 phiên, cộng T19 2 phiên, T20 2 phiên), trong đó 7 nhiệm vụ nội dung. Độ khó chung **4/5**: dữ liệu 549 đề có cấu trúc tốt nhưng chưa có tiêu đề, chưa có bảng chủ đề, chưa có bảng trong DB; Speaking chưa có câu trả lời mẫu/video nào trong repo hay DB; Grammar/Vocabulary có nhiều test ghim chuỗi giao diện. Đây là ước lượng, không phải cam kết.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085) và nguồn dữ liệu ngoài repo

### 2.1 Repo

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Thư viện | Không có route `library` trong `frontend/app` | `/library` là mục 5 của thanh học viên (quyết định đã chốt 7); G06 làm nó công khai. |
| Grammar Wiki — nội dung | `backend/content/<category>/*.md`: foundations 18, grammar-for-meaning 12, grammar-for-reading 14, grammar-for-writing 9, ielts-grammar-lab 23, modifiers 7, parts-of-speech 9, sentence-structures 9, tenses 8, verb-patterns 9, error-clinic 19 (= 137 file); nhóm ở `backend/content/_groups.yaml` (bài không có file → `planned`) | Frontmatter: `title, slug, category, summary, level, tags, prerequisites, related_pages, compare_with, next_articles, pathways, common_error_tags`. Quy ước metadata ở `AGENTS.md` mục "Grammar Wiki conventions". |
| Grammar Wiki — API | `backend/routers/grammar.py`: `GET /api/grammar/home`, `/categories`, `/category/{slug}`, `/article/{category}/{slug}` (model `GrammarArticleDocument` ở `backend/models/grammar_content.py`: `html`, `word_count`, `toc`, `anchors`, `learning_blocks`, `prev_article`, `next_article`, `related_pages`…), `/roadmap/{slug}`, `/compare/{slug}`, `/search`, `/groups`, `/exercises`, `/article/{c}/{s}/exercise`; người dùng: `POST /api/grammar/articles/{slug}/view`, `POST|DELETE /api/grammar/articles/{slug}/save`, `GET /api/grammar/dashboard-data` | Router gắn `_ACTIVE_LEARNER` (`backend/main.py` dòng 307); các GET công khai nằm trong `ACTIVATION_EXEMPT_ROUTES`. Bảng `saved_articles`, `article_views` (mig 015). Không có "đã đọc" do người dùng tự bấm. |
| Grammar Wiki — frontend | `frontend/app/(public-content)/grammar/` (`page.tsx`, `grammar-home-mode.tsx`, `grammar-cards.tsx`, `search-box.tsx`, `[category]/[slug]/{page,page-shell,article-behavior,loading}.tsx`, `search/`, `compare/`, `roadmap/`, `exercises/`, `not-found.tsx`); dữ liệu qua `frontend/lib/grammar-api.ts` (`'use cache'` + `cacheLife`, ADR-008) | Layout `(public-content)/layout.tsx` nạp `tokens.css → components.css → ds.css → grammar-wiki.css → vocab-wiki.css → tailwind.build.css` và gắn class `av-page` lên `<body>` bằng script (CSS Grammar scope dưới `body.av-page`). |
| Grammar 404 thật | `frontend/proxy.ts` (matcher `/grammar/:category/:slug`): bài không có trong `/api/grammar/categories` → rewrite `/__aver-not-found` | Phải giữ khi đổi giao diện bài. Tooling `frontend/tooling/grammar-404-ssr-checks.mjs`, `verify-grammar-404-ssr-flow.mjs`. |
| Test ghim Grammar | 28 file trong `frontend/tests/` đọc mã nguồn `(public-content)`; nhóm Grammar nhiều nhất: `phase3-grammar-home.test.mjs` (10 lần `readFileSync`), `grammar-wiki-light-theme-rendering.test.mjs` (9), `grammar-roadmap-next-behavior.test.mjs` (7), `grammar-compare-next-behavior.test.mjs` (6), `grammar-cutover.test.mjs` (6), `pilot-grammar.test.mjs` (6), `grammar-search-next-behavior.test.mjs` (5), `grammar-wiki-comprehensive-theme-rendering.test.mjs` (4), `grammar-wiki-redesign.test.mjs`, `grammar-wiki-guest-cta-room.test.mjs`, `grammar-article-loading-next-behavior.test.mjs`, `grammar-article-not-found.test.mjs`, `grammar-404-ssr-checks.test.mjs` | Đổi giao diện sẽ vỡ nhiều assert. Xem T14. |
| Vocabulary Wiki — dữ liệu | Bảng `vocab_cards` (mig 110; slug theo chủ đề mig 122; cột `audio_headword`, `audio_example`, `audio_status` — **một** giọng); dự phòng Markdown `backend/content_vocab/` (80 file, 7 chủ đề: economy, education, environment, health, people-society, technology, work-career; `_categories.yaml`, `_lists.yaml`); `backend/services/vocab_content.py` (đọc DB trước, lỗi thì Markdown) | Số dòng `vocab_cards` trên staging: CHƯA KIỂM — người thực thi chạy `select count(*), count(*) filter (where audio_status='ready') from vocab_cards;` trên staging (chỉ đọc). |
| Vocabulary Wiki — API/route | `backend/routers/vocabulary.py` (`/api/vocabulary/categories`, `/directory`, `/categories/{category}/cards`, `/articles`, `/articles/{category}/{slug}`, `/exam`, `/search` — đều exempt); trang `frontend/app/(public-content)/vocabulary/page.tsx` + `vocabulary-wiki.tsx`, chọn từ bằng `?cat=&slug=` | `metadata.alternates.canonical = '/vocabulary'` cho **mọi** mục từ → máy tìm kiếm coi mọi từ là một trang. |
| Sổ từ | Bảng `user_vocabulary` (mig 019: `headword` text tự do, `category` ∈ topic/idiom/phrasal_verb/collocation, `source_type` ∈ used_well/needs_review/upgrade_suggested/manual); API `backend/routers/vocabulary_bank.py` prefix `/api/vocabulary/bank` (`POST /`, `DELETE /{id}`, …) | Sau cờ `VOCAB_BANK_FEATURE_FLAG_ENABLED` (mặc định `False`, `backend/config.py` dòng 399) **và** `users.feature_flags.vocab_enabled`; router gắn `_ACTIVE_LEARNER`. Không có khoá ngoại tới `vocab_cards`. |
| Route Vocabulary đã đăng nhập | `/vocabulary/hub`, `/vocabulary/practice`, `/vocabulary/exam`, `/vocabulary/learn`, `/vocabulary/learn/[unitSlug]`, `/vocabulary/sets/[setId]`, `/vocabulary/study/[sessionId]` | `proxy.ts` matcher `/vocabulary/:path+` coi mọi đường con là route nonce; `robots.ts` cấm `/vocabulary/exam`, `/hub`, `/learn`. |
| Đề Writing | Bảng `writing_prompts` (mig 035: `task_type` task1_academic/task1_general/task2, `title`, `prompt_text`, `difficulty`, `tags`, `exam_only`, `prompt_image_url`); `GET /api/writing/prompt-bank` công khai (sau `WRITING_PROMPT_BANK_ENABLED`, mặc định `False`) | Ảnh Task 1 nằm trong bucket **riêng tư** `writing-images`; khách chỉ nhận `has_prompt_image`, `prompt_image_url: null`. Không chứa bài mẫu. |
| Mẫu script nhập theo quy ước repo | `backend/scripts/import_writing_prompts.py` | Chỉ chạy staging (`assert_staging`, `STAGING_PROJECT_REF = "zjphffoujxkpltixsbzj"`), dry-run mặc định, `--execute` rồi đọc lại phải "không còn khác biệt", nguồn sự thật là manifest JSON trong `backend/content/writing_prompts/`. G06 sao đúng khuôn này. |
| Kiến thức Writing | Bảng `writing_tips` (mig 082: `title`, `slug` unique, `body_markdown`, `task_type` task_1/task_2/both, `category`, `published`, `display_order`; thêm `content_type` ∈ tip/knowledge/sample/outline và `type_data` ở Sprint 19.1C); admin `backend/routers/admin_writing_tips.py` (`/admin/writing/tips`, nhập `/admin/writing/content`); học viên `GET /api/writing/tips`, `GET /api/writing/tips/{slug}` (`backend/routers/writing_student.py` dòng 2709–2760) | Hai GET học viên **bắt buộc đăng nhập** (`get_supabase_user`) và qua `_ACTIVE_LEARNER` → không công khai. Số bài đã xuất bản: CHƯA KIỂM — `select content_type, task_type, count(*) from writing_tips where published group by 1,2;` |
| Đề Speaking | Bảng `topics` (tạo trước hệ migration; cột dùng trong mã: `id, title, part, category, is_active`, `last_rotated_at` mig 002, `updated_at` mig 017; **không có slug**, `category` đang chứa nhãn khung thời gian của nguồn, không phải chủ đề); `topic_questions` (mig 002: `part`, `order_num`, `question_text`, `cue_card_bullets`, `cue_card_reflection`, `is_active`) | Nguồn: `backend/content/speaking_bank/` (`2026-09-source.json`: 57 chủ đề Part 1, 84 thẻ Part 2, 69 nhóm Part 3; `2026-09-reviewed.json`: 126 chủ đề, 504 câu Part 1/3 đã biên tập); nhập bằng `backend/scripts/import_speaking_bank_admin.py` (qua API admin). README ghi ngày tháng trong nguồn là "claims in the supplied document". |
| Câu trả lời mẫu / video Speaking | **Không có** trong repo hay migration: `grep -rli "youtube\|video_url\|video_id"` trên `backend/migrations`, `backend/routers`, `backend/services`, `frontend/app`, `frontend/lib` rỗng | Phải thêm bảng. **Nội dung do repo VIDEO MAKING sản xuất** (viết kịch bản, giọng đọc tổng hợp Kokoro, dựng video — 00 mục 2 điểm 22); web chỉ hiển thị. Gói này không viết câu trả lời mẫu, không sinh giọng đọc, không đụng repo video (quy ước chung 4.5). |
| Phiên Speaking của người dùng | `sessions.topic` là **chuỗi** tiêu đề (`backend/routers/sessions.py` model có `topic: str`), không có `topic_id` | "Đề đã luyện" chỉ khớp được theo chuỗi tiêu đề — xem T16. |
| CSP | `frontend/tooling/content-security-policy.mjs`: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; không có `frame-src` ở production; `media-src 'self' blob: https:` | Nhúng `youtube-nocookie.com` và tải `https://www.youtube.com/iframe_api` đều **bị chặn** hiện nay. Tài liệu `docs/CONTENT_SECURITY_POLICY.md`. |
| Bucket Storage | `backend/services/storage_limits.py`, mig 343 (STORAGELIMITS-0038: mỗi bucket chỉ nhận cỡ/kiểu tệp app ghi) | Bucket mới cho ảnh Task 1 công khai phải khai ở đây. |
| Cache công khai | `backend/services/public_cache.py` (`cacheable_json`, `content_last_modified`), test `backend/tests/test_public_cache_headers.py` | Dùng cho API công khai mới. |
| Cổng kích hoạt | `backend/services/activation_gate.py` `ACTIVATION_EXEMPT_ROUTES`; `backend/tests/test_activation_gate_inventory.py` | Mọi GET công khai mới thêm một dòng lý do. |
| SEO | `frontend/app/sitemap.ts` + `frontend/lib/public-sitemap-model.mjs` (`STATIC_PUBLIC_PATHS` + bài Grammar không `draft`); `frontend/app/robots.ts` (allow `/`, `/grammar/`, `/vocabulary`); `backend/routers/sitemap.py` `/sitemap-grammar.xml` | `/library` chưa có. |
| Kiểm kê route, kiểu | `docs/SITE_OVERVIEW.md` + `frontend/tests/site-overview-coverage.test.mjs`; `frontend/types/api.d.ts` sinh lại trong `.github/workflows/typecheck.yml` | Như G05 mục 8. |

### 2.2 Nguồn 549 đề Writing (ngoài repo, đã đọc ngày 16/11/2026)

Thư mục `/Volumes/Kingston SSD/Writing essays/ielts-pipeline` (repo riêng `ielts-pipeline`, private). Nguồn sự thật là `incoming/`: 549 file bộ `<stem>.json` + 549 file chấm `<stem>.mark.json`; `incoming/_archive/` là bộ đã bị thay (bỏ qua). `exports/` (549 `.json/.md/.docx`) và `ielts.db` (SQLite) là sản phẩm sinh lại, không nằm trong git. Tổng `incoming/` ≈ 30 MB.

| Trường của một bộ | Có ở | Nội dung |
|---|---|---|
| `prompt.text`, `prompt.domain`, `prompt.difficulty_notes` | 549 | Câu đề; `domain` là chữ tự do (**480 giá trị khác nhau** cho 549 bộ, ví dụ `society` 12, `technology` 12) — không dùng làm bộ lọc chủ đề được; `difficulty_notes` là ghi chú nội bộ (tiếng Việt lẫn Anh) — không hiện. |
| `prompt.question_type` | 479 (Task 2) | opinion 164, discussion 110, problem_solution 74, advantages_disadvantages 63, two_part 62, positive_negative 6 — khớp sáu dạng ở tờ `BaiMauWritingDanhSach`. |
| `prompt.task`, `prompt.subtype` | 70 (Task 1 Academic) | bar 15, line 14, process 13, pie 8, table 7, map 7, mixed 6. 70 bộ này **không có** `question_type` — đó là đúng (Task 1 không có dạng Task 2; tờ thiết kế: chọn Task 1 thì nhóm dạng đề vô hiệu). |
| `prompt.image_path` | 67/70 | Đường dẫn tương đối tới `sources/task1_figures/*.png` (129 ảnh). Thiếu ở `task1_bricks`, `task1_internet`, `task1_island`. README của thư mục ảnh ghi ảnh "dựng lại bằng imagegen từ các trang sách" (`9分达人写作 1–4`) — xem mục 10 câu 1. |
| `essays["7.5"|"7.0"|"6.0"]` | 549 | Mỗi bài: `text`, `word_count`, `outline` (danh sách đoạn: `paragraph`, `function`, `topic_sentence`, `supporting_points`…), `vocab_table` (`term`, `pos`, `meaning_vi`, `collocation`, `band_level`, `sentence_in_essay`), `structures`, `ideas_used` (Task 2). |
| `delta_75_70`, `delta_70_60` | 549 | Danh sách `{criterion, type, before, after, why (tiếng Việt), error_group}` — nguồn của "Nhật ký khác biệt". |
| `justification.by_criterion[]` | 549 | `{criterion, summary_vi, jumps:[{pair:'6.0->7.0'|'7.0->7.5', changes:[{lower_form, higher_form, …}]}]}` + `integrity_check`. 2 193 tiêu chí đủ hai cặp; **3 tiêu chí thiếu cặp `6.0->7.0`**: LR của `task1_bricks`, `task1_internet`, `task1_island`. |
| `idea_matrix` / `data` + `selection_matrix` | 479 / 70 | Ma trận ý (Task 2) / số liệu biểu đồ (Task 1: `type`, `title`, `numbers`, `stages`). |
| `review_status` | 530 (`"revised_20261017"`) | **19 bộ không có**: `discussion`, `t1_car_sales_europe`, `t1_vietnam_phones`, `t2_arts_funding`, `t2_competitiveness`, `t2_digital_transactions`, `t2_family_closeness`, `t2_gap_year`, `t2_knowledge_online`, `t2_living_alone`, `t2_mars_research`, `t2_rural_urban_migration`, `t2_student_evaluation`, `task1_bricks`, `task1_internet`, `task1_island`, `tech`, `traffic`, `twopart`. |
| Tiêu đề tiếng Anh ngắn | **0/549** | Không có trường nào. Tên file (`t2_cancer_care_affordable_connected_access`) là khoá nội bộ, không phải tiêu đề. |
| File chấm `.mark.json` | 549 | `essays[band] = {TR, CC, LR, GRA}`, `pairwise`, `note` ("Same model family; not external examiner validation"). Theo `ielts/marking.py` (`ielts_round` = làm tròn nửa lên trung bình bốn tiêu chí; chấp nhận khi lệch ≤ 0,5): **529 bộ** có ít nhất một bài có điểm ước tính khác nhãn — 528 bài nhãn 7.5 ước 8.0, 503 bài nhãn 7.0 ước 7.5, 1 bài nhãn 7.0 ước 6.5, 512 bài nhãn 6.0 ước 6.5; **không bài nào lệch > 0,5**. Tờ thiết kế cấm hiện điểm ước tính từng tiêu chí. |

Ghi chú: tờ thiết kế ghi "Task 2 546 · Task 1 3" là số mẫu; dữ liệu thật là **479 Task 2 · 70 Task 1**. Dữ liệu thắng; giao diện đọc số từ API.

## 3. Phạm vi

**Trong phạm vi:** `/library` (ThuVien); `/library/writing-samples` + `/library/writing-samples/[slug]` (BaiMauWritingDanhSach + BaiMauWriting); `/library/writing-guides` + `/library/writing-guides/[slug]` (KienThucWriting); `/library/speaking` + `/library/speaking/[slug]` (DeSpeakingDanhSach + DeSpeaking); giao diện mới cho `/grammar/**` (NguPhap) giữ nguyên URL và frontmatter; giao diện mới cho `/vocabulary` (TuVung) giữ URL; bảng + script nhập 549 đề; bảng câu trả lời mẫu Speaking; dấu đã đọc/đã lưu; SEO; lối sang khoá học.

**Ngoài phạm vi (thêm 18/11 chiều):** dựng trang Kiến thức nền theo chủ đề, trang Đọc kỹ và khuôn luyện đề (tờ `KienThucNen`, `DocKy`, `KhuonLuyenDe` — prototype; spec ở GOI-13: 0097 Kiến thức nền, 0098 Đọc kỹ, 0099 khuôn luyện đề — hoãn; 00 mục 2 điểm 23). Đã chốt để gói này không làm trái: Kiến thức nền mở công khai và thuộc Thư viện, đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt; Đọc kỹ gắn theo 20 mô đun của dàn 381 bài, chưa có AI nhận xét bản dịch. Khối "Học viên nói gì" (tờ `HocVienNoiGi`) không thuộc Thư viện; khi hiện ở trang sáu khoá online thì KHÔNG ghi là nhận xét của lớp offline (00 mục 2 điểm 23; do G13-A10 dựng — GOI-13 phần A; GOI-05 câu 18, GOI-09 Q34 đã đóng).

**Ngoài phạm vi:** trình soạn Writing và trình luyện Speaking nhận đề điền sẵn (G08); kiểm tra quyền khoá/lượt (API của G04); sản xuất câu trả lời mẫu Speaking — kịch bản, giọng đọc Kokoro, video (repo VIDEO MAKING, không đụng); renderer sơ đồ câu của Grammar Wiki (GOI-11 phần G); mục sidebar "Thư viện công khai" của admin (G09); viết mới bài Grammar/Vocabulary; đổi slug/metadata Grammar; thanh học viên (G03/G07); trang `/vocabulary/hub|practice|exam|learn|sets|study` (G07).

## 4. Yêu cầu (FR)

Chung
- **FR-06-001** Mọi trang Thư viện xem được khi chưa đăng nhập; nội dung chính (đề, ba bài, nhật ký khác biệt, lời thoại, bài ngữ pháp, mục từ) nằm trong HTML server (đọc được khi tắt JS).
- **FR-06-002** Khung theo phiên: khách → thanh + chân trang công khai; đã đăng nhập → thanh học viên, mục "Thư viện" đang chọn. Không chuyển hướng người đã đăng nhập ra/vào khu công khai.
- **FR-06-003** Mỗi trang có đúng một lối sang khoá học (cuối danh sách hoặc cuối bài, không giữa bài, không cửa sổ bật lên); ẩn khi người xem đã có khoá chứa nội dung đó (dữ liệu G04; thiếu dữ liệu → hiện).
- **FR-06-004** Số đếm (số đề, số bài, theo dạng, theo chủ đề) đọc từ API; không có dữ liệu → không hiện số (không "0", không "0/0").
- **FR-06-005** Mọi bộ lọc/tìm ghi vào URL; mở lại URL ra đúng trạng thái; đổi bộ lọc về trang 1.
- **FR-06-005b** (mới, 00 mục 2 điểm 23) `/library` dựng danh sách kệ từ một mảng cấu hình (không gõ cứng năm kệ trong JSX) để thêm kệ "Kiến thức nền" khi gói của trang đó merge mà không sửa bố cục. Ở đợt này mảng chỉ có năm kệ; không hiện kệ trống hay nhãn "Sắp có" cho Kiến thức nền. Test: thêm một kệ giả vào mảng trong test → trang vẽ sáu kệ, không vỡ lưới ở 390px. Kệ thứ sáu `/library/background` (Kiến thức nền) do GOI-13 phần C dựng (G13-C05 thêm vào mảng) (sửa 18/11 theo GOI-13). Chủ đề Kiến thức nền dùng bộ chủ đề riêng (trùng 7 chủ đề Từ vựng), không dùng `library_topics`; nối với bài mẫu/đề Writing (thuộc `library_topics`) bằng bảng liên kết `background_topic_writing_links` của GOI-13 (migration 492).

Bài mẫu Writing
- **FR-06-010** Danh sách: bộ lọc Task (Tất cả · Task 2 · Task 1), Dạng (sáu dạng Task 2; vô hiệu và bị bỏ chọn khi chọn Task 1), Chủ đề (bảng chủ đề có kiểm soát, mục 5.3), ô tìm (tiêu đề + câu đề, không phân biệt hoa thường, sau 300 ms ngừng gõ); tham số URL `task`, `dang`, `chude`, `q`, `trang`.
- **FR-06-011** 12 đề một trang; số thứ tự đếm trong kết quả đang lọc; một trang thì ẩn phân trang; tải giữ đúng 12 dòng chỗ; lỗi giữ bộ lọc và có nút "Tải lại" gọi lại đúng truy vấn; không kết quả → trạng thái rỗng của tờ, giữ bộ lọc.
- **FR-06-012** Mỗi dòng: tiêu đề tiếng Anh ngắn (đậm) + câu đề cắt một dòng (390px: hai dòng); câu đầy đủ có trong HTML; cả dòng là một liên kết.
- **FR-06-013** Trang một đề: mặc định chế độ "Đọc từng bài", bài 7.5; URL giữ chế độ xem, mức điểm, cặp so sánh (`xem`, `muc`, `cap`).
- **FR-06-014** Nhật ký khác biệt: tiêu chí ghi đủ tên tiếng Anh (Task Response/Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy), câu trước (bản cao), câu sau (bản thấp), lý do tiếng Việt; tô/gạch bằng khớp đúng chuỗi trong đoạn; không khớp → chỉ hiện ở lề; lỗi chỉ có ở bản thấp → chỉ gạch cột phải.
- **FR-06-015** Không hiện: mã tiêu chí viết tắt, mã ý, tên dạng viết liền (`problem_solution`), `difficulty_notes`, `integrity_check`, điểm ước tính từng tiêu chí.
- **FR-06-016** Task 1: khối đề có hình; mục 3 là "Đặc điểm chính"; mục nào không có dữ liệu thì bỏ khỏi mục lục và đánh số lại.
- **FR-06-017** Từ vựng trong bài dẫn tới mục từ ở kệ Từ vựng khi mục từ tồn tại; không tồn tại → không có liên kết. Đề liên quan: cùng dạng hoặc cùng chủ đề, tối đa 4. Đề trước/sau theo thứ tự danh sách mặc định.
- **FR-06-018** Chưa có khoá: khối "Tự viết đề này" cuối trang, nút phụ. Có khoá còn lượt: nút chính "Viết đề này" cạnh đề (dẫn tới trình soạn G08 với đề điền sẵn); hết lượt: "Đăng ký thêm lượt chấm".
- **FR-06-019** Một đề chỉ lên trang khi `published = true`; đề bị gỡ trả HTTP 404 (hoặc chuyển 308 nếu đổi slug, mục 5.4).

Kiến thức Writing
- **FR-06-020** Danh sách bốn nhóm cố định Task 1 · Task 2 · Tiêu chí chấm · Dạng đề; một bài ở được hai nhóm với cùng một URL.
- **FR-06-021** Khuôn bài đọc dùng chung với Ngữ pháp: cột chữ 640px Source Serif 4 18/29; mục lục trong trang cột trái 224px, dính, mục đang đọc gạch trái 3px + đậm (390px: khối mở/đóng, mặc định đóng); chú thích lề đánh số mũ, ghi chú cột phải 248px (390px: ngay dưới đoạn).
- **FR-06-022** Đoạn mẫu có chú thích: bấm số ở lề tô đúng cụm, bấm lại bỏ tô; số đánh lại từ 1 trong mỗi đoạn. Trích dẫn bài mẫu lấy từ dữ liệu 549 đề theo mã bài, liên kết mở đúng đề + đúng bản; bài mẫu bị gỡ thì ẩn trích dẫn.
- **FR-06-023** Ngày cập nhật = lần sửa nội dung gần nhất (`updated_at`), không phải ngày đăng.

Đề Speaking
- **FR-06-030** Danh sách: lọc Part (Tất cả/1/2/3), chủ đề (một), công tắc "Chỉ đề có video trả lời mẫu", ô tìm 300 ms; URL `part`, `chude`, `video`, `q`; kết hợp "và"; nhóm theo chủ đề, trong nhóm Part 1 → 2 → 3 rồi theo tên; nhóm rỗng sau lọc ẩn cả tiêu đề.
- **FR-06-031** Tình trạng video luôn bằng chữ: "Có video trả lời mẫu" + thời lượng, hoặc "Chưa có video" + "câu trả lời mẫu dạng audio" / "dạng chữ". Đề chưa có câu trả lời mẫu nào thì không lên kệ. Câu trả lời mẫu (video, audio, lời thoại có mốc thời gian) do repo VIDEO MAKING sản xuất; web chỉ hiển thị, không tạo và không sửa nội dung.
- **FR-06-036** (mới) Mọi nơi phát câu trả lời mẫu Speaking (trang đề, thẻ ở danh sách khi có nút nghe) ghi nhãn chữ **"Giọng đọc tổng hợp"** cạnh trình phát — giọng là giọng máy (Kokoro), không phải người thật; nhãn luôn hiện, không chỉ trong tooltip. Không gắn band cho câu trả lời mẫu.
- **FR-06-032** Trang đề: video nguồn YouTube nhúng `youtube-nocookie.com`, đọc vị trí qua YouTube IFrame API để tô câu; nguồn máy chủ riêng dùng `<video>` của mình, nhớ vị trí (theo đề, trong trình duyệt). Không tự phát ở cả hai nguồn.
- **FR-06-033** Câu đang phát = câu có mốc bắt đầu lớn nhất ≤ thời điểm hiện tại; bấm câu → tua tới mốc và phát; video lỗi → mốc thành chữ thường không bấm được. Không có video → mục 2 thành "Câu trả lời mẫu" với audio thu gọn (không audio → bỏ mốc); không bao giờ có khung video trống.
- **FR-06-034** Đánh dấu "Từ vựng đáng học" (nền nhạt + gạch đôi) và "Cấu trúc đáng học" (gạch liền), luôn có số và nhãn chữ ở lề. Câu trả lời mẫu không gắn band.
- **FR-06-035** "Luyện nói đề này": có khoá còn lượt Speaking → nút chính mở trình luyện với đề này (G08); hết lượt → "Hết lượt chấm AI" + đường xem khoá; chưa có khoá → nút phụ "Xem các khoá". Đề trước/sau theo thứ tự trong chủ đề rồi sang chủ đề kế.

Ngữ pháp
- **FR-06-040** Mọi URL `/grammar`, `/grammar/[category]/[slug]`, `/grammar/search`, `/grammar/compare`, `/grammar/roadmap`, `/grammar/exercises` giữ nguyên và trả cùng mã HTTP như trước (bài lạ vẫn HTTP 404 qua `proxy.ts`); frontmatter không đổi trong gói này. Giao diện theo **ba tờ**: `GrammarWiki` (trang chủ: cây chủ đề 10 nhóm theo `_groups.yaml`, hai chế độ `?mode=`, tìm, "Lỗi hay gặp", một khối mời khoá cuối trang), `GrammarWikiBai` (trang bài: H1 tách Anh/Việt, mục lục theo H2, tự kiểm tra, bài liên quan, khối "Trong khoá"/"Đăng ký lại" lấy nhãn từ `course-access-labels.mjs`), `GrammarWikiMinhHoa` (chuẩn hình của sơ đồ câu). Tờ `NguPhap` là mẫu khuôn bài đọc chung; chỗ hai tờ khác nhau thì ba tờ GrammarWiki* thắng cho trang Grammar.
- **FR-06-044** (mới, khớp GOI-11 phần G) Sơ đồ câu trong bài Grammar là khối `figure` do **renderer của GOI-11 (G11-T33)** dựng ở backend và trả sẵn trong `html` của bài; G06 không viết renderer, không vẽ hình, không thêm ảnh minh hoạ hay tranh khắc (minh hoạ của web là sơ đồ câu chữ — 00 mục 2 điểm 22). Việc của G06: khuôn bài (T07, T14) không làm hỏng `<figure class="gw-fig …">`, chú thích "Hình N" ở lề phải (điện thoại: ngay dưới hình), và nạp CSS sơ đồ của GOI-11 trên trang bài. G11-T33 chưa merge → bài hiện như hôm nay, không có hình.
- **FR-06-041** Mục lục bài: mặc định "Theo nhóm"; "A–Z" theo tên tiếng Việt, chữ cái không có bài mờ và không bấm được; ô tìm lọc khi gõ, bỏ dấu vẫn khớp, khớp cả tên tiếng Anh; không kết quả → nêu từ đã tìm + nút xoá.
- **FR-06-042** Kiểm tra nhanh chạy ở trình duyệt, không gửi, không lưu; còn câu trống → báo số câu chưa chọn, không chấm; đổi đáp án sau chấm → xoá kết quả cũ.
- **FR-06-043** "Đã đọc" chỉ người đã đăng nhập thấy, tự bấm, bỏ được.

Từ vựng
- **FR-06-050** `/vocabulary` giữ URL; mục từ mở bằng `?cat=&slug=` như hiện tại; canonical của mục từ là chính URL `/vocabulary?cat=<cat>&slug=<slug>` (không còn trỏ chung về `/vocabulary`).
- **FR-06-051** Gợi ý tra từ hiện từ ký tự thứ hai, tối đa 5 dòng, khớp đầu từ trước rồi dạng chia; ↑ ↓ chọn, Enter mở, Esc đóng; "Tra từ" khi không chọn dòng → trang kết quả. Không thấy → tối đa 3 từ gần giống (khoảng cách chỉnh sửa); không có → mẹo + lối A–Z, chủ đề.
- **FR-06-052** Nút nghe không tự phát; đang phát → nền mực + nhãn "Dừng"; lỗi tải → nút vô hiệu, dòng "Chưa tải được âm thanh"; IPA luôn font Source Sans 3, giữ "ɡ" (U+0261).
- **FR-06-053** "Lưu vào sổ từ": khách → lời nhắc ngay dưới nút dẫn tới đăng nhập kèm `next` + ý định lưu; sau đăng nhập về đúng mục từ và lưu luôn; đã đăng nhập → bật/tắt tại chỗ, "Đang lưu…".
- **FR-06-054** Phần không có dữ liệu ẩn cả phần và bỏ khỏi mục lục; "Trong bài mẫu Writing" chỉ hiện khi từ có trong ít nhất một bài mẫu đã xuất bản, liên kết mở bài và tô từ đó.

Trạng thái đã đăng nhập, SEO
- **FR-06-060** Đã đăng nhập: danh sách Writing thêm cột "Của bạn" và nhóm lọc "Của bạn" (đã đọc, đã lưu); danh sách Speaking thêm cột "Bạn" và công tắc "Chỉ đề chưa luyện" (mục 10 câu 6); dấu luôn kèm chữ.
- **FR-06-061** Dấu đã đọc/đã lưu ghi ở server, chỉ chủ tài khoản đọc/ghi được; tài khoản chưa có mã lớp (`is_active=false`) vẫn dùng được.
- **FR-06-062** Sitemap có `/library`, các trang danh sách, mọi trang đề Writing/Speaking và bài Kiến thức đã xuất bản; `robots` cho phép `/library`; mỗi trang có `title`, `description`, `canonical` theo mục 5.4.

## 5. Hợp đồng kỹ thuật

### 5.1 Route frontend

| Đường dẫn | Route group | Dữ liệu (server, cache) | Ghi chú |
|---|---|---|---|
| `/library` | `(public-library)` mới | `GET /api/library/summary` | Không phải AuthedShell → không thêm vào `proxy.ts` matcher. |
| `/library/writing-samples` | `(public-library)` | `GET /api/library/writing-samples?task&dang&chude&q&trang` | |
| `/library/writing-samples/[slug]` | `(public-library)` | `GET /api/library/writing-samples/{slug}` | Không có `loading.tsx` (để `notFound()` ra HTTP 404 thật — xem G05-T05). |
| `/library/writing-guides`, `/[slug]` | `(public-library)` | `GET /api/library/writing-guides`, `/{slug}` | |
| `/library/speaking`, `/[slug]` | `(public-library)` | `GET /api/library/speaking`, `/{slug}` | CSP riêng cho trang có YouTube (5.6). |
| `/grammar/**` | giữ `(public-content)` | giữ `lib/grammar-api.ts` | Chỉ đổi giao diện. |
| `/vocabulary` | giữ `(public-content)` | giữ `lib/vocabulary-api.ts` | Chỉ đổi giao diện + canonical. |

Layout `(public-library)` gắn `AuthProvider` **không** `activationGate` (người chưa có mã vẫn đọc và đánh dấu được). Dùng khuôn bài đọc G06-T07 và khung G03. Không nạp `grammar-wiki.css`/`vocab-wiki.css` cũ.

### 5.2 Bảng mới (một migration; số xin ở sổ — `backend/migrations/README.md` ghi số kế tiếp 381 "subject to the shared migration register")

`writing_samples`
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | pk, `gen_random_uuid()` |
| `source_key` | text | not null unique — `stem` của file trong `incoming/` (khoá ổn định, không hiện) |
| `slug` | text | not null unique, `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 80 ký tự |
| `title_en` | text | not null, 3–70 ký tự, không chứa ký tự tiếng Việt có dấu |
| `task_type` | text | `check (task_type in ('task1_academic','task2'))` |
| `question_type` | text null | Task 2: `in ('opinion','discussion','problem_solution','advantages_disadvantages','two_part','positive_negative')`; Task 1: null |
| `task1_subtype` | text null | Task 1: `in ('bar','line','pie','table','process','map','mixed')`; Task 2: null |
| `topic_slug` | text | not null, thuộc bảng chủ đề `library_topics` (FK) |
| `prompt_text` | text | not null |
| `prompt_image_path` | text null | đường dẫn trong bucket công khai `library-public` (5.5); Task 1 bắt buộc khi `published` |
| `essays` | jsonb | not null; khoá `7.5`, `7.0`, `6.0`, mỗi bài `{text, word_count, outline, vocab_table, structures}` |
| `delta_75_70`, `delta_70_60` | jsonb | not null, mảng |
| `justification` | jsonb | not null, chỉ `by_criterion` (bỏ `integrity_check`) |
| `task1_data` | jsonb null | `data` của Task 1 |
| `content_hash` | text | not null — sha256 của JSON chuẩn hoá phần được nhập |
| `source_review_status` | text null | giá trị `review_status` của nguồn |
| `published` | boolean | not null default false |
| `published_at`, `created_at`, `updated_at` | timestamptz | `updated_at` đổi khi nội dung đổi |

Ràng buộc chéo: `check ((task_type='task2' and question_type is not null and task1_subtype is null) or (task_type='task1_academic' and question_type is null and task1_subtype is not null))`. Chỉ mục: `(published, task_type, question_type, topic_slug)`; tìm kiếm: `title_en`/`prompt_text` qua `ilike` (549 dòng, đủ) — không thêm extension.

`writing_sample_slug_history(old_slug text pk, sample_id uuid fk, changed_at)` — để chuyển 308 khi đổi slug sau xuất bản.

`library_topics(slug text pk, label_vi text not null, shelf text check (shelf in ('writing','speaking')), display_order int)` — bảng chủ đề có kiểm soát dùng cho bộ lọc.

`speaking_samples`
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | pk |
| `slug` | text | unique |
| `topic_id` | uuid null | FK `topics(id)` khi đề có trong ngân hàng luyện (để mở trình luyện) |
| `part` | smallint | `in (1,2,3)` |
| `title_en`, `title_vi` | text | `title_vi` là dòng phụ dịch nghĩa (tờ DeSpeaking cho phép) |
| `topic_slug` | text | FK `library_topics` |
| `cue_card` | jsonb null | Part 2: `{prompt, bullets[], reflection}`; Part 1/3: `{questions[]}` |
| `video_source` | text null | `in ('youtube','self_hosted')` |
| `youtube_id` | text null | `^[A-Za-z0-9_-]{11}$` khi `video_source='youtube'` |
| `video_url` | text null | https, khi `self_hosted` |
| `duration_s` | int null | |
| `transcript` | jsonb | not null; `[{start_ms|null, text, marks:[{kind:'vocab'|'structure', start, end, note}]}]` |
| `sample_text` | text | not null — câu trả lời mẫu dạng chữ (bắt buộc: đề không có thì không lên kệ) |
| `audio_path` | text null | bucket `library-public` |
| `outline`, `vocabulary`, `related_part3` | jsonb | |
| `source_note` | text null | "Nguồn đề: …" |
| `published`, `published_at`, `created_at`, `updated_at` | | |

`library_marks(user_id uuid fk users on delete cascade, shelf text check (shelf in ('writing_sample','speaking_sample','writing_guide','grammar_article')), item_key text, kind text check (kind in ('read','saved')), created_at timestamptz default now(), primary key (user_id, shelf, item_key, kind))`. Grammar "đã lưu" **giữ** `saved_articles` hiện có (admin thống kê đang đọc nó, `backend/routers/admin.py` khoảng dòng 5967–6133); `library_marks` chỉ thêm `grammar_article/read`.

RLS: bật trên cả năm bảng; không policy cho `anon`/`authenticated`; `REVOKE ALL … FROM anon, authenticated` theo mẫu migration gần nhất (ví dụ `backend/migrations/376_blackeye_admission.sql`); mọi đọc/ghi qua backend `service_role`. Có file rollback trong `backend/migrations/rollback/`.

### 5.3 Bảng chủ đề

`prompt.domain` có 480 giá trị cho 549 bộ nên không dùng trực tiếp. Nhiệm vụ nội dung G06-T04 lập `backend/content/library/topics.json` (12–16 chủ đề, `slug` tiếng Anh không dấu, `label_vi`) và gán mỗi bộ một `topic_slug` trong manifest. Danh sách chủ đề do người duyệt chốt (mục 10 câu 3).

### 5.4 Slug, tiêu đề, metadata

- `slug` = `title_en` chuyển chữ thường, bỏ ký tự không phải `[a-z0-9]`, nối bằng `-`, tối đa 80 ký tự, cắt ở ranh giới từ; trùng → thêm `-task1`/`-task2`, rồi `-2`, `-3`. Slug **đóng băng** sau khi `published`; đổi phải ghi `writing_sample_slug_history` và trang cũ chuyển 308.
- `<title>`: `"<title_en> — IELTS Writing Task 2: bài mẫu 7.5, 7.0, 6.0 | Aver Learning"` (Task 1: `"Task 1"`). `description`: 150 ký tự đầu của `prompt_text` + " Ba bài mẫu 7.5, 7.0, 6.0 kèm phân tích khác biệt." `canonical`: `/library/writing-samples/<slug>`. `openGraph.title` = `title_en`. Breadcrumb: Thư viện › Bài mẫu Writing › `title_en` rút gọn 40 ký tự.
- Speaking: `"<title_en> — IELTS Speaking Part N: câu trả lời mẫu | Aver Learning"`.
- Danh sách có bộ lọc: `canonical` về URL không tham số; trang `q=` → `robots: noindex, follow` (giống `/grammar/search` đang làm — test `frontend/tests/next-metadata.test.mjs` "public query workspaces are noindex").

### 5.5 Ảnh Task 1 và audio công khai

Bucket mới `library-public` (đọc công khai, ghi chỉ `service_role`), khai cỡ/kiểu trong `backend/services/storage_limits.py` theo STORAGELIMITS-0038 (png/webp ≤ 2 MB; audio mp3/m4a ≤ 10 MB). Không chuyển ảnh sang bucket `writing-images` (riêng tư; đổi nó thành công khai sẽ lộ ảnh đề thi thử `exam_only`). Đường dẫn: `writing-samples/<slug>/figure.png` (lưu theo `source_key` để đổi slug không phải đổi ảnh: `writing-samples/<source_key>/figure.png`).

### 5.6 CSP cho video

Thêm có giới hạn trong `frontend/tooling/content-security-policy.mjs`: `frame-src https://www.youtube-nocookie.com` và `script-src … https://www.youtube.com` (IFrame API tải `https://www.youtube.com/iframe_api` rồi `https://www.youtube.com/s/player/...`) — **chỉ** cho route `/library/speaking/:slug` qua `headers()` trong `next.config.ts` (mẫu `EMBEDDABLE_SAME_ORIGIN_ROUTES`), không mở cho toàn site. Video máy chủ riêng: `media-src` đã cho `https:`. Cập nhật `docs/CONTENT_SECURITY_POLICY.md`. Đây là thay đổi bảo mật: PR riêng, ghi rõ trong thân PR.

### 5.7 API công khai (backend, router mới `backend/routers/library.py`, prefix `/api/library`)

| Method · path | Auth | Trả về | Ghi chú |
|---|---|---|---|
| `GET /summary` | không | `{writing_samples:{total, task2, task1}, writing_guides:{total}, speaking:{total, with_video}, grammar:{total}, vocabulary:{total}}` (trường null khi không đếm được) | Dùng cho `/library`. |
| `GET /writing-samples` | không | `{items:[{slug,title_en,task_type,question_type,task1_subtype,topic_slug,prompt_text}], total, page, page_size:12, facets:{task:{…}, question_type:{…}, topic:{…}}}` | Tham số `task`, `dang`, `chude`, `q` (≤ 100 ký tự), `trang` ≥ 1; sai → 422. |
| `GET /writing-samples/{slug}` | không | toàn bộ bộ đề đã chọn trường (không có `source_key`, `content_hash`, `source_review_status`) + `related[≤4]`, `prev`, `next`, `figure_url` | Slug cũ → 308 `Location` tới slug mới; không có → 404 JSON `{"detail":"sample_not_found"}`. |
| `GET /writing-samples/index` | không | `[{slug, updated_at}]` | Cho sitemap. |
| `GET /writing-guides`, `/{slug}` | không | bài `writing_tips` `published` có `content_type in ('knowledge','tip')`, kèm `groups[]` (mục 10 câu 4) | Không động vào hai route học viên hiện có. |
| `GET /speaking`, `/{slug}`, `/speaking/index` | không | tương tự | Chỉ `published` và `sample_text` không rỗng. |
| `GET /me/marks?shelf=` | có | `{marks:[{item_key, kind}]}` | Exempt khỏi cổng kích hoạt (tài khoản chưa có mã dùng được). |
| `PATCH /me/marks/{shelf}/{item_key}/{kind}` · `DELETE` cùng path | có | `204` | Idempotent; `item_key` phải tồn tại và `published` (không cho ghi rác). |

Mọi GET công khai: `cacheable_json` + `Last-Modified` từ `max(updated_at)`; thêm vào `ACTIVATION_EXEMPT_ROUTES` (lý do: "public Library"). Router đăng ký với `dependencies=_ACTIVE_LEARNER` như mọi router học viên (`backend/main.py` dòng 266), để một route thêm sau này mà quên khai báo thì mặc định bị cổng chặn; mọi route của bảng trên (kể cả `me/*`) được thêm vào `ACTIVATION_EXEMPT_ROUTES` có chủ đích. Sinh lại `frontend/types/api.d.ts`.

### 5.8 Script nhập `backend/scripts/import_writing_samples.py`

Theo khuôn `import_writing_prompts.py`:

- Đầu vào: `--source <thư mục incoming>` (mặc định không có — bắt buộc truyền), `--manifest backend/content/library/writing-samples-manifest.json`, `--figures <thư mục sources/task1_figures>`.
- Manifest (trong repo, nguồn sự thật cho phần do người quyết): `[{source_key, slug, title_en, topic_slug, publish: true|false, review:{status:'approved'|'needs_review'|'excluded', by, at, note}}]`. Nội dung bài **không** chép vào repo (30 MB, mục 10 câu 2); script đọc từ `--source` và ghi `content_hash` vào manifest khi chạy `--write-hashes`.
- Chế độ: `--check` (chỉ kiểm, không cần DB), mặc định dry-run (kiểm + kế hoạch INSERT/UPDATE/UNPUBLISH so với staging), `--execute` (áp dụng rồi lập lại kế hoạch từ bản đọc mới; còn khác biệt → exit ≠ 0). `assert_staging(SUPABASE_URL)` như mẫu; production cần thay đổi riêng được duyệt.
- Kiểm hợp lệ (mã lỗi in một dòng mỗi bộ, tổng kết cuối; lỗi chặn → bộ đó không được `publish`):

| Mã | Điều kiện | Mức | Số bộ hiện tại |
|---|---|---|---|
| `E_NO_REVIEW` | `review_status` thiếu và manifest chưa có `review.status='approved'` | chặn | 19 (T19 rà và duyệt) |
| `E_NO_TITLE` | manifest thiếu `title_en`, hoặc dài > 70, hoặc có chữ Việt có dấu, hoặc trùng | chặn | 549 (trước T05) |
| `E_SLUG` | slug sai mẫu/trùng | chặn | — |
| `E_TYPE` | Task 2 thiếu/sai `question_type`; Task 1 thiếu/sai `subtype`; Task 1 có `question_type` | chặn | 0 |
| `E_TOPIC` | `topic_slug` không có trong `topics.json` | chặn | 549 (trước T04) |
| `E_FIGURE` | Task 1 thiếu `image_path` hoặc file ảnh không đọc được | chặn | 3 (`task1_bricks`, `task1_internet`, `task1_island`) — T19 vẽ hình |
| `E_PAIR` | một tiêu chí trong `justification.by_criterion` không có đủ hai cặp `6.0->7.0`, `7.0->7.5` | chặn | 3 (LR của ba bộ trên) — T19 bổ sung |
| `E_ESSAYS` | thiếu một trong ba bài, `text` rỗng, hoặc thiếu `outline`/`vocab_table` | chặn | 0 |
| `E_BAND_FAR` | điểm ước tính (công thức `ielts_round` của `ielts/marking.py`) lệch nhãn > 0,5 | chặn | 0 |
| `W_BAND_NEAR` | điểm ước tính khác nhãn nhưng ≤ 0,5 | cảnh báo, in danh sách cho người duyệt | 529 bộ |
| `W_DELTA_MATCH` | `before`/`after` của nhật ký không khớp nguyên văn trong bài (giao diện sẽ chỉ hiện ở lề) | cảnh báo | CHƯA KIỂM — script đếm |
| `W_HASH` | `content_hash` khác manifest (nguồn đã đổi sau duyệt) | chặn cho tới khi người duyệt xác nhận lại | — |

- Không đọc/ghi `ielts.db`; không chạy lệnh nào trong repo `ielts-pipeline` (chỉ đọc file).
- **Ghi bản ghi lô (khớp G09-T36):** mỗi lần chạy `--execute` gọi helper `backend/services/import_batch_log.py` của G09 — `start(script='import_writing_samples', skill='writing', mode)` → `add_item(batch, kind='writing_sample', id=<source_key>, action='insert'|'update'|'unpublish'|'skip')` cho từng bộ → `finish(batch, counts, error_report_path)`. Lỗi ghi lô **không** làm hỏng lần nhập (helper đã bọc try/except). `--check` và dry-run không ghi lô. `import_speaking_samples.py` (T13) làm cùng cách với `skill='speaking'`. G09-T36 chưa merge (chưa có bảng 449–450 và helper) → script chạy không ghi lô, in một dòng cảnh báo; nối helper trong PR nhỏ sau. Thẻ "Lô nhập" của admin (G09-T37) và thẻ `import` của `/admin/library` (T20) đọc các bản ghi này.
- Không nhập trường ghi chú nội bộ (`difficulty_notes`, `integrity_check`, file `.mark.json`).

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

### G06-T01 — Soạn thư mục spec `LIBRARY`, mở PR spec, dừng chờ duyệt
- Đầu vào: `specs/_templates/*`, `specs/README.md`, file này.
- Việc làm: tạo `specs/NNNN-public-library/` gồm `spec.md` (FR-06-*), `plan.md` (mục 5), `tasks.md` (mục 6, chỉ nhiệm vụ mã), `verification.md` (mục 9 dạng Given/When/Then), `rollout.md` (thứ tự: migration staging → API → trang → nội dung → bật sitemap; cách tắt: `published=false` hàng loạt), `ui-states.md` (rỗng/tải/lỗi/390px từng màn); "Open questions" = mục 10; thêm dòng "Active index" trạng thái `draft`; `python backend/scripts/validate_specs.py`.
- Nghiệm thu: script qua; mỗi FR có dòng kiểm. Không làm: không viết mã, không tự duyệt.
- Ước lượng: 1 phiên · 2.

### G06-T02 — Migration bảng Thư viện (high-risk)
- Đầu vào: mục 5.2, 5.5; `backend/migrations/README.md`; migration mẫu có REVOKE.
- Việc làm: một migration tạo `library_topics`, `writing_samples`, `writing_sample_slug_history`, `speaking_samples`, `library_marks` + rollback; bucket `library-public` + khai trong `services/storage_limits.py`; test `backend/tests/test_library_schema.py` (ràng buộc chéo task/type, slug sai mẫu bị từ chối, `anon` không đọc được bảng nào, `library_marks` khoá chính chống trùng).
- Nghiệm thu: `cd backend && python -m pytest tests/test_library_schema.py tests/test_public_schema_create_guard.py -q` qua; bộ backend đầy đủ qua; chạy migration trên staging bằng runner có khoá (AGENTS.md "Staging-first") trước khi merge mã dùng bảng.
- Không làm: không đổi `writing_prompts`, `topics`, `writing_tips`.
- Vướng mắc → cách gỡ: (a) Số migration: lấy trong dải 400–419 đã cấp cho G06 ở `01-KE-HOACH-TONG.md` mục 6 (381–389 là của G04); ghi vào sổ đăng ký trong repo. (b) Test bucket (STORAGELIMITS-0038) đòi mọi bucket có giới hạn → thêm cả trong migration (`storage.buckets.file_size_limit`, `allowed_mime_types`) và `storage_limits.py`, chạy test của spec 0038 (`grep -l "storage_limits" backend/tests`).
- Ước lượng: 1,5 phiên · 4.

### G06-T03 — Script nhập 549 đề, chế độ `--check` trước (feature)
- Đầu vào: mục 2.2, 5.8; `backend/scripts/import_writing_prompts.py`; vài file mẫu: `incoming/advdis.json`, `incoming/t2_cancer_care_affordable_connected_access.json`, `incoming/t1_*.json`, `incoming/task1_bricks.json`, `ielts/marking.py` (hàm `ielts_round`).
- Việc làm: viết script; test `backend/tests/test_import_writing_samples.py` với thư mục fixture nhỏ tự tạo (một Task 2 đủ, một Task 1 thiếu ảnh, một thiếu `review_status`, một thiếu cặp, một trùng slug) — fixture là dữ liệu bịa, ngắn, không chép bài thật; mỗi mã lỗi ở bảng 5.8 có một test; dry-run không ghi DB (DB giả của test); `--execute` + đọc lại.
- Nghiệm thu: test qua; chạy `python -m scripts.import_writing_samples --check --source "<incoming>" --manifest …` trên máy anh Andy (người chạy hoặc người thực thi có quyền đọc ổ) in đúng các số ở cột "Số bộ hiện tại" (19 `E_NO_REVIEW`, 3 `E_FIGURE`, 3 `E_PAIR`, 529 `W_BAND_NEAR`).
- Không làm: không ghi `ielts.db`; không gọi AI.
- Vướng mắc → cách gỡ: (a) Worktree của người thực thi nằm ngoài ổ ngoài → `--source` là tham số bắt buộc, không ghi cứng đường dẫn `/Volumes/...` trong mã. (b) JSON chuẩn hoá cho `content_hash`: `json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',',':'))` trên đúng các trường được nhập, để đổi thứ tự khoá không làm "đổi nội dung".
- Ước lượng: 2 phiên · 4.

### G06-T04 — (content) Rà dữ liệu 549 đề và lập bảng chủ đề
- Đầu vào: kết quả `--check` của T03; mục 2.2.
- Việc làm: 1) lập `backend/content/library/topics.json` (đề xuất 12–16 chủ đề; mỗi chủ đề `slug`, `label_vi`); 2) gán `topic_slug` cho 549 bộ trong manifest (dựa `prompt.domain` + câu đề; người thực thi làm bản đề xuất, ghi cột "độ chắc"); 3) 19 bộ `E_NO_REVIEW` và 3 bộ `task1_*` (thiếu ảnh + thiếu cặp): **không loại** — chuyển sang T19 (đội thực hiện rà và tạo luôn, 00 mục 2 điểm 20); ở nhiệm vụ này chỉ gán `topic_slug` và để `review.status='needs_review'`; 5) xuất danh sách `W_BAND_NEAR` (529) thành tệp CSV cho người duyệt xem mẫu ngẫu nhiên 20 bộ.
- Đầu ra: PR `content` chỉ chứa `topics.json`, manifest (cột `topic_slug`, `review`), và mô tả trong thân PR; tệp CSV đính vào PR (không commit nếu > 1 MB).
- Nghiệm thu: `--check` không còn `E_TOPIC`; mỗi bộ có `review.status`; người duyệt ghi tên và ngày vào `review.by/at`.
- Không làm: không sửa nội dung bài; việc rà và đặt `approved` cho 19 bộ làm ở T19 theo quy trình ghi ở đó, không làm lẫn ở PR này.
- Ước lượng: 2 phiên · 2.

### G06-T05 — (content) Đặt tiêu đề tiếng Anh ngắn cho 549 đề, có người duyệt
- Đầu vào: manifest sau T04; quy tắc: tiếng Anh, < 70 ký tự, khác nguyên văn đề, nêu đúng vấn đề của đề (ví dụ "Working from home: benefits versus drawbacks"), không dấu hai chấm kép, không tên dạng đề viết liền, không chữ Việt.
- Việc làm: người thực thi soạn `title_en` cho từng bộ trong một phiên làm việc (không gọi AI trả phí qua backend); sinh `slug` theo 5.4; chạy `--check` để bắt trùng/quá dài; xuất bảng duyệt (stem · câu đề · title_en · slug); người biên soạn duyệt, sửa trực tiếp vào manifest hoặc trả danh sách sửa; người thực thi áp dụng.
- Nghiệm thu: `--check` không còn `E_NO_TITLE`/`E_SLUG`; mọi dòng có dấu duyệt.
- Vướng mắc → cách gỡ: Task 1 có `data.title` (tiêu đề biểu đồ) — chỉ dùng làm gợi ý, vẫn phải là tiêu đề ngắn của đề; slug trùng do đề na ná → thêm từ phân biệt vào tiêu đề, không chỉ thêm `-2`.
- Ước lượng: 2 phiên · 2.

### G06-T06 — API công khai Bài mẫu Writing + tóm tắt Thư viện
- Đầu vào: mục 5.7; `backend/services/public_cache.py`; `backend/routers/vocabulary.py` (mẫu router công khai có cache).
- Việc làm: `backend/routers/library.py` (`/summary`, `/writing-samples`, `/writing-samples/{slug}`, `/writing-samples/index`); đăng ký trong `backend/main.py`; exempt; test `backend/tests/test_library_writing_api.py` (bộ `published=false` không lộ ở mọi route; không có trường cấm; 308 slug cũ; facet đếm đúng; `q` dài 101 → 422; header cache); sinh lại `api.d.ts`.
- Nghiệm thu: test + `test_activation_gate_inventory.py` + `test_public_cache_headers.py` qua.
- Vướng mắc → cách gỡ: facet theo chủ đề khi lọc theo dạng phải đếm trong tập đã lọc khác (chuẩn "faceted": đếm mỗi nhóm khi bỏ chính nhóm đó) → viết rõ trong docstring và test; 549 dòng nên đếm bằng truy vấn đơn, không cần bảng tổng hợp.
- Ước lượng: 1,5 phiên · 3.

### G06-T07 — Khuôn trang bài đọc dùng chung (KienThucWriting + NguPhap)
- Đầu vào: `thiet-ke/KienThucWriting.dc.html`, `thiet-ke/NguPhap.dc.html` (ghi chú: một khuôn cho hai kệ); component G03.
- Việc làm: `frontend/components/library/reading-layout.tsx` (cột chữ 640px, mục lục trái 224px dính + theo dõi mục đang đọc, cột ghi chú phải 248px, 390px: mục lục mở/đóng mặc định đóng, ghi chú dưới đoạn), `margin-note.tsx` (số mũ, đánh lại từ 1 mỗi đoạn mẫu, bấm tô/bỏ tô), `course-link-line.tsx` (một dòng lối sang khoá, ẩn khi có khoá); CSS module dùng `--av2-*`.
- Nghiệm thu: test React: mục lục cập nhật mục đang đọc (mô phỏng `IntersectionObserver`); bấm số chú thích tô đúng `data-anchor`; 390px mục lục đóng.
- Không làm: không đổi route Grammar ở nhiệm vụ này.
- Ước lượng: 1,5 phiên · 3.

### G06-T08 — Trang tổng `/library`
- Đầu vào: `thiet-ke/ThuVien.dc.html` (tờ không có mục "Ghi chú cho lập trình": dựng theo bố cục tờ, áp FR chung 001–005; ghi trong PR "tờ không có ghi chú lập trình").
- Việc làm: `frontend/app/(public-library)/layout.tsx`, `library/page.tsx` (năm kệ, số đếm từ `/summary`, đoạn mẫu một đề Writing đọc từ API); dòng `docs/SITE_OVERVIEW.md`.
- Nghiệm thu: khách và người đã đăng nhập đều xem được; `curl -s localhost:3000/library | grep -c 'Bài mẫu Writing'` ≥ 1; không hiện "0".
- Vướng mắc → cách gỡ: `/library` cũng là mục 5 thanh học viên (G07) — cùng một trang; G07 không tạo route `/library` thứ hai trong AuthedShell (route trùng làm `next build` lỗi "two parallel pages"). Ghi phối hợp trong PR.
- Ước lượng: 1 phiên · 2.

### G06-T09 — Danh sách Bài mẫu Writing
- Đầu vào: `thiet-ke/BaiMauWritingDanhSach.dc.html`; T06.
- Việc làm: `library/writing-samples/page.tsx` (server render trang đầu theo `searchParams`), phần client cho bộ lọc (ghi URL bằng `router.replace`, debounce 300 ms), phân trang 12, giữ chỗ 12 dòng khi tải, lỗi + "Tải lại", rỗng; cột "Của bạn" + nhóm lọc "Của bạn" sau khi có T16 (ẩn khi chưa).
- Nghiệm thu: test React: chọn Task 1 → nhóm dạng vô hiệu và bỏ dạng đang chọn; đổi bộ lọc → `trang` về 1; một trang → không có phân trang; URL có `?task=task2&dang=opinion&q=work` mở ra đúng trạng thái (render server).
- Vướng mắc → cách gỡ: `searchParams` là Promise trong Next 16 (xem `app/(public-content)/vocabulary/page.tsx` dùng `await searchParams` + `connection()`) → làm theo đúng mẫu đó để `next build` không cần backend.
- Ước lượng: 1,5 phiên · 3.

### G06-T10 — Trang một bài mẫu Writing
- Đầu vào: `thiet-ke/BaiMauWriting.dc.html` (đủ ghi chú); T06, T07; lối vào chấm thử của G05-T21 (`trial-entry-model.mjs`).
- Thêm 18/11 theo rà soát (HV-07): khối "Chấm thử miễn phí đề này" dùng lối vào chấm thử của G05-T21 với đề điền sẵn; ẩn theo trạng thái của `public-config` (G11-T15).
- Việc làm: `library/writing-samples/[slug]/page.tsx` + `generateMetadata` (5.4); ba chế độ xem (đọc từng bài · so sánh cặp · …theo tờ), URL `xem/muc/cap`; hàm thuần `frontend/lib/delta-highlight.mjs`: nhận đoạn văn + danh sách `before/after` → đoạn có vùng tô hoặc "chỉ ở lề"; dàn ý, bảng từ vựng (liên kết tới `/vocabulary?cat=&slug=` chỉ khi mục từ tồn tại — tra một lần bằng `GET /api/vocabulary/search`, kết quả cache), đề liên quan ≤ 4, đề trước/sau, khối "Tự viết đề này"/"Viết đề này" (FR-06-018; khi G08 chưa có tham số đề điền sẵn thì "Viết đề này" dẫn tới trình soạn không điền sẵn và PR ghi `CHỜ G08`).
- Nghiệm thu: test `delta-highlight` (khớp đúng chuỗi, không khớp → lề, lỗi chỉ ở bản thấp → chỉ cột phải, chuỗi trùng hai lần trong đoạn → tô lần đầu); slug lạ → `curl` 404; HTML server chứa đủ ba bài; không chuỗi `problem_solution|TR:|CC:|LR:|GRA:` trong HTML (`grep`).
- Vướng mắc → cách gỡ: khớp chuỗi vướng dấu nháy cong/thẳng và khoảng trắng kép → chuẩn hoá cả hai phía (NFC, gộp khoảng trắng, nháy về một dạng) trước khi tìm, nhưng tô trên văn bản gốc theo chỉ số ánh xạ.
- Ước lượng: 2,5 phiên · 4.

### G06-T11 — Kiến thức Writing
- Đầu vào: `thiet-ke/KienThucWriting.dc.html`; bảng `writing_tips`; T07.
- Việc làm: API `GET /api/library/writing-guides`, `/{slug}` (đọc `writing_tips` `published`, `content_type in ('knowledge','tip')`); ánh xạ bốn nhóm (mục 10 câu 4); trang danh sách + trang bài dùng khuôn T07; trích dẫn bài mẫu: cú pháp trong `body_markdown` `[[sample:<slug>#<band>]]` thay bằng trích đoạn lấy từ `writing_samples` (bài gỡ → bỏ trích); `updated_at` làm ngày cập nhật.
- Nghiệm thu: test API (bài nháp không lộ); test thay thẻ trích dẫn; trang 390px.
- Vướng mắc → cách gỡ: `body_markdown` được render phía client ở trang học viên hiện có ("Pattern #39", sanitize client) → trang công khai render ở server bằng `marked` với HTML thô bị bỏ (không có DOMPurify ở server); thử với bài có thẻ `<script>` trong fixture → không xuất hiện trong HTML.
- Ước lượng: 1,5 phiên · 3.

### G06-T12 — (content) Hợp đồng dữ liệu Speaking với repo VIDEO MAKING: đề nào lên kệ, tệp nào nhận
- Đầu vào: `backend/content/speaking_bank/README.md`, `2026-09-reviewed.json`, `2026-09-source.json`; truy vấn chỉ đọc trên staging `select part, is_active, count(*) from topics group by 1,2;`; 00 mục 2 điểm 22 (câu trả lời mẫu do repo VIDEO MAKING sản xuất: kịch bản, giọng đọc Kokoro, dựng video; web chỉ hiển thị).
- Việc làm: 1) lập `backend/content/library/speaking-samples-manifest.json` khung: mỗi đề dự kiến `{slug, part, title_en, title_vi, topic_slug, topic_id|null, video_source|null, youtube_id|null, video_url|null, audio_url|null, voice:'synthetic', has_sample_text:false}`; 2) viết `backend/content/library/SPEAKING_SAMPLE_CONTRACT.md` — định dạng tệp mà repo VIDEO MAKING giao cho web: lời thoại từng câu kèm `start_ms` tăng dần, thời lượng, id YouTube hoặc URL máy chủ riêng, tệp audio (nếu không có video), ghi rõ giọng là giọng tổng hợp; 3) liệt kê những gì anh Andy đã cung cấp từ repo VIDEO MAKING — người thực thi **không** truy cập, không sửa, không chạy gì trong repo đó; báo cáo số đề đã có tệp theo hợp đồng (hiện 0).
- Nghiệm thu: manifest hợp lệ JSON; hợp đồng có ví dụ một đề Part 2 đủ trường (dữ liệu bịa, ngắn); danh sách câu hỏi mở gửi anh Andy (mục 10 câu 11).
- Không làm: không viết câu trả lời mẫu, không sinh giọng đọc, không dựng video, không bịa mốc thời gian.
- Ước lượng: 1 phiên · 2.


### G06-T13 — Đề Speaking: API, danh sách, trang đề, trình phát hai nguồn (CSP)
- Đầu vào: `thiet-ke/DeSpeakingDanhSach.dc.html`, `thiet-ke/DeSpeaking.dc.html`; mục 5.6, 5.7; T02, T07; lối vào chấm thử của G05-T21.
- Thêm 18/11 theo rà soát (HV-07): trang đề Part 2 có khối "Chấm thử miễn phí đề này" (lối vào của G05-T21, đề điền sẵn); trang đề Part 1/Part 3 ghi "Chấm thử miễn phí có ở đề Part 2".
- Việc làm: 1) API `/api/library/speaking*`; 2) script nhập `backend/scripts/import_speaking_samples.py` cùng khuôn T03, đọc tệp theo hợp đồng của T12 do repo VIDEO MAKING giao (staging, dry-run, `--execute`, đọc lại; chặn đề không có `sample_text`; kiểm `youtube_id` mẫu 11 ký tự; transcript `start_ms` tăng dần và không vượt thời lượng; ghi bản ghi lô như 5.8); 3) danh sách + trang đề; 4) `frontend/components/library/video-player.tsx`: nhánh YouTube (iframe `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&rel=0`, tải IFrame API khi người dùng bấm phát lần đầu hoặc khi trang hiện, đọc `getCurrentTime()` mỗi 250 ms khi đang phát) và nhánh `<video>` (nhớ vị trí `localStorage` khoá `aver-sp-pos:<slug>`, bọc try/catch); hàm thuần `activeCueIndex(cues, tMs)`; nhãn "Giọng đọc tổng hợp" cạnh trình phát video và audio (FR-06-034); 5) CSP theo 5.6 chỉ cho `/library/speaking/:slug`.
- Nghiệm thu: test `activeCueIndex` (trước mốc đầu → -1/không tô; đúng mốc; giữa hai mốc); test React: không tự phát (không gọi `playVideo` khi tải); video lỗi → mốc không bấm được; không có video → mục "Câu trả lời mẫu" với audio thu gọn; có video hoặc audio thì luôn có chữ "Giọng đọc tổng hợp"; `curl -I localhost:3000/library/speaking/<slug>` có `frame-src https://www.youtube-nocookie.com`, `curl -I localhost:3000/` **không** có; `tests/post-migration-security-headers.test.mjs` và test CSP hiện có vẫn qua (sửa có chủ ý nếu chúng ghim chuỗi CSP đầy đủ, ghi rõ).
- Vướng mắc → cách gỡ: (a) Trang Speaking chưa có dữ liệu thật (T12) → làm với fixture, kệ trống hiện trạng thái rỗng "Chưa có đề nào" và `/library` ẩn số; (b) `cacheComponents` + iframe trong Server Component: iframe nằm trong component client, server chỉ render khung có kích thước cố định (tránh nhảy bố cục).
- Ước lượng: 3 phiên · 4.

### G06-T14 — Ngữ pháp: đổi giao diện, giữ URL và frontmatter
- Đầu vào: `thiet-ke/GrammarWiki.dc.html` (trang chủ), `GrammarWikiBai.dc.html` (trang bài), `GrammarWikiMinhHoa.dc.html` (chuẩn hình sơ đồ — renderer thuộc GOI-11 G11-T33), `NguPhap.dc.html` (khuôn bài đọc chung); mọi file trong `frontend/app/(public-content)/grammar/`; `frontend/lib/grammar-api.ts`; `frontend/proxy.ts`; danh sách test ở mục 2.1; `AGENTS.md` "Grammar Wiki conventions".
- Việc làm: chia **ba PR** theo trang để giới hạn số test phải sửa mỗi lần: (a) trang bài `/grammar/[category]/[slug]` dùng khuôn T07 (mục lục từ `toc`, `anchors`; thời gian đọc từ `word_count` khi có, không có → ẩn); "Đã đọc" (người đã đăng nhập, qua `library_marks` `grammar_article/read` — sau T16); "Đã lưu" giữ `POST|DELETE /api/grammar/articles/{slug}/save`; kiểm tra nhanh giữ `/api/grammar/article/{c}/{s}/exercise`; (b) trang chủ `/grammar` mục lục "Theo nhóm"/"A–Z" + tìm bỏ dấu; (c) `search`, `compare`, `roadmap`, `exercises` đổi khung, giữ hành vi. Layout `(public-content)`: chuyển sang khung G03 nhưng giữ `BodyClassBridge` tới khi bỏ hẳn `grammar-wiki.css`.
- Nghiệm thu: mỗi URL cũ trả cùng mã HTTP (`curl -o /dev/null -w '%{http_code}'` trên 5 bài mẫu + 1 bài lạ = 404); `node frontend/tooling/verify-grammar-404-ssr-flow.mjs <url>` qua; frontmatter không đổi trong gói này (`git diff --stat backend/content` rỗng) — G13-B04 (GOI-13) sẽ đổi `title` frontmatter, làm sau PR (a) của T14 (sửa 18/11 theo GOI-13); sitemap Grammar không đổi số URL.
- Không làm: không đổi `backend/content/**`; không đổi `proxy.ts` logic 404; không đổi `lib/grammar-article-index.mjs`; không viết renderer sơ đồ, không sửa `backend/services/grammar_learning_blocks.py` (GOI-11 G11-T33, T34 — hai gói cùng đụng trang bài: G11-T33 xếp hàng sau PR (a) của nhiệm vụ này).
- Vướng mắc → cách gỡ: (a) Test ghim chuỗi giao diện cũ (`grammar-wiki-light-theme-rendering`, `phase3-grammar-home`, `pilot-grammar`, `grammar-wiki-redesign`…) sẽ vỡ → trong mỗi PR liệt kê test sửa, chuyển assert sang hành vi (vai trò, nhãn, liên kết) thay vì so chuỗi lớp CSS (quy ước chung 4.9); > 30 assert vỡ trong một PR → dừng, chia nhỏ tiếp. (b) Bỏ `loading.tsx` của bài sẽ đổi cách stream mà `grammar-article-loading-next-behavior.test.mjs` kiểm → **giữ** `loading.tsx` (proxy đã lo 404 thật), chỉ đổi nội dung khung tải. (c) CSS cũ scope `body.av-page` vẫn áp lên trang mới khi cùng layout → bỏ `grammar-wiki.css` khỏi layout ở PR cuối cùng (c), không ở PR (a).
- Ước lượng: 2,5 phiên · 4.

### G06-T15 — Từ vựng: đổi giao diện `/vocabulary`, canonical đúng, sổ từ
- Đầu vào: `thiet-ke/TuVung.dc.html`, `TuVungHocVien.dc.html` (phần chung với trang công khai); `frontend/app/(public-content)/vocabulary/*`; `backend/routers/vocabulary.py`, `vocabulary_bank.py`; `components/vocabulary-audio-button.tsx`.
- Việc làm: giao diện mới dùng khuôn T07; `generateMetadata` theo `cat/slug` (title "<headword> — nghĩa, phát âm, cách dùng | Aver Learning", canonical `/vocabulary?cat=&slug=`); gợi ý tra từ (FR-06-051) dùng `GET /api/vocabulary/search`; khoảng cách chỉnh sửa tính ở client trên danh sách `directory`; nút nghe dùng `vocabulary-audio-button.tsx` (một giọng hiện có; giọng thứ hai ẩn tới khi có dữ liệu); "Lưu vào sổ từ" gọi `POST /api/vocabulary/bank/` với `source_type:'manual'` khi cờ sổ từ bật cho người đó, ý định lưu qua đăng nhập lưu ở `sessionStorage` khoá `aver-pending-save-word` (kiểm lại slug khi đọc); "Trong bài mẫu Writing": API `GET /api/library/writing-samples?q=<headword>` giới hạn 3.
- Nghiệm thu: test React gợi ý (bàn phím ↑ ↓ Enter Esc); test "không thấy" ra ≤ 3 từ gần; khách bấm lưu → lời nhắc dưới nút có liên kết `/login?next=…`; `curl -s 'localhost:3000/vocabulary?cat=economy&slug=<slug>' | grep canonical` ra đúng URL mục từ; IPA trong phần tử có `font-family` Source Sans 3 (kiểm computed style trong test trình duyệt).
- Vướng mắc → cách gỡ: (a) Sổ từ sau cờ `VOCAB_BANK_FEATURE_FLAG_ENABLED` và `_ACTIVE_LEARNER` → khách/người chưa có mã không lưu được; FR-06-053 chỉ đạt khi anh Andy quyết (mục 10 câu 5); mặc định: nút "Lưu vào sổ từ" chỉ hiện khi `GET /api/vocabulary/bank/stats` trả 200 cho người đó. (b) Không đổi sang URL dạng `/vocabulary/<cat>/<slug>`: `proxy.ts` coi mọi `/vocabulary/:path+` là route nonce đã đăng nhập và các đoạn `hub|practice|exam|learn|sets|study` đã bị chiếm.
- Ước lượng: 2 phiên · 3.

### G06-T16 — Dấu đã đọc/đã lưu và cột "Của bạn" (high-risk: ghi dữ liệu người dùng)
- Đầu vào: mục 5.2 `library_marks`, 5.7 `me/marks`.
- Việc làm: API `GET/PATCH/DELETE /api/library/me/marks…` (exempt có chủ đích, kiểm `item_key` tồn tại + `published`); hook client `useLibraryMarks(shelf)`; cột "Của bạn" ở T09; "Đã đọc" ở T14 (a); Speaking cột "Bạn" chỉ có đã đọc/đã lưu (đề đã luyện: mục 10 câu 6).
- Nghiệm thu: test backend: người A không đọc/ghi dấu của B; `item_key` không tồn tại → 404; PATCH hai lần → một hàng; tài khoản `is_active=false` dùng được; xoá tài khoản → dấu xoá theo (FK cascade); test React: bật/tắt tại chỗ, trạng thái "Đang lưu…", lỗi trả lại trạng thái cũ và báo chữ.
- Vướng mắc → cách gỡ: client không được ghi thẳng Supabase REST (SECWRITE-0022, INACTIVEWRITE-0035) → chỉ qua backend; test `backend/tests/test_activation_gate_inventory.py` buộc mỗi route `me/*` có dòng exempt lý do "own library marks; no paid work".
- Ước lượng: 1,5 phiên · 4.

### G06-T17 — SEO Thư viện
- Đầu vào: `app/sitemap.ts`, `lib/public-sitemap-model.mjs`, `app/robots.ts`, `tests/next-metadata.test.mjs`.
- Việc làm: thêm `/library`, `/library/writing-samples`, `/library/writing-guides`, `/library/speaking` vào `STATIC_PUBLIC_PATHS`; đọc `/api/library/writing-samples/index` và `/speaking/index` (lỗi → bỏ qua, như Grammar), thêm từng trang với `lastModified`; `robots.ts` allow `/library`; mục từ Vocabulary không thêm vào sitemap ở gói này (mục 10 câu 7).
- Nghiệm thu: `curl localhost:3000/sitemap.xml | grep -c '/library/writing-samples/'` = số đề `published`; test sitemap model với dữ liệu giả.
- Ước lượng: 1 phiên · 2.

### G06-T18 — (content) Nhập staging, đọc lại, xuất bản theo lô
- Đầu vào: manifest đã duyệt (T04, T05), T02 đã chạy trên staging, T03.
- Việc làm: `--check` sạch lỗi chặn → dry-run → `--execute` trên staging (`publish:false` hết) → đọc lại không khác biệt → bật `publish:true` lô đầu 50 đề đã duyệt → kiểm 10 trang ngẫu nhiên trên staging ở 1280px và 390px → các lô còn lại.
- Đầu ra: PR `content` cập nhật manifest (`publish`, `content_hash`); bằng chứng: đầu ra lệnh, ảnh chụp 10 trang, số đề đã xuất bản.
- Không làm: không chạy trên production (cần thay đổi riêng được duyệt, script từ chối project khác staging).
- Ước lượng: 1 phiên · 2.

### G06-T19 — (mới, content) Rà 19 bộ chưa có trạng thái duyệt; vẽ hình và bổ sung cặp so sánh cho 3 bộ Task 1
- Mục đích: 00 mục 2 điểm 20 — "19 bộ chưa có trạng thái duyệt và 3 bộ Task 1 thiếu hình: đội thực hiện rà và tạo luôn". Sau nhiệm vụ này cả 549 bộ qua được `--check`.
- Đầu vào: danh sách 19 bộ ở mục 2.2; kết quả `--check` (T03); `sources/task1_figures/` và README của nó (cách các hình hiện có được dựng); tờ `BaiMauWriting` (cách hình Task 1 hiển thị); quy tắc "thư, bản in, mã QR, ảnh đề Task 1 luôn sáng" (00 mục 2 điểm 17).
- Việc làm: 1) **Rà 16 bộ Task 2 và các bộ `t1_*`** chưa có `review_status`: đọc đủ ba bài, kiểm theo cùng bảng kiểm của 530 bộ đã duyệt (đủ ba bài, dàn ý, bảng từ, nhật ký khác biệt khớp bài, band ước tính lệch nhãn ≤ 0,5, không lỗi chính tả rõ, đề không trùng bộ khác); lỗi nhỏ ghi vào bảng rà; bộ đạt → `review.status='approved'`, `review.by='doi-thuc-hien'`, `review.at`, `review.note` ghi đã kiểm gì; bộ không đạt → `needs_review` kèm lý do cụ thể, **không** tự sửa nội dung bài. 2) **Ba bộ `task1_bricks`, `task1_internet`, `task1_island`**: vẽ hình từ số liệu/mô tả trong chính tệp nguồn của bộ (trường `data` của đề) bằng mã sinh hình (script tái lập được, đặt trong `backend/scripts/library/`), xuất PNG nền sáng ≤ 2 MB vào `--figures`; hình là bản tự dựng, không chép hình từ sách; bổ sung cặp `6.0->7.0`, `7.0->7.5` còn thiếu của tiêu chí LR bằng cách đối chiếu ba bài của bộ (trích nguyên văn từ bài, không viết thêm nội dung bài). 3) Chạy lại `--check`: `E_NO_REVIEW`, `E_FIGURE`, `E_PAIR` về 0.
- Đầu ra: PR `content`: manifest (trường `review`), ba tệp hình, script sinh hình, bảng rà (trong thân PR); không chép nội dung bài vào repo (mục 10 câu 2).
- Nghiệm thu: `--check` in 0 cho ba mã lỗi trên; ba hình mở được ở 1280px và 390px trên staging sau T18, chữ trong hình đọc được; bảng rà có một dòng cho mỗi bộ trong 19 bộ.
- Không làm: không gọi AI trả phí qua backend; không sửa câu chữ bài mẫu; không ghi vào repo `ielts-pipeline`.
- Vướng mắc → cách gỡ: tệp nguồn của ba bộ Task 1 không đủ số liệu để vẽ → ghi rõ thiếu gì, để `needs_review`, báo anh Andy (không bịa số liệu). Phần "bổ sung cặp LR" cần sửa tệp nguồn ngoài repo → ghi phần bổ sung vào manifest (`overrides`), script nhập gộp khi đọc; không sửa tệp trong `ielts-pipeline`.
- Ước lượng: 2 phiên · 3.

### G06-T20 — (mới) Trang `/admin/library` "Thư viện công khai" (tờ AdminThuVienCongKhai)
- Mục đích: nơi admin xem tình trạng đăng của bài mẫu Writing và đề Speaking, sửa nhanh tiêu đề/chủ đề, đăng/gỡ, và xem kết quả lần nhập gần nhất. **Gói sở hữu: G06** (GOI-09 mục 1, 3, 5.1 ghi G09 chỉ đặt mục sidebar "Nội dung › Thư viện công khai" với `available:false` cho tới khi trang này có).
- Đầu vào: tờ `AdminThuVienCongKhai` và ghi chú cuối tờ; khung admin và sổ điều hướng của G09-T08 (`frontend/lib/admin-nav-registry.mjs`); `thiet-ke/CHUAN-ADMIN.md`; bảng T02; bản ghi lô của G09-T36; component bảng, ngăn kéo, `DangerZone` của G03/G09.
- Việc làm: 1) Backend `backend/routers/admin_library.py` (prefix `/admin/library`, `require_admin` là lệnh await đầu): danh sách có lọc và số đếm từ máy chủ; sửa nhanh `title_en`, `topic_slug` (kiểm như script: 3–70 ký tự, không chữ có dấu, không trùng); đăng/gỡ một hoặc nhiều đề — máy chủ kiểm lại điều kiện đăng của tờ và trả danh sách bị loại kèm lý do; đổi slug sau lần đăng đầu chỉ qua vùng nguy hiểm (gõ xác nhận, ghi `writing_sample_slug_history`); mọi thay đổi ghi nhật ký. 2) Trang `/admin/library` trong nhóm route admin của G10, thẻ `?tab=writing|speaking|import` (thẻ `shelves`, `seo` của tờ: mục 10 câu 12 — đợt đầu hiện "Chưa có ở đợt này"); thẻ `import` chỉ đọc, hiện lần chạy gần nhất từ bản ghi lô. 3) Bật `available:true` cho mục sidebar trong sổ điều hướng của G09 (một dòng, phối hợp phiên làm G09).
- Đầu ra: 1 PR (backend + trang).
- Nghiệm thu: `tests/test_staff_guard_inventory.py` pass; pytest: đăng một đề thiếu tiêu đề → bị loại kèm lý do, không đổi `publish`; test React: nút Lưu tắt khi tiêu đề có dấu; staging: gỡ một đề thử → trang công khai của đề trả 404 và danh sách công khai giảm một.
- Không làm: không có ô tải file (nội dung nhập qua script — 00 mục 2 điểm 19); không sửa nội dung bài; không dựng khung admin riêng; không hiện mã nguồn, mã lỗi script, điểm ước tính từng tiêu chí.
- Vướng mắc → cách gỡ: G09-T08 chưa merge → đặt trang trong khung admin hiện có, ghi rõ; G09-T36 chưa merge → thẻ `import` hiện "Chưa có dữ liệu lô nhập".
- Ước lượng: 2 phiên · 3.


## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Không đọc được ổ ngoài chứa `ielts-pipeline` từ worktree | `--source` báo không tồn tại | Script nhận đường dẫn tham số; chạy `--check` trên máy có ổ (anh Andy hoặc người thực thi được cấp quyền đọc) và dán đầu ra vào PR | Không sao chép 30 MB vào repo khi chưa có quyết định mục 10 câu 2 |
| Nguồn đổi sau khi đã duyệt | `W_HASH` | Dừng xuất bản bộ đó, gửi danh sách cho người duyệt | Luôn hỏi |
| Bài mẫu bị gỡ khi trang Kiến thức đang trích | Trích dẫn rỗng | Thẻ trích bị bỏ khỏi HTML (FR-06-022) | — |
| Test Grammar vỡ hàng loạt | > 30 assert trong một PR | Chia PR nhỏ hơn theo trang | Vẫn > 30 → báo danh sách |
| YouTube bị chặn CSP | Console "Refused to frame" | Kiểm header của đúng route speaking (5.6) | Muốn mở cho toàn site → hỏi |
| Trùng route `/library` với G07 | `next build`: "You cannot have two parallel pages that resolve to the same path" | Một route duy nhất ở `(public-library)` | Báo G07 |
| `next build` cần backend | Build CI lỗi `ECONNREFUSED localhost:8000` | Dùng `connection()` + Suspense như `vocabulary/page.tsx`; sitemap bọc `try/catch` | — |
| Hình Task 1 | (đã quyết 17/11: kho 549 bài mẫu và hình Task 1 mở công khai được) | Xuất bản Task 1 như Task 2 khi bộ qua `--check`; ba bộ thiếu hình chờ T19 | — |
| Câu chữ trộn Việt–Anh | Nhãn tiếng Anh ngoài tên riêng | Nhãn giao diện tiếng Việt; tên tiêu chí ghi đủ bằng tiếng Anh (theo tờ); tiêu đề đề bằng tiếng Anh | — |

## 8. Ràng buộc riêng của gói

- Không đổi slug, `category`, `related_pages`, `next_articles`, `compare_with`, `prerequisites`, `pathways` của Grammar trong gói này; mọi link mới tới bài Grammar phải trỏ slug có file (`AGENTS.md`).
- Không đổi `frontend/public/assets/advanced-vocab/**`, không đổi cấu trúc `backend/content_vocab/`.
- Không ghi vào repo `ielts-pipeline`, không sửa `ielts.db`, không chạy `python -m ielts.cli` ghi dữ liệu.
- Không gọi AI trả phí để đặt tiêu đề/gán chủ đề qua backend; người thực thi soạn trong phiên và người duyệt.
- Không hiện điểm ước tính, mã tiêu chí viết tắt, ghi chú nội bộ (FR-06-015).
- Script nhập chỉ chạy staging; production cần thay đổi riêng được duyệt.
- File dùng chung: `backend/services/activation_gate.py`, `frontend/app/robots.ts`, `frontend/lib/public-sitemap-model.mjs`, `frontend/tooling/content-security-policy.mjs`, `docs/SITE_OVERVIEW.md` (G05 cũng sửa) — theo thứ tự phụ thuộc, bên sau rebase.
- Lệnh sinh lại `api.d.ts` như GOI-05 mục 8.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

Môi trường: local cho test; staging cho nhập dữ liệu và kịch bản đầu-cuối; production chỉ xem sau khi merge và anh Andy cho phép, không ghi gì.

1. Given khách chưa đăng nhập, When mở `/library`, Then thấy năm kệ với số đếm thật (hoặc không số), không có lời nhắc đăng nhập chặn nội dung.
2. Given `/library/writing-samples?task=task2&dang=opinion`, When tải trang, Then chỉ có đề Opinion, 12 đề/trang, URL giữ nguyên khi tải lại; When chọn Task 1, Then nhóm dạng vô hiệu và `dang` biến khỏi URL.
3. Given một đề đã xuất bản, When mở trang với JS tắt, Then HTML có câu đề, ba bài, nhật ký khác biệt; không có "TR:", "problem_solution", điểm ước tính.
4. Given chế độ so sánh 7.0 ↔ 6.0, Then câu trong nhật ký được tô ở cả hai cột (lỗi chỉ ở bản thấp chỉ gạch cột phải); câu không khớp hiện ở lề.
5. Given slug cũ đã đổi, When mở, Then 308 tới slug mới; Given slug không có, Then HTTP 404.
6. Given đề Speaking có YouTube, When mở trang, Then video không tự phát; When bấm câu thứ ba trong lời thoại, Then video tua tới mốc và câu được tô; Given video lỗi (id sai trên staging), Then mốc là chữ thường.
7. Given `/grammar/tenses/past-perfect`, Then cùng URL, giao diện mới, mục lục theo `toc`; Given `/grammar/tenses/khong-co`, Then HTTP 404 thật.
8. Given `/vocabulary?cat=economy&slug=<slug>`, Then `<link rel="canonical">` là URL đó; When khách bấm "Lưu vào sổ từ", Then lời nhắc dưới nút; When đăng nhập (cờ sổ từ bật cho tài khoản thử), Then quay về đúng mục từ và từ đã nằm trong sổ.
9. Given người đã đăng nhập đánh dấu đã đọc một đề Writing, When tải lại danh sách, Then cột "Của bạn" ghi "Đã đọc"; người khác không thấy dấu đó.
10. Given script nhập, When `--check` trên nguồn hiện tại trước T04/T05, Then in 19 `E_NO_REVIEW`, 3 `E_FIGURE`, 3 `E_PAIR`, 549 `E_NO_TITLE`, 549 `E_TOPIC`, 529 `W_BAND_NEAR`; sau T04/T05 và người duyệt, Then không còn lỗi chặn ở các bộ `publish:true`.
11. Mọi màn ở 1280px và 390px, có trạng thái rỗng/tải/lỗi, ảnh đặt cạnh tờ thiết kế trong PR; dùng được bằng bàn phím.

Bằng chứng "xong gói": mọi FR có test hoặc bước kiểm tay trong `verification.md`; PR đã merge `staging`; số đề đã xuất bản trên staging khớp số `publish:true` trong manifest; ảnh 10 trang ngẫu nhiên. Phân biệt rõ: đã ở staging · đã lên production · người dùng đã nghiệm thu.

## 10. Cần anh Andy quyết

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 1 | **ĐÃ TRẢ LỜI 17/11** (00 mục 2 điểm 20): kho 549 bài mẫu và hình Task 1 mở công khai được | — | Xuất bản mọi bộ có `review.status='approved'`, gồm Task 1 |
| 2 | Nội dung 549 bộ (30 MB) có chép vào repo `backend/content/library/` không, hay script đọc từ thư mục ngoài? | Chép bản đã duyệt vào repo (nguồn sự thật cùng chỗ với `writing_prompts`, nhập lại được mọi lúc) — tăng kích thước repo khoảng 30 MB | Script đọc `--source` ngoài; repo chỉ giữ manifest |
| 3 | Danh sách chủ đề cho bộ lọc (12–16 mục) | Môi trường, Giáo dục, Công nghệ, Sức khoẻ, Công việc, Xã hội và gia đình, Chính phủ và luật, Kinh tế và tiêu dùng, Văn hoá và nghệ thuật, Đô thị và giao thông, Truyền thông, Khoa học, Du lịch, Thể thao | Người thực thi đề xuất trong T04, chờ duyệt |
| 4 | Bốn nhóm Kiến thức Writing (Task 1 · Task 2 · Tiêu chí chấm · Dạng đề) ánh xạ từ `writing_tips` thế nào? `task_type` chỉ có task_1/task_2/both, `category` là chữ tự do | Thêm trường `groups text[]` vào `writing_tips` (migration nhỏ) do admin chọn | Ánh xạ tạm: `task_1`→Task 1, `task_2`→Task 2, `both`→cả hai; `category` khớp "criteria"/"question-type" → nhóm tương ứng |
| 5 | "Lưu vào sổ từ" cho người chưa có mã lớp/khoá: mở sổ từ cho mọi tài khoản (bỏ cờ `VOCAB_BANK_FEATURE_FLAG_ENABLED` cho đường lưu thủ công) hay chỉ người có khoá? | Mở cho mọi tài khoản đã đăng nhập (miễn phí, không tốn AI) | Chỉ hiện nút khi sổ từ đã bật cho người đó |
| 6 | "Đề đã luyện" ở kệ Speaking: `sessions.topic` là chuỗi, không có `topic_id` | G08 thêm `topic_id` vào phiên mới; G06 chỉ hiện đã đọc/đã lưu tới lúc đó | Không có công tắc "Chỉ đề chưa luyện" |
| 7 | Mục từ Vocabulary có vào sitemap (URL dạng `?cat=&slug=`) không? | Có, sau khi canonical từng mục từ đã đúng một thời gian | Không thêm |
| 8 | **ĐÃ TRẢ LỜI 18/11** (00 mục 2 điểm 22): câu trả lời mẫu Speaking do repo VIDEO MAKING sản xuất (kịch bản, giọng đọc Kokoro, dựng video); web chỉ hiển thị, ghi nhãn "Giọng đọc tổng hợp" | — | Kệ Speaking dựng xong nhưng rỗng ("Chưa có đề nào") cho tới khi có tệp theo hợp đồng T12 |
| 9 | **ĐÃ TRẢ LỜI 17/11** (00 mục 2 điểm 20): 19 bộ chưa có trạng thái duyệt và 3 bộ Task 1 thiếu hình — đội thực hiện rà và tạo luôn (G06-T19) | — | Như T19; bộ không đạt để `needs_review`, không xuất bản |
| 10 | Có hiện mức "ước lượng" cho câu trả lời mẫu Speaking không? | Không (tờ: không gắn band) | Không hiện |
| 11 | Phạm vi câu trả lời mẫu Speaking đợt đầu từ repo VIDEO MAKING: bao nhiêu đề, Part nào, audio hai mức band hay một, lời thoại bấm nghe từng câu (đề xuất 17/11 chưa được trả lời — 04-VIEC-DE-LAI mục D) | 20 đề Part 2 đầu, một câu trả lời mẫu mỗi đề | Web nhận bất kỳ số lượng nào theo hợp đồng T12 |
| 12 | Thẻ "Kệ và bài nổi bật" và "SEO" của `/admin/library` (tờ AdminThuVienCongKhai, chưa được duyệt) có làm ở đợt đầu không? | Để đợt sau; đợt đầu ba thẻ Writing, Speaking, Lô nhập | Không dựng hai thẻ đó |
| 13 | T19: đội thực hiện tự đặt `approved` cho 19 bộ sau khi rà (theo "rà và tạo luôn"), hay vẫn cần anh xem bảng rà trước khi xuất bản? | Đội tự duyệt, anh xem bảng rà trong PR | Tự duyệt; chỉ xuất bản sau khi PR T19 được merge |
| 14 | (mới, 18/11 chiều) Kiến thức nền (công khai, thuộc Thư viện) và Đọc kỹ: đường dẫn (`/library/background/...`?), vị trí kệ trên `/library`, có vào sitemap không — thuộc spec ở GOI-13 (0097 Kiến thức nền, 0098 Đọc kỹ); gói này cần biết để giữ chỗ | Kệ thứ sáu sau Từ vựng; đường dẫn dưới `/library/`; vào sitemap như các kệ khác. Đã chốt (sửa 18/11 theo GOI-13): kệ thứ sáu `/library/background` (Kiến thức nền) do GOI-13 phần C dựng | Không dựng; `/library` dựng kệ từ mảng cấu hình (FR-06-005b) |
