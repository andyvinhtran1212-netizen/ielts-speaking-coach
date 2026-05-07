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

### Rule 1: Mistake Count Floor by Band

| Overall Band | Minimum mistakeAnalysis count | Reason                                |
|--------------|-------------------------------|---------------------------------------|
| ≤ 4.5        | 12+                           | Limited User — many errors expected   |
| 5.0 – 5.5    | 8 – 12                        | Modest User — noticeable errors       |
| 6.0 – 6.5    | 5 – 8                         | Competent — frequent errors           |
| 7.0          | 3 – 5                         | Good User — occasional errors         |
| 7.5+         | 0 – 3                         | Very Good — rare errors               |

**If `mistakeAnalysis` is empty AND band < 7.5, re-read the essay carefully —
you missed errors.** A Band-5 essay with zero mistakes is mathematically
impossible: that contradiction has shown up in production grading on real
essays and is exactly the failure mode this rule guards against.

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

### Rule 4: Vietlish Detection Floor

For Vietnamese students, you should detect **at least 1 Vietlish-pattern
mistake per 250 words** at bands ≤ 6.5. If you find zero Vietlish patterns in a
sub-7 essay, you almost certainly missed something — re-scan for the patterns
listed in section 2.

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
