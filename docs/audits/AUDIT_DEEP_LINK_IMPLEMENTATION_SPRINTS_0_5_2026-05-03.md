# Codex Audit Report — Deep-Link Implementation (Sprints 0-5)

**Audit date:** 2026-05-03  
**Scope:** Full 6-sprint deep-link feature  
**Codex agent verdict:** **FAIL**

## Executive summary

The backend anchor infrastructure is mostly implemented correctly: anchor markers render, declared anchors are exposed, the mapping file is loaded safely, migration 032 is schema-safe, and the anchor drift gate passes. The frontend Result-page and Grammar-page deep-link plumbing is also largely correct: `result.html` carries `anchor`, `grammar.js` scrolls after async article injection, and the heading pulse/offset implementation is clean.

The feature is **not production-ready yet** for one hard reason: live production data shows **`0 / 160` `grammar_recommendations` rows have `recommended_anchor` populated**, so the end-to-end promise “AI feedback lands users on a specific grammar section” is not currently being realized in real usage. There is also a separate user-facing gap on the practice feedback screen: the prominent Quick Grammar Tip card still links to the article top, not the anchor. Those two issues are sufficient to block merging Sprint 5 as “feature complete”.

## Per-dimension findings

### Dimension 1 — Backend code quality
**Verdict:** **WARN**

**Findings:**
- The renderer implementation is correct and defensive enough for the shipped marker format. `grammar_content.py` converts only `<!-- anchor: ... -->` comments via `_ANCHOR_MARKER_RE` at [backend/services/grammar_content.py:35](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:35) and the replacement happens after Markdown render at [backend/services/grammar_content.py:133-139](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:133). This avoids touching Vietnamese body text and does not depend on DOM parsing.
- Loader anchor exposure is backward-compatible. `anchors` is always present and falls back to `[]` when frontmatter omits it at [backend/services/grammar_content.py:176-183](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:176). Existing callers do not need schema branching.
- Defensive `deferred_until` skipping is implemented correctly in `_load_mappings()` at [backend/services/grammar_content.py:488-509](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:488).
- Migration 032 is idempotent and type-safe for frontend usage: `TEXT`, nullable, `ADD COLUMN IF NOT EXISTS` at [backend/migrations/032_add_recommended_anchor_to_grammar_recommendations.sql:1-16](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/032_add_recommended_anchor_to_grammar_recommendations.sql:1). Rollback is operationally documented at [backend/migrations/032_rollback.sql:1-20](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/032_rollback.sql:1), but dropping the column would discard any populated anchor values.
- The main backend gap is not a crash bug; it is **matcher effectiveness in real data**. `_attach_grammar_recommendations()` resolves slug first, then anchor only within that slug at [backend/services/claude_grader.py:1113-1141](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/claude_grader.py:1113). In production, real issues are still predominantly landing on generic slugs like `articles`, `article-errors`, and `tense-consistency`, while the mapping file mainly covers more specific subtopics. That makes `find_best_anchor()` return `None` for real traffic even though the code path itself works.
- Test coverage is decent but misses the failure mode that matters most. The new suites cover renderer, loader, anchor matching, persistence, and drift, but there is **no integration-style test using production-like issue strings flowing through `find_best_match()` + `find_best_anchor()` together**. That is the blind spot that allowed `recommended_anchor` to stay at `0 / 160` live.

### Dimension 2 — Frontend code quality
**Verdict:** **FAIL**

**Findings:**
- `result.html` is correctly wired for anchors in both link surfaces:
  - inline issue links at [frontend/pages/result.html:856-860](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:856)
  - resource cards at [frontend/pages/result.html:858-860](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:858)
  - `recMatches` now preserves `anchor` at [frontend/pages/result.html:906-915](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:906)
- `grammar.js` scroll/pulse behavior is integrated in the right place. `_scrollToHashAnchor()` runs only after `bodyEl.innerHTML = article.html` at [frontend/js/grammar.js:647-696](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:647); it gracefully warns on missing anchors at [frontend/js/grammar.js:549-556](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:549), and `_pulseAnchorHeading()` only targets the next heading sibling at [frontend/js/grammar.js:568-579](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:568).
- Sticky-header offset is implemented with CSS, not JS magic offsets, at [frontend/pages/grammar-article.html:80-113](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:80).
- **But the practice feedback screen still has a broken deep-link surface.** The prominent Quick Grammar Tip card in `practice.js` builds `href` without `match.anchor` at [frontend/js/practice.js:838-875](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:838), and the recommendation object passed into that card does not preserve `rec.anchor` at [frontend/js/practice.js:884-891](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:884). Only the smaller inline per-issue link was updated at [frontend/js/practice.js:994-1001](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:994).  
  Root cause: Sprint 5 fixed the practice inline link, but not the primary recommendation card on the same screen.

### Dimension 3 — Integration end-to-end
**Verdict:** **FAIL**

**Findings:**
- Field naming is internally consistent where the code path exists:
  - DB column `recommended_anchor` is written at [backend/routers/grading.py:530-543](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grading.py:530)
  - API / response object uses `anchor` at [backend/services/claude_grader.py:1134-1141](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/claude_grader.py:1134)
  - frontend reads `rec.anchor` / `match.anchor` on the Result page
- Backward compatibility for pre-Sprint-4 rows is correct. `NULL` anchor falls back to article-level URLs in all reviewed Sprint 5 ternaries.
- **Live evidence shows the integration is not producing anchored recommendations in real use.** Querying the live DB via `backend/.env` returned:
  - `SELECT COUNT(*) AS total, COUNT(recommended_anchor) AS with_anchor FROM grammar_recommendations;`
  - result: **`160 total`, `0 with_anchor`**
- Additional live evidence shows why:
  - top live slugs are generic: `articles` (72), `tense-consistency` (31), `article-errors` (22)
  - recent rows for `articles` and `tense-consistency` still have `recommended_anchor = NULL`
  - local probe confirms canonical synthetic issue strings can resolve (`"Thiếu mạo từ 'a' trước danh từ đếm được số ít"` → anchor), but production-like issues such as `"Thiếu mạo từ 'the' trước 'future'"` and `"Sai thì hiện tại đơn trong ngữ cảnh quá khứ..."` currently return `None`
- That means the shipped deep-link chain is structurally wired but **not yet functionally effective on live data**. The likely root cause is a combination of:
  - mapping coverage gaps for common real issue phrasings
  - `find_best_match()` choosing broad slugs (`tense-consistency`, `article-errors`) that have no corresponding anchor mappings

### Dimension 4 — Security audit
**Verdict:** **WARN**

**Findings:**
- The prompt’s “known issue: no RLS on four grammar tables” is now stale. Live DB inspection shows:
  - `article_views`, `saved_articles`, and `grammar_recommendations` all have `relrowsecurity = true`
  - those three tables also have SELECT/INSERT/UPDATE/DELETE policies with `USING` / `WITH CHECK` where applicable
- `analytics_events` has `relrowsecurity = true` but no visible row policies in the live `pg_policies` query. That is not a deep-link blocker, but it is worth keeping in view as a separate security/configuration debt.
- No SQL injection issues were found in the Sprint 4 backend anchor path. `recommended_anchor` is passed as a value into Supabase client inserts, not concatenated into raw SQL.
- Hash/XSS risk on Sprint 5 frontend is low. `grammar.js` only decodes the hash and passes it to `document.getElementById()` at [frontend/js/grammar.js:536-550](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:536); it does not inject the hash into HTML.
- The mapping file is loaded with `yaml.safe_load()` both in the runtime loader and the drift script at [backend/services/grammar_content.py:496](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:496) and [backend/scripts/verify_anchor_drift.py:39-53](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/verify_anchor_drift.py:39).

### Dimension 5 — Production readiness
**Verdict:** **FAIL**

**Findings:**
- Deployment compatibility looks fine at the schema/config level:
  - migration 032 already exists and is idempotent
  - no new env vars were introduced in the reviewed Sprint 4/5 code
  - grammar rendering has no `@lru_cache` / memoization that would hold stale article HTML across deploys
- Performance impact of the new mechanics is negligible:
  - one regex pass in article render
  - one extra nullable column in grammar recommendation rows
  - one `requestAnimationFrame` scroll on article load
- The real production-readiness problem is feature effectiveness:
  - **no live anchor population yet**
  - **one major frontend recommendation surface still omits the anchor**
- CI gating is incomplete for this exact merge shape. `.github/workflows/backend-tests.yml` only runs on `pull_request` changes touching `backend/**` or the workflow file at [.github/workflows/backend-tests.yml:12-16](/Users/trantrongvinh/Documents/ielts-speaking-coach/.github/workflows/backend-tests.yml:12). Sprint 5 is frontend-only, so the backend drift/test gate would not automatically run for the final merge PR unless additional backend files were also in the diff.
- Rollback is technically possible, but `032_rollback.sql` would drop populated anchor data if used after live anchor writes begin. That is acceptable only as an emergency rollback, not as a routine reversible migration.

### Dimension 6 — Documentation + traceability
**Verdict:** **WARN**

**Findings:**
- Execution reports for all six sprints are present under `grammar-audit/`:
  - `sprint-0-execution-report.md` through `sprint-5-execution-report.md`
- Traceability is incomplete beyond that:
  - reconnaissance files only exist for Sprint 4 and Sprint 5
  - validation-report YAMLs exist for Sprint 0-2, not all six sprints
  - no `HANDOFF*.md` file was found at repo root or under `docs/`
- `feedback-anchor-mapping.yaml` is documented well at the header, including `deferred_until` semantics, confidence vocabulary, and severity vocabulary at [backend/content/feedback-anchor-mapping.yaml:1-29](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/content/feedback-anchor-mapping.yaml:1).
- There are still 6 vestigial `deferred_until: sprint-3` fields in the live mapping file even though the drift gate now reports `Deferred (not yet expected to resolve): 0`. They are harmless but mildly misleading maintenance residue.
- The Sprint 5 execution report overstates rollout readiness. It claims “Production deep-link feature: LIVE (after this PR merge)” at [grammar-audit/sprint-5-execution-report.md:140-148](/Users/trantrongvinh/Documents/ielts-speaking-coach/grammar-audit/sprint-5-execution-report.md:140), but live DB evidence currently shows `0 / 160` populated anchors.

## Critical findings (must-fix before merge)

1. **Live deep-link population is effectively non-functional today**
   - **Root cause:** Real production `grammar_issue` strings are still resolving to broad slugs or uncovered phrasing, so `find_best_anchor()` returns `None` on live traffic.
   - **Severity:** Critical
   - **Impacted files:**  
     - [backend/services/claude_grader.py:1113-1141](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/claude_grader.py:1113)  
     - [backend/services/grammar_content.py:512-552](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:512)  
     - [backend/content/feedback-anchor-mapping.yaml](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/content/feedback-anchor-mapping.yaml)
   - **Suggested minimal fix:** Add integration-pinned mappings/tests for the actual high-frequency live issue phrasings and/or adjust `find_best_match()` so common live issue texts land on slugs that have anchor mappings.
   - **Verification:** Re-run live query and require `COUNT(recommended_anchor) > 0` on newly created rows after test sessions; sample at least 5 fresh rows with non-null anchors.

2. **Practice feedback’s primary grammar recommendation card still drops the anchor**
   - **Root cause:** `_grammarCardHtml()` in `practice.js` does not append `match.anchor`, and `_showGrammarResources()` does not pass `rec.anchor` into `match`.
   - **Severity:** High
   - **Impacted files:**  
     - [frontend/js/practice.js:838-875](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:838)  
     - [frontend/js/practice.js:884-891](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:884)
   - **Suggested minimal fix:** Mirror the Result-page pattern: append `match.anchor ? '#' + encodeURIComponent(match.anchor) : ''` and plumb `anchor: rec.anchor || null`.
   - **Verification:** Complete one practice response with an anchored recommendation and confirm both the inline issue link and the Quick Grammar Tip card land on the same section hash.

## High-priority findings (should-fix before user impact)

1. **Automated tests miss the real production failure mode**
   - Existing tests validate renderer/loader/matcher internals, but none pin a real production-like issue string through `find_best_match()` and `find_best_anchor()` together. Add one end-to-end matcher test built from sampled live issue text.

2. **Backend CI does not automatically run for the final frontend-only Sprint 5 PR**
   - Because `backend-tests.yml` is filtered to `backend/**`, the drift gate and anchor suites will not run automatically on a pure frontend PR. Add a lightweight frontend/deep-link smoke gate or broaden the PR trigger for this rollout.

## Low-priority findings (nice-to-have)

1. `test_grammar_renderer_anchors.py` does not cover malformed anchor comments or “other HTML comment should remain untouched” negative cases.
2. `test_grammar_anchor_matcher.py` does not pin exact-threshold behavior at `0.35`.
3. `analytics_events` currently shows RLS enabled but no policies in the live snapshot; this is separate from deep-link shipping but worth tracking.
4. The 6 vestigial `deferred_until: sprint-3` fields in `feedback-anchor-mapping.yaml` should be cleaned when convenient.
5. No `HANDOFF` document was found reflecting Sprint 5 completion and the remaining rollout/debt state.

## Production readiness recommendation

**RED: do not merge Sprint 5 as “production-ready deep-linking” until the two blockers above are closed.**

The backend and frontend infrastructure pieces are mostly correct, and the Result page + Grammar article page are close to ready. But as of 2026-05-03, the live data path is not yet delivering anchored recommendations, and one major practice-surface link still drops the hash entirely. After those two items are fixed, this should be a narrow re-audit rather than another broad redesign.

## Specific evidence cited

- Local backend verification:
  - `backend/tests/test_grammar_renderer_anchors.py`, `test_grammar_loader_anchors.py`, `test_grammar_anchor_matcher.py`, `test_grading_anchor_persistence.py`, `test_anchor_drift.py` → **15 passed**
  - `backend/tests/test_grammar_content_archive_exclusion.py`, `test_grammar_smoke.py` → **5 passed**
  - `python backend/scripts/verify_anchor_drift.py` →  
    `OK All 30 active mappings resolve to declared anchors`  
    `Total declared anchors across content: 200`
- Live DB evidence (via `backend/.env`):
  - `SELECT COUNT(*) AS total, COUNT(recommended_anchor) AS with_anchor FROM grammar_recommendations;`  
    → `160 total`, `0 with_anchor`
  - `SELECT recommended_slug, COUNT(*) ... GROUP BY recommended_slug`  
    → top slugs: `articles` 72, `tense-consistency` 31, `article-errors` 22
  - sampled `articles` rows all had `recommended_anchor = NULL`
- Local matcher probe:
  - canonical issue `"Thiếu mạo từ 'a' trước danh từ đếm được số ít"` + slug `articles` → anchor resolves
  - production-like issues `"Thiếu mạo từ 'the' trước 'future'"` and `"Sai thì hiện tại đơn trong ngữ cảnh quá khứ..."` → anchor `None`
