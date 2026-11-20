# Implementation plan

Chép từ gói `GOI-06-thu-vien-cong-khai.md` mục 5, đối chiếu mã `staging` ngày 20/11/2026. Chỗ khác gói được đánh dấu **(khác gói)** kèm lý do. Đây là đề xuất trên giấy; chưa có mã.

## Architecture impact

- **Frontend, route group mới `(public-library)`** dưới `frontend/app/`: `/library`, `/library/writing-samples`, `/library/writing-samples/[slug]`, `/library/writing-guides`, `/library/writing-guides/[slug]`, `/library/speaking`, `/library/speaking/[slug]`. Layout gắn `AuthProvider` **không** `activationGate` (tài khoản chưa có mã vẫn đọc và đánh dấu được), dùng khung G03 (UIBASE-0056), không nạp `grammar-wiki.css`/`vocab-wiki.css` cũ. Không phải AuthedShell nên không thêm vào matcher của `frontend/proxy.ts`. G07 không tạo route `/library` thứ hai (Next báo "two parallel pages").
- **Frontend, route có sẵn đổi giao diện:** `frontend/app/(public-content)/grammar/**` và `frontend/app/(public-content)/vocabulary/*` giữ route group, giữ `lib/grammar-api.ts`, `lib/vocabulary-api.ts`, giữ logic 404 của `proxy.ts`; `BodyClassBridge` giữ tới PR cuối của T14.
- **Component dùng chung mới** `frontend/components/library/`: `reading-layout.tsx`, `margin-note.tsx`, `course-link-line.tsx`, `video-player.tsx`, hook `use-library-marks`; hàm thuần `frontend/lib/delta-highlight.mjs`, `activeCueIndex` (đặt trong `frontend/lib/library-cues.mjs`), mảng kệ `frontend/lib/library-shelves.mjs` (FR-063).
- **Backend, router mới** `backend/routers/library.py` (prefix `/api/library`) và `backend/routers/admin_library.py` (prefix `/admin/library`); đăng ký trong `backend/main.py` với `dependencies=_ACTIVE_LEARNER` (dòng 266) như mọi router học viên, rồi khai từng route trong `ACTIVATION_EXEMPT_ROUTES` (`backend/services/activation_gate.py`) có chủ đích — route quên khai báo thì mặc định bị cổng chặn.
- **Backend, script:** hoàn thiện `backend/scripts/import_writing_samples.py` (đã có `--check`, #2358) thêm dry-run và `--execute`; thêm `backend/scripts/import_speaking_samples.py` cùng khuôn.
- **Hạ tầng dùng chung bị sửa:** `backend/services/storage_limits.py` (bucket `library-public`), `frontend/tooling/content-security-policy.mjs` + `frontend/next.config.ts` (CSP route Speaking), `frontend/app/sitemap.ts`, `frontend/lib/public-sitemap-model.mjs`, `frontend/app/robots.ts`, `docs/SITE_OVERVIEW.md`, `docs/CONTENT_SECURITY_POLICY.md`, `frontend/types/api.d.ts` (sinh lại). Các file này G05 cũng sửa: theo thứ tự phụ thuộc, bên sau rebase.
- **Không đụng:** `writing_prompts`, `topics`, `topic_questions`, `writing_tips` (chỉ đọc), `saved_articles` (giữ cho "đã lưu" Grammar), `backend/content/**` frontmatter, `lib/grammar-article-index.mjs`, `backend/services/grammar_learning_blocks.py`, `frontend/public/assets/advanced-vocab/**`, cấu trúc `backend/content_vocab/`, repo `ielts-pipeline`, repo VIDEO MAKING.

## Data and contracts

### 5.1 Route frontend

| Đường dẫn | Route group | Dữ liệu (server, cache) | Ghi chú |
| --- | --- | --- | --- |
| `/library` | `(public-library)` | `GET /api/library/summary` | Kệ từ `library-shelves.mjs` (FR-063). |
| `/library/writing-samples` | `(public-library)` | `GET /api/library/writing-samples?task&dang&chude&q&trang` | `await searchParams` + `connection()` như `vocabulary/page.tsx`. |
| `/library/writing-samples/[slug]` | `(public-library)` | `GET /api/library/writing-samples/{slug}` | Không có `loading.tsx` để `notFound()` ra HTTP 404 thật (G05-T05). |
| `/library/writing-guides`, `/[slug]` | `(public-library)` | `GET /api/library/writing-guides`, `/{slug}` | |
| `/library/speaking`, `/[slug]` | `(public-library)` | `GET /api/library/speaking`, `/{slug}` | CSP riêng cho trang đề (5.6). |
| `/grammar/**` | giữ `(public-content)` | giữ `lib/grammar-api.ts` | Chỉ đổi giao diện. |
| `/vocabulary` | giữ `(public-content)` | giữ `lib/vocabulary-api.ts` | Đổi giao diện + `canonical`. |

### 5.2 Bảng mới — một migration `backend/migrations/400_public_library.sql` + `backend/migrations/rollback/400_public_library.sql`

Số **400** trong dải G06 (400–419, `01-KE-HOACH-TONG.md` mục 6); PR T02 thêm hàng `400 … present` vào `backend/migrations/register.tsv` (Open question N3). Gói ghi "số xin ở sổ, kế tiếp 381" — đã thay bằng dải.

`library_topics`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `slug` | text | pk, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `label_vi` | text | not null |
| `shelves` | text[] | not null, mỗi phần tử `in ('writing','speaking')`, không rỗng — **(khác gói)**: gói ghi `shelf text`; đổi thành mảng để một bộ chủ đề dùng cho cả hai kệ (Open question N2) |
| `display_order` | int | not null |

Nguồn: `backend/content/library/topics.json` (14 chủ đề, đã merge #2362); script nhập upsert bảng này trước bộ đề.

`writing_samples`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | uuid | pk, `gen_random_uuid()` |
| `source_key` | text | not null unique — stem trong `incoming/`, không hiện |
| `slug` | text | not null unique, `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 80 ký tự |
| `title_en` | text | not null, 3–70 ký tự, không chữ Việt có dấu (kiểm ở script và API admin; DB kiểm độ dài) |
| `task_type` | text | `in ('task1_academic','task2')` |
| `question_type` | text null | Task 2: `in ('opinion','discussion','problem_solution','advantages_disadvantages','two_part','positive_negative')` |
| `task1_subtype` | text null | Task 1: `in ('bar','line','pie','table','process','map','mixed')` |
| `topic_slug` | text | not null, FK `library_topics(slug)` |
| `prompt_text` | text | not null |
| `prompt_image_path` | text null | đường dẫn trong bucket `library-public`; Task 1 bắt buộc khi `published` (CHECK) |
| `essays` | jsonb | not null; khoá `7.5`, `7.0`, `6.0`, mỗi bài `{text, word_count, outline, vocab_table, structures}` |
| `delta_75_70`, `delta_70_60` | jsonb | not null, mảng |
| `justification` | jsonb | not null, chỉ `by_criterion` (bỏ `integrity_check`; `overrides.justification_jumps` của manifest đã gộp) |
| `task1_data` | jsonb null | `data` của Task 1 |
| `content_hash` | text | not null — sha256 của JSON chuẩn hoá phần được nhập (`ensure_ascii=False, sort_keys=True, separators=(',',':')`) |
| `source_review_status` | text null | `review_status` của nguồn |
| `published` | boolean | not null default false |
| `published_at`, `created_at`, `updated_at` | timestamptz | `updated_at` chỉ đổi khi `content_hash`, tiêu đề, chủ đề hoặc ảnh đổi |

Ràng buộc chéo: `check ((task_type='task2' and question_type is not null and task1_subtype is null) or (task_type='task1_academic' and question_type is null and task1_subtype is not null))`. Chỉ mục `(published, task_type, question_type, topic_slug)`. Tìm bằng `ilike` trên `title_en`/`prompt_text` (549 dòng) — không thêm extension.

`writing_sample_slug_history(old_slug text pk, sample_id uuid not null fk writing_samples on delete cascade, changed_at timestamptz not null default now())` — cho 308.

`speaking_samples`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | uuid | pk |
| `source_id` | text | not null unique — `source_id` của `speaking-samples-manifest.json` (ví dụ `p2-001`) **(khác gói: thêm khoá ổn định, cùng vai trò `source_key`)** |
| `slug` | text | not null unique, cùng mẫu slug |
| `topic_id` | uuid null | FK `topics(id)` khi đề có trong ngân hàng luyện |
| `part` | smallint | `in (1,2,3)` |
| `title_en` | text | not null |
| `title_vi` | text null | dòng phụ dịch nghĩa |
| `topic_slug` | text null | FK `library_topics(slug)`; null → nhóm "Chủ đề khác" (N2) |
| `cue_card` | jsonb null | Part 2 `{prompt, bullets[], reflection}`; Part 1/3 `{questions[]}` |
| `video_source` | text null | `in ('youtube','self_hosted')` |
| `youtube_id` | text null | `^[A-Za-z0-9_-]{11}$`, bắt buộc khi `video_source='youtube'` |
| `video_url` | text null | `^https://`, bắt buộc khi `self_hosted` |
| `duration_s` | int null | > 0 |
| `transcript` | jsonb | not null; `[{start_ms|null, text, marks:[{kind:'vocab'|'structure', start, end, note}]}]` |
| `sample_text` | text | not null, không rỗng (CHECK `length(btrim(sample_text)) > 0`) |
| `audio_path` | text null | bucket `library-public` |
| `voice` | text | not null default `'synthetic'`, `in ('synthetic')` **(khác gói: thêm để nhãn FR-036 đọc từ dữ liệu, theo `docs/SPEAKING_SAMPLE_CONTRACT.md`)** |
| `outline`, `vocabulary`, `related_part3` | jsonb | default `'[]'` |
| `source_note` | text null | "Nguồn đề: …" |
| `content_hash` | text | not null |
| `published`, `published_at`, `created_at`, `updated_at` | | như `writing_samples` |

`library_marks(user_id uuid not null fk users on delete cascade, shelf text check (shelf in ('writing_sample','speaking_sample','writing_guide','grammar_article')), item_key text not null, kind text check (kind in ('read','saved')), created_at timestamptz not null default now(), primary key (user_id, shelf, item_key, kind))`. Grammar "đã lưu" **giữ** `saved_articles` (admin thống kê đọc nó, `backend/routers/admin.py`); `library_marks` chỉ thêm `grammar_article/read`. `item_key` = `slug` hiện hành (Writing/Speaking/guide) hoặc `<category>/<slug>` (Grammar); đổi slug Writing thì T20 cập nhật `item_key` trong cùng giao dịch.

RLS bật trên cả năm bảng; không policy cho `anon`/`authenticated`; `REVOKE ALL … FROM anon, authenticated` theo mẫu migration gần nhất có REVOKE; mọi đọc/ghi qua backend `service_role`. Migration áp được lại (idempotent `if not exists`), postcondition kiểm RLS bật và không có grant cho hai vai trò client.

### 5.3 Bảng chủ đề

`prompt.domain` có 480 giá trị cho 549 bộ nên không dùng trực tiếp. `topics.json` (14 chủ đề) và `topic_slug` của 549 bộ đã có ở #2362. Chủ đề Speaking: N2. Kiến thức nền (GOI-13) dùng bộ chủ đề riêng và bảng nối `background_topic_writing_links` (migration 492 của GOI-13), không dùng `library_topics`.

### 5.4 Slug, tiêu đề, metadata

- `slug` = `title_en` chữ thường, bỏ ký tự ngoài `[a-z0-9]`, nối `-`, ≤ 80 ký tự, cắt ở ranh giới từ; trùng → `-task1`/`-task2`, rồi `-2`, `-3`. Slug **đóng băng** sau `published`; đổi phải ghi `writing_sample_slug_history`, trang cũ chuyển 308.
- Writing `<title>`: `"<title_en> — IELTS Writing Task 2: bài mẫu 7.5, 7.0, 6.0 | Aver Learning"` (Task 1: `Task 1`). `description`: 150 ký tự đầu của `prompt_text` + " Ba bài mẫu 7.5, 7.0, 6.0 kèm phân tích khác biệt." `canonical`: `/library/writing-samples/<slug>`. `openGraph.title` = `title_en`. Breadcrumb: Thư viện › Bài mẫu Writing › `title_en` rút gọn 40 ký tự.
- Speaking: `"<title_en> — IELTS Speaking Part N: câu trả lời mẫu | Aver Learning"`.
- Vocabulary mục từ: `"<headword> — nghĩa, phát âm, cách dùng | Aver Learning"`, `canonical` `/vocabulary?cat=<cat>&slug=<slug>`.
- Danh sách có bộ lọc: `canonical` về URL không tham số; có `q=` → `robots: noindex, follow` (như `/grammar/search`, test `frontend/tests/next-metadata.test.mjs`).

### 5.5 Ảnh Task 1 và audio công khai

Bucket mới `library-public` (đọc công khai, ghi chỉ `service_role`), tạo trong migration 400 với `file_size_limit` và `allowed_mime_types`, và khai trong `backend/services/storage_limits.py` theo STORAGELIMITS-0038: png/webp ≤ 2 MB; mp3/m4a ≤ 10 MB. Không chuyển ảnh sang `writing-images` (riêng tư; mở nó sẽ lộ ảnh đề thi thử `exam_only`). Đường dẫn theo `source_key`: `writing-samples/<source_key>/figure.png`; audio `speaking-samples/<source_id>/answer.<ext>`. Ba hình T19 lấy từ `backend/content/library/figures/` qua `overrides.image_path`.

### 5.6 CSP cho video

Thêm có giới hạn trong `frontend/tooling/content-security-policy.mjs`: `frame-src https://www.youtube-nocookie.com` và `script-src … https://www.youtube.com` (IFrame API tải `https://www.youtube.com/iframe_api` rồi `https://www.youtube.com/s/player/...`) **chỉ** cho `/library/speaking/:slug` qua `headers()` trong `frontend/next.config.ts` (cùng cơ chế `EMBEDDABLE_SAME_ORIGIN_ROUTES`), không mở toàn site. Video máy chủ riêng: `media-src` đã cho `https:`. Cập nhật `docs/CONTENT_SECURITY_POLICY.md`. Thay đổi bảo mật: PR riêng trong T13, ghi rõ trong thân PR.

### 5.7 API công khai (`backend/routers/library.py`, prefix `/api/library`)

| Method · path | Auth | Trả về | Ghi chú |
| --- | --- | --- | --- |
| `GET /summary` | không | `{writing_samples:{total, task2, task1}, writing_guides:{total}, speaking:{total, with_video}, grammar:{total}, vocabulary:{total}}`; trường null khi không đếm được | Cho `/library`. |
| `GET /writing-samples` | không | `{items:[{slug,title_en,task_type,question_type,task1_subtype,topic_slug,prompt_text}], total, page, page_size:12, facets:{task:{…}, question_type:{…}, topic:{…}}}` | `task`, `dang`, `chude`, `q` (≤ 100 ký tự), `trang` ≥ 1; sai → 422. Facet "bỏ chính nhóm đó" (đếm mỗi nhóm khi bỏ bộ lọc của chính nhóm). |
| `GET /writing-samples/{slug}` | không | bộ đề đã lọc trường (không `source_key`, `content_hash`, `source_review_status`, `integrity_check`, `difficulty_notes`, điểm ước tính) + `related[≤4]`, `prev`, `next`, `figure_url` | Slug cũ → 308 `Location`; không có → 404 `{"detail":"sample_not_found"}`. |
| `GET /writing-samples/index` | không | `[{slug, updated_at}]` | Cho sitemap; khai route trước `/{slug}`. |
| `GET /writing-guides`, `/{slug}` | không | `writing_tips` `published` có `content_type in ('knowledge','tip')`, kèm `groups[]` (Open question 4) | Không đụng hai route học viên hiện có. |
| `GET /speaking`, `/speaking/{slug}`, `/speaking/index` | không | tương tự; mỗi đề có `voice` | Chỉ `published` và `sample_text` không rỗng. |
| `GET /me/marks?shelf=` | có | `{marks:[{item_key, kind}]}` | Exempt, lý do "own library marks; no paid work". |
| `PUT /me/marks/{shelf}/{item_key}/{kind}` · `DELETE` cùng path | có | `204` | Idempotent; `item_key` phải tồn tại và `published`, không thì 404. `item_key` Grammar có `/` → mã hoá URL. |

Mọi GET công khai: `cacheable_json` + `Last-Modified` từ `max(updated_at)` (`backend/services/public_cache.py`); mỗi route một dòng `ACTIVATION_EXEMPT_ROUTES` lý do "public Library". Sinh lại `frontend/types/api.d.ts` như GOI-05 mục 8.

API admin (`backend/routers/admin_library.py`, T20): `require_admin` là lệnh await đầu; danh sách có lọc và số đếm từ máy chủ; sửa `title_en`, `topic_slug` (kiểm như script); đăng/gỡ một hoặc nhiều đề, máy chủ kiểm lại điều kiện đăng và trả danh sách bị loại kèm lý do; đổi slug sau lần đăng đầu chỉ qua vùng nguy hiểm (gõ xác nhận, ghi `writing_sample_slug_history`); mọi thay đổi ghi nhật ký admin hiện có. `tests/test_staff_guard_inventory.py` phải qua.

### 5.8 Script nhập `backend/scripts/import_writing_samples.py`

- Đầu vào: `--source <incoming>` bắt buộc, `--manifest`, `--topics`, `--figures` (đã có).
- Manifest (nguồn sự thật cho phần do người quyết, đã có 549 dòng): `{source_key, slug, title_en, topic_slug, topic_confidence, publish, review:{status, by, at, note}, content_hash, overrides}`. Nội dung bài không chép vào repo (Open question 2).
- Chế độ: `--check` (đã có, không cần DB); mặc định dry-run (kiểm + kế hoạch `INSERT/UPDATE/UNPUBLISH` so với staging); `--execute` (áp dụng rồi lập lại kế hoạch từ bản đọc mới; còn khác biệt → exit ≠ 0). `assert_staging(SUPABASE_URL)` như `import_writing_prompts.py`; production cần thay đổi riêng được duyệt.
- Mã kiểm: như gói mục 5.8 (đã cài ở #2358) cộng `E_PARSE`, `E_MARK`. **Thêm (khác gói):** `E_NOT_APPROVED` — `publish:true` mà `review.status != 'approved'` hoặc thiếu `review.by/at` → chặn bộ đó (điều kiện xuất bản của gói mục 10 câu 1 thành mã kiểm được).
- Ghi lô (G09-T36, CONTENTBATCH-0087): `--execute` gọi `import_batch_log.start(script='import_writing_samples', skill='writing', mode)` → `add_item(batch, kind='writing_sample', id=<source_key>, action='insert'|'update'|'unpublish'|'skip')` → `finish(batch, counts, error_report_path)`; lỗi ghi lô không làm hỏng lần nhập. `--check` và dry-run không ghi lô. Helper chưa có trên `staging` (20/11) → script in một dòng cảnh báo và chạy không ghi lô; nối helper trong PR nhỏ sau khi #2342 và mã của nó merge.
- Không nhập `difficulty_notes`, `integrity_check`, file `.mark.json`. Không đọc/ghi `ielts.db`, không chạy gì trong `ielts-pipeline`.
- `import_speaking_samples.py` (T13): đọc tệp theo `docs/SPEAKING_SAMPLE_CONTRACT.md` (phiên bản 1); chặn đề không có `sample_text`; `youtube_id` 11 ký tự; `start_ms` tăng dần, không vượt `duration_s`; `voice` phải là `synthetic`; ghi lô với `skill='speaking'`.

### Phụ thuộc chưa có — trạng thái dự phòng

| Thiếu | Hành vi tạm |
| --- | --- |
| G04 (khoá, lượt) | Lối sang khoá luôn hiện; "Viết đề này"/"Luyện nói đề này" ở trạng thái chưa có khoá. |
| G08 (đề điền sẵn) | "Viết đề này" mở trình soạn không điền sẵn; PR ghi `CHỜ G08`. |
| G05-T21 (lối chấm thử) | Không hiện khối "Chấm thử miễn phí đề này". |
| G11-T33 (renderer `figure`) | Bài Grammar hiện như hôm nay, không hình. |
| G09-T36 (lô nhập) | Script không ghi lô, in cảnh báo; thẻ `import` của `/admin/library` hiện "Chưa có dữ liệu lô nhập". |
| G09-T08 (khung admin) | `/admin/library` đặt trong khung admin hiện có, ghi rõ. |
| Câu trả lời mẫu từ VIDEO MAKING | Kệ Speaking rỗng "Chưa có đề nào"; `/library` ẩn số của kệ. |

## UI and interaction

- Ma trận trạng thái từng màn ở `ui-states.md`. Mọi màn: 1280px và 390px; tải/rỗng/lỗi; dùng được bằng bàn phím; nhãn tiếng Việt, tên tiêu chí và tiêu đề đề bằng tiếng Anh.
- Ghi dấu (FR-061) và lưu từ (FR-053): nút ở trạng thái "Đang lưu…" tới khi server trả lời, rồi đọc lại danh sách dấu; lỗi trả lại trạng thái cũ và báo chữ. Không trạng thái lạc quan lệch backend.
- Video: iframe nằm trong component client; server chỉ vẽ khung có kích thước cố định (không nhảy bố cục); IFrame API chỉ tải khi trang hiện hoặc khi người dùng bấm phát lần đầu; vị trí `<video>` nhớ ở `localStorage` khoá `aver-sp-pos:<slug>`, bọc try/catch.
- Ý định lưu từ qua đăng nhập lưu ở `sessionStorage` khoá `aver-pending-save-word`, kiểm lại slug khi đọc.

## Work decomposition

Thứ tự và chủ sở hữu file ở `tasks.md`. Tóm tắt: T02 (migration) → T06 (API Writing) → T07 (khuôn bài đọc) song song T08 (`/library`) → T09, T10 (Writing) → T11 (Kiến thức) → T13 (Speaking + CSP) → T16 (dấu) → T14 a/b/c (Grammar) và T15 (Vocabulary) → T17 (SEO) → T20 (admin) → T18 (nhập và xuất bản staging, nội dung). T03 dry-run/`--execute` đi ngay sau T02.

## Rollout and rollback

Chi tiết ở `rollout.md`: migration 400 lên staging trước dưới khoá advisory → API → trang → nhập nội dung `publish:false` → xuất bản theo lô → bật sitemap. Tắt: `published=false` hàng loạt (qua script hoặc `/admin/library`); migration chỉ thêm bảng nên deploy lại bản trước được.

## Verification strategy

- Backend: `tests/test_library_schema.py` (ràng buộc chéo, slug sai mẫu, `anon` không đọc được bảng nào, khoá chính `library_marks`, `shelves` hợp lệ), `tests/test_import_writing_samples.py` (đã có cho `--check`; thêm dry-run/`--execute` với DB giả), `tests/test_library_writing_api.py`, `tests/test_library_speaking_api.py`, `tests/test_library_marks_api.py`, `tests/test_admin_library.py`, cùng `test_activation_gate_inventory.py`, `test_public_cache_headers.py`, `test_staff_guard_inventory.py`, `test_public_schema_create_guard.py`, test của STORAGELIMITS-0038.
- Frontend: test hành vi (không so chuỗi lớp CSS, TESTPOLICY-0057) cho bộ lọc, phân trang, `delta-highlight`, `activeCueIndex`, trình phát, mục lục, gợi ý tra từ, dấu; `next-metadata.test.mjs`; test sitemap model; tooling `verify-grammar-404-ssr-flow.mjs`.
- `curl` trên build local: mã HTTP của URL Grammar cũ, 404 slug lạ, header CSP chỉ có ở route Speaking, `grep` trường cấm trong HTML.
- Staging: kịch bản `verification.md`, ảnh 10 trang ngẫu nhiên 1280/390 sau T18. Máy cloud hiện không vào được staging → bước xem staging ghi "chờ anh Andy kiểm tay trên staging" khi không có đường khác.
