# Rà soát model AI Aver Learning ngày 12 tháng 10 năm 2026

Bản sửa nâng ba tác vụ ngắn từ Haiku 4.5 lên Haiku 5.5: phân tích từ vựng,
tạo câu hỏi D1 cá nhân và chấm ý chính Listening. Thử trực tiếp qua dịch vụ ứng
dụng trên cùng 12 ca tổng hợp cho mỗi model đạt 12/12 ở cả hai model; chi phí
ước tính từ token trả về giảm **85,95%**. Đây là kết quả trên mẫu nhỏ, không phải
cam kết chất lượng trên mọi bài học viên hoặc mức giảm tổng hóa đơn.

Phạm vi là bản sửa trên nhánh `codex/ai-model-balance-20261012`, từ staging
`8f8f5d02d38b0d6fc836e4a7a8cd962b39beff30`. Chưa merge hoặc deploy. Worktree
riêng không sửa checkout, nội dung Listening, nhánh hay cấu hình dùng chung
của các phiên khác. Không migration, không đổi dữ liệu học viên, không chấm lại
bài cũ, không bật thêm feature flag. Các thay đổi thuộc phạm vi bounded workloads
và catalog giá của [AI-0004](../../specs/0004-ai-model-usage-observability/spec.md).

## Model hiện có và quyết định

Đây là inventory các đường gọi đang có trong mã nguồn staging, không phải xác
nhận tất cả đều phát sinh traffic production. Biến môi trường trên deployment
có thể ghi đè mặc định; feature flag và cache có thể khiến một đường không gọi AI.

| Luồng | Model trước bản sửa | Quyết định và lý do |
| --- | --- | --- |
| Speaking chấm chính | Gemini 3.8 Flash | Giữ; đã là Flash GA hiện hành, có rollback về 3.5 |
| Speaking fallback, off-topic judge | Haiku 4.5 → Sonnet 5 | Giữ chuỗi đã quy định ở FR-005; không thay band scoring theo mẫu tổng hợp ngắn |
| Speaking sửa câu trả lời mẫu | Haiku 4.5 | Giữ vì thuộc pipeline feedback chính |
| Writing standard mức 1–3 | Gemini 3.5 Flash | Giữ baseline; 3.8 có lợi về giá nhưng cần A/B với bài giáo viên chấm trước khi chuyển mặc định |
| Writing mức 4–5, deep và phân tích ảnh Task 1 | Gemini 2.5 Pro | Giữ baseline chất lượng; không thay vì model mới hơn |
| Writing retry cuối | Gemini 2.5 Flash | Giữ fallback khác model chính |
| Listening audit nội dung | Gemini 3.8 Flash | Giữ |
| Course short writing và Advanced Vocab rewrite | Gemini 3.5 Flash-Lite | Giữ; model rẻ cho sửa lỗi có phạm vi hẹp |
| Hàm phân tích từ vựng (migrate/backfill) | Haiku 4.5 | **Nâng Haiku 5.5**, biến `VOCAB_ANALYSIS_MODEL`; auto-extraction sau Speaking đã ngừng, không tính là traffic đang hoạt động |
| Tạo câu hỏi D1 cá nhân | Haiku 4.5 | **Nâng Haiku 5.5**, biến `D1_QUESTION_MODEL`; giữ Gemini/evidence fallback |
| Listening gist | Haiku 4.5 | **Nâng Haiku 5.5**, biến `LISTENING_GIST_MODEL`; giữ keyword fallback |
| Sinh câu hỏi Speaking Part 1–3 | Gemini 2.5 Flash | Giữ; thử 3.5 Flash-Lite nhanh hơn nhưng câu Part 1 còn có xu hướng hỏi giải pháp chung |
| Sinh D1 theo lô, bổ sung từ vựng | Gemini 2.5 Flash | Giữ; chưa có bằng chứng nội dung đủ để chuyển toàn bộ batch |
| Chuyển giọng nói thành văn bản | Whisper-1 | Giữ; reliability classifier phụ thuộc duration/segment logprob và timestamp |
| Phát âm | Azure Pronunciation Assessment | Giữ; không phải model LLM có thể đổi bằng tên |
| TTS trực tiếp, audio tạo sẵn | OpenAI tts-1, Eleven multilingual v2, Kokoro v1.0 | Giữ giọng và audio đã có; sửa đơn giá ước tính ElevenLabs |

Nguồn mã: `backend/config.py`, `services/grading_orchestrator.py`,
`services/claude_grader.py`, `services/grading_providers/`,
`services/essay_service.py::default_grading_model`, `services/gemini_writing_grader.py`,
`services/gemini.py`, `services/d1_content_gen.py`, `services/vocab_enrichment.py`,
`services/whisper.py`, `services/tts_audio.py`, `services/listening_renderer.py`.
Các đường `services/` trong bảng nằm dưới `backend/`.

Review đường gọi ngày 12/10 xác nhận `routers/grading.py` STEP 8c không còn
schedule `_run_vocab_extraction`; hàm chỉ được giữ cho migrate/backfill. D1 cá
nhân còn chịu cả cờ global `VOCAB_BANK_FEATURE_FLAG_ENABLED` và cờ theo user.
Không suy từ model default rằng hai luồng này đang tạo chi phí trên deployment.

## Chênh lệch chất lượng và chi phí

Giá text dưới đây là USD trên 1 triệu token input/output, không gồm cache,
thuế, giá hợp đồng riêng hoặc công cụ phụ. Thinking có thể tăng token tính phí.

| So sánh | Giá cũ input / output | Giá mới input / output | Tác động |
| --- | ---: | ---: | --- |
| Haiku 4.5 → 5.5, prompt ≤100k | $1 / $5 | $0,10 / $0,50 | Giảm 90% cùng số token; tokenizer mới thường đếm nhiều hơn khoảng 30% |
| Writing 3.5 Flash → 3.8 Flash, ứng viên | $1,50 / $9 | $0,75 / $3,75 đến 31/12/2026 | Giảm 56,25% với giả định 2k input + 1k output mỗi lần |
| Cùng ứng viên từ 01/01/2027 | $1,50 / $9 | $1,50 / $7,50 | Giảm 12,5% trên cùng giả định; không coi giá khuyến mại là vĩnh viễn |
| Sonnet 5 → 5.5, chưa chuyển | $2 / $10 | $2 / $10 | Không tiết kiệm đơn giá; request hiện tại cần điều chỉnh riêng |
| Eleven multilingual v2 | $0,10 / 1k ký tự trong catalog cũ | $0,08 / 1k ký tự hiện công bố | Sửa ước tính giảm 20%, không phải tiết kiệm do đổi model |
| Eleven Flash v2.5 | $0,05 / 1k ký tự trong catalog cũ | $0,04 / 1k ký tự hiện công bố | Sửa ước tính giảm 20% |

Giá Haiku và tokenizer: [model overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview),
[migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide).
Giá Gemini: [pricing](https://ai.google.dev/gemini-api/docs/pricing) và
[lịch hết ưu đãi 3.8](https://ai.google.dev/gemini-api/docs/latest-model).
Sonnet: [pricing](https://platform.claude.com/docs/en/about-claude/pricing).
ElevenLabs: [API pricing](https://elevenlabs.io/pricing/api), đọc ngày 12/10;
chỉ áp dụng catalog mới từ ngày này vì trang không xác nhận ngày thay giá trước đó.
Giá theo subscription/credits thực tế vẫn phải đối chiếu hóa đơn.

GPT-6 Luna cũng có giá text ngắn $0,10/$0,50 theo
[OpenAI pricing](https://developers.openai.com/api/docs/pricing). Nó không đem
lại lợi thế đơn giá so với Haiku 5.5, trong khi cần thêm adapter text mới; đợt này
giữ nhà cung cấp đã tích hợp. `gpt-transcribe` được công bố $0,0045/phút, nhưng
chưa thay Whisper chỉ dựa vào giá vì hợp đồng timestamp/reliability của ứng dụng.

### Thử trực tiếp qua SDK hiện có

| Model | Ca đạt | Chi phí ước tính từ usage thực | Độ trễ trung bình một call |
| --- | ---: | ---: | ---: |
| Haiku 4.5 | 12/12 | $0,016812 | 2,375 giây |
| Haiku 5.5 | 12/12 | $0,002362 | 2,079 giây |

Cohort `auxiliary-synthetic-20261012`: ba headword (resilient, serendipity,
sustainable), hai transcript đúng và một transcript cố ý sai, ba gist paraphrase
đúng và ba gist sai. Dùng prompt, parser và validator thực của ứng dụng; chặn
ghi database và cache. Mỗi model thực hiện 12 call, không retry.

Ngưỡng: câu D1 qua validator và còn nguyên distractor/blank; headword, evidence
và context phải nằm trong transcript; không gắn lỗi cho hai transcript đúng,
có nhận ra lỗi ở transcript sai; gist đúng ≥70, gist sai <30 và phải có AI result.
Hai model đều đạt. Chưa phải gold set đa band do giáo viên chấm, nên kết quả này
không dùng để thay grader Speaking/Writing chính. Mẫu nhỏ cũng chưa xác lập p95.

Thử phụ sáu call sinh câu hỏi Speaking (Part 1–3, hai model) đều qua kiểm tra
cấu trúc. 3.5 Flash-Lite nhanh hơn trong mẫu nhưng có câu hỏi Part 1 về giải pháp
cải thiện giao thông thay vì trải nghiệm cá nhân; chưa đủ cơ sở đổi mặc định.

## Chi phí production đang hiển thị

Đọc trực tiếp [admin AI usage](https://www.averlearning.com/admin/system/ai-usage)
ngày 12/10/2026, khoảng 14:38 giờ Việt Nam, bằng tab riêng và chỉ đọc:

- **7 ngày:** 900/900 log, $6,5070 ước tính; Claude $0,1261, Gemini $5,6328,
  Whisper $0,7481. Có 20 lượt Writing lịch sử được bổ sung; 361 lượt Azure chưa
  định giá, không được hiểu là miễn phí.
- **30 ngày:** trang báo truncated, hiển thị ít nhất 1.063 lượt và $7,8265;
  412 lượt chưa định giá. Không sử dụng số này như tổng tháng đầy đủ.

Gemini chiếm khoảng 86,6% phần tiền đã định giá của cửa sổ 7 ngày. Vì chỉ một
phần các call Claude thuộc ba luồng nâng cấp, không được áp dụng mức giảm 86%
cho tổng $6,5070. Dashboard hiện không cho biết tổng theo từng model/tác vụ;
chưa có cơ sở dự báo số USD tiết kiệm mỗi tháng. Ledger đọc từ `.env` local là
staging và phần lớn là fixture; đã loại khỏi nhận định về production.

## Phát hiện và cách sửa

1. **Medium — model phụ bị đóng cứng, chi phí cao hơn lựa chọn mới.**
   `config.py`, `d1_question_generator.py::_try_haiku`,
   `listening_gist_grader.py::grade_gist_response`,
   `vocab_extractor.py::extract_vocab`. Nâng ba đường đã A/B và thêm rollback
   độc lập; các default scoring chính và feature flags giữ nguyên.
2. **Medium — thay tên Haiku đơn thuần có thể gây lỗi API hoặc đọc thinking
   thành JSON.** `services/claude_compat.py` bỏ temperature trên Haiku 5.5,
   tắt thinking cho tác vụ ngắn, tăng output budget 30%, đọc block kiểu text
   và từ chối response bị cắt/refusal. SDK Anthropic 0.39 hiện có đã gọi thành công.
   Sonnet 5.5 thực tế trả 400 với `thinking=disabled`, nên không nâng fallback
   bằng cách đổi tên máy móc.
3. **Low — catalog ElevenLabs cao hơn bảng giá API đang công bố.**
   `services/ai_pricing.py::UNIT_RATES` thêm kỳ giá từ 12/10, giữ đơn giá trước đó;
   `TOKEN_RATES` bổ sung Haiku 5.5 và tính giá 5x khi tổng prompt gồm cache >100k.
4. **Medium — báo cáo 30 ngày không đầy đủ.** Trang production tự báo truncated;
   việc tổng hợp/pagination cần được xử lý riêng. Đây là giới hạn số liệu hiện
   hành, không chứng minh model bị tính phí sai hay tổng tháng chỉ là $7,8265.

## Kiểm chứng và triển khai

Review bổ sung đã chuyển ghi usage từ vựng lên trước parser để response bị
refusal, cắt hoặc JSON lỗi vẫn được tính chi phí. Lỗi CI ở Admin Vocabulary là
đợi cố định 40 ms trước khi request được chặn; kiểm thử nay đợi điều kiện request
đã bắt đầu, giữ nguyên assertion chống response cũ mở lại dialog.

Các test mới phủ request mới/rollback cũ, chọn text sau thinking, refusal và
truncation, logging đúng model, keyword fallback, ngưỡng giá cache 100k và lịch
sử ElevenLabs. Test hiện có tiếp tục kiểm tra fallback, grading và persistence.
Spec governance và `git diff --check` đạt. Kết quả test cuối và SHA nằm trong PR.

Trước phát hành: kiểm tra ba biến model có override trên staging, triển khai
theo staging-first, smoke luồng có bật feature với ledger thật, đối chiếu mỗi
attempt với model/cost thực và duyệt feedback. Chỉ promote production sau
nghiệm thu staging; chưa có thao tác phát hành trong đợt audit này.

Rollback từng luồng bằng cách đặt biến tương ứng về
`claude-haiku-4-5-20251001` rồi restart backend. Không xóa ledger, không sửa bài
cũ. Không đổi feature flags để ép phát sinh traffic thử nghiệm.
