# Level 3 Calibration Examples

These examples anchor your expected output for Band 6.5–7.5 essays at L3.
At this level, `ideaDevelopmentAnalysis` and `counterargumentAnalysis` (T2)
become the main value-add.

## Example 1: Band 7.0 essay (Task 2 discussion essay, ~290 words)

### Profile

Clean grammar, decent linkers, clear position. Bottleneck: arguments are
**stated but not extended** — each paragraph has 2-3 sentences then jumps to
the next idea. No counterargument.

### Expected ideaDevelopmentAnalysis (2-4 items)

```json
[
  {
    "paragraph": 2,
    "originalIdea": "Technology helps students learn faster",
    "issue": "Lập luận surface-level — không giải thích cơ chế",
    "explanation": "{{FORM_OF_ADDRESS}} khẳng định tech giúp học nhanh hơn nhưng không trả lời 'NHƯ THẾ NÀO'. Band 7 cần extended idea, không chỉ stated idea.",
    "suggestion": {
      "instruction": "Đưa 1 ví dụ cụ thể với cơ chế rõ ràng",
      "example": "For instance, language-learning apps like Duolingo use spaced repetition algorithms, allowing students to retain vocabulary 30% longer than traditional flashcards — a concrete mechanism, not just a vague benefit."
    }
  },
  {
    "paragraph": 3,
    "originalIdea": "Studies show online learning is effective",
    "issue": "Generic appeal to 'studies' without specifics",
    "explanation": "Cụm 'studies show' là một dấu hiệu Band 6 — không có study cụ thể, không có số liệu. Band 7+ phải có evidence cụ thể hơn (researcher, year, finding).",
    "suggestion": {
      "instruction": "Thay 'studies show' bằng 1 ví dụ cụ thể hoặc nguồn được đặt tên",
      "example": "A 2023 Stanford study of 1,200 university students found that those using online platforms scored 12% higher on retention tests..."
    }
  }
]
```

### Expected counterargumentAnalysis (T2)

```json
{
  "isPresent": false,
  "feedback": "{{FORM_OF_ADDRESS}} chỉ trình bày một phía của discussion essay — chưa đề cập đến lập luận đối lập. Band 7+ trong discussion essay yêu cầu phải acknowledge cả 2 góc nhìn trước khi nêu opinion.",
  "suggestion": "Thêm 1 đoạn ngắn (~50 từ) trình bày quan điểm đối lập trước khi conclude.",
  "context": {
    "insertionPoint": "Between paragraph 3 (your argument) and paragraph 4 (conclusion)",
    "reasoning": "Discussion essay structure ở Band 7+: arg → counter → rebut → conclude. Bài hiện tại thiếu bước counter."
  }
}
```

### Criteria scores

Typical: TR 6 (capped because of underdeveloped ideas, even though structure is
fine), CC 7, LR 7, GRA 7. Average → 6.75 → round to 7.0.

**Why TR=6 not 7?** Band 7 TR requires "main ideas extended/supported". This
essay states ideas but doesn't extend them. Each paragraph reads like a stated
claim then jumps. The grammar/lexical/coherence are at 7, but TR drags it.

## Example 2: Band 6.5 essay (Task 2 opinion essay)

### Profile

Position clear; some idea development but uneven (2 paragraphs strong, 1
underdeveloped); counterargument absent; few grammar errors.

### Expected mistake count

5-8 per Rule 1. Errors typically: subtle article issues, 1 tense slip, 1
collocation. Less mechanical Vietlish than L2, but still 1-2 per essay (Rule 4).

### Common pitfall

Grading this essay at 7.0 because grammar is clean. But Band 7 requires
**developed ideas across all paragraphs**, not just clean prose. The
underdeveloped paragraph drags TR to 6, pulling overall to 6.5.

## Pitfalls to avoid at L3

- **Don't populate `lexicalAnalysis`** — that's L4+. Even if you notice weak
  vocabulary, flag generic-word issues in `mistakeAnalysis` instead.
- **Don't grade Task 1 with `counterargumentAnalysis` as a non-null object** —
  Task 1 has no counterargument concept; the field MUST be `null`.
- **Don't be too lenient on `ideaDevelopmentAnalysis` for Band 7 essays** —
  even essays at Band 7 typically have 2+ ideas worth pushing further. Zero
  items in this section for a Band 7 essay = you missed the bottleneck.
