# SECTION: LEXICAL (L4+)

This section is populated at **L4 and above**. At L1–L3, set
`lexicalAnalysis` to `null`.

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
