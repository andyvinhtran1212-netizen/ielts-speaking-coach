# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging` (có `approval-decision.md`).
- Số 480 còn trống trong `backend/migrations/register.tsv` lúc mở PR G12-C02; nếu
  đã bị dùng thì lấy số kế trong 480–489 và sửa bảng 5.0 của GOI-12 trong cùng PR.
- Production đã có mig 109 (`writing_feedback.version/source`), 177
  (`class_assignment_items`) và 155 (`runtime_flags`).

## Staging

1. Merge PR G12-C02 vào `staging`.
2. Anh Andy gõ duyệt áp 480 trên staging qua runner có advisory lock.
3. Kiểm ngay sau khi áp:
   `SELECT count(DISTINCT writing_feedback_id) FROM writing_ai_score_snapshots;`
   bằng
   `SELECT count(*) FROM writing_feedback WHERE source LIKE 'ai\_%' OR source IS NULL;`
4. Merge PR G12-C03. Cờ vẫn tắt: trả một bài thử, xác nhận không có cặp và việc
   trả bài như cũ.
5. Anh Andy bật `writing_score_pairs_record` trên staging. Trả một bài qua
   `/instructor/reviews/{id}/deliver`, một bài qua `mark-delivered`, một bài qua
   `bulk-mark-delivered`. Mỗi bài:
   `SELECT * FROM writing_score_pairs_latest WHERE essay_id = '<id>';` có đúng một dòng
   đúng band.
6. Chạy `python -m scripts.writing_score_pairs_reconcile --report` (dry-run): in
   số cặp theo tháng, không có email hay tên.
7. Chạy staging E2E trên đúng SHA.

## Production

- Áp 480 trên production trong một cửa sổ anh Andy gõ duyệt, trước khi promote mã
  G12-C03.
- Promote qua PR `staging` → `main`.
- Bật cờ trên production khi anh Andy gõ duyệt.
- Chạy đối soát dry-run, xem số bài sẽ dựng lại, rồi `--execute` khi anh Andy
  đồng ý. Tạo service cron trên Railway (02:30 giờ VN) là việc của anh Andy.

## Rollback and repair

- Ngừng ghi cặp: tắt cờ (có hiệu lực trong khoảng 15 s, cache của `runtime_flags`, không cần deploy).
- Rollback mã: revert PR G12-C03; trả bài trở về đúng như trước.
- Rollback migration: `rollback/480_writing_score_pairs.sql` từ chối khi
  `writing_score_pairs` có dòng, trừ khi phiên đặt
  `SET aver.allow_score_pairs_rollback='on'`. Chỉ làm khi anh Andy gõ duyệt, vì
  sẽ mất ảnh chụp điểm AI không dựng lại được.
- Sửa dữ liệu: không UPDATE được (chỉ ghi thêm). Cặp sai được xử lý ở chặng đọc
  (SCOREGAP-0091) bằng bộ lọc, hoặc bằng một spec sửa đổi.

## Observability

- Log `[score-pair] failed essay=<id>` (WARNING) mỗi lần ghi cặp lỗi.
- Đối soát `--report` in số bài cần ghi bù; khác 0 hai đêm liền thì xem log.
- Chủ: anh Andy.
