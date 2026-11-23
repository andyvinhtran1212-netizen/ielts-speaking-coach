# Tasks

- [ ] T001 (G08-T09) Hàm thuần `writing-draft-recovery.mjs` (FR-009) và test `node --test`. Phụ thuộc EXAMROOM-0066 T001. `owns: frontend/lib/writing-draft-recovery.mjs, frontend/tests/writing-draft-recovery.test.mjs`
- [ ] T002 (G08-T09) Nhánh `writing-exam-room.tsx` sau `examRoomEnabled('writing')`: bộ đếm và cảnh báo theo Task, hộp thiếu từ và hộp hỏi lại thay hai `confirm()`, trạng thái lưu có giờ, bản sao tại máy, khôi phục, đóng X, mất mạng, 401 với `noRedirect`, tab khác, thanh tập trung cho bài có giờ, 402. Phụ thuộc EXAMROOM-0066 T001–T004. `depends: T001` `owns: frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx, frontend/app/(authed-writing)/writing/dashboard/writing-exam-room.tsx`
- [ ] T003 (G08-T09) Bước `clickIfPresent` trong `write-flows/writing-submit.mjs`; Playwright `writing-exam-room.spec.js`; chạy `verify-write-flows.mjs`, `verify-writing-admission-flow.mjs` ở hai nhánh; sửa và liệt kê test đọc nguồn vỡ có chủ ý. `depends: T002` `owns: frontend/tooling/write-flows/writing-submit.mjs, frontend/tests/writing-exam-room.spec.js`
- [ ] T004 Staging: bật `writing` trong `examRoomSurfaces` trên staging; nghiệm thu với bài "QA TEST Task 2 – do not use" theo Scenario 1–7. `depends: T003`
- [ ] T005 Review độc lập (CR/SA, `/ui-review`) và cập nhật `verification.md`. `depends: T003`
- [ ] T006 Production: chỉ khi anh Andy nói rõ cho Writing; giữ nhánh cờ tắt tới khi anh nghiệm thu (gỡ nhánh cũ là G08-T21). `depends: T004, T005`
