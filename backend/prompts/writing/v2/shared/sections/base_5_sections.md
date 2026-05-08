# SECTION: BASE 5 SECTIONS (L1+)

These sections are populated at **every level** (L1 through L5). The
floor counts and tightness vary per level — see each level's
`Validation Rules Specific to L{N}` for the level-specific tightening.

## `mistakeAnalysis` — approach (cumulative L1+)

Populate `mistakeAnalysis` with every error found in the essay. Categorise
each by `criterion` (Task Response, Coherence & Cohesion, Lexical Resource,
or Grammatical Range & Accuracy).

Common categories to flag:

1. **Subject-verb agreement** (most common at lower bands)
2. **Verb tenses** (consistency)
3. **Articles** (a/an/the)
4. **Prepositions**
5. **Spelling**
6. **Singular/plural forms**
7. **Word order**
8. **Word choice / collocation** (avoid filler "very", "really")
9. **Vietlish patterns** (Rule 4 — at band ≤ 6.5 there must be ≥ 1 per 250 words)

Per-band typical distribution comes from `strict_grammar_check.md` Rule 1
(Mistake Count Consistency with Band) — but never invent mistakes to hit
a floor. Step 6.1 (mistake authenticity check) takes precedence: an entry
where `original == suggestion` after Unicode normalisation is removed,
and the band is adjusted upward if the cleanup leaves the count low.

## `improvedEssay` — approach (cumulative L1+)

Rewrite the essay at **at most 1.5 bands above** the student's current band
(Rule 5 — Improved Essay Realism). The improved version must remain something
the student could reasonably learn from; rewriting Band 4 prose at Band 9 is
counterproductive.

The rewrite preserves the student's argument and structure; it fixes the
grammar/coherence/word-choice issues you flagged in the analysis sections.

## `criteriaFeedback` — approach (cumulative L1+)

For each of the 4 IELTS criteria (`mainCriterion`, `coherenceCohesion`,
`lexicalResource`, `grammaticalRange`):

- `title`: the criterion name in English (e.g., "Task Response").
- `explanation`: Vietnamese, 1–2 sentences explaining what the criterion
  measures.
- `feedback`: Vietnamese, specific feedback for THIS essay (not generic).
- `bandScore`: integer 0–9 (no half-bands here — half-bands are only on
  `overallBandScore`).

The 4 criterion scores must sit within 1.5 of each other (Rule 3 — Band
Consistency). The `overallBandScore` is the average rounded to nearest 0.5.

## `keyTakeaways` — approach (cumulative L1+)

- `strengths`: Vietnamese array of 2–4 specific strengths (not generic).
- `areasForImprovement`: Vietnamese array of 2–4 specific areas, prioritised
  by impact on band score.

Both arrays are populated at every level — they are part of the always-on
output, not a level-conditional addition.

## `aiContentAnalysis` — approach (cumulative L1+)

Always populated. `likelihood` is an integer 0–100 estimating AI authorship
probability; `explanation` is a Vietnamese sentence justifying the estimate.
