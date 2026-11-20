# Sổ brainstorm — các nội dung anh Andy nêu ngày 17/11/2026

Trạng thái: SỔ LỊCH SỬ ngày 17/11 — phần lớn câu "Cần anh quyết" dưới đây đã có trả lời ở `00-QUY-UOC-CHUNG.md` mục 2 (A1 → điểm 22, 23; A2 → điểm 22, 23; A3 → điểm 19; A8 → điểm 16; B1 → điểm 23; B2 → điểm 23; B3 → điểm 22); mỗi câu đã có trả lời được đánh dấu "**Đã có trả lời**" ngay dưới, nội dung cũ giữ nguyên. Không dùng file này làm quy tắc; câu còn mở xem `01` mục 7 và `04` (cập nhật 18/11 tối). Mỗi mục gồm: ý của anh Andy, hiện trạng đã khảo sát (chỉ đọc mã ở `staging` @ 93c7085, chưa đối chiếu trên staging hay production), đề xuất của em, và câu cần anh quyết. Báo cáo khảo sát gốc: `khao-sat/repo-brainstorm.md`, `khao-sat/thpt.md`.

Chưa mục nào ở đây có tờ thiết kế hay spec, trừ chỗ ghi rõ.

## A. Liên quan giao diện

### A1. Nhận xét của học viên trên web, và khảo sát sau khoá
- **Ý của anh:** có khoảng 100 nhận xét cho mỗi khoá offline; đưa lên web. Admin tạo được form khảo sát sau khoá: thời gian làm bài trung bình mỗi buổi, nhận xét và đánh giá khoá, ý định học tiếp hay dừng.
- **Hiện trạng:** repo chưa có gì về nhận xét học viên hay khảo sát. Feedback hiện chỉ dành cho đề Reading/Listening.
- **Đề xuất:**
  - Một bảng nhận xét: khoá, lớp, nội dung nguyên văn, điểm đánh giá, cách hiển thị tên (đầy đủ / tên và chữ cái đầu / ẩn danh), đồng ý cho đăng (có/không, ngày), trạng thái duyệt. Chỉ nhận xét đã được học viên đồng ý và admin duyệt mới lên trang công khai.
  - Trang công khai: khối nhận xét ở trang chủ (3–5 câu chọn tay), ở trang từng khoá (lọc theo khoá), và một trang "Học viên nói gì" đầy đủ, có lọc theo khoá. Không sửa câu chữ của học viên, không gắn band nếu không có chứng cứ.
  - Khảo sát: không làm trình tạo form tự do ở đợt đầu. Làm một mẫu khảo sát sau khoá cố định gồm ba khối anh nêu, admin bật cho từng lớp, sửa được câu chữ và thêm tối đa vài câu hỏi mở. Trình tạo form tự do để sau nếu cần.
  - Câu cuối của khảo sát hỏi luôn "bạn có đồng ý cho đăng nhận xét này không, hiển thị tên thế nào", để nhận xét đi thẳng sang hàng chờ duyệt.
  - Nhập khoảng 100 nhận xét cũ mỗi khoá: qua script backend từ file anh đang có.
- **Cần anh quyết:** nhận xét cũ đã có sự đồng ý cho đăng chưa; hiển thị tên thế nào; có đăng kèm ảnh không.
- **Đã có trả lời** (18/11): đã có đồng ý, được đăng (00 điểm 22); hiện ở trang sáu khoá online, không ghi là của lớp offline (00 điểm 23); thiết kế và spec ở GOI-13 phần A. Còn mở: hiển thị tên, ảnh (GOI-13 mục 10).

### A2. Đơn giản hoá quản lý đề thi và mock test
- **Ý của anh:** giao đề cho lớp hoặc cho một nhóm học viên chọn tay; chọn chế độ phòng thi live hoặc cho học viên làm lần lượt từng phần.
- **Hiện trạng:** repo đã có hai chế độ: `sequential` (phòng live, giám thị bấm chuyển phần) và `retake` (mỗi em tự canh giờ, giao theo từng học viên). Giao cho nhóm chọn tay chỉ làm được ở `retake`; chế độ live gắn cứng một lớp. Chế độ tự làm đang được trình bày như "thi lại". Bài tập lớp thì đã giao theo nhóm được, nhưng mock test không dùng chung mô hình đó.
- **Đề xuất:** một màn "Tổ chức kỳ thi" ba bước: (1) chọn đề; (2) chọn người thi: cả lớp, nhiều lớp, hoặc chọn tay từng học viên, lưu được thành nhóm để dùng lại; (3) chọn cách thi: "Phòng thi live cùng giờ" hoặc "Tự làm trong khoảng thời gian" (làm lần lượt từng phần, mỗi phần tự canh giờ), kèm kỹ năng nào và cửa sổ thời gian. Về dữ liệu: một bảng người dự thi thay cho cặp `cohort_id` + assignments; đổi tên chế độ thành `live` / `self_paced`.
- **Cần anh quyết:** ở chế độ tự làm, học viên có được ngắt giữa các phần và quay lại hôm sau không; có cho làm lại không.
- **Đã có trả lời** (18/11): không nghỉ giữa các phần, làm một lần (00 điểm 22, 23); ca biên ở `01` mục 7.3 câu 38.

### A3. Ẩn bớt các trang upload nội dung thủ công ở admin
- **Hiện trạng:** khoảng 12 trang. Đã có script làm cùng việc cho: import quiz/course, từ vựng, reading, bài luyện Listening và Cambridge, upload audio Listening, import đề thi.
- **Đề xuất:** ẩn các mục trên khỏi sidebar, giữ đường dẫn còn sống để mở lại được. Giữ: import CSV học viên, OCR bài viết, Writing tips (chưa có script), sửa lẻ ảnh và prompt. Tờ AdminNoiDung và hai tờ nội dung sẽ gọn lại theo hướng "xem, tìm, sửa lẻ, bật/tắt công bố", không còn màn tải lên hàng loạt.
- **Cần anh quyết:** đồng ý danh sách ẩn/giữ này không.
- **Đã có trả lời** (17/11): ẩn trang nhập thủ công khỏi sidebar, nhập qua script backend (00 điểm 19); danh sách ẩn/giữ ở trên là mặc định tạm.

### A4. Hiện hoạt động trực tiếp cho học viên (cảm giác cộng đồng)
- **Ý của anh:** số lượt truy cập, số người đang online, số người đang làm bài, ai vừa làm xong loại bài gì.
- **Hiện trạng:** có bảng sự kiện `analytics_events` và các trang thống kê cho admin. Không có realtime hay heartbeat. Ước lượng được ngay: "đang làm bài" từ phiên chưa kết thúc, "online" từ lượt xem trang trong 5 phút.
- **Đề xuất:** một dải nhỏ ở trang Hôm nay và trang Luyện tập: "N người đang học · N người đang làm bài · hôm nay đã có N bài được nộp", cập nhật mỗi 30–60 giây (không cần realtime). Dòng hoạt động gần đây chỉ ghi loại bài, không ghi tên: "Một học viên vừa xong Listening Part 2". Nếu muốn hiện tên thì học viên tự bật trong Tài khoản. Khi số quá nhỏ (dưới một ngưỡng) thì không hiện con số, để web không trông vắng. Lọc tài khoản admin và tài khoản thử.
- **Rủi ro:** lớp nhỏ dễ nhận ra người cụ thể; không bao giờ đưa điểm hay email ra dải này.
- **Cần anh quyết:** hiện tên (tự chọn bật) hay luôn ẩn danh; có hiện cho khách chưa đăng nhập ở trang chủ không.

### A5. Màn chuẩn bị vào mock test phía học viên
- **Trả lời:** đã có tờ `ThiThuTruocGio` (trang "Học viên (Đợt 4)"): kiểm tra thiết bị, hướng dẫn trước giờ thi, phòng chờ. Tờ này đang được cập nhật thêm màn chặn trên điện thoại. Chưa có: biến thể cho chế độ "tự làm trong khoảng thời gian" ở A2.

### A6. Tổng kết bài tập cho admin sau mỗi bài giao
- **Ý của anh:** tối đa hoá thông tin hữu ích để chẩn đoán vấn đề của lớp; phần hiện tại messy.
- **Hiện trạng (bài ngữ pháp Course 1):** ba tab "Tổng kết", "Tiến độ lớp", "Inspect học viên" gọi ba API và dùng ba bộ trạng thái khác nhau (8, 6 và 5 giá trị). Khối "Cả lớp vướng ở đâu" gom lỗi theo "trục", nhưng mỗi buổi có khoảng 91 trục trên khoảng 100 câu, tức gần như mỗi câu một nhóm, nên bảng không nói lên điều gì. Nhóm ngữ pháp có nghĩa (6–11 nhóm mỗi buổi) đã lưu nhưng không dùng để gom. Không có tỉ lệ đúng theo câu cho cả lớp, phân bố điểm, so sánh với buổi trước.
- **Dữ liệu đã lưu, tính được ngay:** tỉ lệ nộp / trễ / chưa nộp; tỉ lệ đúng từng câu; phương án sai được chọn nhiều; lỗi theo nhóm ngữ pháp và theo dạng câu; thời gian từng câu; phân bố điểm; số lần làm lại; so với buổi trước.
- **Đề xuất một trang "Kết quả bài giao" duy nhất, đọc từ trên xuống:**
  1. Ai đã nộp: đúng hạn, trễ, chưa nộp (kèm tên, bấm nhắc được).
  2. Lớp làm thế nào: phân bố điểm, trung vị, so với buổi trước.
  3. Lớp vướng ở đâu: bảng theo nhóm ngữ pháp, sắp theo tỉ lệ sai; mở một nhóm ra thấy các câu sai nhiều nhất, phương án sai được chọn nhiều nhất và lời giải thích.
  4. Ai cần chú ý: học viên điểm thấp, tụt so với buổi trước, làm quá nhanh (đoán), làm lại nhiều lần.
  5. Việc nên làm ở buổi tới: 2–3 câu đáng chữa trên lớp (do máy đề xuất từ mục 3, giáo viên chọn).
  Một bộ trạng thái dùng chung cho cả trang.
- **Tương tự cho mock test:** sau kỳ thi có phân tích câu cho cả phòng (dữ liệu chấm từng câu đã lưu, hiện chỉ xem từng bài), nhịp làm bài tổng hợp, so với kỳ trước. Trong phòng live: thêm cảnh báo chủ động (em nào đứng yên lâu, mất kết nối, chưa nộp phần).
- **Cần thu thêm (để sau):** thẻ buổi học của từng câu, mã ngộ nhận có cấu trúc, lần đổi đáp án.
- **Liên quan:** spec 0043 (báo cáo theo buổi cho đề giữa/cuối kỳ) đã duyệt nhưng chưa có mã.

### A7. Trang tập trung cho từng học viên phía admin (cho đội chăm sóc)
- **Hiện trạng:** có ngăn kéo ở trang học viên và trang bài làm theo lớp. Thiếu dòng thời gian hợp nhất, ghi chú chăm sóc nhiều dòng, cảnh báo cấp học viên. Mục tiêu đang lưu hai nơi không khớp nhau (admin nhập và học viên tự khai).
- **Thiết kế đã có:** tờ `HoSoHocVien` (đã được anh duyệt ở đợt đầu) là khung của trang này.
- **Đề xuất mở rộng tờ đó:** đầu trang là trạng thái một dòng (đang ổn / cần chú ý / có nguy cơ bỏ) kèm lý do; mục tiêu và ngày thi (một nguồn duy nhất); độ liên tục (lịch 8 tuần, chuỗi ngày học, lần hoạt động gần nhất); tiến độ theo khoá; bài trễ và bài chưa nộp; điểm theo thời gian; cảnh báo (trễ liên tiếp, không hoạt động N ngày, điểm tụt, gần ngày thi, khoá sắp hết hạn, sắp hết lượt chấm); nhật ký chăm sóc (ai liên hệ, kênh nào, nội dung, hẹn việc tiếp theo); danh sách "cần gọi hôm nay" cho đội chăm sóc ở trang Việc cần làm.
- **Cần anh quyết:** ngưỡng của từng cảnh báo; đội chăm sóc có vai trò riêng (chỉ xem và ghi chú, không sửa điểm) không.

### A8. Logo và bộ nhận diện
- Đã có hai tờ thiết kế: `NhanDienLogo` (ba hướng logo, khuyến nghị hướng "Ấn ký") và `NhanDienSocial` (ảnh chia sẻ liên kết, bìa, mẫu bài đăng, đầu thư, tài liệu in). Chờ anh chọn hướng.
- **Đã có trả lời** (17/11): Hướng 1 "Ấn ký" (00 điểm 16).
- Phát hiện kèm theo: ảnh chia sẻ liên kết `opengraph-image.jpg` được mã trỏ tới nhưng không có trong repo; 2 mẫu mạng xã hội cũ chứa lời khen mẫu gắn tên người; bộ logo chốt tháng 7/2026 chưa từng được áp lên web.

## B. Tính năng và nội dung mới (không chỉ là giao diện)

### B1. Trang kiến thức xã hội và kiến thức nền, gắn với chủ đề từ vựng
- **Ý của anh:** cây kiến thức / mind map; các khía cạnh của chủ đề; liên kết ngược về kho đề Writing.
- **Hiện trạng:** chưa có gì.
- **Đề xuất:** mỗi chủ đề (trùng danh sách chủ đề của trang từ vựng) là một trang gồm: sơ đồ các khía cạnh (nguyên nhân, hệ quả, giải pháp, các bên liên quan, lập luận hai phía); mỗi khía cạnh có đoạn giải thích tiếng Việt, ý tưởng diễn đạt bằng tiếng Anh, từ vựng và collocation liên quan; cuối trang là các đề Writing Task 2 và Speaking Part 3 thuộc chủ đề đó. Ở trang đề Writing có liên kết ngược "Kiến thức nền cho đề này". Sơ đồ vẽ bằng SVG theo kiểu hình đánh số của "Bản in".
- **Cần anh quyết:** nội dung do ai soạn và duyệt; mở công khai (Thư viện) hay thuộc Khoá Vocabulary Skills + Ideas for IELTS; bắt đầu với bao nhiêu chủ đề.
- **Đã có trả lời** (18/11): mở công khai, thuộc Thư viện; đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt (00 điểm 23); spec ở GOI-13 phần C. Còn mở: ai duyệt, số chủ đề đầu (`04` mục "Cập nhật 18/11 tối", câu 6).

### B2. Trang đọc hiểu khuyến khích dịch theo câu chữ và ngữ pháp
- **Ý của anh:** dịch tôn trọng câu chữ, nhìn ngữ pháp mà dịch; thấy từng thành phần (-s, -ed, thì, chủ động/bị động) đóng góp nghĩa gì; gắn với khoá ngữ pháp.
- **Hiện trạng:** Reading đã có dịch câu hai mức, bản dịch soạn tay (spec 0021 đang làm). Bộ minh hoạ câu chữ đang được vẽ ở tờ `GrammarWikiMinhHoa`.
- **Đề xuất một chế độ "Đọc kỹ":** học viên chọn một câu → bước 1 tự tách khung câu (chủ ngữ, động từ, tân ngữ, phần bổ sung) → bước 2 xem các dấu hiệu ngữ pháp được đánh dấu, mỗi dấu hiệu kèm một dòng "đóng góp nghĩa gì" và liên kết về bài của khoá ngữ pháp → bước 3 tự gõ bản dịch → bước 4 so với bản dịch mẫu, phần lệch được chỉ về đúng dấu hiệu đã bỏ sót. Dữ liệu chú giải theo câu soạn sẵn, không sinh lúc học viên đang làm.
- **Dàn bài khoá ngữ pháp:** em tìm thấy hai bản trên máy anh, chưa bản nào ghi tên Hermes: "Dựng câu" 381 bài / 20 module (13/10/2026) và "Khoá ngữ pháp 60 buổi" (05/2026). Trong repo có dàn bài 30 buổi MASTER30.
- **Cần anh quyết:** bản dàn bài nào là bản dùng; bản dịch của học viên có được AI nhận xét không (tốn lượt chấm) hay chỉ so với bản mẫu.
- **Đã có trả lời** (18/11): gắn theo 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau (00 điểm 23); spec ở GOI-13 phần D.

### B3. Luyện thi THPT quốc gia môn tiếng Anh
- **Hiện trạng thư mục THPT:** 73 đề tự soạn theo định dạng mới 40 câu, đủ đáp án, lời giải từng câu và ma trận (còn thiếu 27 đề so với mục tiêu 100); 10 đề chính thức 2017–2026 dạng PDF, không có đáp án, một đề là ảnh scan; 979 thẻ từ vựng. Trong repo mới có một giá trị `thpt_qg`, chưa có đề.
- **Đề xuất:** một khu riêng "Luyện thi THPT" với đường vào riêng (đối tượng là học sinh, khác người đi làm): làm đề có giờ → kết quả theo dạng câu → mỗi câu sai có lời giải và liên kết sang bài của khoá ngữ pháp hoặc bộ từ vựng. Bắt đầu bằng 73 đề tự soạn. Trước khi làm cần gán nhãn chủ đề ngữ pháp cho từng câu (hiện mới có nhãn dạng câu và bẫy).
- **Rủi ro:** đề chính thức có bài đọc trích từ sách và trang có bản quyền; tỉ lệ lỗi đáp án ở đề tự soạn các lô trước khoảng 5–11% câu, chưa có người duyệt. Nên có một vòng người thật duyệt trước khi mở.
- **Cần anh quyết:** có dùng đề chính thức không; dùng chung thương hiệu và tài khoản với phần IELTS hay tách; miễn phí hay thuộc một khoá.
- **Đã có trả lời** (18/11): hoãn; thiết kế trước một khuôn để tái dùng (00 điểm 22; tờ KhuonLuyenDe, GOI-13 phần E hoãn). Các câu con chỉ hỏi khi mở lại.

### B4. Kênh thông báo, chấm thử miễn phí, chặn full test trên điện thoại, luồng trả điểm kiểm tra khoá
- Đã chốt hoặc đã có đề xuất, ghi ở `00-QUY-UOC-CHUNG.md` mục 2 (điểm 11–15). Cần bổ sung vào các gói việc: G04 (trần chấm thử), G05 (chấm thử công khai), G07 (thông báo, kiểm tra khoá), G08 (chặn điện thoại), G09 (cấu hình và công bố điểm).

## C. Thứ tự đề nghị
1. Làm cùng đợt thương mại hoá vì ảnh hưởng tới thiết kế hiện có: A3, A5, A6, A7, A8, B4.
2. Làm ngay sau, mỗi mục một spec riêng: A1, A2, A4.
3. Sản phẩm mới, cần chốt nội dung trước khi thiết kế chi tiết: B1, B2, B3.
