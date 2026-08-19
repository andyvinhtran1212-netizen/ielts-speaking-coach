# Gate E — real-device evidence — 2026-08-19

**Kết quả:** cả hai hàng `real_device_requirements` đã COMPLETE, xác minh bằng
workflow attestation + pair verification. Đây là mảnh cuối của mục device
matrix trong Gate E; chuỗi 20 clean run bắt đầu đếm lại sau PR này (đổi frozen
manifest ⇒ reset streak, đúng thiết kế).

## Cặp artifact

| Hàng | Thiết bị | Evidence run | Scope | Artifact |
|---|---|---|---|---|
| `safari-desktop` | MacBook Pro (Mac14,9) · macOS 26.5.2 · Safari 26.5.2 | `32225845849` | 5/5 passed | `status: complete` |
| `ios-safari` | iPhone 17 Pro · iOS 26.6 · bundled Mobile Safari | `32226876978` | 6/6 passed | `status: complete` |

- Pair verification: run **`32227093444`** PASS — hai run khác nhau, cùng
  `source_sha`, dispatch lần đầu từ trusted `main`, metadata khớp GitHub API.
- Staging candidate: `3dce244f51ee2ae221d8a55a1facb23f99119070` — Vercel và
  Railway staging cùng phục vụ SHA này trong cả hai journey (workflow đối chiếu
  độc lập; `backend_release_sha` trong response POST của cả hai journey khớp
  từng ký tự).
- Operator: Trần Trọng Vinh (chủ dự án), thao tác thiết bị thật; Claude điều
  phối bookkeeping/DB-verification/dispatch. Tài khoản synthetic
  `e2e-student-smoke@staging-e2e.averlearning.com` (password rotate cùng ngày,
  secret `E2E_PASSWORD` đã cập nhật).
- Canonical: safari-desktop = session `66f33f3e…` / response `04d131cc…`
  (90s, grading completed); ios-safari = session `e4017c2d…` / response
  `4f976722…` (90s, grading completed).

## Hai bug thật tìm được trên đường đi (giá trị của gate này)

1. **Safari 26 MediaRecorder WebM hỏng — PR #1261 (lên cả production).**
   Safari 26 tự nhận hỗ trợ webm/opus nên danh sách ưu tiên webm-first không
   còn rơi xuống `audio/mp4`; WebM Safari phát ra có packet timestamp nén ~8×
   (frame Opus 20ms ghi PTS ~2.5ms) — bản thu 90s → container 2.6s chứa ~21s
   frame, Whisper đo 45s → 422 "quá ngắn". Vá: chọn container theo engine ở CẢ
   `practice.js` (2 site) lẫn `SpeakingRecorderController` (native path của
   player Next — bot review bắt được lỗ thứ hai này). Người dùng Safari desktop
   production dính bug này từ khi Safari 26 phát hành.
2. **Fixture staging chặn mọi bài Part 2 — PR #1263.** Fixture Whisper trả
   cứng `duration_seconds: 45.0` < sàn Part 2 (80s, Sprint 14.2) ⇒ mọi
   submission Part 2 trên staging 422 từ nhiều tuần, không ai thấy vì chưa ai
   thu Part 2 thật trên staging. Vá: 90.0 + test buộc vào bảng
   `MIN_DURATION_BY_PART` thật.

## Ghi chú minh bạch

- Journey safari-desktop chạy 3 lượt: lượt 1 chết vì bug #1 (bằng chứng blob
  `11aeaff4…webm` trong storage), lượt 2 chết vì bug #2 (blob `1f9d9b33…m4a`
  92.548s bị báo "45.0s"), lượt 3 sạch trên release `3dce244f` — mỗi lượt
  restart đúng luật "release đổi/request fail ⇒ journey mới".
- Trong journey safari-desktop, phiên canonical (`66f33f3e`) được tạo qua luồng
  Speaking chuẩn và lượt nộp canonical đi qua trang practice legacy (recorder
  dùng chung một `practice.js` với player Next); các scope
  permission/playback/reload-resume/route-exit đều thao tác trên stable URL
  `/practice/session`. Journey ios-safari nộp thẳng từ stable URL player Next.
- Nội dung chấm (band 6.0, transcript) là fixture — đúng thiết kế staging;
  điều được chứng minh là đường ghi-nộp-persist thật trên thiết bị thật.

## Việc này KHÔNG đóng

Theo runbook §5: chưa bật `route_ready`, chưa đổi `admit_new`, chưa retire
Legacy. Gate E còn cần chuỗi 20 clean critical-suite run (đếm lại từ đây) và
các drill floor→cutover→rollback đã ghi ở các hồ sơ core.
