# Output Schema Requirements

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
  "improvedEssay": "<full English rewrite at Band 8.0+>",
  
  // CONDITIONAL FIELDS — populate based on analysis level (Level 1 = null/[])
  "ideaDevelopmentAnalysis": [...] or null,
  "coherenceAnalysis": [...] or null,
  "counterargumentAnalysis": {...} or null,
  "lexicalAnalysis": {...} or null,
  "sentenceStructureAnalysis": {...} or null,

  // HISTORY-AWARE FIELDS (Phase 1.5) — null UNLESS the user message
  // contains a "## Lịch sử của học viên này" section. If present,
  // populate per the instructions in that section. If absent, leave null.
  "bandTrajectoryAnalysis": null,  // Phase 1.5b — populated with {current_band, average_last_5, trend, trend_explanation, criteria_breakdown, next_target} when history present
  "recurringPatterns": null         // Phase 1.5a — populated with {summary, improvements, stillRecurring} when history present
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

| Field | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| `mistakeAnalysis` | Required | Required | Required | Required | Required |
| `coherenceAnalysis` | null | Required | Required | Required | Required |
| `ideaDevelopmentAnalysis` | null | null | Required | Required | Required |
| `counterargumentAnalysis` (T2 only) | null | null | null | Required | Required |
| `lexicalAnalysis` | null | null | null | Required | Required |
| `sentenceStructureAnalysis` | null | null | Required | Required | Required |
| `recurringPatterns` (Phase 1.5a) | null unless "Lịch sử của học viên này" section present | (same) | (same) | (same) | (same) |
| `bandTrajectoryAnalysis` (Phase 1.5b) | null unless "Lịch sử của học viên này" section present | (same) | (same) | (same) | (same) |

For Task 1 (no counterargument concept), `counterargumentAnalysis` is always null.

## Critical Format Rules for Suggestion Fields

The `suggestion` field in `coherenceAnalysis` and `ideaDevelopmentAnalysis`
items MUST be an **object** with `instruction` AND `example` fields.
**NOT a plain string.**

### ❌ WRONG — Plain string

```json
{
  "suggestion": "Bỏ câu này đi. Sau đó viết lại đoạn văn."
}
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

### If you cannot provide a meaningful example

Use `"example": ""` (empty string), **NOT** `"example": null`.
But always include the `example` key.

### Final reminder

Every `suggestion` field in `coherenceAnalysis` and `ideaDevelopmentAnalysis`
is an **object**, not a string. Plain-string suggestions cause Pydantic
validation failures and the essay grading will be marked as **failed**.
(`mistakeAnalysis[].suggestion` and `counterargumentAnalysis.suggestion`
remain plain strings — those are the only string-form suggestions in the
schema.)

## Critical Format for `counterargumentAnalysis` (Task 2 only)

For Task 2 essays, `counterargumentAnalysis` MUST be a complete object
with **all 4 fields**. **Do NOT** invent your own keys (e.g.
`promptType`, `essayType`) — they will be silently dropped and the
section will appear empty in the rendered feedback.

### ❌ WRONG — Hallucinated shape

```json
{
  "counterargumentAnalysis": {
    "promptType": "Discuss both views and give your opinion"
  }
}
```

### ❌ WRONG — Plain string

```json
{
  "counterargumentAnalysis": "Student didn't address counterargument"
}
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

### Required fields per item type

`counterargumentAnalysis` — **all 4** fields:
- `isPresent` (boolean, required) — Có counterargument trong bài viết không?
- `feedback` (string, required) — Vietnamese feedback về counterargument
- `suggestion` (string, required) — Concrete improvement suggestion
- `context` (**object**, required) — must have:
  - `insertionPoint` (string) — Where to insert the counterargument
  - `reasoning` (string) — Why this location

### Task 1 essays

For Task 1 (no counterargument concept), set `counterargumentAnalysis`
to `null`. **Do NOT** make up a counterargument analysis with empty
strings just to fill the field.
