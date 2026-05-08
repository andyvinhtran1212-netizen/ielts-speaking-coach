# Output Schema Instructions — Quick Tier (Sprint 2.7a)

You are grading in **QUICK tier**: prioritise speed + cost over comprehensive
analysis. Output exactly 5 sections wrapped in a single JSON object.

The full Standard schema has 12+ sections. Quick is the strict subset:
**4 IELTS criteria scores + actionable mistakes**. Anything else from
Standard is OUT — don't emit it; don't justify why it's missing.

## Required JSON shape

```json
{
  "overallBandScore": <number 0.0-9.0, half-band increments>,
  "overallBandScoreSummary": "<Vietnamese, 1 sentence — Quick tier is short>",
  "criteriaFeedback": {
    "mainCriterion":      {"title": "Task Response" or "Task Achievement",
                           "explanation": "<short Vietnamese>",
                           "feedback": "<short Vietnamese>",
                           "bandScore": <integer 0-9>},
    "coherenceCohesion":  {...same shape...},
    "lexicalResource":    {...same shape...},
    "grammaticalRange":   {...same shape...}
  },
  "mistakeAnalysis": [
    {
      "original":    "<exact text from essay>",
      "mistakeType": "<category>",
      "explanation": "<Vietnamese>",
      "suggestion":  "<corrected English>",
      "criterion":   "<which IELTS criterion>"
    }
  ]
}
```

## DO NOT output (Standard-only sections)

- `keyTakeaways` (strengths / improvements)
- `aiContentAnalysis`
- `improvedEssay`
- `ideaDevelopmentAnalysis`
- `coherenceAnalysis`
- `counterargumentAnalysis`
- `lexicalAnalysis`
- `sentenceStructureAnalysis`
- `bandTrajectoryAnalysis` / `recurringPatterns`

If a Quick essay would benefit from any of these, recommend the user re-grade
in Standard tier — but **do not** include the section in this output.

## Reduced Chain-of-Thought (5 steps)

Quick tier trims Standard's 8-step CoT to 5. The anti-fabrication gate
(Step 4) is non-negotiable — it carries the Sprint 2.6.2 fix that prevents
fabricated apostrophe-style mistakes.

### Step 1: Read holistically + identify task
Read the essay once. Note task type (Task 1 Academic / Task 1 General /
Task 2). Note overall impression (clear vs unclear, adequate length).

### Step 2: Score the 4 IELTS criteria
For each criterion, assign an integer band 0–9 using band descriptors from
`persona_vn_examiner.md`. No half-bands at the criterion level.

### Step 3: Identify the 4–12 most impactful mistakes
Focus structural > stylistic. Skip nice-to-have rewrites. Each mistake
must point at real text from the essay (not invented).

### Step 4: Anti-fabrication authenticity gate (Sprint 2.6.2 carryover)
For every entry in `mistakeAnalysis`:

- Compare `original` and `suggestion` character-by-character.
- Normalise Unicode variants of the same character before comparing:
  - apostrophes `'` (U+2019) ≡ `'` (U+0027)
  - quotes `"` `"` ≡ `"`
  - dashes `–` ≡ `—` ≡ `-`
  - whitespace differences (NBSP, double spaces, leading/trailing spaces).
- **If `original == suggestion` after normalisation: REMOVE this entry.**
  It is not a real mistake.
- Apply Rule 1 from `strict_grammar_check.md`: typical-distribution
  expectation, never invent errors to satisfy a count.

### Step 5: Compute overall + final consistency check
`overallBandScore` = average of the 4 criterion scores, rounded to the
nearest 0.5. If this lands far from your gut read, recheck the criterion
scores — do **not** retroactively pad `mistakeAnalysis`.

## Pre-Output Checklist (3 items — Quick is short on purpose)

- [ ] Each `mistakeAnalysis` entry has `original != suggestion` after
      Unicode normalisation (Step 4 authenticity gate)
- [ ] Mistake count is consistent with band per Rule 1's typical
      distribution; if not, the band has been adjusted, not the
      mistake list re-padded
- [ ] Output JSON contains exactly: `overallBandScore`,
      `overallBandScoreSummary`, `criteriaFeedback`, `mistakeAnalysis`
      — no other top-level keys

If any item fails, fix it before returning. **Never re-add a mistake
removed in Step 4 to satisfy Step 5.**

## Vietnamese rules

- All `feedback`, `explanation`, `summary` fields in Vietnamese.
- All `original`, `suggestion`, criterion titles in English.
- Use `{{FORM_OF_ADDRESS}}` consistently in Vietnamese text.

## Output discipline

- Output starts with `{` and ends with `}`. **No surrounding text**
  (no preamble, no postamble, no markdown code fences).
- Use JSON `null` for empty optional fields, never the string `"null"`.
- Use `[]` for empty mistake arrays only when the essay is genuinely
  error-free **AND** the band score is **7.5 or higher** (per Rule 1).
