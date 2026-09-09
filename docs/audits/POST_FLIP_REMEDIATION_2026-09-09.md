# Post-flip remediation — 2026-09-09

## Phạm vi và trạng thái

Owner yêu cầu “tiến hành chỉnh sửa theo phát hiện từ audit”. Các bản vá ở worktree riêng `ielts-speaking-coach-hard-flip`, nhánh `codex/post-flip-full-stack-audit-2026-09-09`, dựa trên release `453e748998fe4c1b8d0ca6ece71afcab6a937d9c`.

**Đã sửa local 8/9 hạng mục; chưa đóng rollout.** Không commit/push/PR, deploy, apply migration, đổi bucket, repair bài học viên hoặc dismiss log. Không sửa checkout của phiên khác, frozen legacy source hay Gate E threshold/evidence. Owner sau đó trả lời “OK” cho cập nhật mốc dependency Gate E: v20 chỉ đổi suite ID và hai dependency hash, không sửa test/harness hoặc lịch soak. [Audit gốc](POST_FLIP_FULL_STACK_AUDIT_2026-09-09.md) giữ nguyên số liệu trước sửa.

## Bản vá theo finding

| ID / severity | Root cause → bản vá tối thiểu | Files / functions | Xác minh và giới hạn |
|---|---|---|---|
| F01 / Medium | Dependency graph có advisory → Next 16.3.4, dependency vá tương thích; js-yaml 4.3.2 override hẹp cho OpenAPI tooling vì Redocly 1.34.19 vẫn pin 4.3.1 | `frontend/package.json`, `frontend/package-lock.json` | npm install/audit toàn bộ graph: 0 vulnerabilities; React giữ 19.2.7; sinh lại API types không drift. Chưa xác minh container/deployment thực tế; override cần bỏ khi upstream pin bản an toàn. |
| F02 / Medium | Parser multipart cũ, thiếu application body cap → python-multipart 0.0.32, đếm byte trước parser | `backend/requirements.txt`, `backend/services/request_safety.py:RequestSafetyMiddleware`, `backend/main.py` | Mặc định 64 MiB; riêng POST Listening full-test commit 68 MiB = audio 60 + ba text files × 2 + envelope 2 MiB. Inline review #1349 phát hiện aggregate ban đầu thiếu ba file phụ; đã thêm regression thực sự parse đủ bốn file ở max size và chặn cả Content-Length/streamed oversize. Per-file validation giữ nguyên. Không chạy DoS/load test thật. |
| F03 / Medium | Save có thể không settle, flush chờ vô hạn, UI chưa phản ánh dirty → request deadline 15s + abort, flush deadline 20s, pending ngay khi edit, đối chiếu generation, giải phóng promise khi hủy retry cũ | `frontend/lib/exam-save-deadline.mjs`, `listening-test-controller.mjs:createListeningSaveCoordinator`, `reading-exam-controller.mjs:createReadingSaveCoordinator`, hai native session TSX | Test timeout, starvation, edit trong khi save, late ACK, retry/recovery và pending labels. Giữ Reading full-answer final submission; Listening không finalize khi chưa lưu sạch. Không redirect mất draft khi save gặp 401. Timeout không chứng minh server chưa ghi; không thêm server-side ordering contract. |
| F04 / Medium | Admin Curated chỉ check role, gọi schema chưa có → check ledger 234–239 sau auth, cache 15s, fail closed với 503 và thông báo chưa sẵn sàng | `backend/services/curated_readiness.py`, `backend/routers/vocab_units.py:_require_curated_admin` (10 routes) | Test nonadmin bị chặn trước lookup, thiếu ledger không gọi domain service, đủ ledger cho phép tiếp tục. Không dùng learner flag để cấm editorial. Gate không tự kiểm chứng mọi RPC/table nếu ledger bị drift thủ công; không apply migration. |
| F05 / Medium, privacy | Bucket audio-responses public → **chưa đổi quyền**, giữ mở finding | `backend/routers/grading.py`, `backend/routers/sessions.py`, admin audio playback và Storage | Cần consumer/legacy compatibility và owner approval theo runbook bên dưới. HEAD đã được duyệt trước đây không phải quyền GET/tải hoặc đổi bucket. |
| F06 / Medium | Exact fingerprint còn floor 226, không tính extension 230 → profile 22 columns / 11 constraints | `backend/scripts/verify_prod_nextjs_migrations_213_225.sql`, regression sentinel | Wrapper READ ONLY trên production hiện exit 0, các check 213–225 và TTL 224 vẫn giữ. Không bỏ exact fingerprint hoặc chấp nhận superset tùy ý. Không thực hiện schema mutation fixture trên production. |
| F07 / Low | Readiness chỉ thử 5 bảng vocabulary cũ → thêm 9 bảng trọng yếu và projection cột; curated ledger kiểm tra khi feature enabled | `backend/routers/health.py:_CRITICAL_TABLES`, `_CRITICAL_COLUMNS`, `health_ready` | Test missing-column → degraded, optional feature off/on, error redaction. Giữ `/health` nhẹ và `/health/ready` HTTP 200/body verdict. Không coi đây là toàn bộ RPC/policy/schema audit. |
| F08 / Medium | Anonymous error extra không giới hạn → 64 KiB body, extra 8 KiB / depth 6 / 256 visited nodes, redact các key nhạy cảm, budget 600 requests/phút/worker | `backend/routers/error_logs.py:ErrorReportRequest.bounded_extra`, `backend/services/request_safety.py` | Test payload lớn/deep, burst, redaction, Unicode không hợp lệ, CORS và logging contracts. Không dùng forwarded IP làm identity; đây không phải distributed WAF hay redaction mọi PII tự do. Không insert log production để thử. |
| F09 / Low | Chữ hướng dẫn 12px dùng faint token → semantic secondary text token | `frontend/public/css/login-next.css:.lx-fine-print` | Browser local sáng/tối × 375/768/1440: contrast 6.07:1 / 8.93:1, 0px page overflow. Không đổi toàn bộ token hoặc redesign login. |

## Verification packet

- Backend: **133 passed**, với dependency parser cô lập và mock/no-network fixtures; gồm error logs, health, migration verifier, curated admin/pilot và CORS.
- Trước owner approval: frontend full unit suite **9.025 passed / 9.026 tests**, một failure là chốt frozen-file hashes cho hai dependency files. Sau owner duyệt mốc v20: **9.026/9.026 passed**, exit 0; frozen-suite preflight cũng pass. So sánh manifest với HEAD xác nhận chỉ suite ID và đúng hai dependency hashes thay đổi, mọi threshold/matrix/test entry giữ nguyên. Không xóa test, giảm threshold hay reset evidence để che failure. Đây là local test, không phải CI hoặc live Gate E/F pass.
- Build: Next 16.3.4 production build + TypeScript; legacy TypeScript check pass.
- API contract: sinh OpenAPI in-process bằng config giả, chạy pinned openapi-typescript 7.13.0 với dependency đã vá. PR #1349 CI phát hiện một dòng mô tả readiness được sửa sau lần sinh local; đã đồng bộ mô tả trong `frontend/types/api.d.ts`. Không thay request/response shape hoặc bỏ chốt drift.
- Browser fixture matrix: Admin Class Detail 27, Admin Writing New 8, Listening Test Session 9, Reading Test listing 15, Mock Exam 35 — tổng **94 assertions**. Đây là fixture local, không phải test account/database thật; Reading listing không được suy thành toàn bộ Reading player.
- Login: 6 kiểm tra contrast/overflow như F09; không cho request ra dịch vụ thật trong probe này.
- `git diff --check` pass. Không chạy Claude review trong remediation này; đã tự review theo skill review/UI/React, không gắn nhãn independent review.
- Scratch logs/screenshots/OpenAPI ở `/tmp/aver-remediation-*`, không commit. Các con số trong báo cáo mới là tóm tắt evidence, `/tmp` không phải kho lưu trữ lâu dài.

## Chốt còn phải duyệt trước rollout

1. **Gate E dependency baseline — đã được duyệt và sửa local:** v19 → v20, chỉ suite ID và SHA-256 hai dependency files. Giữ nguyên denominator 34, target 20, thresholds, matrix và frozen tests. Logic ledger hiện hữu sẽ tách evidence của suite mới khi được triển khai/chạy; không chuyển streak v19 sang v20. Không công bố Gate E/F pass, dispatch workflow hoặc khởi động lại lịch. Chưa có CI/PR mới.
2. **Deploy:** sau baseline được duyệt và CI xanh, triển khai staging rồi kiểm tra upload, submit/collect, readiness, curated unavailable state. Production phải được duyệt riêng; bản vá code không tự làm production an toàn hơn khi chưa deploy.
3. **F05 private audio rollout:** cần quyền riêng và kế hoạch dưới đây; không đánh dấu đã sửa chỉ từ bản vá dependency/UI.

## F05 — Trình tự đề xuất, CHƯA thực hiện

1. Inventory read-only mọi consumer `audio_url` / `audio_storage_path`: upload trả public URL; learner session audio-urls ưu tiên signed path nhưng có fallback URL cũ; result model vẫn fallback response.audio_url; admin playback dùng storage path. Phân loại các row có/không có path, không in URL/object name riêng tư.
2. Chuẩn bị authenticated signed URL nhất quán cho owner/admin, TTL và refresh sau hết hạn. Chỉ chuyển legacy URL thành path khi host/bucket hợp lệ đã được xác minh; không ký một URL tùy ý do client đưa vào. Giữ quyền xem bài canonical.
3. Dùng object/account synthetic được duyệt trên staging: owner/admin phát được, nonowner bị chặn, public URL bị từ chối, signed URL hết hạn; thử session cũ, reload và regrade/review. Quyền HEAD sample trước đây không bao gồm các bài kiểm tra này.
4. Sau khi compatibility pass, xin phép deployment + private bucket flip production; tách mọi backfill path thành dry-run và phê duyệt write riêng. Không tự tải nội dung ghi âm thật, không đổi bucket công khai chứa tài liệu học tập.

## Các việc không bị gộp thành “đã xử lý”

- 22 Speaking sessions lịch sử thiếu band, 1 timestamp và 45 log cũ: chưa repair/dismiss; cần triage riêng, không quy cho hard flip.
- Audit quyền hai tài khoản, Safari/audio, tất cả biến thể admin, toàn bộ Python SBOM, restore drill và query performance vẫn còn trong chương trình audit sâu.
- Skills ảnh hưởng bản vá: review ưu tiên auth/canonical state và schema trước UI; UI review chọn semantic token và đo cả hai theme; React review giữ pending/count derived từ coordinator thay vì thêm state đồng bộ qua effect. Không dùng chúng để mở rộng thành redesign ngoài scope.
