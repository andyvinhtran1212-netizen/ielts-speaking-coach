# Level 4 Calibration Examples

These examples anchor your expected output for Band 7.5–8.5 essays at L4.
At this level, `lexicalAnalysis` and `sentenceStructureAnalysis` are the main
value-add — students at this band already write cleanly; the bottleneck is
**lazy lexical and structural choices**.

## Example 1: Band 8.0 essay (Task 2, ~300 words)

### Profile

Clear position, well-extended ideas, good counterargument, sophisticated
linking. Bottleneck: vocabulary is "safe academic" — uses "important",
"significant", "many", "show" repeatedly when more precise alternatives exist.

### Expected lexicalAnalysis (6-12 items)

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
      "original": "many people",
      "context": "Many people argue that...",
      "suggestions": ["a substantial proportion of the population", "numerous individuals", "a significant cohort"],
      "category": "Quantifier → Academic phrase"
    },
    {
      "original": "show",
      "context": "Studies show that...",
      "suggestions": ["demonstrate", "indicate", "reveal", "establish"],
      "category": "Generic verb → Academic verb"
    },
    {
      "original": "things",
      "context": "There are many things to consider",
      "suggestions": ["factors", "considerations", "dimensions", "variables"],
      "category": "Generic noun → Specific term"
    },
    {
      "original": "good",
      "context": "It's good for the economy",
      "suggestions": ["beneficial", "advantageous", "conducive to growth", "salutary"],
      "category": "Generic adjective → Specific academic term"
    },
    {
      "original": "In today's modern world",
      "context": "(opening cliché)",
      "suggestions": ["(remove entirely)", "(start with the substantive claim)", "Contemporary society"],
      "category": "Cliché → Direct claim"
    }
  ]
}
```

### Expected sentenceStructureAnalysis (4-8 items)

```json
{
  "sentenceUpgrades": [
    {
      "original": "Many people use technology. They find it useful for work.",
      "rewritten": "Increasingly, technology has become indispensable for professionals, who rely on it to streamline their daily workflows.",
      "explanation": "Kết hợp 2 câu đơn thành 1 câu phức với mệnh đề quan hệ — đặc trưng Band 8.0+ là flexibility trong cấu trúc."
    },
    {
      "original": "Education is important. It helps people get jobs.",
      "rewritten": "Education plays a pivotal role in employability, equipping individuals with both qualifications and transferable skills sought by employers.",
      "explanation": "Thay 2 câu SVO bằng 1 câu với participle phrase — Band 8 dùng wide range structures, không chỉ SVO chains."
    }
  ]
}
```

### Mistake count

0-3 per Rule 1 for band 7.5+. At this level the rare mistakes are usually
collocation slips or subtle preposition errors, not basic grammar.

### Criteria scores

Typical: TR 8, CC 8, LR 7 (the bottleneck), GRA 8. Average → 7.75 → round to 8.0.

**Why LR=7?** Band 8 LR requires "wide range used naturally and accurately".
This essay's vocabulary is correct but repeats safe academic words. Wide range
+ flexibility = 8; sufficient range with some precision = 7.

## Example 2: Band 7.5 essay

### Profile

Solid Band 7 with one or two glimmers of Band 8 (a sophisticated transition,
a precise word). Lexical range is "sufficient" but not "wide".

### Expected output

- `wordsToUpgrade`: 8-10 items (more than Band 8 because more low-hanging fruit)
- `sentenceUpgrades`: 5-7 items
- `mistakeAnalysis`: 0-3 items (Rule 1)

## Pitfalls to avoid at L4

- **Don't fabricate upgrades** — only flag a word if you can suggest 3+
  genuinely better alternatives. "Important" → ["important"] is not an upgrade.
- **Don't be lazy on examples** — every `lexicalAnalysis.wordsToUpgrade` item
  MUST have ≥3 entries in `suggestions`. Variety is the point.
- **Tie every `sentenceUpgrade.explanation` to a band descriptor** — e.g.,
  "đặc trưng Band 8 flexibility" or "Band 7 → Band 8 jump là từ SVO sang
  variety". Rewrites without explanation are useless.
