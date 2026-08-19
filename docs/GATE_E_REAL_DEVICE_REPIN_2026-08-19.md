# Gate E — re-pin real-device requirements — 2026-08-19

**Quyết định owner (2026-08-19):** hai hàng `real_device_requirements` trong
Gate E device matrix được re-pin từ floor hardware sang thiết bị thật mà
chương trình thực sự sở hữu. Trạng thái hai hàng vẫn `pending` — batch này
KHÔNG thu evidence, không đổi `route_ready`/`admit_new`, không đóng Gate E.

## Thay đổi

| Hàng cũ | Hàng mới |
|---|---|
| `safari-floor` — macOS 12.5 · Safari 15.6 | `safari-desktop` — macOS 26.5.2 · Safari 26.5.2 |
| `ios-safari-floor` — iOS 15.8.5 · bundled Mobile Safari | `ios-safari` — iPhone 17 Pro · iOS 26.6 · bundled Mobile Safari |

Files: `frontend/tooling/gate-e-speaking-device-matrix.json`,
`frontend/tooling/gate-e-device-matrix.json`,
`frontend/tooling/gate-e-speaking-real-device-evidence.schema.json` (enum id),
`frontend/tooling/gate-e-speaking-real-device-evidence-lib.mjs` (pair ids),
`.github/workflows/speaking-real-device-evidence.yml` (choice options),
`.github/workflows/speaking-real-device-pair.yml` (artifact names), 4 contract
test, runbook 2026-08-11 và doc device matrix 2026-08-09. Required scope của
từng hàng giữ nguyên từng chữ.

## Vì sao floor hardware bị waive

1. **Nguồn gốc floor:** hai hàng cũ pin theo sự cố production 28/07 — một
   người dùng iOS 15.8.5 không parse được chunk Next chứa class `static{}`
   (Safari < 16.4), xem master plan §12.6 DEBT-2026-07-29-K.
2. **Lo ngại đó nay được canh bằng máy, không cần thiết bị:** browserslist đã
   hạ target về `safari 15` / `ios_saf 15` và
   `frontend/tooling/legacy-browser-scan.mjs` +
   `frontend/tests/legacy-browser-floor.test.mjs` quét cú pháp bundle theo sàn
   đó trong CI. Lỗi parse-trên-Safari-cũ tái xuất sẽ đỏ CI trước khi deploy —
   một thiết bị iOS 15.8.5 thật không thêm tín hiệu parse nào mà CI chưa có.
3. **Giá trị thật của hàng real-device là hành vi media/Safari thật** —
   getUserMedia, MediaRecorder, permission prompt, backgrounding, mic
   indicator, persistence — thứ Playwright WebKit không chứng minh được. Các
   hành vi này được kiểm tốt nhất trên Safari/iOS mà người dùng thực đang chạy
   (thiết bị hiện đại), không phải trên một bản iOS 4 năm tuổi gần như không
   thể mua lại.
4. **Tính khả thi:** floor hardware (Mac giữ Monterey 12.5, iPhone kẹt iOS
   15.8.5) không tồn tại trong chương trình; giữ hàng cũ nghĩa là Gate E
   unsatisfiable vĩnh viễn — một cổng không thể đóng thì không bảo vệ gì.

## Rủi ro chấp nhận (owner sign-off)

- **Không có evidence hành-vi-media trên iOS 15–16 thật.** Nếu MediaRecorder
  hoặc permission flow khác biệt trên Safari cũ, chương trình sẽ không thấy
  trước. Giảm nhẹ: (a) sàn parse vẫn CI-guarded nên trang luôn render + SSR
  đọc được; (b) trang legacy còn nguyên cho tới Gate F — người dùng Safari cũ
  gặp lỗi ở core player Next vẫn còn đường legacy trong suốt cửa sổ
  coexistence; (c) error telemetry theo UA (ADR-012) sẽ hiện chữ ký lỗi từ UA
  cũ nếu có thật.
- **Version pin sẽ mốc theo thời gian OTA.** Nếu thiết bị lên iOS/macOS mới
  trước khi thu evidence, phải sửa manifest bằng một PR mới rồi mới dispatch
  workflow (validator so exact string, fail-closed) — không nới validator.

## Không đổi

- Toàn bộ chain chống-giả-evidence giữ nguyên: dispatch từ `main`, provenance
  frontend/backend cùng SHA staging, canonical session/response đọc lại từ
  API, 12h attestation / 3h session, console/network rỗng, pair = 2 run khác
  nhau cùng `source_sha`.
- Flip `status: pending → complete` vẫn chỉ được làm trong PR evidence-only
  sau khi pair verifier xanh, và vẫn reset streak 20 run theo runbook §4.
