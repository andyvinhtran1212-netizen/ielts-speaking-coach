# Writing Coach Prompts v1

System prompts for Gemini grader, organized in 3 layers:

## Layer 1: Shared modules (loaded for all levels)
- `shared/persona_vn_examiner.md` — AI identity & tone
- `shared/strict_grammar_check.md` — Mandatory grammar audit (all levels)
- `shared/output_schema_instructions.md` — JSON output requirements

## Layer 2: Level-specific (one of 5 loaded per request)
- `system_l1_strict_grammar_police.md` — Band 4.0-5.5
- `system_l2_logic_coach.md` — Band 5.5-6.5
- `system_l3_critical_debater.md` — Band 6.5-7.5
- `system_l4_ruthless_editor.md` — Band 7.5-8.5
- `system_l5_pedantic_linguist.md` — Band 9.0

## Composition

Final prompt = persona + strict_grammar + output_schema + level_specific

Loader replaces `{{FORM_OF_ADDRESS}}` with user's choice (bạn/em/anh/chị).

## Versioning

When prompts evolve, create v2/ directory parallel. Track via `PROMPT_VERSION`
in `WritingPromptLoader`. Database stores `prompt_version` per feedback for
reproducibility.
