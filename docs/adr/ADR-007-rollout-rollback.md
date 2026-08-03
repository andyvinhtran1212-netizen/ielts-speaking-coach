# ADR-007 — Rollout / rollback control

**Status:** ACCEPTED 2026-07-13 · Plan v3 §8.4, §12, B26, B34

## Dữ kiện nền (đã xác minh)
Vercel plan = **Pro** (nâng từ Hobby 2026-07-13). Instant Rollback = toàn deployment. KHÔNG đầu tư routing control plane (signed cookie/Proxy) ở giai đoạn này — dark launch → atomic cutover → Instant Rollback; route-level rollback = emergency ownership change + deployment mới.

## Quyết định
1. Route states: legacy-only → next-dark-launch → next-primary → legacy-retired. KHÔNG có sticky canary cho tới khi ADR này được sửa kèm control-plane design (B26).
2. Rolling Releases (Pro) CHỈ cho public/read-only flow không cần affinity; cấm cho core exam/grading (stage advancement đổi deployment giữa session).
3. Core flows: chỉ NEW sessions vào Next + drain legacy tới maximum session TTL; bidirectional resume phải chứng minh trước (Gate E).
4. Recovery targets (phải DRILL trước pilot, Gate B): full-deployment rollback <5 phút command→verified; route emergency redeploy <15 phút. Đo đủ MTTD/decision/execution/total.
5. Kill switch mutation: ADR-010 (đã ship, 15s).
6. Không deploy production trong soak window trừ hotfix có incident commander (giữ rollback target trong tầm). **[SỬA bởi ADR-013, 2026-07-25]** — chỉ áp cho soak-chuẩn của route đạt traffic. Route **low/zero-traffic** (mặc định ở early-stage) KHÔNG freeze-cứng-dài: quy kết một-biến đến từ telemetry tag (ADR-012), rollback target = bất-kỳ-deployment-eligible (Vercel Pro) nên deploy xen không mất target; dùng early-stage profile. **[SỬA TIẾP bởi ADR-013-A1 — ACCEPTED 2026-08-03, chủ dự án ratify]** — điều kiện PASS của lớp low/zero-traffic **không còn là "48–72h quan sát"** mà là **cổng parity trước cutover + probe synthetic chủ động trải theo thời gian (gồm cả route cần đăng nhập) + ngưỡng lỗi tuyệt đối 0** (sàn G2: n≥72 · trải ≥24h · nhịp ≤20 phút); cơ sở: cửa sổ `/profile` nhận đúng 2 request trong 25,1h nên lỗi thời-gian-trôi không thể hiện ra. Xem ADR-013 mục A1. Freeze + reset-đồng-hồ chỉ còn bắt buộc cho soak-chuẩn (route đủ traffic) và core grading/exam. Xem ADR-013.

## Điều kiện mở trước pilot
Hai drill trên chưa chạy — là mục Gate B. Không cutover khi chưa có số đo.

## Cập nhật trạng thái (audit F8, 2026-07-14)
- **Drills ĐÃ CHẠY** (Gate B 2026-07-13 + re-drill sau sự cố rollback-pin): Instant Rollback ≤12s command→serving, Undo ≤5–7s; auto-promote sau merge ~20s; evidence: `docs/GATE_B_EVIDENCE_2026-07-13.md`. Điều kiện mở ở trên coi như ĐÓNG.
- **Bài học vận hành (bắt buộc):** restore sau drill/rollback = **Undo Rollback**, KHÔNG dùng Instant Rollback "tiến" — làm vậy ghim project ở rollback-pin, tắt auto-promote âm thầm (production kẹt 6 merge, ~5h, 2026-07-13). Nightly `production-release-drift` canh drift này.
- **§6 (không deploy trong soak) — VI PHẠM ghi nhận (audit F3):** sau cutover pilot 1 (release `e22b84ff`) có 3 deploy production không cờ hotfix/incident-commander (`67b7b56e`, `a05c5816`, `0afefe88`) → cửa sổ soak đó chỉ có giá trị "diagnostic observation", KHÔNG phải soak hợp lệ. Quy tắc từ nay: vi phạm §6 ⇒ **đồng hồ soak reset về 0** tại release mới nhất; soak chỉ tính trên MỘT release đóng băng (xem soak declaration của đợt remediation).
