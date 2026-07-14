# ADR index — FE Next.js migration program

Quyết định kiến trúc của chương trình migration (plan: `docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` v3, mục 5). ADR-000 (destination) ghi trong plan §1.2 — RATIFIED 2026-07-13.

| ADR | Chủ đề | Status | Điều kiện mở chính |
|---|---|---|---|
| 001 | FastAPI là business backend duy nhất | Accepted | lint boundary khi scaffold |
| 002 | URL ownership / compatibility | Accepted | ownership graph Phase 1 |
| 003 | Auth model (implicit hash parity) | Accepted | login slice Phase 3-4 |
| 004 | Rendering (RSC default) | Accepted | bundle budget khi scaffold |
| 005 | Test retirement theo invariant | Accepted | ~~34 mục UNCLEAR~~ → ledger đã giải quyết toàn bộ UNCLEAR (PR #758, audit F8) |
| 006 | Runtime environment provenance | **Shipped** (PR #730) | server-side egress layers |
| 007 | Rollout/rollback (Pro, no control plane) | Accepted | ~~2 rollback drills~~ → drills ĐÃ chạy (Gate B + re-drill); xem mục "Cập nhật trạng thái" trong ADR về vi phạm soak §6 (audit F3) |
| 008 | Public content caching (SSR + cache) | Accepted | ~~capture Railway region~~ → đo xong: sin1, `vercel.json regions` (PR #757) |
| 009 | Backend N/N−1 compatibility | Accepted | consumer test profile ĐÃ có (static + staging live, PR #756 nhánh) |
| 010 | Mutation kill switch | **Shipped** (PR #732, mig 155 prod+staging) | wired tại PATCH /auth/profile; drill đo 2026-07-13 |
| 011 | Auth state machine | Accepted | two-user isolation: staging-e2e specs; abort-in-flight + signOut{error} vá theo audit F6 — xem bảng trạng thái trong ADR |
| 012 | Observability contract | Accepted | dashboard: migration-stats + rollback-metrics (audit F1) + RUM web-vitals (audit F2) |

_Cập nhật cột "Điều kiện mở" 2026-07-14 (audit F8) — index này từng lỗi thời so với ADR bodies; khi đóng một điều kiện mở phải sửa CẢ index này._
