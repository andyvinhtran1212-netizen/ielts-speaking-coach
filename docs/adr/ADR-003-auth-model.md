# ADR-003 — Auth model trong migration

**Status:** ACCEPTED 2026-07-13 · Plan v3 §4.2, B4 · Chi tiết state machine: ADR-011

## Quyết định
1. GIỮ Supabase browser session (supabase-js, bearer token tới FastAPI) suốt migration chính. KHÔNG chuyển cookie SSR — đó là project riêng hậu migration nếu cần.
2. OAuth contract: **implicit hash flow** là parity mặc định (đã xác minh: client không cấu hình `flowType`, supabase-js@2.107.0 default). PKCE `?code=` là work package riêng, chỉ làm nếu được duyệt, và phải exchange code đúng contract — nhánh `?code=` hiện hữu trong login.html KHÔNG được coi là bằng chứng PKCE hoạt động.
3. Next: Client `AuthProvider` (client-only module); bearer không đi qua RSC; root layout không đọc cookie/header cho auth (giữ public tree static).
4. Ba tầng auth automation (đã triển khai một phần): PR tests bootstrap synthetic session; staging integration dùng synthetic account (factory `staging_seed.py`, Email provider staging — ĐANG CHẠY trong staging-e2e); Google OAuth chỉ scheduled/manual smoke, không giữ provider credential trong CI.

## Ràng buộc
Login/onboarding không gộp vào marketing phase; `/login.html` legacy giữ nguyên cho tới khi auth-callback slice riêng có characterization tests (plan Phase 3-4).
