# Implementation plan

## Architecture impact

- Database: migration mới `480_writing_score_pairs.sql` (dải 480–489 của GOI-12;
  dòng `reserved` trong `backend/migrations/register.tsv` thêm cùng PR với file).
- Backend service mới: `backend/services/writing_score_pairs.py`
  (`record_delivery`, `reconstruct_for_essay`, hằng `INSTRUCTOR_CAN_EDIT_BANDS = False`).
- Hai điểm gọi, mỗi chỗ một dòng gọi bọc `try/except`:
  - `services/instructor_workflow.py::deliver`: ngay sau bước (2) (bài đã
    `delivered`, đã gọi `mark_assignment_delivered`), trước bước (3) đổi
    `prompt_version`. `reviewer_role` đọc từ `users.role` của `instructor_id`, vì
    cả `/instructor/reviews/{id}/deliver` lẫn
    `/admin/instructor/reviews/{id}/deliver` (`routers/admin_instructor_queue.py::deliver_review`)
    gọi hàm này.
  - `routers/admin_writing.py::_deliver_essay`: sau khi RPC
    `fn_deliver_writing_essay` trả `ok`. Thêm tham số keyword `actor_id: str | None = None`;
    `mark_delivered` và `bulk_mark_delivered` truyền id từ `require_admin` (hôm
    nay hai route bỏ giá trị trả về đó).
- Không gọi từ `essay_service.deliver_reviewed_essay` (thi thử) và từ
  `fn_deliver_writing_essay_instant` (mig 384, bài `ai_instant`).
- Script mới `backend/scripts/writing_score_pairs_reconcile.py` và file cron
  `backend/railway.score-pairs-reconcile.json` (chép khuôn
  `backend/railway.staff-security-sweep.json`).
- G09-T17 cùng chạm luồng trả bài nhưng không đổi chữ ký `deliver` hay
  `_deliver_essay`. PR vào sau rebase, giữ lời gọi `record_delivery` ở đúng một
  chỗ mỗi đường.

## Data and contracts

Mọi bảng mới: RLS bật, không policy cho `authenticated`/`anon` (chỉ backend
`supabase_admin`), quyền đọc và INSERT cho `service_role`, không UPDATE/DELETE.
Rollback `backend/migrations/rollback/480_writing_score_pairs.sql`; dòng
`forward-policy.tsv`. Thời gian lưu UTC.

**`writing_ai_score_snapshots`** (chỉ ghi thêm)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | GENERATED ALWAYS AS IDENTITY PK |
| essay_id | uuid | NOT NULL FK `writing_essays(id)` ON DELETE CASCADE |
| writing_feedback_id | uuid | NOT NULL, index; không FK (dòng phản hồi có thể bị `_gc_orphan_versions` xoá), không UNIQUE (một dòng có nhiều ảnh chụp khi chạy lại cùng job) |
| feedback_version | int | NOT NULL |
| source | text | NOT NULL (`ai_pro`, `ai_flash`, `legacy`) |
| overall, band_main, band_cc, band_lr, band_gra | numeric(2,1) | `overall` NOT NULL; bốn tiêu chí NULL được |
| prompt_version_base | text | NOT NULL, đã bỏ hậu tố `-instructor-pending`, `-instructor`, `-composed` |
| model_used | text | NULL |
| task_type | text | NOT NULL, chép từ `writing_essays.task_type` |
| legacy | boolean | NOT NULL DEFAULT false |
| captured_at | timestamptz | NOT NULL DEFAULT now() |

Trigger `trg_writing_feedback_ai_snapshot` AFTER INSERT OR UPDATE OF năm cột band
ON `writing_feedback` FOR EACH ROW WHEN `NEW.source LIKE 'ai\_%'` (với UPDATE thêm
điều kiện ít nhất một cột band `IS DISTINCT FROM` giá trị cũ). Hàm trigger
`SECURITY DEFINER`, `SET search_path = pg_catalog, public, pg_temp` (mẫu mig 369,
383). Nạp lại trong cùng migration: `INSERT … SELECT` mọi dòng có
`source LIKE 'ai\_%' OR source IS NULL` chưa có ảnh chụp (`WHERE NOT EXISTS`, chạy
lại không nhân đôi; dòng NULL ghi `source='legacy'`, `legacy=true`).

**`writing_score_pairs`** (chỉ ghi thêm)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | identity PK |
| essay_id | uuid | NOT NULL FK `writing_essays(id)` ON DELETE CASCADE |
| delivered_at | timestamptz | NOT NULL |
| delivery_key | text | NOT NULL UNIQUE: `review:<instructor_reviews.id>:<instructor_reviews.delivered_at>`, `essay:<essay_id>:<writing_essays.delivered_at>` (đường admin và đối soát), `pack:<id>` (để dành cho REVIEWPACK-0094) |
| ai_first_snapshot_id | bigint | NULL FK `writing_ai_score_snapshots(id)` |
| ai_before_edit_snapshot_id | bigint | NULL FK `writing_ai_score_snapshots(id)` |
| teacher_overall, teacher_main, teacher_cc, teacher_lr, teacher_gra | numeric(2,1) | band bản đang hiện lúc trả |
| current_version | int | NOT NULL |
| current_source | text | NULL (`ai_pro`, `composed`, …) |
| reviewer_id | uuid | NULL FK `users(id)` ON DELETE SET NULL |
| reviewer_role | text | NOT NULL CHECK IN (`admin`,`instructor`,`unknown`) |
| reviewer_can_edit_bands | boolean | NOT NULL |
| delivery_path | text | NOT NULL CHECK IN (`instructor_review`,`admin_mark_delivered`,`review_pack`,`reconcile`) |
| context | text | NOT NULL CHECK IN (`class_assignment`,`self_practice`,`mock`,`review_pack`,`unknown`) |
| cohort_id | uuid | NULL |
| task_type | text | NOT NULL |
| reconstructed | boolean | NOT NULL DEFAULT false |
| change_reason | jsonb | NULL (REVIEWPACK-0094 điền) |
| comments_kept, comments_removed, comments_added, review_active_seconds | int | NULL (REVIEWPACK-0094 điền) |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Index `(essay_id, delivered_at DESC)`, `(delivered_at)`, `(cohort_id, delivered_at)`.
Trigger BEFORE UPDATE OR DELETE (row) và BEFORE TRUNCATE (statement) trên cả hai
bảng gọi một hàm chung ném `<TG_TABLE_NAME>_append_only` (mẫu
`fn_course_commerce_append_only` của mig 383); riêng DELETE cho qua khi
`pg_trigger_depth() > 1` (xoá dây chuyền từ FK). View
`writing_score_pairs_latest` = dòng `delivered_at` mới nhất của mỗi `essay_id`.
Seed `runtime_flags('writing_score_pairs_record', false)` `ON CONFLICT DO NOTHING`.

**`record_delivery(essay_id, *, reviewer_id, reviewer_role, delivery_path, delivery_key, extra=None) -> dict`**
trả `{"status": "recorded"|"duplicate"|"skipped_flag_off"|"no_feedback"|"failed", "pair_id": int | None}`
và không bao giờ ném lỗi. Các bước: đọc cờ (tắt → `skipped_flag_off`); đọc
`writing_essays` (`current_version`, `task_type`, `delivered_at`, `sitting_id`);
đọc chuỗi tổ tiên trong `writing_feedback` như `essay_service._ancestor_versions`
nhưng giữ `id` của từng dòng; không có bản đang hiện → `no_feedback`; ghép ảnh
chụp theo `writing_feedback_id`; tính `context` (bài lớp khi có
`writing_assignments.essay_id = essay_id` (mig 036), lớp =
`class_assignments.cohort_id` qua `class_assignment_items.artifact_kind='writing_assignment'
AND artifact_id = writing_assignments.id` (mig 177); còn lại `self_practice`);
INSERT … ON CONFLICT (`delivery_key`) DO NOTHING (không có dòng trả về →
`duplicate`). `reviewer_can_edit_bands = (reviewer_role == 'admin') or INSTRUCTOR_CAN_EDIT_BANDS`.

Hợp đồng API: không endpoint nào mới hay đổi shape. OpenAPI không đổi.

Tương thích: migration chỉ thêm bảng, trigger, view và một dòng cờ. Mã đang chạy
không đọc các đối tượng này. Trigger chụp chỉ thêm một INSERT nhỏ vào lúc chấm.

## UI and interaction

Không có. Xem `ui-states.md`.

## Work decomposition

1. G12-C02 (PR `high-risk`, migration): `480_writing_score_pairs.sql`, rollback,
   `register.tsv`, `forward-policy.tsv`, `backend/tests/test_migration_480_writing_score_pairs.py` (PG17).
2. G12-C03 (PR `high-risk`, backend, sau khi 480 đã áp trên staging): service, hai
   điểm gọi, script đối soát, file cron, `backend/tests/test_writing_score_pairs.py`.
   Rebase theo G09-T17 nếu T17 vào trước.

## Rollout and rollback

Xem `rollout.md`. Cờ tắt mặc định. Tắt cờ thì ngừng ghi cặp ngay (không cần
deploy); trigger chụp điểm AI vẫn chạy vì chỉ thêm dòng. Rollback migration từ
chối khi `writing_score_pairs` có dòng, trừ khi phiên đặt
`SET aver.allow_score_pairs_rollback='on'`.

## Verification strategy

- PG17 migration test: chụp khi chèn `ai_pro`; không chụp `composed`; UPDATE
  `prompt_version` không chụp; UPDATE band thêm một ảnh, ảnh cũ giữ nguyên;
  UPDATE/DELETE/TRUNCATE trực tiếp lỗi `_append_only`; xoá cứng
  `writing_essays` xoá theo cả hai bảng; chạy migration hai lần không lỗi; nạp
  lại đánh dấu `legacy`.
- Pytest backend với supabase giả cho mọi scenario trong `spec.md` và các edge
  case ghép ảnh chụp, `duplicate`, cờ tắt, lỗi bên trong.
- Bộ backend đầy đủ.
- Staging: áp 480, đếm ảnh chụp bằng truy vấn ở Success criteria, bật cờ, trả một
  bài thử theo mỗi đường, đọc `writing_score_pairs_latest`, chạy đối soát dry-run
  và `--report`.
