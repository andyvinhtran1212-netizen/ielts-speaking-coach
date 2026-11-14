# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_whisper_model_config.py (gpt-transcribe gửi languages=["en"] và không gửi language; whisper-1 gửi language="en"; model lạ → config_invalid trước provider giả) + kết quả thăm dò T001 | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_grading_whisper_latency.py + test admin regrade (transcript_model và ai_usage_logs.model bằng model adapter trả về, kể cả model dự phòng) | PENDING |
| FR-003 | kind=report; ref=báo cáo A/B T005 (mẫu audio xấu ra low 100 %, phân bố nhãn lệch ≤ 10 điểm %) + backend/tests/test_transcript_reliability.py (mới) + backend/tests/test_grading_reliability_caps.py (segments=[] với mẫu ồn ra low, mẫu sạch ra high; ngưỡng bị khoá) | PENDING |
| FR-004 | kind=check; ref=test/health check ffprobe có trên image staging và prod + báo cáo T005 (duration không biết = 0) + log duration_unknown | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_whisper_model_config.py (cờ bật + gpt-transcribe → không gửi timestamp_granularities, một cảnh báo, words rỗng) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_ai_pricing.py (mọi model được phép chạy có UnitRate/TokenRate kèm nguồn; estimate_or_none khác None) | PENDING |
| FR-007 | kind=test; ref=test dự phòng STT (5xx/timeout → đúng một lần whisper-1; 4xx → không dự phòng; hai dòng usage, hai grading_events; retry_safe không tăng grading_attempts) | PENDING |
| FR-008 | kind=test; ref=test admin regrade dùng adapter, dự phòng và usage đúng model | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_tts_entitlement.py (QUESTION_TTS_ENGINE chọn engine; thứ tự chốt không đổi; response audio/mpeg, no-store) | PENDING |
| FR-010 | kind=test; ref=test ánh xạ giọng (nova và giá trị lạ → giọng đã duyệt) | PENDING |
| FR-011 | kind=report; ref=báo cáo A/B T007 (phiên âm ngược WER ≤ 2 %, 0 từ thêm) + test giới hạn độ dài đầu ra nếu engine A | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_speaking_question_audio.py (clip openai cũ vẫn là provider openai; khoá mới; nhóm giọng không trộn) + journey staging admin tạo audio | PENDING |
| FR-013 | kind=test; ref=test audio_path (tag mới khác mọi tag cũ; tag openai-tts-1 giữ; không upload đè object đã có) | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_ai_usage_logger.py (service/model thật, token nếu có, self-hosted cost 0) + quota question_tts không đổi | PENDING |
| FR-015 | kind=test; ref=test model_retirement với đồng hồ giả (05/01, 06/01, 25/02, 26/02; cảnh báo trước 30 ngày; không gọi model đã tắt) | PENDING |
| FR-016 | kind=test; ref=test /tts flag tắt và lỗi đọc flag → 503 tts_disabled, provider giả không gọi + journey staging trình duyệt dùng speechSynthesis không toast | PENDING |
| FR-017 | kind=check; ref=review CR+SA đường log STT/TTS (không log transcript, chữ TTS, key) + grep log staging sau QA | PENDING |
| FR-018 | kind=screenshot; ref=ảnh staging dòng "Giọng đọc do AI tạo" ở 360 px và desktop, hoặc ghi quyết định Q6 = không | PENDING |
| FR-019 | kind=report; ref=báo cáo A/B STT và TTS trong verification.md, kèm chi phí thực tế ≤ trần Leader xác nhận | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` khớp OpenAPI sau T010 (thêm 503 `tts_disabled`).
- Backward compatibility: shape `/tts`, `/sessions/{id}/responses`, render-audio không đổi.

## Data evidence

- Migration/schema query: không có migration.
- Immediate state versus full reload: `transcript_model` và `transcript_reliability` lưu đúng sau reload trang kết quả.

## UI evidence

- Viewports/themes/input methods: 360 px, desktop; sáng/tối; screen reader đọc được dòng công bố (nếu Q6 = có).

## Release evidence

- Staging SHA and checks: ghi SHA và CI của T011a và T011b.
- Production verification: env đọc lại (Q7), usage theo model 48 giờ (TTS) và 72 giờ (STT), không còn dòng `tts-1` sau 18/12/2026 và không còn `whisper-1` làm model chính sau 22/01/2027.
