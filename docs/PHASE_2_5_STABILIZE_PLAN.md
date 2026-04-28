# Phase 2.5 — Stabilize & Measure

**Duration:** 2 tuần (2026-04-28 → 2026-05-11)
**Goal:** Validate features đã ship + clear tech debt CRITICAL trước khi mở scope mới.
**Approach:** Dogfood-driven. Không build feature mới. Decision gates dựa data thật.

---

## Vì sao Phase 2.5 trước Phase 3 chatbot?

1. **Wave 2 vừa ship hôm nay (2026-04-27).** Flashcard SRS chưa có 1 ngày usage thật. Chưa biết:
   - SRS intervals có natural không
   - Card content quality (IPA + example) có đủ học không
   - Daily due queue feel có overwhelming không
   
2. **Phase B FP rate session 2 chưa chạy.** Session 1 = 37%, gate <10%. Post-dogfood fixes shipped nhưng chưa verify.

3. **Tech debt CRITICAL chưa clear.** DB password đã 2 lần lộ, chưa rotate.

4. **Build chatbot khi core features unproven** = risk build feature sai. Better: validate trước, design chatbot dựa pain points thật từ dogfood.

---

## Tuần 1 (2026-04-28 → 2026-05-04)

### Day 1 (Mon): Tech debt CRITICAL clear

**Morning (30 phút):**
- [ ] Rotate Supabase production DB password
  - Supabase Dashboard → Settings → Database → Reset password
  - Update local `backend/.env`
  - Update Railway env var `DATABASE_URL`
  - Test backup script: `bash backend/scripts/backup_production.sh`
- [ ] Rotate staging DB password (same procedure)
- [ ] Verify auto-backup chạy được sau rotation

**Afternoon (1h):**
- [ ] Cleanup AUDIT_*.md files: move sang `docs/audits/`
- [ ] Add favicon.ico (LOW-3 from TECH_DEBT.md)
- [ ] Verify all production smoke tests still pass

**Output:** TECH_DEBT.md cập nhật, mark CRIT-1, CRIT-2, LOW-3, LOW-4 done.

### Day 2-3 (Tue-Wed): Phase B Dogfood Session 2

**Goal:** Verify FP rate <15% (target từ post-dogfood fixes).

**Procedure:**
1. Record 5 speaking sessions thật (Part 1, Part 2, Part 3 mix)
2. Để Phase B extract vocab tự động
3. Review từng vocab với checklist FP:
   - Headword đúng từ user nói không?
   - Definition phù hợp context không?
   - Category (used_well/needs_review/upgrade) đúng không?
   - Suggestion (nếu có) hữu ích không?

**Logging template:** xem `DOGFOOD_PHASE_B_SESSION_2.md` (tạo mới).

**Decision gate:**
- FP rate <15% → ✅ Phase B production-ready, no action needed
- FP rate 15-25% → identify pattern, plan tune
- FP rate >25% → STOP, Phase B cần redesign trước Phase 3

### Day 4-7 (Thu-Sun): Wave 2 Flashcard Dogfood

**Goal:** Verify SRS feel natural + card content valuable.

**Daily routine (15 phút/ngày × 4 ngày):**
1. Mở Flashcards → Daily due queue
2. Học 10-20 cards
3. Rate Again/Hard/Good/Easy theo cảm giác thật
4. Note vào `DOGFOOD_WAVE_2_NOTES.md`:
   - Cards xuất hiện đúng lúc không (quá sớm/muộn)?
   - IPA + example có đủ để học không?
   - Stack types (auto vs manual) flow tự nhiên không?
   - Bug nào không?

**Decision gate:**
- SRS feel OK + content useful → ✅ proceed Phase 3
- SRS intervals lệch nhiều (most cards "Again") → tune algorithm
- Content thiếu → consider audio/image cards Wave 3

---

## Tuần 2 (2026-05-05 → 2026-05-11)

### Day 8-9 (Mon-Tue): Address dogfood findings

Based on Tuần 1 dogfood, có thể có:
- Phase B prompt tuning (nếu FP rate >15%)
- SRS algorithm adjustment (nếu intervals lệch)
- Wave 2 UX polish (nếu phát hiện thêm UX issues)
- Idiom enrichment edge case (HIGH-1 from TECH_DEBT.md)

Estimate 1-2 ngày fix nhỏ. Nếu finding lớn → assess scope.

### Day 10-11 (Wed-Thu): Establish baseline metrics

**Goal:** Có concrete numbers để measure Phase 3+ impact.

**Metrics to track:**

```
USAGE METRICS (admin dashboard hoặc SQL query):
- Total active users (last 7 days)
- Speaking sessions per user per week
- Vocab extracted per session (avg)
- Flashcards reviewed per user per day
- D1 exercises completed per user per week

QUALITY METRICS:
- Phase B FP rate (after session 2)
- D1 exercise correctness rate
- Flashcard "Again" rate (should be <30% for healthy SRS)
- Vocab enrichment success rate (currently 17/18 = 94%)

TECHNICAL METRICS:
- API latency p95 (Railway logs)
- Gemini API cost per active user per month
- Supabase storage usage
- Backup success rate (auto-backup logs)
```

**Output:** `BASELINE_METRICS_2026_05.md` với numbers cụ thể.

### Day 12-13 (Fri-Sat): Strategic planning Phase 3

**Goal:** Decide Phase 3 direction dựa data dogfood.

Possible directions (dựa findings):

**Path A:** Quick Chatbot MVP (nếu user feedback "want quick help")
- Floating widget
- 5 modes core
- Gemini Flash (defer Gemma)

**Path B:** Mock Test feature (nếu user feedback "want practice toàn bộ")
- Full IELTS Speaking Test simulation
- Auto scoring
- History + improvement tracking

**Path C:** Reading/Listening module (nếu user feedback "Speaking đủ rồi, want more")
- Reuse vocab bank
- New module: passages + comprehension exercises

**Path D:** Audio/Image flashcards (nếu finding: SRS effective nhưng cards thiếu rich)
- TTS audio cho IPA
- Image lookup integration

**Decision criteria:** based on dogfood pain points + user requests, KHÔNG based on assumption.

### Day 14 (Sun): Document + handoff

- [ ] Update STRATEGY_2026.md với Phase 3 decision
- [ ] Write Antigravity prompt cho phase tiếp
- [ ] Update TECH_DEBT.md với items mới phát hiện
- [ ] Plan dogfood ongoing routine

---

## Success criteria Phase 2.5

Hoàn thành khi:

- [ ] CRITICAL tech debt cleared (passwords rotated)
- [ ] Phase B FP rate verified <15% (or path forward identified)
- [ ] Wave 2 dogfood log có >50 cards reviewed
- [ ] Baseline metrics documented
- [ ] Phase 3 direction chosen với data justification
- [ ] No production fires (uptime >99%)

---

## Out-of-scope Phase 2.5

KHÔNG làm:

- ❌ Build chatbot
- ❌ Build mock test
- ❌ Add new modules
- ❌ Self-host Gemma
- ❌ Major refactoring
- ❌ Mobile app

Reason: Stabilize first. Validate before expand.

---

## Risk + mitigation

| Risk | Mitigation |
|---|---|
| Dogfood tìm thấy bug critical | Have fix forward path, prioritize over schedule |
| FP rate vẫn >15% | Plan Phase 2.6 Phase B refinement, defer Phase 3 |
| SRS algorithm sai fundamental | Switch to fixed intervals (less elegant nhưng predictable) |
| User churn during stabilize | Communicate roadmap, không launch features mới quá lâu |

---

## Daily checklist Tuần 1

Print/copy template này, fill mỗi ngày:

```
Date: ____
Tasks done:
- [ ] 
- [ ] 

Dogfood notes:
- 

Bugs found:
- 

Tomorrow:
- 
```
