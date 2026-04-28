# PHASE_D_WAVE_2_PLAN.md

*Reference: VOCAB_PLAN_V3.md, PHASE_B_V3_PLAN.md, PHASE_D_V3_PLAN.md (Wave 1)*

## 1. Scope confirmation
**Mục tiêu:** Phát triển Phase D Wave 2: Flashcard system với thuật toán Spaced Repetition (SRS) đơn giản. Giúp user tăng cường retention từ vựng cá nhân, chi phí rẻ, tích hợp mượt mà với Vocab Bank từ Phase B.

**In-scope:**
- Flashcard system (4 loại stacks: All vocab, Recent, Needs review, Manual).
- SRS algorithm đơn giản (Simplified SM-2, 4 mức rate).
- Trải nghiệm học thẻ (flip, self-rate, progress summary).
- Tích hợp UI trực tiếp vào Dashboard, Exercises Hub và My Vocabulary.
- Hạ tầng test tự động, RLS test, và dogfood nghiêm ngặt.

**Out-of-scope / Defer:**
- D3 (Speak-with-target) — Defer sang Phase E.
- Chế độ Audio pronunciation, Image flashcards.
- Edit thẻ thủ công, Heatmap analytics, Streak tracking.
- Test đa chiều (EN→VI, Multiple choice).
- Export/import format của Anki.
- Tuỳ chỉnh tham số SRS theo ý người dùng.

---

## 2. Dependency check Phase B + Wave 1
- **Dữ liệu chuẩn bị:** Vocab Bank của user cần tối thiểu 10 entries. Nếu empty, app phải handle gracefully (hiện empty state friendly nhắc user thực hành Speaking để tự động extract).
- **Sự ổn định của Core:** Cấu trúc `user_vocabulary` phải đang hoạt động ổn định trên production.
- **Wave 1 (D1 Fill-blank):** Hoạt động tốt và không có regression khi triển khai thêm Wave 2.

---

## 3. Data model plan
Mỗi file migration BẮT BUỘC có comment `-- ROLLBACK SCRIPT (commented):` ở cuối file. RLS UPDATE phải bao gồm `USING` và `WITH CHECK`.

### Auto-stack design decision
- 3 auto-stacks (`all_vocab`, `recent`, `needs_review`) là virtual, generated on-the-fly.
- Frontend list endpoint trả về 3 entries với id format `"auto:<type>"` + dynamic count.
- KHÔNG persist vào bảng `flashcard_stacks` hay `flashcard_cards`.
- API `GET /api/flashcards/stacks/{id}/cards` xử lý cả 2 case:
  - id starts with `"auto:"` → query `user_vocabulary` với filter tương ứng.
  - id là UUID → query `flashcard_cards` table (manual stacks).
- **SRS reviews track per `vocabulary_id`, KHÔNG per stack:**
  - 1 vocabulary có 1 review record duy nhất trong `flashcard_reviews`.
  - User học cùng từ qua nhiều stacks → share SRS progress để tránh duplicate state.

### `025_flashcard_stacks.sql`
- **Fields:** `id` (uuid, pk), `user_id` (uuid, fk), `name` (varchar), `type` (enum: 'manual'), `filter_config` (jsonb, nullable), `created_at` (timestamptz). (Lưu ý chỉ lưu persisted stack 'manual').
- **RLS:** User-owned. Policy SELECT/INSERT/UPDATE/DELETE sử dụng `USING (auth.uid() = user_id)` và `WITH CHECK (auth.uid() = user_id)`.
- **Index:** `(user_id, created_at DESC)`.

### `026_flashcard_cards.sql`
- **Mục đích:** Link giữa `flashcard_stacks` (type=manual) và `user_vocabulary`.
- **Fields:** `id` (uuid, pk), `stack_id` (uuid, fk -> flashcard_stacks), `vocabulary_id` (uuid, fk -> user_vocabulary), `added_at` (timestamptz).
- **RLS:** Kiểm tra thông qua quyền sở hữu của `stack_id`.
- **Constraints:** `UNIQUE(stack_id, vocabulary_id)`.

### `027_flashcard_reviews.sql`
- **Mục đích:** Lưu trữ trạng thái SRS riêng lẻ cho mỗi thẻ từ.
- **Fields:** 
  - `id` (uuid, pk), `user_id` (uuid, fk), `vocabulary_id` (uuid, fk -> user_vocabulary).
  - `last_reviewed_at` (timestamptz), `next_review_at` (timestamptz).
  - `ease_factor` (float, default 2.5), `interval_days` (int, default 1).
  - `review_count` (int, default 0), `lapse_count` (int, default 0).
- **RLS:** User-owned. Đầy đủ `USING` và `WITH CHECK`.
- **Index:** `(user_id, next_review_at)` để optimize query queue hàng ngày.
- **Phụ:** Cùng file, thêm bảng `flashcard_review_log` (append-only) cho rate-limit
  counting — không thể tái dùng `vocabulary_exercise_attempts` vì CHECK
  `exercise_type IN ('D1','D3')` và FK tới `vocabulary_exercises`.

### `028_user_vocab_topic.sql` *(thêm trong quá trình Step 3)*
- **Mục đích:** Cho phép filter Manual Stack theo topic mà không phải JOIN
  `sessions` mỗi lần — `user_vocabulary` ban đầu thiếu cột `topic`.
- **Schema:** `ALTER TABLE user_vocabulary ADD COLUMN topic VARCHAR(100)`.
- **Backfill:** UPDATE từ `sessions.topic` cho mọi row có `session_id`.
- **Index:** partial `(user_id, topic) WHERE topic IS NOT NULL`.
- **Forward-populate:** `routers/grading.py::_run_vocab_extraction` lookup
  `sessions.topic` 1 lần và set vào mỗi row insert mới.

---

## 4. SRS Algorithm
Sử dụng thuật toán SM-2 tối giản với fixed intervals cứng để bắt đầu.

```python
# backend/services/srs.py
from datetime import datetime, timedelta, timezone

def update_srs(review, rating: str) -> dict:
    """
    Cập nhật trạng thái SRS của thẻ sau khi user tự đánh giá.
    rating: 'again' | 'hard' | 'good' | 'easy'
    Returns: dict với next_interval_days, next_review_at (UTC ISO), 
             last_reviewed_at, ease_factor, lapse_count, review_count
    """
    now = datetime.now(timezone.utc)
    
    if rating == 'again':
        new_interval = 0
        new_ease = max(1.3, review.ease_factor - 0.2)
        new_lapse = review.lapse_count + 1
    elif rating == 'hard':
        new_interval = max(1, int(review.interval_days * 1.2))
        new_ease = max(1.3, review.ease_factor - 0.15)
        new_lapse = review.lapse_count
    elif rating == 'good':
        new_interval = max(1, int(review.interval_days * review.ease_factor))
        new_ease = review.ease_factor
        new_lapse = review.lapse_count
    elif rating == 'easy':
        new_interval = max(1, int(review.interval_days * review.ease_factor * 1.3))
        new_ease = min(3.0, review.ease_factor + 0.15)
        new_lapse = review.lapse_count
    else:
        raise ValueError(f"Invalid rating: {rating}")
    
    return {
        'interval_days': new_interval,
        'ease_factor': new_ease,
        'lapse_count': new_lapse,
        'review_count': review.review_count + 1,
        'last_reviewed_at': now.isoformat(),
        'next_review_at': (now + timedelta(days=new_interval)).isoformat(),
    }
```
**Test Plan:** Bắt buộc có file `test_srs_algorithm.py` kiểm tra cụ thể chuỗi input tuần tự để đảm bảo đầu ra interval là deterministic.

---

## 5. Backend endpoints
*Yêu cầu Auth (JWT-scoped client), Feature flag check, Rate limit bảo vệ chống spam (cap ở mức 500 requests/ngày).*

**Stack Management:**
- `GET    /api/flashcards/stacks` (List user's stacks, trả về cả 3 virtual auto-stacks và manual stacks persisted)
- `POST   /api/flashcards/stacks/preview` (Preview cards trước khi lưu stack mới)
- `POST   /api/flashcards/stacks` (Create manual stack persisted)
- `GET    /api/flashcards/stacks/{id}` (Detail + card count)
- `DELETE /api/flashcards/stacks/{id}` (Delete stack)

**Card Content:**
- `GET    /api/flashcards/stacks/{id}/cards` (List cards in stack. Giải quyết cả id auto virtual và id UUID manual)
- `POST   /api/flashcards/stacks/{id}/cards` (Add card manual vào persisted stack)
- `DELETE /api/flashcards/stacks/{id}/cards/{vocab_id}` (Remove card khỏi persisted stack)

**Study Session:**
- `GET    /api/flashcards/due` (Queue các card đến hạn hôm nay: `next_review_at <= now()`)
- `POST   /api/flashcards/{vocab_id}/review` (Submit self-rating 1-4, update SRS)
- `GET    /api/flashcards/stats` (Thống kê Mastery)

---

## 6. Frontend plan
**Thêm 2 Pages mới:**
- `frontend/pages/flashcards.html` (Quản lý Stacks, Modal Create Stack).
- `frontend/pages/flashcard-study.html` (Màn hình học session).

**JS Files logic:**
- `frontend/js/flashcards.js`, `frontend/js/flashcard-study.js`.

**Modal "Tạo stack mới" UI:**
- **Input:** Tên stack (required, 3-50 chars).
- **Filter section:**
  - Topic multi-select dropdown (options từ distinct `user_vocabulary.topic`,
    backed by migration 028; `topic IS NULL` rows hiển thị dưới group
    "Chưa phân loại").
  - Category multi-select (used_well, needs_review, upgrade_suggested).
  - Search text (optional, search trong headword + definition).
  - Date range: "Added after" date picker (optional, backed by
    `user_vocabulary.created_at` — đây là field "added_at" trong spec).
- **Preview section:** List cards matching filter (live update khi thay đổi filter call API preview).
- **Buttons:** "Lưu" (disabled nếu count=0) / "Hủy".

**Stack management rules:**
- Sau khi tạo: Stack hiển thị trong list dưới dạng Manual, KHÔNG edit được cấu hình filter nữa.
- Nếu cần thay đổi: User chỉ có thể xóa và tạo lại. (Lý do: simplify Wave 2, tính năng edit defer sang Wave 3).

**Tích hợp với hệ sinh thái hiện tại:**
- `exercises.html`: Thêm 1 ô "Flashcards".
- `dashboard.html`: Hiện notification badge: "🔥 Bạn có X thẻ từ đến hạn ôn tập".
- `my-vocabulary.html`: Thêm nút "Add to flashcard study" vào bảng chi tiết từ.

---

## 7. Feature flag strategy
Tuân thủ rule Default-deny từ Phase B.
- **Biến môi trường:** `FLASHCARD_ENABLED=false` (Mặc định tắt trên Prod).
- **Cờ User-level:** Trường `feature_flags.flashcard_enabled` dạng JSON trong profile.
- **Frontend check:** Kiểm tra thông qua trả về từ `/auth/me`. Nếu tắt, ẩn toàn bộ link/menu dẫn tới flashcard.
- **Rollout flow:** Admin self -> 5 Beta -> 10% User -> 100%.

---

## 8. API contract examples

**Preview cards (`POST /api/flashcards/stacks/preview`)**
- *Request body:* `{ "filter_config": { "topics": ["business"], "categories": ["needs_review"] } }`
- *Response (200 OK):* `{ "card_count": 23, "preview_headwords": ["mitigate", "sustainable"] }`

**Create Stack (`POST /api/flashcards/stacks`)**
- *Request body:*
```json
{
  "name": "Business words from January",
  "type": "manual",
  "filter_config": {
    "topics": ["business", "finance"],
    "categories": ["used_well", "upgrade_suggested"],
    "search": "implement",
    "added_after": "2026-01-01"
  }
}
```
- *Response (201 Created):*
```json
{
  "id": "uuid-here",
  "name": "Business words from January",
  "type": "manual",
  "card_count": 23,
  "created_at": "..."
}
```

**Submit Review Rating (`POST /api/flashcards/{vocab_id}/review`)**
- *Request body:* `{ "rating": "good" }`
- *Response (200 OK):*
```json
{
  "vocab_id": "uuid-here",
  "status": "success",
  "next_review_at": "2026-05-15T00:00:00Z",
  "interval_days": 3,
  "ease_factor": 2.5
}
```

---

## 9. Test infrastructure (CRITICAL TỪ DAY 1)
Bắt buộc thiết lập TRƯỚC khi bắt tay code logic core.
1. `backend/scripts/setup_phase_d_wave_2_test_env.sh`: Reset schema, migrations, seed mock data.
2. `backend/tests/test_flashcard_e2e.py`: Test full user flow. Bổ sung test cases:
   - `test_auto_stack_returns_virtual_id`: Đảm bảo `GET /stacks` trả về 3 auto-stacks id `auto:*`.
   - `test_manual_stack_persisted_with_uuid`: Đảm bảo POST stack lưu xuống database với UUID.
   - `test_srs_shared_across_stacks`: Kiểm tra logic review thẻ X trong stack A cập nhật chung state cho thẻ X trong stack B.
3. `backend/tests/test_srs_algorithm.py`: Bổ sung test cases:
   - `test_again_decreases_ease_factor_floor_1_3`.
   - `test_easy_increases_ease_factor_cap_3_0`.
   - `test_next_review_at_calculation_utc`.
4. `backend/tests/test_stack_rls.py`: Dùng 2-JWT test cross-user access block hoàn toàn.
5. `backend/tests/test_due_queue.py`: Check API `due` chỉ lấy đúng thẻ hết hạn.
6. Cập nhật `verify_page_parity.sh` đưa 2 page flashcards mới vào danh sách grep init scripts.

---

## 10. Dogfood plan
Test UX trực tiếp, không chỉ Audit bằng bot.
- **Week 1:** 1 Admin tự chạy flow daily (Học 10 từ/ngày, quan sát SRS cảm giác có tự nhiên không).
- **Week 2:** 3 Admins chéo nghiệm thu.
- **Week 3:** 5 Beta Users thật tham gia vòng review.
- **Week 4:** Đánh giá độ phủ lỗi, quyết định rollout.

---

## 11. Step-by-step execution
1. **Migrations + test infra:** (1 ngày)
   *Verify:* Script setup chạy xanh toàn bộ.
2. **SRS service + tests:** (1 ngày)
   *Verify:* `test_srs_algorithm.py` pass.
3. **Stack management endpoints:** (1 ngày)
4. **Card endpoints + due queue:** (1 ngày)
5. **Frontend stack list page:** (1 ngày)
6. **Frontend study session page:** (1.5 ngày)
7. **Vocab Bank Integration:** (0.5 ngày)
   *Tasks:* 
   - Update `my-vocabulary.js`: Thêm nút "Thêm vào flashcard study" trong chi tiết thẻ. Click mở modal chọn manual stack hoặc tạo mới. Gọi POST `/api/flashcards/stacks/{id}/cards`.
   - Update `my-vocabulary.html`: Đảm bảo render nút đúng vị trí consistent.
   - *Test integration UX:* Bắn success toast, chặn duplicate (hiện "Đã có trong stack"), test UI không break existing vocab bank, chạy `verify_page_parity.sh`.
8. **Feature flag wireup + rollout setup:** (0.5 ngày)
9. **Dogfood prep:** (0.5 ngày)
*Tổng cộng ~7 ngày công thực tế.*

---

## 12. Acceptance criteria
- [ ] Tất cả test scripts pass (`test_flashcard_e2e`, `test_srs_algorithm`, `test_stack_rls`, `test_due_queue`).
- [ ] RLS test (Live 2-JWT) pass xanh rờn, tuyệt đối không skip.
- [ ] **Auto-stacks generate on-the-fly đúng:** All vocab đếm total count `user_vocabulary`, Recent lấy `ORDER BY added_at DESC LIMIT 20`, Needs review lấy `WHERE category = 'needs_review'`.
- [ ] **SRS share progress qua stacks:** Học từ X trong stack A -> review state cập nhật. Học từ X đó trong stack B sau đó -> tiếp tục từ state cũ (không bị reset).
- [ ] **Rate limit backend:** 500 reviews/ngày. Test spam 500 reviews liên tục -> request 501 báo HTTP 429.
- [ ] Độ giãn khoảng thời gian SRS tính chuẩn xác theo code SM-2.
- [ ] Manual stack cho phép lọc chủ đề, save được.
- [ ] Vocab bank integration mượt mà.
- [ ] **KHÔNG REGRESSION:** Các test suite của Phase B và Wave 1 (D1) giữ nguyên độ xanh.
- [ ] **Dogfood UX:** Chạy ổn định trọn vẹn 1 ngày.
- [ ] DDL migration apply trên production verified.
- [ ] Feature flag mặc định OFF khi merge master.
- [ ] Bot Codex audit báo: 0 CRITICAL/HIGH.

---

## 13. Risks + mitigations
- **Empty vocab bank:** Render Empty State đẹp mắt, CTA: "Bắt đầu bài Practice Speaking để hệ thống tự động tìm và trích xuất từ vựng mới!".
- **SRS algorithm bugs:** Đảm bảo hàm `update_srs` được test hoàn toàn bằng các test case cứng (deterministic) không phụ thuộc API ngoài.
- **Performance Queue quá lớn:** Chặn query chậm bằng Index trên `(user_id, next_review_at)`, có Pagination khi gọi queue.
- **Phase B/D1 regression:** Toàn bộ test suite cũ đều chạy trong quy trình CI.

---

## 14. Cost estimate
- **Backend/AI:** $0 (Không gọi Whisper, không gọi Claude).
- **Storage:** ~3 tables cực nhẹ, giả sử user review 100 records = vài KB. Không đáng kể.
- **Tổng ngân sách Wave 2:** **~$0 incremental/tháng**. Tiết kiệm $190/tháng so với định hướng D3 gốc (sẽ dời qua Phase E).

---

## 15. Deliverables
- **Branch Code:** `feature/phase-d-wave-2-flashcards`.
- **Backend:** 3 migrations (025, 026, 027) với Rollback. Files logic: `services/srs.py`, `routers/flashcards.py`.
- **Frontend:** `flashcards.html`, `flashcard-study.html` kèm 2 JS controllers.
- **Tests:** Bộ 4 test files đã liệt kê.
- Cập nhật `DEPLOY_CHECKLIST.md` đầy đủ.
- Summary artifacts format: `PHASE_D_WAVE_2_COMPLETION.md`.

---

## 16. Coding constraints (Anti-pattern alerts)
*Áp dụng bài học sống còn từ Phase B và Phase D Wave 1:*
1. **Khi thêm UI element mới:** Bắt buộc dùng lệnh `grep` rà soát TOÀN BỘ frontend HTML (menu, cards, navbars, dashboards) để sửa tất cả entry points. KHÔNG sửa cục bộ 1 file rồi bỏ quên.
2. **Khi tạo HTML Page mới:** Bắt buộc copy và verify có đủ 3 init elements (`api.js`, `Supabase CDN`, `initSupabase()`) như page gốc, kết hợp script `verify_page_parity.sh`.
3. **Khi đổi Config/ENV:** Bắt buộc `grep` toàn bộ source repo tìm kiếm các reference sót lại.
4. **Service Role:** Chỉ sử dụng service role supabase client trong các scripts background hoặc admin tools. Toàn bộ route người dùng MẶC ĐỊNH dùng JWT-scoped client.

---

## 17. Step-by-step execution status (post-merge)

Section 11's nine numbered steps all completed and shipped to production
behind `FLASHCARD_ENABLED` over the period 2026-04-26 → 2026-04-27.

| Step | Plan section | Status |
|------|--------------|--------|
| 1 | Migrations + test infra (025/026/027) + setup script + 5 test skeletons | ✅ DONE |
| 2 | `services/srs.py` + 7-case deterministic test suite | ✅ DONE |
| 3 | Stack management endpoints (list / preview / create / get / delete) | ✅ DONE |
| 4 | Card endpoints + due queue + review submission + stats | ✅ DONE |
| 5 | `frontend/pages/flashcards.html` + `flashcards.js` + create modal | ✅ DONE |
| 6 | `frontend/pages/flashcard-study.html` + `flashcard-study.js` | ✅ DONE |
| 7 | Vocab Bank integration ("📚 +Stack" picker in My Vocabulary) | ✅ DONE |
| 8 | Feature flag wireup + dashboard daily badge + exercises hub card | ✅ DONE |
| 9 | DEPLOY_CHECKLIST update + PR | ✅ DONE — merged as PR #10 |

---

## 18. Post-deployment retrospective

### What went right
- **Step-by-step commits + checkpoints** caught one MEDIUM red flag in
  step 3 (`user_vocabulary` had no `topic` column despite the plan
  referencing one in §6 + §8).  Adding migration 028 mid-flight was
  cheaper than discovering it during dogfood.
- **Default-deny strict-True** survived its first cross-feature test
  cleanly: `flashcard_enabled` plumbed through `/auth/me` + four
  frontend entry points without leaking access on a missing flag.
- **Live 2-JWT RLS suite must NOT skip** rule paid off — Codex Round 1
  audit confirmed the `flashcard_stacks` policies correctly reject
  cross-user reads/writes.
- **Page parity** check (`verify_page_parity.sh`) caught zero misses
  this wave, vs Wave 1 which shipped a missing init script.

### Endpoint count
The original plan called for **11 endpoints**.  Final shipped surface
is **13 endpoints** — two adds discovered during integration:
- `GET /api/flashcards/due/count` — lightweight counter for the
  dashboard daily-due badge (added during Step 8 to avoid pulling full
  card payloads on every nav refresh).
- `GET /api/flashcards/vocab-topics` — distinct topics + a
  `has_uncategorized` flag for the Manual Stack modal's topic dropdown
  (added during Step 5 because the modal couldn't render the chip set
  otherwise).

### Audit Round 1 — `AUDIT_PHASE_D_WAVE_2.md`
Verdict **APPROVE** with three non-blocking findings, all closed in
`fix/wave-2-audit-findings` (PR #11):

- **MEDIUM** — Manual Stack topic filter couldn't target `topic IS NULL`
  rows.  Fixed via the `__uncategorized__` sentinel + a "📂 Chưa phân
  loại" chip in the modal.
- **MEDIUM** — Live RLS suite covered `flashcard_stacks` only.
  Extended to 7 cases covering `flashcard_cards` and `flashcard_reviews`
  cross-user denial.
- **LOW** — `frontend/js/my-vocabulary.js` carried a dead hardcoded
  localhost/Railway fallback.  Replaced with a direct `window.api.base`
  read.

### Dogfood UX issues — `fix/wave-2-flashcard-ux` (PR #12)
Three UX regressions surfaced during the first day of admin dogfood:

- The back card displayed `context_sentence` as primary content — i.e.
  the user's own STT transcript, which often carries grammar errors.
  Moved behind an opt-in "📖 Xem câu gốc" overlay with explicit
  warning.
- Each rating click `await`-ed `POST /review` before advancing.
  Switched to fire-and-forget; failed syncs surface in the summary
  banner.
- Rating buttons were dimmed until the user flipped the card.  Removed
  the flip-gate; ratings are active from the front face, hotkeys
  unchanged.

### Rich content — `feature/flashcard-rich-content` (PR #13)
The transcript fix above kept the card honest but left it sparse.
Added migration 029 (`ipa` + `example_sentence` columns), a Gemini
Flash enrichment service, Phase B integration (fail-soft on Gemini
error), and a background backfill admin endpoint.  Codex caught one
MEDIUM (the no-content fallback still inlined transcript text); fixed
in the same PR before merge.

Final state: ~17/18 vocab entries enriched across the dogfood
account; the one outlier is an idiom edge case (`played by ear`)
where Gemini's validator rejected the example.  Tracked as HIGH-1 in
`TECH_DEBT.md`.

### Lessons codified for future waves
- "Plan must verify schema before referencing a column" (added to the
  Antigravity prompt template after step 3's `topic` red flag).
- "Audit ≠ dogfood" — Round 1 was clean; the worst UX issue (transcript
  on back face) only surfaced once the user actually studied a deck.
- "Rich content is a separate phase, not a checkbox" — IPA + example
  sentence lifted the card from "studyable" to "useful", and warranted
  its own migration + service + audit cycle.
