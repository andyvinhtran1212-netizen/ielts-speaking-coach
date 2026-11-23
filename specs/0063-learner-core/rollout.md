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
- Bản sửa đổi 1 (không migration): PR T15 sau T05, T13; PR T16 sau T05, T13 và LEARNERNAV-0062 T12a. Mỗi PR đổi registry sang `live` cùng commit với trang, nên thanh 5 mục của mọi người trỏ tới `/course`, `/practice` ngay khi merge; người tắt cờ được thay URL về trang tạm như hôm nay. Chạy kịch bản 7–9 ở `verification.md` với tài khoản QA.
- Bản sửa đổi 2 (không migration): PR T17 sau T05; PR T26 (high-risk auth) cuối cùng, sau T13, T14, T17, backend trước frontend trong cùng PR là an toàn vì frontend đọc mềm `learner_v2_enabled`. Sau T26: tạo tài khoản QA mới bằng mã email (chưa kích hoạt), bật cờ lẻ cho đúng tài khoản đó, chạy kịch bản 10–12; tắt cờ và kiểm tài khoản đó về `/login`. Báo G05 gỡ cờ tạm `AVER_HOME_OPEN_TO_INACTIVE` chỉ khi `learner_v2_all` được bật (quyết định riêng của anh Andy).

## Production

- Chỉ qua PR promote `staging → main`; migration production áp trước mã phụ thuộc, qua runner có khoá advisory, sau khi anh Andy gõ duyệt cho đúng lần áp.
- Lên production với mọi cờ tắt: không ai thấy đổi gì. Bật `learner_v2` trên production (dù lẻ) là quyết định riêng của anh Andy, không nằm trong spec này.

## Rollback and repair

- Giao diện: tắt `runtime_flags('learner_v2')` (và `learner_v2_all` nếu đã bật) — hiệu lực khi tải lại sau bộ đệm 15 giây, cây cũ không đổi nên an toàn.
- API: revert PR T13; route mới không có người gọi nào ngoài cây mới (cây mới ẩn khi cờ tắt).
- Cờ: revert PR T05; frontend đọc mềm nên thiếu trường = false.
- Lộ trình, Luyện tập, Thi thử (bản sửa đổi 1): tắt `runtime_flags('learner_v2')` đưa người bật lẻ về trang tạm; revert PR T15/T16 đưa registry về `planned` và thanh 5 mục về `NAV_PLAN.today`. Hai API mới chỉ đọc, không dữ liệu nào phải sửa.
- Tài khoản chưa kích hoạt (bản sửa đổi 2): tắt `runtime_flags('learner_v2')`: sau bộ đệm cờ 15 giây, lần tải trang kế tiếp của tài khoản chưa kích hoạt (tab của họ không có dấu đã kích hoạt nên lần tải nào cũng hỏi `check-active`) đưa họ về `/login` như hôm nay; trang đang mở không bị đẩy ra giữa chừng, còn hai route miễn trả 403 như cổng ngay khi cờ tắt (handler đọc cờ); revert PR T26 bỏ hai dòng miễn cổng và quyết định `inactive_open` cùng lúc. `PATCH /auth/profile` còn tắt được riêng bằng cờ `profile_update` hiện có.
- Migration: cột nullable, mã cũ không đọc; giữ cột khi revert mã. Chỉ chạy `rollback/<số>_users_today_seen_at.sql` khi anh Andy duyệt, vì mất mốc "lần vào trước" (hệ quả duy nhất: lần sau "Vừa có kết quả" tính lại từ 7 ngày).

## Observability

- Log mỗi lần gọi `/api/student/today`: thời gian từng phần, tên phần lỗi trong `degraded`, không ghi tên, email, nội dung bài. Đếm tỉ lệ phản hồi có `degraded` không rỗng; > 5% trong một giờ trên staging → dừng bật thêm người.
- Log `POST /api/student/today/seen` thất bại (mức warning, có `user_id` băm hoặc id nội bộ, không email).
- Bật/tắt cờ lẻ ghi log admin như `vocab-flag` hiện có.
- (Bản sửa đổi 1) Log `/api/student/course`, `/api/student/tests` như `/api/student/today`: thời gian từng phần, tên phần trong `degraded`, không tên, email, nội dung bài; cùng ngưỡng 5% dừng bật thêm người.
- (Bản sửa đổi 2) Đếm lời gọi đã miễn cổng của tài khoản chưa kích hoạt tới `/api/student/today` và `PATCH /auth/profile` (theo id nội bộ, không email); bất kỳ 2xx nào của tài khoản chưa kích hoạt ở route học viên khác là sự cố, dừng và revert T26.
