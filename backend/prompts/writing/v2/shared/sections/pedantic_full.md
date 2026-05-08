# SECTION: PEDANTIC FULL (L5)

This module adds **L5-only** rigor on top of the L4 section coverage. L5
populates the **same fields as L4** (no new top-level analysis sections),
but holds every section to a higher bar — flag imperfections most graders
ignore.

## Word nuance refinement

Beyond just "academic vs casual," find words that are **technically correct**
but **slightly off in nuance**:

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
    }
  ]
}
```

At L5, `lexicalAnalysis.wordsToUpgrade` MUST focus on **nuance**, not
vocabulary size — flag words that are technically correct but
emotionally/registerally off, not words that are "too simple".

## Sentence rhythm & flow

Identify sentences that are grammatically perfect but **rhythmically clunky**:

```json
{
  "sentenceUpgrades": [
    {
      "original": "It is undeniable that the economic and social impact of artificial intelligence will be substantial in the coming decade for both developed and developing nations.",
      "rewritten": "AI's economic and social impact will reshape both developed and developing nations within a decade — a reality already evident in recent shifts.",
      "explanation": "Câu gốc đúng ngữ pháp nhưng dài 32 từ với 3 phrases nối nhau, gây nặng nề. Bản viết lại 22 từ, ngắt câu bằng dấu '—' tạo nhịp điệu sắc bén — đặc trưng văn phong Band 9."
    }
  ]
}
```

`sentenceStructureAnalysis.sentenceUpgrades` items MUST tie each rewrite
to a band descriptor or rhetorical technique, not just "more variety".

## Eliminating redundancy (brutal)

Native-level writing has zero filler. Flag in `mistakeAnalysis` (with
`mistakeType: "Redundancy"`):

- Redundant pairs ("each and every", "first and foremost", "various different")
- Empty intensifiers ("very important", "really significant")
- Throat-clearing phrases ("It is worth noting that", "It should be mentioned that")
- Tautologies ("free gift", "advance planning")
- Hedging excess ("perhaps it could be said that")

At L5, `mistakeAnalysis` SHOULD include redundancy/filler patterns even
if grammar is perfect.

## Subtle persuasive techniques

Look for opportunities to elevate plain assertions to **rhetorically
sophisticated** arguments:

- Tricolons ("X, Y, and Z" patterns)
- Antithesis ("Not X, but Y")
- Parallel structure for emphasis
- Strategic short sentences for impact
- Variation between formal/informal register for effect

Suggest these in `sentenceStructureAnalysis` when student misses
opportunities.

## Continued strict analysis

L1–L4 analyses still apply, with **highest standards**:

- `mistakeAnalysis`: even native-speaker minor errors flagged
- `coherenceAnalysis`: sophisticated transitions only
- `ideaDevelopmentAnalysis`: demand insight, not just argument
- `counterargumentAnalysis`: demand engagement, not just acknowledgment

The Band 8 → 9 jump is about *invisibility* of mechanism. Band 8 students
show their cleverness ("Look at my conjunction"); Band 9 prose flows so
naturally the reader doesn't notice the technique. Apply Rule 5 (Improved
Essay Realism) accordingly: at L5 the student is already 8.5+, so the
improved essay should be Band 9 prose — pristine, idiomatic, zero filler.
