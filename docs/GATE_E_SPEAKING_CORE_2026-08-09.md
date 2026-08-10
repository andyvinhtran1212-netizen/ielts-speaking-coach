# Gate E Speaking core — dark route bridge — 2026-08-09

**Trạng thái:** DARK ROUTE BRIDGE ONLY; ADMISSION LEGACY. `/practice/session`
đã là một stable App Router URL nhưng chưa phải native behavior, chưa ready và
không nhận attempt mới.

## Finding

- **Root cause:** player Speaking vẫn là một IIFE 3.848 dòng, giữ MediaRecorder
  blob, timer, full-test chain và nhiều trạng thái ghi trong bộ nhớ. Port thẳng
  rồi flip cùng một batch sẽ làm mất vế phân biệt giữa lỗi shell/routing và lỗi
  recorder/persistence.
- **Severity:** Critical — response audio chỉ an toàn sau khi endpoint upload
  xác nhận; reload/renderer flip trước đó có thể làm mất bản thu duy nhất.
- **Impacted files/functions:** `frontend/public/pages/practice.html`,
  `frontend/public/js/practice.js`, `_uploadAndGrade()`, `_saveFtChain()`,
  `_finishTestAndShowResults()`, recorder/Part 2/sheet state machines và future
  `/practice/session`.
- **Minimal fix trong batch:** App Router sở hữu stable dark URL và SSR shell;
  bridge tiếp tục chạy canonical `practice.js`, chỉ boot sau auth/API/Supabase,
  báo lỗi hữu hình khi dependency không tới. Admission và `route_ready` giữ
  nguyên Legacy/false.
- **Verification:** build-time extractor fail closed khi body boundary, chrome,
  state contract hoặc script boundary drift; contract tests pin asset order,
  guarded boot, dark-route ownership và parity inventory.

## Ranh giới bằng chứng

Parity pair hiện chỉ mở hai URL không có query và so nhánh **THIẾU session_id**.
Nó chứng minh route, chrome, CSS, boot và error state cùng tồn tại; nó không
chứng minh recorder, upload, grading, full-test chain hoặc resume. Vì tài khoản
probe không có một session fixture ổn định, không được dùng cặp này để gọi player
ready.

Shell được trích từ repository HTML tại build time và từ chối mọi `<script>`;
scripts được layout nạp rõ thứ tự. Đây là bridge hữu hạn để có stable URL cho
drill, không phải đích kiến trúc. Native migration vẫn phải chuyển state/effect
ownership ra khỏi IIFE và cung cấp cleanup khi soft navigation/unmount.

## Exit còn lại trước khi `route_ready: true`

1. Port behavior sang client modules có cleanup cho stream, MediaRecorder,
   AudioContext, timers, blob URLs, TTS và document listeners.
2. Chạy browser tests với fixture cho practice, `test_part`, `test_full`, Part 2,
   assignment sheet và mock sitting.
3. Chứng minh reload/resume ở câu đã persist; failed/ambiguous upload giữ blob
   và cho retry; finalize không mất full-test chain.
4. Chạy Chromium/WebKit/iPhone emulation và real Safari/iOS evidence theo device
   matrix; kiểm microphone permission denied/retry/background-tab lifecycle.
5. Pin coexistence rollback floor SHA, rồi drill tab Legacy cũ, tab Next mới,
   reload/copy URL/admission rollback với canonical backend assertions.
6. Chỉ sau các bước trên mới đổi `next.route_ready` và `admit_new`; Legacy URL
   tiếp tục sống đến Gate F.
