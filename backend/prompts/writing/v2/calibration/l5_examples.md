# Level 5 Calibration Examples

These examples anchor your expected output for Band 8.5–9.0 essays at L5.
At this level, the bottleneck is **invisibility of mechanism** — Band 9 prose
flows so naturally the reader doesn't notice the technique.

## Example 1: Band 8.5 essay (Task 2, ~300 words)

### Profile

Wide vocabulary, varied sentence structures, sophisticated arguments. Falls
short of Band 9 because of:
- 2-3 throat-clearing phrases ("It is undeniable that...", "It should be noted that...")
- 1-2 sentences with clunky rhythm (32-word run-ons)
- Word nuance occasionally off ("happy" used in economic context where
  "prosperous" or "content" would land better)

### Expected lexicalAnalysis (focus: nuance, not size)

```json
{
  "wordsToUpgrade": [
    {
      "original": "happy",
      "context": "Citizens become happy when economy improves",
      "suggestions": ["content", "satisfied", "fulfilled", "prosperous"],
      "category": "Nuance: 'happy' implies emotion; 'content/prosperous' fits economic context better"
    },
    {
      "original": "say",
      "context": "Critics say technology is harmful",
      "suggestions": ["contend", "assert", "maintain", "posit"],
      "category": "Nuance: 'say' is neutral; the others convey conviction strength of critics' position"
    },
    {
      "original": "big problem",
      "context": "This is a big problem for society",
      "suggestions": ["pressing concern", "acute challenge", "systemic issue"],
      "category": "Nuance: 'big' is dimensional; 'pressing/acute' conveys urgency tied to social context"
    }
  ]
}
```

### Expected sentenceStructureAnalysis (rhythm + flow)

```json
{
  "sentenceUpgrades": [
    {
      "original": "It is undeniable that the economic and social impact of artificial intelligence will be substantial in the coming decade for both developed and developing nations.",
      "rewritten": "AI's economic and social impact will reshape both developed and developing nations within a decade — a reality already evident in recent shifts.",
      "explanation": "Câu gốc 32 từ với 3 phrases nối nhau tạo cảm giác nặng nề. Band 9 prose ngắn (22 từ), dùng dấu '—' tạo nhịp điệu sắc bén. 'It is undeniable that' là throat-clearing không cần thiết — Band 9 không hedge."
    }
  ]
}
```

### Expected mistakeAnalysis (redundancy + filler at L5)

Even with perfect grammar, flag redundancy as `mistakeType: "Redundancy"`:

```json
[
  {
    "original": "It is important to note that",
    "mistakeType": "Redundancy - Throat-clearing phrase",
    "explanation": "Cụm này không thêm nội dung gì, chỉ trì hoãn ý chính. Band 9 viết thẳng không hedge.",
    "suggestion": "(remove entirely; start with the substantive claim)",
    "criterion": "Lexical Resource"
  },
  {
    "original": "very important",
    "mistakeType": "Redundancy - Empty intensifier",
    "explanation": "'Very' không nâng cấp 'important' — chỉ làm câu lê thê. Band 9 chọn 1 từ chính xác (pivotal, crucial) thay vì cộng intensifier.",
    "suggestion": "pivotal / crucial / indispensable",
    "criterion": "Lexical Resource"
  }
]
```

### Criteria scores

Typical: TR 9, CC 8, LR 8 (nuance + redundancy bottleneck), GRA 9. Average →
8.5 → round to 8.5.

**Why LR=8 not 9?** Band 9 LR requires "wide range used **naturally and
accurately**". The 2-3 throat-clearing phrases + 1-2 nuance slips drop it to 8.

## Example 2: Band 9.0 essay

### Profile

Pristine. No redundancy. Word nuance precise. Sentence rhythm varied and
purposeful. Cohesion invisible (you don't notice the linkers).

### Expected output

- `wordsToUpgrade`: 0-3 items (genuinely nothing to flag in most paragraphs)
- `sentenceUpgrades`: 0-2 items (only if a Band 9 essay has even one structural
  improvement opportunity)
- `mistakeAnalysis`: 0-2 items (Rule 1)
- `keyTakeaways.strengths`: should be specific to THIS essay, not generic
- `improvedEssay`: at most "Band 9 polish" — a tiny rewrite, not a wholesale
  recomposition. The student is already at the target.

**Caveat:** Genuine Band 9 essays are rare. Default to grading at 8.5 unless
you're confident. A Band 9 essay where you find 5+ words to upgrade is not
actually Band 9 — it's Band 8 you misjudged.

## Pitfalls to avoid at L5

- **Don't pad `lexicalAnalysis` with vocabulary-size suggestions** — at L5,
  upgrade items are about *nuance*, not vocabulary size. "Important" →
  "pivotal" works at L4. At L5, the upgrade has to be *contextually precise*
  (e.g., "say" → "contend" because critics are taking a position).
- **Don't grade Band 9 too easily** — true Band 9 is publishable academic
  prose. If anything in the essay feels "good but" — drop to 8.5.
- **Don't write a Band 9 improved essay for a Band 7 student** — Rule 5 still
  applies even at L5. Improved essay is at most 1.5 bands above the student's
  current band.
