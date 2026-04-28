# Audit Phase B Post-Dogfood — 2026-04-25

Branch: `fix/vocab-bank-post-dogfood-improvements`  
Commits reviewed: `cfe7ce3..8b05373`  
Spec reference: `PROMPT_CLAUDE_CODE_POST_DOGFOOD.md` (file not present in repo; audited against the prompt specification provided for this review)

## Overall verdict

❌ BLOCK

The branch improves several important dogfood pain points: `and` phrases are now explicitly banned, Guard 6 is materially stronger, migration `020` is real and idempotent, and the UI now shows bilingual definitions plus source-type badges. However, one of the core extraction root causes is still not actually closed: `evidence_substring` remains optional in the extractor schema and the guard explicitly skips validation when it is missing, so hallucinated or weakly-grounded new items can still pass. In addition, the new “link back to source response” UX is currently wired to the wrong result-page query parameter, so the feature does not work as shipped. Because the prompt set a strict merge bar for the root-cause fixes, this branch should not merge yet.

## Status matrix

| Item | Status | Notes |
|------|--------|-------|
| 1.1 And-phrase rejection | ✅ | Prompt bans `"and"` phrases and Guard `0b` rejects them at application level |
| 1.2 Evidence substring | ❌ | `evidence_substring` is still optional; missing field on new extraction still passes guards |
| 1.3 Guard 6 same-root | ✅ | Probe cases passed via prefix/share-root, Levenshtein, and semantic cluster checks |
| 1.4 Category accuracy | ⚠️ | Prompt is clearer, but borderline examples are still thinner than spec asked for |
| 2.1 Toast notification | ⚠️ | Endpoint exists with flag/RLS pattern, but contract drifted to `session_id` and polling is only 2 delayed attempts, not `3s × 10` |
| 2.2 Link back to source | ❌ | Link uses `result.html?session_id=...` while result page reads `?id=...`; feature is broken |
| 2.3 Badges + bilingual + suggestion | ✅ | Badges render by source type; EN/VI + `suggestion` render; old data does not crash |
| 3 Migration 020 | ✅ | File exists, applies on staging, re-applies idempotently, rollback comments present |
| 4 Anti-pattern (cross-file) | ✅ | Core dependent files were updated together; no obvious “fix hẹp bỏ sót file” gap in changed surface |
| 4 Anti-pattern (page-parity) | ✅ | No new page added; touched pages keep Supabase CDN + `api.js` + `initSupabase()` order |
| 5 Regression | NO REGRESSION (local) | `test_vocab_guards` and `test_grammar_smoke` pass; live RLS pytest skipped locally due missing test-user env |
| 6 Cost & perf | ⚠️ | Prompt is longer but still Haiku; `/recent` polling is lighter than spec, but endpoint has no explicit rate limit |
| 7 Edge cases | ⚠️ | Legacy rows stay render-safe, but the same backward-compat path also lets new no-evidence items slip through |

## Findings

### [HIGH] - `evidence_substring` is not actually required for new extractions
- Location: [backend/services/vocab_extractor.py:57-65](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_extractor.py:57), [backend/services/vocab_guards.py:184-187](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_guards.py:184)
- Description:
  `VocabItem.evidence_substring` still has a default empty string instead of being required, and Guard 8 only runs `if evidence_substring:`. That means a new Claude extraction that omits the field entirely will still pass validation, which is exactly the loophole this dogfood fix was supposed to close.
- Impact:
  The hallucination/grounding root cause is only partially addressed. A malformed or weakly grounded extraction can still enter `user_vocabulary` without verbatim evidence, so the branch does not yet meet the strict merge condition for root-cause quality fixes.
- Reproduction:
  ```bash
  cd backend && ../backend/venv/bin/python - <<'PY'
  from services.vocab_guards import run_all_guards
  item = {
      'headword':'utilize',
      'context_sentence':'Students can utilize digital tools to enhance their learning experience.',
      'reason':'good',
      'category':'topic'
  }
  transcript='I think technology has a significant impact on education. Students can utilize digital tools to enhance their learning experience.'
  print(run_all_guards(item, transcript, 'used_well', [], used_well_headwords=set()))
  PY
  ```
  Output observed: `(True, None)`
- Suggested fix:
  Make `evidence_substring` required for new extraction payloads in `VocabItem`, and make Guard 8 reject empty/missing evidence for all AI-extracted items. Keep the legacy-null compatibility only at render/storage level, not in the extraction acceptance path.

### [HIGH] - Source link back to result page is wired to the wrong query contract
- Location: [frontend/js/my-vocabulary.js:155-158](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:155), [frontend/pages/result.html:952-956](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:952)
- Description:
  The new source link uses `result.html?session_id=...`, but the result page reads `id` from the query string (`params.get('id')`). So auto-extracted vocab entries render a clickable source link that lands on the result page without the parameter the page actually expects.
- Impact:
  One of the three UX fixes is functionally broken. Users clicking the source link will not reliably reach the originating result page, which undermines the intended “review in context” workflow.
- Reproduction:
  - Inspect rendered link HTML from `my-vocabulary.js`: `href="result.html?session_id=..."`
  - Compare with result-page loader:
    `var sessionId = params.get('id');`
  - Result page then shows `Thiếu session ID trong URL.`
- Suggested fix:
  Align the contract. Either generate `result.html?id=${session_id}` from the vocab page, or update the result page to accept `session_id` as an alias consistently. If the intended source of truth is `response_id`, wire that explicitly end-to-end instead of overloading session semantics.

### [MEDIUM] - Recent-vocab toast flow drifted from the specified response-level contract
- Location: [backend/routers/vocabulary_bank.py:143-166](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/vocabulary_bank.py:143), [frontend/pages/result.html:1126-1137](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:1126)
- Description:
  The implementation is session-scoped (`session_id`) instead of response-scoped (`response_id`), and the polling logic is two delayed attempts (`8s`, `18s`) rather than the specified `3s × max 10 attempts`. The backend route itself is still user-scoped and flag-gated, but the contract is looser than spec and may miss late background completions or conflate items across a multi-response session.
- Impact:
  The toast likely works for common single-response practice flows, but it does not match the intended contract and may be less reliable than specified.
- Reproduction:
  - Backend route requires `session_id`, not `response_id`
  - Frontend fetches `/api/vocabulary/bank/recent?session_id=...`
  - Poll schedule is `[8000, 18000]`, not 10 attempts
- Suggested fix:
  Decide whether the feature should truly be response-scoped or session-scoped, then align backend and frontend consistently. If the spec is still authoritative, switch to `response_id` and the requested polling cadence.

### [LOW] - Category-classification prompt is improved but still thinner than requested
- Location: [backend/services/vocab_extractor.py:42-50](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_extractor.py:42)
- Description:
  The prompt now clearly states that contextually correct simple words are not `needs_review`, which is the right direction. But it still only includes a small number of borderline examples and does not fully meet the “2–3 borderline examples” expectation in the spec.
- Impact:
  This is not a deterministic blocker, but category quality will still need human dogfood rather than being strongly anchored by prompt examples alone.
- Reproduction:
  Read the current `Rules:` block — it contains one explicit `needs_review` example and one “NOT needs_review” example, but not a broader set of borderline contrasts.
- Suggested fix:
  Add 1–2 more short borderline examples, especially “used correctly but simple → `used_well`, not `needs_review`” and one borderline collocation case.

### [LOW] - VI-only definition fallback renders with a leading separator
- Location: [frontend/js/my-vocabulary.js:140-144](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:140)
- Description:
  The fallback for old rows without `definition_en` still renders the Vietnamese definition safely, but it prepends `·` even when there is no English text before it.
- Impact:
  This does not break rendering, but it looks slightly unfinished on legacy rows.
- Reproduction:
  Render an item with `definition_en = null` and `definition_vi != null`; the output starts with `· <definition_vi>`.
- Suggested fix:
  Only render the separator when both EN and VI definitions exist.

## Tests run

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py -q`
  - Result: `33 passed`
- `cd backend && ../backend/venv/bin/python -m pytest tests/test_grammar_smoke.py -q`
  - Result: `4 passed`
- `zsh -lc 'set -a; source backend/.env; psql "$DATABASE_URL" -f backend/migrations/020_vocab_bank_dogfood_improvements.sql && psql "$DATABASE_URL" -c "\d user_vocabulary" | grep -E "evidence_substring|suggestion|definition_en"'`
  - Result: migration applied successfully; all 3 columns present on staging
- Re-apply idempotency check:
  - `zsh -lc 'set -a; source backend/.env; psql "$DATABASE_URL" -f backend/migrations/020_vocab_bank_dogfood_improvements.sql'`
  - Result: `NOTICE ... already exists, skipping`; migration is idempotent
- `zsh -lc 'set -a; source backend/.env; cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py -v'`
  - Result: `3 skipped` (`RLS_TEST_USER_*` env vars not present locally)
- Guard probes:
  - `and_phrase` → `False guard_0_and_phrase`
  - `evidence_missing_headword` → `False guard_8_evidence_mismatch`
  - `evidence_not_in_transcript` → `False guard_8_evidence_mismatch`
  - `same_cluster_rejuvenate_reinvigorate` → `False guard_6_levenshtein_duplicate`
  - `derivational_evaluation` → `False guard_6_levenshtein_duplicate`
  - `unrelated_happy_beneficial` → `True None`
  - `levenshtein_cat_catch` → `False guard_6_levenshtein_duplicate`
- Guard 8 loophole probe:
  - Item without `evidence_substring` passed: `(True, None)`

## Merge recommendation

- ✅ APPROVE: 0 CRITICAL + 0 HIGH
- ⚠️ CONDITIONAL: 0 CRITICAL + ≤2 HIGH với fix path rõ
- ❌ BLOCK: ≥1 CRITICAL hoặc regression

**Current decision: ❌ BLOCK**

Rationale:
- No regression was detected in the local test surface.
- Migration 020 is real and safe.
- But one of the key extraction root-cause fixes (`evidence_substring`) is still incomplete, and the new source-link UX is currently broken by a frontend/result-page contract mismatch.
- Under the prompt’s strict merge rule for FP-root-cause fixes, this branch should not merge until those two gaps are closed.

## Recommended follow-up

- Make `evidence_substring` mandatory for all new AI extraction items, and reject empty evidence at guard level before persistence.
- Fix the source-link contract (`result.html?id=...` or consistent alias handling) and verify the link works for auto-extracted entries while manual entries remain link-free.
- Decide whether `/recent` should stay session-scoped or be corrected to the specified response-scoped contract; align polling behavior with that choice.
- After the fix, rerun dogfood session 2 (≥10 transcripts) to re-measure FP rate.
  - Target: FP rate `<15%` after this fix batch
  - If FP rate remains `>15%`, continue tuning extraction quality before broader rollout
