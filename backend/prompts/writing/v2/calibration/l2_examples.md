# Level 2 Calibration Examples

These examples anchor your expected output for Band 5.5–6.5 essays at L2.
At this level, `coherenceAnalysis` is the main value-add.

## Example 1: Band 6.0 essay (Task 2, ~280 words)

### Profile

Student writes mostly correct sentences but uses **mechanical linkers**
("Firstly... Secondly... In addition... In conclusion") and shows weak
paragraph topic sentences. This is a textbook Band 6 — competent but
mechanical.

### Expected coherenceAnalysis (3-6 items)

```json
[
  {
    "location": "Paragraph 2, sentence 1",
    "issue": "Mechanical linker overuse — 'Firstly' as opening",
    "explanation": "Cách mở đoạn bằng 'Firstly' rất an toàn nhưng cứng nhắc, đặc trưng Band 6 mechanical cohesion. Band 7 mở đoạn bằng câu chủ đề nội dung, không phải nhãn vị trí.",
    "suggestion": {
      "instruction": "Thay 'Firstly' bằng câu chủ đề có nội dung, signal vị trí qua context",
      "example": "The most pressing concern is..."
    }
  },
  {
    "location": "Paragraph 3, sentences 2-3",
    "issue": "Sudden topic shift without transition",
    "explanation": "Câu 2 nói về kinh tế; câu 3 nhảy sang giáo dục mà không có dấu hiệu liên kết. Band 6 mechanical cohesion thiếu transition giữa idea changes.",
    "suggestion": {
      "instruction": "Thêm câu cầu nối giữa 2 ý hoặc tách thành 2 đoạn riêng",
      "example": "Beyond economic considerations, education plays an equally critical role..."
    }
  }
]
```

**Why 3-6 items?** Per Rule (L2-specific): not zero, not 20+. Each item must
have a specific `location`, not vague.

### Mistake count

5-8 per Rule 1 for band 6.0–6.5. Errors at this level: occasional article
issues, the odd preposition error, 1-2 Vietlish patterns. Improvements over
L1 are real but errors are still frequent.

### Criteria scores

Typical: TR 6, CC 5–6, LR 5–6, GRA 6. Average → 5.75 → round to 5.5 OR 6.0.

## Example 2: Band 5.5 essay (Task 2)

### Profile

Position present but inconsistent; cohesion may be inadequate (linkers used
incorrectly, e.g., "However," when joining same-direction ideas); paragraphing
inadequate (1-2 paragraphs covering multiple ideas).

### Expected coherenceAnalysis

3-5 items focused on:
- Paragraphing failures (multiple ideas in one para)
- Linker misuse (wrong logical relationship)
- Missing topic sentences

### Mistake count

8-12 per Rule 1 for band 5.0–5.5. Significant article + tense + S-V agreement
errors persist.

## Pitfalls to avoid at L2

- **Don't fabricate coherence issues** — if a Band 6 essay has good linking,
  acknowledge it in `feedback` and keep `coherenceAnalysis` to 3 minimum-real
  items, not 6 padded ones.
- **Don't grade like L3** — `ideaDevelopmentAnalysis` MUST be `null` at L2.
  Even if you notice weak arguments, that's an L3 concern.
