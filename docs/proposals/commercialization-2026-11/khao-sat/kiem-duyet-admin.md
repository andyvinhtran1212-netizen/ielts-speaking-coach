# Kiểm duyệt trải nghiệm vận hành — bộ tờ Admin và Giáo viên (17/11/2026)

Phạm vi: 19 tờ `Admin*`, `GiaoVien`, `HoSoHocVien`, `KiemTraKhoa` (mục 1 và 7), `ThanhPhanKhungTrang2`. Cách làm: dựng từng tờ bằng Chrome headless với support.js giả lập (thư mục `out9/render-admin/`), đọc toàn bộ chữ sau khi dựng, nhìn hình các màn chính (Việc cần làm, Hồ sơ lớp và các thẻ, Phòng thi trực tiếp, Tạo kỳ thi, Chi tiết đơn, Hồ sơ học viên). Đối chiếu với `03-SO-BRAINSTORM.md` (A2, A3, A6, A7), `khao-sat/repo-brainstorm.md`, `00-QUY-UOC-CHUNG.md` mục 2–3 và hai báo cáo quan sát admin thật 10a, 10b.

Tổng: 38 phát hiện — 9 Nặng, 24 Vừa, 5 Nhẹ. Công sửa: S = sửa trong một tờ, dưới nửa ngày; M = vẽ thêm một màn hoặc sửa 2–3 tờ; L = màn mới có nhiều trạng thái.

Nhận xét chung: phần "hàng chờ" (đơn đăng ký, chấm Writing, chấm lại, hộp thư sự cố) đã tốt: có tuổi việc, khoá mềm, phím tắt, trạng thái lỗi, thao tác nguy hiểm tách riêng. Phần yếu là bốn việc chủ dự án đã nêu: chẩn đoán lớp sau bài giao (A6), tổ chức kỳ thi linh hoạt (A2), hồ sơ học viên cho chăm sóc (A7) và nội dung sau khi ẩn upload (A3). Cả bốn hiện chưa có trong tờ nào. Ngoài ra có ba chỗ cùng một việc được vẽ ở hai nơi với quy tắc khác nhau (giao bài, trả kết quả thi thử, cấp mã).

---

## 1. Buổi sáng mở admin

**AD-01 · Nặng · AdminViecCanLam mục 1**
- Gặp gì: 8 dòng việc đều là hàng chờ của quản trị (chấm, đơn, lỗi, phản hồi, quyền hết hạn). Không có việc của lớp: buổi học hôm nay, buổi sắp tới chưa giao bài, bài quá hạn còn người chưa nộp, kỳ thi hôm nay, học viên cần liên hệ. Những dòng này chỉ có ở bản giáo viên (mục 4 cùng tờ; GiaoVien mục 1).
- Vì sao hại: chủ dự án vừa là admin vừa là giáo viên chính, và AdminGiaoVienThongBao ghi rõ Production chưa có tài khoản giáo viên nào. Người này mở admin sẽ không thấy một nửa việc trong ngày, phải tự nhớ rồi vào từng lớp.
- Sửa: thêm khối "Lớp hôm nay và tuần này" (mỗi buổi: đã giao bài chưa, bao nhiêu người chưa nộp bài buổi trước, lối vào Kết quả bài giao), dòng "Bài quá hạn chưa nộp", dòng "Kỳ thi hôm nay" (mở thẳng phòng thi), dòng "Cần liên hệ hôm nay" (xem AD-30). Admin có lớp do mình dạy thì thấy đủ cả hai nhóm việc.
- Công: M.

**AD-02 · Vừa · AdminViecCanLam mục 1; AdminChamWriting mục 1; sidebar**
- Gặp gì: Việc cần làm có hai dòng "Bài chờ chấm" (3) và "Bài chờ giáo viên duyệt" (5), sidebar có hai mục "Writing 3" và "Giáo viên duyệt 5". Nhưng AdminChamWriting chỉ có một hàng chờ "Chờ duyệt 12", bài AI lỗi nằm chung trong đó; không có tờ nào vẽ màn "Giáo viên duyệt" riêng. Bài Speaking của lớp offline chờ nghe lại (AdminChamSpeakingThiThu 1a) không được đếm ở dòng nào.
- Vì sao hại: hai lối vào dẫn tới cùng một màn, số không khớp, và một loại việc bị bỏ sót.
- Sửa: một dòng "Bài chờ duyệt" tách ba số: Writing · Speaking · AI lỗi cần chấm tay; sidebar bỏ mục "Giáo viên duyệt", giữ Writing và Speaking.
- Công: S.

**AD-03 · Vừa · AdminViecCanLam ghi chú; AdminChamWriting mục 1; AdminGiaoVienThongBao mục 1; AdminCaiDat mục 7**
- Gặp gì: ngưỡng quá hạn của bài chờ giáo viên duyệt là 24 giờ ở Việc cần làm, 48 giờ ở hàng chờ Writing. Nơi đặt ngưỡng ghi "trong Hệ thống" (ChamWriting) và "Cài đặt › Ngưỡng vận hành" (GiaoVienThongBao, CaiDat). Mốc tính: "từ lúc việc vào hàng chờ" và "từ lúc AI chấm xong".
- Vì sao hại: cùng một bài sẽ đỏ ở trang này mà chưa đỏ ở trang kia; người vận hành không biết tin số nào.
- Sửa: một bảng ngưỡng duy nhất ở Cài đặt › Ngưỡng vận hành; mọi tờ dẫn về đó, cùng mốc "AI chấm xong".
- Công: S.

**AD-04 · Nhẹ · AdminViecCanLam mục 1, khối "Vận hành tuần này"**
- Gặp gì: bốn ô số (bài đã nộp, bài đã trả, thời gian chờ duyệt, đơn đã mở khoá). Chỉ ô "Thời gian chờ giáo viên duyệt" gắn với một việc; ba ô còn lại không có ngưỡng, không có lối vào.
- Vì sao hại: số cho có, chiếm chỗ của việc thật (AD-01).
- Sửa: thay bằng ba số có lối vào: tỉ lệ nộp đúng hạn tuần này theo lớp (bấm ra lớp thấp nhất), học viên còn quyền nhưng không hoạt động 7 ngày (bấm ra danh bạ đã lọc), trung vị thời gian chờ duyệt.
- Công: S.

**AD-05 · Vừa · AdminViecCanLam dòng "Quyền sắp hết hạn"; AdminDanhBa mục 1**
- Gặp gì: dòng "6 người · Mở danh bạ" đưa tới danh bạ đã lọc, nhưng thanh hàng loạt ở đó chỉ có "Gán vào lớp" và "Xuất danh sách (CSV)". Muốn nhắc đăng ký lại hay gia hạn quyền luyện lại phải mở từng hồ sơ.
- Vì sao hại: cảnh báo không đi thẳng tới chỗ xử lý; việc lặp lại hằng tuần phải làm từng người.
- Sửa: thêm hai thao tác hàng loạt không nguy hiểm: "Gửi nhắc đăng ký lại…" (mở Gửi thông báo với danh sách đã chọn) và "Gia hạn quyền luyện lại…" (lý do bắt buộc, một hộp hỏi lại nêu số người).
- Công: M.

## 2. Đơn đăng ký, mở khoá, mã và lượt

**AD-06 · Vừa · AdminDonDangKy mục 1–2**
- Gặp gì: bảng hàng chờ "không xác nhận ngay trên bảng"; mỗi đơn phải mở, gõ tay ba ô (số tiền đã nhận, nội dung chuyển khoản, ngày nhận) rồi mới bật nút. Lời nhắn của học viên ("Chuyển từ tài khoản của bố, tên Trần Văn Bình") nằm ở Dòng thời gian phía dưới, xa khối đối chiếu. Xác nhận xong không có lối sang đơn kế tiếp.
- Vì sao hại: trường hợp thường gặp nhất (chuyển đúng, đủ) tốn nhiều lần gõ nhất; thông tin giải thích tên người chuyển khác tên học viên không nằm cạnh quyết định.
- Sửa: nút "Điền đúng học phí, mã đơn, hôm nay" (một bấm, vẫn sửa được); đưa lời nhắn của học viên lên ngay trên ba ô; sau khi xác nhận hiện "Đơn kế tiếp (còn 1)" và phím J/K như màn chấm.
- Công: S.

**AD-07 · Vừa · HoSoHocVien, khối "Khoá đang có" và "Nhật ký gần đây"**
- Gặp gì: Course 1 có nguồn "Đơn #1042 · chuyển khoản"; nhật ký ghi "Cấp Course 1 theo đơn #1042".
- Vì sao hại: trái quyết định 2 (Course 1–5 không đăng ký trên web, chỉ vào bằng mã kích hoạt) và trái dạng mã đơn AVER-XXXXXX ở AdminDonDangKy. Đây là tờ đã duyệt nên lập trình viên dễ dựng sai nguồn quyền.
- Sửa: đổi mẫu thành "Mã lớp T9RB-6KZE" cho Course 1; thêm một dòng khoá online có nguồn "Đơn AVER-M5RD2K" để thấy cả hai dạng.
- Công: S.

**AD-08 · Vừa · AdminLop mục 3a; AdminLuotVaMa mục 3–4; AdminKhoaHoc mục 1**
- Gặp gì: cấp mã kích hoạt cho một lớp có hai luồng khác nhau: hộp một bước trong thẻ Học viên của lớp ("Tạo 2 mã") và trang riêng bốn bước ở Mã kích hoạt. Cấp quyền luyện lại có ba lối vào (lớp, trang mã, hồ sơ) với hai biểu mẫu (trang mã có chọn luồng chấm, lớp thì không).
- Vì sao hại: hai nơi làm cùng một việc, mỗi nơi một bộ trường; người làm phải nhớ nơi nào có tuỳ chọn nào.
- Sửa: lớp là nơi chính để cấp mã và cấp quyền luyện lại; trang Mã kích hoạt chỉ là sổ tra cứu, nút "Tạo mã cho một lớp" mở đúng hộp của lớp. Một biểu mẫu luyện lại dùng chung, có đủ trường luồng chấm.
- Công: M.

**AD-09 · Nhẹ · AdminLuotVaMa mục 1; AdminDanhBa cột "Lượt AI còn"**
- Gặp gì: muốn biết ai sắp hết lượt phải tìm từng học viên; cột "Lượt AI còn" ở danh bạ không lọc, không sắp được.
- Vì sao hại: học viên hết lượt giữa chừng là lúc dễ bỏ; người vận hành chỉ biết khi học viên nhắn.
- Sửa: bộ lọc "Còn ≤ N lượt" ở danh bạ và một dòng "Sắp hết lượt chấm" ở Việc cần làm.
- Công: S.

## 3. Quản lý lớp offline

**AD-10 · Nặng · AdminLop mục 3c (thẻ Bài nộp và chấm); AdminNoiDungTuVungNguPhap mục 8**
- Gặp gì: bảng bài giao chỉ có Buổi · Hạn · Đã nộp · Chờ duyệt · Đã trả và liên kết "Xem" (không tờ nào vẽ đích của "Xem"). Không có điểm, phân bố điểm, câu sai nhiều, ai cần chú ý. Tờ nội dung ngữ pháp ghi "giáo viên xem kết quả ở trang lớp" nhưng trang lớp không có chỗ đó.
- Vì sao hại: đây đúng là ý A6 của chủ dự án. Bộ thiết kế bỏ ba tab rối hiện nay nhưng chưa thay bằng gì; sau khi lớp nộp bài, giáo viên không biết buổi tới nên chữa gì.
- Sửa: vẽ màn "Kết quả một bài giao" (phác thảo ở mục b1). Ở bảng 3c thêm ba cột: Trung vị điểm · Đạt · Vướng nhất (tên nhóm ngữ pháp hoặc số câu sai nhiều nhất), bấm tên bài mở màn mới.
- Công: L.

**AD-11 · Vừa · AdminLop mục 3d; KiemTraKhoa mục 7**
- Gặp gì: kết quả kiểm tra và bảng công bố điểm chỉ có câu đúng và tỉ lệ từng người. Không có kết quả theo buổi cho cả lớp, trong khi phía học viên (KiemTraKhoa mục 5) đã có "theo từng buổi" và nhãn "Cần ôn" dưới 60%.
- Vì sao hại: giáo viên công bố điểm mà không thấy lớp yếu buổi nào; học viên thấy nhiều hơn giáo viên. Spec 0043 (ma trận học viên × buổi) đã duyệt nhưng không có trong tờ.
- Sửa: thêm khối "Theo buổi" phía trên bảng công bố: mỗi buổi một dòng (số câu, tỉ lệ đúng của lớp, số học viên dưới 60%), mở ra ma trận học viên × buổi.
- Công: M.

**AD-12 · Nặng · AdminLop mục 3b; GiaoVien mục 2; AdminNoiDungVietNoi mục 4; AdminNoiDungTuVungNguPhap mục 8**
- Gặp gì: giao bài có bốn lối vào và hai giao diện: bảng bên một bước trong lớp (có ô "Giao cho"), luồng năm bước của giáo viên (không có bước chọn người nhận), sổ giao bài Writing ở Nội dung, giao bài ngữ pháp ở Nội dung. Hạn mặc định cũng lệch: 23:59 ngày học của buổi kế tiếp (AdminLop) so với 21:00 và 19:00 (GiaoVien).
- Vì sao hại: cùng một việc làm hằng tuần mà mỗi nơi một cách; báo cáo 10b đã ghi đúng lỗi này ở admin hiện tại ("Writing homework is assigned in a different admin area"). Luồng năm bước dài hơn bảng một bước cho cùng kết quả.
- Sửa: một thành phần giao bài theo buổi (kiểu bảng bên của AdminLop 3b) dùng cho cả admin và giáo viên, có "Giao cho: cả lớp / chọn tay / nhóm đã lưu" và "Chế độ trả điểm" khi là bài kiểm tra. Bỏ hai sổ giao bài ở Nội dung; ở trang một đề chỉ có nút "Giao bài này…" mở đúng thành phần đó.
- Công: M.

**AD-13 · Vừa · AdminLop mục 3a (thẻ Học viên); GiaoVien mục 3**
- Gặp gì: bảng học viên × bài (ô chữ Đã trả / Đã nộp / Trễ / Chưa nộp) chỉ có ở khu giáo viên. Admin thấy bảng năm cột trong đó "Mã kích hoạt" và "Quyền luyện lại" gần như giống nhau ở mọi dòng; không có hoạt động gần nhất, không có điểm.
- Vì sao hại: cột không dẫn tới quyết định chiếm chỗ của cột cần cho chăm sóc; người chủ phải đổi vai mới thấy bảng tốt hơn.
- Sửa: thẻ Học viên của lớp mặc định là bảng học viên × bài như GiaoVien mục 3, thêm cột "Hoạt động gần nhất" và "Xu hướng" (lên / ngang / xuống so với ba bài trước). Mã và quyền luyện lại chỉ hiện dưới tên khi bất thường (chưa dùng mã, sắp hết hạn).
- Công: M.

**AD-14 · Vừa · AdminLop mục 3c; GiaoVien mục 1**
- Gặp gì: "3 học viên còn thiếu bài đã qua hạn · Gửi nhắc nhở" không cho thấy tên ba người, không có "đã nhắc lúc…". Giáo viên có "Xem ai chưa nộp", admin thì không.
- Vì sao hại: gửi mà không biết gửi cho ai; nhắc trùng hoặc bỏ sót (quy tắc mỗi bài một lần mỗi ngày chỉ nằm trong ghi chú).
- Sửa: bấm "Gửi nhắc nhở" mở hộp nhỏ liệt kê tên, bài còn thiếu, lần nhắc gần nhất; sau khi gửi dòng đổi thành "Đã nhắc 10:42".
- Công: S.

**AD-15 · Vừa · AdminLop mục 1 và 2**
- Gặp gì: nút "Tạo lớp" không có biểu mẫu nào được vẽ. Không có chỗ sửa lịch, đổi giáo viên, thêm hoặc dời buổi học, gắn bài giảng cho buổi. Mục 4a vẽ lớp mới chưa có học viên nhưng bước tạo ra nó thì thiếu.
- Vì sao hại: "tạo lớp" là việc đầu tiên trong danh sách công việc; lập trình viên sẽ phải tự nghĩ ra biểu mẫu.
- Sửa: vẽ hộp "Tạo lớp" ba bước ngắn: (1) tên, Course, giáo viên, lịch tuần, ngày khai giảng → hệ thống sinh sẵn danh sách buổi; (2) thêm học viên hoặc số mã cần tạo; (3) xem lại. Thêm "Sửa thông tin lớp" ở khối Thông tin lớp và "Dời buổi" ở thẻ Buổi học.
- Công: M.

**AD-16 · Vừa · GiaoVien; AdminViecCanLam mục 4; AdminLop mục 5; ThanhPhanKhungTrang2 mục 8**
- Gặp gì: khung giáo viên ở tờ GiaoVien có năm mục, trang đầu "Việc của tôi"; ba tờ còn lại vẽ bốn mục, trang đầu "Lớp của tôi".
- Vì sao hại: hai bản khung cho cùng một vai trò.
- Sửa: chốt năm mục theo GiaoVien (có trang việc riêng), sửa ba tờ kia.
- Công: S.

**AD-17 · Vừa · KiemTraKhoa mục 7**
- Gặp gì: ghi chú nói công bố "chỉ nâng, không hạ, không thu hồi", nhưng bảng công bố không có bước xem trước "học viên sẽ thấy gì" và không thấy hộp hỏi lại. Hai nút "Công bố cho cả lớp (5 bài)" và "Công bố cho 3 bạn đã chọn" đứng cạnh nhau. Trong khi đó trả kết quả thi thử (AdminKyThi) phải gõ tên lớp.
- Vì sao hại: thao tác không hoàn tác được mà dễ bấm nhầm phạm vi; mức bảo vệ lệch giữa hai việc cùng loại.
- Sửa: một hộp hỏi lại nêu số người, mức hiển thị, kèm liên kết "Xem như học viên thấy"; nút cả lớp tắt khi đang có dòng được chọn.
- Công: S.

**AD-18 · Nhẹ · nhiều tờ (dữ liệu mẫu)**
- Gặp gì: lớp "Tue–Thu 19:30" là Course 1, 14 học viên, buổi 11 (AdminLop); 18 học viên, buổi 8 (GiaoVien); Course 3 (AdminChamWriting, AdminChamSpeakingThiThu); Course 2 (AdminGiaoVienThongBao). AdminKyThi, AdminKhoaHoc, AdminLuotVaMa lại dùng tên lớp "Tối 3-5-7", "Sáng 2-4-6".
- Vì sao hại: người đọc bộ tờ không lần được một học viên qua các màn; dễ hiểu nhầm thành quy tắc khác nhau.
- Sửa: một bộ dữ liệu mẫu chung (3 lớp, 1 giáo viên, 6 học viên có tên cố định).
- Công: S.

## 4. Chấm và duyệt bài

**AD-19 · Vừa · AdminChamWriting mục 2**
- Gặp gì: "Duyệt và trả bài" (Ctrl Enter) không nói sau đó đi đâu; sang bài kế phải bấm J. Không có chỉ báo còn bao nhiêu bài của lớp sắp có buổi học.
- Vì sao hại: việc lặp lại nhiều nhất của giáo viên tốn thêm một thao tác mỗi bài; không biết nên dừng ở đâu.
- Sửa: Ctrl Enter = trả và mở bài kế theo bộ lọc; đầu màn hiện "còn 11 bài · 4 bài của lớp học tối nay"; thêm sắp xếp "Lớp có buổi học sớm nhất trước".
- Công: S.

**AD-20 · Vừa · AdminChamWriting mục 2; AdminChamSpeakingThiThu mục 1b**
- Gặp gì: màn chấm chỉ có "các lần nộp của bài này". Không có mục tiêu band của học viên, band các bài gần đây, lỗi lặp lại, lối sang hồ sơ.
- Vì sao hại: giáo viên duyệt nhận xét mà không biết học viên đã được nhắc lỗi này mấy lần; nhận xét kém đích.
- Sửa: một dải một dòng dưới tên học viên: "4 bài gần nhất 5.5 · 5.5 · 6.0 · 6.0 · mục tiêu 6.5 · hay sai: hoà hợp chủ–vị (3 bài)" kèm liên kết hồ sơ.
- Công: M.

**AD-21 · Vừa · AdminKhoaHoc ghi chú; AdminChamSpeakingThiThu mục 1a; AdminLop mục 3c**
- Gặp gì: AdminKhoaHoc ghi "Speaking chưa có hàng chờ giáo viên nên vẫn trả ngay". AdminChamSpeakingThiThu vẽ hàng chờ nghe lại cho lớp offline, AdminLop ghi "Writing và Speaking của lớp offline luôn qua giáo viên duyệt".
- Vì sao hại: hai quy tắc trái nhau cho luồng chấm (b) của quyết định 3.
- Sửa: chốt một câu (đề nghị: có hàng chờ Speaking), sửa ghi chú AdminKhoaHoc.
- Công: S.

**AD-22 · Nặng · AdminKyThi mục 4; AdminChamSpeakingThiThu mục 2**
- Gặp gì: trả kết quả thi thử được vẽ ở hai nơi với quy tắc trái nhau. AdminKyThi: không thu hồi, gõ tên lớp, chỉ thí sinh đủ bốn phần. AdminChamSpeakingThiThu: có lựa chọn "Trả cả phần đã có cho 4 người còn thiếu", "sau khi trả bạn vẫn sửa được điểm từng phần", không gõ xác nhận. Speaking ở tờ này là "AI đề xuất", ở tờ kia là "Giáo viên chấm từ bản ghi". Bảng trạng thái chấm theo thí sinh cũng có ở cả hai. Sidebar có hai mục "Thi thử" (Chấm bài › Thi thử và Thi thử › Kỳ thi).
- Vì sao hại: thao tác nguy hiểm nhất của kỳ thi có hai cửa, cửa này chặt cửa kia lỏng; người làm sẽ dùng cửa lỏng.
- Sửa: chỉ trả kết quả ở thẻ "Trả kết quả" của kỳ thi, giữ quy tắc chặt nhưng thêm lựa chọn trả từng phần (ghi "đang chấm"). Chấm bài › Thi thử chỉ là hàng chờ Writing và Speaking lọc theo kỳ, không có nút trả; bỏ mục sidebar trùng.
- Công: M.

**AD-23 · Nhẹ · AdminChamLai mục 1**
- Gặp gì: yêu cầu khoá online "đến nhóm giáo viên của Aver"; hiện không có giáo viên nào trên Production nên tất cả về một người, nhưng danh sách không có cách gom yêu cầu cùng lý do "Bài bị nhận sai" (lỗi hệ thống, không phải lỗi chấm).
- Vì sao hại: yêu cầu do lỗi nhập bài trộn với yêu cầu về điểm; loại đầu xử lý được hàng loạt.
- Sửa: thêm lọc "Lý do" và thao tác "Chấm lại bằng AI cho các yêu cầu đã chọn" riêng cho lý do "Bài bị nhận sai".
- Công: S.

## 5. Tổ chức và giám sát thi thử

**AD-24 · Nặng · AdminKyThi mục 5 (Tạo kỳ thi), mục 2 (thẻ Thí sinh)**
- Gặp gì: bước 1 chọn một Lớp trong danh sách thả; bước 3 chỉ có "Cả lớp … được thêm: 11 học viên · Thêm học viên lẻ · Mã vào thi". Không chọn nhiều lớp, không bỏ bớt người, không lưu nhóm, không chọn cách thi (phòng live hay tự làm trong khoảng thời gian), không chọn kỹ năng. "Lên lịch chỉ bật khi đủ bốn phần" còn cứng hơn mã hiện tại (đang cho giao theo kỹ năng). Thẻ "Thí sinh" có tên trên thanh thẻ nhưng không được vẽ. Tờ AdminChamSpeakingThiThu lại dùng mẫu một kỳ thi hai lớp.
- Vì sao hại: đây đúng là ý A2. Tờ gom các trang rời lại nhưng giữ nguyên mô hình "một kỳ thi một lớp, live".
- Sửa: dựng lại theo phác thảo b2: ba bước Đề · Người thi · Cách thi; vẽ thẻ Thí sinh.
- Công: L.

**AD-25 · Nặng · AdminKyThi mục 3 (Phòng thi trực tiếp)**
- Gặp gì: bảng chỉ có Đang ở phần · Còn · Kết nối. Không có số câu đã trả lời, hoạt động gần nhất, dấu hiệu đứng yên, dấu hiệu rời trang. Cảnh báo chỉ có cho mất kết nối. Thí sinh "Chưa vào" không có hành động. Không có nút của giám thị: mở phòng, bắt đầu phần, thu bài, đóng phòng, nhắn cả phòng. Tờ ghi "thí sinh nộp phần trước sớm thì sang phần sau ngay", tức mỗi người một đồng hồ, khác chế độ live hiện tại (đồng hồ chung, giám thị chuyển phần) mà không nêu đây là đề xuất đổi quy tắc.
- Vì sao hại: A6 yêu cầu "cảnh báo chủ động: em nào đứng yên lâu, mất kết nối, chưa nộp phần". Dữ liệu `answered/total`, `last_activity_at`, `stalled`, `integrity` đã có trong API live nhưng không lên màn. Thiếu nút điều khiển thì không chạy được một buổi thi cùng giờ.
- Sửa: thêm cột "Đã làm 27/40" và "Hoạt động gần nhất"; dải cảnh báo gom ba loại (mất kết nối, đứng yên quá N phút, chưa vào sau giờ bắt đầu) xếp theo mức; thanh điều khiển phòng ở đầu trang (phần đang mở, đồng hồ chung, "Thu bài và sang phần sau…" có hỏi lại). Ghi rõ quy tắc sang phần sớm là lựa chọn của kỳ thi, mặc định tắt cho phòng live.
- Công: M.

**AD-26 · Nặng · AdminKyThi mục 4 (thẻ Chấm, Trả kết quả)**
- Gặp gì: sau thi chỉ có bảng "Phần · Cách chấm · Xong" với liên kết "Xem điểm". Không có phân bố band, câu và dạng câu cả phòng sai nhiều, so với kỳ trước, nhịp làm bài tổng hợp. Trang nhịp làm bài cũ được ghi là gom về đây nhưng không có chỗ trong tờ.
- Vì sao hại: phần "tương tự cho mock test" của A6 chưa có; sau một kỳ thi giáo viên không biết lớp yếu dạng câu nào.
- Sửa: thêm thẻ "Phân tích" (phác thảo cuối b2).
- Công: M.

**AD-27 · Vừa · AdminKyThi; AdminChamSpeakingThiThu**
- Gặp gì: không tờ nào có "thi lại" hay "làm bù" cho thi thử (chỉ KiemTraKhoa có làm bù). Admin hiện tại có ô đánh dấu thi lại theo từng kỹ năng và hộp giao thi lại. Nhật ký mẫu ghi "13 thí sinh đã nộp, 1 vắng" nhưng không có việc tiếp theo cho người vắng.
- Vì sao hại: mất một chức năng đang dùng; người vắng hoặc gặp sự cố không có đường thi bù.
- Sửa: ở thẻ Thí sinh sau thi, mỗi dòng có "Cho thi bù…" (chọn kỹ năng, khoảng thời gian, chế độ tự làm); dùng chung mô hình người thi của b2.
- Công: M.

## 6. Theo dõi và chăm sóc một học viên

**AD-28 · Nặng · HoSoHocVien (cả tờ)**
- Gặp gì: chỉ vẽ thẻ Tổng quan: khoá đang có, bài làm gần đây, vùng nguy hiểm, cột Tình hình (6 số), Đăng nhập, Nhật ký gần đây. Không có trạng thái một dòng, mục tiêu và ngày thi, độ liên tục, cảnh báo, nhật ký chăm sóc. Năm thẻ còn lại (Khoá và quyền, Bài làm, Điểm và tiến độ, Chi phí AI, Nhật ký) không được vẽ. "Ghi chú của giáo viên" chỉ xuất hiện như một tiêu đề trong ngăn rút gọn của GiaoVien.
- Vì sao hại: đây đúng là ý A7. Trang hiện là trang quyền và tài khoản, chưa phải trang để gọi cho học viên.
- Sửa: theo phác thảo b3.
- Công: L.

**AD-29 · Vừa · HoSoHocVien, thẻ Tổng quan**
- Gặp gì: Vùng nguy hiểm với ba nút đỏ (Thu hồi quyền học, Gỡ khỏi lớp, Khoá tài khoản) nằm giữa thẻ mở đầu, ngay dưới hai bảng hay xem nhất. "Chi phí AI" vừa là một thẻ riêng vừa là một dòng ở cột Tình hình.
- Vì sao hại: người chăm sóc mở hồ sơ hàng chục lần mỗi ngày đều lướt qua ba nút nguy hiểm; chi phí AI không giúp gì cho việc chăm sóc.
- Sửa: chuyển Vùng nguy hiểm xuống cuối thẻ "Khoá và quyền"; gộp Chi phí AI thành một khối trong thẻ đó.
- Công: S.

**AD-30 · Vừa · AdminDanhBa mục 1; AdminBaoCao mục 1; AdminViecCanLam**
- Gặp gì: danh bạ lọc được theo dạng, lớp, trạng thái quyền, vai trò; không lọc theo dấu hiệu cần chăm sóc (không hoạt động N ngày, có bài quá hạn, điểm tụt, gần ngày thi). Báo cáo có ô "Chưa hoạt động 14 ngày · Xem danh sách" nhưng không nói mở ra đâu và từ đó không làm gì tiếp được. Không có danh sách "cần liên hệ hôm nay".
- Vì sao hại: số liệu có nhưng không dẫn tới hành động; đội chăm sóc phải tự dò.
- Sửa: bộ lọc "Cần chú ý" ở danh bạ (mỗi lý do một lựa chọn), thay cột "Lượt AI còn" bằng cột "Cần chú ý" ghi lý do; ô ở Báo cáo mở danh bạ đã lọc; dòng "Cần liên hệ hôm nay" ở Việc cần làm.
- Công: M.

**AD-31 · Vừa · AdminDanhBa mục 2; HoSoHocVien; GiaoVien mục 3**
- Gặp gì: ba bản xem một học viên (ngăn "Xem nhanh", hồ sơ đầy đủ, ngăn rút gọn của giáo viên), mỗi bản một bộ trường khác nhau.
- Vì sao hại: lặp lại lỗi 10b đã ghi ở admin hiện tại ("three partial views").
- Sửa: một khối tóm tắt dùng chung (trạng thái, mục tiêu, bài quá hạn, band gần đây, hoạt động gần nhất, ghi chú mới nhất); ngăn kéo và ngăn giáo viên chỉ là khối đó cộng nút "Mở hồ sơ".
- Công: M.

## 7. Nội dung

**AD-32 · Nặng · AdminNoiDung mục 1, 4, 6; AdminNoiDungVietNoi mục 1, 10; AdminNoiDungTuVungNguPhap mục 4, 5**
- Gặp gì: trang kỹ năng vẫn có nút chính "Nhập hàng loạt", thẻ "Nhập liệu" và luồng bốn bước tải file .xlsx/.zip; Writing có "nhập nhiều mẹo từ file Markdown"; Từ vựng có "Nhập câu" và nhập bảng từ .xlsx.
- Vì sao hại: trái ý A3 (nhập hàng loạt đi qua script backend; trang chỉ để xem, tìm, sửa lẻ, bật tắt công bố). Giữ luồng tải file nghĩa là phải dựng và bảo trì thứ sẽ bị ẩn.
- Sửa: theo phác thảo b4. Mẫu đúng đã có sẵn ở AdminThuVienCongKhai mục 6 ("Chạy bằng script nhập trên máy chủ… Trang này chỉ đọc kết quả; không tải file qua trình duyệt"): áp mẫu đó cho sáu kỹ năng.
- Công: M.

**AD-33 · Vừa · AdminNoiDung ghi chú ("Chỉ đề Chờ duyệt được Đăng; Nháp phải gửi duyệt trước")**
- Gặp gì: mọi đề phải đi Nháp → Chờ duyệt → Đã đăng, kể cả khi người soạn và người duyệt là một. Nội dung do script nhập vào ở trạng thái nào thì chỉ tờ Thư viện nói ("Chưa đăng").
- Vì sao hại: bước thừa cho đội một người; không rõ lô vừa nhập đã tới học viên chưa.
- Sửa: người có quyền duyệt được "Đăng" thẳng từ Nháp qua một hộp hỏi lại; ghi rõ ở mọi tờ nội dung: lô nhập bằng script luôn vào "Chờ duyệt".
- Công: S.

**AD-34 · Vừa · AdminNoiDung (thẻ Kiểm duyệt chất lượng); AdminNoiDungTuVungNguPhap mục 4; AdminBaoCao mục 4; AdminSuCo mục 3**
- Gặp gì: "câu có tỉ lệ sai bất thường" và "học viên báo lỗi đáp án" xuất hiện ở bốn nơi, mỗi nơi một danh sách và một bộ trạng thái (Chưa xử lý / Mới / Đang xem / Đánh dấu đã kiểm).
- Vì sao hại: không biết xử lý ở đâu thì tính là xong; cùng câu Q14 có thể còn "Mới" ở trang này sau khi đã sửa ở trang kia.
- Sửa: một hàng chờ duy nhất "Câu cần kiểm" ở Nội dung › Kiểm duyệt chất lượng (gộp báo lỗi và bất thường theo câu); Báo cáo và Hộp thư chỉ hiện số và liên kết tới đó.
- Công: M.

**AD-35 · Vừa · AdminSuCo mục 3**
- Gặp gì: câu trả lời mẫu cho học viên ghi "Điểm bài của bạn đã được tính lại", nhưng không tờ nào có thao tác tính lại điểm sau khi sửa đáp án; quy tắc phiên bản lại nói bài đã nộp giữ bản cũ.
- Vì sao hại: hứa với học viên điều hệ thống không làm.
- Sửa: khi đăng bản mới có đổi đáp án, hộp xác nhận hỏi "Tính lại điểm cho N bài đã nộp trên bản cũ?" và ghi kết quả vào nhóm sự cố; nếu chưa làm thì sửa câu mẫu.
- Công: M.

**AD-36 · Nhẹ · AdminNoiDungVietNoi mục 7; AdminNoiDungTuVungNguPhap mục 5, 8**
- Gặp gì: các khối "Phiên Speaking gần đây", "Số liệu dùng · 30 ngày", "Phân tích · 30 ngày" nằm trong trang nội dung.
- Vì sao hại: số liệu không gắn hành động trong trang soạn nội dung; trùng với Báo cáo.
- Sửa: bỏ, thay bằng một liên kết sang Báo cáo đã lọc theo đề hoặc bộ đó.
- Công: S.

## 8. Báo cáo, sự cố, hệ thống, thông báo, khung

**AD-37 · Vừa · sidebar của các tờ Admin và HoSoHocVien (đếm trên 14 tờ)**
- Gặp gì: có ba bản sidebar. "Giáo viên duyệt" có ở 10 tờ, thiếu ở 4 tờ (AdminDonDangKy, AdminKhoaHoc, AdminLuotVaMa, HoSoHocVien). "Gửi thông báo" và "Cài đặt" chỉ có ở 3 tờ, "Thư viện công khai" ở 5 tờ; các tờ còn lại không có đường vào ba trang này. Bảng phủ ghi "Cài đặt" là một mục của nhóm Hệ thống nhưng AdminViecCanLam, AdminLop, AdminKyThi không có.
- Vì sao hại: không rõ bản nào đúng; ba trang có thể bị bỏ khỏi điều hướng khi dựng.
- Sửa: chốt một danh sách mục (đề nghị: bỏ "Giáo viên duyệt", thêm đủ ba mục kia), ghi vào ThanhPhanKhungTrang2 và dùng chung một đoạn mã sidebar cho mọi tờ.
- Công: S.

**AD-38 · Vừa · AdminGiaoVienThongBao mục 2; AdminBaoCao mục 1**
- Gặp gì: người nhận thông báo chỉ là "Một lớp / Một khoá / Tất cả học viên". Không gửi được cho nhóm chọn tay hay nhóm theo điều kiện (chưa nộp bài X, sắp hết hạn, không hoạt động 14 ngày), đúng những nhóm mà Việc cần làm và Báo cáo đang đếm. Báo cáo › Hoạt động học viên có hai hình đếm theo tuần và theo kỹ năng, không có bảng theo lớp hay theo khoá.
- Vì sao hại: từ con số không đi được tới hành động; báo cáo trả lời "bao nhiêu" chứ không trả lời "lớp nào, ai".
- Sửa: Gửi thông báo nhận thêm "Danh sách đã chọn" (đẩy sang từ danh bạ, bảng lớp, Kết quả bài giao). Ở Báo cáo thay Hình 2 bằng bảng theo lớp và khoá: tỉ lệ nộp đúng hạn, trung vị điểm, số học viên cần chú ý, mỗi dòng mở lớp đó.
- Công: M.

---

## (a) 10 việc đáng sửa nhất

1. Vẽ màn "Kết quả một bài giao" và nối từ thẻ Bài nộp của lớp (AD-10, kèm AD-11 cho bài kiểm tra).
2. Dựng lại "Tạo kỳ thi" thành Đề · Người thi · Cách thi, có nhiều lớp, chọn tay, nhóm lưu, live hoặc tự làm, chọn kỹ năng; vẽ thẻ Thí sinh (AD-24).
3. Mở rộng HoSoHocVien thành hồ sơ chăm sóc: trạng thái một dòng, mục tiêu, độ liên tục, cảnh báo, nhật ký chăm sóc; chuyển vùng nguy hiểm khỏi thẻ đầu (AD-28, AD-29).
4. Bỏ luồng tải file ở ba tờ Nội dung, thay bằng thẻ "Lô nhập" chỉ đọc theo mẫu của AdminThuVienCongKhai (AD-32).
5. Một nơi duy nhất để trả kết quả thi thử, một bộ quy tắc (AD-22).
6. Phòng thi trực tiếp: thêm nút điều khiển của giám thị, cột số câu đã làm và hoạt động gần nhất, cảnh báo đứng yên và chưa vào (AD-25).
7. Một thành phần giao bài dùng chung, có chọn người nhận; bỏ hai sổ giao bài ở Nội dung (AD-12).
8. Việc cần làm của admin có thêm việc lớp, kỳ thi hôm nay và "cần liên hệ hôm nay" (AD-01).
9. Thêm thẻ Phân tích sau kỳ thi và lối thi bù theo kỹ năng (AD-26, AD-27).
10. Chốt một sidebar, một bảng ngưỡng, một bộ dữ liệu mẫu cho mọi tờ (AD-37, AD-03, AD-18, AD-16).

---

## (b) Phác thảo bốn màn

Ký hiệu: [NGAY] = tính được từ dữ liệu repo đang lưu; [THÊM] = cần thêm cột, bảng hoặc quy tắc.

### b1. Kết quả một bài giao (chẩn đoán lớp)

Vào từ: tên bài ở thẻ "Bài nộp và chấm" của lớp, dòng buổi ở Việc cần làm. Một trang cuộn, một bộ trạng thái dùng chung: Đã nộp đúng hạn · Nộp trễ · Đang làm · Chưa mở · Chưa có tài khoản.

Đầu trang: tên bài · lớp · buổi · hạn · chế độ trả điểm; nút "Gửi nhắc người chưa nộp…", "Chữa trên lớp" (bản trình chiếu khối 5).

1. **Ai đã nộp** [NGAY: `class_assignment_items.submitted_at` so với `due_at`, `opened_at`]. Một thanh chia năm trạng thái kèm số. Dưới thanh là danh sách tên của ba nhóm cần việc: Chưa mở, Đang làm dở (quá 24 giờ), Nộp trễ (kèm số giờ trễ). Mỗi nhóm có ô chọn và nút "Gửi nhắc".
2. **Lớp làm thế nào** [NGAY: `quiz_sessions.accuracy`, `kind`, chuỗi bài của cùng lớp xếp theo `lesson_id`]. Dải điểm lượt đầu (mỗi học viên một chấm trên trục 0–100%), trung vị, tỉ lệ đạt sau lượt đầu, số người phải làm lại. Một dòng so sánh: "Buổi trước: trung vị 71% · buổi này 64%".
3. **Lớp vướng ở đâu** [NGAY: `quiz_attempts.skill` = nhóm ngữ pháp `truc_nhom`, 6–11 nhóm mỗi buổi; `answer_given`; `quiz_questions.why_wrong`]. Bảng xếp theo tỉ lệ sai giảm dần. Cột: Nhóm ngữ pháp · Số câu · Tỉ lệ sai lượt đầu (thanh) · Số học viên sai từ 2 câu · Trung vị giây mỗi câu. Mở một nhóm: ba câu sai nhiều nhất, mỗi câu có đề, đáp án đúng, phương án sai được chọn nhiều nhất kèm số người và lời giải thích của phương án đó. Nút đổi cách gom: theo nhóm ngữ pháp / theo dạng câu (`subtype`). Không dùng "trục" từng câu.
4. **Ai cần chú ý** [NGAY, trừ ngưỡng là THÊM]. Bảng: Học viên · Lý do · Điểm lượt đầu · So buổi trước · Việc. Lý do tính sẵn: điểm thấp hơn ngưỡng đạt; tụt hai buổi liên tiếp; làm quá nhanh (trung vị dưới N giây và điểm thấp: có thể đoán); làm lại từ 3 lần; bỏ dở. Việc: mở bài làm từng câu, mở hồ sơ, thêm ghi chú chăm sóc.
5. **Nên chữa ở buổi tới** [NGAY: lấy từ khối 3]. Máy đề xuất 3 câu (sai nhiều, thuộc nhóm yếu nhất, có phương án nhiễu tập trung); giáo viên bỏ chọn hoặc thêm; "Lưu vào buổi 13" đưa danh sách sang thẻ Buổi học.

Với Writing và Speaking: khối 3 đổi thành "Tiêu chí thấp nhất của lớp" (trung vị từng tiêu chí) [NGAY] và "Loại chú thích xuất hiện nhiều nhất" [NGAY nếu chú thích có loại như ở AdminChamWriting]. Với bài kiểm tra giữa và cuối kỳ: khối 3 gom theo buổi B01–B20 [NGAY với đề đã có `skill`/`item_key` theo buổi; thẻ `lesson_primary` cho mọi câu là THÊM, spec 0043]. Cần thu thêm về sau: mã ngộ nhận có cấu trúc, lần đổi đáp án.

### b2. Tổ chức kỳ thi

Ba bước, lưu nháp ở mọi bước; bước 4 chỉ là xem lại.

1. **Đề**. Chọn kỹ năng dự thi bằng ô đánh dấu (Listening, Reading, Writing, Speaking; mặc định đủ bốn). Mỗi kỹ năng đã chọn có một dòng chọn đề như hiện nay (chỉ đề đã đăng, kiểm tra audio, phiên bản). Cảnh báo "N người đã làm đề này ở Luyện tập" tính lại sau bước 2. [NGAY: `assigned_skills` đã có theo lượt thi.]
2. **Người thi**. Ba nguồn cộng dồn vào một danh sách: "Thêm lớp" (chọn nhiều lớp), "Thêm học viên" (tìm theo tên, mã), "Dùng nhóm đã lưu". Danh sách một bảng: ô chọn · Học viên · Lớp · Kỹ năng dự thi (mặc định theo bước 1, sửa được từng người) · Ghi chú. Bỏ chọn để loại một người khỏi lớp. Nút "Lưu thành nhóm…". [THÊM: bảng người dự thi thay cho `mock_exams.cohort_id` + `mock_exam_assignments`; bảng nhóm lưu. Chọn tay từng người hiện đã làm được ở chế độ retake.]
3. **Cách thi**. Hai thẻ chọn một:
   - *Phòng thi live cùng giờ*: ngày, giờ bắt đầu, phòng mở trước 15 phút, mã vào thi, giám thị chuyển phần và thu bài, tuỳ chọn "cho sang phần sau khi nộp sớm" (mặc định tắt). [NGAY: chế độ `sequential`.]
   - *Tự làm trong khoảng thời gian*: mở từ … đến …; mỗi phần tự canh giờ; "được nghỉ giữa các phần" (có / không); "số lần làm" (1 / cho làm lại). [NGAY về cơ chế: chế độ `retake`; THÊM: đổi tên thành `self_paced`, giao cho cả lớp một lần, hai lựa chọn nghỉ và làm lại chờ chủ dự án quyết.]
   Cuối bước: chế độ trả kết quả và hạn chấm.

Trang một kỳ thi: thẻ Đề · Thí sinh · Theo dõi · Chấm · Phân tích · Trả kết quả · Nhật ký.
- **Theo dõi (live)**: thanh điều khiển phòng (phần đang mở, đồng hồ chung, "Thu bài và sang phần sau…"); dải cảnh báo xếp theo mức; bảng: Thí sinh · Phần · Đã làm n/tổng · Hoạt động gần nhất · Kết nối · Dấu hiệu (rời trang, dán chữ). [NGAY: API live đã trả `answered`, `total`, `last_activity_at`, `stalled`, `integrity`; THÊM: ngưỡng đứng yên, nhật ký sự kiện theo thời gian.]
- **Theo dõi (tự làm)**: bảng: Thí sinh · Đã bắt đầu · Phần đã xong · Còn lại của cửa sổ · "Nhắc". [NGAY]
- **Thí sinh (sau thi)**: mỗi dòng có "Cho thi bù…" theo kỹ năng, mở lại bước 3 ở chế độ tự làm cho riêng người đó. [NGAY: `needs_retest`, giao thi lại.]
- **Phân tích**: phân bố band từng kỹ năng [NGAY: band trong roster]; Listening và Reading: 10 câu sai nhiều nhất và tỉ lệ đúng theo dạng câu [NGAY: `grading_details` từng câu đã lưu, hiện chỉ xem từng bài]; nhịp làm bài cả phòng (mỗi thí sinh một dòng thời gian, đánh dấu chỗ dừng lâu) [NGAY: `answered_at`]; so với kỳ trước của cùng lớp và cùng người [NGAY nếu có kỳ trước]. Writing: trung vị từng tiêu chí.

### b3. Hồ sơ một học viên cho chăm sóc

Giữ khung HoSoHocVien; thẻ: Tổng quan · Học tập · Chăm sóc · Khoá và quyền · Nhật ký hệ thống. Vùng nguy hiểm và chi phí AI nằm trong "Khoá và quyền".

Đầu trang (mọi thẻ): tên · lớp hoặc khoá · **trạng thái một dòng**: "Cần chú ý: trễ 2 bài liên tiếp, 9 ngày chưa hoạt động" (Đang ổn / Cần chú ý / Có nguy cơ bỏ) [THÊM quy tắc và ngưỡng; dữ liệu NGAY]. Nút: "Ghi liên hệ", "Gửi nhắc", "Giao bài".

Thẻ Tổng quan, cột trái theo thứ tự:
1. **Cảnh báo đang mở** [NGAY về dữ liệu]: mỗi dòng một lý do và một việc. Trễ liên tiếp (`class_assignment_items`), không hoạt động N ngày (phiên các kỹ năng, `analytics_events`), điểm tụt (`quiz_sessions.accuracy`, band Writing/Speaking), bỏ dở bài (`course_stalled`), khoá sắp hết hạn, sắp hết lượt chấm, còn dưới N ngày tới ngày thi mà cách mục tiêu từ 1 band.
2. **Mục tiêu và ngày thi**: band mục tiêu, ngày thi, band ước tính hiện tại, khoảng cách. Khi hai nguồn lệch (`students.target_band/target_date` do admin nhập, `users.target_band/exam_date` do học viên khai) hiện cả hai kèm nút "Dùng giá trị này". [NGAY để hiện; THÊM: gộp về một nguồn.]
3. **Độ liên tục**: lưới 8 tuần × 7 ngày (ô đậm = có học), chuỗi ngày hiện tại, lần hoạt động gần nhất, số phút tuần này so với tuần trước. [NGAY: bộ tính streak đã có; số phút lấy từ thời lượng phiên.]
4. **Bài được giao**: ba số (đã nộp đúng hạn / trễ / chưa nộp) và danh sách bài quá hạn kèm số ngày, nút "Nhắc bài này". [NGAY: API bài làm của học viên trong lớp.]
5. **Điểm theo thời gian**: một đường cho mỗi loại (bài ngữ pháp theo buổi %, Writing band, Speaking band, thi thử Overall), điểm giữa và cuối kỳ là mốc. [NGAY]

Cột phải: liên hệ gần nhất và việc đã hẹn (từ thẻ Chăm sóc); khoá và hạn; lượt chấm còn.

Thẻ Chăm sóc: **nhật ký chăm sóc** nhiều dòng. Cột: Ngày · Người liên hệ · Kênh (gọi, Zalo, email, tại lớp) · Nội dung · Kết quả · Việc tiếp theo và ngày hẹn · Xong. Việc đến hạn tự vào "Cần liên hệ hôm nay" ở Việc cần làm. [THÊM: bảng ghi chú chăm sóc; `persona_notes` hiện là một ô chữ, chuyển thành dòng đầu.] Vai trò "Chăm sóc" chỉ xem và ghi nhật ký, không sửa điểm, không thấy vùng nguy hiểm [THÊM, chờ quyết].

Thẻ Học tập: bảng bài làm đủ (lọc kỹ năng, trạng thái), lỗi lặp lại ở Writing (loại chú thích nhiều nhất), nhóm ngữ pháp yếu nhất qua các buổi [NGAY].

### b4. Nội dung sau khi ẩn upload

Mỗi kỹ năng một trang, bốn thẻ: **Đề và bài · Chương trình và bộ · Lô nhập · Cần kiểm**. Bỏ nút "Nhập hàng loạt", "Tạo đề" khỏi vị trí nút chính; "Tạo đề lẻ" chỉ giữ ở Writing (đề, mẹo) và Speaking (chủ đề) vì chưa có script thay thế đầy đủ.

- **Đề và bài** (mặc định). Một ô tìm lớn (tên đề, câu đầu đề, mã lô). Cột: Tên · Dạng · Trạng thái · Dùng trong · Báo lỗi chưa xử lý · Lô nhập · Sửa lần cuối. Bỏ cột "Phiên bản" khỏi bảng (xem trong chi tiết). Thao tác hàng loạt: Đăng… · Gỡ khỏi học viên… · Thêm vào bộ…. [NGAY: trạng thái, nơi dùng, cấp lớp qua `/admin/exam-content/...`; cột Lô nhập là THÊM.]
- **Chi tiết một đề**: xem trước như học viên; **sửa lẻ tại chỗ** những thứ không đổi cấu trúc: đáp án chấp nhận thêm, lời giải thích, tiêu đề tiếng Anh, ảnh sơ đồ hoặc bản đồ, hình Task 1, đường dẫn video; nơi đang dùng; báo lỗi của học viên. Đổi audio, thêm bớt câu: ghi "làm bằng script, nhập lại thành phiên bản mới". [NGAY: sửa ảnh lẻ và prompt là các mục A3 đề nghị giữ.]
- **Lô nhập** (chỉ đọc). Mỗi lần script chạy một dòng: Thời điểm · Người chạy · Script · Môi trường · Số mục tạo, cập nhật, lỗi · Trạng thái (đã nhập, chờ duyệt N mục) · "Xem các mục của lô" · tải báo cáo lỗi. Trạng thái rỗng: "Chưa có lô nào. Nội dung nhập bằng script trên máy chủ; xem hướng dẫn." Không có ô tải file. [THÊM: script ghi một bản ghi lô; mẫu giao diện đã có ở AdminThuVienCongKhai mục 6.]
- **Cần kiểm**. Một hàng chờ theo câu, gộp báo lỗi của học viên và câu có tỉ lệ sai bất thường. Cột: Câu · Đề · Lý do (báo lỗi N người / sai cao hơn dạng N điểm / nhiều người chọn cùng đáp án sai) · Lượt làm · Việc. [NGAY: `user_feedback` cho Reading, Listening; `quiz_item_error_rates` cho quiz; THÊM: tỉ lệ sai theo câu cho Listening và Reading ở mức toàn kho.]
- Điều hướng: route nhập cũ vẫn sống nhưng không có trong sidebar; mở bằng đường dẫn thì hiện dải "Trang nhập thủ công đã ẩn; dùng script" kèm nút "Vẫn mở" cho quản trị. Giữ nguyên ngoài Nội dung: nhập CSV học viên (Danh bạ), OCR bài viết (Chấm bài).

---

## (c) Đề xuất phát triển thêm cho phía vận hành

1. **Danh sách "Cần liên hệ hôm nay" tự sinh.** Quy tắc cảnh báo cấp học viên chạy mỗi đêm, cộng với việc đã hẹn trong nhật ký chăm sóc, cho ra một danh sách có lý do và kịch bản gợi ý. Một người chăm được nhiều học viên hơn vì không phải dò ai cần gọi.
2. **Nhắc tự động theo quy tắc, có sổ.** Nhắc trước hạn 24 giờ, khi quá hạn, khi không hoạt động 7 ngày, khi khoá còn 7 ngày; bật tắt theo lớp; mỗi lần nhắc ghi vào hồ sơ. Nhắc tay chỉ còn cho trường hợp riêng.
3. **Hàng chờ duyệt có ưu tiên và duyệt nhanh.** Xếp bài theo buổi học sắp tới của lớp; đánh dấu bài mà AI và giáo viên thường lệch (dựa trên các lần giáo viên đã sửa điểm AI) để đọc kỹ, các bài còn lại duyệt nhanh bằng một phím; thư viện câu nhận xét hay dùng của giáo viên.
4. **Bản tin lớp trước mỗi buổi.** Tự soạn từ "Kết quả một bài giao": 3 câu nên chữa, nhóm ngữ pháp yếu nhất, ai chưa nộp, ai cần hỏi thăm; gửi cho giáo viên trước giờ dạy, in được một trang.
5. **Nhóm học viên đã lưu dùng chung.** Một nhóm (chọn tay hoặc theo điều kiện) dùng được ở giao bài, kỳ thi, gửi thông báo và cấp quyền luyện lại; tránh chọn lại danh sách ở từng nơi.
6. **Mẫu lớp và bảng lệnh.** Tạo lớp từ mẫu của Course (lịch buổi, bài giao gợi ý cho từng buổi, ngày kiểm tra sinh sẵn); ⌘K nhận cả lệnh ("giao bài lớp…", "tạo kỳ thi", "ghi liên hệ cho…") chứ không chỉ tìm.

---

## (d) Những gì không kiểm được

- Chỉ kiểm tờ thiết kế. Không mở staging hay production, không đối chiếu mã; phần "tính được ngay" dựa hoàn toàn vào `khao-sat/repo-brainstorm.md` (khảo sát đọc mã, chưa chạy).
- Dựng bằng support.js giả lập: mỗi tờ chỉ thấy trạng thái mở đầu. Các thẻ, bước và hộp phải bấm mới hiện (ví dụ bước 1, 3, 4 của Tạo kỳ thi; các làn của Đơn đăng ký) được đọc từ chữ trong mã nguồn tờ, không nhìn hình. Ở HoSoHocVien, bảng "Bài làm gần đây" dựng ra rỗng do bộ giả lập không điền được dữ liệu vòng lặp; không tính là lỗi của tờ.
- Nhìn hình 9 vùng (Việc cần làm, Hồ sơ lớp mục 2 và 3a–3e, Phòng thi trực tiếp, Tạo kỳ thi, Chi tiết đơn, Hồ sơ học viên). Các tờ còn lại chỉ đọc chữ sau khi dựng, nên chưa soát bố cục, mật độ, thứ tự mắt đọc.
- Đọc lướt, không soát chi tiết: AdminHeThong, AdminCaiDat (chỉ tiêu đề mục, thẻ Ngưỡng vận hành, ghi chú), AdminThuVienCongKhai mục 2–5, AdminNoiDungVietNoi mục 2–3, 5–6, 8–9, AdminNoiDungTuVungNguPhap mục 1–3, 6–7. Chưa mở ThanhPhanDuLieu và CheDoToiCongKhaiAdmin để soát.
- Không kiểm: bản hẹp và điện thoại, nền tối, khả năng dùng bằng bàn phím và trình đọc màn hình, tốc độ tải, phân quyền thật giữa quản trị và giáo viên.
- Chưa đọc `GOI-09-admin-va-giao-vien.md` (bảng ánh xạ 75 trang), nên không xác nhận được trang admin hiện có nào bị bỏ sót ngoài những gì 10a và 10b nêu.
- Số tờ trong AD-37 đếm từ danh sách mục sidebar trong mã nguồn của 14 tờ có khai báo sidebar theo cùng một kiểu; 6 tờ (AdminBaoCao, AdminChamLai, AdminChamSpeakingThiThu, AdminChamWriting, AdminHeThong, AdminSuCo) khai báo kiểu khác nên chưa đếm.
