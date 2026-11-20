# Tasks

Tasks are dependency ordered. Anh Vinh đã duyệt spec (t1543s5028, 11:25 ngày
10/11/2026), nhưng spec phải merge vào `staging` (qua PR spec do FD mở) trước. Code ticket chỉ được xếp hàng sau khi spec
đã merge vào `staging`, và do Leader xếp. Không tạo job qua `newjob` khi Leader chưa
xếp. Owner, cỡ, mức review và hạn xem bảng ở plan.md "Work decomposition".
Lát STT được ưu tiên review và QA trước.

- [ ] T001 Thăm dò hợp đồng `gpt-transcribe` **chỉ trên staging**, tối đa 5 lần gọi API, không đổi env, không ghi prod, hạn 17/11/2026. Nếu là job code thì Leader xếp hàng. Ghi các trường trả về vào plan.md. `owns: báo cáo trong verification.md` `depends: Leader budget`
- [ ] T002 Adapter STT theo bảng năng lực; `transcript_model` thật; word timestamps chỉ cho whisper-1; kiểm ffprobe; admin regrade dùng chung (FR-001, FR-002, FR-004, FR-005, FR-008). `owns: backend/services/whisper.py, backend/routers/grading.py (khối STT), backend/routers/admin.py (khối regrade STT)` `depends: T001`
- [ ] T003 Hiệu chỉnh độ tin cậy khi không có tín hiệu đoạn (FR-003). `owns: backend/services/transcript_reliability.py` `depends: T001, T005 (dữ liệu)`
- [ ] T004 [P] Bảng ngày tắt model + cảnh báo + chặn gọi (FR-015). `owns: backend/services/model_retirement.py (mới)`
- [ ] T005a Security Auditor kiểm script trích ~60 bản ghi Speaking prod ở dạng ẩn danh (chỉ đọc; không lấy email/tên/user_id thô; lưu private; xoá sau 30 ngày) **trước khi** script đọc dữ liệu prod (Q3, t1543s5028). Chạy script cần quyền đọc prod do anh Vinh cấp cho đúng job đó. `owns: backend/eval/stt_ab/extract_prod_sample.* (mới)` `depends: T002`
- [ ] T005 Harness A/B STT, chạy và báo cáo (FR-019). Chỉ dùng dữ liệu prod sau khi T005a được SA duyệt. Trước đó chỉ dùng dữ liệu staging hoặc nội bộ. `owns: backend/eval/stt_ab/ (mới), verification.md` `depends: T002, T005a (dữ liệu prod), Leader budget`
- [ ] T006 Dự phòng STT một lần + giá có nguồn (FR-006, FR-007). `owns: backend/services/whisper.py (sau T002), backend/services/ai_pricing.py` `depends: T002, T004, Q4`
- [ ] T007 [P] A/B TTS (tts-1 mốc, ElevenLabs, gpt-realtime-2.1-mini, Kokoro offline) (FR-011, FR-019). `owns: backend/eval/tts_ab/ (mới)` `depends: Leader budget`
- [ ] T008 Engine TTS thay thế cho `/tts`, ánh xạ giọng, usage log model thật, giá, runtime flag `question_tts_ai` (FR-006, FR-009, FR-010, FR-011, FR-014, FR-016). `owns: backend/services/tts_audio.py, backend/routers/tts.py, backend/services/ai_pricing.py (dòng TTS)` `depends: T007, Q1`
- [ ] T009 Render admin bằng engine mới, khoá provider mới, giữ tag cũ (FR-012, FR-013). `owns: backend/services/speaking_question_audio.py, backend/routers/admin_class_assignments.py (nhóm giọng)` `depends: T008`
- [ ] T010 Frontend: 503 `tts_disabled` im lặng, dòng công bố giọng AI nếu Q6 = có, `api.d.ts` (FR-016, FR-018). Review UI: CR + Product QA. `owns: frontend/public/js/practice.js, frontend/types/api.d.ts` `depends: T008, Q6`
- [ ] T011 QA staging: T011a TTS (trước 16/12/2026), T011b STT (trước 08/01/2027), gồm diễn tập kill switch và rollback env. `depends: T008-T010; T002-T006`
- [ ] T012 Release TTS lên prod (anh Vinh duyệt), đọc lại env và usage 48 giờ. `depends: T011a`
- [ ] T013 Release STT lên prod (anh Vinh duyệt): Release Manager đặt env `WHISPER_STT_MODEL=gpt-transcribe` (prod hiện chưa đặt biến này, Q7), theo dõi 72 giờ, gỡ `STT_FALLBACK_MODEL` trước 19/02/2027. `depends: T011b`
- [ ] T014 Đổi mặc định code `WHISPER_STT_MODEL` sang `gpt-transcribe`, dọn nhánh `tts-1`/`whisper-1` sau ngày tắt (giữ giá để tính lại log cũ và tag nhận diện clip cũ). `depends: 26/02/2027`
