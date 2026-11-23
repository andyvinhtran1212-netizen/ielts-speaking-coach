---
id: WRITINGGPT-0088
title: Writing grades that Claude cannot serve fall back to GPT before Gemini
status: draft
risk: high
owner: product
---

# Bài Writing mà Claude không chấm được sẽ chuyển sang GPT trước Gemini

Status: **draft** — soạn ngày 23/11/2026 theo yêu cầu của anh Andy ("thử nghiệm đổi model chấm bài writing sang dùng gpt hoặc claude", 22/11) và lựa chọn của anh trên thẻ quyết định ngày 23/11 ("GPT-6.1-terra (cần PR)"). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời được ghi nguyên văn kèm thời điểm vào `approval-decision.md`, và `status` đổi sang `approved`. Bản thực thi làm trong một PR `high-risk` riêng, sau khi spec đã lên `staging`.

Spec cha: [AI-0004](../0004-ai-model-usage-observability/spec.md) (sổ usage, bảng giá) và [AIOPS-0024](../0024-admin-ai-model-control/spec.md) (override model trên admin). Spec này không đổi requirement nào của hai spec đó.

## Problem

Hiện nay mỗi bài Writing đi theo thứ tự: Claude Sonnet 5.5 chấm trước, sửa lại một lần nếu cần; khi Claude vẫn lỗi thì chuyển sang Gemini. Đường Gemini dùng `gemini-2.5-pro` ở L4–L5 (`essay_service.default_grading_model`) và `gemini-3.8-flash` ở L1–L3. `services/ai_router.effective_order` chỉ nhận `anthropic` và provider cũ `gemini` cho Writing, nên mục `openai` trong `AI_PROVIDER_ORDER` bị bỏ qua.

Eval ngày 22/11/2026 (gọi API có phí, không ghi DB) chạy 42 bài Task 2 của bộ t19, ở L5, qua đúng grader production, trên Mac mini. Script và bộ bài không đưa vào repo.

| Model | Chấm được | MAE band | Lệch TB | Trong ±0.5 | Xếp đúng thứ tự | $/bài |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 34/42 | 0.41 | +0.21 | 79% | 100% | 0.098 |
| gpt-6.1-terra | 42/42 | 0.58 | +0.51 | 57% | 98% | ~0.034 |
| gemini-3.8-flash | 38/42 | 0.76 | +0.50 | 37% | 100% | 0.034 |
| gemini-2.5-pro | 40/42 | 1.09 | +1.01 | 33% | 92% | 0.091 |

**Số liệu này chỉ để tham khảo, không dùng để duyệt rollout.** Band của bộ t19 do AI gán, không phải giám khảo chấm, và nguồn văn bản cùng quyền dùng bộ này chưa được xác minh. Chi phí chỉ tính các lượt thành công; phần retry và lượt lỗi chưa được đối soát. Model thực trả của GPT cũng chưa được ghi riêng. Trước khi bật trên production, cần đo lại theo FR-008. Từ bảng trên rút ra ba điểm:

1. Khoảng 19% bài (8/42) Claude không chấm được, chủ yếu vì `ungrounded_feedback`: feedback trích câu không có trong bài. Những bài đó lặng lẽ chuyển sang Gemini.
2. Gemini 2.5 Pro, model mà học viên L4–L5 nhận khi Claude lỗi, chấm cao khoảng +1 band.
3. GPT-6.1-terra không lỗi bài nào, sai ít hơn cả hai model Gemini, và giá ngang Gemini 3.8 Flash.

Anh Andy đã chọn GPT-6.1-terra làm model thay cho Gemini trên đường dự phòng.

## Scope

- Lượt chấm chính của Writing: bản Standard và pass 1 của Deep, ở mọi cấp L1–L5, cho bài của học viên và bài admin chấm lại qua cùng grader.
- Thêm một bậc dự phòng GPT, bật bằng env, nằm giữa Claude và Gemini.
- Ghi nhận đúng model đã chấm, usage, chi phí và lỗi cho bậc mới.

## Non-goals

- Đổi model chính (Claude Sonnet 5.5 vẫn chấm trước).
- Bỏ Gemini: Gemini vẫn là bậc cuối cùng.
- Pass 2/3 của Deep (`GEMINI_PRO_MODEL`), trích số liệu biểu đồ Task 1 (`WRITING_ANALYSIS_MODEL`), model mặc định trong admin, và Course Writing (`course_writing`). Mỗi phần này là một việc riêng.
- Giảm tỉ lệ lỗi grounding của Claude. Đó là việc theo dõi riêng, vì nó quyết định bao nhiêu bài rơi xuống đường dự phòng.
- Thêm nút chọn GPT trên giao diện override ở admin (AIOPS-0024).

## Users and journeys

- Học viên nộp bài Writing: nếu Claude lỗi, học viên nhận điểm và feedback từ GPT thay vì Gemini 2.5 Pro. Giao diện không đổi.
- Admin xem bài: thấy đúng model đã chấm (`model_used`) và chi phí đã tính.
- Owner: bật hoặc tắt bậc GPT bằng một biến env trên Railway, không cần deploy.

## Requirements

- **FR-001:** Thêm setting `WRITING_OPENAI_FALLBACK_MODEL`, mặc định rỗng. Khi rỗng, hoặc khi `OPENAI_API_KEY` trống, đường chấm Writing giống hệt hôm nay: cùng thứ tự provider, cùng số lần gọi, cùng kết quả.
- **FR-002:** Khi setting có giá trị, lượt chấm chính của một bài Writing mà Claude không trả được câu trả lời hợp lệ (sau lần sửa lại hiện có) sẽ gọi model OpenAI đó **trước** Gemini. Lời gọi dùng cùng system prompt, user prompt và ảnh biểu đồ Task 1 (nếu có) như lời gọi Claude.
- **FR-003:** Câu trả lời của GPT phải qua đúng bộ kiểm hiện có: schema và grounding (`_validated_text`). Nếu GPT lỗi (timeout, 429, 5xx, mạng, JSON hỏng, ungrounded, refusal, bị cắt cụt) thì được thêm tối đa một lần sửa lại, dùng chung ngân sách thời gian với Claude. Nếu vẫn lỗi, bài chuyển tiếp sang đường Gemini hiện có. Không lần lỗi nào được kết thúc bằng một lần chấm thất bại mà trước đây đã thành công.
- **FR-004:** Bài do GPT chấm lưu `model_used` là id model OpenAI đã trả lời, và cost là tổng các lượt gọi đã bị tính tiền trong lần chấm đó, tính theo bảng giá `ai_pricing` (dòng `gpt-6.1-terra` đã có). Mỗi lượt gọi GPT ghi một dòng `ai_usage_logs`, gồm `feature='writing_grading'` và provider OpenAI, không trùng với dòng của Claude hay Gemini. Admin không thấy chi phí Writing bị cộng hai lần.
- **FR-005:** Mỗi lượt GPT lỗi được ghi vào sổ lỗi AI (AIOPS-0024) với provider `openai`, đúng mã lỗi, và không chứa bài làm của học viên.
- **FR-006:** Thiếu ảnh biểu đồ, hoặc model không nhận ảnh: GPT chấm text-only, giữ nguyên cảnh báo "chưa xem biểu đồ" như đường Gemini hiện có. Ảnh không bị gửi đi dưới dạng URL công khai.
- **FR-007:** Tắt nhanh: xoá hoặc để rỗng `WRITING_OPENAI_FALLBACK_MODEL` thì bậc GPT ngừng từ lượt chấm kế tiếp sau khi service khởi động lại. Không cần migration hay đổi dữ liệu.
- **FR-008:** Trước khi bật trên production, đo lại trên staging bằng chính đường thực thi: dùng bộ bài có nguồn và quyền dùng rõ ràng (bài tổng hợp, hoặc bài được phép), ghi model thực trả lời và tổng chi phí gồm cả retry và lượt lỗi lấy từ `ai_usage_logs`, và giới hạn tổng lượt gọi cũng như chi phí trước khi chạy.

## Acceptance scenarios

### Tắt (mặc định)

- **Given** `WRITING_OPENAI_FALLBACK_MODEL` rỗng
- **When** Claude lỗi ở một bài
- **Then** bài đi thẳng sang Gemini như hôm nay, không có lời gọi OpenAI nào.

### Claude lỗi, GPT chấm được

- **Given** setting là `gpt-6.1-terra` và `OPENAI_API_KEY` có giá trị
- **When** Claude trả `ungrounded_feedback` hai lần
- **Then** GPT chấm bài, `model_used = gpt-6.1-terra`, Gemini không được gọi, sổ usage có các dòng Claude (lỗi) và GPT (thành công), cost là tổng các lượt.

### Cả Claude và GPT đều lỗi

- **Given** setting có giá trị, OpenAI trả 429
- **When** Claude cũng lỗi
- **Then** bài được Gemini chấm như hôm nay. Sổ lỗi ghi một dòng `openai` mã `rate_limited`.

### Claude chấm được

- **Given** setting có giá trị
- **When** Claude trả câu trả lời hợp lệ
- **Then** không có lời gọi OpenAI nào.

## Edge cases

- Thiếu `OPENAI_API_KEY`: bỏ qua bậc GPT và ghi log một lần, không làm lỗi bài.
- Giá long context của OpenAI ($2.00/$7.50) chưa có ngưỡng rõ ràng, trong khi prompt Writing khoảng 15k token. Cost ghi theo giá Standard; nếu ngưỡng nằm dưới 15k thì cost bị ghi thấp. Xem Open questions.
- Claude bị admin override tắt (AIOPS-0024 `preferred_provider=gemini`): giữ đúng thứ tự override, bậc GPT chỉ chạy khi Claude đứng trước Gemini.
- Hết ngân sách thời gian chung: dừng bậc GPT và chuyển sang Gemini.

## Success criteria

- Trên staging, ép Claude lỗi (ví dụ đặt model Claude không tồn tại cho Writing): 10/10 bài được GPT chấm, 0 bài gọi Gemini, cost và `model_used` đúng.
- Sau 7 ngày trên production: tỉ lệ bài do Gemini chấm giảm xuống dưới 2%, và không tăng số bài chấm thất bại.

## Open questions

1. Ngưỡng long context của gpt-6.1-terra. Đề xuất: kiểm trên trang giá OpenAI trước khi merge bản thực thi; nếu prompt Writing vượt ngưỡng thì thêm dòng giá long context.
2. `reasoning_effort` cho GPT. Đề xuất: `medium`, đúng mức đã dùng trong eval (thời gian trung vị 51 s).
3. Cảnh báo GPT chấm cao khoảng +0.5 band trong eval. Đề xuất: chấp nhận cho bậc dự phòng (vẫn tốt hơn Gemini 2.5 Pro +1.0), và đo lại trên bài thật có điểm giáo viên chấm trước khi bật trên production.
