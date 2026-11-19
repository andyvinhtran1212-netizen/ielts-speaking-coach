# Bàn giao cho người thực thi (project Claude Code của repo averlearning.com)

Bản ngày 18/11/2026, đã qua một lượt rà chéo năm góc và áp 79 phát hiện. Có hiệu lực từ lúc anh Andy chuyển bản này cho project. Mười một câu đang áp mặc định tạm, chờ anh Andy xác nhận: xem `04-VIEC-DE-LAI.md`, mục "Rà soát trước bàn giao 18/11". Người soạn: phiên thiết kế và spec (gọi là "phiên giám sát" ở dưới).

## 1. Việc này là gì

Thương mại hoá web Aver Learning (repo `ielts-speaking-coach`: FastAPI + Next.js 16 + Supabase): dựng lại giao diện theo bộ thiết kế "Bản in", thêm khoá học, quyền truy cập, lượt chấm, đơn đăng ký, trang công khai, Thư viện, lõi học viên, phòng thi, admin. Mọi thứ cần biết nằm trong thư mục này của repo: `docs/proposals/commercialization-2026-11/` (bản gốc do phiên giám sát giữ ở `AVER-GROK/` trên máy anh Andy). Tên thư mục có chữ "GROK" vì kế hoạch ban đầu; nay người thực thi là bạn.

## 2. Đọc theo thứ tự này

1. `00-QUY-UOC-CHUNG.md` — đọc hết. Mục 2 (điểm 1–24) là quyết định sản phẩm; **điểm sau thắng điểm trước**. Mục 3 là quy tắc câu chữ. Mục 4 là ràng buộc cứng. Mục 5 là quy trình một nhiệm vụ.
2. `01-KE-HOACH-TONG.md` — năm đợt A–E, phụ thuộc giữa các gói, sổ cấp số spec và số migration (mục 6), câu còn mở (mục 7).
3. Gói bạn sắp làm: `GOI-NN-*.md` (GOI-01 đến GOI-13). Mỗi gói có 10 mục; nhiệm vụ ở mục 6, mỗi nhiệm vụ là một PR.
4. `02-BANG-PHU-THIET-KE.md` — trang nào ứng với tờ thiết kế nào.
5. `thiet-ke/` — 138 tờ `.dc.html` (mở bằng trình duyệt không chạy được nếu thiếu bộ dựng; đọc như HTML, phần "Ghi chú cho lập trình" ở cuối mỗi tờ là quy tắc hành vi). `thiet-ke/CHUAN-ADMIN.md` là bản chuẩn cho mọi màn admin.
6. Khi cần bối cảnh: `khao-sat/` (hiện trạng mã, kiểm duyệt trải nghiệm, hướng phát triển), `03-SO-BRAINSTORM.md`, `04-VIEC-DE-LAI.md`.

Khi tài liệu mâu thuẫn nhau: `00` mục 2 thắng gói; gói viết lại ngày 18/11 thắng gói cũ; tờ thiết kế thắng mô tả bằng chữ về giao diện (ngoại lệ: lượt chấm của mock test được giao — gói thắng tờ, GOI-04 mục 5.6); mã thật thắng mọi mô tả về hiện trạng (nếu thấy gói mô tả sai mã, dừng và báo).

## 3. Ràng buộc cứng (vi phạm là dừng việc)

- Không sửa, không `git pull`, không đổi nhánh ở bản checkout chính `~/code/ielts-speaking-coach`. Mỗi nhiệm vụ làm trong worktree riêng, nhánh tạo từ `origin/staging`, PR vào `staging` (xem `docs/AGENT_WORKFLOW.md` trong repo).
- **Merge chỉ khi anh Andy nói "merge".** Không tự bật auto-merge.
- Production chỉ xem: không nộp bài, không ghi âm, không lưu, không đổi gì; không mở trang tự tạo lượt làm bài; không đăng xuất.
- Không đăng nhập hộ, không nhập mật khẩu hay khoá bí mật. Không in giá trị secrets.
- Không chép dữ liệu cá nhân học viên vào tài liệu, PR hay log.
- Không đụng các phiên làm việc tên "Hermes".
- Thay đổi loại feature hoặc high-risk (chấm điểm, lưu kết quả, auth/RLS, mã kích hoạt, migration, hành vi AI trả phí): phải có thư mục spec được duyệt trước khi viết mã (`specs/README.md`). Số spec và số migration lấy theo `01` mục 6; anh Andy là người duy nhất vận hành repo, không cần hỏi "Leader" nào khác; ghi số đã dùng vào sổ trong repo.
- Không làm yếu test để cho qua. Không thêm test khoá chuỗi mã nguồn. Không gọi AI trả phí trong test.
- Đổi repo sang private chỉ khi anh Andy nói "private".

## 4. Bắt đầu từ đâu (đợt A)

Làm song song được, không phụ thuộc gì:

| Việc | Gói | Vì sao làm trước |
|---|---|---|
| Sửa nhanh các lỗi gây mất tin trên web hiện tại | `GOI-02`; G09-T02 | Nhỏ, độc lập, người dùng thấy ngay |
| Dọn tài liệu repo pha 0 | `GOI-01` T01–T05 | Mở đường cho mọi gói sau |
| Soạn và trình spec nền | G04-T00, G03-T01, G09-T01, G09-T21, G10-T01/T22, G01-T06, G11-T01…T06 | Các gói lớn chờ spec được duyệt |
| Rà dữ liệu Thư viện | G06-T03 (chỉ `--check`), T04, T05, T12, T19 | 19 bộ bài mẫu chưa có trạng thái duyệt, 3 bộ Task 1 thiếu hình |

Sau khi spec nền được duyệt mới sang đợt B (nền giao diện G03, backend khoá học G04, backend admin G09 phần đầu). Thứ tự đầy đủ ở `01` mục 2–3.

## 5. Quy trình một nhiệm vụ

1. Đọc nhiệm vụ trong gói: mục đích, đầu vào, việc làm, nghiệm thu, "không làm", vướng mắc và cách gỡ.
2. Kiểm lại hiện trạng mã mà gói mô tả (gói viết theo `staging` giữa tháng 11; repo có thể đã đổi). Chỗ gói ghi `CHƯA KIỂM` thì chạy lệnh kiểm kèm theo trước khi viết mã.
3. Làm trong worktree riêng; chạy các lệnh kiểm chứng của `docs/AGENT_WORKFLOW.md`.
4. Nghiệm thu trên staging dùng tài khoản QA và phiên đăng nhập có sẵn theo `docs/AGENT_WORKFLOW.md` (mục QA/staging) của repo; nếu file đó không có, dừng ở bước nghiệm thu, ghi "chờ anh Andy kiểm tay trên staging" trong PR, không tự tạo tài khoản (cần anh xác nhận nguồn tài khoản QA và hộp thư nhận mã đăng nhập cho tài khoản QA sau khi bỏ mật khẩu).
5. Mở PR vào `staging` theo mẫu báo cáo ở `00` mục 8: đã đổi gì cho người dùng, kiểm ở môi trường nào, còn thiếu gì. Phân biệt rõ local, đã merge, đã deploy, đã nghiệm thu trên staging.
6. Dừng ở PR. Chờ anh Andy.

Khi gặp chỗ sản phẩm chưa chốt: dùng mặc định tạm ghi ở mục 10 của gói, làm thành cấu hình, và ghi vào PR. Không tự quyết thay anh Andy.

## 6. Phiên giám sát làm gì

Khi anh Andy yêu cầu, phiên giám sát sẽ: đọc PR và đối chiếu với gói và tờ thiết kế; chỉ ra chỗ lệch; trả lời câu hỏi về ý định thiết kế; cập nhật gói khi anh Andy đổi quyết định; tiếp quản một nhiệm vụ nếu anh Andy bảo. Phiên giám sát không merge và không sửa nhánh của bạn.

Để việc giám sát nhanh: mỗi PR ghi mã nhiệm vụ (ví dụ `G04-T03`) ở tiêu đề, và ghi rõ FR nào đã có bằng chứng.

## 7. Điều cần biết trước khi tin tài liệu

- Bộ spec viết bằng cách đọc mã, **chưa có dòng mã nào được chạy thử** theo spec. Coi mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy.
- Bộ gói đã qua một lượt rà chéo năm góc ngày 18/11 (quyết định, số hiệu, độ phủ, GOI-12, GOI-13) và các phát hiện đã áp (nhật ký `ban-lam-viec/ra-soat/6-da-ap.md`); vẫn chưa dòng mã nào chạy thử. Vẫn có thể còn chỗ lệch nhỏ giữa các gói: thấy thì báo, đừng đoán.
- Số phiên ghi ở mỗi nhiệm vụ là ước lượng của người viết, không phải cam kết.
- Cả 138 tờ thiết kế đã được dựng bằng bộ dựng thật của canvas và bấm thử mọi nút, tab, mục mở rộng: không lỗi. Phần tương tác trên tờ vẫn chỉ là minh hoạ, không phải đặc tả đầy đủ.
- Dữ liệu sáu khoá online (học phí, thời hạn, số lượt, ngày mở, tài khoản nhận tiền, hạn giữ đơn) chưa có: để cấu hình và placeholder, không ghi cứng.
- `GOI-12` (sáu hướng phát triển) và `GOI-13` (nhận xét học viên và khảo sát, biên tập 137 bài Grammar Wiki, kiến thức nền, đọc kỹ, khuôn luyện đề đang hoãn) **không thuộc đợt A–E**; đừng làm trước khi anh Andy mở từng phần. Ngoại lệ đã mở: G12-C01…C03 (lưu cặp điểm AI–giáo viên) thuộc đợt D, làm ngay sau G09-T17. Hai gói này viết ngày 18/11 và đã qua lượt rà riêng cùng ngày.

## 8. Câu còn mở

Xem `01` mục 7 và `04-VIEC-DE-LAI.md`. Câu nào chặn nhiệm vụ bạn đang làm thì hỏi anh Andy kèm phương án đề nghị; câu không chặn thì dùng mặc định tạm.
