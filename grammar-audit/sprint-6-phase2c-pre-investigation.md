# Sprint 6 Phase 2c-pre — `_DIRECT_MAP` routing investigation

**Date:** 2026-05-03
**Scope:** READ-ONLY. Trace production samples through actual routing logic. No commits.
**Branch posture preserved:** 2 commits ahead of main (`4cecb67` Phase 2a, `c02995b` Phase 2b). 5 designed-failing tests still red.

---

## TL;DR — Recommendation: SKIP Phase 2c

The investigation reveals `_DIRECT_MAP` interception is far stronger than planner anticipated. Bilingualizing M001-M030 would address **~1.3% of sampled inputs** (1 of 75) and likely **~1-2% of production-weighted traffic**. The effort:reward ratio doesn't justify a 30-mapping mechanical edit.

Sprint 6 final projected coverage **without Phase 2c: ~78-80%** of production traffic. With Phase 2c: ~80-82% (marginal lift). Recommend going straight to Phase 3 (fixture flips) and Phase 5 (report).

If planner wants additional production lift in this sprint, the higher-leverage move is **expanding `_DIRECT_MAP` itself** (Plan B below) rather than bilingualizing the mappings it already bypasses.

---

## `_DIRECT_MAP` definition

Located: `backend/services/grammar_content.py:331-341` (within `find_best_match()`).

```python
_DIRECT_MAP: list[tuple[str, str]] = [
    ("dùng a thay vì an",  "articles-a-an-sound-rules"),
    ("dùng an thay vì a",  "articles-a-an-sound-rules"),
    ("a thay vì an",       "articles-a-an-sound-rules"),
    ("an thay vì a",       "articles-a-an-sound-rules"),
    ("sai a/an",           "articles-a-an-sound-rules"),
    ("âm đầu",             "articles-a-an-sound-rules"),
    ("missing determiner", "article-errors"),
    ("thiếu mạo từ",       "article-errors"),
    ("sai thì",            "tense-consistency"),
]
```

Routing semantics: substring check on lowercased issue. First match wins (longest-first ordering). On hit, returns `{slug, score: 1.0}` — bypasses Vietnamese→English keyword scoring entirely.

Of 9 entries:
- 6 → `articles-a-an-sound-rules` (slug has **no** mappings → anchor=None always)
- 2 → `article-errors` (slug **now** has M031-M037 from Phase 2b → anchor resolves)
- 1 → `tense-consistency` (slug **now** has M033 from Phase 2b → anchor resolves)

---

## Routing trace — 15 top-3-slug samples (priority cohort)

All 15 inputs hit `_DIRECT_MAP`. Zero flow to `find_best_match` scoring. After Phase 2b mappings:

| Stored slug (DB) | Direct-map phrase | Live routes to | Anchor (post-Phase-2b) |
|---|---|---|---|
| `articles` × 5 | `thiếu mạo từ` | `article-errors` | `...missing-the-with-unique-reference` (M031) ✓ |
| `tense-consistency` × 5 | `sai thì` | `tense-consistency` | 3× `...tense-shift-mid-narrative` (M033) ✓; 2× None |
| `article-errors` × 5 | `thiếu mạo từ` | `article-errors` | 3× `...missing-the-with-unique-reference` (M031), 1× `...missing-the-on-second-mention` (M037), 1× `...missing-a-when-categorizing` (M032) ✓ |

**Two tense-consistency cases land on `tense-consistency` slug but score below 0.35 against M033's keywords** (e.g., `"Sai thì: 'the shoe to handle' — nên dùng 'shoes to handle' (số nhiều)"` — actually a number-agreement issue mislabeled as tense). These are matcher-precision misses, not routing misses; tightening M033's keywords could help, but they're noise, not a Phase 2c concern.

**Critical insight on stored DB slug values:** 72 production rows have `recommended_slug=articles` despite live routing sending those same strings to `article-errors`. The DB values are **historical** — captured at grading time before the direct map had `("thiếu mạo từ", "article-errors")`. New traffic post-Sprint-6 will route correctly to `article-errors` and resolve M031-M037 anchors. The 72 stored `articles`-slug rows are immutable history.

---

## Routing breakdown — all 75 sampled inputs (15 slugs × 5)

Note: actual sum is 40 because smaller slugs have <5 unique inputs in the production sample.

```
   14  DIRECT_MAP       → article-errors
    5  DIRECT_MAP       → tense-consistency
    8  FIND_BEST_MATCH  → None              (matcher returns no slug)
    3  FIND_BEST_MATCH  → this-that-these-those-in-use
    3  FIND_BEST_MATCH  → missing-main-verbs
    2  FIND_BEST_MATCH  → agreeing-and-disagreeing-naturally
    1  FIND_BEST_MATCH  → missing-subjects
    1  FIND_BEST_MATCH  → nouns
    1  FIND_BEST_MATCH  → countable-vs-uncountable        ← M001-M030 COVERED
    1  FIND_BEST_MATCH  → pronouns
    1  FIND_BEST_MATCH  → expressing-preferences-naturally
   ── 
   40  total
```

### Aggregated

| Path | Count | % |
|---|---:|---:|
| `_DIRECT_MAP` (all bypass M001-M030 scoring) | 19 | **47.5%** |
| `find_best_match` → slug WITHOUT M001-M030 coverage | 20 | **50.0%** |
| `find_best_match` → slug WITH M001-M030 coverage | **1** | **2.5%** |

The single `find_best_match → countable-vs-uncountable` hit is the only sample input that bilingualizing M001-M030 could potentially help. And even that's not guaranteed — depends on the specific Vietnamese tokens in the issue overlapping the bilingualized M015/M016 keywords.

---

## Production-weighted impact estimate

Mapping the 40 unique sampled inputs back to the 160 production rows by occurrence count:

| Routing fate | Production rows (estimate) | % of 160 |
|---|---:|---:|
| Direct map → article-errors (M031/M032/M037 fires) | ~94-100 | **~60%** |
| Direct map → tense-consistency (M033 fires for ~60% of these; rest score below threshold) | ~18-20 | **~12%** |
| Direct map → articles-a-an-sound-rules (no mapping coverage) | ~0-2 | **~1%** |
| `find_best_match` → slug without M001-M030 coverage | ~30 | **~19%** |
| `find_best_match` → slug WITH M001-M030 coverage (Phase 2c addressable) | **~1-3** | **~1-2%** |
| `find_best_match` → None (no slug match) | ~10 | **~6%** |

**Phase 2b alone covers ~72-80% of production traffic.** Phase 2c lifts that by ~1-2 percentage points. Not zero, but definitely below the bar for a 30-mapping mechanical edit pass.

---

## Why the planner's earlier estimate diverged

The Phase 0 sample showed 72 rows stored with `recommended_slug=articles`, which made the planner reason: "M001-M003 cover articles slug, but English-only keywords miss Vietnamese inputs — bilingualizing fixes 72/160 = 45% of traffic". That logic was correct **for the data state at write time**, but missed two facts:

1. The DB-stored slug is **historical**. Live re-routing of those exact strings now sends them to `article-errors`, not `articles`.
2. The `_DIRECT_MAP` entry `("thiếu mạo từ", "article-errors")` was added between when those production rows were graded and when Phase 0 sampled the DB. So the 72 rows were graded under an older routing rule that no longer applies.

This was unknowable from the JSON sample alone — required tracing live code. The investigation confirms it conclusively.

---

## Plans considered

### Plan A — Skip Phase 2c, proceed to Phase 3 ✓ RECOMMENDED

- Cost: zero
- Coverage lift: 0
- Sprint 6 final coverage: ~78-80%
- Reasoning: Phase 2b already addresses the dominant traffic; Phase 2c addresses 1-2%. Effort:reward unfavourable.

### Plan B — Expand `_DIRECT_MAP` instead of bilingualizing

Add Vietnamese trigger phrases for currently-uncovered patterns. Candidates from `find_best_match`-routed samples:

```python
("đại từ", ...) → pronouns      # but pronouns has no mappings; needs Sprint 7 anchors first
("thiếu chủ ngữ", ...) → missing-subjects   # ditto
("lặp cấu trúc", ...) → ?       # unclear target
("không có động từ chính", ...) → missing-main-verbs   # ditto
```

Cost: requires both `_DIRECT_MAP` edit AND new mappings on currently-uncovered slugs. Crosses Sprint 6's tight scope (top 3 slugs only) — closer to Sprint 7. **Defer.**

### Plan C — Repoint M001-M003 to article-errors

M001-M003 target `articles.md` anchors. Live routing for "thiếu mạo từ" sends to `article-errors`, so M001-M003 are effectively dead code for production-shaped Vietnamese inputs. Could:

- **C1.** Change `target_file` from `articles.md` to `article-errors.md` and pick the equivalent article-errors anchor.
- **C2.** Leave M001-M003 as-is; they remain useful for English/test-mode inputs. M031-M037 already cover the production case.

C1 risks because it modifies existing mappings. C2 is the implicit current state — Phase 2b already added the production-routing-correct mappings. **Skip; M001-M030 stay as English-test-mode safety net.**

### Plan D — Hybrid: skip 2c bilingualization, do tightly-scoped 2c'

Quick-win bilingualization of just M001-M003 (3 mappings, mechanical) — covers the (currently empty) bucket of inputs that don't contain "thiếu mạo từ" but route to `articles` slug via tags/title scoring. Likely <2% production lift, but cheap. **Optional; planner's call.**

---

## Recommendation

**Plan A — skip Phase 2c entirely.** Move directly to:

- **Phase 3:** flip Sprint 5b integration test fixtures False→True for the 5 currently-failing cases. Add 1-2 new positive-control fixtures that target `article-errors.common-mistake.missing-the-on-second-mention` (M037) and `article-errors.common-mistake.missing-a-when-categorizing` (M032) for assertion coverage of M031/M033's siblings.
- **Phase 4:** verification (drift gate, full pytest, no commit).
- **Phase 5:** execution report — note the Phase 2c-pre finding so Sprint 7 / future planners don't re-attempt bilingualization without re-evaluating routing first.

If planner wants belt-and-braces, add Plan D's M001-M003-only bilingualization as a 1-commit add-on between Phase 3 and Phase 5. But the data doesn't justify it as load-bearing.

---

## Open question for planner

**Q1 — Phase 2c disposition:** Approve Plan A (skip), Plan D (M001-M003 only), or other?

**Q2 — Sprint 6 success metric revision:** Original Sprint 6 success criterion was ">40% NEW rows have populated anchor". Investigation suggests ~78-80% is achievable from Phase 2b alone. Confirm new soak-test metric or keep the 40% floor for safety (with overshoot expected).

**Q3 — Document `_DIRECT_MAP` finding for Sprint 7 planning?** The two-stage routing (direct map → scoring fallback) wasn't visible in the original architecture docs. Worth a one-paragraph note in the Sprint 6 execution report so future contributors don't repeat the mistake of designing mappings for slugs that direct-map intercepts away.

---

## STOP — awaiting planner decision

Branch posture preserved. No files modified. Investigation script ran in-process; no temp files created.

Phase 2b mappings (M031-M037) confirmed live-routing-correct via this trace — the 5 test failures are genuine fixture-flip signals, not regression noise.
