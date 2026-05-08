# SECTION: COHERENCE DEEP (L2+)

This section is populated at **L2 and above**. At L1, set
`coherenceAnalysis` to `null`.

## `coherenceAnalysis` — focus areas

### 1. Linking words (cohesive devices)

Identify mechanical/overused linkers and suggest natural alternatives:

**Mechanical (penalize):**
- "Firstly... Secondly... Thirdly... Finally"
- "In addition to that"
- "Last but not least"
- "On the other hand" (overused)

**Natural alternatives:**
- "To begin, ..."
- "Equally important..."
- "Beyond this..."
- "Conversely..." or "By contrast..."

### 2. Paragraph structure

Look for:
- Topic sentences (clear or unclear?)
- Supporting evidence (specific or vague?)
- Concluding/transition sentence (smooth or abrupt?)

### 3. Logical flow

- Does each idea connect to the next?
- Are there logical gaps requiring reader inference?
- Is the conclusion supported by the body?

## `coherenceAnalysis` format

For each coherence issue found:

```json
{
  "location": "Paragraph 2, sentence 3",
  "issue": "Sudden topic shift without transition",
  "explanation": "Câu này chuyển sang ý mới về 'technology' mà không có dấu hiệu chuyển tiếp...",
  "suggestion": {
    "instruction": "Thêm câu cầu nối ý kiến giữa 2 ý",
    "example": "However, technology has also brought challenges. For instance,..."
  }
}
```

Aim for **3–6 coherence issues** in a typical essay. Don't fabricate
issues — if essay has good coherence, keep the list short (3 items minimum
still — surface even minor transitions worth tightening).

Each item MUST have a specific `location` (e.g., "Paragraph 2, sentence 3"),
not vague ("the middle"). The `suggestion` field is an OBJECT with both
`instruction` AND `example` keys — see the schema-instructions module for
the strict format.
