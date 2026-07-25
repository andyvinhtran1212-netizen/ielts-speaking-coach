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

## Trạng thái implementation (AUDIT F6, 2026-07-14 — trung thực hóa scope)
Audit ngoài phát hiện ADR này được đánh dấu "đóng" RỘNG hơn code thật. Đối chiếu từng khoản:

| Khoản | Trạng thái | Ghi chú |
|---|---|---|
| §2 abort in-flight khi logout/switch | ✅ từ patch F6 | `api.js` nhận `opts.signal`; profile (route authed duy nhất) đăng ký AbortController vào `inflightRef`, abort ở gate signed-out + nhánh account-switch + effect cleanup. TRƯỚC patch này: KHÔNG abort — mục từng bị coi là xong. |
| §2 clear user-scoped cache/storage | ✅ (scope hiện tại) | Route Next hiện không có query cache; DOM blank qua `resetProfileDom()`. Khi thêm cache layer (pilot sau) phải nối vào đây. |
| signOut revoke kiểm tra kết quả | ✅ từ patch F6 | supabase-js v2 signOut() **resolve** `{error}` chứ không throw — trước đây bị nuốt; giờ report `auth_signout_revoke_failed`. Local state vẫn fail-closed signed-out dù revoke fail. |
| Toast mutation trung thực | ✅ từ patch F6 | "✓ Đã lưu" chỉ khi reconcile GET thành công; nhánh ambiguous chỉ nói "đã tải lại" khi GET thật sự thành công, ngược lại nói thẳng "KHÔNG xác nhận được". |
| §3 two-user isolation test | ✅ staging-e2e | pilot-3/pilot-4 specs. |

Quy tắc rút ra: KHÔNG đánh dấu một khoản ADR là đóng khi chưa chỉ được vào dòng code/test thực hiện nó.
