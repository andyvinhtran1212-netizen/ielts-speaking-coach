# Implementation plan

## Architecture impact

Chỉ sổ `backend/migrations/register.tsv` (thêm hàng `block`), `backend/tests/test_migration_register.py` và ba câu trong `backend/migrations/README.md` mục "Finding the next number". Không đổi file `.sql`, `apply_migrations.sh`, `forward-policy.tsv`.

Ràng buộc riêng của gói (mục 8):

1. Mục (b), (c), (d), (e), (g): không PR mã nào trước khi spec tương ứng được duyệt trên `staging`.
2. Mục (c): PR tách chỉ cắt-dán và đổi đường dẫn; mọi thay đổi logic, đổi tên, dọn import là PR khác.
3. Mục (b): mỗi file xoá có bằng chứng ba lớp (hoặc hai lớp khi chưa có log, ghi rõ); không xoá theo thư mục.
4. Mục (e): không viết lại lịch sử, không LFS, không đổi URL, không xoá thư mục `versions/`; T19 chỉ khi anh Andy duyệt bằng chữ.
5. Không sửa `components/authed-shell.tsx` (cascade) trong gói này.
6. Không sửa file bằng chứng có ngày trong `docs/audits/`.

## Data and contracts

### 5.4 Dải số migration (mục g)

Thêm `state=block` vào `register.tsv` (cột `number` dạng `400-419`, `owner` = tiền tố gói `G06`). Dải số đã cấp ở `01-KE-HOACH-TONG.md` mục 6 (anh Andy duyệt ở Q-g1; không đề xuất dải khác): G04 381–389; G05 390–399; G06 400–419; G07 420–439; G09 440–459; G08 460–469; GOI-11 470–479; GOI-12 480–489; GOI-13 490–499; từ 500 trở đi dự phòng, cấp thêm theo yêu cầu (sửa 18/11 theo rà soát). Test kiểm FR-10g-002 và in cảnh báo khi `max(number) >= 900`. Không đổi `apply_migrations.sh`.

Vì sao **không** dùng dấu thời gian hay 4 chữ số: `apply_migrations.sh:104` chạy `for f in $(ls "$MIG_DIR"/*.sql | sort)` (sắp từ điển) và hai test dùng glob `[0-9][0-9][0-9]_*.sql`; tên dạng dấu thời gian hay 4 chữ số sẽ bị sắp sai hoặc bỏ sót. Chuyển sang 4 chữ số là spec riêng khi số chạm 900.

## Rollout and rollback

Xem `rollout.md`. Không ảnh hưởng runtime; quay lui = revert PR (sổ và test).

## Verification strategy

`cd backend && python -m pytest tests/test_migration_register.py -q`; thử âm (hàng `reserved 405 G09-T01` → thất bại); bộ backend đầy đủ (test ghim README không vỡ).
