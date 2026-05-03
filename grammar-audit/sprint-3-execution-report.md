# Sprint 3 Execution Report — New Topics + Deferred Merges Resolution

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-3-newtopics-2026-05-03`
**Base:** `b38c55e` (main HEAD; Sprint 2 PR #39 merge)
**Audited input:** `grammar-audit/grammar-audit-report/patches/new-topics/` + Sprint 2 deferred-merge specs

---

## Outcome

| Metric | Value |
|---|---|
| New Tier-A topic files created | **3 / 3** ✓ |
| Deferred merges resolved (C1, C3) | **2 / 2** ✓ |
| C4 (zero-article) decision | **Skip merge — keep as standalone SUPPORTING** (Andy decision) |
| `_groups.yaml` | **97 → 98** ✓ |
| Drift gate | **30 active / 0 deferred / 200 declared** (was 24 / 6 / 165) |
| Sprint-3-deferred mappings auto-resolved | **6 / 6** ✓ (M016, M017, M025, M027, M028, M030) |
| Smoke tests | **6 / 6 pass** after every phase |
| Atomic commits | **7** |

**Content audit work: COMPLETE.** Sprint 4 (backend deep-link infra) can now proceed.

---

## C4 overlap analysis (Phase 1d gate)

The Sprint 3 prompt mandated an overlap pre-check before allowing the Path A skip. Result triggered the STOP gate; Andy reconsidered and chose **Option 2 — Keep zero-article as standalone SUPPORTING article**.

```
Source: backend/content/foundations/zero-article.md
        9191 chars / 1764 words
        7 detailed cases (TRƯỜNG HỢP 1-7)
        + 4 common-error subsections (Lỗi 1-4)
        + IELTS Writing/Speaking application examples
        + Practice exercises with answers

Target L3: "### Zero Article — Không dùng mạo từ" inside articles.md
        1780 chars / 332 words
        6 brief sub-bullets (####)

4-gram analysis:
  source-coverage: 0.6%   ← far below 80% Path-A-safe threshold
  target-coverage: 3.1%
  Jaccard:         0.5%
```

**Andy decision rationale (Option 2):**

1. **Cowork's `OPTIONAL` flag is strong signal** — they themselves were uncertain about merge value; trust editorial judgment.
2. **3 independent sprint passes converged** (Sprint 0 deferral, Sprint 2 deferral, Sprint 3 Phase 1 overlap) on same conclusion: zero-article fits better as standalone.
3. **Source merits standalone CORE-quality article** — 1764 words, 7 detailed cases, 4 error subsections, IELTS application — not nested L5 append.
4. **UX risk avoided** — L5 nesting (Option 1) would have broken design system Batch 2D TOC sidebar conventions. articles.md stays clean L2/L3.
5. **Discovery preserved** — zero-article.md remains in manifest, has its own anchor set (independent from `articles.zero-article` Sprint 1 anchor that points at the L3 brief summary in articles.md), accessible via search and `/grammar/zero-article#anchor`.

**Sprint 4 prep opportunity flagged:** backend can surface "see also" cross-link between articles.md L3 brief summary and the standalone zero-article.md CORE-quality article — closes the discovery loop.

---

## What shipped

### Commit 1 — `271aa85` — 3 new Tier-A topic files
| Slug | Category | Body words | Anchors | Inline markers |
|---|---|---|---|---|
| `discourse-markers-spoken` | grammar-for-meaning | 1927 | 12 | 12 |
| `grammatical-collocations` | grammar-for-meaning | 2270 | 13 | 13 |
| `pronunciation-grammar-link` | ielts-grammar-lab | 1479 | 10 | 10 |

Word counts came in smaller than the prompt's ~3.5k/3.5k/3k estimates (real: ~5.7k total vs prompt ~10k). Content is substantive and pedagogically complete; copied verbatim per Phase 2 spec. Files ship with `status: draft` (Cowork's choice) — production loader does not filter on this field, so files render normally. Dropping `draft` to `complete` is a one-line edit if needed.

**Drift gate auto-resolved 6 sprint-3-deferred mappings** as Sprint 1 design intended. The `deferred_until: sprint-3` fields are now vestigial (no-op). Per Andy preference: leave them in the mapping file as audit-trail; cleanup deferred to maintenance.

### Commit 2 — `2e29275` — C1 body edit
Appended `## High-leverage structures` parent section to `grammar-for-band7plus.md` (header + brief intro paragraph only).

### Commit 3 — `7bc644a` — C1 merge
Merged `avoiding-repetitive-sentence-openings` content (frontmatter + Tóm tắt/Tại sao stripped) under the new section. Source archived to `_archive/2026-05-03_sprint-3-merged/sentence-structures/`. ARCHIVE_LOG updated.

### Commit 4 — `ad56800` — C3 body edit
Appended `## Nhóm 7: Distancing phrases (Khoảng cách hóa)` parent section to `hedging-language.md` (header + brief intro paragraph). Distancing phrases is a distinct form of hedging warranting its own group rather than blending into Nhóm 1-6.

### Commit 5 — `e1f3c2a` — C3 merge
Merged `expressing-uncertainty` content under Nhóm 7. Source archived. ARCHIVE_LOG updated. Note: source was at `ielts-grammar-lab/`, not `grammar-for-meaning/` as the Sprint 3 prompt assumed — slug-based merge so location was irrelevant.

### Commit 6 — `052c6af` — Manifest update
- Added 3 new slugs to their target groups
- Removed 2 merged source slugs (avoiding-repetitive, expressing-uncertainty)
- C4 source (zero-article) kept per Option 2 decision
- Net: 97 → 98

### Commit 7 — this report

---

## Drift gate transition

```
Pre-Sprint 3:                 Post-Sprint 3:
  24 active resolve     →       30 active resolve
  6 deferred (sprint-3) →       0 deferred
  165 declared anchors  →       200 declared anchors (165 + 35 from new topics)
```

The 6 mappings that were forward-references to Sprint 3 anchors (M016, M017, M025, M027, M028, M030) auto-resolved the moment the new topic files landed. The drift script's `deferred_until` schema worked exactly as designed — no manual mapping-file edit needed.

The `deferred_until: sprint-3` fields remain in the mapping file as vestigial no-ops; Andy preference is to leave them as audit-trail evidence of the deferral history. Maintenance pass can clean up later.

---

## Verification

| Check | Result |
|---|---|
| `pytest tests/test_grammar_smoke.py test_grammar_content_archive_exclusion.py test_anchor_drift.py` | 6 / 6 pass |
| `python backend/scripts/verify_anchor_drift.py` | exit 0 — 30 active resolve, 0 deferred, 200 declared |
| `_groups.yaml` parses | ✓, 98 articles |
| Sprint-3-deferred mappings (M016/M017/M025/M027/M028/M030) | All 6 auto-resolve |
| Backup at `backups/grammar-pre-sprint-3-20260503-*` | byte-identical to pre-Sprint-3 state |
| C1 + C3 merge sources archived | ✓ git detected as 100% renames |
| C4 source `zero-article.md` still present in active content | ✓ (per Option 2) |

---

## What was NOT touched (per scope discipline)

- ❌ Backend renderer (markdown → HTML with `<a id>`) — Sprint 4
- ❌ AI feedback service integration — Sprint 4
- ❌ Result endpoint update — Sprint 4
- ❌ Loader exposure of `anchors:` to article dict — Sprint 4
- ❌ CI workflow YAML for drift script — Sprint 4 prep
- ❌ Frontend deep-link UX (scroll, highlight) — Sprint 5
- ❌ SUPPORTING articles anchor coverage (52 articles) — future sprint
- ❌ Vestigial `deferred_until` cleanup — maintenance pass
- ❌ Promotion of new topics' `status: draft` → `complete` — pending Andy decision (loader doesn't filter on this field)

---

## Reconciliation trail (cross-sprint summary)

| Sprint | Articles before | After | Anchors | Mappings | Tests |
|---|---|---|---|---|---|
| Pre-Sprint 0 | 126 | — | 0 | 0 | baseline |
| Sprint 0 | 126 | 109 | 0 | 0 | + archive exclusion |
| Sprint 1 | 109 | 109 | 165 | 24 active + 6 deferred | + drift gate |
| Sprint 2 | 109 | 97 | 165 | 24 active + 6 deferred | maintained |
| **Sprint 3** | **97** | **98** | **200** | **30 active + 0 deferred** | maintained |

---

## Project status post-Sprint 3

**Content audit work: COMPLETE.**

Sprint 4-5 (deep-link infrastructure) can now proceed:
- **Sprint 4:** backend renderer + AI feedback service + result endpoint + loader anchor extraction + CI integration
- **Sprint 5:** frontend deep-link UX (URL hash → scroll, highlight pulse, suggestion cards)

Combined Sprint 4+5 closes the loop on the **Result page → Grammar wiki user flow**: user finishes a practice session → AI feedback identifies a grammar issue → result page renders a suggestion linking directly to the exact section of the relevant grammar article.

---

## Next steps for Andy

1. Review: `git diff main...HEAD --stat` — expect 7 commits
2. Spot-check the 3 new topic files load correctly (visit `/grammar/discourse-markers-spoken`, `/grammar/grammatical-collocations`, `/grammar/pronunciation-grammar-link`)
3. Spot-check C1 + C3 merges integrated into targets:
   - `grammar-for-band7plus.md` should have `## High-leverage structures` populated
   - `hedging-language.md` should have new `## Nhóm 7: Distancing phrases` populated
4. Verify drift gate: `python backend/scripts/verify_anchor_drift.py` (expect 30 / 0 / 200)
5. Decide:
   - Merge to main → proceed Sprint 4 planning
   - Adjust → fix in branch
   - Rollback → backup at `backups/grammar-pre-sprint-3-20260503-*`
   - Optional: bump new topics' `status: draft` → `complete` if you want a stronger publication signal in the frontmatter
