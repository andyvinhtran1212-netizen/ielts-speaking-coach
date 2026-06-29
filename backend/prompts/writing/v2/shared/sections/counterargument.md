# SECTION: COUNTERARGUMENT (L4+)

This section is populated at **L4 and above**. At L1–L3, set
`counterargumentAnalysis` to `null`.

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
