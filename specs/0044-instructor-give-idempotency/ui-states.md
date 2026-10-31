# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| /instructor "Giao một đề bài" (`instructor-dashboard.tsx`), class and individual | Unchanged: "Đang giao…", other mutations disabled, synchronous lock (PC-J114) | Unchanged: "Lớp này chưa có học viên nào." (400) | Unchanged banners "Đã giao bài cho lớp." / "Đã giao bài cho học viên." — also for a replayed request; form reset; a new `request_id` next time | Error banner as today (message + canonical refetch, no automatic resend). Pressing "Giao bài" again with the same form resends the same `request_id` → the first result, never a second give. 409 "Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại." / "Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại." shown in the same banner (reachable only by API misuse or a reused tab). A tab opened before the deploy gets 422 until reload | Own prompts, classes and learners; 403 generic as today | No layout change; banner is the existing live region; desktop/mobile, light/dark |

Canonical data is `writing_assignments`. After every give, settled or
refused, the dashboard refetches; a reload shows the same single give.
