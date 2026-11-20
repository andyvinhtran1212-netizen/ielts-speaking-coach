# Kiểm duyệt trải nghiệm người học — bộ thiết kế Aver Learning

Ngày 17/11/2026. Phạm vi: 59 tờ phía người học và công khai trong `AVER-GROK/thiet-ke/` (không xét tờ Admin, GiaoVien, NhanDien, và các tờ ThanhPhan trừ ThanhPhanKhungTrang).

Cách làm: đọc chữ của từng tờ theo hành trình (cả bản mẫu thô có mọi nhánh trạng thái lẫn bản đã dựng với dữ liệu mẫu); dựng hình bằng Chrome headless và nhìn các tờ TrangChuCongKhai, Main, Mobile, KetQuaWriting, ChamThuMienPhi, ThanhToan, LuyenTap, CheDoToiHocVien. Giới hạn ghi ở mục (c).

Nhận định chung, để đặt các phát hiện vào đúng tỉ lệ: bộ tờ làm kỹ phần trạng thái (rỗng, tải, lỗi, mất mạng, hết lượt), không có chuỗi ngày, huy hiệu hay bảng xếp hạng, phiếu kết quả nào cũng có "Làm gì tiếp". Các vấn đề còn lại tập trung ở ba chỗ: (1) các tờ nói khác nhau về cùng một việc, (2) tài khoản miễn phí và ngày đầu chưa được vẽ, (3) dữ liệu giá trị nhất (lỗi lặp lại, mục tiêu) có nhưng bị để xa chỗ người học nhìn hằng ngày.

Tổng: 36 phát hiện — Nặng 4 · Vừa 18 · Nhẹ 14.

Công sửa: S = sửa chữ hoặc một khối trong một tờ · M = thêm trạng thái/màn hoặc sửa 2–4 tờ · L = cần quyết định sản phẩm kèm vẽ lại nhiều tờ.

---

## Hành trình 1 — Người lạ tới web lần đầu

### HV-01 · Vừa · Trang chủ không có lối chấm thử ở phần mở đầu; hai tờ vẽ khác nhau
- Tờ: TrangChuCongKhai mục 1 (phần mở đầu) và mục 2 (điện thoại); ChamThuMienPhi màn 1 "Trang chủ · phần mở đầu".
- Gặp gì: TrangChuCongKhai có hai nút "Xem các khoá học" và "Đọc thử Thư viện miễn phí"; chấm thử chỉ là một liên kết giữa câu ở mục 3 ("tài khoản miễn phí được chấm thử miễn phí một số bài…"). ChamThuMienPhi lại vẽ phần mở đầu trang chủ với "Xem các khoá học" + "Thử chấm Writing miễn phí" + dòng "Thử chấm Speaking miễn phí", ghi "Có cả trong menu điện thoại".
- Vì sao hại: lời hứa của trang chủ là "chữa bài có dẫn chứng"; cách duy nhất để người lạ tự kiểm lời hứa đó trên bài của chính mình là chấm thử, và nó đang nằm sau ba màn hình cuộn. Lập trình viên cũng không biết dựng theo tờ nào.
- Sửa: lấy bản của ChamThuMienPhi làm chuẩn. Phần mở đầu: nút chính "Xem các khoá học", nút phụ "Chấm thử một bài miễn phí" (một nút, vào màn 2 của ChamThuMienPhi, chọn Writing/Speaking ở đó), "Đọc thử Thư viện" thành liên kết chữ. Thêm mục "Chấm thử" vào menu điện thoại ở TrangChuCongKhai mục 2. Khi chấm thử tạm dừng: nút phụ trở lại "Đọc thử Thư viện miễn phí".
- Công: S.

### HV-02 · Vừa · Trang từ vựng công khai mời vào "Course 3" — khoá của lớp, không đăng ký được trên web
- Tờ: TuVung màn 2 (cuối mục từ) và màn 3d (điện thoại).
- Gặp gì: "Muốn tự viết câu với từ này và được chấm? Bài luyện từ vựng theo chủ đề Environment nằm trong Course 3 · XXX, kèm lượt chấm AI." Nút "Xem Course 3".
- Vì sao hại: Course 1–5 không có trang công khai và không đăng ký trên web (00-QUY-UOC mục 2.2; TrangKhoaHoc ghi "Course 1–5 không có trang này"). Người lạ bấm vào sẽ gặp ngõ cụt hoặc trang lỗi.
- Sửa: đổi thành "…nằm trong Khoá Vocabulary Skills + Ideas for IELTS" và nút "Xem khoá"; khoá chưa mở đăng ký thì ghi "Sắp mở" và dẫn tới trang khoá (có "Báo cho tôi khi mở").
- Công: S.

### HV-03 · Vừa · Trang khoá không nói ai soạn và ai dạy
- Tờ: TrangKhoaHoc màn 1 (cả cột nội dung và khối đăng ký); DanhMucKhoa.
- Gặp gì: trang có "Khoá này dành cho ai", "Học xong làm được gì", "Chương trình", "Một bài học gồm gì", lượt AI, câu hỏi thường gặp. Không có mục nào về người giảng trong video, người biên soạn, hay một mẫu phiếu nhận xét của khoá đó.
- Vì sao hại: người đi làm sắp chuyển khoản cho một web chưa quen, admin xác nhận tay. Câu hỏi "ai dạy tôi" là câu đầu tiên của người lớn khi trả học phí; lớp offline có giáo viên thật là điểm mạnh mà trang bán khoá online không dùng tới.
- Sửa: thêm một mục ngắn "Người soạn và giảng" ngay sau "Khoá này dành cho ai": tên, một dòng kinh nghiệm, liên kết tới video bài 1.1 (đã là bài học thử). Thêm một "Mảnh giao diện · phiếu nhận xét" như đã có ở TrangChuCongKhai mục 2 vào trang Khoá Writing và Khoá Speaking. Dữ liệu chưa có thì để XXX như các trường khác.
- Công: S.

### HV-04 · Nhẹ · Danh mục khoá lúc ra mắt gần như toàn "Sắp mở" nhưng không có chỗ để lại email
- Tờ: DanhMucKhoa màn 3 ("1 khoá đang mở đăng ký · 5 khoá sắp mở").
- Gặp gì: năm dòng "Sắp mở", mỗi dòng chỉ có "Xem khoá ›". Ô "Báo cho tôi khi mở" chỉ có ở trang từng khoá (TrangKhoaHoc màn 2, đang ghi "Giả định").
- Vì sao hại: người cần Listening phải mở từng trang khoá mới để lại được email; đa số sẽ rời đi.
- Sửa: ở dòng "Sắp mở" trên danh mục thêm liên kết "Báo cho tôi khi mở" (mở ô email ngay dưới dòng, đã đăng nhập thì chỉ còn nút). Chốt "Báo cho tôi khi mở" là tính năng thật, bỏ nhãn giả định.
- Công: S.

### HV-05 · Nhẹ · Kệ bài mẫu: chỉ tìm được bằng chữ tiếng Anh; một tiêu đề đề Task 1 bằng tiếng Việt
- Tờ: BaiMauWritingDanhSach màn 1 ("Tìm theo chữ tiếng Anh có trong tiêu đề hoặc câu đề", "Danh sách chủ đề chưa chốt", "Trang 1 trên 46"); BaiMauWriting màn 2 (tiêu đề "Phương tiện công cộng ở City Y…").
- Gặp gì: người học gõ "quảng cáo", "môi trường" sẽ ra trạng thái không có kết quả, trong khi bộ lọc chủ đề chưa có. Tiêu đề Task 1 tiếng Việt trái với ghi chú cùng tờ "Không đặt tên đề bằng tiếng Việt".
- Sửa: cho ô tìm khớp cả tên chủ đề tiếng Việt (bảng ánh xạ chủ đề Việt–Anh, bỏ dấu vẫn khớp như Grammar Wiki đã làm); chốt danh sách chủ đề trước khi phát hành kệ. Đổi tiêu đề mẫu Task 1 sang tiếng Anh.
- Công: S.

### HV-06 · Nhẹ · Trang Liên hệ công khai không có Zalo, trong khi Trợ giúp sau đăng nhập có
- Tờ: PhapLy màn 2 ("Kênh liên hệ: Email, Điện thoại, Giờ làm việc"); TroGiupLanDau màn 1 ("Liên hệ trực tiếp: Email, Điện thoại, Zalo").
- Vì sao hại: người hỏi về chuyển khoản là người chưa có khoá, họ ở trang công khai; Zalo là kênh họ quen dùng để gửi ảnh biên lai.
- Sửa: dùng chung một khối kênh liên hệ (Email · Điện thoại · Zalo · giờ trả lời) cho PhapLy màn 2, ThanhToan màn 3 và 6, TroGiupLanDau.
- Công: S.

---

## Hành trình 2 — Chấm thử miễn phí, bài học thử

### HV-07 · Vừa · Chấm thử Speaking: hạn mức ghi "Part 2", màn hình lại dùng "câu" và có lượt Part 1
- Tờ: ChamThuMienPhi phần đầu và màn 2 ("2 bài Speaking Part 2", "10 bài Speaking Part 2"); màn 6 ("Speaking hôm nay còn XXX câu", lịch sử "Speaking · Part 1 · Hometown · 5.5 · 15/11"); màn 7 ("Còn XXX trên XXX câu"); DeSpeaking màn 1 và 3 (khối "Chấm thử miễn phí đề này" có ở mọi trang đề, kể cả Part 1).
- Gặp gì: người dùng thử không biết mình được nói Part nào, và một lượt là một câu hay một thẻ đề.
- Vì sao hại: họ có thể tiêu lượt vào một câu Part 1 dài 15 giây, hoặc bấm "chấm thử" ở trang đề Part 1/Part 3 rồi bị từ chối.
- Sửa: thống nhất đơn vị "bài Part 2" ở mọi chỗ của tờ; bỏ dòng Part 1 trong lịch sử mẫu. Ở DeSpeaking: trang đề Part 2 giữ nút "Chấm thử miễn phí đề này"; trang Part 1 và Part 3 đổi thành "Chấm thử miễn phí có ở đề Part 2 · Chọn một đề Part 2".
- Công: S.

### HV-08 · Vừa · "Thiết bị hoặc mạng này đã dùng thử" là ngõ cụt cho người dùng chung mạng
- Tờ: ChamThuMienPhi màn 3 "Trạng thái của bước bật" ("Thiết bị hoặc mạng này đã dùng thử. Liên hệ Aver nếu cần hỗ trợ: XXX."); phần đầu tờ ("tính theo email và địa chỉ IP").
- Gặp gì: người thứ hai trong cùng văn phòng, cùng nhà, cùng quán cà phê bị chặn ngay ở bước bật, chưa viết được chữ nào, và chỉ có một dòng liên hệ.
- Vì sao hại: nhóm người dùng chính là người đi làm, thường vào web từ mạng công ty. Đây là điểm đã chốt (mục 2.11), tôi không đề nghị bỏ; nhưng hại cụ thể là mất đúng những người được đồng nghiệp giới thiệu.
- Sửa (giữ quy tắc tính theo IP): màn bị chặn thêm hai lối đi thật: "Học thử bài 1.1" (BaiHocThu) và "Đọc bài mẫu cùng đề"; thêm một nút "Xin mở chấm thử cho tài khoản này" gửi yêu cầu kèm email tài khoản cho admin (admin đã có công tắc ở AdminCaiDat). Về phía quy tắc, đề nghị cân nhắc: IP chỉ dùng cho trần mỗi ngày, hạn mức tổng tính theo email đã xác minh.
- Công: S cho màn; L nếu đổi quy tắc.

### HV-09 · Nhẹ · Trước chữ đầu tiên phải qua ba chặng, và có ba bộ đếm khác nhau
- Tờ: ChamThuMienPhi màn 2–4 và 7–8.
- Gặp gì: chọn đề → đăng nhập Google → màn riêng "Bật chấm thử cho tài khoản này" (ô chống máy) → mới viết. Trong lúc viết phải hiểu ba con số: "Lượt thử hôm nay còn", "hạn mức còn", và "Còn 2 lần nộp lại hôm nay".
- Sửa: gộp ô chống máy vào ngay màn viết (hiện một lần phía trên ô viết, bài vẫn gõ được trong lúc xác minh). Thanh trên chỉ giữ "Hôm nay còn N bài"; hạn mức tổng chỉ hiện khi còn từ 2 trở xuống; số lần nộp lại chỉ hiện trong chính thông báo bài chưa đạt (đã làm đúng ở màn 8).
- Công: M.

### HV-10 · Nhẹ · Cấm dán: lý do không được nói, và gõ 250 chữ trên điện thoại là rào lớn
- Tờ: ChamThuMienPhi màn 2 ("Gõ trực tiếp, không dán, không tải file"), màn 8 ("Bài dùng thử cần được gõ trực tiếp trên trang. Bạn thử gõ lại nhé."), màn 9.
- Gặp gì: người đã viết sẵn bài trên giấy hoặc Word bị chặn mà không biết vì sao; trên điện thoại khung viết chỉ có một dòng nhắc.
- Sửa: thêm nửa câu lý do ở "Cách viết": "…để kết quả phản ánh đúng bài bạn tự viết lúc này". Ở màn 9 (điện thoại) thêm một dòng dưới nút "Bắt đầu viết": "Bài 250 chữ gõ dễ hơn trên máy tính · Gửi liên kết đề này vào email của tôi".
- Công: S.

---

## Hành trình 3 — Đăng ký khoá và chuyển khoản

### HV-11 · Nặng · Chuyển tiền sai nội dung hoặc thiếu tiền: chỉ báo trong ứng dụng, không gửi thư
- Tờ: ThanhToan màn 6 và màn 8 ("Báo đã chuyển, cần bổ sung, sai lệch, huỷ, hết hạn: chỉ hiện trên trang đơn và trong Thông báo, không gửi thư"); EmailMau nhóm 2 (chỉ ba thư: tạo đơn, nhắc, đã mở).
- Gặp gì: người đã chuyển tiền nhưng ngân hàng cắt mất mã đơn, hoặc chuyển thiếu. ThanhToan màn 3 bảo họ "Bạn không cần ở lại trang này" và hứa email khi khoá mở. Admin ghi "Chưa tìm thấy khoản chuyển khớp" — thông tin này chỉ nằm trên trang đơn và trong chuông.
- Vì sao hại: người chưa có khoá không có lý do mở lại web; họ đã trả tiền và chờ một email không bao giờ tới. Đây là tình huống hỏng niềm tin nặng nhất của cả luồng đăng ký.
- Sửa: thêm thư thứ tư, loại bắt buộc: "Đơn AVER-… cần bạn bổ sung" gửi khi admin chuyển đơn sang Cần bổ sung (thiếu tiền, không tìm thấy khoản khớp), nội dung lấy đúng câu ở ThanhToan màn 6. Thêm thư thứ năm khi admin huỷ đơn đã báo chuyển. Sửa câu ở ThanhToan màn 8, EmailMau ghi chú, TaiKhoan (công tắc "Đơn đăng ký: Ba thư…").
- Công: M.

### HV-12 · Vừa · Chuyển khoản buổi tối thì chờ tới giờ làm việc hôm sau, trong lúc chờ không học được bài nào của khoá
- Tờ: ThanhToan màn 3 ("Chuyển ngoài giờ thì xử lý vào đầu giờ làm việc kế tiếp", "Trong lúc chờ, Thư viện vẫn mở miễn phí").
- Gặp gì: người đi làm đăng ký lúc 21 giờ — đúng lúc họ có thời gian và động lực — rồi được mời đi đọc Thư viện.
- Vì sao hại: buổi học đầu tiên bị dời sang hôm sau; nhiều người sẽ không quay lại đúng nhịp.
- Sửa: sau khi bấm "Tôi đã chuyển khoản", màn chờ thêm khối "Học trước trong lúc chờ": mở chương 1 của khoá ở chế độ như bài học thử (video, bài đọc, bài tập tự chấm; phần AI chấm còn khoá; tiến độ được lưu vì đã đăng nhập). Không cần quyền mới: BaiHocThu đã có đúng chế độ này, chỉ nới từ "bài có nhãn Học thử" sang "cả chương 1" cho đơn đang chờ. Cần chủ dự án quyết.
- Công: M.

### HV-13 · Nhẹ · Đơn tự hết hạn nếu người học chuyển tiền mà quên quay lại bấm "Tôi đã chuyển khoản"
- Tờ: ThanhToan màn 2, 5 và ghi chú ("Chờ chuyển khoản quá XXX giờ thì tự Hết hạn; đơn đã báo chuyển không tự hết hạn").
- Gặp gì: trên điện thoại, người học sang ứng dụng ngân hàng, chuyển xong và đóng máy. Đơn hết hạn dù tiền đã tới.
- Sửa: việc đối chiếu không phụ thuộc nút: khi admin thấy khoản chuyển khớp mã của một đơn đã hết hạn, đơn tự mở lại và mở khoá (ghi vào ghi chú lập trình và AdminDonDangKy). Thư 5 (nhắc) thêm câu: "Đã chuyển rồi mà chưa bấm nút? Không sao, chúng tôi vẫn đối chiếu theo mã đơn."
- Công: S (chữ) + M (hành vi).

### HV-14 · Nặng · "Một tài khoản, một nơi một lúc": đăng nhập ở điện thoại là máy tính bị đăng xuất, và không tờ nào nói phòng thi được miễn
- Tờ: TaiKhoanDangNhap màn 8 và ghi chú ("đăng nhập mới đẩy phiên cũ ra; phiên cũ hiện màn 8 ở lần thao tác kế tiếp"); TaiKhoan màn 2 "Phiên đăng nhập"; EmailMau thư 6; PhongThi, PhongThiNgheViet, PhongThiSpeaking, ThiThuTruocGio, KiemTraKhoa (không tờ nào nhắc tới ca này).
- Gặp gì: người học làm bài Writing trên máy tính, mở điện thoại xem thông báo "bài đã có kết quả" → máy tính bị đăng xuất ở lần thao tác kế. Trong phòng thi và bài kiểm tra của khoá, đồng hồ do máy chủ giữ và không dừng.
- Vì sao hại: người đi làm dùng hai thiết bị mỗi ngày (thẻ từ trên điện thoại, viết bài trên máy tính). Bị đá ra giữa bài có giờ là mất bài thi và có thể mất lượt chấm. Chống dùng chung tài khoản là mục tiêu chính đáng; cách làm hiện tại phạt cả người dùng đúng.
- Sửa, theo thứ tự ít đụng nhất: (1) cho phép đồng thời một phiên máy tính và một phiên điện thoại; (2) nếu giữ một phiên: hỏi ở thiết bị MỚI trước khi vào ("Bạn đang đăng nhập trên Chrome · macOS. Tiếp tục ở đây sẽ đăng xuất thiết bị đó."), không đá âm thầm; (3) khi thiết bị cũ đang ở trong phòng thi, bài kiểm tra có giờ hoặc đang ghi âm: thiết bị mới bị từ chối với câu "Bạn đang làm bài có giờ trên thiết bị khác". Vẽ thêm ca này vào ThiThuTruocGio và KiemTraKhoa.
- Công: L (quyết định) + M (màn).

### HV-15 · Vừa · Thư mời vào lớp bắt học viên đi bốn bước và gõ tay 12 ký tự
- Tờ: EmailMau thư 3 ("Cách dùng: đăng nhập hoặc đăng ký, mở menu tài khoản › Khoá học và lượt AI › Nhập mã kích hoạt của lớp, rồi gõ mã trên"; "Liên kết chỉ mở trang đăng nhập, không chứa mã").
- Vì sao hại: đây là bước đầu tiên của mọi học viên lớp offline; máy nhớ hộ được mà đang bắt người nhớ. Mã đã nằm sẵn trong thân thư nên việc không đưa vào liên kết không tăng thêm an toàn đáng kể.
- Sửa: liên kết trong thư mở thẳng màn "Nhập mã kích hoạt" (TaiKhoanDangNhap màn 6) sau đăng nhập, mã điền sẵn, người học chỉ bấm "Kiểm tra mã" rồi "Xác nhận mở khoá". Nếu vẫn không muốn mã trong đường dẫn: ít nhất liên kết phải dẫn tới đúng màn nhập mã, và ô nhập cho dán cả chuỗi có dấu gạch.
- Công: S.

---

## Hành trình 4 — Ngày đầu sau đăng nhập

### HV-16 · Nặng · Tài khoản miễn phí (người vừa chấm thử) chưa có "nhà": ba tờ vẽ ba khung khác nhau, và Hôm nay chỉ có một trạng thái
- Tờ: Main (một trạng thái duy nhất: học viên Course 1 đang học đều); ChamThuMienPhi màn 6 ("giữ thanh công khai, thay Đăng nhập bằng nút tài khoản"); BaiHocThu màn 2 ("thanh học viên 5 mục, giả định"); DeSpeakingDanhSach màn 3 ("Học viên chưa có khoá vẫn thấy thanh học viên"); TaiKhoanDangNhap ghi chú ("chưa có khoá → Thư viện"); TroGiupLanDau ("Bỏ qua ở bước nào cũng về Hôm nay").
- Gặp gì: người vừa đăng nhập để chấm thử — nhóm đông nhất lúc ra mắt — có thể thấy thanh công khai ở trang này và thanh học viên năm mục ở trang kia. Với thanh năm mục, bốn mục dẫn tới màn "cần khoá" (LuyenTap màn 4, ThiThu màn 4, LoTrinh). Trang Hôm nay của họ chưa tờ nào vẽ.
- Vì sao hại: ngày đầu của người dùng mới là đi qua một loạt cửa khoá; không có trang nào gom những việc họ làm được (lượt chấm thử còn lại, bài dùng thử đã chấm, bài học thử, đơn đang chờ).
- Sửa: (1) Chốt một quy tắc khung: đã đăng nhập thì luôn dùng thanh học viên; sửa ChamThuMienPhi màn 6. (2) Vẽ thêm vào Main bốn trạng thái: A. chưa có khoá (lượt chấm thử hôm nay, "Bài dùng thử của bạn", ba bài học thử, lối xem khoá và nhập mã); B. đơn đang chờ xác nhận; C. ngày đầu có khoá (chưa học bài nào: một nút "Bắt đầu bài 1", không có khối rỗng); D. khoá sắp hết hạn / đã hết hạn / hết lượt (GiaHanThemLuot nói cảnh báo có "trên Hôm nay" nhưng Main chưa vẽ). (3) Chốt đích sau đăng nhập cho tài khoản chưa có khoá là Hôm nay ở trạng thái A; sửa câu ở TaiKhoanDangNhap.
- Công: M.

### HV-17 · Vừa · Lần đầu vào hỏi band mục tiêu và ngày thi "để trang Hôm nay đúng với bạn", nhưng Hôm nay không dùng hai thứ đó; lời chào nói ngược trang công khai
- Tờ: TroGiupLanDau màn 2 bước 1 ("học tiếng Anh và IELTS từ đầu tới nâng cao theo một lộ trình thống nhất", "Hai câu hỏi ngắn để trang Hôm nay đúng với bạn") và bước 2 ("Band muốn đạt", ngày thi); Main, Mobile (không có mục tiêu, không có ngày thi); TrangChuCongKhai ("Các khoá độc lập… không có thứ tự bắt buộc"); TaiKhoanDangNhap màn 7 (màn chào cũ, vẫn còn trong tờ dù TroGiupLanDau ghi "Thay cho màn chào số 7").
- Vì sao hại: hỏi mà không dùng là làm cho có; người học trả lời xong không thấy gì đổi. Câu "một lộ trình thống nhất" trái với lời đã nói lúc đăng ký.
- Sửa: Hôm nay thêm một dòng dưới ngày tháng: "Mục tiêu 6.5 · còn 17 tuần tới ngày thi" (bấm sang Tiến độ), và câu nhịp học ở cột phải tính theo ngày thi thay vì hạn khoá khi có ngày thi. Chưa đặt mục tiêu thì không hiện dòng. Sửa bước 1: "Mỗi khoá dạy một kỹ năng; trang Hôm nay gom việc của các khoá bạn có." Gỡ màn 7 khỏi TaiKhoanDangNhap hoặc đánh dấu "đã thay".
- Công: S.

### HV-18 · Vừa · Hôm nay không báo bài vừa được trả, không nhắc lỗi đang lặp lại
- Tờ: Main cột phải "Kết quả gần đây" (ba dòng chữ và số, không liên kết); TienDo mục "Lỗi lặp lại nhiều nhất" (có ví dụ câu sai của chính người học và "Bài ngữ pháp: …"); ThanhPhanKhungTrang (Tiến độ chỉ mở từ menu tài khoản).
- Gặp gì: "Writing · 4 bài đã chấm · 5.5" không bấm được. Bài giáo viên vừa duyệt chỉ hiện trong chuông. Phần có giá trị học cao nhất của cả web — "4 trên 5 bài Writing sai hoà hợp chủ ngữ–động từ, ôn bài này" — nằm trong menu tài khoản, sau hai lần bấm.
- Vì sao hại: kết quả chấm không tự dẫn tới hành động học tiếp theo ở đúng trang người học mở mỗi ngày.
- Sửa: trong Main, đổi "Kết quả gần đây" thành hai khối: (1) "Vừa có kết quả" — tối đa hai dòng bài mới trả kể từ lần vào trước, mỗi dòng mở thẳng phiếu; hết thì ẩn. (2) "Lỗi đang lặp lại" — đúng một dòng lấy lỗi số 1 của TienDo kèm liên kết "Ôn 10 phút" tới bài ngữ pháp và "Xem cả 4 lỗi" tới Tiến độ. Band theo kỹ năng chuyển hẳn sang Tiến độ.
- Công: S.

### HV-19 · Nhẹ · "Hôm nay bạn có ba việc" nhưng màn hình có năm dòng việc
- Tờ: Main và Mobile (1 bài tiếp theo + 2 bài được giao + 2 bài đang dở); ThongBao màn 1 (cùng tiêu đề với ba bài được giao).
- Sửa: định nghĩa con số: chỉ đếm việc có hạn trong hôm nay và ngày mai cộng bài tiếp theo của lộ trình; "Đang làm dở" đổi tên "Làm tiếp khi rảnh" và không đếm. Không có việc nào: "Hôm nay không có bài đến hạn."
- Công: S.

---

## Hành trình 5 — Học hằng ngày

### HV-20 · Nặng · Học viên lớp offline có bị tính lượt chấm AI hay không: các tờ nói ngược nhau
- Tờ nói KHÔNG tính: TaiKhoan màn 1 ("Khoá của lớp… Không tính lượt chấm AI", "bài của lớp không tính lượt"); TroGiupLanDau ("giáo viên duyệt rồi mới trả, không tính lượt"); ThiThu ("Do Lớp… xếp · không tính lượt chấm AI của bạn").
- Tờ nói CÓ tính: Main (học viên Course 1, khối "Lượt chấm AI kèm khoá: Writing XXX trên XXX"); KetQuaWriting (bài Course 3: "Viết lại và nộp chấm sẽ dùng 1 lượt chấm AI. Bạn còn XXX lượt Writing"); LuyenTap màn 3 ("Học viên lớp offline hết lượt: Hỏi giáo viên hoặc admin cấp thêm lượt"); BaiTapWriting khối 4 (hộp "Nộp chấm dùng 1 lượt" được ghi là "Luôn hiện").
- Vì sao hại: việc chính của học viên lớp là nộp bài tập về nhà. Nếu màn nộp bài doạ "dùng 1 lượt" trong khi thật ra không tính, họ sẽ ngại viết lại; nếu thật ra có tính mà trang Tài khoản bảo không, họ hết lượt giữa khoá mà không hiểu vì sao.
- Sửa: chủ dự án chốt một quy tắc, đề nghị: bài được giao và kỳ thi của lớp không tính lượt; tự luyện ngoài bài giao và "Viết lại bài này" tính lượt của tài khoản (nếu admin có cấp). Rồi sửa theo: Main (học viên chỉ có lớp và không được cấp lượt: bỏ khối "Lượt chấm AI kèm khoá" và số trên thanh); KetQuaWriting (bài lớp: "Viết lại để giáo viên xem · không tính lượt" hoặc ghi rõ tính); BaiTapWriting và BaiTapSpeaking (hộp hỏi lại của bài được giao không nhắc lượt).
- Công: M.

### HV-21 · Vừa · Bài trong khoá online mở được tự do hay phải học tuần tự: hai tờ nói khác nhau
- Tờ: LoTrinh ("Chặng 3 đến 5 · 30 bài. Mở dần khi bạn học xong chặng trước"; bài 16 "Sau bài 15"); BaiGiang ("Làm xong mới mở bài 15"); TrangKhoaHoc màn 2 "Đã đăng ký" ("mọi bài mở được"); ChuongTrinhKyNang ("Ngày nào cũng mở sẵn; bạn đi theo thứ tự hoặc chọn ngày mình cần").
- Vì sao hại: người đã trả học phí, ba tuần nữa thi, cần đúng chương Task 1 ở chặng 4 thì bị khoá. Trang bán khoá đã hứa mọi bài mở được.
- Sửa: theo TrangKhoaHoc và ChuongTrinhKyNang: mọi bài mở được; LoTrinh giữ thứ tự và nhãn "Tiếp theo" như gợi ý. LoTrinh đổi câu thành "Chặng 3 đến 5 · 30 bài · nên học sau chặng 2; bạn vẫn mở trước được". BaiGiang đổi "Làm xong mới mở bài 15" thành "Làm xong thì bài 14 được ghi Đã học". Riêng bài kiểm tra giữa chặng có thể giữ điều kiện.
- Công: S.

### HV-22 · Vừa · Bài được giao đã đóng là ngõ cụt: không còn cách nào để tự luyện
- Tờ: LoTrinhBaiDuocGiao màn 2D ("Không còn nhận bài"; "Muốn làm lại để luyện thì hỏi giáo viên mở lại hạn; trang không tự mở"); LopBuoiHoc màn 3 (lớp kết thúc: "Không nộp", "không có nút Làm bài").
- Vì sao hại: người bận việc lỡ hạn một tuần mất luôn cơ hội luyện đúng bài đó; mục đích của bài tập là học chứ không phải nộp cho đủ.
- Sửa: dòng bài đã đóng có nút "Tự luyện bài này". Listening, Reading, từ vựng, ngữ pháp: làm ở chế độ tự chấm, kết quả ghi "Tự luyện · không tính vào bài được giao", giáo viên không nhận. Writing, Speaking: mở trình soạn ở chế độ tự luyện theo quy tắc lượt đã chốt ở HV-20.
- Công: M.

### HV-23 · Vừa · Hết lượt chấm: mỗi tờ chỉ một lối ra khác nhau
- Tờ: BaiTapWriting khối 4 (nút "Xem các khoá học"); LuyenTap màn 3 ("Đăng ký thêm lượt chấm"); BaiMauWriting ghi chú ("Đăng ký thêm lượt chấm"); ThongBao ("Xem cách thêm lượt"); TrangKhoaHoc và TaiKhoan ("Chưa chốt có mở đăng ký thêm lượt lẻ hay không").
- Vì sao hại: người vừa viết xong 250 từ, bấm nộp, và được mời "Xem các khoá học" — trong khi thứ họ cần là thêm lượt cho khoá đang học.
- Sửa: một khối hết lượt dùng chung, ba dòng: (1) bài đã lưu nháp, nộp lại được khi có lượt; (2) nút chính "Đăng ký thêm lượt chấm" (GiaHanThemLuot màn 3) — nếu chủ dự án chưa mở thêm lượt lẻ thì nút chính là "Đăng ký lại khoá" kèm số lượt nhận; (3) việc làm ngay không tốn lượt: "So bài nháp với bài mẫu 7.0 cùng đề" khi đề có trong kho. Dùng khối này ở BaiTapWriting, BaiTapSpeaking, LuyenTap, HubKyNang, ThuVien.
- Công: S (sau khi chốt).

### HV-24 · Vừa · Speaking: một câu lẻ 20 giây tốn một lượt, bằng cả full test
- Tờ: LuyenTap màn 1 ("một câu lẻ, một Part hoặc cả full test tính là một lượt"); TaiKhoan ("một phần Speaking dùng 1 lượt"); TrangKhoaHoc (bảng lượt để XXX).
- Vì sao hại: người ít thời gian hợp nhất với luyện câu lẻ, nhưng quy tắc này khiến luyện ngắn "đắt" nhất nên họ sẽ né. Ba tờ cũng chưa khớp đơn vị.
- Sửa: chốt đơn vị trước khi dựng. Đề nghị: một lượt = một lần nộp tới tối đa một Part (Part 1 gồm cả bộ 4–5 câu); luyện câu lẻ gom tới 5 câu mới tính một lượt, hoặc không chấm band mà chỉ nhận xét ngắn và không tính lượt. Ghi cùng một câu ở LuyenTap, TaiKhoan, TrangKhoaHoc, HubKyNang.
- Công: L (quyết định) + S (chữ).

### HV-25 · Nhẹ · Hai hộp hỏi liên tiếp trước khi nộp, và một hộp hỏi thừa ở bài quá hạn
- Tờ: BaiTapWriting khối 4 ("Nộp chấm khi bài mới có 182 từ?" rồi hộp "Nộp chấm bài này?" được ghi "Luôn hiện, kể cả sau khi đã bấm Vẫn nộp chấm"); LoTrinhBaiDuocGiao màn 2A ("Làm bài đã quá hạn 3 ngày?" trong khi dòng đã ghi "Quá hạn 3 ngày · nhận bài trễ đến 20/11" và trình soạn có dải 2B).
- Sửa: gộp cảnh báo thiếu từ vào chính hộp nộp (thêm một dòng cảnh báo phía trên, nút chính "Viết tiếp"). Bỏ hộp 2A; giữ dải 2B.
- Công: S.

### HV-26 · Nhẹ · Nút "Xem kết quả" ở bài còn chờ giáo viên duyệt; "nộp trễ" và "nộp muộn" dùng lẫn
- Tờ: LoTrinhBaiDuocGiao màn 1 nhóm "Đã nộp · chờ giáo viên duyệt" (nút "Xem kết quả" mở phiếu chưa có kết quả); HubKyNang dùng "Xem bài" cho đúng ca này; ThongBao ("Xem và nộp muộn", "bài ghi là nộp muộn") so với LoTrinhBaiDuocGiao ("Nộp trễ 3 ngày").
- Sửa: bài chờ duyệt dùng "Xem bài đã nộp". Chọn một từ, đề nghị "nộp trễ", sửa ThongBao.
- Công: S.

### HV-27 · Nhẹ · Nhãn "Không tính lượt" lặp ở bốn trên sáu dòng của hub Luyện tập
- Tờ: LuyenTap màn 1 (Listening, Reading, Từ vựng, Ngữ pháp đều có ô "Không tính lượt"; đầu trang và cuối trang đã nói cùng điều).
- Sửa: chỉ gắn nhãn cho ngoại lệ ("Tốn 1 lượt khi nộp chấm" ở Speaking, Writing); bỏ bốn nhãn còn lại.
- Công: S.

### HV-28 · Nhẹ · Không có ô tra nhanh cho người đang học
- Tờ: ThanhPhanKhungTrang ("Thanh trên không có ô tìm kiếm").
- Gặp gì: đang đọc bài giảng, muốn tra một từ hay một điểm ngữ pháp phải đi Thư viện › Từ vựng › ô tra.
- Sửa: không thêm mục thứ sáu; đặt một nút kính lúp cạnh chuông, mở ô tra dùng chung dữ liệu gợi ý của TuVung và GrammarWiki (từ, bài ngữ pháp, đề bài mẫu). Trên điện thoại đặt trong trang Thư viện, ô đầu trang.
- Công: M.

---

## Hành trình 6 — Nộp bài và nhận kết quả

### HV-29 · Vừa · "Việc nên sửa" không phải lúc nào cũng kèm lối học
- Tờ: KetQuaWriting "Ba việc nên sửa trước" (việc 2 có "Ôn bài 14 trong lộ trình"; việc 1 và 3 không có gì); PhieuKetQua mục 1 Speaking (ba việc: thì quá khứ, từ lặp, ngập ngừng — không liên kết nào); ChamThuMienPhi màn 6 (việc 2 "Động từ theo chủ ngữ thật… lặp 3 lần" không liên kết; "Làm gì tiếp" chỉ có bài mẫu và thử Speaking).
- Vì sao hại: kho 137 bài Grammar Wiki có sẵn anchor tới đúng mục chữa lỗi (GrammarWiki "Mỗi dòng dẫn thẳng tới mục chữa lỗi trong bài"), và GrammarWiki đã có cột "Cần ôn, từ bài đã chấm". Phiếu là nơi người học đang chú ý nhất nhưng lại không nối sang.
- Sửa: quy tắc cho cả ba phiếu: mỗi việc nên sửa có đúng một liên kết học. Lỗi ngữ pháp → mục chữa lỗi trong Grammar Wiki (công khai, nên dùng được cả cho phiếu chấm thử) và, nếu người học có khoá chứa bài đó, "Ôn bài N trong lộ trình". Lỗi từ vựng → mục từ hoặc chủ đề trong kệ Từ vựng. Lỗi bố cục/ý → bài Kiến thức Writing tương ứng. Không khớp được thì không hiện liên kết.
- Công: M (cần bảng ánh xạ loại lỗi → bài).

### HV-30 · Vừa · Phiếu Writing, Lộ trình và Bài giảng chưa có bản điện thoại
- Tờ: KetQuaWriting, LoTrinh, BaiGiang, ThuVien (không có khung 390px; PhieuKetQua mục 7 chỉ vẽ điện thoại cho Listening/Reading; BaiHocThu màn 5 có bản điện thoại của bài học thử).
- Gặp gì: thông báo "bài đã có kết quả" thường được mở trên điện thoại. Phiếu Writing có bài viết hai cột với chú thích lề và bốn thẻ — chưa ai quyết chú thích nằm đâu ở 390px.
- Sửa: thêm khung 390px cho KetQuaWriting theo đúng cách BaiMauWriting màn 4 đã giải (chú thích thành khối ngay dưới đoạn, bấm số để khoanh câu; bốn thẻ thành hàng cuộn ngang; "Ba việc nên sửa" lên trước bảng tiêu chí). LoTrinh: danh sách khoá thành ô chọn phía trên, danh sách bài một cột. BaiGiang: dùng lại bố cục BaiHocThu màn 5.
- Công: M.

### HV-31 · Vừa · Khoá hết hạn rồi thì bài đã làm còn xem được bao lâu: ba câu trả lời
- Tờ: TaiKhoan màn 3 ("Bài đã nộp và kết quả vẫn xem được trong Tiến độ" — không nêu hạn); EmailMau thư 7 và 8 ("vẫn xem được trong XXX ngày", "tới XXX"); GiaHanThemLuot màn 2 ("Xem được tới XXX (XXX ngày sau hạn)"); TrangKhoaHoc màn 2 ("chính sách lưu bài sau hạn chưa chốt").
- Vì sao hại: bài viết và nhận xét là tài sản học tập của người học; họ cần biết chắc trước khi quyết có đăng ký lại.
- Sửa: chốt một con số; đề nghị nhận xét và bài viết giữ theo tài khoản, không theo khoá (chỉ ghi âm có hạn lưu). Ghi cùng một câu ở bốn tờ. Thêm nút "Tải các phiếu của khoá này (PDF)" ở màn khoá hết hạn — dữ liệu đã có sẵn ở "Dữ liệu của tôi" (TaiKhoan).
- Công: S sau khi chốt.

---

## Hành trình 7 — Thi thử

### HV-32 · Vừa · Đề tự chọn: rời bài thì đồng hồ vẫn chạy và bài tự nộp — với Writing, Speaking nghĩa là mất lượt cho bài dở
- Tờ: ThiThu màn 1 khối cảnh báo và chú thích [1] ("Đồng hồ vẫn chạy khi bạn rời bài. Hết giờ… bài tự nộp"; "[1] XXX cần xác nhận"); bảng "Tự chọn đề thi thử" (Writing, Speaking, 4 kỹ năng: "Có · XXX lượt").
- Vì sao hại: kỳ thi của lớp thì đúng là không dừng. Nhưng với đề tự chọn, người đi làm bị gọi họp giữa chừng sẽ mất cả lượt chấm cho một bài 90 từ. Sau một lần như vậy họ không dám tự thi nữa.
- Sửa: giữ đồng hồ không dừng (để giống thi thật), nhưng tách việc tính lượt: khi hết giờ mà bài Writing dưới mức tối thiểu hoặc Speaking có Part chưa ghi, màn "Time is up" thêm lựa chọn: "Mark what I wrote (uses 1 credit)" hoặc "Discard this attempt (no credit used)". Ghi vào ThiThuTruocGio màn 6 và PhongThiNgheViet. Cho đề tự chọn một nút "Abandon test" có hỏi lại, không tính lượt.
- Công: M.

### HV-33 · Vừa · Màn trước giờ thi, lỗi micro/âm thanh/mạng và màn chặn điện thoại đều bằng tiếng Anh
- Tờ: ThiThuTruocGio màn 7a–7c ("Click the site settings icon to the left of the address bar. Set Microphone to Allow."), màn 9 ("This full test needs a screen at least 768 pixels wide"); PhongThiSpeaking màn 8; TrangLoi 7d.
- Vì sao hại: quy tắc đã chốt (mục 3) là full test toàn tiếng Anh, tôi không đề nghị đổi trong phòng thi. Nhưng các màn này nằm ngoài bài thi: đồng hồ chưa chạy, người học đang phải sửa máy. Web có cả Khoá Ngữ pháp nền tảng và lớp Course 1; người trình độ đó không tự gỡ được lỗi micro bằng hướng dẫn tiếng Anh và sẽ lỡ giờ thi của lớp. Đây là hại cụ thể của quy tắc.
- Sửa: giữ tiếng Anh từ lúc bấm "Start test" tới "Test submitted". Ba loại màn trước đó — lỗi thiết bị (7a–7c), màn chặn điện thoại (9), phòng chờ — thêm một dòng phụ tiếng Việt (`lang="vi"`, chữ nhỏ hơn) dưới mỗi câu hướng dẫn, đúng cách tờ đã làm với dòng lối về ở màn 6. Xin chủ dự án duyệt ngoại lệ này.
- Công: S.

---

## Hành trình 8 — Tiến độ, tài khoản, điện thoại

### HV-34 · Nhẹ · Trang Hôm nay trên điện thoại: dòng bài không có dấu hiệu bấm được, hạn nộp chữ 12–13px
- Tờ: Mobile (các dòng "Bài được giao, đến hạn" và "Đang làm dở" chỉ có chữ; bản máy tính có "Viết bài", "Làm tiếp"; hạn "Hạn ngày mai, 20:00" đặt cỡ 12–13px).
- Sửa: mỗi dòng thêm mũi tên "›" ở lề phải và cả dòng cao tối thiểu 56px; hạn nộp lên 14px, đậm. Giữ màu đánh dấu kèm chữ "Hạn".
- Công: S.

### HV-35 · Nhẹ · "Nhịp học theo tuần" đếm số bài, không phân biệt bài 5 phút với bài 60 phút
- Tờ: TienDo mục "Nhịp học theo tuần" ("6 trên 8 tuần bạn giữ được nhịp 3 bài"; "Tính bài giảng đã học xong, bài luyện đã nộp và buổi Speaking"); LuyenTap cột "Tuần này: 5 bài".
- Vì sao hại: chưa tới mức gây áp lực (không có chuỗi ngày, không phạt), nhưng con số dễ thành mục tiêu tự thân: ba bộ thẻ từ cũng "giữ nhịp" như ba bài Writing.
- Sửa: giữ biểu đồ, đổi đơn vị sang thứ gắn với mục tiêu: số bài lộ trình đã học trong tuần so với số cần để kịp ngày thi (đã có "Nhịp gợi ý tính từ mục tiêu và số bài còn lại"). Bỏ câu tổng kết "6 trên 8 tuần giữ nhịp"; thay bằng "Với nhịp hiện tại bạn học xong khoá trước ngày thi N tuần / chậm N tuần".
- Công: S.

### HV-36 · Nhẹ · Danh sách phiên đăng nhập chỉ có một dòng nên không giúp được gì
- Tờ: TaiKhoan màn 2 "Phiên đăng nhập" (chỉ "Thiết bị này · Đang dùng").
- Sửa: nếu giữ một phiên (xem HV-14), thay khối này bằng "Lần đăng nhập gần đây" (3 dòng: thiết bị, giờ, nơi gần đúng) để người học tự nhận ra đăng nhập lạ — đúng điều màn 8 của TaiKhoanDangNhap đang hỏi "Không phải bạn?" mà không cho dữ kiện.
- Công: S.

---

## Chế độ tối

Đã nhìn CheDoToiHocVien màn 1–4 (Hôm nay, Lộ trình, Bài giảng, Bài đọc có tô sáng): chữ phụ, hạn nộp, dòng đang chọn, tô sáng và vòng focus đều đọc được; không thấy vấn đề riêng của chế độ tối ngoài những gì đã nêu cho bản sáng (HV-19, HV-21 lặp lại ở bản tối vì cùng nội dung). Quyết định phòng thi luôn sáng là hợp lý, không đề nghị đổi.

Tương phản bản sáng (tự tính): chữ phụ `#5E5A52` trên nền `#FAF6EF` đạt 6,4:1; đỏ mận 8,6:1; viền ô nhập dùng `--muted` nên đạt 3:1. Không có phát hiện về tương phản.

---

## (a) 10 việc đáng sửa nhất, xếp theo lợi ích cho người học

1. **HV-20** — Chốt và ghi thống nhất: học viên lớp offline có bị tính lượt chấm AI không. Đang sai ở chính màn nộp bài và phiếu kết quả.
2. **HV-11** — Gửi thư khi đơn cần bổ sung hoặc không tìm thấy khoản chuyển. Người đã trả tiền không được phép chờ trong im lặng.
3. **HV-16** — Vẽ trang Hôm nay cho tài khoản chưa có khoá, đơn đang chờ, ngày đầu, khoá hết hạn; chốt một khung cho người đã đăng nhập.
4. **HV-14** — Sửa quy tắc một phiên: cho máy tính + điện thoại, hoặc hỏi ở thiết bị mới; không bao giờ đá người đang làm bài có giờ.
5. **HV-18** — Đưa "vừa có kết quả" và "lỗi đang lặp lại" lên Hôm nay.
6. **HV-29** — Mỗi "việc nên sửa" trên phiếu (kể cả phiếu chấm thử) kèm một liên kết tới đúng bài Grammar Wiki, mục từ hoặc bài trong lộ trình.
7. **HV-01** — Đặt lối chấm thử vào phần mở đầu trang chủ; bỏ lệch giữa hai tờ.
8. **HV-21** — Bỏ khoá tuần tự trong khoá online; thứ tự chỉ là gợi ý.
9. **HV-32** — Đề tự chọn hết giờ với bài dở: cho chọn chấm hay bỏ, không tự trừ lượt.
10. **HV-30** — Vẽ bản điện thoại cho phiếu Writing, Lộ trình và Bài giảng.

Sát ngay sau: HV-12 (học trước chương 1 trong lúc chờ xác nhận), HV-23 (một khối hết lượt dùng chung), HV-33 (dòng phụ tiếng Việt ở màn trước giờ thi).

---

## (b) Đề xuất phát triển thêm cho phía người học

### P1 · Sổ lỗi của tôi: biến lỗi lặp lại thành vòng ôn có kiểm chứng
- Là gì: mỗi lỗi lặp lại (đã có ở TienDo) thành một thẻ gồm: các câu sai của chính người học trích từ phiếu → mục chữa lỗi trong Grammar Wiki → 4–5 câu luyện, trong đó có việc viết lại đúng câu mình từng sai → sau đó hệ thống theo dõi lỗi này còn xuất hiện ở các bài chấm kế tiếp không ("3 bài gần nhất không còn lỗi này").
- Giá trị: người học thấy được một lỗi cụ thể biến mất; đây là bằng chứng tiến bộ thật hơn mọi đường band.
- Dựa vào: feedback có dẫn chứng, `weak_areas`, anchor của 137 bài wiki, Quick Check, cột "Cần ôn, từ bài đã chấm" ở GrammarWiki.
- Rủi ro: AI gán nhầm loại lỗi → cho nút "Đây không phải lỗi này"; chỉ lập thẻ khi lỗi xuất hiện từ hai bài trở lên.
- Không phải làm cho có vì: nó đóng vòng chấm → học → kiểm lại mà hiện các tờ mới làm tới bước "học".

### P2 · Viết lại có đối chiếu
- Là gì: sau phiếu, người học viết lại; trang đặt bản 1 và bản 2 cạnh nhau theo đúng khuôn so sánh 7.5 → 7.0 của BaiMauWriting (nhật ký khác biệt theo tiêu chí): lỗi nào đã hết, lỗi nào còn, câu nào mới phát sinh.
- Giá trị: viết lại là hoạt động nâng band Writing hiệu quả nhất nhưng ít người làm vì không thấy kết quả.
- Dựa vào: nút "Viết lại bài này" (KetQuaWriting), khuôn nhật ký khác biệt đã thiết kế, chú thích theo câu.
- Rủi ro: tốn lượt nên người học né → lần viết lại đầu của mỗi bài tính nửa lượt hoặc không tính (cần chủ dự án quyết); so sánh sai khi người học viết lại hoàn toàn → khi độ trùng thấp thì chỉ hiện hai phiếu cạnh nhau.

### P3 · Bài của tôi đứng ở đâu giữa 6.0, 7.0 và 7.5
- Là gì: khi người học viết đúng một đề trong kho 549, phiếu thêm thẻ "So với bài mẫu": với tiêu chí yếu nhất của bài, chỉ ra đoạn tương ứng trong bài 7.0 làm khác gì, bằng đúng cách chú thích của trang bài mẫu.
- Giá trị: "bài mẫu" thôi là thứ để đọc; đối chiếu với bài của mình mới là thứ để học. Không web nào ở Việt Nam có ba mức cho cùng một dàn ý, nên đây là điểm riêng.
- Dựa vào: 549 đề × 3 mức, nhật ký khác biệt theo tiêu chí, nút "Viết đề này" đã có ở BaiMauWriting màn 3.
- Rủi ro: AI so sánh gượng ép khi dàn ý khác hẳn → chỉ so theo tiêu chí và theo loại đoạn (mở bài, thân bài, kết), không so câu với câu.

### P4 · Nhại theo câu trả lời mẫu Speaking
- Là gì: ở trang đề Speaking có video, bấm một câu trong lời thoại → nghe → ghi âm câu đó → máy chấm phát âm theo từ và âm.
- Giá trị: luyện phát âm và ngữ điệu trên đúng câu mình sẽ dùng khi thi; mỗi lượt chỉ 10–20 giây, hợp điện thoại.
- Dựa vào: lời thoại có mốc thời gian (DeSpeaking mục 3), máy chấm phát âm thang 100 và trình thu từng câu (BaiTapPhatAm), nút "Nghe lại 0:14".
- Rủi ro: chi phí chấm nếu mở công khai → chỉ cho người có khoá Speaking hoặc lớp; học thuộc bài mẫu → nhắc "mượn cấu trúc, đổi nội dung" và gợi ý ghi lại bằng ý của mình.

### P5 · "Tôi có 15 phút": Hôm nay theo quỹ thời gian
- Là gì: một hàng ba nút ở đầu Hôm nay — 15 · 30 · 60 phút — chọn xong trang xếp lại đúng số việc vừa quỹ đó, ưu tiên bài đến hạn, rồi lỗi đang lặp, rồi bài lộ trình. Dùng mục tiêu và ngày thi đã hỏi ở lần đầu vào.
- Giá trị: người đi làm quyết bằng thời gian đang có chứ không bằng danh sách.
- Dựa vào: thời lượng đã ghi ở mọi bài ("Video 18 phút · 12 câu", "còn khoảng 9 phút"), dữ liệu resume, thẻ từ đến hạn.
- Rủi ro: thành áp lực nếu kèm đếm ngày → không chuỗi ngày, không nhắc khi bỏ lỡ; chỉ là cách sắp xếp.

### P6 · Phiếu trước buổi học cho lớp offline
- Là gì: 24 giờ trước mỗi buổi, học viên thấy "Mang gì tới lớp": hai lỗi của riêng mình từ bài tập buổi trước, một câu mình muốn hỏi (ô gõ, gửi giáo viên), tài liệu buổi tới. Giáo viên nhận bản gom của cả lớp (AI soạn nháp, giáo viên duyệt).
- Giá trị: buổi học trực tiếp chữa đúng lỗi của lớp đó; học viên thấy web và lớp là một.
- Dựa vào: LopBuoiHoc đã có "Nhận xét của giáo viên · Cho cả lớp / Riêng cho bạn", bài tập gắn số buổi, "Buổi cần ôn" từ bài kiểm tra.
- Rủi ro: thêm việc cho giáo viên → nháp tự động, một lần bấm duyệt; không gửi tên học viên kèm lỗi trong bản gom cho cả lớp.

### P7 · Kho ý theo chủ đề, rút từ 549 bài mẫu
- Là gì: tra theo chủ đề (công nghệ, môi trường…) ra các ý lập luận, ví dụ và cụm từ đã dùng trong bài mẫu, mỗi ý dẫn về đúng đoạn trong bài; kèm bài tập "chọn hai ý, viết một đoạn thân bài" có AI chấm.
- Giá trị: khó khăn hàng đầu của người thi Task 2 là hết ý chứ không phải ngữ pháp; cũng là nội dung nền cho Khoá Vocabulary Skills + Ideas.
- Dựa vào: "ma trận ý" của từng đề (BaiMauWriting mục 3), bảng từ vựng theo đề, kệ Từ vựng theo chủ đề.
- Rủi ro: học thuộc ý → trình bày ý dưới dạng câu hỏi gợi mở, yêu cầu tự viết câu của mình trước khi xem câu mẫu.

Thứ tự nên làm: P1 và P3 trước (dùng dữ liệu sẵn có, tạo điểm riêng rõ nhất), rồi P2, P5, P6; P4 và P7 khi có khoá Speaking và Vocabulary.

---

## (c) Những gì không kiểm được

- **Tương tác thật.** Các tờ là bản tĩnh; tôi không bấm thử. Trạng thái sau khi bấm (mở menu, đổi bước, lọc) chỉ đọc qua chữ trong mẫu, không nhìn hình. Thứ tự Tab, bẫy tiêu điểm trong hộp thoại, trình đọc màn hình: chỉ đọc quy tắc ghi trong tờ, chưa thử.
- **Hình.** Chỉ nhìn hình 8 tờ nêu ở đầu báo cáo (và chỉ phần đầu của ChamThuMienPhi, ThanhToan, LuyenTap, CheDoToiHocVien). 51 tờ còn lại đánh giá qua chữ và style nội tuyến; chưa kiểm tràn chữ, xuống dòng xấu, vùng bấm thật ở 390px.
- **Đọc lướt, chưa đọc hết:** ChuongTrinhKyNang, SachBaiTap, DanhSachDe, BaiTapListening, BaiTapReading, BaiTapKhachQuan, BaiTapTuVungNguPhap, BaiTapPhatAm (phần sau màn 1), NguPhap, GrammarWikiMinhHoa, PhongThiNgheViet, XemLaiBaiLam (chỉ phần cuối), CheDoToi và CheDoToiCongKhaiAdmin (chỉ ghi chú). Có thể còn phát hiện ở các tờ này.
- **Nội dung thật.** Mọi con số là XXX hoặc mẫu: chưa đánh giá được học phí, thời hạn, số lượt có hợp lý với người học không; chưa xem video, audio, chất lượng nhận xét của AI, độ đúng của 549 bài mẫu và 137 bài wiki.
- **Web đang chạy.** Không mở averlearning.com; chỉ dựa vào các báo cáo 03, 03b (đọc phần đầu) để biết hiện trạng. Báo cáo 12-navigation-ia chưa đọc.
- **Hiệu năng, tải chậm, mạng yếu trên điện thoại thật; ghi âm trên iOS Safari; bàn phím ảo che ô viết.**
- **Phía giáo viên và admin** của các luồng người học phụ thuộc (duyệt bài, xác nhận đơn, cấp mã): ngoài phạm vi, chưa đối chiếu với các tờ Admin.
- **Người học thật.** Chưa có quan sát hay phỏng vấn; mức Nặng/Vừa/Nhẹ là phán đoán của người kiểm duyệt.
