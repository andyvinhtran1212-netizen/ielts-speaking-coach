# Spec — Task 1 verified "answer key" (image → static facts) for consistent grading

Status: **proposed / MVP** · Author: handoff for implementation · Related: PR #670
(stale-image fallback + queue badge), `docs/WRITING_IMAGE_MIGRATION.md`.

## 1. Mục tiêu

Với **Task 1 Academic**, việc chấm hiện đọc lại hình bằng vision mỗi lần chấm →
nhiễu, có thể lệch số liệu giữa các lần, và sập về text-only khi hình lỗi. Ta
muốn một **"đáp án chuẩn" (answer key) tĩnh, đã được admin duyệt**, sinh ra **một
lần** từ hình, dùng để **neo** việc chấm Task Achievement.

**Nguyên tắc an toàn (bất biến):**
- **Augment, không replace.** Vẫn gửi hình cho grader; facts là *neo ground-truth*,
  không phải nguồn duy nhất.
- **Human-in-the-loop bắt buộc.** Facts do AI trích xuất **chỉ** được dùng khi
  admin đã **duyệt** (`reviewed=true`). Chưa duyệt → chấm như hiện tại (image-only).
  Điều này chặn "sai một lần → sai vĩnh viễn cho mọi bài".
- **Snapshot lúc nộp.** Facts được chốt vào essay khi submit (giống
  `prompt_image_url`) → sửa đề về sau không đổi điểm bài cũ; mất hình vẫn chấm được.

## 2. Non-goals (MVP)

- Không bỏ vision / không chuyển text-only (để pha sau khi có dữ liệu tin cậy).
- Không xử lý Task 1 General / Task 2 (không có hình dữ liệu).
- Admin-created essay (không qua assignment/prompt) → **image-only**, không facts
  (không có prompt nguồn để lấy answer key). Chỉ library/assignment prompt có facts.
- Không auto-approve. Không dùng facts chưa duyệt để chấm.

## 3. Data model (migration 136)

`migrations/136_writing_prompt_image_analysis.sql`:

```sql
ALTER TABLE writing_prompts
  ADD COLUMN IF NOT EXISTS prompt_image_analysis            JSONB,
  ADD COLUMN IF NOT EXISTS prompt_image_analysis_status     TEXT
      CHECK (prompt_image_analysis_status IN ('pending','ready','failed')),
  ADD COLUMN IF NOT EXISTS prompt_image_analysis_reviewed   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prompt_image_analysis_model      TEXT,
  ADD COLUMN IF NOT EXISTS prompt_image_analysis_public_id  TEXT,   -- invalidation key
  ADD COLUMN IF NOT EXISTS prompt_image_analysis_error      TEXT,
  ADD COLUMN IF NOT EXISTS prompt_image_analysis_at         TIMESTAMPTZ;

-- essay snapshot (mirrors prompt_image_url snapshot, mig 033)
ALTER TABLE writing_essays
  ADD COLUMN IF NOT EXISTS prompt_image_analysis JSONB;
```

`prompt_image_analysis_public_id` records **which image** the analysis came from;
when the prompt image is replaced (new `prompt_image_public_id`), the two differ
→ re-analysis is triggered and `reviewed` resets to false.

### Analysis JSON shape (validated by a Pydantic model)

```jsonc
{
  "chart_type": "line|bar|pie|table|map|process|mixed",
  "overview": "1–2 câu tổng quan mà bài band-9 phải nêu.",
  "key_features": [                 // các điểm salient bắt buộc đề cập
    "Xu hướng/so sánh 1", "..."     // 3–6 mục
  ],
  "notable_data": [                 // mốc số liệu để kiểm tra độ chính xác
    { "label": "Năm 2000, X", "value": "45", "unit": "%" }
  ],
  "axes_or_categories": "Mô tả trục/đơn vị/danh mục (optional).",
  "grading_note": "Cảnh báo cho grader (vd. 'map — quan hệ không gian, hình vẫn là nguồn chính')."
}
```

Với `map`/`process`, `notable_data` có thể rỗng; `grading_note` nhắc grader dựa
nhiều hơn vào hình. Đây là lý do **không bỏ hình**.

## 4. Extraction service

`services/writing_prompt_analysis.py`:

```
analyze_prompt_image(image_bytes, task_type, prompt_text, *, model=None) -> AnalysisResult
```

- Chỉ chạy cho `task1_academic`.
- Gọi Gemini vision (mặc định `settings.WRITING_ANALYSIS_MODEL='gemini-2.5-pro'`),
  system prompt yêu cầu trả đúng schema §3 (JSON-only). Tái dùng
  `GeminiWritingGrader._call_with_retry(..., image=(bytes,mime), parse_schema=...)`
  đã có sẵn — không viết lại vòng retry/parse.
- Validate bằng Pydantic model `PromptImageAnalysis` (models/writing_feedback.py).
- Never-raise ở tầng gọi nền: lỗi → `status='failed'` + `error` message.

Chi phí: **1 vision call/đề** (một lần + khi thay hình). Không đáng kể so với
tiết kiệm token multimodal mỗi lần chấm.

## 5. Trigger (khi nào chạy extraction)

Vì upload ảnh **tách rời** create/PATCH (admin upload → stash `url`+`public_id`
→ gửi ở create/PATCH kế), trigger đặt ở **create_prompt / update_prompt** khi:

- prompt là `task1_academic`, VÀ
- có `prompt_image_url`, VÀ
- `prompt_image_public_id` != `prompt_image_analysis_public_id` (ảnh mới/đổi).

Luồng:
1. Ghi prompt row như hiện tại + set `analysis_status='pending'`, `reviewed=false`.
2. `BackgroundTasks.add_task(_bg_analyze_prompt, prompt_id)` — không chặn response.
3. `_bg_analyze_prompt`: load ảnh (public URL) → `analyze_prompt_image` → lưu
   `prompt_image_analysis`, `status='ready'`, `analysis_public_id=<current>`,
   `model`, `at`. Lỗi → `status='failed'` + `error`.
4. Endpoint thủ công **POST `/admin/writing/prompts/{id}/reanalyze`** để chạy lại
   (recovery cho `failed`, hoặc admin muốn làm mới). BackgroundTask không bền qua
   restart → nút này là đường phục hồi (đủ cho MVP; nâng lên writing_jobs sau nếu cần).

## 6. Admin review UI (`pages/admin/writing/prompts.html`)

Trong panel ảnh của prompt task1_academic:
- Badge trạng thái: `⏳ Đang phân tích` / `✓ Đã sẵn sàng (chờ duyệt)` / `✅ Đã duyệt` / `⚠ Lỗi`.
- Hiển thị facts (overview, key_features, notable_data) ở dạng **editable form**.
- Nút **"Lưu & Duyệt"** → PATCH facts + `reviewed=true`. Nút **"Phân tích lại"**.
- Chỉ khi `reviewed=true` thì facts mới được dùng lúc chấm (gate ở §7).

Endpoint duyệt: **PATCH `/admin/writing/prompts/{id}/analysis`**
`{ analysis: {...}, reviewed: true }` — validate lại bằng `PromptImageAnalysis`.

## 7. Grader integration

`models/writing_feedback.py` — `GraderConfig`:
```python
prompt_image_facts: Optional[dict] = None   # verified answer key (reviewed only)
```

`services/essay_service.py::_bg_grade_essay` — khi build config, resolve facts đã
snapshot trên essay; nếu essay chưa có (bài cũ) thì fallback qua
`assignment→prompt` **chỉ khi** `analysis_status='ready' AND reviewed=true` (tái
dùng đúng pattern `current_prompt_image_for_essay`, thêm hàm chị em
`reviewed_prompt_facts_for_essay`).

`gemini_writing_grader._build_user_prompt` — chèn TRƯỚC "## Bài viết":
```
## Dữ kiện biểu đồ (đã xác minh — dùng làm chuẩn chấm Task Achievement)
<overview / key_features / notable_data đã format>
Hướng dẫn: coi đây là mô tả ĐÚNG của biểu đồ. Đánh giá độ chính xác + độ đầy đủ
của bài viết SO VỚI các dữ kiện này. Nếu là map/process, kết hợp với hình.
```
Hình **vẫn** được gửi kèm (image=multimodal như hiện tại). Facts là neo, không thay.

**Gate quan trọng:** facts chỉ vào prompt khi đã duyệt. Chưa duyệt → không chèn →
hành vi y hệt hiện tại (an toàn, không hồi quy).

## 8. Snapshot lúc nộp (determinism)

- `essay_service.create_essay_row_only`: thêm `prompt_image_analysis` vào
  `_OPTIONAL_ESSAY_FIELDS` (đã có cơ chế copy optional fields).
- `writing_student.py` (submit) + admin create: snapshot
  `prompt.prompt_image_analysis` **chỉ khi** prompt `reviewed=true` (đúng lúc
  snapshot `prompt_image_url`). Mirror hoàn toàn cách hình đang được snapshot.
- Regrade: đọc snapshot trên essay; nếu null → fallback prompt (như §7). Đổi facts
  ở đề sau này KHÔNG đổi điểm bài đã nộp trừ khi regrade → re-snapshot (đúng nguyên
  tắc canonical-truth, không sửa lịch sử).

## 9. Files touched (checklist triển khai)

Backend:
- `migrations/136_writing_prompt_image_analysis.sql` — cột mới (prompts + essays).
- `models/writing_feedback.py` — `PromptImageAnalysis` model + `GraderConfig.prompt_image_facts`.
- `services/writing_prompt_analysis.py` — extraction (mới).
- `services/gemini_writing_grader.py` — chèn facts block vào `_build_user_prompt`.
- `services/essay_service.py` — resolve facts vào config `_bg_grade_essay`;
  `reviewed_prompt_facts_for_essay()`; snapshot field.
- `routers/admin_writing_prompts.py` — trigger BG analyze ở create/PATCH;
  `POST /{id}/reanalyze`; `PATCH /{id}/analysis` (duyệt).
- `routers/writing_student.py` + admin create path — snapshot facts.
- `config.py` — `WRITING_ANALYSIS_MODEL`, `WRITING_TASK1_FACTS_ENABLED` (feature flag).

Frontend:
- `pages/admin/writing/prompts.html` + js — panel facts (view/edit/duyệt/re-analyze).
- (không đổi grade.html — hình vẫn hiển thị như PR #670.)

## 10. Testing (DoD)

- `test_writing_prompt_analysis.py` — schema validate; extraction gọi grader với
  image; never-raise → status failed.
- `test_gemini_writing_grader` — `_build_user_prompt` chèn facts khi có, KHÔNG chèn
  khi None; hình vẫn gửi kèm.
- `test_essay_service` — resolve facts chỉ khi reviewed; snapshot field; fallback.
- `test_admin_writing_prompts` — trigger set `pending` khi ảnh đổi; PATCH analysis
  set reviewed; reanalyze endpoint.
- Frontend: `prompts` test — panel render theo status, gate "Duyệt".
- Feature flag OFF → mọi hành vi = hiện tại (regression guard).

## 11. Rollout

1. **Phase A** — migration + model + extraction + admin review UI (flag OFF).
   Backfill: chạy analyze cho các prompt task1_academic đang có ảnh; admin duyệt dần.
2. **Phase B** — bật flag: grader dùng facts đã duyệt (vẫn kèm hình). Snapshot ON.
3. **Phase C (sau, tùy dữ liệu)** — cân nhắc text-only cho chart thuần; map/process
   giữ vision. Ngoài scope MVP.

## 12. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Trích xuất sai → bias hệ thống | Bắt buộc admin duyệt; chưa duyệt không dùng |
| Map/process khó số hoá | `grading_note` + giữ hình làm nguồn chính |
| BG task chết khi restart | status `pending`+`failed` + nút re-analyze thủ công |
| Facts lệch khi đổi hình | invalidation qua `analysis_public_id`; reset reviewed |
| Đổi facts đổi điểm lịch sử | snapshot lúc nộp; chỉ regrade mới re-snapshot |
| Hồi quy khi lỗi | feature flag; gate reviewed; hình vẫn multimodal |

## 13. Open questions (cần chốt trước khi code)

1. **Model trích xuất:** `gemini-2.5-pro` (chính xác, đắt, 1 lần) — OK chứ?
2. **Answer-key style:** thiên "key_features cho examiner" (đề xuất) hay JSON số
   liệu thuần? (Đề xuất: cả hai — features + notable_data.)
3. **Backfill:** auto-run analyze cho toàn bộ prompt task1_academic hiện có rồi
   admin duyệt, hay chỉ áp cho prompt mới từ nay?
4. **Có snapshot vào essay ngay Phase B** (đề xuất) hay để resolve-at-grade-time
   cho gọn rồi thêm snapshot sau?
