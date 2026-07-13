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
| Drill: full-deployment rollback (<5 phút) | ✅ **≤ 12 giây** (re-drill 2026-07-13 tối, verification đã sửa) | Xem Drill 1 + mục RE-DRILL cuối file |
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

**Số đo curl bị nhiễm** (xem bài học) → số "command→verified" sạch chưa chốt
tại thời điểm drill; quan sát UI cho thấy alias swap hoàn tất trong giây.
**→ ĐÃ CHỐT bằng RE-DRILL cùng ngày (mục cuối file): ≤ 12 giây.** Lưu ý hồi
tố: leg "roll-forward" của drill này chính là thao tác để lại rollback-pin —
xem PHÁT HIỆN NGHIÊM TRỌNG ở mục re-drill.

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

**PASS — điều kiện đã đóng 2026-07-13 tối**: mọi tiêu chí cơ chế/parity/seam/
ownership đạt với bằng chứng tự động lặp lại được. Điều kiện duy nhất của
phán quyết gốc — số đo thời gian rollback production sạch — đã đóng bằng
RE-DRILL cùng ngày (mục cuối file): Instant Rollback hiệu lực **≤ 12 giây**,
restore **≤ 5 giây**, zero challenge, zero user impact.

<details><summary>Phán quyết gốc trước re-drill (giữ làm lịch sử)</summary>

PASS có điều kiện: mọi tiêu chí cơ chế/parity/seam/ownership đạt với bằng
chứng tự động lặp lại được; riêng số đo thời gian rollback production cần một
re-drill sạch (tooling đã sửa theo bài học trên) trước pilot cutover đầu tiên
— re-drill này gộp vào chuẩn bị Pilot Entry, không chặn việc bắt đầu xây 4
pilot.

</details>

---

## RE-DRILL 2026-07-13 tối — Instant Rollback với verification đã sửa (đóng điều kiện Gate B)

**Phương pháp** (đúng bài học Drill 1): poller curl cadence **15 giây** đọc
`release` SHA từ `/js/runtime-config.js` (marker per-deployment, page bytes
không đổi) + ghi `x-vercel-mitigated` mỗi poll; verification trạng thái bằng
**browser thật** (Chromium page-load đầy đủ, console sạch); thao tác dashboard
qua Chrome. Không một challenge nào bị kích hoạt trong toàn bộ re-drill
(`mitigated=none` trên mọi poll — đối chứng trực tiếp với thảm họa curl@5s
của Drill 1).

**Số đo (lệnh Confirm trên dashboard → domain phục vụ deployment mới; độ phân
giải poll 15s):**

| Leg | Thao tác | Confirm lúc | Poll đầu tiên thấy flip | Hiệu lực |
|---|---|---|---|---|
| A | Undo Rollback (gỡ pin kẹt từ Drill 1) → `ef05046` | 21:51:08 | 21:51:15 | **≤ 7s** |
| B | Instant Rollback `ef05046` → `4921bf0` (default "Previous") | 21:53:37 | 21:53:49 | **≤ 12s** |
| C | Undo Rollback (restore chuẩn) → `ef05046` | 21:56:02 | 21:56:07 | **≤ 5s** |

Zero user impact chứng minh: index hash không đổi qua flip (`5e5cb2e2d18c41c8`),
delta frontend giữa hai deployment chỉ là test/config; browser verify ở trạng
thái rolled-back lẫn restored: title/h1 đúng, `/next-probe` + `/profile-preview`
200, **zero console errors**.

### PHÁT HIỆN NGHIÊM TRỌNG (root cause "production kẹt 6 merge")

Leg "restore" của Drill 1 (5h trước) thực hiện bằng một **Instant Rollback
"forward"** thay vì Undo Rollback → project ở lại **rollback-pin mode**:
Vercel NGỪNG auto-promote — 6 merge liên tiếp (#739→#744, gồm cả 4 pilots)
build Production **Ready** nhưng domain không bao giờ được gán; production
phục vụ bản Phase-1 (`6dcac878`) suốt ~5h trong khi cả team tin rằng pilots đã
dark-launch trên production. UI xác nhận hành vi này ngay trong modal:
*"After rolling back, production deployments will not be automatically
promoted until the rollback is removed."*

**Quy tắc mới (bổ sung runbook rollback):**
1. Restore sau rollback = **Undo Rollback DUY NHẤT** — không bao giờ
   Instant-Rollback "forward".
2. Checklist hậu-drill/hậu-sự-cố bắt buộc: (a) banner rollback đã biến mất
   trên Overview; (b) merge kế tiếp vào main **auto-promote** (release SHA
   trên domain flip theo) — chính PR chứa evidence này là bài test đó.
3. Giám sát trôi dạt: so `release` của `/js/runtime-config.js` production
   với SHA của main sau mỗi merge — lệch >1 deploy = pin/failure, điều tra
   ngay. (Ứng viên đưa vào observability dashboard trước pilot cutover.)

**Điều kiện Gate B "số đo rollback sạch": ĐÓNG.** RTO thực đo cho
full-deployment rollback: **≤ 12 giây** từ lệnh Confirm (kèm ~30–60s thao tác
người: mở dashboard, chọn target, xác nhận).
