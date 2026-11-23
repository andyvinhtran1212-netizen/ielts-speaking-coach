# Implementation plan

## Architecture impact

- `backend/config.py`: thêm `WRITING_OPENAI_FALLBACK_MODEL: str = ""` và `WRITING_OPENAI_REASONING_EFFORT: str = "medium"`.
- `backend/services/gemini_writing_grader.py` `_call_with_retry`: khi `_try_claude` (position `first`) trả `None`, gọi `_try_openai(...)` nếu setting có giá trị và `OPENAI_API_KEY` có giá trị, rồi mới tới Gemini. Khi position là `after` hoặc không có Claude, thứ tự giữ nguyên như hôm nay.
- `_try_openai` dùng `AsyncOpenAI` (`max_retries=0`), Chat Completions với `response_format={"type":"json_object"}`, ảnh dạng data URL từ bytes đã tải, kiểm bằng `_validated_text`, sửa lại tối đa một lần, và dùng chung `CLAUDE_TOTAL_BUDGET_S`. Salvage `missing_mistake_analysis` làm theo đúng cách của Claude.
- `services/ai_router.existing_models("writing_grading")` liệt kê thêm bậc GPT khi được bật, để admin AI dashboard thấy model thật.

## Data and contracts

- Không migration, không endpoint mới, không đổi shape response. `writing_feedback.model_used` nhận id model OpenAI. `cost_usd` là tổng các lượt gọi đã bị tính tiền (`_run_cost`).
- Usage: `ai_usage_logger.log_openai_chat_async`, `feature='writing_grading'`, `operation` theo pass, `usage_event_id` riêng cho mỗi lượt. Giá lấy từ dòng `gpt-6.1-terra` đã có trong `ai_pricing.py`.
- Sổ lỗi: `ai_failure_log` provider `openai`, chỉ có mã lỗi và chi tiết đã cắt gọn, không chứa bài làm.

## UI and interaction

- Không có (xem `ui-states.md`).

## Work decomposition

- T001 → T002 → T003 làm tuần tự trong một PR backend. T004/T005 làm sau merge.

## Rollout and rollback

- Xem `rollout.md`. Mặc định tắt. Bật hay tắt bằng một biến env, cả hai đều cần anh Andy duyệt.

## Verification strategy

- Unit tests mock client OpenAI/Claude/Gemini cho từng FR, cộng thêm bộ test grader Writing hiện có, chạy toàn bộ `backend/tests` liên quan.
- Đo lại theo FR-008 trên staging sau khi bật env, với bộ bài có nguồn rõ, chi phí đối soát từ `ai_usage_logs`, và trần lượt gọi/chi phí được đặt trước.
- Staging journey theo Success criteria: ép Claude lỗi, chấm 10 bài.
