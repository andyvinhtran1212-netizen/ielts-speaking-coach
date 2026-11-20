# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Luyện tập Speaking, nút nghe đề (`practice.js` `_ttsAI`, `_ttsAISequence`) | Như hiện tại: chờ fetch `/tts`, chưa phát | Không có chữ thì không gọi (đã lọc segment rỗng) | Phát mp3 của engine mới; nếu Q6 = có thì dòng "Giọng đọc do AI tạo" luôn hiện cạnh nút | Mọi lỗi, kể cả 503 `tts_disabled`/`ai_budget_exhausted` và 502: chuyển sang `speechSynthesis` từ đoạn đang đọc, không có toast | 403 entitlement: giữ hành vi hiện tại (dự phòng trình duyệt) | 360 px không vỡ dòng nút; dòng công bố dùng màu chữ phụ hiện có, đủ tương phản ở cả hai theme, có trong cây accessibility |
| Admin chủ đề, nút "Tạo audio" (render-audio) | Nút bận như hiện tại | — | Câu có `audio_url` mới; nhóm giọng mới | 502 "Không tạo được audio" và 409 đổi tên topic: giữ nguyên | Chỉ admin (`require_admin`) | Không đổi |
| Nộp câu trả lời Speaking (STT) | Màn "processing" hiện tại | Transcript rỗng: 422 hiện tại | Kết quả chấm; cảnh báo ghi âm khi nhãn "low" | 502 "Lỗi nhận dạng giọng nói" hiện tại; dự phòng STT không hiện gì thêm cho học viên | Không đổi | Không đổi |

Nguồn dữ liệu chuẩn: `ai_usage_logs` (chi phí, quota) và `session_responses`
(`transcript_model`, `transcript_reliability`). Tải lại trang kết quả phải hiện
cùng nhãn độ tin cậy đã lưu. Focus và bàn phím của nút nghe đề không đổi.
