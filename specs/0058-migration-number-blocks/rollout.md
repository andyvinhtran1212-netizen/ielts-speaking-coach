# Rollout and rollback

## Preconditions

- G01-T06 đã merge (`backend/migrations/register.tsv`, `test_migration_register.py`). Spec này `approved` trên `staging`.
- Dải số đúng bảng ở `01-KE-HOACH-TONG.md` mục 6 (Q-g1 đã trả lời, 00 mục 2 điểm 22).

## Staging

- PR G10-T23 chỉ đổi sổ, test và README; CI backend chạy bộ đầy đủ. Không có migration áp lên staging.

## Production

- Không có thay đổi runtime hay schema; promotion `staging → main` như mọi PR tài liệu/test.

## Rollback and repair

- Revert PR. Nếu một PR đang mở bị test dải chặn vì số đã cấp sai: anh Andy cấp số mới trong dải đúng; không đổi số của file đã merge.

## Observability

- Thông báo lỗi của test nêu số, gói sở hữu dải và gói của owner; cảnh báo in ra khi số cao nhất ≥ 900.
