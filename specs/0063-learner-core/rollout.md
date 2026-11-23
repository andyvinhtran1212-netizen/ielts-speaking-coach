# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging` (anh Andy duyệt, `approval-decision.md`).
- Số migration trong dải 420–439 chưa bị file hay PR khác dùng; dòng `register.tsv` thêm cùng PR T13.
- Cờ mặc định tắt: `runtime_flags('learner_v2')` và `runtime_flags('learner_v2_all')` tắt; không người nào có `feature_flags.learner_v2 = true`.
- Khung `LearnerShell` của G03 đã ở staging (#2445).

## Staging

- Thứ tự: migration `today_seen_at` (runner có khoá advisory, anh Andy gõ duyệt cho lần áp; đọc lại cột bằng `information_schema.columns`) → PR T13 → PR T05 → PR T14. Mỗi PR chờ CI tích hợp và Staging E2E xanh đúng SHA.
- Sau T05 + T14: bật `runtime_flags('learner_v2')` trên staging (ghi trong PR ai bật, lúc nào), bật cờ lẻ cho tài khoản QA bằng endpoint admin; chạy kịch bản 1–6 ở `verification.md`; ảnh 1280px và 390px; tắt khẩn và chụp lại giao diện cũ.
- Không bật cờ cho tài khoản học viên thật trên staging.

## Production

- Chỉ qua PR promote `staging → main`; migration production áp trước mã phụ thuộc, qua runner có khoá advisory, sau khi anh Andy gõ duyệt cho đúng lần áp.
- Lên production với mọi cờ tắt: không ai thấy đổi gì. Bật `learner_v2` trên production (dù lẻ) là quyết định riêng của anh Andy, không nằm trong spec này.

## Rollback and repair

- Giao diện: tắt `runtime_flags('learner_v2')` (và `learner_v2_all` nếu đã bật) — hiệu lực khi tải lại sau bộ đệm 15 giây, cây cũ không đổi nên an toàn.
- API: revert PR T13; route mới không có người gọi nào ngoài cây mới (cây mới ẩn khi cờ tắt).
- Cờ: revert PR T05; frontend đọc mềm nên thiếu trường = false.
- Migration: cột nullable, mã cũ không đọc; giữ cột khi revert mã. Chỉ chạy `rollback/<số>_users_today_seen_at.sql` khi anh Andy duyệt, vì mất mốc "lần vào trước" (hệ quả duy nhất: lần sau "Vừa có kết quả" tính lại từ 7 ngày).

## Observability

- Log mỗi lần gọi `/api/student/today`: thời gian từng phần, tên phần lỗi trong `degraded`, không ghi tên, email, nội dung bài. Đếm tỉ lệ phản hồi có `degraded` không rỗng; > 5% trong một giờ trên staging → dừng bật thêm người.
- Log ghi `today_seen_at` thất bại (mức warning, có `user_id` băm hoặc id nội bộ, không email).
- Bật/tắt cờ lẻ ghi log admin như `vocab-flag` hiện có.
