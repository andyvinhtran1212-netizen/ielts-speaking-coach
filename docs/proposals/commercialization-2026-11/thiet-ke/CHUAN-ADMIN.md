# Chuẩn dùng chung cho các tờ Admin và Giáo viên — Đợt 10 (bắt buộc, giống hệt ở mọi tờ)

Hôm nay trong dữ liệu mẫu: Thứ Ba 17/11/2026.

## A. Sidebar admin chuẩn (AD-37) — bản gốc nằm ở ThanhPhanKhungTrang2 mục 7

Markup: dùng ĐÚNG khối `<nav aria-label="Điều hướng quản trị">…</nav>` của AdminCaiDat (fix/project/AdminCaiDat.dc.html, `<sc-for list="{{nav}}" as="g">` với các trường g.exp, g.toggle, g.headColor, g.chev, g.name, g.badgeShow, g.show, g.items; i.href, i.current, i.bar, i.bg, i.weight, i.label, i.count). Nếu tờ đang dùng kiểu khác (vd. `side1`, hoặc danh sách viết tay), thay bằng khối này. Tờ có nhiều khung admin (nhiều màn) dùng cùng một `nav` hoặc gọi `NAV('…')` nhiều lần với mục hiện tại khác nhau.

JS: dán nguyên khối dưới đây vào renderVals (chỉ đổi đối số của NAV và nhóm mở sẵn). `open` là object state các nhóm đang mở; nhóm chứa trang hiện tại phải mở sẵn trong state khởi tạo.

```js
const NAV = (cur, open) => [
['tq', 'Tổng quan', [['Việc cần làm', 'AdminViecCanLam.dc.html', '']]],
['hv', 'Học viên và quyền truy cập', [['Học viên', 'AdminDanhBa.dc.html', ''], ['Lớp', 'AdminLop.dc.html', ''], ['Giáo viên', 'AdminGiaoVienThongBao.dc.html', ''], ['Mã kích hoạt', 'AdminLuotVaMa.dc.html#s2', ''], ['Gửi thông báo', 'AdminGiaoVienThongBao.dc.html#m2', ''], ['Khảo sát và nhận xét', 'AdminKhaoSat.dc.html', '4']]],
['kh', 'Khoá học và đăng ký', [['Khoá học', 'AdminKhoaHoc.dc.html', ''], ['Đơn đăng ký', 'AdminDonDangKy.dc.html', '2'], ['Lượt AI', 'AdminLuotVaMa.dc.html', '']]],
['cb', 'Chấm bài', [['Writing', 'AdminChamWriting.dc.html', '3'], ['Speaking', 'AdminChamSpeakingThiThu.dc.html', '2'], ['Yêu cầu chấm lại', 'AdminChamLai.dc.html', '2']]],
['nd', 'Nội dung', [['Listening', 'AdminNoiDung.dc.html', ''], ['Reading', 'AdminNoiDung.dc.html', ''], ['Writing', 'AdminNoiDungVietNoi.dc.html', ''], ['Speaking', 'AdminNoiDungVietNoi.dc.html#m5', ''], ['Từ vựng', 'AdminNoiDungTuVungNguPhap.dc.html', ''], ['Ngữ pháp', 'AdminNoiDungTuVungNguPhap.dc.html#m6', ''], ['Thư viện công khai', 'AdminThuVienCongKhai.dc.html', '']]],
['tt', 'Thi thử', [['Kỳ thi', 'AdminKyThi.dc.html', '']]],
['bc', 'Báo cáo', [['Hoạt động học viên', 'AdminBaoCao.dc.html#m1', ''], ['Lưu lượng', 'AdminBaoCao.dc.html#m2', ''], ['Chi phí AI', 'AdminBaoCao.dc.html#m3', ''], ['Chất lượng nội dung', 'AdminBaoCao.dc.html#m4', '']]],
['ht', 'Hệ thống', [['Hộp thư sự cố', 'AdminSuCo.dc.html', '12'], ['AI và mô hình', 'AdminHeThong.dc.html', ''], ['Bảo mật', 'AdminHeThong.dc.html#m2', ''], ['Công cụ QA', 'AdminHeThong.dc.html#m3', ''], ['Cài đặt', 'AdminCaiDat.dc.html', '']]]
].map(([id, name, rows]) => {
const items = rows.map(([label, href, count]) => { const c = cur === id + '/' + label; return { label, href, count, current: c ? 'page' : 'false', bar: c ? 'var(--accent)' : 'transparent', bg: c ? 'var(--tint)' : 'transparent', weight: c ? 600 : 400 }; });
const ex = !!open[id];
const hasCur = items.some((x) => x.current === 'page');
const badge = items.reduce((n, x) => n + (Number(x.count) || 0), 0);
return { id, name, items, exp: ex ? 'true' : 'false', show: ex, chev: ex ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6', badgeShow: !ex && badge ? String(badge) : '', headColor: hasCur ? 'var(--ink)' : 'var(--muted)', toggle: () => this.setState({ open: Object.assign({}, open, { [id]: !open[id] }) }) };
});
// dùng: nav: NAV('ht/Cài đặt', s.open || { ht: true })
```

Danh sách chốt (nguyên văn): Tổng quan: Việc cần làm · Học viên và quyền truy cập: Học viên, Lớp, Giáo viên, Mã kích hoạt, Gửi thông báo, Khảo sát và nhận xét (4) · Khoá học và đăng ký: Khoá học, Đơn đăng ký (2), Lượt AI · Chấm bài: Writing (3), Speaking (2), Yêu cầu chấm lại (2) · Nội dung: Listening, Reading, Writing, Speaking, Từ vựng, Ngữ pháp, Thư viện công khai · Thi thử: Kỳ thi · Báo cáo: Hoạt động học viên, Lưu lượng, Chi phí AI, Chất lượng nội dung · Hệ thống: Hộp thư sự cố (12), AI và mô hình, Bảo mật, Công cụ QA, Cài đặt.
Đã bỏ: "Giáo viên duyệt" (gộp vào Writing/Speaking, AD-02), "Chấm bài › Thi thử" (trùng với Thi thử › Kỳ thi, AD-22). Không có mục tải lên / nhập hàng loạt nào (nội dung nhập qua script backend, AD-32).
Thanh trên: logo Ấn ký + "Aver Learning", nhãn "Quản trị", nhãn môi trường "Production · dữ liệu thật", ô tìm ⌘K, "Xem như học viên", nút tài khoản "VT" (Vũ Thanh Tâm) — giữ như AdminViecCanLam.

## B. Khung giáo viên chuẩn (AD-16) — theo GiaoVien
Nhãn vai trò "Giáo viên"; sidebar phẳng NĂM mục, trang đầu "Việc của tôi": Việc của tôi · Lớp của tôi · Học viên · Giao bài · Chấm và duyệt bài (5). Nút tài khoản "TH" (Trần Thu Hà). Mọi tờ vẽ khung giáo viên phải dùng đúng năm mục này (số ở "Chấm và duyệt bài" = 5 = bài chờ duyệt của các lớp cô Hà: Writing 3 + Speaking 2; bài AI lỗi đi về admin).

## C. Bộ dữ liệu mẫu chuẩn (AD-18)
Người vận hành:
- Vũ Thanh Tâm — Quản trị, chủ trung tâm, tamvt@example.com, viết tắt VT. Vừa quản trị vừa dạy lớp Sat–Sun 09:00.
- Trần Thu Hà — Giáo viên, thuha@example.com, viết tắt TH. Dạy Tue–Thu 19:30 và Mon–Wed 18:00. (Không dùng "Lê Thu Hà", "Trần Thu Hằng", "Lê Quang Vinh" cho giáo viên/admin nữa.)
Lớp (tên lớp = lịch; Course ghi "Course N · XXX"):
- Tue–Thu 19:30 · Course 1 · giáo viên Trần Thu Hà · 14 học viên · hôm nay (Thứ Ba 17/11) học buổi 11 / 20.
- Mon–Wed 18:00 · Course 3 · giáo viên Trần Thu Hà · 12 học viên · buổi kế tiếp 15 / 20, Thứ Tư 18/11.
- Sat–Sun 09:00 · Course 2 · giáo viên Vũ Thanh Tâm · 10 học viên · buổi kế tiếp 6 / 20, Thứ Bảy 21/11.
(Không dùng "Tối 3-5-7", "Sáng 2-4-6", "Mon–Wed 20:00".)
Học viên cố định (email ten@example.com):
- Nguyễn Minh Anh — Tue–Thu 19:30, mã lớp T9RB-6KZE, minhanh@example.com (nhân vật của HoSoHocVien). Mục tiêu 6.5. Writing 4 bài gần nhất 5.5 · 5.5 · 6.0 · 6.0.
- Phạm Gia Huy — Tue–Thu 19:30; trễ 2 bài liên tiếp (dùng cho "Cần chú ý").
- Đỗ Khánh Linh — Tue–Thu 19:30; 9 ngày chưa hoạt động.
- Trần Bảo Ngọc — Tue–Thu 19:30.
- Trần Quốc Bảo — Tue–Thu 19:30.
- Đặng Văn Khoa — Tue–Thu 19:30; chưa nộp bài buổi 10 (cùng Phạm Gia Huy và Đỗ Khánh Linh).
- Lê Quang Minh — Mon–Wed 18:00; quyền Course 3 hết hạn 22/11 (sắp hết hạn).
- Hoàng Mai Chi — Mon–Wed 18:00.
- Phạm Thu Trang — học viên khoá online "Khoá Writing for IELTS", đơn AVER-M5RD2K (chờ xác nhận); người chuyển tiền "Trần Văn Bình" là bố (lời nhắn trên đơn). Đây là khoá đầu tiên của Trang: đơn chưa xác nhận nên CHƯA có lượt chấm AI nào (không dùng Trang làm ví dụ "còn ≤ 3 lượt").
Số trong hàng chờ (khớp sidebar): Nhận xét chờ duyệt 4 (Khảo sát và nhận xét) · Writing chờ duyệt 3 · Speaking chờ duyệt 2 · AI lỗi cần chấm tay 1 (nằm trong Writing) · Yêu cầu chấm lại 2 · Đơn đăng ký chờ xác nhận 2 · Hộp thư sự cố 12.
Kỳ thi hôm nay: "Thi thử tháng 11", 17/11 14:00, cách thi "Phòng thi cùng giờ", hai lớp Tue–Thu 19:30 và Mon–Wed 18:00 (26 thí sinh), mở từ AdminKyThi.dc.html.
Bài kiểm tra chờ công bố: "Kiểm tra giữa khoá · Course 3" của lớp Mon–Wed 18:00, 12/12 bài đã nộp, chế độ "giáo viên công bố".

## D. Bảng ngưỡng vận hành DUY NHẤT (AD-03) — nằm ở AdminCaiDat › Ngưỡng vận hành (id m6)
Mọi tờ khác KHÔNG ghi số ngưỡng riêng; chỉ ghi "ngưỡng ở Cài đặt › Ngưỡng vận hành" và liên kết `AdminCaiDat.dc.html#m6`. Trên tờ mẫu được hiện chữ "quá hạn" khi vượt, có thể ghi giá trị trong ngoặc đúng như bảng.
Mốc tính chung cho bài chờ duyệt: từ lúc AI chấm xong. Giá trị là mặc định đề xuất, chủ dự án chốt:
- Quá hạn xử lý: Đơn đăng ký chờ xác nhận 24 giờ (từ lúc học viên báo đã chuyển) · Bài Writing/Speaking chờ giáo viên duyệt 48 giờ (từ lúc AI chấm xong) · Yêu cầu chấm lại 48 giờ · Bài Speaking thi thử chờ chấm 72 giờ · Sự cố chưa có người nhận 24 giờ · Phản hồi học viên chưa trả lời 72 giờ.
- Cần chú ý (học viên): trễ liên tiếp từ 2 bài · không hoạt động từ 7 ngày · quyền khoá còn ≤ 7 ngày · còn ≤ 3 lượt chấm AI · Điểm tụt · Bỏ dở · Gần ngày thi · Có nguy cơ bỏ (giá trị từng ngưỡng xem bảng ở AdminCaiDat #m6).
- Khảo sát: lớp còn ≤ 5 buổi mà chưa có khảo sát · số người trả lời tối thiểu để hiện phần trăm (giá trị ở AdminCaiDat #m6).
- Sắp hết hạn: mã kích hoạt chưa dùng còn ≤ 14 ngày.
- Phòng thi: đứng yên quá 5 phút (AdminKyThi dùng).
- Lưu dữ liệu: giữ như hiện có.

## E. Thành phần giao bài dùng chung (AD-12) — bản gốc ở ThanhPhanDuLieu, mục "Giao bài theo buổi"
Bảng bên (ngăn kéo phải, rộng ~480px) mở từ: thẻ Buổi học / Bài nộp của lớp (AdminLop), mục Giao bài và Việc của tôi (GiaoVien), hồ sơ học viên "Giao bài" (HoSoHocVien, chọn sẵn người đó), trang một đề "Giao bài này…" (các tờ Nội dung). Trường, theo thứ tự:
1. Lớp — cố định khi mở từ lớp; danh sách chọn khi mở từ chỗ khác.
2. Buổi — mặc định buổi kế tiếp chưa có bài (vd. "Buổi 12 · Thứ Năm 19/11").
3. Bài — chọn một hoặc nhiều bài từ ngân hàng của Course lớp (lọc kỹ năng).
4. Giao cho — Cả lớp (14) / Chọn tay (danh sách ô chọn, đếm "đã chọn 3") / Nhóm đã lưu (danh sách nhóm). Có "Lưu nhóm này…" khi chọn tay.
5. Hạn nộp — mặc định 23:59 của ngày học buổi đó; sửa được.
6. Chế độ trả điểm — CHỈ hiện khi bài là bài kiểm tra: "Trả ngay khi nộp" / "Giáo viên công bố" (mặc định với lớp offline).
7. Dòng xem lại một câu + nút "Giao bài" (nút chính) và "Huỷ". Sau khi giao: dòng trạng thái "Đã giao · học viên nhận thông báo trong ứng dụng".
Writing/Speaking của lớp offline: AI chấm, giáo viên duyệt rồi mới trả (ghi một dòng trong bảng bên).
Hai sổ giao bài ở Nội dung (AdminNoiDungVietNoi mục 4, AdminNoiDungTuVungNguPhap mục 8) BỊ BỎ; trang một đề chỉ còn nút "Giao bài này…" mở thành phần này.

## F. Liên kết sang tờ người khác làm
- Kết quả một bài giao: AdminKetQuaBaiGiao.dc.html (tờ mới, người khác vẽ).
- Kỳ thi (tổ chức, phòng live, phân tích, NƠI DUY NHẤT trả kết quả thi thử): AdminKyThi.dc.html.
- Hồ sơ chăm sóc học viên: HoSoHocVien.dc.html.

## G. Thư về đơn đăng ký: BỐN thư
1. Đã tạo đơn đăng ký (bắt buộc). 2. Nhắc chuyển khoản — tối đa một lần. 3. MỚI "Cần bổ sung / chưa tìm thấy khoản chuyển" — gửi khi admin đánh dấu đơn "Cần bổ sung" hoặc "Sai lệch", kèm lời nhắn của admin và đường về trang đơn (bắt buộc). 4. Khoá đã mở (bắt buộc). Đơn không có thư nào khác. Không còn câu "cần bổ sung chỉ báo trong ứng dụng" (vẫn có thông báo trong ứng dụng song song).

## H. Khối tóm tắt học viên dùng chung (AD-31) — bản gốc ở ThanhPhanDuLieu, cạnh thành phần giao bài
Dùng cho ngăn "Xem nhanh" ở AdminDanhBa và ngăn học viên ở GiaoVien (và đầu HoSoHocVien — người khác). Trường theo thứ tự: tên + lớp/khoá · trạng thái một dòng ("Đang ổn" / "Cần chú ý: trễ 2 bài liên tiếp" …) · mục tiêu band và ngày thi (nếu có; không có thì "chưa đặt") · bài quá hạn (số + tên bài gần nhất) · band gần đây (Writing/Speaking; không có dữ liệu thì "chưa có bài", không ghi band) · hoạt động gần nhất · ghi chú mới nhất (người, ngày, một dòng). Cuối khối: nút "Mở hồ sơ" (HoSoHocVien.dc.html) và tuỳ ngữ cảnh "Gửi nhắc" / "Giao bài". Không thêm trường khác.

## I. Kiểm tra bắt buộc sau khi sửa
- python3 -I S/check3.py S/out10/project (không có unclosed/err/hex/emoji; support và pal True).
- python3 -I S/out10/tools/jscheck.py <tờ> (cú pháp script).
- zsh S/out10/tools/render.sh <TenTo> → in "need" (chiều cao nội dung thật) và "missing" (hole thiếu). Chiều cao khai báo (cả ở style gốc và "$preview" height) phải ≥ need + 100 và ≤ 8000. "missing" chỉ được chứa biến của vòng lặp lồng (mock không điền được), không được chứa biến cấp cao nhất. Ảnh ở S/out10/render/<TenTo>.png để tự nhìn.


## Sửa đổi 17/11/2026 (chiều) — thắng các mục trên
- Chỉ Writing của lớp offline qua giáo viên duyệt. Speaking của lớp offline: AI chấm và trả ngay, không vào hàng chờ duyệt.
- "Speaking (2)" trên sidebar và trong các số đếm là **Speaking thi thử chờ giáo viên chấm**, không phải bài chờ duyệt.
- "Chấm và duyệt bài (5)" = Writing chờ duyệt 3 + Speaking thi thử chờ chấm 2.
- Mã lớp cấp kèm số lượt chấm; "Cấp thêm lượt cho học viên/lớp" là một hộp ở AdminLop.


## Sửa đổi 18/11/2026 (lượt dọn chéo) — thắng các mục trên
- Sidebar: nhóm "Học viên và quyền truy cập" có thêm mục cuối "Khảo sát và nhận xét" (AdminKhaoSat.dc.html, số đếm 4 = nhận xét chờ duyệt), sau "Gửi thông báo".
- Lớp Tue–Thu 19:30, buổi 10: lớp có 2 bài Writing chờ duyệt; ba người chưa nộp bài buổi 10 là Phạm Gia Huy, Đỗ Khánh Linh, Đặng Văn Khoa.
- Mock test (thi thử nhiều kỹ năng) chỉ có khi admin/giáo viên giao. Hai cách thi, tên dùng thống nhất ở mọi tờ admin và học viên: **"Phòng thi cùng giờ"** và **"Làm trong khoảng thời gian"**. Mỗi phần làm một lần, làm lần lượt; không có công tắc "Được nghỉ giữa các phần" hay "Cho làm lại"; muốn cho làm lại thì dùng thi bù. Overall band chỉ có ở mock test được giao.
- Nhãn phiếu mock test phía học viên: Đã trả / Đang chấm / Không dự thi / Không làm. "Xem như thí sinh thấy" trỏ MockTestDuocGiao.dc.html.
- Đơn vị lượt chấm: 1 lượt = 1 bài Writing = 1 bài Speaking Part 2 = 1 cụm Part 1 hoặc Part 3 gồm 2–3 câu. Full test Speaking mô phỏng = 3 câu Part 1 + 1 bài Part 2 + 2 câu Part 3 = 3 lượt (mỗi Part một lượt). Full test Writing = 2 lượt (giả định, chờ anh Andy xác nhận).
- Trạng thái nội dung, một bộ cho các tờ Nội dung và AdminThuVienCongKhai: Nháp · Chờ duyệt · Chưa đăng (đã duyệt, chưa công bố) · Đã đăng · Đã gỡ.
- Các ngưỡng "Điểm tụt", "Bỏ dở", "Gần ngày thi", "Có nguy cơ bỏ" và hai ngưỡng khảo sát nằm ở AdminCaiDat #m6; tờ khác chỉ liên kết về đó.

## Sửa đổi 18/11/2026 (đợt chiều, theo 00-QUY-UOC-CHUNG mục 2 điểm 23) — thắng các mục trên
- Mỗi lớp đúng MỘT giáo viên (một giáo viên dạy được nhiều lớp). Dữ liệu mẫu giữ nguyên: Tue–Thu 19:30 và Mon–Wed 18:00 · Trần Thu Hà; Sat–Sun 09:00 và Mon–Wed 09:00 (sắp khai giảng) · Vũ Thanh Tâm. Không tờ nào vẽ lớp có hai giáo viên, "giáo viên phụ", "đồng giáo viên". Tạo/sửa lớp: một ô chọn giáo viên. Gán một lớp đã có giáo viên cho người khác là THAY người (AdminGiaoVienThongBao: "Chuyển lớp sang giáo viên này").
- Lượt chưa dùng: bỏ quy tắc "chuyển 50%". Học viên đăng ký lại thì chuyển TOÀN BỘ lượt chưa dùng sang, bảo lưu tối đa 60 ngày; không đăng ký lại thì số lượt còn lại hết hiệu lực khi khoá hết hạn. Nhãn dòng sổ lượt: "Chuyển toàn bộ khi đăng ký lại" và "Hết hiệu lực". Ô ở AdminCaiDat #m6: "Chuyển toàn bộ lượt chưa dùng khi đăng ký lại · bảo lưu tối đa 60 ngày".
- Lớp đang chạy bằng mã cũ cũng được đo lượt. Lớp mẫu ở trạng thái "Lớp dùng mã cũ · chưa cấp lượt": Sat–Sun 09:00 (Course 2, 10 học viên); thao tác "Cấp lượt cho lớp" mở hộp Cấp thêm lượt của AdminLop (chọn sẵn Cả lớp). Ở sổ mã, mã của lớp này ghi "Mã cũ · chưa cấp lượt" ở cột số lượt.
- Mock test "Làm trong khoảng thời gian": KHÔNG nghỉ giữa các phần; đã bắt đầu thì các phần chạy liền nhau. Câu mô tả dùng chung: "mỗi phần làm một lần; đã bắt đầu thì làm liền các phần, không nghỉ giữa các phần". Trạng thái người thi: chưa bắt đầu · đang làm · đã nộp hết · đã đóng chưa làm · đã đóng làm dở (không có "giữa hai phần"). Thẻ Theo dõi mẫu (Thi thử Listening–Reading · Sat–Sun 09:00): 4 đã xong · 2 đang làm · 4 chưa bắt đầu; nút "Nhắc 4 người chưa bắt đầu".
- Bài làm giữ 45 ngày sau khi khoá hết hạn (ô "Bài làm sau khi khoá hết hạn · 45 ngày" ở AdminCaiDat #m6). Bản ghi âm vẫn tối đa 60 ngày.
- Full test Writing = 2 lượt (mỗi task một lượt): ĐÃ XÁC NHẬN, thay chữ "giả định, chờ anh Andy xác nhận" ở mục sửa đổi trên. Part 3 tính như Part 1: đã chốt.
- Nhận xét học viên: ghim "Trang chủ" (tối đa 3) và "Trang các khoá online" (tối đa 3, dùng chung cho sáu khoá cho tới khi khoá có nhận xét riêng); trang công khai không ghi là của lớp offline.
- Gửi thư: dùng dịch vụ gửi thư đã có của hệ thống; còn thiếu địa chỉ gửi cho thư học viên (tên miền đã xác minh) — ghi XXX.
