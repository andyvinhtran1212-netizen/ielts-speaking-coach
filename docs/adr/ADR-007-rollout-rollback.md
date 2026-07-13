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
6. Không deploy production trong soak window trừ hotfix có incident commander (giữ rollback target trong tầm).

## Điều kiện mở trước pilot
Hai drill trên chưa chạy — là mục Gate B. Không cutover khi chưa có số đo.
