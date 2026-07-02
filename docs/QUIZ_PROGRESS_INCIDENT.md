# Incident — vocab/grammar quiz progress not saving (500 on /progress)

## Triệu chứng
- Học viên thấy **"Một phần tiến độ chưa lưu được — sẽ tự thử lại ở phiên sau."** ở cuối phiên quiz.
- Admin không có dashboard xem tiến độ (vấn đề riêng — xem commit "surface vocab quiz-analytics in nav").
- DB: nhiều phiên `quiz_sessions.ended_by='paused'` (nhiều học viên, mỗi phiên 50–70 câu) nhưng `quiz_attempts` / `quiz_word_stats` **gần như trống**.

## Chẩn đoán (từ log Railway)
```
POST /api/quiz/sessions/{id}/progress → 500 Internal Server Error   (173/173 = 100%)
POST /api/quiz/sessions                → 201 Created                 (tạo phiên OK)
PATCH /api/quiz/sessions/{id}          → 200 OK                      (end_session OK)
```
Client (`frontend/pages/quiz.html`) POST tiến độ; khi thất bại 2 lần ở `finish()` → phiên đánh `paused`, phần chưa lưu carry-over sang phiên sau. Đây là **degradation có kiểm soát** — nhưng nó kích hoạt 100% vì backend 500.

## Root cause
`services/quiz_service.log_progress` là chỗ **duy nhất** dùng UPSERT `on_conflict`:
- `quiz_attempts`  — `on_conflict="client_id"` (unique index `uq_quiz_attempts_client_id`, mig 119)
- `quiz_word_stats` — `on_conflict="user_id,bank_id,item_key"` (unique constraint, mig 119)

`quiz_sessions` chỉ dùng `insert`/`update` (không `on_conflict`) → **luôn chạy** (nên phiên vẫn tạo + đánh paused).

Migration 119 áp **thủ công** ("apply by hand before deploy"). Sau khi thêm unique index/constraint, **PostgREST phải reload schema cache** — nếu không, mọi `on_conflict` upsert trả lỗi Postgres `42P10`:
> *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*
→ backend `HTTPException(500, "Lỗi ghi ...")` → client thấy "chưa lưu tiến độ".

Khi kiểm tra hiện tại (sau khi constraint đã có + PostgREST đã reload), cả đường merge upsert **chạy đúng** → sự cố nằm ở khoảng migration/cache lệch.

## Khắc phục vận hành
Sau **mọi** migration thêm/đổi unique index/constraint mà code dùng cho `on_conflict`, chạy trên DB production:
```sql
NOTIFY pgrst, 'reload schema';
```
(hoặc restart PostgREST) — nếu không, `on_conflict` upsert sẽ 500 dù constraint đã tồn tại trong Postgres.

## Safeguard đã thêm (chống tái diễn)
1. **Health probe** `GET /health/quiz-write` (`routers/health.py` → `services.quiz_service.quiz_write_health`):
   probe non-destructive (FK bogus → row bị từ chối, không ghi) để xác nhận PostgREST **nhận** 2 constraint on_conflict. Trả `status: healthy | error`. Đưa vào uptime-check để bắt sớm lần sau.
   - Test: `backend/tests/test_quiz_write_health.py`.
2. **Log server-side**: `log_progress` giờ ghi exception vào bảng `error_logs` (source=`backend`) trước khi raise 500 — lần sau có traceback ngay trong admin Error Logs (trước đây `HTTPException(500)` không được log, access log chỉ có status).

## Kiểm tra đã khỏi
- `curl https://<backend>/health/quiz-write` → `status: healthy`.
- Chơi thử 1 phiên quiz → không còn thông báo + `quiz_attempts` có row mới.
