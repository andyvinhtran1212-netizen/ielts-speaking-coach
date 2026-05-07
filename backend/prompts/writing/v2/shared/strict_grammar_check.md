# Strict Grammar Check (MANDATORY) — v2

This module is **mandatory and non-negotiable** for every analysis level (1-5).
You MUST scan the entire essay for the following error categories and include
all findings in `mistakeAnalysis`.

## 1. Grammar & Spelling Errors

Including but not limited to:

- **Articles:** Missing/wrong/redundant a/an/the (e.g., "I went to school" vs "I went to the school")
- **Prepositions:** Wrong choice (e.g., "depend of" → "depend on")
- **Subject-verb agreement:** Mismatched number (e.g., "people is" → "people are")
- **Verb tenses:** Inconsistent or incorrect tense (especially past/present mixing)
- **Singular/plural:** Wrong form (e.g., "many informations" → "much information")
- **Word forms:** Wrong part of speech (e.g., "education system" vs "educational system")
- **Pronoun reference:** Ambiguous "it/this/they"
- **Spelling:** Any misspelled words

## 2. Vietlish (Vietnamese-influenced English)

Patterns where Vietnamese L1 interferes:

- **Word-by-word translation:** "I very like" (← "tôi rất thích")
- **Incorrect collocations:** "do a research" (correct: "do research")
- **Topic-comment structure:** "This problem, we need to solve" (English uses subject-verb)
- **Missing articles:** "I am student" (← "tôi là sinh viên")
- **Wrong verb-noun pairings:** "make a question" (correct: "ask a question")

## 3. Word Choice & Context

- **Inappropriate register:** Casual words in formal essays
- **Misused vocabulary:** Words used outside their typical context
- **Overused intensifiers:** "very", "really", "so" overuse
- **Incorrect synonyms:** Words sound similar but mean differently

## 4. Awkward Phrasing & Repetition

- **Wordy/circuitous expressions:** Long sentences saying simple things
- **Repetitive vocabulary:** Same word appearing multiple times when synonyms could help
- **Unclear pronouns:** Reader can't tell what "it/this/they" refers to
- **Run-on sentences:** Multiple ideas without proper conjunctions

## Rules

1. **Do NOT skip** even small errors. Every detected issue must appear in `mistakeAnalysis`.
2. **Categorise** each error with `mistakeType`: "Grammar", "Spelling", "Word Choice", "Vietlish", "Awkward Phrasing", or specific subtypes.
3. **Explain in Vietnamese** so the student understands the rule, not just the fix.
4. **Suggest a corrected version** — be specific, not "rewrite this."
5. **Link to criterion**: Tag each error with the IELTS criterion it primarily affects.

## Output Format Per Mistake

```json
{
  "original": "I has been study for 3 years",
  "mistakeType": "Grammar - Verb form",
  "explanation": "Sai trợ động từ 'has' (cần 'have' với chủ ngữ 'I'), và sau 'have been' phải là dạng V-ing.",
  "suggestion": "I have been studying for 3 years",
  "criterion": "Grammatical Range"
}
```

---

## Validation Rules (MANDATORY) — v2

After completing your initial grading, validate your output against these rules.
**If your output violates any rule, RE-GRADE before returning.**

### Rule 1: Mistake Count Consistency with Band

The table below describes the **typical distribution** observed at each band.
It is an expectation for calibration, **not an absolute floor that justifies
inventing errors**.

| Overall Band | Typical mistakeAnalysis count | Reason                                |
|--------------|-------------------------------|---------------------------------------|
| ≤ 4.5        | typically 12+                 | Limited User — many errors expected   |
| 5.0 – 5.5    | typically 8 – 12              | Modest User — noticeable errors       |
| 6.0 – 6.5    | typically 5 – 8               | Competent — frequent errors           |
| 7.0          | typically 3 – 5               | Good User — occasional errors         |
| 7.5+         | typically 0 – 3               | Very Good — rare errors               |

**CRITICAL ANTI-FABRICATION RULE — read carefully:**

1. **DO NOT fabricate errors to meet the typical count.** If the essay has
   fewer real errors than the band would predict, the *band* is what should
   be reconsidered (likely revised upward). Inventing errors is never the
   correct response to a count mismatch.

2. **Every reported mistake MUST have a real, verifiable difference between
   `original` and `corrected`** — meaning the two strings differ in actual
   characters after normalising Unicode variants of the same character:
   - apostrophes: `'` (U+2019) ≡ `'` (U+0027)
   - quotes: `"` `"` (U+201C/U+201D) ≡ `"` (U+0022)
   - dashes: `–` (U+2013) ≡ `—` (U+2014) ≡ `-` (U+002D)
   - whitespace differences (NBSP, double spaces) do not count.
   If `original == corrected` after this normalisation, the entry is **not**
   a mistake — DO NOT include it.

3. **An empty `mistakeAnalysis` IS acceptable when both:**
   (a) the essay is genuinely error-free at the structural level, **AND**
   (b) the band score is **7.5 or higher**.

4. **For bands ≤ 7.0 with empty `mistakeAnalysis`, re-examine. Either:**
   (a) you missed real errors → find them, **or**
   (b) the band should actually be higher → adjust the band.
   Do **not** invent errors as a third option.

**Background:** A Band-5 essay with zero mistakes is mathematically
impossible (production bug 0caf5e59). But a Band-6.5 essay with a fabricated
"missing apostrophe" where original and corrected are identical strings is
equally a failure mode — and it erodes student trust faster. Both shapes are
guarded by this rule.

### Rule 2: Word Count Caps

For Task 2:
- < 200 words → cap Task Response at 4
- 200 – 249 words → cap Task Response at 5
- 250+ words → no cap

For Task 1:
- < 100 words → cap Task Achievement at 4
- 100 – 149 words → cap Task Achievement at 5
- 150+ words → no cap

The cap is on the criterion bandScore. Other criteria are unaffected by the
cap (a short but well-written essay can still score well on Lexical Resource).
The overall band remains the average — but capping TR/TA pulls it down.

### Rule 3: Band Consistency

The 4 criteria scores should be within 1.5 bands of each other in most cases.
If your scores differ by more than 1.5 (e.g., TR=4, GRA=7), one of them is
likely miscalibrated. Re-evaluate the outliers.

`overallBandScore` = average of the 4 criteria, rounded to the nearest 0.5.

### Rule 4: Vietlish Detection Expectation

For Vietnamese students at bands ≤ 6.5, Vietlish patterns (literal Vietnamese-
to-English translation, e.g., `"I have 25 years old"` instead of `"I am 25
years old"`) are **typically** present at ≥ 1 per 250 words.

This is an expectation, not a floor that justifies invention.

- If you find genuine Vietlish: report it.
- If you do not find genuine Vietlish despite the expectation, treat the
  empty result as a **yellow flag for the grader to recheck**, not a licence
  to fabricate. Three legitimate explanations exist, in order of likelihood:
  1. **Re-scan with focus** on prepositions, tense, articles, possessives —
     Vietlish at bands 6.0–6.5 is often subtle and easy to miss on first pass.
  2. **The student has stronger structural English than typical for their
     band** — adjust the band upward if other criteria support.
  3. **The 8 Vietlish patterns in `persona_vn_examiner.md` genuinely don't
     apply** to this essay (rare but possible).

Empty Vietlish detection at band ≤ 6.5 must never be resolved by inventing
a pattern. Apply the same `original != corrected` authenticity rule from
Rule 1 — a Vietlish "mistake" whose `original` and `corrected` strings are
identical is not a mistake.

### Rule 5: Improved Essay Realism

The `improvedEssay` should be at most **1.5 bands above the student's current
band**:
- Student band 4 – 5 → improved at 6.5
- Student band 5.5 – 6 → improved at 7.0
- Student band 6.5 – 7 → improved at 8.0
- Student band 7.5+ → improved at 8.5+

DO NOT write a band-9 essay for a band-5 student — they cannot learn from a
target that is 4 bands above their current ability. The improved essay is a
*realistic next step*, not a model answer.
