# Rollout and rollback

## Preconditions

- Spec được anh Vinh duyệt trên `staging`; Q1–Q8 đã có câu trả lời; Leader xác nhận trần ngân sách A/B (≤ 30 USD).
- Báo cáo A/B STT (T005) và TTS (T007) đạt tiêu chí ở plan.md, ghi trong verification.md.
- Không có migration. Runtime flag `question_tts_ai` mặc định bật khi chưa có hàng.
- Prod: Release Manager đã đọc env (Q7, 11:26 ngày 10/11/2026): `WHISPER_STT_MODEL` chưa đặt (mặc định `whisper-1`); `ELEVENLABS_API_KEY`, `AZURE_SPEECH_KEY` và `AZURE_SPEECH_REGION` đã có. Nếu chọn ElevenLabs thì chỉ cần anh Vinh chốt trần `AI_BUDGET_MONTHLY_USD_ELEVENLABS`.

## Staging

- Deploy đúng SHA của T008–T010 (TTS) rồi T002–T006 (STT) lên `staging`; CI xanh.
- Đặt env staging: `QUESTION_TTS_ENGINE=<engine Q1>`, `WHISPER_STT_MODEL=gpt-transcribe`, `STT_FALLBACK_MODEL=whisper-1` (nếu Q4 = có).
- Product QA chạy hành trình T011a/T011b, gồm diễn tập: tắt `question_tts_ai` (giọng trình duyệt), đặt lại `WHISPER_STT_MODEL=whisper-1` (rollback) rồi chuyển lại.
- Soak STT trên staging từ 21/12/2026 đến 08/01/2027.

## Production

- Cần anh Vinh duyệt trực tiếp cho từng lần (TTS 17/12/2026, STT 23/12/2026). Lời duyệt bot khác chuyển lại không tính.
- TTS: Release đặt env, deploy SHA đã QA ngày 18/12/2026, theo dõi 48 giờ: tỉ lệ 2xx `/tts` ≥ 99 %, usage theo model mới, chi phí/ngày.
- STT: đổi `WHISPER_STT_MODEL` ngày 11/01/2027 vào giờ thấp điểm, theo dõi 72 giờ: tỉ lệ 502 STT, phân bố nhãn độ tin cậy so với tuần trước, độ trễ p95, chi phí. Hoàn tất trước 22/01/2027.

## Rollback and repair

- TTS: tắt `question_tts_ai`, học viên dùng giọng trình duyệt ngay (không deploy). Đổi `QUESTION_TTS_ENGINE` về `openai_tts1` chỉ còn hiệu lực đến hết 05/01/2027.
- STT: đặt `WHISPER_STT_MODEL=whisper-1` và khởi động lại, hiệu lực đến hết 25/02/2027. Sau ngày đó không còn model OpenAI file-transcription nào khác ngoài `gpt-transcribe`; sự cố lúc ấy xử lý bằng hotfix hoặc spec dự phòng riêng.
- Không có dữ liệu cần sửa: kết quả chấm đã lưu giữ nguyên `transcript_model` của lúc chấm. Nếu A/B sau triển khai cho thấy lệch band, admin chạy lại chấm theo quy trình regrade hiện có (cần anh Vinh duyệt nếu trên prod).
- Audio sinh sẵn không bị đụng, nên không có gì phải khôi phục.

## Observability

- Log: `[stt] config_invalid`, `[stt] duration_unknown`, `[stt] fallback model=...`, `[stt] fallback_skipped_retired`, `[model_retirement] warning model=... days_left=...`, `[tts] engine=... voice=...`, `[tts] disabled_by_flag`.
- Số liệu: `ai_usage_logs` theo `service`/`model`/`feature`; `grading_events` theo provider; tỉ lệ nhãn `transcript_reliability` theo ngày.
- Ngưỡng cảnh báo: STT 502 > 2 % trong 1 giờ; `/tts` 5xx > 5 % trong 1 giờ; còn dòng model đã tắt sau ngày chuyển.
- Owner: Release Manager theo dõi sau mỗi lần lên prod; Leader nhận cảnh báo; FD đọc báo cáo.
