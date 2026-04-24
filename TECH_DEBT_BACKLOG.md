# TECH_DEBT_BACKLOG

Short list of non-blocking technical debt remaining after the stabilization / audit pass.

---

## 1. Full-test recovery after timeout
**Status:** not fully solved  
**Priority:** High

### Problem
`_bg_finalize_full_test()` now has a grace period, but the flow is still not truly self-healing if grading finishes later than the timeout window.

### Risk
A slow full test can still land in `analysis_failed` and require manual admin recovery.

### Suggested future fix
- Add a safe re-finalize path for `submitted` / `analysis_failed` full-test sessions once all responses are truly graded
- Prefer automatic retry or resumable finalization over manual repair

---

## 2. Token accumulation is still not atomic
**Status:** partially improved  
**Priority:** Medium

### Problem
`sessions.tokens_used` is now additive, but still uses a read-then-write pattern.

### Risk
Concurrent grading can lose increments.

### Suggested future fix
- Replace with atomic DB-side increment
- Or explicitly document token usage as approximate only

---

## 3. Grammar `compare_with` graph is still asymmetric
**Status:** usable but not clean  
**Priority:** Medium

### Problem
Slug validity is much better now, but many `compare_with` relationships are still one-way.

### Risk
Comparison/discovery features may feel inconsistent or incomplete.

### Suggested future fix
- Add a content integrity pass for reciprocal `compare_with` relationships
- Decide whether symmetry is required or optional by design

---

## 4. Grammar saved/viewed slug validation
**Status:** still open  
**Priority:** Medium

### Problem
Grammar user-data rows may still accept arbitrary slugs without validating article existence.

### Risk
Orphaned saved/viewed rows can accumulate if slugs change or invalid values are written.

### Suggested future fix
- Validate slug existence at write time
- Or add a cleanup/reporting path for stale rows

---

## 5. Legacy `responses.py` router
**Status:** needs decision  
**Priority:** Medium

### Problem
Legacy audio-only response flow has been identified as likely obsolete, but final removal/quarantine decision is still pending.

### Risk
Unused routes remain callable and can preserve stale assumptions.

### Suggested future fix
- Confirm whether any production path still depends on it
- Remove or explicitly quarantine if unused

---

## 6. Admin regrade / rebuild semantics can be clearer
**Status:** much improved, still worth polishing  
**Priority:** Low-Medium

### Problem
Admin flows are more honest now, but naming and UX could still be clearer about:
- full regrade
- partial repair
- rebuild summary

### Risk
Operators may still misunderstand what each action guarantees.

### Suggested future fix
- Tighten admin labels and descriptions
- Make partial-failure states more explicit in UI

---

## 7. Result pipeline readiness / recovery can be unified further
**Status:** improved, not final  
**Priority:** Low-Medium

### Problem
Readiness, completion, and recovery semantics are much better than before, but some paths are still more practical than elegant.

### Risk
Future features may accidentally reintroduce drift if they bypass the canonical session truth.

### Suggested future fix
- Centralize finalization/recovery rules even more
- Keep all UI surfaces reading canonical `sessions.*` truth only after completion

---

## 8. Grammar metadata quality can still improve
**Status:** stable enough for current use  
**Priority:** Low

### Problem
Metadata is now structurally usable, but still not perfect for future recommendation/pathway features.

### Examples
- some pathways may still be broad
- some `next_articles` are “related” rather than true next steps
- some semantic relationships may need another audit later

### Suggested future fix
- run a future metadata refinement pass focused on pedagogy, not just structural correctness

---

## 9. Vocab and Grammar content loaders are separate copies (not shared)
**Status:** intentional for Phase A, deferred  
**Priority:** Low

### Problem
`services/vocab_content.py` is a hand-adapted copy of `services/grammar_content.py`.
Both load Markdown files from separate directories but share the same core parsing pattern.

### Risk
If parsing logic needs to change (e.g., Markdown extensions, frontmatter validation),
it must be updated in two places.

### Suggested future fix
- Extract a shared `BaseContentService` or a generic loader function that both services use
- `GrammarContentService` and `VocabContentService` become thin subclasses with different dirs and schemas
- Phase B is the right time to do this, not before: premature abstraction would slow Phase A and risk regressions

### Non-goals
- Do NOT refactor in Phase A. Ship content first, then abstract.

---

# Suggested next review order

1. Full-test recovery after timeout  
2. Token accumulation atomicity  
3. Grammar slug validation  
4. Legacy responses router decision  
5. Admin semantics polish  
6. Grammar compare/pathway quality pass

---

# Notes
- This backlog intentionally excludes issues already treated as fixed in the recent stabilization pass.
- This is a prioritization list, not a promise to solve everything immediately.
- Production smoke tests should be run before starting a new major feature pass.
