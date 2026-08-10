# Gate E device matrix v1 — 2026-08-09

**Trạng thái:** AUTOMATED FOUNDATION IMPLEMENTED; EXECUTION + REAL SAFARI/iOS
PENDING. Tài liệu này không tuyên bố staging matrix đã chạy hoặc Gate E PASS.

## Root cause và phạm vi sửa

- **Root cause:** staging E2E trước batch chỉ cài/chạy Chromium, nên không có
  runtime evidence trên WebKit/mobile viewport; đồng thời không có artifact
  machine-readable gắn matrix version với SHA/run outcome.
- **Severity:** Critical — Gate E bắt buộc versioned Safari/iOS/Chromium matrix.
- **Impacted files/functions:** `frontend/playwright.staging.config.js` projects
  và reporter; `.github/workflows/staging-e2e.yml` install/run/artifact steps;
  `frontend/tests/staging-e2e/device-matrix.spec.js`.
- **Minimal fix đã làm:** cấu hình mutation-heavy core suite chạy đúng một lần
  trên Chromium; cấu hình browser seam riêng trên Chromium desktop, WebKit
  desktop và WebKit/iPhone 13 emulation; thêm writer/upload cho JSON result +
  exact matrix metadata sau mọi outcome có thể thu artifact.
- **Verification:** contract test đọc resolved Playwright projects để khóa
  project isolation, toàn bộ project set, versions, retry=0, timeout 30 phút,
  fail-closed browser/result metadata, điều kiện upload và real-device pending
  state. Manual/nightly staging workflow vẫn phải chạy xanh core project và cả
  ba matrix projects trước khi ghi nhận execution evidence.

## Matrix versioned

Canonical manifest: `frontend/tooling/gate-e-device-matrix.json`.

| Project | Runtime target | Scope | Evidence class |
|---|---|---|---|
| `staging-core-chromium` | Playwright 1.60.0 · Chromium 148.0.7778.96 rev 1223 · desktop | Toàn staging suite trừ matrix spec | Automated Chromium |
| `matrix-chromium-148-desktop` | cùng Chromium pin | Next↔legacy seam, storage, fail-closed auth, responsive login, zero production egress | Automated Chromium |
| `matrix-webkit-26.4-desktop` | Playwright WebKit 26.4 rev 2287 · Desktop Safari emulation | cùng matrix spec | Synthetic WebKit, **không phải Safari thật** |
| `matrix-webkit-26.4-iphone13` | Playwright WebKit 26.4 rev 2287 · iPhone 13 emulation | cùng matrix spec | Synthetic WebKit/mobile, **không phải iOS thật** |

`workers: 1` và `retries: 0` giữ nguyên vì staging dùng shared identities và
kill switch global. Toàn bộ core suite không được nhân ba: việc đó vừa kéo dài
quá timeout vừa lặp mutation không tạo thêm browser evidence.

## Artifact contract

Mỗi workflow run hoàn tất tới bước evidence sẽ upload artifact
`gate-e-device-matrix-<run_id>-<run_attempt>` trong 30 ngày, gồm:

- `gate-e-device-matrix-evidence.json`: matrix id, SHA/ref, workflow/run/attempt,
  outcome, runner OS, Node/Playwright version, Chromium/WebKit revision và các
  real-device requirement; kèm số test discovered/executed/passed/failed/skipped
  theo từng project và cờ `matrix_complete`;
- `staging-e2e-results.json`: kết quả Playwright theo project/test.

Metadata step dùng `if: always()` để giữ evidence của run đỏ khi runner còn hoạt
động. Writer chỉ thành công khi JSON report tồn tại, project set khớp manifest và
mỗi project đã thực thi ít nhất một test. Skip có chủ đích của core suite được
ghi vào counts; riêng ba bounded matrix projects phải chạy đủ, không skip.
Upload chỉ chạy sau writer thành công, nên artifact không thể chỉ có một trong
hai file. Run cancelled, report không hoàn tất hoặc thiếu artifact vẫn phải bẻ
streak ở batch sau dựa trên GitHub run conclusion; không được suy diễn là
artifact chắc chắn tồn tại sau mọi kiểu hủy.
Artifact không chứa bypass token, `E2E_PASSWORD`, user session token hay storage
state. Failure message có thể chứa nội dung public của runtime config (gồm public
Supabase anon key); không được coi artifact là nơi lưu secret hoặc dữ liệu tài
khoản.

## Real-device requirements còn mở

WebKit không phải Safari shipping và device emulation không phải iPhone thật.
Hai hàng sau vẫn **PENDING** và bắt buộc trước Gate E PASS:

| ID | Thiết bị/version tối thiểu | Evidence phải ghi |
|---|---|---|
| `safari-floor` | macOS 12.5 · Safari 15.6 | device/browser version, SHA, matrix id, route journey, console/network, reload/resume result, operator + timestamp |
| `ios-safari-floor` | iOS 15.8.5 · bundled Mobile Safari | device model, OS/browser version, SHA, matrix id, touch/audio/storage/reload result, operator + timestamp |

Không được đổi `status: pending` trong manifest chỉ vì CI WebKit xanh. PR sau sẽ
định nghĩa evidence schema/runbook và thu bằng chứng thật; core player coverage
sẽ mở rộng theo từng migration cluster.
