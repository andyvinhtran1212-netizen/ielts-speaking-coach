# Audit: Upload & quản lý file nội dung Reading + Listening

**Ngày:** 2026-07-17 · **Phạm vi:** mọi đường đưa nội dung vào hệ thống (admin UI, API, script offline), khả năng phân loại, flag từ người học, và mức sử dụng thực tế 60 ngày gần nhất (từ 2026-05-17, đo trên DB prod, chỉ đọc).

---

## 1. Tổng quan các chế độ upload

### 1.1 Reading — 4 chế độ nhập + quản lý file (TẤT CẢ đang sống)

| # | Chế độ | Entry point | Ghi vào | Sử dụng 60 ngày |
|---|--------|-------------|---------|-----------------|
| R1 | Import .md đơn (L1/L2/L3 YAML), dry-run → commit | `frontend/pages/admin/reading/content.html` + `POST /admin/reading/content/import` (`backend/routers/admin_reading.py:215`) | `reading_passages`, `reading_questions`, `reading_tests` | ✅ RẤT MẠNH — 242 passages (100 L1 + 100 L2 + 42 L3), 225 tạo trong tháng 7 |
| R2 | Import bundle prose (đề + lời giải, 2 file .md) | cùng trang + `POST /admin/reading/content/import-bundle` (`admin_reading.py:322`) | như trên | ✅ Đang dùng (34 reading_tests, 25 tạo tháng 7) |
| R3 | Script offline: `import_ilr_rdg_001.py`, `reimport_wp5_reading.py` | `backend/scripts/` | như trên (tái dùng cùng pipeline commit) | ✅ Commit gần nhất 12–13/7 |
| R4 | Upload ảnh diagram/flow-chart per câu hỏi | `POST /admin/reading/questions/{id}/upload-diagram-image` (`admin_reading.py:1060`) | bucket private `reading-images` + `payload.template` | ✅ Dùng ít — 4 ảnh (1 tháng 6, 3 tháng 7) |

Quản lý sau upload (đều LIVE): preview có đáp án, delete an toàn theo attempts (0 attempt = hard delete, >0 = archive), lock mật khẩu, share link ẩn danh có hạn, xóa passage L1/L2, reconcile orphan passage khi re-import.

**Hạn chế đo lường:** bảng reading không có cột provenance ghi "row này vào bằng đường nào" (UI đơn / bundle / script) — chỉ đo được tổng lượng, không tách theo chế độ.

### 1.2 Listening — 15 entry point: cái sống, cái ngủ đông, cái dở dang

**Đang sống, dùng mạnh:**

| # | Chế độ | Entry point | Sử dụng 60 ngày |
|---|--------|-------------|------------------|
| L1 | Import full-test 4 file (đề MD + giải MD + timings JSON + audio MP3) | `routers/listening.py:3163` | ✅ 1 đề pilot ILR-LIS-001 (08/6) + 2 bản archived |
| L2 | Import mini-test (cùng flow, flag `mini`) | như trên | ✅ 15 published (+17 archived — churn re-import cao) |
| L3 | Import skill-drill (CLI `scripts/import_skill_drills.py` + route UI) | `listening.py:3350` | ✅ NGUỒN CHÍNH — 66 drill published, dồn dập tháng 7 |
| L4 | CRUD exercise, patch metadata/status, audio assembly (full/section/assemble), audit engine | nhiều route | ✅ audit đã chạy cho 20/101 test, tất cả `passed` |
| L5 | Map image upload TAY (PNG/JPG/WebP) | `listening.py:4640` | ✅ 2 ảnh (đều manual) |

**Ngủ đông — không dùng ≥ ~2 tháng (mốc cuối cùng đều tháng 5):**

| # | Chế độ | Lần dùng cuối | Ghi chú |
|---|--------|---------------|---------|
| L6 | **Upload MP3 đơn** (`POST /admin/listening/upload`) | **20/05** — đúng 1 row toàn thời gian | UI còn sống nhưng gần như không ai dùng |
| L7 | **Upload MP3 bulk** (`/upload/bulk`, tối đa 20 file + manifest) | **CHƯA TỪNG DÙNG** (tổng source_type=upload_mp3 chỉ có 1 row của L6) | Ứng viên gỡ bỏ / đơn giản hóa |
| L8 | **AI render ElevenLabs** (`/render`, feature-flag `LISTENING_AI_RENDER_ENABLED`) | **20/05** — 4 row, trong đó 1 row draft "Untitled listening" nghi là placeholder render FAIL bỏ lại (orphan) | Tốn phí API; flag đang gate |
| L9 | **exercise_snippet** (4 row draft "Section 1..4", legacy) | **22/05** — tất cả draft từ đó | Rác legacy, ứng viên dọn |

**Dở dang — không dùng được:**

| # | Chế độ | Trạng thái |
|---|--------|-----------|
| L10 | **Audio cutter** (`/detect-silence` + `/cut-audio`, trang `audio-cutter.html`) | ⚠️ Code CHƯA HOÀN THIỆN (agent + comment sprint xác nhận) — chưa từng ghi dữ liệu |
| L11 | **Map image AI generate** (Imagen/Gemini, `/generate-map-image`) | ⚠️ **0 ảnh AI trong DB** — chưa từng dùng thành công (2 ảnh map hiện có đều manual). Route sống nhưng kết quả = 0 |

**Legacy còn mounted:** flow convert 2-file MD (`/admin/listening/convert`, trang `convert.html`) vẫn sống song song với import-fulltest; cùng ghi `source_type='test_section'` nên không tách được usage riêng từ DB. Cần quyết định giữ 1 trong 2.

---

## 2. Khả năng phân loại (taxonomy)

### Reading — chặt chẽ, có CHECK constraint ở DB (migration 086–087)
- `reading_tests.module`: `academic | general_training`; `status`: `draft|published|archived`; loại đề `metadata.test_type`: `mini|full`
- `reading_passages.library`: `l1_vocab | l2_skill | l3_test`; `difficulty_level`: foundation/intermediate/advanced; `topic_tags[]` (GIN index); `skill_focus` (8 giá trị)
- `reading_questions.question_type`: 15 dạng IELTS (whitelist parser); `skill_tag`: 8 kỹ năng nhận thức (bắt buộc, NOT NULL) — phân biệt đúng "dạng câu hỏi" vs "kỹ năng" (matching/completion là FORMAT, không phải skill)
- Validation 2 tầng: service (`content_import_service.py`) trước khi ghi + CHECK constraint ở DB

### Listening — đầy đủ ở content, LỎNG ở test_type
- `listening_content`: `accent_tag` (us/uk/au/ca/other), `cefr_level` (A2–C2), `ielts_section` (1–4), `topic_tags`, `is_premium`, license, **`source_type`** (upload_mp3/curated_external/ai_elevenlabs/test_section/exercise_snippet — chính là provenance đo được usage)
- `listening_exercises.exercise_type`: dictation/gist/true_false/mcq/mini_test
- ⚠️ **Gap:** `test_type` (full/mini/drill) nằm trong `metadata` JSONB của `listening_tests`, **không có cột thật, không có CHECK constraint** — 3 row full test hiện có `test_type = NULL` và phải hiểu ngầm là "full". Dễ vỡ khi code lọc theo type.

---

## 3. Flag từ người học — CÓ, hoạt động, nhưng chưa ai xử lý

Hệ thống `user_feedback` (migration 100, `backend/routers/feedback.py`, widget `frontend/js/feedback-widgets.js`):

| Khả năng | Reading | Listening |
|----------|---------|-----------|
| Rating 1–5 chất lượng đề sau khi xem review | ✅ | ✅ (+ rating riêng chất lượng AUDIO) |
| "⚑ Báo lỗi trong đề" (chọn loại lỗi: sai đáp án / lỗi audio / khó hiểu / khác + chọn số câu + ghi chú) | ✅ | ✅ |
| "⚑ Báo lỗi bài giải" per câu | ✅ | ✅ |
| Phạm vi | Full + mini test (kể cả người làm qua share-link ẩn danh) | Full + mini + **drill** (xác nhận bằng DB: có rating trên `ILR-LIS-DRL-*`; yêu cầu đăng nhập) |
| KHÔNG phủ | Bài practice L1/L2 (vocab/skill) | Exercise lẻ ngoài luồng test/drill review |

Admin triage: trang `pages/admin/feedback/` — filter theo skill/type/status/test, deep-link thẳng tới câu hỏi trong trang admin (`#q<n>`), mark resolved.

**Số liệu prod (toàn thời gian = 60 ngày qua):** 9 feedback — 6 rating listening drill, 1 report reading, 2 flag reading. **Cả 9 đang `status=new`, 0 resolved.**

🔴 **Cần xử lý ngay:** report ngày 30/06 trên đề **ILR-RDG-LSN-L09 câu 11** (type=report — người học báo lỗi trong đề) + 2 flag bài giải reading — chưa ai xem trong ~3 tuần.

---

## 4. Rủi ro quản lý file (orphan)

1. **Audio orphan (listening):** flow upload ghi Storage TRƯỚC, insert DB SAU (`listening.py:695`) — nếu insert fail, file MP3 nằm mồ côi trong bucket `listening-audio`, không có cleanup tự động.
2. **Placeholder render fail:** render ElevenLabs insert row trước, BackgroundTask fail → row draft `audio_storage_path=NULL` tồn tại vĩnh viễn. Nghi vấn thực tế: row "Untitled listening" (draft, 20/05).
3. **Map image orphan:** hard-delete exercise không cascade xóa ảnh trong `listening-images` (chỉ có best-effort xóa theo prefix khi hard-delete cả test).
4. **Reading L1 dùng Cloudinary URL dán tay** — không validate khi import, link chết không ai biết. (Diagram L3 thì an toàn: path atomic với row + có route delete.)
5. **Rác archive:** 17 mini + 2 full listening archived (đúng thiết kế soft-delete nhưng nên có lịch dọn).

---

## 5. Đề xuất (chờ quyết định)

1. **Triage 9 feedback đang `new`** — đặc biệt report ILR-RDG-LSN-L09 câu 11.
2. **Quyết định số phận 4 chế độ ngủ đông/dở dang:** MP3 đơn + bulk (1 lần dùng/0 lần), ElevenLabs render (tắt flag? giữ?), audio-cutter (hoàn thiện hay xóa trang), map-image AI generate (0 kết quả — sửa hay bỏ).
3. **Dọn rác:** 4 row `exercise_snippet` draft (22/05), row "Untitled listening" (20/05), cân nhắc dọn 19 test archived.
4. **Chốt 1 flow import listening MD:** convert (legacy) vs import-fulltest — đang song song, khó audit.
5. **Cứng hóa `test_type`:** thêm cột thật + CHECK (`full|mini|drill`) thay vì metadata JSONB, backfill 3 row NULL → `full`.
6. **Mở rộng flag người học** cho reading L1/L2 practice và listening exercise lẻ (hiện chỉ test/drill review có).
7. **Vá orphan:** đảo thứ tự DB-trước-Storage-sau hoặc thêm cleanup khi insert fail; cascade xóa map image khi xóa exercise.

---

## Phụ lục — thực thi 2026-07-17 (cùng ngày)

- **Đã gỡ 4 chế độ khỏi admin + backend** (quyết định của Andy): MP3 upload đơn/bulk/validate, ElevenLabs render UI, audio cutter, AI map-image generation. Route + trang + JS + test tương ứng đã xóa; **manual map upload/delete/signed-url giữ nguyên**; `services/listening_renderer.py` GIỮ vì audio-assembly narrator (mini/full import) vẫn gọi `render_via_elevenlabs`; `ELEVENLABS_API_KEY` giữ (assembly + vocab TTS).
- **Triage 9 feedback:** 6 rating (không cần hành động), 3 phản ánh nội dung → 2 lỗi THẬT đã soạn fix: L01 q2 answer key `(small) workshops`→`workshops` (+alt), L09 q11 reword "Name ONE type..." để khớp giới hạn 3 từ. Script: `backend/scripts/oneoff_fix_flagged_content_and_resolve_feedback.py` (admin chạy tay — classifier chặn ghi DB prod từ agent).
- **Rác archived:** 14/19 test archived có attempts → giữ; 5 test 0-attempt (LSN-L06/07/11/12/13) + draft render "Untitled listening" → script `backend/scripts/oneoff_cleanup_archived_listening_junk.py` (dry-run mặc định, `--commit` để xóa).
