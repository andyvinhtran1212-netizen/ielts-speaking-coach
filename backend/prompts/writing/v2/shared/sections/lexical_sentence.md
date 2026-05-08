# SECTION: LEXICAL SENTENCE (L4+)

These sections are populated at **L4 and above**. At L1–L3, set both
`lexicalAnalysis` and `sentenceStructureAnalysis` to `null`.

## `lexicalAnalysis` — approach

Find words that are **safe but unmemorable**. Suggest academic upgrades:

```json
{
  "wordsToUpgrade": [
    {
      "original": "important",
      "context": "Education is important for development",
      "suggestions": ["pivotal", "indispensable", "instrumental", "cardinal"],
      "category": "Generic adjective → Specific academic term"
    },
    {
      "original": "many",
      "context": "Many people argue that...",
      "suggestions": ["a substantial proportion of", "numerous", "a significant number of"],
      "category": "Quantifier → Academic phrase"
    },
    {
      "original": "show",
      "context": "Studies show that...",
      "suggestions": ["demonstrate", "indicate", "reveal", "establish"],
      "category": "Generic verb → Academic verb"
    }
  ]
}
```

Aim for **6–12 word upgrades** per essay. Each upgrade MUST have ≥3
entries in `suggestions` (variety is the point).

Categories to flag:
- Generic adjectives: good, bad, big, small, important
- Generic verbs: do, make, get, show, say
- Generic nouns: thing, way, problem, issue
- Vague quantifiers: many, some, a lot
- Cliché phrases: "In today's modern world", "Last but not least"

## `sentenceStructureAnalysis` — approach

Find sentences that are **grammatically correct but structurally simple**.
Suggest variety:

```json
{
  "sentenceUpgrades": [
    {
      "original": "Many people use technology. They find it useful for work.",
      "rewritten": "Increasingly, technology has become indispensable for professionals, who rely on it to streamline their daily workflows.",
      "explanation": "Kết hợp 2 câu đơn thành 1 câu phức với mệnh đề quan hệ — thể hiện khả năng dùng cấu trúc Band 7+."
    },
    {
      "original": "Education is important. It helps people get jobs.",
      "rewritten": "Education plays a pivotal role in employability, equipping individuals with both qualifications and transferable skills sought by employers.",
      "explanation": "Thay 2 câu SVO đơn giản bằng 1 câu với participle phrase — cấu trúc đa dạng đặc trưng Band 8.0+."
    }
  ]
}
```

Aim for **4–8 sentence upgrades** per essay. Each upgrade MUST have an
`explanation` field tying the rewrite to a band descriptor (e.g., "đặc
trưng Band 8.0+").

Variety types to suggest:
- Complex sentences (subordinate clauses)
- Compound-complex
- Participle phrases
- Cleft sentences ("It is X that...")
- Inverted structures (for emphasis)
- Rhetorical questions (sparingly)

> **Note on the Phase 1.5c override:** When the user message contains a
> sentence-structure history block, that block instructs Gemini to emit
> `sentenceStructureAnalysis` in the structured Phase-1.5c shape
> (`{summary, common_issues, complexity_indicator, focus_theme, ...}`)
> instead of the legacy `{sentenceUpgrades: [...]}` shape. The override
> takes precedence — both shapes parse downstream.
