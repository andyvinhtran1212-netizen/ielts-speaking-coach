# AI model and usage-ledger rollout — 2026-09-18

## Chốt phạm vi

Đợt này nâng các đường gọi có rủi ro thấp, giữ nguyên các model chấm cần dữ
liệu hiệu chuẩn, và thay cơ chế ước tính chi phí rời rạc bằng một ledger theo
từng lần gọi. Hóa đơn của nhà cung cấp vẫn là nguồn sự thật cuối cùng; số trong
ứng dụng là ước tính có phiên bản giá để đối soát.

## Quyết định model

| Luồng | Chốt sau audit | Lý do |
|---|---|---|
| Speaking grading chính | `gemini-3.5-flash` | Giữ nguyên hành vi chấm hiện tại |
| Speaking fallback nhanh | `claude-haiku-4-5-20251001` | Giữ nguyên |
| Speaking fallback cuối | `claude-sonnet-5` | Nâng cùng dòng; request không gửi temperature và tắt thinking cho JSON xác định |
| Writing grading | `gemini-2.5-pro` mặc định | Chưa thay baseline chấm; 3.8 Flash chỉ thêm lựa chọn để A/B |
| Writing model mức thấp / fallback | `gemini-2.5-flash` | Giữ nguyên |
| Listening content audit | `gemini-3.8-flash` | Luồng cấu trúc, rủi ro thấp, có rollback qua biến môi trường |
| Course short-writing check | `gemini-3.5-flash-lite` | Thay model 3.1 Flash-Lite không còn phù hợp |
| Speaking STT | `whisper-1` mặc định | Giữ vì pipeline đang dùng verbose JSON, duration và timestamp; `gpt-transcribe` chỉ sẵn sàng cho A/B |
| Pronunciation | Azure Pronunciation Assessment | Không phải LLM để “nâng model”; cần hiệu chuẩn điểm Azure → IELTS bằng gold set |
| TTS | OpenAI `tts-1`, ElevenLabs `eleven_multilingual_v2`, Kokoro v1 | Giữ nguyên; OpenAI/ElevenLabs được định giá theo ký tự, Kokoro là local |

Lưu ý tương thích: request tới Gemini 3.8 không gửi `temperature`, `top_p`,
`top_k` hoặc `candidate_count`, theo migration guide chính thức. Các model cũ
giữ cấu hình sampling hiện tại cho đến khi có A/B riêng.

## Thứ tự triển khai bắt buộc

1. Áp dụng `backend/migrations/284_ai_usage_ledger.sql` trên staging.
2. Xác nhận index `idx_ai_usage_event_id` là unique **không có WHERE**; PostgREST
   không thể suy luận partial index cho `ON CONFLICT`.
3. Deploy backend lên staging. Schema cũ có fallback tạm thời nhưng không phải
   trạng thái vận hành đích; trước migration, hệ thống cố ý không ghi các event
   lỗi/unpriced vì schema cũ sẽ biến chúng thành “success $0” sai sự thật. Event
   Writing cũng không fallback vào schema cũ vì `writing_feedback` đã giữ chi
   phí; mất `feature`/`usage_event_id` sẽ khiến dashboard đếm đôi.
4. Chạy smoke cho Speaking, Writing, Listening audit, course writing, TTS và
   pronunciation; xác nhận mỗi provider attempt tạo đúng một ledger row, lỗi có
   `status=error` + `error_code`, và `user_id` của Writing là `users.id` (không
   phải `students.id`).
5. Đối chiếu dashboard `/admin/system/ai-usage` với mẫu response thực và hóa đơn
   provider. Cảnh báo schema cũ/truncation phải bằng `false` trước khi promote.
6. Theo dõi 24–48 giờ: tỷ lệ lỗi/fallback, call không định giá, chi phí theo
   feature/model và chênh lệch ledger–invoice.
7. Chỉ sau đó promote cùng migration + release lên production.

## Gate chưa được phép tự suy diễn

- **Azure pronunciation:** cần tập audio có band phát âm do giáo viên chấm, tối
  thiểu đủ mẫu theo band/giọng/độ dài; đo MAE, sai lệch theo band và tỷ lệ null.
  Không đổi mapping điểm chỉ dựa trên Azure score.
- **Gemini 2.5 Pro cho Writing:** không nâng mặc định chỉ vì model mới hơn. Chạy
  A/B mù với cùng rubric/prompt trên gold set, so band agreement, false-positive
  grammar, chất lượng feedback, latency và chi phí. Promote khi chất lượng không
  giảm và tiêu chí chi phí/độ trễ đạt ngưỡng đã chốt.
- **STT:** `gpt-transcribe` phải qua A/B cho accent IELTS và kiểm chứng duration,
  reliability, word timestamp. Nếu thiếu signal, giữ `whisper-1`.

## Kiểm chứng và rollback

- Test backend phải phủ catalog giá theo ngày hiệu lực, idempotency/schema
  fallback, retry/fallback provider, dashboard merge lịch sử Writing và chống
  đếm đôi.
- Test frontend phải phủ model được chọn và metadata “legacy/truncated”.
- Rollback model bằng biến môi trường tương ứng. Không rollback migration bằng
  cách drop cột vì sẽ làm mất lịch sử observability.
- Nếu ledger lỗi, grading/TTS/pronunciation vẫn tiếp tục theo nguyên tắc
  best-effort; ghi ledger chạy ngoài timeout của provider để một lần ghi DB chậm
  không làm retry một API call đã tính phí. Dashboard phải báo rõ
  schema/lookup/truncation, không hiển thị 0 như thể dữ liệu đầy đủ.
