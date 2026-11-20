---
id: LIBRARY-0061
title: Anyone can read the public Library of Writing samples, Writing guides, Speaking questions with synthetic-voice model answers, Grammar and Vocabulary without an account, and signed-in learners keep read and saved marks
status: draft
risk: high
owner: product
---

# Anyone can read the public Library of Writing samples, Writing guides, Speaking questions with synthetic-voice model answers, Grammar and Vocabulary without an account, and signed-in learners keep read and saved marks

Status: **draft** — soạn ngày 20/11/2026 cho nhiệm vụ `G06-T01` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-06-thu-vien-cong-khai.md` mục 1–10 (bản trên `staging`, gồm các dòng "Khớp chéo 18/11" và "Cập nhật 18/11 chiều") và `00-QUY-UOC-CHUNG.md` mục 2. Chưa dòng mã nào của Thư viện công khai chạy theo spec này; các hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy với mã ở `staging` ngày 20/11/2026. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec `0061` và dải migration **400–419** lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6.

Đánh số yêu cầu: `FR-06-NNN` của gói → `FR-NNN`, giữ nguyên số. Yêu cầu có hậu tố chữ `FR-06-005b` nhận số mới **FR-063** (sau số cuối FR-062). Chỗ nào trong gói ghi `FR-06-005b` thì đọc là FR-063.

## Tóm tắt (tiếng Việt)

- **Mục tiêu.** Một Thư viện mở cho mọi người, không cần tài khoản, gồm năm kệ: Bài mẫu Writing (549 đề, mỗi đề ba bài 7.5 / 7.0 / 6.0 kèm nhật ký khác biệt), Kiến thức Writing, Đề Speaking kèm câu trả lời mẫu giọng đọc tổng hợp, Ngữ pháp (Grammar Wiki hiện có, đổi giao diện, giữ URL), Từ vựng (Vocabulary Wiki hiện có, đổi giao diện, giữ URL). Người đã đăng nhập thấy thêm dấu đã đọc, đã lưu, sổ từ. Mỗi trang có đúng một lối kín đáo sang khoá học. Kệ thứ sáu "Kiến thức nền" (GOI-13 phần C) được giữ chỗ bằng mảng cấu hình, không dựng ở đây.
- **Lớp thay đổi.** `risk: high`: một migration bảng mới (dải 400–419) có RLS và REVOKE, bucket Storage công khai mới, route công khai mới trong cổng kích hoạt, nới CSP cho một route để nhúng YouTube, ghi dữ liệu người dùng (dấu đã đọc/đã lưu). PR mã dùng lớp `high-risk`, `Spec: LIBRARY-0061`, chỉ sau khi spec `approved`. Nhiệm vụ nội dung (T04, T05, T12, T18, T19) dùng `Change class: content`, `Spec: N/A` theo `specs/README.md`, ghi nguồn gốc và kiểm hợp lệ trong thân PR.
- **Phụ thuộc.** G03 (`frontend/components/ui/`, token `--av2-*`, font Source Serif 4 + Source Sans 3, khung công khai/học viên — UIBASE-0056). G04 (COURSEACCESS-0055) chỉ cho lối sang khoá và nút "Viết đề này"/"Luyện nói đề này"; thiếu dữ liệu G04 thì dùng trạng thái "chưa có khoá". G08 cho trình soạn Writing/trình luyện Speaking nhận đề điền sẵn. G05 cho `safeNext` và trang lỗi; G05-T21 cho lối "Chấm thử miễn phí đề này". G09-T36 (CONTENTBATCH-0087, PR #2342 đang mở; helper `backend/services/import_batch_log.py`, migration 449–450) cho bản ghi lô nhập; G09-T08 (ADMINIA-0074) cho khung admin của T20. GOI-11 G11-T33 (GRAMMARFIG-0084) cho khối `figure` trong bài Grammar. Repo VIDEO MAKING (ngoài phạm vi, không đụng) cấp video/audio và lời thoại có mốc. Song song được với G05 và G07.
- **Ước lượng** (từ gói, không phải cam kết): 20 nhiệm vụ, 20 PR, khoảng 34 phiên; độ khó chung 4/5. Năm nhiệm vụ nội dung và phần `--check` của T03 đã merge vào `staging` trước spec này (mục "Hiện trạng đã có" bên dưới), nên phần còn lại là 14 nhiệm vụ mã + T18 nội dung.

## Quyết định đã có

Từ `00-QUY-UOC-CHUNG.md` mục 2 và các bản cập nhật của gói (không hỏi lại):

- **Điểm 20 (17/11):** kho 549 bài mẫu và hình Task 1 mở công khai được — bỏ điều kiện chặn vì bản quyền (gói mục 10 câu 1 đóng). 19 bộ chưa có trạng thái duyệt và 3 bộ Task 1 thiếu hình: người thực thi rà và tạo luôn (G06-T19; câu 9 đóng).
- **Điểm 22 (18/11):** câu trả lời mẫu Speaking do repo VIDEO MAKING sản xuất (kịch bản, giọng tổng hợp Kokoro, dựng video); web chỉ hiển thị video/audio và lời thoại có mốc, ghi nhãn "Giọng đọc tổng hợp" (câu 8 đóng). Minh hoạ của web là sơ đồ câu chữ, không tranh khắc.
- **Điểm 23 (18/11 chiều):** Kiến thức nền theo chủ đề mở công khai và thuộc Thư viện (spec ở GOI-13: TOPICKNOW-0097, kệ `/library/background` do G13-C05 thêm vào mảng kệ); đoạn viết ngắn tính 1 lượt. Đọc kỹ gắn 20 mô đun của dàn 381 bài (CLOSEREAD-0098). Gói này không dựng hai trang đó.
- Trang `/admin/library` thuộc G06 (G06-T20); G09 chỉ đặt mục sidebar `available:false`.
- Script nhập ghi bản ghi lô qua `services/import_batch_log.py` của G09-T36.
- **20/11 ("đồng ý cả 11", `04-VIEC-DE-LAI.md`, tóm tắt ở `/mnt/project-files/dot-a/11-cau-cho-andy-20261120.md`):** câu 9 — tên bài Grammar Wiki lấy theo frontmatter `title` (khuôn bài T14 đọc `title` frontmatter, không đọc `_groups.yaml`); câu 10 — "Mở bài mẫu ngay" của GOI-12 chỉ mở trang bài mẫu của Thư viện (route ở FR-013 là đích).

## Hiện trạng đã có trên `staging` (20/11/2026)

Gói ghi các con số "trước T04/T05"; trên `staging` các nhiệm vụ nội dung sau đã merge, nên các mã lỗi đã giảm:

| Nhiệm vụ | PR | Kết quả trên `staging` |
| --- | --- | --- |
| G06-T03 phần `--check` | #2358 | `backend/scripts/import_writing_samples.py` chỉ có `--check` (cùng `--write-hashes`, `--band-csv`); dry-run và `--execute` bị từ chối cho tới khi có bảng của T02. Đủ mã lỗi mục 5.8 cộng `E_PARSE`, `E_MARK`; `overrides` cho phần bổ sung của T19. |
| G06-T04 | #2362 | `backend/content/library/topics.json`: 14 chủ đề (`environment` … `sport`), cả 14 đều `shelf: "writing"`. 549 dòng manifest đều có `topic_slug` hợp lệ và `topic_confidence`. |
| G06-T05 | #2363 | 549 dòng có `title_en` + `slug` theo 5.4. |
| G06-T19 | #2360 | 19 bộ thiếu `review_status` → `review.status='approved'`; ba hình `backend/content/library/figures/task1_{bricks,internet,island}.png` dựng bằng `backend/scripts/library/draw_task1_figures.py`; cặp LR bổ sung qua `overrides.justification_jumps`. |
| G06-T12 | #2343 | `backend/content/library/speaking-samples-manifest.json` (210 đề: Part 1 57, Part 2 84, Part 3 69; `topic_slug` đều `null`; 0 đề có `sample_text`) và hợp đồng `docs/SPEAKING_SAMPLE_CONTRACT.md` (đặt ở `docs/` vì script rà Grammar đếm mọi `.md` dưới `backend/content/`). |

Manifest Writing hiện: 19 bộ `approved`, **530 bộ `needs_review` chờ người duyệt ký `review.by/at`**, cả 549 `publish:false`. Theo bản ghi của nhiệm vụ trước (19/11), `--check` trên nguồn ngoài repo ra cả 549 bộ **không lỗi chặn**, chỉ 529 `W_BAND_NEAR` (cảnh báo): 530 bộ `needs_review` không bị `E_NO_REVIEW` vì nguồn đã có `review_status`. Điều kiện xuất bản vẫn là `review.status='approved'` (gói mục 10 câu 1), nên 530 bộ này chờ người duyệt ký (Open question N1).

## Problem

Người chưa có tài khoản không có chỗ nào trên site để đọc tài liệu luyện thi ngoài Grammar Wiki và Vocabulary Wiki; hai khu này có giao diện cũ, và mọi mục từ Vocabulary đều khai `canonical` là `/vocabulary` nên máy tìm kiếm coi mọi từ là một trang. Kho 549 bộ bài mẫu Writing (ba mức band kèm nhật ký khác biệt) nằm ngoài repo, chưa có bảng, chưa có trang. Kiến thức Writing (`writing_tips`) chỉ đọc được khi đã đăng nhập và đã kích hoạt. Kệ Speaking chưa có chỗ chứa câu trả lời mẫu hay video. Người đã đăng nhập không có dấu "đã đọc" do mình tự bấm.

Hiện trạng repo (gói mục 2.1, kiểm lại trên `staging` 20/11):

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
| --- | --- | --- |
| Thư viện | Không có route `library` trong `frontend/app` | `/library` là mục 5 của thanh học viên (G07); G06 làm nó công khai. |
| Grammar Wiki | `backend/content/<category>/*.md`, `backend/routers/grammar.py`, `frontend/app/(public-content)/grammar/`, `frontend/lib/grammar-api.ts`; 404 thật qua `frontend/proxy.ts` | Bảng `saved_articles`, `article_views` (mig 015). Nhiều test ghim chuỗi giao diện (gói mục 2.1, xem T14). |
| Vocabulary Wiki | Bảng `vocab_cards` (mig 110/122, một giọng), dự phòng `backend/content_vocab/`, `backend/routers/vocabulary.py`, `frontend/app/(public-content)/vocabulary/` | `canonical` chung `/vocabulary`. |
| Sổ từ | Bảng `user_vocabulary` (mig 019), `backend/routers/vocabulary_bank.py` | Sau cờ `VOCAB_BANK_FEATURE_FLAG_ENABLED` (mặc định `False`) và `users.feature_flags.vocab_enabled`; router gắn `_ACTIVE_LEARNER`. |
| Đề Writing | `writing_prompts` (mig 035); ảnh Task 1 ở bucket riêng tư `writing-images` | Không chứa bài mẫu; không chuyển ảnh sang bucket này. |
| Kiến thức Writing | `writing_tips` (mig 082/083); `GET /api/writing/tips*` bắt buộc đăng nhập | Không công khai. |
| Đề Speaking | `topics`, `topic_questions`; `backend/content/speaking_bank/` | `topics` không có slug; `sessions.topic` là chuỗi. |
| Câu trả lời mẫu / video | Không có cột/bảng nào | Phải thêm bảng. |
| CSP | `frontend/tooling/content-security-policy.mjs` (không `frame-src`), `next.config.ts` `EMBEDDABLE_SAME_ORIGIN_ROUTES` | YouTube bị chặn hiện nay. |
| Hạ tầng dùng lại | `backend/services/public_cache.py`, `backend/services/activation_gate.py` `ACTIVATION_EXEMPT_ROUTES`, `backend/services/storage_limits.py` (STORAGELIMITS-0038), `frontend/app/sitemap.ts` + `frontend/lib/public-sitemap-model.mjs`, `frontend/app/robots.ts` | `/library` chưa có trong sitemap/robots. |
| Migration | `backend/migrations/register.tsv`: số cao nhất đang dùng/giữ dưới 500 là 382; 400–419 chưa có hàng nào | Lấy số trong dải G06. |

Nguồn 549 đề (gói mục 2.2): thư mục `incoming/` của project riêng `ielts-pipeline` trên ổ ngoài máy anh Andy; 479 Task 2 · 70 Task 1 Academic; dữ liệu thắng số mẫu của tờ thiết kế.

## Scope

- `/library` (tờ ThuVien); `/library/writing-samples` + `/[slug]` (BaiMauWritingDanhSach + BaiMauWriting); `/library/writing-guides` + `/[slug]` (KienThucWriting); `/library/speaking` + `/[slug]` (DeSpeakingDanhSach + DeSpeaking).
- Giao diện mới cho `/grammar/**` (ba tờ GrammarWiki, GrammarWikiBai, GrammarWikiMinhHoa; tờ NguPhap là khuôn bài đọc chung) giữ URL, mã HTTP và frontmatter.
- Giao diện mới cho `/vocabulary` (TuVung) giữ URL, `canonical` đúng từng mục từ, "Lưu vào sổ từ".
- Một migration tạo `library_topics`, `writing_samples`, `writing_sample_slug_history`, `speaking_samples`, `library_marks` + bucket riêng tư `library-media` và route ký tệp theo trạng thái đăng; router công khai `backend/routers/library.py`; script nhập Writing (hoàn thiện dry-run/`--execute`) và Speaking; dấu đã đọc/đã lưu; SEO; lối sang khoá học; trang `/admin/library` (G06-T20).
- Mảng cấu hình kệ để GOI-13 thêm kệ thứ sáu mà không sửa bố cục (FR-063).

## Non-goals

- Dựng trang Kiến thức nền, Đọc kỹ, khuôn luyện đề (GOI-13 phần C, D, E: 0097, 0098, 0099). Khối "Học viên nói gì" (GOI-13 phần A).
- Trình soạn Writing và trình luyện Speaking nhận đề điền sẵn (G08); kiểm quyền khoá/lượt (API của G04).
- Sản xuất câu trả lời mẫu Speaking — kịch bản, giọng đọc, video — và mọi thao tác trong repo VIDEO MAKING.
- Renderer sơ đồ câu Grammar (GOI-11 G11-T33 / GRAMMARFIG-0084); viết mới bài Grammar/Vocabulary; đổi slug hay metadata Grammar (G13-B04 đổi `title` frontmatter sau T14 PR (a)).
- Mục sidebar "Thư viện công khai" của admin (G09); thanh học viên (G03/G07); các trang `/vocabulary/hub|practice|exam|learn|sets|study` (G07).
- Ghi vào `ielts-pipeline` hay `ielts.db`; gọi AI trả phí để đặt tiêu đề, gán chủ đề hay viết nội dung.
- Chạy script nhập trên production (cần thay đổi riêng được duyệt).

## Users and journeys

- **Khách chưa đăng nhập:** mở `/library`, lọc 549 đề Writing, đọc ba bài và nhật ký khác biệt, xem đề Speaking và nghe câu trả lời mẫu, đọc Grammar/Vocabulary; thấy một lối sang khoá học.
- **Học viên đã đăng nhập (kể cả tài khoản chưa có mã, `is_active=false`):** như khách, cộng dấu đã đọc/đã lưu, cột "Của bạn", lưu từ vào sổ từ (khi sổ từ bật cho họ), nút "Viết đề này"/"Luyện nói đề này" khi có khoá còn lượt.
- **Admin:** nhập nội dung bằng script trên staging, xem tình trạng đăng và đăng/gỡ ở `/admin/library`.
- **Người duyệt nội dung (anh Andy hoặc người được giao):** ký `review.by/at` trong manifest, xem danh sách `W_BAND_NEAR`.

## Requirements

Chung

- **FR-001:** Mọi trang Thư viện xem được khi chưa đăng nhập; nội dung chính (đề, ba bài, nhật ký khác biệt, lời thoại, bài ngữ pháp, mục từ) nằm trong HTML server, đọc được khi tắt JS.
- **FR-002:** Khung theo phiên: khách thấy thanh và chân trang công khai; người đã đăng nhập thấy thanh học viên với mục "Thư viện" đang chọn. Không chuyển hướng người đã đăng nhập ra hay vào khu công khai.
- **FR-003:** Mỗi trang có đúng một lối sang khoá học, đặt cuối danh sách hoặc cuối bài (không giữa bài, không cửa sổ bật lên); ẩn khi người xem đã có khoá chứa nội dung đó theo dữ liệu G04; thiếu dữ liệu thì hiện.
- **FR-004:** Số đếm (số đề, số bài, theo dạng, theo chủ đề) đọc từ API; không có dữ liệu thì không hiện số (không "0", không "0/0").
- **FR-005:** Mọi bộ lọc và ô tìm ghi vào URL; mở lại URL ra đúng trạng thái; đổi bộ lọc đưa về trang 1.

Bài mẫu Writing

- **FR-010:** Danh sách có bộ lọc Task (Tất cả · Task 2 · Task 1), Dạng (sáu dạng Task 2; vô hiệu và bị bỏ chọn khi chọn Task 1), Chủ đề (bảng `library_topics`), ô tìm theo tiêu đề và câu đề không phân biệt hoa thường sau 300 ms ngừng gõ; tham số URL `task`, `dang`, `chude`, `q`, `trang`.
- **FR-011:** 12 đề một trang; số thứ tự đếm trong kết quả đang lọc; một trang thì ẩn phân trang; khi tải giữ đúng 12 dòng chỗ; lỗi giữ bộ lọc và có nút "Tải lại" gọi lại đúng truy vấn; không kết quả thì hiện trạng thái rỗng của tờ và giữ bộ lọc.
- **FR-012:** Mỗi dòng có tiêu đề tiếng Anh ngắn (đậm) và câu đề cắt một dòng (390px: hai dòng); câu đầy đủ có trong HTML; cả dòng là một liên kết.
- **FR-013:** Trang một đề mặc định chế độ "Đọc từng bài", bài 7.5; URL giữ chế độ xem, mức điểm và cặp so sánh qua tham số `xem`, `muc`, `cap`.
- **FR-014:** Nhật ký khác biệt ghi đủ tên tiêu chí tiếng Anh (Task Response/Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy), câu của bản cao, câu của bản thấp và lý do tiếng Việt; tô/gạch bằng khớp đúng chuỗi trong đoạn; không khớp thì chỉ hiện ở lề; lỗi chỉ có ở bản thấp thì chỉ gạch cột phải.
- **FR-015:** Không hiện mã tiêu chí viết tắt, mã ý, tên dạng viết liền (ví dụ `problem_solution`), `difficulty_notes`, `integrity_check`, hay điểm ước tính từng tiêu chí ở bất kỳ trang hay API công khai nào.
- **FR-016:** Đề Task 1 có khối đề kèm hình; mục 3 là "Đặc điểm chính"; mục nào không có dữ liệu thì bỏ khỏi mục lục và đánh số lại.
- **FR-017:** Từ vựng trong bài dẫn tới mục từ ở kệ Từ vựng chỉ khi mục từ tồn tại; đề liên quan cùng dạng hoặc cùng chủ đề, tối đa 4; đề trước/sau theo thứ tự danh sách mặc định.
- **FR-018:** Người chưa có khoá thấy khối "Tự viết đề này" cuối trang với nút phụ; người có khoá còn lượt thấy nút chính "Viết đề này" cạnh đề, dẫn tới trình soạn G08 với đề điền sẵn; hết lượt thì thấy "Đăng ký thêm lượt chấm".
- **FR-019:** Một đề chỉ lên trang khi `published = true`; đề bị gỡ trả HTTP 404, đề đổi slug sau xuất bản trả 308 tới slug mới.

Kiến thức Writing

- **FR-020:** Danh sách có bốn nhóm cố định Task 1 · Task 2 · Tiêu chí chấm · Dạng đề; một bài ở được hai nhóm với cùng một URL.
- **FR-021:** Khuôn bài đọc dùng chung với Ngữ pháp: cột chữ 640px Source Serif 4 18/29; mục lục trong trang ở cột trái 224px, dính, mục đang đọc có gạch trái 3px và chữ đậm (390px: khối mở/đóng, mặc định đóng); chú thích lề đánh số mũ, ghi chú ở cột phải 248px (390px: ngay dưới đoạn).
- **FR-022:** Đoạn mẫu có chú thích: bấm số ở lề tô đúng cụm, bấm lại bỏ tô, số đánh lại từ 1 trong mỗi đoạn; trích dẫn bài mẫu lấy từ `writing_samples` theo mã bài và mở đúng đề và đúng bản; bài mẫu bị gỡ thì trích dẫn bị bỏ khỏi HTML.
- **FR-023:** Ngày cập nhật của bài là lần sửa nội dung gần nhất (`updated_at`), không phải ngày đăng.

Đề Speaking

- **FR-030:** Danh sách lọc theo Part (Tất cả/1/2/3), một chủ đề, công tắc "Chỉ đề có video trả lời mẫu" và ô tìm 300 ms; URL `part`, `chude`, `video`, `q`; các bộ lọc kết hợp "và"; nhóm theo chủ đề, trong nhóm xếp Part 1 → 2 → 3 rồi theo tên; nhóm rỗng sau lọc ẩn cả tiêu đề.
- **FR-031:** Tình trạng video luôn bằng chữ: "Có video trả lời mẫu" kèm thời lượng, hoặc "Chưa có video" kèm "câu trả lời mẫu dạng audio" hay "dạng chữ"; đề chưa có câu trả lời mẫu nào thì không lên kệ; web chỉ hiển thị câu trả lời mẫu do repo VIDEO MAKING giao, không tạo và không sửa nội dung.
- **FR-032:** Trang đề nhúng video YouTube qua `youtube-nocookie.com` và đọc vị trí qua YouTube IFrame API để tô câu; video máy chủ riêng dùng `<video>` và nhớ vị trí theo đề trong trình duyệt; không tự phát ở cả hai nguồn.
- **FR-033:** Câu đang phát là câu có mốc bắt đầu lớn nhất không vượt thời điểm hiện tại; bấm câu thì tua tới mốc và phát; video lỗi thì mốc thành chữ thường không bấm được; không có video thì mục 2 thành "Câu trả lời mẫu" với audio thu gọn (không audio thì bỏ mốc); không bao giờ có khung video trống.
- **FR-034:** "Từ vựng đáng học" được đánh dấu nền nhạt + gạch đôi, "Cấu trúc đáng học" gạch liền, luôn có số và nhãn chữ ở lề; câu trả lời mẫu không gắn band.
- **FR-035:** "Luyện nói đề này": có khoá còn lượt Speaking thì nút chính mở trình luyện G08 với đề này; hết lượt thì hiện "Hết lượt chấm AI" kèm đường xem khoá; chưa có khoá thì nút phụ "Xem các khoá"; đề trước/sau theo thứ tự trong chủ đề rồi sang chủ đề kế.
- **FR-036:** Mọi nơi phát câu trả lời mẫu Speaking (trang đề, thẻ danh sách có nút nghe) ghi nhãn chữ "Giọng đọc tổng hợp" cạnh trình phát video và audio, luôn hiện, không chỉ trong tooltip.

Ngữ pháp

- **FR-040:** Mọi URL `/grammar`, `/grammar/[category]/[slug]`, `/grammar/search`, `/grammar/compare`, `/grammar/roadmap`, `/grammar/exercises` giữ nguyên và trả cùng mã HTTP như trước (bài lạ vẫn HTTP 404 qua `proxy.ts`); frontmatter không đổi; giao diện theo ba tờ GrammarWiki (trang chủ: cây 10 nhóm theo `_groups.yaml`, hai chế độ `?mode=`, tìm, "Lỗi hay gặp", một khối mời khoá cuối trang), GrammarWikiBai (H1 tách Anh/Việt, mục lục theo H2, tự kiểm tra, bài liên quan, khối "Trong khoá"/"Đăng ký lại" lấy nhãn từ `course-access-labels.mjs`) và GrammarWikiMinhHoa; tên bài lấy từ frontmatter `title`.
- **FR-041:** Mục lục bài mặc định "Theo nhóm"; "A–Z" xếp theo tên tiếng Việt, chữ cái không có bài thì mờ và không bấm được; ô tìm lọc khi gõ, bỏ dấu vẫn khớp, khớp cả tên tiếng Anh; không kết quả thì nêu từ đã tìm và có nút xoá.
- **FR-042:** Kiểm tra nhanh chạy ở trình duyệt, không gửi, không lưu; còn câu trống thì báo số câu chưa chọn và không chấm; đổi đáp án sau khi chấm thì xoá kết quả cũ.
- **FR-043:** Nút "Đã đọc" của bài Grammar chỉ người đã đăng nhập thấy, do họ tự bấm và bỏ được.
- **FR-044:** Khuôn bài Grammar giữ nguyên `<figure class="gw-fig …">` mà renderer của GOI-11 (G11-T33) trả trong `html`, đặt chú thích "Hình N" ở lề phải (điện thoại: ngay dưới hình) và nạp CSS sơ đồ của GOI-11 trên trang bài; G06 không viết renderer, không vẽ hình; khi G11-T33 chưa merge thì bài hiện như hôm nay, không có hình.

Từ vựng

- **FR-050:** `/vocabulary` giữ URL; mục từ mở bằng `?cat=&slug=` như hiện tại; `canonical` của mục từ là chính URL `/vocabulary?cat=<cat>&slug=<slug>`.
- **FR-051:** Gợi ý tra từ hiện từ ký tự thứ hai, tối đa 5 dòng, khớp đầu từ trước rồi dạng chia; ↑ ↓ chọn, Enter mở, Esc đóng; "Tra từ" khi không chọn dòng mở trang kết quả; không thấy thì gợi ý tối đa 3 từ gần giống theo khoảng cách chỉnh sửa; không có thì hiện mẹo và lối A–Z, chủ đề.
- **FR-052:** Nút nghe không tự phát; đang phát thì nền mực và nhãn "Dừng"; lỗi tải thì nút vô hiệu và hiện dòng "Chưa tải được âm thanh"; IPA luôn dùng font Source Sans 3 và giữ "ɡ" (U+0261).
- **FR-053:** "Lưu vào sổ từ": khách bấm thì thấy lời nhắc ngay dưới nút dẫn tới đăng nhập kèm `next` và ý định lưu, sau đăng nhập quay về đúng mục từ và lưu luôn; người đã đăng nhập bật/tắt tại chỗ với trạng thái "Đang lưu…".
- **FR-054:** Phần của mục từ không có dữ liệu thì ẩn cả phần và bỏ khỏi mục lục; "Trong bài mẫu Writing" chỉ hiện khi từ có trong ít nhất một bài mẫu đã xuất bản, liên kết mở bài và tô từ đó.

Trạng thái đã đăng nhập, SEO

- **FR-060:** Người đã đăng nhập thấy cột "Của bạn" và nhóm lọc "Của bạn" (đã đọc, đã lưu) ở danh sách Writing, cột "Bạn" ở danh sách Speaking; dấu luôn kèm chữ. Công tắc "Chỉ đề chưa luyện" chỉ có khi phiên Speaking ghi được `topic_id` (Open question 6).
- **FR-061:** Dấu đã đọc/đã lưu ghi ở server, chỉ chủ tài khoản đọc và ghi được; tài khoản chưa có mã lớp (`is_active=false`) vẫn dùng được; xoá tài khoản thì dấu xoá theo.
- **FR-062:** Sitemap có `/library`, các trang danh sách, mọi trang đề Writing/Speaking và bài Kiến thức Writing đã xuất bản; `robots` cho phép `/library`; mỗi trang có `title`, `description`, `canonical` theo plan mục 5.4; trang có `q=` là `noindex, follow`.
- **FR-064:** Ảnh đề Task 1 và audio câu trả lời mẫu chỉ tải được khi bản ghi của chúng đang `published`: tệp của bản nháp không đọc được bằng bất kỳ URL nào; tệp của đề đã đăng đọc được không cần đăng nhập; sau khi gỡ, mọi yêu cầu mới tới đúng URL đã phát ra trả 404 ngay, kể cả khi tệp đã được tải trước đó.
- **FR-063:** `/library` dựng danh sách kệ từ một mảng cấu hình (không gõ cứng năm kệ trong JSX); ở đợt này mảng có đúng năm kệ, không hiện kệ trống hay nhãn "Sắp có"; thêm một phần tử vào mảng (kệ thứ sáu `/library/background` của GOI-13 phần C) thì trang vẽ sáu kệ mà không vỡ lưới ở 390px.

## Acceptance scenarios

Gói mục 9 viết lại theo Given/When/Then; bảng đầy đủ theo FR ở `verification.md`.

### Scenario 1 — khách mở Thư viện

- **Given** khách chưa đăng nhập
- **When** mở `/library`
- **Then** thấy năm kệ với số đếm thật (hoặc không số khi API không đếm được), không có lời nhắc đăng nhập chặn nội dung (FR-001, FR-004, FR-063)

### Scenario 2 — bộ lọc Writing ghi URL

- **Given** `/library/writing-samples?task=task2&dang=opinion`
- **When** tải trang
- **Then** chỉ có đề Opinion, 12 đề một trang, URL giữ nguyên khi tải lại; **When** chọn Task 1 **Then** nhóm Dạng vô hiệu và `dang` biến khỏi URL, `trang` về 1 (FR-005, FR-010, FR-011)

### Scenario 3 — trang đề đọc được khi tắt JS, không lộ trường nội bộ

- **Given** một đề đã xuất bản
- **When** mở trang với JS tắt
- **Then** HTML có câu đề, ba bài, nhật ký khác biệt; không có chuỗi `TR:`, `problem_solution`, điểm ước tính (FR-001, FR-013, FR-015)

### Scenario 4 — so sánh cặp

- **Given** chế độ so sánh 7.0 ↔ 6.0
- **When** xem nhật ký
- **Then** câu khớp được tô ở cả hai cột, lỗi chỉ ở bản thấp chỉ gạch cột phải, câu không khớp hiện ở lề (FR-014)

### Scenario 5 — slug cũ và slug lạ

- **Given** một đề đã đổi slug sau xuất bản
- **When** mở slug cũ
- **Then** nhận 308 tới slug mới; **Given** slug không có **Then** HTTP 404 thật (FR-019)

### Scenario 6 — video Speaking

- **Given** đề Speaking có YouTube
- **When** mở trang
- **Then** video không tự phát và nhãn "Giọng đọc tổng hợp" hiện cạnh trình phát; **When** bấm câu thứ ba **Then** video tua tới mốc và câu được tô; **Given** id YouTube sai trên staging **Then** mốc là chữ thường (FR-032, FR-033, FR-036)

### Scenario 7 — Grammar giữ URL

- **Given** `/grammar/tenses/past-perfect`
- **When** mở
- **Then** cùng URL, giao diện mới, mục lục theo `toc`; **Given** `/grammar/tenses/khong-co` **Then** HTTP 404 thật (FR-040)

### Scenario 8 — Vocabulary canonical và sổ từ

- **Given** `/vocabulary?cat=economy&slug=<slug>`
- **When** xem nguồn trang
- **Then** `<link rel="canonical">` là URL đó; **When** khách bấm "Lưu vào sổ từ" **Then** lời nhắc hiện dưới nút; **When** đăng nhập bằng tài khoản thử có sổ từ bật **Then** quay về đúng mục từ và từ đã nằm trong sổ (FR-050, FR-053)

### Scenario 9 — dấu riêng của từng người

- **Given** người A đánh dấu đã đọc một đề Writing
- **When** A tải lại danh sách
- **Then** cột "Của bạn" ghi "Đã đọc"; người B không thấy dấu đó và không ghi được vào dấu của A (FR-060, FR-061)

### Scenario 10 — script nhập

- **Given** nguồn `incoming/` hiện tại và manifest trên `staging`
- **When** chạy `--check`
- **Then** 0 lỗi chặn (không còn `E_NO_REVIEW`, `E_NO_TITLE`, `E_TOPIC`, `E_FIGURE`, `E_PAIR`), 529 `W_BAND_NEAR`; script từ chối `publish:true` cho bộ chưa có `review.status='approved'` (FR-019)

### Scenario 11 — quyền tải tệp theo trạng thái đăng

- **Given** đề Task 1 đã nhập `publish:false` có ảnh trong `library-media`
- **When** khách gọi `/api/library/media/writing-sample/<slug>/figure` hoặc thử URL object Storage công khai của bucket
- **Then** cả hai không trả tệp (404 / bucket không công khai); **When** đề được đăng **Then** route trả nội dung ảnh với `no-store`; **When** tải ảnh một lần (làm nóng mọi cache) rồi gỡ đề **Then** cùng URL đó trả 404 ngay và vẫn 404 khi thử lại sau 300 giây (FR-064)

### Scenario 12 — kệ thứ sáu

- **Given** mảng kệ có thêm một phần tử giả trong test
- **When** vẽ `/library` ở 390px
- **Then** có sáu kệ, lưới không vỡ, không có nhãn "Sắp có" ở cấu hình thật (FR-063)

## Edge cases

- Nguồn đổi sau khi đã duyệt (`W_HASH`): bộ đó dừng xuất bản tới khi người duyệt xác nhận lại.
- Bài mẫu bị gỡ khi trang Kiến thức đang trích: thẻ trích bị bỏ khỏi HTML (FR-022).
- API backend lỗi khi build hoặc khi render: trang danh sách hiện trạng thái lỗi có "Tải lại"; sitemap bỏ qua phần lỗi như Grammar; `next build` không cần backend (`connection()` + Suspense như `vocabulary/page.tsx`).
- `PUT` dấu hai lần → một hàng; `item_key` không tồn tại hoặc chưa xuất bản → 404; lỗi ghi → giao diện trả lại trạng thái cũ và báo bằng chữ (không lạc quan).
- Kệ Speaking chưa có đề nào có `sample_text` (hiện 0/210) → kệ hiện "Chưa có đề nào", `/library` không hiện số cho kệ đó.
- G04/G08/G05-T21/G11-T33/G09-T36 chưa merge → trạng thái dự phòng ghi ở `plan.md` mục "Phụ thuộc chưa có", không chặn trang đọc.
- Trùng route `/library` với G07 → chỉ một route ở `(public-library)`.

## Success criteria

- Số đề Writing đã xuất bản trên staging khớp số `publish:true` trong manifest; mọi trang đề trả 200 khi xuất bản, 404 khi gỡ.
- Mọi URL Grammar cũ trả cùng mã HTTP; số URL Grammar trong sitemap không đổi.
- Không API hay trang công khai nào chứa trường cấm của FR-015 (`grep` trên HTML và JSON của test).
- `anon`/`authenticated` không đọc được bảng nào trong năm bảng mới (test schema).
- Tệp của đề nháp hoặc đã gỡ không tải được; sau khi gỡ, yêu cầu mới tới URL cũ trả 404 ngay (FR-064).
- Mọi FR có dòng kiểm ở `verification.md`; ảnh 1280px và 390px của mỗi màn đặt cạnh tờ thiết kế trong PR.

## Open questions

Gói mục 10 (giữ số câu của gói) cộng câu mới phát hiện khi soạn spec (N1–N4). Mỗi câu có đề xuất và mặc định tạm người thực thi dùng nếu chưa có trả lời. Câu 1, 8, 9 đã đóng (mục "Quyết định đã có").

| # | Câu hỏi | Đề xuất | Mặc định tạm |
| --- | --- | --- | --- |
| 2 | Nội dung 549 bộ (≈30 MB) có chép vào repo không, hay script đọc từ thư mục ngoài? | Không chép: script đọc `--source`, repo giữ manifest + `content_hash` + `overrides`. Lý do: nội dung nằm sẵn trong DB staging sau T18, nhập lại được từ ổ của anh; repo không phình 30 MB. (Gói đề xuất chép; người soạn spec đề xuất ngược lại vì T03/T19 đã chạy tốt theo cách đọc ngoài.) | Script đọc `--source` ngoài |
| 3 | Danh sách chủ đề bộ lọc | Giữ 14 chủ đề đã merge ở `topics.json` (#2362, đã qua CM review) | Dùng 14 chủ đề đó |
| 4 | Bốn nhóm Kiến thức Writing ánh xạ từ `writing_tips` thế nào? | Đợt này ánh xạ tạm bằng mã, không migration: `task_1`→Task 1, `task_2`→Task 2, `both`→cả hai; `category` khớp `criteria`/`question-type` → nhóm tương ứng. Thêm cột `groups text[]` khi admin cần chọn tay. Lý do: không mở thêm migration cho bảng cũ khi chưa biết số bài đã xuất bản. | Ánh xạ tạm |
| 5 | "Lưu vào sổ từ" cho người chưa có mã/khoá | Mở cho mọi tài khoản đã đăng nhập ở đường lưu thủ công (miễn phí, không tốn AI); cần sửa spec INACTIVEWRITE-0035 nên tách thành thay đổi riêng | Chỉ hiện nút khi `GET /api/vocabulary/bank/stats` trả 200 cho người đó |
| 6 | "Đề đã luyện" ở kệ Speaking khi `sessions.topic` là chuỗi | G08 thêm `topic_id` vào phiên mới; G06 chỉ hiện đã đọc/đã lưu tới lúc đó | Không có công tắc "Chỉ đề chưa luyện" |
| 7 | Mục từ Vocabulary có vào sitemap không? | Có, sau khi `canonical` từng mục từ đã đúng ít nhất 4 tuần | Không thêm |
| 10 | Hiện mức "ước lượng" cho câu trả lời mẫu Speaking? | Không (tờ: không gắn band) | Không hiện |
| 11 | Phạm vi câu trả lời mẫu đợt đầu từ repo VIDEO MAKING | 20 đề Part 2 đầu, một câu trả lời mẫu mỗi đề | Web nhận mọi số lượng theo hợp đồng |
| 12 | Thẻ "Kệ và bài nổi bật" và "SEO" của `/admin/library` có làm đợt đầu? | Để đợt sau; đợt đầu ba thẻ Writing, Speaking, Lô nhập | Không dựng |
| 13 | T19: người thực thi tự đặt `approved` cho 19 bộ, hay anh xem bảng rà trước? | Đã làm theo đề xuất ở #2360 (tự duyệt, bảng rà trong PR); anh chỉ cần xác nhận | Tự duyệt; xuất bản sau T18 |
| 14 | Kiến thức nền: đường dẫn, vị trí kệ, sitemap | Đã chốt theo GOI-13: kệ thứ sáu `/library/background`, vào sitemap; G06 chỉ giữ mảng kệ (FR-063) | Không dựng |
| N1 | Ai ký `review.by/at` cho 530 bộ đang `needs_review` (nguồn đã có `review_status="revised_20261017"`)? | Anh Andy ký một lần cho cả lô sau khi xem mẫu ngẫu nhiên 20 bộ trong `w-band-near-549.csv`; người thực thi ghi `review.by='andy'`, `review.at`=ngày anh trả lời, trong PR nội dung trước T18. Lý do: nguồn đã được rà ngày 17/10, ký từng bộ không thêm giá trị. | T18 chỉ nhập `publish:false` cho các bộ chưa ký; chỉ xuất bản 19 bộ `approved` |
| N2 | Chủ đề cho kệ Speaking: `library_topics.shelf` chỉ nhận `writing` hoặc `speaking`, mà 14 chủ đề hiện là `writing` và 210 đề Speaking chưa có `topic_slug` | Dùng chung một bộ chủ đề cho hai kệ: đổi cột thành `shelves text[]` (`{writing,speaking}`), thêm chủ đề riêng Speaking khi cần; gán `topic_slug` cho 210 đề trong một PR nội dung kiểu T04 | Migration dùng `shelves text[]`; đề Speaking chưa gán chủ đề nằm nhóm "Chủ đề khác" |
| N3 | Số migration | Một file `400_public_library.sql` (+ rollback), giữ hàng `reserved` 400 trong `register.tsv` ngay ở PR T02; 401–419 để dành sửa sau | Như đề xuất |
| N4 | Writing guides công khai lấy `content_type in ('knowledge','tip')`; số bài đã xuất bản chưa đếm (gói ghi CHƯA KIỂM) | Người thực thi chạy truy vấn chỉ đọc trên staging khi làm T11 (cần quyền đọc DB staging theo quy trình máy anh Andy) và ghi vào PR | T11 vẫn làm; kệ rỗng hiện trạng thái rỗng |
