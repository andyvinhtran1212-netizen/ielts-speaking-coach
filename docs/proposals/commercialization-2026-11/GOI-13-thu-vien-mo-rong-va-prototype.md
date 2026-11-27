# GÓI 13 — Nhận xét học viên và khảo sát sau khoá; biên tập Grammar Wiki; Kiến thức nền; Đọc kỹ; khuôn luyện đề

Lập ngày 18/11/2026 theo `00-QUY-UOC-CHUNG.md` mục 2 điểm 22 và 23 (điểm sau thắng điểm trước). Người thực thi: project Claude Code của repo averlearning.com. Tờ thiết kế nhắc trong gói nằm ở `thiet-ke/`. Bản mới nhất của các tờ hiện ở `ban-lam-viec/fix-moi-nhat/`; người điều phối chép sang `thiet-ke/` trước khi giao việc. Đọc chữ của một tờ: `python3 -I ban-lam-viec/lam/dctext.py <tờ>.dc.html`. Mục "Ghi chú cho lập trình" ở cuối mỗi tờ là quy tắc hành vi phải theo.

**Số đề nghị cho sổ cấp số (`01-KE-HOACH-TONG.md` mục 6), người điều phối ghi vào sổ trước khi giao:**

- Spec: 0095 `TESTIMONIAL` (phần A), 0096 `GRAMMAREDIT` (phần B, có phần sửa đổi GRAMMARFIG-0084), 0097 `TOPICKNOW` (phần C), 0098 `CLOSEREAD` (phần D), 0099 `EXAMKIT` (phần E, chỉ giữ số, chưa viết). Số 0089–0094 và 0102 là của GOI-12 (sổ ở 01 mục 6 đã ghi; 0088 thuộc WRITINGGPT từ 23/11). Không dồn số.
- Migration: dải 490–499. Dải 480–489 là của GOI-12 (sổ ở 01 mục 6: dùng đủ 10 số). Dùng 490 (nhận xét và khảo sát), 491 (mở rộng loại thông báo, chỉ cần khi migration 470 đã merge), 492 (Kiến thức nền), 493 (đoạn viết ngắn), 494 (Đọc kỹ). Số 495 và 496 giữ cho phần E và chưa được áp. Số 497–499 là dự phòng của gói.

## 1. Tóm tắt

- **Mục tiêu.**
  - (A) Trước khi mở đăng ký, người lạ đọc được nhận xét nguyên văn của học viên ở trang chủ, ở trang sáu khoá online và ở trang "Học viên nói gì". Admin bật khảo sát sau khoá cho từng lớp, duyệt nhận xét (chỉ được lược bớt câu) và nhập khoảng 100 nhận xét cũ mỗi khoá bằng script.
  - (B) 137 bài Grammar Wiki được sửa các lỗi hai agent thiết kế đã ghi. Một script trong CI chặn lỗi mới. Bài ghép được xử lý theo quyết định của anh Andy, URL cũ vẫn mở được. Mỗi bài có sơ đồ câu chữ theo thứ tự ưu tiên.
  - (C) Có trang Kiến thức nền chủ đề Work mở công khai trong Thư viện, sau đó thêm 8–10 chủ đề. Người đăng nhập nộp một đoạn viết ngắn để AI nhận xét, tốn 1 lượt.
  - (D) Có prototype "Đọc kỹ" theo 20 mô đun của dàn 381 bài. Thí điểm 20 câu để đo công soạn.
  - (E) Có phần nền cho khuôn luyện đề trắc nghiệm, KHÔNG bật cho tới khi anh Andy mở.
- **Lớp thay đổi** (theo `specs/README.md` của repo):
  - A là `high-risk`: có migration, RLS, dữ liệu cá nhân và nội dung đăng công khai.
  - B gồm `content` (biên tập, soạn hình), `small` (script kiểm nội dung) và `feature` (chuyển hướng URL, khối khuôn bài mới, mở rộng renderer).
  - C và D là `feature`. Các nhiệm vụ có migration (C03, C07, D03) là `high-risk` (00 mục 4.7: migration, lưu kết quả); C07 còn gọi AI trả phí và trừ lượt.
  - E là `feature` và chưa làm.
  - Spec mới: TESTIMONIAL-0095, GRAMMAREDIT-0096, TOPICKNOW-0097, CLOSEREAD-0098; giữ số EXAMKIT-0099.
- **Phụ thuộc.** Chi tiết ở đầu mỗi phần trong mục 6.

| Phần | Đợt | Phải xong trước | Chạy song song được với |
|---|---|---|---|
| A | Chặng 1, trước khi mở bán | G03 (`PublicShell`, token), G05-T03/T05 (trang chủ, trang khoá — chỗ để sẵn), G09-T08 (khung admin, sổ đăng ký sidebar), G09-T36 (`import_batch_log`), GOI-11 T08–T10 (thông báo), G07 (Hôm nay, Hồ sơ) cho A11 | B, C, D |
| B | Biên tập nội dung (B02, B04): ngay. Khuôn bài và hình: sau G06-T14 (a) và G11-T33 | G06-T14 (giao diện bài), G11-T33 (renderer 10 kiểu), G11-T34 (5 bài thí điểm) | A, C, D |
| C | Sau G06 (`/library`, kệ cấu hình FR-06-005b, trang bài mẫu G06-T10) và G04 (lượt) | G04-T03 (`credits.py`, `short_writing_feedback` trong CHECK 382), G06-T08, T10 | A, B, D |
| D | Sau khi có 20 câu thí điểm (D02). Mở rộng quy mô chỉ khi anh Andy quyết | G07 (Lộ trình, nếu dùng lối vào A), spec 0021 (dịch câu Reading) đã merge | A, B, C |
| E | HOÃN — không mở PR | — | — |

- **Ước lượng** (giả định: 1 phiên ≈ một nhiệm vụ trọn vẹn kèm test; không tính giờ người duyệt nội dung; chưa đo):

| Phần | Số PR | Số phiên agent | Độ khó | Lý do |
|---|---|---|---|---|
| A | 13 | khoảng 21,5 | 4 | Có migration và RLS cho dữ liệu cá nhân, quy tắc "không sửa chữ" phải giữ ở tầng dữ liệu, và việc gỡ ngay khi rút đồng ý chạm ba trang công khai |
| B | khoảng 32 | khoảng 38 | 3 | Phần lớn là content. Khó nhất là giữ anchor cho phiếu chấm khi tách bài, và test ghim của trang Grammar |
| C | khoảng 17 | khoảng 25 | 3 | Có một đường AI trả phí dùng lượt. Phần còn lại là trang đọc |
| D | 6 (+ mở rộng sau quyết định) | khoảng 11,5 | 3 | Dữ liệu chú giải theo vị trí ký tự, và phải dùng lại băm của 0021 |
| E | 0 ở đợt này | — | — | Hoãn |

## 2. Hiện trạng trong repo (đã kiểm ở bản checkout chỉ đọc `~/code/ielts-speaking-coach` @ `c3bc71574`, 15/11/2026)

Người thực thi kiểm lại trên `origin/staging` mới nhất trước khi làm (00 mục 5 bước 1). Mã thắng tài liệu.

| Thứ cần biết | File / đường dẫn thật | Ghi chú |
|---|---|---|
| Nhận xét học viên, khảo sát | KHÔNG CÓ bảng hay route | `backend/migrations/100_user_feedback.sql` và `backend/routers/feedback.py` chỉ là đánh giá đề Reading/Listening. Không dùng lại |
| Lớp, khoá offline | `cohorts` (`060_cohorts_table.sql`: `id, name, is_active…`), `cohorts.course_id` → `courses(id)` (`175_courses.sql` dòng 82); `courses(code UNIQUE 'C1'…'C5', name, sort_order, is_active)`; thành viên `student_cohort_memberships(student_id, cohort_id, is_active, joined_at, left_at)` (`227_…sql`); `students(full_name NOT NULL, user_id NULL)` (`033_…sql` dòng 53, 62) | Có bảng buổi `class_lessons` (`176_class_lessons.sql`: `cohort_id`, `lesson_no` NULL, `lesson_date` NULL; G09 migration 441 thêm `starts_at`). KHÔNG CÓ ngày kết thúc lớp hay tổng số buổi dự kiến. Dòng "Lớp sắp kết thúc khoá mà chưa có khảo sát" của tờ chưa có đủ dữ liệu (thiếu tổng số buổi) |
| Tên hiển thị | `users.display_name VARCHAR(100)` (`013_…sql` dòng 3); `students.full_name` | Không có `users.full_name` |
| Grammar Wiki — nội dung | `backend/content/<category>/*.md`, 137 file trong 11 thư mục: foundations 18, error-clinic 19, grammar-for-meaning 12, grammar-for-reading 14, grammar-for-writing 9, ielts-grammar-lab 23, modifiers 7, parts-of-speech 9, sentence-structures 9, tenses 8, verb-patterns 9. Có `backend/content/_archive/` (34 md) | Frontmatter gồm: `title, slug, category, summary, level, tags, prerequisites, related_pages, compare_with, order, status, last_updated, difficulty, band_relevance, common_error_tags, speaking_relevance, writing_relevance, next_articles, pathways, anchors, learning_blocks`. **Không có** trường tên tiếng Việt: phần tiếng Việt nằm trong `title` sau " — " |
| Grammar Wiki — nhóm | `backend/content/_groups.yaml`: `groups:` gồm 10 nhóm (`slug, title, description, color, articles: [{slug, category, title}]`), 137 mục | Không có `status` hay `title_vi`. Bài không có file thì backend coi là "planned" (chú thích dòng 3). Nhóm "parts-of-speech" (dòng 31) gồm bài của hai thư mục `modifiers/` và `parts-of-speech/` |
| Grammar Wiki — dựng HTML | `backend/services/grammar_content.py`: `_MD_EXTENSIONS` dòng 80 (`toc_depth` "2-3" dòng 84); `_ANCHOR_MARKER_RE` dòng 91 → `<a id class="grammar-anchor">` (dòng 328–332); `inject_learning_blocks` dòng 334; `_flatten_toc` dòng 1120; `get_groups()` dòng 1023 | KHÔNG CÓ cơ chế chuyển hướng slug bài đổi tên: không có trong `grammar*.py`, `routers/grammar.py`, `frontend/proxy.ts`. `next.config.ts` chỉ có chuyển hướng HTML cũ `/pages/grammar-article.html` |
| Khối học trong bài | `backend/services/grammar_learning_blocks.py`: `BLOCK_MARKER_RE` (`<!-- learning-block: <id> -->`, dòng 16), `ALLOWED_TYPES = {check, visual, repair, transfer, takeaways}`, `ALLOWED_VISUALS = {decision-tree, timeline, sentence-xray, chart-map, flow}`, `ALLOWED_KINDS = {precheck, microcheck}`; `validate_learning_blocks` (27), `render_learning_block` (163), `inject_learning_blocks` (223) | Có `learning_blocks:` ở 20 bài. Danh sách ở bảng 6.B.0 |
| Script kiểm Grammar sẵn có | `backend/scripts/validate_grammar_learning_blocks.py` (không có job CI nào gọi trực tiếp), `backend/scripts/verify_anchor_drift.py` (test `backend/tests/test_anchor_drift.py` gọi), `validate_grammar_quiz_bank.py` | Script kiểm nội dung của B02 nối vào cùng kiểu: chạy qua một test pytest trong `backend/tests/`, nên chạy trong job `backend-shard` hiện có. Không thêm tên job CI (00 mục 4.11) |
| Anchor của phiếu chấm | `backend/content/feedback-anchor-mapping.yaml` nối lỗi AI phát hiện → anchor bài | Tách bài hay dời mục thì phải sửa mapping, nếu không `test_anchor_drift.py` đỏ |
| Trang Grammar | `frontend/app/(public-content)/grammar/` (`page.tsx`, `[category]/[slug]/{page,page-shell,loading,article-behavior}.tsx`, `search/`, `compare/`, `roadmap/`, `exercises/`); `frontend/proxy.ts` dòng 47 (đọc `/api/grammar/categories`), dòng 78 `grammarArticle` (bài lạ → 404 thật) | Giao diện mới do G06-T14 làm; renderer sơ đồ do G11-T33 làm |
| TOEIC, THPT, band trong bài | Có 23 dòng nhắc TOEIC/THPT trong 12 file (`modifiers/{compound-adjectives, participial-adjectives, order-of-adjectives}`, `error-clinic/{tag-questions-errors, dangling-modifiers}`, `parts-of-speech/{word-formation-verbs-and-adverbs, determiners-overview, word-formation-adjective-suffixes, word-formation-noun-suffixes}`, `grammar-for-writing/parallel-structure`, hai đề `exams/toeic-p5-*`). "Band 7" xuất hiện ở khoảng 113 file | Tóm tắt của `ielts-grammar-lab/grammar-for-band7plus.md` đã có câu "không bảo đảm Band 7+". Script kiểm phải phân biệt câu hứa với câu nói rõ là không bảo đảm |
| Audio câu mẫu Grammar | KHÔNG CÓ | Audio do repo VIDEO MAKING sản xuất (00 mục 2 điểm 22). Web chỉ phát |
| Dịch câu Reading (0021) | `specs/0021-reading-practice-support/spec.md` (`status: implementing`); `backend/services/reading_practice_support.py`: `digest()`, `validated_support(metadata, body)` (dòng 70) kiểm `source_sha256 == digest(body)` và `translation_sha256 == digest(metadata.translation_vi)`; model `PracticeUnit{id, source, translation_vi, precision: sentence\|paragraph, phrases[≤24]{source,target}}`; `backend/routers/reading_student.py` dòng 436–443; frontend `frontend/app/(authed-reading)/reading/practice-reading-text.tsx` | Đọc kỹ dùng lại `digest`, `PracticeUnit` và cách ẩn khi lệch băm |
| Bảng đề thi | `backend/migrations/134_exam_module_foundation.sql`: `exam_tests(exam_source CHECK, code UNIQUE, title, part, time_limit_minutes, total_questions, status draft/published/archived, meta jsonb)`, `exam_questions(test_id, q_num, question_type CHECK 'mcq_single', prompt, options, answer, solution, grammar_slug, kp_focus, explanation, order_num)`, `exam_attempts(user_id, test_id, exam_source, answers, score, max_score, correct_count, grading_details, status)`; CHECK mở rộng ở 141–143; `backend/services/exam_service.py` dòng 29 `EXAM_SOURCES` có `thpt_qg`; router `routers/exams.py` (`/api/exams`), `routers/admin_exams.py`, `routers/admin_exam_content.py`; script `backend/scripts/seed_exams.py`; nội dung `backend/content/exams/` (8 file, không có đề THPT) | RLS chặn `anon`, `authenticated` |
| Từ vựng theo chủ đề | `backend/content_vocab/_categories.yaml` gồm 7 chủ đề: environment, technology, education, `work-career`, health, people-society, economy. `backend/services/vocab_content.py`; `backend/routers/vocabulary.py` (`/api/vocabulary/articles/{category}/{slug}`…); bảng `content_topics` (mig 117) | Chủ đề Work của tờ KienThucNen ứng với `work-career`. Chỉ có 7 chủ đề, ít hơn "8–10 chủ đề" (mục 10 câu C1) |
| Kho bài mẫu Writing | Chưa có `writing_samples`: bảng này do G06-T02 tạo (dải 400–419). `writing_prompts` (035), `writing_tips` (082/083) | Liên kết ngược ở phần C trỏ vào `writing_samples.slug` của G06 |
| Gọi AI và ghi chi phí | `backend/services/ai_usage_logger.py` (`log_claude_response`, `log_gemini_response…`); ví dụ dịch vụ nhận xét ngắn: `backend/services/advanced_vocab_rewrite_grader.py` (`grade_rewrites`, qua `services.ai_router`) | Đoạn viết ngắn (C07) chép khuôn này |
| Lượt, thông báo, lô nhập | `services/credits.py`, `services/notification_service.py`, `services/import_batch_log.py`: CHƯA CÓ, do G04-T03, G11-T09, G09-T36 tạo; `services/runtime_flags.py`, `services/activation_gate.py`: đã có | Nhiệm vụ của gói này đứng sau các nhiệm vụ kia |
| Số migration, spec | Migration cao nhất là `380_…`; `backend/migrations/README.md` dòng 20–25 ("subject to the shared migration register"), sổ giữ số `backend/migrations/forward-policy.tsv`. Spec cao nhất là `specs/0054-…` | Số của gói lấy theo sổ ở 01 mục 6 |
| Bucket Storage | Không có migration tạo bucket. Sáu bucket đã biết (mig 343): audio-responses, listening-audio, listening-images, reading-images, writing-images, vocab-audio | Gói này không tạo bucket ở đợt đầu (ảnh học viên đang tắt — mục 10 câu A2) |

## 3. Phạm vi

**Trong phạm vi**

- (A) Dữ liệu và API khảo sát sau khoá theo mẫu cố định ba khối, câu đồng ý, nhận xét, duyệt, ghim, rút đồng ý. Script nhập nhận xét cũ. Trang công khai `/hoc-vien-noi-gi`, khối ở trang chủ và trang sáu khoá online, mục chân trang. Trang admin "Khảo sát và nhận xét". Màn học viên trả lời, thẻ ở Hôm nay, "Nhận xét của tôi" ở Hồ sơ. Thông báo mở và nhắc. Kết quả khảo sát dẫn về hồ sơ học viên.
- (B) Script kiểm nội dung trong CI. Lượt biên tập 137 bài theo nhóm. Quy tắc tách bài ghép và chuyển hướng URL. Hợp đồng dữ liệu cho các mở rộng của khối `figure` và phần renderer của các mở rộng đó. Soạn hình theo nhóm. Sáu khối khuôn bài còn thiếu.
- (C) Mô hình dữ liệu chủ đề, file nguồn và script nhập, API, trang mục lục và trang chủ đề, sơ đồ cây, liên kết ngược ở trang đề Writing, đoạn viết ngắn có AI nhận xét (1 lượt), quy trình soạn và duyệt, chủ đề Work rồi 8–10 chủ đề.
- (D) Dữ liệu chú giải câu, phần dùng lại từ 0021, màn bốn bước và tổng kết, hai lối vào, thí điểm 20 câu kèm điều kiện dừng.
- (E) Mô hình dữ liệu và điều kiện mở của khuôn luyện đề, chỉ viết thành tài liệu.

**Ngoài phạm vi**

- Renderer mười kiểu sơ đồ cơ bản và năm bài thí điểm: GOI-11 G11-T33, T34 (GRAMMARFIG-0084).
- Giao diện mới của trang Grammar: G06-T14.
- Kệ `/library` và cơ chế kệ cấu hình: G06-T08 (FR-06-005b).
- Hàm lượt `charge_plan`, `reserve`: G04.
- Bảng và job thông báo: GOI-11 phần A.
- Sidebar admin, sổ đăng ký điều hướng, ghi chú chăm sóc: G09.
- Hôm nay và Hồ sơ: G07 (gói này cấp hàm và component, G07 gắn vào hoặc gói này gắn sau khi G07 merge).
- Sản xuất audio câu mẫu: repo VIDEO MAKING (không đụng).
- AI nhận xét bản dịch ở Đọc kỹ: để sau (00 điểm 23).
- Trình tạo form khảo sát tự do: không làm (khảo sát `huong-phat-trien.md` mục 4 câu 9).
- Khu THPT: hoãn (00 điểm 22).
- Sổ lỗi cá nhân: GOI-12.

## 4. Yêu cầu (FR)

### A — Nhận xét và khảo sát

- **FR-13-A01** Mỗi lớp (`cohorts.id`) có tối đa một khảo sát cho khoá của lớp (`cohorts.course_id`). Khảo sát dùng một bản mẫu có phiên bản gồm ba khối cố định: (1) số phút làm bài mỗi buổi, nhập một ô số kèm nút chọn nhanh 30 · 45 · 60 · 90 · 120; (2) mức hài lòng 1–5 và hai câu viết tự do "có ích nhất" / "muốn cải thiện"; (3) ý định học tiếp, ba lựa chọn cố định, kèm "Lý do" không bắt buộc khi chọn "Chưa quyết" hoặc "Dừng". Admin chỉ sửa được câu chữ, thêm tối đa 3 câu hỏi mở và chọn ngày mở, ngày đóng. Không có kiểu câu hỏi khác.
- **FR-13-A02** Câu đồng ý cuối khảo sát là chữ cố định của bản mẫu, không sửa được theo từng khảo sát. Lý do: sự đồng ý phải có cùng một nghĩa ở mọi lớp. Không có lựa chọn chọn sẵn. Chọn "Đồng ý" thì phải chọn tên hiển thị: `full` · `initial` · `anonymous`. Mỗi câu trả lời lưu phiên bản câu đồng ý đã thấy.
- **FR-13-A03** Trạng thái khảo sát đi `draft` → `open` (tới `opens_at`, hoặc admin bấm "Lưu và mở ngay") → `closed` (hết `closes_at`, hoặc "Đóng sớm"). "Mở lại" đặt `closes_at` mới. Khi đã có câu trả lời `submitted`, câu chữ bị khoá, chỉ còn sửa được ngày đóng.
- **FR-13-A04** Học viên là thành viên active của lớp, có `students.user_id`, được trả lời một lần cho mỗi khảo sát. Nháp tự lưu. Sửa được tới hết `closes_at`. Bắt buộc câu 1, 2, 5 và câu đồng ý. Câu 3, 4 bỏ trống được.
- **FR-13-A05** Câu trả lời `submitted` có đồng ý cho đăng thì sinh tối đa hai mục nhận xét `pending`: một mục `helpful` từ câu 3, một mục `improve` từ câu 4. Ô trống thì không sinh mục. Không đồng ý thì không sinh mục, nhưng admin vẫn đọc được câu trả lời ở trang kết quả. Học viên sửa câu trả lời sau khi đã sinh mục: mục `pending` được cập nhật theo nguyên văn mới; mục `published` bị chuyển về `pending` và gỡ khỏi web cho tới khi duyệt lại. Lý do: chữ đăng công khai phải đúng chữ học viên đang để.
- **FR-13-A06** Nguyên văn (`original_text`) không ghi đè được, kể cả bằng API admin. Việc duy nhất làm được với nguyên văn là lược bớt nguyên câu, lưu thành danh sách chỉ số câu bị bỏ và áp lúc hiển thị. Chỗ lược hiện "[…]". Mục có lược hiện dòng "Đã rút gọn, không sửa chữ" kèm nút mở đủ nguyên văn tại chỗ. Phải còn ít nhất một câu.
- **FR-13-A07** Một nhận xét lên trang công khai khi đủ ba điều kiện: có đồng ý, chưa rút đồng ý, và `status='published'`. Trang chủ và trang các khoá online (dùng chung cho sáu khoá) mỗi nơi tối đa 3 mục ghim. Thiếu mục ghim thì lấy mục đã đăng mới nhất. Hai khối này luôn hiện và không ghi là của lớp offline (00 điểm 23). Khi một khoá online có nhận xét riêng được đăng, trang khoá đó chỉ lấy nhận xét của chính nó.
- **FR-13-A08** Rút đồng ý (ở Hồ sơ › Quyền riêng tư): mọi mục của người đó chuyển `rejected` với lý do `withdrawn` và bỏ ghim ngay trong cùng giao dịch. Không admin nào đăng lại được. Trang công khai hết hiện mục đó ngay ở lần tải kế tiếp. Cache công khai tối đa `TESTIMONIAL_PUBLIC_CACHE_SECONDS`, mặc định 60.
- **FR-13-A09** Tên hiển thị tính lúc trả về, không lưu chuỗi đã cắt:
  - `full`: họ tên hồ sơ.
  - `initial`: bỏ họ, giữ tên đệm và tên, thêm chữ cái đầu của họ ("Hải Đăng V."). Tên chỉ có hai tiếng thì ra "Đăng V.".
  - `anonymous`: "Học viên Course N". Không ảnh, không dữ kiện đi kèm. Lớp có sĩ số dưới `TESTIMONIAL_ANON_MIN_COHORT_SIZE` thì bỏ cả tháng/năm kết thúc lớp.
  - Học viên đổi được tên hiển thị ở Hồ sơ, áp ngay. Admin chỉ hạ được xuống `anonymous`, không nâng lên được.
- **FR-13-A10** Không hiện band, điểm thi, sao hay "X% hài lòng" ở trang công khai. Mức 1–5 chỉ dùng trong admin. Khối số liệu chỉ lấy từ khảo sát trên web. Khoá chưa có khảo sát ghi "Chưa có khảo sát trên web". Khoá có ít người trả lời hơn `survey_min_respondents` (số người, ngưỡng ở Cài đặt) thì chỉ ghi số người, không ghi phần trăm. Không bao giờ hiện "0 / 0".
- **FR-13-A11** Nhận xét cũ chỉ vào hệ thống qua script backend, không có đường tải lên từ trình duyệt. Mỗi mục cũ có nguồn `legacy_form`, vào hàng duyệt `pending`, không có dữ kiện đi kèm. Nhập lại cùng một file không tạo bản trùng. Mỗi lần chạy ghi một bản ghi lô qua `services/import_batch_log.py` (G09-T36). Đồng ý: theo 00 điểm 22 ("đã có sự đồng ý chia sẻ từ lúc thu"), dòng không ghi lựa chọn được coi là đã đồng ý, ngày đồng ý là ngày thu ghi trong file. Dòng ghi rõ "không đồng ý" thì không sinh mục. Tên hiển thị không ghi thì lấy `initial`, không tự nâng lên `full`.
- **FR-13-A12** Lúc khảo sát mở, mỗi thành viên của lớp có tài khoản nhận thông báo trong ứng dụng `survey_open`. Trước `closes_at` 3 ngày, người chưa gửi nhận một lần `survey_reminder`. Nút "Nhắc người chưa trả lời" bấm tay được tối đa một lần mỗi ngày cho mỗi khảo sát. Không gửi thư.
- **FR-13-A13** Thẻ "Khảo sát sau khoá" ở Hôm nay hiện khi học viên thuộc lớp có khảo sát đang mở và chưa gửi câu trả lời. Đã gửi, khảo sát đóng, hoặc tài khoản chỉ có khoá online thì ẩn.
- **FR-13-A14** Kết quả một khảo sát cho admin, đọc từ trên xuống:
  - số người trả lời trên sĩ số lúc mở (nháp không tính);
  - phân bố số phút;
  - số người dự định học tiếp trên số người trả lời; số người đồng ý cho đăng kèm số mục chờ duyệt / đã đăng / không đăng (sửa 18/11 theo rà soát: tờ thắng về giao diện);
  - dòng đối chiếu thời gian làm bài hệ thống ghi được chỉ hiện khi có nguồn (CHƯA KIỂM), không thì ẩn;
  - mức 1–5 (dưới ngưỡng thì không tính phần trăm, không tính trung bình);
  - danh sách người chọn dừng hoặc chưa quyết, có nút "Mở hồ sơ";
  - toàn bộ câu trả lời;
  - tải CSV.
  
  Giáo viên chỉ xem kết quả lớp của mình (qua `services/staff_scope.py` của G09-T24), không duyệt đăng.
- **FR-13-A15** Ý định `stop` hoặc `undecided` ghi một dòng vào `learner_care_notes` (G09, migration 442), body bắt đầu bằng "Khảo sát sau khoá · <tên khoá>: …". Không tạo cảnh báo "Cần chú ý" mới. Hồ sơ học viên có khối "Khảo sát sau khoá" liệt kê câu trả lời của người đó.
- **FR-13-A16** Số đếm sidebar "Khảo sát và nhận xét" = số mục `pending` có đồng ý hợp lệ.

### B — Grammar Wiki

- **FR-13-B01** Có lệnh `python backend/scripts/lint_grammar_content.py` chạy được local. Lệnh in mọi vi phạm theo mã luật (6.B.2) và có ba chế độ: `--format text|json` và `--baseline`. Có test pytest chạy lệnh với file nền `backend/content/_lint_baseline.json`. Test đỏ khi có vi phạm MỚI không nằm trong file nền. Vi phạm đã sửa thì phải xoá khỏi file nền trong cùng PR (test đỏ khi file nền còn mục không còn vi phạm). Lý do: chặn lỗi mới ngay mà không bắt sửa 137 bài trong một PR.
- **FR-13-B02** Mỗi PR biên tập chỉ đụng bài của một nhóm. Không đổi anchor đang được `feedback-anchor-mapping.yaml` trỏ tới, trừ khi sửa mapping trong cùng PR. `verify_anchor_drift.py` phải qua.
- **FR-13-B03** Bài đổi slug hoặc bị tách: URL cũ trả 308 về URL mới, theo `backend/content/_redirects.yaml`. Slug lạ vẫn 404 thật như hiện nay. Sitemap chỉ có URL mới.
- **FR-13-B04** Khối `figure` theo hợp đồng của GRAMMARFIG-0084 cộng các mở rộng ở 5.B.2. Gói này không viết lại renderer của mười kiểu cơ bản.
- **FR-13-B05** Sáu khối khuôn bài (5.B.3) hiện đúng tờ: câu nói mẫu có nút nghe kèm nhãn "Giọng đọc tổng hợp"; mục lục hai cấp; ẩn mục trống; bảng trong khối Tóm tắt; khối bài đọc/câu hỏi; bảng dài gập được (thêm 18/11 theo tờ Nhom8, Nhom9).

### C — Kiến thức nền

- **FR-13-C01** `/library/background` và `/library/background/<slug>` mở công khai, không cần tài khoản, nội dung nằm sẵn trong HTML khi tải. Chủ đề chưa xuất bản trả 404 và không có trong sitemap; mục lục vẫn hiện tên chủ đề đang soạn ở dạng "Đang soạn" (chữ mờ, không bấm, không số đếm — tờ KienThucNen mục 4) qua trường `upcoming` của API.
- **FR-13-C02** Sơ đồ cây sinh từ dữ liệu, bố cục cố định cho 3–6 nhánh. Bấm nhánh, bấm thẻ dưới hình hoặc bấm "Khía cạnh trước/sau" đều đổi cùng một lựa chọn. Lựa chọn ghi vào URL (`?k=<n>`). Nhánh nhận tiêu điểm bàn phím và phím Enter.
- **FR-13-C03** Trang một đề Writing (G06) có dòng "Kiến thức nền cho đề này" khi đề có trong bảng nối. Đề không có thì không hiện dòng.
- **FR-13-C04** Nộp đoạn viết ngắn cần đăng nhập. Mỗi lần nộp tốn `CREDIT_COST_SHORT_WRITING` lượt (bằng 1), qua `feature='short_writing_feedback'`. Lượt chỉ bị trừ khi nhận xét trả về thành công; AI lỗi thì hoàn lượt. Không chấm band. Nhận xét có tối đa 3 mục, mỗi mục trích nguyên văn một đoạn của chính bài; trích không khớp thì máy chủ bỏ mục đó.
- **FR-13-C05** Mỗi lần nộp lưu số ý của cây và số collocation của chủ đề xuất hiện trong đoạn, đếm bằng mã chứ không do AI tự báo. Đây là số đo chính của sản phẩm (tờ KienThucNen).
- **FR-13-C06** Một chủ đề chỉ xuất bản khi có đủ tên hai người duyệt (`reviewed_by_teacher`, `reviewed_by_owner`).

### D — Đọc kỹ

- **FR-13-D01** Đơn vị là mô đun M01–M20 của dàn 381 bài; mỗi mô đun một bộ tối đa 6 câu. Màn học viên chỉ hiện tên bài, không hiện mã B001…B381.
- **FR-13-D02** Bốn bước mở lần lượt. Bản dịch mẫu không gửi về trình duyệt trước khi học viên gửi bản dịch đầu. Sau đối chiếu, bản dịch đầu bị khoá; làm lại câu thì lưu thành lần mới.
- **FR-13-D03** "So chữ" chạy ở trình duyệt trên từ khoá soạn sẵn: không gọi AI, không trừ lượt. Không có điểm hay phần trăm ở bất kỳ màn nào.
- **FR-13-D04** Câu gắn với đơn vị Reading thì dùng `translation_vi` và `phrases` của đơn vị đó. Đơn vị bị lệch băm (`validated_support` không qua) thì ẩn nút "Đọc kỹ câu này". Chỉ đơn vị `precision='sentence'` được gắn. Mỗi bài đọc tối đa 2 câu. Tắt hẳn trong phòng thi và full test.

### E — Khuôn luyện đề

- **FR-13-E01** (chỉ để ghi nhận, không làm) Không route, migration hay mục điều hướng nào của khuôn được merge cho tới khi anh Andy mở bằng lời trong chat.

## 5. Hợp đồng kỹ thuật

### 5.A Phần A — Nhận xét và khảo sát (spec TESTIMONIAL-0095)

#### 5.A.1 Migration 490 `backend/migrations/490_testimonials_surveys.sql`

Có rollback ở `backend/migrations/rollback/490_testimonials_surveys.sql`. Rollback từ chối chạy khi `testimonials` có dòng `published`, trừ khi `SET aver.allow_testimonial_rollback='on'`. Thêm dòng vào `forward-policy.tsv` theo README. Test PG17: `backend/tests/test_migration_490_testimonials_surveys.py`.

**`survey_templates`** (bản mẫu có phiên bản)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `version` | int | PK, ≥ 1 |
| `defaults` | jsonb | NOT NULL, câu chữ mặc định: `{q_minutes, q_rating, rating_label_1, rating_label_5, q_helpful, q_improve, q_intent, intent_labels:{continue_tpl, undecided, stop}, q_reason}` |
| `consent_text` | text | NOT NULL, 20..1000 ký tự |
| `effective_from` | timestamptz | NOT NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

Migration nạp `version=1` với câu chữ đúng tờ AdminKhaoSat màn 2–3. `continue_tpl` = "Học tiếp {next_course}". Tên khoá kế lấy theo `courses.sort_order`. Lớp Course 5 thay bằng "Học tiếp ở Aver Learning".

**`cohort_surveys`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK default `gen_random_uuid()` |
| `cohort_id` | uuid | NOT NULL FK `cohorts(id)` ON DELETE RESTRICT |
| `course_id` | uuid | NULL FK `courses(id)` ON DELETE SET NULL, chép từ `cohorts.course_id` lúc tạo |
| `template_version` | int | NOT NULL FK `survey_templates(version)` |
| `copy` | jsonb | NOT NULL DEFAULT `'{}'`, chỉ các khoá có trong `defaults` (CHECK bằng hàm `fn_survey_copy_keys_ok`) |
| `extra_questions` | jsonb | NOT NULL DEFAULT `'[]'`, mảng ≤ 3 phần tử `{key: "x1"\|"x2"\|"x3", text: 3..300}` |
| `opens_at`, `closes_at` | timestamptz | NOT NULL, CHECK `closes_at > opens_at` |
| `status` | text | NOT NULL DEFAULT `draft` CHECK IN (`draft`,`open`,`closed`) |
| `roster_size_at_open` | int | NULL, ghi lúc chuyển `open` |
| `auto_reminder_sent_at` | timestamptz | NULL |
| `manual_reminded_on` | date | NULL (ngày giờ Việt Nam) |
| `created_by` | uuid | NOT NULL FK `users(id)` |
| `created_at`, `updated_at` | timestamptz | NOT NULL DEFAULT now() |

Có `UNIQUE NULLS NOT DISTINCT (cohort_id, course_id)` (FR-13-A01; `course_id` NULL được, nên phải `NULLS NOT DISTINCT` để lớp không gắn khoá cũng chỉ có một khảo sát). Chỉ mục `(status, opens_at)` và `(status, closes_at)`.

**`survey_responses`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK |
| `survey_id` | uuid | NOT NULL FK `cohort_surveys(id)` ON DELETE CASCADE |
| `user_id` | uuid | NOT NULL FK `users(id)` ON DELETE CASCADE |
| `student_id` | uuid | NULL FK `students(id)` ON DELETE SET NULL |
| `minutes_per_session` | int | NULL, CHECK 0..600 |
| `rating` | smallint | NULL, CHECK 1..5 |
| `helpful_text`, `improve_text`, `intent_reason` | text | NULL, mỗi ô ≤ 4000 ký tự |
| `intent` | text | NULL CHECK IN (`continue`,`undecided`,`stop`) |
| `extra_answers` | jsonb | NOT NULL DEFAULT `'{}'`, khoá `x1..x3`, mỗi giá trị ≤ 2000 ký tự |
| `theme_tags` | text[] | NOT NULL DEFAULT `'{}'`; admin gắn ở trang kết quả, cả câu trả lời không đồng ý đăng; `summary.themes` của `/api/testimonials/summary` đếm từ cột này (tờ HocVienNoiGi: "tính trên mọi câu trả lời") (sửa 18/11 theo rà soát: tờ thắng về giao diện) |
| `status` | text | NOT NULL DEFAULT `draft` CHECK IN (`draft`,`submitted`) |
| `submitted_at`, `last_edited_at` | timestamptz | NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

Có `UNIQUE (survey_id, user_id)`. CHECK: khi `status='submitted'` thì `minutes_per_session`, `rating`, `intent` NOT NULL. Lý do đặt ở tầng dữ liệu: chặn bản ghi thiếu câu bắt buộc dù đi bằng đường nào.

**`testimonial_consents`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK |
| `response_id` | uuid | NULL FK `survey_responses(id)` ON DELETE CASCADE, UNIQUE |
| `user_id` | uuid | NULL FK `users(id)` ON DELETE CASCADE |
| `source` | text | NOT NULL CHECK IN (`survey`,`legacy_form`) |
| `granted` | boolean | NOT NULL |
| `granted_at` | timestamptz | NOT NULL |
| `name_display` | text | NULL CHECK IN (`full`,`initial`,`anonymous`); NOT NULL khi `granted` |
| `consent_text_version` | int | NULL FK `survey_templates(version)`; NOT NULL khi `source='survey'` |
| `photo_path` | text | NULL (tính năng ảnh đang tắt, mục 10 câu A2) |
| `withdrawn_at` | timestamptz | NULL |

CHECK: `(source='survey') = (response_id IS NOT NULL)`.

**`testimonials`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK |
| `consent_id` | uuid | NOT NULL FK `testimonial_consents(id)` ON DELETE CASCADE |
| `response_id` | uuid | NULL FK `survey_responses(id)` ON DELETE CASCADE |
| `kind` | text | NOT NULL CHECK IN (`helpful`,`improve`) |
| `course_id` | uuid | NULL FK `courses(id)` |
| `course_product_id` | uuid | NULL FK `course_products(id)` (G04, 381). Dành cho khoá online khi có nhận xét riêng |
| `cohort_id` | uuid | NULL FK `cohorts(id)` ON DELETE SET NULL |
| `cohort_ended_on` | date | NULL (tháng/năm kết thúc lớp) |
| `original_text` | text | NOT NULL, 1..6000 ký tự |
| `omitted_sentences` | int[] | NOT NULL DEFAULT `'{}'` |
| `status` | text | NOT NULL DEFAULT `pending` CHECK IN (`pending`,`published`,`rejected`) |
| `reject_reason` | text | NULL CHECK IN (`names_other_person`,`private_info`,`offensive`,`off_topic`,`withdrawn`) |
| `reviewed_by` | uuid | NULL FK `users(id)` |
| `reviewed_at`, `published_at` | timestamptz | NULL |
| `show_facts` | boolean | NOT NULL DEFAULT false; chỉ được true khi `response_id` NOT NULL |
| `pin_home`, `pin_courses` | boolean | NOT NULL DEFAULT false |
| `theme_tags` | text[] | NOT NULL DEFAULT `'{}'`, nhãn nhóm ý do admin gắn; giữ để lọc hàng duyệt (số đếm công khai lấy từ `survey_responses.theme_tags`) |
| `org_reply`, `org_reply_at` | text, timestamptz | NULL; chỉ cho `kind='improve'` |
| `legacy_key` | text | NULL UNIQUE, khoá ổn định của dòng trong file cũ (sha256 của khoá + lớp + nguyên văn đã chuẩn hoá) |
| `legacy_batch_code` | text | NULL, mã lô của `content_import_batches` (G09, 449), không FK (bảng lô có thể chưa có trên môi trường thử) |
| `legacy_person_name` | text | NULL, họ tên trong file cũ khi không khớp được tài khoản |
| `created_at`, `updated_at` | timestamptz | NOT NULL DEFAULT now() |

Có ba trigger:
- `trg_testimonials_text_immutable`: UPDATE đổi `original_text` thì `RAISE EXCEPTION` (FR-13-A06). Ngoại lệ duy nhất là hàm `fn_testimonial_sync_from_response` (FR-13-A05) đặt `SET LOCAL aver.testimonial_sync='on'`.
- `trg_testimonials_withdrawn_final`: chặn UPDATE từ `rejected/withdrawn` sang trạng thái khác.
- `trg_testimonials_pin_published`: ghim chỉ được khi `published`.

Chỉ mục: `(status, kind, published_at DESC)`; `(status, cohort_ended_on DESC, published_at DESC)` (thứ tự trang công khai, thêm 18/11); `(course_id) WHERE status='published'`.

**Hàm** (đều `SECURITY DEFINER`, chỉ `service_role`, trả jsonb `{status: …}`):
- `fn_survey_submit(p_user_id, p_survey_id, p_answers jsonb, p_consent jsonb, p_request_key text)`: kiểm khảo sát `open` và người gửi là thành viên active. Ghi `survey_responses` và `testimonial_consents`, sinh hoặc đồng bộ mục `testimonials` (FR-13-A05) trong một giao dịch. Trả `submitted`, `updated`, `not_open`, `not_member`, `incomplete`.
- `fn_testimonial_publish(p_admin_id, p_id, p_omitted int[], p_show_facts bool, p_pin_home bool, p_pin_courses bool, p_tags text[])`: khoá dòng (`FOR UPDATE`) và khoá tư vấn theo vị trí ghim. Đã đủ 3 mục ghim thì trả `pin_full`. Lược hết mọi câu thì trả `nothing_left`. Trả `published`, `not_found`, `not_publishable` (đã rút, đồng ý `granted=false`).
- `fn_testimonial_reject(p_admin_id, p_id, p_reason)`, `fn_testimonial_unpublish(p_admin_id, p_id, p_reason)`, `fn_testimonial_set_pins(...)`.
- `fn_testimonial_withdraw(p_user_id, p_consent_id)`: FR-13-A08, idempotent.
- `fn_testimonial_set_name_display(p_user_id, p_consent_id, p_value)` và `fn_testimonial_admin_lower_name(p_admin_id, p_id)` (chỉ hạ xuống `anonymous`).

**RLS:** bật trên năm bảng. Không có policy cho `anon`, `authenticated`. `REVOKE ALL … FROM anon, authenticated` theo mẫu `backend/migrations/376_blackeye_admission.sql`. Mọi đọc ghi đi qua backend `service_role`. Lý do: bảng chứa nguyên văn và họ tên học viên, không được đọc thẳng qua Supabase. Test E11 kiểu GOI-04: JWT `authenticated` gọi `GET /rest/v1/testimonials` và `rpc/fn_testimonial_publish` đều bị từ chối.

#### 5.A.2 Migration 491 `backend/migrations/491_notification_kinds_survey.sql` (có điều kiện)

- Nếu migration 470 của GOI-11 **chưa** merge: người điều phối thêm `survey_open`, `survey_reminder` vào CHECK `learner_notifications.kind`, và `survey` vào danh sách `target.type`, ngay trong G11-T08. Khi đó số 491 bỏ trống.
- Nếu 470 **đã** merge: 491 làm ba việc. (1) `ALTER TABLE learner_notifications DROP CONSTRAINT <tên CHECK kind>` rồi tạo lại CHECK với hai giá trị mới. Tên ràng buộc lấy bằng `SELECT conname FROM pg_constraint WHERE conrelid='learner_notifications'::regclass AND contype='c'`, không đoán. (2) Có file rollback. (3) Có test PG17.

#### 5.A.3 Service và job

- `backend/services/surveys.py`:
  - `open_surveys_for(user_id) -> list[{survey_id, course_name, closes_at}]`, dùng cho Hôm nay;
  - `render_survey(survey, template) -> SurveyView` (gộp `defaults` và `copy`, điền `next_course`);
  - `roster(cohort_id) -> list[{student_id, user_id, full_name}]` (thành viên active có `user_id`);
  - `results(survey_id) -> SurveyResults`.
- `backend/services/testimonials.py`: `display_name(full_name, mode, course_code) -> str` (FR-13-A09, tách chữ bằng `split()` sau `unicodedata.normalize('NFC')`); `split_sentences(text) -> list[str]` (tách theo `.`, `?`, `!`, `…` và xuống dòng; giữ dấu câu trong câu); `public_view(row) -> PublicTestimonial`.
- Job mở, đóng, nhắc: thêm bước `surveys` vào `backend/scripts/notification_sweep.py` của G11-T10. Không tạo service cron mới.
  - (1) `draft` có `opens_at ≤ now` → `open`, ghi `roster_size_at_open`, gọi `fn_notify_batch` kind `survey_open`, `dedupe_key='survey:<id>:open:<user_id>'`, `target={"type":"survey","id":<id>}`.
  - (2) `open` có `closes_at - now ≤ SURVEY_AUTO_REMINDER_DAYS` (mặc định 3 ngày) và `auto_reminder_sent_at IS NULL` → `survey_reminder` cho người chưa `submitted`, `dedupe_key='survey:<id>:remind_auto:<user_id>'`.
  - (3) `open` có `closes_at ≤ now` → `closed`.
  
  Cờ `notifications_enabled` tắt thì bước (1) và (3) vẫn chạy, chỉ không sinh thông báo. Lý do: trạng thái khảo sát không được phụ thuộc kênh thông báo.
- Câu chữ thông báo: thêm hai `kind` vào `backend/services/notification_copy.py`. `survey_open`: tiêu đề "Khảo sát sau khoá <tên khoá>", thân "Khoảng 3 phút · mở tới hết <ngày>", nút "Trả lời khảo sát". `survey_reminder`: tiêu đề "Còn <n> ngày để trả lời khảo sát sau khoá", cùng nút. `frontend/lib/notification-target-model.mjs`: `survey` → `/surveys/<id>`.

#### 5.A.4 API

Đăng ký router trong `backend/main.py`. Route học viên và route công khai đều thêm vào `ACTIVATION_EXEMPT_ROUTES` (`backend/services/activation_gate.py`) kèm lý do một dòng; cập nhật `tests/test_activation_gate_inventory.py`. Sinh lại `frontend/types/api.d.ts`.

**Công khai** — `backend/routers/testimonials_public.py`, prefix `/api/testimonials`, không cần đăng nhập, `cacheable_json` theo cách G06 mục 5.7 làm

| Method · path | Request | Response 200 | Lỗi |
|---|---|---|---|
| `GET /api/testimonials` | `?course=all\|C1..C5\|<product_slug>&kind=helpful\|improve&cursor&limit=20` | `{items:[PublicTestimonial], next_cursor, total}` | 422 `invalid_course` |
| `GET /api/testimonials/summary` | — | `{courses:[{key, label, published_count, survey:null\|{cohorts, roster, respondents, minutes:{mean, median, min, max}, intent:{continue, undecided, stop}, percent_allowed: bool, top_stop_reason_tag?, updated_at}}], themes:[{tag, count}]}` | — |
| `GET /api/testimonials/pinned` | `?place=home\|courses&course=<product_slug>?` | `{items:[PublicTestimonial ×≤3]}` (luật lấp chỗ theo FR-13-A07) | 422 |

`PublicTestimonial` = `{id, kind, display_name, course_label, ended_label|null, segments:[{text, omitted: bool}], abridged: bool, facts:null|{submitted_sessions, total_sessions, minutes}, source: "survey"|"legacy_form", org_reply:null|{text, date}}`. Không trả `user_id`, email, `rating`.

`facts.submitted_sessions` và `total_sessions` là "số buổi có nộp bài trên tổng số buổi" theo tờ. CHƯA KIỂM nguồn: đọc G09 `GET /admin/learners/{ref}/overview` (lưới 8 tuần) hoặc `class_assignment_items`. Lệnh: `grep -rn "submitted\|is_missing" backend/routers/class_student.py | head -30`. Chưa có nguồn đúng thì `facts.submitted_sessions = null` và giao diện bỏ nửa câu đó.

**Học viên** — `backend/routers/surveys.py`, prefix `/api/surveys`, cần đăng nhập

| Method · path | Request | Response | Lỗi |
|---|---|---|---|
| `GET /api/surveys/open` | — | `{items:[{survey_id, course_name, closes_at}]}` | 401 |
| `GET /api/surveys/{id}` | — | `{survey: SurveyView, response: null\|{answers, consent, status, submitted_at}, can_edit_until}` | 401; 404 `survey_not_found` (cả khi không phải thành viên, để không lộ khảo sát tồn tại) |
| `PATCH /api/surveys/{id}/draft` | `{answers}` | `{saved_at}` | 409 `survey_closed` |
| `POST /api/surveys/{id}/submit` | `{answers, consent:{granted, name_display?}, request_key}` | `{status:"submitted"\|"updated", testimonials_created: int}` | 409 `survey_closed`; 422 `incomplete` kèm `missing:[1,2,5,6]` |

**Hồ sơ** — `backend/routers/me_testimonials.py`, prefix `/api/me/testimonials`

| Method · path | Response |
|---|---|
| `GET /api/me/testimonials` | `{items:[{consent_id, course_label, name_display, preview_name, published_count}]}` (rỗng → giao diện ẩn khối) |
| `PATCH /api/me/testimonials/{consent_id}` `{name_display}` | `{name_display}` |
| `POST /api/me/testimonials/{consent_id}/withdraw` | `{withdrawn_at}` (idempotent) |

**Admin** — `backend/routers/admin_surveys.py`, prefix `/admin` (theo phân xử 8 của 01 mục 6: router admin không có `/api`). Quyền: admin cho mọi route. Giáo viên chỉ được gọi `GET …/results` của lớp mình qua `resolve_staff_scope` (lệnh `await` đầu tiên). Lớp không thuộc mình thì 404.

| Method · path | Ghi chú |
|---|---|
| `GET /admin/surveys?status=` | Danh sách theo lớp (bảng màn 1): lớp, khoá, giáo viên, sĩ số, trạng thái, mở–đóng, đã trả lời / sĩ số, số mục chờ duyệt |
| `POST /admin/surveys` `{cohort_id, opens_at, closes_at, copy, extra_questions, open_now: bool, request_key}` | 409 `survey_exists`. `open_now=true` chuyển `open` ngay, ghi `roster_size_at_open` và gọi `fn_notify_batch` kind `survey_open` với cùng `dedupe_key` như bước (1) của job (FR-13-A12) |
| `PATCH /admin/surveys/{id}` | Khi đã có câu trả lời, chỉ nhận `closes_at`. Trường khác → 409 `copy_locked` |
| `POST /admin/surveys/{id}/close` · `/reopen {closes_at}` | |
| `POST /admin/surveys/{id}/remind` | Gửi `survey_reminder` cho người chưa gửi, `dedupe_key='survey:<id>:remind:<user_id>:<YYYY-MM-DD giờ VN>'`. Trong ngày đã nhắc → 409 `already_reminded_today` |
| `GET /admin/surveys/{id}/results` · `GET …/results.csv` | FR-13-A14. CSV có cột tên, phút, mức, hai câu viết, ý định, lý do, câu mở, đồng ý, tên hiển thị. Tên file không chứa tên lớp |
| `GET /admin/testimonials?status=&course=&source=&cursor` | Hàng duyệt |
| `GET /admin/testimonials/{id}` | Gồm `sentences:[{i, text}]`, `preview` sau lược, đồng ý, ghim hiện có |
| `POST /admin/testimonials/{id}/publish` · `/reject {reason}` · `/unpublish {reason}` · `/pins` · `/lower-name` · `/reply {text}` | Gọi hàm 5.A.1 |
| `POST /admin/testimonials/publish-bulk {ids[]}` | Giữ nguyên văn, không lược, không ghim (tờ màn 5) |
| `GET /admin/testimonials/imports` | Đọc `content_import_batches` có `script='import_legacy_testimonials'` cộng số đếm theo lô. Bảng lô chưa có thì trả `{items: [], unavailable: true}` |
| `GET /admin/testimonials/counts` | `{pending}`, cho số đếm sidebar |

Ghi nhật ký thao tác (công bố, gỡ, ghim, hạ tên) theo cơ chế G09 dùng. CHƯA KIỂM tên bảng: `grep -rn "staff_security_audit\|class_action_log\|admin_action" backend/routers/admin*.py | head`.

#### 5.A.5 Script `backend/scripts/import_legacy_testimonials.py`

- Lệnh: `python -m scripts.import_legacy_testimonials --file <đường dẫn ngoài repo> --course C1 --collected-on 2026-06-30 [--cohort-ended 2026-06] [--dry-run]`.
- Đầu vào chuẩn hoá: CSV UTF-8, các cột `person_name, email?, text, kind? (helpful|improve; trống = helpful), consent? (yes|no|trống), name_display? (full|initial|anonymous|trống), cohort_name?`.
- File gốc của anh Andy chưa xem được. Bước đầu tiên của nhiệm vụ A07 là đọc file thật, viết bảng ánh xạ cột vào thân PR, KHÔNG chép nội dung file vào repo hay PR (00 mục 4.4).
- Khớp tài khoản bằng `lower(email)` với `users.email`. Không khớp thì để `user_id` NULL và lưu `legacy_person_name`.
- Idempotent qua `legacy_key`. `--dry-run` in số dòng sẽ tạo, cập nhật, bỏ qua và lỗi; không ghi DB nhưng vẫn ghi bản ghi lô `mode='dry_run'`.
- Ghi lô qua `services/import_batch_log.start/add_item/finish`. Helper chưa có thì in cảnh báo và chạy tiếp (G09-T36 quy định lỗi ghi lô không làm hỏng lần nhập).

#### 5.A.6 Frontend

| Route | Nhóm route / khung | Tờ |
|---|---|---|
| `/hoc-vien-noi-gi` | `(public-commerce)` của G05 (hoặc nhóm công khai G05 dùng cho `/courses`), `PublicShell`; `?khoa=` ghi bộ lọc | HocVienNoiGi |
| Khối "Học viên nói gì" ở `/` và `/courses/[slug]` | Component `frontend/components/testimonials/TestimonialStrip.tsx` (props `place: 'home'\|'courses'`, `courseSlug?`), dựng phía server | TrangChuCongKhai mục 4, TrangKhoaHoc |
| Mục chân trang "Học viên nói gì" | `PublicFooter` (G03), thêm khi trang đã có | — |
| `/surveys/[surveyId]` | Trang tập trung (thanh tập trung, không có thanh 5 mục), cần đăng nhập, khai trong danh mục trang G07 với trang cha `/home` | AdminKhaoSat màn 3 |
| Thẻ Hôm nay | `frontend/components/surveys/SurveyTodayCard.tsx` | HomNayTrangThai 7b |
| "Nhận xét của tôi" | `frontend/components/testimonials/MyTestimonials.tsx`, gắn ở `/profile` mục Quyền riêng tư | TaiKhoan |
| `/admin/surveys` (`?tab=surveys\|review\|imports`), `/admin/surveys/new?cohort=`, `/admin/surveys/[id]`, `/admin/surveys/[id]/edit` | `(authed-admin)`, khung `ADMIN_FRAME_V2` | AdminKhaoSat màn 1, 2, 4, 5, 6 |

Sổ đăng ký sidebar của G09: mục "Khảo sát và nhận xét" đổi thành `available: true, href: '/admin/surveys'`, số đếm từ `GET /admin/testimonials/counts`.

#### 5.A.7 Cấu hình A

| Tên | Loại | Mặc định | Ý nghĩa |
|---|---|---|---|
| `testimonials_public` | runtime flag (`default=False, on_error=False`) | tắt | Tắt thì API công khai trả rỗng, khối trên trang chủ và trang khoá ẩn, `/hoc-vien-noi-gi` trả 404. Lý do: chỉ bật khi đã có nhận xét được duyệt |
| `surveys_enabled` | runtime flag | tắt | Tắt thì trang admin chỉ đọc, job không mở khảo sát |
| `SURVEY_DEFAULT_CLOSE_DAYS` | env int | 14 (theo tờ) | Ngày đóng mặc định = ngày mở + N |
| `SURVEY_AUTO_REMINDER_DAYS` | env int | 3 (theo tờ) | |
| `TESTIMONIAL_ANON_MIN_COHORT_SIZE` | env int | 10 (tạm, tờ ghi XXX — mục 10 câu A3) | |
| `TESTIMONIAL_PUBLIC_CACHE_SECONDS` | env int | 60 | |
| `TESTIMONIAL_PHOTOS_ENABLED` | env bool | false (mục 10 câu A2) | Tắt thì không có ô gửi ảnh |
| `ops_thresholds.survey_min_respondents` | khoá trong `admin_settings` (G09 mục 5.6) | 5 người (theo tờ: "dưới 5 người trả lời") | Dưới ngưỡng thì không có phần trăm hay trung bình |
| `ops_thresholds.survey_remaining_sessions` | như trên | `null` (repo chưa có tổng số buổi của lớp) | Dòng "Lớp sắp kết thúc khoá mà chưa có khảo sát" ẩn khi `null` |

### 5.B Phần B — Grammar Wiki (spec GRAMMAREDIT-0096)

#### 5.B.1 Chuyển hướng URL bài

- File `backend/content/_redirects.yaml`: `redirects: [{from: "<category>/<slug>", to: "<category>/<slug>", anchor?: "<anchor-id>", reason: "split|rename", since: "YYYY-MM-DD"}]`. Không cho chuỗi (A→B, B→C): script kiểm báo lỗi `GW020`. `from` không được trùng một bài đang có file.
- Backend: `GrammarContentService` đọc file, thêm `GET /api/grammar/redirects` (cache như `/categories`), trả `{items:[{from, to, anchor}]}`.
- `frontend/proxy.ts`, hàm `grammarArticle`: trước khi rewrite 404, tra bảng chuyển hướng. Có thì trả `NextResponse.redirect(new URL('/grammar/'+to+(anchor?'#'+anchor:''), request.url), 308)`. Bảng lấy cùng cách `/api/grammar/categories` đang lấy (dòng 47). Không tra được bảng thì giữ hành vi 404 hiện tại.
- Sitemap (`frontend/lib/public-sitemap-model.mjs` và `backend/routers/sitemap.py` `/sitemap-grammar.xml`) không có URL `from`.

#### 5.B.2 Mở rộng khối `figure` (sửa đổi GRAMMARFIG-0084)

**Ranh giới:**
- GOI-11 G11-T33 viết `ALLOWED_FIGURES` cho mười kiểu, các hàm `_validate_<kiểu>`, `_render_<kiểu>`, CSS `gw-fig*`, cách đánh số "Hình N" và giới hạn 4 hình mỗi bài.
- Gói này: (a) thêm trường TUỲ CHỌN vào lược đồ của các kiểu sẵn có. Khối không có trường mới vẫn hợp lệ, nên không vỡ bài thí điểm của G11-T34. (b) Thêm ba kiểu mới vào cùng `ALLOWED_FIGURES`. (c) Viết validate và render cho phần thêm, trong cùng file `backend/services/grammar_learning_blocks.py`, sau khi G11-T33 đã merge.
- Không tạo cơ chế khối thứ hai. Tờ GrammarWikiNhom8 ghi: "không mở cơ chế thứ hai".
- Khai báo khối giữ như GOI-11 mục 5.7.4: khai trong frontmatter `learning_blocks` (`type: "figure"`), đặt bằng `<!-- learning-block: <id> -->`.

| Mở rộng | Áp cho kiểu | Trường thêm | Bài cần (theo tờ) |
|---|---|---|---|
| Chỗ thiếu | 1 `sentence-anatomy`, 5 `clause-levels`, 8 `error-pair`, 9 `role-translation` | kiểu 1, 5, 9: phần tử `parts[]` có `gap: true`, `label_vi` bắt buộc (ví dụ "thiếu chủ ngữ"), `tone: "error"\|"neutral"`; kiểu 8 (`error-pair` là `{wrong, right, reason_vi}`, không có `parts[]` — GOI-11 mục 5.7.4): `gaps: [{at: <vị trí ký tự trong wrong>, label_vi, tone}]` (sửa 18/11 theo rà soát). `neutral` dùng cho "không nhắc" ở Nhóm 10. Không dùng màu làm tín hiệu duy nhất: nhãn chữ luôn hiện | 8.2, 8.14, 8.15, thiếu phẩy ở Nhóm 9, 10.8 (GrammarWikiNhom8, Nhom8-Bai2, Nhom9, Nhom10-Bai2) |
| Nhãn kiểu 8 đổi được | 8 `error-pair` | `labels: {left, right}` (mặc định "Sai" / "Đúng"); `left_tone: "error"\|"plain"` (`plain` khi câu trái không sai ngữ pháp: không tô đỏ, không gạch); `third?: {label, text, reason_vi}` cho nhãn thứ ba "Kém tự nhiên" (màu nhấn phụ, không gạch chữ) | 6.5, 6.9, 6.12, 7.10, 7.15, 8.11, 9.9, 10.x ("Bài đọc / Câu hỏi"), 4.8, 1.7 |
| Bảng chọn nhanh | kiểu mới `quick-choice` | `{title?, rows:[{question_vi, result_vi, example_en?}]}`; viền liền, nhãn "Bảng chọn nhanh", **không** đánh số Hình, không tính vào giới hạn 4 | 3.5, 1.5, 1.6 |
| Thang mức độ | kiểu mới `intensity-scale` | `{axis_vi:{low, high}, stops:[{word_en, example_en, note_vi?}] 2..6}` | 2.7, 5.5, 10.10 |
| Đoạn văn có chú giải | kiểu mới `annotated-paragraph` | `{text_en, notes:[{start, end, n, label_vi}]}`, vị trí theo ký tự, không chồng nhau; số mũ nhảy hai chiều tới dòng chú giải; trên điện thoại danh sách chú giải nằm dưới đoạn | 9.3, các bài Writing có đoạn mẫu |
| Cung qua hai câu | 7 `agreement` | `sentences: [s1, s2]` (thay `sentence`), mỗi cung `{from:{s, start, end}, to:{s, start, end}, label_vi}`; trên điện thoại đổi thành số mũ cặp ①②. Câu dài hơn 16 từ không dùng kiểu 7 (validator báo `GW031`) | 8.16, 9.6, 10.7, 10.11 |
| Bộ nhãn từ loại | 1, 10 `word-slot` | `label_set: "role"\|"pos"` (mặc định `role`) | 1.1 |
| Kiểu 3 nhiều ký hiệu | 3 `timeline` | `points[].shape: "dot"\|"bar"\|"hatched"\|"dashed"\|"ring"\|"lookback"` (`points` là trường của lược đồ `timeline` ở GOI-11 mục 5.7.4), nhiều `ref_points[]` có nhãn | nhóm 4 |
| Kiểu 4 mở rộng | 4 `voice-shift` | `added: true` (khối thêm vào, không mũi tên); `sources: [s1, s2]` (gộp hai câu); `swap_group: n` (hai khối đổi chỗ cùng số) | 3.4, 3.7, 3.8, 3.9 |
| Kiểu 6 thêm mẩu | 6 `morphemes` | `parts[].joiner: "hyphen"`; `parts[].role: "prefix-pos-shift"`; `ipa?` (đặt bằng Source Sans 3 — 00 mục 3) | 2.6, 1.15 |
| Bậc chữ tự do | 5 `clause-levels` | `levels[].label_vi` tự do ("Trả lời", "+ Lý do") | nhóm 7 |

**Không làm ở đợt này** (ghi lại để khỏi làm nhầm):
- `chart-map` của 9.1, 9.2 giữ là khối `visual` cũ.
- Ký hiệu quan hệ "A < B" ở 10.14 dựng bằng chữ trong `caption_vi`.
- "Hiểu sai / hiểu đúng" dựng bằng kiểu 5 hoặc 7 kèm chú thích.

Đây là đề nghị của tờ Nhom9 và Nhom10, không cần renderer riêng.

#### 5.B.3 Sáu khối khuôn bài

| Khối | Dữ liệu | Hiển thị | Tờ |
|---|---|---|---|
| Câu nói mẫu có nút nghe | kiểu khối mới `model-answer` trong `learning_blocks`: `{id, type:"model-answer", part: 1\|2\|3, question_en, answer_en, audio_key?: string, voice: "synthetic"\|"human"}`. `audio_key` tra trong `backend/content/_audio_manifest.yaml` (`{key: {url, duration_s, source: "video-making", voice}}`, do repo VIDEO MAKING giao theo hợp đồng ở nhiệm vụ B07) | Nút nghe 44px. Nhãn "Giọng đọc tổng hợp" hiện khi `voice='synthetic'`, ẩn khi giọng người thật. Chưa có `audio_key` hoặc không tra được thì ẩn cả hàng nút. Một trang chỉ phát một audio tại một thời điểm | GrammarWikiNhom7, Nhom7-Bai1 |
| Mục lục hai cấp | Không thêm dữ liệu. `toc_depth` đã là "2-3" (dòng 84). Trả `toc` dạng cây `[{id, title, children:[…]}]` thay danh sách phẳng khi bài có `toc_levels: 2` trong frontmatter | Bỏ tiền tố "PHẦN N:", cắt chữ ở hai dòng. Bài có hơn 6 mục "Lỗi N" thì gập, hiện 5 lỗi và nút "Xem cả N lỗi". Lý do giữ cờ theo bài: đa số bài ngắn không cần cấp hai | Nhom1, Nhom3, Nhom5, Nhom6, Nhom7 |
| Ẩn mục trống | API trả `sections_present: {toc, self_check, margin_notes}` | Mục lục, "Tự kiểm tra", lề chú thích chỉ hiện khi có dữ liệu | Nhom8, Nhom2 |
| Bảng trong khối Tóm tắt | Backend tách bảng Markdown đầu tiên ngay sau H2 "Tóm tắt" thành `summary_table_html`. Đoạn tóm tắt vẫn lấy từ `summary` | Bảng hiện ngay dưới đoạn tóm tắt, cuộn ngang từ 4 cột, cột đầu dính | Nhom1, Nhom5, Nhom6, Nhom8-Bai2 |
| Khối bài đọc / câu hỏi | kiểu khối mới `passage-question`: `{id, passage_en, question_en, answer: "TRUE"\|"FALSE"\|"NOT GIVEN"\|string, reasoning_vi}` | Dòng kết quả in đậm, ẩn tới khi bấm "Xem đáp án" | Nhom10, Nhom10-Bai2 |
| Bảng dài gập được (thêm 18/11 theo rà soát) | Không thêm dữ liệu; bảng Markdown trên 10 dòng | Hiện 7 dòng đầu, nút "Xem đủ N dòng"; từ 4 cột cuộn ngang; `@media print` mở hết | Nhom8, Nhom9 |

Ba kiểu khối mới (`model-answer`, `passage-question`, `figure` mở rộng) đi qua `validate_learning_blocks` hiện có: khối sai thì bỏ khối, `logger.warning`, bài vẫn hiện.

### 5.C Phần C — Kiến thức nền (spec TOPICKNOW-0097)

#### 5.C.1 File nguồn trong repo

Mỗi chủ đề một file `backend/content/background/<slug>.yaml`. `slug` trùng `slug` của `backend/content_vocab/_categories.yaml`; Work là `work-career`.

```yaml
slug: work-career
title_en: Work
title_vi: Công việc
intro_vi: [đoạn, đoạn]          # 1–3 đoạn
status: draft | review | published
authored_by: "<tên>"            # người soạn (AI soạn nháp thì ghi "bản nháp AI, <người chạy>")
reviewed_by_teacher: null        # tên giáo viên IELTS đã duyệt câu tiếng Anh, nhãn, bẫy
reviewed_by_owner: null          # tên người duyệt dữ kiện, giọng văn
reviewed_on: null
aspects:                         # 3–6, có thứ tự
  - n: 1
    title_vi: Vì sao công việc thay đổi
    short_vi: Vì sao thay đổi
    sub_ideas_vi: [công nghệ và kết nối, đại dịch như một phép thử, chi phí và kỳ vọng mới]  # đúng 3
    explain_vi: [đoạn, đoạn]     # 2–3
    ideas:                       # 3–4
      - key: a1-i1
        idea_vi: …
        why_vi: …
        keywords_en: [boundary, …]  # từ khoá để mã đếm ý trong đoạn viết ngắn (5.C.4 bước 7)
        sentence_en: …           # ≤ 30 từ
        level: simple | developed   # nhãn "câu đơn giản" / "câu phát triển hơn", không phải band
    collocations:                # 6–8
      - en: blur the boundary
        vi: làm mờ ranh giới
        vocab_ref: work-career/<slug>   # chỉ khi file tồn tại trong content_vocab, không thì bỏ
    trap: {name_vi, bad_en, why_vi, good_en}
relations: [{a: 2, b: 5, label_vi: "hay đi cùng trong đề lợi – hại"}]
self_check: [{q_vi, hint_aspect: 2}]   # đúng 3
short_writing: {prompt_en, min_words: 80, max_words: 100}   # dưới min_words: 422; trên max_words vẫn nhận, giao diện nhắc "đoạn dài hơn yêu cầu" (tờ KienThucNen 5d)
writing_links: [{sample_slug, aspects: [2, 3, 5]}]   # slug của writing_samples (G06)
speaking_links: [{question_en, aspects: [2], speaking_slug?: …}]
```

Validator `backend/scripts/validate_background_topics.py` kiểm: đếm phần tử đúng khoảng; `vocab_ref` tồn tại; `sample_slug` tồn tại trong manifest của G06 (`backend/content/library/writing-samples-manifest.json`, GOI-06 mục 5.8); không có chữ số band trong `level`; `sentence_en` ≤ 30 từ; mỗi ý dùng được cho ít nhất một đề (có `writing_links` phủ khía cạnh đó); `published` thì phải có đủ hai tên người duyệt.

#### 5.C.2 Migration 492 `backend/migrations/492_background_topics.sql`

- `background_topics(slug text PK, title_en, title_vi, status text CHECK IN ('draft','review','published'), document jsonb NOT NULL, content_hash text NOT NULL, reviewed_by_teacher text NULL, reviewed_by_owner text NULL, reviewed_on date NULL, display_order int NOT NULL DEFAULT 0, published_at, updated_at)`. CHECK `status <> 'published' OR (reviewed_by_teacher IS NOT NULL AND reviewed_by_owner IS NOT NULL)` (FR-13-C06).
- `background_topic_writing_links(topic_slug FK, sample_slug text, aspects int[] NOT NULL, PRIMARY KEY (topic_slug, sample_slug))`. Không FK sang `writing_samples` vì G06 có thể đổi slug (bảng `writing_sample_slug_history`). API tra slug hiện hành lúc đọc.
- RLS bật, revoke `anon` và `authenticated`, đọc qua backend. Có rollback.

Script `backend/scripts/import_background_topics.py [--dry-run] [--only <slug>]`: đọc file, chạy validator, upsert theo `content_hash`, ghi lô qua `import_batch_log`. File là nguồn thật. Lý do vẫn có DB: trang Thư viện đọc nhanh, bật tắt được bằng `status` mà không deploy, và có bản ghi lô cho admin (G06-T20 hiện ở `/admin/library`).

#### 5.C.3 Migration 493 `backend/migrations/493_background_short_writings.sql`

- `background_short_writings(id uuid PK, user_id FK users ON DELETE CASCADE, topic_slug FK background_topics, prompt_hash text NOT NULL, text text NOT NULL CHECK length 1..2000, word_count int NOT NULL, request_key text NOT NULL, status text CHECK IN ('pending','done','failed'), reservation_id uuid NULL, feedback jsonb NULL, ideas_matched text[] NOT NULL DEFAULT '{}', collocations_matched text[] NOT NULL DEFAULT '{}', model text NULL, error_code text NULL, created_at, completed_at, UNIQUE (user_id, request_key))`.
- RLS như trên. Phụ thuộc 382 (giá trị `short_writing` ở CHECK `resource_type` của G04).

#### 5.C.4 API

`backend/routers/library_background.py`, prefix `/api/library/background`; nằm trong `ACTIVATION_EXEMPT_ROUTES` vì là Thư viện công khai.

| Method · path | Auth | Response | Lỗi |
|---|---|---|---|
| `GET /api/library/background` | không | `{items:[{slug, title_en, title_vi, aspect_count, idea_count, collocation_count, writing_count}], upcoming:[{title_en, title_vi}]}` — `items` chỉ `published`; `upcoming` là chủ đề `draft`/`review` cho dòng "Đang soạn" của mục lục, không có slug, không có số đếm (sửa 18/11 theo rà soát: tờ thắng về giao diện) | — |
| `GET /api/library/background/{slug}` | không | `document` (bỏ `authored_by`, giữ tên hai người duyệt) + `writing:[{slug, title_en, question_type, aspects}]` + `vocab_links:{<en>: href}` | 404 `topic_not_found` |
| `GET /api/library/background/for-sample/{sample_slug}` | không | `{topic: null\|{slug, title_en, title_vi, aspects:[{n, title_vi}]}}` | — |
| `POST /api/library/background/{slug}/short-writings` | có | `{text, request_key}` → 202 `{id, status:"pending"}`; replay → 200 với bản đã có | 401; 402 `insufficient_credits` (kèm `credit_source`); 403 `no_entitlement`; 422 `word_count_out_of_range` chỉ khi dưới `min_words`; trên `max_words` vẫn nhận, giao diện hiện "đoạn dài hơn yêu cầu"; trần cứng là `text` ≤ 2000 ký tự (CHECK 493) (sửa 18/11 theo rà soát: tờ thắng về giao diện); 429 `daily_limit` (`SHORT_WRITING_DAILY_LIMIT`); 503 `credits_unavailable` |
| `GET /api/library/background/short-writings/{id}` | có, chủ bài | `{status, feedback, ideas_matched, collocations_matched}` | 404 |
| `GET /api/library/background/{slug}/short-writings/mine` | có | `{items:[…≤10]}` | — |

Luồng nộp, theo GOI-04 mục 5.6 phần "Đoạn viết ngắn":
1. `plan = await credits.acharge_plan(user_id, "short_writing_feedback")`.
2. `metered` thì gọi `credits.reserve(user_id, "short_writing_feedback", request_key=<id>, resource_type='short_writing', resource_id=<id>, ttl_seconds=CREDIT_HOLD_TTL_SPEAKING_SECONDS, course_ids=plan.course_ids, kinds=plan.kinds)`.
3. Ghi dòng `pending`.
4. Chạy nền `services/short_writing_feedback.py::run(id)`: gọi AI qua `services.ai_router` như `advanced_vocab_rewrite_grader.py`, ghi chi phí bằng `ai_usage_logger.log_*_response(..., feature="short_writing_feedback")`.
5. Kiểm đầu ra: JSON `{summary_vi, items:[{kind:"strength"|"vague"|"trap", quote, note_vi, fix_vi}] ≤3}`. Mỗi `quote` phải là chuỗi con của `text` sau khi chuẩn hoá khoảng trắng; không khớp thì bỏ mục. Không còn mục nào và không có `summary_vi` thì coi là lỗi.
6. Thành công thì `fn_credit_commit`. Lỗi, hết giờ, đầu ra sai thì `fn_credit_release`, `status='failed'`.
7. `ideas_matched`, `collocations_matched` do mã đếm, so cụm collocation và từ khoá ý soạn trong file (trường `ideas[].keywords_en` của lược đồ 5.C.1) không phân biệt hoa thường.

Prompt không chứa tên hay email người học.

#### 5.C.5 Frontend

- `/library/background` (mục lục: danh sách chủ đề, số khía cạnh, số đề) và `/library/background/[slug]` (tờ KienThucNen mục 1) trong nhóm route công khai của G06, `PublicShell`. Thêm một phần tử vào mảng kệ của `/library` (FR-06-005b). Thêm vào sitemap của G06.
- Component trong `frontend/components/background/`:
  - `TopicTree`: SVG sinh từ dữ liệu, 3–6 nhánh, dùng biến màu nên theo được chế độ tối, bản in luôn sáng; `role="img"` và `aria-label` đọc thành câu.
  - `AspectPanel`, `IdeaList`, `TrapBox`, `SelfCheck`.
  - `ShortWritingBox`: nháp lưu `localStorage` trong try/catch; bốn trạng thái khách / đã đăng nhập có lượt / hết lượt (tờ 5a) / đã nộp; đếm từ.
  - `ShortWritingFeedback`: trích dẫn được gạch chân và đánh số trong đoạn.
  - `BackgroundLinkLine`: dòng ở trang đề Writing.

### 5.D Phần D — Đọc kỹ (spec CLOSEREAD-0098)

#### 5.D.1 Dữ liệu chú giải một câu

File `backend/content/close_read/M<nn>.yaml` (mỗi mô đun một file), kèm `backend/content/close_read/_lessons.json`. `_lessons.json` chép trường `id, title, module_id, module_title` của `~/Documents/Co-work/Course 1/15_DE-CUONG-V2/381-bai-v2.jsonl` (381 dòng; chỉ ba trường đó, không chép `key`, `example`, `practice`).

```yaml
module_id: M09
module_title: Hoà hợp, bị động, đọc chuỗi động từ   # lấy từ _lessons.json, validator so khớp
items:
  - id: m09-04
    order: 4
    status: draft | review | published
    authored_by, reviewed_by, authoring_minutes   # authoring_minutes bắt buộc ở 20 câu thí điểm
    text_en: "The collection of old manuscripts has been catalogued by two librarians since 2021."
    segments: [{start, end, role: S|V|O|C|A, role_note_vi?, hint_wrong_vi, praise_vi}]  # không chồng nhau, phủ kín câu trừ dấu chấm cuối
    no_object: true          # câu không có O/C: bước 1 hỏi xác nhận
    frame_line_vi: "Khung câu: S + V (bị động) + A + A."
    signals: [{n, name_vi, spans:[[start,end]], adds_vi, translate_vi, morphemes?:[{t, g_vi}], lesson_code: B158, wiki: {slug: "sentence-structures/passive-voice", anchor?}}]
    model_natural_vi: "…"
    model_by_role: [{role, en, vi}]
    inner_map?: {block: S, pairs:[{en, vi, moved: bool}], note_vi}
    self_check: [{label_vi, signal_n, keywords_vi: ["được"]}]
    reading_link?: {reading_id, unit_id, source_sha256}
```

Vị trí `start`, `end` tính theo ký tự Unicode của `text_en`. Một ký tự thuộc được nhiều `signals`.

Dùng lại 0021:
- Khi có `reading_link`, validator và API lấy `PracticeUnit` qua `validated_support(metadata, body)`.
- `text_en` phải bằng `unit.source`, `unit.precision == 'sentence'`, và `digest(body) == reading_link.source_sha256`.
- `model_natural_vi` mặc định lấy `unit.translation_vi`; `model_by_role` được gợi ý từ `unit.phrases`, người soạn sửa.
- Lệch thì API trả `available: false` cho lối vào Reading và không gắn chú giải.

#### 5.D.2 Migration 494 `backend/migrations/494_close_read.sql`

- `close_read_items(id text PK, module_id text NOT NULL CHECK (module_id ~ '^M(0[1-9]|1[0-9]|20)$'), item_order int, status, document jsonb NOT NULL, content_hash text, reading_id uuid NULL, reading_unit_id text NULL, published_at, updated_at)`.
- `close_read_attempts(id uuid PK, user_id FK users ON DELETE CASCADE, item_id FK close_read_items, attempt_no int, step1_hints_used bool, translation_vi text NOT NULL CHECK length 1..2000, self_marks jsonb NOT NULL DEFAULT '{}', submitted_at, marked_at NULL, UNIQUE (user_id, item_id, attempt_no))`. `translation_vi` không UPDATE được sau khi ghi (trigger), vì FR-13-D02 khoá bản dịch đầu.
- RLS bật, revoke `anon` và `authenticated`. Có rollback. Script nhập `backend/scripts/import_close_read.py [--dry-run] [--module M09]`, ghi lô qua `import_batch_log`.

#### 5.D.3 API

`backend/routers/close_read.py`, prefix `/api/close-read`, cần đăng nhập. Quyền mặc định tạm: tài khoản đã kích hoạt (mục 10 câu D1).

| Method · path | Response | Ghi chú |
|---|---|---|
| `GET /api/close-read/modules` | `[{module_id, title, item_count, done_count}]` (chỉ mô đun có câu `published`) | |
| `GET /api/close-read/modules/{m}` | `{items:[{id, order, done, needs_hint}]}` | |
| `GET /api/close-read/items/{id}` | `text_en, segments` (không có `praise_vi`, `hint_wrong_vi` trước khi chọn: trả theo từng lần kiểm), `signals` (đủ), `self_check.label_vi` | KHÔNG trả `model_natural_vi`, `model_by_role`, `inner_map`, `keywords_vi` |
| `POST /api/close-read/items/{id}/check-segment` `{start, end, role}` | `{correct, message_vi}` | Kiểm ở máy chủ để đáp án bước 1 không nằm sẵn trên trình duyệt |
| `POST /api/close-read/items/{id}/reveal-frame` | `{segments: [...]}`, ghi `needs_hint` | |
| `POST /api/close-read/items/{id}/attempts` `{translation_vi, step1_hints_used}` | 201 `{attempt_id, model_natural_vi, model_by_role, inner_map, self_check:[{label_vi, signal_n, keywords_vi, lesson_title, wiki_href}]}` | Chỉ lúc này mới trả bản mẫu (FR-13-D02) |
| `PATCH /api/close-read/attempts/{id}/marks` `{marks:{<signal_n>: "ok"\|"missed"}}` | 204 | |
| `GET /api/close-read/modules/{m}/summary` | `{missed:[{signal_name, at:[order], lessons:[title]}], solid:[…], hints_needed:[order]}` | Không có điểm |
| `GET /api/close-read/for-reading/{reading_id}` | `{units:[{unit_id, item_id}] ≤2}` (chỉ câu `status='published'` và đơn vị qua kiểm băm (sửa 18/11 theo rà soát: tờ thắng về giao diện)) | Lối vào B |

Mã bài (`lesson_code`) chỉ dùng ở máy chủ để tra `lesson_title`. Không trường nào trả về học viên chứa chuỗi `B\d{3}`; test kiểm điều này bằng regex trên JSON trả về.

#### 5.D.4 Frontend

- Trang `/practice/close-reading` (danh sách 20 mô đun, dưới Luyện tập, đăng ký trong danh mục trang G07 với trang cha `/practice`). Trang `/practice/close-reading/[module]/[item]` (màn bốn bước, tờ DocKy mục 2, 5). Trang `/practice/close-reading/[module]/summary` (mục 4).
- Component `frontend/components/close-read/CloseReadModuleBlock.tsx` cho lối vào A, để G07 gắn vào trang mô đun khi có (mục 10 câu D2).
- Nút "Đọc kỹ câu này" trong `practice-reading-text.tsx` cho lối vào B, ẩn ở mọi trình full test.
- "So chữ" chạy trong trình duyệt trên `keywords_vi` nhận được sau khi gửi bản dịch.

### 5.E Phần E — Khuôn luyện đề (EXAMKIT-0099, chỉ tài liệu)

Mở rộng ba bảng của migration 134, không dựng mô-đun mới (tờ KhuonLuyenDe, ghi chú "Dùng lại từ quiz hiện có"). Phác thảo dưới đây chỉ để spec sau này viết đúng hướng, KHÔNG phải hợp đồng cho người thực thi đợt này.

| Đối tượng | Hình dạng dự kiến | Ghi chú |
|---|---|---|
| `exam_programs` (mới) | `code text PK` (bằng `exam_source`, ví dụ `thpt_qg`), `title_vi`, `question_count`, `time_limit_minutes`, `sections jsonb [{no, title_vi, q_from, q_to}]`, `score_scale numeric`, `points_per_question numeric`, `ui_language 'vi'\|'en'`, `modes text[] ('timed','untimed')`, `allow_phone bool`, `access_policy text` (chưa quyết: miễn phí hay thuộc khoá), `is_open bool DEFAULT false` | Bảng cấu hình mục 2 của tờ. Đổi kỳ thi là thêm một dòng |
| `exam_passages` (mới) | `id, test_id FK, section_no, body, source_note` | Một đoạn văn dùng chung cho nhiều câu |
| `exam_tests` (thêm cột) | `review_status ('draft','in_review','approved')`, `reviewed_by`, `reviewed_at`, `import_batch_code` | Chỉ đề `approved` và `status='published'` mới ra kho |
| `exam_questions` (thêm cột) | `passage_id`, `section_no`, `type_tag text` (danh sách mở theo kỳ thi), `level ('NB','TH','VD')`, `option_traps jsonb` (lý do sai từng phương án), `topic_tags text[]`, `is_suspended bool` | `question_type` giữ `mcq_single` |
| `exam_tag_lesson_map` (mới) | `program_code, tag, lesson_code, grammar_slug?, vocab_list_slug?` | Bảng ánh xạ nhãn → bài học, tra cho màn E |
| Báo lỗi đáp án | Dùng `content_review_items` của G09 (450), `item_kind='exam_question'` | Không tạo hàng chờ thứ hai |
| Chấm | điểm = số đúng × (`score_scale` ÷ `question_count`), làm tròn 2 chữ số, hiện dấu phẩy; câu bỏ trống tính sai; câu `is_suspended` không tính ("39 câu được tính") | Đáp án không gửi về trình duyệt trước khi nộp |

Năm màn: A Kho đề · B Làm đề (dùng lại khung tập trung, đồng hồ, dải số câu của PhongThi; nhãn tiếng Việt "Câu 5" vì đề thật in hướng dẫn tiếng Việt) · C Kết quả theo phần và dạng câu · D Xem lại từng câu · E Ôn chỗ hổng (sinh từ bảng ánh xạ).

**Điều kiện mở một kỳ thi** (tất cả phải đúng):
1. Anh Andy nói mở bằng lời trong chat.
2. Có người thật duyệt xong đáp án của từng đề sẽ mở, và tỉ lệ lỗi sau duyệt đã được đo. Tài liệu khảo sát ghi các lô trước có khoảng 5–11% câu cần sửa và chưa có người thật duyệt.
3. Đã quyết về bản quyền. 73 đề tự soạn thì gỡ dòng "Adapted from <nguồn thật>" hoặc ghi "bài đọc tự biên soạn". 10 đề chính thức của Bộ không dùng nếu chưa có quyết định riêng; các đề này cũng không có đáp án.
4. Đã gán nhãn chủ đề ngữ pháp cho từng câu và chuyên môn đã chốt bảng ánh xạ (bảng ở `khao-sat/thpt.md` mục 5 là bản sơ bộ).
5. Đã chốt quyền truy cập.

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

Quy ước: mỗi nhiệm vụ là một PR vào `staging` từ worktree riêng (00 mục 4.1). Nhiệm vụ `feature`/`high-risk` không viết mã trước khi PR spec tương ứng được duyệt (00 mục 4.6).

### Phần A — Nhận xét học viên và khảo sát sau khoá (đợt: chặng 1, trước mở bán)

#### G13-A01 — Spec TESTIMONIAL-0095

- Mục đích: chốt hợp đồng 5.A trước khi viết mã.
- Đầu vào: gói này mục 4 A, 5.A. Tờ `HocVienNoiGi`, `AdminKhaoSat`, `TrangChuCongKhai` (mục 4), `TrangKhoaHoc` (khối nhận xét), `HomNayTrangThai` (7b), `TaiKhoan` (Nhận xét của tôi). `specs/_templates/`, `specs/README.md`, `specs/_meta/constitution.md`.
- Việc làm:
  1. Tạo `specs/0095-testimonials-surveys/` (`spec.md` có `risk: high`, `plan.md`, `tasks.md`) theo mẫu repo.
  2. `plan.md` có lược đồ 490, danh sách hàm, bảng API, bảng cấu hình.
  3. Ghi mục 10 phần A vào phần "Open questions" kèm mặc định tạm.
  4. `python backend/scripts/validate_specs.py`.
  5. Mở PR spec và dừng chờ duyệt.
- Đầu ra: 1 PR spec.
- Nghiệm thu: `python backend/scripts/validate_specs.py` thoát 0; `git diff --check` sạch; PR chỉ có file trong `specs/0095-*`.
- Không làm: không viết mã, không migration; không tự duyệt.
- Vướng mắc → cách gỡ:
  - Số 0095 đã bị PR khác dùng → `ls specs | grep 0095` và `gh pr list --search 0095`; có thì dừng, báo người điều phối, không tự lấy số khác.
  - Mẫu spec của repo đòi mục mà gói không có (ví dụ "telemetry") → điền theo 5.A.4 (nhật ký thao tác) và ghi "N/A" kèm lý do, không bịa sự kiện.
- Ước lượng: 1 phiên · 2.

#### G13-A02 — Migration 490 và hàm (high-risk)

- Mục đích: 5.A.1; FR-13-A01…A09.
- Đầu vào: spec 0095 đã duyệt; `backend/migrations/README.md`; `forward-policy.tsv`; `376_blackeye_admission.sql` (mẫu RLS và revoke); `060_cohorts_table.sql`, `175_courses.sql`, `227_student_cohort_memberships.sql`; test PG17 gần nhất làm mẫu (`ls backend/tests | grep test_migration_ | tail -3`).
- Việc làm:
  1. Viết `490_testimonials_surveys.sql` (bảng, trigger, hàm, nạp `survey_templates` v1, RLS) và rollback.
  2. Thêm dòng `forward-policy.tsv` (`pending_feature`, "No apply on merge").
  3. Viết `backend/tests/test_migration_490_testimonials_surveys.py` (PG17), gồm các ca:
     - (a) UPDATE `original_text` bị từ chối;
     - (b) ghim thứ 4 → `pin_full`; 10 kết nối đồng thời ghim cùng chỗ đã có 2 mục → đúng 1 thành công;
     - (c) rút đồng ý → mọi mục `rejected/withdrawn`, bỏ ghim, publish lại → `not_publishable`;
     - (d) submit thiếu câu bắt buộc → `incomplete`;
     - (e) submit lần hai sửa `helpful_text` khi mục đã `published` → mục về `pending`, nguyên văn mới;
     - (f) người không phải thành viên → `not_member`;
     - (g) `authenticated` không SELECT được bảng nào.
- Đầu ra: 1 PR migration.
- Nghiệm thu: `cd backend && python -m pytest tests/test_migration_490_testimonials_surveys.py -q` qua trên PG17 local; rollback chạy được trên DB rỗng; `python -m pytest tests/ -q` không đỏ thêm.
- Không làm: không áp lên staging hay production (anh Andy áp theo sổ); không thêm bucket ảnh.
- Vướng mắc → cách gỡ:
  - Trigger chặn ghi đè chặn luôn hàm đồng bộ FR-13-A05 → dùng `SET LOCAL aver.testimonial_sync='on'` trong hàm và cho trigger đọc `current_setting('aver.testimonial_sync', true)`. Test ca (e) bắt lỗi này.
  - `course_products` (381) chưa có trên DB thử → test PG áp migration theo thứ tự số; chưa có 381 thì cột `course_product_id` tạo không FK và thêm FK có điều kiện (`DO $$ … IF to_regclass('course_products') …`). Ghi rõ trong PR.
  - Tên khoá kế theo `sort_order` gặp hai khoá cùng thứ tự → lấy khoá có `code` nhỏ hơn; ghi test.
- Ước lượng: 2 phiên · 4.

#### G13-A03 — Loại thông báo khảo sát (migration 491 có điều kiện)

- Mục đích: 5.A.2.
- Đầu vào: trạng thái merge của G11-T08 (`git log origin/staging -- backend/migrations/470_*`).
- Việc làm:
  - 470 chưa merge: không mở PR này; báo người điều phối thêm hai `kind` và `target.type='survey'` vào G11-T08.
  - 470 đã merge: viết 491, rollback, test PG17 (chèn `survey_open` thành công; `foo` vẫn bị từ chối).
- Đầu ra: 0 hoặc 1 PR.
- Nghiệm thu: `pytest tests/test_migration_491_notification_kinds_survey.py -q` qua.
- Không làm: không sửa 470 đã merge.
- Vướng mắc → cách gỡ:
  - Tên CHECK do Postgres tự đặt → lấy từ `pg_constraint` trong migration bằng `DO $$`, không gõ tên.
  - G11-T08 đang mở PR → nhờ người điều phối gộp vào PR đó thay vì tạo 491.
- Ước lượng: 0,5 phiên · 2.

#### G13-A04 — Service khảo sát và API admin khảo sát

- Mục đích: 5.A.3 (trừ job), 5.A.4 bảng Admin phần `surveys`; FR-13-A01, A03, A12 (nút nhắc), A14.
- Đầu vào: A02; `services/staff_scope.py` (G09-T24); `services/notification_service.py` (G11-T09); `backend/routers/admin_class_assignments.py` (mẫu router admin có `staff_scope`).
- Việc làm:
  1. `backend/services/surveys.py`.
  2. `backend/routers/admin_surveys.py` (phần `/admin/surveys*`).
  3. CSV qua `csv` chuẩn, BOM UTF-8 để Excel đọc đúng dấu.
  4. Gọi `fn_notify_batch` cho nhắc tay và cho "Lưu và mở ngay" (`survey_open`, 5.A.4).
  5. Viết test `backend/tests/test_admin_surveys_api.py`: tạo trùng → 409; sửa câu chữ khi đã có trả lời → 409 `copy_locked`; giáo viên xem lớp khác → 404; nhắc hai lần trong ngày → 409; kết quả dưới 5 người → `percent_allowed=false` và không có trung bình mức.
- Đầu ra: 1 PR.
- Nghiệm thu: test mới qua; `tests/test_staff_guard_inventory.py` qua; `tests/test_suite_makes_no_live_calls.py` qua.
- Không làm: không làm trang; không gửi thư.
- Vướng mắc → cách gỡ:
  - `staff_scope.py` chưa merge → bản đầu chỉ cho admin, giáo viên 403, ghi CẦN theo G09-T24 trong PR.
  - `notification_service` chưa có → nút nhắc trả 503 `notifications_unavailable`, giao diện hiện nút tắt kèm lý do (cùng cách G09 làm).
  - Sĩ số lúc mở khác sĩ số hiện tại → tỉ lệ luôn dùng `roster_size_at_open`; lớp mở trước khi có cột (không xảy ra với bảng mới) thì dùng sĩ số hiện tại và ghi chú.
- Ước lượng: 2 phiên · 4.

#### G13-A05 — API học viên: trả lời khảo sát, đồng ý, Hồ sơ

- Mục đích: FR-13-A04, A05, A08, A09, A13 (nguồn dữ liệu).
- Đầu vào: A02; `backend/services/activation_gate.py`; `tests/test_activation_gate_inventory.py`.
- Việc làm:
  1. Viết `backend/routers/surveys.py` và `backend/routers/me_testimonials.py`.
  2. Viết `services/surveys.py::open_surveys_for`.
  3. Khai báo exempt kèm lý do.
  4. Viết test `test_surveys_api.py`, `test_me_testimonials_api.py`: không phải thành viên → 404; khảo sát đóng → 409; replay `request_key` không sinh mục trùng; rút đồng ý → `GET /api/testimonials` không còn mục (cần A06 cho route công khai: test gọi thẳng service nếu A06 chưa merge); đổi tên hiển thị → `preview_name` đổi.
- Đầu ra: 1 PR.
- Nghiệm thu: test qua; inventory qua; `frontend/types/api.d.ts` sinh lại, CI `apitype-drift` xanh.
- Không làm: không làm màn; không gắn vào `GET /api/student/today` (A11).
- Vướng mắc → cách gỡ:
  - Một người có nhiều hồ sơ `students` ở nhiều lớp → xác định thành viên theo `students.user_id = user` VÀ có membership active ở `cohort_id` của khảo sát; lấy `student_id` của hồ sơ đó.
  - Học viên đã bị gỡ khỏi lớp sau khi mở khảo sát → không cho gửi mới (404); câu trả lời đã gửi giữ nguyên.
- Ước lượng: 2 phiên · 4.

#### G13-A06 — API duyệt nhận xét và API công khai

- Mục đích: FR-13-A06, A07, A09, A10, A16; 5.A.4 bảng Công khai và phần `/admin/testimonials*`.
- Đầu vào: A02; G06 mục 5.7 (`cacheable_json`, `Last-Modified`); `services/runtime_flags.py`.
- Việc làm:
  1. Viết `backend/services/testimonials.py`, `backend/routers/testimonials_public.py`, phần testimonials của `admin_surveys.py`.
  2. Cờ `testimonials_public`.
  3. Viết test:
     - tên hiển thị ba kiểu, gồm tên hai tiếng, tên có khoảng trắng thừa, chữ tổ hợp NFD;
     - lược câu: còn 0 câu → 422 `nothing_left`;
     - JSON công khai không chứa `user_id`, `email`, `rating` (duyệt cây khoá);
     - lấp chỗ ghim;
     - khoá có nhận xét riêng → chỉ lấy của khoá đó;
     - cờ tắt → `items: []`.
- Đầu ra: 1 PR.
- Nghiệm thu: test qua; `curl -s localhost:8000/api/testimonials | python -m json.tool` khi cờ bật trên DB thử cho đúng hình dạng.
- Không làm: không có route ghi đè nguyên văn, kể cả "sửa lỗi chính tả"; không trả mức 1–5 ra ngoài.
- Vướng mắc → cách gỡ:
  - Tách câu sai với chữ viết tắt ("TP. HCM", "v.v.") → chấp nhận sai lệch nhỏ vì admin thấy từng câu trước khi lược; thêm danh sách viết tắt không tách trong `split_sentences` và test.
  - Cache công khai giữ mục đã rút → `max-age` ≤ `TESTIMONIAL_PUBLIC_CACHE_SECONDS`, không dùng `'use cache'` dài hạn ở frontend cho các API này (khác G06).
  - Nhãn bộ lọc "Course 1–5" lấy từ `courses.name` có thể chứa chữ "lớp offline" → hiển thị "Course N" theo `courses.code`; tên khoá online lấy từ `course_products`.
- Ước lượng: 2 phiên · 4.

#### G13-A07 — Script nhập nhận xét cũ

- Mục đích: FR-13-A11; 5.A.5.
- Đầu vào: A02; file nhận xét cũ do anh Andy chỉ đường dẫn (ngoài repo); `services/import_batch_log.py` (G09-T36); mẫu script nhập có `--dry-run`: `backend/scripts/import_writing_prompts.py`.
- Việc làm:
  1. Đọc file thật (chỉ đọc) và lập bảng ánh xạ cột trong thân PR. Không dán dòng nào của file.
  2. Viết `backend/scripts/import_legacy_testimonials.py`.
  3. Viết test `backend/tests/test_import_legacy_testimonials.py` với CSV giả 5 dòng tự viết (không tên thật): chạy hai lần → không trùng; dòng `consent=no` → không sinh mục; dòng không có email → `legacy_person_name`; `--dry-run` không ghi.
- Đầu ra: 1 PR. Chạy thật trên staging là việc của anh Andy hoặc theo lệnh anh cho phép.
- Nghiệm thu: test qua; `python -m scripts.import_legacy_testimonials --file <csv giả> --course C1 --collected-on 2026-06-30 --dry-run` in đúng bốn số đếm.
- Không làm: không chép file vào repo, fixture, PR (00 mục 4.4); không tự điền `consent=yes` cho dòng ghi "không"; không chạy trên production.
- Vướng mắc → cách gỡ:
  - File gốc không phải CSV (docx, xlsx, ảnh phiếu) → viết bước chuyển đổi riêng `--from-xlsx` dùng `openpyxl` nếu repo đã có (CHƯA KIỂM: `grep -n openpyxl backend/requirements*.txt`). Không có thì dừng, đề nghị anh xuất CSV.
  - Một nhận xét gộp cả khen và góp ý → nhập thành `helpful`; tách hai mục là việc admin không làm được (không sửa chữ), nên ghi nhãn `theme_tags=['mixed']` để lọc.
  - Họ tên trong file viết thường hoặc thiếu dấu → giữ nguyên như file (không sửa chữ); `display_name` tính từ chuỗi đó.
- Ước lượng: 1,5 phiên · 3.

#### G13-A08 — Bước `surveys` trong job thông báo

- Mục đích: FR-13-A03 (chuyển trạng thái theo ngày), A12; 5.A.3 phần job.
- Đầu vào: G11-T10 (`backend/scripts/notification_sweep.py`), A03, A04.
- Việc làm:
  1. Thêm bước `surveys` (độc lập, lỗi không chặn bước khác, log `[notify] step=surveys opened=<n> reminded=<n> closed=<n>`).
  2. Viết câu chữ hai `kind` trong `notification_copy.py`.
  3. Map `survey` trong `notification-target-model.mjs`.
  4. Viết test: mở đúng ngày; chạy hai lần không sinh trùng (dedupe); cờ thông báo tắt vẫn đóng khảo sát.
- Đầu ra: 1 PR.
- Nghiệm thu: `pytest tests/test_notification_sweep_surveys.py -q` qua; `python -m scripts.notification_sweep --dry-run --step surveys` in số đếm.
- Không làm: không tạo service cron Railway mới; không gửi thư.
- Vướng mắc → cách gỡ:
  - Giờ mở theo giờ Việt Nam khác UTC → lưu `timestamptz`; giao diện tạo nhập ngày theo giờ VN, mở lúc 00:00 giờ VN; test ở ranh 17:00 UTC.
  - G11-T10 chưa merge → để nhiệm vụ chờ. Trong lúc chờ, admin dùng "Lưu và mở ngay" (A04 đã chuyển trạng thái tại chỗ) và việc đóng vẫn xảy ra khi đọc: API học viên coi `closes_at ≤ now` là đóng dù `status` còn `open`.
- Ước lượng: 1 phiên · 3.

#### G13-A09 — Trang admin "Khảo sát và nhận xét"

- Mục đích: FR-13-A01, A03, A06, A14, A16 trên giao diện.
- Đầu vào: tờ `AdminKhaoSat` (màn 1, 2, 4, 5, 6 và trạng thái phụ); `thiet-ke/CHUAN-ADMIN.md`; khung admin G09 (`ADMIN_FRAME_V2`, `frontend/components/admin/`); A04, A06.
- Việc làm:
  1. Dựng route theo 5.A.6.
  2. Thẻ Duyệt: khối "Lược bớt" bấm từng câu; "Bản sẽ đăng" đổi theo; ghim kèm số "2 / 3"; "Không đăng…" có danh sách lý do.
  3. Bật mục sidebar trong sổ đăng ký G09.
  4. Bản 1024px theo câu cuối màn 3 của tờ.
- Đầu ra: 1 PR (tách 2 nếu quá 800 dòng: Khảo sát + Kết quả / Duyệt + Nhập cũ).
- Nghiệm thu:
  - Bước bấm trên local với DB thử: tạo khảo sát cho lớp thử → "Chưa gửi" → "Lưu và mở ngay" hỏi lại → "Đang mở".
  - Trả lời bằng tài khoản thử → thẻ Duyệt có 2 mục → lược một câu → bản đăng có "[…]" → đăng → `/hoc-vien-noi-gi` có mục.
  - `npm --prefix frontend run test:react` qua; ảnh 1280 và 1024 đính PR.
- Không làm: không có ô gõ vào nguyên văn; không có nút tải file lên ở thẻ Nhập cũ; không thêm ngưỡng ngoài hai khoá 5.A.7.
- Vướng mắc → cách gỡ:
  - Sổ đăng ký sidebar của G09 chưa có trường `available` → theo G09 mục 5.2; G09-T08 chưa merge thì đặt trang nhưng không thêm mục sidebar, ghi trong PR.
  - Bảng kết quả rộng trên 1024px → cột "Điều có ích/muốn cải thiện" cắt hai dòng, mở rộng dòng để đọc đủ (tờ màn 4 "Xem cả 10 câu trả lời").
- Ước lượng: 3 phiên · 3.

#### G13-A10 — Trang công khai "Học viên nói gì" và hai khối

- Mục đích: FR-13-A07, A09, A10 trên trang công khai.
- Đầu vào: tờ `HocVienNoiGi` (mục 1–3), `TrangChuCongKhai` mục 4, `TrangKhoaHoc` khối "Học viên nói gì"; G05-T03, T05 (chỗ để sẵn), `PublicShell`, `PublicFooter`; A06.
- Việc làm:
  1. Dựng `/hoc-vien-noi-gi` với bộ lọc ghi `?khoa=`; danh sách sắp `cohort_ended_on DESC NULLS LAST, published_at DESC` (tờ: mới nhất trước theo ngày lớp kết thúc); khối "Điều học viên muốn cải thiện" rỗng thì ghi "Chưa có góp ý nào được đồng ý cho đăng", không ẩn tiêu đề (sửa 18/11 theo rà soát: tờ thắng về giao diện); "Xem thêm 20 nhận xét", khối số liệu, khối "Điều học viên muốn cải thiện" (trên điện thoại chèn sau 5 nhận xét đầu), trạng thái rỗng, đang tải, lỗi.
  2. `TestimonialStrip` cho `/` và `/courses/[slug]`.
  3. Mục chân trang.
  4. `generateMetadata`; nội dung dựng phía server; không gắn dữ liệu đánh giá sao (schema.org `Review`/`AggregateRating`).
- Đầu ra: 1 PR.
- Nghiệm thu:
  - `curl -s localhost:3000/hoc-vien-noi-gi | grep -c 'Đã rút gọn'` > 0 khi có mục lược.
  - Không có chuỗi "lớp offline": `curl -s localhost:3000/hoc-vien-noi-gi localhost:3000/ | grep -c 'lớp offline'` = 0.
  - Cờ tắt → `/hoc-vien-noi-gi` 404 và trang chủ không có khối.
  - Nút lọc của khoá chưa có nhận xét không có số.
  - Ảnh 1280 và 390 đính PR.
- Không làm: không thêm nhận xét mẫu gõ tay; không hiện band hay sao; không thêm trang vào sitemap khi cờ tắt.
- Vướng mắc → cách gỡ:
  - Trang chủ G05 cache tĩnh làm mục đã rút còn hiện → khối nhận xét gọi API với `revalidate` ≤ 60 giây, tách thành component server riêng.
  - Đường dẫn tiếng Việt `/hoc-vien-noi-gi` va với kiểm danh mục route (`frontend/tooling/route-ownership-check.mjs`) → đăng ký route vào manifest như route công khai khác; anh Andy chọn đường dẫn khác (mục 10 câu A1) thì chỉ đổi một hằng.
- Ước lượng: 2,5 phiên · 3.

#### G13-A11 — Màn học viên trả lời, thẻ Hôm nay, "Nhận xét của tôi"

- Mục đích: FR-13-A04, A08, A13 trên giao diện.
- Đầu vào: tờ `AdminKhaoSat` màn 3, `HomNayTrangThai` 7b, `TaiKhoan` (Nhận xét của tôi); G07 (`/home`, `/profile`, `GET /api/student/today`, danh mục trang); A05.
- Việc làm:
  1. Dựng `/surveys/[surveyId]`: một cột 640px, tự lưu nháp, "Để sau" về `/home`, câu 6 không chọn sẵn, phần tên chỉ hiện sau "Đồng ý" và có xem trước tên đúng cách tính, nút gửi dính đáy trên điện thoại, ba trạng thái đã gửi / đã đóng / thiếu câu.
  2. Thêm `open_surveys` vào `GET /api/student/today` bằng một lời gọi `services/surveys.py::open_surveys_for`. Gắn `SurveyTodayCard`.
  3. Gắn `MyTestimonials` ở `/profile`, có hộp xác nhận "Rút đồng ý đăng".
- Đầu ra: 1 PR.
- Nghiệm thu:
  - Bước bấm: tài khoản thử trong lớp thử có khảo sát mở → Hôm nay có thẻ → trả lời → thẻ ẩn → Hồ sơ có "Nhận xét của tôi" → rút → khối ẩn và mục biến khỏi `/hoc-vien-noi-gi`.
  - Tài khoản chỉ có khoá online không thấy thẻ.
  - `test:react` qua.
- Không làm: không sửa bố cục khác của Hôm nay và Hồ sơ.
- Vướng mắc → cách gỡ:
  - G07-T17/T26 chưa merge (Hồ sơ, Hôm nay mới) → làm trang `/surveys/[id]` trước; phần gắn vào Hôm nay và Hồ sơ để PR sau khi G07 merge, ghi trong báo cáo.
  - Hai bot cùng sửa route `student_home.py` hoặc file Today của G07 → theo 00 mục 7: bot G07 làm trước, gói này rebase.
- Ước lượng: 2 phiên · 3.

#### G13-A12 — Kết quả khảo sát dẫn về hồ sơ học viên

- Mục đích: FR-13-A15.
- Đầu vào: G09-T11a (trang `/admin/learners/[ref]`), G09 migration 442 `learner_care_notes`, `routers/admin_care_notes.py`; A04.
- Việc làm:
  1. Khi câu trả lời `submitted` có `intent ∈ {stop, undecided}` (lần đầu hoặc đổi sang), chèn một dòng `learner_care_notes` với `author_id = cohort_surveys.created_by` và body "Khảo sát sau khoá · <khoá>: dự định <Dừng|Chưa quyết>. Lý do: <nguyên văn hoặc 'không ghi'>". Ghi `source='survey'` nếu 442 có cột `source` (GOI-09 mục 5.3 đã đề nghị), không thì chỉ dùng tiền tố body. Chống trùng bằng khoá idempotent trong service (một dòng mỗi câu trả lời mỗi giá trị ý định).
  2. Thêm khối "Khảo sát sau khoá" vào thẻ Tổng quan của hồ sơ, gọi `GET /admin/learners/{ref}/surveys` (route mới trong `admin_surveys.py`).
  3. Nút "Mở hồ sơ" ở trang kết quả trỏ `/admin/learners/<ref>`.
- Đầu ra: 1 PR.
- Nghiệm thu: test: trả lời "Dừng" → một dòng ghi chú; gửi lại cùng ý định → không thêm dòng; đổi sang "Học tiếp" → không xoá dòng cũ. Bước bấm: hồ sơ hiện khối.
- Không làm: không tạo cảnh báo "Cần chú ý"; không đổi bảng ngưỡng.
- Vướng mắc → cách gỡ:
  - `learner_care_notes.author_id NOT NULL` và người tạo khảo sát đã bị xoá → dùng admin đang gọi job; job không có người gọi thì bỏ qua và ghi log, không bịa tác giả.
  - G09 muốn phân biệt ghi chú do hệ thống sinh → đề nghị cột `source` ở 442 (mục 7 dòng "Ghi chú tự sinh"); chưa có thì dùng tiền tố body.
- Ước lượng: 1 phiên · 3.

#### G13-A13 — Áp staging và nghiệm thu đầu-cuối phần A

- Mục đích: chứng minh mục 9 kịch bản A1–A5 trên staging.
- Đầu vào: A02–A12 đã merge; anh Andy áp 490 (và 491 nếu có) trên staging.
- Việc làm: chạy từng kịch bản bằng tài khoản thử và lớp thử QA. Chụp ảnh. Ghi bảng kết quả trong báo cáo.
- Đầu ra: báo cáo nghiệm thu (không phải file trong repo).
- Nghiệm thu: mọi kịch bản A1–A5 có bằng chứng; mục nào hỏng thì mở nhiệm vụ sửa có mã.
- Không làm: không bật `testimonials_public` trên production; không nhập nhận xét cũ trên production khi chưa có lệnh.
- Vướng mắc → cách gỡ:
  - Staging chưa có lớp thử → dùng `setup_phase_d_test_env.sh` như GOI-11 mục 9.
  - Thông báo trễ một chu kỳ 5 phút → chờ chu kỳ, không chạy job tay trên staging nếu chưa được phép.
- Ước lượng: 1 phiên · 2.

### Phần B — Grammar Wiki: biên tập nội dung và sơ đồ cho 137 bài

#### 6.B.0 Số liệu từ 10 tờ GrammarWikiNhomN (đọc trực tiếp; ước lượng của người vẽ, chưa đo)

| Nhóm (`_groups.yaml`) | Thư mục | Bài | Hình | Kiểu chính | Giờ soạn hình (tờ ghi) | Tờ minh hoạ bài |
|---|---|---|---|---|---|---|
| 1 `foundations` — Nền tảng | foundations | 18 | 36 | 10 `word-slot` (5 bài), 7, 2 | khoảng 9 (559 phút) | Nhom1-Bai1 `foundations/sentence-elements`, Bai2 `foundations/there-is-vs-it-is` |
| 2 `parts-of-speech` — Từ loại chi tiết | modifiers (7), parts-of-speech (9) | 16 | 31 | 6 `morphemes` (5), 1 (4), 2, 7, 8 | khoảng 7 (404 phút) | Bai1 `modifiers/adjective-vs-adverb`, Bai2 `modifiers/compound-adjectives` |
| 3 `sentence-structures` — Cấu trúc câu | sentence-structures | 9 | 28 | 4 `voice-shift` (5), 5, 1 | khoảng 10 (610 phút) | Bai1 `relative-clauses`, Bai2 `cleft-sentences`; `passive-voice` đã vẽ ở GrammarWikiBai |
| 4 `tenses` — Thì | tenses | 8 | 21 | 3 `timeline` (7) | khoảng 9–10 (570 phút) | Bai1 `past-perfect`, Bai2 `future-forms` |
| 5 `verb-patterns` — Mẫu động từ | verb-patterns | 9 | 22 (+ khoảng 12 nếu tách 5.4) | 1 (4), 3, 8, 4 | khoảng 7 (426 phút, chưa tính tách) | Bai1 `causative-verbs`, Bai2 `used-to-be-used-to-get-used-to` |
| 6 `grammar-for-meaning` | grammar-for-meaning | 12 | 29 | 8 `error-pair` (12), 1, 5 | khoảng 6–7 | Bai1 6.6 Because vs. Because of, Bai2 6.1 Comparison |
| 7 `ielts-grammar-lab` — Speaking Lab | ielts-grammar-lab | 23 | 53 | 8 (21), 3, 1 | khoảng 7–8, chưa tính 50–90 đoạn audio | Bai1 7.4, Bai2 7.23 |
| 8 `error-clinic` | error-clinic | 19 | 45 | 8 (13), 1, 7 | khoảng 8–10 | Bai1 8.6 Do vs. Make, Bai2 8.14 Missing Subjects |
| 9 `grammar-for-writing` — Writing Lab | grammar-for-writing | 9 | 21 | 8 (9), 5, 1 | khoảng 3–4, chưa tính hình biểu đồ cho hai bài Task 1 | Bai1 9.3, Bai2 9.4 |
| 10 `grammar-for-reading` | grammar-for-reading | 14 | 37 | 5 `clause-levels` (6), 1, 7 | khoảng 10–12 (tốn công nhất tính theo hình) | Bai1 10.6, Bai2 10.8 |
| **Tổng** | 11 thư mục | **137** | **323** | — | **76–84 giờ** biên tập khi đã có renderer (cộng cận dưới và cận trên của từng tờ; ước lượng, chưa đo) | — |

Danh sách đề nghị cho TỪNG bài (kiểu hình, số hình, câu ví dụ) nằm trong bảng của từng tờ GrammarWikiNhomN. Người thực thi đọc tờ của nhóm đang làm; gói không chép lại 137 dòng. Đánh số "N.M" trong tờ là thứ tự bài trong nhóm theo `_groups.yaml`.

Bài đang có `learning_blocks` (20, kiểm trong repo):
- grammar-for-meaning/conditionals
- error-clinic/{sentence-fragments, subject-verb-agreement, run-on-sentences}
- verb-patterns/{gerund-vs-infinitive, modal-verbs}
- sentence-structures/{compound-sentence, relative-clauses, complex-sentence, simple-sentence}
- foundations/{articles, countable-vs-uncountable}
- grammar-for-reading/{reduced-relative-clauses, complex-noun-phrases}
- tenses/{present-simple, past-simple, present-perfect, future-forms}
- grammar-for-writing/{grammar-in-task1, grammar-in-task2}

**Chỗ số liệu lệch với đầu bài, người thực thi đo lại bằng script B02:**
- Đầu bài ghi 43 bài lệch tên. Các tờ chỉ ghi được 32 bài (nhóm 2, 3, 4 không đếm).
- Đầu bài ghi 77–84 giờ. Cộng theo tờ ra 76–84 giờ.
- Đầu bài nhắc lỗi kiến thức "find out", nhưng không tờ nào ghi: CHƯA KIỂM, dùng `grep -rn "find out" backend/content --include='*.md'` rồi đưa vào lượt kiểm của người duyệt nhóm chứa bài đó.

#### G13-B01 — Spec GRAMMAREDIT-0096 (có phần sửa đổi GRAMMARFIG-0084)

- Mục đích: chốt 5.B.1–5.B.3 và luật của script kiểm (6.B.2).
- Đầu vào: 5.B; GOI-11 mục 5.7.4; `specs/0084-grammar-wiki-figures/` (nếu đã merge); tờ `GrammarWikiMinhHoa`, `GrammarWikiBai`, `GrammarWiki`, 10 tờ GrammarWikiNhomN và 20 tờ -Bai1/-Bai2.
- Việc làm:
  1. Tạo `specs/0096-grammar-wiki-editorial/` (`risk: medium`), có mục "Amends 0084" liệt kê trường tuỳ chọn và ba kiểu mới, mỗi kiểu một ví dụ YAML lấy từ tờ.
  2. Viết bảng luật kiểm.
  3. Viết quy tắc tách bài và chuyển hướng (6.B.3).
  4. Ghi câu hỏi mục 10 phần B.
  5. Mở PR spec và dừng.
- Đầu ra: 1 PR spec.
- Nghiệm thu: `validate_specs.py` thoát 0.
- Không làm: không sửa `specs/0084-*` của GOI-11 trong PR này; phần sửa đổi nằm trong 0096 và trỏ sang.
- Vướng mắc → cách gỡ:
  - 0084 chưa merge → viết sửa đổi dựa trên GOI-11 mục 5.7.4 và ghi "đối chiếu lại khi 0084 merge".
  - Repo không cho một spec sửa spec khác → theo `specs/README.md`; nếu cần thì tách phần sửa đổi thành PR sửa `specs/0084-*` sau khi chủ 0084 đồng ý.
- Ước lượng: 1 phiên · 2.

#### G13-B02 — Script kiểm nội dung chạy trong CI

- Mục đích: FR-13-B01.
- Đầu vào: `backend/scripts/validate_grammar_learning_blocks.py` (khuôn đọc frontmatter), `verify_anchor_drift.py`, `backend/tests/test_anchor_drift.py` (khuôn test gọi script), `backend/content/_groups.yaml`, 137 file bài.
- Việc làm:
  1. Viết `backend/scripts/lint_grammar_content.py` với các luật (mỗi luật một hàm, mỗi vi phạm `{rule, file, line, detail}`):
     - `GW001` `title` trong `_groups.yaml` khác `title` frontmatter (so sau khi chuẩn hoá khoảng trắng và dấu gạch "—"/"–"/"-");
     - `GW002` tên bài thiếu phần tiếng Việt (không có " — " hoặc phần sau rỗng) ở yaml hoặc frontmatter;
     - `GW003` mục `#{2,4} Lỗi \d+` không có dòng `❌` trước mục kế tiếp;
     - `GW004` bài quá dài: số ký tự thân bài > `max_chars` (mặc định 25 000) hoặc số H2 > `max_h2` (mặc định 18);
     - `GW005` H2 nằm sau H2 "Tóm tắt nhanh";
     - `GW006` H2 trùng tên trong cùng bài;
     - `GW010` cụm lời hứa band theo danh sách regex trong `backend/content/_lint_rules.yaml` (mặc định `đạt\s+band\s*\d`, `chắc chắn\s+(đạt|lên)\s+band`, `giúp bạn\s+(đạt|lên)\s+band`; câu có "không bảo đảm"/"không đảm bảo" trong cùng câu thì bỏ qua);
     - `GW011` nhắc `TOEIC` hoặc `THPT` trong thân bài hoặc `summary`;
     - `GW012` frontmatter `tested_in` có `toeic_*`/`thpt_qg` mà không có `ielts_*`;
     - `GW020` chuyển hướng lỗi (chuỗi, đích không tồn tại, nguồn trùng bài đang có);
     - `GW030` khối `figure` quá 4 mỗi bài, hoặc không qua `validate_learning_blocks`;
     - `GW031` kiểu 7 có câu dài hơn 16 từ.
     
     Ngưỡng nằm trong `_lint_rules.yaml`, không gõ cứng.
  2. Tạo file nền `backend/content/_lint_baseline.json` từ lần chạy đầu (`--write-baseline`).
  3. Viết test `backend/tests/test_grammar_content_lint.py`: vi phạm mới → đỏ; mục nền không còn vi phạm → đỏ, kèm thông báo "xoá khỏi baseline".
  4. Viết test đơn vị cho từng luật trên chuỗi Markdown tự viết.
- Đầu ra: 1 PR (`small`). Thân PR có bảng số vi phạm theo luật và theo nhóm: đây là con số thật thay cho 43/32 và 12 ở đầu bài.
- Nghiệm thu: `cd backend && python scripts/lint_grammar_content.py --format text | tail -5` in tổng theo luật; `python -m pytest tests/test_grammar_content_lint.py -q` qua; thêm tạm một bài vi phạm `GW010` → test đỏ (ghi lại trong PR, không commit).
- Không làm: không sửa nội dung bài trong PR này; không thêm job CI mới (test chạy trong `backend-shard` sẵn có — 00 mục 4.11); không kiểm chữ của mã nguồn (00 mục 4.9: luật chỉ đọc nội dung bài).
- Vướng mắc → cách gỡ:
  - `GW003` bắt nhầm mục "Lỗi N" dùng ký hiệu khác (ví dụ "Sai:") → chạy thử, liệt kê các dạng thật (`grep -rhn -A3 "^### Lỗi" backend/content | grep -v "❌" | head -50`), thêm các dạng đó vào `_lint_rules.yaml`; không nới luật để giảm số.
  - `GW010` bắt câu có "Band 7+" trong tên bài 7.3 → tên bài không thuộc luật (chỉ xét `summary` và thân bài); việc giữ hay bỏ tên chờ mục 10 câu B3.
  - File nền làm người sau "chấp nhận" lỗi mới bằng cách ghi thêm vào nền → test kiểm số mục nền chỉ được giảm so với `origin/staging`: so bằng một hằng `BASELINE_MAX` trong file nền, PR nào tăng phải ghi lý do.
- Ước lượng: 2 phiên · 3.

#### G13-B03 — Chuyển hướng URL bài cũ (feature)

- Mục đích: FR-13-B03; 5.B.1.
- Đầu vào: B01 đã duyệt; `frontend/proxy.ts` (dòng 47, 78, 171); `backend/routers/grammar.py`; `grammar_content.py`; `frontend/tooling/verify-grammar-404-ssr-flow.mjs`; `frontend/lib/public-sitemap-model.mjs`; `backend/routers/sitemap.py`.
- Việc làm:
  1. Tạo `_redirects.yaml` rỗng (`redirects: []`).
  2. Viết loader và `GET /api/grammar/redirects`.
  3. Sửa proxy: tra bảng trước khi rewrite 404.
  4. Sitemap bỏ `from`.
  5. Viết test backend (đọc, chặn chuỗi), test hành vi proxy theo khuôn test proxy sẵn có (CHƯA KIỂM tên: `ls frontend/tests | grep -i proxy`), một mục mẫu trong fixture test (không trong file thật).
- Đầu ra: 1 PR.
- Nghiệm thu: với một mục thử trong fixture, `curl -sI localhost:3000/grammar/<from>` trả `308` và `location` đúng; bài lạ vẫn 404 (`node frontend/tooling/verify-grammar-404-ssr-flow.mjs <url>` qua); `git diff --stat backend/content` chỉ có `_redirects.yaml`.
- Không làm: không đổi slug bài nào trong PR này.
- Vướng mắc → cách gỡ:
  - Proxy gọi thêm một request mỗi bài lạ → lấy bảng cùng lời gọi `/api/grammar/categories` (thêm trường `redirects` vào phản hồi đó) nếu đo thấy chậm; chọn một cách và ghi trong PR.
  - Anchor đích (`#…`) bị trình duyệt bỏ khi theo 308 nhiều bước → chỉ một bước (luật `GW020` cấm chuỗi).
- Ước lượng: 2 phiên · 4.

#### 6.B.3 Quy tắc tách bài ghép (áp khi anh Andy chọn "tách" ở mục 10 câu B2)

1. Bài gốc giữ slug và giữ các anchor đang được `feedback-anchor-mapping.yaml` trỏ tới. Lý do: phiếu chấm cũ đang dẫn về đúng chỗ đó.
2. Mỗi phần tách ra là một file mới trong cùng thư mục, slug tiếng Anh không dấu. Frontmatter đủ trường như bài cũ (`category` khớp thư mục), `prerequisites` trỏ bài gốc. Bài gốc thêm slug mới vào `related_pages`/`next_articles`.
3. Anchor của mục đã dời sang bài mới KHÔNG đi qua `_redirects.yaml`, vì bài gốc vẫn tồn tại và chuyển hướng theo URL sẽ chặn cả bài gốc. Thay vào đó, sửa `feedback-anchor-mapping.yaml` trỏ anchor ở bài mới. Ở bài gốc, giữ một đoạn ngắn có liên kết "Xem bài riêng: …" tại đúng anchor cũ. `verify_anchor_drift.py` phải qua.
4. `_redirects.yaml` chỉ dùng khi một bài biến mất hẳn (gộp hai bài thành một, hoặc đổi slug).
5. `_groups.yaml` thêm bài mới ngay sau bài gốc, cùng nhóm.
6. Mỗi bài tách là một PR content, có người duyệt, kèm ảnh trước/sau.

Bài thuộc diện này (theo tờ):

| Bài | Đề nghị của tờ |
|---|---|
| `verb-patterns/gerund-vs-infinitive` (74 nghìn byte, 75 H2) | 7 bài: bài chính + need + V-ing, try, stop, regret, forget, remember |
| `sentence-structures/complex-sentence` | Tách ba mục chèn sau, hoặc gộp vào `compound-sentence`/bài 3.4 |
| `grammar-for-meaning/conditionals` (6.3), 6.4 Discourse Markers, 6.5 Hedging Language | Tách hai bài, hoặc gộp các mục "Lỗi/Bài tập/Tóm tắt nhanh" lặp |
| `ielts-grammar-lab/grammar-for-band7plus` (7.3) | Tách Phần 1–8 và Phần 9–14, hoặc dùng mục lục hai cấp |

#### G13-B04 — Lượt biên tập nội dung theo nhóm (content; mỗi nhóm một PR: B04-N1 … B04-N10)

- Mục đích: sửa các vấn đề hai agent đã ghi, nhóm nào xong nhóm đó, có người duyệt.
- Đầu vào: báo cáo luật của B02 cho nhóm đó; tờ `GrammarWikiNhomN`, `-Bai1`, `-Bai2`; `AGENTS.md` mục "Grammar Wiki conventions"; quyết định mục 10 câu B1, B3, B4.
- Việc làm cho một nhóm:
  1. Tên bài: đưa `_groups.yaml` và frontmatter về một nguồn theo câu B1 (mặc định tạm: frontmatter là nguồn, yaml chép theo), thêm phần tiếng Việt cho bài thiếu.
  2. Mục "Lỗi N" không có câu sai: thêm dòng `❌` thật, hoặc đổi tên mục thành "Lưu ý N" nếu nội dung là cách dùng đúng (ví dụ 3.5 "Lỗi 5", 8.11).
  3. H2 sau "Tóm tắt nhanh": dời lên trước "Tự kiểm tra" (giữ anchor).
  4. Lỗi kiến thức: chỉ sửa sau khi người duyệt chuyên môn xác nhận. Danh sách cần người kiểm: 3.8 ví dụ "When-cleft" thực ra là it-cleft; 4.8 "It will rain" ghi sai hẳn trong khi Lỗi 1, 3 chỉ ghi "kém tự nhiên", và "Lỗi 2" ghi *I'm going to help you* là SAI; 4.7 câu sửa số 3 đổi chủ ngữ, câu số 4 không dùng được cho chấm tự động; 7.23 /əd/ ở mục lỗi và /ɪd/ ở bảng, phiên âm /ˈmeniː/ /ˈhæpiː/, "50" và "30" verb; 2.3 câu sửa số 3 kiểm a/an, dòng "Trong IELTS:" sót; 8.14 "ba kiểu" và bốn kiểu; 9.6 "chủ đề–vần" (có lẽ là đề–thuyết); 9.3 "hai phần tư điểm". Người thực thi đánh dấu trong PR từng chỗ "đã sửa theo người duyệt X" hoặc "để nguyên, người duyệt X giữ".
  5. Trùng nội dung: thay đoạn chép lại bằng một dòng "Xem thêm: <bài gốc>" khi đoạn trùng dài hơn 5 dòng (danh sách cặp trùng ở tờ nhóm).
  6. Lời hứa band, TOEIC/THPT: theo câu B3, B4 (mặc định tạm: bỏ câu hứa "đạt Band N" ở `summary` và thân bài; bỏ nhắc TOEIC/THPT trong thân bài; giữ `tested_in` nhưng giao diện không hiện; tên bài 7.3 giữ cho tới khi có trả lời).
  7. Chạy B02, xoá mục đã sửa khỏi file nền.
- Đầu ra: 10 PR content.
- Nghiệm thu mỗi PR:
  - `python scripts/lint_grammar_content.py --only-group <slug>` không còn mục ngoài file nền;
  - `python -m pytest tests/test_anchor_drift.py tests/test_grammar_content_lint.py tests/test_grammar_wiki_ref_drift.py tests/test_grammar_publication_contract.py -q` qua;
  - thân PR có tên người duyệt chuyên môn và danh sách chỗ sửa theo bài.
- Không làm:
  - không sửa nhóm khác trong cùng PR;
  - không đổi slug;
  - không tách bài (B05);
  - không thêm hình (B08);
  - không viết lại văn bài ngoài chỗ ghi ở tờ — lý do: nội dung đã có người soạn, sửa tràn làm người duyệt phải đọc lại cả bài.
- Vướng mắc → cách gỡ:
  - G06-T14 đang đổi giao diện bài và ghi "frontmatter không đổi trong gói này" → B04 đổi `title` frontmatter; chờ G06-T14 PR (a) merge rồi mới mở B04 (hai PR không đổi cùng file cùng lúc).
  - Sửa `title` làm vỡ test ghim tiêu đề (ví dụ `test_grammar_article_index_contract.py`) → test đó kiểm hành vi thì cập nhật dữ liệu mong đợi trong cùng PR, liệt kê; quá 30 assert vỡ → dừng (00 mục 7).
  - Người duyệt chưa có → PR vẫn mở với phần cơ học (tên, H2, Lỗi N có câu sai rõ); phần lỗi kiến thức để nhãn "chờ người duyệt" trong thân PR, không sửa.
- Ước lượng: 10 phiên (khoảng 1 phiên mỗi nhóm; nhóm 7 và 8 có thể 1,5) · 2. Chưa tính giờ người duyệt.

#### G13-B05 — Tách hoặc gập bài ghép (content + chuyển hướng nếu cần; tối đa 6 PR)

- Mục đích: xử lý 6 bài ở 6.B.3 theo câu B2.
- Đầu vào: câu trả lời B2; B03 (nếu có bài biến mất); B07 (mục lục hai cấp, nếu chọn "gập"); `feedback-anchor-mapping.yaml`.
- Việc làm:
  - Chọn "tách": theo 6.B.3, mỗi bài gốc một PR.
  - Chọn "gập": thêm `toc_levels: 2` vào frontmatter, gộp các mục "Lỗi/Bài tập/Tóm tắt nhanh" lặp thành một bộ, không tạo file mới.
- Đầu ra: tối đa 6 PR content.
- Nghiệm thu: `verify_anchor_drift.py` thoát 0; `curl -o /dev/null -w '%{http_code}' localhost:3000/grammar/verb-patterns/gerund-vs-infinitive` = 200; bài mới có trong sitemap; `GW004` của bài gốc hết.
- Không làm: không bắt đầu trước khi có trả lời B2. Mặc định tạm: chưa tách bài nào; làm B07 (mục lục hai cấp) để bài dài dễ đọc trong lúc chờ.
- Vướng mắc → cách gỡ:
  - Bài con mới cần hình (Nhom5: "thêm khoảng 12 hình") → tính vào B08 nhóm 5, không làm trong B05.
  - Quiz hoặc bài tập gắn `grammar_slug` của bài gốc (`exam_questions.grammar_slug`, ngân hàng quiz) → giữ slug gốc nên không vỡ; kiểm `grep -rn "gerund-vs-infinitive" backend --include=*.py --include=*.json --include=*.jsonl | head`.
- Ước lượng: khoảng 5 phiên · 3.

#### G13-B06 — Renderer cho các mở rộng của khối `figure` (feature, sau G11-T33)

- Mục đích: 5.B.2; FR-13-B04.
- Đầu vào: B01 đã duyệt; G11-T33 đã merge (`backend/services/grammar_learning_blocks.py` có `ALLOWED_FIGURES`); tờ `GrammarWikiMinhHoa` và các tờ nhóm có mở rộng; CSS `grammar-figures.css` của G11.
- Việc làm:
  1. Thêm trường tuỳ chọn vào `_validate_<kiểu>`/`_render_<kiểu>` có sẵn.
  2. Thêm `quick-choice`, `intensity-scale`, `annotated-paragraph` vào `ALLOWED_FIGURES` cùng hàm validate và render.
  3. `quick-choice` không đánh số và không tính giới hạn.
  4. Thêm lớp CSS vào danh sách cho phép.
  5. Viết test mỗi mở rộng: khối đúng → HTML có nhãn chữ cho chỗ thiếu, `role="img"`, `lang="en"`; chuỗi có `<script>` bị escape; khối của G11-T34 không đổi HTML (so trước/sau trên 5 bài thí điểm).
- Đầu ra: 1 PR.
- Nghiệm thu: `python -m pytest tests/test_grammar_learning_blocks.py tests/test_grammar_content_render_fixes.py tests/test_anchor_drift.py -q` qua; một bài thử local có đủ 3 kiểu mới, ảnh 1280 và 390 đính PR.
- Không làm: không viết lại 10 hàm cơ bản; không đổi cách đánh số; không thêm thư viện Markdown.
- Vướng mắc → cách gỡ:
  - G11-T33 chưa merge → nhiệm vụ chờ; không viết renderer song song vào cùng file (00 mục 7).
  - Vị trí ký tự của `annotated-paragraph` lệch khi chuỗi có dấu nháy cong hay ký tự tổ hợp → validator so `text_en[start:end]` với `quote` tuỳ chọn trong mỗi `note`; lệch thì bỏ khối và cảnh báo.
- Ước lượng: 2 phiên · 4.

#### G13-B07 — Sáu khối khuôn bài (feature; 2 PR: B07a backend, B07b frontend)

- Mục đích: 5.B.3; FR-13-B05.
- Đầu vào: B01; G06-T14 PR (a) đã merge (trang bài mới, `page-shell.tsx`); tờ GrammarWikiBai và các tờ nhóm ghi ở 5.B.3; hợp đồng audio với repo VIDEO MAKING (G06-T12 đã có khuôn hợp đồng cho Speaking — dùng cùng cách giao tệp).
- Việc làm:
  - B07a: (1) Kiểu khối `model-answer`, `passage-question` trong `grammar_learning_blocks.py`. (2) `toc` dạng cây khi `toc_levels: 2`. (3) `summary_table_html`. (4) `sections_present`. (5) Đọc `backend/content/_audio_manifest.yaml`. (6) Model `GrammarArticleDocument` thêm trường; sinh lại `api.d.ts`. (7) Test.
  - B07b: dựng các khối trong `page-shell.tsx` (nút nghe 44px, một audio một lúc, nhãn "Giọng đọc tổng hợp"; mục lục hai cấp có gập lỗi; ẩn mục trống; bảng tóm tắt cuộn ngang, cột đầu dính; "Xem đáp án"). Viết `test:react`.
- Đầu ra: 2 PR.
- Nghiệm thu: bài thử có `model-answer` có `audio_key` → nút và nhãn hiện; không có → không có hàng nút; bài không có Tự kiểm tra → không có tiêu đề rỗng; `curl` bài 7.3 có `toc` hai cấp.
- Không làm: không sản xuất audio; không thêm audio vào bucket; không đổi giao diện ngoài sáu khối.
- Vướng mắc → cách gỡ:
  - Chưa có tệp audio nào từ VIDEO MAKING → manifest rỗng, nút ẩn. Nhiệm vụ vẫn xong; phần nghe được nghiệm thu khi có tệp.
  - Chuyển 21 bài nhóm 7 sang `model-answer` là việc content → làm trong B04-N7 hoặc B08-N7, không trong B07.
- Ước lượng: 4 phiên (2 + 2) · 4.

#### G13-B08 — Soạn hình theo nhóm (content; mỗi nhóm một PR: B08-N1 … B08-N10)

- Mục đích: đưa 323 hình (cộng khoảng 12 nếu tách 5.4) vào bài, theo bảng đề nghị từng bài trong tờ GrammarWikiNhomN.
- Thứ tự đề nghị (lý do một câu; không có số liệu lượt xem theo bài — nếu anh Andy có số lượt xem thì xếp lại theo đó):
  1. **Nhóm 4 Thì** — mỗi bài một hình chính kiểu 3, chỉ 21 hình, và G11-T34 đã thử kiểu `timeline` trên một bài thì, nên rủi ro thấp nhất để chốt nhịp làm.
  2. **Nhóm 8 Error Clinic** — là đích của liên kết từ phiếu chấm (`feedback-anchor-mapping.yaml`), tức trang học viên đang trả tiền được dẫn tới nhiều nhất.
  3. **Nhóm 1 Nền tảng** — nền của Khoá Ngữ pháp nền tảng, các nhóm sau trỏ về.
  4. **Nhóm 10 Grammar for Reading** — cùng kiểu hình (5, 1, 9) với Đọc kỹ phần D nên câu và hình dùng lại được.
  5. **Nhóm 3 Cấu trúc câu** — kiểu 4, 5 tốn 20–25 phút mỗi hình, làm khi đã quen renderer.
  6. **Nhóm 2 Từ loại chi tiết**.
  7. **Nhóm 5 Mẫu động từ** — sau quyết định tách 5.4 (B2).
  8. **Nhóm 6 Grammar for Meaning** — sau quyết định tách 6.3–6.5 và cần nhãn kiểu 8 đổi được (B06).
  9. **Nhóm 9 Writing Lab** — cần `annotated-paragraph` (B06) và hình biểu đồ Task 1.
  10. **Nhóm 7 Speaking Lab** — 53 hình, cộng 50–90 đoạn audio và câu hỏi về lời hứa band chưa có trả lời.
- Đầu vào: B06 (cho nhóm cần mở rộng), G11-T33 (cho mọi nhóm), tờ nhóm đang làm, B04 của nhóm đó đã merge (để không sửa cùng file song song).
- Việc làm cho một nhóm:
  1. Mỗi bài thêm khối `figure` theo đúng kiểu và số hình tờ đề nghị (tối đa 4), câu ví dụ lấy từ bài.
  2. Thêm "(Hình N)" vào văn bài tại chỗ dẫn.
  3. Với 20 bài có `learning_blocks` cũ: theo câu B5 (mặc định tạm: giữ khối cũ, không chuyển `sentence-xray`/`flow` sang `figure`; khối cũ cộng hình mới không quá 4 hình kiểu `figure`).
  4. Bấm giờ thật mỗi hình và ghi vào thân PR.
- Đầu ra: 10 PR content.
- Nghiệm thu: `lint_grammar_content.py` không có `GW030`, `GW031` mới; test Grammar qua; ảnh mỗi bài ở 1280 và 390 đính PR; tổng phút đo được ghi trong PR (dùng để chỉnh ước lượng các nhóm sau).
- Không làm: không vẽ tay hay chèn ảnh; không vẽ cho bảng collocation (tờ Nhom8); không sửa văn bài ngoài câu dẫn "(Hình N)"; không thêm hình cho 5 bài G11-T34 đã có.
- Vướng mắc → cách gỡ:
  - Một hình trong tờ không biểu diễn được bằng lược đồ đã duyệt → ghi vào PR, bỏ hình đó, không tự mở rộng lược đồ (mở rộng phải qua B01/B06).
  - Bấm giờ thực tế vượt quá 1,5 lần ước lượng của tờ ở nhóm đầu tiên → dừng sau nhóm đó, báo anh Andy con số đo được kèm hai phương án (giảm số hình mỗi bài xuống 1–2, hoặc giữ nguyên và kéo dài lịch). Không tự cắt hình.
- Ước lượng: khoảng 12 phiên agent (10 PR) · 2. Giờ biên tập theo tờ: 76–84 giờ khi đã có renderer; ước lượng của người vẽ, chưa đo.

### Phần C — Kiến thức nền theo chủ đề (prototype Work; đợt: sau G06 và G04)

#### G13-C01 — Spec TOPICKNOW-0097

- Mục đích: chốt 5.C.
- Đầu vào: tờ `KienThucNen` (mục 1, 2, 5a, 6); GOI-04 FR-04-051 và mục 5.6; G06 mục 5.1, 5.7, FR-06-005b, câu 14.
- Việc làm: tạo `specs/0097-background-knowledge/` (`risk: high` vì có AI trả phí và trừ lượt). Lược đồ YAML 5.C.1 kèm ví dụ một khía cạnh lấy từ tờ. Viết prompt AI dạng nháp và hình dạng JSON trả về. Ghi câu mục 10 phần C. Mở PR spec và dừng.
- Đầu ra: 1 PR spec.
- Nghiệm thu: `validate_specs.py` thoát 0.
- Không làm: không viết mã.
- Vướng mắc → cách gỡ:
  - Repo đòi lớp `high-risk` cho cả spec vì có một nhiệm vụ AI → để `risk: high` cho cả spec; không hạ cấp (00 mục 4.7).
  - Đường dẫn `/library/background` chưa được G06 chốt (câu 14 của G06) → dùng mặc định của G06 (kệ thứ sáu, dưới `/library/`); đổi sau chỉ là một hằng.
- Ước lượng: 1 phiên · 2.

#### G13-C02 — Định dạng file, validator và bản nháp chủ đề Work (content)

- Mục đích: 5.C.1; có file Work đúng định dạng để mọi nhiệm vụ sau dùng.
- Đầu vào: tờ `KienThucNen` (nội dung Work đã viết ở mục 1: 5 khía cạnh, 20 ý, 40 collocation, 5 bẫy, 3 câu tự kiểm, 5 đề Writing, 4 câu Speaking); `backend/content_vocab/work-career/` (12 mục từ); manifest bài mẫu của G06.
- Việc làm:
  1. Tạo `backend/content/background/work-career.yaml` từ nội dung tờ, `status: draft`, hai trường người duyệt để trống.
  2. Viết `backend/scripts/validate_background_topics.py` cùng test trên file Work và trên ba file hỏng tự viết.
  3. `vocab_ref` chỉ điền khi file từ có thật.
  4. `writing_links` chỉ điền slug có trong manifest G06; chưa có manifest thì để trống và ghi trong PR.
- Đầu ra: 1 PR content.
- Nghiệm thu: `python backend/scripts/validate_background_topics.py` thoát 0 với Work; ba file hỏng cho đúng ba lỗi.
- Không làm: không đặt `published`; không bịa số liệu (quy tắc soạn của tờ: "dữ kiện phổ thông, không số liệu"); không gắn nhãn band.
- Vướng mắc → cách gỡ:
  - 5 đề Writing của tờ dùng tiêu đề tiếng Anh đề xuất, kho chưa có trường tiêu đề → nối bằng `sample_slug` sau khi G06-T05 đặt tiêu đề; trước đó để danh sách đề trong một trường `pending_prompts` (nguyên văn đề), validator chỉ cảnh báo.
  - 4 câu Speaking Part 3 của tờ là minh hoạ → giữ trong file với `speaking_slug` trống, trang chỉ hiện chữ, không liên kết.
- Ước lượng: 2 phiên · 3.

#### G13-C03 — Migration 492 và script nhập (high-risk)

- Mục đích: 5.C.2.
- Đầu vào: C01 đã duyệt, C02; `services/import_batch_log.py`; mẫu migration RLS.
- Việc làm: viết `492_background_topics.sql`, rollback, `forward-policy.tsv`, test PG17 (CHECK người duyệt chặn `published` thiếu tên); `backend/scripts/import_background_topics.py` cùng test (chạy hai lần không đổi gì; đổi nội dung thì `content_hash` đổi và `updated_at` đổi).
- Đầu ra: 1 PR.
- Nghiệm thu: `pytest tests/test_migration_492_background_topics.py tests/test_import_background_topics.py -q` qua; `python -m scripts.import_background_topics --dry-run` in một dòng cho Work.
- Không làm: không áp staging.
- Vướng mắc → cách gỡ:
  - `import_batch_log` chưa có → in cảnh báo, chạy tiếp (theo G09-T36).
  - File có `status: published` nhưng thiếu tên duyệt → script dừng trước khi ghi, mã thoát khác 0. Lý do: ràng buộc nằm cả ở DB, lỗi sớm dễ hiểu hơn lỗi SQL.
- Ước lượng: 2 phiên · 4.

#### G13-C04 — API công khai Kiến thức nền

- Mục đích: 5.C.4 ba route GET.
- Đầu vào: C03; G06 mục 5.7 (`cacheable_json`, exempt).
- Việc làm: viết `backend/routers/library_background.py` (phần GET); tra slug bài mẫu hiện hành qua bảng của G06; viết test (chủ đề `draft` → 404; `for-sample` của đề không nối → `topic: null`); sinh lại `api.d.ts`.
- Đầu ra: 1 PR.
- Nghiệm thu: test qua; inventory exempt qua.
- Không làm: không route nộp bài (C07).
- Vướng mắc → cách gỡ:
  - Bảng `writing_samples` chưa có trên DB thử → route trả `writing: []` và ghi cảnh báo; test dùng bảng giả trong fixture DB.
  - `vocab_links` trỏ route từ vựng chưa ổn định (G06-T15 đang đổi `/vocabulary`) → dựng href bằng hàm của G06 nếu đã có, không tự ghép chuỗi đường dẫn.
- Ước lượng: 1,5 phiên · 3.

#### G13-C05 — Trang mục lục, trang chủ đề và sơ đồ cây

- Mục đích: FR-13-C01, C02; 5.C.5.
- Đầu vào: tờ `KienThucNen` mục 1, mục 3–4 (biến thể), mục 6; G06-T07 (khuôn bài đọc), G06-T08 (`/library`, mảng kệ); C04.
- Việc làm: dựng hai route; viết `TopicTree`, `AspectPanel`, `IdeaList`, `TrapBox`, `SelfCheck`; thêm kệ vào mảng cấu hình `/library`; thêm sitemap; `generateMetadata`; viết `test:react` (đổi nhánh bằng bàn phím; `?k=3` mở đúng khía cạnh; chủ đề không tồn tại → 404).
- Đầu ra: 1 PR.
- Nghiệm thu: `curl -s localhost:3000/library/background/work-career | grep -c 'blur the boundary'` ≥ 1 (nội dung nằm trong HTML); ảnh 1280 và 390, sáng và tối, bản in.
- Không làm: không khung nộp (C08); không đếm "đã mở mấy khía cạnh" cho khách.
- Vướng mắc → cách gỡ:
  - Sơ đồ 3–6 nhánh vỡ ở 390px → theo quy tắc điện thoại của tờ (danh sách mở/đóng thay hình nếu tờ ghi); nếu tờ không vẽ thì dùng khung trang đã có và ghi "chưa có tờ cho bản này" trong PR (00 mục 6).
  - Đường nét đứt "a/b" (quan hệ khía cạnh) chồng nhau khi có hơn 2 quan hệ → giới hạn hiển thị 2 quan hệ, validator cảnh báo khi file có hơn 2.
- Ước lượng: 3 phiên · 3.

#### G13-C06 — Liên kết ngược ở trang đề Writing

- Mục đích: FR-13-C03.
- Đầu vào: G06-T10 (trang `/library/writing-samples/[slug]`); tờ `KienThucNen` mục 2; C04.
- Việc làm: thêm `BackgroundLinkLine` (gọi `for-sample`) vào trang một đề, không hiện khi `topic: null`; gắn `BackgroundLinkLine` dưới đề ở trang làm bài Writing tự luyện (không ở bài được giao có giờ, thi thử); thêm lối "Kiến thức nền theo chủ đề" và dòng "Kiến thức nền của chủ đề này" ở khối "Theo chủ đề" của `/vocabulary` (sau G06-T15) (sửa 18/11 theo rà soát: tờ thắng về giao diện); viết test.
- Đầu ra: 1 PR.
- Nghiệm thu: đề có nối → dòng "Kiến thức nền cho đề này · Work · khía cạnh 2, 3 và 5"; đề không nối → không có dòng.
- Không làm: không đổi phần còn lại của trang bài mẫu.
- Vướng mắc → cách gỡ:
  - G06-T10 dùng `'use cache'` dài → dòng liên kết đọc cùng lời gọi, chịu cùng thời gian cache. Chấp nhận được vì bảng nối chỉ đổi khi nhập lại.
  - Hai bot sửa cùng file trang G06 → G06-T10 merge trước, gói này rebase.
- Ước lượng: 1 phiên · 2.

#### G13-C07 — Migration 493 và đường nộp đoạn viết ngắn cho AI (high-risk)

- Mục đích: FR-13-C04, C05; 5.C.3, 5.C.4 (route POST/GET bài nộp).
- Đầu vào: C01 đã duyệt; G04-T03 (`services/credits.py`, `acharge_plan`, `reserve`, `CreditRefused`, `CreditUnavailable`), G04 382 (CHECK `short_writing`); `backend/services/advanced_vocab_rewrite_grader.py`; `services/ai_usage_logger.py`; `services/ai_router.py`.
- Việc làm:
  1. Viết `493_background_short_writings.sql`, rollback, test PG17.
  2. Viết `backend/services/short_writing_feedback.py` (prompt, gọi AI, kiểm trích dẫn, đếm ý và collocation, commit/release).
  3. Viết route POST/GET.
  4. Cấu hình `SHORT_WRITING_DAILY_LIMIT`, `SHORT_WRITING_MODEL` (đọc qua bảng mô hình hiện có nếu repo có — CHƯA KIỂM: `grep -n "def get_model\|AI_MODEL" backend/services/ai_router.py | head`).
  5. Viết test với AI giả (không gọi AI thật — 00 mục 4.10):
     - nộp thành công → commit một lần;
     - AI lỗi → release, `failed`;
     - trích dẫn không khớp → mục bị bỏ;
     - replay `request_key` → không trừ thêm;
     - hết lượt → 402;
     - 10 lần nộp đồng thời khi còn 1 lượt → đúng 1 được nhận;
     - số đếm collocation đúng trên đoạn mẫu của tờ (0 collocation của khía cạnh 2).
- Đầu ra: 1 PR.
- Nghiệm thu: `pytest tests/test_short_writing_feedback.py tests/test_migration_493_*.py -q` qua; `tests/test_suite_makes_no_live_calls.py` qua; mọi lời gọi AI đi qua `ai_usage_logger` (test kiểm hàm ghi được gọi).
- Không làm: không chấm band; không gửi tên/email vào prompt; không gộp vào chấm thử miễn phí; không dùng cho bài Writing đầy đủ.
- Vướng mắc → cách gỡ:
  - `charge_plan` trả `metered=false` cho người dùng mã cũ chưa đo → theo G04 (nhánh 5) vẫn cho nộp, không trừ lượt; ghi trong PR rằng hành vi theo G04.
  - Sản phẩm của người học không có `writing` trong `features` → 403 `no_entitlement`; giao diện hiện màn 5a của tờ.
  - AI trả JSON hỏng → thử lại một lần với cùng `request_key` phía AI; vẫn hỏng thì `failed` và hoàn lượt.
- Ước lượng: 3 phiên · 4.

#### G13-C08 — Khung nộp và nhận xét trên trang chủ đề

- Mục đích: FR-13-C04 trên giao diện.
- Đầu vào: tờ `KienThucNen` khối "Viết một đoạn 80–100 từ" và các biến thể "Xem thử"; C05, C07; nhãn lượt của G04 (`credit_source`, số dư `GET /api/me/credits`).
- Việc làm: viết `ShortWritingBox` và `ShortWritingFeedback`; poll `GET …/short-writings/{id}` mỗi 2 giây tối đa 60 giây rồi chuyển sang nút "Tải lại"; viết `test:react` cho bốn trạng thái.
- Đầu ra: 1 PR.
- Nghiệm thu: khách: ô viết dùng được, nháp còn sau khi tải lại trang, nút "Đăng nhập để nộp"; đã đăng nhập có lượt: nộp → nhận xét hiện, số lượt giảm 1; hết lượt: màn 5a.
- Không làm: không hiện band; không hiện số lượt khi API không trả (không hiện "0/0").
- Vướng mắc → cách gỡ:
  - `localStorage` bị chặn → bọc try/catch, ô viết vẫn dùng được không lưu nháp.
  - Lối "Chấm thử một bài miễn phí" chỉ hiện khi hôm nay còn bài chấm thử → đọc trạng thái từ API của GOI-11 phần B (`GET /api/trial/...`); chưa có API thì ẩn lối đó.
- Ước lượng: 1,5 phiên · 3.

#### G13-C09 — Quy trình soạn và duyệt; xuất bản Work, rồi 8–10 chủ đề (content; mỗi chủ đề một PR)

- Mục đích: FR-13-C06; có nội dung thật.
- Quy trình một chủ đề (ghi vào `backend/content/background/README.md`):
  1. Người thực thi soạn bản nháp từ kho 549 đề (đề nào thuộc chủ đề) và bộ từ của chủ đề, theo quy tắc soạn của tờ (không số liệu, câu tiếng Anh ≤ 30 từ, mỗi ý đi được vào ít nhất một đề).
  2. `status: review`, mở PR content.
  3. Giáo viên IELTS duyệt câu tiếng Anh, nhãn mức câu, bẫy; ghi `reviewed_by_teacher`.
  4. Chủ dự án hoặc người phụ trách nội dung duyệt dữ kiện, giọng văn; ghi `reviewed_by_owner`, `reviewed_on`.
  5. `status: published`, chạy script nhập trên staging (người có quyền chạy).
  6. Ghi số phút soạn và số phút duyệt thật vào thân PR. Tờ ước lượng 2–3 giờ giáo viên mỗi chủ đề, chưa đo.
- Thứ tự: Work (`work-career`) trước, đo giờ, báo anh Andy, rồi mới tới các chủ đề sau theo câu C1.
- Đầu ra: 1 PR cho Work, sau đó tối đa 9 PR.
- Nghiệm thu mỗi PR: validator thoát 0; thân PR có hai tên người duyệt và hai số phút; trang staging hiện chủ đề.
- Không làm: không xuất bản khi thiếu tên người duyệt; không chép bài văn mẫu vào trang (tờ: "không đưa bài văn để học thuộc").
- Vướng mắc → cách gỡ:
  - Từ vựng chỉ có 7 chủ đề mà mục tiêu là 8–10 → chờ câu C1; trong lúc chờ làm các chủ đề trùng 7 chủ đề sẵn có.
  - Một chủ đề có ít hơn 3 đề Writing trong kho → không mở chủ đề đó (luật "mỗi ý đi được vào một đề"), báo lại.
- Ước lượng: Work 1 phiên; mỗi chủ đề sau khoảng 1 phiên agent · 2. Chưa tính giờ người duyệt.

### Phần D — Đọc kỹ (prototype; song song A, B, C — mục 1)

#### G13-D01 — Spec CLOSEREAD-0098

- Mục đích: chốt 5.D và điều kiện dừng.
- Đầu vào: tờ `DocKy` (mục 1–6); `specs/0021-reading-practice-support/`; `reading_practice_support.py`; dàn bài `~/Documents/Co-work/Course 1/15_DE-CUONG-V2/` (chỉ đọc: `381-bai-v2.jsonl`, `theo-mo-dun/M01.md…M20.md`).
- Việc làm: tạo `specs/0098-close-reading/` (`risk: high` vì có migration 494 và lưu lần làm — 00 mục 4.7). Lược đồ YAML 5.D.1, API 5.D.3. Điều kiện dừng: sau 20 câu thí điểm mới quyết quy mô. Ghi câu mục 10 phần D. Mở PR và dừng.
- Đầu ra: 1 PR spec.
- Nghiệm thu: `validate_specs.py` thoát 0.
- Không làm: không đưa AI nhận xét bản dịch vào spec (để sau).
- Vướng mắc → cách gỡ:
  - 0021 còn `implementing` và có thể đổi `PracticeUnit` → spec trỏ tên model và hàm, không chép trường; đổi thì sửa theo 0021.
  - Dàn bài nằm ngoài repo → spec ghi rõ chỉ chép `id, title, module_id, module_title` vào `_lessons.json`, nguồn và ngày chép.
- Ước lượng: 1 phiên · 2.

#### G13-D02 — Thí điểm 20 câu và bấm giờ soạn (content) — ĐIỀU KIỆN DỪNG

- Mục đích: đo công soạn thật trước khi quyết quy mô.
- Đầu vào: tờ `DocKy` (6 câu mô đun 9 đã soạn: câu 1, 3, 5 lấy từ dàn bài, câu 2, 4, 6 soạn mới); `theo-mo-dun/M09.md` và hai mô đun khác do người duyệt chọn; bài Reading có `practice_support` (`backend/content/reading-practice/`).
- Việc làm:
  1. Tạo `backend/content/close_read/_lessons.json` và `M09.yaml` (6 câu của tờ), cùng 14 câu nữa ở hai mô đun khác, trong đó ít nhất 4 câu gắn `reading_link` với đơn vị Reading thật đã qua kiểm băm.
  2. Viết `backend/scripts/validate_close_read.py` (vị trí không chồng, phủ kín câu, `lesson_code` có trong `_lessons.json`, băm khớp).
  3. Ghi `authoring_minutes` mỗi câu.
- Đầu ra: 1 PR content, thân PR có bảng phút theo câu và tổng.
- Nghiệm thu: validator thoát 0; 20 câu có `authoring_minutes`; người duyệt thứ hai ghi tên và phút duyệt.
- **Điều kiện dừng:** sau PR này người thực thi DỪNG soạn câu mới và báo anh Andy: tổng phút soạn, tổng phút duyệt, phút trung bình mỗi câu theo độ dài, và ngoại suy cho 20 mô đun × 6 câu. Tờ ước lượng 60–70 giờ soạn và 20 giờ duyệt, chưa đo. Câu thứ 21 trở đi chỉ được soạn khi anh trả lời câu D3. D03–D06 (máy móc và màn) vẫn làm được với 20 câu này.
- Không làm: không hiện mã bài ra file giao diện; không chép `key`, `example`, `practice` của dàn bài vào repo.
- Vướng mắc → cách gỡ:
  - Không đủ 4 đơn vị Reading mức `sentence` có chữ khó → lấy câu từ đơn vị có sẵn, ghi số thật; không sửa bài Reading để có câu (sẽ làm lệch băm của 0021).
  - Vị trí ký tự sai do người soạn đếm tay → validator in đoạn chữ ứng với mỗi `[start, end]` để người soạn so; thêm chế độ `--print-spans`.
- Ước lượng: 2 phiên · 3 (chưa tính giờ người soạn và người duyệt, đó là thứ đang đo).

#### G13-D03 — Migration 494 và script nhập (high-risk)

- Mục đích: 5.D.2.
- Đầu vào: D01 đã duyệt, D02.
- Việc làm: viết `494_close_read.sql` (trigger khoá `translation_vi`), rollback, test PG17; `backend/scripts/import_close_read.py` cùng test.
- Đầu ra: 1 PR.
- Nghiệm thu: test qua; UPDATE `translation_vi` bị từ chối; nhập hai lần không đổi.
- Không làm: không áp staging.
- Vướng mắc → cách gỡ:
  - Câu đã có lần làm mà nội dung câu đổi → giữ `id`, đổi `content_hash`; lần làm cũ giữ nguyên, tổng kết chỉ tính lần làm sau `updated_at` của câu.
  - Câu bị gỡ khỏi file → script đặt `status='draft'`, không xoá (lần làm cũ vẫn trỏ tới).
- Ước lượng: 2 phiên · 3.

#### G13-D04 — API Đọc kỹ

- Mục đích: 5.D.3; FR-13-D01–D04.
- Đầu vào: D03; `reading_practice_support.py`; `activation_gate.py`.
- Việc làm: viết `backend/routers/close_read.py` và test:
  - `GET items/{id}` không có `model_natural_vi`;
  - `POST attempts` mới trả bản mẫu;
  - regex `B\d{3}` không xuất hiện trong mọi JSON trả về;
  - đơn vị Reading lệch băm → `for-reading` không trả đơn vị đó;
  - `check-segment` sai → `correct=false` kèm `message_vi`, không trả đáp án.
- Đầu ra: 1 PR.
- Nghiệm thu: test qua; `api.d.ts` sinh lại.
- Không làm: không gọi AI.
- Vướng mắc → cách gỡ:
  - Quyền truy cập chưa chốt (D1) → một hàm `can_use_close_read(user)` duy nhất, mặc định tạm "tài khoản đã kích hoạt"; đổi quyết định chỉ sửa hàm này.
  - Bước 1 kiểm ở máy chủ gây trễ mỗi lần bấm → chấp nhận (một request nhỏ); nếu đo thấy trên 300 ms ở staging thì báo, không chuyển đáp án xuống trình duyệt khi chưa hỏi.
- Ước lượng: 2 phiên · 3.

#### G13-D05 — Màn Đọc kỹ bốn bước và tổng kết

- Mục đích: tờ `DocKy` mục 2–5.
- Đầu vào: D04; khung học viên G07 (`LearnerShell`, danh mục trang); thành phần sơ đồ của G11-T33 nếu dùng lại được cho "Sơ đồ khung câu".
- Việc làm: dựng ba route 5.D.4; bước mở dần; "Hiện đáp án"; khoá bản dịch sau đối chiếu; "So chữ" trong trình duyệt; tổng kết không điểm; điện thoại 390px; lỗi lưu giữ bản dịch trên màn ("Chưa lưu được, thử lại"); viết `test:react`.
- Đầu ra: 1 PR.
- Nghiệm thu: bước bấm trên local: câu 4 mô đun 9 đi đủ bốn bước; tab Network không có `model_natural_vi` trước khi bấm "Đối chiếu"; tổng kết đúng câu tự đánh dấu "bỏ sót".
- Không làm: không có điểm, phần trăm, huy hiệu.
- Vướng mắc → cách gỡ:
  - Bấm chọn mảnh bằng bàn phím trên câu dài → mỗi mảnh là một nút có `aria-pressed`, Tab theo thứ tự trong câu.
  - Người học tải lại trang giữa bước 3 → bản dịch nháp lưu `localStorage` (try/catch), bước đã mở đọc lại từ lần làm trên máy chủ nếu có.
- Ước lượng: 3 phiên · 3.

#### G13-D06 — Hai lối vào: trang mô đun và bài Reading

- Mục đích: tờ `DocKy` mục 1 (A, B); FR-13-D04.
- Đầu vào: D04, D05; `frontend/app/(authed-reading)/reading/practice-reading-text.tsx`, `reading-detail.tsx`; trang mô đun của G07 (nếu có, câu D2).
- Việc làm:
  1. Lối B: trong `practice-reading-text.tsx`, câu có trong `for-reading` có vạch đôi ở lề và nút "Đọc kỹ câu này"; ẩn ở chế độ thi (kiểm bằng prop chế độ hiện có — CHƯA KIỂM tên prop: `grep -n "mode\|exam" "frontend/app/(authed-reading)/reading/practice-reading-text.tsx" | head`).
  2. Lối A: `CloseReadModuleBlock`; gắn vào trang mô đun của G07 nếu đã có, không thì chỉ có trang `/practice/close-reading`.
- Đầu ra: 1 PR.
- Nghiệm thu: bài Reading có đơn vị gắn → nút hiện, bấm mở đúng câu; full test Reading → không có nút (kiểm bằng `test:react`).
- Không làm: không đổi hành vi dịch câu của 0021.
- Vướng mắc → cách gỡ:
  - `reading-practice-support.test.tsx` ghim cấu trúc DOM → thêm nút ngoài vùng chữ của câu (lề), chạy test đó trước và sau.
  - Trang mô đun G07 chưa có → để lối A ở `/practice/close-reading`; ghi trong PR "chưa gắn trang mô đun".
- Ước lượng: 1,5 phiên · 3.

#### G13-D07 — Mở rộng quy mô (chưa lên lịch)

Chỉ làm khi anh Andy trả lời câu D3 sau khi xem số đo của D02. Mỗi mô đun một PR content theo cùng quy trình D02. Không ước lượng ở đây.

### Phần E — Khuôn luyện đề tái dùng (HOÃN; không mở PR)

Các nhiệm vụ dưới đây chỉ để người sau biết thứ tự. **Không làm cho tới khi anh Andy mở** (FR-13-E01).

| Mã | Nội dung | Việc phải xong trước |
|---|---|---|
| G13-E01 | Spec EXAMKIT-0099 theo 5.E và tờ `KhuonLuyenDe` | Anh Andy mở khu |
| G13-E02 | Migration 495 (`exam_programs`, `exam_passages`, `exam_tag_lesson_map`), 496 (cột mới ở `exam_tests`, `exam_questions`) | E01 duyệt |
| G13-E03 | Parser 73 đề tự soạn (`DE-01..DE-073`, chuẩn hoá tên `DE-001…`) dựa trên `qa/validate_de.py` của thư mục THPT, ghi lô | Người thật duyệt đáp án; quyết định bản quyền; gỡ dòng "Adapted from…" |
| G13-E04 | Năm màn A–E | E02; bảng ánh xạ đã được chuyên môn chốt |
| G13-E05 | Gán nhãn chủ đề ngữ pháp cho từng câu, kiểm tay | Chốt dàn bài dùng cho ánh xạ (381 bài) |

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Gói phụ thuộc chưa merge (G04-T03, G06-T08/T10/T14, G09-T08/T24/T36, G11-T08/T10/T33) | `git log origin/staging -- <file>` trống; import lỗi | Làm nhiệm vụ độc lập kế tiếp trong gói (00 mục 7); ở PR ghi rõ nhiệm vụ chờ ai | Không dừng; chỉ hỏi khi mọi nhiệm vụ còn lại đều chờ |
| Hai bot sửa cùng file (`grammar_learning_blocks.py`, `page-shell.tsx`, `notification_sweep.py`, trang Hôm nay, trang bài mẫu) | Xung đột rebase | Bot có nhiệm vụ đứng trước trong bảng phụ thuộc làm trước; bot sau rebase | — |
| Sửa nội dung Grammar làm vỡ anchor phiếu chấm | `test_anchor_drift.py` đỏ | Sửa `feedback-anchor-mapping.yaml` trong cùng PR hoặc giữ anchor tại chỗ cũ (6.B.3) | Mapping trỏ anchor của bài thuộc nhóm khác: hỏi chủ nhóm đó |
| Test ghim chuỗi Grammar vỡ do đổi tên bài | Nhiều test `test_grammar_*` đỏ | Sửa dữ liệu mong đợi trong cùng PR, liệt kê từng test | Quá 30 assert vỡ ngoài dự kiến (00 mục 7) |
| Dữ liệu cá nhân trong nhận xét | Tên thật, email trong fixture, ảnh chụp | Dùng dữ liệu tự viết; ảnh chụp dùng tài khoản thử | Cần dữ liệu thật để kiểm script nhập: chỉ chạy trên staging bằng lệnh anh Andy cho |
| Số migration hoặc spec bị dùng | `ls backend/migrations \| grep ^49`; `ls specs \| grep 009[5-9]` có kết quả lạ | Dừng, báo người điều phối | Luôn hỏi; không tự nhảy số |
| Tờ thiết kế lệch quy định 00 | Ví dụ một tờ còn ghi nhận xét là "của học viên lớp offline" (01 mục 6, dòng l) | 00 thắng (điểm 23: không ghi là của lớp offline); ghi khác biệt trong PR | — |
| Chi phí AI đoạn viết ngắn vượt dự kiến | `ai_usage_logs` theo `feature='short_writing_feedback'` tăng nhanh | Giảm `SHORT_WRITING_DAILY_LIMIT` | Khi cần đổi mô hình hay số lượt: hỏi anh Andy |
| Người duyệt nội dung chưa có | PR content mở lâu không có tên duyệt | Làm phần cơ học, đánh dấu phần cần duyệt | Sau 2 PR content cùng chờ duyệt: báo danh sách chỗ chờ |
| Ghi chú tự sinh vào `learner_care_notes` (A12) | G09 muốn tách ghi chú hệ thống | Dùng cột `source` nếu 442 đã có (GOI-09 đã đề nghị), không thì tiền tố body | Chỉ hỏi khi 442 đã merge mà không có cột `source` |

## 8. Ràng buộc riêng của gói

1. Nguyên văn nhận xét không bị sửa ở bất kỳ tầng nào (DB trigger, API, giao diện). Lý do: lời hứa trên trang công khai là "không chỉnh sửa câu chữ", sai một chỗ là mất toàn bộ giá trị chứng cứ.
2. Không đăng nhận xét khi chưa có đồng ý, kể cả nhận xét cũ có dòng ghi "không". Rút đồng ý thì gỡ ngay, không qua admin.
3. Trang công khai không có chữ "lớp offline", không band, không sao, không phần trăm hài lòng (00 điểm 23; tờ HocVienNoiGi).
4. Không có trình tạo form tự do. Lý do: khảo sát `huong-phat-trien.md` mục 4 câu 9 đã loại, và tờ chốt mẫu cố định.
5. Bài Grammar: mỗi PR một nhóm, không đổi anchor mà không sửa mapping, không đổi slug mà không có chuyển hướng.
6. Gói này không viết renderer mười kiểu cơ bản (GOI-11) và không đổi giao diện trang Grammar ngoài sáu khối (G06).
7. Kiến thức nền: phần đọc luôn công khai. Chỉ nộp đoạn viết mới cần đăng nhập và lượt. Không chấm band cho đoạn ngắn.
8. Đọc kỹ: không gọi AI; không hiện mã bài; bản dịch mẫu không gửi trước khi học viên gửi bản dịch đầu.
9. Không làm gì của phần E.
10. Không chép nội dung dàn bài ngoài ba trường đã nêu; không chép file nhận xét cũ vào repo.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

Môi trường: local (PG17, DB thử), sau đó staging với lớp thử QA và tài khoản thử (`setup_phase_d_test_env.sh` như GOI-11 mục 9). Không kiểm, không nhập, không bật cờ trên production.

**Phần A**
- A1. Given lớp thử Course 1 có 3 học viên có tài khoản. When admin tạo khảo sát và "Lưu và mở ngay". Then cả 3 nhận thông báo `survey_open` ngay khi mở (mở theo ngày thì sau một chu kỳ job), Hôm nay có thẻ.
- A2. Given học viên 1 trả lời đủ, đồng ý, chọn `initial`. When gửi. Then thẻ Duyệt có 2 mục; admin lược một câu và đăng. Then `/hoc-vien-noi-gi?khoa=C1` hiện "<Tên đệm Tên> <H>.", có "[…]" và "Đã rút gọn, không sửa chữ"; trang chủ hiện mục khi ghim hoặc khi là mục mới nhất.
- A3. Given học viên 1 vào Hồ sơ. When "Rút đồng ý đăng". Then trong 60 giây trang chủ, trang khoá, `/hoc-vien-noi-gi` không còn mục; admin không đăng lại được.
- A4. Given 2 người trả lời, ngưỡng 5. Then khối số liệu ghi số người, không phần trăm; admin thấy mức 1–5 nhưng không có trung bình.
- A5. Given CSV giả 10 dòng (2 dòng "không"). When chạy script hai lần. Then 8 mục `pending`, một bản ghi lô `import` và một `dry_run` nếu có chạy thử; không trùng.

**Phần B**
- B1. `python backend/scripts/lint_grammar_content.py --format json` chạy xong, có số theo luật. Test lint qua trên `staging`.
- B2. Given mục chuyển hướng thử. Then 308 đúng đích; bài lạ 404.
- B3. Mỗi nhóm đã biên tập không còn vi phạm ngoài file nền; `test_anchor_drift.py` qua.
- B4. Bài có `model-answer` không audio → không có hàng nút; có audio giọng tổng hợp → nhãn "Giọng đọc tổng hợp".

**Phần C**
- C1. Khách mở `/library/background/work-career` → đọc đủ, sơ đồ đổi theo nhánh, ô viết lưu nháp, không nộp được.
- C2. Học viên có 3 lượt nộp đoạn 86 từ → nhận xét tối đa 3 mục có trích dẫn đúng chữ, còn 2 lượt; AI giả lỗi → lượt vẫn 3.
- C3. Trang đề "Working from home" có dòng "Kiến thức nền cho đề này".

**Phần D**
- D1. Câu 4 mô đun 9 đi đủ bốn bước; bản mẫu chỉ có sau "Đối chiếu"; tổng kết liệt kê dấu hiệu tự đánh dấu.
- D2. Bài Reading có câu gắn → nút "Đọc kỹ câu này"; sửa bài đọc trên DB thử làm lệch băm → nút ẩn.
- D3. Báo cáo số đo 20 câu đã gửi anh Andy (điều kiện dừng).

**Bằng chứng hoàn tất:** mỗi nhiệm vụ có PR, CI xanh ở đúng SHA đầu nhánh, báo cáo theo 00 mục 8, và phân biệt rõ trạng thái: đã có ở nhánh, đã merge vào `staging`, đã áp staging, đã lên production, đã được nghiệm thu.

## 10. Cần anh Andy quyết

| # | Câu hỏi | Đề nghị | Mặc định tạm bot dùng |
|---|---|---|---|
| A1 | Đường dẫn trang công khai: `/hoc-vien-noi-gi` (theo tờ) hay một đường dẫn tiếng Anh như các trang khác (`/courses`, `/library`)? | Giữ `/hoc-vien-noi-gi` vì tờ đã ghi và người đọc là người Việt | `/hoc-vien-noi-gi`, đặt trong một hằng |
| A2 | Có cho học viên gửi ảnh kèm nhận xét không (tờ có vẽ; cần bucket, kiểm ảnh, đồng ý đăng ảnh riêng)? | Chưa làm ở đợt này | Tắt (`TESTIMONIAL_PHOTOS_ENABLED=false`); có cột `photo_path` để làm sau |
| A3 | Lớp dưới bao nhiêu người thì nhận xét ẩn danh bỏ cả tháng/năm lớp (tờ ghi XXX)? | 10 | 10 |
| A4 | Ngưỡng số người trả lời tối thiểu để hiện phần trăm: tờ ghi 5 | 5 | 5 (khoá `survey_min_respondents`) |
| A5 | Nhận xét cũ: dòng có ghi tên hiển thị khác ba cách (ví dụ biệt danh) xử lý thế nào? | Hạ về `initial` | `initial` |
| A6 | Khoá online có khảo sát sau khoá không, hay chỉ lớp offline (tờ chỉ vẽ lớp offline)? | Chỉ lớp offline ở đợt này | Chỉ lớp offline |
| A7 | Có dùng trường "Aver Learning trả lời" cho góp ý ở trang công khai không? | Có, không bắt buộc | API có; trang chỉ hiện khi có nội dung |
| A8 | Đổi tên hiển thị ở Hồ sơ có cần duyệt lại không (tờ TaiKhoan ghi "giả định không")? | Không cần duyệt lại | Áp ngay |
| B1 | Nguồn tên bài: `_groups.yaml` hay frontmatter `title`? | Frontmatter là nguồn, yaml chép theo (backend đã đọc frontmatter cho trang bài; yaml chỉ là danh mục). Lưu ý: ba tờ GrammarWikiNhom1, Nhom7, Nhom8 đang lấy tên theo `_groups.yaml` ("cần chốt một nguồn cho H1") | Frontmatter (mặc định tạm 18/11, chờ anh Andy xác nhận); câu hỏi ở `04` mục "Rà soát trước bàn giao 18/11" |
| B2 | Bài ghép: tách thành bài riêng hay giữ một bài và gập bằng mục lục hai cấp? Áp cho 5.4 (7 bài), 3.3, 6.3, 6.4, 6.5, 7.3 | Tách 5.4 và 7.3 (rõ là nhiều bài dán vào nhau); gập 3.3, 6.3, 6.4, 6.5 | Chưa tách bài nào; làm mục lục hai cấp (B07) trong lúc chờ |
| B3 | Giữ hay bỏ lời hứa "đạt Band 7+" trong tóm tắt (nhóm 7), và tên bài "Grammar cho Band 7+"? | Bỏ câu hứa; đổi tên bài thành tên theo nội dung | Bỏ câu hứa ở `summary` và thân bài; giữ tên bài tới khi có trả lời |
| B4 | Nhắc TOEIC/THPT trong 12 file và `tested_in: toeic_rc, thpt_qg`: bỏ hay giữ? | Bỏ câu nhắc trong thân bài; giữ `tested_in` trong dữ liệu nhưng không hiện (THPT đang hoãn) | Như đề nghị |
| B5 | Số phận `learning_blocks` cũ (20 bài, `sentence-xray`, `flow`, `decision-tree`, `timeline`…): chuyển sang khối `figure` hay giữ hai hệ? | Giữ khối cũ ở đợt này; chuyển dần khi soạn hình nhóm đó và có người duyệt | Giữ nguyên |
| B6 | Audio câu mẫu nhóm Speaking Lab (50–90 đoạn, giọng Kokoro của repo VIDEO MAKING): đặt hàng khi nào, có ưu tiên trước nhóm khác không? | Đặt sau khi B07 merge, làm cùng B08 nhóm 7 (cuối danh sách) | Không có audio; nút ẩn |
| B7 | Thứ tự soạn hình theo nhóm (B08: 4 → 8 → 1 → 10 → 3 → 2 → 5 → 6 → 9 → 7) có hợp không, hay anh có số lượt xem theo bài để xếp lại? | Như B08 | Như B08 |
| C1 | Từ vựng chỉ có 7 chủ đề; mục tiêu 8–10 chủ đề Kiến thức nền: thêm chủ đề mới vào Từ vựng, hay Kiến thức nền có chủ đề không trùng Từ vựng (ví dụ Crime, Media)? | Bắt đầu với 7 chủ đề trùng; chủ đề thứ 8–10 thêm cả ở Từ vựng | Chỉ làm chủ đề trùng 7 chủ đề sẵn có |
| C2 | Ai là giáo viên IELTS duyệt câu tiếng Anh và người duyệt thứ hai cho mỗi chủ đề? | — | Chủ đề ở trạng thái `review` tới khi có tên |
| C3 | Giới hạn số đoạn viết ngắn mỗi người mỗi ngày (ngoài lượt)? | 5 | `SHORT_WRITING_DAILY_LIMIT=5` |
| C4 | Đếm "ý và collocation của chủ đề" cho cả bài Writing đầy đủ của các đề liên quan (tờ đề nghị) không? Việc này chạm luồng chấm Writing | Để sau, chỉ đếm ở đoạn viết ngắn | Chỉ đoạn viết ngắn |
| C5 | Nhãn mức câu "câu đơn giản / câu phát triển hơn" thay cho số band (tờ ghi "đề xuất, chờ duyệt") | Dùng hai nhãn | Hai nhãn |
| D1 | Ai được dùng Đọc kỹ: mọi tài khoản đã kích hoạt, hay chỉ người có Khoá Ngữ pháp nền tảng / lớp Course 1? | Tài khoản đã kích hoạt (00 điểm 20: kích hoạt mở luôn phần ngữ pháp) | Tài khoản đã kích hoạt |
| D2 | Lối vào A "cuối trang mô đun" cần trang mô đun trong Lộ trình. Khoá Ngữ pháp nền tảng có dùng 20 mô đun của dàn 381 bài làm khung Lộ trình không? | — | Trang riêng `/practice/close-reading`; component sẵn để gắn khi có trang mô đun |
| D3 | Sau 20 câu thí điểm: làm đủ 20 mô đun × 6 câu, giảm số câu, hay dừng? | Quyết sau khi có số đo | Dừng ở 20 câu |
| D4 | Giáo viên lớp offline có xem được bảng tổng kết Đọc kỹ của học viên không (tờ ghi "Giáo viên của lớp thấy cùng bảng này")? | Có, chỉ đọc, qua `staff_scope` | Chưa làm giao diện giáo viên |
| E1 | Khu luyện đề THPT: khi nào mở, miễn phí hay thuộc khoá, có dùng đề chính thức không? | Giữ hoãn | Không làm |

**Chỗ chưa kiểm được trong mã** (người thực thi kiểm khi làm, lệnh ở chỗ ghi `CHƯA KIỂM`): nguồn "số buổi có nộp bài"; bảng nhật ký thao tác admin; tổng số buổi dự kiến của lớp; tên prop chế độ thi ở trang Reading; thư viện đọc xlsx; cấu hình mô hình AI; vị trí lỗi "find out".
