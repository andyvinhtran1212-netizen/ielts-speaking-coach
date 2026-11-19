# Rollout and rollback

## Preconditions

- This spec merged on `staging`. This feature adds no migration, but the import writes `quiz_banks` as service_role, which fails with 42501 until migration 501 (`course_bank_service_write`, #2368) is applied. Apply 501 on each environment, and confirm `has_function_privilege('service_role', 'public.grammar_quiz_allowed_code(text)', 'EXECUTE')` is true there, before that environment's import. New optional settings `SENTENCE_LAB_MODEL`, `SENTENCE_LAB_REASONING_EFFORT` and `SENTENCE_LAB_MAX_CALLS_PER_USER_PER_DAY` and `SENTENCE_LAB_ENABLED` have safe code defaults. `SENTENCE_LAB_PROMPT` must be set on Railway staging, then production, to the revised grading prompt v2 that passed calibration (sha256 `4ad07f49d3175645f2fc36d66e68e7d81b426848196574f8b74842f351c57ed2`, kept off the repository). Never use the pack's original `private/ai_grader_prompt.md`, whose text is public in #2366's history. Setting it is an env change that needs owner approval. Production additionally needs Content Manager and Security Auditor review of the exact text and a separate owner approval. Until the setting is present, lab grading stays paused. `OPENAI_API_KEY` present on Railway staging and production (already used by Whisper).
- The owner's typed approval for each DB write: staging import, then production import with a named window.

## Staging

- Merge the implementation PR after Code Reviewer, Security Auditor and CI. Apply migration 501 on staging and verify the grant (Preconditions). Import to staging (dry run, `--commit`, then `--publish` once the code is deployed), run calibration, then assign S01 to a test learner and complete form → coach → rewrite.

## Production

- Promote `staging` → `main` through the normal promotion PR. Under separate approval, apply migration 501 on production and verify the grant, then run the importer with `--commit --publish` against production and verify 45/540 counts and the admin picker.

## Rollback and repair

- Pause in place (FR-008): set `SENTENCE_LAB_ENABLED=false` on Railway (env change, owner approval). Lab submit and rewrite return 503 with the work kept; nothing reaches the Course 1 grader. Do not revert the lab code while any lab assignment exists: assigned learners open Course banks through the assignment even when `is_published=false`, so a revert would route them to the Course 1 grader and release reference answers early. A full code revert requires first removing every class assignment item that points at a `C5-SL-S%` bank, then verifying with an assigned test learner that opening and submitting are both refused.
- Content repair: re-run the importer with a corrected package; it updates the same 45 banks by code.

## Observability

- `ai_usage_logs` rows `feature='sentence_lab'` (call count, tokens, model). Grader failures log at warning level with the item id and failure class, never the learner text or key. Owner: Andy.
