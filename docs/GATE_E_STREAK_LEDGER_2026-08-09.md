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

## Frozen critical suite v5

Canonical manifest: `frontend/tooling/gate-e-critical-suite.json`.

| Project | Số test bắt buộc | Vai trò |
|---|---:|---|
| `staging-core-chromium` | 28 | auth, persistence, mutation, isolation, N/N−1, kill-switch, staging/platform, live failure injection |
| `matrix-chromium-148-desktop` | 2 | browser seam + private fail-close/overflow |
| `matrix-webkit-26.4-desktop` | 2 | cùng journey trên synthetic WebKit desktop |
| `matrix-webkit-26.4-iphone13` | 2 | cùng journey trên synthetic WebKit mobile |
| **Tổng** | **34** | mọi test thực thi phải pass; chỉ modal core đã whitelist được phép skip |

Manifest pin SHA-256 của package manifest/lockfile, Playwright config, matrix
manifest, shared helper và cả 9 spec. Thay dependency, command, test/helper/config
bắt buộc bump suite hoặc cập nhật manifest có review; không thể giữ streak bằng
cách lặng lẽ đổi runner/test nhưng giữ đủ số lượng. Frozen-directory contract
cũng cấm file/symlink mới ngoài allowlist trong `tests/staging-e2e`, nên spec mới
không thể lọt qua chỉ vì các file cũ vẫn giữ hash. Auditor kiểm các contract này
và cấm `.npmrc` trong tested tree trước `npm ci`/Playwright, không đợi tới sau
khi code đã nhận secret. Nếu hashes lệch, suite chỉ được chạy chẩn đoán và reset
ledger khi GitHub chứng minh staging SHA là ancestor đã qua `main`, hoặc cây Git
của staging sync commit trùng tuyệt đối với cây của merge-base thuộc lịch sử
`main`. Điều kiện thứ hai xử lý branch được đồng bộ bằng merge commit mà không
tin riêng lịch sử commit; chỉ một thay đổi nội dung ngoài `main` cũng làm tree
khác và hard-stop. Source không thuộc nội dung `main` đã review hoặc không xác
minh được cũng hard-stop. Ledger cũng
lưu SHA-256 của toàn manifest contract; mọi thay đổi manifest giữa chuỗi đều tạo
`manifest-changed` và khởi động lại streak tại 1.

## Clean-run contract

Một run chỉ được cộng streak khi đồng thời:

1. Playwright outcome `success`, đúng 34 test và exact project counts;
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
- Job có timeout 180 phút và mọi step có timeout riêng: live staging E2E có
  timeout 20 phút, bốn failure matrix có timeout 10 phút mỗi bước, còn setup,
  verifier, provenance, ledger, cache và từng artifact upload đều có trần 1–5
  phút. Contract test cộng cả ba nhánh streak/reset upload vốn loại trừ nhau để
  lấy trường hợp bảo thủ 149 phút; job vẫn dành thêm 31 phút ngoài toàn bộ tổng
  đó. Vì vậy một runner chạm timeout riêng vẫn không tước thời gian của ledger
  và artifact finalization.
- Token GitHub, Vercel bypass, `E2E_PASSWORD` và Supabase admin session chỉ dùng
  lúc query/capture; không được serialize vào artifact hoặc log. Bypass chỉ gửi
  tới canonical Vercel staging origin; password grant chỉ gửi tới canonical
  staging Supabase origin. Mọi network call provenance và GitHub history/ancestry
  đều có timeout 20 giây để ledger/reset artifact còn đủ thời gian hoàn tất
  trước job timeout.

## Failure-injection: synthetic + live staging đã đủ, real device vẫn độc lập

Suite v5 phủ 401/400, double-submit, kill switch, fixture grade + persistence,
N/N−1 replay, two-user isolation và zero production egress. Bốn nhánh
core-player từng còn thiếu — ambiguous commit, partial persistence,
reload/resume và bidirectional cross-version — chạy bằng production Next build
trong `npm run test:e2e:gate-e`: 16 Chromium + 15 WebKit desktop + 15
WebKit/iPhone synthetic. Workflow critical chạy suite này sau live staging E2E.
Trước khi tạo metadata hay cập nhật ledger, trusted auditor parse JSON để bắt
đúng 46 test/3 project, zero skip/fail/flake và kiểm ZIP report nhúng trong HTML
đã flush hoàn chỉnh. Một trong hai suite đỏ hoặc semantic verifier đỏ đều làm
`GATE_E_RUN_OUTCOME=failure` và reset streak; clean streak không được save/upload
trước bước này. JSON + HTML report được upload thành artifact riêng, còn toàn bộ
config/harness/spec/verifier được frozen bằng hash và directory allowlist.

Reading nay có slice độc lập `npm run test:e2e:gate-e:reading`: đúng bốn failure
path trên Chromium desktop, WebKit desktop và WebKit/iPhone synthetic, tổng 12
case. Ambiguous commit chứng minh retry idempotent sau connection reset; partial
persistence chứng minh full in-memory submit không bị chấm thiếu khi một PATCH
422; reload/resume giữ server clock; Legacy → Next → Legacy cùng đọc một attempt
và answer ledger. Trusted verifier bắt exact title/project counts, zero
skip/fail/flake và HTML ZIP hoàn chỉnh. Reading suite hoặc verifier đỏ cũng làm
`GATE_E_RUN_OUTCOME=failure` trước khi ledger được cập nhật.

Listening nay có slice thứ ba `npm run test:e2e:gate-e:listening`, cũng gồm 12
case trên ba project. Partial persistence cố ý khác Reading: Listening submit
chỉ gửi `{}`, nên test bắt buộc client chặn submit khi PATCH 422 và chỉ cho nộp
sau khi `Thử lại` đã đưa đủ answer lên canonical state. Reload/resume còn kiểm
full-test audio bám `started_at`; Legacy → Next → Legacy dùng chung attempt.
Verifier semantic và artifact upload chạy trước ledger như hai slice trước.

Writing nay có slice thứ tư `npm run test:e2e:gate-e:writing`, 12 case trên ba
project. Ambiguous commit commit canonical essay/job rồi reset connection và
được GET readback đối chiếu mà không replay POST; partial persistence chứng minh
exact in-memory text được submit dù PATCH latest 422; reload/resume và
Legacy → Next → Legacy cùng đọc một draft/start state. Verifier semantic và
artifact upload cũng chạy trước ledger.

Live staging bổ sung một journey Speaking trên chính `/practice/session` đã
deploy: tạo session + question thật, gửi multipart qua native
`SpeakingSubmissionController`, cho Railway commit response rồi reset kết nối
trước khi browser nhận 200. Client phải GET canonical session, trả đúng cùng
`response_id` và giữ `upload_attempts=1`; production egress và page error đều
bằng 0. Test ghi artifact
`gate-e-live-staging-failure-injection.json`, còn trusted auditor khóa source
SHA/origin/route/UUID/commit status/reconcile count/response identity/freshness
và cấm token, password, audio, transcript trong artifact. Verifier chạy trước
metadata/ledger; thiếu hoặc sai evidence làm `GATE_E_RUN_OUTCOME=failure`.

Vì vậy `failure_injection.status=complete` và `missing=[]` chỉ nói matrix
failure-injection đã đủ khi run hiện tại xanh. Nó **không** thay Safari/iOS thật,
20-run streak hay active-session drill; Gate E vẫn NOT READY cho tới khi các cờ
độc lập còn lại hoàn tất.

Vì vậy ledger tách ba cờ:

- `threshold_met`: streak đã đủ 20;
- `failure_matrix_complete` và `real_devices_complete`;
- `gate_e_evidence_eligible`: chỉ true khi cả ba cùng true.

Ngay cả khi candidate streak chạm 20 trước các batch core/real-device, tooling
vẫn không được phép tuyên bố Gate E đủ evidence.

## Bước vận hành sau merge

1. Đồng bộ stack xuống branch/deployment `staging` để Vercel + Railway cùng SHA.
2. Manual dispatch workflow từ default branch; kiểm artifact đầu tiên có
   provenance `ok=true`, 34/34, live failure artifact hợp lệ và `streak_count=1`.
3. Để nightly/manual runs tiếp tục; bất kỳ reset nào phải được điều tra từ
   `reset_reasons`, không chỉnh ledger bằng tay.
4. Thu hai real-device artifact và chạy active-session drill; chỉ sau đó mới
   đánh giá Gate E.
