# Rollback (b) nhóm `ai_budget` (migration 333 + 340)

> **Runbook này chỉ mô tả, không cấp quyền chạy.**
> - Production: mọi bước, kể cả câu `SELECT` chỉ đọc, export và rollback,
>   đều **cần anh Vinh duyệt** trước (ghi rõ môi trường, SHA, file SQL, hành
>   động). Không có duyệt thì không chạy.
> - Staging: kiểm `/workspace/cc-jobs/STAGING_FREEZE` trước mỗi lần chạy; file
>   đó tồn tại thì dừng và báo Leader.
> - Leader quyết có rollback (b) hay không; người vận hành chỉ thực hiện.
> - Không in, log hay commit secret, connection string hay dữ liệu học viên.
>   Báo cáo chỉ ghi số đếm và ID.

Nguồn sự thật cho SQL là
[`340_ai_budget_hardening.sql`](../../backend/migrations/340_ai_budget_hardening.sql)
(khối comment `ROLLBACK (b)`, dòng 110–185). Runbook trích dẫn `340:<dòng>`, không
chép lại phần DROP. Các trích dẫn khác: `333:<dòng>` là
[`333_ai_budget_hard_cap.sql`](../../backend/migrations/333_ai_budget_hard_cap.sql),
`rollout.md` là
[`specs/0033-ai-budget-hard-cap/rollout.md`](../../specs/0033-ai-budget-hard-cap/rollout.md)
và `plan.md` là
[`specs/0033-ai-budget-hard-cap/plan.md`](../../specs/0033-ai-budget-hard-cap/plan.md).
Dòng ghi theo `origin/staging` `436bc59b4`. Nếu 340 đổi, đối chiếu lại số dòng
trước khi dùng.

## 1. Khi nào dùng rollback (b)

Rollback (b) gỡ **cả nhóm** `ai_budget` (333 + 340): bảng counters,
reservations, deferred jobs, refresh, raises, alerts, heartbeat, các hàm
`fn_ai_*` của nhóm ngân sách (`340:145-172`), trigger `trg_ai_session_generation`
trên `responses` và các cột `budget_*` của `writing_jobs`. Bảng `ai_budget_raise_events`, trigger
append-only và hàm của trigger đó được giữ lại làm hồ sơ kiểm toán
(`340:113-116`). Mất lịch sử ngân sách, không mất dữ liệu bài làm, **với điều
kiện** cả năm guard đều qua.

Thử các cách nhẹ hơn trước (`rollout.md` §Rollback and repair):

| Vấn đề | Cách xử lý | Có cần DB? |
| --- | --- | --- |
| Cần chặn ngay mọi lời gọi AI | `AI_KILL_SWITCH=on` (bài vẫn được lưu và xếp hàng) | Không |
| Backend 0033 lỗi | Code rollback; bảng 333 ở lại và bị bỏ qua | Không |
| Một raise đang mở sai | Kết thúc raise (mục 3.5) | RPC |
| Chỉ phần hardening của 340 có vấn đề | Rollback (a) (`340:92-108`), giữ 333 | Migration mới |
| Phải gỡ hẳn schema ngân sách | **Rollback (b)** | Migration mới |

Rollback (b) là một **migration forward mới** do Leader duyệt và chạy, không phải
sửa 333 hay 340 (`340:89-90`). Nó thay cho down script trong header 333: cùng
các guard đó, thêm guard class-sync (F03) và khoá writer trước khi kiểm
(`340:110-113`). Không dùng down script trong header 333, vì nó thiếu guard
class-sync (`340:57-61`).

## 2. Điều kiện trước khi chạy

- [ ] Leader đã quyết dùng (b); với production đã có anh Vinh duyệt bằng chữ.
- [ ] Staging: `/workspace/cc-jobs/STAGING_FREEZE` không tồn tại.
- [ ] Ledger có 333 (và 340 nếu đã áp). Đọc, không sửa:

  ```sql
  SELECT filename
    FROM public._schema_migrations
   WHERE filename IN ('333_ai_budget_hard_cap.sql', '340_ai_budget_hardening.sql')
   ORDER BY filename;
  ```

- [ ] Hàng đợi đã được drain **trong lúc backend 0033 còn chạy**. 340 yêu cầu
  (b) chạy sau khi backend pre-0033 đã deploy (`340:110-111`), nhưng backend cũ
  không chấm hàng đợi (`rollout.md`: "Queued Speaking and Writing items remain
  saved but are not graded by the old backend"). Vì vậy: chạy năm `SELECT` ở
  mục 3 khi backend 0033 còn phục vụ, chờ tới khi rỗng, rồi mới đổi backend.
  Sau khi đổi, chạy lại năm `SELECT` (xem mục 5 về refresh mới phát sinh).
- [ ] Chọn giờ thấp điểm. Lệnh `LOCK` ở `340:119-120` giữ `public.responses`,
  `writing_jobs`, `ai_deferred_grading_jobs`, `ai_deferred_session_refresh`,
  `ai_budget_raises` ở `SHARE ROW EXCLUSIVE` tới `COMMIT`. Trong lúc đó mọi ghi
  bài nói bị chặn (`lock_timeout` 5s ở `340:118`).

## 3. Thứ tự thực hiện

1. **Liệt kê nợ (chỉ đọc).** Chạy năm câu `SELECT` ở mục 4. Mỗi câu dùng đúng
   bảng, cột và điều kiện của guard tương ứng, chỉ thêm cột để người quyết
   nhìn thấy bản ghi. Mọi câu phải trả về 0 dòng. Câu nào còn dòng thì xử lý
   theo mục 4 của guard đó, không đi tiếp.
   Các câu này chạy ngoài khoá, nên chỉ là ảnh chụp. Kiểm tra quyết định là
   guard trong transaction đã khoá (bước 3).
2. **Sao lưu `ai_budget_raise_events`** (`340:113-116`), bằng psql trên máy vận
   hành, rồi đối chiếu số dòng:

   ```
   \copy public.ai_budget_raise_events TO 'raise-events.csv' CSV HEADER
   ```

   ```sql
   SELECT count(*) AS raise_events FROM public.ai_budget_raise_events;
   ```

   Số dòng dữ liệu trong CSV (trừ dòng header) phải bằng `raise_events`. File
   có `actor_id`, `reason`, `request_id`: cất ở nơi lưu trữ đã duyệt, không
   commit vào repo, không đính kèm vào PR hay log công khai. Rollback (b) giữ
   lại bảng này, nhưng bản export vẫn là bản sao lưu bắt buộc.
3. **Chạy migration rollback (b).** Nội dung là khối `340:117-185` (BEGIN, `SET
   LOCAL lock_timeout`, `LOCK TABLE` `340:119-120`, khối guard `340:121-143`,
   các lệnh gỡ `340:144-184`, COMMIT `340:185`), bỏ tiền tố comment, không sửa
   gì. Chạy qua runner có advisory lock như mọi migration, staging trước. Đây
   là thao tác ghi: theo quy tắc job A (ghi file request, dòng `SENDING`, lưu
   output, dòng `RESULT`).
4. **Nếu một guard từ chối.** Transaction abort toàn bộ: không gì bị gỡ, khoá
   được nhả khi transaction kết thúc. Đọc tên lỗi (`rollback_unsafe_*`), quay
   lại bước 1 với guard đó. Không chạy lại liên tục để "thử vận may".
5. **Hậu kiểm (chỉ đọc).**

   ```sql
   SELECT t AS still_present
     FROM unnest(ARRAY['ai_budget_counters', 'ai_budget_reservations', 'ai_budget_alerts',
                       'ai_deferred_grading_jobs', 'ai_deferred_session_refresh',
                       'ai_budget_raises', 'ai_budget_heartbeat']) AS t
    WHERE to_regclass('public.' || t) IS NOT NULL;
   -- mong đợi: 0 dòng

   SELECT count(*) AS triggers FROM pg_trigger
    WHERE tgrelid = 'public.responses'::regclass AND tgname = 'trg_ai_session_generation';
   -- mong đợi: 0

   SELECT count(*) AS fn_left FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = ANY(ARRAY[
          'fn_ai_session_generation_bump',
          'fn_ai_budget_reserve',
          'fn_ai_budget_settle',
          'fn_ai_budget_release',
          'fn_ai_budget_expire',
          'fn_ai_budget_close_scope',
          'fn_ai_budget_recompute',
          'fn_ai_deferred_save',
          'fn_ai_deferred_claim',
          'fn_ai_deferred_commit',
          'fn_ai_deferred_claim_writing',
          'fn_ai_deferred_commit_writing',
          'fn_ai_deferred_aggregate_write',
          'fn_ai_session_bands_write',
          'fn_ai_class_sync',
          'fn_ai_budget_raise_grant',
          'fn_ai_budget_raise_end',
          'fn_ai_budget_raise_expire_sweep',
          'fn_ai_budget_raise_record_end',
          'fn_ai_budget_alert_crossings',
          'fn_ai_budget_lock_counter',
          'fn_ai_budget_thresholds',
          'fn_ai_budget_active_raise',
          'fn_ai_budget_ensure_refresh',
          'fn_ai_patch_row',
          'fn_ai_insert_row',
          'fn_ai_response_revision',
          'fn_ai_budget_assert_finite'
      ]);
   -- mong đợi: 0

   SELECT count(*) AS budget_cols FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'writing_jobs' AND column_name LIKE 'budget_%';
   -- mong đợi: 0

   SELECT count(*) AS raise_events FROM public.ai_budget_raise_events;
   -- mong đợi: bằng số đếm ở bước 2
   ```

   `fn_left` chỉ đếm đúng các hàm bị gỡ ở `340:145-172`. Hai hàm
   `fn_ai_model_override_audit` và `fn_ai_model_override_audit_append_only` của
   [`322_ai_model_overrides_and_failures.sql`](../../backend/migrations/322_ai_model_overrides_and_failures.sql)
   (dòng 84 và 122) không thuộc nhóm ngân sách và được giữ nguyên.
   Test
   `test_rollback_b_keeps_every_333_guard_then_drops_the_group` trong
   `backend/tests/test_migration_340_ai_budget_hardening.py` dựng schema 333 + 340,
   không áp 322. Truy vấn `fn_ai_%` trong test trả 0 sau khi loại hàm audit raise
   chỉ vì schema test thiếu 322; không dùng truy vấn rộng đó để hậu kiểm DB đã áp 322.

## 4. Từng guard

Thứ tự dưới đây là thứ tự guard trong `340:121-143`. Guard đầu tiên trúng sẽ
dừng cả khối, nên một lần chạy chỉ báo một tên lỗi. Hãy chạy cả năm `SELECT`
một lượt để biết hết nợ.

Quy tắc chung cho phần "Không làm" của mọi guard: **không `UPDATE`, `DELETE`
hay `INSERT` bằng tay để qua guard**, không sửa điều kiện guard trong file
rollback, không bỏ khối guard. Nếu Leader và anh Vinh quyết thay đổi dữ liệu,
đó phải là một script riêng được review, có chế độ dry-run (in danh sách sẽ
đổi, không ghi), có guard điều kiện trong chính câu ghi, ghi log theo quy tắc
job A, và tôn trọng `STAGING_FREEZE`.

### 4.1 `rollback_unsafe_deferred_jobs_pending` (`340:123-125`)

**Ý nghĩa.** Còn bài nói đang chờ chấm do hết ngân sách
(`ai_deferred_grading_jobs.status` là `queued` hoặc `running`). Gỡ bảng lúc này
làm bài đó mất đường được chấm. Job `running` có lease đã hết hạn vẫn tính
(`fn_ai_deferred_claim` sẽ claim lại nó, `333:1057-1060`).

```sql
SELECT j.id AS job_id, j.status, j.attempts, j.enqueued_at, j.lease_until,
       (j.status = 'running' AND j.lease_until < now()) AS lease_expired,
       j.resource_id AS response_id, r.session_id, r.grading_status, j.user_id
  FROM public.ai_deferred_grading_jobs j
  LEFT JOIN public.responses r ON r.id = j.resource_id
 WHERE j.status IN ('queued', 'running')
 ORDER BY j.enqueued_at, j.id;
```

**Xử lý an toàn.**
- Khi backend 0033 còn chạy: chờ worker drain hết (cần còn ngân sách). Nếu
  cần nhanh, Leader và anh Vinh có thể quyết một raise tạm thời qua luồng
  raise hiện có, rồi kết thúc nó trước bước 2 của mục 3 (xem 4.5).
- Job `superseded` (bài đã nộp lại) không chặn. Worker tự chuyển sang
  `superseded` khi claim (`333:1063-1069`).
- Nếu đã đổi sang backend pre-0033: backend cũ không drain. Các lựa chọn để
  Leader quyết: deploy lại backend 0033 để drain (`rollout.md`), hoặc chấm lại
  từng bài qua route admin regrade. Lưu ý chấm lại qua route của backend cũ
  không đổi `status` của job, nên guard vẫn chặn. Cách đóng job nào khác
  RPC `fn_ai_deferred_commit` là quyết định riêng (script có dry-run).

**Không làm.** Không đổi tay `status` sang `done`, `failed` hay `superseded`.
`done` bắt buộc `persisted_at` (`333:206`) và làm hỏng đối soát V5 trong
`plan.md`.

### 4.2 `rollback_unsafe_session_refresh_owed` (`340:126-130`)

**Ý nghĩa.** Có session `completed` mà band tổng chưa được tính lại sau lần ghi
response cuối (`refreshed_generation < generation`). Gỡ bảng lúc này có thể để
`sessions.overall_band` thiếu kết quả chấm muộn.

```sql
SELECT r.session_id, r.generation, r.refreshed_generation, r.class_synced_generation,
       r.updated_at, s.completed_at, s.class_assignment_item_id, s.user_id,
       EXISTS (SELECT 1
                 FROM public.ai_deferred_grading_jobs j
                 JOIN public.responses x ON x.id = j.resource_id
                WHERE x.session_id = r.session_id) AS has_deferred_job
  FROM public.ai_deferred_session_refresh r
  JOIN public.sessions s ON s.id = r.session_id AND s.status = 'completed'
 WHERE r.refreshed_generation < r.generation
 ORDER BY s.completed_at NULLS LAST, r.session_id;
```

Cột `has_deferred_job` không thuộc guard. Nó tách session từng có bài chấm
muộn khỏi session chỉ bị trigger tăng `generation` (xem mục 5).

**Xử lý an toàn.**
- Khi backend 0033 còn chạy: chờ sweeper refresh. Sweeper ghi band qua
  `fn_ai_deferred_aggregate_write` với `generation` đã đọc, thử lại tối đa 3
  lần mỗi lượt (`plan.md`, Sweeper drain order). Session `in_progress` không
  bị tính, guard chỉ xét `completed`.
- Sau khi đổi sang backend pre-0033: không còn ai xác nhận refresh. Lựa chọn
  để Leader quyết: deploy lại backend 0033 để sweeper chạy, hoặc một script
  được review gọi RPC `fn_ai_deferred_aggregate_write` với band tính bằng
  `_compute_session_bands` chuẩn (dry-run trước, liệt kê session và band sẽ
  ghi).

**Không làm.** Không đặt tay `refreshed_generation = generation`. Làm vậy xoá
nghĩa vụ mà không tính lại band.

### 4.3 `rollback_unsafe_class_sync_owed` (`340:131-135`)

**Ý nghĩa.** Có session gắn bài tập lớp (`sessions.class_assignment_item_id`
khác NULL) mà band mới nhất chưa được đẩy sang
`class_assignment_items.score` (`class_synced_generation <
refreshed_generation`). Gỡ bảng lúc này có thể để điểm bài tập lớp cũ hơn band
của session. Guard này **có thể chặn vô thời hạn**, xem mục 4.3.1.

```sql
SELECT r.session_id, r.refreshed_generation, r.class_synced_generation,
       s.status AS session_status, s.completed_at, s.overall_band,
       i.id AS item_id, i.assignment_id, i.student_id, i.state,
       i.submitted_at, i.artifact_kind, i.artifact_id, i.score,
       a.title AS assignment_title, a.due_at, a.status AS assignment_status,
       CASE
           WHEN i.id IS NULL THEN 'no_item'
           WHEN i.submitted_at IS NOT NULL
                AND (i.artifact_kind IS DISTINCT FROM 'session'
                     OR i.artifact_id IS DISTINCT FROM r.session_id) THEN 'no_item'
           WHEN i.submitted_at IS NULL THEN 'pending_handin'
           WHEN s.overall_band IS NULL THEN 'no_band'
           ELSE 'synced'
       END AS expected_sync_status
  FROM public.ai_deferred_session_refresh r
  JOIN public.sessions s ON s.id = r.session_id AND s.class_assignment_item_id IS NOT NULL
  LEFT JOIN public.class_assignment_items i ON i.id = s.class_assignment_item_id
  LEFT JOIN public.class_assignments a ON a.id = i.assignment_id
 WHERE r.class_synced_generation < r.refreshed_generation
 ORDER BY expected_sync_status, s.completed_at NULLS LAST, r.session_id;
```

Cột `expected_sync_status` dự đoán kết quả của `fn_ai_class_sync` theo đúng
nhánh trong `333:1409-1424`. Đây chỉ là dự đoán đọc ngoài khoá; kết quả thật do
hàm quyết dưới khoá. Đối chiếu với V9 trong `plan.md` (V9 chỉ lấy session
hoàn thành quá 1 giờ; câu trên lấy mọi dòng guard sẽ chặn).

**Xử lý an toàn.**
- Dòng `no_item`, `no_band`, `synced`: một lần chạy `fn_ai_class_sync` sẽ xoá
  nợ (`333:1426-1428`). Khi backend 0033 còn chạy, chờ sweeper lượt sau (mỗi
  lượt gọi lại hàm cho mọi session còn nợ, `plan.md`). Sau khi đổi backend, chỉ
  còn cách gọi RPC `fn_ai_class_sync(session_id)` bằng script được review
  (dry-run = chạy câu trên và in danh sách).
- Dòng `pending_handin`: xem 4.3.1.

**Không làm.** Không đặt tay `class_synced_generation`, không ghi tay
`class_assignment_items.submitted_at`, `state` hay `score` để guard qua. Ghi
`submitted_at` tay còn đổi kết luận nộp đúng hạn hay trễ của học viên.

#### 4.3.1 `pending_handin`: nợ có thể không bao giờ tự hết

`fn_ai_class_sync` trả `pending_handin` và **giữ nguyên nợ** khi item chưa ghi
nhận nộp bài (`class_assignment_items.submitted_at IS NULL`, `333:1413-1415`).
Chỉ khi `mark_item_submitted` ghi nhận nộp bài
(`backend/services/class_assignment_service.py`) thì lần sync sau mới xoá được
nợ. Các trường hợp nợ treo:

- học viên đang làm (session `in_progress`) và sẽ nộp sau: nợ tự hết khi nộp;
- học viên bỏ dở, session không bao giờ `completed`: nợ treo mãi;
- session `completed` nhưng bước ghi nhận nộp bài lỗi: `plan.md` V9 nói đây là
  trường hợp phải điều tra, không xoá nợ bằng tay.

Guard từ chối là hướng an toàn (fail-closed). Người vận hành và PC **không tự
chọn** cách xử lý. Các lựa chọn để Leader và anh Vinh quyết:

| Lựa chọn | Hệ quả |
| --- | --- |
| A. Chờ học viên nộp (hoặc tới hạn `due_at` rồi xem lại) | Không đổi dữ liệu; rollback (b) có thể trễ vô thời hạn |
| B. Liệt kê từng item `pending_handin` (câu ở 4.3) và quyết riêng từng item, ví dụ hỏi giáo viên hoặc học viên | Không đổi dữ liệu cho tới khi có quyết định cho từng item |
| C. Với item đã điều tra và có quyết định, một script được review gọi luồng chuẩn (ghi nhận nộp bài như route hoàn thành session làm, rồi `fn_ai_class_sync`) | Đổi dữ liệu thật; cần dry-run, guard, log quy tắc A, `STAGING_FREEZE`; production cần anh Vinh duyệt |
| D. Hoãn rollback (b); dùng code rollback hoặc kill switch (mục 1) cho tới khi hết nợ | Bảng 333 ở lại; trigger vẫn chạy (mục 5) |

Thông tin cần đưa cho người quyết, lấy từ câu ở 4.3: số item theo
`expected_sync_status`, và với mỗi item `pending_handin` thì `assignment_id`,
`assignment_title`, `due_at`, `assignment_status`, `student_id`,
`session_status`, `completed_at`. Không chép tên hay email học viên vào báo cáo.

### 4.4 `rollback_unsafe_writing_jobs_deferred` (`340:136-139`)

**Ý nghĩa.** Còn bài viết bị hoãn vì ngân sách và chưa chấm xong
(`writing_jobs.budget_deferred_at IS NOT NULL` và `status` là `queued` hoặc
`running`). Rollback gỡ các cột `budget_*` (`340:181-184`), nên bài đó mất dấu
hoãn.

```sql
SELECT w.id AS writing_job_id, w.essay_id, w.job_type, w.status,
       w.budget_deferred_at, w.budget_lease_until, w.budget_drain_count,
       w.attempt_count, w.max_attempts, w.created_at
  FROM public.writing_jobs w
 WHERE w.budget_deferred_at IS NOT NULL AND w.status IN ('queued', 'running')
 ORDER BY w.budget_deferred_at, w.id;
```

**Xử lý an toàn.**
- Khi backend 0033 còn chạy: chờ Writing drain (`fn_ai_deferred_claim_writing`,
  `fn_ai_deferred_commit_writing`). Bài bị từ chối lại vì ngân sách quay về
  `queued` và vẫn giữ `budget_deferred_at` (`plan.md`).
- Sau khi đổi backend: backend pre-0033 không biết các cột `budget_*`. Bài có
  được worker cũ chấm hay không phải kiểm trên code của SHA sẽ deploy; runbook
  không giả định. Còn dòng thì báo Leader.

**Không làm.** Không đặt tay `status = 'failed'` hay xoá `budget_deferred_at`.
Bài của học viên sẽ thành lỗi hoặc mất đường chấm mà không ai biết.

### 4.5 `rollback_unsafe_raise_active` (`340:140-142`)

**Ý nghĩa.** Còn một raise ngân sách tạm thời đang hiệu lực (`ended_at IS NULL`
và `expires_at > now()`). Gỡ bảng lúc này xoá raise mà không có sự kiện kết
thúc trong `ai_budget_raise_events`.

```sql
SELECT id AS raise_id, scope, amount_usd, base_month_cap_usd,
       granted_at, expires_at, granted_by, request_id
  FROM public.ai_budget_raises
 WHERE ended_at IS NULL AND expires_at > now()
 ORDER BY expires_at, id;
```

**Xử lý an toàn.**
- Chờ hết hạn: một raise dài tối đa 24 giờ (CHECK ở `333:257`). Raise đã quá
  `expires_at` nhưng chưa ghi kết thúc (`ended_at IS NULL`) không chặn guard;
  sweeper ghi sự kiện `expired` qua `fn_ai_budget_raise_expire_sweep`.
- Hoặc kết thúc sớm qua RPC có sẵn `fn_ai_budget_raise_end(raise_id, actor,
  'aal2', reason, request_id)` (`333:1546-1574`; `rollout.md` Raise rollback),
  hoặc qua màn hình admin khi đã có. Đây là thao tác ghi: cần Leader (staging)
  hoặc anh Vinh (production) duyệt, actor là admin thật đã AAL2, và theo quy
  tắc job A. Nó ghi sự kiện `ended_early` vào `ai_budget_raise_events`, nên
  làm **trước** bước sao lưu ở mục 3.

**Không làm.** Không đặt tay `ended_at` hay `expires_at`. Bảng sự kiện là
append-only và sẽ thiếu sự kiện kết thúc.

## 5. Lưu ý: trigger vẫn tạo nợ refresh khi backend 0033 không chạy

Đây là nhận xét từ đọc code, **chưa kiểm trên dữ liệu staging hay
production**.

- Trigger `trg_ai_session_generation` (`333:1602-1644`) tăng
  `ai_deferred_session_refresh.generation` ở mọi lần thêm, xoá response, hoặc
  đổi band, feedback hay `grading_status` của response. Trigger thuộc 333, nên
  vẫn chạy khi backend là pre-0033.
- Chỉ các RPC của 333 mới nâng `refreshed_generation`
  (`fn_ai_deferred_aggregate_write`, `fn_ai_session_bands_write`). Backend
  pre-0033 ghi band trực tiếp, không gọi chúng.
- Hệ quả: mỗi session hoàn thành dưới backend pre-0033, khi 333 đã áp, đều
  trúng điều kiện 4.2. Test 340 dựng đúng tình huống này: thêm response rồi
  đặt session `completed` là đủ để còn nợ refresh
  (`backend/tests/test_migration_340_ai_budget_hardening.py`, fixture
  `_owed_class_sync` và
  `test_rollback_b_keeps_every_333_guard_then_drops_the_group`).
- Nghĩa là: sau khi đổi sang backend pre-0033, guard 4.2 (và 4.3 với session
  gắn bài tập lớp) có thể không bao giờ qua nếu còn session mới được hoàn
  thành. Cột `has_deferred_job = false` ở 4.2 chỉ ra các session này. Band của
  chúng do backend cũ tự tính, nhưng việc coi nợ đó là bỏ qua được hay không là
  quyết định của Leader và anh Vinh, không phải của người vận hành.

## 6. Bảng đối chiếu guard → 340 → SELECT

| Guard | 340 | Bảng | Điều kiện (giống hệt guard) | SELECT |
| --- | --- | --- | --- | --- |
| `rollback_unsafe_deferred_jobs_pending` | 123-124 | `ai_deferred_grading_jobs` | `status IN ('queued', 'running')` | 4.1 |
| `rollback_unsafe_session_refresh_owed` | 126-129 | `ai_deferred_session_refresh r` ⋈ `sessions s` | `s.id = r.session_id AND s.status = 'completed'`; `r.refreshed_generation < r.generation` | 4.2 |
| `rollback_unsafe_class_sync_owed` | 131-134 | `ai_deferred_session_refresh r` ⋈ `sessions s` | `s.id = r.session_id AND s.class_assignment_item_id IS NOT NULL`; `r.class_synced_generation < r.refreshed_generation` | 4.3 |
| `rollback_unsafe_writing_jobs_deferred` | 136-138 | `writing_jobs` | `budget_deferred_at IS NOT NULL AND status IN ('queued', 'running')` | 4.4 |
| `rollback_unsafe_raise_active` | 140-141 | `ai_budget_raises` | `ended_at IS NULL AND expires_at > now()` | 4.5 |

Các `LEFT JOIN` và cột thêm trong mục 4 (`responses`, `class_assignment_items`,
`class_assignments`, `has_deferred_job`, `expected_sync_status`) không lọc bớt
dòng nào, nên số dòng của mỗi câu bằng số dòng guard nhìn thấy.
