# PHASE_B_V3_PLAN.md

## 1. Scope confirmation
**Mục tiêu:** Xây dựng Phase B của Vocabulary Module (Personal Vocab Bank MVP). Trọng tâm là dùng AI trích xuất tự động từ vựng hay từ bài nói của user (transcript) và lưu vào sổ tay cá nhân. Dogfood nội bộ trước khi release.

**In-scope:**
- Feature flag (Global qua Env Vars + Per-user qua DB).
- Trích xuất từ vựng bằng Claude Haiku chạy ngầm (Background Task).
- Lưu trữ vào bảng `user_vocabulary`.
- Hệ thống 6-guards bảo vệ dữ liệu (Precision > Recall, HARD SKIP).
- Các API quản lý Vocab Bank (List, Detail, Manual Add, Archive).
- Giao diện `my-vocabulary.html` đơn giản tích hợp nút "Report incorrect".
- Rollout plan chặt chẽ và manual review gate (100 responses).

**Out-of-scope / Non-goals:**
- Không mở rộng sang Phase C (spaced repetition) hay Phase D (Quiz).
- Không backfill cho các responses cũ trong quá khứ.
- Không dùng NLP phức tạp (chỉ dùng rule-based cơ bản).
- Không làm ảnh hưởng hay làm chậm quá trình Grading hiện tại.

---

## 2. Current repo preflight
Qua quá trình kiểm tra repo:
- **Current grading flow:** Nằm tại `backend/routers/grading.py`. Gọi Whisper STT -> Claude Grader đồng bộ (chạy mất 15-30s) -> Lưu `responses` -> Lưu `grammar_recommendations`.
- **Current Claude grading output:** Chứa `grammar_issues`, `vocabulary_issues`, v.v. nhưng KHÔNG xuất các từ vựng hay dưới dạng structured data theo đúng 3 nhóm (used_well, needs_review, upgrade_suggested).
- **Current feature flag reality:** Per-user flag sẽ được lưu trong JSON column `users.feature_flags`. Các biến môi trường bắt buộc phải có theo v3:
  - `VOCAB_ANALYSIS_ENABLED`
  - `VOCAB_ANALYSIS_MODEL`
  - `VOCAB_MIN_TRANSCRIPT_WORDS`
  - `VOCAB_MAX_PER_CATEGORY`
  - `VOCAB_BANK_FEATURE_FLAG_ENABLED`
- **Current analytics reality:** Đã có bảng `analytics_events`. Sẽ bổ sung đầy đủ tập event cho Phase B.
- **DB shape:** `responses` table có `transcript`. Sẽ cần trích xuất từ cột này.
- **Missing prerequisites:** Cần bảng `user_vocabulary`, JSON column `users.feature_flags`, và cơ chế `BackgroundTasks` trong `grading.py`.

---

## 3. Data model plan
**Migration Proposal:** `019_user_vocabulary.sql`
- **Fields:**
  - `id` (uuid, pk)
  - `user_id` (uuid, fk -> auth.users)
  - `session_id` (uuid, fk -> sessions, nullable - null nếu thêm tay)
  - `response_id` (uuid, fk -> responses, nullable)
  - `headword` (varchar, bắt buộc)
  - `context_sentence` (text)
  - `definition_vi` (text)
  - `category` (varchar: 'topic', 'idiom', 'phrasal_verb', 'collocation')
  - `source_type` (varchar: 'used_well', 'needs_review', 'upgrade_suggested', 'manual')
  - `reason` (varchar, <15 words — lý do Claude extract)
  - `original_word` (varchar, nullable — từ gốc user dùng, chỉ áp dụng cho upgrade_suggested)
  - `mastery_status` (varchar: 'learning', 'mastered' - mặc định 'learning')
  - `is_archived` (boolean - mặc định false)
  - `created_at` (timestamptz)
- **Indexes:** 
  - `CREATE INDEX idx_user_vocab_user ON user_vocabulary(user_id);`
  - `CREATE UNIQUE INDEX idx_user_vocab_unique ON user_vocabulary(user_id, lower(headword)) WHERE not is_archived;`
- **RLS Requirements:** 
  - `ALTER TABLE user_vocabulary ENABLE ROW LEVEL SECURITY;`
  - Policy: `SELECT, INSERT, UPDATE, DELETE` với điều kiện `auth.uid() = user_id`.
- **Archive Strategy:** Dùng Soft Delete (`is_archived = true`). Không Hard delete.

---

## 4. Claude / extraction architecture
- **Kiến trúc:** Khởi tạo `backend/services/vocab_extractor.py`.
- **Model:** Cấu hình qua biến môi trường `VOCAB_ANALYSIS_MODEL` (mặc định `claude-haiku-4-5-20251001`).
- **Prompt extension strategy:** Bơm `transcript` vào prompt. Tham chiếu trực tiếp nội dung prompt tại file `VOCAB_PROMPTS_MVP.md`. Yêu cầu Claude trả về đúng 3 nhóm: `used_well`, `needs_review`, `upgrade_suggested` (tối đa 3 items mỗi nhóm).
- **Cost policy:** Skip hoàn toàn nếu `word_count < 15` words (dùng env `VOCAB_MIN_TRANSCRIPT_WORDS`).
- **Integration (Failure Isolation):** Gọi qua `fastapi.BackgroundTasks` ở cuối hàm `grade_response_endpoint`. Không ảnh hưởng đến grading result. 

---

## 5. Guard system plan (Conservative: Precision > Recall)
Nguyên tắc: Thà bỏ sót từ hay còn hơn trích xuất sai. Các guard kiểm tra chéo sau khi Claude trả kết quả.

1. **Word in sentence guard:** `headword.lower() in context_sentence.lower()`. 
   - **Action:** HARD SKIP.
2. **Sentence in transcript guard:** `context_sentence.strip() in raw_transcript`. 
   - **Action:** HARD SKIP.
3. **Not proper noun guard:** Bỏ qua nếu từ viết hoa chữ cái đầu nhưng không nằm ở đầu câu.
   - **Action:** HARD SKIP.
4. **Contradiction check:** Chặn định nghĩa sai ngữ cảnh (MVP chủ yếu dựa vào prompt).
   - **Action:** HARD SKIP.
5. **Band-level whitelist upgrade pairs:** Dùng danh sách `backend/data/band_upgrade_pairs.json` (~200 cặp `{from, to}` đã verified). Nếu Claude gợi ý `upgrade_suggested` mà cặp từ không nằm trong whitelist này ->
   - **Action:** HARD SKIP. (KHÔNG dùng A1-A2 blacklist tự chế).
6. **Same-lemma / Levenshtein distance ≤ 2:** Chặn các từ mới có khoảng cách Levenshtein ≤ 2 so với gốc từ đã có trong bank của user (tránh lưu trùng "sustainable" và "sustainability").
   - **Action:** HARD SKIP (bỏ qua im lặng, KHÔNG log admin review ở bước này).

---

## 6. API plan
Tất cả đặt dưới prefix `/api/vocabulary/bank` (yêu cầu Auth).

1. **`GET /` (List)**
   - Trả về danh sách (lọc `is_archived=false`). Param `?status=learning`.
2. **`GET /stats`**
   - Response: `{ "total": 120, "learning": 100, "mastered": 20 }`
3. **`GET /{id}` (Detail)**
   - Trả về chi tiết 1 từ (kèm `source_type`, `reason`, `original_word`).
4. **`POST /` (Manual Add)**
   - Dành cho user tự thêm từ. `source_type` tự động gán là `manual`.
5. **`PATCH /{id}` (Update Status)**
   - Payload: `{ "mastery_status": "mastered" }`
6. **`DELETE /{id}` (Archive)**
   - Đánh dấu `is_archived = true`.

---

## 7. Frontend plan
- **Trang chủ Vocab Bank:** Tạo `frontend/pages/my-vocabulary.html`.
- **Logic File:** `frontend/js/my-vocabulary.js`.
- **Giao diện:** 
  - Danh sách từ hiển thị dưới dạng card, filter theo `source_type` và `status`.
  - Phân rõ UI cho từ dùng tốt (`used_well`), từ cần cải thiện (`needs_review`), và từ nâng cấp (`upgrade_suggested` hiển thị thêm `original_word`).
  - **Bắt buộc:** Có UI "Report incorrect" trên mỗi vocab card để đo False Positive rate từ người dùng.
- **Integration Flow:** Ở màn hình Practice Result (`result.html`), hiện thông báo "✨ X words analyzed" nếu analysis chạy xong.
- **Feature Flag UI:** Kiểm tra `users.feature_flags`. Nếu cờ tắt, ẩn hoàn toàn tab/menu Vocab Bank.

---

## 8. Dogfood / rollout plan
Rollout theo đúng tuần tự v3 (không gộp chung):
1. **1 Admin self-test** (Developer/QA).
2. **3 Admins** thử nghiệm chéo.
3. **5 Beta users** (Người dùng thân thiết được chọn).
4. **Gate B check:** Tạm dừng để review metrics (FP rate, latency, bugs).
5. **10% Random rollout:** Mở ngẫu nhiên cho một tập người dùng.
6. **100% Global rollout.**

---

## 9. Analytics and monitoring plan
**Events (Lưu bảng `analytics_events`):**
- Bắt buộc cập nhật event `practice_response_graded`: Thêm property `has_vocab_analysis` (boolean).
- `vocab_bank_viewed` (props: `source`: 'dashboard' | 'practice' | 'direct').
- `vocab_bank_entry_clicked` (props: `vocab_id`, `status`).
- `vocab_bank_entry_reviewed` (props: `vocab_id`, `mastery_before`, `mastery_after`).
- `vocab_fp_reported` (props: `vocab_id`, `reason`). Đây là **GATE-CRITICAL event** để tính FP rate.

**Monitoring Dashboard & Alerts:**
- **Guard Trigger Breakdown:** Thống kê xem guard nào (1 đến 6) đang reject nhiều nhất.
- **Token Cost Monitoring:** Tích hợp cùng `ai_usage_logger.py` để giám sát chi phí tách riêng cho model Haiku Vocab.
- **Alert Mechanism:** Gửi cảnh báo (email/webhook) nếu Background Task error spike > 5% hoặc FP Report spike đột biến.

---

## 10. Step-by-step execution breakdown
1. **Migration & Schema**
   - *File:* `019_user_vocabulary.sql`. Tạo bảng `user_vocabulary`, thêm cột `feature_flags` (JSON) vào bảng `users`. Xây dựng file rollback (DDL rollback script).
2. **Prompt & Extractor**
   - *File:* `backend/services/vocab_extractor.py`. Tham chiếu prompt từ `VOCAB_PROMPTS_MVP.md`. Xử lý 3 mảng category kết quả.
3. **Guard System & Unit Tests**
   - *File:* `backend/services/vocab_extractor.py` và `backend/tests/test_vocab_guards.py`.
   - *Mục tiêu:* Viết 6 test cases riêng biệt, tối thiểu mỗi guard 1 test case pass 100%.
4. **Integration & Persistence**
   - *File:* `backend/routers/grading.py`. Gọi qua `BackgroundTasks`, kiểm tra điều kiện `VOCAB_MIN_TRANSCRIPT_WORDS`. Update `practice_response_graded` event.
5. **API Endpoints**
   - *File:* `backend/routers/vocabulary_bank.py`.
6. **Frontend Pages & FP Report UI**
   - *File:* `my-vocabulary.html`, `my-vocabulary.js`. Tích hợp nút "Report incorrect".
7. **Dogfood & Monitoring**
   - Chạy Rollout Sequence từng bước. Theo dõi breakdown dashboard.

---

## 11. Acceptance criteria
- [ ] **RLS:** Test user A không thể truy cập từ vựng của user B.
- [ ] **Unit Tests:** 6 test cases cho 6 guards pass 100%.
- [ ] **Data Quality Gate:** Tỷ lệ FP (qua `vocab_fp_reported` và manual review 100 rows) < 10%.
- [ ] **Performance:** Main grading flow latency không đổi (Background Tasks hoạt động chuẩn).
- [ ] **Feature flag:** Env vars và `users.feature_flags` vận hành đúng logic ẩn/hiện UI.
- [ ] **Code Audit:** 0 critical/high findings.

---

## 12. Risks, Mitigations & Rollback Plan
- **False Positives (Bịa từ/Ảo giác):** Khống chế bởi 6 Hard Skip guards (đặc biệt Guard 2 chặn text không có trong transcript) và whitelist `band_upgrade_pairs.json`.
- **Synonym-swap nonsense:** Khắc phục bằng Guard 5 (chỉ cho phép cặp upgrade đã được verified thủ công).
- **Trùng lặp gốc từ:** Guard 6 (Levenshtein ≤ 2) chặn sinh rác dữ liệu.
- **Rollback Plan:** 
  - *Mềm:* Set `VOCAB_ANALYSIS_ENABLED=false` tắt tính năng ngay lập tức toàn cục. 
  - *Cứng:* Chạy DDL rollback script gỡ bảng `user_vocabulary` và các cột liên quan.
