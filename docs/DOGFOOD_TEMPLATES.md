# Dogfood Templates — Phase 2.5

2 templates dưới đây dùng cho Tuần 1 dogfood. Copy mỗi template thành file 
riêng trong `dogfood/` folder hoặc Apple Notes.

---

## Template 1: DOGFOOD_PHASE_B_SESSION_2.md

````markdown
# Phase B Dogfood Session 2

**Date:** ____
**Tester:** ____
**Goal:** Verify FP rate <15% after post-dogfood fixes (Session 1: 37%)

## Sessions recorded

| # | Topic | Part | Duration | Vocab extracted | FP count | FP rate |
|---|-------|------|----------|-----------------|----------|---------|
| 1 | ____  | ____ | ____     | ____            | ____     | ____%   |
| 2 |       |      |          |                 |          |         |
| 3 |       |      |          |                 |          |         |
| 4 |       |      |          |                 |          |         |
| 5 |       |      |          |                 |          |         |
|   |       |      | TOTAL    | ____            | ____     | ____%   |

## FP analysis (per session)

### Session 1: [Topic]

Vocabulary extracted:
1. **[headword]**: 
   - Category: ____
   - User said: "..."
   - Definition: "..."
   - Verdict: ✅ correct / ❌ FP because [reason]

2. **[headword]**:
   - ...

(Repeat for all extracted vocab)

### FP patterns observed

(Group similar FP types):

**Pattern A: [name]**
- Examples: ____
- Hypothesis why: ____
- Severity: HIGH/MED/LOW

**Pattern B: [name]**
- ...

## Comparison vs Session 1 (37% FP)

What improved:
- 

What still problematic:
- 

## Quality of suggestions (for needs_review/upgrade categories)

- Were suggestions actionable?
- Did they improve user's English?
- Examples of good/bad suggestions:

## Decision

- [ ] FP rate <15% → Phase B production-ready, mark HIGH-2 from TECH_DEBT done
- [ ] FP rate 15-25% → Plan tune
- [ ] FP rate >25% → STOP, redesign needed

## Recommendations

- 
````

---

## Template 2: DOGFOOD_WAVE_2_NOTES.md

````markdown
# Wave 2 Flashcard Dogfood — 4 days

**Start date:** ____
**Goal:** Validate SRS feel + content quality

---

## Day 1 — [Date]

### Cards reviewed: ___ / 20

### Distribution
- Again: __ ( __%)
- Hard: __  ( __%)
- Good: __  ( __%)
- Easy: __  ( __%)

(Healthy SRS: Again 10-20%, Hard 20-30%, Good 40-50%, Easy 10-20%)

### Card quality observations
- IPA accuracy: ____ (1-5 scale)
- Example sentence usefulness: ____ (1-5)
- Definition clarity: ____ (1-5)
- Specific cards that stood out (good/bad):
  - 

### UX observations
- Daily due queue feel: overwhelming / OK / not enough
- Stack navigation: smooth / confusing
- Rating buttons response: instant / lag / OK
- Hotkeys 1/2/3/4 useful: yes / no / didn't notice
- Bug found: ____

### Pain points
- 

---

## Day 2 — [Date]

(Repeat structure)

### SRS interval check
- Cards from Day 1 that should appear today: ____
- Actually appeared: ____
- Match: ✅ / ❌
- If not match, why: ____

---

## Day 3 — [Date]

(Repeat)

### Mid-week assessment
- Is SRS adapting to my level? (cards I knew → less frequent?)
- Are weak words coming back to me?
- Total cards mastered (interval >30 days): ____

---

## Day 4 — [Date]

(Repeat)

### Final assessment

**SRS quality:**
- [ ] Intervals feel natural
- [ ] Difficult words appear more often
- [ ] Easy words gradually fade
- [ ] Algorithm needs adjustment because: ____

**Content quality:**
- [ ] IPA reliable (no obvious errors)
- [ ] Examples natural English (Band 7+ feel)
- [ ] Definitions match user level

**UX quality:**
- [ ] Daily routine sustainable (would do without prompting)
- [ ] No friction points
- [ ] Friction points: ____

## Bugs/Issues found (cumulative)

| Day | Issue | Severity | Status |
|-----|-------|----------|--------|
|     |       |          |        |

## Recommendations

For Wave 3+:
- 
- 

For tech debt:
- 

## Decision

- [ ] Wave 2 production-ready, proceed Phase 3
- [ ] Need SRS tuning before Phase 3
- [ ] Need content improvement (audio/image) before Phase 3
````

---

## Usage instructions

### Setup (5 phút)

```bash
mkdir -p ~/Documents/ielts-speaking-coach/dogfood
cd ~/Documents/ielts-speaking-coach/dogfood

# Tạo 2 files từ templates
touch DOGFOOD_PHASE_B_SESSION_2.md
touch DOGFOOD_WAVE_2_NOTES.md

# Add to .gitignore (private notes, không cần commit)
cd ..
echo "dogfood/" >> .gitignore
```

### Workflow

**Phase B Session 2 (Day 2-3):**
- Make 5 speaking sessions
- Open My Vocabulary → review từng vocab extracted
- Fill template
- Compute FP rate
- Document patterns

**Wave 2 Daily (Day 4-7):**
- Set alarm 15 phút mỗi sáng (hoặc tối)
- Mở flashcards → due queue
- Học cards thật, rate honestly
- Fill day section trong DOGFOOD_WAVE_2_NOTES.md
- Commit gì đến gì học, không skip

### Tips

1. **Be honest**: Rate "Hard" if hard, không tự ép "Good"
2. **Note immediately**: Memory fade nhanh, ghi ngay khi gặp
3. **Distinguish bug vs preference**: bug = fix, preference = note for design
4. **Track time**: how long study session takes (sustainability check)
5. **Compare days**: Day 4 self vs Day 1 self — improving?

### After dogfood

- [ ] Tổng hợp findings
- [ ] Update TECH_DEBT.md với items mới
- [ ] Decision gate proceed/tune
- [ ] Write retrospective in PHASE_2_5_RETROSPECTIVE.md
