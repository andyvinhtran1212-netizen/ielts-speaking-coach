# Sprint 4 Execution Report — Backend Deep-Link Infrastructure

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-4-backend-2026-05-03`
**Base:** `b07a175` (main HEAD; Sprint 3 PR #40 merge)
**Approach:** Scenario A-prime — incremental wiring of existing scaffolding
**Migration 032:** Applied to staging + production by Andy on 2026-05-03 (before PR merge — accelerated path)

---

## Outcome

| Metric | Value |
|---|---|
| Reconnaissance complete + scope re-shaped | ✓ Phase 0 caught Scenario A → A-prime |
| Markdown renderer converts marker → `<a id>` | ✓ |
| Loader exposes `anchors` field | ✓ |
| Matcher resolves anchor via mapping file | ✓ (defensive `deferred_until` skip) |
| DB migration 032 applied staging + production | ✓ (Andy executed manually) |
| Persistence writes `recommended_anchor` | ✓ |
| CI workflow with drift gate | ✓ (PR-only trigger) |
| All grammar tests pass | **20 / 20** ✓ |
| Full backend test suite | **265 / 265 pass + 15 skipped** ✓ |
| Drift gate | ✓ green (30 / 0 / 200) |
| Atomic commits | **8** |

---

## Q&A decisions captured

| # | Question | Decision | Implementation |
|---|---|---|---|
| Q1 | Anchor confidence threshold | **0.35** (same as slug) | `find_best_anchor` uses identical threshold; consistency avoids orphan slug matches |
| Q2 | Honor `deferred_until` defensively in matcher | **YES** | `_load_mappings` filters out entries with `deferred_until` set; pinned by `test_mapping_index_skips_deferred_entries` |
| Q3 | Migration sequence number | Used `/db-migrate` skill | Skill confirmed conventions; latest was `031`, so `032_*` |
| Q4 | CI trigger scope | **`pull_request` only** | `.github/workflows/backend-tests.yml` triggers on PRs that touch `backend/**` or this workflow |
| Q5 | Renderer cache invalidation | **Trust deploy = restart** | Verified `grammar_service` is a module-level singleton with no Redis/disk/lru_cache layer; deploy reloads HTML |

---

## What shipped

### Commit 1 — `c831204` — Markdown renderer converts anchor markers
Added `_ANCHOR_MARKER_RE` + a single `re.sub` call inside `_parse_file` that converts `<!-- anchor: ID -->` (preserved verbatim by the markdown library) into `<a id="ID" class="grammar-anchor"></a>` so `/grammar/<cat>/<slug>#<id>` URLs scroll the browser. Pinned by 3 tests.

### Commit 2 — `d2d18c7` — Loader exposes anchors field
1-line addition to the `_parse_file` return dict: each article now carries an `anchors` list (`[{id, location, type}, ...]`). Used by Phase 4 matcher; future-proof for any other introspection. Empty list when frontmatter has no `anchors:`. Pinned by 3 tests.

### Commit 3 — `7e65d72` — Matcher anchor resolution via mapping file
- New method `GrammarContentService.find_best_anchor(issue, slug)`
- Lazy-loads `feedback-anchor-mapping.yaml` on first call into a per-slug index
- **Defensively filters** entries with `deferred_until` (Andy Q2)
- Scores issue tokens against `feedback_keywords[]` + `user_phrase_examples[]` + `feedback_pattern_summary` per mapping; **0.35 threshold** (Andy Q1)
- `claude_grader._attach_grammar_recommendations` now appends an `anchor` field to each rec (None when no mapping resolves)
- Pinned by 6 tests including defensive deferral skip

### Commit 4 — `7988073` — Migration 032 forward + rollback files
```sql
ALTER TABLE grammar_recommendations
    ADD COLUMN IF NOT EXISTS recommended_anchor TEXT;
```
Plus rollback. Idempotent, nullable, no constraints, no index. Postgres ≥11 metadata-only ALTER → negligible lock impact.

### Commit 5 — `10d0a4d` — Migration 032 accelerated apply checklist
Walks Andy through staging + production application via Supabase dashboard. Shortened smoke from 30-min to 5-min since pre-Sprint-4 endpoints don't reference the new column.

### Commit 6 — `3d9c24d` — Persistence writes `recommended_anchor`
`_save_grammar_recommendations` now includes `recommended_anchor: r.get("anchor")` in the insert row dict. Falls back to NULL when `anchor` is None or field is absent (backward compat). Pinned by 2 tests using mocked Supabase.

### Commit 7 — `6220cb7` — CI workflow `backend-tests.yml`
PR-only trigger filtered to `backend/**` + workflow file. Runs full pytest suite (excluding `test_d1_e2e.py` which needs live external services), then runs the drift script as an explicit final step so a failure attributes clearly to "anchor drift" rather than a generic pytest miss.

### Commit 8 — this report

---

## End-to-end verification

```
$ python backend/scripts/verify_anchor_drift.py
OK All 30 active mappings resolve to declared anchors
   Total declared anchors across content: 200
   Deferred (not yet expected to resolve): 0

$ python -c "from services.grammar_content import grammar_service; ..."
conditionals: 2 clickable anchors in HTML
  sample ids: ['conditionals.type1.common-mistake.will-after-if',
               'conditionals.natural-speech-patterns']
  anchors field: 12 entries (frontmatter)

find_best_anchor('Thiếu mạo từ a trước danh từ đếm được số ít', 'articles')
  → 'articles.indefinite.missing-with-singular-count-noun'   ✓ correct

find_best_anchor('Sai thì hiện tại đơn', 'present-simple')
  → None    ✓ honest miss (no mapping registered for this issue under this slug)
```

---

## What was NOT touched (Sprint 5+ scope)

- ❌ Frontend deep-link UX — Sprint 5 will:
  - Append `'#' + rec.anchor` to recommendation card URLs in `practice.js::_grammarIssuesBlock` and `result.html`
  - Smooth-scroll on URL hash on `grammar-article.html`
  - 3-second pulse highlight on the landed `<a id>` target
- ❌ Loader-time hot reload of mapping file (deploy=restart sufficient per Q5)
- ❌ Embedding-based matcher (start simple substring; iterate later if needed)
- ❌ SUPPORTING articles anchor coverage (52 articles, future sprint)
- ❌ Vestigial `deferred_until` cleanup in mapping file (maintenance pass per Sprint 3 decision)

---

## Reconciliation trail (cross-sprint summary)

| Sprint | Articles | Anchors | Mappings | Tests | Backend code |
|---|---|---|---|---|---|
| Pre-Sprint 0 | 126 | 0 | 0 | baseline | unchanged |
| Sprint 0 | 109 | 0 | 0 | + archive exclusion | loader skips `_archive/` |
| Sprint 1 | 109 | 165 | 24 active + 6 deferred | + drift gate | no app code change |
| Sprint 2 | 97 | 165 | 24 + 6 | maintained | no app code change |
| Sprint 3 | 98 | 200 | 30 active + 0 deferred | maintained | no app code change |
| **Sprint 4** | **98** | **200** | **30 + 0** | **+ 8 tests (renderer, loader, matcher, persistence)** | **renderer, loader, matcher, persistence, CI all wired** |

Cumulative test growth: baseline pinning tests + Sprint 0/1 specific pins + Sprint 4's 8 new tests across 5 new files. Full suite: 265 passed.

---

## Production rollout state (post-this-PR-merge)

After merge to main + Railway redeploy:
- Renderer ships fresh HTML with `<a id>` tags on next backend boot
- Loader exposes `anchors` field — anyone consuming the article dict gets it for free
- Matcher resolves anchors against mapping file at first call (lazy singleton)
- New grading calls write `recommended_anchor` to grammar_recommendations table (column already in production via migration 032)
- CI gate active on every future PR touching `backend/**`
- Frontend (Sprint 5) consumes the new `anchor` field from the practice grading endpoint response

Old grammar_recommendations rows (pre-Sprint 4) carry NULL in `recommended_anchor` — frontend article-level URL fallback continues to work unchanged.

---

## Next steps for Andy

1. Review: `git diff main...HEAD --stat` — expect 8 commits
2. Spot-check a sample article's HTML has clickable anchors:
   ```bash
   curl -s https://api.averlearning.com/api/grammar/article/foundations/articles \
     | python -m json.tool \
     | grep 'class="grammar-anchor"' | head -3
   ```
3. Spot-check a fresh practice grading response includes `anchor` field in `grammar_recommendations`:
   ```sql
   SELECT recommended_slug, recommended_anchor, grammar_issue
   FROM grammar_recommendations
   WHERE created_at > NOW() - INTERVAL '1 hour'
     AND recommended_anchor IS NOT NULL
   ORDER BY created_at DESC
   LIMIT 5;
   ```
4. Verify CI workflow triggers correctly on this PR (the drift gate step should pass)
5. Decide:
   - Merge to main → Sprint 5 (frontend deep-link UX) unblocked
   - Adjust → fix in branch
   - Rollback → backup at `backups/backend-pre-sprint-4-20260503-*`; rollback migration 032 only AFTER reverting application deploy first (per checklist warning)

---

## Sprint 5 brief (handoff)

Frontend changes after Sprint 4 ships:
1. **`frontend/js/practice.js::_grammarIssuesBlock`** — change `recHref` construction:
   ```javascript
   var recHref = '/grammar.html?category=' + encodeURIComponent(rec.category)
     + '&slug=' + encodeURIComponent(rec.slug)
     + (rec.anchor ? '#' + encodeURIComponent(rec.anchor) : '');
   ```
2. **`frontend/pages/result.html`** — same URL extension in `_fbGrammarIssues`
3. **`frontend/pages/grammar-article.html`** — on URL hash:
   - Smooth-scroll to `<a id="<hash>">` element
   - 3-second pulse highlight on the landed section's surrounding heading
4. **Optional analytics** — `was_clicked` already in schema; can wire CTR tracking per anchor for future content prioritization
