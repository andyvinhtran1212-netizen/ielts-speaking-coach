# Tasks

- [ ] T001 (G08-T07) Nhánh `reading-exam-room.tsx` sau `examRoomEnabled('reading')`, một chỗ rẽ nhánh sau các hook; thanh trên không email; hộp "Start a new attempt"; tay nắm, dải câu, cờ xem lại một điều khiển; trạng thái lưu; nộp; thoát; mất mạng; 401 với `noRedirect`; tab khác; nhúng; xem trước admin; Highlight/Note. Phụ thuộc EXAMROOM-0066 T001–T004 đã merge. `owns: frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx, frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-room.tsx`
- [ ] T002 (G08-T07) Playwright `exam-room.spec.js` với `?exam_room=on`; chạy bộ `reading-native` cũ, write-flow `reading-exam-*`, `verify-mock-exam-flow.mjs`; sửa và liệt kê test đọc nguồn vỡ có chủ ý. `depends: T001` `owns: frontend/tests/reading-native/exam-room.spec.js`
- [ ] T003 (G08-T23, phần Reading) Route `POST /api/reading/test/attempts/{id}/abandon`, sinh lại `types/api.d.ts`, nút "Abandon test" cho đề tự chọn; pytest và journey. `depends: T001` `owns: backend/routers/reading_student.py, backend/tests/test_reading_abandon_attempt.py, frontend/types/api.d.ts`
- [ ] T004 Staging: bật `reading` trong `examRoomSurfaces` trên staging; nghiệm thu GOI-08 mục 9 với tài khoản QA và đề AVR-READ-001; ghi lượt đã làm để admin dọn. `depends: T002, T003`
- [ ] T005 Review độc lập (CR/SA, `/ui-review`) và cập nhật `verification.md`. `depends: T002, T003`
- [ ] T006 Production: chỉ khi anh Andy nói rõ cho Reading; giữ nhánh cờ tắt tới khi anh nghiệm thu (gỡ nhánh cũ là G08-T21). `depends: T004, T005`
