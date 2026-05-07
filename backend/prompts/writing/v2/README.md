# Writing Coach Prompts — v2 (Sprint 2.6)

Composed system prompts for the Gemini IELTS Writing grader. v2 layers four
quality upgrades on top of v1:

1. **Concrete band descriptors** in `shared/persona_vn_examiner.md` (Band 4–9
   bullet evidence markers, not just "familiar").
2. **Validation rules** in `shared/strict_grammar_check.md` — mistake count
   floors by band, word count caps, band consistency, Vietlish detection
   floor, improved-essay realism.
3. **Chain-of-thought + self-validation checklist** in
   `shared/output_schema_instructions.md` — 8-step grading process before
   output, Pre-Output Checklist before returning JSON.
4. **Few-shot calibration files** in `calibration/l1-l5_examples.md` — pinned
   examples per level so the model has anchors for what counts as a Band-X
   essay and the minimum mistake count expected.

## Compose order

The loader (`services/writing_prompt_loader.py`) concatenates files in this
order, separated by `\n\n---\n\n`:

1. `shared/persona_vn_examiner.md`
2. `shared/strict_grammar_check.md`
3. `shared/output_schema_instructions.md`
4. `calibration/l{N}_examples.md` (NEW in v2 — only loaded for v2)
5. `system_l{N}_<persona>.md`

Then `{{FORM_OF_ADDRESS}}` is replaced with the user's chosen pronoun.

## Selection

Set `WRITING_PROMPT_VERSION=v2` in the environment (default in `config.py` is
`v1` until A/B testing confirms v2 is at least as good as v1). The loader
exposes `WritingPromptLoader(version="v2")` for explicit per-instance
selection.

## Quality bug v2 addresses

**Essay 0caf5e59 production bug:** graded at Band 5 with **zero** mistakes
detected, which is mathematically impossible per IELTS band descriptors. v1
prompts said "find every error" but had no enforced floor. v2's Rule 1
enforces a per-band mistake count floor (≤4.5 → 12+, 5.0–5.5 → 8–12, etc.) and
the L1 calibration file pins this with a real worked example.

## A/B test plan

After deploy, set `WRITING_PROMPT_VERSION=v2` for a sample of essays and
compare:

```sql
SELECT
    prompt_version,
    COUNT(*)                                                AS essay_count,
    AVG(overall_band_score)                                 AS avg_band,
    AVG(jsonb_array_length(feedback_json->'mistakeAnalysis')) AS avg_mistakes,
    SUM(CASE WHEN jsonb_array_length(feedback_json->'mistakeAnalysis') = 0
             AND overall_band_score < 7
             THEN 1 ELSE 0 END)                             AS zero_mistake_low_band_essays
FROM writing_feedback
WHERE created_at > '2026-05-07'
GROUP BY prompt_version;
```

Expected: v2 has higher `avg_mistakes` for low-band essays, similar `avg_band`
overall, and `zero_mistake_low_band_essays` should drop to ~0.
