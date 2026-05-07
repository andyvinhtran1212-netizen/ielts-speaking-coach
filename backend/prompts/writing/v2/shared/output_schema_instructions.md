# Output Schema Requirements — v2

You MUST return a single JSON object matching the schema below. **No other text
outside the JSON** — no preamble, no postamble, no markdown code fences.

## Schema

```json
{
  "overallBandScore": <number 0.0-9.0, half-band increments>,
  "overallBandScoreSummary": "<Vietnamese, 2-3 sentences explaining the band>",
  "keyTakeaways": {
    "strengths": ["<Vietnamese strength 1>", "<Vietnamese strength 2>"],
    "areasForImprovement": ["<Vietnamese area 1>", "<Vietnamese area 2>"]
  },
  "criteriaFeedback": {
    "mainCriterion": {
      "title": "Task Response" or "Task Achievement",
      "explanation": "<Vietnamese, what this criterion measures>",
      "feedback": "<Vietnamese, specific feedback for this essay>",
      "bandScore": <integer 0-9>
    },
    "coherenceCohesion": {...same structure...},
    "lexicalResource": {...same structure...},
    "grammaticalRange": {...same structure...}
  },
  "mistakeAnalysis": [
    {
      "original": "<exact text from essay>",
      "mistakeType": "<category>",
      "explanation": "<Vietnamese explanation>",
      "suggestion": "<corrected English>",
      "criterion": "<which IELTS criterion>"
    }
  ],
  "aiContentAnalysis": {
    "likelihood": <0-100, percentage AI-like>,
    "explanation": "<Vietnamese, explanation of AI likelihood>"
  },
  "improvedEssay": "<full English rewrite, max 1.5 bands above student's current>",

  // CONDITIONAL FIELDS — populate based on analysis level (Level 1 = null/[])
  "ideaDevelopmentAnalysis": [...] or null,
  "coherenceAnalysis": [...] or null,
  "counterargumentAnalysis": {...} or null,
  "lexicalAnalysis": {...} or null,
  "sentenceStructureAnalysis": {...} or null,

  // HISTORY-AWARE FIELDS (Phase 1.5) — null UNLESS the user message
  // contains a "## Lịch sử của học viên này" section.
  "bandTrajectoryAnalysis": null,
  "recurringPatterns": null
}
```

## Critical Rules

1. **Strict JSON:** Output starts with `{` and ends with `}`. No surrounding text.
2. **Use `null` not "null":** For empty optional fields, use JSON `null`, not the string `"null"`.
3. **Use empty arrays `[]`:** For list fields with no items, use `[]`, not `null`.
4. **Vietnamese for explanations:** All `feedback`, `explanation`, `summary` fields in Vietnamese.
5. **English for code-like text:** `original`, `suggestion`, `improvedEssay`, IELTS criteria titles in English.
6. **Half-band scores:** `overallBandScore` can be X.0 or X.5 only. Criterion `bandScore` is integer.
7. **Be specific:** No placeholder text like "good vocabulary" — explain WHICH words and WHY.
8. **Address as "{{FORM_OF_ADDRESS}}":** All Vietnamese text uses this pronoun consistently.

## Conditional Field Rules (per analysis level)

| Field                              | L1   | L2       | L3       | L4       | L5       |
|------------------------------------|------|----------|----------|----------|----------|
| `mistakeAnalysis`                  | Required | Required | Required | Required | Required |
| `coherenceAnalysis`                | null | Required | Required | Required | Required |
| `ideaDevelopmentAnalysis`          | null | null     | Required | Required | Required |
| `counterargumentAnalysis` (T2 only)| null | null     | Required | Required | Required |
| `lexicalAnalysis`                  | null | null     | null     | Required | Required |
| `sentenceStructureAnalysis`        | null | null     | null     | Required | Required |
| `recurringPatterns` (Phase 1.5a)   | null unless history present (any level) |
| `bandTrajectoryAnalysis` (Phase 1.5b) | null unless history present (any level) |

For Task 1 (no counterargument concept), `counterargumentAnalysis` is always null.

## Critical Format Rules for Suggestion Fields

The `suggestion` field in `coherenceAnalysis` and `ideaDevelopmentAnalysis`
items MUST be an **object** with `instruction` AND `example` fields.
**NOT a plain string.**

### ❌ WRONG — Plain string

```json
{ "suggestion": "Bỏ câu này đi. Sau đó viết lại đoạn văn." }
```

### ✅ CORRECT — Object with both fields

```json
{
  "suggestion": {
    "instruction": "Bỏ câu này đi vì không liên quan đến luận điểm chính",
    "example": "Sau đó viết lại đoạn văn với câu mở đầu rõ ràng hơn: 'However, recent studies suggest...'"
  }
}
```

### Required fields per item type

`coherenceAnalysis[]` — every item MUST have **all 4** fields:
- `location` (string, required, e.g., `"Paragraph 2, sentence 3"`)
- `issue` (string, required, e.g., `"Sudden topic shift"`)
- `explanation` (string, required, Vietnamese explanation)
- `suggestion` (**object** with `instruction` + `example`, required)

`ideaDevelopmentAnalysis[]` — every item MUST have **all 5** fields:
- `paragraph` (integer, required, e.g., `2`)
- `originalIdea` (string, required, the essay's idea being critiqued)
- `issue` (string, required)
- `explanation` (string, required, Vietnamese explanation)
- `suggestion` (**object** with `instruction` + `example`, required)

If you cannot provide a meaningful example, use `"example": ""` (empty string),
**NOT** `"example": null`. Always include the `example` key.

`mistakeAnalysis[].suggestion` and `counterargumentAnalysis.suggestion` remain
plain strings — those are the only string-form suggestions in the schema.

## Critical Format for `counterargumentAnalysis` (Task 2 only)

For Task 2 essays, `counterargumentAnalysis` MUST be a complete object with
**all 4 fields**. **Do NOT** invent your own keys (e.g. `promptType`,
`essayType`) — they will be silently dropped and the section will appear empty.

### ❌ WRONG — Hallucinated shape
```json
{ "counterargumentAnalysis": { "promptType": "Discuss both views" } }
```

### ❌ WRONG — Plain string
```json
{ "counterargumentAnalysis": "Student didn't address counterargument" }
```

### ✅ CORRECT — Full object
```json
{
  "counterargumentAnalysis": {
    "isPresent": false,
    "feedback": "Bài chưa đề cập đến quan điểm đối lập, làm giảm tính thuyết phục.",
    "suggestion": "Thêm 1 đoạn ngắn thừa nhận lập luận phản biện rồi phản bác.",
    "context": {
      "insertionPoint": "Sau đoạn 3 (luận điểm chính), trước đoạn kết.",
      "reasoning": "Cấu trúc Band 7+ đòi hỏi acknowledge opposing view trước khi conclude."
    }
  }
}
```

For Task 1 (no counterargument concept), set `counterargumentAnalysis` to
`null`. **Do NOT** make up an analysis with empty strings just to fill the field.

---

## Grading Process (Chain-of-Thought — MANDATORY) — v2

Before producing the JSON output, think through these steps internally. You
don't need to output your reasoning, but you MUST follow this order.

### Step 1: Read holistically
Read the entire essay once without judgment. Note overall impression: clear or
unclear? Coherent or disjointed? Adequate length?

### Step 2: Word count + structure check
- Count words. Apply word count caps from Rule 2.
- Identify paragraph count. Task 2 should have 4–5 paragraphs.
- Note opening/conclusion presence.

### Step 3: Strict grammar scan
Scan sentence-by-sentence. List ALL errors in `mistakeAnalysis`. Categorise
each by criterion (TR/CC/LR/GRA).

### Step 4: 4-criteria assessment
For each of the 4 IELTS criteria:
- Identify primary band level (use Band Descriptors from persona module)
- Note 2–3 specific evidence points from this essay
- Score from 0–9, halves NOT allowed (criterion `bandScore` is integer)

### Step 5: Calculate overall + cross-check
Average the 4 scores → round to nearest 0.5 → that's `overallBandScore`.
Cross-check: does overall feel right when you re-read holistically? If gap of
>1 band between overall and your gut, recalibrate.

### Step 6: Apply validation rules
Run through Rules 1–5 from `strict_grammar_check.md`. If any rule violated,
regrade the affected sections.

### Step 7: Generate level-appropriate sections
Based on the level (L1–L5), populate only the required sections. Set unused
sections to `null` per the level instructions.

### Step 8: Sanity check before output
Final check: Does this feedback help this specific student improve?
- Are mistakes specific (with quoted text from the essay)?
- Are suggestions actionable?
- Is improved essay a realistic upgrade (max 1.5 bands above)?

If any answer is "no", revise.

## Self-Validation (Pre-Output Checklist)

Before returning the JSON, mentally verify:

- [ ] `mistakeAnalysis` count meets minimum for band (Rule 1)
- [ ] Word count cap applied (Rule 2)
- [ ] 4 criteria scores within 1.5 of each other (Rule 3)
- [ ] At least 1 Vietlish pattern detected if band ≤ 6.5 (Rule 4)
- [ ] Improved essay at most 1.5 bands above student (Rule 5)
- [ ] Every mistake has: `original`, `mistakeType`, `explanation` (Vietnamese), `suggestion`, `criterion`
- [ ] Every criteria item has: `title`, `bandScore` (0-9), `explanation` (Vietnamese), `feedback` (Vietnamese)
- [ ] Vietnamese feedback uses "{{FORM_OF_ADDRESS}}" consistently
- [ ] No section is an empty array `[]` when it should be `null` (per level)

If any item fails check, REGRADE before returning.
