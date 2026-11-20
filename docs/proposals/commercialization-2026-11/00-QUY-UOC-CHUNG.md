# 00 — Quy ước chung cho người thực thi (đọc trước mọi gói việc)

Lập ngày 16/11/2026. Người quyết định: anh Andy (chủ dự án). Tài liệu này và các file `GOI-*.md` cùng thư mục là đầu bài cho team bot thực hiện đợt thương mại hoá Aver Learning. Bot làm đúng theo đây; chỗ nào tài liệu này khác với quy tắc trong repo thì **quy tắc trong repo thắng** và bot báo lại chỗ lệch.

## 1. Sản phẩm và repo

- Sản phẩm: Aver Learning (averlearning.com) — web học tiếng Anh và IELTS. Backend FastAPI (Railway), frontend Next.js 16 App Router + React/TypeScript (Vercel), Supabase (PostgreSQL, Auth, Storage).
- Repo: `andyvinhtran1212-netizen/ielts-speaking-coach`. Nhánh tích hợp: `staging`. Production: `main`.
- Tài liệu bắt buộc đọc trong repo, theo thứ tự: `AGENTS.md` → `docs/AGENT_WORKFLOW.md` → `README.md` → `CLAUDE.md` → `specs/README.md` → `specs/_meta/constitution.md` → `frontend/AGENTS.md` (khi sửa frontend).
- Bộ thiết kế chuẩn: thư mục `thiet-ke/` cạnh file này (138 tờ `.dc.html` + `canvas.json` + `quy-tac-thiet-ke-ban-in.md`). Xem mục 6.

## 2. Quyết định sản phẩm đã chốt (không tự đổi)

1. Bán theo khoá: mỗi khoá có học phí, thời hạn truy cập, kèm lượt chấm AI. Dữ liệu cụ thể (tên chính thức, học phí, thời hạn, số lượt) chưa chốt → mọi nơi dùng giá trị cấu hình được, không ghi cứng; trên giao diện mẫu để `XXX`.
2. Hai dạng học viên dùng chung một sản phẩm:
   - **Học viên lớp offline:** 5 khoá của lớp (Course 1–5). Admin cấp mã kích hoạt để vào khoá làm bài tập về nhà; admin có thể cấp quyền vào thêm khoá khác để luyện lại. Các khoá này **không đăng ký trên web**.
   - **Học viên khoá online:** đăng ký trên web. Dự kiến 6 khoá (tên chốt 17/11/2026): Ngữ pháp nền tảng cho việc hiểu tiếng Anh (gọi tắt "Khoá Ngữ pháp nền tảng"), Khoá Listening for IELTS, Khoá Reading for IELTS, Khoá Writing for IELTS, Khoá Speaking for IELTS, Khoá Vocabulary Skills + Ideas for IELTS.
3. Hai luồng chấm bài: (a) AI chấm và trả ngay — khoá online và tự luyện; (b) AI chấm, giáo viên duyệt rồi mới trả — chỉ Writing của học viên lớp offline được gán mã (sửa theo điểm 20: Speaking lớp offline AI trả ngay; Speaking thi thử do giáo viên chấm từ bản ghi).
4. Thanh toán: chuyển khoản VietQR, admin xác nhận rồi mở khoá. Chưa có cổng tự động.
5. Thư viện mở công khai không cần tài khoản: 549 bài mẫu Writing (mỗi đề ba bài 7.5 / 7.0 / 6.0), kiến thức Writing, đề Speaking kèm video trả lời mẫu, ngữ pháp, từ vựng. Nộp bài để AI chấm thì cần khoá, trừ **chấm thử miễn phí** (mục 11).
6. Video hai nguồn: YouTube công khai và máy chủ video riêng. Trình phát hỗ trợ cả hai.
7. Điều hướng học viên 5 mục: Hôm nay · Lộ trình · Luyện tập · Thi thử · Thư viện. Đổi khoảng 16 đường dẫn học viên, kèm chuyển hướng vĩnh viễn.
8. Admin: gộp Người dùng + Học viên thành một danh bạ có trang hồ sơ; sidebar 8 nhóm việc, mục con thụt lề, nhóm gập/mở được.
9. Một khung phòng thi chung cho Reading, Listening, Mock, Writing; kiểu "giống thi máy thật".
10. Ngôn ngữ thiết kế "Bản in", bảng màu Navy + đỏ mận (nền `#FAF6EF`, chữ `#1B1A17`, nhấn `#1A3561`, đánh dấu `#8A1C1C`), font Source Serif 4 + Source Sans 3.
11. **Chấm thử miễn phí (chốt 17/11/2026):** người dùng mới có tài khoản miễn phí, chưa đăng ký khoá, được chủ động làm thử hoặc gửi bài để AI chấm ở Writing và Speaking, số lượng hạn chế. Ba trần đều là cấu hình: hạn mức mỗi người, trần mỗi ngày cho mỗi người, trần mỗi ngày cho toàn web. Số đã chốt: mỗi người mỗi ngày 1 bài Writing Task 1 + 1 bài Task 2 và 2 bài Speaking Part 2; toàn web 5 USD chi phí chấm mỗi ngày; hạn mức tổng mỗi người suốt chương trình: 10 bài Writing (5 Task 1 + 5 Task 2) và 10 bài Speaking Part 2, tính theo email và địa chỉ IP. Người từng có khoá online (kể cả đã hết hạn) không được chấm thử. Có công tắc tạm dừng. Mục đích: lấy lượt truy cập và thử web với nhiều kiểu người dùng.
12. **Kênh thông báo trong ứng dụng (chốt 17/11/2026):** cho cả web và giao diện điện thoại; báo bài tập mới, nhắc nhở, deadline; cảnh báo tổng số bài đã trễ deadline. Chuông nằm trên thanh điều hướng học viên.
13. **Full test trên điện thoại (chốt 17/11/2026):** hiện cảnh báo và không cho vào bài. iPad hoặc tablet đủ chỗ hiển thị thì vẫn cho vào (ngưỡng đề xuất, chưa chốt: vùng nhìn rộng từ 768px). Mini test không tính là full test, vẫn làm được trên điện thoại, cũng như luyện từng phần.
14. **Khoá hết hạn (chốt 17/11/2026):** nhãn hành động là "Đăng ký lại".
16. **Logo (chốt 17/11/2026):** Hướng 1 "Ấn ký" — chữ A chân serif trong khung kẻ vuông, thanh ngang đỏ mận; quy cách ở tờ NhanDienLogo, tài nguyên ở NhanDienSocial. Trên nền tối dùng bản một màu.
17. **Chế độ sáng/tối (chốt 17/11/2026):** giao diện mới có cả hai, ba lựa chọn Sáng · Tối · Theo thiết bị; quy cách ở tờ CheDoToi và GOI-03 mục 5.9. Anh Andy đã duyệt: (a) đổi nút lật sáng/tối hiện nay thành ba lựa chọn Sáng · Tối · Theo thiết bị — đây là thay đổi phải làm trên web; (b) thư, bản in, mã QR, ảnh đề Task 1 luôn sáng; (c) lưu lựa chọn trên trình duyệt như hiện nay, không lưu theo tài khoản. Phòng thi full test LUÔN SÁNG (chốt 17/11/2026).
18. **Thư về đơn đăng ký (sửa 17/11/2026):** bốn thư — đã tạo đơn; nhắc một lần trước hạn; đơn cần bổ sung hoặc chưa tìm thấy khoản chuyển; khoá đã mở. Huỷ, hết hạn, báo đã chuyển chỉ là thông báo trong ứng dụng. Điều này thay quy tắc "ba thư" trong GOI-11 phần C và các ghi chú sửa đổi ở đầu GOI-04, GOI-05.
19. **Admin (17/11/2026):** các tờ admin dùng một sidebar, một bảng ngưỡng cảnh báo (Cài đặt), một thành phần giao bài, một bộ dữ liệu mẫu — bản chuẩn ở `thiet-ke/CHUAN-ADMIN.md`. Trang nhập nội dung thủ công bị ẩn khỏi sidebar; nội dung nhập qua script backend. Trả kết quả thi thử chỉ ở thẻ "Trả kết quả" của trang kỳ thi.
20. **Quyết định ngày 17/11/2026 (đợt chiều) của anh Andy:**
    - Điều hướng admin: gói G09 làm chuẩn, không theo spec 0049 (PR chưa merge); phần giao bài của 0049 chỉ giữ nếu không trùng.
    - Quy tắc "đường dẫn lịch sử giữ nguyên" nới thành "giữ khi còn được tham chiếu".
    - Lượt chấm AI: Speaking và Writing dùng CHUNG một kho. Lượt của học viên đăng ký khoá online có hạn dùng (con số: cấu hình, chưa có). ~~Lượt chưa dùng được chuyển sang 50% khi đăng ký lại~~ — thay bởi điểm 23: chuyển toàn bộ, bảo lưu tối đa 2 tháng.
    - Học viên lớp offline: mã kích hoạt do admin cấp đã kèm quyền và SỐ LƯỢT CHẤM; bài của lớp dùng lượt đó. Hết lượt thì admin cấp thêm (mặc định tạm 18/11, chờ anh Andy xác nhận; câu cũ ghi "giáo viên/admin"; hiện mỗi lớp một giáo viên là anh Andy, cũng là admin).
    - Speaking của lớp offline: AI chấm và trả ngay. Chỉ Writing của lớp offline qua giáo viên duyệt. Speaking thi thử do giáo viên chấm từ bản ghi.
    - Xác nhận đơn một khoá online là kích hoạt tài khoản: mở luôn các phần Reading, Listening, ngữ pháp, từ vựng dành cho tài khoản đã kích hoạt. Chấp nhận.
    - Một phiên đăng nhập mỗi tài khoản: chỉ áp học viên. Không bao giờ đẩy người đang làm bài có giờ ra; thiết bị mới phải hỏi trước khi chiếm phiên.
    - Bản ghi âm giữ tối đa 60 ngày rồi xoá. ~~Dùng audio làm mẫu hoặc để cải thiện chấm bài~~ — đã bỏ khỏi đợt này (điểm 22).
    - Chấm phát âm (dịch vụ Azure, đắt): chỉ chấm trên một đoạn mẫu — bài nói khoảng 2 phút thì cắt một đoạn; Part 1 nhiều câu thì chỉ chấm phát âm một câu. Các tiêu chí khác chấm trên cả bài. Phiếu phải nói rõ đoạn nào được chấm phát âm.
    - Dữ liệu sáu khoá online (học phí, thời hạn, số lượt, ngày mở, tài khoản nhận tiền, hạn giữ đơn): để placeholder/cấu hình, anh Andy điền sau.
    - Kho 549 bài mẫu và hình Task 1: mở công khai được. 19 bộ chưa có trạng thái duyệt và 3 bộ Task 1 thiếu hình: đội thực hiện rà và tạo luôn (thêm vào G06).
21. **Đăng nhập (chốt 17/11/2026):** không dùng mật khẩu. Hai cách: Google, hoặc nhập email rồi nhập mã 6 số gửi qua thư. Lần đầu nhập mã đúng là tạo tài khoản. Không có quên/đặt lại/đổi mật khẩu, không có thư xác minh email. Điều này thay câu 14 ở 01-KE-HOACH-TONG mục 7 và mọi chỗ trong G05 nói về mật khẩu.
22. **Quyết định ngày 18/11/2026 của anh Andy:**
    - Thực hiện: người thực thi (nay là project Claude Code của repo — điểm 23) làm trước; khi anh Andy báo sẵn sàng thì chuẩn bị bàn giao; sau đó có giám sát tiến độ và tiếp quản nếu cần.
    - Vận hành repo: chỉ có anh Andy. "Leader" trong tài liệu migration của repo chính là anh Andy; số spec và số migration lấy theo bảng ở 01-KE-HOACH-TONG mục 6.
    - Đơn vị lượt chấm Speaking: 1 lượt = 1 bài Part 2, hoặc 1 cụm Part 1 gồm 2–3 câu. (Part 3 tính như Part 1 — đã chốt qua ví dụ full test Speaking mô phỏng, xem gạch cuối điểm này.) Writing: 1 bài = 1 lượt.
    - Phòng thi: chế độ thi không có nút tạm dừng bài nghe (luyện từng phần thì có); full test không có "Save and exit", thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test".
    - Mã kích hoạt: lỗi gộp một câu chung, thêm hai câu riêng an toàn ("Bạn đã có khoá này", "Bạn đã dùng mã này rồi"); giới hạn 5 lần thử trong 15 phút.
    - Đề công khai học viên tự chọn: chỉ có full test TỪNG KỸ NĂNG và mini test, làm lúc nào cũng được, làm lại được; không có full test 4 kỹ năng một mạch. Mock test nhiều kỹ năng CHỈ có khi admin/giáo viên giao (live cùng giờ, hoặc tự bắt đầu trong khoảng thời gian được mở, các phần chạy liền nhau, không nghỉ giữa các phần (điểm 23), làm một lần). Overall band chỉ có ở mock test được giao.
    - Bản ghi âm dùng để cải thiện chấm bài: ĐÃ BỎ khỏi đợt này (anh Andy, 18/11/2026: không nhất thiết phải làm, bỏ ra để tránh vấn đề pháp lý). Không có ô hỏi, không có công tắc, không có API. Bản ghi âm chỉ giữ tối đa 60 ngày rồi xoá. Nếu sau này làm lại thì là lựa chọn tự bật và có rà pháp lý trước.
    - Chấm thử bị chặn vì dùng chung IP: có lối đi cho người dùng (màn bị chặn nêu lý do và cách liên hệ/xác minh). Màn ngoài bài thi của full test (chặn điện thoại, lỗi thiết bị): thêm dòng phụ tiếng Việt.
    - Bốn khoản: gỡ hai trang chẩn đoán (`/next-probe`, `/recorder-spike`) khỏi bản chạy thật, `/exam` chuyển hướng về Thi thử; công cụ nội bộ admin dùng khuôn bảng; vẽ ba trang admin ở 1024px; minh hoạ của web là sơ đồ câu chữ, không dùng tranh khắc.
    - Câu trả lời mẫu Speaking: do repo VIDEO MAKING sản xuất (viết kịch bản, giọng đọc Kokoro, dựng video). Web chỉ hiển thị.
    - Nhận xét học viên: đã có sự đồng ý chia sẻ từ lúc thu. Được đăng.
    - Luyện thi THPT: hoãn; thiết kế trước một khuôn để tái dùng.
    - Full test Speaking mô phỏng (chốt 18/11/2026): 3 câu Part 1, 1 bài Part 2, 2 câu Part 3 = 3 lượt chấm (mỗi Part một lượt). Vậy Part 3 tính như Part 1: một cụm 2–3 câu là một lượt.
    - Đề Reading và Listening tự chọn hết giờ thì TỰ NỘP, không hỏi "chấm hay bỏ" (hai kỹ năng này không tốn lượt). Hỏi "chấm phần đã làm hay bỏ" chỉ áp cho Writing và Speaking tự chọn.
    - Full test Writing tốn 2 lượt (mỗi task một lượt): anh Andy đã xác nhận ngày 18/11/2026.
23. **Quyết định ngày 18/11/2026 (đợt chiều) của anh Andy — thắng các điểm trước nếu khác:**
    - Mỗi lớp chỉ có MỘT giáo viên (hiện tại là anh Andy).
    - Lượt chấm chưa dùng: THAY quy tắc "chuyển 50%". Nếu người học đăng ký lại (không huỷ) thì chuyển TOÀN BỘ lượt chưa dùng sang, bảo lưu tối đa 2 tháng. Nếu không đăng ký lại thì khi khoá hết hạn số lượt còn lại hết hiệu lực. (Cách hiểu của người viết: "huỷ gói" = không đăng ký lại; cần anh xác nhận nếu ý khác.)
    - Lớp đang chạy bằng mã cũ: CÓ chuyển sang đo lượt.
    - Mock test "làm trong khoảng thời gian": KHÔNG được nghỉ giữa các phần; đã bắt đầu thì làm liền các phần.
    - Bài làm giữ 45 ngày sau khi khoá hết hạn.
    - Gửi thư: dùng dịch vụ đã có trong repo (Resend, hiện mới dùng cho thư báo chủ dự án: `backend/services/owner_alerts.py`, biến `RESEND_API_KEY`). Còn cần: địa chỉ gửi cho thư học viên (tên miền đã xác minh).
    - Full test Writing tốn 2 lượt (mỗi task một lượt): đã xác nhận.
    - Kiến thức nền theo chủ đề: MỞ CÔNG KHAI (thuộc Thư viện); đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt.
    - Đọc kỹ: gắn theo 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau.
    - Nhận xét học viên: hiện cả ở trang sáu khoá online, KHÔNG ghi là của lớp offline; khi nào khoá online có nhận xét riêng thì mới tách.
    - Thực thi: giao cho project Claude Code của repo averlearning.com (không phải đội Grok). Tên thư mục AVER-GROK giữ nguyên.
    - Bốn chỗ đã vẽ mà chưa có dữ liệu ("Lỗi đang lặp lại", "Lần đăng nhập gần đây", "Đổi email đăng nhập", thư "khoá đã mở đăng ký"): THÊM vào gói.
    - Ba prototype (kiến thức nền, đọc kỹ, khuôn luyện đề) và sáu hướng phát triển (sổ lỗi cá nhân, viết lại sau khi chấm, độ lệch AI–giáo viên, kiểm tra đầu vào, nhắc việc và thư tổng kết tuần, gói giáo viên chấm): làm thiết kế và spec.
    - Rà 19 bộ bài mẫu và vẽ hình 3 bộ Task 1: để bên thực thi làm (G06).
24. **Quyết định tối 18/11/2026 của anh Andy:** đưa ba nhiệm vụ lưu cặp điểm AI–giáo viên (G12-C01, C02, C03; spec SCOREPAIR-0088, migration 480) vào đợt D, làm cùng G09-T17. Chỉ ghi cặp điểm chạy nền, chưa công bố gì. Các phần còn lại của GOI-12 vẫn chờ anh mở.
15. **Bài kiểm tra của khoá:** luồng trả điểm phải được viết cụ thể trong spec và có thiết kế (tờ KiemTraKhoa). Đã chốt: mỗi bài có chế độ trả điểm "trả ngay khi nộp" hoặc "giáo viên công bố"; lớp offline mặc định "giáo viên công bố"; nộp trễ và làm lại để đợt sau.

## 3. Quy tắc câu chữ (áp cho mọi giao diện)

- Xưng "bạn". Không xưng "em". Không dùng "thầy": dùng "giáo viên".
- Không dùng "Mua", "bán", "giá", "đơn hàng": dùng "Đăng ký khoá", "Đơn đăng ký", "Học phí", "Thanh toán", "Đang mở đăng ký".
- Không trộn nhãn Việt–Anh trên một màn. Trang học và bài luyện từng phần: tiếng Việt. **Bài thi full test (phòng thi, thi thử): toàn bộ nhãn, hướng dẫn, trạng thái bằng tiếng Anh; số câu ghi "Q5".** Nhãn công cụ kiểu thi (Highlight, Note, Clear) dùng tiếng Anh ở mọi chế độ. Giữ tên riêng: IELTS, Speaking, Writing, Listening, Reading, Task 1/2, band.
- Đề Writing có tiêu đề ngắn bằng tiếng Anh.
- Không hiện band khi chưa đủ dữ liệu. Không bao giờ hiện "0/0". Không hiện mã nội bộ, tên tham số, mã lỗi HTTP.
- Cảnh báo phải trông như cảnh báo (màu đánh dấu, có nhãn chữ "Cảnh báo"/"Warning"); nút đỏ chỉ dùng trong ngữ cảnh cảnh báo.
- Không emoji. Phiên âm IPA đặt bằng Source Sans 3 (Source Serif 4 thiếu ký tự IPA).

## 4. Ràng buộc cứng (vi phạm là dừng việc)

1. Không sửa, không `git pull`, không đổi nhánh trong bản checkout chính `~/code/ielts-speaking-coach` trên máy anh Andy. Mỗi nhiệm vụ làm trong worktree riêng tạo từ `origin/staging`, nhánh `codex/<ten-nhiem-vu>`, PR vào `staging`. Không bao giờ PR thẳng vào `main`.
2. **Merge chỉ khi anh Andy nói "merge".** Bot không tự merge, không bật auto-merge, không tự duyệt spec của chính mình.
3. Production chỉ xem. Không nộp bài, ghi âm, lưu, đổi dữ liệu trên production. Không đăng xuất phiên của anh. Không nhập mật khẩu hộ.
4. Không chép dữ liệu cá nhân học viên thật vào tài liệu, test, fixture, ảnh chụp.
5. Không đụng phiên Hermes (dây chuyền sản xuất nội dung Course 1) và repo video.
6. Việc thuộc loại `feature` hoặc `high-risk` (xem `specs/README.md`) phải có thư mục spec đã được duyệt trên `staging` **trước khi** viết mã. Bot soạn spec → mở PR spec → dừng chờ anh duyệt. Không gộp spec và mã vào một PR.
7. `high-risk` gồm: chấm bài, lưu kết quả, auth/RLS, mã kích hoạt, kết thúc bài thi, migration, chấm lại, thay đổi hành vi AI trả phí. Loại này không được hạ cấp.
8. Không xoá, bỏ qua, `xfail` hay thu hẹp test để che lỗi. Hành vi đổi có chủ ý thì sửa test trong cùng PR và ghi rõ.
9. Không viết thêm test kiểu đọc file mã nguồn rồi so chuỗi/đường dẫn (kiểu test đang làm repo khó sửa). Test mới kiểm hành vi.
10. Không gọi AI trả phí trong test (`--run-smoke` chỉ khi anh cho phép). Mọi lời gọi AI mới phải ghi qua `services/ai_usage_logger.py`.
11. Không đổi: đường dẫn công khai đang có (trừ danh sách ~16 đường dẫn đã duyệt), tên và số migration cũ, tên thư mục spec, `frontend/public/assets/advanced-vocab/**`, tên job CI bắt buộc, thứ tự cascade CSS trong `components/authed-shell.tsx` (trừ khi gói việc nói rõ).
12. Giới hạn vòng review của repo: sau vòng 3 còn lỗi thì dừng đẩy, rà lại toàn bộ; không vào vòng 6. CI là cổng kiểm, không phải vòng lặp thử.
13. Mỗi PR một việc. Không trộn dọn dẹp vào PR tính năng.

## 5. Quy trình chuẩn cho mỗi nhiệm vụ

1. Đọc gói việc, đọc các file "Đầu vào" ghi trong nhiệm vụ. Đối chiếu với mã hiện tại; nếu mã khác mô tả thì ghi lại chỗ khác và làm theo mã thật, không làm theo trí nhớ của tài liệu.
2. Tạo worktree và nhánh từ `origin/staging` mới nhất.
3. Làm đúng phạm vi. Chạy test hẹp trước, rồi bộ đầy đủ của tầng bị ảnh hưởng (lệnh ở `docs/AGENT_WORKFLOW.md`, mục "Local verification"):
   - Backend: `cd backend && python -m pytest tests/ -q`
   - Frontend hợp đồng: `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`
   - React: `npm --prefix frontend run test:react`
   - Kiểu: `cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build`
   - Spec: `python backend/scripts/validate_specs.py`; `git diff --check`
4. Mở PR vào `staging`. Thân PR ghi: lớp thay đổi (`hotfix|small|content|feature|high-risk`), `Spec:` (mã spec hoặc `N/A`), vấn đề, hành vi mong đợi, phạm vi và ngoài phạm vi, cách đã kiểm (lệnh + kết quả + số test bỏ qua). Cần ảnh xem trước giao diện thì thêm `[preview]` vào thông điệp commit cuối hoặc dùng nhánh `preview/<slug>`.
5. Báo cáo theo mẫu ở mục 8 rồi dừng chờ quyết định merge.

## 6. Cách đọc bộ thiết kế `thiet-ke/`

- Mỗi file `.dc.html` là một tờ thiết kế: HTML với style nội tuyến; phần `<script>` cuối file là dữ liệu mẫu và trạng thái tương tác. Đọc trực tiếp bằng trình soạn văn bản: cấu trúc khối, cỡ chữ, khoảng cách, màu (qua biến `--paper`, `--ink`, `--accent`, `--mark`…) đều nằm trong style. `{{ten}}` là chỗ chèn dữ liệu; `<sc-for>` là vòng lặp; `<sc-if>` là điều kiện.
- Cuối mỗi tờ có mục "Ghi chú cho lập trình": quy tắc hành vi phải theo.
- `canvas.json`: tên tờ, trang, kích thước. Nhóm tờ: Màn hình (8 màn mẫu), Thành phần (6 tờ), Dạng bài tập (7 tờ), Công khai và đăng ký khoá (7 tờ), Thư viện công khai (7 tờ), Học viên Đợt 4 (10 tờ), Admin và giáo viên Đợt 5 (20 tờ), Học viên bổ sung Đợt 6 (12 tờ), cùng 3 tờ thêm vào các nhóm cũ. Bảng "trang của web → tờ" ở `02-BANG-PHU-THIET-KE.md`.
- Thiết kế là chuẩn về bố cục, thứ bậc, câu chữ và trạng thái. Dữ liệu trong tờ (tên người, số, đề bài) là mẫu. `XXX` = chưa chốt, phải lấy từ cấu hình/dữ liệu thật.
- Bộ tờ đã phủ các màn chính của học viên, admin và giáo viên (cập nhật 16/11, sau khi viết các gói). Sáu tờ Thành phần và các tờ Đợt 4, Đợt 5: anh Andy đã duyệt bản hiện tại (17/11: "Duyệt Canva: anh duyệt rồi"; sau đó "canvas đã xem, không có góp ý lớn" — sửa 18/11 theo rà soát). Tờ Đợt 6 và các tờ vẽ hoặc sửa sau đó theo điểm 23, 24 vẫn là bản nháp: quy tắc sản phẩm trong đó là đề xuất; chỗ trái mục 2 thì mục 2 thắng. Màn nào vẫn chưa có tờ riêng: **không tự bịa giao diện**; dựng từ các tờ thành phần + khung trang đã có và ghi rõ trong PR là "chưa có tờ thiết kế riêng". Chỗ nào gói việc ghi "chưa có tờ thiết kế" mà nay đã có tờ trong `thiet-ke/` thì dùng tờ đó.

## 7. Khi gặp vướng mắc

- Thiếu quyết định sản phẩm (ví dụ số ngày giữ đơn, chính sách hết lượt): không tự chọn. Làm thành giá trị cấu hình có mặc định an toàn, ghi `CẦN ANH ANDY QUYẾT` trong PR, tiếp tục phần không phụ thuộc.
- Test đang ghim đường dẫn/chuỗi bị vỡ do thay đổi có chủ ý: sửa test trong cùng PR, liệt kê từng test đã sửa và lý do. Nếu vỡ quá 30 test ngoài dự kiến: dừng, báo danh sách, không sửa hàng loạt bằng tìm-thay.
- Mã hiện tại khác mô tả trong gói việc: mã thắng. Báo chỗ khác, đề xuất chỉnh gói việc.
- Hai bot cùng cần sửa một file: bot có nhiệm vụ đứng trước trong bảng phụ thuộc làm trước; bot sau rebase. Không sửa song song cùng file.
- Cần số migration mới: xem `backend/migrations/README.md` (và sổ đăng ký nếu đã có); không tự nhảy số, không đổi số cũ.
- Bị chặn thật sự: báo cáo ngắn gồm việc đang làm, điều chặn, bằng chứng (lệnh + đầu ra), hai phương án và phương án đề nghị. Trong lúc chờ, làm nhiệm vụ độc lập kế tiếp.

## 8. Mẫu báo cáo sau mỗi nhiệm vụ

```
Nhiệm vụ: <mã, ví dụ G4-T03>
Trạng thái: xong chờ merge | bị chặn | cần quyết định
PR: <link> · nhánh · SHA đầu nhánh
Đã đổi: <3–6 dòng, nói theo hành vi người dùng thấy>
Đã kiểm: <lệnh> → <kết quả; số test chạy / bỏ qua>
Chưa kiểm: <môi trường hoặc ca chưa thử>
Khác với gói việc: <không | mô tả>
Cần anh Andy quyết: <không | câu hỏi cụ thể kèm đề xuất>
```

Phân biệt rõ bốn trạng thái: đã có ở nhánh · đã merge vào `staging` · đã lên production · đã được người dùng nghiệm thu. Không nói "xong" khi mới ở trạng thái đầu.

## 9. Định nghĩa "xong" cho một nhiệm vụ

- Mọi tiêu chí nghiệm thu trong nhiệm vụ có bằng chứng (test tự động, hoặc bước kiểm tay có ghi lại).
- Bộ test của tầng bị ảnh hưởng chạy qua trên máy trước khi đẩy; CI của PR xanh ở đúng SHA đầu nhánh.
- Giao diện: khớp tờ thiết kế ở 1280px và 390px, cả trạng thái rỗng, đang tải, lỗi; nhãn theo mục 3; dùng được bằng bàn phím; chữ đạt tương phản.
- Không còn file tạm, log, khoá bí mật trong commit.
