# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging` (anh Andy duyệt, `approval-decision.md`).
- Số migration trong dải 420–439 còn trống; dòng `register.tsv` thêm cùng PR T21.
- Cờ `learner_v2` của LEARNERCORE-0063 đã có, mặc định tắt.
- Truy vấn chỉ đọc trên staging trả 0 dòng có `reason` ngoài 50–500 ký tự.

## Staging

- Thứ tự: T27 → T20 → T21 (áp migration qua runner có khoá advisory, anh Andy gõ duyệt cho đúng lần áp; đọc lại ràng buộc) → T22. Mỗi PR chờ CI tích hợp và Staging E2E xanh đúng SHA.
- Bật cờ `learner_v2` cho tài khoản QA rồi chạy kịch bản 1–5 ở `verification.md`; chụp ảnh ba phiếu ở 390px và 1280px.
- Kịch bản 2 (dạng cũ) chạy trên chính staging sau T21 để chứng minh frontend cũ vẫn gửi được.

## Production

- Chỉ đi qua PR promote `staging → main`. Migration production áp trước mã phụ thuộc, qua runner có khoá advisory, sau khi anh Andy gõ duyệt cho đúng lần áp. Truy vấn chỉ đọc chạy ngay trước lúc áp.
- Lên production với cờ tắt: phiếu cũ giữ nguyên. API chấm lại nhận thêm dạng mới, nhưng chưa frontend nào gửi dạng đó.
- Bật `learner_v2` trên production là quyết định riêng của anh Andy.

## Rollback and repair

- **Mã:** `git revert` PR lỗi, merge vào `staging`, rồi promote. Cây phiếu cũ vẫn còn, nên tắt cờ là cách lùi nhanh nhất.
- **API:** revert T21 khiến dạng mới bị 422. Frontend cũ không bị ảnh hưởng, vì vẫn gửi `{reason}`.
- **Migration:** giữ hai cột khi revert mã, vì dữ liệu mới vẫn hợp lệ. Chỉ chạy rollback khi anh Andy duyệt. Rollback từ chối khi có dòng `reason_code IS NOT NULL`, trừ khi đặt `aver.allow_regrade_reason_rollback = 'on'`; khi đó ràng buộc cũ được thêm lại dạng `NOT VALID`.

## Observability

- **Log chấm lại:** mỗi yêu cầu ghi mức info `[regrade] shape=old|new reason_code=<mã>`, không ghi nội dung. Đếm dạng cũ theo ngày để quyết ngày gỡ (câu hỏi mở 1).
- **Log ẩn Overall:** `[result] overall_suppressed` khi frontend ẩn `overall` do backend trả sai chỗ. Đếm theo ngày và báo G02 nếu khác 0.
- **Khối hết lượt:** đếm số lần hiện `CreditsEmptyNotice` theo `credit_source` (sự kiện phía client nếu đã có kênh; chưa có thì bỏ qua).
- Không ghi email, tên, nội dung bài, `reason` hay `note` vào log hay PR.
