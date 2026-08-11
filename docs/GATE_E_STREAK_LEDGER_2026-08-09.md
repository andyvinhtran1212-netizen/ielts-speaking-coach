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
  checkout/cache/evidence steps; `frontend/tooling/gate-e-critical-suite.json`
  và auditor/streak tooling; `backend/tests/test_health.py` khóa public liveness
  response không chứa provenance. Capture tái sử dụng endpoint admin-only sẵn
  có `backend/routers/health.py::health_runtime` mà không sửa endpoint này.
- **Minimal fix đã làm:** freeze suite bằng SHA-256 + exact project counts;
  checkout evaluator độc lập từ `main`; capture Vercel/Railway release
  provenance qua admin E2E; fail-closed trên fail/unexpected skip/flake/rerun/
  version drift/history gap; dùng cache chỉ để chuyển state và tách matrix/
  provenance/ledger thành các artifact kiểm được độc lập.
- **Verification:** pure unit tests chạy các nhánh seed/increment/reset/20-run;
  workflow contract khóa ordering, điều kiện upload và secret boundaries;
  backend test khóa `/health` public không có `release`/`git_branch`, còn
  frontend contract test khóa capture chỉ gọi `/health/runtime` bằng admin token.

## Frozen critical suite v2

Canonical manifest: `frontend/tooling/gate-e-critical-suite.json`.

| Project | Số test bắt buộc | Vai trò |
|---|---:|---|
| `staging-core-chromium` | 27 | auth, persistence, mutation, isolation, N/N−1, kill-switch, staging/platform |
| `matrix-chromium-148-desktop` | 2 | browser seam + private fail-close/overflow |
| `matrix-webkit-26.4-desktop` | 2 | cùng journey trên synthetic WebKit desktop |
| `matrix-webkit-26.4-iphone13` | 2 | cùng journey trên synthetic WebKit mobile |
| **Tổng** | **33** | mọi test thực thi phải pass; chỉ modal core đã whitelist được phép skip |

Manifest pin SHA-256 của package manifest/lockfile, Playwright config, matrix
manifest, shared helper và cả 9 spec. Thay dependency, command, test/helper/config
bắt buộc bump suite hoặc cập nhật manifest có review; không thể giữ streak bằng
cách lặng lẽ đổi runner/test nhưng giữ đủ số lượng. Frozen-directory contract
cũng cấm file/symlink mới ngoài allowlist trong `tests/staging-e2e`, nên spec mới
không thể lọt qua chỉ vì các file cũ vẫn giữ hash. Auditor kiểm các contract này
và cấm `.npmrc` trong tested tree trước `npm ci`/Playwright, không đợi tới sau
khi code đã nhận secret. Nếu hashes lệch nhưng GitHub chứng minh staging SHA là ancestor
đã qua `main`, suite vẫn chạy để giữ giá trị chẩn đoán nhưng ledger reset; source
không thuộc lịch sử `main` hoặc không xác minh được thì hard-stop. Ledger cũng
lưu SHA-256 của toàn manifest contract; mọi thay đổi manifest giữa chuỗi đều tạo
`manifest-changed` và khởi động lại streak tại 1.

## Clean-run contract

Một run chỉ được cộng streak khi đồng thời:

1. Playwright outcome `success`, đúng 33 test và exact project counts;
2. pass rate 100% trên test đã thực thi, `unexpected=0`, `flaky=0`; tối đa một
   skip khớp chính xác project + title + spec file + Playwright skip-annotation
   của modal core có điều kiện. Cùng test nhưng skip vì route/network lỗi vẫn
   reset;
3. `run_attempt=1` — re-run luôn reset, dù lần hai xanh;
4. suite/matrix versions và frozen-file hashes khớp;
5. source checkout là branch `staging`; runtime Vercel release và Railway
   `git_sha` từ endpoint admin-only `/health/runtime` đều bằng exact checkout
   SHA; Vercel git ref là `staging`. Workflow truyền SHA do bước
   `source_revision` chụp vào `GATE_E_SOURCE_SHA`; thiếu/sai SHA làm provenance
   `ok=false` và reset streak;
6. GitHub API xác nhận ledger cache đến từ đúng workflow run number ngay trước
   trên toàn workflow; run number phải chính xác bằng `current - 1`, không chỉ là
   run cũ gần nhất API còn trả về. Riêng job `staging-e2e` của run trước phải kết
   luận `success`; job `production-release-drift` độc lập không được phép làm
   sai continuity của staging;
7. frontend/backend release không đổi giữa hai run.

Fail, cancel, unexpected skip, retry, history API không kiểm được, cache gap,
đổi release, đổi version hoặc đổi frozen file đều reset. Scheduled workflow
luôn checkout `staging`, thay vì vô tình test staging deployment bằng source
`main` khác SHA. Writer, manifest và streak library lại chạy từ checkout
`main` riêng, nên branch đang được test không thể tự nới tiêu chí auditor.

## State transport và audit artifact

- `actions/cache` chỉ là transport cho ledger trước; cache không phải evidence.
  State nằm ở `${RUNNER_TEMP}/gate-e-streak-state`, ngoài tested checkout;
  preflight cấm tested branch mang sẵn `.gate-e-streak-state` để không thể seed
  giả `streak_count` khi cache miss.
  Key không partition theo dispatch ref, nhưng GitHub vẫn scope cache theo
  branch. Vì vậy continuity được đối chiếu trên global workflow history; cache
  không nhìn thấy hoặc manual dispatch ở ref khác đều làm lần kế tiếp reset,
  không được phép che một run đỏ.
- Matrix result, staging provenance và streak ledger dùng ba artifact riêng có
  run id/attempt và retention 30 ngày. Vì vậy một matrix writer lỗi không che
  ledger reset. Candidate ledger artifact chỉ được đóng gói/upload sau khi đã
  kiểm cả ledger lẫn raw `staging-e2e-results.json` cùng tồn tại, nên verdict
  luôn tái kiểm được độc lập. Nếu raw report không được tạo, workflow đỏ và chỉ
  upload artifact `gate-e-streak-reset-*` không đủ điều kiện xét streak. Artifact
  tên `gate-e-streak-ledger-*` dành cho run có entry `clean=true`, kể cả seed
  hoặc continuity reset khiến chuỗi khởi động lại tại 1; `reset_reasons` trong
  ledger là nguồn chuẩn về continuity. Run có `clean=false` dùng tên
  `gate-e-streak-reset-*` dù raw report có hay không.
- Ledger giữ tối đa 50 entries, đủ thấy chuỗi 20 và lần reset gần nhất.
- Nếu một run chết trước khi save cache/artifact, run kế tiếp không khớp GitHub
  history với `last_run_id` và reset fail-closed.
- E2E step có timeout riêng 20 phút trong job 30 phút; `npm ci` và browser install
  có timeout 5 phút. Như vậy timeout ở phần thực thi vẫn nhường ngân sách cho
  provenance, reset ledger, cache save và artifact uploads.
- Token GitHub, Vercel bypass, `E2E_PASSWORD` và Supabase admin session chỉ dùng
  lúc query/capture; không được serialize vào artifact hoặc log. Bypass chỉ gửi
  tới canonical Vercel staging origin; password grant chỉ gửi tới canonical
  staging Supabase origin. Mọi network call provenance và GitHub history/ancestry
  đều có timeout 20 giây để ledger/reset artifact còn đủ thời gian hoàn tất
  trước job timeout.

## Failure-injection status vẫn PARTIAL

Suite v2 đã phủ 401/400, double-submit, kill switch, fixture grade + persistence,
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
