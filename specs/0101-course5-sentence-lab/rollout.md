# Rollout and rollback

## Preconditions

- This spec merged on `staging`. No migration. `OPENAI_API_KEY` present on Railway staging and production (already used by Whisper).
- The owner's typed approval for each DB write: staging import, then production import with a named window.

## Staging

- Merge the implementation PR after Code Reviewer, Security Auditor and CI. Import to staging (dry run, `--commit`, then `--publish` once the code is deployed), run calibration, then assign S01 to a test learner and complete form → coach → rewrite.

## Production

- Promote `staging` → `main` through the normal promotion PR. Under separate approval, run the importer with `--commit --publish` against production and verify 45/540 counts and the admin picker.

## Rollback and repair

- Code rollback: revert the implementation; lab banks then fall back to the Course 1 grader, so unpublish the 45 banks first (`update quiz_banks set is_published=false where code like 'C5-SL-S%'`). Stored submissions are additive JSON and stay readable.
- Content repair: re-run the importer with a corrected package; it updates the same 45 banks by code.

## Observability

- `ai_usage_logs` rows `feature='sentence_lab'` (call count, tokens, model). Grader failures log at warning level with the item id and failure class, never the learner text or key. Owner: Andy.
