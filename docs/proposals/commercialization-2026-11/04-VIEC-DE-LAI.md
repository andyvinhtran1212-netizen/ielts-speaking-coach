# Việc để lại — mang ra khi anh Andy hỏi "còn gì"

Cập nhật: 17/11/2026; bổ sung 18/11, 18/11 chiều, 18/11 tối và lượt rà soát trước bàn giao 18/11 (mục cuối file). Chữ bị gạch là câu đã có trả lời, kèm chỗ ghi trả lời. Anh Andy dặn: để các mục này lại, khi anh hỏi còn gì thì mang ra.

## A. Brainstorm, chưa chốt
| # | Mục | Trạng thái |
|---|---|---|
| 18 | Nhận xét học viên trên web và khảo sát sau khoá | Chưa thiết kế. Kiểm duyệt đề nghị: giữ, làm trước mở bán; chỉ đăng khi có đồng ý. ~~Cần anh trả lời: nhận xét cũ đã có đồng ý chưa~~ (đã có đồng ý, được đăng — 00 điểm 22; hiện ở trang sáu khoá online, không ghi là của lớp offline — điểm 23). Còn: hiển thị tên thế nào; có làm GOI-13 phần A (nơi dựng khối và trang admin) trước mở bán không |
| 19 | Mock test linh hoạt (lớp hoặc nhóm chọn tay; live hoặc tự làm) | Phía admin ĐÃ vẽ (AdminKyThi, AdminKyThiChiTiet). Phía học viên đã vẽ (MockTestDuocGiao; đã sửa theo điểm 23 — các phần chạy liền, không nghỉ). ~~Còn hỏi: tự làm có được ngắt giữa các phần, có được làm lại không~~ (KHÔNG nghỉ giữa các phần, làm một lần — 00 điểm 22, 23; ca biên ở 01 mục 7 câu 38) |
| 20 | Ẩn trang upload thủ công ở admin | ĐÃ chốt ẩn khỏi sidebar, nhập qua script (00 điểm 19); ĐÃ vẽ (ba tờ Nội dung). Danh sách ẩn/giữ theo tờ và 03 mục A3 là mặc định tạm |
| 21 | Hiện hoạt động trực tiếp cho học viên | Chưa thiết kế. Kiểm duyệt đề nghị sửa hướng: tín hiệu theo lớp ("14/20 đã nộp bài buổi 7") thay cho dải toàn web |
| 22 | Kết quả một bài giao, phân tích sau mock test | ĐÃ vẽ (AdminKetQuaBaiGiao, thẻ Phân tích ở AdminKyThiChiTiet). Chờ anh duyệt |
| 23 | Trang tập trung một học viên | ĐÃ vẽ bản một người dùng (HoSoHocVien). Vai trò "đội chăm sóc" và nhật ký đa kênh: hoãn |
| 24 | Kiến thức nền theo chủ đề | Đã có prototype (KienThucNen). ~~Đề nghị: thuộc Khoá Vocabulary~~ (MỞ CÔNG KHAI, thuộc Thư viện; đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt — điểm 23). Spec ở GOI-13 (0097 Kiến thức nền, 0098 Đọc kỹ, 0099 khuôn luyện đề — hoãn); còn: 8–10 chủ đề đầu là những chủ đề nào |
| 25 | Đọc và dịch theo ngữ pháp | Đã có prototype (DocKy). ~~Cần anh chỉ bản dàn bài khoá ngữ pháp nào là bản dùng~~ (gắn theo 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau — điểm 23). Spec ở GOI-13 (0098 Đọc kỹ) |
| 26 | Khu luyện thi THPT | ~~Kiểm duyệt đề nghị hoãn~~ (hoãn; thiết kế trước một khuôn để tái dùng — điểm 22; đã có prototype KhuonLuyenDe) |

## B. Hướng phát triển do kiểm duyệt đề xuất (~~chưa bàn với anh~~ — điểm 23: làm thiết kế và spec; đã có spec ở GOI-12)
Sổ lỗi cá nhân; viết lại sau khi chấm cạnh bài mẫu cùng đề; công bố độ lệch điểm AI với giáo viên; kiểm tra đầu vào dẫn tới gợi ý khoá; nhắc việc và thư tổng kết tuần; gói giáo viên chấm trả phí. Chi tiết: `khao-sat/huong-phat-trien.md`.

## C. Thiết kế còn dở
- ~~Ba trang admin ở 1024px (chờ anh đồng ý).~~ (đã vẽ: Admin1024)
- ~~Phía học viên của kỳ thi tự làm~~ (đã vẽ: MockTestDuocGiao); trạng thái "đang chấm" từng phần; ~~nút bỏ bài và màn hết giờ ở phòng thi Reading và Speaking~~ (đã vẽ: "Abandon test", "Time is up" ở PhongThi, PhongThiSpeaking, PhongThiNgheViet).
- Lệch nhỏ giữa các tờ: màn Hôm nay bản tối còn bảng band cũ; khối tóm tắt học viên ở tờ thành phần chưa khớp hồ sơ; tên buổi học ở tờ Lớp chưa khớp dàn bài trong repo; trạng thái lô nhập có hai tên.
- Chưa soi phần lớn các tờ ở cỡ thật trên canvas.

## D. Chờ anh quyết
- ~~Ai thực hiện: đội Grok hay đội agent do em dựng (anh đang cân nhắc).~~ (project Claude Code của repo averlearning.com — điểm 23)
- ~~Ai là người cấp số migration ("Leader" trong repo) cho đội mới.~~ (anh Andy; số theo 01 mục 6 — điểm 22)
- Dữ liệu sáu khoá online (học phí, thời hạn, số lượt, ngày mở, tài khoản nhận tiền, hạn giữ đơn; thêm 18/11 tối: nguồn bài giảng của sáu khoá — thư mục nào, ai sản xuất, để G07-T28 nạp) — anh điền sau.
- Hạn dùng lượt chấm (con số) — còn mở, đi cùng bảng dữ liệu sáu khoá. Riêng lượt chuyển khi đăng ký lại: bảo lưu tối đa 2 tháng (điểm 23; cấu hình `CREDIT_CARRY_VALID_DAYS` mặc định 60).
- ~~Dùng audio của người học làm mẫu hoặc để cải thiện chấm bài: có làm không, đồng ý thế nào.~~ (bỏ khỏi đợt này — điểm 22)
- Hai đề xuất em gửi ngày 17/11: ~~phạm vi câu trả lời mẫu Speaking (audio hai mức band, lời thoại bấm nghe từng câu, 20 đề Part 2 đầu)~~ (repo VIDEO MAKING sản xuất, web chỉ hiển thị — điểm 22; còn mở: máy chủ video riêng là dịch vụ nào); ~~quy tắc nhỏ ở phòng thi và mã kích hoạt (bỏ tạm dừng bài nghe ở chế độ thi; không có "Save and exit" ở full test; lỗi mã kích hoạt gộp một câu, giới hạn 5 lần thử trong 15 phút)~~ (đã chốt — điểm 22). Đăng nhập bằng mã 6 số qua email: ĐÃ đồng ý.
- ~~Hai điểm kiểm duyệt nêu: lối đi cho người bị chặn vì dùng chung IP; dòng phụ tiếng Việt ở màn trước giờ thi.~~ (có cả hai — điểm 22; chi tiết lối đi: 01 mục 7 câu 31)
- ~~Đơn vị lượt Speaking (một câu hay một bài).~~ (một bài Part 2 hoặc một cụm 2–3 câu; full test Speaking 3 lượt, full test Writing 2 lượt — điểm 22, 23)
- Khoảng 19 câu nhỏ trong GOI-11 mục 10 đang chạy theo mặc định tạm.
- (18/11 tối) Học viên khoá online hết lượt khi khoá còn hơn 30 ngày: đợt đầu không có nút đăng ký; khối "Hết lượt chấm" ghi "Liên hệ Aver để được cấp thêm lượt" kèm khối liên hệ (phương án B (mặc định tạm 18/11, chờ anh Andy xác nhận); GOI-07 FR-07-055). Đăng ký lại bất kỳ lúc nào khi hết lượt (A) hoặc thêm lượt lẻ (C, GOI-04 Q14) để sau.
- (18/11 tối) Thư 11 "Trả lời yêu cầu chấm lại" và thư 12 "Trả lời phản hồi" của tờ EmailMau: để sau (mặc định tạm 18/11, chờ anh Andy xác nhận); chỉ có thông báo trong ứng dụng (thư 12 cũng chưa có thông báo vì `feedback_reply` chưa có nguồn). Thư 8 "Khoá đã hết hạn" làm ở G11-T12.

## E. Tài liệu cho người thực thi chưa viết lại
~~Thân các gói G04, G05, G09 chưa được viết lại theo quyết định ngày 17/11 (mới có ghi chú sửa đổi ở đầu file và mục 2 của 00-QUY-UOC-CHUNG).~~ (đã viết lại 18/11; chiều 18/11 đã đọc lại từng dòng và áp điểm 23)

## Cập nhật 18/11/2026
- Đã vẽ: nhận xét học viên và khảo sát (HocVienNoiGi, AdminKhaoSat); mock test được giao phía học viên (MockTestDuocGiao); admin 1024px (Admin1024); prototype kiến thức nền (KienThucNen), đọc kỹ (DocKy), khuôn luyện đề (KhuonLuyenDe). Ba prototype đã có spec ở GOI-13 (phần C, D, E).
- Đã chốt: người thực thi (project Claude Code của repo — điểm 23) làm trước, khi anh báo sẵn sàng thì bàn giao, có giám sát và tiếp quản nếu cần; bỏ tính năng đồng ý dùng ghi âm; quy tắc phòng thi và mã kích hoạt; đơn vị lượt Speaking (full test Speaking = 3 lượt); THPT hoãn.
- Còn chờ anh: dữ liệu sáu khoá; hạn dùng lượt; ~~một lớp một hay nhiều giáo viên; quy tắc chuyển 50% lượt (làm tròn, thời hạn); lớp đang chạy bằng mã cũ có đo lượt không; mock test "làm trong khoảng thời gian" có được nghỉ giữa các phần không; nhận xét lớp offline có hiện ở trang khoá online không~~; các câu của ba prototype (~~trục gắn bài Đọc kỹ, trang kiến thức nền công khai hay thuộc khoá~~, có hiện band cạnh câu mẫu không). Các câu bị gạch đã có trả lời ở 00 mục 2 điểm 23 — xem mục "Cập nhật 18/11 chiều".
- Chưa làm: soi các tờ ở cỡ thật trên canvas; sáu hướng phát triển (sổ lỗi cá nhân, viết lại sau khi chấm, độ lệch AI–giáo viên, kiểm tra đầu vào, thư tổng kết tuần, gói giáo viên chấm) đã có spec ở GOI-12 (điểm 23 giao làm thiết kế và spec).
- Sự cố 18/11: máy khởi động lại hai lần, thư mục tạm bị xoá; đã khôi phục từ nhật ký agent. Bản làm việc nay nằm ở `ban-lam-viec/` trên ổ SSD, không còn dùng thư mục tạm.

## Cập nhật 18/11 chiều (theo 00 mục 2 điểm 23)

Đã có trả lời (đã gạch ở các mục trên và đã áp vào các gói):

| Câu | Trả lời | Đã áp ở |
|---|---|---|
| Một lớp một hay nhiều giáo viên | Mỗi lớp MỘT giáo viên (hiện là anh Andy) | GOI-09 T24 (một cột `cohorts.instructor_id`), GOI-11 phần A |
| Quy tắc chuyển 50% lượt | BỎ. Đăng ký lại (không huỷ) thì chuyển TOÀN BỘ lượt chưa dùng, bảo lưu tối đa 2 tháng; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn | GOI-04 mục 5.15, T12; GOI-05, 07, 09, 11 |
| Lớp đang chạy bằng mã cũ có đo lượt không | CÓ chuyển sang đo lượt | GOI-04 T15 (mới), GOI-09 T43 (mới) |
| Mock test "làm trong khoảng thời gian" có được nghỉ giữa các phần không | KHÔNG; đã bắt đầu thì làm liền các phần | GOI-09 mục 5.5, T31–T34; GOI-08 T22; GOI-07 T16 |
| Bài làm giữ bao lâu sau khi khoá hết hạn | 45 ngày (bản ghi âm vẫn tối đa 60 ngày kể từ lúc ghi) | GOI-04 mục 5.14, T10; GOI-07 |
| Gửi thư bằng dịch vụ nào | Resend đã có trong repo (`backend/services/owner_alerts.py`, `RESEND_API_KEY`) | GOI-04 mục 5.11; GOI-05 mục 5.6 |
| Full test Writing tốn mấy lượt | 2 lượt, đã xác nhận | GOI-04, GOI-07, GOI-08 |
| Kiến thức nền công khai hay thuộc khoá | MỞ CÔNG KHAI, thuộc Thư viện; đoạn viết ngắn tính 1 lượt | GOI-04 (đơn vị lượt), GOI-06 (giữ chỗ kệ) |
| Trục gắn bài Đọc kỹ | 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau | GOI-06 (ghi chú); spec ở GOI-13 (0098 Đọc kỹ) |
| Nhận xét lớp offline có hiện ở trang khoá online không | Có, ở trang sáu khoá online, KHÔNG ghi là của lớp offline | GOI-05, GOI-06, GOI-09 (ghi chú); dựng ở GOI-13 phần A |
| Ai thực thi | Project Claude Code của repo averlearning.com (không phải đội Grok); tên thư mục AVER-GROK giữ nguyên | 01 mục 5; mọi gói đổi "bot" thành "người thực thi" |
| Bốn chỗ đã vẽ mà chưa có dữ liệu | THÊM vào gói: "Lần đăng nhập gần đây" (GOI-04 T16 + GOI-07 T17), "Đổi email đăng nhập" (GOI-05 T24 + GOI-07 T17), thư "khoá đã mở đăng ký" (GOI-04 T17 + GOI-05 T22), "Lỗi đang lặp lại" (GOI-12 G12-A04 + GOI-07, ẩn tới khi có dữ liệu) | như cột trái |
| Rà 19 bộ bài mẫu, vẽ hình 3 bộ Task 1 | Người thực thi làm | GOI-06 T19 |

Còn chờ anh sau lượt này (đủ danh sách và đề xuất ở 01 mục 7.2, 7.3):

- Dữ liệu sáu khoá; hạn dùng lượt (con số).
- Địa chỉ gửi thư học viên và tên miền đã xác minh trên Resend; chọn đường gửi mã đăng nhập (đề nghị: OTP của Supabase Auth, anh cấu hình SMTP của Supabase trỏ vào Resend).
- Cách áp "bảo lưu 2 tháng": thế nào là "đăng ký lại" (mặc định tạm: đơn tạo trước ngày hết hạn hoặc trong 60 ngày sau đó); 60 ngày của lượt chuyển tính từ lúc nào (mặc định tạm: từ ngày khoá mới bắt đầu); "huỷ gói" có đúng nghĩa là không đăng ký lại không.
- Lớp mã cũ: số lượt ban đầu của từng lớp; giáo viên có được cấp lượt không.
- Mock test tự làm: bốn ca biên (mất mạng, khoảng chuyển phần, bắt đầu gần cuối khoảng mở, nộp sớm).
- Đổi email: tài khoản từng vào bằng Google có được đổi không. Lần đăng nhập gần đây: có hiện "nơi gần đúng" không.
- Có làm GOI-13 phần A (khối "Học viên nói gì" và trang admin "Khảo sát và nhận xét") trước mở bán không.
- Có hiện band cạnh câu mẫu ở prototype không.

Việc tài liệu còn lại:

- Tờ thiết kế (đối chiếu 18/11 tối): MockTestDuocGiao, TrangKhoaHoc, EmailMau thư 7, 8, TrangChuCongKhai và nhãn "Chuyển 50%" ở TaiKhoan đã sửa theo điểm 23; hộp cấp lượt cho lớp mã cũ đã có ở AdminLuotVaMa. Còn: TaiKhoan cột "nơi gần đúng"; EmailMau chưa có ba thư mới (khoá đã mở đăng ký, mã đổi email, báo đổi email).
- Tám gói ngoài GOI-04, GOI-05, GOI-09 chưa được đọc lại từng dòng.
- GOI-12 đã viết (mục cuối file); C01–C03 đã cộng vào bảng công ở 01 mục 4 (đợt D); phần còn lại cộng khi anh mở; nối nguồn "Lỗi đang lặp lại" cho GOI-07 khi phần A được mở.

## Cập nhật 18/11 tối — GOI-12 và GOI-13 đã viết xong

- **Đã xong:** `GOI-12-huong-phat-trien.md` (sáu hướng, 38 nhiệm vụ, spec 0088–0094, migration 480–489) và `GOI-13-thu-vien-mo-rong-va-prototype.md` (nhận xét và khảo sát, biên tập 137 bài Grammar Wiki, kiến thức nền, đọc kỹ, khuôn luyện đề hoãn; spec 0095–0099, migration 490–499). Cả hai nằm ngoài đợt A–E, chỉ làm khi anh mở từng phần. Hai gói đã qua một lượt rà soát riêng ngày 18/11 (`ban-lam-viec/ra-soat/4-goi-12.md`, `5-goi-13.md`; các phát hiện đã áp). Điểm 23 ("làm thiết kế và spec" cho ba prototype và sáu hướng) đã xong ở mức gói: thư mục spec 0089–0099 trong repo chỉ soạn khi anh mở từng phần (phương án A (mặc định tạm 18/11, chờ anh Andy xác nhận)).
- **Đã soi:** 138 tờ dựng bằng bộ dựng thật và bấm thử mọi nút: không lỗi (chi tiết cuối `02-BANG-PHU-THIET-KE.md`).
- **Sự thật trong mã cần anh biết (GOI-12 phần C):** hôm nay web không lưu cặp điểm AI – giáo viên. Bản AI thường còn trong chuỗi phiên bản nhưng không được bảo vệ; điểm giáo viên lúc trả không được lưu riêng; tài khoản vai trò giáo viên (instructor) không tự đặt band (sửa phản hồi trực tiếp luôn bị chặn), nhưng vẫn đổi được band hiển thị cho học viên qua soạn lại (`compose`, ghép từ các bản AI) và chấm lại (`regrade`); chỉ admin sửa thẳng band; cặp điểm của thi thử không dùng được. Muốn có số độ lệch thì phải làm C01–C03 trước, càng sớm càng có nhiều bài.

### Câu chờ anh quyết của hai gói mới (mỗi câu đã có mặc định tạm trong mục 10 của gói)

Chỉ cần trả lời khi anh mở phần tương ứng. Các câu đáng trả lời sớm vì đổi thứ tự công việc:

1. ~~Có đưa C01–C03 (lưu cặp điểm AI – giáo viên) vào đợt D không~~ — ĐÃ TRẢ LỜI 18/11: CÓ (00 điểm 24; đã áp ở `01` đợt D, GOI-12, GOI-09 T17).
2. GOI-13 phần A (nhận xét học viên, khảo sát) có làm trước khi mở bán không. Đề nghị: có.
3. Kiểm tra đầu vào (GOI-12 phần D) có làm trước khi mở bán không; khách chưa đăng nhập có làm được không.
4. Viết lại sau khi chấm: lần viết lại đầu của mỗi bài miễn phí (phương án A) hay tính lượt.
5. Grammar Wiki: nguồn tên bài (mặc định lấy frontmatter; ba tờ nhóm 1, 7, 8 đang lấy theo `_groups.yaml` — câu 9 mục dưới); tách hay gập bài ghép (đề nghị tách 5.4 và 7.3); bỏ câu hứa band; bỏ nhắc TOEIC/THPT trong thân bài.
6. Kiến thức nền: ai là hai người duyệt mỗi chủ đề; hiện chỉ có 7 chủ đề Từ vựng trong khi mục tiêu 8–10.
7. Gói giáo viên chấm: học phí, số lượt, hạn trả, trần mỗi tuần (đang vẽ 8), chỉ Writing hay cả Speaking.
8. Thư tuần: ngày giờ gửi, địa chỉ gửi, lớp offline có nhận không.

Các câu còn lại (ngưỡng, giới hạn, tên đường dẫn): GOI-12 mục 10 và GOI-13 mục 10.

### Chỗ lệch đã biết mà chưa vá

- GOI-12 mục 10.1 (M1–M12) và mục 3.3–3.4: các tờ và gói cũ phải đổi khi bật từng phần của GOI-12. Chưa vá vì chưa phần nào được mở; đã ghi ở `01` mục cuối, điểm 7. Riêng M5 (tờ Độ lệch ghi sai là đã có cặp điểm) và M8 (vị trí khối kiểm tra đầu vào) đã sửa trên tờ.
- Số liệu Grammar Wiki: các tờ ghi 32 bài lệch tên và 76–84 giờ biên tập; con số 43 và 77–84 nói trước đó không khớp tờ. Script kiểm nội dung (G13-B02) sẽ đo lại.
- Mười tờ ở trần 8000px có thể dài hơn khung khi mở hết mục (xem `02`).

## Rà soát trước bàn giao 18/11 — câu chờ anh xác nhận

**ĐÃ TRẢ LỜI 20/11/2026 (11:04 giờ Việt Nam):** anh Andy viết "đồng ý cả 11". Cả 11 mặc định ở bảng dưới thành quyết định; ghi chú "(mặc định tạm 18/11, chờ anh Andy xác nhận)" ở các chỗ thuộc cột "Áp ở đâu" nay được hiểu là đã xác nhận, không cần sửa câu chữ ở từng chỗ. Cùng lúc anh duyệt spec 0055, 0056 và 0074.

Lượt rà chéo năm góc ngày 18/11 (quyết định, số hiệu, độ phủ, GOI-12, GOI-13; nhật ký `ban-lam-viec/ra-soat/6-da-ap.md`) đã áp mặc định tạm cho các câu dưới đây; mỗi chỗ áp có ghi "(mặc định tạm 18/11, chờ anh Andy xác nhận)". Anh trả lời khác thì sửa đúng các chỗ ở cột "Áp ở đâu".

| # | Câu hỏi | Mặc định đang áp | Áp ở đâu |
|---|---|---|---|
| 1 | Giáo viên của lớp có được cấp thêm lượt và chuyển lớp mã cũ sang đo lượt không? | Chỉ admin (hiện mỗi lớp một giáo viên là anh, cũng là admin) | `00` mục 2 điểm 20 (câu "Hết lượt thì admin cấp thêm"); GOI-04 Q5; GOI-09 Q32; `01` bảng lệch dòng h, mục 7.3 câu 37 |
| 2 | Có phiên nào khác đang làm spec 0047 (chấm thử miễn phí) không? | Giao người thực thi qua G11-T14a; việc đầu tiên của nhiệm vụ là kiểm trong repo đã có nhánh/PR nào thực thi 0047 chưa, có thì dừng và báo anh | GOI-11 G11-T14a, mục 6; `01` đợt B, mục 3, luồng L2, mục 4 |
| 3 | Xoá tài khoản, tải dữ liệu và tải phiếu PDF ("Dữ liệu của tôi") làm trước mở bán hay để sau? | Phương án A: làm trước mở bán (G04-T18, spec ACCOUNTDATA-0100, migration 500; G07-T17 gắn khối). Nếu anh chọn để sau: hai khối ẩn, trang Quyền riêng tư ghi kênh liên hệ | GOI-04 FR-04-052, G04-T18, mục 6; GOI-07 T17; `01` đợt B, mục 4, mục 6 (sổ số) |
| 4 | Học viên khoá online hết lượt khi khoá còn hơn 30 ngày thì lối ra là gì? | Phương án B: không có nút đăng ký; câu "Liên hệ Aver để được cấp thêm lượt" kèm khối liên hệ (A: cho đăng ký lại khi số dư 0; C: mở thêm lượt lẻ — để sau) | GOI-07 FR-07-055, T27; `04` mục D |
| 5 | Bài phát âm Course 1 (Azure) có trừ lượt lớp không? | Không trừ ở đợt này | `01` mục 7.3 câu 44; GOI-08 T26 |
| 6 | Thư của tờ EmailMau: thư 8 "Khoá đã hết hạn" làm ở đợt đầu; thư 11 "Trả lời yêu cầu chấm lại", 12 "Trả lời phản hồi" để sau — đúng ý anh không? | Thư 8 làm (cùng bước sweep với `course_expiring`, mở CHECK outbox); thư 11, 12 để sau, chỉ có thông báo trong ứng dụng | GOI-11 G11-T12, FR-11-012; GOI-04 CHECK `learner_email_outbox.template`, 5.11; GOI-05 T14 bước 6; `04` mục D |
| 7 | Mock test được giao có trừ lượt không? | Không trừ, cả Writing lẫn Speaking; tờ MockTestDuocGiao, ThiThu ghi khác thì gói thắng | GOI-04 mục 5.6, 5.7; GOI-08 T22; `01` phân xử 18 |
| 8 | Spec của GOI-12, GOI-13 (0089–0099) soạn trong repo lúc nào? | Phương án A: điểm 23 đã xong ở mức gói; thư mục spec chỉ soạn khi anh mở từng phần | `04` mục "Cập nhật 18/11 tối"; `BAN-GIAO.md` mục 7 giữ "đừng làm trước khi anh Andy mở từng phần" |
| 9 | Grammar Wiki: nguồn tên bài lấy `_groups.yaml` hay frontmatter `title`? | Frontmatter; lưu ý ba tờ GrammarWikiNhom1, Nhom7, Nhom8 đang lấy tên theo `_groups.yaml` | GOI-13 mục 10 câu B1 |
| 10 | Viết lại sau khi chấm: "đứng đâu so với bài mẫu" chỉ có sau khi đã có bản viết lại, hay cho mở trước? | Chỉ sau bản viết lại: route `POST /{rewrite_id}/stand` trả 409 `no_sample`, `not_done`, bỏ `rewrite_first`; "Mở bài mẫu ngay" chỉ mở trang bài mẫu của Thư viện | GOI-12 mục 5.B (bảng API), nhiệm vụ B (việc 4) |
| 11 | Tài khoản QA trên staging: người thực thi lấy ở đâu, hộp thư nào nhận mã đăng nhập cho tài khoản QA (đăng nhập không còn mật khẩu)? | Dùng tài khoản QA và phiên có sẵn theo `docs/AGENT_WORKFLOW.md` của repo; không có thì dừng ở bước nghiệm thu, ghi "chờ anh Andy kiểm tay trên staging", không tự tạo tài khoản | `BAN-GIAO.md` mục 5 bước 4 |

Gộp vào câu đang mở, không thành câu riêng: nguồn bài giảng của sáu khoá online (thư mục nào, ai sản xuất) — gộp vào câu "dữ liệu sáu khoá" (`01` mục 7.2 câu 13, `04` mục D).
