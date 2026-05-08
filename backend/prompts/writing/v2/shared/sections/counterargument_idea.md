# SECTION: COUNTERARGUMENT IDEA (L3+)

These sections are populated at **L3 and above**. At L1–L2, set both
`ideaDevelopmentAnalysis` and `counterargumentAnalysis` to `null`.

## `ideaDevelopmentAnalysis` — approach

For each major argument in the essay, evaluate:
- **Is there a clear thesis?**
- **Does the example support the claim?** (Or just restate it?)
- **Is the reasoning logical?** (Or jump to conclusions?)
- **Does it explore implications?** (So what?)

For each weak argument:

```json
{
  "paragraph": 2,
  "originalIdea": "Technology helps students learn faster",
  "issue": "Lập luận quá chung chung, thiếu dẫn chứng cụ thể",
  "explanation": "{{FORM_OF_ADDRESS}} nói tech giúp học nhanh hơn nhưng không giải thích NHƯ THẾ NÀO và CỤ THỂ tech gì...",
  "suggestion": {
    "instruction": "Đưa 1 ví dụ cụ thể với cơ chế rõ ràng",
    "example": "For instance, language-learning apps like Duolingo use spaced repetition algorithms, allowing students to retain vocabulary 30% longer than traditional flashcards."
  }
}
```

Aim for **2–5 items** for Task 2 (Task 1 may have fewer — usually 1–3
about data interpretation). Each item MUST have a specific `paragraph`
integer pointing to a real paragraph in the essay.

## `counterargumentAnalysis` — approach (T2 only)

Task 2 essays at Band 7+ MUST acknowledge opposing views. Evaluate:

- **Is a counterargument present?** Yes/No
- **If present:** Is it taken seriously or strawmanned?
- **If absent:** Suggest where one would fit naturally

```json
{
  "isPresent": false,
  "feedback": "{{FORM_OF_ADDRESS}} chỉ nêu một góc nhìn, chưa thừa nhận quan điểm đối lập...",
  "suggestion": "Trước khi kết luận, dành 1 đoạn cho counterargument để bài thuyết phục hơn",
  "context": {
    "insertionPoint": "Between paragraph 3 (your argument) and paragraph 4 (conclusion)",
    "reasoning": "Cấu trúc Band 7+ đòi hỏi acknowledge opposing view rồi rebut, thay vì chỉ argue 1 chiều"
  }
}
```

For Task 2 essays, `counterargumentAnalysis` MUST be a complete object
(all 4 fields). For Task 1, it MUST be `null` (no counterargument concept
in data description).
