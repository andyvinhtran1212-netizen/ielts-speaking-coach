# Implementation plan

Nguồn hiện trạng: `origin/staging` @ `7243b3364` (10/11/2026). Mọi số giá có
link và ngày đọc ở spec.md "So sánh phương án".

## Architecture impact

- **STT:**
  - `backend/services/whisper.py` có thêm bảng năng lực theo model, ví dụ
    `_STT_CAPABILITIES = {"whisper-1": {...}, "gpt-transcribe": {...}}`. Hàm
    dựng request và hàm đọc response đều lấy từ bảng này. `_response_format_for`
    (dòng 54-63) được thay bằng bảng.
  - Có thêm vòng dự phòng một lần (FR-007) và kiểm ngày tắt (FR-015).
  - `transcribe_audio`/`transcribe_from_url` (dòng 126-197, 279-322) dùng cùng
    adapter để không còn nhánh nào gửi `language` cứng.
- **Độ tin cậy:** `backend/services/transcript_reliability.py`.
  - Nhánh "không có tín hiệu đoạn" dùng bộ tín hiệu và ngưỡng hiệu chỉnh từ A/B
    (FR-003). Nhánh có segments giữ nguyên cho `whisper-1`.
  - Ngưỡng là hằng số có tên trong code, kèm comment trỏ tới báo cáo A/B trong
    verification.md.
- **Luồng chấm và admin:**
  - `grading.py:633` và `admin.py:4537` lấy `transcript_model` từ adapter.
  - `grading.py:645-658` ghi usage theo từng lần thử. Không đổi thứ tự rate
    limit, STT, upload, độ tin cậy.
- **Bảng ngày tắt model:** module mới `backend/services/model_retirement.py`
  (tên đề xuất), dùng chung cho STT và TTS. Ngày theo UTC. Có hàm
  `is_retired(model, at)` và `warn_if_retiring(model)` (mỗi tiến trình mỗi ngày
  một lần).
- **TTS:** `backend/services/tts_audio.py` có thêm engine thay thế.
  - Nếu chọn C: hàm async cho ElevenLabs (httpx, timeout 30 giây), dùng lại
    payload ở dòng 196-216. Nếu chọn A: client Realtime, đổi PCM sang mp3,
    instructions chỉ đọc nguyên văn và giới hạn thời lượng đầu ra.
  - `synthesize_mp3` (dòng 54-68) dispatch theo `QUESTION_TTS_ENGINE`.
  - `_engine_tag` (dòng 71-82) thêm tag cho engine mới. Tag `openai-tts-1` giữ
    làm tag nhận diện clip cũ.
- **`routers/tts.py`:** đọc runtime flag `question_tts_ai` trước provider.
  `_ALLOWED_VOICES` (dòng 204-205) thành bảng ánh xạ giọng của client sang giọng
  engine. Usage log ghi model thật (bỏ chuỗi `"tts-1"` ở dòng 217).
- **`services/speaking_question_audio.py`:** `ADMIN_ENGINE`/`ADMIN_VOICE` (dòng
  35-36) lấy theo engine thay thế. `audio_provider` (dòng 132-151) nhận cả ba
  khoá `kokoro`, `openai` (cũ) và khoá mới. `admin_class_assignments.py:442`
  thêm nhóm mới.
- **`services/ai_pricing.py`:** thêm link nguồn cho `gpt-transcribe` (dòng
  141-142) và dòng giá cho engine TTS thay thế. Nếu chọn A thì cần loại giá
  token có modality audio, và `ai_budget.estimate_or_none` cần nhánh tương ứng
  (dòng 191-196 hiện chỉ có `text_chars`).
- **Frontend:**
  - `practice.js`: coi 503 `tts_disabled` là tín hiệu dự phòng im lặng. Hiện
    mọi `!res.ok` đều rơi về trình duyệt (dòng 2889-2891, 2903-2906); chỉ cần
    bảo đảm không có toast.
  - Thêm dòng công bố giọng AI nếu Q6 = có.
  - `frontend/types/api.d.ts` cập nhật theo OpenAPI.
- **Không đổi:** Kokoro pregen, Listening, Vocabulary, grader, prompt chấm,
  schema DB.

## Data and contracts

- **Không có migration** (spec.md "Thay đổi dữ liệu, config, migration").
- **Bảng năng lực STT, bản khởi đầu.** T001 sửa các ô "?" theo kết quả thăm dò
  thật:

| Model | Tham số ngôn ngữ | response_format | timestamp_granularities | prompt | segments/avg_logprob | duration | Ngày tắt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `whisper-1` | `language="en"` | `verbose_json` | được (khi cờ bật) | được (≤ 224 token) | có | có | 2027-02-26 |
| `gpt-transcribe` | `languages=["en"]` | `verbose_json` hay `json`? | không | được | ? | ? (nếu không có thì dùng ffprobe) | — |

- **Ánh xạ giọng TTS:** client `nova` (và mọi giá trị khác) → `QUESTION_TTS_VOICE`
  của engine đã duyệt. Bảng này nằm trong code, có test.
- **Usage log:**
  - STT: `service="whisper"` giữ cho tương thích dashboard
    (`ai_pricing.effective_logged_cost` dòng 333-337), `model=<id thật>`.
  - TTS C: `service="elevenlabs"`, `feature="question_tts"` hoặc
    `"speaking_question_tts"`.
  - TTS A: `service="tts"`, `model="gpt-realtime-2.1-mini"`, kèm
    `input_tokens`/`output_tokens`. Cần mở rộng `effective_logged_cost` để
    tính lại dòng token.
- **Hợp đồng HTTP:** xem spec.md "API và contract". Không đổi shape. Chỉ thêm
  503 `tts_disabled`.
- **Nguồn sự thật:** `ai_usage_logs` cho chi phí và quota; `session_responses`
  (`transcript_model`, `transcript_reliability`) cho kết quả chấm. Không có bảng
  mới.

## UI and interaction

- Trang luyện tập Speaking (`practice.js`):
  - Hành vi đọc đề không đổi. Giọng đổi theo engine.
  - Lỗi, 503 hay flag tắt đều chuyển sang `speechSynthesis` như hiện tại, không
    có toast.
  - Nếu Q6 = có: dòng chữ nhỏ "Giọng đọc do AI tạo" cạnh nút nghe đề, đọc được
    bằng screen reader, cùng màu chữ phụ hiện có, không đẩy bố cục trên di động
    360 px.
- Trang admin chủ đề: nút "Tạo audio" giữ nguyên. Lỗi 502 giữ thông báo hiện
  có. Không thêm UI chọn engine.
- Chi tiết trạng thái ở `ui-states.md`.

## Work decomposition

Mỗi lát là một PR nhỏ, có test đỏ trước, không ghi DB prod. Cỡ: S ≈ ≤ 0,5 ngày
job, M ≈ 1 ngày, L ≈ 2 ngày. Mức review: **CR** = Code Reviewer;
**CR+FD** = CR cùng FD đối chiếu spec; **CR+SA** = thêm Security Auditor.

| Lát | Nội dung (FR) | Owner | Cỡ / rủi ro / review | Phụ thuộc | Hạn |
| --- | --- | --- | --- | --- | --- |
| T001 | Thăm dò hợp đồng `gpt-transcribe` **chỉ trên staging**, ≤ 5 lần gọi, không đổi env, Leader xếp hàng nếu là job code; ghi các trường trả về, cách xử lý `language`, `usage.type` (FR-001) | Claude (script chỉ đọc) + Leader cấp key staging | S / thấp / CR | Leader xác nhận ngân sách | 17/11/2026 |
| T002 | Adapter STT theo bảng năng lực, `transcript_model` thật, word-timestamp chỉ với whisper-1, ffprobe check, admin regrade dùng chung (FR-001, 002, 004, 005, 008) | Codex | M / cao (chấm) / CR+FD | T001 | 27/11/2026 |
| T003 | Hiệu chỉnh độ tin cậy khi không có tín hiệu đoạn (FR-003) | Claude | M–L / cao (đổi điểm) / CR+FD | T001, dữ liệu T005 | 11/12/2026 |
| T004 | Bảng ngày tắt model + cảnh báo + chặn gọi model đã tắt (FR-015) | Codex | S / trung bình / CR | — | 27/11/2026 |
| T005a | Security Auditor kiểm script trích ~60 bản ghi prod ẩn danh trước khi đọc prod (Q3) | Claude (script) + Security Auditor (kiểm) | S / cao (dữ liệu prod) / SA | T002 | 04/12/2026 |
| T005 | Harness A/B STT (so sánh cặp, WER, độ lệch band, nhãn độ tin cậy, duration, độ trễ) + chạy + báo cáo (FR-019) | Claude (harness) + Product QA (transcript tham chiếu ≥ 30 mẫu, gắn nhãn audio xấu) | M / trung bình / CR+FD | T002, T005a (dữ liệu prod), ngân sách | 18/12/2026 |
| T006 | Dự phòng STT một lần + giá có nguồn (FR-006, 007) | Codex | S / trung bình / CR | T002, T004, Q4 | 11/12/2026 |
| T007 | A/B TTS: tts-1 làm mốc, C, A, B (offline trên box); phiên âm ngược, nghe mù, độ trễ, chi phí đo thật (FR-011, 019) | Claude (harness) + Product QA (nghe mù 20 clip, 2 người) | S–M / thấp / CR | Ngân sách, Q1 sơ bộ | 24/11/2026 (quyết 27/11) |
| T008 | Engine TTS thay thế cho `/tts`: dispatch, ánh xạ giọng, usage log model thật, giá, runtime flag `question_tts_ai`, 503 `tts_disabled` (FR-009, 010, 011, 014, 016, 006) | Codex | M nếu C / L nếu A; cao (AI trả phí) / CR+SA | T007, Q1 | 11/12/2026 |
| T009 | Render admin bằng engine mới, khoá provider mới, giữ tag cũ, nhóm giọng khi giao bài (FR-012, 013) | Codex | S–M / trung bình / CR+FD | T008 | 11/12/2026 |
| T010 | Frontend: im lặng khi 503 `tts_disabled`, dòng công bố giọng AI nếu Q6 = có, cập nhật `api.d.ts` (FR-016, 018) | Claude | S / thấp / CR + Product QA (review UI; UI Auditor đã nghỉ) | T008, Q6 | 11/12/2026 |
| T011a | QA staging TTS: hành trình học viên đọc đề, admin tạo audio, kill switch, giao bài nhiều giọng | Product QA | S / — / FD đọc kết quả | T008–T010 | 16/12/2026 |
| T012 | Release TTS lên prod: đặt env, deploy SHA đã QA, đọc lại env và usage 48 giờ (cần anh Vinh duyệt) | Release Manager | S / cao (prod) / Leader | T011a, anh Vinh duyệt | 18/12/2026 |
| T011b | QA staging STT: hành trình nộp bài Part 1/2/3, audio xấu, regrade admin, dự phòng, rollback env | Product QA | S / — / FD đọc kết quả | T002–T006, báo cáo T005 | 08/01/2027 |
| T013 | Release STT lên prod: đặt env `WHISPER_STT_MODEL=gpt-transcribe` (prod chưa đặt, Q7), theo dõi 72 giờ, gỡ `STT_FALLBACK_MODEL` trước 19/02 (cần anh Vinh duyệt) | Release Manager | S / cao (prod, chấm) / Leader | T011b, anh Vinh duyệt (23/12) | chuyển 11/01, xong 22/01/2027 |
| T014 | Đổi mặc định code sang `gpt-transcribe`; dọn code sau ngày tắt: bỏ nhánh `tts-1`/`whisper-1` khỏi đường gọi (giữ giá để tính lại log cũ, giữ tag nhận diện clip cũ) | Codex | S / thấp / CR | 26/02/2027 | 12/03/2027 |

Thứ tự ưu tiên: các lát STT (T001 → T002 → T005 → T003) được ưu tiên review và
QA trước, vì ảnh hưởng điểm chấm. Các lát TTS chạy song song vì hạn sớm hơn.
`whisper.py` là file dùng chung của T002, T003 (đọc) và T006: tích hợp tuần tự
T002 → T006, T003 chỉ sửa `transcript_reliability.py`. `tts_audio.py` dùng
chung giữa T008 và T009: tích hợp tuần tự T008 → T009.

## Rollout and rollback

Xem `rollout.md`. Tóm tắt:

- **STT:** rollback bằng env `WHISPER_STT_MODEL=whisper-1`. Hiệu lực đến hết
  25/02/2027; sau đó bảng ngày tắt chặn.
- **TTS:** kill switch là runtime flag `question_tts_ai=false`, học viên chuyển
  sang giọng trình duyệt. Rollback engine bằng env `QUESTION_TTS_ENGINE`, hiệu
  lực đến hết 05/01/2027 với `openai_tts1`.

Mốc lùi từ hai ngày tắt:

| Mốc | TTS (tắt 06/01/2027, thứ Tư) | STT (tắt 26/02/2027, thứ Sáu) |
| --- | --- | --- |
| Anh Vinh trả lời Q1–Q8, Leader xác nhận ngân sách | 13/11/2026 | 13/11/2026 |
| Thăm dò / A/B | A/B TTS 16–24/11, quyết 27/11 | T001 17/11; A/B STT chạy 07–18/12 |
| Code lên staging | 11/12/2026 | T002 27/11, T003 + T006 11/12 |
| QA staging | 14–16/12/2026 | soak 21/12/2026–08/01/2027 |
| Anh Vinh duyệt prod | 17/12/2026 | 23/12/2026 |
| Lên prod | **18/12/2026** (đệm 19 ngày, gồm kỳ nghỉ cuối năm) | chuyển 11/01/2027, **xong 22/01/2027** (trước Tết 06/02/2027) |
| Hết đường rollback model cũ | 05/01/2027 | 25/02/2027 (gỡ dự phòng trước 19/02/2027) |
| Dọn code | 12/03/2027 | 12/03/2027 |

## Verification strategy

- **Test tự động (không gọi mạng, dùng provider fixture):**
  - Bảng năng lực: `gpt-transcribe` gửi `languages` mà không gửi `language`;
    `whisper-1` ngược lại; model lạ bị từ chối trước provider.
  - Độ tin cậy khi `segments=[]`: mẫu ồn ra "low", mẫu sạch ra "high"; bảng
    ngưỡng bị khoá bằng test.
  - Bảng ngày tắt chạy với đồng hồ giả: 05/01, 06/01, 25/02, 26/02.
  - Dự phòng: một lần; 4xx không dự phòng; usage hai dòng.
  - `/tts`: flag tắt → 503, provider giả không bị gọi; ánh xạ giọng; usage ghi
    model thật; quota không đổi.
  - Render admin: clip `openai` cũ vẫn được nhận; khoá mới; không ghi đè.
  - Test quét repo: không còn chuỗi `"tts-1"` hay `"whisper-1"` cứng trong đường
    gọi, ngoài bảng năng lực, bảng ngày tắt, bảng giá và tag nhận diện.
- **A/B STT (T005), chạy ngoài CI, trên staging:**
  - **Cohort:** khoảng 60 bản ghi gồm Part 1, 2, 3; band thấp, giữa, cao; ≥ 10
    mẫu audio xấu đã gắn nhãn (ồn, nhỏ, cắt, im lặng dài). Nguồn: staging, nội
    bộ, hoặc prod nếu Q3 = có.
  - **Transcript tham chiếu:** Product QA gõ cho ≥ 30 mẫu, giữ filler.
  - **Phương pháp:** cùng audio chạy `whisper-1` và `gpt-transcribe`, mỗi model
    3 lượt. Chấm lại mỗi transcript một lần bằng grader hiện tại, cùng prompt.
  - **Tiêu chí đạt:**
    - WER `gpt-transcribe` ≤ WER `whisper-1` + 1 điểm phần trăm tuyệt đối.
    - Tỉ lệ filler giữ lại ≥ 80 % so với tham chiếu.
    - Độ lệch band overall trung bình ≤ 0,25; ≥ 90 % mẫu trong ±0,5; đổi phía
      mốc 6/7 ≤ 5 %.
    - Mẫu audio xấu ra "low" 100 % sau hiệu chỉnh; phân bố nhãn lệch ≤ 10 điểm
      phần trăm mỗi nhãn.
    - Duration không biết = 0.
    - Độ trễ p50/p95 ≤ `whisper-1` + 20 %.
    - Lỗi provider = 0 trên cohort.
- **A/B TTS (T007):**
  - **Mẫu:** 50 chữ đề (Part 1, Part 3, cue card Part 2 dài, có số, viết tắt
    IELTS/TV/UK, dấu "&").
  - **Engine:** `tts-1` (mốc), C, A; B chạy offline trên box (0 USD).
  - **Tiêu chí đạt:**
    - Phiên âm ngược bằng `gpt-transcribe` cho WER ≤ 2 % và 0 từ thêm, trên
      100 % mẫu.
    - Nghe mù 20 clip × 2 người (thang 1–5): trung bình không thấp hơn
      `tts-1`.
    - p95 thời gian trả đủ audio cho câu ~150 ký tự ≤ 6 giây.
    - Chi phí mỗi 1K ký tự đo từ usage thật.
- **Ngân sách gọi API, cần Leader xác nhận trước khi chạy.** Tính từ giá công
  khai, với giả định ghi rõ:

| Hạng mục | Giả định | Ước tính |
| --- | --- | --- |
| T001 thăm dò | ≤ 5 lần × ≤ 2 phút | ≤ 0,06 USD |
| A/B STT `whisper-1` | 60 bản ghi × trung bình ≤ 2 phút × 3 lượt = 360 phút × 0,006 | ≤ 2,16 USD |
| A/B STT `gpt-transcribe` | 360 phút × 0,0045 | ≤ 1,62 USD |
| Chấm lại để đo độ lệch band | 60 × 2 transcript × 1 lượt = 120 lần chấm; giá mỗi lần chấm **chưa xác minh** (Leader đọc trung bình `cost_usd_est` của `speaking_grading` trên ledger staging) | trần **20 USD**, dừng khi chạm |
| A/B TTS `tts-1` | 50 câu × ≤ 200 ký tự × 2 lượt = 20 000 ký tự × 15/1M | ≤ 0,30 USD |
| A/B TTS ElevenLabs Flash | 20 000 ký tự × 0,04/1K | ≤ 0,80 USD |
| A/B TTS `gpt-realtime-2.1-mini` | giá mỗi câu **chưa xác minh** | trần **2,50 USD**, dừng khi chạm |
| Phiên âm ngược | khoảng 400 clip × khoảng 15 giây = 100 phút × 0,0045 | ≤ 0,45 USD |
| **Tổng trần đề xuất** | STT ≤ 25 USD, TTS ≤ 5 USD | **≤ 30 USD** |

- `gpt-live-transcribe` **không** nằm trong A/B (khuyến nghị không dùng). Nếu
  Leader muốn đo thì cộng thêm khoảng 20 bản ghi × 2 phút × 0,017 ≈ 0,68 USD và
  cần một harness Realtime riêng.
- **Bằng chứng prod:** Release Manager đọc lại env (Q7, owner RM; lần đọc đầu 11:26 ngày 10/11/2026), xem usage 48 giờ (TTS)
  và 72 giờ (STT) theo model, tỉ lệ 2xx, tỉ lệ nhãn độ tin cậy so với tuần
  trước.
