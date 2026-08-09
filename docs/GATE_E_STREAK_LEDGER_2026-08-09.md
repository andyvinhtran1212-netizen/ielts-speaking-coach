# Gate E critical-suite streak ledger — 2026-08-09

**Trạng thái:** MECHANISM READY; QUALIFYING STREAK NOT STARTED. Không có artifact
20-run nào trong PR này và Gate E vẫn NOT READY.

## Root cause

Nightly staging trước đây có `workers: 1` và `retries: 0`, nhưng không freeze
chính xác suite/matrix, không bind browser run vào cùng frontend + backend SHA,
không kiểm continuity với GitHub run history, và không có ledger artifact. Vì
vậy lịch sử nhiều workflow xanh không đủ chứng minh “20 consecutive clean”.

- **Severity:** Critical — thiếu exit evidence bắt buộc của Gate E.
- **Impacted files/functions:** `.github/workflows/staging-e2e.yml` source
  checkout/cache/evidence steps; `backend/routers/health.py::health_basic`;
  `frontend/tooling/gate-e-critical-suite.json` và streak tooling.
- **Minimal fix đã làm:** freeze suite bằng SHA-256 + exact project counts;
  capture Vercel/Railway release provenance; fail-closed trên fail/skip/flake/
  rerun/version drift/history gap; dùng cache chỉ để chuyển state và upload
  ledger artifact ở mọi run.
- **Verification:** pure unit tests chạy các nhánh seed/increment/reset/20-run;
  workflow contract khóa ordering, always-upload và secret boundaries; backend
  test khóa release/null behavior của `/health`.

## Frozen critical suite v1

Canonical manifest: `frontend/tooling/gate-e-critical-suite.json`.

| Project | Số test bắt buộc | Vai trò |
|---|---:|---|
| `staging-core-chromium` | 27 | auth, persistence, mutation, isolation, N/N−1, kill-switch, staging/platform |
| `matrix-chromium-148-desktop` | 2 | browser seam + private fail-close/overflow |
| `matrix-webkit-26.4-desktop` | 2 | cùng journey trên synthetic WebKit desktop |
| `matrix-webkit-26.4-iphone13` | 2 | cùng journey trên synthetic WebKit mobile |
| **Tổng** | **33** | phải pass đủ, không skip |

Manifest pin SHA-256 của config, matrix manifest, shared helper và cả 9 spec.
Thay một test/helper/config bắt buộc bump suite hoặc cập nhật manifest có review;
không thể giữ streak bằng cách lặng lẽ đổi test nhưng giữ đủ số lượng.

## Clean-run contract

Một run chỉ được cộng streak khi đồng thời:

1. Playwright outcome `success`, đúng 33 test và exact project counts;
2. pass rate 100%, `unexpected=0`, `flaky=0`, `skipped=0`;
3. `run_attempt=1` — re-run luôn reset, dù lần hai xanh;
4. suite/matrix versions và frozen-file hashes khớp;
5. source checkout là branch `staging`; runtime Vercel release và Railway
   `RAILWAY_GIT_COMMIT_SHA` đều bằng exact checkout SHA; cả hai git ref là
   `staging`;
6. GitHub API xác nhận ledger cache đến từ đúng workflow run number ngay trước
   trên toàn workflow, và run trước kết luận `success`;
7. frontend/backend release không đổi giữa hai run.

Fail, cancel, skip, retry, history API không kiểm được, cache gap, đổi release,
đổi version hoặc đổi frozen file đều reset. Scheduled workflow luôn checkout
`staging`, thay vì vô tình test staging deployment bằng source `main` khác SHA.

## State transport và audit artifact

- `actions/cache` chỉ là transport cho ledger trước; cache không phải evidence.
  Key không partition theo dispatch ref, nhưng GitHub vẫn scope cache theo
  branch. Vì vậy continuity được đối chiếu trên global workflow history; cache
  không nhìn thấy hoặc manual dispatch ở ref khác đều làm lần kế tiếp reset,
  không được phép che một run đỏ.
- Mỗi run upload `gate-e-streak-ledger.json` cùng matrix metadata, Playwright
  JSON và staging provenance trong artifact 30 ngày.
- Ledger giữ tối đa 50 entries, đủ thấy chuỗi 20 và lần reset gần nhất.
- Nếu một run chết trước khi save cache/artifact, run kế tiếp không khớp GitHub
  history với `last_run_id` và reset fail-closed.
- Token GitHub và Vercel bypass chỉ dùng lúc query/capture; không được serialize
  vào artifact hoặc log.

## Failure-injection status vẫn PARTIAL

Suite v1 đã phủ 401/400, double-submit, kill switch, fixture grade + persistence,
N/N−1 replay, two-user isolation và zero production egress. Chưa phủ bốn nhóm
core-player: ambiguous commit, partial persistence, reload/resume và
bidirectional cross-version.

Vì vậy ledger tách ba cờ:

- `threshold_met`: streak đã đủ 20;
- `failure_matrix_complete` và `real_devices_complete`;
- `gate_e_evidence_eligible`: chỉ true khi cả ba cùng true.

Ngay cả khi candidate streak chạm 20 trước các batch core/real-device, tooling
vẫn không được phép tuyên bố Gate E đủ evidence.

## Bước vận hành sau merge

1. Đồng bộ stack xuống branch/deployment `staging` để Vercel + Railway cùng SHA.
2. Manual dispatch workflow từ default branch; kiểm artifact đầu tiên có
   provenance `ok=true`, 33/33 và `streak_count=1`.
3. Để nightly/manual runs tiếp tục; bất kỳ reset nào phải được điều tra từ
   `reset_reasons`, không chỉnh ledger bằng tay.
4. Mở PR riêng cho failure-injection/core-player coverage và real-device
   evidence; chỉ sau đó mới đánh giá Gate E.
