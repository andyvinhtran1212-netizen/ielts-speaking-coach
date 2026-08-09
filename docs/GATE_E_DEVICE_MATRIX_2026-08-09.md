# Gate E device matrix v1 — 2026-08-09

**Trạng thái:** AUTOMATED FOUNDATION READY; REAL SAFARI/iOS PENDING. Artifact
này không tuyên bố Gate E PASS.

## Root cause và phạm vi sửa

- **Root cause:** staging E2E trước batch chỉ cài/chạy Chromium, nên không có
  runtime evidence trên WebKit/mobile viewport; đồng thời không có artifact
  machine-readable gắn matrix version với SHA/run outcome.
- **Severity:** Critical — Gate E bắt buộc versioned Safari/iOS/Chromium matrix.
- **Impacted files/functions:** `frontend/playwright.staging.config.js` projects
  và reporter; `.github/workflows/staging-e2e.yml` install/run/artifact steps;
  `frontend/tests/staging-e2e/device-matrix.spec.js`.
- **Minimal fix đã làm:** giữ mutation-heavy core suite chạy đúng một lần trên
  Chromium; chạy browser seam riêng trên Chromium desktop, WebKit desktop và
  WebKit/iPhone 13 emulation; xuất JSON result + exact matrix metadata sau mọi
  outcome.
- **Verification:** contract test khóa project isolation, versions, retry=0,
  artifact always-upload và real-device pending state; manual/nightly staging
  workflow phải xanh cả ba matrix projects.

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

Mỗi workflow run upload artifact
`gate-e-device-matrix-<run_id>-<run_attempt>` trong 30 ngày, gồm:

- `gate-e-device-matrix-evidence.json`: matrix id, SHA/ref, workflow/run/attempt,
  outcome, runner OS, Node/Playwright version, Chromium/WebKit revision và các
  real-device requirement;
- `gate-e-staging-provenance.json`: Vercel frontend release + git ref và Railway
  backend release + git branch, đã sanitize;
- `gate-e-streak-ledger.json`: candidate clean streak, reset reasons và ba cờ
  threshold/failure-matrix/real-device eligibility;
- `staging-e2e-results.json`: kết quả Playwright theo project/test.

Metadata step và upload dùng `if: always()`, vì run đỏ/cancelled cũng là evidence
và phải bẻ streak ở batch sau. Artifact không chứa bypass token, password, JWT,
storage state hay response body có dữ liệu tài khoản.

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
