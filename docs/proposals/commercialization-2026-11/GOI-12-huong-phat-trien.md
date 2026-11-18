# GÓI 12 — Sáu hướng phát triển sau mở bán: sổ lỗi, viết lại sau khi chấm, độ lệch AI–giáo viên, kiểm tra đầu vào, nhắc việc theo tuần, gói giáo viên chấm

Lập ngày 18/11/2026. Người đọc: người thực thi (project Claude Code của repo averlearning.com), không biết lịch sử dự án. Đọc `00-QUY-UOC-CHUNG.md` trước; mục 2 của file đó thắng file này, và trong mục 2 điểm sau thắng điểm trước. Mã thật thắng mô tả ở đây: thấy khác thì làm theo mã và ghi chỗ khác vào PR.

**Không bắt đầu phần nào của gói này khi anh Andy chưa mở phần đó.** Ngoại lệ duy nhất là ba nhiệm vụ lưu cặp điểm AI–giáo viên (G12-C01…C03), làm trong đợt D cùng G09-T17: **anh Andy đã duyệt tối 18/11/2026 (00 mục 2 điểm 24)**. Lý do: năm phần còn lại là tính năng mới, đo được tác dụng chỉ khi đã có người dùng thật; làm trước khi có người dùng là tiêu công vào thứ chưa ai dùng. Riêng D (kiểm tra đầu vào, cho người chưa trả tiền) được đề nghị ở chặng trước mở bán (mục 1.5), vẫn chờ anh mở.

## 1. Tóm tắt

### 1.1 Mục tiêu

Sáu tính năng, mỗi tính năng một spec, một cờ (tắt mặc định), một chuỗi PR riêng. Gỡ một tính năng không kéo theo tính năng khác, trừ chỗ ghi rõ ở 1.3.

| Phần | Tên | Người dùng thấy gì khi xong |
|---|---|---|
| A | Sổ lỗi cá nhân (bản ngữ pháp) | Học viên có bài tập ngữ pháp theo buổi thấy "3 lỗi cần ôn hôm nay" trên Hôm nay; mỗi nhóm ngữ pháp sai từ 2 câu thành một mục, quay lại sau 2, 7, 21 ngày dưới dạng 4 câu; đúng cả ba mốc thì "Đã vững". Giáo viên thấy sổ lỗi của lớp gom theo nhóm. Đây là nguồn của khối "Lỗi đang lặp lại" mà G07 đang để ẩn. |
| B | Viết lại sau khi chấm | Sau phiếu Writing, học viên viết lại đúng một đoạn bị nhận xét; kết quả cho thấy từng nhận xét đã xử lý hay còn, có lỗi mới không, kèm câu trích; đề thuộc kho 549 đề thì đặt đoạn đó cạnh đoạn cùng loại của bài 6.0 / 7.0 / 7.5. Không chấm lại band. |
| C | Độ lệch điểm AI với giáo viên | Trước hết: mỗi bài Writing giáo viên trả có một bản ghi bất biến gồm điểm AI gốc và điểm giáo viên chốt. Sau đó: admin xem độ lệch theo tiêu chí; khi đủ điều kiện, một trang công khai "Chúng tôi chấm bài thế nào" và một dòng trên phiếu. |
| D | Kiểm tra đầu vào ngắn | Người mới có tài khoản miễn phí làm bài 15–20 phút (ngữ pháp, đọc, nghe, tuỳ chọn viết hoặc nói), nhận "vững nhóm nào, hổng nhóm nào" và một khoá nên bắt đầu, không có band. |
| E | Nhắc việc theo kế hoạch và thư tổng kết tuần | Hôm nay có thẻ "Kế hoạch tuần này" tính ngược từ ngày thi; khi chậm thì đề nghị giảm tải hoặc lùi mốc; mỗi tuần đúng một thư tổng kết, tắt bằng một lần bấm. |
| F | Gói giáo viên chấm, số chỗ giới hạn | Học viên khoá online đăng ký thêm lượt "giáo viên chấm": AI chấm trước, giáo viên duyệt, ký và trả trong hạn ghi rõ; hết chỗ trong tuần thì ngừng nhận. |

### 1.2 Lớp thay đổi, mã spec, cờ

Số spec lấy từ khối **0088–0094**, số migration từ dải **480–489**, cả hai do anh Andy cấp cho gói này ngày 18/11/2026 (GOI-13 dùng spec 0095–0099 và migration 490–499; gói này không dùng số ngoài hai khối của mình). `01-KE-HOACH-TONG.md` mục 6 đã ghi hai khối này (bản tối 18/11); người thực thi không sửa file đó (chỗ còn phải sửa ở 01: mục 3.4, dòng K1).

| Phần | Mã spec | Thư mục spec | Lớp | Cờ (`runtime_flags`, tắt mặc định) |
|---|---|---|---|---|
| C, nhiệm vụ đầu | SCOREPAIR-0088 | `specs/0088-writing-score-pairs/` | high-risk (lưu kết quả chấm, migration) | `writing_score_pairs_record` |
| A | ERRORBOOK-0089 | `specs/0089-error-book/` | high-risk (migration, dữ liệu bài làm) | `error_book_enabled` |
| B | REWRITE-0090 | `specs/0090-writing-rewrite/` | high-risk (lời gọi AI trả phí mới, trừ lượt) | `writing_rewrite_enabled` |
| C, phần sau | SCOREGAP-0091 | `specs/0091-score-gap/` | high-risk (migration; trang công khai nói về chấm bài) | `score_gap_admin`, `score_gap_public` |
| D | PLACEMENT-0092 | `specs/0092-placement-test/` | high-risk (migration, chấm phía máy chủ, phần 4 gọi AI) | `placement_test_enabled` |
| E | WEEKLYPLAN-0093 | `specs/0093-weekly-plan/` | high-risk (migration, gửi thư) | `weekly_plan_enabled`, `weekly_digest_emails` |
| F | REVIEWPACK-0094 | `specs/0094-review-pack/` | high-risk (sổ lượt, đơn đăng ký, chấm bài) | `review_pack_enabled` |

### 1.3 Phụ thuộc

- Mọi phần trừ C01–C03: G03 (khung, component), G01-T06 (sổ số migration), G09-T22 (bảng `admin_settings`, `admin_settings_log`, `ops_thresholds`, migration 440). C01–C03 không có giao diện và không đọc ngưỡng nên không cần G03, G09-T22; chỉ cần G01-T06 để ghi số 480 vào sổ.
- A: G07-T13/T14 (khối "Lỗi đang lặp lại" và hàm ghép `_repeat_error_for`), G09-T27 (file nhãn `backend/content/course-labels/truc_nhom_vi.json`), G06-T14 (trang bài Grammar Wiki có neo mục chữa lỗi), G11-T33 (sơ đồ câu chữ). Không cần AI.
- B: G07-T20 (phiếu Writing mới), G04-T08 (lượt Writing), G06 (bảng `writing_samples`), G08-T25 (route Writing tự luyện ghi được đề gốc). G12-C03 không bắt buộc.
- C phần đầu (C01–C03): chỉ cần mã hiện có; nên làm cùng đợt với G09-T17 vì cùng chạm luồng trả bài. C phần sau (C04–C07): cần C03 đã chạy và có số cặp đủ (mục 1.5).
- D: G05 (đăng nhập, Danh mục khoá, trang khoá), G07-T26 (Hôm nay cho tài khoản chưa có khoá), GOI-11 phần B (chấm thử, chỉ cho D05), spec 0003 MASTER30 đã có release nội dung.
- E: G07-T13/T14, G07-T18 (`course_lessons`), GOI-11 phần A (thông báo, `notification_email_prefs`), G04-T04 (`services/learner_email.py`, `learner_email_outbox`). A không bắt buộc (không có A thì tuần không có "lượt ôn lỗi").
- F: G04 (sản phẩm, đơn, sổ lượt), G09-T17 (hàng chờ Writing mới), C03 (bản ghi cặp điểm), GOI-11 phần A (thông báo).
- Song song được: A với B; D với E; C phần sau với F (cùng sửa `writing_score_pairs`: C trước, F rebase).

### 1.4 Từng phần: phép thử "không performative", chỉ số, điều kiện DỪNG

Phép thử lấy từ `khao-sat/huong-phat-trien.md` mục 2: một tính năng bị hoãn nếu trả lời "không" cho từ hai câu trở lên (việc cụ thể · đo được · một người nuôi nổi · thật ở quy mô nhỏ · nằm trên đường chính). "Công mỗi tuần" là công của anh Andy, người vận hành duy nhất; số là ước lượng của người viết.

| Phần | Việc cụ thể người học (giáo viên) làm đúng thêm | Con số đo từ dữ liệu web | Công mỗi tuần của anh Andy (ước lượng) | Chỉ số phải ghi từ ngày đầu | DỪNG / không mở rộng khi |
|---|---|---|---|---|---|
| A | Bớt sai lại cùng nhóm ngữ pháp đã bị chỉ ra; giáo viên chọn đúng nhóm để chữa lại trên lớp | Tỉ lệ sai lại cùng nhóm ở lần gặp sau so với lần đầu, so người dùng sổ với người không dùng | Gần 0 sau khi duyệt một lần bảng tên nhóm và ánh xạ nhóm → bài Grammar Wiki (khoảng 2–3 giờ một lần cho mỗi khoá) | (a) tỉ lệ sai lại cùng nhóm; (b) tỉ lệ mục được ôn đúng hạn; tỉ lệ bấm "Để mai"; số mục đến hạn mỗi ngày so với trần; tỉ lệ mục đã vững bị mở lại | Sau 8 tuần bật, (a) của người dùng sổ không thấp hơn người không dùng → không mở sang Writing, xem lại bộ chọn câu; tỉ lệ "Để mai" trên 60% trong 4 tuần → hạ trần hoặc gỡ khối ở Hôm nay |
| B | Sửa đúng đoạn bị nhận xét thay vì chỉ đọc phiếu | Tỉ lệ bài đã chấm có ít nhất một bản viết lại; số nhận xét "đã xử lý" trên tổng nhận xét của đoạn | Gần 0 (không soạn mới); lớp offline: đọc dòng "đã viết lại" khi muốn | Tỉ lệ bài có bản viết lại; tỉ lệ "đã xử lý"; tỉ lệ lỗi mới; tỉ lệ mở "Bài của tôi đứng đâu"; tỉ lệ mở bài mẫu trước khi viết; chi phí AI mỗi bản viết lại; điểm cùng tiêu chí ở bài kế tiếp (đề khác) của người có viết lại so với người không | Sau 8 tuần tỉ lệ bài có bản viết lại dưới 10% → không mở rộng, xem lại cách tính lượt; chi phí AI của bản viết lại miễn lượt vượt trần cấu hình `REWRITE_FREE_MONTHLY_USD` → chuyển sang phương án B (mỗi lần 1 lượt) |
| C | Giáo viên sửa hướng dẫn chấm theo tiêu chí AI lệch nhiều nhất; người lạ có con số thật để tin | Lệch trung bình \|AI − giáo viên\| theo tiêu chí, theo tháng, theo phiên bản chấm | Phần đầu: 0 (tự ghi khi trả bài). Phần sau: 15–30 phút mỗi tháng xem bài lệch từ 1.0 band, viết phần chữ "Điều AI chấm kém" | Số cặp mỗi tuần; tỉ lệ bài giữ nguyên cả bốn điểm AI; số phút duyệt mỗi bài (khi F có đồng hồ); số yêu cầu chấm lại trên 100 phiếu | Không công bố khi chưa đủ ngưỡng (mặc định 50 bài, lệch trung bình ≤ 0.5); tỉ lệ "bằng nhau cả bốn tiêu chí" trên 80% → số đang bị neo theo AI, không công bố, xét mẫu chấm mù |
| D | Người mới chọn đúng khoá bắt đầu, ít đăng ký nhầm | Tỉ lệ ngừng học trong 2 tuần đầu của người theo gợi ý so với người không theo và người không làm bài | Soạn 2–3 bộ đề một lần; sau đó 0 | Tỉ lệ làm xong ba phần chính; tỉ lệ đăng ký đúng khoá gợi ý; tỉ lệ ngừng học 2 tuần đầu theo ba nhóm; số yêu cầu hoàn học phí lý do "đăng ký nhầm khoá"; nơi bỏ dở | Sau 8 tuần tỉ lệ làm xong dưới 40% → rút bài ngắn lại trước khi làm gì thêm; người theo gợi ý ngừng học không ít hơn người không làm bài → gỡ lối vào ở Danh mục khoá |
| E | Người đi làm biết tuần này phải làm gì và làm kịp | Tỉ lệ còn hoạt động ở tuần 4 và tuần 8 kể từ ngày mở khoá, so với nhóm mở khoá trước khi bật | Gần 0; chỉ khi tác vụ gửi thư lỗi (cảnh báo về Hộp thư sự cố) | Còn hoạt động tuần 4, tuần 8; bám kế hoạch theo tuần; tỉ lệ nộp đúng hạn của lớp offline; tỉ lệ tắt thư; tỉ lệ có làm việc trong 7 ngày sau thư 16; tỉ lệ mở thư (chỉ tham khảo) | Tỉ lệ tắt thư trên 30% sau 4 tuần → ngừng gửi thư 16, xem lại thư 15; hai tháng liền tỉ lệ còn hoạt động tuần 4 không hơn nhóm trước khi bật → không mở rộng (không thêm kênh nhắc) |
| F | Học viên online nhận nhận xét của chính giáo viên dạy khoá và sửa theo ba việc giáo viên chọn | Tỉ lệ trả đúng hạn; số phút duyệt mỗi bài; tỉ lệ đăng ký lại gói | Đây là phần tốn công nhất: trần mỗi tuần × số phút mỗi bài (ví dụ 8 bài × 20 phút ≈ 2 giờ 40 phút mỗi tuần, số phút thật chưa đo) | Số phút duyệt mỗi bài (trung vị, bài lâu nhất), tổng giờ mỗi tuần; tỉ lệ trả đúng hạn; số tuần phải ngừng nhận sớm; tỉ lệ đăng ký lại; tỉ lệ viết lại sau phiếu; số cặp điểm mỗi tuần | Tỉ lệ trả đúng hạn dưới mức tối thiểu trong 2 tuần liên tiếp → tự ngừng nhận và báo anh Andy; tổng giờ duyệt mỗi tuần vượt mức anh Andy đặt → hạ trần, không nâng |

### 1.5 Thứ tự đề nghị và điều kiện sang chặng sau

Theo `khao-sat/huong-phat-trien.md` mục 5. **Không phần nào thuộc đợt A–E của kế hoạch chính**, trừ G12-C01…C03 (lưu cặp điểm) đã được duyệt đưa vào đợt D cùng G09-T17 (00 điểm 24). Các ngưỡng dưới đây là đề nghị khởi điểm, chưa có dữ liệu nền; anh Andy chỉnh.

| Chặng | Phần | Bắt đầu khi | Sang chặng sau khi |
|---|---|---|---|
| Trong đợt D (đã duyệt 18/11, 00 điểm 24) | C01–C03: ghi cặp điểm, chưa công bố | G09-T17 đang làm | — (chạy nền) |
| 1 · trước mở bán | D: kiểm tra đầu vào | G05 đã có Danh mục khoá; anh Andy mở phần D | 5 người ngoài tự đi hết đường thử → đăng ký → vào học không cần hỗ trợ; nhận xét có đồng ý cho ít nhất 3 trong 6 khoá; có ít nhất 50 cặp điểm AI–giáo viên; học phí và số lượt đã chốt |
| 2 · ba tháng đầu sau mở bán | A (bản ngữ pháp), B, E | Anh Andy mở từng phần; A cần G07-T14 đã merge | Có khoảng 30 học viên online trả tiền (dưới mức đó mọi tỉ lệ là nhiễu); tỉ lệ còn hoạt động tuần 4 đo được và không giảm hai tháng liền; tỉ lệ sai lại theo nhóm có giảm ở người dùng sổ lỗi; số giờ vận hành mỗi tuần của anh Andy ổn định và chấp nhận được; tỉ lệ hoàn học phí và lý do đã biết |
| 3 · sau đó | F (gói giáo viên chấm), C04–C07 (công bố độ lệch); sổ lỗi mở sang Writing (spec mới, xin số ngoài khối của gói này) | F: anh Andy chốt học phí, trần, hạn trả. C công bố: đủ bốn điều kiện ở FR-12-C-020 | — |

### 1.6 Ước lượng

37 nhiệm vụ = 37 PR (thêm 1 nếu làm mẫu chấm mù C08), khoảng 79 phiên làm việc của agent (1 phiên ≈ một nhiệm vụ trọn vẹn kèm test). Độ khó kỹ thuật chung 4/5: phần nhiều chạm luồng chấm bài, sổ lượt và gửi thư — ba chỗ sai là mất dữ liệu hoặc mất tiền của người học. Đây là ước lượng, giả định các gói G03, G04, G07, G09, GOI-11 đã merge đúng hợp đồng ghi trong file của chúng; gói nào lệch thì cộng thêm 1 phiên mỗi chỗ ghép.

## 2. Hiện trạng trong repo (đã kiểm ở bản sao staging @ c3bc71574, 15/11/2026)

Kiểm bằng cách đọc mã ở `~/code/ielts-speaking-coach` (chỉ đọc). Không truy vấn database. Bảng do gói khác tạo (G04, G06, G07, G09, GOI-11) chưa có trong repo: tên lấy theo file gói đó.

### 2.1 Bài tập ngữ pháp và ôn ngắt quãng (cho A, D)

| Thứ cần biết | File / đường dẫn thật | Ghi chú |
|---|---|---|
| Từng câu trả lời | `quiz_attempts` (`backend/migrations/119_quiz_progress.sql`): `user_id, session_id, bank_id, item_key, question_id, qid, skill, type, subtype, is_correct, answer_given, response_time_ms, attempt_no, client_id, created_at` | RLS: chủ tài khoản SELECT và INSERT được (`quiz_attempts_select`, `quiz_attempts_insert`); không migration nào sau 119 đổi chính sách này (`grep -n "POLICY" backend/migrations/*.sql \| grep quiz_attempts`). Học viên đọc được `is_correct` của chính mình qua Supabase (đã ghi ở 01 mục 6, phần GOI-11). Gói này không thêm đường đọc trực tiếp nào. |
| Phiên làm | `quiz_sessions` (119): `started_at, ended_at, duration_sec, ended_by` ('completed'/'time_cap'/'paused'); `class_assignment_item_id` (mig 188); `kind` 'run'/'retake' (mig 189 dòng 76) | |
| Câu hỏi | `quiz_questions` (`118_quiz_banks.sql`): `qid, item_key, type, subtype, input, skill NOT NULL, prompt, options, answer` (chỉ số 0-based), `accept, explain, points, grammar_article_slug`; `why_wrong jsonb` (mig 186, khoá là chỉ số phương án dạng chuỗi, chỉ phương án sai) | RLS bật, không policy: chỉ backend đọc. |
| Ánh xạ khi nạp bank Course | `backend/scripts/import_course_exercise_bank.py` dòng 21–28, hàm `_mcq_row` dòng 116–150: `dang→subtype`, `truc→item_key`, **`truc_nhom→skill`, nếu thiếu thì `skill = dang[0]`** (chữ cái họ dạng A…E), `bay→why_wrong`, `muc→points` | Vì vậy `skill` không phải lúc nào cũng là nhóm ngữ pháp: giá trị một chữ cái `A`–`E` là họ dạng câu, phải loại. |
| Số nhóm mỗi buổi | Đo trên `backend/content/master30-assigned-practice/v3-banks/M30-B13.jsonl`: 100 câu, 8 nhóm `truc_nhom` (22, 18, 16, 11, 8, 6, 5, 4 câu) + 10 câu họ E không có `truc_nhom` | Có nhóm chỉ 4–6 câu một buổi: không đủ 3 phiên × 3 câu chưa gặp. Bank thật trên database có thể khác bản trong repo: `CHƯA KIỂM` — lệnh (chỉ đọc, staging): `select qb.code, qq.skill, count(*) from quiz_questions qq join quiz_banks qb on qb.id=qq.bank_id where qb.skill_area='course' group by 1,2 order by 1,2;` |
| Dạng câu | Cùng file: A1–A3 (nhận diện thì), B1–B3 (chọn dạng), C1–C4 (tìm phần sai, câu đúng), D1–D4 (viết lại giữ nghĩa, so sánh), E1–E3 (tự luận, không chấm máy, không `truc_nhom`) | Đề là câu hướng dẫn tiếng Việt + câu tiếng Anh, không có ô trống `___`. Không suy được "câu sai của chính người học" bằng một quy tắc chung: phải có dữ liệu soạn riêng (A03). |
| "Lượt đầu" | `quiz_service.course_section_attempt_no` (dòng 1189), `_course_rows_for_attempt` (1209): với bank Course, `attempt_no` là số lượt làm của phần, 1 = lượt đầu | Cách tính trục "lượt đầu" của báo cáo hiện có: `course_attempt_report` (dòng 6382), khoá `"scope": "first_attempt"` dòng 6784. |
| Câu sai đã có đường đọc | `GET /api/quiz/mistakes` (`backend/routers/quiz.py` dòng 107) → `quiz_service.student_mistakes` (dòng 7033): câu sai mới nhất gom theo từ/câu | Gom theo `item_key`, không theo nhóm, không lịch ôn. A không sửa route này. |
| Hằng `COURSE_AREA` | `backend/services/quiz_service.py` dòng 343: `"course"` (`quiz_banks.skill_area`) | |
| Ôn ngắt quãng đang dùng cho từ vựng | `backend/services/srs.py::update_srs(review, rating, floor)` — SM-2 rút gọn, 4 mức `again/hard/good/easy`; bảng `flashcard_reviews` (mig 027: `interval_days, ease_factor, review_count, lapse_count, next_review_at`); RPC nguyên tử `fn_apply_srs_review` (mig 125); route `backend/routers/flashcards.py` (prefix `/api/flashcards`) | A **không** dùng SM-2: lịch của tờ SoLoiCaNhan là ba mốc cố định 2 · 7 · 21 ngày, lùi một mốc khi sai. Lý do: người học và giáo viên đọc được lịch; SM-2 cho khoảng cách thay đổi theo hệ số dễ, không giải thích được bằng một câu. Lấy lại từ `srs.py` đúng cách chặn tràn ngày (`_INTERVAL_CAP`) và cách tính ngày theo giờ Việt Nam. |
| Bài chẩn đoán MASTER30 (spec 0003) | `specs/0003-master30-grammar-diagnostic/spec.md` (status `implementing`); `backend/migrations/283_master30_grammar_diagnostic.sql` (bảng `grammar_items` với `attribute_id` M01–M14, `correct_index`, `distractor_explanations`, `entry_safe`, `diagnostic_status`; `grammar_diagnostic_sessions` với `mode IN ('ENTRY','REVIEW')`, `test_length IN ('QUICK','FULL')`, `objective_limit` 28 hoặc 54 bắt buộc bằng CHECK); `backend/routers/grammar_diagnostic.py` (prefix `/api/grammar/diagnostics`, cả router sau cờ `master30_grammar_diagnostic`); `backend/services/grammar_diagnostic_service.py` | Cờ `master30_grammar_self_serve` (tắt) seed ở mig 283 dòng 872; `create_session` dòng 242–250 trả 403 `grammar_assignment_required` khi không có bài giao và cờ tắt. Spec 0003 ghi rõ "Non-goals: Public self-enrolment". Bài 18 câu "chỉ phần nền" của tờ KiemTraDauVao **không** khớp CHECK hiện có (28 hoặc 54). |

### 2.2 Writing: chấm, giáo viên duyệt, điểm AI và điểm giáo viên (cho B, C, F)

| Thứ cần biết | File / đường dẫn thật | Ghi chú |
|---|---|---|
| Phiên bản phản hồi | `writing_feedback` (mig 033; `id uuid PK`; band `overall_band_score, band_main_criterion, band_coherence_cohesion, band_lexical_resource, band_grammatical_range`, `prompt_version, model_used, feedback_json`); mig 109 thêm `version` (CHECK 1..3, UNIQUE `(essay_id, version)`), `source` (`ai_pro`/`ai_flash`/`partial`/`composed`), `parent_version`; `writing_essays.current_version`; view `writing_feedback_current` | Mỗi lần AI chấm (kể cả chấm lại) **chèn** một dòng mới `source='ai_pro'` (`essay_service._bg_grade_essay`, khoảng dòng 1118–1145); chạy lại cùng `job_id` thì **UPDATE** dòng của job đó. |
| Admin sửa điểm | `PATCH /admin/writing/essays/{id}/feedback` (`backend/routers/admin_writing.py` dòng 472) → `essay_service.upsert_composed_version` (dòng 693): bản đang hiện là AI → chèn dòng mới `source='composed'`, `parent_version` = bản AI, dời `current_version`; bản đang hiện đã là `composed` → **UPDATE tại chỗ** | Bản AI không bị ghi đè khi sửa. Bản của người sửa thì sửa được nhiều lần, kể cả sau khi thu hồi bài đã trả. |
| Giáo viên (vai trò instructor) sửa điểm | `PATCH /instructor/essays/{id}/feedback` (`backend/routers/instructor.py` dòng 484) **luôn trả 403** ("Giảng viên không được sửa AI feedback"); giáo viên chỉ ghi lời nhắn (`/instructor-note`), cho AI chấm lại (`POST /instructor/essays/{id}/regrade`, dòng 563) hoặc ghép từng tiêu chí từ các bản AI (`POST /instructor/essays/{id}/compose`, dòng 441 → `essay_service.compose_version` → `upsert_composed_version`, tạo bản `composed`) | Hôm nay chỉ tài khoản admin tự đặt được band. Tờ AdminChamWriting vẽ giáo viên sửa điểm từng tiêu chí: đó là hành vi mới của G09, chưa có trong mã. |
| Trả bài qua tầng duyệt | `services/instructor_workflow.py::deliver` (dòng 226): (1) `instructor_reviews` → `delivered`, ghi `instructor_note`; (2) `writing_essays.status='delivered'`, `delivered_at`, lời nhắn; (3) **đổi `prompt_version` của dòng phản hồi đang hiện** thành `<gốc>-instructor` | Hàm này không ghi điểm. Nếu giáo viên không sửa gì, dòng đang hiện là dòng AI, nên bước (3) **sửa cột `prompt_version` của chính dòng AI**. |
| Trả bài của admin | `POST /admin/writing/essays/{id}/mark-delivered` (dòng 587) và `POST /admin/writing/essays/bulk-mark-delivered` (dòng 665) → `_deliver_essay` (dòng 142, RPC `fn_deliver_writing_essay` của mig 205); chỉ từ `reviewed` | `_deliver_essay(essay_id, method, hide_subbands)` không nhận id người trả; `mark_delivered` bỏ giá trị trả về của `require_admin`. Admin còn trả qua tầng duyệt: `POST /admin/instructor/reviews/{id}/deliver` (`routers/admin_instructor_queue.py` dòng 149) gọi `instructor_workflow.deliver` với id admin. Bài thi thử được trả khi công bố kỳ thi qua `essay_service.deliver_reviewed_essay` (dòng 523), không qua hai hàm trên. |
| Bảng duyệt | `instructor_reviews` (mig 047): `essay_id, status` (`queued/claimed/edited/delivered/released`), `claimed_by, claimed_at, delivered_at, instructor_note`; tạo ở `essay_service` dòng 1190–1194 khi `grading_tier == INSTRUCTOR` | Không có cột điểm nào. |
| Xoá phiên bản | `essay_service._gc_orphan_versions` (dòng 649): xoá mọi dòng `writing_feedback` không nằm trong chuỗi tổ tiên của `current_version`; gọi trước khi chèn bản mới | Không có trigger nào chặn UPDATE/DELETE trên dòng AI. |
| Đọc lại "nguồn chấm" | `backend/routers/writing_student.py::_band_source` (khoảng dòng 480–520): so band bản đang hiện với bản cha để biết `ai` hay `teacher` | Chứng tỏ cặp điểm **dựng lại được** từ chuỗi phiên bản cho bài đã sửa, nhưng không có chỗ lưu. |
| Thi thử | `mock_exam_reviews` (mig 147): `ai_draft jsonb`, `final_bands jsonb` theo **kỹ năng**; `services/mock_review_workflow.py::sync_writing_band_for_essay` (dòng 1048) ghi lại `ai_draft.writing` từ `writing_feedback_current` **sau khi admin sửa** (gọi từ `update_feedback` dòng 571) | `ai_draft.writing` không phải điểm AI gốc và không có bốn tiêu chí. Tờ DoLechAIGiaoVien ghi "đã có sẵn cặp điểm" ở đây là sai. |
| Nhận xét theo câu | `backend/models/writing_feedback.py::MistakeAnalysis` (dòng 100): `original, mistakeType, explanation, suggestion, criterion` | Chỉ có câu trích, **không** có vị trí ký tự, không có số đoạn; `mistakeType` là chữ tự do, không thuộc bộ nhãn cố định. |
| Bài nộp gắn đề | `writing_essays` (mig 033): `task_type`, `prompt_text`, `prompt_image_url`; xoá mềm `deleted_at` (mig 101) | Không có cột trỏ tới bài mẫu của Thư viện. Bảng `writing_samples` (G06 mục 5.2) có `essays` (ba bài), `delta_75_70`, `delta_70_60` (`{criterion, type, before, after, why, error_group}`). Chia đoạn theo loại (mở bài, thân bài, kết): `CHƯA KIỂM` — đọc `essays.*.outline` của một bộ trong `backend/content/library/` sau khi G06 nhập. |
| Ghi chi phí AI | `backend/services/ai_usage_logger.py` | Mọi lời gọi AI mới của B, D05 phải đi qua đây (00 mục 4 điểm 10). |

**Kết luận về điểm AI gốc và điểm giáo viên (đã kiểm):**
1. Điểm AI gốc **hiện còn giữ được trong đa số ca** nhưng **không được bảo đảm**: mỗi lần AI chấm là một dòng `writing_feedback` riêng (`source='ai_pro'`), admin sửa thì tạo dòng `composed` mới chứ không ghi đè dòng AI. Nhưng (a) không có trigger chặn sửa hay xoá dòng AI; (b) `deliver` đổi `prompt_version` của dòng đang hiện, tức của dòng AI khi không ai sửa; (c) `_gc_orphan_versions` xoá dòng ngoài chuỗi tổ tiên; (d) chạy lại cùng job ghi đè dòng của job đó; (e) dòng phản hồi trước mig 109 (`source` NULL) đã qua đường DELETE→INSERT cũ nên có thể không còn bản AI.
2. Điểm giáo viên chốt **không được lưu riêng**: "điểm giáo viên" hôm nay = band của bản đang hiện lúc trả; bản `composed` sửa tại chỗ được, kể cả sau khi thu hồi rồi trả lại, nên không có ảnh chụp lúc trả. `instructor_reviews` và `deliver` không ghi điểm.
3. Giáo viên vai trò instructor không tự đặt được band (403), nên mọi bài họ trả có điểm lấy từ các bản AI (giữ nguyên, chấm lại, hoặc ghép từng tiêu chí qua `compose`), không phải điểm tự chấm; chỉ bài do tài khoản admin sửa mới có cặp phản ánh điểm của người. Đo độ lệch phải biết ai đã duyệt và người đó có quyền sửa band không.
4. Cặp điểm của thi thử ở `mock_exam_reviews.ai_draft` không dùng được (đã giải thích ở bảng).
→ Vì vậy nhiệm vụ đầu của phần C (G12-C02, C03) là chụp điểm AI lúc chấm xong vào bảng bất biến và ghi cặp điểm lúc trả bài, kèm dựng lại cặp cho bài đã trả trước đó (đánh dấu `reconstructed`).

### 2.3 Hồ sơ, mục tiêu, thư (cho D, E, F)

| Thứ cần biết | File / đường dẫn thật | Ghi chú |
|---|---|---|
| Mục tiêu và ngày thi | `users.target_band DECIMAL(2,1)`, `users.exam_date DATE`, `users.self_level` (`backend/migrations/005_add_user_profile.sql`); `users.weekly_goal` (mặc định 5), `users.timezone` (mặc định `Asia/Ho_Chi_Minh`), `users.notification_email` (`013_extend_user_profile.sql`); đọc/ghi ở `backend/routers/auth.py` (model dòng 73, trả ra dòng 352, 458; `PATCH /auth/profile` dòng 1101) | Có chỗ thứ hai: `students.target_band`, `students.target_date`, `students.current_band_estimate` (`033_writing_coach_tables.sql` dòng 56–59). Hai chỗ có thể lệch nhau. G07 mục 5.3 ghi `goal` "cùng chỗ lưu với Tiến độ" và còn `CHƯA KIỂM`. E đọc đúng nguồn G07 chọn (mục 3.4, K7). |
| Gửi thư | `backend/services/owner_alerts.py`: `SENDER = "alerts@averlearning.com"` (dòng 66), `RESEND_URL` (67), `transport_config()` (127), `class Email` (139, chỉ văn bản thuần), `send_via_resend(email, *, config, idempotency_key, client=None)` (270); biến môi trường `RESEND_API_KEY` | Chỉ gửi thư báo chủ dự án. Thư học viên đi qua `services/learner_email.py` và `learner_email_outbox` của G04-T04 (chưa có trong repo). Địa chỉ gửi cho thư học viên còn chờ (GOI-04 Q9). |
| Cờ | `backend/services/runtime_flags.py`: `is_enabled(key, default)`, `require_flag(key, default)`; cờ mới seed bằng `INSERT INTO runtime_flags (key, enabled, note) … ON CONFLICT DO NOTHING` (mẫu: mig 283 dòng 866–874) | |
| Migration | `backend/migrations/README.md`: lấy số theo sổ, có `rollback/` và `forward-policy.tsv`; số cao nhất 380 | Dải 480–489 thuộc gói này. |

## 3. Phạm vi

### 3.1 Trong phạm vi

- A: sổ lỗi từ bài tập ngữ pháp theo buổi (bank `skill_area='course'`, lượt đầu và câu sai lại ở lượt làm lại); trang Sổ lỗi, chi tiết mục, phiên ôn 4 câu, dòng ở Hôm nay qua API cho G07, khối "Sổ lỗi của lớp" cho giáo viên.
- B: viết lại một đoạn của bài Writing đã trả; đối chiếu bằng AI có câu trích kiểm ở máy chủ; "Bài của tôi đứng đâu" khi đề thuộc kho; kiểm trùng bài mẫu bằng so chuỗi; cách tính lượt cấu hình được; dòng "đã viết lại" cho giáo viên.
- C: bảng chụp điểm AI và bảng cặp điểm bất biến (làm sớm); sau đó tổng hợp theo kỳ, thẻ admin, trang công khai sau công tắc, dòng trên phiếu.
- D: bộ đề đầu vào, phiên làm có lưu, chấm phía máy chủ, quy tắc gợi ý có phiên bản, kết quả không band, phần 4 tuỳ chọn qua chấm thử, khối phễu ở Báo cáo.
- E: kế hoạch tuần theo học viên, thẻ trên Hôm nay, khối chậm kế hoạch, cài đặt nhắc, hai thư 15 và 16, liên kết tắt một lần bấm, hai bảng ở Báo cáo.
- F: sản phẩm "Gói giáo viên chấm", loại lượt riêng, trần mỗi tuần, hàng chờ nguồn "gói", hạn trả theo ngày làm việc, ký và trả, quá hạn và hoàn lượt, màn học viên và admin.

### 3.2 Ngoài phạm vi

- Sổ lỗi từ nhận xét Writing và Speaking: giai đoạn sau, spec mới (khối 0088–0094 đã dùng hết; xin số mới ở sổ). Điều kiện để bắt đầu: (1) bản ngữ pháp chạy 8 tuần và chỉ số (a) giảm; (2) có bộ nhãn lỗi cố định cho chú thích Writing (thay `mistakeType` chữ tự do), do anh Andy duyệt; (3) lập mục khi cùng nhãn có ở từ 2 bài; (4) có nút "Đây không phải lỗi này" và ghi lại số lần bấm. Không gói nào khác tự tổng hợp lỗi (01 mục 6 phân xử 29).
- Câu tự luận họ E (không có `truc_nhom`): không vào sổ lỗi ở bản đầu.
- Ứng dụng điện thoại, chuỗi ngày, huy hiệu, điểm thưởng, bảng xếp hạng: không làm (khảo sát mục 4).
- Gợi ý band dự đoán ở kiểm tra đầu vào: không bao giờ.
- Gói giáo viên chấm cho Speaking: không ở bản đầu (mục 10, F5).
- Sửa luồng trả bài, thuật toán chấm, prompt chấm hiện có: không. C chỉ thêm chỗ ghi; B thêm lời gọi AI mới, không đổi lời gọi cũ.
- Sửa `01-KE-HOACH-TONG.md`, `00-QUY-UOC-CHUNG.md`, file gói khác, tờ thiết kế: không (người thực thi chỉ báo chỗ lệch).

### 3.3 Khi bật từng phần thì phải sửa những tờ và gói nào

Để thiết kế chính không lẫn với tính năng chưa lên lịch: khi chưa bật phần nào, các tờ chính **không** vẽ lối vào của phần đó (hoặc vẽ ở trạng thái ẩn). Khi anh Andy mở một phần, người thực thi mở PR giao diện theo đúng dòng dưới; tờ chưa sửa thì dựng từ tờ của phần (SoLoiCaNhan, VietLaiSauCham…) và ghi trong PR.

| Phần | Tờ | Việc khi bật |
|---|---|---|
| A | Main, HomNayTrangThai, Mobile | Khối "Lỗi đang lặp lại" lấy từ `repeat_error` (mục 5.A, "Hàm cho G07"), bốn biến thể của SoLoiCaNhan mục 1; dòng "Sổ lỗi · N lỗi cần ôn hôm nay" ở "Làm tiếp khi rảnh". "Ôn 10 phút" mở phiên ôn, "Xem cả N lỗi" mở `/practice/error-book` (khác ghi chú hiện tại của HomNayTrangThai và G07 FR-07-029b — mục 3.4, K2). |
| A | TienDo | Khối "Lỗi lặp lại nhiều nhất" đang ghi gom từ 5 bài Writing và 6 buổi Speaking: bản ngữ pháp không cấp được dữ liệu đó. Khi A bật: khối hiện mục sổ lỗi ngữ pháp và ghi rõ "từ bài tập ngữ pháp"; phần Writing/Speaking giữ ẩn tới spec Writing sau. |
| A | LuyenTap | Thêm lối "Sổ lỗi của tôi" (chỉ khi người đó có bài tập ngữ pháp theo buổi). |
| A | XemLaiBaiLam | Câu sai lẻ có dòng "Sai thêm một câu của nhóm này thì nhóm vào Sổ lỗi" (SoLoiCaNhan mục 6). |
| A | AdminLop, GiaoVien, AdminKetQuaBaiGiao | Khối "Sổ lỗi của lớp" ở thẻ Bài nộp và chấm và ở "Lớp của tôi"; mỗi dòng dẫn sang khối 3 của Kết quả một bài giao; dùng chung bảng tên `truc_nhom_vi.json`. |
| B | KetQuaWriting | Nút "Viết lại đoạn này" ở từng đoạn có nhận xét; hàng "Làm gì tiếp" đổi nút chính thành "Viết lại một đoạn". Thẻ "Bài mẫu cùng đề" và nút "Đọc bài mẫu 7.5 cùng đề" trái quy tắc "mở bài mẫu sau khi viết lại" (mâu thuẫn M1). |
| B | HomNayTrangThai (5c), khối "Hết lượt chấm" của G07-T27 | Dòng "Làm ngay, không tốn lượt: So bài nháp với bài mẫu 7.0 cùng đề" trái cùng quy tắc (mâu thuẫn M2). |
| B | BaiTapWriting | Màn viết lại dùng cùng khung soạn bài; giới hạn 140 từ, nộp một đoạn. |
| B | AdminChamWriting | Trang "Đã trả": dòng "Viết lại Đoạn N · ngày · x đã xử lý · y còn · z lỗi mới", "Xem hai bản", ô lời nhắn; không vào hàng chờ duyệt (nếu anh Andy chọn "qua giáo viên duyệt" thì vào hàng chờ). |
| B | EmailMau, ThongBao | Không thư mới; một thông báo khi có kết quả đối chiếu (loại mới `rewrite_ready`) hoặc khi giáo viên ghi lời nhắn. |
| C | AdminChamWriting | Thẻ thứ ba "Độ lệch AI–giáo viên"; "Mở bài" có hai cột điểm. Câu "Mỗi tiêu chí lưu cả điểm AI và điểm giáo viên" của tờ chỉ đúng sau C03. |
| C | AdminCaiDat (#m6), AdminViecCanLam | Hai ngưỡng mới (`score_gap_review_band`, `score_gap_publish_*`); cảnh báo "N bài lệch từ 1.0 band chưa xem lại". |
| C | KetQuaWriting, TrangChuCongKhai, DanhMucKhoa, ChamThuMienPhi | Dòng "AI lệch trung bình XXX band so với giáo viên…" và liên kết tới `/cham-bai-the-nao` chỉ khi đã công bố. |
| D | DanhMucKhoa | Khối "Hai cách chọn khoá" thay đầu khối "Chưa biết bắt đầu từ khoá nào?"; khối "chọn theo mô tả" xuống hàng hai. Tờ KiemTraDauVao 1a ghi khối này ở trang chủ công khai, nhưng trong bộ tờ khối đó nằm ở DanhMucKhoa (mâu thuẫn M8). |
| D | TrangChuCongKhai | Một lối "Làm bài kiểm tra đầu vào" (nếu anh Andy muốn có ở trang chủ). |
| D | HomNayTrangThai (chưa có khoá) | Khối "Bắt đầu từ đâu" trên "Chấm thử hôm nay"; sau khi làm: "Gợi ý cho bạn: …". |
| D | ChamThuMienPhi | Phần 4 dùng lượt chấm thử: thêm câu báo trước "Phần này dùng 1 lượt chấm thử Writing Task 2". |
| D | AdminBaoCao, AdminCaiDat | Khối phễu 7 bước; ba ô Cài đặt › Tính năng (bật, làm lại sau N ngày, giữ bài dở N ngày). |
| E | Main, HomNayTrangThai, Mobile | Thẻ "Kế hoạch tuần này", hàng "Hôm nay tôi có 15 · 30 · 60 phút · Cả tuần", khối "Kế hoạch cần chỉnh" (không phải cảnh báo). |
| E | TienDo | "Đổi kế hoạch", nhịp, ngày thi. |
| E | TaiKhoan, ThongBao | Nhóm cài đặt "Nhắc việc theo kế hoạch" ở Hồ sơ › Thông báo; hai dòng mới trong ngăn thông báo. |
| E | EmailMau | Hai thư mới 15 "Tổng kết tuần" và 16 "Tuần chưa vào học"; trang mở ra khi bấm tắt thư. |
| E | AdminBaoCao | Hai bảng: nhóm theo tháng mở khoá; thư. |
| E | AdminKhoaHoc | Nhãn "cốt lõi / mở rộng" cho từng bài (chỉ khi anh Andy chọn có "Giảm tải"). |
| F | DanhMucKhoa, ThanhToan, TaiKhoan | Trang giới thiệu gói, đăng ký dùng màn 1 của ThanhToan; "Khoá học và lượt chấm AI" có dòng lượt giáo viên chấm riêng. |
| F | BaiTapWriting, KetQuaWriting, ThongBao, EmailMau | Lối "Gửi giáo viên chấm" khi nộp; trang một bài đã gửi; phiếu trả có chữ ký; thông báo và thư 10 dùng cho bài gói; thư trễ hạn. |
| F | AdminChamWriting, AdminDonDangKy, AdminKhoaHoc, AdminCaiDat, AdminViecCanLam, AdminBaoCao, GiaoVien | Thẻ "Gói giáo viên chấm" (nguồn bài riêng); đơn đăng ký loại gói; sản phẩm gói; hai ngưỡng mới; việc "sắp trễ hạn trả gói"; thống kê phút duyệt; khung giáo viên. |
| Mọi phần admin | CHUAN-ADMIN | Không thêm mục sidebar: mọi khối mới là thẻ hoặc khối trong trang đã có (theo ba tờ admin của gói). |

### 3.4 Chỗ gói khác phải khớp

| # | Gói, mục | Cần khớp gì |
|---|---|---|
| K1 | 01-KE-HOACH-TONG mục 3, mục 6 | Số spec 0088–0094 và dải migration 480–489 đã có ở sổ mục 6. Còn: bỏ chữ "đang viết" ở sơ đồ phụ thuộc (mục 3) và ở phân xử 29; đóng lệch (j) bằng tên hàm `services/error_book.py::today_block` (K2). Anh Andy sửa. |
| K2 | GOI-07 FR-07-029b, mục 5.3, T13, T14, mục 10 câu 14 | `_repeat_error_for(user_id)` gọi `services/error_book.py::today_block(user_id)` (mục 5.A, "Hàm cho G07"). Hình trả về giữ năm khoá G07 đã đặt (`label, count, of, review_href, total_errors`) và thêm bảy khoá (`unit, due_entries, due_questions, due_minutes, next_due, state, list_href`). Ý nghĩa khác bản G07 đang ghi: lập mục khi sai từ 2 **câu** cùng nhóm (không phải "từ 2 bài có nhận xét"); "Ôn 10 phút" mở phiên ôn (không mở Grammar Wiki); "Xem cả N lỗi" mở `/practice/error-book` (không mở `/progress`). Tờ SoLoiCaNhan thắng ghi chú cũ của HomNayTrangThai vì vẽ sau và riêng cho khối này. |
| K3 | GOI-07 T17 (Tiến độ) | "Lỗi số 1" của Tiến độ bản ngữ pháp lấy từ `GET /api/error-book/summary`; phần Writing/Speaking giữ ẩn. |
| K4 | GOI-09 T27, Q27 | Dùng chung `backend/content/course-labels/truc_nhom_vi.json`; A thêm `truc_nhom_wiki.json` cạnh đó. Hàm lọc mã nội bộ khỏi `explain`/`why_wrong` ("RÀNG BUỘC n", "N1"–"N6", "Mẹo n"): nếu G09 đã có thì A dùng lại, chưa có thì A tạo `services/learner_text_clean.py` và G09 dùng lại. |
| K5 | GOI-09 T17, 6.1 ("không thêm cột điểm AI/giáo viên nếu chưa có") | C02/C03 thêm bảng riêng, không thêm cột vào `writing_essays`/`instructor_reviews`. Khi G09 cho giáo viên sửa điểm từng tiêu chí, đường lưu đó phải đi qua `upsert_composed_version` (hoặc gọi `writing_score_pairs.record_delivery` khi trả), để cặp điểm không bị bỏ sót. |
| K6 | GOI-04 mục 5.2, 5.3 | Các CHECK sẽ được mở rộng trong dải 480–489: `credit_ledger.feature`, `credit_reservations.feature`, `credit_reservations.resource_type` thêm `writing_rewrite` (B); `credit_ledger.credit_kind` thêm `teacher_review` và `course_products.kind` thêm `review_pack` (F); `learner_email_outbox.template` thêm `weekly_summary`, `weekly_inactive` (E). Đề nghị G04 viết sẵn điều kiện `credit_kind = 'ai_grading'` trong `fn_credit_usable_balance`, `fn_credit_balance`, `fn_credit_reserve` ngay từ 382 để F không phải sửa ba hàm sau này. `services/learner_email.py` cần nhận thêm header (`List-Unsubscribe`, `List-Unsubscribe-Post`) cho E. |
| K7 | GOI-07 mục 5.3 (`goal`) | E đọc mục tiêu và ngày thi từ đúng nguồn G07 chọn (`users.target_band`/`users.exam_date` hay `students.target_band`/`target_date`); không tự chọn nguồn thứ hai. |
| K8 | GOI-11 phần A (mig 470) | Thêm giá trị `kind` của `learner_notifications`: `rewrite_ready` (B), `plan_week_new`, `plan_midweek` (E), `review_pack_returned`, `review_pack_late`, `review_pack_reopened` (F) — mỗi phần một migration riêng trong dải 480–489, cộng câu chữ ở `services/notification_copy.py`. |
| K9 | GOI-11 phần B | D05 cần một chế độ chấm thử "nhận xét chữ, không band" cho đoạn viết 120 từ và bài nói; đếm vào cùng `trial_usage` như một bài Task 2 / Part 2 (mặc định của tờ). |
| K10 | GOI-08 T25 | Route Writing tự luyện ghi `writing_essays.library_sample_id` (cột do B02 thêm) khi học viên bắt đầu từ "Viết đề này" ở trang bài mẫu. Chưa có thì B so khớp `prompt_text` đã chuẩn hoá. |
| K11 | GOI-07 T18 | E cần cột `course_lessons.track` (`core`/`extension`) — E thêm trong migration của mình, sau 420–439. |
| K12 | GOI-04 FR-04-020, `writing_student.get_my_essay` | Bài gói giáo viên chấm của học viên online: học viên thấy bản AI ngay, có nhãn "Bản AI, giáo viên đang duyệt", khác bài lớp offline (ẩn tới khi trả). F làm ngoại lệ có điều kiện, không đổi hành vi bài lớp. |

## 4. Yêu cầu (FR đánh số)

### A — Sổ lỗi cá nhân

- **FR-12-A-001** Chỉ tài khoản có ít nhất một câu trả lời ở bank `skill_area='course'` có nhãn nhóm hợp lệ mới thấy Sổ lỗi và lối vào; người khác không thấy lối vào, `GET /api/error-book/summary` trả `{"enabled": false}`.
- **FR-12-A-002** Nhãn nhóm hợp lệ: `quiz_questions.skill` không rỗng, không phải một chữ cái `A`–`E`, có tên tiếng Việt trong `truc_nhom_vi.json`. Câu họ E và câu không chấm máy bị loại. Người học không bao giờ thấy mã nhóm.
- **FR-12-A-003** Lập mục khi một người có từ `ERROR_BOOK_OPEN_MIN_WRONG` (mặc định 2) câu sai cùng nhóm, đếm trên lượt đầu (`attempt_no` = 1 hoặc NULL) của mọi bài tập và bài kiểm tra cộng câu sai ở lượt làm lại; cộng dồn qua các bài.
- **FR-12-A-004** Mục mới ở mốc 1, đến hạn sau 2 ngày tính theo ngày giờ Việt Nam. Phiên đạt (theo `ERROR_BOOK_PASS_RULE`, mặc định `all_correct`) → sang mốc sau (2 → 7 ngày, 3 → 21 ngày); có câu sai → lùi một mốc (mốc 1 ở lại mốc 1); đạt ở mốc 3 → "Đã vững". Ngày kế tiếp tính từ hôm ôn thật.
- **FR-12-A-005** Mục đã vững mở lại (về mốc 1) khi nhóm đó sai từ `ERROR_BOOK_REOPEN_MIN_WRONG` (mặc định 2) câu trong **một** bài tập mới.
- **FR-12-A-006** Mỗi ngày tối đa `ERROR_BOOK_DAILY_CAP` mục (mặc định 3). Quá trần: mục quá hạn lâu nhất trước, rồi mục ở mốc 1; phần còn lại sang ngày kế, không tính trễ, không lùi mốc.
- **FR-12-A-007** "Để mai" ở từng mục, ở khối đầu trang ("Để mai cả ba mục") và trong phiên: mục sang ngày mai, mốc giữ nguyên, không hỏi lý do.
- **FR-12-A-008** Một phiên = 4 câu cùng nhóm: 3 câu trắc nghiệm chọn theo thứ tự ưu tiên (chưa gặp → đã sai → gặp lâu nhất) và 1 câu "viết lại câu bạn từng sai" nếu nhóm có câu viết lại đã soạn; không có thì 4 câu trắc nghiệm. Hết câu chưa gặp: dùng lại câu đã gặp lâu nhất, đảo thứ tự phương án, ghi "câu đã gặp". Không tự sinh câu, không gọi AI.
- **FR-12-A-009** Đáp án không gửi về trình duyệt trước khi trả lời; máy chủ chấm. Danh sách mục không hiện đáp án.
- **FR-12-A-010** Câu viết lại: máy so với câu đúng và các cách viết được nhận đã soạn sẵn, bỏ qua khác biệt hoa thường, dấu chấm cuối, khoảng trắng, viết tắt `didn't`/`did not` (bảng viết tắt cấu hình). Sai lần một: gạch chỗ khác, cho thử lại một lần, chưa hiện đáp án. Sai lần hai: hiện câu đúng, tính là sai.
- **FR-12-A-011** Sau mỗi câu: hiện lời giải thích đã lọc mã nội bộ, `why_wrong` của phương án đã chọn, liên kết bài Grammar Wiki và sơ đồ câu chữ nếu nhóm có ánh xạ.
- **FR-12-A-012** Chi tiết mục: các câu đã sai (nguồn, ngày, lượt, số giây, câu sai của chính người học theo quy tắc của tờ), lịch sử ôn, biểu đồ theo tháng chỉ khi mỗi tháng so có từ `ERROR_BOOK_CHART_MIN_PER_MONTH` (mặc định 5) câu đã gặp; không đủ thì một câu nói rõ còn thiếu gì, không phần trăm.
- **FR-12-A-013** Trạng thái rỗng, chưa đủ dữ liệu, lỗi tải đúng SoLoiCaNhan mục 6. Sổ chưa có mục: `today_block` trả `None`, khối ở Hôm nay ẩn; không hiện số 0.
- **FR-12-A-014** Ôn không tính lượt chấm AI; không thông báo, không thư riêng cho việc ôn lỗi.
- **FR-12-A-015** Giáo viên (trong phạm vi `staff_scope` của G09) thấy khối "Sổ lỗi của lớp": mỗi nhóm số người đang có mục, đã vững, sai lại sau khi ôn, bài nguồn; danh sách "ôn hai lần vẫn sai" có tên (mặc định của tờ, mục 10 câu A6); không xếp hạng học viên.

### B — Viết lại sau khi chấm

- **FR-12-B-001** Lối "Viết lại đoạn này" chỉ hiện trên bài Writing đã trả (`status='delivered'`) ở đoạn có ít nhất một nhận xét gắn được vào đoạn.
- **FR-12-B-002** Chia bài thành đoạn theo dòng trống; gắn nhận xét vào đoạn bằng cách tìm `MistakeAnalysis.original` (đã chuẩn hoá khoảng trắng) trong đoạn. Không tìm được → nhận xét thuộc "nhận xét chung", không có nút viết lại.
- **FR-12-B-003** Bản viết lại: tối đa `REWRITE_MAX_WORDS` từ (mặc định 140), tối đa `REWRITE_MAX_PER_PARAGRAPH` bản mỗi đoạn (mặc định 3); gần như không đổi (độ giống trên `REWRITE_MIN_CHANGE_RATIO`) → không nộp được, báo dưới ô viết.
- **FR-12-B-004** Lượt: phương án cấu hình `REWRITE_CREDIT_MODE` = `first_free` (mặc định, như tờ vẽ: lần viết lại đầu của mỗi bài không trừ lượt, từ lần hai 1 lượt) hoặc `always` (mỗi lần 1 lượt). AI lỗi thì không trừ lượt và không tính là lần đầu. Học viên lớp offline trừ vào lượt lớp; hết lượt thì "Liên hệ giáo viên để được cấp thêm".
- **FR-12-B-005** Kết quả đối chiếu: mỗi nhận xét của đoạn một nhãn `resolved` / `remaining` / `not_applicable`, kèm câu trích nguyên văn từ bản 2; danh sách lỗi mới kèm câu trích. Máy chủ kiểm mỗi câu trích có trong bản 2; không khớp → hạ nhãn thành `remaining` (lỗi mới không khớp thì bỏ). Không trả band; trang ghi "Đây không phải điểm".
- **FR-12-B-006** Câu trùng bài mẫu từ `REWRITE_SAMPLE_OVERLAP_WORDS` (mặc định 8) từ liên tiếp: vẫn trả kết quả, câu đó ghi "trùng bài mẫu", không tính là đã xử lý. So chuỗi, không dùng AI.
- **FR-12-B-007** "Bài của tôi đứng đâu" chỉ khi bài gắn được một bộ `writing_samples` đã xuất bản và đã có ít nhất một bản viết lại của đoạn đó (khoá mềm, mục 10 câu B3): so đoạn của người học với đoạn cùng loại của ba bài mẫu theo tiêu chí yếu nhất của bài; trả bảng việc và tối đa hai khác biệt, mỗi khác biệt một câu trích từ bài 7.0 (kiểm câu trích ở máy chủ); không xếp đoạn của người học vào band.
- **FR-12-B-008** Lối "Mở bài mẫu ngay, không viết lại" luôn có; ai mở trước thì kết quả ghi "đã xem bài mẫu trước khi viết".
- **FR-12-B-009** Lớp offline: bản viết lại AI đối chiếu và trả ngay (mặc định, mục 10 câu B2); giáo viên của lớp thấy dòng ở trang bài đã trả và ghi được lời nhắn; học viên nhận thông báo khi có lời nhắn.
- **FR-12-B-010** Trạng thái: đang đối chiếu (rời trang được, có kết quả thì báo ở chuông), lỗi (bản viết lại đã lưu), hết lượt (lưu nháp), không nộp được — đúng VietLaiSauCham mục 7.

### C — Độ lệch AI–giáo viên

Phần đầu (SCOREPAIR-0088):
- **FR-12-C-001** Mỗi dòng `writing_feedback` có `source` bắt đầu bằng `ai_` được chụp ngay khi chèn, và chụp thêm mỗi lần band của dòng đó đổi (chạy lại cùng job ghi đè band — mục 2.2 kết luận 1(d)), vào bảng chỉ ghi thêm `writing_ai_score_snapshots` (năm band, `prompt_version` gốc đã bỏ hậu tố, `model_used`, `task_type`). Chụp bằng trigger database để mọi đường chấm (kể cả đường sau này) đều được ghi.
- **FR-12-C-002** Mỗi lần một bài Writing chuyển sang `delivered` (qua `instructor_workflow.deliver` hoặc `admin_writing._deliver_essay`), khi cờ `writing_score_pairs_record` bật, ghi một dòng `writing_score_pairs`: ảnh chụp AI gốc (bản AI đầu tiên của bài), ảnh chụp AI ngay trước khi người duyệt sửa (nếu khác), band của bản đang hiện lúc trả (= điểm giáo viên chốt), người trả, vai trò người trả, đường trả, ngữ cảnh bài (lớp, tự luyện, thi thử, gói), lớp, Task.
- **FR-12-C-003** Hai bảng chỉ ghi thêm: UPDATE, DELETE, TRUNCATE bị từ chối với mọi vai trò kể cả `service_role` (chỉ xoá theo dây chuyền khi bài bị xoá cứng). Thu hồi rồi trả lại → thêm dòng mới, dòng cũ giữ nguyên; bản đọc "mới nhất" là view.
- **FR-12-C-004** Ghi cặp lỗi không làm hỏng việc trả bài: lỗi ghi log `[score-pair] failed essay=<id>` và để tác vụ đối soát hằng đêm ghi bù.
- **FR-12-C-005** Bài đã trả trước khi có C03: script đối soát dựng lại cặp từ chuỗi phiên bản (bản AI đầu trong chuỗi, bản đang hiện), đánh dấu `reconstructed=true`; không dựng được (thiếu bản AI, `source` NULL) thì bỏ qua và đếm.
- **FR-12-C-006** Không giao diện học viên nào đổi trong phần đầu.

Phần sau (SCOREGAP-0091):
- **FR-12-C-010** Tổng hợp mỗi đêm theo kỳ đo, tháng, tiêu chí, lớp, Task, phiên bản chấm: số bài, lệch trung bình, tỉ lệ trong 0.5 band, hướng lệch (AI lớn hơn / nhỏ hơn / bằng). Chỉ tính cặp `reviewer_can_edit_bands = true` và ngữ cảnh trong `SCORE_GAP_CONTEXTS` (mặc định `['class_assignment']`, như tờ vẽ). Đổi mô hình hoặc prompt chấm → kỳ đo bắt đầu lại từ ngày đổi; không trộn hai phiên bản.
- **FR-12-C-011** Thẻ "Độ lệch AI–giáo viên" trong Chấm bài › Writing: quản trị thấy mọi lớp và công tắc; giáo viên chỉ thấy lớp mình, không thấy công tắc.
- **FR-12-C-012** Bài lệch từ `score_gap_review_band` (mặc định 1.0) ở bất kỳ tiêu chí nào: hiện trong danh sách "cần xem lại", có cờ "đã xem lại" kèm người và lúc; số chưa xem lại vào Việc cần làm.
- **FR-12-C-020** Công bố chỉ khi đủ bốn điều kiện: số bài trong kỳ ≥ `score_gap_publish_min_papers` (mặc định 50); lệch trung bình chung ≤ `score_gap_publish_max_mean` (mặc định 0.5); phần chữ "Điều AI chấm kém" đã được người vận hành viết; quản trị bật công tắc kèm lý do (ghi `admin_settings_log`). Dòng nào dưới `score_gap_row_min_papers` (mặc định 30) bài thì không hiện số dòng đó.
- **FR-12-C-021** Trang công khai `/cham-bai-the-nao` (tên và đường dẫn chờ anh Andy, mục 10 câu C4) và dòng trên phiếu đọc cùng một con số; cả hai có câu "không phải điểm thi". Chưa công bố → trang trả 404, dòng trên phiếu không hiện.

### D — Kiểm tra đầu vào

- **FR-12-D-001** Chỉ tài khoản đã đăng nhập làm được (mặc định của tờ, mục 10 câu D4); khách bấm lối vào → Đăng nhập rồi về thẳng màn giới thiệu.
- **FR-12-D-002** Bài gồm ba phần chính (ngữ pháp `PLACEMENT_GRAMMAR_ITEMS` mặc định 18 câu chia đều 6 nhóm; đọc 1 đoạn 6 câu; nghe 1 đoạn 6 câu, nghe tối đa 2 lần) và phần 4 tuỳ chọn (đoạn viết khoảng 120 từ hoặc bài nói). Không đồng hồ đếm ngược. Phần ngữ pháp có lựa chọn "Tôi không chắc", tính là chưa nắm.
- **FR-12-D-003** Câu lấy từ một bộ đề soạn sẵn (`backend/content/placement/forms/*.json`, 2–3 bộ); câu ngữ pháp là `grammar_items` của release MASTER30 đang hoạt động, chọn sẵn theo `item_id`. Làm lại dùng bộ khác bộ lần trước.
- **FR-12-D-004** Đáp án không gửi về trình duyệt; máy chủ chấm; mỗi câu lưu ngay khi trả lời; làm dở tiếp tục được tới `placement_keep_days`; quá hạn thì xoá bài dở, gửi một thông báo trong ứng dụng `placement_expire_notice_days` ngày trước.
- **FR-12-D-005** Kết quả: ngữ pháp theo nhóm (Vững 3/3, Tạm ổn 2/3, Hổng 0–1/3 — ngưỡng cấu hình), đọc và nghe theo số câu kèm loại câu sai, phần 4 bằng chữ; **không** band, không phần trăm tổng, không con số tổng.
- **FR-12-D-006** Gợi ý theo bảng quy tắc có phiên bản (`backend/content/placement/rules-v1.json`, mặc định đúng KiemTraDauVao mục 4b): đúng một khoá "Nên bắt đầu"; dòng trên thắng; mỗi lý do dẫn về câu cụ thể đã làm; luôn có khoá "Chưa nên học lúc này" khi quy tắc chỉ ra, và nhóm "Chưa đủ dữ liệu" cho khoá bài không đo (Vocabulary Skills + Ideas luôn ở đây). Phiên lưu `rule_version` để đổi quy tắc không làm sai kết quả cũ.
- **FR-12-D-007** Phần 4 gọi đường chấm thử của GOI-11 phần B, chế độ nhận xét chữ không band; hết lượt hoặc chấm thử tạm dừng → phần 4 tự bỏ qua, kết quả ba phần vẫn ra; AI lỗi → hoàn lượt chấm thử, kết quả ba phần đủ.
- **FR-12-D-008** Người đã có khoá làm được, không có phần 4 (mặc định của tờ, mục 10 câu D5). Người từng có khoá online (kể cả đã hết hạn) cũng không có phần 4, vì không được chấm thử (00 mục 2 điểm 11; `entitlements.has_ever_had_online_course` của G04).
- **FR-12-D-009** Làm lại được sau `placement_retake_days` ngày; trước đó chỉ hiện ngày, không nút. Làm lại có "So với lần trước" theo nhóm, không số tổng.
- **FR-12-D-010** Phễu ở Báo cáo: bảy bước của KiemTraDauVao mục 7; nhóm dưới ngưỡng số người tối thiểu thì hiện số đếm, không phần trăm. "Đăng ký đúng khoá gợi ý" = đơn `confirmed` trong `placement_order_window_days` ngày sau khi có kết quả.

### E — Nhắc việc theo kế hoạch và thư tổng kết tuần

- **FR-12-E-001** Tuần tính Thứ Hai–Chủ nhật giờ Việt Nam. 00:05 Thứ Hai (giờ VN) sinh kế hoạch tuần cho mỗi học viên có quyền khoá online còn hạn hoặc thuộc lớp offline đang hoạt động, khi cờ bật.
- **FR-12-E-002** Khoá online: số việc mỗi tuần = số bài lộ trình còn lại chia số tuần tới ngày thi (giữ một tuần ôn), cộng `weekly_plan.writing_per_week` bài viết (mặc định 1) và `weekly_plan.review_per_week` lượt ôn lỗi (mặc định 2, chỉ khi A bật và người đó có sổ lỗi). Chưa đặt ngày thi: theo nhịp chọn (Nhẹ 3 · Vừa 5 · Nhiều 7, mặc định Vừa). Khoá hết hạn trước khi xong theo nhịp: thẻ nói thẳng số bài học được trước hạn và đưa hai nút (đổi nhịp, Đăng ký lại).
- **FR-12-E-003** Lớp offline: "tuần" là các buổi học trong tuần và bài giao cho từng buổi; số việc do bài giao quyết định; không có "Giảm tải", "Lùi mốc".
- **FR-12-E-004** Việc chưa làm không cộng dồn sang tuần sau.
- **FR-12-E-005** Khối "Kế hoạch cần chỉnh" hiện khi `weekly_plan.slow_weeks` tuần liên tiếp (mặc định 2) làm dưới `weekly_plan.slow_ratio` (mặc định 0.5) số việc; hiện một lần; "Để sau" thì hai tuần sau mới hỏi lại. Không dùng màu cảnh báo, không chữ "trễ", "bỏ lỡ", "cố lên". "Giảm tải" chỉ có khi khoá đã gắn nhãn cốt lõi/mở rộng.
- **FR-12-E-006** Hàng "Hôm nay tôi có 15 · 30 · 60 phút · Cả tuần" xếp việc theo thứ tự: bài giao sắp đến hạn → lỗi đang lặp → bài viết của tuần → bài lộ trình; chỉ việc vừa quỹ; việc dài hơn đề nghị làm một phần có điểm dừng. Lựa chọn nhớ trên thiết bị tới hết ngày, không gửi về máy chủ, không dùng làm chỉ số.
- **FR-12-E-007** Mỗi tuần đúng một thư: 15 (tuần có ít nhất một việc đã làm) hoặc 16 (cả tuần không làm việc nào); gửi theo `digest_dow`/`digest_time` của `weekly_plan_settings` (lựa chọn của người học, mặc định Chủ nhật 19:00). Thư 16 tối đa `weekly_plan.inactive_max_weeks` tuần liên tiếp (mặc định 2) rồi ngừng tới khi người học quay lại. Lớp offline nhận thư 15 dạng lớp, không nhận thư 16.
- **FR-12-E-008** Không gửi khi: khoá đã hết hạn, đang tạm nghỉ nhắc, chưa có kế hoạch tuần, `users.notification_email=false`, hoặc người học tắt "Tổng kết tuần".
- **FR-12-E-009** Liên kết "Tắt thư tổng kết tuần" có chữ ký, không cần đăng nhập, tắt bằng một lần bấm (POST từ trang xác nhận; GET chỉ hiện trang); thư có header `List-Unsubscribe` và `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **FR-12-E-010** Thư theo khung EmailMau: một liên kết chính, không band, không nội dung bài viết; khối không có dữ liệu thì bỏ cả khối.
- **FR-12-E-011** Cài đặt "Nhắc việc theo kế hoạch": kênh trong ứng dụng / email cho "Kế hoạch tuần mới" và "Nhắc giữa tuần" (chỉ khi còn việc), ngày giờ thư tổng kết, tạm nghỉ 1 tuần / 2 tuần / tới ngày; mặc định: trong ứng dụng bật cả hai, thư tổng kết bật, email giữa tuần tắt. Tắt nhắc không tắt thẻ trên Hôm nay.
- **FR-12-E-012** Tác vụ gửi lỗi liên tiếp 2 lần → ghi sự cố về Hộp thư sự cố (G09-T07).

### F — Gói giáo viên chấm

- **FR-12-F-001** Sản phẩm `course_products.kind='review_pack'` gắn một khoá (mặc định Khoá Writing for IELTS); số lượt, học phí, hạn dùng là dữ liệu sản phẩm; đăng ký qua đơn đăng ký và VietQR như khoá.
- **FR-12-F-002** Lượt giáo viên chấm là loại lượt riêng (`credit_kind='teacher_review'`), không cộng vào số lượt chấm AI hiển thị; một bài gửi giáo viên chấm trừ 1 lượt giáo viên chấm và **không** trừ lượt chấm AI.
- **FR-12-F-003** Chỉ người có quyền Khoá Writing còn hạn đăng ký được gói (mặc định của tờ, mục 10 câu F6); chỉ Writing ở bản đầu.
- **FR-12-F-004** Trần mỗi tuần `review_pack.weekly_cap` (mặc định 8, như tờ vẽ): chỗ tính theo bài nộp; đơn gói đang mở giữ tạm một chỗ tới khi đơn hết hạn hoặc bị huỷ. Đủ trần → trạng thái "đủ chỗ", ngừng nhận bài mới và ngừng mở đơn mới; người đã có lượt thấy "Tuần này đã đủ chỗ" kèm ngày mở lại.
- **FR-12-F-005** Giáo viên hoặc quản trị bấm "Ngừng nhận" (có lịch ngừng đặt trước); khi đó hạn dùng lượt của người đang có gói được cộng thêm số ngày ngừng (mặc định của tờ).
- **FR-12-F-006** Hạn trả = lúc nộp + `review_pack.turnaround_business_days` ngày làm việc (bỏ Thứ Bảy, Chủ nhật và ngày nghỉ cấu hình). Học viên online thấy bản AI ngay, ghi rõ "Bản AI, giáo viên đang duyệt".
- **FR-12-F-007** Ký và trả chỉ được khi: mọi tiêu chí đã có điểm giáo viên; tiêu chí bị sửa có lý do; có ít nhất một phần giáo viên tự viết (trả lời câu hỏi của học viên hoặc ba việc nên làm). Ký ghi một dòng `writing_score_pairs` có đủ trường của gói (lý do sửa, số chú thích giữ/bỏ/thêm, số giây duyệt, người ký, lúc ký).
- **FR-12-F-008** Đồng hồ duyệt đo theo thao tác, tự dừng sau `review_pack.idle_seconds` (mặc định 120) không thao tác.
- **FR-12-F-009** Quá hạn trả: thông báo và thư trễ hạn cho học viên; cách bù theo `review_pack.late_policy` (mặc định đề xuất của tờ: hoàn lượt tự động và vẫn trả phiếu — chờ anh Andy, mục 10 câu F3).
- **FR-12-F-010** Học viên rút lại bài khi giáo viên chưa mở → hoàn lượt; đã mở thì không rút.
- **FR-12-F-011** Khi chỗ mở lại, người từng gặp "đủ chỗ" nhận một thông báo trong ứng dụng, một lần.

## 5. Hợp đồng kỹ thuật

Quy ước chung cho mọi bảng mới: bật RLS, **không** policy cho `authenticated`/`anon` (chỉ backend `supabase_admin`, theo spec 0039); có file `backend/migrations/rollback/<số>_<tên>.sql`; dòng trong `forward-policy.tsv` theo README; test migration trên PG17 theo mẫu các test `test_migration_*` hiện có. Thời gian lưu UTC, so ngày theo `Asia/Ho_Chi_Minh`. Mọi số mặc định ở dưới là **cấu hình**, đọc qua `backend/config.py` (biến môi trường) hoặc `ops_thresholds`/`admin_settings` của G09; không ghi cứng ở chỗ khác.

### 5.0 Bảng số migration (dải 480–489 của GOI-12)

| Số | File | Nội dung | Nhiệm vụ |
|---|---|---|---|
| 480 | `480_writing_score_pairs.sql` | `writing_ai_score_snapshots`, trigger chụp, nạp lại từ dòng AI đang có; `writing_score_pairs`, trigger chỉ ghi thêm; view `writing_score_pairs_latest`; seed cờ `writing_score_pairs_record` | C02 |
| 481 | `481_error_book.sql` | `error_book_entries`, `error_book_evidence`, `error_book_sessions`, `error_book_answers`; seed cờ `error_book_enabled` | A02 |
| 482 | `482_writing_rewrites.sql` | `writing_rewrites`; `writing_essays.library_sample_id`; mở CHECK `credit_ledger.feature`, `credit_reservations.feature`, `credit_reservations.resource_type` thêm `writing_rewrite`; thêm `kind` `rewrite_ready` vào `learner_notifications`; seed cờ | B02 |
| 483 | `483_score_gap_reports.sql` | `writing_score_gap_monthly`, `writing_score_pair_reviews`; khoá `admin_settings` `score_gap_publication`; seed hai cờ | C05 |
| 484 | `484_placement_tests.sql` | `placement_sessions`, `placement_responses`; seed cờ | D03 |
| 485 | `485_weekly_plans.sql` | `weekly_plans`, `weekly_plan_settings`, `weekly_plan_events`; `course_lessons.track` (có kiểm `to_regclass`); seed hai cờ | E02 |
| 486 | `486_weekly_plan_messages.sql` | Mở CHECK `learner_email_outbox.template` (`weekly_summary`, `weekly_inactive`); thêm `kind` `plan_week_new`, `plan_midweek` | E04 |
| 487 | `487_review_pack_products.sql` | Mở CHECK `course_products.kind` (`review_pack`), `credit_ledger.credit_kind` (`teacher_review`); `CREATE OR REPLACE` ba hàm lượt của G04 thêm tham số `p_credit_kind` mặc định `'ai_grading'` (nếu G04 chưa lọc sẵn — K6) | F02 |
| 488 | `488_review_pack_queue.sql` | `review_pack_submissions`, `review_pack_pauses`; thêm `kind` thông báo của F; seed cờ | F03 |
| 489 | `489_writing_blind_review.sql` | Chỉ khi anh Andy chọn làm mẫu chấm mù (`writing_blind_review_samples`) | C08 |

Dải 480–489 dùng đủ 10 số (489 chỉ khi làm C08; không làm thì 489 bỏ trống). Bản Writing của sổ lỗi và mọi migration thêm phải xin số ngoài dải (spec 0095–0099 và migration 490–499 thuộc GOI-13).

Migration số nhỏ không phụ thuộc đối tượng do migration số lớn tạo. 482, 486, 487, 488 sửa CHECK của bảng gói khác: mỗi file bắt đầu bằng kiểm `to_regclass(...)` và ném lỗi rõ nếu bảng chưa có, để không ai áp trước gói gốc.

### 5.C Phần đầu của C — cặp điểm (SCOREPAIR-0088, migration 480)

**`writing_ai_score_snapshots`** (chỉ ghi thêm)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | GENERATED ALWAYS AS IDENTITY PK |
| essay_id | uuid | NOT NULL FK `writing_essays(id)` ON DELETE CASCADE |
| writing_feedback_id | uuid | NOT NULL, index (không FK, vì dòng phản hồi có thể bị `_gc_orphan_versions` xoá mà ảnh chụp phải còn; không UNIQUE, vì một dòng có thể có nhiều ảnh chụp khi chạy lại cùng job) |
| feedback_version | int | NOT NULL |
| source | text | NOT NULL (`ai_pro`, `ai_flash`, hoặc `legacy` khi nạp từ dòng `source` NULL) |
| overall, band_main, band_cc, band_lr, band_gra | numeric(2,1) | `overall` NOT NULL; bốn tiêu chí NULL được (bài AI lỗi một phần) |
| prompt_version_base | text | NOT NULL — `prompt_version` đã bỏ hậu tố `-instructor-pending`, `-instructor`, `-composed` |
| model_used | text | NULL |
| task_type | text | NOT NULL (chép từ `writing_essays.task_type`) |
| legacy | boolean | NOT NULL DEFAULT false — true cho dòng nạp lại mà không chắc là bản AI đầu (trước mig 109) |
| captured_at | timestamptz | NOT NULL DEFAULT now() |

Trigger `trg_writing_feedback_ai_snapshot` AFTER INSERT OR UPDATE OF `overall_band_score, band_main_criterion, band_coherence_cohesion, band_lexical_resource, band_grammatical_range` ON `writing_feedback` FOR EACH ROW WHEN (`NEW.source LIKE 'ai\_%'`; với UPDATE thêm điều kiện ít nhất một cột band `IS DISTINCT FROM` giá trị cũ): INSERT một ảnh chụp. Lý do chụp cả UPDATE: `_bg_grade_essay` (`essay_service.py` dòng 1123–1133) chạy lại cùng `job_id` thì gọi AI lần nữa và UPDATE band của chính dòng đó; nếu chỉ chụp lúc INSERT thì ảnh chụp giữ band của lần chạy trước, khác band người duyệt thấy. UPDATE chỉ đổi `prompt_version` (bước (3) của `deliver`) không tạo ảnh chụp. Hàm trigger `SECURITY DEFINER`, `SET search_path = public, pg_temp` (theo mẫu mig 369). Nạp lại trong cùng migration: INSERT … SELECT mọi dòng `writing_feedback` có `source LIKE 'ai\_%'` hoặc `source IS NULL` mà chưa có ảnh chụp (`WHERE NOT EXISTS`, để chạy lại migration không nhân đôi; dòng NULL ghi `source='legacy'`, `legacy=true`).

**`writing_score_pairs`** (chỉ ghi thêm)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | identity PK |
| essay_id | uuid | NOT NULL FK `writing_essays(id)` ON DELETE CASCADE |
| delivered_at | timestamptz | NOT NULL |
| delivery_key | text | NOT NULL UNIQUE — một lần trả một dòng: `review:<instructor_reviews.id>:<instructor_reviews.delivered_at>` (đường `deliver`; lần gọi lại giống hệt của `deliver` không đổi `instructor_reviews.delivered_at` nên không sinh dòng thứ hai), `essay:<essay_id>:<writing_essays.delivered_at>` (đường admin và đối soát), `pack:<review_pack_submissions.id>` (F) |
| ai_first_snapshot_id | bigint | NULL FK `writing_ai_score_snapshots(id)` — bản AI đầu tiên của bài; NULL khi không còn ảnh chụp |
| ai_before_edit_snapshot_id | bigint | NULL FK — bản AI là cha gần nhất của bản đang hiện (khác bản đầu khi đã chấm lại) |
| teacher_overall, teacher_main, teacher_cc, teacher_lr, teacher_gra | numeric(2,1) | band của bản đang hiện lúc trả |
| current_version, current_source | int, text | bản đang hiện lúc trả (`ai_pro` nghĩa là người duyệt giữ nguyên điểm AI) |
| reviewer_id | uuid | NULL FK `users(id)` ON DELETE SET NULL (`claimed_by` hoặc admin trả) |
| reviewer_role | text | NOT NULL CHECK IN (`admin`,`instructor`,`unknown`) |
| reviewer_can_edit_bands | boolean | NOT NULL — `true` khi người trả là admin, hoặc khi G09 đã mở sửa điểm cho giáo viên (đọc từ hằng `INSTRUCTOR_CAN_EDIT_BANDS` của `services/writing_score_pairs.py`, mặc định `false` theo mã hiện tại) |
| delivery_path | text | NOT NULL CHECK IN (`instructor_review`,`admin_mark_delivered`,`review_pack`,`reconcile`) |
| context | text | NOT NULL CHECK IN (`class_assignment`,`self_practice`,`mock`,`review_pack`,`unknown`) |
| cohort_id | uuid | NULL |
| task_type | text | NOT NULL |
| reconstructed | boolean | NOT NULL DEFAULT false |
| change_reason | jsonb | NULL — F điền `{criterion: lý do}` |
| comments_kept, comments_removed, comments_added | int | NULL — F điền |
| review_active_seconds | int | NULL — F điền |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Index `(essay_id, delivered_at DESC)`, `(delivered_at)`, `(cohort_id, delivered_at)`. Trigger BEFORE UPDATE OR DELETE (row) và BEFORE TRUNCATE (statement) → `RAISE EXCEPTION 'writing_score_pairs_append_only'` (mẫu `credit_ledger` của G04 và mig 356); cùng trigger cho `writing_ai_score_snapshots`. Xoá dây chuyền khi bài bị xoá cứng vẫn chạy vì DELETE do FK cascade thực hiện… **lưu ý:** trigger BEFORE DELETE cũng chặn xoá dây chuyền; vì vậy trigger chỉ chặn khi `pg_trigger_depth() = 1` (xoá trực tiếp), cho qua khi chạy trong dây chuyền (`pg_trigger_depth() > 1`). Test phải có cả hai ca. View `writing_score_pairs_latest` = dòng `delivered_at` mới nhất của mỗi `essay_id`.

Service `backend/services/writing_score_pairs.py`:
- `record_delivery(essay_id: str, *, reviewer_id: str | None, reviewer_role: str, delivery_path: str, delivery_key: str, extra: dict | None = None) -> dict` → `{"status": "recorded"|"duplicate"|"skipped_flag_off"|"no_feedback"|"failed", "pair_id": int | None}`. INSERT … ON CONFLICT (`delivery_key`) DO NOTHING → `duplicate`. Đọc `writing_essays.current_version` và chuỗi tổ tiên của nó trong `writing_feedback` (như `essay_service._ancestor_versions`); ghép ảnh chụp theo `writing_feedback_id` của các dòng trong chuỗi, **không** theo `feedback_version` (số version được dùng lại sau `_gc_orphan_versions`: bản mới lấy `max(live)+1`, `essay_service.py` dòng 1135–1139). `ai_first_snapshot_id` = ảnh chụp sớm nhất của dòng gốc trong chuỗi (không `legacy` nếu có); `ai_before_edit_snapshot_id` = ảnh chụp mới nhất của dòng AI gần nhất trong chuỗi tính từ bản đang hiện (chính bản đang hiện nếu nó là AI). `context`: thi thử khi `writing_essays.sitting_id` không NULL (mig 148); bài lớp khi có `writing_assignments.essay_id = essay_id` (mig 036), lớp = `class_assignments.cohort_id` qua `class_assignment_items.artifact_kind='writing_assignment' AND artifact_id = writing_assignments.id` (mig 177; không có dòng nối thì `cohort_id` NULL); còn lại `self_practice` (`writing_essays` không có cột `writing_assignment_id` hay `class_assignment_item_id` — đã kiểm ở `c3bc71574`). **Không bao giờ ném lỗi** ra bên gọi.
- Gọi từ: `instructor_workflow.deliver` ngay sau bước (2) (bài đã `delivered`; trước bước (3) đổi `prompt_version`), `reviewer_role` lấy từ `users.role` của `instructor_id` vì cả `/instructor/reviews/{id}/deliver` lẫn `/admin/instructor/reviews/{id}/deliver` gọi hàm này; và `admin_writing._deliver_essay` sau khi RPC trả `ok` (thêm tham số `actor_id` cho `_deliver_essay`; `mark_delivered` và `bulk_mark_delivered` truyền id từ `require_admin`). `essay_service.deliver_reviewed_essay` (trả bài thi thử) không gọi: thi thử ngoài phạm vi đo (mục 10 câu C5), đối soát cũng bỏ qua bài có `sitting_id`. Bên gọi không đổi hành vi nào khác.
- Script `backend/scripts/writing_score_pairs_reconcile.py`: mặc định dry-run; `--execute` ghi; `--since <ngày>`; `--report` in số cặp theo tháng, theo `reviewer_role`, số bài bỏ qua kèm lý do. Hai việc: ghi bù bài `delivered` sau khi bật cờ mà chưa có cặp; dựng lại cặp cho bài trả trước khi bật cờ (`reconstructed=true`, `delivery_path='reconcile'`). "Chưa có cặp" = không có dòng nào của bài có `delivered_at` không sớm hơn `writing_essays.delivered_at` quá 5 phút (bước (2) của `deliver` đặt lại `writing_essays.delivered_at` mỗi lần gọi lại); dòng ghi bù dùng `delivery_key` `essay:<essay_id>:<writing_essays.delivered_at>`. Bỏ qua bài có `sitting_id`. Không in email, tên học viên.
- Cron: `backend/railway.score-pairs-reconcile.json` (chép khuôn `backend/railway.staff-security-sweep.json`), 02:30 giờ VN mỗi ngày; tạo service cron trên Railway là việc của anh Andy.

### 5.A Sổ lỗi cá nhân (ERRORBOOK-0089, migration 481)

**Bảng**

`error_book_entries`: `id uuid PK`, `user_id uuid NOT NULL FK users ON DELETE CASCADE`, `source_kind text NOT NULL CHECK IN ('grammar')` (Writing thêm ở spec sau), `group_key text NOT NULL` (mã `truc_nhom`), `status text NOT NULL CHECK IN ('active','mastered')`, `stage smallint NOT NULL CHECK BETWEEN 1 AND 3`, `due_on date NOT NULL`, `deferred_until date NULL`, `opened_at timestamptz NOT NULL`, `mastered_at timestamptz NULL`, `reopened_at timestamptz NULL`, `reopen_count int NOT NULL DEFAULT 0`, `last_reviewed_on date NULL`, `updated_at`; UNIQUE `(user_id, source_kind, group_key)`; index `(user_id, status, due_on)`.

`error_book_evidence`: `entry_id uuid FK ON DELETE CASCADE`, `quiz_attempt_id uuid NOT NULL`, `bank_id uuid`, `qid text`, `answered_at timestamptz`, `reason text CHECK IN ('open','reopen','wrong_again')`, PK `(entry_id, quiz_attempt_id)`.

`error_book_sessions`: `id uuid PK`, `entry_id uuid FK`, `user_id uuid`, `stage_at_start smallint`, `items jsonb NOT NULL` (mảng `{n, qid, bank_id, kind: 'mcq'|'rewrite', option_order: [..], seen_before: bool}`; không chứa đáp án), `status text CHECK IN ('open','finished','abandoned')`, `outcome text NULL CHECK IN ('advance','stay','back','mastered')`, `correct int`, `total int`, `started_at`, `finished_at`; UNIQUE một phiên `open` mỗi mục (`(entry_id) WHERE status='open'`).

`error_book_answers`: `session_id uuid FK ON DELETE CASCADE`, `n smallint`, `try_no smallint CHECK IN (1,2)`, `answer text`, `is_correct boolean`, `answered_at`, PK `(session_id, n, try_no)`.

**Nội dung kèm (không phải migration):**
- `backend/content/course-labels/truc_nhom_vi.json` của G09-T27 (dùng chung).
- `backend/content/course-labels/truc_nhom_wiki.json` (mới): `{ "<mã>": {"grammar_category": "...", "grammar_slug": "...", "anchor": "chua-loi" | null, "figure_id": "..." | null} }`; giáo viên duyệt một lần; mã không có trong file → không có liên kết.
- `backend/content/error-book/rewrite_items.jsonl` (mới): mỗi dòng `{bank_code, qid, wrong_sentence_by_option: {"<chỉ số>": "<câu sai do chọn phương án đó>"}, correct_sentence, accepted: [..]}`; soạn bằng script hỗ trợ rồi giáo viên duyệt; câu không có dòng thì không có câu viết lại.

**Lập mục:** `services/error_book.py::sync_user(user_id, *, now)`: đọc `quiz_attempts` của người đó ở bank `skill_area='course'` từ mốc `error_book_entries.updated_at` gần nhất (hoặc toàn bộ lần đầu), nối `quiz_questions` lấy `skill`; áp FR-12-A-002, A-003, A-005. Gọi (1) ngay sau khi một phiên `quiz_sessions` của bank Course kết thúc (điểm móc: hàm chốt phiên trong `quiz_service` — `CHƯA KIỂM` tên hàm: `grep -n "ended_by\|def .*finish\|def .*complete" backend/services/quiz_service.py | head -20`), chạy nền, lỗi không chặn việc nộp bài; (2) tác vụ đêm `backend/scripts/error_book_sweep.py` (dry-run mặc định) quét người có câu trả lời mới trong 48 giờ.

**API học viên** — `backend/routers/error_book.py`, prefix `/api/error-book`, sau `require_flag("error_book_enabled", default=False)`, đi qua cổng kích hoạt như route học viên khác:

| Method · path | Vào | Ra | Lỗi |
|---|---|---|---|
| GET `/summary` | — | `{"enabled": bool, "has_entries": bool, "due_today": {"entries": 3, "questions": 12, "minutes": 10} \| null, "deferred_today": 1, "next_due": {"date": "2026-11-19", "entries": 2} \| null, "done_today": {"entries": 3, "advanced": 2, "stayed": 1} \| null, "counts": {"due": 3, "tracking": 4, "mastered": 2, "all": 9}, "top": EntryBrief \| null}` | 401 |
| GET `/entries` | `?filter=due\|tracking\|mastered\|all` | `{"items": [EntryBrief]}` | 422 `invalid_filter` |
| GET `/entries/{id}` | — | `EntryDetail` | 404 `entry_not_found` (của người khác cũng 404) |
| POST `/entries/{id}/defer` | `{}` | `{"id", "deferred_until"}` | 404 |
| POST `/defer-today` | `{}` | `{"deferred": int}` | — |
| POST `/sessions` | `{"entry_id"}` | `{"session_id", "entry": EntryBrief, "items": [{"n", "kind", "prompt", "options" \| null, "seen_before", "your_old_sentence" \| null}]}` | 404; 409 `not_due` (chưa đến hạn và không phải "ôn sớm" — mặc định cho ôn sớm, mục 10 câu A7) |
| POST `/sessions/{id}/answers` | `{"n", "choice": int \| null, "text": str \| null}` | `{"n", "correct": bool, "try_no", "final": bool, "explain", "why_wrong" \| null, "diff": [{"start", "end"}] \| null, "correct_text" \| null, "wiki": {"href", "title"} \| null, "figure_id" \| null}` | 409 `already_answered`; 422 |
| POST `/sessions/{id}/finish` | `{}` | `{"correct", "total", "outcome", "stage_after", "next_due_on" \| null, "mastered": bool}` | 409 `missing_answers` |

`EntryBrief` = `{"id", "label" (tên tiếng Việt), "source_label" ("Ngữ pháp B13"), "stage", "status", "due_on", "wrong_questions", "source_count", "latest_wrong_sentence" \| null, "next_label"}`. `EntryDetail` thêm `"wrongs": [{"source_label", "answered_on", "attempt_label", "seconds", "sentence", "your_choice_text"}]`, `"history": [...]`, `"monthly": {"enough": bool, "months": [{"month", "seen", "wrong"}], "missing_note" \| null}`, `"wiki"`. Không trường nào chứa mã nhóm, `qid`, `bank_id`.

**Hàm cho G07** — `services/error_book.py::today_block(user_id: str) -> dict | None`:
```json
{
  "label": "Quá khứ với did: động từ về nguyên mẫu",
  "count": 3,
  "of": 2,
  "unit": "question",
  "review_href": "/practice/error-book/review?entry=<id>",
  "list_href": "/practice/error-book",
  "total_errors": 9,
  "due_entries": 3,
  "due_questions": 12,
  "due_minutes": 10,
  "next_due": {"date": "2026-11-19", "entries": 2},
  "state": "due"
}
```
`label`, `count` (số câu sai), `of` (số bài nguồn) là của mục "sai nhiều nhất" trong các mục đến hạn (không có mục đến hạn → mục đang theo dõi sai nhiều nhất); `state` ∈ `due` (có mục đến hạn), `not_due` (có mục, hôm nay không đến hạn; `review_href` = null), `done_today` (đã ôn xong hôm nay; `due_entries` = số đã ôn). Trả `None` khi cờ tắt, người đó không có mục nào, hoặc lỗi (ghi log). Giao diện ẩn khối khi `None`. Đơn vị phút: `ERROR_BOOK_MINUTES_PER_QUESTION` (mặc định 0.8, làm tròn lên).

**API giáo viên** — thêm vào `backend/routers/admin_class_assignments.py` (hoặc router lớp mà G09 dùng): GET `/admin/cohorts/{cohort_id}/error-book` → `{"cohort", "learners": 14, "with_entries": 11, "never_opened": 3, "groups": [{"label", "active_people", "mastered_people", "wrong_after_review_people", "stuck_twice": [{"student_id", "name", "entries"}], "sources": [{"label", "assignment_id"}]}]}`. Kiểm phạm vi bằng `services/staff_scope.py` của G09-T24; lớp khác → 404.

**Frontend:** `frontend/app/(authed-practice)/practice/error-book/page.tsx` (danh sách, bốn bộ lọc, mặc định "Cần ôn hôm nay"), `…/error-book/[entryId]/page.tsx` (chi tiết), `…/error-book/review/page.tsx` (phiên, `?entry=`); component trong `frontend/components/error-book/`; đăng ký trang vào danh mục trang của G03/G07 với trang cha `/practice`; khối lớp trong trang lớp admin và khung giáo viên.

**Cấu hình:** `ERROR_BOOK_OPEN_MIN_WRONG=2`, `ERROR_BOOK_REOPEN_MIN_WRONG=2`, `ERROR_BOOK_STAGE_DAYS=2,7,21`, `ERROR_BOOK_DAILY_CAP=3`, `ERROR_BOOK_ITEMS_PER_SESSION=4`, `ERROR_BOOK_PASS_RULE=all_correct|allow_one_mcq_wrong`, `ERROR_BOOK_CHART_MIN_PER_MONTH=5`, `ERROR_BOOK_MINUTES_PER_QUESTION=0.8`, `ERROR_BOOK_CONTRACTIONS` (file `backend/content/error-book/contractions.json`).

**Sự kiện log:** `[error-book] step=sync user=<uuid> opened=<n> reopened=<n>`; `[error-book] session=<uuid> outcome=<x>`. Không ghi email, tên.

### 5.B Viết lại sau khi chấm (REWRITE-0090, migration 482)

**`writing_rewrites`**: `id uuid PK`, `essay_id uuid NOT NULL FK writing_essays ON DELETE CASCADE`, `user_id uuid NOT NULL`, `paragraph_index smallint NOT NULL` (0-based theo FR-12-B-002), `attempt_no smallint NOT NULL CHECK (attempt_no >= 1)` (trần `REWRITE_MAX_PER_PARAGRAPH` là cấu hình, kiểm ở service), `body text NOT NULL`, `word_count int NOT NULL`, `status text NOT NULL CHECK IN ('draft','submitted','comparing','done','failed')`, `credit_charged boolean NOT NULL DEFAULT false`, `reservation_id uuid NULL`, `is_free_first boolean NOT NULL DEFAULT false`, `opened_samples_before boolean NOT NULL DEFAULT false`, `result jsonb NULL` (`{"comments": [{"comment_index", "label", "quote"}], "new_errors": [{"quote", "criterion", "explanation"}], "sample_overlap": [{"quote"}]}`), `stand_result jsonb NULL`, `model_used text NULL`, `prompt_version text NULL`, `cost_usd numeric NULL`, `teacher_note text NULL`, `teacher_note_by uuid NULL`, `submitted_at`, `done_at`, `created_at`; UNIQUE `(essay_id, paragraph_index, attempt_no)`; UNIQUE một dòng `draft` mỗi `(essay_id, paragraph_index)`.

`writing_essays.library_sample_id uuid NULL` (FK `writing_samples(id)` ON DELETE SET NULL, chỉ thêm khi `to_regclass('public.writing_samples')` có; không có thì để cột không FK và ghi NOTICE).

Mở CHECK `credit_ledger.feature`, `credit_reservations.feature` thêm `writing_rewrite` và `credit_reservations.resource_type` thêm `writing_rewrite`; `fn_credit_reserve` map `writing_rewrite → writing` (sửa bằng `CREATE OR REPLACE` giữ nguyên chữ ký nếu G04 chưa có sẵn map mở rộng được; ghi trong PR).

**API** — `backend/routers/writing_rewrite.py`, prefix `/api/writing/essays/{essay_id}/rewrites`, sau `require_flag("writing_rewrite_enabled", default=False)`, chỉ chủ bài:

| Method · path | Vào | Ra | Lỗi |
|---|---|---|---|
| GET `` | — | `{"paragraphs": [{"index", "kind_label" ("Mở bài"/"Thân bài 1"…), "text", "comments": [{"comment_index", "criterion", "quote", "explanation"}], "rewrites": [RewriteBrief], "can_rewrite": bool, "remaining_attempts"}], "general_comments": [...], "credit_rule": {"mode": "first_free"\|"always", "next_cost": 0\|1, "source": "online"\|"class"}, "sample": {"available": bool, "slug" \| null}}` | 404; 409 `not_delivered` |
| PUT `/draft` | `{"paragraph_index", "body"}` | `{"id", "word_count"}` | 422 `too_long` |
| POST `` | `{"paragraph_index", "body", "opened_samples_before": bool}` | 202 `{"id", "status": "comparing"}` | 402 `insufficient_credits` (kèm `credit_source`, theo G04); 409 `max_attempts`; 422 `too_long`, `unchanged` |
| GET `/{rewrite_id}` | — | `Rewrite` (bản 1, bản 2, `result`, nhãn tổng "x đã xử lý · y còn · z lỗi mới", `opened_samples_before`) | 404 |
| POST `/{rewrite_id}/stand` | `{}` | `{"criterion", "criterion_band", "rows": [{"task", "you", "b60", "b70", "b75"}], "differences": [{"key", "quote_70", "your_note"}], "samples": {"6.0": "...", "7.0": "...", "7.5": "..."}}` | 409 `no_sample`, `not_done` (bản viết lại chưa có kết quả đối chiếu) (mặc định tạm 18/11, chờ anh Andy xác nhận). "Mở bài mẫu ngay" (FR-12-B-008) chỉ mở trang bài mẫu của Thư viện, không gọi `stand` |
| POST `/{rewrite_id}/teacher-note` (route giáo viên, prefix `/instructor` hoặc `/admin/writing` theo G09) | `{"note"}` | `{"id"}` | 404 ngoài phạm vi lớp (`staff_scope`, như API giáo viên của A và FR-09-113) |

**Lời gọi AI** — `backend/services/writing_rewrite_ai.py`: `compare_rewrite(original_paragraph, comments, rewrite) -> CompareResult` và `stand_against_samples(paragraph, sample_paragraphs, criterion) -> StandResult`; đầu ra JSON theo khuôn Pydantic bắt buộc; mọi lời gọi qua `ai_usage_logger`; prompt đặt ở `backend/prompts/writing_rewrite/` (`CHƯA KIỂM` thư mục prompt hiện có: `ls backend/prompts backend/services/prompts 2>/dev/null`); mô hình và trần chi phí là cấu hình (`REWRITE_MODEL`, `REWRITE_MAX_USD_PER_CALL`). Kiểm câu trích ở máy chủ: chuẩn hoá khoảng trắng và dấu nháy, so chuỗi con. Test dùng provider giả, không gọi AI thật.

**Lượt:** gọi `credits.acharge_plan(user_id, "writing_grading")` của G04 để biết có tính lượt không; nếu `REWRITE_CREDIT_MODE='first_free'` và bài chưa có bản viết lại nào `done` với `is_free_first=true` → không giữ chỗ; ngược lại `plan = await credits.acharge_plan(user_id, "writing_grading", assignment=<bài giao nếu có>)` rồi `credits.reserve(user_id, "writing_rewrite", request_key=<rewrite_id>, resource_type='writing_rewrite', resource_id=<rewrite_id>, ttl_seconds=CREDIT_HOLD_TTL_WRITING_S, course_ids=plan.course_ids, kinds=plan.kinds)`; số lượt do `reserve` tự lấy theo `feature` từ cấu hình mới `CREDIT_COST_WRITING_REWRITE` (mặc định 1, thêm vào bảng cấu hình G04 mục 5.10 cùng PR B03), thay cho `REWRITE_CREDIT_COST` (tên hằng TTL theo hằng Writing có sẵn của G04 mục 5.10; kiểm khi làm), chốt khi có kết quả, hoàn khi AI lỗi. Trần chi phí bản miễn lượt: `REWRITE_FREE_MONTHLY_USD` (mặc định `null` = không trần; khi vượt thì bản miễn lượt chuyển sang tính lượt và ghi log cảnh báo).

**Gắn bài mẫu:** `services/writing_rewrite.py::sample_for_essay(essay)`: dùng `library_sample_id` nếu có; không có thì so `prompt_text` chuẩn hoá (chữ thường, bỏ khoảng trắng thừa) với `writing_samples.prompt_text` đã xuất bản, chỉ nhận khi khớp đúng một bộ.

**Cấu hình:** `REWRITE_CREDIT_MODE=first_free`, `CREDIT_COST_WRITING_REWRITE=1` (cấu hình của G04, thay `REWRITE_CREDIT_COST`), `REWRITE_MAX_WORDS=140`, `REWRITE_MAX_PER_PARAGRAPH=3`, `REWRITE_MIN_CHANGE_RATIO=0.95`, `REWRITE_SAMPLE_OVERLAP_WORDS=8`, `REWRITE_SAMPLE_LOCK=soft|hard` (mặc định `soft`), `REWRITE_CLASS_REVIEW=instant|teacher` (mặc định `instant`), `REWRITE_FREE_MONTHLY_USD=null`.

### 5.C' Phần sau của C — độ lệch (SCOREGAP-0091, migration 483)

`writing_score_gap_monthly`: `period_start date`, `period_end date`, `month date`, `criterion text CHECK IN ('overall','main','cc','lr','gra')`, `task_type text`, `cohort_id uuid NULL` (NULL = mọi lớp), `scoring_version text` (`prompt_version_base` + `model_used`), `n int`, `mean_abs numeric`, `within_half_pct numeric`, `ai_higher_pct`, `ai_lower_pct`, `equal_pct`, `computed_at`; PK `(period_start, month, criterion, task_type, coalesce(cohort_id, '00000000-0000-0000-0000-000000000000'), scoring_version)`. Ghi đè mỗi đêm (bảng tổng hợp, không phải dữ liệu gốc).

`writing_score_pair_reviews`: `pair_id bigint PK FK writing_score_pairs`, `reviewed_by uuid`, `reviewed_at`, `note text NULL ≤ 1000`.

Khoá `admin_settings` `score_gap_publication`: `{"published": false, "published_at": null, "limitations_md": "", "weak_points_md": "", "period_months": 6}`; mọi lần đổi ghi `admin_settings_log` có lý do. Ngưỡng mới thêm vào `ops_thresholds` của G09 (bằng UPDATE gộp jsonb trong 483, không sửa 440): `score_gap_review_band` (1.0, khoảng 0.5–3.0), `score_gap_publish_min_papers` (50, 10–1000), `score_gap_publish_max_mean` (0.5, 0.1–2.0), `score_gap_row_min_papers` (30, 5–500); khoá và khoảng cũng phải đăng ký trong `services/ops_thresholds.py` và có dòng ở bảng GOI-09 mục 5.6 (đã thêm 18/11, ghi "chỉ nạp khi phần đó được mở").

API admin (`backend/routers/admin_score_gap.py`, prefix `/admin/writing/score-gap`, cờ `score_gap_admin`): GET `/summary?period=&cohort_id=&task=` (giáo viên: chỉ lớp mình); GET `/pairs?min_gap=&reviewed=` (danh sách bài lệch); POST `/pairs/{id}/reviewed`; GET · PUT `/publication` (chỉ admin; PUT kiểm bốn điều kiện, thiếu điều kiện → 409 `publish_conditions` kèm danh sách điều kiện chưa đạt). API công khai (`backend/routers/public_score_gap.py`, cờ `score_gap_public`, miễn cổng kích hoạt): GET `/api/public/score-gap` → 404 khi chưa công bố. Tác vụ `backend/scripts/score_gap_rollup.py` chạy sau `writing_score_pairs_reconcile`.

### 5.D Kiểm tra đầu vào (PLACEMENT-0092, migration 484)

Quyết định kỹ thuật: **không** sửa bảng và CHECK của spec 0003. Bài đầu vào có bảng riêng và chỉ **đọc** `grammar_items` của release đang hoạt động. Lý do: `grammar_diagnostic_sessions` đang ràng buộc 28/54 câu và quy tắc bài giao, đổi nó là đổi một spec high-risk đang `implementing` cho một tính năng chưa lên lịch.

`placement_sessions`: `id uuid PK`, `user_id uuid NOT NULL FK users ON DELETE CASCADE`, `form_id text NOT NULL`, `rule_version text NOT NULL`, `status text CHECK IN ('in_progress','completed','expired')`, `current_part text CHECK IN ('grammar','reading','listening','optional','done')`, `skipped_parts text[] NOT NULL DEFAULT '{}'`, `listening_plays smallint NOT NULL DEFAULT 0`, `optional_kind text NULL CHECK IN ('writing','speaking')`, `optional_trial_ref text NULL`, `result jsonb NULL` (nhóm, đọc, nghe, phần 4, gợi ý — bất biến sau `completed`), `suggested_product_slug text NULL`, `started_at`, `completed_at`, `expires_at`; UNIQUE một phiên `in_progress` mỗi người.

`placement_responses`: `session_id uuid FK ON DELETE CASCADE`, `part text`, `item_ref text` (`item_id` của `grammar_items` hoặc mã câu trong form), `choice smallint NULL`, `unsure boolean NOT NULL DEFAULT false`, `is_correct boolean NOT NULL`, `answered_at`; PK `(session_id, item_ref)`; trả lời lại cùng câu với lựa chọn khác → 409 (bất biến như 0003 FR-003).

Nội dung: `backend/content/placement/forms/<form_id>.json` (`grammar: [{item_id, group_label}] ×18`, `reading: {passage, items: [{id, prompt, options, answer, tag: 'main_idea'|'detail'|'long_sentence'}]}`, `listening: {audio_path, transcript_hidden, items: [...]}`), `backend/content/placement/rules-v1.json`; script kiểm `backend/scripts/validate_placement_forms.py` (mỗi `item_id` có trong release đang hoạt động; đủ 6 nhóm × 3; không trùng câu giữa các bộ; audio tồn tại). Audio để ở bucket của G06 (`library-public`) hoặc bucket audio hiện có — `CHƯA KIỂM` bucket nào dùng cho Listening: `grep -rn "bucket" backend/services/listening*.py | head`.

API học viên `backend/routers/placement.py`, prefix `/api/placement`, cờ `placement_test_enabled`; **miễn cổng kích hoạt** (tài khoản chưa có khoá cần làm được; route chỉ đọc/ghi dữ liệu của chính người gọi):

| Method · path | Ra |
|---|---|
| GET `/status` | `{"state": "not_started"\|"in_progress"\|"completed"\|"disabled", "progress": {...} \| null, "keep_until" \| null, "retake_from" \| null, "suggested": {"slug", "title"} \| null, "has_course": bool}` |
| POST `/sessions` | phiên mới hoặc phiên đang dở (409 `retake_too_soon` kèm `retake_from`) |
| GET `/sessions/{id}/next` | câu kế tiếp, không đáp án |
| POST `/sessions/{id}/responses` | `{"item_ref", "choice" \| null, "unsure"}` → `{"saved": true}` (không trả đúng/sai giữa bài) |
| POST `/sessions/{id}/listening/play` | tăng `listening_plays`, 409 khi đã 2 lần |
| POST `/sessions/{id}/skip` | `{"part": "listening"\|"optional"}` |
| POST `/sessions/{id}/optional` | `{"kind", "text" \| "audio_ref"}` → gọi chấm thử GOI-11 chế độ `text_feedback_only`; 409 `trial_unavailable` kèm lý do |
| POST `/sessions/{id}/complete` | kết quả bất biến + gợi ý |
| GET `/sessions/{id}/result` | kết quả; `review`: các câu sai kèm bài Grammar Wiki (không cho tải đề) |

API admin: GET `/admin/reports/placement-funnel?days=30` (thêm vào router Báo cáo của G09-T41) — bảy bước, "rơi ở đâu", phần tuỳ chọn; nhóm dưới `report_min_group_size` (khoá `ops_thresholds` mới, mặc định 10; nếu G09 đã có khoá tương đương thì dùng khoá đó) chỉ trả số đếm. Ba ô Cài đặt › Tính năng: `placement_test_enabled` (cờ), `placement_retake_days` (mặc định `null` = chưa cho làm lại, chờ anh Andy), `placement_keep_days` (mặc định 7, đề xuất), lưu ở `admin_settings` khoá `placement`.

Thời lượng và số câu: `PLACEMENT_GRAMMAR_ITEMS=18`, `PLACEMENT_GROUPS=6`, `PLACEMENT_READING_ITEMS=6`, `PLACEMENT_LISTENING_ITEMS=6`, `PLACEMENT_LISTENING_MAX_PLAYS=2`, `PLACEMENT_ORDER_WINDOW_DAYS` (mặc định 14, đề xuất), `PLACEMENT_EXPIRE_NOTICE_DAYS=1`.

### 5.E Nhắc việc và thư tuần (WEEKLYPLAN-0093, migration 485, 486)

`weekly_plans`: `user_id uuid`, `week_start date` (Thứ Hai), `kind text CHECK IN ('online','class','mixed')`, `pace text NULL CHECK IN ('light','medium','heavy','exam_date')`, `items jsonb NOT NULL` (mảng `{key, type: 'lesson'|'writing'|'review'|'assigned', ref, title, minutes, due_at \| null, done_at \| null, partial_stop \| null}`), `planned int`, `done int`, `rule_version text`, `generated_at`, `updated_at`; PK `(user_id, week_start)`.

`weekly_plan_settings`: `user_id uuid PK`, `pace text`, `reduced boolean DEFAULT false`, `inapp_new_week boolean DEFAULT true`, `inapp_midweek boolean DEFAULT true`, `email_midweek boolean DEFAULT false`, `digest_enabled boolean DEFAULT true`, `digest_dow smallint DEFAULT 7`, `digest_time time DEFAULT '19:00'`, `midweek_dow smallint DEFAULT 4`, `midweek_time time DEFAULT '19:00'`, `paused_until date NULL`, `slow_prompt_snoozed_until date NULL`, `inactive_mail_streak smallint DEFAULT 0`, `updated_at`. Không có dòng = mặc định.

`weekly_plan_events` (chỉ ghi thêm): `id`, `user_id`, `kind text CHECK IN ('pace_changed','reduced','shifted','kept','paused','resumed','unsubscribed','resubscribed')`, `before jsonb`, `after jsonb`, `created_at`.

`course_lessons.track text NULL CHECK IN ('core','extension')` (NULL = chưa gắn; khoá có bài NULL thì không có "Giảm tải").

486: CHECK `learner_email_outbox.template` thêm `weekly_summary`, `weekly_inactive`; payload cho phép: `week_label, course_title, done, planned, blocks, next_tasks[≤3], repeat_error_label, repeat_error_count, primary_href, unsubscribe_token` — không band, không nội dung bài. `dedupe_key`: `week:<user_id>:<week_start>` (một thư một tuần cho cả hai mẫu). Thông báo `plan_week_new` (`dedupe_key` `plan:<user>:<week_start>:new`), `plan_midweek` (`…:mid`).

Service `backend/services/weekly_plan.py`: `build_week(user_id, week_start, *, now) -> WeeklyPlan`; `arrange_for_budget(plan, minutes) -> list` (hàm thuần, frontend gọi qua API, không lưu); `slow_status(user_id) -> dict | None`. Nguồn việc: bài lộ trình kế tiếp (`course_lessons`, `course_lesson_progress` của G07), bài giao (`_visible_assignments` qua hàm bọc như G07 mục 5.3), lượt ôn lỗi (số mục từ `services/error_book.py`, cùng nguồn với `GET /api/error-book/summary`; chỉ khi A bật), bài viết của tuần (một đề gợi ý từ hub Writing của G07). Mục tiêu và ngày thi: theo nguồn G07 chọn (K7).

API `backend/routers/weekly_plan.py`, prefix `/api/plan`, cờ `weekly_plan_enabled`: GET `/week` (thẻ Hôm nay: `{"week_label", "planned", "done", "remaining_minutes", "why", "last_week", "items", "slow": {...} \| null, "expiry_warning": {...} \| null, "pace", "no_exam_date": bool}`), GET `/week/arrange?minutes=15|30|60`, POST `/adjust` (`{"choice": "reduce"|"shift"|"keep"|"later"}`), PATCH `/settings`, GET `/settings`. Thư: `GET /api/email/unsubscribe?t=<token>` (trang xác nhận, miễn đăng nhập và cổng kích hoạt), `POST /api/email/unsubscribe?t=<token>` (nhận token ở tham số `t` hoặc thân `{"t"}`; cũng nhận thân form `List-Unsubscribe=One-Click` mà hộp thư gửi thẳng tới URL trong header theo RFC 8058 → tắt `digest_enabled`, ghi sự kiện; header `List-Unsubscribe` trỏ vào chính URL này), `POST /api/email/resubscribe` (cần đăng nhập). Token = HMAC-SHA256 (`EMAIL_UNSUBSCRIBE_SECRET`, biến môi trường mới) của `user_id|list|issued_at`, không hết hạn, đổi bí mật thì token cũ vô hiệu.

Tác vụ `backend/scripts/weekly_plan_sweep.py` (cron mỗi giờ, `backend/railway.weekly-plan-sweep.json`): bước `build` (Thứ Hai), `midweek` (theo `midweek_dow/time` từng người, chỉ khi còn việc), `digest` (theo `digest_dow/time`, xếp vào outbox của G04), `purge` (kế hoạch cũ hơn 26 tuần). Cờ `--dry-run`, `--step`. Thư chỉ khi cờ `weekly_digest_emails` bật.

Ngưỡng (`admin_settings` khoá `weekly_plan`): `slow_weeks=2`, `slow_ratio=0.5`, `inactive_max_weeks=2`, `writing_per_week=1`, `review_per_week=2`, `default_pace='medium'`.

### 5.F Gói giáo viên chấm (REVIEWPACK-0094, migration 487, 488)

487: CHECK `course_products.kind` thêm `review_pack` (sản phẩm `review_pack`: `features = '{writing}'`, `ai_credits` = số lượt giáo viên chấm của gói, `is_public` được bật như `online`); CHECK `credit_ledger.credit_kind` thêm `teacher_review`; hàm cấp lượt khi xác nhận đơn của G04 ghi `credit_kind='teacher_review'` cho sản phẩm `review_pack`; mọi hàm tổng lượt AI lọc `credit_kind='ai_grading'` (K6). `GET /api/me/credits` của G04 thêm `teacher_review: {total, usable_until}` (không cộng vào `total`). `credit_reservations.feature` thêm `teacher_review`; `fn_credit_reserve` nhận `p_credit_kind` (mặc định `ai_grading`), chỉ cộng dòng sổ cùng `credit_kind` khi tính số dư dùng được, và ghi `credit_kind` vào dòng `reserve`/`release`; test: chấm Writing AI khi người đó chỉ có lượt gói → `insufficient_credits`, không trừ lượt gói (sửa 18/11 theo rà soát).

488: `review_pack_submissions`: `id uuid PK`, `essay_id uuid UNIQUE FK writing_essays`, `user_id`, `entitlement_id`, `reservation_id`, `week_start date`, `learner_note text NULL ≤ 1000`, `status text CHECK IN ('queued','in_review','returned','withdrawn')`, `due_at timestamptz NOT NULL`, `late boolean NOT NULL DEFAULT false`, `late_notified_at`, `refunded_at`, `opened_by_teacher_at`, `returned_at`, `created_at`; index `(status, due_at)`, `(week_start)`. `review_pack_pauses`: `id`, `starts_on date`, `ends_on date`, `reason text`, `created_by`, `created_at`, `cancelled_at`. Cấu hình ở `admin_settings` khoá `review_pack`: `{"weekly_cap": 8, "turnaround_business_days": null, "holidays": [], "accepting": true, "late_policy": "refund_and_return", "allow_admin_overcap": true, "teacher_can_pause": true, "idle_seconds": 120}`; mọi lần đổi ghi `admin_settings_log` (nhật ký từng lần đổi theo tờ). Hai ngưỡng mới `review_pack_due_soon_hours` (12), `review_pack_on_time_min_pct` (90) thêm vào `ops_thresholds`.

API học viên `backend/routers/review_pack.py`, prefix `/api/review-pack`, cờ `review_pack_enabled`: GET `/offer` (trạng thái gói: `open`/`full`/`paused`/`you_have_pack`/`not_eligible`, số chỗ còn — chỉ câu chữ, không số trần), POST `/submissions` (`{"essay_id", "note"}` — bài đã có kết quả AI thì không trừ thêm lượt AI; trừ 1 lượt giáo viên chấm; 409 `week_full` kèm `reopens_on`), GET `/submissions`, GET `/submissions/{id}`, POST `/submissions/{id}/withdraw` (409 `already_opened`). API giáo viên/admin: thêm nguồn `review_pack` vào `essay-queue` của G09-T17 (`source=review_pack`, sắp theo `due_at`), POST `/admin/review-pack/submissions/{id}/open`, POST `/…/heartbeat` (đồng hồ: cộng giây khi có thao tác trong `review_pack.idle_seconds`), POST `/…/sign` (kiểm FR-12-F-007, gọi `writing_score_pairs.record_delivery(..., delivery_path='review_pack', extra={...})` rồi trả bài), GET · PUT `/admin/review-pack/settings`, POST `/admin/review-pack/pauses`, GET `/admin/review-pack/stats?weeks=8`. Tác vụ `backend/scripts/review_pack_sweep.py` (mỗi 15 phút): đánh dấu sắp trễ (Việc cần làm), quá hạn → thông báo, thư, áp `late_policy`; chỗ mở lại → thông báo `review_pack_reopened` một lần cho người từng gặp "đủ chỗ".

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

Mỗi nhiệm vụ một PR, nhánh `codex/g12-<mã>` từ `origin/staging`. Mọi nhiệm vụ có mã: chạy bộ test của tầng bị ảnh hưởng theo 00 mục 5. Không nhiệm vụ nào gọi AI thật trong test.

### Bảng nhiệm vụ

| Mã | Tên | Phần | Phiên | Độ khó |
|---|---|---|---|---|
| G12-C01 | Spec SCOREPAIR-0088 | C (sớm) | 1 | 2 |
| G12-C02 | Migration 480: ảnh chụp điểm AI và bảng cặp điểm bất biến | C (sớm) | 2 | 4 |
| G12-C03 | Ghi cặp điểm khi trả bài + đối soát hằng đêm + dựng lại lịch sử | C (sớm) | 2 | 4 |
| G12-A01 | Spec ERRORBOOK-0089 | A | 1 | 2 |
| G12-A02 | Migration 481, nhãn và ánh xạ, lập mục từ bài làm | A | 3 | 4 |
| G12-A03 | Bộ chọn câu, phiên ôn, chấm câu viết lại | A | 3 | 4 |
| G12-A04 | API tóm tắt, danh sách, chi tiết; hàm `today_block` cho G07 | A | 2 | 3 |
| G12-A05 | Trang Sổ lỗi, chi tiết mục, phiên ôn (1280px và 390px) | A | 3 | 3 |
| G12-A06 | Khối "Sổ lỗi của lớp" cho giáo viên | A | 2 | 3 |
| G12-B01 | Spec REWRITE-0090 | B | 1 | 2 |
| G12-B02 | Migration 482, chia đoạn, gắn nhận xét, gắn bài mẫu | B | 2 | 4 |
| G12-B03 | Nộp bản viết lại, AI đối chiếu, kiểm câu trích, lượt | B | 3 | 5 |
| G12-B04 | "Bài của tôi đứng đâu" và kiểm trùng bài mẫu | B | 2 | 4 |
| G12-B05 | Giao diện viết lại, kết quả, đứng đâu, trạng thái | B | 3 | 3 |
| G12-B06 | Dòng "đã viết lại" và lời nhắn của giáo viên | B | 1 | 2 |
| G12-D01 | Spec PLACEMENT-0092 | D | 1 | 2 |
| G12-D02 | Nội dung: 2–3 bộ đề, quy tắc v1, script kiểm | D | 2 | 3 |
| G12-D03 | Migration 484, API phiên, chấm, quy tắc gợi ý | D | 3 | 4 |
| G12-D04 | Giao diện lối vào, giới thiệu, ba phần, kết quả, trạng thái | D | 3 | 3 |
| G12-D05 | Phần 4 tuỳ chọn qua chấm thử (nhận xét chữ, không band) | D | 2 | 4 |
| G12-D06 | Khối phễu ở Báo cáo và ba ô Cài đặt | D | 2 | 3 |
| G12-E01 | Spec WEEKLYPLAN-0093 | E | 1 | 2 |
| G12-E02 | Migration 485, sinh kế hoạch tuần, API thẻ Hôm nay | E | 3 | 4 |
| G12-E03 | Giao diện kế hoạch tuần, quỹ thời gian, chậm kế hoạch, lớp offline | E | 3 | 3 |
| G12-E04 | Migration 486, thư 15 và 16, tác vụ gửi, tắt một lần bấm | E | 3 | 4 |
| G12-E05 | Cài đặt nhắc và hai dòng thông báo | E | 2 | 3 |
| G12-E06 | Hai bảng ở Báo cáo | E | 1 | 3 |
| G12-C04 | Spec SCOREGAP-0091 | C (sau) | 1 | 2 |
| G12-C05 | Migration 483, tổng hợp hằng đêm, API admin | C (sau) | 2 | 4 |
| G12-C06 | Thẻ "Độ lệch AI–giáo viên" ở Chấm bài › Writing | C (sau) | 2 | 3 |
| G12-C07 | Trang công khai và dòng trên phiếu, sau công tắc | C (sau) | 2 | 3 |
| G12-C08 | (tuỳ quyết định) Mẫu chấm mù | C (sau) | 1 | 3 |
| G12-F01 | Spec REVIEWPACK-0094 | F | 1 | 2 |
| G12-F02 | Migration 487: sản phẩm gói, loại lượt riêng | F | 3 | 5 |
| G12-F03 | Migration 488, nộp bài dùng lượt giáo viên, trần tuần, hạn trả, quá hạn | F | 3 | 4 |
| G12-F04 | Màn duyệt bài gói: đồng hồ, điều kiện ký, ghi cặp điểm | F | 3 | 4 |
| G12-F05 | Giao diện học viên của gói | F | 3 | 3 |
| G12-F06 | Thẻ gói phía admin, ngăn cấu hình, thống kê | F | 2 | 3 |

Tổng: 38 dòng (37 nếu không làm C08), khoảng 79 phiên (80 với C08). Ước lượng, giả định như 1.6.

### Phần C — làm sớm (đợt D, cùng G09-T17)

### G12-C01 — Spec SCOREPAIR-0088
- Mục đích: có spec được duyệt trước khi viết mã (00 mục 4 điểm 6, 7: lưu kết quả chấm là high-risk).
- Đầu vào: mục 2.2, 4 (FR-12-C-001…006), 5.C của file này; `specs/_templates/`; `specs/0050-writing-band-save-consistency/` (mẫu spec về lưu band); tờ `DoLechAIGiaoVienAdmin` mục "Ghi chú cho lập trình".
- Việc làm: 1) Tạo `specs/0088-writing-score-pairs/` (`spec.md`, `plan.md`, `tasks.md`, `rollout.md`, `verification.md`) theo mẫu repo. 2) `spec.md` ghi bốn kết luận ở cuối mục 2.2, FR-12-C-001…006, ngoài phạm vi (không giao diện, không công bố). 3) `rollout.md`: áp 480 ở staging, bật `writing_score_pairs_record` ở staging, chạy đối soát dry-run, rồi production theo lệnh anh Andy. 4) `python backend/scripts/validate_specs.py`.
- Đầu ra: 1 PR spec. DỪNG chờ anh Andy duyệt.
- Nghiệm thu: `python backend/scripts/validate_specs.py` qua; `git diff --check` sạch; spec nêu đủ năm đường làm mất điểm AI (a)–(e) của mục 2.2.
- Không làm: không viết mã, không migration trong PR này.
- Vướng mắc có thể gặp → cách gỡ: validator đòi trường frontmatter khác mẫu → chép frontmatter từ spec gần nhất (`specs/0054-*`); spec 0050 đang sửa cùng khu → ghi liên kết, không sửa spec 0050.
- Ước lượng: 1 phiên · 2.

### G12-C02 — Migration 480: ảnh chụp điểm AI và bảng cặp điểm bất biến
- Mục đích: không còn đường nào làm mất điểm AI gốc; có chỗ lưu cặp điểm.
- Đầu vào: 5.C; `backend/migrations/033_writing_coach_tables.sql`, `109_grading_versions_readpath.sql`, `356_*` (mẫu chỉ ghi thêm), `369_grammar_quiz_definer_search_path.sql` (mẫu `SECURITY DEFINER`), `README.md`, `forward-policy.tsv`; `services/essay_service.py` dòng 604–770.
- Việc làm: 1) `backend/migrations/480_writing_score_pairs.sql`: hai bảng, trigger chụp `AFTER INSERT ON writing_feedback`, trigger chỉ ghi thêm (cho qua khi `pg_trigger_depth() > 1`), view `writing_score_pairs_latest`, nạp lại ảnh chụp từ dòng có sẵn, seed cờ `writing_score_pairs_record` = false. 2) `backend/migrations/rollback/480_writing_score_pairs.sql` (từ chối khi `writing_score_pairs` có dòng, trừ khi `SET aver.allow_score_pairs_rollback='on'`). 3) Dòng `forward-policy.tsv`. 4) Test `backend/tests/test_migration_480_writing_score_pairs.py` (PG17): chèn dòng `ai_pro` → có ảnh chụp; chèn `composed` → không; UPDATE `prompt_version` của dòng AI → không thêm ảnh chụp; UPDATE band của dòng AI (chạy lại cùng job) → thêm một ảnh chụp, ảnh cũ giữ nguyên; UPDATE/DELETE trực tiếp trên hai bảng → lỗi `writing_score_pairs_append_only`; xoá cứng `writing_essays` → hai bảng xoá theo; chạy migration hai lần không lỗi; nạp lại đánh dấu `legacy` cho dòng `source` NULL.
- Đầu ra: 1 PR (migration + rollback + test).
- Nghiệm thu: `cd backend && python -m pytest tests/test_migration_480_writing_score_pairs.py -q` qua; bộ backend đầy đủ qua; trên DB thử, ngay sau khi áp: `SELECT count(DISTINCT writing_feedback_id) FROM writing_ai_score_snapshots` = số dòng `writing_feedback` có `source LIKE 'ai\_%' OR source IS NULL`.
- Không làm: không sửa `essay_service`, `instructor_workflow`; không thêm cột vào `writing_essays`, `instructor_reviews`, `writing_feedback`; không áp lên production.
- Vướng mắc có thể gặp → cách gỡ: số 480 đã bị dùng → lấy số kế trong 480–489 theo sổ, sửa bảng 5.0 trong PR; trigger chụp làm chậm chấm bài → chỉ một INSERT nhỏ, đo bằng test và ghi số ms vào PR; `pg_trigger_depth()` không phân biệt được xoá dây chuyền trên phiên bản Postgres của staging → dùng cờ phiên `SET LOCAL aver.cascade_delete='on'` trong RPC xoá bài và ghi rõ, hỏi anh Andy trước khi chọn.
- Ước lượng: 2 phiên · 4.

### G12-C03 — Ghi cặp điểm khi trả bài, đối soát hằng đêm, dựng lại lịch sử
- Mục đích: mỗi bài trả có đúng một bản ghi cặp điểm; bài trả trước đó được dựng lại khi dựng được.
- Đầu vào: 5.C; `services/instructor_workflow.py::deliver` (dòng 226–376); `routers/admin_writing.py::_deliver_essay` (dòng 142), `mark_delivered` (587), `bulk_mark_delivered` (665); `routers/admin_instructor_queue.py::deliver_review` (dòng 149); `routers/writing_student.py::_band_source` (dòng 481); `backend/railway.staff-security-sweep.json`; G09-T17 (nếu đang làm, rebase theo nó).
- Việc làm: 1) `backend/services/writing_score_pairs.py` (`record_delivery`, `reconstruct_for_essay`). 2) Gọi `record_delivery` trong `deliver` ngay sau bước (2) (vai trò đọc từ `users.role` của `instructor_id`) và trong `_deliver_essay` sau khi RPC trả `ok` (thêm tham số `actor_id`, hai route admin truyền id từ `require_admin`); mỗi chỗ bọc `try/except` ghi log. 3) `backend/scripts/writing_score_pairs_reconcile.py` (dry-run mặc định, `--execute`, `--since`, `--report`). 4) `backend/railway.score-pairs-reconcile.json`. 5) Test `backend/tests/test_writing_score_pairs.py` với supabase giả: bài AI → giáo viên giữ nguyên → cặp bằng nhau, `current_source='ai_pro'`, `reviewer_role='instructor'`, `reviewer_can_edit_bands=false`; admin sửa một tiêu chí → cặp lệch đúng tiêu chí đó; chấm lại rồi sửa → `ai_first` là bản 1, `ai_before_edit` là bản 2; thu hồi rồi trả lại → hai dòng, view lấy dòng sau; gọi lại `deliver` giống hệt sau khi bước (1) đã ghi → vẫn một dòng (`duplicate`); admin trả qua `/admin/instructor/reviews/{id}/deliver` → `reviewer_role='admin'`; số version được dùng lại sau `_gc_orphan_versions` → ghép đúng ảnh chụp theo `writing_feedback_id`; cờ tắt → `skipped_flag_off`, việc trả bài vẫn thành công; `record_delivery` ném lỗi bên trong → `deliver` vẫn trả `delivered`; đối soát dựng lại đúng bài không có cặp, bỏ qua bài thiếu ảnh chụp và đếm.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; bộ backend đầy đủ qua; trên staging (sau khi anh Andy áp 480 và bật cờ): trả một bài thử → `SELECT * FROM writing_score_pairs_latest WHERE essay_id='<id>'` có một dòng đúng band; `python -m scripts.writing_score_pairs_reconcile --report` in số cặp theo tháng, không in email.
- Không làm: không đổi thứ tự hay nội dung ba bước của `deliver`; không đổi `prompt_version` stamping; không sửa `mock_review_workflow`; không giao diện.
- Vướng mắc có thể gặp → cách gỡ: cách nối bài với bài giao trên `staging` khác mục 5.C (`writing_assignments.essay_id`, `class_assignment_items.artifact_kind/artifact_id`) → đọc lại mig 036, 177 và migration sau đó, không đoán, ghi `unknown` nếu thiếu; test cũ của `deliver` đếm số lần gọi supabase → cập nhật test trong cùng PR, liệt kê; G09-T17 đổi `_deliver_essay` cùng lúc → bên vào sau rebase, giữ lời gọi `record_delivery` ở đúng một chỗ.
- Ước lượng: 2 phiên · 4.

### Phần A — Sổ lỗi cá nhân

### G12-A01 — Spec ERRORBOOK-0089
- Mục đích: spec được duyệt cho bản ngữ pháp.
- Đầu vào: 4 (FR-12-A-*), 5.A; tờ `SoLoiCaNhan`; `khao-sat/huong-phat-trien.md` hướng 1; `khao-sat/repo-brainstorm.md` mục 1; GOI-07 FR-07-029b; GOI-09 T27.
- Việc làm: `specs/0089-error-book/` đủ năm file; `ui-states.md` theo SoLoiCaNhan mục 6; ghi rõ K2, K3, K4 và mâu thuẫn M3, M4.
- Đầu ra: 1 PR spec, DỪNG chờ duyệt.
- Nghiệm thu: validator qua; spec có bảng cấu hình với mặc định và câu "chờ anh Andy".
- Không làm: không mã.
- Vướng mắc có thể gặp → cách gỡ: G07 đã merge khối với ý nghĩa cũ (FR-07-029b) → spec ghi rõ hành vi mới thắng và liệt kê test G07 phải đổi; tên nhóm `truc_nhom_vi.json` còn rỗng → spec ghi A không bật được tới khi file có tên cho mọi nhóm của bank đang giao.
- Ước lượng: 1 phiên · 2.

### G12-A02 — Migration 481, nhãn và ánh xạ, lập mục
- Mục đích: sổ lỗi tự ghi mục từ bài tập ngữ pháp đã lưu.
- Đầu vào: 5.A; mig 119, 118, 186, 188, 189; `scripts/import_course_exercise_bank.py`; `services/quiz_service.py` (dòng 343, 1189–1212, 7033); `backend/content/course-labels/truc_nhom_vi.json` (G09-T27).
- Việc làm: 1) `481_error_book.sql` + rollback + `forward-policy.tsv` + test PG17. 2) `backend/content/course-labels/truc_nhom_wiki.json` (khởi đầu `{}`) và loader có kiểm khoá. 3) `backend/services/error_book.py`: `valid_group(skill)`, `sync_user`, lịch mốc (hàm thuần `next_due(stage, outcome, today)`), áp trần ngày khi đọc. 4) Điểm móc sau khi phiên Course kết thúc (chạy nền) và `backend/scripts/error_book_sweep.py`. 5) Test: 2 câu sai cùng nhóm ở hai bài → một mục mốc 1, đến hạn +2 ngày; 1 câu sai → không mục; `skill='A'` → bỏ qua; nhóm không có tên → không mục, có log; mục đã vững + 2 câu sai trong một bài mới → mở lại mốc 1; 1 câu sai mỗi bài ở hai bài mới → không mở lại; lượt làm lại sai cộng vào lập mục; giờ Việt Nam qua nửa đêm UTC tính đúng ngày.
- Đầu ra: 1 PR (migration + service + test).
- Nghiệm thu: `python -m pytest tests/test_error_book_sync.py tests/test_migration_481_error_book.py -q` qua; trên staging dry-run `python -m scripts.error_book_sweep --dry-run` in số mục sẽ lập theo nhóm, không in email/tên.
- Không làm: không sửa `quiz_attempts`, RLS của nó, `student_mistakes`; không dùng `srs.py`; không gọi AI.
- Vướng mắc có thể gặp → cách gỡ: không tìm được hàm chốt phiên Course duy nhất (có nhiều đường kết thúc: completed, time_cap, đóng giờ) → không móc, chỉ dùng tác vụ đêm cộng một lời gọi khi mở Sổ lỗi (`sync_user` trước khi đọc), ghi trong PR; `quiz_attempts` lớn làm chậm lần đồng bộ đầu → giới hạn theo người và theo 180 ngày gần nhất, đo và ghi.
- Ước lượng: 3 phiên · 4.

### G12-A03 — Bộ chọn câu, phiên ôn, chấm câu viết lại
- Mục đích: một phiên 4 câu đúng nhóm, chấm ở máy chủ, đổi mốc đúng quy tắc.
- Đầu vào: 5.A; `quiz_questions` (`options`, `answer`, `explain`, `why_wrong`, `grammar_article_slug`); tờ `SoLoiCaNhan` mục 3, 4; GOI-11 T33 (mã sơ đồ).
- Việc làm: 1) `services/error_book_selector.py` (ưu tiên chưa gặp → đã sai → gặp lâu nhất; đảo phương án, lưu `option_order`; nguồn câu cùng nhóm ở mọi bank Course người đó được giao, cả bài kiểm tra giữa/cuối khoá). 2) `services/error_book_rewrite.py` (chuẩn hoá, viết tắt, tính chỗ khác `diff`). 3) `backend/content/error-book/rewrite_items.jsonl` khởi đầu rỗng + `backend/scripts/draft_error_book_rewrites.py` (đọc bank, in nháp cho giáo viên duyệt; không ghi DB). 4) `services/learner_text_clean.py` (hoặc dùng bản của G09 — K4). 5) Route phiên trong `backend/routers/error_book.py`. 6) Test: không có đáp án trong phản hồi tạo phiên; đảo phương án vẫn chấm đúng; sai câu viết lại lần một → `final=false`, có `diff`, không `correct_text`; lần hai → `final=true`, có `correct_text`; `didn't` = `did not`; phiên đạt ở mốc 3 → `mastered`; có câu sai ở mốc 2 → về mốc 1; hết câu chưa gặp → `seen_before=true`; nhóm không có câu viết lại → 4 câu trắc nghiệm.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; `grep -rn "\"answer\"" backend/routers/error_book.py` không có trường đáp án trong mô hình trả ra của `POST /sessions`.
- Không làm: không sinh câu mới; không AI; không gửi thông báo.
- Vướng mắc có thể gặp → cách gỡ: nhóm có ít hơn 3 câu khác câu đã sai → lấy câu đã gặp, ghi "câu đã gặp", không hạ số câu; `explain` chứa HTML hoặc Markdown → dùng bộ hiển thị Markdown an toàn sẵn có (`CHƯA KIỂM`: `grep -rn "markdown" backend/services/*.py | head`), không tự viết bộ lọc HTML.
- Ước lượng: 3 phiên · 4.

### G12-A04 — API tóm tắt, danh sách, chi tiết; hàm `today_block` cho G07
- Mục đích: G07 nối được khối "Lỗi đang lặp lại"; trang Sổ lỗi có dữ liệu.
- Đầu vào: 5.A; GOI-07 mục 5.3 (`_repeat_error_for`), T13.
- Việc làm: 1) `GET /summary`, `/entries`, `/entries/{id}`, `defer`, `defer-today`. 2) `today_block(user_id)` đúng hình ở 5.A. 3) Nối `_repeat_error_for` của G07 sang `today_block` (một dòng import, trong PR này nếu G07-T13 đã merge; chưa merge thì ghi việc cho G07). 4) Model Pydantic, sinh lại `frontend/types/api.d.ts`. 5) Test: không mục → `today_block` là `None`; có mục đến hạn → `state='due'`, `count`, `of` đúng; đã ôn hết → `done_today`; cờ tắt → `None` và `/summary` trả `enabled=false`; mục của người khác → 404; biểu đồ tháng dưới 5 câu → `enough=false` kèm câu giải thích.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; `GET /api/student/today` của G07 trả `repeat_error` khác `null` cho người thử có mục (test tích hợp với supabase giả).
- Không làm: không đổi khung năm khoá G07 đã đặt; không thêm `degraded`.
- Vướng mắc có thể gặp → cách gỡ: G07 đã đặt hàm ghép ở file khác tên → theo mã thật, ghi trong PR; số phút làm tròn lệch tờ ("12 câu · khoảng 10 phút") → tham số `ERROR_BOOK_MINUTES_PER_QUESTION`, không ghi cứng.
- Ước lượng: 2 phiên · 3.

### G12-A05 — Trang Sổ lỗi, chi tiết mục, phiên ôn
- Mục đích: học viên dùng được sổ lỗi trên máy tính và điện thoại.
- Đầu vào: tờ `SoLoiCaNhan` mục 2–7; component G03; sơ đồ câu chữ của G11-T33; danh mục trang G07.
- Việc làm: ba trang ở 5.A; component `ErrorBookList`, `ErrorEntryDetail`, `ReviewSession`, `RewriteQuestion`, `MonthlyGrid`; nối khối Hôm nay của G07 (chỉ nếu G07-T14 chưa làm phần gọi `review_href`/`list_href`); test React `frontend/tests/react/error-book.test.tsx` (bốn bộ lọc, rỗng hai kiểu, lỗi tải, câu viết lại ba trạng thái, "Để mai" không hỏi lý do, không có chuỗi "chuỗi ngày", "huy hiệu", không hiện mã nhóm).
- Đầu ra: 1 PR frontend.
- Nghiệm thu: preview 1280px và 390px khớp tờ; bàn phím đi hết phiên (Tab, Enter); ô viết lại tắt tự sửa chính tả (`autoCorrect="off" spellCheck={false}`); `npx tsc --noEmit`, `npm run build`, test React qua.
- Không làm: không đổi `/practice` hub ngoài một lối vào; không thêm thông báo.
- Vướng mắc có thể gặp → cách gỡ: sơ đồ câu chữ chưa có cho nhóm → không hiện hình, giữ chữ; route group `(authed-practice)` có layout riêng không dùng `AuthedShell design="v2"` → theo cách G07 đã làm cho `/practice`, ghi trong PR.
- Ước lượng: 3 phiên · 3.

### G12-A06 — Khối "Sổ lỗi của lớp" cho giáo viên
- Mục đích: giáo viên chọn nhóm cần chữa lại và biết ai ôn rồi vẫn sai.
- Đầu vào: tờ `SoLoiCaNhan` mục 8, `AdminLop`, `AdminKetQuaBaiGiao` khối 3, `GiaoVien`; `services/staff_scope.py` (G09-T24); route lớp admin.
- Việc làm: API `GET /admin/cohorts/{cohort_id}/error-book`; khối trong trang lớp và "Lớp của tôi"; nút "Thêm nhóm đầu bảng vào 'Nên chữa ở buổi tới'" dùng `review_items` của G09 (mig 444); test: giáo viên lớp khác → 404; lớp không ai có mục → khối ẩn; đếm "chưa mở Sổ lỗi lần nào".
- Đầu ra: 1 PR (backend nhỏ + frontend).
- Nghiệm thu: pytest và test React qua; preview: số trong khối khớp tổng của API.
- Không làm: không xếp hạng; không trang mới; không mục sidebar.
- Vướng mắc có thể gặp → cách gỡ: `review_items` lưu theo câu, không theo nhóm → thêm các câu sai nhiều nhất của nhóm (tối đa 3), ghi trong PR; G09-T29 chưa có trang lớp mới → đặt khối vào trang lớp hiện có, ghi "chưa có tờ mới".
- Ước lượng: 2 phiên · 3.

### Phần B — Viết lại sau khi chấm

### G12-B01 — Spec REWRITE-0090
- Mục đích: spec được duyệt (lời gọi AI trả phí mới, trừ lượt).
- Đầu vào: 4 (FR-12-B-*), 5.B; tờ `VietLaiSauCham`, `KetQuaWriting`, `BaiMauWriting`; GOI-04 5.6 (đơn vị lượt); GOI-06 5.2.
- Việc làm: `specs/0090-writing-rewrite/`; ghi rõ hai phương án lượt, mặc định `first_free`, chi phí ước tính mỗi lần gọi (dựa giá mô hình cấu hình, ghi "chưa đo"); mâu thuẫn M1, M2.
- Đầu ra: 1 PR spec, DỪNG.
- Nghiệm thu: validator qua.
- Không làm: không mã.
- Vướng mắc có thể gặp → cách gỡ: chưa chốt mô hình cho lời gọi đối chiếu → để cấu hình `REWRITE_MODEL`, ghi câu hỏi; G06 chưa có `writing_samples` → spec ghi "đứng đâu" bật sau G06.
- Ước lượng: 1 phiên · 2.

### G12-B02 — Migration 482, chia đoạn, gắn nhận xét, gắn bài mẫu
- Mục đích: biết đoạn nào có nhận xét và bài nào thuộc kho mẫu.
- Đầu vào: 5.B; `models/writing_feedback.py`; mig 033, 101; G06 mục 5.2; GOI-04 mục 5.3.
- Việc làm: 1) `482_writing_rewrites.sql` + rollback + test PG17 (kiểm `to_regclass` cho `credit_ledger`, `writing_samples`, `learner_notifications`). 2) `services/writing_rewrite.py`: `split_paragraphs(text)`, `attach_comments(paragraphs, mistakes)`, `paragraph_kind_labels(task_type, n)`, `sample_for_essay(essay)`. 3) `GET` danh sách đoạn. 4) Test: câu trích có khoảng trắng khác → vẫn gắn; câu trích không có → nhận xét chung; bài Task 1 đặt nhãn đoạn đúng; bài thuộc kho khớp một bộ; khớp hai bộ → không gắn.
- Đầu ra: 1 PR.
- Nghiệm thu: pytest qua; trên staging với một bài thử đã trả, `GET` trả số đoạn bằng số đoạn hiện trên phiếu.
- Không làm: không gọi AI; không đổi phiếu Writing.
- Vướng mắc có thể gặp → cách gỡ: học viên không xuống dòng giữa các đoạn → chia theo một dòng xuống hàng; vẫn một khối thì cả bài là một đoạn và chỉ hiện "Viết lại cả bài"; `credit_ledger` chưa có (G04 chưa merge) → migration dừng với lỗi rõ, không tạo bảng nửa vời.
- Ước lượng: 2 phiên · 4.

### G12-B03 — Nộp bản viết lại, AI đối chiếu, kiểm câu trích, lượt
- Mục đích: kết quả "đã xử lý / còn / lỗi mới" có dẫn chứng thật.
- Đầu vào: 5.B; `services/ai_usage_logger.py`; mẫu lời gọi AI chấm Writing hiện có (`CHƯA KIỂM` tên module: `grep -rln "def grade_essay\|GradingResult" backend/services | head`); `services/credits.py` của G04.
- Việc làm: 1) `services/writing_rewrite_ai.py::compare_rewrite` + khuôn Pydantic + prompt. 2) Kiểm câu trích, hạ nhãn. 3) Route `POST`, `GET /{id}`, `PUT /draft`; chạy nền như chấm Writing hiện có. 4) Lượt theo 5.B; AI lỗi → hoàn và không tính lần đầu. 5) Thông báo `rewrite_ready`. 6) Test với provider giả: nhãn `resolved` có câu trích không có trong bản 2 → hạ `remaining`; lỗi mới không khớp → bỏ; `first_free` lần một không giữ chỗ, lần hai giữ 1; `always` lần nào cũng giữ; AI lỗi → hoàn, lần sau vẫn miễn; quá 140 từ → 422; bản 4 → 409; lớp offline hết lượt → 402 `credit_source='class'`; mọi lời gọi có dòng `ai_usage_logger`.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua (không gọi AI thật); `--run-smoke` chỉ khi anh Andy cho phép, ghi chi phí thật một lần gọi vào PR.
- Không làm: không chấm lại band; không đổi prompt chấm cũ; không tạo hàng chờ giáo viên (trừ khi `REWRITE_CLASS_REVIEW=teacher`).
- Vướng mắc có thể gặp → cách gỡ: mô hình trả câu trích đã sửa dấu nháy → chuẩn hoá nháy cong/thẳng trước khi so; mô hình trả JSON hỏng → thử lại một lần, rồi `failed`, không trừ lượt.
- Ước lượng: 3 phiên · 5.

### G12-B04 — "Bài của tôi đứng đâu" và kiểm trùng bài mẫu
- Mục đích: đặt đoạn của người học cạnh đoạn cùng loại của ba bài mẫu theo tiêu chí yếu nhất.
- Đầu vào: 5.B; G06 (`writing_samples.essays`, `delta_75_70`, `delta_70_60`); tờ `VietLaiSauCham` mục 4, `BaiMauWriting`.
- Việc làm: 1) `stand_against_samples` (AI) với kiểm câu trích từ bài 7.0. 2) Tách đoạn cùng loại của bài mẫu (`outline` hoặc chia dòng trống — `CHƯA KIỂM` cấu trúc `essays.*`). 3) Kiểm trùng 8 từ liên tiếp (so n-gram, không AI). 4) Bản viết lại chưa có kết quả đối chiếu → 409 `not_done` (bỏ `rewrite_first`: route cần `rewrite_id` nên ca "chưa có bản viết lại" không gọi được; "Mở bài mẫu ngay" chỉ mở trang bài mẫu — mặc định tạm 18/11, chờ anh Andy xác nhận). 5) Lưu `stand_result` để mở lại không gọi AI lần hai. 6) Test giả lập: câu trích không có trong bài 7.0 → bỏ khác biệt đó; có thể trả "không có khác biệt đáng nói"; trùng 8 từ → `sample_overlap`.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; một lần mở lại không tạo dòng `ai_usage_logger` mới.
- Không làm: không xếp band cho đoạn; không so câu với câu.
- Vướng mắc có thể gặp → cách gỡ: bài mẫu không có `outline` theo đoạn → chia theo dòng trống và ghép theo thứ tự (mở bài = đoạn đầu, kết = đoạn cuối); số đoạn khác nhau → chỉ so mở bài, kết và thân bài có cùng thứ tự, đoạn còn lại không có thẻ.
- Ước lượng: 2 phiên · 4.

### G12-B05 — Giao diện viết lại, kết quả, đứng đâu, trạng thái
- Mục đích: học viên đi hết vòng viết lại trên máy tính và điện thoại.
- Đầu vào: tờ `VietLaiSauCham` mục 1–8; `KetQuaWriting`; component G07-T20, T27 (`CreditsEmptyNotice`).
- Việc làm: nút ở phiếu (chỉ khi cờ bật), màn viết lại, kết quả hai cột, trang đứng đâu với ba thẻ 6.0 · 7.0 · 7.5 (mở ở 7.0), các trạng thái; khi cờ bật: ẩn thẻ "Bài mẫu cùng đề" và dòng "So bài nháp với bài mẫu 7.0" của phiếu và khối hết lượt, thay bằng thẻ khoá mềm (M1, M2); test React.
- Đầu ra: 1 PR frontend.
- Nghiệm thu: preview 1280px, 390px; câu "Đây không phải điểm" nằm ngay dưới dòng tổng; cờ tắt → phiếu giống hệt trước (test so ảnh chụp mốc của G10).
- Không làm: không đổi phiếu khi cờ tắt.
- Vướng mắc có thể gặp → cách gỡ: phiếu G07-T20 chưa merge → dựng trên phiếu hiện có, ghi "chưa có tờ mới"; chuông chưa có (GOI-11 A) → kết quả chỉ hiện khi quay lại trang.
- Ước lượng: 3 phiên · 3.

### G12-B06 — Dòng "đã viết lại" và lời nhắn của giáo viên
- Mục đích: giáo viên lớp offline thấy học viên đã sửa gì.
- Đầu vào: tờ `VietLaiSauCham` mục 6, `AdminChamWriting` (trang Đã trả); `staff_scope`.
- Việc làm: dòng trong trang Đã trả, "Xem hai bản", ô lời nhắn (route `teacher-note`), thông báo cho học viên; test phạm vi lớp.
- Đầu ra: 1 PR.
- Nghiệm thu: pytest + test React qua; giáo viên lớp khác không thấy dòng.
- Không làm: không nút duyệt, không hạn xử lý.
- Vướng mắc có thể gặp → cách gỡ: trang Đã trả của G09-T17 chưa có → đặt dòng ở trang chi tiết bài hiện có; lời nhắn dài → giới hạn 1000 ký tự.
- Ước lượng: 1 phiên · 2.

### Phần D — Kiểm tra đầu vào

### G12-D01 — Spec PLACEMENT-0092
- Mục đích: spec được duyệt.
- Đầu vào: 4 (FR-12-D-*), 5.D; tờ `KiemTraDauVao`; spec 0003; GOI-11 phần B; `khao-sat/huong-phat-trien.md` hướng 4.
- Việc làm: `specs/0092-placement-test/`; ghi lý do không sửa bảng của 0003; bảng quy tắc v1; mâu thuẫn M8, M9.
- Đầu ra: 1 PR spec, DỪNG.
- Nghiệm thu: validator qua.
- Không làm: không mã.
- Vướng mắc có thể gặp → cách gỡ: chủ spec 0003 muốn dùng chung engine → ghi phương án thay trong spec và hỏi anh Andy; chưa có tên sáu nhóm → lấy từ `grammar_lessons`/`attribute_id` của release, liệt kê để anh Andy chọn.
- Ước lượng: 1 phiên · 2.

### G12-D02 — Nội dung: bộ đề, quy tắc v1, script kiểm
- Mục đích: có 2–3 bộ đề đã kiểm.
- Đầu vào: release MASTER30 trong repo (`CHƯA KIỂM` đường dẫn manifest: `grep -rn "86a55dc1" backend | head -3`); ngân hàng Reading/Listening hiện có (`CHƯA KIỂM` bảng: `ls backend/migrations | grep -i "reading\|listening" | head`); tờ `KiemTraDauVao` mục 3, 4b.
- Việc làm: `backend/content/placement/forms/f1.json`, `f2.json` (f3 nếu đủ câu), `rules-v1.json`, `backend/scripts/validate_placement_forms.py`; test cho script.
- Đầu ra: 1 PR content.
- Nghiệm thu: `python -m scripts.validate_placement_forms` in "ok" cho mọi bộ; không câu trùng giữa các bộ.
- Không làm: không soạn câu ngữ pháp mới (chỉ chọn `item_id` có sẵn, `entry_safe=true` nếu đủ); không ghi DB.
- Vướng mắc có thể gặp → cách gỡ: không đủ câu `entry_safe` cho 6 nhóm × 3 × 3 bộ → làm 2 bộ, ghi số; đoạn đọc/nghe có sẵn dài hơn 6 câu → chọn 6 câu đầu có nhãn, không cắt audio (nghe cả đoạn).
- Ước lượng: 2 phiên · 3.

### G12-D03 — Migration 484, API phiên, chấm, quy tắc gợi ý
- Mục đích: làm bài, lưu từng câu, ra kết quả và gợi ý đúng quy tắc.
- Đầu vào: 5.D; mig 283 (bảng `grammar_items`); `services/grammar_diagnostic_service.py` (cách đọc release đang hoạt động: `_active_release`); G04 `has_ever_had_online_course`, `list_access`.
- Việc làm: `484_placement_tests.sql` + rollback + test; `services/placement.py`, `services/placement_rules.py` (hàm thuần, đọc JSON quy tắc); `backend/routers/placement.py`; thêm route vào `ACTIVATION_EXEMPT_ROUTES` với lý do; test bảng chân trị quy tắc (mỗi dòng 4b, dòng trên thắng, đúng một "Nên bắt đầu", Vocabulary luôn "Chưa đủ dữ liệu", bỏ phần nghe → không gợi ý Listening), không lộ đáp án, trả lời lại khác → 409, làm lại sớm → 409 kèm ngày, đổi `rule_version` không đổi kết quả cũ.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; `GET /sessions/{id}/next` không có trường `correct_index`/`answer`.
- Không làm: không đổi `grammar_diagnostic_*`; không hiện band, không phần trăm tổng.
- Vướng mắc có thể gặp → cách gỡ: release đang hoạt động đổi sau khi soạn bộ đề → validator chạy lúc khởi động service, bộ có `item_id` không còn thì tắt bộ đó và log; người đã có khoá hoặc từng có khoá online → không có phần 4 (theo `list_access` và `has_ever_had_online_course`).
- Ước lượng: 3 phiên · 4.

### G12-D04 — Giao diện lối vào, giới thiệu, ba phần, kết quả, trạng thái
- Mục đích: người mới làm xong bài trên máy tính và điện thoại.
- Đầu vào: tờ `KiemTraDauVao` mục 1–6; `DanhMucKhoa`, `HomNayTrangThai` mục 2.
- Việc làm: trang `/placement` (giới thiệu), `/placement/test`, `/placement/result` trong nhóm route của G05/G07 (`CHƯA KIỂM` nhóm phù hợp cho tài khoản chưa kích hoạt — theo G07-T26); lối vào ở Danh mục khoá và Hôm nay; trạng thái 5a–5d; test React (không chữ "band", không số tổng).
- Đầu ra: 1 PR frontend.
- Nghiệm thu: preview 1280px, 390px; khách chưa đăng nhập bấm lối vào → đăng nhập → về `/placement`.
- Không làm: không hộp bật lên mời làm bài.
- Vướng mắc có thể gặp → cách gỡ: trình phát audio hiện có không chặn được số lần nghe → đếm ở máy chủ (`/listening/play`), nút phát mờ khi hết lượt; mất mạng giữa bài → giữ câu chưa lưu ở bộ nhớ trang, hiện cảnh báo 5c.
- Ước lượng: 3 phiên · 3.

### G12-D05 — Phần 4 tuỳ chọn qua chấm thử
- Mục đích: có dữ liệu viết hoặc nói mà không tạo trần riêng.
- Đầu vào: GOI-11 phần B (`services/trial_caps.py`, `fn_trial_reserve`); tờ `KiemTraDauVao` mục 4 (khối đoạn viết), 5d; `ChamThuMienPhi` mục 8.
- Việc làm: chế độ `text_feedback_only` cho chấm thử (đoạn ≥ `PLACEMENT_MIN_WORDS`, không band, nhận xét theo nhóm lỗi); route `POST /optional`; hoàn lượt khi AI lỗi; test với provider giả.
- Đầu ra: 1 PR backend (high-risk: AI trả phí).
- Nghiệm thu: pytest qua; một lần nộp tạo đúng một dòng `trial_usage` và một dòng `ai_usage_logger`.
- Không làm: không trần mới; không trả band.
- Vướng mắc có thể gặp → cách gỡ: GOI-11 phần B chưa merge → nhiệm vụ chờ, D04 ẩn phần 4; prompt chấm thử trả band bắt buộc → thêm khuôn đầu ra riêng, không sửa khuôn cũ.
- Ước lượng: 2 phiên · 4.

### G12-D06 — Khối phễu ở Báo cáo và ba ô Cài đặt
- Mục đích: anh Andy thấy bài có tác dụng không.
- Đầu vào: tờ `KiemTraDauVao` mục 7; `AdminBaoCao` #m1 (G09-T41); `AdminCaiDat`.
- Việc làm: API phễu; khối trong Báo cáo; ba ô Cài đặt › Tính năng; test: nhóm dưới ngưỡng không có phần trăm; "đăng ký đúng khoá" chỉ đếm đơn `confirmed` trong cửa sổ.
- Đầu ra: 1 PR.
- Nghiệm thu: pytest + test React qua.
- Không làm: không trang mới, không mục sidebar.
- Vướng mắc có thể gặp → cách gỡ: chưa có sự kiện "mở màn giới thiệu" → ghi một dòng đếm theo ngày (`placement_sessions` không đủ) bằng bảng sự kiện báo cáo nếu G09 có; không có thì bước 1 ghi "chưa đo", không bịa số; "ngừng học 2 tuần đầu" chưa có định nghĩa chung → dùng định nghĩa "việc học hoàn thành" của AdminBaoCao.
- Ước lượng: 2 phiên · 3.

### Phần E — Nhắc việc và thư tuần

### G12-E01 — Spec WEEKLYPLAN-0093
- Mục đích: spec được duyệt (gửi thư, migration).
- Đầu vào: 4 (FR-12-E-*), 5.E; tờ `NhacViecThuTuan`; `EmailMau`; `ThongBao`; GOI-04 5.11; GOI-11 5.1.
- Việc làm: `specs/0093-weekly-plan/`; ghi nguồn mục tiêu/ngày thi theo K7.
- Đầu ra: 1 PR spec, DỪNG.
- Nghiệm thu: validator qua.
- Không làm: không mã.
- Vướng mắc có thể gặp → cách gỡ: địa chỉ gửi thư học viên chưa có → spec ghi E04 không bật thư tới khi có; G07 chưa chọn nguồn `goal` → spec ghi câu hỏi, mặc định `users.target_band`/`users.exam_date` (cột đang được `PATCH /auth/profile` ghi).
- Ước lượng: 1 phiên · 2.

### G12-E02 — Migration 485, sinh kế hoạch tuần, API thẻ Hôm nay
- Mục đích: mỗi học viên có kế hoạch tuần đúng công thức.
- Đầu vào: 5.E; G07 (`course_lessons`, `course_lesson_progress`, `_visible_assignments`); `services/error_book.py` (nếu A bật).
- Việc làm: `485_weekly_plans.sql` + rollback + test; `services/weekly_plan.py`; `backend/routers/weekly_plan.py`; bước `build` của `scripts/weekly_plan_sweep.py`; test: 48 bài, 17 tuần → 3 bài/tuần; chưa đặt ngày thi → theo nhịp; khoá hết hạn trước → `expiry_warning`; việc tuần trước không cộng dồn; lớp offline lấy bài giao theo buổi; người vừa lớp vừa online → một kế hoạch hai nhóm; `arrange_for_budget(15)` chỉ lấy việc vừa 15 phút theo thứ tự ưu tiên; chậm hai tuần dưới nửa → `slow`, hiện một lần.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; `python -m scripts.weekly_plan_sweep --step build --dry-run` trên staging in số kế hoạch sẽ sinh.
- Không làm: không gửi thư, không thông báo (E04, E05).
- Vướng mắc có thể gặp → cách gỡ: bài lộ trình không có thời lượng → dùng `video_seconds` + số câu × hằng cấu hình, ghi "ước lượng"; `course_lessons` chưa có (G07-T18) → khoá online không có việc "bài học", thẻ chỉ có bài viết và ôn lỗi, ghi trong PR.
- Ước lượng: 3 phiên · 4.

### G12-E03 — Giao diện kế hoạch tuần, quỹ thời gian, chậm kế hoạch, lớp offline
- Mục đích: thẻ trên Hôm nay đúng tờ.
- Đầu vào: tờ `NhacViecThuTuan` mục 1, 2, 5, 6; G07-T14.
- Việc làm: component `WeeklyPlanCard`, `TimeBudgetBar`, `PlanAdjustBlock`, `ClassWeekCard`; nhớ lựa chọn quỹ thời gian bằng `localStorage` tới hết ngày (bọc try/catch); test React (không chữ "trễ", "bỏ lỡ", "cố lên"; khối chậm không dùng màu đánh dấu).
- Đầu ra: 1 PR frontend.
- Nghiệm thu: preview 1280px, 390px; cờ tắt → Hôm nay như trước.
- Không làm: không đếm ngày liên tiếp; không gửi lựa chọn quỹ thời gian về máy chủ.
- Vướng mắc có thể gặp → cách gỡ: Hôm nay của G07 chưa có chỗ chèn → thêm slot trong PR này, ghi cho G07; "Giảm tải" khi khoá chưa gắn nhãn → không hiện lựa chọn đó.
- Ước lượng: 3 phiên · 3.

### G12-E04 — Migration 486, thư 15 và 16, tác vụ gửi, tắt một lần bấm
- Mục đích: mỗi tuần đúng một thư, tắt được không cần đăng nhập.
- Đầu vào: 5.E; GOI-04 `learner_email_outbox`, `services/learner_email.py`; `services/owner_alerts.py`; tờ `NhacViecThuTuan` mục 3, `EmailMau`.
- Việc làm: `486_weekly_plan_messages.sql` + rollback + test; mẫu thư HTML/văn bản ở `backend/templates/email/weekly_summary.*`, `weekly_inactive.*`; bước `digest` và `midweek`; route tắt/bật lại; header `List-Unsubscribe`; test: tuần có việc → thư 15, không có → thư 16; thư 16 lần ba liên tiếp → không gửi; khoá hết hạn → không gửi; `notification_email=false` → không gửi; token sai → 400 không lộ người dùng; POST tắt → `digest_enabled=false` và sự kiện; hai lần chạy cùng tuần → một dòng outbox (dedupe).
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; trên staging dry-run in số thư theo mẫu; không email thật nào được gửi trong test.
- Không làm: không gửi qua đường khác outbox; không thư cho bài làm dở.
- Vướng mắc có thể gặp → cách gỡ: `learner_email.py` chưa hỗ trợ header → thêm tham số `headers` tuỳ chọn trong PR riêng nhỏ cho G04 (K6) trước, rồi rebase; giờ gửi theo từng người làm tác vụ chạy lâu → quét theo khung giờ (`digest_time` làm tròn giờ), cron mỗi giờ.
- Ước lượng: 3 phiên · 4.

### G12-E05 — Cài đặt nhắc và hai dòng thông báo
- Mục đích: học viên chỉnh kênh, giờ, tạm nghỉ.
- Đầu vào: tờ `NhacViecThuTuan` mục 4; `TaiKhoan` màn 2; `ThongBao` mục 3; GOI-11 5.1.2.
- Việc làm: nhóm "Nhắc việc theo kế hoạch" ở Hồ sơ › Thông báo; `plan_week_new`, `plan_midweek` qua `fn_notify`; câu chữ ở `notification_copy.py`; test: làm hết việc trước Thứ Năm → không dòng giữa tuần; tạm nghỉ hết hạn → tự bật lại, không thư "chào mừng trở lại".
- Đầu ra: 1 PR.
- Nghiệm thu: pytest + test React qua.
- Không làm: không âm thanh, không hộp bật lên.
- Vướng mắc có thể gặp → cách gỡ: trang cài đặt thư của GOI-11 khác bố cục tờ → thêm nhóm theo khuôn đang có, ghi khác biệt; người tắt `notification_email` tổng → nhóm này hiện trạng thái tắt kèm câu giải thích.
- Ước lượng: 2 phiên · 3.

### G12-E06 — Hai bảng ở Báo cáo
- Mục đích: đo tỉ lệ còn hoạt động và tác dụng của thư.
- Đầu vào: tờ `NhacViecThuTuan` mục 7; `AdminBaoCao` (G09-T41).
- Việc làm: API và khối hai bảng; mốc so sánh "trước khi bật" = nhóm mở khoá trước ngày bật cờ; test ngưỡng số người tối thiểu.
- Đầu ra: 1 PR.
- Nghiệm thu: pytest + test React qua.
- Không làm: không biểu đồ thêm.
- Vướng mắc có thể gặp → cách gỡ: chưa ghi được "đã mở thư" (Resend webhook chưa có) → cột "Đã mở" ghi "chưa đo", không bịa; định nghĩa "còn hoạt động" chưa thống nhất → dùng định nghĩa của AdminBaoCao, ghi trong PR.
- Ước lượng: 1 phiên · 3.

### Phần C — phần sau (sau khi có số)

### G12-C04 — Spec SCOREGAP-0091
- Mục đích: spec được duyệt cho đo, xem và công bố.
- Đầu vào: 4 (FR-12-C-010…021), 5.C'; tờ `DoLechAIGiaoVien`, `DoLechAIGiaoVienAdmin`; số cặp thật từ `writing_score_pairs_reconcile --report`.
- Việc làm: `specs/0091-score-gap/`; cách tính; quy tắc tách phiên bản; bốn điều kiện công bố; câu "không phải điểm thi".
- Đầu ra: 1 PR spec, DỪNG.
- Nghiệm thu: validator qua; spec ghi số cặp hiện có và ngày lấy số.
- Không làm: không mã.
- Vướng mắc có thể gặp → cách gỡ: phần lớn cặp có `reviewer_can_edit_bands=false` → spec ghi rõ chưa đo được tới khi G09 mở sửa điểm cho giáo viên hoặc anh Andy duyệt bằng tài khoản admin; số cặp dưới 50 → spec vẫn trình, phần công bố để tắt.
- Ước lượng: 1 phiên · 2.

### G12-C05 — Migration 483, tổng hợp hằng đêm, API admin
- Mục đích: số độ lệch đúng cách tính, tách phiên bản.
- Đầu vào: 5.C'; G09 5.6 (`ops_thresholds`), mig 440.
- Việc làm: `483_score_gap_reports.sql` + rollback + test; `scripts/score_gap_rollup.py`; `routers/admin_score_gap.py`; test: tính tay trên 6 cặp ra đúng lệch trung bình, tỉ lệ trong 0.5, hướng lệch; đổi `prompt_version_base` giữa kỳ → hai dòng phiên bản; dòng dưới 30 bài → không có số; PUT công bố thiếu điều kiện → 409 liệt kê; giáo viên gọi PUT → 403.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua.
- Không làm: không trang công khai.
- Vướng mắc có thể gặp → cách gỡ: band thiếu một tiêu chí ở bài AI lỗi một phần → bỏ tiêu chí đó khỏi tổng, không tính 0; cập nhật `ops_thresholds` đè giá trị anh Andy đã sửa → UPDATE chỉ thêm khoá chưa có (`jsonb` gộp với khoá cũ thắng).
- Ước lượng: 2 phiên · 4.

### G12-C06 — Thẻ "Độ lệch AI–giáo viên"
- Mục đích: admin và giáo viên đọc độ lệch, đánh dấu bài đã xem lại.
- Đầu vào: tờ `DoLechAIGiaoVienAdmin`; `AdminChamWriting`; `CHUAN-ADMIN.md`.
- Việc làm: thẻ thứ ba trong trang Writing; danh sách bài lệch; "Mở bài" hai cột điểm; khối công bố (chỉ admin); cảnh báo ở Việc cần làm; test React.
- Đầu ra: 1 PR frontend.
- Nghiệm thu: preview 1280px và 1024px; giáo viên không thấy công tắc.
- Không làm: không mục sidebar.
- Vướng mắc có thể gặp → cách gỡ: trang Writing mới của G09-T17 chưa có thẻ → thêm thẻ vào trang hiện có; số trên sidebar thay đổi → thẻ này không cộng vào số Writing.
- Ước lượng: 2 phiên · 3.

### G12-C07 — Trang công khai và dòng trên phiếu
- Mục đích: công bố đúng con số khi đã đủ điều kiện.
- Đầu vào: tờ `DoLechAIGiaoVien` mục 1–4; G05 khung công khai.
- Việc làm: trang `/cham-bai-the-nao` (tên chờ câu C4) trong khung công khai; 404 khi chưa công bố; dòng trên phiếu Writing; SEO cơ bản; test.
- Đầu ra: 1 PR frontend.
- Nghiệm thu: cờ hoặc công bố tắt → trang 404 thật, phiếu không có dòng; bật → số trên trang = số trên phiếu = API.
- Không làm: không sinh tự động phần chữ "Điều AI chấm kém".
- Vướng mắc có thể gặp → cách gỡ: CSP hoặc proxy chặn trang mới → theo cách G05 thêm trang công khai; trang được cache khi đã tắt công bố → dùng `revalidate` ngắn, ghi trong PR.
- Ước lượng: 2 phiên · 3.

### G12-C08 — (tuỳ quyết định) Mẫu chấm mù
- Mục đích: đo mức giáo viên bị neo theo điểm AI.
- Đầu vào: câu C3 ở mục 10; tờ `DoLechAIGiaoVienAdmin` (8).
- Việc làm: `489_writing_blind_review.sql`; chọn ngẫu nhiên `blind_monthly_count` bài mỗi tháng, ẩn điểm AI trong màn chấm; cặp ghi `blind=true` (cột trong `extra`); test.
- Đầu ra: 1 PR.
- Nghiệm thu: bài mù không lộ điểm AI ở API màn chấm.
- Không làm: không bắt đầu khi anh Andy chưa chọn "có".
- Vướng mắc có thể gặp → cách gỡ: chỉ một giáo viên → tỉ lệ mù làm chậm hàng chờ → bắt đầu 5 bài/tháng; bài mù là bài lớp có buổi gần → loại bài có hạn trả trong 24 giờ.
- Ước lượng: 1 phiên · 3.

### Phần F — Gói giáo viên chấm

### G12-F01 — Spec REVIEWPACK-0094
- Mục đích: spec được duyệt (sổ lượt, đơn, chấm bài).
- Đầu vào: 4 (FR-12-F-*), 5.F; tờ `GoiGiaoVienCham`, `GoiGiaoVienChamAdmin`; GOI-04 5.2, 5.3, 5.6.
- Việc làm: `specs/0094-review-pack/`; ghi K6, K12; bảng câu chờ anh Andy.
- Đầu ra: 1 PR spec, DỪNG.
- Nghiệm thu: validator qua.
- Không làm: không mã.
- Vướng mắc có thể gặp → cách gỡ: học phí, trần, hạn trả chưa có → spec để cấu hình, ghi "không bật khi `turnaround_business_days` NULL"; G04 không đồng ý lọc `credit_kind` sẵn → spec ghi phương án `CREATE OR REPLACE` ở 487.
- Ước lượng: 1 phiên · 2.

### G12-F02 — Migration 487: sản phẩm gói, loại lượt riêng
- Mục đích: lượt giáo viên chấm tồn tại tách khỏi lượt AI.
- Đầu vào: GOI-04 5.2, 5.3 (`fn_credit_usable_balance`, `fn_credit_balance`, `fn_credit_reserve`, hàm xác nhận đơn); migration 381–383 trong repo.
- Việc làm: `487_review_pack_products.sql` + rollback + test PG17; sửa service `credits.py` thêm tham số `credit_kind`; `GET /api/me/credits` thêm khối `teacher_review`; test: số dư AI không đổi khi cấp lượt giáo viên chấm; giữ chỗ `teacher_review` không trừ lượt AI; xác nhận đơn gói ghi đúng `credit_kind`; mọi test G04 cũ qua.
- Đầu ra: 1 PR backend (high-risk).
- Nghiệm thu: `python -m pytest tests/ -q` toàn bộ qua; đếm truy vấn của `fn_credit_balance` không đổi.
- Không làm: không đổi đơn vị lượt AI; không giao diện.
- Vướng mắc có thể gặp → cách gỡ: hàm G04 đã đổi chữ ký so với GOI-04 → làm theo mã thật, ghi chỗ khác; CHECK kết hợp `kind`/`is_public` của `course_products` chặn `review_pack` công khai → mở CHECK đúng một chỗ, test cả hai chiều.
- Ước lượng: 3 phiên · 5.

### G12-F03 — Migration 488, nộp bài dùng lượt giáo viên, trần tuần, hạn trả, quá hạn
- Mục đích: bài gói vào hàng chờ với hạn rõ; trần và quá hạn tự xử lý.
- Đầu vào: 5.F; G09-T17 (`essay-queue`); GOI-11 `fn_notify`; G04 `writing_essays.review_mode`.
- Việc làm: `488_review_pack_queue.sql` + rollback + test; `services/review_pack.py` (đếm chỗ, giữ chỗ theo đơn mở, hạn ngày làm việc, ngừng nhận); `routers/review_pack.py` phía học viên; nguồn `review_pack` trong `essay-queue`; `scripts/review_pack_sweep.py`; ngoại lệ hiển thị bản AI cho bài gói (K12); test: đủ trần → 409 `week_full`; đơn mở giữ một chỗ; ngừng nhận cộng hạn dùng lượt; quá hạn → thông báo + hoàn lượt (theo `late_policy`); rút bài trước khi mở → hoàn; sau khi mở → 409; bài lớp offline vẫn ẩn tới khi trả.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua.
- Không làm: không đổi luồng bài lớp.
- Vướng mắc có thể gặp → cách gỡ: ngày nghỉ lễ chưa có → `holidays` rỗng, ghi trong PR; tuần tính theo giờ VN lệch UTC ở Chủ nhật đêm → hàm `week_start_vn` dùng chung với E, test ranh giới.
- Ước lượng: 3 phiên · 4.

### G12-F04 — Màn duyệt bài gói: đồng hồ, điều kiện ký, ghi cặp điểm
- Mục đích: phiếu trả có chữ ký và bản ghi cặp điểm đầy đủ.
- Đầu vào: tờ `GoiGiaoVienChamAdmin` mục 3, 4; `AdminChamWriting`; `services/writing_score_pairs.py`.
- Việc làm: route `open`, `heartbeat`, `sign`; điều kiện ký FR-12-F-007; ghi `writing_score_pairs` với trường gói; giao diện màn duyệt; test: thiếu lý do khi sửa → 422; không có phần tự viết → 422; đồng hồ không cộng khi không thao tác quá 120 giây.
- Đầu ra: 1 PR.
- Nghiệm thu: pytest + test React qua; một lần ký tạo đúng một dòng cặp điểm có `delivery_path='review_pack'`.
- Không làm: không cho giáo viên (instructor) sửa band nếu G09 chưa mở quyền đó — khi đó F04 chờ G09 hoặc chỉ admin ký được (ghi trong PR).
- Vướng mắc có thể gặp → cách gỡ: giáo viên vai trò instructor bị 403 khi sửa (mục 2.2) → F04 phụ thuộc quyết định của G09-T17; đồng hồ đếm khi tab ẩn → chỉ cộng khi `visibilityState === 'visible'`.
- Ước lượng: 3 phiên · 4.

### G12-F05 — Giao diện học viên của gói
- Mục đích: học viên đăng ký, nộp, theo dõi, đọc phiếu.
- Đầu vào: tờ `GoiGiaoVienCham` mục 1–5; `ThanhToan` màn 1; `KetQuaWriting`.
- Việc làm: trang giới thiệu gói, trạng thái 1b–1e, nộp bài kèm ghi chú, trang một bài đã gửi, trễ hạn, danh sách bài gửi, phiếu có chữ ký; test React (không đếm ngược, không màu đánh dấu cho số chỗ, câu "điểm bài luyện").
- Đầu ra: 1 PR frontend.
- Nghiệm thu: preview 1280px, 390px.
- Không làm: không hiện con số trần (mặc định của tờ).
- Vướng mắc có thể gặp → cách gỡ: màn đăng ký G05 chưa nhận sản phẩm `review_pack` → thêm nhánh nhỏ trong PR này, ghi cho G05; phiếu G07-T20 chưa có khối chữ ký → thêm khối tuỳ chọn.
- Ước lượng: 3 phiên · 3.

### G12-F06 — Thẻ gói phía admin, ngăn cấu hình, thống kê
- Mục đích: anh Andy điều khiển trần, ngừng nhận và xem số phút duyệt.
- Đầu vào: tờ `GoiGiaoVienChamAdmin` mục 1, 2; `AdminCaiDat` #m6; `AdminViecCanLam`.
- Việc làm: thẻ "Gói giáo viên chấm" trong Writing; ngăn cấu hình (chỉ quản trị); lịch ngừng nhận; thống kê 8 tuần; hai ngưỡng mới; việc "sắp trễ hạn trả gói"; test React.
- Đầu ra: 1 PR.
- Nghiệm thu: preview 1280px, 1024px; mọi lần đổi cấu hình có dòng `admin_settings_log`.
- Không làm: không mục sidebar.
- Vướng mắc có thể gặp → cách gỡ: số Writing trên sidebar gộp bài gói → thẻ tách nguồn rõ, sidebar giữ chuẩn; giáo viên bấm ngừng nhận khi anh Andy chọn "không cho" → ẩn nút theo `teacher_can_pause`.
- Ước lượng: 2 phiên · 3.

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Gói gốc chưa merge (G04, G07, G09, GOI-11) | Bảng/hàm/route ghi trong 3.4 không có trên `origin/staging` | Làm nhiệm vụ không phụ thuộc; migration có `to_regclass` dừng với lỗi rõ | Khi mọi nhiệm vụ còn lại của phần đều phụ thuộc |
| Mã khác mô tả ở mục 2 | `grep` ra dòng khác, hàm đổi tên | Mã thắng; ghi chỗ khác vào PR | Khi chỗ khác làm đổi kết luận ở cuối 2.2 (ví dụ đã có bảng cặp điểm) |
| Số migration đã bị dùng | File `48x_*.sql` có sẵn hoặc PR đang mở | Lấy số kế trong 480–489 theo sổ; sửa bảng 5.0 trong PR | Khi dải hết số |
| Lời gọi AI mới tốn hơn dự tính | `ai_usage_logger` cho thấy chi phí một lần gọi vượt `REWRITE_MAX_USD_PER_CALL` | Giảm đầu vào (chỉ đoạn, không cả bài); không đổi mô hình khi chưa hỏi | Trước khi bật cờ trên production |
| Tờ và gói khác mâu thuẫn | Như M1–M10 | 00 thắng; tờ riêng của phần thắng ghi chú cũ của tờ chung; ghi khác biệt trong PR | Khi mâu thuẫn chạm quyết định sản phẩm chưa có trong mục 10 |
| Dữ liệu ít, tỉ lệ vô nghĩa | Nhóm dưới ngưỡng số người tối thiểu | Hiện số đếm, không phần trăm | Không cần hỏi |
| Test cũ ghim chuỗi/đường dẫn vỡ | Test đọc file nguồn so chuỗi | Sửa trong cùng PR, liệt kê | Quá 30 test ngoài dự kiến |
| Thư gửi trùng hoặc gửi nhầm | Hai dòng outbox cùng tuần | `dedupe_key` duy nhất; dry-run trước khi bật | Trước khi bật `weekly_digest_emails` ở production |

## 8. Ràng buộc riêng của gói

- Mỗi phần một cờ, tắt mặc định; bật ở staging trước, production chỉ khi anh Andy nói. Lý do: gỡ được từng phần khi điều kiện DỪNG ở 1.4 xảy ra.
- Ngoại lệ: trigger chụp điểm AI (480) chạy không phụ thuộc cờ. Lý do: nó chỉ chép dữ liệu đang có vào bảng chỉ ghi thêm, không đổi hành vi nào; tắt nó là để mất điểm AI gốc vĩnh viễn.
- Hai bảng của C chỉ ghi thêm, kể cả với `service_role`. Lý do: một lần ghi đè là mất cặp điểm vĩnh viễn, không lấy lại được.
- Không hiện band ở D, ở bản viết lại của B, ở thư của E. Lý do: các con số đó không đủ dữ liệu để là band (00 mục 3).
- Không chuỗi ngày, huy hiệu, điểm thưởng, đếm ngược ở bất kỳ phần nào. Lý do: khảo sát mục 4 điểm 5; chúng không làm ai học đúng hơn.
- Không gọi AI để gán nhãn nhóm lỗi, sinh câu ôn, hay sinh phần chữ "Điều AI chấm kém". Lý do: nhãn sai thì ôn sai chỗ, và phần chữ công khai phải do người chịu trách nhiệm viết.
- Mọi bảng mới không có policy cho `authenticated`/`anon`; học viên đọc qua API backend. Lý do: tránh lặp lỗi `quiz_attempts` đọc được `is_correct` trực tiếp.
- Mọi lời gọi AI mới qua `ai_usage_logger`; test dùng provider giả. Lý do: 00 mục 4 điểm 10.
- Không chép dữ liệu học viên thật vào test, ảnh chụp, log; script đối soát và sweep không in email, tên.
- Câu chữ giao diện theo 00 mục 3: xưng "bạn", "giáo viên", "Học phí", "Đăng ký", không "mua/bán/giá/đơn hàng"; không trộn Việt–Anh trên một màn (tên tiêu chí IELTS giữ tiếng Anh).

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

Môi trường: local (pytest, PG17 cho migration) và staging. Không nộp bài, không đổi dữ liệu trên production; production chỉ được bật cờ khi anh Andy nói, sau khi staging đạt.

1. **Cặp điểm (C01–C03).** Given staging đã áp 480, cờ `writing_score_pairs_record` bật, một bài Writing thử của lớp thử đã được AI chấm. When admin sửa Lexical Resource từ 6.0 lên 6.5 rồi trả. Then `writing_score_pairs_latest` có một dòng: `band_lr` của ảnh chụp AI (nối `writing_ai_score_snapshots` qua `ai_before_edit_snapshot_id`) 6.0, `teacher_lr` 6.5, `reviewer_role='admin'`, `reviewer_can_edit_bands=true`; thử `UPDATE writing_score_pairs SET teacher_lr=7` bằng service role → lỗi `writing_score_pairs_append_only`; dòng `writing_ai_score_snapshots` của bài vẫn 6.0 sau khi `deliver` đổi `prompt_version`.
2. **Sổ lỗi (A).** Given tài khoản thử ở lớp thử Course 1 làm bài B13, sai 3 câu nhóm "Quá khứ với did" ở hai bài. When mở Hôm nay sau 2 ngày. Then khối "Lỗi đang lặp lại" ghi "… cần ôn hôm nay", "Ôn 10 phút" mở phiên 4 câu, đúng cả 4 → mục sang mốc 2, ngày kế +7; sai 1 → ở lại mốc 1; không lúc nào trình duyệt nhận đáp án trước khi trả lời (xem tab Network).
3. **Viết lại (B).** Given bài Task 2 thử đã trả, đề "Working from home" có trong kho. When viết lại Thân bài 1 (provider giả trả một nhãn "đã xử lý" với câu trích không có trong bản 2). Then kết quả hạ nhãn đó thành "còn"; lần viết lại đầu không trừ lượt (`first_free`), lần hai trừ 1; "Bài của tôi đứng đâu" mở được sau khi đã có bản viết lại, khác biệt nào cũng có câu trích từ bài 7.0.
4. **Kiểm tra đầu vào (D).** Given tài khoản miễn phí mới. When làm ba phần với 2 nhóm "Hổng". Then "Nên bắt đầu: Khoá Ngữ pháp nền tảng", Writing ở "Chưa nên học lúc này", Vocabulary ở "Chưa đủ dữ liệu"; trang không có chữ "band", không phần trăm tổng; làm lại trước hạn → chỉ thấy ngày.
5. **Kế hoạch tuần (E).** Given học viên online thử với 48 bài còn lại, ngày thi sau 17 tuần. When Thứ Hai tác vụ chạy. Then thẻ ghi 6 việc (3 bài học, 1 bài viết, 2 lượt ôn lỗi khi A bật); Chủ nhật 19:00 có đúng một dòng outbox `weekly_summary`; bấm "Tắt thư tổng kết tuần" ở trang xác nhận → tuần sau không có dòng outbox.
6. **Gói giáo viên chấm (F).** Given trần tuần 2 (staging), hai bài đã nộp. When học viên thứ ba nộp. Then 409 "Tuần này đã đủ chỗ" kèm ngày mở lại; bài quá hạn trả → học viên nhận thông báo và lượt được hoàn (theo `late_policy`); ký thiếu lý do sửa → không ký được.
7. **Độ lệch (C sau).** Given 6 cặp thử. When chạy `score_gap_rollup`. Then số trên thẻ admin khớp tính tay; công bố bị từ chối khi dưới 50 bài; trang công khai 404.

Bằng chứng mỗi nhiệm vụ: lệnh test + kết quả + số test bỏ qua trong thân PR; ảnh chụp 1280px và 390px cho nhiệm vụ giao diện (dữ liệu thử, không dữ liệu thật). Báo đúng bốn trạng thái: ở nhánh · đã merge `staging` · đã lên production · người dùng đã nghiệm thu.

## 10. Cần anh Andy quyết

Mỗi câu: phương án đề nghị · mặc định tạm người thực thi dùng nếu chưa có trả lời (lấy đúng theo cách tờ đang vẽ). Mọi mặc định đều là cấu hình, đổi không cần sửa mã.

**Chung**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| G1 | Có đưa C01–C03 (lưu cặp điểm) vào đợt D cùng G09-T17 không? | Có: thiếu nó thì mọi bài duyệt từ nay tới khi làm phần C là mất cặp điểm, trong khi việc chỉ khoảng 5 phiên | **ĐÃ TRẢ LỜI 18/11: CÓ**, đưa vào đợt D (00 điểm 24) |
| G2 | Ghi số 0088–0094 và 480–489 cho GOI-12 vào sổ ở 01 mục 6 | Ghi | **ĐÃ CÓ** ở 01 mục 6 (bản tối 18/11); người thực thi dùng hai khối này |

**A — Sổ lỗi**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| A1 | Ngưỡng lập mục | 2 câu sai cùng nhóm, cộng dồn qua các bài | 2 (`ERROR_BOOK_OPEN_MIN_WRONG`) |
| A2 | Trần mỗi ngày | 3 mục (12 câu, khoảng 10 phút) | 3 |
| A3 | Phiên đạt: đúng cả 4 câu, hay cho sai 1 câu trắc nghiệm (câu viết lại vẫn phải đúng) | Đúng cả 4 ở bản đầu, xem tỉ lệ ở lại mốc sau 4 tuần | `all_correct` |
| A4 | Số lỗi cần ôn có cộng vào số việc ở câu chào Hôm nay không | Không | Không (như tờ) |
| A5 | Ngưỡng hiện biểu đồ tháng | 5 câu mỗi tháng | 5 |
| A6 | Giáo viên thấy tên người "ôn hai lần vẫn sai" | Có, chỉ giáo viên của lớp | Có (như tờ) |
| A7 | Cho ôn sớm mục chưa đến hạn không | Có, không đổi lịch nếu ôn sớm | Có |
| A8 | Ai duyệt bảng tên nhóm và ánh xạ nhóm → bài Grammar Wiki, câu viết lại | Anh Andy duyệt một lần mỗi khoá | Nhóm chưa duyệt không lập mục |

**B — Viết lại sau khi chấm**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| B1 | Cách tính lượt: A (lần viết lại đầu của mỗi bài không tốn lượt, từ lần hai 1 lượt) hay B (mỗi lần 1 lượt) | A, kèm trần chi phí tháng cho bản miễn lượt | A (`first_free`, như tờ vẽ) |
| B2 | Bản viết lại của lớp offline có qua giáo viên duyệt không | Không: AI đối chiếu trả ngay, giáo viên xem được | `instant` (như tờ) |
| B3 | Khoá bài mẫu mềm hay cứng trên phiếu | Mềm (Thư viện công khai nên khoá cứng không thật) | `soft` (như tờ) |
| B4 | Trần 3 bản viết lại mỗi đoạn và 140 từ | Giữ | 3 và 140 |
| B5 | "Viết lại một đoạn" thay "Viết lại bài này" làm nút chính ở phiếu | Có | Có (như tờ) |
| B6 | Mô hình và trần chi phí mỗi lần đối chiếu | Mô hình rẻ hơn mô hình chấm, trần 0,01 USD/lần (chưa đo) | Cấu hình rỗng → B03 không bật được |

**C — Độ lệch AI–giáo viên**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| C1 | (= G1) | | |
| C2 | Ngưỡng công bố: 50 bài và lệch trung bình ≤ 0.5 band; ngưỡng từng dòng 30 bài; kỳ đo 6 tháng | Giữ | Như tờ |
| C3 | Có làm mẫu chấm mù không, bao nhiêu bài mỗi tháng | Có, 5 bài/tháng, sau khi có 50 cặp | Không làm (C08 không bắt đầu) |
| C4 | Tên trang và đường dẫn | "Chúng tôi chấm bài thế nào", `/cham-bai-the-nao` | Như tờ |
| C5 | Có đưa bài viết của thi thử vào cùng bảng không | Chưa, tách sau khi đủ số | Chỉ bài tập Writing của lớp (như tờ) |
| C6 | Đã công bố mà số xấu đi: vẫn hiện hay tự tạm ẩn | Vẫn hiện, kèm ngày cập nhật (trung thực) | Vẫn hiện (như tờ) |
| C7 | Giáo viên có xem được thẻ độ lệch không; thẻ của Writing hay mục trong Báo cáo | Có, chỉ lớp mình; thẻ của Writing | Như tờ |
| C8 | Ai viết và duyệt phần chữ "Điều AI chấm kém" | Anh Andy | Thiếu phần chữ → không công bố được |
| C9 | Có mở cho giáo viên (vai trò instructor) sửa band không (hôm nay bị 403) | Quyết cùng G09-T17; nếu có thì phải đi qua bản `composed` | Không đổi; cặp của giáo viên instructor đánh dấu `reviewer_can_edit_bands=false` |

**D — Kiểm tra đầu vào**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| D1 | Thứ tự gợi ý giữa sáu khoá và các ngưỡng ở bảng 4b | Như tờ, xem lại sau 8 tuần theo phễu | `rules-v1.json` như tờ |
| D2 | Số ngày được làm lại và số ngày giữ bài làm dở | Làm lại sau 30 ngày; giữ bài dở 7 ngày | Làm lại: chưa cho (`null`); giữ: 7 |
| D3 | Đoạn viết 120 từ tính là 1 lượt chấm thử Writing Task 2 hay hạn mức riêng | Tính 1 lượt Task 2 | 1 lượt Task 2 (như tờ) |
| D4 | Khách chưa đăng nhập có được làm ba phần đầu rồi mới yêu cầu tài khoản không | Không: cần tài khoản trước để lưu bài dở | Cần tài khoản (như tờ) |
| D5 | Người đã có khoá có được làm không | Có, không có phần 4 | Như tờ |
| D6 | Dùng chung engine bài chẩn đoán 0003 hay bảng riêng (gói đề nghị bảng riêng, chỉ đọc `grammar_items`) | Bảng riêng | Bảng riêng |
| D7 | Cửa sổ "đăng ký đúng khoá gợi ý" | 14 ngày | 14 |

**E — Nhắc việc và thư tuần**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| E1 | Ngưỡng hiện khối chậm kế hoạch | Hai tuần liên tiếp dưới một nửa | Như tờ |
| E2 | Có gắn nhãn cốt lõi / mở rộng cho bài của sáu khoá không (không có thì bỏ "Giảm tải") | Có, khi soạn khoá | Chưa gắn → không có "Giảm tải" |
| E3 | Thư 16 ngừng sau mấy tuần | 2 | 2 |
| E4 | Ngày giờ gửi mặc định | Chủ nhật 19:00; nhắc giữa tuần Thứ Năm 19:00 | Như tờ |
| E5 | Thành phần một tuần của khoá online; bài viết của tuần có trừ lượt như bài thường không | 3 bài học, 1 bài viết, 2 lượt ôn lỗi; có trừ 1 lượt | Như tờ |
| E6 | Lớp offline có nhận thư tổng kết tuần không | Có, không nhận thư 16 | Như tờ |
| E7 | Nguồn mục tiêu và ngày thi: `users.*` hay `students.*` | `users.target_band`, `users.exam_date` (đang được `PATCH /auth/profile` ghi) | Theo G07; G07 chưa chọn thì `users.*` |
| E8 | Địa chỉ gửi thư học viên (tên miền đã xác minh) | Theo GOI-04 Q9 | Chưa có → không bật thư |

**F — Gói giáo viên chấm**

| # | Câu hỏi | Đề nghị | Mặc định tạm |
|---|---|---|---|
| F1 | Học phí, số lượt mỗi gói, hạn dùng lượt, hạn trả (ngày làm việc) | Anh Andy điền | `XXX`; hạn trả NULL → không bật được |
| F2 | Trần mỗi tuần khởi điểm; có hiện con số trần cho người học không | 8 bài; không hiện, chỉ hiện "còn chỗ" | 8, không hiện (như tờ) |
| F3 | Cách bù khi trễ hạn | Tự hoàn lượt và vẫn trả phiếu | Như đề xuất của tờ |
| F4 | Chỗ trong tuần tính theo bài nộp hay theo đơn đăng ký | Theo bài nộp; đơn mở giữ tạm một chỗ | Như tờ |
| F5 | Chỉ Writing hay cả Speaking | Chỉ Writing | Chỉ Writing (như tờ) |
| F6 | Có mở cho người chưa có Khoá Writing không | Không | Không (như tờ) |
| F7 | Có cho hỏi lại một câu về phiếu không; có mục "một đoạn viết lại" bắt buộc không | Cho hỏi lại một câu; viết lại không bắt buộc | Không có hỏi lại, không bắt buộc viết lại |
| F8 | Khi giáo viên ngừng nhận, hạn dùng lượt có được cộng thêm không | Có | Có (như tờ) |
| F9 | Giáo viên (không phải quản trị) có được bấm ngừng nhận; có cho "nhận thêm 1 bài" vượt trần | Có; vượt trần chỉ quản trị | Như tờ |

### 10.1 Mâu thuẫn đã biết (người thực thi không tự sửa tờ hay gói khác)

| # | Chỗ | Mâu thuẫn | Mặc định tạm |
|---|---|---|---|
| M1 | Tờ `KetQuaWriting` (thẻ "Bài mẫu cùng đề" ở hàng thẻ phiếu; nút "Đọc bài mẫu 7.5 cùng đề" ở "Làm gì tiếp") | Trái quy tắc "mở bài mẫu sau khi viết lại" của `VietLaiSauCham` mục 4 | Khi B tắt: giữ như tờ KetQuaWriting. Khi B bật: thay bằng thẻ khoá mềm của VietLaiSauCham |
| M2 | Tờ `HomNayTrangThai` mục 5c (khối hết lượt: "So bài nháp với bài mẫu 7.0 cùng đề"); `CreditsEmptyNotice` của G07-T27 | Cùng quy tắc trên | Như M1 |
| M3 | GOI-07 FR-07-029b, mục 5.3; tờ `HomNayTrangThai` ghi chú lập trình | "Lỗi đang lặp lại" = lỗi số 1 của Tiến độ, từ 2 bài có nhận xét, "Ôn 10 phút" mở Grammar Wiki, "Xem cả n lỗi" → `/progress`; tờ SoLoiCaNhan: lỗi ngữ pháp, từ 2 câu, mở phiên ôn và trang Sổ lỗi | SoLoiCaNhan thắng (K2) |
| M4 | Tờ `TienDo` ("Lỗi lặp lại nhiều nhất" gom từ 5 bài Writing và 6 buổi Speaking) | Bản ngữ pháp không cấp được dữ liệu Writing/Speaking | Hiện mục ngữ pháp, ghi nguồn; Writing/Speaking ẩn tới spec Writing sau |
| M5 | Tờ `DoLechAIGiaoVien`, `DoLechAIGiaoVienAdmin` ("`mock_exam_reviews` đã lưu riêng `ai_draft` và `final_bands`, tức đã có sẵn cặp điểm") | Sai với mã: `ai_draft.writing` bị ghi lại từ bản đã sửa (`sync_writing_band_for_essay`), chỉ có band chung theo kỹ năng | Không dùng `mock_exam_reviews` cho độ lệch |
| M6 | Tờ `AdminChamWriting` ("Mỗi tiêu chí lưu cả điểm AI và điểm giáo viên"; giáo viên sửa điểm) và GOI-09 T17 ("không thêm cột điểm AI/giáo viên nếu chưa có") | Mã hiện tại: không lưu cặp; giáo viên vai trò instructor bị 403 khi sửa | C02/C03 làm cùng đợt D (G1); quyền sửa của giáo viên theo C9 |
| M7 | Tờ `AdminChamWriting` ghi chú ("Bài khoá online và tự luyện không vào đây") | F đưa bài gói của khoá online vào hàng chờ | Thẻ và nguồn riêng "Gói giáo viên chấm"; câu của tờ đúng cho mọi bài khác |
| M8 | Tờ `KiemTraDauVao` 1a (thay khối "Chưa biết bắt đầu từ khoá nào?" ở trang chủ công khai) | Khối đó nằm ở tờ `DanhMucKhoa`, không có ở `TrangChuCongKhai` | Đặt ở Danh mục khoá; trang chủ chỉ thêm lối vào nếu anh muốn |
| M9 | Tờ `DanhMucKhoa` ("không phải bài kiểm tra; các khoá không có thứ tự bắt buộc") và `KiemTraDauVao` mục 4 ("Nếu bạn định học nhiều khoá": thứ tự) | Một bên nói không có thứ tự, một bên gợi ý thứ tự | Thứ tự chỉ là gợi ý, có câu "đây là gợi ý, không phải điều kiện" (như KiemTraDauVao) |
| M10 | GOI-04 mục 5.3 (`credit_kind` chỉ `ai_grading`; `feature` 3 giá trị; `course_products.kind` 3 giá trị; outbox 8 mẫu) | B, E, F cần mở rộng | Mở rộng trong 482, 486, 487 (K6) |
| M11 | GOI-04 FR-04-020 và `writing_student.get_my_essay` (bài `teacher_review` ẩn phản hồi tới khi trả) với tờ `GoiGiaoVienCham` (học viên online thấy bản AI ngay) | Hai quy tắc hiển thị khác nhau | Ngoại lệ chỉ cho bài gói (K12) |
| M12 | `users.target_band`/`exam_date` (mig 005) và `students.target_band`/`target_date` (mig 033) | Hai chỗ lưu mục tiêu | Theo E7 |
