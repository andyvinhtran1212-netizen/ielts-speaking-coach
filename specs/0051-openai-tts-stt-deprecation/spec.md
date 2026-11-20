---
id: AUDIODEPR-0051
title: Speaking read-aloud and Speaking transcription keep working after OpenAI retires tts-1 and whisper-1
status: approved
risk: high
owner: product
---

# Speaking read-aloud and Speaking transcription keep working after OpenAI retires tts-1 and whisper-1

Trạng thái: **approved**. Anh Vinh duyệt lúc 11:25 ngày 10/11/2026 (giờ Việt
Nam), nguồn t1543s5028, qua Leader. Duyệt Q1–Q8 theo khuyến nghị của FD (mục
"Quyết định của anh Vinh" bên dưới). FD viết bản nháp ngày 10/11/2026 theo
tracker `DEPR-OPENAI-TTS1` và `DEPR-OPENAI-WHISPER1` (P2); Leader chuyển lời anh
Vinh (t1540u) giao phần thiết kế. Số spec **0051** đã ghi trong
`/workspace/cc-jobs/spec-number-register.md`. Spec không cần số migration
(xem "Thay đổi dữ liệu, config, migration").

Theo quy trình `specs/README.md`, spec phải được merge vào `staging` trước khi
làm code. Leader quyết định (11:29 ngày 10/11/2026) FD mở PR spec chỉ gồm
docs; CR review rồi merge. Code ticket
chỉ được xếp hàng sau bước đó và do Leader xếp. Hiện trạng code đọc từ
`origin/staging` @ `7243b3364` (fetch lúc 10:59 ngày 10/11/2026, giờ Việt Nam).

## Quyết định của anh Vinh

Nguồn: t1543s5028, 11:25 ngày 10/11/2026 (giờ Việt Nam), Leader chuyển lại.
Anh Vinh duyệt AUDIODEPR-0051 và chốt Q1–Q8 theo khuyến nghị của FD:

| Câu | Chốt |
| --- | --- |
| Q1 | (a) ElevenLabs Flash v2.5 cho `/tts` và render admin, nếu A/B TTS đạt; trượt thì (b) `gpt-realtime-2.1-mini`; giọng trình duyệt giữ làm dự phòng |
| Q2 | Trần A/B **30 USD** (STT 25 USD, TTS 5 USD); Leader xác nhận trước mỗi lần chạy |
| Q3 | Cho lấy khoảng 60 bản ghi Speaking prod, **chỉ ở T005**. Bước trích dữ liệu ẩn danh phải được Security Auditor kiểm **trước** khi đọc dữ liệu prod (T005a) |
| Q4 | Có dự phòng `whisper-1` một lần, gỡ trước 19/02/2027 |
| Q5 | Chấp nhận nhãn độ tin cậy tính lại, với điều kiện A/B đạt ngưỡng |
| Q6 | Có dòng "Giọng đọc do AI tạo" |
| Q7 | Cấp quyền đọc env prod (biến không bí mật và việc có hay không `ELEVENLABS_API_KEY`); **owner: Release Manager**. **Đã xong** lúc 11:26 ngày 10/11/2026, snapshot `/workspace/cc-jobs/reports/railway-env-20261110-1126-audio.txt` (kết quả ở mục Hiện trạng code) |
| Q8 | Chấp nhận để word timestamps vô hiệu đến khi có spec riêng |

Các điều kiện kèm theo quyết định:

- **T001** chạy chỉ trên staging, tối đa 5 lần gọi API, không đổi env, không ghi
  prod, hạn 17/11/2026. Nếu T001 là job code thì Leader phải xếp hàng; FD không
  tự tạo job.
- **T005** đọc dữ liệu prod chỉ sau khi Security Auditor duyệt script trích dữ
  liệu ẩn danh (T005a). Không có bước SA thì T005 chỉ dùng dữ liệu staging hoặc
  dữ liệu nội bộ.
- **Q7:** Release Manager giữ quyền đọc env prod. FD và job code không đọc env
  prod.
- Lên prod (T012, T013) vẫn cần anh Vinh duyệt trực tiếp cho từng lần; lời duyệt
  bot khác chuyển lại không tính.

## Tóm tắt (tiếng Việt)

- OpenAI ngừng `tts-1` ngày **06/01/2027** và `whisper-1` ngày **26/02/2027**.
  Em đã đọc lại trang nguồn ngày 10/11/2026. Ngày và tên model thay thế khớp với
  Leader. Có thêm 4 điểm Leader chưa ghi:
  (a) `gpt-4o-transcribe` và `gpt-4o-mini-transcribe` cũng ngừng ngày 26/02/2027,
  nên không dùng được làm phương án thay;
  (b) `gpt-4o-mini-tts` cũng ngừng ngày 06/01/2027;
  (c) `gpt-realtime-2.1-mini` **không** chạy trên `/v1/audio/speech`. Muốn dùng
  phải chuyển sang Realtime API (WebSocket/WebRTC), và bộ giọng của nó không có
  `nova`;
  (d) `gpt-transcribe` dùng `languages` thay cho `language`, không có
  `timestamp_granularities` (chỉ `whisper-1` có) và không trả `logprobs`.
- Ảnh hưởng lớn nhất là **chấm Speaking** (STT). Nếu `gpt-transcribe` không trả
  `avg_logprob` theo đoạn, bộ phân loại độ tin cậy transcript sẽ luôn ra
  "medium". Khi đó mức trần LR/GRA cho audio xấu không bao giờ bật, và nhãn
  "high" cũng không bao giờ xuất hiện. Spec này buộc hiệu chỉnh lại trước khi
  đổi model.
- Về TTS, có **hai** đường gọi `tts-1` trên server. Một là `POST /tts` (đọc đề
  trong luyện tập; trình duyệt có sẵn `speechSynthesis` để dự phòng). Hai là nút
  admin "tạo audio" cho câu Part 1/3 (`ADMIN_ENGINE = "openai"`). Đường thứ hai
  không có dự phòng: sau 06/01/2027 admin sẽ không tạo được bản đọc đề mới để
  giao bài. Audio đã sinh sẵn vẫn phát bình thường vì là file mp3 trong bucket.
- Đề xuất:
  - STT dùng `gpt-transcribe`, rẻ hơn 25 % so với `whisper-1` theo bảng giá
    công khai, qua A/B và hiệu chỉnh độ tin cậy.
  - TTS chọn giữa ElevenLabs Flash v2.5 (đã tích hợp sẵn) và
    `gpt-realtime-2.1-mini`, quyết bằng A/B.
  - Làm STT trước. Hạn nội bộ: TTS lên prod trước 18/12/2026, STT trước
    22/01/2027 (trước Tết).

## Problem

Hai model OpenAI mà prod đang dùng sẽ bị tắt:

| Model | Ngày tắt | Thay thế OpenAI đề xuất | Nguồn |
| --- | --- | --- | --- |
| `tts-1` (và `tts-1-hd`, `gpt-4o-mini-tts`) | 06/01/2027 | `gpt-realtime-2.1-mini` (Realtime API, không phải `/v1/audio/speech`) | [deprecations](https://developers.openai.com/api/docs/deprecations) mục "2026-10-01: Text-to-speech models"; [TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech) dòng cảnh báo đầu trang. Đọc 10/11/2026. |
| `whisper-1` (và `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize`) | 26/02/2027 | `gpt-live-transcribe` hoặc `gpt-transcribe` | [deprecations](https://developers.openai.com/api/docs/deprecations) mục "2026-08-26: Transcription models"; [speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text). Đọc 10/11/2026. |

**Chênh lệch so với bối cảnh Leader gửi:** ngày và tên model thay thế khớp
hoàn toàn. Leader chưa ghi bốn điểm (a)–(d) ở phần tóm tắt. Các file:dòng Leader
dẫn đều đúng trên `origin/staging`. Riêng `routers/tts.py:217` chỉ là **nhãn
model ghi vào usage log**; lệnh gọi OpenAI thật nằm ở
`services/tts_audio.py:62-67` và dùng `_MODEL = "tts-1"` (`tts_audio.py:33`).
Ngoài ra còn một đường TTS mà Leader chưa liệt kê: render admin (bảng dưới).

Nếu không làm gì:

- **Từ 06/01/2027:**
  - Mọi lệnh `POST /tts` trả 502 sau khi đã gọi provider thất bại. Trình duyệt
    tự rơi về `speechSynthesis` (`practice.js:2903-2906`, `2935-2939`), nên học
    viên vẫn nghe được nhưng bằng giọng máy của thiết bị.
  - Nút admin `POST /admin/topics/{topic_id}/questions/{question_id}/render-audio`
    trả 502. Câu mới hoặc câu vừa sửa lời không có bản đọc đề, nên không giao
    được trong bài Part 1/3 nghe đề (`admin_class_assignments.py:451-461`).
- **Từ 26/02/2027:** mọi lượt chấm Speaking dừng ở bước STT và trả 502 "Lỗi nhận
  dạng giọng nói" (`grading.py:616-626`). Admin cũng không chạy lại transcript
  được (`admin.py:4532`). Đây là sự cố chặn tính năng chính.

### Hiện trạng code (origin/staging @ 7243b3364)

**STT (whisper-1)**

| Chỗ | File:dòng | Ghi chú |
| --- | --- | --- |
| Model mặc định | `backend/config.py:280-287` `WHISPER_STT_MODEL: str = "whisper-1"` | Đổi được qua env. Comment ghi "Keep whisper-1 until A/B verification". |
| Chọn model | `backend/services/whisper.py:49-51` `_stt_model()` | Nếu rỗng thì dùng `whisper-1`. |
| Chọn định dạng | `backend/services/whisper.py:54-63` | `verbose_json` cho `{"whisper-1","gpt-transcribe"}`, model khác dùng `json`. **Chưa xác minh** `gpt-transcribe` có trả `segments`/`avg_logprob` trong `verbose_json` hay không. Docs chỉ nói `timestamp_granularities` dành riêng cho `whisper-1`. |
| Lệnh gọi trong luồng chấm | `backend/services/whisper.py:233-247` | Gửi `language="en"` (dòng 244). Với `gpt-transcribe`, docs ghi "`languages` replaces the singular `language` field. Don't send both fields". **Chưa xác minh** API có từ chối `language` hay không. Prompt cố định `"Uh, um, er, ..."` ở dòng 107-109. |
| Word timestamps | `whisper.py:238-239`, `config.py:295` `SPEAKING_WORD_TIMESTAMPS_ENABLED = False` | Chỉ `whisper-1` hỗ trợ. Sau 26/02/2027 OpenAI không còn model nào có tính năng này. |
| Duration | `whisper.py:250-254` (ffprobe dự phòng ở dòng 66-92) | Nếu ffprobe thiếu thì duration = 0, và `grading.py:721-739` bỏ qua cổng "quá ngắn". **Chưa xác minh** image Railway prod có ffprobe hay không. |
| Luồng chấm | `backend/routers/grading.py:605-658` | Dòng 633 lấy `transcript_model` mặc định `"whisper-1"`. Dòng 645-658 ghi usage `feature="speaking_stt"`. |
| Độ tin cậy | `backend/services/transcript_reliability.py:46-77` | Trọng số: logprob 0,60, tốc độ từ 0,25, no-speech 0,15. Khi không có segment, logprob được cho cố định 0,5 (dòng 99-100, 108-109) và no-speech = 1,0 (dòng 152-153). Kết quả luôn nằm trong [0,50; 0,70], tức **luôn "medium"**. |
| Hệ quả lên điểm | `grading.py:212-240` (cắt LR/GRA xuống Band 6 khi nhãn "low"), `grading.py:1434-1443` (assessment_confidence) | Khi nhãn luôn "medium", mức trần không bao giờ bật và "high" không bao giờ xuất hiện. Hành vi chấm đổi mà không ai thấy. |
| Admin chạy lại transcript | `backend/routers/admin.py:4516-4547` | Dòng 4537 mặc định `"whisper-1"`. |
| Bảng giá | `backend/services/ai_pricing.py:138-142` | `whisper-1` 0,006 USD/phút, `gpt-transcribe` 0,0045 USD/phút. Dòng `gpt-transcribe` chưa ghi link nguồn trong code. |
| Usage log | `backend/services/ai_usage_logger.py:164-194` | `service="whisper"`, tính tiền theo `audio_seconds`. |
| Ngân sách | `backend/services/ai_budget.py:178-189` có ước tính theo giây audio. Nhưng các call site `guard` của AIBUDGET-0033 T004 đã bị revert (`0acde8884`, 30/10/2026). | Hôm nay Whisper/TTS **không** giữ chỗ ngân sách. Chỉ có quota theo người dùng chặn fail-closed (`rate_limit.py:261`). |
| Cột dữ liệu | `migrations/006_add_transcript_reliability_columns.sql:18` `transcript_model TEXT` | Kiểu text, không cần migration. |

**TTS (tts-1)**

| Chỗ | File:dòng | Có dùng tts-1 không? |
| --- | --- | --- |
| `POST /tts` (đọc đề luyện tập) | `backend/routers/tts.py:180-232`; gọi `synthesize_mp3` ở dòng 211; usage log `model="tts-1"` ở dòng 214-221; giọng cho phép ở dòng 204-205 (mặc định `nova`) | **Có**, live, mỗi lần đọc đều gọi OpenAI. |
| Hàm synth async | `backend/services/tts_audio.py:54-68` (`_MODEL` ở dòng 33) | **Có**. |
| Render admin câu Part 1/3 | `backend/routers/admin.py:3440-3490` (engine ở dòng 3471); `backend/services/speaking_question_audio.py:32-36` `ADMIN_ENGINE = "openai"`, comment ghi Railway không cài Kokoro | **Có**, qua `tts_audio.synth_sync` → `_synth_openai_sync` (`tts_audio.py:182-193`). Không có dự phòng. |
| Pregen câu hỏi Speaking hàng loạt | `speaking_question_audio.py:30-31` `ENGINE = "kokoro"` | Không (Kokoro). |
| Audio từ vựng sinh sẵn | `backend/scripts/pregen_vocab_audio.py:43` `_ENGINE = "kokoro"`, CLI chỉ cho `--engine kokoro` (dòng 277); `backend/routers/admin_vocab.py:121-130`: sinh audio hosted đã tắt, mặc định `kokoro` | **Không** cho audio mới. Nhưng mặc định tham số của `tts_audio.synth_sync`/`get_or_create_audio_sync` vẫn là `engine="openai"` (dòng 286-293, 321-323), và `get_or_create_audio` async (dòng 162-171) gọi `tts-1`. Em không tìm thấy caller nào của `get_or_create_audio` async trong `backend/` ngoài test. File từ vựng **đã** sinh bằng `tts-1` trước đây (tag `openai-tts-1-pad1`) vẫn nằm trong bucket `vocab-audio` và vẫn phát được. **Chưa xác minh** số lượng file. |
| Audio câu hỏi khoá học | `backend/scripts/pregen_course_question_audio.py:33` `ENGINE = "kokoro"` | Không. |
| Phát âm khoá học | `backend/scripts/setup_course_pronunciation.py:108-109`; dữ liệu `backend/data/course_pronunciation/C1-B01..C1-B10.json` có `"voice_engine": "kokoro"` | Không. |
| Listening | `backend/services/listening_renderer.py:72-166` | Không (ElevenLabs). |
| Khoá đường dẫn audio | `tts_audio.py:36` `_ACCENT_TAG = "openai-tts-1"`, `tts_audio.py:71-91` | Path = sha256(text\|voice\|tag). `speaking_question_audio.audio_provider` (dòng 132-151) dựa vào tag này để nhận clip `openai` cũ. Nếu đổi tag, clip cũ thành "không khớp" và câu hỏi tụt khỏi danh sách giao được. |
| Nhóm cùng giọng khi giao bài | `backend/routers/admin_class_assignments.py:432-448` | Có ba nhóm `kokoro`/`openai`/`legacy`. Engine mới sẽ là một nhóm mới. |
| Frontend | `frontend/public/js/practice.js:2777` gửi `voice: 'nova'`; dòng 2883 và 2948 gọi `/tts`; dự phòng `speechSynthesis` ở dòng 2903-2906 và 2935-2939 | Hợp đồng `/tts` khai báo ở `frontend/types/api.d.ts:393`. |
| Giá, quota | `ai_pricing.py:143-144` `tts-1` 15 USD/1M ký tự; `config.py:356-360` `TTS_DAILY_LIMIT_PER_USER=200`, `TTS_IP_MAX_PER_MINUTE=60` | Quota đếm `ai_usage_logs.feature="question_tts"` (`tts.py:117-131`), không phụ thuộc model. |

**Env prod đã kiểm (Q7 xong).** Release Manager đọc env Railway backend prod ở
chế độ chỉ đọc lúc 11:26 ngày 10/11/2026 (giờ Việt Nam). Snapshot nằm ở
`/workspace/cc-jobs/reports/railway-env-20261110-1126-audio.txt`. FD không đọc
snapshot này; các ý dưới đây theo bản tóm tắt Leader chuyển:

- `WHISPER_STT_MODEL` **không đặt** trên prod, nên prod dùng mặc định trong code
  là `whisper-1` (`config.py:287` trên `main` @ `6cc32c4e9`).
- `ELEVENLABS_API_KEY` **có**.
- `AZURE_SPEECH_KEY` và `AZURE_SPEECH_REGION` **có**.
- Ngoài các biến trên, không có biến nào chứa AUDIO/TTS/STT/VOICE/TRANSCRIB/PRONUN.
  Tên `SPEAKING_WORD_TIMESTAMPS_ENABLED` không chứa từ khoá nào trong danh sách
  này, nên bản tóm tắt không cho biết biến này có được đặt hay không. Nếu không
  đặt thì giá trị là mặc định trong code, `False` (`config.py:295`).

Hệ quả:

- **Đổi STT** có hai cách, đều đi qua quy trình release và cần anh Vinh duyệt
  lần lên prod (T013): (1) đổi giá trị mặc định trong code
  (`config.py:287`); hoặc (2) Release Manager đặt env
  `WHISPER_STT_MODEL=gpt-transcribe`. Spec ưu tiên (2) cho lần chuyển, vì
  rollback chỉ cần xoá hoặc đổi env. T014 đổi mặc định code sau khi ổn định.
- **ElevenLabs Flash (Q1-a)** và một dự phòng STT bằng Azure (nếu sau này có spec
  riêng) **không cần thêm secret** trên prod. Việc có dùng hay không vẫn theo
  kết quả A/B và lời duyệt của anh Vinh. Key có sẵn không phải là quyền dùng.

## Scope

- STT chấm Speaking (`grading.py`) và admin chạy lại transcript (`admin.py`)
  chuyển sang model còn được hỗ trợ trước 26/02/2027, không làm chất lượng chấm
  kém đi một cách đo được.
- Bộ phân loại độ tin cậy transcript và mức trần LR/GRA vẫn hoạt động đúng với
  model mới.
- `POST /tts` và render admin câu Part 1/3 chuyển sang engine còn được hỗ trợ
  trước 06/01/2027. Hợp đồng HTTP của `/tts` giữ nguyên.
- Bảng giá, usage log và ước tính ngân sách đúng với model mới.
- Có chốt ngày tắt model, kill switch, đường rollback, A/B có ngân sách trần,
  và mốc thời gian lùi từ hai ngày tắt.

## Non-goals

- Vocabulary audio (Kokoro), Listening (ElevenLabs), phát âm khoá học (Kokoro):
  không đổi.
- Không render lại hay xoá audio đã sinh sẵn bằng `tts-1`. Các file đó vẫn hợp
  lệ.
- Không thêm tính năng Speaking dùng Realtime (hội thoại trực tiếp).
- Không triển khai lại các call site `guard` của AIBUDGET-0033 T004. Spec này
  chỉ bảo đảm ước tính cho model mới tồn tại, để khi T004 quay lại thì không bị
  `config_invalid`.
- Không thay grader Speaking (Claude/Gemini), không đổi prompt chấm.
- Không phục hồi word timestamps (audit #8). Cờ này đang tắt và sẽ không có
  model kế nhiệm (Q8).

## Users and journeys

- **Học viên luyện Speaking (practice):** bấm nghe đề → `POST /tts` → nghe giọng
  AI. Nếu lỗi, trình duyệt đọc bằng `speechSynthesis`. Sau thay đổi: nghe giọng
  của engine mới (giọng khác `nova`). Có thêm dòng nhỏ "Giọng đọc do AI tạo"
  nếu anh Vinh duyệt Q6. Nếu engine tắt hoặc lỗi thì vẫn dự phòng như cũ, không
  có màn hình lỗi.
- **Học viên làm bài Part 1/3 nghe đề (lớp):** phát `audio_url` sinh sẵn. Không
  đổi gì.
- **Học viên nộp câu trả lời Speaking:** ghi âm → `POST /sessions/{id}/responses`
  → STT → độ tin cậy → chấm. Sau thay đổi: chạy STT bằng model mới. Điểm,
  phản hồi và cảnh báo "ghi âm hạn chế" giữ cùng ý nghĩa (A/B chứng minh).
- **Admin/giáo viên soạn đề Part 1/3:** bấm "Tạo audio" → bản đọc đề mới dùng
  engine mới, thuộc nhóm giọng mới. Câu cũ giữ nhóm cũ. Muốn giao nhiều câu cùng
  một giọng thì render lại cả chủ đề. Thông báo hiện có
  (`admin_class_assignments.py:491-493`) đã hướng dẫn việc này.
- **Admin chạy lại chấm (regrade):** transcript chạy lại bằng model mới, usage
  log ghi đúng model.
- **Vận hành (Leader/Release):** đổi model bằng env, tắt TTS AI bằng runtime
  flag, xem chi phí theo model trên dashboard AI.

## So sánh phương án

Giá trong mục này lấy từ [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
(đọc 10/11/2026), trừ khi ghi khác. Chỗ nào không có số công khai thì ghi
"chưa xác minh".

### STT

| Tiêu chí | `gpt-transcribe` (khuyến nghị) | `gpt-live-transcribe` | Khác: Azure Speech STT | Giữ `whisper-1` |
| --- | --- | --- | --- | --- |
| API | Cùng endpoint `/v1/audio/transcriptions`, upload file. Phải đổi `language` thành `languages=["en"]`; không có `timestamp_granularities`; không có `logprobs` (API reference, đọc 10/11/2026) | Realtime transcription session (WebSocket/WebRTC) cho audio đang phát. Ta có file hoàn chỉnh nên phải viết harness stream mới | SDK/REST của Azure. Resource S0 đã có cho Pronunciation Assessment. Định dạng, giới hạn độ dài và trường confidence cho luồng của ta **chưa xác minh** | Không khả thi sau 26/02/2027 |
| Chất lượng accent VN, giữ filler | Chưa xác minh, cần A/B. Docs khuyên dùng cho file đã ghi | Chưa xác minh | Chưa xác minh | Mốc so sánh hiện tại |
| Tín hiệu độ tin cậy | `avg_logprob`/`no_speech_prob` theo đoạn **chưa xác minh** (T001 thăm dò). Giả định xấu nhất: không có | Chưa xác minh | Azure có confidence/NBest theo docs chung, **chưa xác minh** cho cấu hình ta dùng | Có (verbose_json segments) |
| Độ trễ | Chưa xác minh. Có streaming file (`stream=true`) | Thiết kế cho realtime. Với file có sẵn thì không có lợi rõ | Chưa xác minh | Mốc so sánh (`stt_latency_ms`, `grading.py:617-620`) |
| Giá | **0,0045 USD/phút** (−25 % so với Whisper 0,006 USD/phút) | **0,017 USD/phút** (≈ 2,8× Whisper) | 1,00 USD/giờ audio ≈ 0,0167 USD/phút theo comment `ai_pricing.py:156-165` (Azure quan sát 29/10/2026). Em **chưa đọc lại** trang giá Azure | 0,006 USD/phút |
| Dữ liệu học viên | `/v1/audio/transcriptions`: không dùng để train, abuse-monitoring retention "None" ([your-data](https://developers.openai.com/api/docs/guides/your-data), đọc 10/11/2026). Giống hôm nay | `/v1/realtime/transcription_sessions` thuộc nhóm Realtime. Bảng `/v1/realtime` ghi retention 30 ngày, **tệ hơn** hôm nay | Audio đã gửi Azure cho Pronunciation Assessment. Chính sách lưu trữ **chưa xác minh** | — |
| ai_pricing / ai_budget / usage log | Đã có `UnitRate` theo giây audio, cần thêm link nguồn. `log_whisper` dùng lại được. `ai_budget.estimate_or_none(audio_seconds=...)` chạy luôn | Cần `UnitRate` mới cùng harness mới | Cần `UnitRate` mới (service `azure`, model STT) cùng adapter mới | — |
| Dự phòng | Trước 26/02: `whisper-1` (Q4). Sau đó: không có dự phòng tự động trong spec này | — | Có thể làm dự phòng thứ hai về sau (spec riêng, đổi phạm vi dữ liệu và chi phí) | — |

**Khuyến nghị STT:** dùng `gpt-transcribe`. Đây là đường đổi nhỏ nhất (cùng
endpoint), rẻ hơn, và giữ nguyên chính sách dữ liệu hôm nay. Không chọn
`gpt-live-transcribe`, vì nó sai dạng API với file đã ghi, giá gấp ≈ 3,8 lần
`gpt-transcribe` và có retention 30 ngày. Azure để dành làm phương án dự phòng
nếu A/B của `gpt-transcribe` trượt.

### TTS

| Tiêu chí | A. `gpt-realtime-2.1-mini` (OpenAI) | B. Kokoro-82M tự host | C. ElevenLabs (đã tích hợp) | D. Chỉ `speechSynthesis` trình duyệt |
| --- | --- | --- | --- | --- |
| API | Realtime API (WebSocket/WebRTC). "Isn't a supported model for `/v1/audio/speech`" (TTS guide). Cần client session mới và chuyển PCM sang mp3 (pydub đã có, `tts_audio.py:137-158`) | Thư viện Python có sẵn (`tts_audio.py:219-283`). Railway prod **không** cài (`speaking_question_audio.py:32-34`). Cần cài torch cùng model vào image, hoặc chạy service riêng | REST sync có sẵn (`tts_audio.py:196-216`), trả mp3. Cần thêm biến thể async cho `/tts` | Không cần backend |
| Đọc đúng nguyên văn | **Rủi ro.** Đây là model hội thoại, phải ép "chỉ đọc nguyên văn" bằng instructions. Chưa xác minh | Có (TTS thuần) | Có (TTS thuần) | Có |
| Giọng | `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar`; docs khuyên `marin`/`cedar` ([realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), đọc 10/11/2026). **Không có `nova`, `onyx`, `fable`** | `bf_emma` (Anh-Anh), cùng giọng với clip Kokoro sinh sẵn của câu hỏi và phát âm khoá học | Voice en-GB cấu hình ở `config.py:504` | Tuỳ thiết bị |
| Chất lượng | Chưa xác minh | Chưa đo với câu đọc live | Chưa đo trong A/B | Không đồng đều |
| Độ trễ | Chưa xác minh (mở session rồi stream) | Chưa xác minh. Nạp model mất vài giây khi khởi động lạnh (docstring `tts_audio.py:274-283`) | Chưa xác minh | Gần 0 |
| Giá | Text in **0,60 USD/1M token**, audio out **20 USD/1M token**. Số token audio mỗi giây **chưa xác minh**, nên giá mỗi câu **chưa xác minh** | 0 USD mỗi lần gọi. Chi phí hạ tầng (RAM/CPU Railway) **chưa xác minh** | Flash v2.5 **0,04 USD/1K ký tự**, Multilingual v2 **0,08 USD/1K ký tự**, theo `ai_pricing.py:149-155` (nguồn [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api), code đọc 12/10/2026; em chưa đọc lại), tức 2,7×–5,3× `tts-1` (15 USD/1M ký tự) | 0 |
| ai_pricing / ai_budget / usage log | Cần loại giá token có modality audio. `ai_budget.estimate_or_none` hiện không ước tính được TTS theo token (`ai_budget.py:191-196` chỉ có `text_chars`), nên khi T004 quay lại sẽ bị `config_invalid` nếu không bổ sung | Không có chi phí gọi. Ghi usage `service="kokoro"`, `cost_usd_est=0` | Đã có `UnitRate`, `log_tts(service="elevenlabs")` và scope ngân sách `elevenlabs` (trần cứng mặc định 20 USD/tháng, `config.py:368-379`, **dùng chung với Listening**) | Không |
| Dữ liệu gửi bên thứ ba | Chỉ gửi chữ của đề, không có dữ liệu học viên. `/v1/realtime`: không train, retention 30 ngày | Không | Chữ của đề. Chính sách lưu trữ ElevenLabs **chưa xác minh** | Không |
| Audio sinh sẵn | Không ảnh hưởng | Không ảnh hưởng | Không ảnh hưởng | Không ảnh hưởng |

**Khuyến nghị TTS:**

- Server dùng **C (ElevenLabs Flash v2.5)** cho cả `/tts` và render admin, với
  điều kiện A/B đạt. Lý do:
  - Là TTS thuần, đọc đúng nguyên văn.
  - Hợp đồng REST/mp3 giống `tts-1`.
  - Đã có giá, usage log và scope ngân sách.
  - Chạy được trên Railway ngay.
- **A** là phương án thứ hai nếu C trượt chất lượng, hoặc nếu anh Vinh không
  muốn tăng chi phí. A cần thêm client Realtime và loại giá theo token, nên lát
  job lớn hơn (L).
- **B** chỉ giữ cho mẻ pregen offline như hiện nay. Không đưa lên Railway trước
  06/01/2027 vì rủi ro hạ tầng.
- **D** luôn là lớp dự phòng cuối.
- Đổi engine là đổi chi phí và đổi giọng, nên cần anh Vinh quyết (Q1).

## Requirements

- **FR-001:** `services/whisper.py` xây request STT từ **một** bảng năng lực theo model. Bảng gồm: tham số ngôn ngữ (`language="en"` cho `whisper-1`, `languages=["en"]` cho `gpt-transcribe`, không bao giờ gửi cả hai); `response_format`; có hay không `timestamp_granularities`; có hay không `prompt`; và cách đọc response (`text`, `duration`, `language`/`languages`, `segments`, `usage`). Model không có trong bảng bị từ chối **trước** khi gọi provider, kèm log `[stt] config_invalid model=<id>`, và luồng chấm trả 502 như lỗi STT hiện tại. Bảng cho `gpt-transcribe` ghi đúng kết quả thăm dò T001.
- **FR-002:** Response Speaking (`transcript_model`) và dòng `ai_usage_logs` (`model`) ghi **đúng model đã trả transcript**, kể cả khi đó là model dự phòng. Bỏ giá trị mặc định cứng `"whisper-1"` ở `grading.py:633` và `admin.py:4537`; thay bằng model trả về từ adapter.
- **FR-003:** Khi response STT không có `avg_logprob`/`no_speech_prob` theo đoạn, `classify_reliability` không được dùng hằng số trung tính làm nhãn bị ép về "medium". Bộ tín hiệu thay thế phải được ghi trong code và trong plan.md. Ứng viên: tốc độ từ, duration, tỉ lệ chữ trên duration, và điểm Pronunciation Assessment nếu có. Ngưỡng hiệu chỉnh bằng A/B: trên cohort A/B, các mẫu audio xấu đã gắn nhãn (ồn, nhỏ, cắt) vẫn ra "low"; tỉ lệ nhãn low/medium/high lệch không quá 10 điểm phần trăm mỗi nhãn so với `whisper-1` trên cùng audio. Mức trần LR/GRA (`grading.py:212-240`) vẫn bật cho các mẫu "low" đó.
- **FR-004:** Khi STT không trả duration, backend đo bằng ffprobe như hiện tại. Image backend prod và staging phải có `ffprobe`: kiểm bằng một test hoặc health check. Trên cohort A/B, tỉ lệ duration không biết phải bằng 0. Mỗi lần duration không biết ghi một log có đếm được (`[stt] duration_unknown model=<id>`).
- **FR-005:** `SPEAKING_WORD_TIMESTAMPS_ENABLED` chỉ có hiệu lực khi model STT là `whisper-1`. Với model khác, backend bỏ qua cờ, ghi đúng một cảnh báo mỗi tiến trình, không gửi `timestamp_granularities`, và `fluency_signals` nhận danh sách rỗng mà không lỗi.
- **FR-006:** `ai_pricing` có dòng giá cho mọi model STT và TTS mà spec này cho phép chạy. Mỗi dòng có comment link nguồn công khai và ngày đọc (với `gpt-transcribe`: 0,0045 USD/phút, pricing đọc 10/11/2026). `ai_budget.estimate_or_none` trả được một ước tính có trần cho từng model đó. Một model không có giá bị từ chối trước khi gọi provider (giữ nguyên AIBUDGET-0033 FR-004).
- **FR-007:** Model STT chính chọn bằng `WHISPER_STT_MODEL`. Có tuỳ chọn `STT_FALLBACK_MODEL`, mặc định rỗng tức không dự phòng. Khi bật (Q4), nếu model chính lỗi 5xx, timeout hoặc lỗi mạng, backend thử **đúng một** lần với model dự phòng. Mỗi lần thử ghi một dòng usage riêng có chi phí và một sự kiện `grading_events` riêng. Lỗi 4xx (request sai) không kích hoạt dự phòng.
- **FR-008:** Admin chạy lại transcript (`admin.py:4516-4547`) dùng cùng adapter, cùng model và cùng quy tắc dự phòng với luồng chấm, và ghi usage đúng model.
- **FR-009:** `POST /tts` chọn engine bằng config `QUESTION_TTS_ENGINE`. Giá trị hợp lệ: engine đang chạy hôm nay (`openai_tts1`, chỉ hợp lệ đến hết 05/01/2027), engine thay thế được duyệt ở Q1, và `off`. Hợp đồng HTTP giữ nguyên: request `{text, voice, session_id?}`, response `audio/mpeg`, `Cache-Control: no-store`. Thứ tự các chốt giữ nguyên: throttle IP → auth → activation → entitlement → quota ngày → provider.
- **FR-010:** Trường `voice` của client (frontend luôn gửi `nova`, `practice.js:2777`) được ánh xạ phía server sang **một** giọng đã duyệt của engine thay thế. Giá trị lạ dùng giọng mặc định đã duyệt. Frontend không cần đổi để chạy được.
- **FR-011:** Engine thay thế phải đọc đúng nguyên văn `text`. Nếu engine là model hội thoại (phương án A), backend gửi kèm instructions chỉ-đọc-nguyên-văn và giới hạn độ dài audio đầu ra theo số ký tự. Vượt giới hạn thì huỷ, ghi chi phí, trả 502, và frontend rơi về `speechSynthesis`. A/B kiểm bằng phép phiên âm ngược.
- **FR-012:** Render admin câu Part 1/3 (`admin.py:3440-3490`) dùng engine thay thế khi engine đó chạy được trên Railway sau 06/01/2027. `speaking_question_audio` có một khoá provider mới cho engine này. Clip `openai` cũ vẫn được `audio_provider` nhận là `"openai"` qua tag cũ `openai-tts-1`. Hệ thống không tự render lại câu nào. Nhóm cùng giọng khi giao bài (`admin_class_assignments.py:432-448`) có thêm nhóm mới và không trộn giọng.
- **FR-013:** Không object nào trong bucket `vocab-audio` bị xoá hay ghi đè vì thay đổi này. Tag đường dẫn của engine mới khác mọi tag cũ. `_ACCENT_TAG = "openai-tts-1"` vẫn được giữ làm tag nhận diện clip cũ.
- **FR-014:** Mỗi lần gọi TTS ghi `ai_usage_logs` với `service` và `model` **thật** của engine đã chạy, thay cho chuỗi cứng `"tts-1"` ở `tts.py:217`, cùng `text_chars`. Engine tính tiền theo token thì ghi `input_tokens`/`output_tokens` từ usage provider trả về. Engine tự host ghi `cost_usd_est = 0` kèm `pricing_version` riêng. Quota `TTS_DAILY_LIMIT_PER_USER` vẫn đếm `feature="question_tts"` như cũ, không phụ thuộc engine.
- **FR-015:** Backend có một bảng ngày tắt model trong code: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` → 2027-01-06; `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize` → 2027-02-26. Từ 30 ngày trước ngày tắt, mỗi tiến trình ghi một cảnh báo mỗi ngày khi model đó đang được cấu hình làm model chính hoặc dự phòng. Từ ngày tắt (giờ UTC), backend không gọi model đó nữa: với STT dự phòng thì bỏ qua; với TTS thì coi như `off`; với STT chính thì log `config_invalid` và trả 502 như FR-001, không gửi request vào model đã chết. Test dùng đồng hồ giả.
- **FR-016:** Runtime flag `question_tts_ai` (mặc định bật khi chưa có hàng) khi tắt làm `POST /tts` trả 503 `{error_code: "tts_disabled"}` trước mọi lệnh gọi provider. Khi nhận 503 này, frontend đọc bằng `speechSynthesis` mà không hiện thông báo lỗi. Đọc flag lỗi thì coi như tắt (theo AIBUDGET-0033 FR-006).
- **FR-017:** Không log audio, không log nội dung transcript hay chữ TTS ở mức INFO/ERROR ngoài những gì đã log hôm nay (độ dài, số đoạn). Không log API key. Audio học viên chỉ gửi tới endpoint OpenAI có "Data used for training: No" trong bảng your-data. Gửi audio học viên tới bất kỳ provider mới nào cần anh Vinh duyệt riêng.
- **FR-018:** Nếu anh Vinh duyệt Q6, mọi chỗ phát giọng TTS AI cho học viên hiện dòng "Giọng đọc do AI tạo". Dòng này đáp ứng yêu cầu công bố giọng AI trong usage policies mà TTS guide của OpenAI dẫn. Nếu không duyệt, ghi quyết định vào verification.
- **FR-019:** Trước khi đổi model trên prod, verification ghi một báo cáo A/B đạt các tiêu chí trong plan.md (STT: WER, độ lệch band, nhãn độ tin cậy, duration, độ trễ; TTS: nguyên văn, chất lượng nghe, độ trễ, chi phí đo từ usage thật), kèm tổng chi phí A/B thực tế không vượt trần Leader đã xác nhận.

## Acceptance scenarios

### Scenario 1: Chấm Speaking bằng gpt-transcribe

- **Given** staging đặt `WHISPER_STT_MODEL=gpt-transcribe` và bảng năng lực đã cập nhật theo T001
- **When** học viên nộp một câu trả lời Part 2 dài 90 giây
- **Then** request gửi `languages=["en"]` và không có `language`; response có `transcript_model="gpt-transcribe"`, duration lớn hơn 0 và nhãn độ tin cậy từ bộ tín hiệu đã hiệu chỉnh; `ai_usage_logs` có một dòng `model=gpt-transcribe`, `feature=speaking_stt`, cost = giây × 0,0045/60

### Scenario 2: Audio xấu vẫn bị gắn nhãn "low"

- **Given** một bản ghi trong cohort audio xấu (ồn nền, nói nhỏ)
- **When** chấm ở test mode với `gpt-transcribe`
- **Then** nhãn là "low", LR/GRA bị cắt về Band 6 và phản hồi có dòng cảnh báo ghi âm

### Scenario 3: Dự phòng STT trước ngày tắt

- **Given** `STT_FALLBACK_MODEL=whisper-1`, ngày hiện tại 10/02/2027 và `gpt-transcribe` trả 503
- **When** học viên nộp câu trả lời
- **Then** backend thử `whisper-1` đúng một lần; transcript chấm bình thường với `transcript_model="whisper-1"`; có hai dòng usage (lần lỗi và lần thành công) và hai sự kiện `grading_events`

### Scenario 4: Sau ngày tắt không gọi model chết

- **Given** đồng hồ giả 27/02/2027 và `STT_FALLBACK_MODEL=whisper-1`
- **When** `gpt-transcribe` lỗi 503
- **Then** backend không gọi `whisper-1` và trả 502 như hôm nay; log có `[stt] fallback_skipped_retired model=whisper-1`

### Scenario 5: Đọc đề bằng engine mới

- **Given** `QUESTION_TTS_ENGINE` là engine đã duyệt ở Q1
- **When** học viên bấm nghe một câu Part 1 với body `{text, voice:"nova"}`
- **Then** server dùng giọng đã ánh xạ, trả `audio/mpeg`; `ai_usage_logs` ghi service và model thật; quota ngày tăng 1

### Scenario 6: Tắt TTS AI khẩn cấp

- **Given** runtime flag `question_tts_ai` = false
- **When** học viên bấm nghe đề
- **Then** `/tts` trả 503 `tts_disabled` mà không gọi provider; trình duyệt đọc bằng `speechSynthesis` và không có toast lỗi

### Scenario 7: Render admin sau 06/01/2027

- **Given** đồng hồ giả 07/01/2027, một câu Part 1 mới chưa có audio, và chủ đề có 5 câu `openai` cũ
- **When** admin bấm "Tạo audio"
- **Then** clip mới thuộc nhóm provider mới; 5 câu cũ vẫn là nhóm `openai` và vẫn giao được với nhau; không object cũ nào bị ghi đè

## Edge cases

- `gpt-transcribe` trả `languages: []` (không nhận ra ngôn ngữ): ghi `language="en"` như mặc định hiện tại (`whisper.py:255`), transcript rỗng thì 422 như hôm nay.
- Prompt quá dài hoặc có ký tự bị cấm: theo docs, API từ chối **cả** request. Prompt cố định hiện tại không có các ký tự đó; test khoá chuỗi này.
- File > 24,5 MB: từ chối trước khi gọi, giữ như `whisper.py:225-229`.
- Provider fixture mode (`whisper.py:217-219`) trả fixture cho mọi model, nên test không gọi mạng.
- Một lượt nộp bị retry (`retry_safe`): dự phòng STT không được làm tăng `grading_attempts` lần thứ hai.
- TTS: chữ dài 4 096 ký tự (`tts.py:52`) phải nằm trong giới hạn của engine mới; nếu engine có giới hạn thấp hơn thì chia đoạn hoặc từ chối 422. **Chưa xác minh** giới hạn của ElevenLabs và Realtime cho một request.
- Đọc runtime flag lỗi: tắt TTS AI, dùng trình duyệt (FR-016).
- Hai admin bấm "Tạo audio" cùng lúc cho cùng một câu: giữ chốt điều kiện hiện có (`admin.py:3478-3490`).
- Đổi `WHISPER_STT_MODEL` trên Railway cần khởi động lại tiến trình; trong lúc rolling deploy hai model có thể chạy song song vài phút. Điều này chấp nhận được vì mỗi dòng ghi đúng model.

## Thay đổi dữ liệu, config, migration

- **Migration:** không cần. `ai_usage_logs` đã có `service`/`model` kiểu text cùng `input_tokens`/`output_tokens`/`text_chars`/`audio_seconds` (`migrations/031_ai_usage_logs.sql:20-34`); `transcript_model` là TEXT (`migrations/006`); runtime flag mặc định bật khi chưa có hàng (`runtime_flags.is_enabled(default=True)`). Nếu lúc làm phát hiện cần migration thì dừng lại và xin Leader cấp số. Không tự tạo.
- **Config mới (code):** `QUESTION_TTS_ENGINE`, `QUESTION_TTS_VOICE` (giọng đã duyệt của engine mới), `STT_FALLBACK_MODEL`, bảng ngày tắt model (hằng số trong code, không phải env).
- **Env prod cần đổi (Release Manager làm, cần anh Vinh duyệt):** `WHISPER_STT_MODEL=gpt-transcribe`; `QUESTION_TTS_ENGINE=<engine Q1>`; `STT_FALLBACK_MODEL=whisper-1` (nếu Q4 = có) rồi xoá trước 26/02/2027. Prod hiện chưa đặt `WHISPER_STT_MODEL` (mặc định code là `whisper-1`, Q7). Nếu chọn C: `ELEVENLABS_API_KEY` đã có trên prod (Q7), chỉ cần chốt trần `AI_BUDGET_MONTHLY_USD_ELEVENLABS`.
- **Dữ liệu:** không ghi DB ngoài usage log và kết quả chấm như hôm nay. Không backfill, không render lại.

## API và contract

- `POST /tts`: request, response và mã lỗi giữ nguyên. Thêm 503 `{error_code: "tts_disabled"}` (FR-016). Mã này cùng họ với 503 `ai_budget_exhausted` mà frontend đã xử lý bằng dự phòng. `frontend/types/api.d.ts:393` cần bổ sung mô tả lỗi; OpenAPI drift kiểm trong CI.
- `POST /sessions/{id}/responses`: không đổi shape. Giá trị `transcript_model` có thể là `gpt-transcribe`; `transcript_reliability` vẫn là `high|medium|low`.
- `POST /admin/topics/{topic_id}/questions/{question_id}/render-audio`: không đổi shape; `audio_path` của clip mới mang tag engine mới.
- Nội bộ: `services/whisper.transcribe_from_bytes` vẫn trả cùng dict (`transcript`, `duration_seconds`, `language`, `confidence`, `transcript_model`, `segments`, `words`). `segments` có thể rỗng.

## Rủi ro bảo mật và riêng tư

- **Audio học viên gửi bên thứ ba:** hôm nay đã gửi OpenAI (`whisper-1`). `gpt-transcribe` đi cùng endpoint, chính sách giống hôm nay (không train, abuse retention "None", đủ điều kiện ZDR theo bảng your-data đọc 10/11/2026). `gpt-live-transcribe` (Realtime) có retention 30 ngày, nên không chọn. Mọi dự phòng sang provider khác cho audio học viên đều cần anh Vinh duyệt (FR-017).
- **Audio dùng cho A/B:** chỉ lấy bản ghi staging hoặc bản ghi prod đã được anh Vinh cho phép (Q3). Lưu ở thư mục private trên box (không git, không bucket public), tên file chỉ dùng ID ẩn danh, xoá sau 30 ngày kể từ báo cáo. Transcript tham chiếu do người gõ cũng là dữ liệu cá nhân, xử lý giống audio.
- **Key:** không cần key OpenAI mới. Nếu chọn C thì dùng `ELEVENLABS_API_KEY` đã có trên prod (Q7, 10/11/2026); `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` cũng đã có. Job A/B dùng key staging do Release/Leader cấp qua env, không in, không ghi vào báo cáo. Không đọc `/workspace/qa/creds/*`.
- **Log:** giữ mức log hiện tại (độ dài, số đoạn, độ tin cậy). Không log transcript hay chữ TTS. Lỗi provider log `str(e)` như hiện tại (`grading.py:622`), cần kiểm để chắc không chứa header Authorization.
- **TTS:** chỉ gửi chữ đề, không có dữ liệu học viên. Rủi ro thấp.
- **Công bố giọng AI:** theo usage policies OpenAI (TTS guide). Áp dụng cho cả `tts-1` hôm nay (Q6).

## Success criteria

- Trước 06/01/2027: prod không còn gọi `tts-1`. Theo dõi `ai_usage_logs` (service `tts`, model `tts-1`) = 0 dòng mới sau ngày chuyển (Release đọc với quyền anh Vinh cấp). `/tts` có tỉ lệ 2xx ≥ 99 % trong 48 giờ đầu.
- Trước 26/02/2027: prod không còn gọi `whisper-1` làm model chính. Mọi lượt chấm có `transcript_model` thuộc model được hỗ trợ.
- Báo cáo A/B STT đạt: WER của `gpt-transcribe` không kém `whisper-1` quá 1 điểm phần trăm tuyệt đối; độ lệch band overall trung bình ≤ 0,25; ≥ 90 % mẫu lệch trong ±0,5; số mẫu đổi phía mốc 6/7 ≤ 5 %; mẫu audio xấu vẫn ra "low" 100 %; duration không biết = 0.
- Báo cáo A/B TTS đạt: phiên âm ngược đúng nguyên văn (WER ≤ 2 %, không thêm từ) trên 100 % mẫu; điểm nghe mù không thấp hơn `tts-1`; p95 thời gian trả đủ audio cho câu ~150 ký tự ≤ 6 giây (mục tiêu, Leader xác nhận).
- Chi phí A/B thực tế ≤ trần Leader xác nhận.
- Kill switch TTS và rollback env STT đều được diễn tập trên staging và ghi vào verification.

## Open questions

Các mục dưới đây là câu hỏi kỹ thuật, không chặn việc duyệt. T001, T005 và T007
sẽ trả lời và ghi kết quả vào plan.md hoặc verification.md.

- T001 thăm dò `gpt-transcribe`: có `segments`/`avg_logprob`/`no_speech_prob`/`duration` trong `verbose_json` không, có từ chối `language` không, `usage.type` là `duration` hay `tokens`. Kết quả quyết định độ lớn của FR-003.
- Số token audio mỗi giây của `gpt-realtime-2.1-mini`. Chưa có số công khai mà em đọc được; chỉ cần nếu chọn A.
- Giới hạn ký tự mỗi request của ElevenLabs Flash v2.5 và chính sách lưu dữ liệu của ElevenLabs.
- Image Railway prod có `ffprobe` không.
- Gold set Speaking (`gold_speaking`, mig 144) đang để "parked" (`docs/TECH_DEBT_gold_set_A1.md`), nên A/B dùng so sánh cặp (cùng audio, cùng grader) và transcript tham chiếu do người gõ, không dùng band người chấm.

## Câu hỏi cho anh Vinh

**Đã chốt toàn bộ Q1–Q8 theo khuyến nghị** (t1543s5028, 11:25 ngày 10/11/2026;
xem "Quyết định của anh Vinh"). Nội dung gốc giữ lại bên dưới để đối chiếu.

- **Q1 (chi phí, hành vi) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** đổi engine đọc đề (`/tts` và nút admin "Tạo audio")
  sang:
  (a) ElevenLabs Flash v2.5: 0,04 USD/1K ký tự, gấp ≈ 2,7 lần `tts-1`; giọng
  en-GB. Dùng chung scope ngân sách `elevenlabs` (mặc định trần cứng 20 USD/tháng)
  với Listening, nên có thể phải nâng trần;
  (b) `gpt-realtime-2.1-mini` của OpenAI: giá mỗi câu chưa xác minh, giọng
  `marin`/`cedar`, việc làm lớn hơn, có rủi ro đọc không nguyên văn;
  (c) bỏ giọng AI, chỉ dùng giọng trình duyệt: 0 USD, chất lượng tuỳ máy.
  Cả (a) và (b) đều đổi giọng vì không còn `nova`.
  **Khuyến nghị: (a), nếu A/B đạt; trượt thì (b).** Giữ (c) làm dự phòng như hôm
  nay.
- **Q2 (chi phí, để anh biết) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** A/B gọi API trả phí ở mức tối thiểu, trần đề
  xuất **30 USD tổng** (STT kèm chấm lại ≤ 25 USD, TTS ≤ 5 USD; chi tiết ở
  plan.md "Verification strategy"). Leader xác nhận trước khi chạy, không chạy
  khi chưa có xác nhận. **Khuyến nghị: duyệt trần này.**
- **Q3 (dữ liệu, quyền) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** cho phép lấy khoảng 60 bản ghi Speaking thật trên prod
  (chỉ đọc, ẩn danh, lưu private, xoá sau 30 ngày) cùng transcript chấm sẵn để
  A/B STT? Nếu không, A/B chỉ dùng bản ghi staging và bản ghi nội bộ, kém đại
  diện hơn cho accent học viên. **Khuyến nghị: cho phép**, cấp quyền đọc prod
  cho đúng một job A/B.
- **Q4 (chi phí, hành vi) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** từ khi chuyển đến 19/02/2027, khi `gpt-transcribe`
  lỗi thì thử lại một lần bằng `whisper-1` (chỉ tốn tiền khi có lỗi)?
  **Khuyến nghị: có**, rồi gỡ trước 26/02/2027.
- **Q5 (hành vi chấm) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** chấp nhận nhãn độ tin cậy transcript được tính lại bằng
  bộ tín hiệu mới (FR-003). Mức trần LR/GRA vẫn giữ nhưng điều kiện bật dựa trên
  tín hiệu khác. **Khuyến nghị: chấp nhận**, với điều kiện A/B đạt các ngưỡng ở
  Success criteria.
- **Q6 (hành vi UI) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** thêm dòng "Giọng đọc do AI tạo" cạnh nút nghe đề (yêu cầu
  của usage policies OpenAI)? **Khuyến nghị: có.**
- **Q7 (quyền) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** cấp cho Release Manager quyền đọc env prod, chỉ các biến không
  bí mật (`WHISPER_STT_MODEL`, `SPEAKING_WORD_TIMESTAMPS_ENABLED`,
  `QUESTION_TTS_*`) và việc *có hay không* `ELEVENLABS_API_KEY` (không đọc giá
  trị). **Khuyến nghị: cấp.** Đã chốt: owner là Release Manager. **Đã xong** lúc 11:26 ngày 10/11/2026 (snapshot `/workspace/cc-jobs/reports/railway-env-20261110-1126-audio.txt`).
- **Q8 (hành vi) — ĐÃ CHỐT theo khuyến nghị (t1543s5028):** word timestamps (audit #8, cờ đang tắt) không còn model kế
  nhiệm sau 26/02/2027. Chấp nhận để cờ này vô hiệu cho đến khi có spec riêng?
  **Khuyến nghị: chấp nhận.**

## Changelog

- 10/11/2026 11:04 (giờ Việt Nam): FD viết bản nháp đầu, `status: draft`.
- 10/11/2026 11:25 (giờ Việt Nam): anh Vinh duyệt (t1543s5028, qua Leader),
  chốt Q1–Q8 theo khuyến nghị. Đổi `status: approved`. Thêm mục "Quyết định của
  anh Vinh" và các điều kiện: T001 chỉ staging, tối đa 5 lần gọi, không đổi env,
  Leader xếp hàng nếu là job code; T005a để Security Auditor kiểm script trích
  dữ liệu ẩn danh trước khi đọc prod; Q7 owner Release Manager. Không đổi
  FR, phạm vi hay risk.
- 10/11/2026 11:26 (giờ Việt Nam): **Q7 xong.** Release Manager đọc env Railway
  prod ở chế độ chỉ đọc (snapshot
  `/workspace/cc-jobs/reports/railway-env-20261110-1126-audio.txt`; FD không đọc
  file này). Kết quả: `WHISPER_STT_MODEL` không đặt nên dùng mặc định
  `whisper-1`; có `ELEVENLABS_API_KEY`, `AZURE_SPEECH_KEY` và
  `AZURE_SPEECH_REGION`. Đã bỏ "env prod chưa kiểm" và ghi hệ quả: đổi STT bằng
  env hoặc bằng mặc định code qua quy trình release; ElevenLabs và Azure không
  cần thêm secret. Không đổi FR.
- 10/11/2026 11:29 (giờ Việt Nam): Leader quyết định chuyển việc review UI của
  T010 từ UI Auditor (đã nghỉ) sang Product QA, và để FD mở PR spec vào
  `staging`. Đã sửa plan.md và tasks.md. Không đổi FR.
