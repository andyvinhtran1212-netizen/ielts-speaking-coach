# ADR-011 — Auth state machine (trước authenticated pilot)

**Status:** ACCEPTED 2026-07-13 — mở items phải xanh trước authenticated pilot · Plan v3 B24, Pilot Entry

## State machine (Next AuthProvider)
States: `initial-loading → signed-in | signed-out`; transitions: refresh-success (giữ signed-in), refresh-failure → signed-out FAIL-CLOSED (không render stale private data), sign-out (local + cross-tab qua storage event/BroadcastChannel), account-switch = sign-out A rồi sign-in B.

## Quyết định
1. Role truth từ `/auth/me` (server), KHÔNG từ JWT claim phía client; role revoke có hiệu lực ở lần `/auth/me` kế tiếp và mọi guard render lại theo nó.
2. Logout/account-switch PHẢI: abort mọi in-flight request; clear TOÀN BỘ user-scoped cache/storage (query cache, localStorage keys user-scoped, sessionStorage exam state); không giữ dữ liệu user trước trong memory.
3. Two-user isolation là bài test bắt buộc trước authenticated pilot: Login A → private data → logout → Login B: không cache/storage/request nào của A xuất hiện; kèm logout → back/forward/reload và bfcache restoration.
4. Legacy hiện có event `av-chrome-signed-out` — Next AuthProvider phát/nhận tương thích trong coexistence để hai stack đồng bộ sign-out.

## Điều kiện mở
Implement khi scaffold Next (Phase 1); test isolation chạy trong browser-integration + staging-e2e trước pilot 3 (authenticated read).
