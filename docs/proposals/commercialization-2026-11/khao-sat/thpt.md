# Khảo sát ~/Documents/Co-work/THPT (chỉ đọc)

## 1. Kiểm kê
Tổng 132 file, ~14,4 MB (không file nào bị sửa/tạo trong Documents).
- md: 119 (73 đề + tài liệu quy trình + 979 thẻ từ vựng + 4 asset bank)
- pdf: 10 (đề chính thức của Bộ, 2017-2026)
- py: 2 (qa/validate_de.py, _tmp_validate_vocab.py) · csv: 1 (tracker.csv, 73 dòng) · không có docx/json/hình.

Cây thư mục:
- Gốc: 10 PDF đề thật + MASTER-TRAINING-TIENG-ANH-THPT.md (phân tích 10 đề, SOP, blueprint) + KE-HOACH-100-DE.md + LO-0-README + BAO-CAO-LO1..5 + AUDIT-REPORT + PILOT/SENIOR-REVIEW + tracker.csv
- de-mau/ DE-01..DE-10.md (0,5 MB) · content_de/ DE-011..DE-073.md (63 file, 3 MB) · content_vocab/ 29 file, 979 thẻ (AWL sublist 2-10 = 510; THPT-core 8 file ~202; TOEIC-core 11 file ~267) · asset_banks/ (topic, idiom, grammar G1-G16, trap templates A-F) · template/DE-TEMPLATE.md · qa/validate_de.py

Quy ước đặt tên: PDF không thống nhất (2017-de-thi.pdf, "de-thi-thpt-quoc gia-2024-...pdf" có khoảng trắng, "Đề 401.pdf", De_thi_TN_THPT_2026_..._ma_1116.pdf); đề sinh: DE-01..10 rồi DE-011..073 (đổi độ rộng số, nên chuẩn hoá thành DE-001..DE-100 khi nhập). Mã đề dạng 0101, 0731.

## 2. Hai nhóm "đề" — khác bản chất, quan trọng nhất
### A. 10 PDF đề chính thức của Bộ GD&ĐT (2017-2026)
| Năm | Mã | Định dạng | Chữ/ảnh | Ghi chú |
|---|---|---|---|---|
| 2017 | 401 | cũ 50 câu/60' | chữ | 6 trang |
| 2018 | 401 | cũ 50 | chữ | |
| 2019 | 401 | cũ 50 | **ẢNH SCAN** (2480x3507, 5 trang, không có text) | file "Đề 401.pdf", 7,4 MB; cần OCR (có tesseract tại /opt/homebrew/bin; chưa có ocrmypdf) |
| 2020 | 402 | cũ 50 | chữ | |
| 2021 | 401 | cũ 50 | chữ | |
| 2022 | 405 | cũ 50 | chữ | |
| 2023 | 401 | cũ 50 | chữ | |
| 2024 | 401 | cũ 50 | chữ | |
| 2025 | 1101 | **mới 40 câu/50'** | chữ | 6 phần, 100% theo văn bản |
| 2026 | 1116 | mới 40 | chữ | |
- 9/10 PDF có text layer (pdftotext -layout chạy tốt, 16-24k ký tự/đề), 1/10 cần OCR.
- **Không PDF nào có đáp án hay lời giải** (chỉ là đề). Muốn dùng làm "đề luyện có chấm" phải lấy đáp án chính thức từ nguồn khác (Bộ công bố) hoặc tự giải + đối chiếu; chưa có file đáp án nào trong thư mục.
- Chỉ 1 mã đề mỗi năm (Bộ phát 24-48 mã đề).
- Định dạng cũ có: phát âm (2), trọng âm (2), giao tiếp (2), đồng nghĩa (2), trái nghĩa (2), ngữ pháp-từ vựng (~15), tìm lỗi sai (3), viết lại câu (3), nối câu (2), điền từ đoạn văn (5), đọc hiểu (5 + 7). Định dạng mới 2025+: sắp xếp (5), cloze điền câu vào đoạn (5), đọc hiểu 8 câu, đọc hiểu 10 câu (có chèn câu [I]-[IV], tóm tắt), cloze thông báo (6), cloze tờ rơi (6).
- **Bản quyền:** đề chính thức do Bộ GD&ĐT ban hành, thường được phổ biến công khai nhưng văn bản bài đọc trích từ sách/web có bản quyền (The Business of Tourism, Psychology of Money, greenpeace.org.uk, nhs.uk, vanderbilthustler.com... theo MASTER §3.3). File PDF nhiều khả năng tải từ trang đề thi của bên thứ ba (metadata ghi tên site/docx). Dùng công khai cần cân nhắc/xin phép; an toàn hơn là chỉ làm trang hiển thị tham chiếu hoặc dùng nội bộ.

### B. 73 đề "tham khảo" tự biên soạn (de-mau 10 + content_de 63) — do AI sinh theo blueprint
- Không phải đề của Bộ, không phải sách NXB: văn bản "biên soạn mới theo phong cách đề chính thức"; dòng "(Adapted from …)" chỉ là mô phỏng định dạng (có disclaimer đầu đề). Rủi ro bản quyền thấp, nhưng nên **không để học sinh hiểu đây là nguồn thật** (nhãn "Adapted from <tên nguồn thật>" có thể gây hiểu nhầm; cân nhắc gỡ hoặc ghi "bài đọc tự biên soạn").
- Cả 73 đề: **format mới 40 câu/50 phút/6 phần** (kiểm máy: 73/73 có đủ 40 câu "**Question n.**" và mục GIẢI CHI TIẾT), có BẢNG ĐÁP ÁN, GIẢI CHI TIẾT từng câu (dạng, mức NB/TH/VD, distractor, bẫy A-F), MA TRẬN ĐỀ, phân bố đáp án.
- Cấu trúc 1 đề: Q1-5 sắp xếp (hội thoại 3 lượt, hội thoại 5 lượt, thư, 2 đoạn) · Q6-10 cloze điền câu · Q11-18 đọc 8 câu · Q19-28 đọc 10 câu · Q29-34 cloze thông báo · Q35-40 cloze tờ rơi. Ma trận chuẩn 9 NB/15 TH/16 VD.
- Số lượng thực tế là **73/100** (không phải 100): còn thiếu 27 đề (BAO-CAO-LO5 đề xuất Lô 6 +12 để lên 85). DE-001..DE-099 hay DE-100 chưa có.
- Chất lượng đã qua QA: audit giải lại mù từng đề, validate_de.py, senior review; ghi nhận lỗi đã sửa (DE-05/06 Q3, nhiều câu length-tell...). Tồn đọng đã biết: DE-05/DE-06 cố ý ma trận 3/19/18 (lệch chuẩn); DE-011..013 rubric chưa theo template; tracker DE-02..04, 07..10 nhiều ô "TBD". Chưa có human acceptance (người thật/giáo viên duyệt) trong tài liệu.

## 3. Ước lượng công chuyển thành dữ liệu có cấu trúc
| Nhóm | Số lượng | Tình trạng | Công việc |
|---|---|---|---|
| Đề sinh DE-01..073 (md) | 73 | Đọc máy ngay: định dạng markdown rất đều (**Question n.**, A./B./C./D., bảng đáp án, giải thích "**Câu n — Đáp án: X** \| Dạng \| Mức"). Có đáp án + lời giải 100% | Viết 1 parser (thường 1-2 ngày công): tách 6 phần, passage, 40 câu, đáp án, dạng, mức, giải thích, bẫy. Ngoại lệ định dạng: de-mau (phương án cùng 1 dòng) vs content_de (mỗi dòng); thư/passage có đánh [I]-[IV] và ký hiệu (6)____ ; cần test từng loại. validate_de.py có thể tái dùng làm cửa kiểm |
| PDF 2017-2018, 2020-2024 | 7 | Có text, nhưng **không đáp án/lời giải** | Parse câu bằng regex "Question n." + phương án (bố cục 2 cột, có ký tự gạch chân khó nhận: cần đánh dấu underline thủ công cho câu phát âm/đồng nghĩa); phải bổ sung đáp án + giải thích |
| PDF 2025, 2026 | 2 | Có text, không đáp án | Như trên, nhưng bố cục mới dễ hơn (có sắp xếp, passage dài) |
| PDF 2019 scan | 1 | Cần OCR (tesseract có sẵn) + sửa tay | OCR 5 trang, kiểm tay phần phát âm/trọng âm |
| Thẻ từ vựng | 979 | YAML front matter, 0 trùng slug (audit) | Nạp trực tiếp; đã có trường tested_in/lists/collocations/common_error |
Tổng: 73 đề đọc máy ngay & đủ đáp án/giải; 9 PDF đọc được nhưng thiếu đáp án; 1 PDF cần OCR và thiếu đáp án. Đề thật có thể bổ sung lời giải bằng agent nhưng phải kiểm tay (rủi ro đáp án sai, lịch sử cho thấy ~5-11% câu cần sửa ở bản sinh).
Lưu ý: đề cũ 50 câu có các dạng (phát âm, trọng âm, tìm lỗi sai, viết lại câu) không tồn tại trong 73 đề mới -> mô hình dữ liệu cần trường question_type mở rộng + trường passage riêng.

## 4. Dàn bài khoá ngữ pháp "Hermes"
Không có file nào ghi tên Hermes (tìm theo tên file "hermes" trong Co-work: 0 kết quả). Mình **không xác định được file nào do Hermes soạn**. Có hai ứng viên khớp từ khoá, anh Andy cần xác nhận cái nào là của Hermes:

### Ứng viên 1 (hiện hành, mới nhất): "Dựng câu" — Course 1 (author trong 00_DOC-TRUOC.md: averandy12, 31/07/2026)
- Đề cương: ~/Documents/Co-work/Course 1/15_DE-CUONG-V2/De-cuong-381-bai-v2.md (cập nhật 13/10/2026), chi tiết theo module ở .../15_DE-CUONG-V2/theo-mo-dun/M01.md..M20.md; dữ liệu máy: 381-bai-v2.jsonl. (Thư mục "Course 1.__MAC_BACKUP_20261104T195732" là bản sao lưu; bản chính "Course 1" là bản dùng.) Còn có giáo trình 20 buổi: .../Course 1/03_BAN-GIAO-VIEN (map 20 buổi TM20-B01..B20 trong ...BACKUP.../06_KHO-BAI-TAP/COURSE-SESSION-MAP.tsv).
- 381 bài (321 LÕI + 60 MỞ RỘNG), 20 module. Cây chủ đề:
  - M01 B001-017 khung câu, be · M02 B018-037 phát âm/chính tả, đuôi -s/-ed, trọng âm · M03 B038-054 hiện tại, câu hỏi · M04 B055-087 danh từ, lượng từ, mạo từ, đại từ · M05 B088-105 tính từ, trật tự, so sánh · M06 B106-125 trạng từ, giới từ, because/although/despite/during/while · M07 B126-135 quá khứ, tương lai (will/going to, tương lai trong mệnh đề thời gian) · M08 B136-147 hoàn thành (HTHT vs QKĐ, for/since, QKHT) · M09 B148-172 hoà hợp S-V, bị động, đọc chuỗi động từ · M10 B173-189 họ từ, giới từ phụ thuộc, collocation, paraphrase · M11 B190-208 modal (suy đoán, should have, need not have) · M12 B209-217 điều kiện 0-3, unless, wish · M13 B218-234 V-ing/to V/verb patterns, too/enough · M14 B235-248 nối câu, liên từ, song song, dấu câu · M15 B249-264 mệnh đề danh từ, tường thuật, bị động báo cáo · M16 B265-287 mệnh đề trạng ngữ, quan hệ, rút gọn · M17 B288-302 liên kết đoạn (tham chiếu, this+N, từ nối), đọc ý chính/suy ra · M18 B303-317 mô tả dữ liệu · M19 B318-321 vận dụng, kiểm đầu ra · M20 B322-381 mở rộng: have sth done (B343), điều kiện hỗn hợp (B346), wish quá khứ (B350), which trỏ cả mệnh đề (B357), Having+V3 (B359), câu chẻ (B361-363), đảo ngữ never/only/not until/hardly (B364-367), thức giả định (B368).
### Ứng viên 2: "Khoá học Ngữ pháp 60 buổi" — ~/Documents/Co-work/Grammar Course/Khoá học Online/MASTER PLAN — Khoá học Ngữ pháp 60 buổi.docx (cũ hơn, 04/05/2026; kèm Scripts/Slides PPTX/PDF 60 buổi)
- 30 bài x 2 buổi (A lý thuyết, B thực hành): 0.1 7 từ loại · 1 5 cấu trúc câu · 0.2 IPA/collocation · 2 cụm danh từ/mạo từ · 3 đại từ · 4 tính từ · 5 trạng từ · 6 so sánh · 7 giới từ · 8 12 thì · 9 hoà hợp S-V · 10 bị động · 11 modal · 12 điều kiện · 13 non-finite · 14 to-V · 15 FANBOYS/câu ghép · 16 MĐ danh từ · 17 MĐ trạng từ · 18-19 MĐ tính từ · 20 tổng kết MĐ · 21-23 rút gọn · 24 đảo ngữ · 25 nhấn mạnh/cleft · 26 tường thuật + nominalisation · 27 dấu câu · 28 tổng ôn.
(Còn folder Grammar Course/grammar_data.py, grammar_checker.py, mindmap: dữ liệu ngữ pháp cho công cụ, chưa đọc sâu.)
Ghi chú: đề cương Hermes nếu khác hai bản này thì nằm ngoài phạm vi tìm (không mở rộng ngoài Co-work/độ sâu 4, theo yêu cầu).

## 5. Bảng ánh xạ sơ bộ: dạng câu THPT -> chủ đề ngữ pháp/từ vựng -> bài học (mã bài Course 1 / "Dựng câu"; thay bằng buổi tương ứng nếu Hermes là bản 60 buổi)
| Dạng câu (nhãn) | Điểm kiểm tra | Chủ đề bài học liên kết |
|---|---|---|
| Phát âm -ed/-s (đề cũ) | đuôi -ed, -s/-es, nguyên âm | M02 B028-B031 |
| Trọng âm (đề cũ) | trọng âm từ 2-3 âm tiết, hậu tố | M02 B032, B036; M10 B173-174 |
| Giao tiếp (đề cũ) + hội thoại sắp xếp | đáp lời, khen/cảm ơn/đề nghị | M03 B043; M11 B196 (will/would/shall); B207-208 |
| Đồng nghĩa/trái nghĩa, từ vựng theo ngữ cảnh | nghĩa theo ngữ cảnh, idiom, collocation | M10 B183-187 + content_vocab (AWL/THPT-core) |
| Word form (cloze Q29-34) | từ loại theo vị trí | M10 B173-175, B179; M04-M06 |
| Collocation / giới từ đi kèm | giới từ phụ thuộc N/Adj/V | M10 B176-178, B185; M06 B113-115, B117 |
| Phrasal verb | take over, pick up, sort out... | M20 B334-335 + vocab |
| Mạo từ/lượng từ (G9: either/other/another) | a/the/Ø, few/little, either/neither | M04 B060-B073, B078-B079; M20 B325 |
| Trật tự tính từ ("heavy grocery bags") | trật tự nhiều tính từ | M05 B089-B093 |
| So sánh kép/nhất (G7) | the+comp, the+comp | M05 B096-B103; M20 B331 |
| Thì, hoà hợp thời gian (G1) | QKĐ/HTHT/QKHT, since/for | M07 B126-127; M08 B136-B147 |
| Mệnh đề thời gian không dùng will (G2) | when/until/as soon as | M07 B132; M16 B265 |
| Bị động, causative (G3) | passive các thì, have/get sth done | M09 B155-B161; M20 B342-343 |
| Câu điều kiện, wish, đảo ngữ điều kiện (G4) | loại 1-3, mixed, Were/Had/But for | M12 B209-B217; M20 B346-B351, B367 |
| Mệnh đề quan hệ + rút gọn (G5, G6) | who/which/whose/where, V-ing/V3, Having+V3 | M16 B271-B287; M20 B356-B359 |
| Câu hỏi đuôi (G8) | tag question | M03 (hỏi) / M14B (chưa thấy bài riêng - cần kiểm) |
| Đảo ngữ (G10) | Only after, Not until, Hardly...when, No sooner | M20 B364-B367 |
| Câu gián tiếp (G12) / mệnh đề danh từ | lùi thì, đổi ngôi | M15 B249-B264 |
| Liên từ/discourse marker (G13) | but/however/therefore | M14 B236-B239; M17 B289 |
| Modal (G14) | should have, need not, must | M11 B190-B206 |
| Hoà hợp S-V (G15) | each/every, a number of | M09 B148-B154 |
| Cấu trúc song song, đề-thuyết (G16, cloze điền câu) | chủ ngữ nhất quán, voice, parallel | M14 B240-B241; M16 B280-B283 (dangling) |
| Sắp xếp câu/thư/hội thoại | cohesion, tham chiếu, this+N, trình tự | M17 B288-B298; M14 B245-B247 |
| Đọc hiểu: detail/inference/main idea/summary | ý chính vs chi tiết, suy ra vs nêu rõ | M17 B299-B302 |
| Từ quy chiếu (reference) | it/they/this+N | M17 B290-B291 |
| Paraphrase câu gạch chân | đảo ngữ/điều kiện/rút gọn, nominalisation | M20 B345, B364-367; M10 B184 |
| Chèn câu [I]-[IV] | liên kết cũ-mới, từ nối | M17 B288-B289, B294 |
| Tìm lỗi sai, viết lại câu, nối câu (đề cũ) | tổng hợp ngữ pháp | các module ngữ pháp + "Chữa lỗi" cuối mỗi nhóm (vd B216, B222, B234, B263, B278) |
Mapping này dựa trên tiêu đề bài (chưa đọc nội dung từng bài) và grammar_bank G1-G16 của THPT; cần chuyên gia kiểm/chốt trước khi gắn thật. Mỗi câu trong 73 đề đã có nhãn "Dạng" và "Bẫy A-F" nên gắn tự động khá khả thi; nhãn điểm ngữ pháp từng câu (G-id) chưa thấy ghi sẵn trong từng câu (chỉ ghi ở tracker/bank) -> cần gán thêm (có thể dùng agent sinh nhãn).

## 6. Đề xuất cho trang web (rút từ khảo sát)
1. Dùng 73 đề sinh làm lõi (đủ đáp án + giải, rủi ro bản quyền thấp, đúng format hiện hành). 27 đề còn lại sản xuất tiếp bằng pipeline có sẵn.
2. Đề chính thức: chỉ hiển thị nếu anh chấp nhận rủi ro bản quyền ngữ liệu; cần bổ sung đáp án (chưa có) và OCR cho đề 2019.
3. Mô hình dữ liệu: exam -> part -> passage -> question(type, level, answer, explanation, trap, grammar_tag, vocab_tags, lesson_id).
4. Chốt trước: ai là Hermes/dàn bài nào là bản dùng; có gắn bài học theo "Dựng câu" 381 bài hay 60 buổi.
