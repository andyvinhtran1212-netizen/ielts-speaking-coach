# 02 — Bảng phủ: trang của web → tờ thiết kế

Lập 16/11/2026, cập nhật 18/11/2026. Đối chiếu 159 trang hiện có trong `frontend/app` (nhánh `staging` @ 93c7085) và các trang mới của đợt thương mại hoá với **138 tờ** `.dc.html` trong `thiet-ke/` (đếm lại thư mục ngày 18/11/2026: 138 tờ, cùng `canvas.json` 10 trang canvas, `quy-tac-thiet-ke-ban-in.md` và `CHUAN-ADMIN.md`). Tờ ghi tên file, bỏ đuôi `.dc.html`.

**Khớp chéo ngày 18/11/2026:** thêm tờ HomNayTrangThai vào bảng (trước đó có trong thư mục nhưng chưa có trong file này); `/grammar` theo ba tờ GrammarWiki*; "Lần đầu vào" theo TroGiupLanDau (thay `/onboarding`); thêm dòng cho các tờ admin mới và KiemTraKhoaGiaoVien; thư về đơn là bốn thư; minh hoạ là sơ đồ câu chữ; tờ Admin1024 đã có trong thư mục (18/11); cập nhật mục "Chưa áp, chờ chốt" theo 00 mục 2 điểm 20–22.

Trạng thái duyệt: 8 màn mẫu và tờ thành phần cơ bản đã được anh Andy xem và ghi chú (17 ghi chú, đã sửa). Sáu tờ Thành phần và các tờ Đợt 4, Đợt 5 đã được anh duyệt ngày 17/11 (00 mục 6, sửa 18/11). Các tờ còn lại (Đợt 6, tờ vẽ sau) là bản nháp; quy tắc sản phẩm trong đó là đề xuất.

## Nền tảng và thành phần (7 tờ)

| Nội dung | Tờ |
|---|---|
| Màu, chữ, khoảng cách, lưới, icon, tên token | ThanhPhanNenTang |
| Nút, ô nhập, nhãn trạng thái, thông báo, trạng thái trang | ThanhPhan |
| Bảng dữ liệu, lọc, modal, ngăn kéo, uploader, stepper, biểu đồ | ThanhPhanDuLieu |
| Band, audio (có lặp A–B), video hai nguồn, đồng hồ | ThanhPhanHocTap |
| Bảng câu hỏi, thẻ từ, chú thích lỗi, sơ đồ | ThanhPhanHocTap2 |
| Khung học viên, công khai, breadcrumb, thanh tập trung | ThanhPhanKhungTrang |
| Khung admin, giáo viên, chân trang, thiếu quyền | ThanhPhanKhungTrang2 |

## Công khai (chưa đăng nhập)

| Trang (hiện có hoặc mới) | Tờ |
|---|---|
| `/` | TrangChuCongKhai |
| `/courses`, `/courses/[slug]` (mới); `/pricing` chuyển hướng | DanhMucKhoa, DanhMucKhoaMoiMotKhoa (khi mới một khoá mở), TrangKhoaHoc |
| Bài học thử (mới) | BaiHocThu — G07-T29 |
| Chấm thử miễn phí (spec 0047) | ChamThuMienPhi |
| Đơn đăng ký, chuyển khoản, chờ xác nhận (mới) | ThanhToan |
| `/login` (Google hoặc mã 6 số), kích hoạt mã `/activate`, giao diện "một phiên" 8a–8c | TaiKhoanDangNhap (màn 7 "màn chào" không dựng) |
| "Lần đầu vào" (thay `/onboarding`; G07-T17) | TroGiupLanDau màn 2 |
| `/terms`, `/privacy`, `/contact`, `/about` (mới) | PhapLy |
| 404, 403, 500, bảo trì, mất mạng, phiên hết hạn | TrangLoi |
| Thư viện tổng (mới `/library`) | ThuVien |
| Bài mẫu Writing: danh sách, một bài (mới) | BaiMauWritingDanhSach, BaiMauWriting |
| Kiến thức Writing | KienThucWriting |
| Đề Speaking và video (mới) | DeSpeakingDanhSach, DeSpeaking |
| `/grammar` (trang chủ Grammar Wiki) | GrammarWiki |
| `/grammar/[category]/[slug]` (trang bài) | GrammarWikiBai; sơ đồ câu theo GrammarWikiMinhHoa (renderer: GOI-11 phần G); khuôn bài đọc chung: NguPhap |
| `/vocabulary` phần tra cứu công khai | TuVung |
| Thư gửi học viên | EmailMau |

## Học viên sau đăng nhập

| Trang hiện có | Tờ |
|---|---|
| `/home` — có khoá, đang học | Main (mục 1 đã duyệt), Mobile |
| `/home` — chưa có khoá · đơn chờ xác nhận hoặc cần bổ sung · ngày đầu có khoá · sắp hết hạn / đã hết hạn / hết lượt | HomNayTrangThai (bản điện thoại của "chưa có khoá": Main mục 6) |
| `/my-class` (thành Lộ trình) | LoTrinh (G07-T15), LoTrinhBaiDuocGiao, LopBuoiHoc — G07-T30 |
| Trang bài giảng (mới) | BaiGiang |
| Hub Luyện tập (mới `/practice`) | LuyenTap |
| `/speaking`, `/writing/dashboard`, `/listening`, `/reading` | HubKyNang |
| `/listening/browse`, `/listening/tests`, `/listening/practice`, `/reading/test`, danh sách đề các kỹ năng | DanhSachDe |
| `/listening/ielts/80-days`, `/[day]`, `/listening/general`, `/listening/general/[lessonId]`, `/listening/ielts`, `/listening/ielts/[lessonId]`, `/listening/lessons/[lessonId]`, `/listening/skills`, `/reading/skill`, `/reading/skill/[slug]` | ChuongTrinhKyNang — G08-T26 |
| `/listening/exercise-book/*` | SachBaiTap — G08-T26 |
| `/listening/dictation`, `/dictation/session`, `/listening/gist`, `/mcq`, `/tf`, `/listening/practice-run`, `/listening/programmes/form/[testId]` | BaiTapListening, BaiTapKhachQuan |
| `/reading/vocab`, `/reading/vocab/[slug]`, bài luyện Reading | BaiTapReading, BaiTapKhachQuan |
| `/practice/session` (Speaking) | BaiTapSpeaking |
| Trình soạn Writing | BaiTapWriting |
| `/course-exercises`, `/exercises`, `/d1-exercise` (phát âm và bài tập khoá) | BaiTapPhatAm — G08-T26, BaiTapTuVungNguPhap |
| `/vocabulary/hub`, `/vocabulary/learn`, `/learn/[unitSlug]`, `/vocabulary/sets/[setId]`, `/vocabulary/study/[sessionId]`, `/vocabulary/practice`, `/vocabulary/exam`, `/advanced-vocabulary`, `/flashcards`, `/flashcard-study` | TuVungHocVien — G08-T26 (phần chung với `/vocabulary` ở G06-T15), BaiTapTuVungNguPhap |
| `/grammar-checkup`, `/grammar-checkup/review/[routeId]`, `/grammar-lessons/assigned`, `/grammar/roadmap`, `/grammar/compare`, `/grammar/search`, `/grammar/exercises`, `/quiz`, `/quiz/progress` | NguPhapHocVien — G08-T26, BaiTapTuVungNguPhap |
| `/mock-exam`, `/full-test`, `/listening/mini-test`, `/reading/mini-test` (hub Thi thử) | ThiThu |
| Trước giờ thi, chuyển phần | ThiThuTruocGio |
| `/reading/exam/session` | PhongThi |
| `/listening/test/session`, phần Writing của thi thử | PhongThiNgheViet |
| Speaking full test | PhongThiSpeaking |
| Bài kiểm tra giữa kỳ, cuối kỳ của khoá (màn học viên; G11-T27) | KiemTraKhoa |
| `/writing/result` | KetQuaWriting |
| `/speaking/result`, `/result`, `/listening/programmes/result/[attemptId]`, `/full-test-result`, `/mock/result` | PhieuKetQua |
| `/listening/review`, `/reading/review` | XemLaiBaiLam — G07-T31 |
| `/listening/analytics`, tiến độ | TienDo |
| `/profile`, khoá học và lượt chấm AI | TaiKhoan |
| Đăng ký lại, khối "Hết lượt chấm" dùng chung (mới) | GiaHanThemLuot |
| Thông báo (mới) | ThongBao |
| Trợ giúp (mới) | TroGiupLanDau |

## Admin và giáo viên

75 trang admin hiện có được gom về các trang có thẻ theo bảng ánh xạ trong `GOI-09-admin-va-giao-vien.md`.

| Nhóm sidebar | Trang hiện có | Tờ |
|---|---|---|
| Tổng quan | `/admin` | AdminViecCanLam |
| Học viên và quyền truy cập | `/admin/users`, `/admin/students` | AdminDanhBa, HoSoHocVien |
| | `/admin/classes`, `/classes/[cohortId]`, `/exercise-book`, `/grants`, `/admin/writing/cohorts` | AdminLop |
| | Kết quả một bài giao (mới; G09-T28) | AdminKetQuaBaiGiao |
| | Bảng công bố điểm bài kiểm tra khoá (mới; G09-T30) | KiemTraKhoaGiaoVien |
| | `/admin/instructors`, gửi thông báo (mới) | AdminGiaoVienThongBao |
| | Mã kích hoạt | AdminLuotVaMa |
| Khoá học và đăng ký (mới) | Khoá, đơn đăng ký, lượt AI | AdminKhoaHoc, AdminDonDangKy, AdminLuotVaMa |
| Chấm bài | `/admin/writing/queue`, `/grade`, `/instructor-queue`, `/status` | AdminChamWriting |
| | `/admin/writing/regrade-requests` | AdminChamLai |
| | `/admin/speaking/sessions`, `/admin/mock-reviews`, `/mock-reviews/report`, `/mock-exams/corrections` | AdminChamSpeakingThiThu |
| Nội dung | `/admin/listening/*` (15 trang), `/admin/reading/*` | AdminNoiDung |
| | `/admin/writing/prompts`, `/new`, `/tips`, `/assignments`, `/admin/speaking`, `/speaking/topics` | AdminNoiDungVietNoi |
| | `/admin/vocab/*` (13 trang), `/admin/grammar/*`, `/admin/grammar-diagnostic`, `/admin/grammar-lessons` | AdminNoiDungTuVungNguPhap |
| | Thư viện công khai `/admin/library` (mới; G06-T20) | AdminThuVienCongKhai |
| Thi thử | `/admin/mock-tests`, `/mock-exams`, `/mock-live`, `/mock-pacing`; "Tổ chức kỳ thi" ba bước | AdminKyThi |
| | Trang một kỳ thi 7 thẻ (mới; G09-T34) | AdminKyThiChiTiet |
| Báo cáo | `/admin/usage`, `/admin/foot-traffic`, `/admin/system/ai-usage`, `/admin/dashboard/reading-attempts`, các trang analytics và stats | AdminBaoCao |
| Hệ thống | `/admin/error-logs`, `/admin/feedback`, `/admin/system/alerts` | AdminSuCo |
| | `/admin/system`, `/admin/mfa` | AdminHeThong |
| | Cài đặt (mới) | AdminCaiDat |
| Giáo viên | `/instructor`, `/instructor/grade`, `/instructor/compare` | GiaoVien, AdminChamWriting |

## Chưa có tờ riêng, có chủ ý

| Thứ | Lý do |
|---|---|
| `/next-probe`, `/recorder-spike` | Trang chẩn đoán kỹ thuật: gỡ khỏi bản chạy thật (00 mục 2 điểm 22) |
| `/exam` | Chuyển hướng về Thi thử `/tests` (00 mục 2 điểm 22) |
| `/admin/vocab/pilot-metrics`, `/admin/grammar/recommend-test`, `/admin/listening/audit*` | Công cụ nội bộ; G09 gom vào Báo cáo hoặc Hệ thống, dựng bằng thành phần bảng có sẵn |
| Từng dạng bài Listening lẻ (gist, mcq, tf) | Dùng chung dạng câu hỏi ở BaiTapKhachQuan và BaiTapListening |
| Bản 1024px của admin | Tờ `Admin1024.dc.html` (ba trang: Việc cần làm, Chấm Writing, Lớp) **đã có trong thư mục**; các trang khác theo quy tắc chung: sidebar thu thành icon, bảng cuộn ngang giữ cột đầu (GOI-03 FR-03-010a) |
| Chế độ nền tối | Đã có ba tờ CheDoToi, CheDoToiHocVien, CheDoToiCongKhaiAdmin (17/11/2026); spec ở GOI-03 mục 5.9 |
| Minh hoạ | Minh hoạ của web là sơ đồ câu chữ (GrammarWikiMinhHoa), không dùng tranh khắc (00 mục 2 điểm 22); các ô giữ chỗ tranh trên tờ cũ không dựng |
| Trạng thái "Đang chấm" từng phần của mock test được giao | Chưa vẽ riêng (`04-VIEC-DE-LAI.md` mục C); G08-T22 dựng từ MockTestDuocGiao, ThiThu và thành phần G03. Phía học viên của mock test được giao (MockTestDuocGiao), "Abandon test" và màn "Time is up" (PhongThi, PhongThiNgheViet, PhongThiSpeaking, ThiThu, ThiThuTruocGio) đã vẽ (đối chiếu 18/11 tối) |
| Công tắc và ô hỏi "đồng ý dùng bản ghi âm" (có trên tờ TaiKhoan) | **Không dựng**: tính năng hoãn theo quyết định 18/11/2026 |
| Giao diện tiếng Anh cho toàn web | Chỉ bài thi full test dùng tiếng Anh |

## Chỗ các tờ từng lệch nhau — đã xử lý ngày 17/11/2026 (canvas Version 140)

- **Chuông thông báo:** đã thêm vào khung trang học viên (máy tính, tablet, điện thoại), Main, LoTrinh, Mobile; ThongBao có dải cảnh báo tổng số bài quá hạn.
- **Chấm thử miễn phí:** giữ, là ngoại lệ có chủ đích; Writing và Speaking; trần cấu hình ở AdminCaiDat (theo task, theo IP, ngân sách ngày — GOI-11 mục 5.2); lối vào ở trang chủ và menu công khai (G05-T21). Chưa thêm lối chấm thử ở HubKyNang.
- **Thư khi tạo đơn:** **bốn thư** về đơn (đã tạo đơn · nhắc một lần trước hạn · cần bổ sung hoặc chưa tìm thấy khoản chuyển · khoá đã mở) theo 00 mục 2 điểm 18; EmailMau thư 4, 5, 14, 6. Tờ nào còn ghi "ba thư" thì 00 thắng.
- **Nhãn khoá hết hạn:** "Đăng ký lại" ở mọi tờ.
- **Thi full test trên điện thoại:** màn chặn tiếng Anh dưới 768px (ngưỡng đề xuất); tablet 768–1023 có bố cục riêng.
- **Kết quả kiểm tra của khoá:** KiemTraKhoa có hai chế độ trả điểm và bảng công bố phía giáo viên; AdminLop trỏ sang. Mã hiện tại chỉ trả ngay, cần spec mới. LopBuoiHoc chưa có dòng "Đã nộp · chờ công bố".

## Tờ thêm ngày 17/11/2026

| Tờ | Nội dung |
|---|---|
| GrammarWiki | Mục lục Grammar Wiki: 137 bài thật, 10 nhóm (thay phần mục lục giả định của NguPhap) |
| GrammarWikiBai | Trang một bài wiki (Passive Voice) và phần đầu hai bài khác loại |
| GrammarWikiMinhHoa | 10 kiểu minh hoạ câu chữ |
| NhanDienLogo | Hiện trạng, ba hướng logo, quy cách |
| NhanDienSocial | Ảnh chia sẻ liên kết, bìa, mẫu bài đăng, đầu thư, tài liệu in |

## Tờ thêm và thay đổi lớn sau kiểm duyệt (17/11/2026, canvas Version 152 trở đi)

| Tờ | Nội dung |
|---|---|
| AdminKetQuaBaiGiao (mới) | Kết quả một bài giao: ai nộp, lớp làm thế nào, lớp vướng ở đâu theo nhóm ngữ pháp, ai cần chú ý, nên chữa gì; biến thể Writing, Speaking, giữa kỳ |
| AdminKyThi (dựng lại) + AdminKyThiChiTiet (mới) | Tổ chức kỳ thi cho lớp hoặc nhóm chọn tay, live hoặc tự làm; trang một kỳ thi: theo dõi phòng live, phân tích sau thi, một nơi trả kết quả |
| HoSoHocVien (mở rộng) | Hồ sơ một học viên bản một người dùng: trạng thái, cảnh báo, mục tiêu, độ liên tục, ghi chú chăm sóc |
| AdminNoiDung, AdminNoiDungVietNoi, AdminNoiDungTuVungNguPhap | Bỏ tải file hàng loạt; 4 thẻ Đề và bài · Chương trình và bộ · Lô nhập (chỉ đọc) · Câu cần kiểm |
| KiemTraKhoaGiaoVien (mới) | Bảng công bố điểm bài kiểm tra khoá phía giáo viên (tách từ KiemTraKhoa) |
| DanhMucKhoaMoiMotKhoa (mới) | Danh mục khi mới có một khoá mở, "Báo cho tôi khi mở" |
| Main + HomNayTrangThai | Main giữ trạng thái "có khoá, đang học" (đã duyệt) và bản điện thoại "chưa có khoá"; HomNayTrangThai chứa các trạng thái: chưa có khoá, đơn chờ xác nhận, ngày đầu, sắp hết hạn / hết hạn / hết lượt |

Báo cáo kiểm duyệt gốc và danh sách phát hiện: `khao-sat/kiem-duyet-hoc-vien.md`, `khao-sat/kiem-duyet-admin.md`. Các điểm trước đây ghi "chưa áp, chờ anh Andy chốt" **đã có quyết định** (00 mục 2 điểm 20, 22): HV-20 (mã lớp kèm số lượt chấm; bài của lớp dùng lượt đó), HV-14 (một phiên mỗi tài khoản, chỉ học viên, hỏi trước khi chiếm), HV-08 (người bị chặn vì dùng chung IP có lối đi), HV-33 (dòng phụ tiếng Việt ở màn ngoài bài thi), HV-24 (1 lượt = 1 bài Part 2 hoặc 1 cụm Part 1 gồm 2–3 câu). Chỗ tờ còn vẽ theo cách cũ thì 00 thắng.

## Danh sách 138 tờ trong `thiet-ke/` (18/11/2026)

AdminBaoCao · AdminCaiDat · AdminChamLai · AdminChamSpeakingThiThu · AdminChamWriting · AdminDanhBa · AdminDonDangKy · AdminGiaoVienThongBao · AdminHeThong · AdminKetQuaBaiGiao · AdminKhoaHoc · AdminKyThi · AdminKyThiChiTiet · AdminLop · AdminLuotVaMa · AdminNoiDung · AdminNoiDungTuVungNguPhap · AdminNoiDungVietNoi · AdminSuCo · AdminThuVienCongKhai · AdminViecCanLam · BaiGiang · BaiHocThu · BaiMauWriting · BaiMauWritingDanhSach · BaiTapKhachQuan · BaiTapListening · BaiTapPhatAm · BaiTapReading · BaiTapSpeaking · BaiTapTuVungNguPhap · BaiTapWriting · ChamThuMienPhi · CheDoToi · CheDoToiCongKhaiAdmin · CheDoToiHocVien · ChuongTrinhKyNang · DanhMucKhoa · DanhMucKhoaMoiMotKhoa · DanhSachDe · DeSpeaking · DeSpeakingDanhSach · EmailMau · GiaHanThemLuot · GiaoVien · GrammarWiki · GrammarWikiBai · GrammarWikiMinhHoa · HoSoHocVien · HomNayTrangThai · HubKyNang · KetQuaWriting · KiemTraKhoa · KiemTraKhoaGiaoVien · KienThucWriting · LoTrinh · LoTrinhBaiDuocGiao · LopBuoiHoc · LuyenTap · Main · Mobile · NguPhap · NguPhapHocVien · NhanDienLogo · NhanDienSocial · PhapLy · PhieuKetQua · PhongThi · PhongThiNgheViet · PhongThiSpeaking · SachBaiTap · TaiKhoan · TaiKhoanDangNhap · ThanhPhan · ThanhPhanDuLieu · ThanhPhanHocTap · ThanhPhanHocTap2 · ThanhPhanKhungTrang · ThanhPhanKhungTrang2 · ThanhPhanNenTang · ThanhToan · ThiThu · ThiThuTruocGio · ThongBao · ThuVien · TienDo · TrangChuCongKhai · TrangKhoaHoc · TrangLoi · TroGiupLanDau · TuVung · TuVungHocVien · XemLaiBaiLam.

Cạnh các tờ: `canvas.json` (10 trang canvas: Màn hình · Thành phần · Dạng bài tập · Công khai, đăng ký khoá · Thư viện công khai · Học viên Đợt 4 · Admin và giáo viên Đợt 5 · Học viên bổ sung Đợt 6 · Nhận diện thương hiệu · Chế độ tối), `quy-tac-thiet-ke-ban-in.md`, `CHUAN-ADMIN.md` (bản chuẩn sidebar, ngưỡng, giao bài, dữ liệu mẫu của các tờ admin).

## Tờ thêm ngày 18/11/2026 (canvas Version 160, 138 tờ)

| Tờ | Nội dung |
|---|---|
| MockTestDuocGiao | Mock test được giao, phía học viên: thông báo, trang kỳ thi của tôi, hai cách thi, phiếu trả từng phần |
| HocVienNoiGi | Trang công khai "Học viên nói gì" |
| AdminKhaoSat | Khảo sát sau khoá và duyệt nhận xét |
| Admin1024 | Quy tắc co giãn admin và ba trang ở 1024px |
| KienThucNen | Prototype kiến thức nền theo chủ đề (Work) — gói `GOI-13` |
| DocKy | Prototype đọc và dịch theo ngữ pháp, gắn dàn bài Course 1 — gói `GOI-13` |
| KhuonLuyenDe | Khuôn luyện đề tái dùng (ví dụ THPT, đang hoãn) — gói `GOI-13` |

Đã sửa lớn cùng ngày: mô hình thi mới (đề tự chọn chỉ full test từng kỹ năng; mock test chỉ khi được giao), "Leave test" thay "Save and exit", đơn vị lượt Speaking, lỗi mã kích hoạt gộp, lối đi khi chấm thử bị chặn vì IP, sơ đồ câu chữ thay tranh khắc, nhận xét học viên ở trang chủ và trang khoá.

## Tờ thêm chiều 18/11/2026 (canvas Version 165)

| Tờ | Nội dung | Gói |
|---|---|---|
| GrammarWikiNhom1 … GrammarWikiNhom10 | Trang nhóm của 10 nhóm bài Grammar Wiki đang có trong repo (137 bài Markdown ở `backend/content/`): mục lục nhóm, thứ tự đọc, khối đặc thù của nhóm | `GOI-13` |
| GrammarWikiNhomN-Bai1, -Bai2 (20 tờ) | Hai bài mẫu dựng thật cho mỗi nhóm, dùng nội dung bài đang có; là mẫu để dựng 137 bài còn lại | `GOI-13` |
| SoLoiCaNhan | Sổ lỗi cá nhân: lỗi lặp lại gom từ các bài đã chấm, lịch ôn | `GOI-12` |
| VietLaiSauCham | Viết lại sau khi chấm, so hai bản | `GOI-12` |
| DoLechAIGiaoVien, DoLechAIGiaoVienAdmin | Công bố độ lệch điểm AI so với giáo viên; trang admin nhập và duyệt số liệu | `GOI-12` |
| KiemTraDauVao | Bài kiểm tra đầu vào và gợi ý khoá | `GOI-12` |
| NhacViecThuTuan | Thư nhắc việc hằng tuần và trang chọn nhận thư | `GOI-12` |
| GoiGiaoVienCham, GoiGiaoVienChamAdmin | Gói giáo viên chấm tay; hàng chờ và phân công phía admin | `GOI-12` |

Các khối bài viết mà tờ nhóm Grammar Wiki dùng thêm so với tờ mẫu `GrammarWikiBai` (ký hiệu chỗ trống, nhãn đổi được, "Bảng chọn nhanh", đoạn văn có chú thích, mục lục hai tầng, khối nghe mẫu) được vẽ ngay trong tờ nhóm và bài mẫu của nhóm đó; `GrammarWikiBai` đã chạm trần 8000px nên không chép lại vào đó. Khi dựng, lấy khối theo tờ của nhóm.

Kiểm chứng 18/11: 138 tờ đều dựng bằng bộ dựng thật của canvas, không tờ nào tràn khung, thiếu dữ liệu hay báo lỗi ở trạng thái mặc định. Đã bấm thử mọi nút, tab, mục mở rộng, ô chọn trên 138 tờ: không lỗi script; 38 khung được nâng chiều cao để chứa trạng thái mở rộng. Còn mười tờ đang ở trần 8000px có thể dài hơn khung khoảng 10–600px khi mở hết mục (AdminBaoCao, AdminCaiDat, AdminKetQuaBaiGiao, AdminKhaoSat, AdminLop khi mở hết các nhóm menu bên; PhieuKetQua, TrangChuCongKhai, TaiKhoanDangNhap, KienThucNen, GrammarWikiBai khi mở form hoặc FAQ): phần tương tác trên tờ là minh hoạ, trên web trang tự dài ra.
