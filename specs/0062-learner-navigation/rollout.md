# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging` (anh Andy duyệt, `approval-decision.md`).
- Đợt 8 cần `/course` có thật (LEARNERCORE-0063, G07-T15 PR 1). Đợt 9 cần câu trả lời câu hỏi mở 2 và `/progress`.
- Đợt 7b: các đợt 1–7a đã chạy ổn trên staging; anh Andy cho biết lịch thi thử để triển khai ngoài lịch; không PR nào của G08 đang mở cùng `mock-exam-runner.tsx` (nếu có, gói đứng trước làm trước, gói sau rebase).
- Không migration, không cờ: chuyển hướng áp cho mọi người dùng ngay khi bản lên.

## Staging

- Một đợt một PR. Sau merge: chờ CI tích hợp và Staging E2E xanh đúng SHA, rồi chạy kịch bản tương ứng ở `verification.md` bằng tài khoản QA, ghi kết quả vào PR hoặc sổ việc.
- `curl -sI` từng đường cũ của đợt trên staging (có query): mong đợi `307` và `location:` đúng đích, một bước.
- Đợt 7b: mở một lượt thi QA trước khi triển khai preview, bấm chuyển phần sau khi preview lên (FR-017).
- Đợt 3, 4: PR backend `class_student.py` chỉ mở sau khi PR frontend đã lên staging và kịch bản 4 qua.

## Production

- Chỉ qua PR promote `staging → main` theo `docs/STAGING_FIRST_RELEASE_FLOW.md`; không PR đợt nào vào thẳng `main`.
- Sau promote: `curl -sI` chỉ đọc trên `https://www.averlearning.com` cho từng đường cũ của đợt. Không đăng nhập bằng tài khoản học viên thật, không nộp bài, không bật cờ.
- Chốt 308 (G07-T24) chỉ khi anh Andy nói, sau khi xong mọi đợt và 14 ngày ổn định.

## Rollback and repair

- Trong giai đoạn 307: `git revert` PR của đợt lỗi (khôi phục thư mục và xoá quy tắc chuyển hướng trong cùng commit, cổng sở hữu route vẫn sạch), merge vào `staging`, promote như bình thường. Trình duyệt không nhớ 307 nên link cũ sống lại ngay.
- Đợt có PR backend (3, 4): revert backend trước, frontend sau; frontend nhận hai dạng link nên thứ tự ngược lại vẫn mở được bài.
- Đợt 7b: `exam-language-bridge.tsx` giữ cả URL cũ trong tập nên lùi không đổi ngôn ngữ giữa chừng.
- Sau 308: không lùi được ở trình duyệt đã nhớ. Sửa tiến: thêm trang hoặc quy tắc ở đích mới. Đây là lý do 308 để sau cùng.

## Observability

- Log truy cập Vercel: đếm request tới các đường cũ (mong đợi giảm dần; còn nhiều sau 14 ngày → còn link nội bộ hoặc link ngoài cần sửa trước khi chốt 308).
- 404 trên Vercel cho đường dưới `/course/`, `/tests/`, `/vocabulary/` mới: phải bằng 0 sau mỗi đợt.
- Báo lỗi học viên qua giáo viên về "bài không mở được": người thực thi đối chiếu với đợt vừa lên.
- Không ghi email, tên, mã đơn hay nội dung bài vào log hay PR.
