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
  "sentenceStructureAnalysis": {...} or null
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
| `counterargumentAnalysis` (T2 only) | null | null | Required | Required | Required |
| `lexicalAnalysis` | null | null | null | Required | Required |
| `sentenceStructureAnalysis` | null | null | null | Required | Required |

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
