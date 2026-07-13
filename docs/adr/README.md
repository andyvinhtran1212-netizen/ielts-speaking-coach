# ADR index — FE Next.js migration program

Quyết định kiến trúc của chương trình migration (plan: `docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` v3, mục 5). ADR-000 (destination) ghi trong plan §1.2 — RATIFIED 2026-07-13.

| ADR | Chủ đề | Status | Điều kiện mở chính |
|---|---|---|---|
| 001 | FastAPI là business backend duy nhất | Accepted | lint boundary khi scaffold |
| 002 | URL ownership / compatibility | Accepted | ownership graph Phase 1 |
| 003 | Auth model (implicit hash parity) | Accepted | login slice Phase 3-4 |
| 004 | Rendering (RSC default) | Accepted | bundle budget khi scaffold |
| 005 | Test retirement theo invariant | Accepted | 34 mục UNCLEAR trong ledger |
| 006 | Runtime environment provenance | **Shipped** (PR #730) | server-side egress layers |
| 007 | Rollout/rollback (Pro, no control plane) | Accepted | 2 rollback drills (Gate B) |
| 008 | Public content caching (SSR + cache) | Accepted | capture Railway region |
| 009 | Backend N/N−1 compatibility | Accepted | consumer test trước mutation pilot |
| 010 | Mutation kill switch | **Shipped** (PR #732, mig 155 prod+staging) | wire endpoint đầu tại pilot |
| 011 | Auth state machine | Accepted | two-user isolation trước pilot 3 |
| 012 | Observability contract | Accepted | dashboard trước pilot đầu |
