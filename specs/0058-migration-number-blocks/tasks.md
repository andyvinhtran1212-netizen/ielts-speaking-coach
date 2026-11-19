# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk` (spec `risk: high`, validator đòi, dù PR không chạm `*.sql`), `Spec: MIGNUM-0058`, sau khi spec `approved`. G10-T22 là chính PR spec này.

- [ ] T023 (G10-T23) Thêm hàng `block` và kiểm dải. `depends: G01-T06, spec approved`

Chi tiết (gói mục 6, chép nguyên):

### G10-T23 — Thêm hàng `block` và kiểm dải

- **Việc làm:** thêm hàng `block` theo dải được duyệt vào `register.tsv`; mở rộng `test_migration_register.py` (FR-10g-002, FR-10g-004); thêm 3 câu vào `backend/migrations/README.md` mục "Finding the next number" (lấy số trong dải của gói; phụ thuộc chỉ xuống số nhỏ hơn; ≥ 900 thì báo).
- **Nghiệm thu:** `cd backend && python -m pytest tests/test_migration_register.py -q`; thử âm (hàng `reserved 405 G09-T01` → thất bại); bộ backend đầy đủ qua (test ghim README không vỡ).
- **Không làm:** không sửa file `.sql`, `apply_migrations.sh`, `forward-policy.tsv`. Lớp PR vẫn là `high-risk` vì spec MIGNUM có `risk: high` (validator đòi), dù PR không chạm `*.sql`.
- **Ước lượng:** 1 phiên · độ khó 3.
