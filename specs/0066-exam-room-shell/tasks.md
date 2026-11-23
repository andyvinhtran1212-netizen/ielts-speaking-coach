# Tasks

- [ ] T001 (G08-T02) Logic thuần: bộ chuỗi Anh/Việt, mô hình dải câu, tỉ lệ cột, chặn nộp, trạng thái kết nối, chặn hai tab, `examRoomEnabled` + trường `examRoomSurfaces` trong `generate-runtime-config.mjs`; test hành vi bằng `node --test`. `owns: frontend/lib/exam-room/, frontend/tooling/generate-runtime-config.mjs, frontend/tests/exam-room-*.test.mjs`
- [ ] T002 (G08-T03) `ExamRoomShell` và thành phần con trên component G03, CSS module gốc `[data-exam-room]`; test React. `depends: T001` `owns: frontend/components/exam-room/*.tsx, frontend/components/exam-room/exam-room.module.css, frontend/tests/react/exam-room-shell.test.tsx`
- [ ] T003 [P] (G08-T04) Dạng câu dùng chung, giữ nguyên chuỗi `user_answer` của từng bề mặt; test React và test so chuỗi đáp án với trình hiện tại. `depends: T002` `owns: frontend/components/exam-room/questions/, frontend/tests/react/exam-room-questions.test.tsx`
- [ ] T004 [P] (G08-T05) Trình phát audio (`practice`/`test`/`once`) và Highlight/Note; test React. `depends: T002` `owns: frontend/components/exam-room/audio-player.tsx, frontend/components/exam-room/annotation-layer.tsx, frontend/tests/react/exam-room-audio.test.tsx`
- [ ] T005 Review độc lập (CR/SA, `/ui-review`) và cập nhật `verification.md`. `depends: T003, T004`
