# Rollout and rollback

## Preconditions

- Spec này đã được duyệt trên `staging`. Bản thực thi đã merge sau CR, SA và CI xanh.
- `OPENAI_API_KEY` đã có trên Railway staging và production (đang dùng cho Whisper và Sentence Lab).

## Staging

- Owner đặt `WRITING_OPENAI_FALLBACK_MODEL=gpt-6.1-terra` trên staging. Đây là đổi env, cần anh Andy gõ duyệt.
- Ép Claude lỗi cho Writing bằng `ANTHROPIC_MODEL_WRITING_GRADING=claude-does-not-exist` (cũng là đổi env, cần duyệt), chấm 10 bài, kiểm `model_used`, cost và sổ usage, rồi gỡ biến ép lỗi.

## Production

- Promote `staging` → `main` theo quy trình thường lệ. Đặt env trên production cần anh Andy duyệt riêng.

## Rollback and repair

- Xoá `WRITING_OPENAI_FALLBACK_MODEL` (đổi env) thì bậc GPT ngừng ngay sau khi service khởi động lại. Không có dữ liệu nào cần sửa. Bài đã do GPT chấm giữ nguyên `model_used`.

## Observability

- `ai_usage_logs` `feature='writing_grading'` theo provider; tỉ lệ bài do Gemini, GPT hay Claude chấm (`writing_feedback.model_used`); sổ lỗi AI provider `openai`. Người theo dõi: anh Andy.
