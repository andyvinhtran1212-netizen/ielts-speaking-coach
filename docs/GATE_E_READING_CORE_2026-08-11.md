# Gate E Reading core-player failure matrix — 2026-08-11

**Trạng thái slice:** COMPLETE sau khi workflow production-build chạy xanh và
trusted semantic verifier chấp nhận artifact. Đây không phải tuyên bố Gate E
global đã đạt: Listening, Writing, real-device Safari/iOS và chuỗi 20 lượt sạch
vẫn còn thiếu.

## Audit trước remediation

### RGE-1 — Reading native player chưa thuộc frozen failure matrix

- **Root cause:** native Reading regressions chỉ chạy Chromium trong development
  suite riêng; critical workflow chỉ buộc Speaking failure matrix. Không có
  artifact versioned chứng minh bốn failure path của Reading.
- **Severity:** Critical — Gate E không thể chứng minh autosave/submit và
  rollback giữ canonical attempt truth dưới lỗi mạng.
- **Impacted files/functions:** `frontend/lib/reading-exam-controller.mjs`
  `createReadingSaveCoordinator`; `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx`
  `boot`, `saveAnswer`, `submit`; `frontend/js/reading-exam.js` `patchAnswer`,
  `_flushPendingSaves`, `submitAttempt`; `.github/workflows/staging-e2e.yml`.
- **Suggested minimal fix:** thêm một suite production-build độc lập, đúng bốn
  path × ba browser profiles; dùng cùng API state fixture cho Legacy và Next;
  verify semantic JSON + complete HTML ZIP trước khi ledger tiến.
- **Verification:** `npm run test:e2e:gate-e:reading` phải chạy đúng 12/12,
  retries 0, zero skip/fail/flake; verifier phải bắt exact test title/project và
  artifact bị thiếu/truncated.

## Contract đã đóng

| Failure path | Canonical assertion |
|---|---|
| Ambiguous commit | PATCH đầu đã commit nhưng connection reset; retry cùng câu không tạo truth thứ hai; reload và Legacy resume thấy đúng answer. |
| Partial persistence | Một answer PATCH 422 tạo cảnh báo terminal; submit vẫn gửi toàn bộ in-memory answers; result và server fixture không bị undergrade; Legacy reload không dựng lại submitted attempt. |
| Reload/resume | Answer đã lưu phục hồi từ boot; timer tiếp tục từ `started_at` của server, không reset 60 phút. |
| Bidirectional cross-version | Legacy → Next → Legacy giữ cùng attempt id, cùng answer map và chỉ một lần start. |

Mọi journey cũng bắt zero page error và zero request tới production Railway hoặc
production Supabase. CDN/auth chỉ được stub ở transport seam; App Router, legacy
scripts, shared `api.js`, coordinator và UI state machine vẫn là code production.

## Bằng chứng và giới hạn

- Manifest: `frontend/tooling/gate-e-reading-device-matrix.json`.
- Config: `frontend/playwright.gate-e-reading.config.js`.
- Harness/spec: `frontend/tests/gate-e-reading/`.
- Semantic verifier: `frontend/tooling/verify-gate-e-reading-failure-evidence.mjs`.
- WebKit desktop/iPhone là emulation, không phải Safari/iOS thiết bị thật.
- Listening/Writing synthetic slices và Speaking live-staging ambiguous-commit
  journey đã đóng sau batch này; `failure_injection.status=complete` chỉ khi
  trusted verifier của mọi slice cùng xanh. Safari/iOS thật, streak và drill
  vẫn là các gate độc lập.
