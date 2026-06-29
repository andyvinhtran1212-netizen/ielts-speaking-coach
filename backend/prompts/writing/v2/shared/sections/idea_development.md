# SECTION: IDEA DEVELOPMENT (L3+)

This section is populated at **L3 and above**. At L1–L2, set
`ideaDevelopmentAnalysis` to `null`.

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
