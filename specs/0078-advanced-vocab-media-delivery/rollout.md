# Rollout and rollback

## Preconditions

- Spec này `approved` trên `staging` (anh Andy, ghi ở `approval-decision.md`).
- Q-e1 đã có câu trả lời bằng chữ: phương án, và nới 00 §4.11 cho riêng `frontend/public/assets/advanced-vocab/**`.
- Q-e2 đã có câu trả lời, và T001 cho kết quả 0 dòng giữ URL media nguyên văn. Nếu khác 0, bổ sung FR-003 trước khi gỡ file.
- Không có PR mở nào đổi `backend/content/advanced_vocab/**` hoặc cây media.

## Staging

- T002 và T003 merge vào `staging` với cờ tắt. CI và Staging E2E phải xanh trên SHA đó, và hành vi không đổi (FR-006).
- Anh Andy gõ duyệt đặt cờ trên Vercel Preview/Staging. Sau đó chạy Scenario 1, 2, 4, 6 bằng tài khoản thử, và ghi SHA cùng kết quả vào `verification.md`.
- Theo dõi log Vercel staging 48 giờ: 404, 416, 5xx trên `/assets/advanced-vocab/*`.

## Production

- Chỉ qua PR promotion `staging → main` mà anh Andy duyệt (`docs/STAGING_FIRST_RELEASE_FLOW.md`). Bật cờ production là thay đổi env, cần anh gõ duyệt riêng.
- Không có migration. Không chạy script tải lên production (A/B) khi anh chưa gõ duyệt.
- T005 (gỡ file) chỉ làm sau ít nhất 14 ngày cờ bật trên production không lỗi, có anh Andy xác nhận.

## Rollback and repair

- Trước T005: tắt cờ rồi redeploy. File vẫn trong `public/`, nên phục vụ như cũ. Nếu CDN giữ phản hồi lỗi, purge `/assets/advanced-vocab/*`.
- Sau T005: `git revert` PR T005 để trả cây legacy về, rồi deploy. Bảng rewrite có thể giữ, vì `beforeFiles` trỏ tới file `versions/` vẫn còn.
- Không dữ liệu DB nào phải sửa, vì DB chỉ giữ `lesson_id` và `content_checksum`.

## Observability

- Log Vercel: tỉ lệ 404, 416 và 5xx trên `/assets/advanced-vocab/*`, trước và sau khi bật cờ.
- Báo lỗi frontend (Sentry): lỗi phát audio trên route `/advanced-vocabulary` và trình chơi quiz.
- `du -sh frontend/public/assets/advanced-vocab` trên một worktree mới, trước và sau T005, cho Success criteria.
