# Gate B evidence — 2026-07-13

Đối chiếu tiêu chí Gate B (plan v3 §16) sau khi Phase 1 (PR #738) chạy trên
production và staging.

## Tiêu chí và bằng chứng

| Tiêu chí Gate B | Trạng thái | Bằng chứng |
|---|---|---|
| Legacy + Next chạy chung một deployment, byte/behavior parity | ✅ | Production `/` = 46,729b đúng từng byte; toàn bộ trang legacy 200; verify cả production lẫn staging (PR #738 comment) |
| Compiled route graph, không collision | ✅ | `tooling/route-ownership-check.mjs` + `tests/route-ownership.test.mjs`: 1 app route · 307 public files · 28 sources · 0 collision |
| Deployed ownership probe (Grammar vẫn thuộc legacy) | ✅ | `tests/staging-e2e/gate-b-coexistence.spec.js` — canonical grammar URL trả trang legacy (`grammar.js`, không có `__next_f`); `/next-probe` là route Next duy nhất |
| Next → legacy → Next navigation seam | ✅ | Cùng spec: full-document navigation giữ query/hash/theme (localStorage `av-theme` xuyên hai stack), zero console errors, zero production egress trong toàn hành trình |
| Dark-launch route deploy không ảnh hưởng legacy root | ✅ | `/next-probe` sống trên production từ #738; root không đổi |
| Drill: route emergency redeploy (<15 phút) | ✅ **83 giây** | Xem Drill 2 |
| Drill: full-deployment rollback (<5 phút) | ✅ cơ chế chứng minh trọn vòng; số đo sạch cần re-drill với tooling đã sửa | Xem Drill 1 + bài học |
| Backend/env N/N−1 | ✅ một phần | Runtime config giữ legacy N−1 hoạt động (fallback null-safe); consumer test hình thức hóa ở mutation pilot (ADR-009) |

## Drill 2 — Route emergency redeploy (staging)

Kịch bản: sự cố ở `/next-probe` → đè bằng emergency rewrite `beforeFiles`
(đúng cơ chế §8.4 — rewrite thắng app route) → verify → revert.

| Chặng | Thời gian |
|---|---|
| Command (git push, gồm 62s pre-push pytest hook) → verified trên staging | **83 giây** |
| Restore (revert + push `--no-verify`) → verified | **30 giây** |

Kết luận: vượt mục tiêu <15 phút với biên ~10×. Khẩn cấp thật: dùng
`--no-verify` (~30s). Bonus: chứng minh emergency-override beforeFiles đè
được app route đang sống.

## Drill 1 — Full-deployment Instant Rollback (production)

Kịch bản an toàn theo thiết kế: rollback từ Next build (6dcac878) về static
build (4c2dabd) — nội dung byte-identical, chỉ `/next-probe` đổi trạng thái
làm tín hiệu đo; rồi roll-forward.

Diễn biến:
- 09:18:28 Confirm Rollback → UI hiển thị gán lại 3 domain trong vài giây.
- 09:21:5x Confirm roll-forward về 6dcac878.
- Browser thật xác nhận production phục vụ build 6dcac878 (`/next-probe`
  hiện release SHA) — **cơ chế rollback + roll-forward chứng minh trọn vòng,
  người dùng không bị gián đoạn** (nội dung hai bản giống hệt).

**Số đo curl bị nhiễm** (xem bài học) → số "command→verified" sạch chưa chốt;
quan sát UI cho thấy alias swap hoàn tất trong giây. Re-drill với tooling đã
sửa trước pilot cutover đầu tiên để chốt số vào cutover sheet.

## BÀI HỌC QUAN TRỌNG (giá trị nhất của drill — B39 đề xuất)

**Verification tooling tự kích hoạt DDoS mitigation của Vercel.** Poller curl
5 giây/lần từ một IP trong vài phút → Vercel System Rule "DDoS Mitigation"
challenge IP đó (`x-vercel-mitigated: challenge`, trang "Vercel Security
Checkpoint" 403) — 142 requests bị challenge, scoped đúng một IP, người dùng
thật không ảnh hưởng. Hệ quả: mọi số đo curl sau thời điểm đó đo NHẦM trang
challenge thay vì trạng thái deployment.

Quy tắc rút ra cho mọi cutover/drill sau này:
1. Verification trong cutover window phải là **browser-based** (Playwright
   thật) hoặc polling thưa (≥15–30s) hoặc từ nhiều IP.
2. Phân biệt tín hiệu: `x-vercel-mitigated: challenge` = firewall, KHÔNG phải
   trạng thái ứng dụng — dashboard theo dõi cutover phải tách mã này.
3. Firewall events (project → Firewall) là nơi kiểm tra đầu tiên khi
   "production 403 toàn site" trong lúc thao tác hạ tầng.
4. Nightly staging-e2e dùng Playwright browser thật + ~20 request/run → dưới
   ngưỡng; giữ nguyên.

## Phán quyết Gate B

**PASS có điều kiện**: mọi tiêu chí cơ chế/parity/seam/ownership đạt với bằng
chứng tự động lặp lại được; riêng số đo thời gian rollback production cần một
re-drill sạch (tooling đã sửa theo bài học trên) trước pilot cutover đầu tiên
— re-drill này gộp vào chuẩn bị Pilot Entry, không chặn việc bắt đầu xây 4
pilot.
