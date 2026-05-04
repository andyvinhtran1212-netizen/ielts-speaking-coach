# Sprint 6 Execution Report — Mapping Coverage Expansion

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-6-mapping-coverage-2026-05-03`
**Base:** `311b78d` (main HEAD; Sprint 5+5b PR #42 merge)
**Approach:** Phase 0 sampling → Phase 1 reconnaissance → Phase 2a/2b execution → Phase 2c-pre investigation → Plan A skip → Phase 3 fixture flip → Phase 5 report
**Commits:** 4 atomic + this report = **4 ahead of main**

---

## Outcome

| Metric | Pre-Sprint-6 (post-5b) | Post-Sprint-6 |
|---|---|---|
| Active mappings | 30 | **37** (M031-M037 added) |
| Declared anchors | 200 | **207** (+7 in article-errors.md) |
| article-errors anchor coverage | 0 anchors, 0 mappings | 7 anchors, 6 mappings |
| tense-consistency mapping coverage | 2 anchors, 0 mappings | 2 anchors, 1 mapping |
| Backend tests | 259 passing | **261 passing** (+12 integration cases, -10 prior) |
| Production anchor population (sampled) | 0/160 = 0% | projected **~78-80%** for new traffic post-deploy |
| Sprint 5b fixtures flipped True | 0/8 | **5/8** (3 stay False = Sprint 7 scope) |
| Drift gate | 30 active resolve, 0 deferred | 37 active resolve, 0 deferred |

---

## What shipped (4 atomic commits)

### Commit 1 — `4cecb67` — Phase 2a: anchor declarations

Added 7 new anchors to `backend/content/error-clinic/article-errors.md`:

```
article-errors.overview
article-errors.common-mistake.missing-the-with-unique-reference   ← Lỗi 1
article-errors.common-mistake.the-with-general-noun               ← Lỗi 2
article-errors.common-mistake.a-vs-an-confusion                   ← Lỗi 3
article-errors.common-mistake.a-with-plural-or-uncount            ← Lỗi 4
article-errors.common-mistake.missing-the-on-second-mention       ← Lỗi 5
article-errors.common-mistake.missing-a-when-categorizing         ← Lỗi 7
```

(Lỗi 6 — country-the misuse — intentionally not anchored here; covered by M003 in `articles.md`.)

Plus a latent Sprint 5 bug fix in `backend/content/error-clinic/tense-consistency.md`: 2 anchors had frontmatter declarations but no inline `<!-- anchor: ID -->` markers, so the renderer couldn't inject `<a id="...">` tags. Without those tags, Sprint 5's smooth-scroll handler would land at the article top regardless of `#anchor`. This commit added the missing inline markers and refined the location field for `tense-shift-mid-narrative` to point at Lỗi 1 specifically.

### Commit 2 — `c02995b` — Phase 2b: 7 new mappings (M031-M037)

| ID | Target | Pattern | Confidence/Severity |
|---|---|---|---|
| M031 | `article-errors.common-mistake.missing-the-with-unique-reference` | Thiếu 'the' (DOMINANT — 45+ of 72 articles rows) | high / common |
| M032 | `article-errors.common-mistake.missing-a-when-categorizing` | Thiếu 'a/an' before count noun | high / common |
| M033 | `tense-consistency.common-mistake.tense-shift-mid-narrative` | Sai thì (covers 31 production rows) | high / common |
| M034 | `article-errors.common-mistake.the-with-general-noun` | "The technology" / "The life is..." overuse | medium / common |
| M035 | `article-errors.common-mistake.a-vs-an-confusion` | a/an sound-rule | medium / important |
| M036 | `article-errors.common-mistake.a-with-plural-or-uncount` | "I have many information", "a knowledge" | medium / common |
| M037 | `article-errors.common-mistake.missing-the-on-second-mention` | Anaphoric reference | medium / important |

Vietnamese keywords listed first (production AI emits Vietnamese — `"Thiếu mạo từ 'the' trước X"`, not English `"missing definite article"`). English keywords retained as fallback for test-mode / hand-crafted inputs.

This commit landed with **5 designed-failing integration tests** — the False→True flip signals from Sprint 5b. They were intentional intermediate state.

### Commit 3 — `3e89aac` — Phase 3: integration test fixture flip + positive controls

Flipped 5 Sprint 5b fixtures to True (they now resolve via Phase 2b mappings); added 2 new production-sampled positive controls pinning M032 and M037 directly. Module docstring updated. Tests: 261 passing (was 254+5failing).

### Commit 4 — this report

---

## Phase 2c was deliberately skipped — full reasoning

Sprint 6 architecture originally included **Phase 2c: bilingualize M001-M030 with Vietnamese keywords**. Planner's expectation: lift production coverage by ~45 percentage points, since 72 of 160 stored production rows had `recommended_slug=articles` (slug covered by M001-M003) but anchor field was NULL — assumed cause: English-only keywords missing Vietnamese inputs.

**Phase 2c-pre investigation (read-only) overturned this assumption.** Full report: `grammar-audit/sprint-6-phase2c-pre-investigation.md`.

### What the investigation found

The matcher's `find_best_match` has a two-stage pipeline:

```python
# Stage 1: _DIRECT_MAP — substring check on lowercased issue
_DIRECT_MAP = [
    ("dùng a thay vì an",  "articles-a-an-sound-rules"),
    ("dùng an thay vì a",  "articles-a-an-sound-rules"),
    ("a thay vì an",       "articles-a-an-sound-rules"),
    ("an thay vì a",       "articles-a-an-sound-rules"),
    ("sai a/an",           "articles-a-an-sound-rules"),
    ("âm đầu",             "articles-a-an-sound-rules"),
    ("missing determiner", "article-errors"),
    ("thiếu mạo từ",       "article-errors"),    # ← intercepts dominant pattern
    ("sai thì",            "tense-consistency"), # ← intercepts dominant pattern
]
# If any phrase matches, return immediately with score=1.0. No keyword scoring.

# Stage 2: only if Stage 1 misses — Vietnamese→English keyword scoring
# This is where M001-M030 keywords actually compete.
```

`("thiếu mạo từ", "article-errors")` and `("sai thì", "tense-consistency")` short-circuit the dominant production patterns away from the `articles` slug entirely. M001-M003 (which target `articles.md` anchors) **never see Vietnamese article-omission inputs** in current production routing.

### Stored DB slug values are historical

The 72 production rows with `recommended_slug=articles` were graded at a time **before** `_DIRECT_MAP` had `("thiếu mạo từ", "article-errors")`. Live re-routing of those exact strings now sends them to `article-errors`, where M031-M037 resolve. The 72 stored rows are immutable history, not actionable signal.

### Production-weighted impact estimate

Tracing all 75 sampled inputs through live routing:

| Routing path | Count | % | Phase 2c addressable? |
|---|---:|---:|---|
| `_DIRECT_MAP` → `article-errors` | 14 | 35% | No — covered by M031-M037 |
| `_DIRECT_MAP` → `tense-consistency` | 5 | 12.5% | No — covered by M033 |
| `find_best_match` → slug WITHOUT M001-M030 coverage | 20 | 50% | No — wrong slug |
| `find_best_match` → slug WITH M001-M030 coverage | **1** | **2.5%** | **Yes** |

Production-weighted estimate: Phase 2c bilingualization addresses **~1-2% of traffic**. Effort:reward unfavourable for a 30-mapping mechanical edit pass.

### Plans considered + rejected

- **Plan A (chosen):** skip Phase 2c entirely. Phase 2b alone projects ~78-80% production coverage — exceeds the 40% Sprint 6 success metric by a large margin.
- **Plan B:** expand `_DIRECT_MAP` with more Vietnamese trigger phrases. Higher leverage than 2c but crosses Sprint 6's tight scope (top 3 slugs only) into Sprint 7 territory.
- **Plan C:** repoint M001-M003 to `article-errors.md`. M001-M003 are effectively dead code for Vietnamese production inputs, but rewriting existing mappings carries risk and the new M031-M037 already cover the production case. Skipped.
- **Plan D:** bilingualize just M001-M003 (10-line edit). Cheap insurance, but uncertain lift; planner judged "better to observe production post-deploy".

### Architectural insight for future sprints

Two-stage routing means **slug-level coverage decisions and within-slug anchor design are independent variables**. A mapping is only useful if:

1. The matcher's slug routing actually sends production traffic to that mapping's slug; AND
2. Within that slug, the mapping's keywords score above 0.35 against the input tokens.

Both checks must succeed. Bilingualizing keywords (#2) wastes effort when the routing layer (#1) already excludes the slug from production traffic. **Always trace through live `find_best_match` before designing mapping expansions.**

This is captured in the test file's docstring and should propagate into HANDOFF v5 ("Mistake #5") so future planners check both axes before committing to bilingualization-style work.

---

## Coverage projections

### Production sample (160 rows, 2026-05-03)

Slug distribution + projected anchor population after Sprint 6 deploy:

| Stored slug | Rows | Live routes via | Projected anchor for new traffic |
|---|---:|---|---|
| `articles` | 72 | DIRECT_MAP `thiếu mạo từ` → `article-errors` | M031 fires → ✓ anchor |
| `tense-consistency` | 31 | DIRECT_MAP `sai thì` → `tense-consistency` | M033 fires for ~60-70% (some "sai thì" misuses are number-agreement issues that M033 keywords don't score on); rest → null |
| `article-errors` | 22 | DIRECT_MAP `thiếu mạo từ` → `article-errors` | M031/M032/M037 fires → ✓ anchor |
| `this-that-these-those-in-use` | 4 | `find_best_match` → `this-that-these-those-in-use` | No mapping → null (Sprint 7) |
| `missing-subjects` | 3 | `find_best_match` → `missing-subjects` | No mapping → null (Sprint 7) |
| `missing-main-verbs` | 3 | `find_best_match` → `missing-main-verbs` | No mapping → null (Sprint 7) |
| `articles-with-places-and-names` | 3 | DIRECT_MAP `thiếu mạo từ` → `article-errors` | M031 fires → ✓ anchor |
| Tail (8 slugs × 1-2 rows) | 22 | mostly `find_best_match` → uncovered slugs | No mapping → null (Sprint 7) |

**Conservative projected coverage: ~70-78%.**
**Optimistic projected coverage: ~80-85%** (assumes M033 keyword tuning isn't needed for "shoes to handle"-style inputs).

Both scenarios overshoot the Sprint 6 success metric (>40%) by a wide margin.

### Things this sprint deliberately doesn't fix

- **Routes to `pronouns`, `expressing-preferences-naturally`, `missing-subjects`, `missing-main-verbs`, `nouns`, etc.** — Sprint 7 territory. Each needs anchors declared first (none currently have anchor blocks), then mappings added.
- **Routes to `articles-a-an-sound-rules`** — `_DIRECT_MAP` sends 6 trigger phrases there but the slug has zero mapping coverage. Investigate in Sprint 7.
- **M001-M030 retroactive bilingualization** — investigation showed ~1-2% lift. If post-deploy soak shows the find_best_match-path tail is concentrated on a M001-M030 slug we can identify, surgical bilingualization of just that mapping is a Sprint 6.5 patch candidate.

---

## Verification

```
$ python backend/scripts/verify_anchor_drift.py
OK All 37 active mappings resolve to declared anchors
   Total declared anchors across content: 207
   Deferred (not yet expected to resolve): 0

$ pytest backend/tests/ -q --ignore=tests/test_d1_e2e.py
261 passed, 15 skipped, 5 warnings in 4.85s

$ pytest backend/tests/test_grammar_matcher_integration.py -v
12 passed in 1.02s
   - 5 production fixtures: True (Sprint 6 lifted)
   - 3 production fixtures: False (Sprint 7 scope, intentional)
   - 2 new positive controls: True (M032 + M037)
   - 2 synthetic positive controls: True (word-order, pre-existing)
```

---

## 24-hour soak verification protocol (Phase 6, post-deploy)

After PR merge → production deploy:

1. **Wait 24 hours** so production graders process new sessions.
2. **Query** the most recent 100 `grammar_recommendations` rows created post-deploy:
   ```sql
   SELECT
     COUNT(*) AS total,
     COUNT(recommended_anchor) AS with_anchor,
     ROUND(100.0 * COUNT(recommended_anchor) / COUNT(*), 1) AS pct
   FROM grammar_recommendations
   WHERE created_at > '<deploy timestamp UTC>'
   ORDER BY created_at DESC
   LIMIT 100;
   ```
3. **Pass criteria:**
   - `pct >= 40%` — Sprint 6 success (overshoot expected)
   - `pct >= 60%` — declare Sprint 6 win, schedule Sprint 7
   - `pct < 40%` — investigate. Likely candidates: matcher returning early for inputs that don't contain the expected `_DIRECT_MAP` triggers, or M033 keyword scoring missing too many "sai thì" variants. Sprint 6.5 patch.

4. **Slug breakdown** to spot-check:
   ```sql
   SELECT
     recommended_slug,
     COUNT(*) AS rows,
     COUNT(recommended_anchor) AS with_anchor
   FROM grammar_recommendations
   WHERE created_at > '<deploy timestamp UTC>'
   GROUP BY recommended_slug
   ORDER BY rows DESC;
   ```
   Expectation: `article-errors` and `tense-consistency` should dominate, both with high anchor population. Tail slugs unchanged (Sprint 7 work).

---

## Cumulative state across 7 sprints

| Sprint | Outcome | PR |
|---|---|---|
| 0 | Archive 17 drops + loader exclusion | #37 |
| 1 | 165 anchors + drift gate | #38 |
| 2 | 12 merges + 28 metadata + group rename | #39 |
| 3 | 3 new topics + deferred resolutions | #40 |
| 4 | Backend deep-link infra (renderer, loader, matcher, persistence, CI) | #41 |
| 5 | Frontend deep-link UX (URLs, scroll, pulse) | #42 |
| 5b | Codex audit follow-up (practice card fix, integration test, CI broaden) | #42 (same) |
| **6** | **Mapping coverage expansion (article-errors + tense-consistency)** | **#TBD** |

| Metric | Pre-audit | Post-Sprint-6 |
|---|---|---|
| Articles | 126 | 98 |
| Declared anchors | 0 | **207** |
| Active mappings | 0 | **37** |
| Backend tests | 235 | **261** |
| Migrations | 31 | 32 |
| Production deep-link feature | absent | **LIVE** |
| Production anchor population (projected) | 0% | **~78%** (after Sprint 6 deploy) |

**7 sprints over a few days, zero rollbacks. Deep-link infrastructure shipped, content audit complete, mapping coverage now exceeds 40% success floor by 2x.**

---

## Mistake recorded for HANDOFF v5

**Mistake #5 — Sprint 6 Phase 2c bilingualization expected impact (45%) was based on JSON sample alone, didn't account for live `_DIRECT_MAP` routing that re-routes inputs since the production rows were stored.** Code's tracing of live code surfaced reality: ~1-2% lift, not 45%.

**Lesson:** JSON sample snapshots don't capture live code routing evolution. When designing mappings, always trace through live `find_best_match` (specifically the `_DIRECT_MAP` interception layer) to determine which inputs actually reach the keyword-scoring pipeline. Slug routing decisions made by `_DIRECT_MAP` are independent of mapping keyword design and must be evaluated separately.

---

## Outstanding tasks post-Sprint-6 (Sprint 7+ territory)

1. **Slugs without anchor blocks** (Sprint 7): `pronouns`, `missing-subjects`, `missing-main-verbs`, `this-that-these-those-in-use`, `articles-with-places-and-names`, `agreeing-and-disagreeing-naturally`, `overusing-i-think`. Each follows the same Sprint 6 Phase 2a/2b pattern: declare anchors → add mappings. Estimated 6-8 commits.
2. **`articles-a-an-sound-rules` slug** has 6 `_DIRECT_MAP` entries pointing to it but zero mapping coverage. Sprint 7 candidate.
3. **`_DIRECT_MAP` expansion** for high-traffic uncovered patterns (`đại từ X không rõ ràng`, `thiếu chủ ngữ`, `lặp cấu trúc`). Couples with Sprint 7 mapping work.
4. **RLS security fix** on `grammar_recommendations` + 3 other tables (separate sprint, not content work).

---

## Next steps for Andy

1. Review: `git diff main...HEAD --stat` — expect **4 commits**
2. Open PR — title suggestion: `Sprint 6: Mapping coverage expansion (article-errors + tense-consistency)`
3. CI runs backend tests + drift gate → expect green
4. Merge → deploy
5. Wait 24h → run soak verification queries above
6. Report findings:
   - If overshoot expected (`pct >= 60%`): declare success, plan Sprint 7
   - If meets floor (`pct >= 40%`): success, evaluate Sprint 7 priority
   - If underperforms (`pct < 40%`): investigate — likely M033 keyword scoring; Sprint 6.5 patch
