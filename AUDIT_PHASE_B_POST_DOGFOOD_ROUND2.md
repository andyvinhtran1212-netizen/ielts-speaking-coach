# Audit Phase B Post-Dogfood — Round 2

Branch: `fix/vocab-bank-post-dogfood-improvements`  
Commits reviewed: `8b05373..eb4adf1`

## Final verdict

✅ APPROVE

Both HIGH findings from the previous audit are now resolved. `evidence_substring` is required in the extractor schema and Guard 8 now rejects empty/missing evidence at acceptance time, which closes the previous grounding loophole. The source link contract is also aligned: `my-vocabulary.js` now generates `result.html?id=...`, matching the result page loader. Regression check passed with `test_vocab_guards.py` increasing to `34 passed`.

## Blockers

None.

## Medium issues

None in this round’s scope.

## Low issues

- `pytest_asyncio` still emits the same deprecation warning about `asyncio_default_fixture_loop_scope` being unset. This does not affect correctness for this branch.

## What is now verified

- **HIGH 1 resolved:** `evidence_substring` is mandatory in the extractor schema.
  - Evidence: [backend/services/vocab_extractor.py:57-60](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_extractor.py:57)
- **HIGH 1 resolved:** Guard 8 now rejects empty/missing evidence instead of skipping validation.
  - Evidence: [backend/services/vocab_guards.py:189-194](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_guards.py:189)
  - Probe:
    ```text
    (False, 'guard_8_evidence_required')
    ```
- **HIGH 2 resolved:** source link now uses `?id=` and matches the result page contract.
  - Link generation: [frontend/js/my-vocabulary.js:155-157](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:155)
  - Result page loader: [frontend/pages/result.html:952-954](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:952)
- **Regression check passed:** `test_vocab_guards.py`
  - Result: `34 passed`

## Tests run

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py -q`
  - Result: `34 passed`
- Guard 8 probe:
  - `run_all_guards(... evidence_substring='' ...)`
  - Result: `(False, 'guard_8_evidence_required')`

## Decision

**APPROVE** — 2 HIGH resolved + no regression.
