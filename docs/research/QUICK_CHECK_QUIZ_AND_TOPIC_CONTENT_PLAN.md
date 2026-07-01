# Kế hoạch — Quick-Check Quiz importer + Topic-centric content admin (vocab + grammar)

> Trạng thái: **nghiên cứu / chờ duyệt**. Chưa code. Tài liệu này gộp 3 yêu cầu liên quan:
> 1. Đưa **Quick-Check quiz** (parser + widget + chấm + Adaptive Mastery) vào codebase averlearning.
> 2. Làm **cùng/kế thừa hạ tầng import vocab** hiện có.
> 3. Chuyển **upload + quản lý nội dung sang mô hình THEO CHỦ ĐỀ (topic)** ở phía admin, mở rộng để admin **thêm/sửa/upload bài tập grammar**.

---

## 0. Hiện trạng codebase (đã khảo sát)

### Vocabulary (đã có, khá đầy đủ)
- **`vocab_cards`** (mig 110–112): thư viện từ admin, tổ chức theo **`category`** (1 category = 1 "chủ đề"); fields: headword, slug, level, pos, pronunciation, syllables, definition_en/vi, gloss_vi, example, register, common_error, memory_hook, synonyms/antonyms/collocations/related_words/word_family (JSONB), body_html, audio_headword/audio_example/audio_status.
- **Importer** `services/vocab_import.py`: tách multi-block YAML (`split_word_blocks` — *đúng hợp đồng parser mà spec quiz mô tả*), dry-run, **upsert theo slug**, all-or-nothing. Dùng chung `content_import_service` (`_split_frontmatter`, `slugify`).
- **Admin UI** `frontend/pages/admin/vocab/content.html`: drag-drop import + search/filter theo category + bulk edit + generate audio (BackgroundTask). Router `routers/admin_vocab.py` (`require_admin`).
- **Public wiki** `routers/vocabulary.py` + `frontend/vocabulary.html`. Category auto-surface từ DB DISTINCT; có manifest điều khiển thứ tự + tên VN.
- **Audio**: bucket `vocab-audio`, **content-hash addressed** (SHA256 của text+voice+engine), URL stamp lên `vocab_cards.audio_headword/example`. (KHÁC với quy ước slug `<headword>_vN` trong spec quiz → cần "cầu nối", xem §6.)
- **Hệ per-user khác (KHÔNG đụng tới):** `user_vocabulary` + `flashcard_*` (SRS SM-2) + `user_d1_questions` (fill-blank cá nhân hoá do Claude Haiku sinh). **D1 ≠ Quick-Check** — Quick-Check là **bank do admin biên soạn, test-tới-khi-thuộc**; D1 là câu sinh tự động theo từ user bắt được. Hai thứ song song, không thay thế nhau.

### Grammar (read-only, chưa có exercise)
- Bài viết = **md files trong repo** `backend/content/{category}/{slug}.md`, load vào RAM lúc startup (`services/grammar_content.py`). **Không có DB.** Admin chỉ **xem analytics** (`routers/admin.py` `/admin/grammar/*`), sửa bài = git commit + deploy.
- `_groups.yaml` = 8 nhóm biên tập; category = thư mục. CI `test_grammar_wiki_ref_drift` chặn link chết giữa `related_pages/next_articles/compare_with/prerequisites`.
- **KHÔNG có bài tập/quiz grammar nào.** Cơ sở exercise duy nhất hiện có là cho vocab (D1).

### Hạ tầng chung
- **Admin chrome**: web component `aver-admin-chrome` (`active=` ∈ {…,'vocab','grammar',…}, `subsection=`). Thêm trang = thêm vào `NAV_GROUPS` + mount component.
- **Migration**: thủ công, 3 chữ số, mới nhất **116**. RLS: service-role ghi, public/owner đọc. UUID `gen_random_uuid()`, trigger `update_updated_at_column()`.
- **Auth**: `get_supabase_user(authorization)` (student, Bearer JWT) · `require_admin(authorization)` (admin). Frontend `window.api.get/post/patch/delete/upload` tự gắn token.
- **Progress hiện có**: `sessions`/`responses` (speaking), `d1_sessions` (owner-scoped, exercise_ids[] + correct/total) — **mẫu rất sát** cho quiz_sessions.

---

## 1. Quyết định kiến trúc cốt lõi

### QĐ-1 — Lưu quiz bank vào DB (không để md trong repo)
Admin cần **upload/sửa lúc runtime** (Railway fs ephemeral) → bank phải nằm DB, **giống đúng lý do `vocab_cards` chuyển md→DB ở mig 110**. Md chỉ là *định dạng nhập*, parse rồi ghi DB.

### QĐ-2 — Một "engine exercise" DÙNG CHUNG cho cả vocab quiz và grammar exercise
Spec quiz đã skill-agnostic (type: mcq/gap_text/boolean/… , `skill`, `pair`, `counts_toward_mastery`). Grammar exercise dùng **cùng schema + cùng importer + cùng player**, chỉ khác `skill_area` và `item_key` (vocab = headword; grammar = "điểm ngữ pháp"). → 1 cơ sở, 2 nguồn nội dung.

### QĐ-3 — "Chủ đề (topic)" là xương sống tổ chức
Tạo bảng **`content_topics`** gom: (a) vocab cards (`vocab_cards.category` map vào topic), (b) vocab quiz bank, (c) grammar exercises. Admin quản lý **theo topic**: mở 1 topic → thấy & sửa cả từ vựng lẫn bài tập của topic đó.

### QĐ-4 — Adaptive Mastery chạy ở FRONTEND; backend lưu nội dung + log tiến độ
Spec ghi rõ "web xử lý logic" và "chấm INSTANT". Backend: phục vụ bank + ghi `attempts/word_stats/sessions`. Frontend: vòng lặp queue/rotation/mastery/anti-guess/recheck/time-budget/carry-over. (Giống mô hình `d1_sessions` do frontend lái.)

### QĐ-5 — Chấm phía client (đáp án gửi kèm cho học viên đã đăng nhập)
"Chấm tức thì" cần client có đáp án → bank serve **kèm `answer`/`accept`** cho student đã auth, client tự chấm + lộ key khi chấm. Đây là quiz **tự học, low-stakes** nên chấp nhận được (như spec §3 "web ẩn key khi làm, lộ khi chấm"). *(Đánh đổi: học viên có thể xem đáp án qua devtools — không quan trọng với quick-check ôn tập. Nếu sau này cần chống gian lận cho bài tính điểm thật → chuyển sang chấm server-side, xem §10 rủi ro.)*

### QĐ-6 — averlearning là IMPORTER + PLAYER, không phải generator
Generator (sinh bank từ thẻ) **giữ offline** trong thư mục `Vocab_Quiz/` (banks đã sinh sẵn, vd L14). averlearning chỉ **import bank đã sinh** + chơi. (Có thể thêm server-side generator sau, ngoài phạm vi.)

---

## 2. Mô hình dữ liệu (migration mới, áp tay trước deploy)

> Đánh số tiếp theo từ 117. Tất cả: UUID PK, `created_at/updated_at` + trigger, RLS (content = public/admin; progress = owner-scoped).

### 2.1 `content_topics` (xương sống) — mig 117
```
id uuid pk
slug text unique            -- vd "work-careers", "tenses"
title text                  -- "Work & Careers"
title_vi text
skill_area text             -- 'vocab' | 'grammar' (mở rộng sau: 'reading'…)
description text
"order" int default 0
is_published bool default true
created_at/updated_at
```
- **Cầu nối vocab hiện có**: thêm cột `vocab_cards.topic_id uuid null` (FK → content_topics) ở cùng migration; backfill từ `category` (map category-slug → topic-slug). `category` GIỮ NGUYÊN (không phá vocab wiki/CI); `topic_id` là lớp tổ chức mới chồng lên.

### 2.2 `quiz_banks` — mig 118
```
id uuid pk
topic_id uuid fk -> content_topics
code text                   -- "L14"
title text
skill_area text             -- 'vocab' | 'grammar'
meta jsonb                  -- toàn bộ META spec: mode, correct_to_master, require_*,
                            --   confirm_by_reversal, retention_recheck, recheck_sample,
                            --   rotate_on, cooldown, max_attempts_per_word,
                            --   target_session_min, soft_cap_min, avg_sec_per_item,
                            --   carry_over_unmastered, log_*, shuffle_options
words_count int
source text                 -- "Vocab_Markdown_Upload/L14_Group*.md"
version int default 1
is_published bool default true
import_batch_id text
unique (skill_area, code)
```

### 2.3 `quiz_questions` — mig 118
```
id uuid pk
bank_id uuid fk -> quiz_banks (cascade)
qid text                    -- "vocation_v1" (duy nhất trong bank)
item_key text               -- headword/khái niệm để gom pool ("Vocation")
type text                   -- mcq|gap_mcq|gap_text|spelling|missing_letters|stress|syllable_count|boolean|match
subtype text null
input text                  -- choice|text|boolean|syllable|match
skill text                  -- meaning|recall|…|stress|grammar|pronunciation
pair text null              -- meaning|colloc|gap
counts_toward_mastery bool default true
prompt text
options jsonb null          -- choice
answer int null             -- choice/syllable: chỉ số 0-based
accept jsonb null           -- text: danh sách đáp án
segments jsonb null         -- syllable
mask text null              -- missing_letters
pairs jsonb null            -- match
explain text
points int default 1
audio_url text null         -- resolve lúc import từ vocab_cards (xem §6)
"order" int
unique (bank_id, qid)
index (bank_id, item_key)
```

### 2.4 Tiến độ học viên (owner-scoped RLS) — mig 119
- **`quiz_sessions`**: id, user_id, bank_id, code, started_at, ended_at, duration_sec, total_questions, total_correct, total_wrong, accuracy, words_mastered, words_carried_over, `ended_by` ('completed'|'time_cap'|'paused').
- **`quiz_attempts`**: id, user_id, session_id fk, bank_id, item_key, question_id, skill, type, subtype, is_correct, answer_given, response_time_ms, attempt_no, created_at. *(log per-question; ghi theo batch để đỡ chatty — xem §4.)*
- **`quiz_word_stats`**: id, user_id, session_id fk, bank_id, item_key, correct_count, wrong_count, first_try_correct, attempts_to_master, `status` ('testing'|'provisional'|'mastered'|'carried_over'), is_difficult, skills_passed jsonb, provisional_skill text null, created/updated. **Dùng để resume carry-over** (unique (user_id, bank_id, item_key) cho phép giữ tiến độ liên phiên).
- **`quiz_word_agg`** (tùy chọn/giai đoạn sau): (bank_id, item_key) → error_rate toàn lớp cho bảng "từ dễ sai". Có thể làm **VIEW** từ quiz_attempts thay vì bảng vật lý.

---

## 3. Backend (mirror pattern vocab)

### 3.1 Parser — `services/quiz_import.py` (mirror `vocab_import.py`)
- Tái dùng `split_word_blocks`/`_split_frontmatter` (đúng hợp đồng parser spec §0).
- Block đầu `kind: quiz` = META → `quiz_banks` (meta jsonb). Block có `type:` = câu → `quiz_questions`.
- Gom pool theo `headword` → `item_key`; `words_count` = số pool (đối chiếu META).
- `validate_quiz()`: YAML hợp lệ; mỗi câu đủ field theo `input` (choice cần options+answer; text cần accept; boolean cần answer:true/false; syllable cần segments+answer); qid duy nhất; mọi từ có ≥2 skill tính-điểm + ≥1 production + cặp `pair` đầy đủ (cảnh báo nếu thiếu → Adaptive Mastery có thể kẹt).
- `import_quiz_file(text, dry_run, …)`: dry-run preview + commit all-or-nothing, **upsert theo (skill_area, code)** (xoá-ghi-lại questions của bank, hoặc upsert theo qid).

### 3.2 Router admin — `routers/admin_quiz.py` (`require_admin`)
- `POST /admin/quiz/import` (UploadFile .md, `dry_run`) — y như vocab import.
- `GET /admin/quiz/banks?topic=&skill_area=` · `GET /admin/quiz/banks/{id}` (bank + questions) · `PATCH /admin/quiz/banks/{id}` (meta/publish) · `DELETE`.
- (Sửa câu lẻ nếu cần) `PATCH /admin/quiz/questions/{id}`.

### 3.3 Router topic — `routers/admin_topics.py` (`require_admin`)
- CRUD `content_topics`; `GET /admin/topics/{id}/bundle` → trả gộp: vocab cards (qua topic_id/category), quiz banks, grammar exercise banks của topic → cấp dữ liệu cho console theo-chủ-đề.

### 3.4 Router student — `routers/quiz.py` (`get_supabase_user`)
- `GET /api/quiz/banks/{code}` (hoặc `?topic=`) → META + questions **kèm key** cho client chấm.
- `POST /api/quiz/sessions` {bank} → tạo `quiz_sessions`, trả session_id + (nếu có) **resume** word_stats carry-over.
- `POST /api/quiz/sessions/{id}/attempts` (batch) → ghi `quiz_attempts` + cập nhật `quiz_word_stats`.
- `PATCH /api/quiz/sessions/{id}` → kết phiên (duration, totals, accuracy, words_mastered/carried_over, ended_by).
- `GET /api/quiz/banks/{code}/resume` → word_stats để tiếp tục đúng tiến độ.

### 3.5 main.py: `include_router` cả 4; tuân `db-migrate`/`api-route` skill.

---

## 4. Frontend

### 4.1 Player học viên — `frontend/pages/quiz.html?bank=L14` + `frontend/js/quiz-engine.js`
- **Engine Adaptive Mastery** (spec §4/§6): queue theo từ; `unseen→testing→MASTERED`; rotation `rotate_on: skill`; mastery = `correct_to_master` skill khác nhau + ≥1 production + xác nhận chiều ĐẢO (`pair`); provisional + reset khi confirm sai; `cooldown`; `max_attempts_per_word`; recheck cuối phiên (`recheck_sample`, ưu tiên "thuộc rẻ"); ngân sách giờ (`soft_cap_min`, `avg_sec_per_item`) + carry-over resume.
- **Widget theo `input`**: choice (radio, shuffle), text (ô nhập + normalize/accept), boolean (Đúng/Sai), syllable (chip âm tiết), match (2 cột kéo-nối, giai đoạn sau). Placeholder `____`/`{{audio}}`/`{{ipa}}`.
- **Chấm client instant** + hiện `explain` (+ memory_hook/common_error nếu join được thẻ). Log attempts theo batch (vd mỗi 5 câu / khi kết phiên) → đỡ chatty.
- Thanh tiến độ (đã thuộc/tổng) + giờ còn lại; màn tổng kết (số lần thử, từ khó nhất, "cần ôn lại").

### 4.2 Admin theo chủ đề — `frontend/pages/admin/content/topics.html` (subsection mới)
- Danh sách **topic** (tạo/sửa/xoá, thứ tự, publish). Mở 1 topic → 3 tab:
  1. **Từ vựng**: nhúng/688 tái dùng UI quản lý `vocab_cards` hiện có (lọc theo topic_id), + import md.
  2. **Quiz từ vựng**: import bank `.md` (dry-run preview) + list/sửa/publish bank.
  3. **Bài tập Grammar**: import exercise `.md` (cùng format) + list/sửa/publish; gắn `grammar_article_slug` tùy chọn.
- Tái dùng `aver-admin-chrome` (thêm subsection vào `NAV_GROUPS`).

---

## 5. Grammar exercises (yêu cầu "upload bù bài tập grammar")
- **Dùng lại nguyên `quiz_banks`/`quiz_questions`** với `skill_area='grammar'`, `item_key` = điểm ngữ pháp (vd "present-perfect-vs-past-simple"), `pair`/production vẫn áp dụng (gap_text điền dạng đúng…).
- Thêm cột tùy chọn `quiz_questions.grammar_article_slug text null` để link về bài Wiki (mở lại bài khi sai). **Không** ghi vào md grammar (giữ read-only/CI ref-drift) — exercise sống ở DB, tách khỏi article.
- Admin upload exercise md theo cùng importer; tổ chức dưới topic grammar (map từ grammar category).
- **Không đụng** `test_grammar_wiki_ref_drift` (chỉ thêm DB exercise, không sửa frontmatter article). Có thể thêm test mới: mọi `grammar_article_slug` phải resolve tới article sống.

---

## 6. Cầu nối audio ({{audio}})
- Spec quiz: slug audio = slug-từ-headword (`hustle_and_bustle`). Hệ hiện tại: audio content-hash, URL nằm ở `vocab_cards.audio_headword`.
- **Giải pháp:** lúc import quiz, resolve `{{audio}}` bằng cách **join `item_key` (headword) → `vocab_cards` cùng topic → lấy `audio_headword`**, lưu sẵn vào `quiz_questions.audio_url`. Nếu chưa có thẻ/chưa pregen → để null, player ẩn nút (đúng spec). → tái dùng pipeline audio sẵn có, không cần slug mới.

---

## 7. Lộ trình (phân pha, mỗi pha 1 PR reviewable)
- **Pha 0 — Topic spine:** mig 117 `content_topics` + `vocab_cards.topic_id` + backfill; router topic CRUD; (chưa đổi UI).
- **Pha 1 — Quiz import (vocab):** mig 118 `quiz_banks/quiz_questions`; `services/quiz_import.py`; `routers/admin_quiz.py`; UI import trong admin (tab quiz). Pilot import **L14**.
- **Pha 2 — Player + Adaptive Mastery + progress:** mig 119 (sessions/attempts/word_stats); `routers/quiz.py`; `quiz.html` + `quiz-engine.js`. Chơi trọn vẹn L14.
- **Pha 3 — Admin theo chủ đề:** `topics.html` gộp vocab + quiz; di chuyển quản lý vocab vào khung topic (giữ tương thích trang cũ).
- **Pha 4 — Grammar exercises:** `skill_area='grammar'` + `grammar_article_slug`; tab bài tập grammar; (tùy chọn) test ref-drift exercise→article.
- **Pha 5 (tùy chọn):** bảng "từ dễ sai" (`quiz_word_agg`/view) + dashboard tiến bộ; widget `match`; server-side grading nếu cần.

---

## 8. Tái sử dụng tối đa (giảm rủi ro)
- Parser: `content_import_service` + `split_word_blocks` (không viết lại tách block).
- Importer flow (dry-run, upsert, all-or-nothing, reload): copy khuôn `vocab_import.py`.
- Admin auth/upload/migration/RLS/trigger: copy khuôn hiện có.
- Audio: tái dùng `vocab-audio` + `audio_headword`.
- Mô hình session frontend-driven: theo `d1_sessions`.

## 9. Test (Definition of Done)
- Backend: `parse/validate/import_quiz` (block tách đúng, dry-run không ghi, upsert theo code, all-or-nothing, validate đủ field theo input, cảnh báo thiếu pair/production); router admin/student (auth gate, RLS owner-scope, resume carry-over); audio-resolve join.
- Frontend: `node --test` cho quiz-engine (mastery rule, rotation, provisional+confirm-reversal, cooldown, recheck sampling, time-cap carry-over, normalize đáp án gõ).
- Không sửa/skip test để ép xanh; CI ref-drift grammar phải vẫn xanh.

## 10. Rủi ro / điểm cần lưu ý
- **Lộ đáp án client (QĐ-5):** chấp nhận cho self-study; nếu chuyển bài tính điểm thật → server-side grading (POST từng câu, ẩn key).
- **Trùng khái niệm với D1:** làm rõ trong UI — Quick-Check (bank admin, test-tới-thuộc) khác D1 (cá nhân hoá theo từ đã bắt). Không gộp.
- **Di trú category→topic:** backfill cẩn thận, giữ `category` để không phá vocab wiki + CI; topic là lớp chồng.
- **Quy mô bank lớn** (~232 câu/bài × 30 bài): import all-or-nothing + index theo bank_id; serve 1 bank/lần (không tải toàn bộ).
- **Match/error_fix:** spec để dành; engine hỗ trợ schema nhưng generator chưa auto-sinh → Pha sau.

---

## 11. Quyết định đã CHỐT (2026-06-30)
1. **Phạm vi đợt này = Pha 0–2** — topic spine + quiz import + player Adaptive Mastery, chạy trọn 1 bank **L14** end-to-end. Pha 3 (admin theo-chủ-đề) + Pha 4 (grammar exercises) để đợt sau.
2. **Mô hình topic = bảng `content_topics` đầy đủ** (vocab_cards.topic_id trỏ vào; mở sẵn cho grammar/reading).
3. **Chấm = client instant** (đáp án gửi kèm cho học viên đã auth; web chấm ngay; chấp nhận đánh đổi lộ-key cho bài tự học).
4. **Grammar exercise = chung engine `quiz_*`** (`skill_area='grammar'` + `grammar_article_slug`); triển khai ở Pha 4.

### Execution breakdown — Pha 0–2 (mỗi pha 1 PR)
- **PR-1 (Pha 0):** mig 117 `content_topics` + `vocab_cards.topic_id` + backfill category→topic; `routers/admin_topics.py` (CRUD + `/bundle`); mount; test. *(Áp migration tay trên Supabase trước merge.)*
- **PR-2 (Pha 1):** mig 118 `quiz_banks`/`quiz_questions`; `services/quiz_import.py` (mirror vocab_import, resolve `{{audio}}` qua join headword→vocab_cards); `routers/admin_quiz.py`; tab import trong admin; **import pilot L14**; test parser/import.
- **PR-3 (Pha 2):** mig 119 `quiz_sessions`/`quiz_attempts`/`quiz_word_stats`; `routers/quiz.py` (serve bank kèm key + sessions/attempts/resume); `frontend/pages/quiz.html` + `frontend/js/quiz-engine.js` (Adaptive Mastery + widget + chấm client + log batch); chơi trọn L14; `node --test` cho engine.
