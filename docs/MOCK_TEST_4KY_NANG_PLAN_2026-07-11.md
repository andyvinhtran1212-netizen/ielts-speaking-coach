# Kế hoạch triển khai: Full Mock Test IELTS 4 kỹ năng (thu bài kín → admin duyệt → trả điểm sau)

*Ngày: 2026-07-11. Nguồn: validate `THIET_KE_FULL_MOCK_TEST_4_KY_NANG.md` bằng discovery thực tế trên repo (4 agent đọc code). Tài liệu này = **bản kế hoạch thi công**, không sửa product code.*

---

## Phần 0 — Kết quả validate: bản thiết kế đúng đến đâu

Discovery đọc trực tiếp `instructor_workflow.py`, `exam_service.py`, `reading_student.py`, `listening.py`, `sessions.py`, `band_rounding.py`, `pdf_generator.py`, các migration 033/044/047/105/115/134/144, và frontend `practice.js` / `reading-exam.js`. Verdict từng claim:

| Claim trong thiết kế | Verdict | Bằng chứng |
|---|---|---|
| Instructor workflow là blueprint (create_review idempotent → claim atomic → deliver, stamp `-instructor`) | ✅ ĐÚNG | `instructor_workflow.py`: `claim()` dùng `UPDATE ... WHERE id=? AND status='queued'`; status enum `queued/claimed/edited/delivered/released` (`models/instructor_review.py`); bảng `instructor_reviews` (mig `047`) |
| Exam UI L/R có state-machine + timer + strip answer key | ✅ ĐÚNG | `reading-exam.js` `showState()`; timer client đếm nhưng **neo vào `SESSION.started_at` từ server**; reading **bỏ hẳn cột `answer` khỏi SELECT** (`reading_student.py:575`), listening `strip_answer_keys()` (`listening_test_grader.py:366`); solution cũng bị strip |
| Writing đủ tầng: tier `instructor` + `hide_subbands` + regrade | ✅ ĐÚNG | `grading_tier_enum` có `'instructor'` (mig `044`, nhắc lại ở `115`); `hide_subbands` (mig `105`) **sống sót qua regrade**; `admin_writing.py` có trang chấm + PATCH feedback |
| Speaking full test 3 part (`_ftAllSessionIds`, `test_full`, band agg tại complete) | ✅ ĐÚNG | `practice.js:70` `_ftAllSessionIds`; `POST /sessions/finalize-full-test` (`sessions.py`); **KHÔNG có record cha — chỉ N session được nối lúc finalize** |
| Chấm auto làm nháp: reading/listening grader trả `score`+`skill_breakdown`; Claude FC/LR/GRA; Azure P | ✅ ĐÚNG | `reading_test_grader.grade_attempt()` trả `{score, band_estimate, per_question, skill_breakdown, by_part}`; Claude **bị cấm chấm P** (`claude_grader.py:114`), P chỉ từ Azure (`pron_calibration.pron_band()`) |
| `overall_from_criteria` = mean 4 band + ielts_round | ✅ ĐÚNG (chính xác **4 tham số**) | `band_rounding.py:26` `(b1+b2+b3+b4)/4` rồi `ielts_round` (.25→.5, .75→up). Vừa khít cho overall L/R/W/S |
| PDF ReportLab + font Việt | ✅ ĐÚNG | `pdf_generator.py` register `DejaVuSans`/Arial Unicode |
| Cohort + access code mở kỳ theo lớp | ⚠️ ĐÚNG MỘT NỬA | Cohort có (mig `060`) nhưng **KHÔNG có `open_from`/`open_until`** — khung giờ phải để trên `mock_exams` |
| analytics_events + beacon ghi blur/focus | ⚠️ ĐÚNG MỘT NỬA | `analytics_events` + `/api/analytics/events` có, nhưng beacon **chỉ bắn `page_view`** — event `exam_blur/exam_focus` **chưa tồn tại**, phải thêm |
| **Gap #1**: chưa có thực thể "kỳ thi" xuyên 4 kỹ năng | ✅ ĐÚNG | Không có bảng `mock_exams`; `exam_*` hiện tại **chỉ là MCQ 1 câu** (TOEIC/grammar/vocab, `mig 134`), không band IELTS, không sitting |
| **Gap #2**: submit trả điểm ngay | ✅ ĐÚNG | reading `submit` trả `{score, band_estimate, per_question,...}` (`reading_student.py:1159`); listening tương tự (`listening.py:6113`) |
| **Gap #3**: chưa có console duyệt theo sitting 4 kỹ năng | ✅ ĐÚNG | `admin_instructor_queue.py` **chỉ theo từng essay** (1 review = 1 `essay_id`), không nhóm theo sitting |
| **Gap #4**: chưa có email app-level | ✅ ĐÚNG | grep sạch `resend/postmark/sendgrid/smtplib/ses/boto3` trong `backend/` (ngoài venv) |
| **Gap #5**: Listening 0 đề import | ⚠️ **STALE — thực tế tốt hơn** | Importer `listening_fulltest_import.py` đã có + test pass; **ILR-LIS-001 ĐÃ import thành công** (`import_result.json`: 4 section/10 exercise, audio 1668s đã lên storage) nhưng đang **status `draft`**; mới 1 đề, chưa có pipeline seed như reading |

**Kết luận:** thiết kế đúng về bản chất. Ba điều chỉnh lớn ở Phần 1 dưới đây là bắt buộc trước khi code.

---

## Phần 1 — Ba điều chỉnh bắt buộc so với bản thiết kế gốc

### 1.1 ⚠️ Va chạm namespace `exam_*` — PHẢI đổi tên toàn bộ sang `mock_*`

Repo **đã có** module exam MCQ đang chạy production (2 đề live):
- Bảng: `exam_tests`, `exam_questions`, `exam_attempts` (mig 134/141/142/143)
- Router: `exams.py` mount tại `/api/exams`, `admin_exams.py` tại `/admin/exams`
- Service: `exam_service.py`; Frontend: `exam.html`, `exam-player.js`

→ **Bảng mới** dùng `mock_exams` / `mock_exam_sittings` / `mock_exam_reviews` (thiết kế đã đề xuất — an toàn, không đụng). **Nhưng route/file phải tránh `exam`**:
- Student API: `/api/mock-exams/...` (file `routers/mock_exams.py`)
- Admin API: `/admin/mock-exams/...` + `/admin/mock-reviews/...` (file `routers/admin_mock_exams.py`, `routers/admin_mock_reviews.py`)
- Service: `services/mock_exam_service.py`, `services/mock_review_workflow.py`
- Frontend: `pages/mock-exam.html`, `js/mock-exam-runner.js`, `pages/admin/mock-reviews/`

*Không tái dùng `exam_service.py`/`exams.py` — chúng là MCQ 1-câu, không có band IELTS, không sitting.*

### 1.2 Instructor review là **1:1 với essay** → cần bảng cha `mock_exam_sittings` + N review-row theo kỹ năng

`instructor_reviews.essay_id` có UNIQUE constraint (1 review = 1 essay). Không thể nhồi 4 kỹ năng vào 1 row. Chọn **Option A** (khuyến nghị, tách bạch, ít rủi ro hơn Option B "nhét cột skill vào instructor_reviews"):

- `mock_exam_reviews` = **hồ sơ duyệt cấp sitting** (1 row / 1 sitting) — giữ `final_bands`, `examiner_comment_vi`, lifecycle release.
- Logic claim/atomic/idempotent **bê nguyên** từ `instructor_workflow.py` sang `mock_review_workflow.py` (hàm skill-agnostic — chỉ đổi bảng thao tác). **Không** sửa `instructor_workflow.py` (writing lẻ vẫn dùng nó).
- Writing trong sitting: **vẫn tạo `writing_essays` + đi qua `instructor_workflow` sẵn có** (tier `instructor`), rồi `mock_exam_reviews` **tham chiếu** `essay_task1_id/essay_task2_id`. Tức là admin chấm Writing trên **trang `admin_writing` có sẵn**, còn console mock chỉ nhúng/link tới. Tránh viết lại UI chấm writing.

### 1.3 Sealed mode: chốt chặn ở **response của submit** + **mọi endpoint review/result**, không phải ở nút

Reading đã strip answer key ở fetch câu hỏi (tốt), nhưng **rò rỉ nằm ở 2 chỗ server-side**:
1. **Response của `POST .../submit`** — hiện trả thẳng `score/band/per_question`. Sealed: vẫn **chấm + lưu** như thường (nháp cho admin), nhưng response chỉ `{received:true, sitting_status}`.
2. **Endpoint review/result** (`GET .../attempts/{id}/review`, `GET .../results`, PDF export) — phải **403** tới khi `sitting.status='released'`.

Cơ chế enforce: thêm cột `sitting_id` (nullable) vào `reading_test_attempts`, `listening_test_attempts`, và `writing_essays`; speaking dùng link sitting↔sessions. Submit handler: `if attempt.sitting_id and sitting.sealed → seal response`. **Single source of truth `sealed` nằm trên sitting** (không cache lệch).

---

## Phần 2 — Mô hình dữ liệu (DDL tinh chỉnh, đánh số migration thực tế)

Migration mới nhất hiện tại = `144`. Số dưới đây là **dự kiến**, chốt lại lúc thi công (dùng `/db-migrate` để auto-detect). Tất cả ADDITIVE + idempotent + RLS service-role-only (đúng precedent mig 134).

### mig 145 — `mock_exams` (định nghĩa đề, admin soạn)
```sql
CREATE TABLE IF NOT EXISTS mock_exams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,              -- 'MOCK-2026-08A'
  title         TEXT NOT NULL,
  listening_test_id     UUID,                      -- FK listening_tests(id)
  reading_test_id       UUID,                      -- FK reading_tests(id)
  writing_task1_prompt_id UUID,                    -- FK writing_prompts(id)
  writing_task2_prompt_id UUID,
  speaking_topic_set    JSONB DEFAULT '{}'::jsonb, -- {part1:[...],part2:{...},part3:[...]}
  section_minutes JSONB DEFAULT
     '{"listening":32,"reading":60,"writing":60}'::jsonb,
  open_from     TIMESTAMPTZ,                       -- null = tự do (khung giờ ở ĐÂY, không ở cohort)
  open_until    TIMESTAMPTZ,
  cohort_id     UUID,                              -- null = mọi học viên
  review_sla_days INT NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','archived')),
  created_by    UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### mig 146 — `mock_exam_sittings` (một lượt thi của 1 học viên)
```sql
CREATE TABLE IF NOT EXISTS mock_exam_sittings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_exam_id  UUID NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'registered' CHECK (status IN (
                  'registered','lrw_listening','lrw_reading','lrw_writing',
                  'lrw_submitted','speaking_pending','all_submitted',
                  'under_review','reviewed','released','void')),
  -- server-authoritative timestamps (không tin đồng hồ client):
  lrw_started_at TIMESTAMPTZ,
  listening_started_at TIMESTAMPTZ, listening_submitted_at TIMESTAMPTZ,
  reading_started_at   TIMESTAMPTZ, reading_submitted_at   TIMESTAMPTZ,
  writing_started_at   TIMESTAMPTZ, writing_submitted_at   TIMESTAMPTZ,
  speaking_completed_at TIMESTAMPTZ,
  -- link bài làm (canonical vẫn ở bảng miền):
  listening_attempt_id UUID, reading_attempt_id UUID,
  essay_task1_id UUID, essay_task2_id UUID,
  speaking_session_ids JSONB DEFAULT '[]'::jsonb,   -- [p1,p2,p3]
  integrity     JSONB NOT NULL DEFAULT '{}'::jsonb, -- {blur_count,late_ms,resumes}
  sealed        BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- chống 2 sitting song song cùng user/đề (edge case §6):
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_sitting
  ON mock_exam_sittings (mock_exam_id, user_id)
  WHERE status NOT IN ('released','void');
```

### mig 147 — `mock_exam_reviews` (hồ sơ duyệt, nhân từ instructor_reviews)
```sql
CREATE TABLE IF NOT EXISTS mock_exam_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id    UUID NOT NULL UNIQUE REFERENCES mock_exam_sittings(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                  ('queued','claimed','edited','reviewed','released')),
  claimed_by    UUID, claimed_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
  ai_draft      JSONB DEFAULT '{}'::jsonb,  -- {listening:{raw,band},reading:{raw,band},writing:{t1,t2,band},speaking:{fc,lr,gra,p,band}}
  final_bands   JSONB DEFAULT '{}'::jsonb,  -- {listening,reading,writing,speaking,overall} — NGUỒN TRUTH
  examiner_comment_vi TEXT,
  per_skill_notes JSONB DEFAULT '{}'::jsonb,
  released_at TIMESTAMPTZ, released_by UUID, release_channel TEXT, -- 'in_app'|'email'|'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mock_reviews_queue
  ON mock_exam_reviews (status) WHERE status IN ('queued','claimed');
```

### mig 148 — cột `sitting_id` cho enforce sealed + bảng quy đổi band
```sql
ALTER TABLE reading_test_attempts   ADD COLUMN IF NOT EXISTS sitting_id UUID;
ALTER TABLE listening_test_attempts ADD COLUMN IF NOT EXISTS sitting_id UUID;
ALTER TABLE writing_essays          ADD COLUMN IF NOT EXISTS sitting_id UUID;
CREATE INDEX IF NOT EXISTS idx_reading_attempt_sitting   ON reading_test_attempts(sitting_id)   WHERE sitting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_attempt_sitting ON listening_test_attempts(sitting_id) WHERE sitting_id IS NOT NULL;
-- bảng raw→band để admin sửa được, không hardcode:
CREATE TABLE IF NOT EXISTS band_conversion_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill TEXT NOT NULL CHECK (skill IN ('listening','reading')),
  module TEXT NOT NULL DEFAULT 'academic',  -- reading: academic|general
  raw_min INT NOT NULL, raw_max INT NOT NULL, band NUMERIC(2,1) NOT NULL,
  UNIQUE(skill, module, raw_min, raw_max)
);
```
*(Speaking dùng `sessions` sẵn có — thêm cách nối sitting↔session bằng `speaking_session_ids` trên sitting; nếu cần enforce sealed phía sessions thì thêm `sessions.sitting_id` ở cùng migration.)*

### mig 149 (P2) — `email_outbox`
```sql
CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL, template TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INT NOT NULL DEFAULT 0, last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ
);
```

**Nguyên tắc bất biến:** bài làm ở bảng miền (attempts/essays/sessions = canonical); sitting chỉ **buộc + điều phối**; `final_bands` là truth kết quả, band AI chỉ là `ai_draft` có stamp.

---

## Phần 3 — Backend (theo phase, endpoint-by-endpoint)

### P1 — Orchestration + sealed

**`services/mock_exam_service.py`** (mới):
- `create_sitting(user_id, mock_exam_id)` — check `open_from/until`, cohort, unique-active-index; tạo row `registered`. Idempotent (trả sitting đang mở nếu có).
- `start_section(sitting_id, section)` — ghi `*_started_at` **server-side**; one-way (không cho quay lại section trước — pattern `showState`).
- `attach_attempt(sitting_id, section, attempt_id)` — set `listening_attempt_id`/... + set `attempt.sitting_id` (2 chiều: sitting→attempt để console load, attempt→sitting để enforce sealed).
- `submit_section` / `submit_lrw` — advance status máy trạng thái; khi `all_submitted` → gọi `mock_review_workflow.create_review(sitting_id)` (idempotent).
- `void_sitting`, `auto_submit_expired` (job): quá `open_until` mà chưa nộp → auto-submit phần đã autosave, gắn cờ `incomplete` trong `integrity`.

**`routers/mock_exams.py`** (`/api/mock-exams`):
| Route | Việc |
|---|---|
| `POST /{code}/sittings` | tạo/nối sitting (check khung giờ, cohort) |
| `GET /sittings/{id}` | trạng thái + section còn lại + thời gian còn lại (tính từ server timestamp) |
| `POST /sittings/{id}/sections/{section}/start` | ghi start server-side |
| `POST /sittings/{id}/submit-lrw` | nộp cả mạch |
| `GET /sittings/{id}/result` | **403 nếu chưa `released`**; nếu released → TRF payload |

**Sealed — sửa endpoint có sẵn (thêm nhánh, không phá luồng cũ):**
- `reading_student.py` submit (`~L1159`): `if attempt.sitting_id: s=get_sitting(); if s.sealed: persist nháp; return {received:true, sitting_status:s.status}`.
- `listening.py` submit (`~L6113`): y hệt.
- **Mọi GET review/result/PDF** cho attempt thuộc sitting sealed → 403 tới khi released (check server-side).
- Writing: khi tạo essay trong sitting → ép `grading_tier='instructor'` + set `sitting_id` + `hide_subbands=true`. Luồng `instructor_workflow` có sẵn lo phần "học sinh không thấy gì".
- Speaking: `sessions` tạo với cờ sitting; endpoint result trả 403 tới released (grading + Azure vẫn chạy ngầm làm nháp).

**`services/mock_review_workflow.py`** (mới, copy contract từ `instructor_workflow.py`):
- `create_review(sitting_id)` idempotent · `claim(review_id, admin_id)` atomic `UPDATE ... WHERE status='queued'` · `save_final_bands(...)` · `release(review_id, admin_id, channel)` → set `mock_exam_reviews.status='released'`, `sitting.status='released'`, stamp `released_by/at`, ghi audit.
- `assemble_ai_draft(sitting)` — gom nháp: reading/listening `band_estimate` + raw; writing essay bands (Gemini Pass 1); speaking FC/LR/GRA (Claude) + P (Azure). Chỉ đọc, không quyết.
- `compute_overall(final_bands)` — gọi thẳng `band_rounding.overall_from_criteria(L,R,W,S)` (hàm 4-arg có sẵn).

**`routers/admin_mock_exams.py`** + **`routers/admin_mock_reviews.py`** (`/admin/mock-exams`, `/admin/mock-reviews`): CRUD đề; queue (SLA countdown, cột integrity); claim/save/release; band table CRUD.

### P2 — Email outbox
`services/email_service.py` + provider (Resend/Postmark/SES). Gửi qua **outbox pattern** (không gọi API trong request duyệt): release ghi 1 row `email_outbox`; job `jobs/` quét pending, retry, log. Email **chỉ band + link đăng nhập** (single source, không nhét feedback).

### P3 — Sau-released
Mở lại review UI (hết sealed), đổ kết quả vào learner report; lỗi Writing/Speaking → `kp_evidence` (đã có store); thống kê phân phối band theo kỳ.

---

## Phần 4 — Frontend

### P1
1. **`pages/mock-exam.html` + `js/mock-exam-runner.js`** — vỏ điều phối mạch LRW:
   - Màn chuẩn bị (test loa bằng audio thử, quy chế) → **nhúng lại** `reading-exam.js` / listening player theo iframe/module + màn đệm 60s auto-advance → Writing 2 tab (word count, gợi ý 20'/40').
   - Timer **hiển thị** client nhưng đọc `started_at` server; hết giờ auto-submit (+30s grace, ghi `integrity.late_ms`).
   - Autosave 15s + on-blur (reading đã có PATCH `/answers` upsert; writing dùng draft có sẵn); resume đúng section/thời gian còn lại từ server.
   - Beacon `exam_blur`/`exam_focus` → `/api/analytics/events` (event mới) → job gộp vào `integrity.blur_count`.
   - Màn "ĐÃ THU BÀI" (giờ nộp + SLA + nút đặt lịch Speaking) thay cho màn điểm.
2. **Speaking**: tái dùng `test_full` mode; chỉ đổi kết thúc → màn "Đã thu bài Speaking" (không mở `full-test-result.html`).
3. **`pages/mock-result.html`** — TRF khi released: 4 band + overall + nhận xét giám khảo + (admin bật) link xem lại từng module. Nút xuất PDF.

### P1 — Admin console `pages/admin/mock-reviews/`
1 sitting = 4 tab: 🎧 Listening (bảng 40 câu, sửa verdict) · 📖 Reading (tương tự) · ✍️ Writing (**nhúng/link trang `admin_writing` theo essay_id** — không viết lại) · 🎙 Speaking (player 3 part + transcript + nháp FC/LR/GRA + Azure P). Nhập `final_bands` → overall auto. Viết `examiner_comment_vi`. RELEASE (chọn kênh).

---

## Phần 5 — Ma trận sealed (chốt chặn server-side)

| Module | Rò rỉ hiện tại | Chốt chặn |
|---|---|---|
| Reading submit | `{score,band,per_question}` (`reading_student.py:1159`) | sealed → `{received:true}`; grade+lưu nháp |
| Listening submit | `{score,band,...}` (`listening.py:6113`) | y hệt |
| Reading/Listening review GET | lộ answer key + explanation | 403 tới `released` |
| Writing | tier thường trả feedback | ép `instructor` + `hide_subbands` (luồng có sẵn) |
| Speaking result | feedback sau grading | 403 tới `released`; grading chạy ngầm |
| PDF/export | mở theo attempt/session | gate theo `sitting.status='released'` |

---

## Phần 6 — Content dependency (điều chỉnh theo thực tế)

| Kỹ năng | Trạng thái thực | Việc trước khi mạch chạy |
|---|---|---|
| **Listening** | ILR-LIS-001 **đã import** (draft, audio 1668s đã lên storage) — tốt hơn thiết kế nói | (1) **Publish** ILR-LIS-001; (2) soạn/nhập **thêm ≥1–2 đề** theo template 4-file + lo audio; (3) chưa có pipeline seed như reading → có thể viết `scripts/import_listening_fulltest.py` kiểu `reimport_wp5_reading.py` |
| **Reading** | 2 đề L3 Academic published, gradable | Nâng chuẩn giải cho phần xem-lại sau released (P3) |
| **Writing** | prompts sẵn | Chọn 1 T1 + 1 T2 cho mỗi đề |
| **Band table** | chưa có | Seed `band_conversion_tables` (L + R academic/general) |
| **Speaking** | topic set | Soạn `speaking_topic_set` cho mỗi đề |

---

## Phần 7 — Edge cases & integrity (đã có cơ chế)

- **Rớt mạng giữa Listening**: resume theo đồng hồ server, phần trôi coi như mất (đúng luật); sự cố diện rộng → admin `void` + cấp lượt mới (giữ audit).
- **Speaking upload fail part 2/3**: `speaking_pending`, retry chỉ part hỏng (session-per-part sẵn có).
- **Nộp trắng/bỏ giữa chừng**: quá `open_until` → job auto-submit phần đã autosave, cờ `incomplete`.
- **2 sitting song song**: unique partial index (Phần 2).
- **Chênh AI vs người**: mọi `ai_draft` vs `final_bands` được lưu → 1 điểm dữ liệu gold set người-vs-AI miễn phí (nối vào `gold_speaking`/`gold_writing` mig 144).

---

## Phần 8 — Lộ trình + DoD

| Phase | Nội dung | Ước lượng | Test bắt buộc (DoD) |
|---|---|---|---|
| **P1** | mig 145–148; `mock_exam_service` + `mock_review_workflow` (claim atomic, idempotent); sealed 4 module; runner LRW; speaking gắn sitting; console 4 tab + release; result in-app + PDF; kênh in-app + thủ công. Song song: publish + soạn 1 pack listening | 3–4 tuần | `pytest`: máy trạng thái sitting, atomic claim (2 concurrent), sealed trả `{received}` không lộ score, overall=`overall_from_criteria`, unique-active-index. `node --test`: runner auto-advance/timer/autosave |
| **P2** | mig 149 + `email_service` outbox + provider + template; mở kỳ theo cohort/khung giờ; SLA dashboard | 1–2 tuần | outbox idempotent + retry; email chỉ band+link |
| **P3** | mở xem-lại sau released; đổ kết quả vào learner report/`kp_evidence`; nhiều đề chống trùng; thống kê band | 2 tuần | gating released; kp_evidence ghi đúng |

**Chia patch (theo rule "1 issue = 1 patch"):** (a) migrations; (b) service orchestration; (c) sealed reading; (d) sealed listening; (e) sealed writing+speaking; (f) review workflow+admin API; (g) runner FE; (h) admin console FE; (i) result+PDF FE; (j) content publish/seed. Mỗi cái review độc lập.

---

## Phần 9 — Quyết định đã CHỐT (2026-07-11)

1. ✅ **Nguồn student = Cohort + khung giờ.** Mở kỳ theo `cohort_id` (có sẵn) + `open_from`/`open_until` trên `mock_exams`. Không làm access-code-riêng-mỗi-kỳ ở P1. → `create_sitting` check membership cohort + khung giờ; không cần bảng phát mã mới.
2. ✅ **Writing console = nhúng/link `admin_writing`.** Tab Writing của console mock link sang trang `admin_writing` có sẵn theo `essay_task1_id`/`essay_task2_id`. **Không** dựng lại UI chấm Writing. → giảm hẳn khối lượng FE console.
3. ⏳ **Email provider (P2) = Resend (tentative).** Chưa chốt cứng, quyết lúc bắt đầu P2. Outbox pattern (`email_service.py`) nên đổi provider sau rẻ. Không chặn P1.
4. ✅ **Listening P1 = publish ILR-LIS-001 ngay.** Publish đề đã import (audio sẵn trên storage) làm đề mẫu để P1 chạy end-to-end sớm; soạn thêm đề song song. → mốc P1 không bị chặn bởi content.
5. ✅ **Speaking timing = linh hoạt trong cửa sổ kỳ.** Thi Speaking trước/sau LRW đều được, miễn trong `open_until`. Không ép cùng cửa sổ LRW. → state machine sitting đơn giản, dễ xếp lịch giám khảo.

**Hệ quả cho P1:** không cần hạ tầng access-code mới; FE console bớt phần chấm Writing; content listening không chặn; máy trạng thái Speaking tách rời LRW (chỉ cần cả hai xong trước khi `create_review`).

---

*Ba điều chỉnh cốt lõi so với thiết kế gốc: (1) đổi hết `exam_*` → `mock_*` để tránh va chạm module MCQ đang chạy; (2) sitting là bảng cha, review 1:1 sitting, Writing tái dùng luồng instructor 1:1 essay; (3) Listening đã đi xa hơn "0 đề" — chỉ cần publish + thêm đề, không phải soạn từ 0.*

---

## Phần 10 — Trạng thái thi công (branch `feat/mock-test-4skill-p1`, 2026-07-11)

**Backend P1 nền tảng — ĐÃ CODE + test xanh (3791 pass, 0 fail ở CI-scope; 24 test mới cho mock).**

Đã có:
- **Migrations 145–148** (`mock_exams`, `mock_exam_sittings`, `mock_exam_reviews`, cột `sitting_id` trên 4 bảng miền + `band_conversion_tables`). RLS service-role-only, trigger `updated_at`, partial index, `uq_mock_sitting_active`. **Chưa apply** — chạy tay trong Supabase SQL editor (đúng convention repo).
- **`services/mock_exam_service.py`** — create_sitting (gate window + cohort, idempotent), start_section (một chiều, resume idempotent, auto-submit section trước), attach_attempt (2 chiều), submit_lrw, record_speaking, `_reconcile_terminal` (order-independent → all_submitted + create_review), void_sitting, admin CRUD, `is_sealed` (hook sealed), `section_time_remaining_seconds`.
- **`services/mock_review_workflow.py`** — clone contract instructor: create_review idempotent, claim atomic (`UPDATE … WHERE status='queued'`), release, save_final_bands (overall = `overall_from_criteria`, không tin client), release_results (**lift seal**: sitting → released + sealed=false).
- **Sealed enforcement** (surgical, 58 dòng/4 file): reading submit + review GET; listening submit + result GET + review GET (helper `_mock_sealed`); speaking grading response (`grading.py`) — chấm + lưu như thường, chỉ giấu điểm; writing **sealed-by-construction** qua tier `instructor` (không đụng endpoint).
- **Routers**: `mock_exams.py` (`/api/mock-exams`), `admin_mock_exams.py` (`/admin/mock-exams`), `admin_mock_reviews.py` (`/admin/mock-reviews`) — mount trong `main.py`.
- **Tests**: `tests/test_mock_exam_workflow.py` — 24 test (state machine, forward-only, order-independent finalize, atomic claim 2-thread, overall .25→.5, sealed flag, endpoint seal helper).

**Frontend P1 (LRW) — ĐÃ CODE (2026-07-11).** Mig 149 (`writing_submission` trên sitting) + endpoint `POST /sittings/{id}/writing` + `get_exam_content_for_sitting` (resolve reading-code/listening-uuid/writing-prompts cho runner). Speaking optional: exam không có `speaking_topic_set` → LRW finalize thẳng (mock chạy end-to-end không cần speaking wiring).
- `pages/mock-exam.html` + `js/mock-exam-runner.js` — orchestrator **status-driven**: prep → Listening/Reading **redirect** sang runner có sẵn (`?sitting_id=`) → buffer 60s auto-advance → Writing **native 2-tab** (word count, timer server, autosave localStorage) → submit-lrw → "đã thu bài".
- `js/mock-exam-hook.js` — bridge nhỏ nhúng vào reading-exam + listening-test-player (mỗi runner sửa 2 dòng): sau khi tạo attempt → `attach` (seal); submit sealed `{received}` → màn "đã thu bài" → quay lại orchestrator (`?done=`).
- `pages/mock-result.html` — TRF (403 tới released).
- `pages/admin/mock-reviews/` + `js/admin-mock-reviews.js` — console: queue → claim → 4 tab (L/R nháp AI, Writing text hoặc link `admin_writing`, Speaking session links) → nhập final band (overall server tính) → release.
- Test: backend 26 (mock) + suite CI-scope xanh (3794); frontend `node --test` **không phát sinh fail mới** (2 file đỏ còn lại = tailwind-ENOENT môi trường, đỏ cả trên cây sạch). SITE_OVERVIEW + token-sentinel đã cập nhật.

**Còn lại P1:**
1. **Apply migrations 145–149** trong Supabase (tay) + **seed `band_conversion_tables`**.
2. **Publish ILR-LIS-001** + tạo 1 row `mock_exams` (`MOCK-2026-08A`) trỏ listening/reading/writing prompts → chạy E2E thật.
3. **E2E verify trên dev server**: mạch LRW redirect + attach + sealed submit + admin release + result (chưa chạy browser trong session này).
4. **Speaking wiring** (P1.1): `POST /sessions` nhận `sitting_id` (để per-response grading seal) + `practice.js` test_full gắn sitting + gọi `record_speaking` lúc finalize. Backend đã sẵn (`record_speaking`, sealed grading).
5. **Writing→instructor-tier** (P1.1): promote `writing_submission` → `writing_essays` (tier instructor, AI Pass-1 draft) thay cho capture text.
6. Integrity events (`exam_blur/exam_focus`) → `/api/analytics/events` + gộp vào `integrity`.
