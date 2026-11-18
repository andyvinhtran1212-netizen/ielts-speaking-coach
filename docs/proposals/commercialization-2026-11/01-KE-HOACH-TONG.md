# 01 — Kế hoạch tổng: thương mại hoá Aver Learning

Lập ngày 16/11/2026, theo trạng thái repo `staging` @ `93c7085`; **cập nhật ngày 18/11/2026** sau khi GOI-04, GOI-05, GOI-09 được viết lại và cả bộ được khớp chéo theo `00-QUY-UOC-CHUNG.md` mục 2 điểm 1–22; **cập nhật lần hai chiều 18/11/2026** theo điểm 23 (mỗi gói có dòng "Cập nhật 18/11/2026 chiều" ở đầu file) và sau khi GOI-04, GOI-05, GOI-09 được đọc lại từng dòng; **cập nhật tối 18/11/2026** theo điểm 24 và sau lượt rà chéo năm góc (quyết định, số hiệu, độ phủ, GOI-12, GOI-13) — các phát hiện đã áp, nhật ký ở `ban-lam-viec/ra-soat/6-da-ap.md`. Đây là bản điều phối cho cả đợt: các bước, mỗi bước gồm gì, phụ thuộc, công ước lượng, độ khó, cách chia việc cho người thực thi (project Claude Code của repo averlearning.com — 00 mục 2 điểm 23), và các quyết định đang chờ anh Andy.

Chi tiết từng việc nằm trong 13 file `GOI-NN-*.md`. Người thực thi đọc `00-QUY-UOC-CHUNG.md` trước (thứ tự đọc đầy đủ ở `BAN-GIAO.md`).

## 1. Bộ tài liệu này gồm gì

| File | Nội dung | Dòng (18/11 tối) |
|---|---|---|
| `00-QUY-UOC-CHUNG.md` | Quyết định đã chốt (mục 2, điểm 1–24 — thắng mọi tài liệu khác, điểm sau thắng điểm trước), quy tắc câu chữ, ràng buộc cứng, quy trình một nhiệm vụ, cách gỡ vướng, mẫu báo cáo, định nghĩa "xong" | 157 |
| `01-KE-HOACH-TONG.md` | File này | — |
| `02-BANG-PHU-THIET-KE.md` | Bảng đối chiếu 159 trang hiện có và các trang mới với 138 tờ thiết kế | 190 |
| `03-SO-BRAINSTORM.md` | Sổ các ý anh Andy nêu ngày 17/11 chưa chốt; không phải đầu bài cho người thực thi | 100 |
| `04-VIEC-DE-LAI.md` | Việc để lại, mang ra khi anh Andy hỏi "còn gì" (có mục "Cập nhật 18/11 chiều": các câu đã có trả lời theo 00 mục 2 điểm 23) | 132 |
| `BAN-GIAO.md` | Bản nháp bàn giao cho người thực thi: thứ tự đọc, cách bắt đầu (do phiên giám sát soạn; chưa có hiệu lực tới khi anh Andy nói "sẵn sàng") | 73 |
| `GOI-01-sap-xep-repo-pha-0-1.md` | Sắp xếp repo: việc không rủi ro và dời file cơ học | 407 |
| `GOI-02-sua-nhanh.md` | Sửa nhanh trên giao diện hiện tại | 378 |
| `GOI-03-nen-giao-dien.md` | Token, font, component dùng chung, bốn khung trang, danh mục trang, chế độ sáng/tối | 489 |
| `GOI-04-khoa-hoc-quyen-luot-ai-don-dang-ky.md` | Backend: sản phẩm khoá, quyền, một kho lượt chấm AI, đơn đăng ký và bốn thư, một phiên mỗi tài khoản và lần đăng nhập gần đây, chấm phát âm trên đoạn mẫu, chuyển lớp mã cũ sang đo lượt, thư "khoá đã mở đăng ký", yêu cầu xoá tài khoản và tải dữ liệu (viết lại 18/11, cập nhật chiều và tối 18/11) | 1.203 |
| `GOI-05-trang-cong-khai-va-dang-ky.md` | Trang chủ, danh mục, trang khoá, đăng nhập Google hoặc mã 6 số, đổi email đăng nhập, thanh toán, "Báo cho tôi khi mở", pháp lý, trang lỗi (viết lại 18/11, cập nhật chiều 18/11) | 747 |
| `GOI-06-thu-vien-cong-khai.md` | Thư viện: 549 bài mẫu Writing, kiến thức, Speaking, ngữ pháp, từ vựng; trang `/admin/library` | 477 |
| `GOI-07-loi-hoc-vien.md` | Điều hướng 5 mục, đổi đường dẫn, Hôm nay năm trạng thái, Lộ trình, bài giảng, phiếu kết quả, Tài khoản, lần đầu vào; nạp bài học khoá online, bài học thử, bài được giao và buổi học, trang xem lại (thêm tối 18/11) | 722 |
| `GOI-08-phong-thi-va-trinh-luyen.md` | Khung phòng thi chung, 7 trình làm bài, mock test được giao phía học viên; khung mới năm nhóm trang luyện của học viên (thêm tối 18/11) | 583 |
| `GOI-09-admin-va-giao-vien.md` | Khung admin, danh bạ và hồ sơ học viên, khoá và đơn, chấm bài, kết quả bài giao, tổ chức kỳ thi, cài đặt, lô nhập, khu giáo viên, cấp lượt cho lớp cũ (viết lại 18/11, cập nhật chiều 18/11) | 1.403 |
| `GOI-10-repo-pha-2-cau-truc.md` | Thay đổi cấu trúc repo: test, JS cũ, tách file lớn, route admin, media | 559 |
| `GOI-11-bo-sung-quyet-dinh-20261117.md` | Thông báo trong ứng dụng, trần chấm thử, chặn full test trên điện thoại, trả điểm bài kiểm tra khoá (backend và màn học viên), tên khoá, nhận diện, sơ đồ Grammar Wiki; thực thi spec chấm thử 0047 (G11-T14a, thêm tối 18/11) | 1.158 |
| `GOI-12-huong-phat-trien.md` | Sáu hướng phát triển (sổ lỗi cá nhân, viết lại sau chấm, độ lệch AI–giáo viên, kiểm tra đầu vào, nhắc việc tuần, gói giáo viên chấm); 38 nhiệm vụ; ngoài đợt A–E, trừ G12-C01…C03 ở đợt D (điểm 24, đã cộng vào bảng công mục 4); phần còn lại chưa tính | 1.109 |
| `GOI-13-thu-vien-mo-rong-va-prototype.md` | Nhận xét học viên và khảo sát, biên tập 137 bài Grammar Wiki, Kiến thức nền, Đọc kỹ, khuôn luyện đề (hoãn); ngoài đợt A–E; chưa tính vào bảng công mục 4 | 1.426 |
| `_MAU-GOI-VIEC.md` | Khung 10 mục của một gói | 58 |
| `thiet-ke/` | 138 tờ thiết kế `.dc.html`, `canvas.json`, quy tắc "Bản in"; `thiet-ke/CHUAN-ADMIN.md` là bản chuẩn của các tờ admin (sidebar, bảng ngưỡng, thành phần giao bài, dữ liệu mẫu — 00 mục 2 điểm 19). 6 tờ Thành phần và các tờ Đợt 4, 5 đã được anh duyệt (17/11); tờ Đợt 6 và tờ vẽ sau là bản nháp (00 mục 6) | — |
| `khao-sat/` | Báo cáo khảo sát và kiểm duyệt gốc (chỉ để tra) | — |


Mỗi gói có cùng khung: tóm tắt · hiện trạng trong repo (đã mở mã kiểm) · phạm vi · yêu cầu đánh số · hợp đồng kỹ thuật · nhiệm vụ theo thứ tự (đầu vào, việc làm, đầu ra, nghiệm thu, không làm, vướng mắc và cách gỡ, ước lượng) · vướng mắc chung · ràng buộc riêng · kiểm thử cả gói · câu hỏi cần anh quyết.

**Mức tin cậy của bộ spec.** Mỗi gói do một agent viết sau khi đọc mã thật ở bản sao chỉ đọc của `staging`. Ngày 18/11 cả bộ được khớp chéo một lượt (mỗi gói có dòng "Khớp chéo ngày 18/11/2026" ở đầu file liệt kê điểm đã đổi). Chiều 18/11 ba gói viết lại (GOI-04, GOI-05, GOI-09) được đọc lại từng dòng và đối chiếu với mã ở `staging @ c3bc71574`: tìm thấy 19 + 20 + 18 = 57 lỗi (tham chiếu mã sai dòng hoặc sai file, câu tự mâu thuẫn, chỗ trái 00 mục 2, nhiệm vụ thiếu nghiệm thu), 51 lỗi đã sửa trong gói, 3 đưa vào mục 10 của gói, 3 nằm ở file khác (hai đã sửa ở GOI-04 và ở file này; một nằm ở 00 mục 2 điểm 22 — ghi ở cuối mục 6); 97 tham chiếu mã đã kiểm (47 + 29 + 21). Tám gói còn lại (khoảng 5.200 dòng) chưa được đọc lại từng dòng. Chưa có test hay build nào được chạy để kiểm các gói. Mỗi gói có nhiều chỗ ghi `CHƯA KIỂM` kèm lệnh để người thực thi tự kiểm trước khi làm. Nhiệm vụ đầu của mỗi gói lớn là soạn spec trong repo và chờ anh duyệt; đó là lần rà thứ hai. Chỗ còn lệch chưa phân xử được ghi ở cuối mục 6.

## 2. Các bước

Năm đợt. Trong một đợt các gói chạy song song; đợt sau cần nền của đợt trước.

### Đợt A — Khởi động (làm ngay, không phụ thuộc gì)

| Việc | Gồm | Gói |
|---|---|---|
| Sửa nhanh | Tab Reading sáng; xưng "bạn" (28 chỗ frontend, 8 chỗ backend); không hiện band khi thiếu dữ liệu; bỏ "0/0"; Quick Check hiện sai sau khi mở lại; ẩn mã nội bộ; trang thiếu tham số về trang cha; trang pháp lý tối thiểu; thay 6 `alert()`; đăng nhập xong quay lại đúng trang; "Duyệt bài thi" không còn mở lỗi thiếu `mock_exam_id` | G02 (15 nhiệm vụ); G09-T02 |
| Repo pha 0 | Chỉ mục tài liệu; sổ spec; sửa hướng dẫn mâu thuẫn; xoá 2 file rác; README | G01-T01…T05 |
| Soạn và trình spec nền | Spec khoá học và quyền; spec nền giao diện; spec chính sách test và ảnh chụp mốc; spec dải số migration; sổ số migration; spec admin (ADMINIA-0074) và ba spec bổ sung của G09 (0085–0087); sáu spec của GOI-11 (0079–0084) | G04-T00, G03-T01, G10-T01, G10-T22, G01-T06, G09-T01, G09-T21, G11-T01…T06 |
| Nội dung Thư viện | Rà dữ liệu 549 đề; đặt tiêu đề tiếng Anh; bảng chủ đề; rà 19 bộ chưa có trạng thái duyệt và vẽ hình 3 bộ Task 1; hợp đồng dữ liệu Speaking với repo VIDEO MAKING | G06-T03 (chỉ chế độ `--check`), T04, T05, T19, T12 |
| Thiết kế còn lại | 6 tờ Thành phần và các tờ Đợt 4, 5 đã được anh duyệt (17/11); tờ Đợt 6 và tờ vẽ sau là bản nháp. Đã vẽ (đối chiếu 18/11 tối): `Admin1024`, `MockTestDuocGiao` (các phần chạy liền, không nghỉ), "Abandon test" và màn "Time is up" ở PhongThi, PhongThiNgheViet, PhongThiSpeaking, ThiThu, ThiThuTruocGio, khối "Cấp lượt cho lớp" ở AdminLuotVaMa. Chưa vẽ: thư "khoá đã mở đăng ký" và hai thư đổi email trên tờ EmailMau | Canvas, ngoài phạm vi người thực thi |
| Anh Andy | Trả lời các câu còn mở ở mục 7 (6 tờ Thành phần đã duyệt 17/11) | — |

Xong đợt A: các lỗi gây mất tin biến mất trên bản hiện tại; spec nền được duyệt; người thực thi có số spec và số migration riêng.

### Đợt B — Nền (cần spec ở đợt A được duyệt)

| Việc | Gồm | Gói |
|---|---|---|
| Nền giao diện | Token `--av2-`, font; trang `/ui-library` và test ảnh chụp; khoảng 25 component trong `frontend/components/ui/`; danh mục trang kèm test CI; cơ chế cùng tồn tại (`AuthedShell design="v2"`); khung công khai, học viên (có slot chuông, tra nhanh), thanh tập trung, admin; chế độ sáng/tối. Bộ 94 icon và logo "Ấn ký" do GOI-11 làm | G03-T02, T04…T18; G11-T30, T31, T32 |
| Backend khoá học | Migration 381–385, 387, 388: sản phẩm, quyền, đơn, outbox (bốn thư đơn và thư "khoá đã mở đăng ký"), gửi qua Resend đã có trong repo; sổ lượt một kho chung và hàm giữ chỗ/chốt/hoàn; vòng đời lượt (hạn dùng; đăng ký lại thì chuyển toàn bộ lượt chưa dùng, bảo lưu tối đa 2 tháng — cấu hình mặc định 60 ngày; cấp thêm); chuyển lớp đang chạy bằng mã cũ sang đo lượt; API công khai và "của tôi"; API đơn; API admin; mã kích hoạt kèm số lượt; móc lượt vào chấm Speaking và Writing; một phiên mỗi tài khoản học viên và lần đăng nhập gần đây; thời hạn lưu (bài làm 45 ngày sau khi khoá hết hạn, bản ghi âm tối đa 60 ngày); chấm phát âm trên đoạn mẫu; yêu cầu xoá tài khoản và tải dữ liệu (G04-T18, spec 0100, migration 500 — phương án A (mặc định tạm 18/11, chờ anh Andy xác nhận)) | G04-T01…T13, T15…T18 (T14 đã bỏ) |
| Repo pha 1 | Dời tài liệu lịch sử; gom script; bỏ Tailwind thừa; gộp phần trùng AGENTS/CLAUDE | G01-T07…T15 |
| Mốc kiểm và cấu trúc mở đường | Ảnh chụp mốc; dải số migration; rà 30 spec dở; tách `routers/listening.py`; thí điểm gộp route group admin | G10 mục (a), (g), (f), (c), (d) |
| Backend admin | API danh bạ, hồ sơ, tìm nhanh, việc cần làm, gom lỗi; cài đặt và ngưỡng (440); phạm vi giáo viên theo lớp (441); nhóm đã lưu (443); kết quả bài giao (444); kỳ thi: người dự thi, chế độ `live`/`self_paced` (445–448); ghi chú chăm sóc (442); lô nhập (449–450) | G09-T03…T07, T22, T24, T25, T27, T31, T33, T35, T36 |
| Backend bổ sung (GOI-11) | Thông báo: bảng, API, job (470); trần chấm thử theo task, IP, ngân sách ngày (471, sau 440 của G09 và 371 của 0047); cổng chặn điện thoại (thư viện + màn chặn); trả điểm bài kiểm tra khoá: lược đồ, cổng máy chủ, API công bố, hẹn giờ (473, 474); renderer sơ đồ Grammar Wiki; thực thi spec chấm thử FREETRIAL-0047 (migration 371, `/api/trial/*`, màn `/trial/*` — G11-T14a, thêm 18/11 tối; việc đầu là kiểm nhánh/PR đã có) | G11-T08…T10, T14a, T14, T15, T19, T21…T24, T33, T34 |

Xong đợt B: hệ thống biết ai được học gì, đến khi nào, còn bao nhiêu lượt; có bộ component và khung trang để dựng mọi màn; đổi giao diện có ảnh chụp làm mốc; backend của thông báo, chấm thử, trả điểm bài kiểm tra và kỳ thi đã sẵn cho giao diện đợt C, D.

### Đợt C — Bề mặt mới cho người lạ và học viên (cần G03, G04)

| Việc | Gồm | Gói |
|---|---|---|
| Trang công khai và đăng ký | Trang chủ có lối chấm thử, `/courses`, `/courses/[slug]`; pháp lý, liên hệ; đăng nhập Google hoặc mã 6 số, có đường quay lại; giao diện "một phiên"; nhập mã kích hoạt của lớp; VietQR; đơn đăng ký và chờ xác nhận; "Báo cho tôi khi mở" và thư "khoá đã mở đăng ký"; đổi email đăng nhập; trang lỗi; SEO | G05 (22 nhiệm vụ còn hiệu lực) |
| Thư viện | Migration và script nhập 549 đề (ghi bản ghi lô); API; mẫu trang bài đọc; `/library`; bài mẫu Writing; kiến thức; Speaking và trình phát hai nguồn (nhãn "Giọng đọc tổng hợp"); ngữ pháp theo ba tờ GrammarWiki*; từ vựng; đánh dấu đã đọc/đã lưu; trang `/admin/library` | G06-T01…T03, T06…T11, T13…T18, T20 |
| Lõi học viên | Cờ `learner_v2`; đổi đường dẫn theo 9 đợt nhỏ; API Hôm nay; Hôm nay năm trạng thái; mở `/home` cho tài khoản chưa có khoá; Lộ trình; hub Luyện tập và Thi thử (đề tự chọn + mock test được giao); tài khoản, tiến độ, trợ giúp, lần đầu vào; bài giảng; phiếu kết quả; khối "Hết lượt chấm"; chấm lại có lý do; script nạp bài học khoá online và trang bài học thử; bài được giao, buổi học, trang xem lại bài làm theo tờ (thêm 18/11 tối: T28–T31) | G07 (32 nhiệm vụ) |
| Bổ sung phía học viên (GOI-11) | Chuông, thẻ quá hạn, trang Thông báo; cài đặt thư; các màn chấm thử sáu trạng thái; màn học viên của bài kiểm tra khoá; tên sáu khoá và nhãn "Đăng ký lại" | G11-T11, T12, T17, T27, T29 |

Xong đợt C: người lạ đọc Thư viện, chấm thử, xem khoá, đăng ký và chuyển khoản được; học viên có điều hướng 5 mục, việc hôm nay theo đúng trạng thái tài khoản, thông báo, lộ trình hai nhóm khoá, phiếu kết quả ba lối ra.

### Đợt D — Làm bài và vận hành (cần G03; phần lớn cần G07 hoặc G04)

| Việc | Gồm | Gói |
|---|---|---|
| Phòng thi và trình luyện | Khung chung; rồi lần lượt Reading → Writing → Listening luyện → Quick Check và flashcard → Listening test → Mock → Speaking. Mỗi trình một spec, một cờ, giữ trình cũ song song tới khi nghiệm thu. Thêm: mock test được giao phía học viên, "Abandon test" và màn hết giờ, đăng nhập lại trong phòng thi, Writing tự luyện giữ lượt; nối cổng chặn điện thoại; khung mới cho trang luyện kỹ năng, Sách bài tập, ngữ pháp, từ vựng, phát âm của học viên (G08-T26, thêm 18/11 tối) | G08 (26 nhiệm vụ); G11-T20 |
| Admin và giáo viên | Khung admin mới và sidebar 8 nhóm; danh bạ; hồ sơ học viên 5 thẻ; vùng nguy hiểm; mã kích hoạt; khoá và đơn đăng ký; cấp/thu hồi quyền; sổ lượt; hộp thư sự cố; chấm bài; tìm nhanh; khu giáo viên 5 mục; Cài đặt; thành phần giao bài; Kết quả một bài giao; trang Lớp; bảng công bố điểm; tổ chức kỳ thi và trang một kỳ thi; ba trang Nội dung; chấm Speaking thi thử; yêu cầu chấm lại; giáo viên và Gửi thông báo; Báo cáo; cấp lượt cho lớp cũ; nghiệm thu | G09-T08…T20, T23, T26, T28…T30, T32, T34, T37…T43; G11-T13, T16, T35 |
| Lưu cặp điểm AI–giáo viên (thêm 18/11, 00 điểm 24) | Spec SCOREPAIR-0088; migration 480 (ảnh chụp điểm AI, bảng cặp điểm chỉ ghi thêm); ghi cặp lúc trả bài, đối soát hằng đêm, dựng lại cặp cho bài đã trả. Chạy nền, chưa công bố. Làm ngay sau G09-T17. Khoảng 5 phiên | G12-C01…C03 |

Xong đợt D: mọi bài làm trong một khung thống nhất; admin xác nhận đơn, cấp quyền và lượt, chấm và duyệt bài, tổ chức kỳ thi và trả kết quả ở một nơi, xem một học viên ở một nơi.

### Đợt E — Dọn sau khi chuyển xong

| Việc | Gồm | Gói |
|---|---|---|
| Gỡ JS cũ | 6 đợt theo nhóm trang, mỗi đợt sau khi nhóm đó đã chạy giao diện mới | G10 mục (b) |
| Gộp hết route group admin | Các đợt còn lại sau thí điểm | G10 mục (d) |
| Media ra khỏi git | Theo kế hoạch 4 bước | G10 mục (e) |
| Chốt chuyển hướng | Đổi 307 thành 308, xoá cây trang cũ, gỡ giao diện làm bài cũ | G07-T24, G08-T21 |

## 3. Phụ thuộc

```
G02 ─────────────────────────────────────────► (độc lập)
G01 pha 0 ──► G01 pha 1 ──► G10
G01-T06 (sổ số migration) ──► mọi migration của G04, G05, G06, G07, G08, G09, GOI-11
G10(a) ảnh chụp mốc ──► PR giao diện lớn đầu tiên của G03, G07, G09
G03 ──► G05, G06, G07, G08, G09, GOI-11 (phần giao diện)
G03-T02 ──► G11-T32 (bộ 94 icon, thay G03-T03) ──► component G03 cần icon
G04 ──► G05 (đơn, quyền, API phiên), G07 (lượt, quyền), G08 (giữ lượt Writing tự luyện, cổng phiên),
        G09-T13…T15, T29 (đơn, quyền, lượt, mã kèm lượt), GOI-11 (outbox thư tuỳ chọn, sự kiện đơn,
        sổ lượt, has_ever_had_online_course)
G05-T18/T19 (mã 6 số) ──► G08-T24 (đăng nhập lại trong phòng thi); G05-T20 (màn một phiên) ──► G07-T17, G08-T24
G05-T21 (lối vào chấm thử) ◄── G11-T15 (public-config)
G07 (phiếu kết quả, khung tài khoản, khối "Hết lượt chấm") ──► G05 /account/orders, G08 nối phiếu
G07-T18/T19 (course_lessons) ──► lesson_count/chapters của G04 ──► trang khoá của G05
G07-T26 (mở /home cho tài khoản chưa kích hoạt) ──► G05 gỡ cờ tạm AVER_HOME_OPEN_TO_INACTIVE
G08-T24 (nguồn "bài có giờ") ──► services/timed_work.py của G04-T09
G09-T22 (migration 440: admin_settings_log) ──► G11-T14 (471), G11-T16 (thẻ Chấm thử)
G09-T24 (staff_scope) ──► G11-T13 (gửi thông báo của giáo viên), API công bố điểm của GOI-11
G09-T31 (người dự thi, live/self_paced) ──► G08-T22 (phía học viên) ──► G09 bật kỳ live nhiều lớp; G07-T16 (/tests)
G09-T36 (lô nhập) ──► script nhập của G06, G06-T20; G09-T08 (khung admin) ──► G06-T20 (mềm: chưa có thì đặt trong khung admin hiện có)
G07-T18 (course_lessons) + G09-T36 ──► G07-T28 (script nạp bài) ──► G09-T13 thẻ Chương trình; G07-T19 + T28 ──► G07-T29 (bài học thử)
G11-T02 (TRIALCAP duyệt) ──► G11-T14a (thực thi 0047, 371) ──► G11-T14, T15, T17
G04-T09 + G04-T04 ──► G04-T18 (xoá tài khoản, tải dữ liệu) ──► G07-T17 (khối "Dữ liệu của tôi")
G11-T09 (service nhắc) ──► nút "Gửi nhắc" của G09-T26…T29, T34
G11-T21…T23 (backend trả điểm) ──► G09-T30 (bảng công bố), G11-T27 (màn học viên)
G11-T33 (renderer sơ đồ) ──► trang bài Grammar của G06-T14
G04-T09 (một phiên) ──► G04-T16 (lần đăng nhập gần đây, 387) ──► G07-T17 (khối "Lần đăng nhập gần đây")
G05-T18/T19 + G04-T04 (learner_email.send_direct) + G04-T09 ──► G05-T24 (đổi email) ──► G07-T17 (gắn ChangeEmail)
G05-T22 (bảng course_open_alerts + fn_course_open_alerts_enqueue, 394) ◄──► G04-T17 (mẫu course_open_alert, bước sweep)
G04-T12 ──► G04-T15 (convert-class, 388) ──► G09-T43 (cấp lượt cho lớp cũ)
G09-T31 (self_paced_timeline: các phần chạy liền) ──► G08-T22
GOI-12 phần A (sổ lỗi, `services/error_book.py::today_block`, G12-A04) ──► khối "Lỗi đang lặp lại" của G07-T13, T14 (ẩn tới khi có dữ liệu)
G10(c) tách listening.py ──► G08-T14 (Listening test)
G10(d) thí điểm gộp group admin ──► G09-T08 trở đi
G08 Reading + Listening test ──► G08 Mock
```


Ba quy tắc thứ tự khi hai gói đụng cùng file:
- `frontend/public/js/aver-chrome.js`: G02-T09 → G07 → G09-T09 → GOI-11 (logo).
- `backend/routers/listening.py`: G10 mục (c) xong hẳn rồi G08 mới sửa.
- `next.config.ts` (chuyển hướng): mỗi lúc một PR; G07 xếp hàng các đợt đổi đường dẫn, G05 chỉ thêm `/pricing`.
- Trang admin hai gói cùng thêm phần: `/admin/settings` (G09-T23 và G11-T16), `/admin/notifications` (G11-T13 và G09-T40) — bên vào sau rebase, mỗi bên chỉ thêm thẻ/khối của mình.

## 4. Công và độ khó

Đơn vị: **phiên** = một agent làm trọn một nhiệm vụ kèm test, tới lúc mở PR. Không tính thời gian chờ anh duyệt spec, chờ review và chờ merge. Đây là ước lượng của người viết spec sau khi đọc mã, chưa có số đo thực tế.

| Gói | Nhiệm vụ còn hiệu lực | PR | Phiên | Độ khó (1–5) | Lý do độ khó |
|---|---|---|---|---|---|
| G01 | 15 | 15 | 16 | 2 | Việc cơ học; khó ở chỗ khoảng 27 test ghim câu chữ README migration |
| G02 | 15 | 16 | 16 | 2 | Sửa nhỏ; ba mục phải lần ra nơi tính điểm |
| G03 | 17 (T03 đã bỏ, thay bằng G11-T32) | 18 | 27 | 3–4 | Cùng tồn tại hai bộ CSS; test ghim thứ tự cascade và CSP; hai chế độ sáng/tối |
| G04 | 18 (T14 đã bỏ; thêm T15, T16, T17; T18 thêm 18/11 tối) | 19 | 32 | 5 | RLS, mã kích hoạt đang chạy, trừ lượt trong luồng chấm, đua đồng thời, cổng phiên ở mọi route học viên |
| G05 | 22 (T10, T17 đã bỏ; thêm T24) | 22 | 34 (33,5) | 4 | Đăng nhập bằng mã và đổi email (đường auth mới); cổng kích hoạt; VietQR; bốn bảng mới, năm migration |
| G06 | 20 | 20 | 34 | 4 | Nhập và rà 549 đề; CSP chặn YouTube; Speaking chờ nội dung từ repo VIDEO MAKING |
| G07 | 32 (T28–T31 thêm 18/11 tối) | 33 | 54 | 4 | Đổi đường dẫn vỡ nhiều test ghim; chuyển hướng không bật theo người được; mở cổng kích hoạt cho `/home` |
| G08 | 26 (T26 thêm 18/11 tối) | 38–39 | 49 | 4–5 | Kết thúc bài thi và lưu kết quả; ghi âm Speaking; mock test được giao và giữ lượt chạm backend đang chạy |
| G09 | 43 (44 dòng: T11 tách a, b; thêm T43) | 48 | 97 | 4 | 75 trang, 39 route group; đổi mô hình người dự thi của kỳ thi đang chạy; vùng thao tác nguy hiểm; 12 migration |
| G10 | 23 | khoảng 43 | 51 | 4–5 | Tách file 9.558 dòng có 71 file test bám; gỡ file đang được phục vụ công khai |
| GOI-11 | 31 (36 mã: T07, T18, T28 đã bỏ; T25, T26 hoãn; T14a thêm 18/11 tối) | 32 | 42 | 4–5 |
| GOI-12 (chỉ C01–C03, đợt D) | 3 | 3 | 5 | 4 | Ghi cặp điểm lúc trả bài ở hai đường trả bài; đối soát; dựng lại cặp cho bài đã trả | Đường chấm và quyền đọc bảng đáp án (phần E); sửa hàm giữ chỗ chấm thử có khoá đồng thời (phần B) |
| **Tổng** | **265** | **khoảng 307–308** | **khoảng 457** | | |

Cách lấy số: từng dòng chép từ bảng nhiệm vụ của chính gói đó rồi cộng lại (G01, G02, G10 không đổi so với bản 16/11); số nhiệm vụ đếm lại bằng `grep -c '^### G..-'` tối 18/11. **Tối 18/11 (rà soát chéo):** thêm 10 nhiệm vụ, 17 PR, khoảng 27 phiên — G04-T18 (2 PR, 4 phiên), G07-T28…T31 (5 PR, 9 phiên), G08-T26 (5 PR, 5 phiên), G11-T14a (2 PR, 4 phiên), và cộng G12-C01…C03 (3 PR, khoảng 5 phiên; đợt D theo điểm 24). Không tính G12-C: 262 nhiệm vụ, khoảng 304–305 PR, khoảng 452 phiên. So với bản sáng 18/11 (250 nhiệm vụ, khoảng 285–286 PR, khoảng 418 phiên): thêm 5 nhiệm vụ, 5 PR, khoảng 12 phiên do điểm 23 — G04 thêm T15 (chuyển lớp mã cũ, 2 phiên), T16 (lần đăng nhập, 1), T17 (thư khoá mở, 1) và tăng T10, T12 mỗi cái 1 phiên; G05 thêm T24 (đổi email, 2 phiên), T14 và T22 tăng 1,5 phiên; G09 thêm T43 (cấp lượt cho lớp cũ, 2 phiên). G06, G07, G08, GOI-11 đổi nội dung nhưng không đổi số. GOI-12: chỉ C01–C03 thuộc đợt D (3 nhiệm vụ, 3 PR, khoảng 5 phiên — đã cộng từ tối 18/11); phần còn lại (35 nhiệm vụ, khoảng 74 phiên) chờ anh mở. GOI-13 chưa tính. Nhiệm vụ ghi ĐÃ BỎ không tính; hai nhiệm vụ hoãn của GOI-11 (T25, T26: 2 PR, 3 phiên) không tính. So với bản 16/11 (185 nhiệm vụ, khoảng 213 PR, khoảng 289 phiên): tăng chủ yếu ở G09 (thêm 22 nhiệm vụ), GOI-11 (gói mới), G08, G07, G05. Số phiên của G11-T14, T15 lập trước khi có trả lời về trần chấm thử theo task/IP/chi phí và chưa được ước lượng lại.

**Dự kiến thời gian.** Không có căn cứ để hẹn ngày hay quy ra tuần: tốc độ phụ thuộc số phiên Claude Code chạy song song, tỉ lệ nhiệm vụ phải làm lại và thời gian anh duyệt, và chưa có số đo thực tế nào cho đợt này trên repo. Bảng trên là ước lượng, không phải cam kết. Hai điều đọc được từ bảng mà không cần giả định tốc độ:

- Chuỗi dài nhất không song song hoá được: spec nền được duyệt → G03 (27 phiên) → G07 (45 phiên) → G08 (44 phiên). Dù thêm phiên song song, chuỗi này vẫn quyết định ngày xong. G09 (97 phiên) dài nhất về công nhưng chia được cho nhiều phiên sau khi G03, G10(d), G04 xong phần liên quan.
- Điểm nghẽn nhiều khả năng là phía anh: khoảng 33 PR spec cần duyệt (G03 1, G04 2, G05 1, G06 1, G07 4, G08 8, G09 4, G10 6, GOI-11 6), khoảng 305 PR chờ chữ "merge", và các câu hỏi sản phẩm còn mở (mục 7).


Mốc dùng được sớm, không cần chờ hết: sau đợt A (lỗi gây mất tin đã sửa); sau G04 + G05 (đăng ký khoá online chạy được); sau G06 (Thư viện công khai); sau G04-T06 + G09-T29 (lớp offline nhận mã kèm lượt chấm); sau G04-T15 + G09-T43 (lớp đang chạy bằng mã cũ được chuyển sang đo lượt).

## 5. Chia việc cho người thực thi

Người thực thi là project Claude Code của repo averlearning.com (00 mục 2 điểm 23), chạy **một hoặc vài phiên song song**. Cách làm theo đúng `docs/AGENT_WORKFLOW.md` của repo (đã đọc ở `staging @ c3bc71574`); chỗ nào mục này khác file đó thì file đó thắng.

**Quy tắc cho mỗi phiên (theo `docs/AGENT_WORKFLOW.md`):**

1. Thứ tự đọc: nhiệm vụ anh Andy giao cho phiên → `AGENTS.md` gốc và hướng dẫn trong thư mục sẽ sửa → `README.md`, `CLAUDE.md` → `specs/README.md` và spec đã duyệt áp cho việc đó. Kế hoạch cũ dưới `docs/` chỉ là bằng chứng lịch sử. Mã, migration và test thật thắng mô tả trong gói; lệch thì báo, không tự định nghĩa lại yêu cầu đã duyệt.
2. Trước khi bắt đầu, từ bản checkout hiện có chạy `git status --short --branch`, `git worktree list --porcelain`, `git stash list`, `git remote -v`; `git fetch` rồi mới chọn gốc.
3. **Mỗi phiên một worktree riêng** đặt cạnh bản checkout chính, tên theo nhiệm vụ (để `git worktree list` cho thấy ai đang giữ), tạo từ `origin/staging`, nhánh `codex/<ten-nhiem-vu>`, PR vào `staging`. Bản checkout chính `~/code/ielts-speaking-coach` là mốc tích hợp dùng chung: không sửa, không commit, không đổi nhánh, không `git pull` ở đó. Thư mục anh em không phải worktree (`*-cleanup-*`, `*-hygiene-*`, `repo-archives/`) là bằng chứng khôi phục: không sửa, không xoá.
4. Giữ nguyên thay đổi có sẵn, file chưa theo dõi, stash và commit chỉ có ở máy; không `reset`, `clean`, ghi đè cho tiện.
5. Một phiên làm một nhiệm vụ, ra một PR (nhiệm vụ ghi "2 PR" thì hai PR nối tiếp trong cùng phiên hoặc hai phiên nối tiếp, không song song). Ghi chú công việc nằm trong `tasks.md` / `verification.md` của spec, hoặc trong PR khi `Spec: N/A`. Khi dừng hoặc chuyển phiên, bàn giao ghi: checkout, nhánh, PR, SHA mới nhất, kết quả kiểm, việc còn lại, điều đang chặn.
6. Kiểm ở máy từ chính worktree đó (không gõ đường dẫn cứng của checkout chính): test hẹp trước, rồi bộ đầy đủ của tầng bị ảnh hưởng theo mục "Local verification" (lệnh chép ở 00 mục 5). Cài cổng pre-push bằng `./scripts/hooks/install.sh`. CI là cổng kiểm, không phải vòng lặp thử: giữ mốc rà lại sau vòng 3 và giới hạn 5 vòng của `AGENTS.md`. Không gọi AI trả phí (`--run-smoke`) khi chưa được phép; test bị bỏ qua không phải bằng chứng đã đạt — báo số test bỏ qua.
7. Cần ảnh xem trước giao diện: thêm `[preview]` vào thông điệp commit cuối được đẩy (head) hoặc dùng nhánh `preview/<slug>`.
8. Báo cáo tách bốn trạng thái: bản vá (nhánh, SHA, kết quả kiểm ở máy) · tích hợp (PR đã merge, CI ở đúng SHA của `staging`) · production (chỉ khi anh yêu cầu) · yêu cầu của spec đã có bằng chứng. Mẫu báo cáo ở 00 mục 8.
9. Xong việc: chỉ gỡ worktree của chính nhiệm vụ đó khi nó sạch, công việc khôi phục được và anh cho phép; trước `git worktree prune`/`remove` xác nhận đường dẫn thật sự đã mất.
10. **Số phiên song song do anh Andy mở.** `docs/AGENT_WORKFLOW.md`: chỉ giao việc cho agent khác khi người dùng yêu cầu rõ. Một phiên không tự sinh thêm agent con để làm song song, trừ khi anh nói; quyền được cấp cho một nhiệm vụ không kéo sang việc khác.

**Luồng theo vùng mã.** Luồng là hàng đợi nhiệm vụ đụng cùng một vùng mã. Mỗi lúc **tối đa một phiên trên một luồng**; hai phiên ở hai luồng khác nhau chạy song song được.

| Luồng | Thứ tự việc | Vùng mã |
|---|---|---|
| L1 Repo | G01 → G10 (a), (g), (f) → (c) → (d) → (b), (e) | `docs/`, `specs/`, `backend/routers`, `frontend/app/(admin-*)` cấu trúc |
| L2 Backend khoá học | G04 (T00 → T01 → T02 → T03 → T04, T05, T06 → T07, T08 → T09 → T16 → T10 → T12 → T15, T17 → T13 → T18 → T11) → G09 backend (T03…T07, T22, T24, T25, T27, T31, T33, T35, T36) → GOI-11 backend (A, B — T14a trước T14 —, E) → hỗ trợ API cho G05, G07 | `backend/`, `backend/migrations/` |
| L3 Nền giao diện và học viên | G03 (+ G11-T30…T32 logo, icon) → G07 → GOI-11 giao diện học viên (T11, T12, T17, T27) | `frontend/components/ui/`, khung trang, `frontend/app` học viên |
| L4 Công khai và Thư viện | G02 → G06 nội dung → G05 (T18, T19 trước T24; T22 sau migration 381) → G06 mã | trang công khai, `/library`, script nhập, `backend/routers/auth.py` (phần mã đăng nhập, đổi email) |
| L5 Làm bài và admin | G08 lib và component (sau G03) → G09 giao diện (+ G11-T13, T16; T43 sau G04-T15) → G08 các trình và T22–T25 | trình làm bài, `frontend/app` admin |

- **Một phiên:** đi theo các đợt A → E ở mục 2; trong một đợt theo thứ tự L2, L3, L1, L4, L5 (backend và nền giao diện mở đường cho phần còn lại). Trong lúc một PR chờ duyệt hoặc chờ chữ "merge", phiên làm nhiệm vụ độc lập kế tiếp ở worktree khác, không ngồi chờ.
- **Hai hoặc ba phiên:** ưu tiên L2 và L3 chạy song song từ đợt A (soạn spec G04 và G03); phiên thứ ba lấy L4 (G02 trước) rồi L1. L5 chỉ mở khi G03 đã có khung và component.
- **Bốn hoặc năm phiên:** mỗi luồng một phiên. Nhiều hơn năm không có lợi: các luồng đã chạm trần phụ thuộc ở mục 3.
- **File dùng chung giữa hai luồng** (`frontend/public/js/aver-chrome.js`, `next.config.ts`, `backend/routers/listening.py`, `backend/routers/auth.py`, `backend/services/owner_alerts.py`, sổ đăng ký số migration): theo thứ tự ở cuối mục 3; nhiệm vụ đứng trước trong bảng phụ thuộc làm trước, phiên sau rebase; không sửa song song cùng file. `owner_alerts.py` chỉ G04-T04 sửa (mở rộng `send_via_resend`), các gói khác gọi qua `services/learner_email.py`.
- **Số migration và số spec:** lấy theo bảng mục 6 và ghi vào sổ đăng ký trong repo (G01-T06) trong chính PR dùng số đó; hai phiên cùng cần số thì phiên mở PR sau lấy số kế tiếp trong dải của gói mình.

**Giao việc theo độ khó:**
- Độ khó 1–3: một phiên làm theo đúng gói.
- Độ khó 4: một phiên làm; trước khi trình anh, PR có một lượt review độc lập (một phiên khác không viết mã đó, hoặc người).
- Độ khó 5 (G04-T01, T02, T07, T12; G08-T18, T22, T25; G09-T31; G11-T14a, T14, T21, T22; G10 tách `listening.py`): dùng model mạnh nhất; phần lõi (migration, hàm RPC, thứ tự route) được review độc lập trước khi viết phần còn lại; phiên giám sát (phiên soạn bộ spec này) đọc PR trước khi trình anh.

Mỗi phiên báo cáo theo mẫu ở `00-QUY-UOC-CHUNG.md` mục 8. Theo quyết định 18/11: người thực thi làm trước; khi anh Andy báo sẵn sàng thì bàn giao (`BAN-GIAO.md`); sau đó có giám sát tiến độ và tiếp quản nếu cần.

## 6. Bảng cấp số và các phân xử giữa các gói

Các gói được viết song song nên có vài chỗ chồng nhau. Phân xử dưới đây thắng nội dung trong từng gói; `00-QUY-UOC-CHUNG.md` mục 2 thắng phân xử này.

**Anh Andy là người duy nhất vận hành repo; bảng này là sổ cấp số.** "Leader" trong tài liệu migration của repo chính là anh Andy (00 mục 2 điểm 22). Người thực thi lấy số theo bảng, kiểm số chưa bị file nào trên `staging` hay PR đang mở dùng, rồi ghi số đã dùng vào sổ đăng ký trong repo; không tự nhảy số, không lấy số ngoài dải.

**Số spec (0049, 0051, 0053 đang bị PR khác giữ):**

| Số | Mã | Gói |
|---|---|---|
| 0055 | COURSEACCESS | G04 |
| 0056 | UIBASE | G03 |
| 0057 | TESTPOLICY | G10 (a) |
| 0058 | MIGNUM | G10 (g) |
| 0059 | PUBLICSITE | G05 |
| 0060 | ENROLL | G05 |
| 0061 | LIBRARY | G06 |
| 0062–0065 | LEARNERNAV, LEARNERCORE, COURSELESSON, RESULTSHEET | G07 |
| 0066–0073 | EXAMROOM, EXAMREAD, EXAMWRITE, EXAMLISTENP, EXAMLISTENT, EXAMMOCK, EXAMSPEAK, EXAMDRILL | G08 |
| 0074 | ADMINIA | G09 |
| 0075–0078 | LEGACYJS, BACKENDSPLIT, ADMINGROUP, MEDIAOUT | G10 |
| 0079 | NOTIFY | GOI-11 phần A |
| 0080 | TRIALCAP (sửa đổi FREETRIAL-0047) | GOI-11 phần B |
| 0081 | PHONEGATE | GOI-11 phần D |
| 0082 | COURSETESTRELEASE | GOI-11 phần E |
| 0083 | BRANDMARK | GOI-11 phần G |
| 0084 | GRAMMARFIG | GOI-11 phần G |
| 0085 | CLASSRESULT (kết quả một bài giao) | G09-T21 |
| 0086 | MOCKORG (tổ chức kỳ thi) | G09-T21 |
| 0087 | CONTENTBATCH (lô nhập và câu cần kiểm) | G09-T21 |
| 0088 | SCOREPAIR (lưu cặp điểm AI – giáo viên bất biến) | GOI-12 phần C, C01–C03 |
| 0089 | ERRORBOOK (sổ lỗi cá nhân, bản ngữ pháp) | GOI-12 phần A |
| 0090 | REWRITE (viết lại sau khi chấm) | GOI-12 phần B |
| 0091 | SCOREGAP (công bố độ lệch AI – giáo viên) | GOI-12 phần C, C04–C08 |
| 0092 | PLACEMENT (kiểm tra đầu vào) | GOI-12 phần D |
| 0093 | WEEKLYPLAN (kế hoạch và thư nhắc theo tuần) | GOI-12 phần E |
| 0094 | REVIEWPACK (gói giáo viên chấm) | GOI-12 phần F |
| 0095 | TESTIMONIAL (nhận xét và khảo sát sau khoá) | GOI-13 phần A (sửa 18/11 theo GOI-13) |
| 0096 | GRAMMAREDIT (biên tập Grammar Wiki; sửa đổi GRAMMARFIG-0084) | GOI-13 phần B (sửa 18/11 theo GOI-13) |
| 0097 | TOPICKNOW (Kiến thức nền) | GOI-13 phần C (sửa 18/11 theo GOI-13) |
| 0098 | CLOSEREAD (Đọc kỹ) | GOI-13 phần D (sửa 18/11 theo GOI-13) |
| 0099 | EXAMKIT (khuôn luyện đề) — chỉ giữ số, hoãn, chưa viết | GOI-13 phần E (sửa 18/11 theo GOI-13) |
| 0100 | ACCOUNTDATA (yêu cầu xoá tài khoản và tải dữ liệu) | G04-T18 (cấp tối 18/11 theo rà soát) |

Số 0085–0087 cấp ngày 18/11/2026; trước đó chưa file nào trong bộ tài liệu dùng. Từ 18/11 (sửa theo GOI-13): 0088–0094 giữ cho GOI-12, 0095–0099 cấp cho GOI-13; tối 18/11: 0100 cấp cho G04-T18; số kế tiếp còn trống: 0101.

**Dải số migration (số cao nhất hiện tại trong repo là 380; các số 370–375 đang bị giữ, 371 thuộc spec 0047). Migration số nhỏ không được phụ thuộc đối tượng do migration số lớn tạo.**

| Gói | Dải đã cấp | Đang dùng (18/11) | Ghi chú |
|---|---|---|---|
| G04 | 381–389 | 381–385, **387** (`learner_login_events`, G04-T16), **388** (`fn_credit_convert_class`, G04-T15) | 386 để trống (G04-T14 đã bỏ); 389 dự phòng của gói. Vòng đời lượt mới (chuyển toàn bộ, bảo lưu 60 ngày) nằm trong 381–383, không thêm số |
| G05 | 390–399 | **390** `contact_messages` (T07) · **391** `login_code_state` và ba hàm (T18) · **392** đổi ngưỡng `fn_activate_attempt_check` thành 5 lần / 15 phút (T09) · **393** `account_email_changes` (T24) · **394** `course_open_alerts` và `fn_course_open_alerts_enqueue` (T22) | 394 sau 381 (trỏ `course_products`, ghi `learner_email_outbox`); 395–399 dự phòng của gói |
| G06 | 400–419 | một migration bảng Thư viện | — |
| G07 | 420–439 | `course_lessons`, chấm lại có lý do | `course_lessons` sau 381 |
| G09 | 440–459 | **440–451** | 452–459 dự phòng của gói |
| G08 | 460–469 | chỉ khi T23 cần cột trạng thái "bỏ bài" | — |
| GOI-11 | 470–479 | 470, 471, 473, 474 | 472 không dùng; 475, 476 hoãn cùng G11-T25, T26; 471 phụ thuộc 440 (bảng `admin_settings_log` của G09) và 371 |
| GOI-12 | 480–489 | 480 `writing_score_pairs` · 481 `error_book` · 482 `writing_rewrites` · 483 `score_gap_reports` · 484 `placement_tests` · 485 `weekly_plans` · 486 `weekly_plan_messages` · 487 `review_pack_products` · 488 `review_pack_queue` · 489 `writing_blind_review` | Dùng đủ 10 số, không còn dự phòng; 489 chỉ dùng nếu làm C08 (chấm mù). Bản Writing của sổ lỗi sau này phải xin số mới |
| GOI-13 | 490–499 | **490** nhận xét và khảo sát · **491** loại thông báo khảo sát (có điều kiện: chỉ khi 470 đã merge, nếu chưa thì thêm thẳng vào G11-T08) · **492** Kiến thức nền · **493** đoạn viết ngắn · **494** Đọc kỹ | 495–496 giữ cho khuôn luyện đề (E), chưa áp; 497–499 dự phòng của gói (sửa 18/11 theo GOI-13) |
| Dự phòng | 500 trở đi | **500** `account_data_rights` (G04-T18, cấp tối 18/11: dải 381–389 không còn số — 386 để trống có chủ ý, 389 giữ cho phần chênh của 381/382) | 501 trở đi còn trống |

**Phân xử:**

1. **Bảng email cho học viên** chỉ có một: `learner_email_outbox`, do G04-T01 tạo và G04-T04 gửi. Thư về đơn là **bốn thư** (`order_created`, `order_pay_reminder`, `order_needs_info`, `order_confirmed`), đều do G04 gửi; G05-T14 không tạo migration email, chỉ hoàn thiện câu chữ và bản HTML; GOI-11 không còn nhiệm vụ nào về thư đơn (G11-T07, T18 đã bỏ, migration 472 không dùng). Thư mã đăng nhập không qua outbox (G05-T18). **Cập nhật chiều 18/11:** nhà cung cấp là Resend đã có trong repo (`backend/services/owner_alerts.py`, `RESEND_API_KEY`; hiện chỉ gửi thư báo chủ dự án từ `alerts@averlearning.com`); G04-T04 dựng `services/learner_email.py` dùng lại `send_via_resend` (mở rộng người gửi, người nhận, HTML). Thêm mẫu thứ năm đi qua outbox: `course_open_alert` (thư "khoá đã mở đăng ký": G05-T22 tạo bảng và hàm xếp thư, G04-T17 thêm mẫu và bước sweep, G05-T14 viết câu chữ; một người một khoá một thư). Thư báo đổi email (`email_changed_notice`, G05-T24) gửi ngay bằng `learner_email.send_direct`, không qua outbox. Mã đăng nhập và mã đổi email: G05 đề nghị đường A (OTP của Supabase Auth, SMTP của Supabase trỏ vào Resend) — mục 7 câu 33.
2. **Bảng `course_lessons`** thuộc G07 (spec COURSELESSON), tạo sau G04-T01 vì trỏ tới `course_products`. G07-T19 cấp `lesson_count` và `chapters` cho API khoá công khai của G04 qua điểm ghép `_outline_for`.
3. **"AI chấm, trả ngay" cho Writing** là hành vi mới, do G04-T08 làm; Writing tự luyện gọi hàm giữ lượt của G04 từ route của G08-T25. Speaking luôn AI chấm và trả ngay, kể cả lớp offline; chỉ Writing của lớp offline chờ giáo viên duyệt; Speaking thi thử do giáo viên chấm từ bản ghi, không trừ lượt. G07 chỉ hiển thị dòng "Nguồn chấm"; G09 chỉ dựng hàng chờ duyệt.
4. **Người đăng ký online không có mã kích hoạt:** xác nhận đơn là kích hoạt tài khoản (G04, cùng giao dịch). Tài khoản chưa có khoá đăng nhập xong về Hôm nay trạng thái "Chưa có khoá": G07-T26 mở `/home`, trang lần đầu và `GET /api/student/today` cho tài khoản `is_active=false`; tới lúc đó G05 dùng cờ tạm `AVER_HOME_OPEN_TO_INACTIVE` và đích tạm `/courses`. Khung công khai và `/library` của G05, G06 không dùng cổng kích hoạt.
5. **Nhúng YouTube:** CSP production hiện chặn. G06-T13 mở `frame-src` cho đúng các trang cần; G07-T19 dùng lại, không mở thêm.
6. **Cờ bật giao diện mới:** `AuthedShell design="v2"` (G03, theo trang) · `learner_v2` (G07, theo người) · `ADMIN_FRAME_V2` (G09) · `AVER_PUBLIC_COMMERCE`, `email_code_login` (G05) · cờ theo từng trình của G08 · `mock_exam_audiences_learner` (G08-T22/G09-T31) · `notifications_enabled`, `free_trial_enabled` (GOI-11) · `credit_metering`, `enrollment_orders`, `single_session_learners`, `pron_sample_window` (G04). Chuyển hướng URL không gắn cờ được nên dùng 307 trong giai đoạn chuyển, chốt 308 ở đợt E.
7. **Đường dẫn đã có chủ:** `/practice` đang tồn tại trong `(authed-practice)`; `/vocabulary/[slug]` là route động nên G06 không đặt trang con tên `flashcards`, `fill-in`, `quick-check` trùng với đích chuyển của G07; `/admin/access-codes` đã là chuyển hướng nên G09 dùng `/admin/activation-codes`.
8. **Tiền tố API:** theo mã hiện có. Router admin dùng `/admin/...`, không có `/api`.
9. **Số liệu kho bài mẫu Writing:** thực tế là 479 đề Task 2 và 70 đề Task 1. Con số "546 Task 2, 3 Task 1" trong tài liệu cũ và trên tờ thiết kế là sai; dùng số thật.
10. **Câu chữ:** các tờ thiết kế đã được sửa về "giáo viên", "Đơn đăng ký", "Khoá học và đăng ký". Nếu còn sót chữ cũ, `00-QUY-UOC-CHUNG.md` mục 3 thắng tờ thiết kế.
11. **Số dư lượt chấm AI** là một kho chung cho Writing và Speaking, tính theo quyền khoá, tách theo nguồn online / lớp (G04). Mã kích hoạt của lớp kèm số lượt chấm; hết lượt thì admin cấp thêm (`grant-extra`). Lượt chưa dùng (00 mục 2 điểm 23): đăng ký lại thì chuyển toàn bộ sang kỳ mới, bảo lưu 60 ngày (`CREDIT_CARRY_PERCENT`=100, `CREDIT_CARRY_VALID_DAYS`=60; trường API `credit_carry_percent`, `credit_carry_valid_days`, `credits.carry_balance`, `credits.carry_expires_at`); không đăng ký lại thì hết hiệu lực khi khoá hết hạn; lượt lớp offline không chuyển. Chấm thử miễn phí **không** gộp vào sổ lượt (GOI-11 phần B dùng bảng riêng của 0047).
12. **Tên nguồn cấp quyền luyện lại** dùng tên của G04; chỗ G09 gọi `class_practice` đổi theo G04.
13. **Nhãn trạng thái đơn đăng ký ở admin:** Chờ chuyển khoản · Đã báo chuyển · Cần bổ sung · Đã xác nhận · Hết hạn · Đã huỷ (theo tờ `AdminDonDangKy`). Chỗ G09 ghi "Chờ xác nhận", "Đã mở khoá" đổi theo bộ này.
14. **Trạng thái "Lưu trữ" của khoá:** đã có ở G04 bản 18/11 (`archived_at`, `POST /admin/course-products/{id}/archive`); G09-T13 dùng.
15. **Các gói viết trước khi có tờ Đợt 4 và 5:** chỗ nào G07, G08, G09 ghi "chờ tờ thiết kế" thì nay dùng tờ tương ứng trong `thiet-ke/` (ví dụ G07-T25 dùng `HubKyNang`, `LuyenTap`, `DanhSachDe`).
16. **Bảng công bố điểm bài kiểm tra khoá:** giao diện thuộc G09-T30 (tờ KiemTraKhoaGiaoVien); backend (migration 473, 474, API công bố, `tally` mở rộng) thuộc GOI-11 T21–T24; màn học viên thuộc G11-T27. G11-T28 đã bỏ.
17. **Lối vào chấm thử** ở trang chủ và menu công khai thuộc G05-T21; các màn `/trial/*`, trần và trạng thái thuộc GOI-11 phần B; mã của spec FREETRIAL-0047 (migration 371, `/api/trial/*`) thuộc G11-T14a (thêm tối 18/11); khối "Chấm thử miễn phí đề này" ở trang bài mẫu và trang đề Speaking thuộc G06-T10, G06-T13. Tài khoản đăng nhập bằng mã email được chấm thử như tài khoản Google; người từng có khoá online không được chấm thử (kiểm bằng hàm của G04).
18. **Mock test** chỉ có khi được giao: G09 (T31–T34) tổ chức kỳ thi và trả kết quả; G08-T22 làm phía học viên (đọc danh sách người dự thi, `live`/`self_paced`, từng phần, một lần); G07-T16 dựng khối "Mock test được giao" ở `/tests`. Đề tự chọn chỉ có full test từng kỹ năng và mini test. Overall band chỉ ở mock test được giao. Mock test được giao không trừ lượt, cả Writing lẫn Speaking (mặc định tạm 18/11, chờ anh Andy xác nhận; GOI-04 5.6; tờ MockTestDuocGiao, ThiThu ghi khác thì gói thắng).
19. **Nhật ký cài đặt** `admin_settings_log` chỉ có một bảng, do migration 440 của G09-T22 tạo; thẻ Chấm thử của GOI-11 ghi vào bảng đó (471 không tạo bảng cùng tên).
20. **Phạm vi "giáo viên của lớp"** chỉ có một cách xác định: `services/staff_scope.py` của G09-T24 (`cohorts.instructor_id`, migration 441); **mỗi lớp đúng một giáo viên** (00 mục 2 điểm 23), không có bảng nhiều giáo viên; GOI-11 (gửi thông báo, công bố điểm) dùng lại.
21. **Trang `/admin/library`** thuộc G06 (G06-T20); G09 chỉ đặt mục sidebar. Script nhập của G06 ghi bản ghi lô qua helper của G09-T36.
22. **Bộ icon:** 94 icon nét 2 của tờ ThanhPhanNenTang, do G11-T32 dựng; G03-T03 đã bỏ.
23. **"Lần đầu vào"** (tờ TroGiupLanDau) thuộc G07-T17, thay `/onboarding` và màn chào `/welcome` đã bỏ của G05. **Không có** ô hỏi hay công tắc "đồng ý dùng bản ghi âm" ở bất kỳ gói nào: tính năng đã bỏ khỏi đợt này (00 mục 2 điểm 22); bản ghi âm giữ tối đa 60 ngày rồi xoá.
24. **Một phiên mỗi tài khoản học viên:** backend ở G04-T09; ba màn 8a–8c và hộp "Đăng xuất khỏi mọi thiết bị" ở G05-T20 (G07 gắn vào Hồ sơ, G08 dùng trong phòng thi); G08-T24 cấp nguồn "bài có giờ" để máy chủ không cho chiếm phiên khi đang làm bài có giờ. "Lần đăng nhập gần đây": bảng `learner_login_events` và `GET /api/account/login-events` ở G04-T16 (không lưu địa chỉ IP), giao diện ở G07-T17.
25. **Đổi email đăng nhập** (thêm chiều 18/11): backend và thành phần `ChangeEmail` ở G05-T24 (`POST /auth/email-change/request`, `/verify`; mã gửi tới email mới, thư báo về email cũ; bảng `account_email_changes`); G07-T17 chỉ gắn thành phần vào Hồ sơ.
26. **Lớp đang chạy bằng mã cũ** (thêm chiều 18/11): CÓ chuyển sang đo lượt. API và RPC ở G04-T15 (`GET /admin/credits/convert-class/pending`, `…/preview`, `POST /admin/credits/convert-class`; gợi ý số từ `LEGACY_CLASS_INITIAL_CREDITS`); hộp thao tác ở G09-T43; lớp chưa được chuyển thì thành viên dùng mã cũ chưa bị đo.
27. **Kỳ thi `self_paced`** (thêm chiều 18/11): đã bắt đầu thì các phần chạy liền nhau, không nghỉ giữa các phần. Hợp đồng đồng hồ một chỗ: GOI-09 mục 5.5 và hàm `services/mock_exam_modes.py::self_paced_timeline` của G09-T31; G08-T22 dùng lại; G07-T16 chỉ hiện câu báo trước.
28. **Thời hạn xem bài làm** (thêm chiều 18/11): 45 ngày sau khi quyền khoá cuối cùng hết hạn (`RETENTION_CONTENT_DAYS_AFTER_EXPIRY`, trường `content_visible_until` của G04-T10); bản ghi âm vẫn tối đa 60 ngày kể từ lúc ghi. G05, G07, G08, G09 chỉ đọc trường này.
29. **"Lỗi đang lặp lại"** (thêm chiều 18/11): nguồn là "Sổ lỗi cá nhân" của GOI-12 (đã viết; hàm `today_block`, G12-A04). G07 nối `_repeat_error_for` vào `services/error_book.py::today_block` (GOI-12 K2); G07 giữ khung `repeat_error` và một hàm ghép; khối ẩn tới khi API sổ lỗi có dữ liệu. Không gói nào khác tự tổng hợp lỗi.
30. **Kiến thức nền, Đọc kỹ, khuôn luyện đề** (thêm chiều 18/11): prototype; spec và nhiệm vụ ở GOI-13 (TOPICKNOW-0097, CLOSEREAD-0098; EXAMKIT-0099 hoãn), phần C, D, E. Đã chốt: Kiến thức nền mở công khai, thuộc Thư viện, đoạn viết ngắn tính 1 lượt (`feature='short_writing_feedback'` của G04); Đọc kỹ gắn theo 20 mô đun, chưa có AI nhận xét. G06 chỉ giữ chỗ kệ (FR-06-005b).
31. **Nhận xét học viên** (thêm chiều 18/11): hiện ở trang sáu khoá online, không ghi là của lớp offline. Khối "Học viên nói gì", trang `/hoc-vien-noi-gi` và trang admin `/admin/surveys` do GOI-13 phần A dựng (G13-A09, A10); G05 để chỗ, G09 đặt mục sidebar "Chưa mở" tới khi phần A được mở.

**Chỗ còn lệch, chưa phân xử được (bản chiều 18/11; mỗi chỗ đã ghi ở mục 10 của gói liên quan):**

Đã hết lệch từ bản sáng 18/11: (a), (b) GOI-04 mục 10 Q1, Q2 đã sửa theo 00; (c) "Lần đăng nhập gần đây" → G04-T16, G07-T17; (e) mock test tự làm → không nghỉ giữa các phần (phân xử 27); (g) thư "khoá đã mở đăng ký" → G04-T17, G05-T22; (k) đổi email → G05-T24. Tối 18/11: (j) tên hàm theo GOI-12 K2 (`services/error_book.py::today_block`, G12-A04; G07 vẫn ẩn khối tới khi GOI-12 được mở); (m) → GOI-13 phần A (G13-A09, A10); (n) đã sửa ở 00.

| # | Chỗ lệch | Gói | Mặc định tạm |
|---|---|---|---|
| d | Trang Gửi thông báo: G09 muốn "Nhóm theo điều kiện"; GOI-11 chỉ có ba kiểu người nhận (lớp, danh sách, tất cả) | G09, GOI-11 | Không làm; G09 đẩy danh sách đã lọc (GOI-11 mục 10 câu 25) |
| f | Writing tự luyện của người đăng ký online chưa có hồ sơ `students` (G04 để G08 quyết) | G04, G08 | Route chạy theo `user_id` (GOI-08 mục 10 câu 14) |
| h | Giáo viên có được "Cấp thêm lượt" và chạy "Cấp lượt cho lớp cũ" cho lớp mình không (00 điểm 20 ghi "giáo viên/admin"; tờ AdminLop ghi giáo viên không thao tác quyền) | G04, G09 | Chỉ admin (mặc định tạm 18/11, chờ anh Andy xác nhận); 00 điểm 20 đã sửa theo (GOI-04 Q5; GOI-09 Q32) |
| i | Thẻ Thanh toán của Cài đặt: sửa tài khoản nhận tiền trên web hay giữ biến môi trường | G04, G09 | Thẻ chỉ đọc (GOI-09 Q20) |
| l | Các tờ thiết kế còn vẽ theo cách cũ (đối chiếu 18/11 tối; ThiThu, TrangKhoaHoc, EmailMau thư 7, 8, MockTestDuocGiao, TrangChuCongKhai và công tắc ghi âm ở TaiKhoan đã sửa): TaiKhoan còn cột "nơi gần đúng" (câu 40); tờ nghe một lần (BaiTapListening, ThanhPhanHocTap) ghi "không tạm dừng được" ở chế độ luyện; ThanhPhanKhungTrang che bài khi xoay hẹp | thiet-ke | 00 thắng; gói ghi khác biệt trong PR |
| o | `/auth/activate` với mã chính tài khoản đó đã dùng: repo hiện trả 400 kèm chuỗi `detail`, không có `error_code`; mã `already_used_by_you` chỉ có ở route xem trước của G05 | G04, G05 | Giữ hành vi repo ở route kích hoạt; G05 hiện câu riêng từ route xem trước |
| p | Lượt lớp có dùng được cho bài tự luyện ngoài bài giao không (thiết kế `charge_plan` của G04 đang cho; 00 chỉ ghi "bài của lớp dùng lượt đó") | G04 | Cho dùng (GOI-04 Q21) |
| q | Ẩn bài Writing sau 45 ngày: hôm nay chỉ Speaking có cơ chế thời hạn; G04-T10 thêm ẩn ở tầng đọc cho Writing (không xoá); Reading, Listening không áp | G04 | Như G04-T10 (GOI-04 Q20) |

### GOI-11 (thêm ngày 17/11/2026, khớp chéo 18/11/2026)

- `GOI-11-bo-sung-quyet-dinh-20261117.md` (cập nhật chiều 18/11: một lớp một giáo viên, câu về lượt chuyển trong thư "khoá sắp hết hạn", gửi thư qua Resend — không đổi số): 36 mã nhiệm vụ (T14a thêm tối 18/11: thực thi spec 0047), còn hiệu lực đợt đầu 31 (T07, T18, T28 đã bỏ vì việc nằm ở G04 và G09; T25, T26 hoãn theo trả lời của anh Andy), 32 PR, khoảng 42 phiên — đã cộng vào bảng mục 4. Sáu phần còn việc: thông báo trong ứng dụng, trần chấm thử miễn phí, chặn full test trên điện thoại, trả điểm bài kiểm tra khoá (backend và màn học viên), tên khoá và nhãn "Đăng ký lại", nhận diện và sơ đồ Grammar Wiki. Phần C (thư về đơn) không còn nhiệm vụ.
- Không còn quy tắc "GOI-11 thắng": thân các gói G03–G09 đã được đưa về cùng nội dung ngày 18/11; mỗi gói có dòng "Khớp chéo ngày 18/11/2026" ở đầu file.
- Phát hiện an toàn dữ liệu cần xử lý trong phần E: học viên hiện đọc được `is_correct` trực tiếp từ `quiz_attempts` / `quiz_sessions` qua Supabase (chính sách SELECT ở migration 119). Chưa kiểm trên staging.


## 7. Quyết định cần anh Andy

Mỗi gói có danh sách riêng ở mục 10 của gói; câu nào cũng có đề xuất và mặc định tạm để người thực thi không bị chặn. Mục này tách hai phần: câu đã có trả lời (không hỏi lại; giữ số cũ để dẫn chiếu) và câu còn mở. Cập nhật chiều 18/11 theo 00 mục 2 điểm 23.

### 7.1 Đã có trả lời (không hỏi lại)

| # | Câu | Trả lời (00 mục 2) |
|---|---|---|
| 1 | Duyệt 6 tờ Thành phần và các tờ Đợt 4, 5 | Đã duyệt 17/11 ("Duyệt Canva: anh duyệt rồi"; "canvas đã xem, không có góp ý lớn"); tờ Đợt 6 và tờ vẽ sau vẫn là bản nháp (00 mục 6). G03 không còn chờ duyệt tờ |
| 41 | Khối "Học viên nói gì" và trang "Khảo sát và nhận xét" | GOI-13 phần A (G13-A10 trang công khai, `/admin/surveys`); GOI-13 nằm ngoài đợt A–E, chỉ làm khi anh mở; câu còn mở: có làm phần A trước mở bán không (`04` mục "Cập nhật 18/11 tối", câu 2) |
| 2 | Spec 0049 và G09: bên nào làm chuẩn | G09 làm chuẩn; phần giao bài của 0049 chỉ giữ nếu không trùng (điểm 20) |
| 3 | Ai cấp số spec và số migration; ai thực thi; tiền tố nhánh | Anh Andy là người duy nhất vận hành repo, số theo bảng mục 6 (điểm 22). Thực thi: project Claude Code của repo averlearning.com (điểm 23). Nhánh `codex/<ten-nhiem-vu>` theo `docs/AGENT_WORKFLOW.md` và 00 mục 4 |
| 4 | Nới quy tắc "đường dẫn lịch sử giữ nguyên" | Nới thành "giữ khi còn được tham chiếu" (điểm 20) |
| 5 | "Giáo viên" hay "giảng viên" | "Giáo viên" mọi nơi (00 mục 3) |
| 6 | Một lượt chấm AI là gì; chung hay tách kho | Một kho chung. Writing 1 bài = 1 lượt; Speaking 1 bài Part 2, hoặc 1 cụm 2–3 câu Part 1 hay Part 3 = 1 lượt; full test Speaking mô phỏng = 3 lượt; **full test Writing = 2 lượt (đã xác nhận)**; đoạn viết ngắn ở Kiến thức nền = 1 lượt (điểm 20, 22, 23) |
| 7, 24 | Lượt chưa dùng | **Thay quy tắc 50% (điểm 23):** đăng ký lại (không huỷ) thì chuyển TOÀN BỘ lượt chưa dùng, bảo lưu tối đa 2 tháng; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn. Không còn câu làm tròn. Cách áp chi tiết: câu 36 dưới đây |
| 8 | Gộp dùng thử vào sổ lượt | Không gộp (GOI-04 mục 5.8; GOI-11 mục 5.2.6) |
| 9 | Xác nhận đơn bật tài khoản | Chấp nhận (điểm 20) |
| 10 | Speaking lớp offline có chờ duyệt không | Trả ngay; chỉ Writing lớp offline chờ duyệt; Speaking thi thử giáo viên chấm (điểm 20) |
| 11 | Một phiên mỗi tài khoản | Tự làm, chỉ học viên, hỏi trước khi chiếm, không đẩy bài có giờ (điểm 20) |
| 12 | Giữ dữ liệu bao lâu | Bản ghi âm tối đa 60 ngày kể từ lúc ghi rồi xoá, không dùng cho mục đích khác (điểm 20, 22); **bài làm giữ 45 ngày sau khi khoá hết hạn** (điểm 23). Phần còn mở: câu 12b |
| 13 (phần tên) | Tên sáu khoá online | Đã chốt (điểm 2) |
| 14 | Đăng nhập email và mật khẩu | Không dùng mật khẩu: Google hoặc mã 6 số qua email (điểm 21) |
| 15 | Bản quyền kho 549 bài và hình Task 1 | Mở công khai được (điểm 20) |
| 16 | 19 bộ chưa duyệt, 3 bộ Task 1 thiếu hình | Người thực thi rà và tạo luôn — G06-T19 (điểm 20, 23) |
| 17 | Ai làm câu trả lời mẫu Speaking | Repo VIDEO MAKING (kịch bản, giọng Kokoro, video); web chỉ hiển thị (điểm 22) |
| 19 | Lỗi mã kích hoạt | Một câu chung + hai câu riêng; 5 lần thử trong 15 phút (điểm 22) |
| 22 | "Save and exit" ở bài thi | Full test không có "Save and exit", thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test" (điểm 22) |
| 23 | "Tạm dừng" bài nghe | Chế độ thi không có; luyện từng phần thì có (điểm 22) |
| 25 | Lớp đang chạy bằng mã cũ có chuyển sang đo lượt không | **CÓ** (điểm 23). G04-T15 + G09-T43. Chi tiết còn mở: câu 37 |
| 27 | Một lớp một hay nhiều giáo viên | **Mỗi lớp MỘT giáo viên** (hiện là anh Andy): một cột `cohorts.instructor_id` (điểm 23) |
| 29 | Mock test "làm trong khoảng thời gian" có được nghỉ giữa các phần không | **KHÔNG**; đã bắt đầu thì làm liền các phần (điểm 23). Ca biên: câu 38 |
| 33 (phần nhà cung cấp) | Gửi thư bằng gì | Resend đã có trong repo (`backend/services/owner_alerts.py`, `RESEND_API_KEY`) (điểm 23). Phần còn mở: câu 33 |
| — | Bốn chỗ đã vẽ chưa có dữ liệu | THÊM vào gói (điểm 23): "Lần đăng nhập gần đây" → G04-T16 + G07-T17; "Đổi email đăng nhập" → G05-T24 + G07-T17; thư "khoá đã mở đăng ký" → G04-T17 + G05-T22; "Lỗi đang lặp lại" → GOI-12 + G07 |
| — | Kiến thức nền công khai hay thuộc khoá; trục gắn bài Đọc kỹ | Kiến thức nền mở công khai, thuộc Thư viện; Đọc kỹ gắn theo 20 mô đun của dàn 381 bài, AI nhận xét bản dịch để sau (điểm 23) |
| — | Nhận xét lớp offline có hiện ở trang khoá online không | Có, ở trang sáu khoá online, không ghi là của lớp offline; khi khoá online có nhận xét riêng mới tách (điểm 23) |

### 7.2 Còn mở — chặn việc khởi động

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 13 | Dữ liệu sáu khoá online: học phí, thời hạn, số lượt, hạn dùng lượt, ngày mở; tài khoản nhận tiền; hạn giữ đơn; slug của sáu khoá; nguồn bài giảng của sáu khoá — thư mục nào, ai sản xuất (thêm 18/11 tối, cho G07-T28) (chặn mở đăng ký, không chặn viết mã) | Anh gửi bảng; tới lúc đó để cấu hình, giao diện ẩn (G04 Q11; GOI-11 câu 23) |
| 33 | Thư cho học viên: (a) địa chỉ gửi và tên miền đã xác minh trên Resend (hiện chỉ có `alerts@averlearning.com` cho thư báo chủ dự án); (b) mã đăng nhập đi đường nào — A: OTP của Supabase Auth, anh cấu hình SMTP của Supabase trỏ vào Resend và dán mẫu thư, ở staging rồi production; B: backend tự sinh mã, gửi qua Resend, tự xin phiên; (c) các số của mã (thời hạn, số lần thử, số lần gửi) | (a) một địa chỉ trên `averlearning.com`, ví dụ `hoc@averlearning.com`; (b) đường A; (c) 10 phút · 5 lần thử · 5 lần gửi mỗi email (G04 Q9; G05 câu 3, 4, 5; G09 Q36) |

### 7.3 Còn mở — khó đổi về sau hoặc chặn mở bán

| # | Câu hỏi | Đề xuất | Gói · câu |
|---|---|---|---|
| 36 | (mới) "Chuyển toàn bộ, bảo lưu tối đa 2 tháng" áp thế nào: (a) thế nào là "đăng ký lại" — đơn cùng khoá tạo trước ngày hết hạn, hay cả trong một khoảng sau đó; (b) 60 ngày của lượt chuyển tính từ lúc nào; (c) "huỷ gói" có đúng nghĩa là không đăng ký lại không; (d) lượt đã chuyển một lần còn dư có chuyển tiếp sang kỳ thứ ba không; lượt admin cấp thêm có được chuyển không | (a) đơn tạo trước ngày hết hạn hoặc trong 60 ngày sau đó, miễn sau đó được xác nhận; (b) từ ngày khoá mới bắt đầu; (c) đúng; (d) không chuyển tiếp; lượt cấp thêm có chuyển | G04 Q3, Q17, Q19 |
| 37 | (mới) Chuyển lớp mã cũ sang đo lượt: số lượt ban đầu mỗi người của từng lớp; có hạn chót chuyển không; lớp chưa chuyển có bị đo không; giáo viên có được cấp lượt cho lớp mình không; lượt lớp có dùng cho tự luyện không | Admin nhập từng lớp (không có số mặc định); không hạn chót; chưa chuyển thì chưa đo; chỉ admin (mặc định tạm 18/11, chờ anh Andy xác nhận); cho dùng | G04 Q4, Q5, Q21; G09 Q32 |
| 38 | (mới) Mock test tự làm chạy liền các phần — ca biên: mất mạng hoặc đóng trình duyệt thì đồng hồ có dừng không; có khoảng chuyển phần cố định không; bắt đầu gần cuối khoảng mở thì được làm hết không; nộp sớm thì phần kế bắt đầu ngay không | Không dừng, phần hết giờ tự nộp; 0 giây; làm hết, có cảnh báo trước khi bắt đầu; bắt đầu ngay | G09 Q31; G08 câu 13 |
| 12b | Con số giữ bản ghi âm áp trên production (trần 60, hôm nay 15); hết 45 ngày thì bài làm bị xoá hay chỉ ẩn; quy tắc 45 ngày có áp cho Reading, Listening không | 60 ngày cho mọi người; Writing chỉ ẩn ở tầng đọc, Speaking theo cơ chế xoá đang có; không áp Reading, Listening | G04 Q10, Q20 |
| 26 | Chấm phát âm trên đoạn mẫu: độ dài đoạn, lấy ở đâu, Part 3 chấm mọi câu hay một câu mỗi phiên | 30 giây, giữa bài, một câu mỗi phiên | G04 Q6 |
| 28 | Quy tắc trả kết quả thi thử (chỉ trả người đã chấm đủ; có trả từng phần; không thu hồi; sửa điểm phải có lý do) và thêm lớp vào kỳ thi là chụp danh sách hay tự cập nhật | Duyệt như đề xuất; chụp danh sách | G09 Q12, Q14 |
| 30 | Hết giờ với bài Writing/Speaking tự chọn chưa đạt mức tối thiểu: có bao lâu để chọn chấm hay bỏ | 24 giờ, không chọn thì bỏ | G08 câu 12 |
| 31 | Người bị chặn chấm thử vì dùng chung IP: "lối đi" cụ thể là gì, ai nới | Màn nêu lý do + kênh liên hệ; admin nới bằng hệ số IP chung | GOI-11 câu 26 |
| 32 | Ngưỡng chặn full test trên điện thoại (768px là đề xuất, chưa chốt); đang thi mà màn hẹp lại thì dải nhắc không che bài hay che bài | 768px; dải nhắc không che bài | GOI-11 câu 10, 12 |
| 39 | (mới) Đổi email đăng nhập: tài khoản từng vào bằng Google có được đổi không; admin, giáo viên thì sao; nhật ký đổi email lưu email đọc được | Không cho tài khoản Google đổi; chỉ học viên; chấp nhận lưu | G05 câu 19, 22 |
| 40 | (mới) "Lần đăng nhập gần đây": có hiện "nơi gần đúng" như tờ TaiKhoan không (cần dịch vụ tra vị trí; gói không lưu IP); giữ lịch sử bao lâu | Không hiện nơi; giữ 90 ngày | G04 Q18; G07 câu 16 |
| 42 | (mới) Thư "khoá đã mở đăng ký" và hai thư đổi email chưa có trên tờ EmailMau: ai duyệt câu chữ; khoá đóng rồi mở lại có báo lần hai không | Người thực thi soạn, anh duyệt trong PR; không báo lần hai (một người một khoá một thư) | G04 Q16b; G05 câu 20, 21 |
| 43 | (mới) Lớp đang có mà không suy được giáo viên: để trống hay gán anh Andy | Để trống, admin chọn | G09 Q35 |
| 20 | Chấm lại: 5 lý do + ghi chú tối đa 300 ký tự như tờ, thay ràng buộc 50–500 ký tự hiện có; chấm lại Speaking làm ở đợt này không | Theo tờ; Speaking để sau | G07 câu 7, 8 |
| 18 | Máy chủ video riêng là dịch vụ nào (câu trả lời mẫu do repo VIDEO MAKING sản xuất — điểm 22; web hiển thị bộ đề nào VIDEO MAKING giao) | Chỉ YouTube chạy trước | G07 câu 10; G06 câu 11 |
| 34 | VietQR: vẽ ảnh cục bộ (thêm một thư viện) hay dùng dịch vụ ngoài | Cục bộ | G05 câu 2 |
| 35 | Thao tác nào cần xác thực lại (step-up): xác nhận/huỷ đơn, cộng/cấp thêm lượt, cấp lượt cho lớp cũ, thu hồi quyền, lưu trữ khoá | Có cho thao tác đổi quyền học và cấp trên 50 lượt | G04 Q13; G09 Q7 |
| 21 | Xác nhận cách hiểu ghi chú bị cắt ở phòng thi: kéo đổi tỉ lệ hai cột | Giữ cách hiểu trong tờ | G08 câu 2 |
| 44 | (mới 18/11 tối) Bài phát âm Course 1 (Azure, tờ BaiTapPhatAm ghi "hiện không trừ, chờ chủ dự án quyết") có trừ lượt lớp không? | Không trừ ở đợt này (mặc định tạm 18/11, chờ anh Andy xác nhận) | G08-T26 |

**Chặn G10 (đợt E, chưa gấp):** cho gỡ JS cũ theo đợt; cho đưa media ra khỏi git và nơi lưu; gộp route admin thành 1 nhóm hay khoảng 8 nhóm; job ảnh chụp là bắt buộc hay tham khảo.

Chỗ hai gói còn lệch chưa phân xử được: bảng cuối mục 6. Số câu còn mở ở mục 10 của ba gói vừa rà: GOI-04 19 câu, GOI-05 18 câu, GOI-09 25 câu (đa số là số cấu hình có mặc định tạm).


## 8. Rủi ro chính

| Rủi ro | Dấu hiệu | Cách giảm |
|---|---|---|
| Test ghim đường dẫn và chuỗi mã nguồn vỡ hàng loạt | Một PR nhỏ đỏ hàng chục test | Chia đợt nhỏ (G07 chia 9 đợt); sửa test trong cùng PR; quá 30 test ngoài dự kiến thì dừng báo |
| Người thực thi tự chốt quyết định sản phẩm | PR có hằng số ghi cứng thay cho cấu hình | Mọi giá trị chưa chốt là cấu hình; ghi `CẦN ANH ANDY QUYẾT` |
| Hai phiên sửa cùng file | Xung đột merge lặp lại | Chia luồng theo vùng mã (mục 5); ba quy tắc thứ tự (mục 3) |
| Mã kích hoạt đang chạy bị ảnh hưởng | Học viên lớp không vào được, hoặc lớp cũ bị trừ lượt khi chưa được cấp | G04 không sửa migration cũ, thêm cột và trigger có điều kiện; mã cũ chạy nguyên và chưa bị đo cho tới khi admin chủ động chuyển lớp (G04-T15, G09-T43) |
| Trừ lượt sai hoặc trừ hai lần | Số dư âm, học viên báo mất lượt | Sổ chỉ ghi thêm, giữ chỗ rồi chốt hoặc hoàn; test đua đồng thời bắt buộc; Speaking thi thử và chấm thử không đi qua sổ lượt |
| Tài liệu lệch nhau sau một quyết định mới | Hai gói ghi hai cách cho cùng một việc | `00-QUY-UOC-CHUNG.md` mục 2 thắng; sau mỗi quyết định mới, khớp lại cả bộ và ghi dòng "Khớp chéo" ở đầu gói; chỗ chưa phân xử được ghi ở cuối mục 6 |
| Giao diện mới và cũ trộn CSS | Trang vỡ bố cục khi chuyển qua lại | Trang v2 không nạp CSS cũ; chuyển giữa hai cây luôn tải lại trang |
| Thiếu tờ thiết kế cho vài màn | Người thực thi tự bịa bố cục | Tờ Thành phần, Đợt 4, 5 đã duyệt; tờ Đợt 6 đã có (bản nháp). Còn thiếu: ba thư mới trên EmailMau (khoá đã mở đăng ký, mã đổi email, báo đổi email) — dựng từ thành phần có sẵn và ghi rõ khác biệt trong PR |
| Anh thành điểm nghẽn duyệt | Hàng chờ PR dài | Gom PR spec theo đợt; trả lời nhóm quyết định ở mục 7 một lần |

## 9. Việc tiếp theo ngay

1. Anh đọc file này và `00-QUY-UOC-CHUNG.md`, trả lời các câu còn mở ở mục 7 (trước hết các câu "chặn việc khởi động" ở 7.2, gồm câu 13 về dữ liệu sáu khoá).
2. Người thực thi bắt đầu đợt A: G02 và G01 pha 0 không cần chờ gì.
3. Song song, phiên ở luồng L2 và L3 soạn spec G04 và G03 trong repo để anh duyệt; các spec của G09 (0074, 0085–0087) và GOI-11 (0079–0084) soạn được ngay vì không cần mã nào xong trước.
4. Tờ Thành phần, Đợt 4, 5 đã được anh duyệt (17/11); tờ Đợt 6 còn là bản nháp. Tờ đã sửa theo điểm 23 trừ các chỗ ở bảng cuối mục 6, dòng l; EmailMau còn thiếu ba thư mới.
5. Theo quyết định 18/11: người thực thi (project Claude Code của repo) làm trước; khi anh báo sẵn sàng thì bàn giao theo `BAN-GIAO.md`; sau đó có giám sát tiến độ và tiếp quản nếu cần. Các ý chưa chốt nằm ở `03-SO-BRAINSTORM.md` và `04-VIEC-DE-LAI.md`, không phải đầu bài cho người thực thi.
6. GOI-12 (sáu hướng phát triển, 38 nhiệm vụ, khoảng 79 phiên) và GOI-13 (nhận xét và khảo sát, Grammar Wiki, kiến thức nền, đọc kỹ; khoảng 68 PR, 96 phiên) đã viết xong ngày 18/11. Cả hai **nằm ngoài đợt A–E** và chỉ bắt đầu từng phần khi anh Andy mở. Riêng C01–C03 (lưu cặp điểm) anh đã duyệt đưa vào đợt D cùng G09-T17 (00 điểm 24). Thứ tự đề nghị cho phần còn lại của GOI-12: phần D (kiểm tra đầu vào) trước mở bán; A, B, E trong ba tháng đầu sau mở bán; F và C04–C07 sau đó. GOI-13 phần A (nhận xét học viên) xếp trước mở bán.
7. Chỗ GOI-12 đòi gói và tờ khác phải khớp **chưa được vá vào các gói kia** (vì chưa phần nào được mở): xem GOI-12 mục 3.3 (bật phần nào thì sửa tờ và gói nào), mục 3.4 (K1–K12) và mục 10.1 (M1–M12). Đáng chú ý: G04 mục 5.3 phải mở rộng các CHECK `credit_kind`, `feature`, `course_products.kind` và mẫu thư khi bật B, E, F; G07 FR-07-029b đổi nghĩa khối "Lỗi đang lặp lại" khi bật A; quy tắc "mở bài mẫu sau khi viết lại" của phần B trái với thẻ bài mẫu ở KetQuaWriting và khối hết lượt ở Hôm nay; FR-04-020 trái với tờ GoiGiaoVienCham về việc học viên online thấy bản AI ngay.
