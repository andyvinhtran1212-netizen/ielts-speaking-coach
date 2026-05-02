# Sprint 0 Execution Report — Grammar Content Audit

**Date:** 2026-05-02
**Branch:** `audit/grammar-sprint-0-cleanup-2026-05-02`
**Audited commit:** `1ca9792`
**Scope:** Drops + file-deletion merges + manifest update + loader exclusion. **Strictly no Sprint 1+ work** (no anchors, body edits, metadata updates, new topics, group renames).

---

## Outcome

| Metric | Value |
|---|---|
| Drops archived | **17 / 17** ✓ |
| Merges executed | **0 / 15** (all deferred to Sprint 2) |
| Slugs removed from `_groups.yaml` | **17** (drops only) |
| Active articles before / after | 126 → **109** |
| Loader fix shipped | ✓ |
| Regression test added | ✓ |
| Atomic commits | 4 |

---

## Reconciliation trail

The merge count went through several reductions as scope blockers surfaced:

| Step | Count | Source |
|---:|---:|---|
| 0 | 35 | Cowork manifest claim — conflated 16 file-merges with 19 metadata cross-refs |
| 1 | 16 | `02_merges.yaml` revised count (file-deletion merges only) |
| 2 | 15 | After dropping `PATTERN_CONTINUES_BELOW` sentinel placeholder |
| 3 | 7 | After Phase 1 prerequisite scan: 8 had missing parent sections |
| 4 | 3 | After deeper validator pass: 4 more had unresolved `after_section_with_heading` directives |
| 5 | **0** | Phase 3 execution: each remaining target had a near-miss heading mismatch (patch-spec typo) |

**Key insight:** Sprint 0's strict "no editorial judgment" gate excludes prefix-matching on near-miss headings (`## Bài tập` vs `## Bài tập luyện`, `## Loại 3: Third Conditional` vs `## Loại 3: Third Conditional — Giả định quá khứ`). These are spec typos that Sprint 2 prep will reconcile in the patches before re-execution.

---

## What shipped

### Commit 1 — `4376442` — Drops archived

Moves 17 Writing-only articles into `backend/content/_archive/2026-05-02_sprint-0-dropped/<category>/<slug>.md`.

- Files preserved verbatim — git detected all 17 as 100% renames.
- Reference cleaning applied to 3 surviving frontmatter entries; 7 cleanups correctly skipped (target also dropped, slug already absent, etc.).
- ARCHIVE_LOG_2026-05-02.md Section 1 records every archived slug with original path, archive path, and reason.

### Commit 2 — `5f6c996` — Merges deferred to Sprint 2

Documents the 15-merge deferral set in ARCHIVE_LOG_2026-05-02.md Section 2, categorized by reason:
- 6 merges depend on Sprint 2's `gerund-vs-infinitive-restructure` body edit
- 3 merges blocked by missing parent section in target (Sprint 2 body-edit prerequisite)
- 5 merges blocked by patch-spec heading typos / near-misses
- 1 merge marked optional and skipped per spec recommendation

Source files remain at their original paths so Sprint 2 can pick them up unchanged.

### Commit 3 — `2a4d04a` — Manifest update

Removes the 17 dropped slugs from `backend/content/_groups.yaml`. Line-based deletion preserves the file's inline-dict format — diff is exactly 17 deletions, no reformatting.

Merge sources are intentionally not removed (zero merges executed).

### Commit 4 — `a70ad2c` — Loader exclusion + regression test

Adds a 2-line guard to `services/grammar_content.py::_load_all` that skips any path containing `_archive` in its `Path.parts`. Without this, the existing `rglob('*.md')` would re-load every archived file at runtime, defeating the archive.

Pinned with `tests/test_grammar_content_archive_exclusion.py`. Test creates a sentinel article under `_archive/` and asserts the loaded slug index does not contain it. Verified the test fails on the pre-fix loader (surfacing both the sentinel and incidental archive files like `README` and `ARCHIVE_LOG_2026-05-02`).

---

## Verification

| Check | Result |
|---|---|
| `git diff main...HEAD --stat` | 17 deletions in `_groups.yaml`, 17 renames into `_archive/`, 1 loader edit, 1 new test, ARCHIVE_LOG + execution report added |
| `pytest tests/test_grammar_smoke.py tests/test_grammar_content_archive_exclusion.py` | 5 / 5 pass |
| `_groups.yaml` parses with `yaml.safe_load` | ✓, 109 articles |
| Backup at `backups/grammar-pre-audit-2026-05-02-*` | byte-identical to pre-Sprint-0 state |

---

## Sprint 2 prep — deferred work

The deferred-merges list in ARCHIVE_LOG Section 2 is the authoritative input for Sprint 2's merge re-attempt. Before Sprint 2 runs:

1. **Reconcile patch-spec heading typos in `02_merges.yaml`** (5 merges):
   - `combining-two-short-sentences`: change `## Bài tập` → `## Bài tập luyện`
   - `from-simple-to-complex-sentences`: depends on #1 first
   - `adding-conditions-naturally`: change `## Loại 3: Third Conditional` → `## Loại 3: Third Conditional — Giả định quá khứ`
   - `adding-contrast-naturally`: change `## Nhóm 4: Tương phản (Contrast)` → `## Nhóm 2: Tương phản (Contrast)`
   - `adding-results-clearly`: change `## Nhóm 5: Kết quả (Result)` → `## Nhóm 3: Nguyên nhân và Kết quả (Cause and Effect)`

2. **Land the body-edit prerequisites that 9 merges depend on** (Sprint 2 body-edits batch covers these):
   - `gerund-vs-infinitive-restructure` (unblocks 6 verb-pattern merges)
   - `## High-leverage structures` section in `grammar-for-band7plus`
   - `## Inversion với negative adverbials` section in `inversion`
   - `## Distancing phrases` section in `hedging-language`

3. **Decide on the 1 optional merge** (`zero-article` → `articles`) — patch spec marks this optional; default behaviour was to skip.

After (1)+(2), all 14 non-optional merges become mechanically executable. Re-running the Sprint 0 phase-3 script (with patch reconciliations applied) is sufficient — no per-file judgment needed.

---

## Out-of-scope items NOT touched in Sprint 0

Per the strict scope gate, Sprint 0 did not:
- Apply any anchor additions (Sprint 1)
- Apply any frontmatter metadata updates beyond reference cleaning of the 17 drops (Sprint 1)
- Apply any body edits (Sprint 2)
- Create any new topics (Sprint 3)
- Rename the `ielts-grammar-lab` group display name (deferred, ties into Sprint 2 cleanup)

---

## PR-ready

- 4 atomic commits, each cleanly reverting independently
- All affected paths tracked under git (including `_archive/` per archive policy)
- Validation report at `grammar-audit/sprint-0-validation-report.yaml`
- Recoverable: every archived file is restorable via the procedure in `backend/content/_archive/README.md`
